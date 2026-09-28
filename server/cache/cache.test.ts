import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache";

// `Cache` reads `XDG_STATE_HOME` (via `cacheDataDir`) once per instance, at
// construction time, so every test gets its own throwaway directory under the
// OS temp dir rather than touching the real user state directory.
let dataDir: string;
const originalXdgStateHome = process.env.XDG_STATE_HOME;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "github-integration-cache-test-"));
  process.env.XDG_STATE_HOME = dataDir;
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;
  await rm(dataDir, { recursive: true, force: true });
});

describe("Cache.get", () => {
  it("answers from memory within the TTL without calling the loader again", async () => {
    const cache = new Cache<number>("ttl-hit");
    const load = vi.fn().mockResolvedValue(1);
    expect(await cache.get("k", 10_000, load)).toBe(1);
    vi.setSystemTime(1_000_000 + 9_999);
    expect(await cache.get("k", 10_000, load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the entry is older than the TTL", async () => {
    const cache = new Cache<number>("ttl-miss");
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.get("k", 10_000, load)).toBe(1);
    vi.setSystemTime(1_000_000 + 10_001);
    expect(await cache.get("k", 10_000, load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers for the same key", async () => {
    const cache = new Cache<number>("single-flight");
    const load = vi.fn().mockResolvedValue(7);
    // Both calls are issued before either resolves, so the second must join
    // the first's in-flight sweep rather than starting its own.
    const [first, second] = await Promise.all([
      cache.get("k", 10_000, load),
      cache.get("k", 10_000, load),
    ]);
    expect(first).toBe(7);
    expect(second).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("persists across instances so a fresh Cache resumes without reloading", async () => {
    const first = new Cache<string>("persisted");
    await first.get("k", 10_000, () => Promise.resolve("stored value"));

    const second = new Cache<string>("persisted");
    const load = vi.fn().mockResolvedValue("should not be used");
    // Same faked "current" time, so the entry the second instance hydrates
    // from disk is still within its TTL: a real reload here would mean
    // persistence did not actually round-trip.
    expect(await second.get("k", 10_000, load)).toBe("stored value");
    expect(load).not.toHaveBeenCalled();
  });

  it("writes JSON to the on-disk cache file a persisted instance can read back", async () => {
    const cache = new Cache<string>("on-disk");
    await cache.get("k", 10_000, () => Promise.resolve("v"));
    const raw = await readFile(join(dataDir, "paseo-github-integration", "cache", "on-disk.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, { value: string; storedAt: number }>;
    expect(parsed.k?.value).toBe("v");
  });
});

describe("Cache.read with revalidate", () => {
  it("answers from the expired entry and marks it stale while reloading behind the caller", async () => {
    const cache = new Cache<number>("revalidate");
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.read("k", 10_000, load)).toEqual({ value: 1, stale: false });

    vi.setSystemTime(1_000_000 + 10_001);
    expect(await cache.read("k", 10_000, load, { revalidate: true })).toEqual({
      value: 1,
      stale: true,
    });

    // The background sweep started; once it lands the same call answers fresh.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await cache.read("k", 10_000, load, { revalidate: true })).toEqual({
      value: 2,
      stale: false,
    });
  });

  it("drops the expired entry when the refreshed answer may not be cached", async () => {
    const cache = new Cache<number>("revalidate-uncacheable");
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(2);
    await cache.read("k", 10_000, load);

    // The sweep runs but its answer is declined, so the entry behind it goes
    // too: serving it again would pin the caller to an answer that only ages.
    vi.setSystemTime(1_000_000 + 10_001);
    const decline = { revalidate: true, shouldCache: () => false };
    expect(await cache.read("k", 10_000, load, decline)).toEqual({ value: 1, stale: true });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    // Never the remembered 1 again: the caller waits for a real answer.
    expect(await cache.read("k", 10_000, load, decline)).toEqual({ value: 2, stale: false });
  });

  it("still waits for the first sweep when nothing is cached yet", async () => {
    const cache = new Cache<number>("revalidate-cold");
    const load = vi.fn().mockResolvedValue(5);
    expect(await cache.read("k", 10_000, load, { revalidate: true })).toEqual({
      value: 5,
      stale: false,
    });
  });
});

describe("Cache file permissions", () => {
  it("creates the cache file at 0600 and its directory at 0700", async () => {
    const cache = new Cache<string>("perm-fresh");
    await cache.get("k", 10_000, () => Promise.resolve("v"));

    const cacheDir = join(dataDir, "paseo-github-integration", "cache");
    const fileStat = await stat(join(cacheDir, "perm-fresh.json"));
    const dirStat = await stat(cacheDir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("hardens a pre-existing 0644 cache file back to 0600 on first write", async () => {
    const cacheDir = join(dataDir, "paseo-github-integration", "cache");
    await mkdir(cacheDir, { recursive: true });
    const file = join(cacheDir, "perm-stale.json");
    // Simulates a file an older build already wrote at `writeFile`'s
    // world-readable default mode, before this instance ever persists.
    await writeFile(file, "{}", { mode: 0o644 });
    expect((await stat(file)).mode & 0o777).toBe(0o644);

    const cache = new Cache<string>("perm-stale");
    await cache.get("k", 10_000, () => Promise.resolve("v"));

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe("Cache.invalidate", () => {
  it("drops the entry so the next get reloads regardless of its age", async () => {
    const cache = new Cache<number>("invalidate");
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.get("k", 10_000, load)).toBe(1);
    await cache.invalidate("k");
    // Still well within the TTL window; only invalidation should force a reload.
    expect(await cache.get("k", 10_000, load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("Cache.patchAll", () => {
  it("rewrites every cached value in place without resetting its stored age", async () => {
    const cache = new Cache<{ n: number }>("patch-all");
    await cache.set("a", { n: 1 });
    await cache.set("b", { n: 10 });

    await cache.patchAll((value) => ({ n: value.n + 1 }));

    const load = vi.fn().mockResolvedValue({ n: -1 });
    // Still inside the TTL relative to the original `set` time, so the
    // patched value must come back untouched by `load`.
    vi.setSystemTime(1_000_000 + 500);
    expect(await cache.get("a", 10_000, load)).toEqual({ n: 2 });
    expect(await cache.get("b", 10_000, load)).toEqual({ n: 11 });
    expect(load).not.toHaveBeenCalled();

    // Patching must not refresh `storedAt`: once the original age crosses
    // the TTL, a get still reloads even though patchAll ran more recently.
    vi.setSystemTime(1_000_000 + 10_001);
    expect(await cache.get("a", 10_000, load)).toEqual({ n: -1 });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
