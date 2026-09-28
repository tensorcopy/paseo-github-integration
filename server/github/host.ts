import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function ghProcessEnv(hostname: string | null): NodeJS.ProcessEnv {
  return hostname === null ? process.env : { ...process.env, GH_HOST: hostname };
}
