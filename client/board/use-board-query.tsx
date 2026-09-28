import { useCallback, useEffect, useRef, useState } from "react";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Board } from "../../shared/board";
import { loadBoard, saveLogin } from "../../shared/board";
import { STALE_AFTER_MS, STALE_POLL_MS } from "./constants";

/**
 * The board's query key: the login it was fetched for (`null` meaning "let
 * the daemon pick") and the watched-owner sweep, sorted so two settings reads
 * that differ only in order never look like two different boards. `@tanstack/
 * react-query` owns the cache this used to be a module-scope object for; a
 * remount within `STALE_AFTER_MS` of the same key renders the cached answer
 * immediately and does not refetch, and widening or narrowing the owners is
 * simply a different key, which the query client fetches on its own without
 * the hand-written comparison this replaces.
 */
function boardQueryKey(login: string | undefined, owners: readonly string[]) {
  return ["board", login ?? null, [...owners].sort()] as const;
}

/** What `useBoardQuery` exposes to the surface and to the other board hooks. */
export interface UseBoardQueryResult {
  board: Board | null;
  busy: boolean;
  error: string | null;
  refresh: (login?: string, force?: boolean) => Promise<void>;
  loginDraft: string;
  applyLogin: (next: string) => Promise<void>;
  /** Patches the cached board in place; see the doc comment below. */
  mutateBoardCache: (updater: (current: Board) => Board) => void;
}

/**
 * The board fetch and its `@tanstack/react-query` cache: the query itself,
 * the login it is keyed on, the error and busy state the surface shows, and
 * the one helper (`mutateBoardCache`) that lets another hook patch the cached
 * board in place without reaching into the query client or the query key
 * itself.
 */
export function useBoardQuery(
  props: PluginSurfaceProps,
  watchedOwners: readonly string[],
  ownersReady: boolean,
): UseBoardQueryResult {
  const load = useRpc(loadBoard);
  const persistLogin = useRpc(saveLogin);
  const queryClient = useQueryClient();

  /**
   * The login the board is queried for. `undefined` lets the daemon pick,
   * which is every mount's starting point; it only ever becomes a concrete
   * login right after `applyLogin` persists one, and from then on it is part
   * of the query key below, so a return to a login already fetched under
   * this key answers from the query client's cache rather than refetching.
   */
  const [queryLogin, setQueryLogin] = useState<string | undefined>(undefined);
  /**
   * Set by `refresh` right before `refetch`, and read once by the query
   * function that refetch triggers: the Refresh button asks the daemon to
   * bypass its own cache too, but `refetch` cannot pass a fresh argument to
   * the function it re-runs, so this is how that one instruction crosses.
   */
  const forceNextBoardFetch = useRef(false);
  const boardQuery = useQuery({
    queryKey: boardQueryKey(queryLogin, watchedOwners),
    queryFn: () => {
      const force = forceNextBoardFetch.current;
      forceNextBoardFetch.current = false;
      return queryLogin === undefined
        ? load({ owners: [...watchedOwners], force })
        : load({ login: queryLogin, owners: [...watchedOwners], force });
    },
    staleTime: STALE_AFTER_MS,
    // A key change (the owner sweep widens or narrows, or the login switches)
    // keeps the previous key's board on screen while the new one loads,
    // which is what the hand-written cache did by never changing identity.
    placeholderData: keepPreviousData,
    /**
     * The watched owners are part of the key, so fetching before the settings
     * read lands would sweep GitHub for the empty owner list and then sweep
     * again for the real one — several seconds of `gh` calls spent on a board
     * nobody sees.
     */
    enabled: ownersReady,
    /**
     * A stale board is one the daemon is refreshing right now, so the fresh
     * one is a short wait away rather than a sweep away; asking again picks it
     * up. Polling stops the moment a board comes back fresh.
     */
    refetchInterval: (query) => (query.state.data?.stale === true ? STALE_POLL_MS : false),
  });
  const board = boardQuery.data ?? null;
  /**
   * Errors this surface reports beyond the board query's own: `applyLogin`'s
   * `saveLogin` RPC failing before the board fetch it triggers even runs. The
   * board query's own failure is merged in below, so the banner shows
   * whichever is live without either clobbering the other.
   */
  const [manualError, setManualError] = useState<string | null>(null);
  const boardErrorMessage =
    boardQuery.error == null
      ? null
      : boardQuery.error instanceof Error
        ? boardQuery.error.message
        : String(boardQuery.error);
  const error = manualError ?? boardErrorMessage;
  /**
   * True while the board query is in flight, including a background refetch
   * behind the board already on screen, and while `applyLogin` is fetching a
   * new login's board outside that query's own key (see `refresh`).
   */
  const [switchingLogin, setSwitchingLogin] = useState(false);
  const busy = boardQuery.isFetching || switchingLogin || !ownersReady;
  const [loginDraft, setLoginDraft] = useState(() => board?.login ?? "");
  useEffect(() => {
    if (board !== null) setLoginDraft(board.login);
  }, [board]);

  /**
   * Async **function expressions**, never async arrows, anywhere in the client
   * bundle: the app `eval`s this bundle, and Hermes's eval compiler on iOS and
   * Android evaluates an async arrow to `undefined` instead of a function —
   * silently, no SyntaxError.
   *
   * A login switches the query's key, so it is fetched through the query
   * client directly rather than through `boardQuery.refetch`, which only ever
   * refetches the key this render is bound to; `setQueryLogin` then moves the
   * render onto that key, where it finds the answer already cached. Nothing
   * else needs a distinct path: widening or narrowing the watched owners is
   * already a key change the query above reacts to on its own, so there is no
   * effect left here to reproduce that.
   */
  const refresh = useCallback(
    async function refresh(login?: string, force = false) {
      setManualError(null);
      if (login !== undefined) {
        setSwitchingLogin(true);
        try {
          await queryClient.fetchQuery({
            queryKey: boardQueryKey(login, watchedOwners),
            queryFn: () => load({ login, owners: [...watchedOwners], force }),
            // Ignore whatever is already cached under this key: a login the
            // user just applied is asked for again on purpose.
            staleTime: 0,
          });
          setQueryLogin(login);
        } catch (cause) {
          setManualError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSwitchingLogin(false);
        }
        return;
      }
      // The Refresh button and pull-to-refresh: same key, but `refetch` always
      // runs the query function regardless of `staleTime`, and `force` rides
      // along to the daemon so its own cache is bypassed too.
      if (force) forceNextBoardFetch.current = true;
      await boardQuery.refetch();
    },
    [boardQuery, load, queryClient, watchedOwners],
  );

  const applyLogin = useCallback(
    // Async function expression, not an async arrow — see `refresh`.
    async function applyLogin(next: string) {
      const trimmed = next.trim();
      if (trimmed === "" || trimmed === board?.login) return;
      try {
        const { login } = await persistLogin({ login: trimmed });
        await refresh(login);
      } catch (cause) {
        setManualError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [board?.login, persistLogin, refresh],
  );

  /**
   * Patches the cached board in place, for a mutation (a label toggle, a
   * merge) that already knows the outcome and would rather repaint it now
   * than wait for a refetch. Keeps `queryClient`, `queryLogin` and the query
   * key itself private to this hook: a caller only ever describes *how* the
   * board changes, never which cache entry that is.
   */
  const mutateBoardCache = useCallback(
    (updater: (current: Board) => Board) => {
      queryClient.setQueryData(boardQueryKey(queryLogin, watchedOwners), (current?: Board) =>
        current === undefined ? current : updater(current),
      );
    },
    [queryClient, queryLogin, watchedOwners],
  );

  return { board, busy, error, refresh, loginDraft, applyLogin, mutateBoardCache };
}

