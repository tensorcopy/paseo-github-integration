/**
 * How long a cached answer is trusted before a remount or a settings change
 * refetches it, for the board itself and for the per-repository label
 * catalogue the label menu keeps alongside it.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * How often the board asks again while the daemon is refreshing the answer it
 * just served from its cache. Short enough that the fresh board lands without
 * the user reaching for Refresh, and each ask is cheap: the daemon answers
 * from memory until its own sweep finishes.
 */
export const STALE_POLL_MS = 3_000;
