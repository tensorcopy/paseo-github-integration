import type { BoardColumn } from "../../shared/board";
import { Cache } from "../cache/cache";

/**
 * How old a cached board may be before the next request sweeps GitHub again.
 * Nobody waits for that sweep — an expired board is served immediately and
 * refreshed behind the surface — so this is only about how far behind GitHub
 * the board is allowed to run, not about how fast it opens. A minute keeps a
 * pull request merged elsewhere from lingering while still collapsing the
 * burst of requests a workspace switch or a window focus produces. The
 * Refresh button sends `force` and skips it entirely.
 */
export const BOARD_TTL_MS = 60_000;

export interface CachedBoard {
  columns: BoardColumn[];
  fetchedAt: string;
}

/** Keyed by login, limit and the watched owners — see `loadBoardHandler`. */
export const boardCache = new Cache<CachedBoard>("board");

/**
 * Keeps the cached board honest. Without this a label edited now would be
 * undone on screen by the next cache hit — the board is remembered for five
 * minutes, and a surface remounts on every workspace switch.
 */
export async function patchCachedLabels(itemId: string, labels: readonly string[]): Promise<void> {
  await boardCache.patchAll((cached) => ({
    ...cached,
    columns: cached.columns.map((column) => ({
      ...column,
      items: column.items.map((item) => (item.id === itemId ? { ...item, labels: [...labels] } : item)),
    })),
  }));
}

/**
 * Drops one card from the cached board. A merged pull request no longer
 * answers the `state:open` search the board runs, so leaving it in the cache
 * would show it as open again for up to five minutes after it landed.
 */
export async function dropCachedItem(itemId: string): Promise<void> {
  await boardCache.patchAll((cached) => ({
    ...cached,
    columns: cached.columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => item.id !== itemId),
    })),
  }));
}
