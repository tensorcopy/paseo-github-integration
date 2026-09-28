import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const hostnameContext = new AsyncLocalStorage<string>();

export interface GithubAccount {
  hostname: string;
  login: string;
}

function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

function hostnameSettingsPaths(): string[] {
  const home = paseoHome();
  return [
    join(home, "plugins", "github-integration", "settings.json"),
    join(home, "plugins", "github-board", "settings.json"),
  ];
}

/** Resolve the GitHub host from the daemon environment or saved plugin settings. */
export async function githubHostname(): Promise<string | null> {
  const contextual = hostnameContext.getStore();
  if (contextual !== undefined) return contextual;

  const fromEnv = process.env.GH_HOST?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  for (const path of hostnameSettingsPaths()) {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (typeof parsed !== "object" || parsed === null) continue;
      const hostname = (parsed as { hostname?: unknown }).hostname;
      if (typeof hostname === "string" && hostname.trim() !== "") return hostname.trim();
    } catch {
      // Missing or unreadable; try the next path.
    }
  }
  return null;
}

export function withGithubHostname<T>(hostname: string, run: () => Promise<T>): Promise<T> {
  return hostnameContext.run(hostname, run);
}

export function parseGithubAccounts(value: unknown): GithubAccount[] {
  const hosts = (value as { hosts?: unknown } | null)?.hosts;
  if (typeof hosts !== "object" || hosts === null) return [];

  const accounts: GithubAccount[] = [];
  for (const [hostname, rawEntries] of Object.entries(hosts)) {
    if (!Array.isArray(rawEntries)) continue;
    const entries = rawEntries.filter(
      (entry): entry is { state?: unknown; active?: unknown; login?: unknown } =>
        typeof entry === "object" && entry !== null,
    );
    const selected =
      entries.find((entry) => entry.state === "success" && entry.active === true) ??
      entries.find((entry) => entry.state === "success");
    if (selected !== undefined && typeof selected.login === "string" && selected.login !== "") {
      accounts.push({ hostname, login: selected.login });
    }
  }
  return accounts.sort((left, right) => left.hostname.localeCompare(right.hostname));
}

/**
 * `gh auth status` validates each token against its host, so it costs a
 * subprocess and a round trip per call — the better part of two seconds, paid
 * before the board can even look in its own cache. Who is logged in changes
 * only when someone runs `gh auth login`, so the answer is remembered for a
 * few minutes and shared by every request in that window.
 */
const ACCOUNTS_TTL_MS = 5 * 60_000;
let cachedAccounts: { accounts: GithubAccount[]; storedAt: number } | null = null;
let accountsInFlight: Promise<GithubAccount[]> | null = null;

async function readGithubAccounts(): Promise<GithubAccount[]> {
  const { GH_HOST: _ignored, ...env } = process.env;
  // `gh auth status` exits non-zero when any one host is in a failed state —
  // an expired login on one host must not blank the board for the hosts that
  // are fine — so the stdout is parsed first and the failure honoured only
  // when the stdout says nothing usable.
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("gh", ["auth", "status", "--json", "hosts"], {
      env,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    const output = error as { stdout?: unknown };
    if (typeof output.stdout === "string") stdout = output.stdout;
  }
  const accounts = parseGithubAccounts(stdout.trim() === "" ? [] : JSON.parse(stdout));
  if (accounts.length === 0) {
    throw new Error("GitHub CLI has no authenticated hosts. Run `gh auth login`.");
  }
  return accounts;
}

/** Every authenticated host known to gh, with the active account for each host. */
export async function listGithubAccounts(force = false): Promise<GithubAccount[]> {
  if (!force && cachedAccounts !== null && Date.now() - cachedAccounts.storedAt < ACCOUNTS_TTL_MS) {
    return cachedAccounts.accounts;
  }
  // A failed read is not remembered, so a `gh auth login` in another terminal
  // takes effect on the next request rather than at the end of the window.
  if (accountsInFlight === null) {
    accountsInFlight = (async () => {
      try {
        const accounts = await readGithubAccounts();
        cachedAccounts = { accounts, storedAt: Date.now() };
        return accounts;
      } finally {
        accountsInFlight = null;
      }
    })();
  }
  return accountsInFlight;
}

export function ghProcessEnv(hostname: string | null): NodeJS.ProcessEnv {
  return hostname === null ? process.env : { ...process.env, GH_HOST: hostname };
}

export function projectScopeCommand(hostname: string | null): string {
  return `gh auth refresh -h ${hostname ?? "github.com"} -s read:project`;
}
