import type { z } from "zod";
import type { loadImage } from "../../shared/board";
import { isGitHubImageHost } from "../../shared/image-host";
import { gh } from "../github/gh";
import { listGithubAccounts } from "../github/host";

/**
 * An image out of a comment, fetched here because the app cannot: a
 * `github.com/user-attachments/assets/…` URL on a private repository answers
 * 404 to anyone without the token and, with it, answers a 302 to a signed
 * URL good for five minutes. The redirect is followed by hand
 * (`fetchFollowingRedirects` below) rather than left to `fetch`'s own
 * `redirect: "follow"`: the Authorization header must never reach that
 * signed leg — a presigned URL answers 400 to a request that also carries
 * one — and asserting that here is safer than trusting undici to keep
 * dropping it across origins forever.
 *
 * Only GitHub image hosts — `github.com`, and any host `gh` is authenticated
 * on, both narrowed to the `/user-attachments/` path this proxy exists to
 * serve — checked again here rather than trusted from the client, because
 * this is the daemon fetching a URL that a comment's author chose. An
 * Enterprise attachment is fetched with that host's own token, which
 * `gh auth token --hostname` answers.
 *
 * One cross-host case is accepted: a comment on one authenticated host can
 * make the daemon send an authenticated request to `/user-attachments/` on
 * another authenticated host. The bytes come back only to this user's
 * client, so the worst a comment author achieves is loading an image the
 * reader could have loaded anyway.
 */
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_CACHE_ENTRIES = 24;
const MAX_IMAGE_REDIRECTS = 5;

/**
 * `gh auth token`, remembered for five minutes per host so opening several
 * images in a row does not shell out to `gh` for each one. Kept in plain
 * module-local maps rather than the disk-backed `Cache` every other feature
 * in this plugin uses: unlike every other cached answer, this one *is* the
 * credential, and persisting it would write the account's GitHub token to a
 * file on every daemon restart — a strict downgrade from `gh`'s own 0600
 * `hosts.yml`. A five-minute memo needs no file to unlink either, because
 * nothing here ever reaches disk.
 */
const TOKEN_TTL_MS = 5 * 60_000;
const cachedTokens = new Map<string, { value: string; storedAt: number }>();
const tokensInFlight = new Map<string, Promise<string>>();

async function ghToken(hostname: string): Promise<string> {
  const hit = cachedTokens.get(hostname);
  if (hit !== undefined && Date.now() - hit.storedAt < TOKEN_TTL_MS) {
    return hit.value;
  }
  const running = tokensInFlight.get(hostname);
  if (running !== undefined) return running;
  const promise = (async () => {
    try {
      const token = (await gh(["auth", "token", "--hostname", hostname])).trim();
      if (token === "") throw new Error(`GitHub CLI has no token for ${hostname}.`);
      cachedTokens.set(hostname, { value: token, storedAt: Date.now() });
      return token;
    } finally {
      tokensInFlight.delete(hostname);
    }
  })();
  tokensInFlight.set(hostname, promise);
  return promise;
}

/**
 * The host whose token a redirect hop carries: the githubusercontent CDNs
 * answer to the github.com token — they are github.com's own image hosting,
 * not hosts gh itself is logged in to — and every other allowed host answers
 * to its own. Any host that is neither is refused before a hop is fetched,
 * so it never reaches this mapping; asking `gh auth token` for a CDN
 * hostname would fail, which is what this function exists to prevent.
 */
export function tokenHostname(hostname: string): string {
  return hostname.endsWith(".githubusercontent.com") ? "github.com" : hostname;
}

/**
 * Follows a redirect chain one hop at a time instead of handing `redirect:
 * "follow"` to `fetch`: the Authorization header a hop carries is always the
 * token of the host that hop belongs to, so one host's credential is never
 * sent to another, and the signed URL a `user-attachments` redirect resolves
 * to is fetched without any header at all.
 */
async function fetchFollowingRedirects(url: string, hosts: readonly string[]): Promise<Response> {
  let target = url;
  for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
    const carryToken = isGitHubImageHost(target, hosts);
    const headers = carryToken
      ? { Authorization: `token ${await ghToken(tokenHostname(new URL(target).hostname))}` }
      : {};
    const response = await fetch(target, { headers, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (location === null) return response;
    target = new URL(location, target).toString();
  }
  throw new Error("Too many redirects fetching this image.");
}

async function fetchImage(url: string): Promise<string> {
  const accounts = await listGithubAccounts();
  const hosts = accounts.map((account) => account.hostname);
  if (!isGitHubImageHost(url, hosts)) {
    throw new Error("Only images from GitHub or an authenticated host are fetched through the daemon.");
  }
  const response = await fetchFollowingRedirects(url, hosts);
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for this image.`);
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!type.startsWith("image/")) {
    throw new Error(`Not an image: GitHub answered with ${type || "no content type"}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > IMAGE_MAX_BYTES) {
    throw new Error("This image is too large to show here.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new Error("This image is too large to show here.");
  }
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * A handful of images, by URL, so scrolling back through a thread does not
 * fetch a screenshot twice. Bounded by count rather than time, unlike every
 * other cache in this plugin: each entry is a whole image rather than
 * something with a meaningful staleness window, so a plain count-bounded map
 * is kept here instead of routing through the shared TTL cache.
 */
const cachedImages = new Map<string, string>();

export async function loadImageHandler({
  url,
}: z.output<typeof loadImage.input>): Promise<z.input<typeof loadImage.output>> {
  const hit = cachedImages.get(url);
  if (hit !== undefined) return { dataUrl: hit };
  const dataUrl = await fetchImage(url);
  cachedImages.set(url, dataUrl);
  if (cachedImages.size > IMAGE_CACHE_ENTRIES) {
    const oldest = cachedImages.keys().next().value;
    if (oldest !== undefined) cachedImages.delete(oldest);
  }
  return { dataUrl };
}
