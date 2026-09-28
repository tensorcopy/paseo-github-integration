import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Board } from "../../shared/board";
import type { BoardMode } from "../lib/board-modes";
import { isRelation, RELATION_FILTERS } from "../lib/relations";
import { matchesSearchTerms, parseSearchQuery } from "../lib/search";
import {
  compareBySortDate,
  DEFAULT_SORT_ORDER,
  isSortId,
  SORT_ORDERS,
  type BoardRow,
  type SortOrder,
} from "../lib/sort";
import { withHostHeaders, type ListRow } from "./host-sections";
import type { UseBoardSettingsResult } from "./use-board-settings";

/** Which of the three dropdowns is open; never more than one at once, so one backdrop closes any of them. */
export type OpenBoardFilter = "repo" | "owner" | "sort" | null;

/** What `useBoardFilters` exposes to the surface and to the other board hooks. */
export interface UseBoardFiltersResult {
  mode: BoardMode;
  selectColumnMode: (id: BoardMode) => void;
  showDiscussionsMode: boolean;
  visibleRelations: typeof RELATION_FILTERS;
  effectiveRelation: string;
  relationCounts: Map<string, number>;
  commitRelation: (next: string) => void;
  allOwners: string[];
  ownerCounts: Map<string, number>;
  hiddenOwners: ReadonlySet<string>;
  toggleOwner: (owner: string) => void;
  selectAllOwners: () => void;
  selectNoOwners: () => void;
  repositories: string[];
  hiddenRepos: ReadonlySet<string>;
  toggleRepo: (repository: string) => void;
  selectAllRepos: () => void;
  selectNoRepos: () => void;
  visibleSortOrders: readonly SortOrder[];
  effectiveSort: string;
  commitSort: (next: string) => void;
  searchQuery: string;
  setSearchQuery: (next: string) => void;
  displayRows: BoardRow[];
  /** `displayRows` with a heading before each host's run of cards; see `withHostHeaders`. */
  listRows: ListRow[];
  modeRows: { rows: BoardRow[]; error: string | null };
  openFilter: OpenBoardFilter;
  setOpenFilter: Dispatch<SetStateAction<OpenBoardFilter>>;
  /** The ordering object behind `effectiveSort`, shared by the sort and by every row's meta line. */
  activeOrder: SortOrder;
}

/**
 * The board's four columns with the repository, relation, owner and search
 * filters applied, the mode switcher choosing which mode's rows those
 * filters run over, and the resulting sort. Every dropdown's open/closed
 * state lives here too, since it is one more piece of the same filter UI.
 * The repository, relation and sort choices are hydrated once from
 * `display` when it first becomes ready, and persisted back to it on every
 * change from then on; the owner filter and the free-text search are session
 * only, the way they were before this hook existed.
 */
export function useBoardFilters(
  board: Board | null,
  display: UseBoardSettingsResult["display"],
): UseBoardFiltersResult {
  const savedHidden = display.status === "ready" ? display.values.hiddenRepositories : null;
  const savedRelation = display.status === "ready" ? display.values.relation : null;
  const savedSort = display.status === "ready" ? display.values.sort : null;

  const [hiddenRepos, setHiddenRepos] = useState<ReadonlySet<string>>(() => new Set());
  /** Owners hidden from the current view. Not persisted: only the relation filter is. */
  const [hiddenOwners, setHiddenOwners] = useState<ReadonlySet<string>>(() => new Set());
  /** Which of the three dropdowns is open; never more than one at once, so one backdrop closes any of them. */
  const [openFilter, setOpenFilter] = useState<OpenBoardFilter>(null);
  /** The last relation chip picked, hydrated from and persisted to `displaySettings`. */
  const [relationFilter, setRelationFilter] = useState<string>("all");
  /** The last ordering picked, hydrated from and persisted to `displaySettings`. */
  const [sortOrder, setSortOrder] = useState<string>("updated");
  const [searchQuery, setSearchQuery] = useState("");
  /**
   * Which of the four modes fills the body. Not persisted — the user picks it
   * fresh every time the surface mounts, the way a browser tab does.
   */
  const [mode, setMode] = useState<BoardMode>("pull-requests");

  /**
   * The saved filter is adopted once, when the settings read first lands. Later
   * pushes must not overwrite what the user is toggling right now — and the
   * local set is already what was just written, so re-adopting it would only
   * ever be a chance to undo a toggle.
   */
  const filterHydrated = useRef(false);
  useEffect(() => {
    if (filterHydrated.current || savedHidden === null) return;
    filterHydrated.current = true;
    setHiddenRepos(new Set(savedHidden));
  }, [savedHidden]);

  /** Same one-shot adoption as the repository filter, for the relation chip. */
  const relationHydrated = useRef(false);
  useEffect(() => {
    if (relationHydrated.current || savedRelation === null) return;
    relationHydrated.current = true;
    setRelationFilter(savedRelation === "all" || isRelation(savedRelation) ? savedRelation : "all");
  }, [savedRelation]);

  /** Same one-shot adoption again, for the ordering; an id this build does not know falls back to "updated". */
  const sortHydrated = useRef(false);
  useEffect(() => {
    if (sortHydrated.current || savedSort === null) return;
    sortHydrated.current = true;
    setSortOrder(isSortId(savedSort) ? savedSort : "updated");
  }, [savedSort]);

  /** Every repository with an item in any column, whether or not it is filtered out. */
  const repositories = useMemo(() => {
    const seen = new Set<string>();
    for (const column of board?.columns ?? []) {
      for (const item of column.items) {
        if (item.repository !== "") seen.add(item.repository);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [board]);

  /**
   * The board's four columns with the repository filter applied and, once
   * that leaves a pull request's linked issue with nothing claiming it,
   * folded so the issue keeps only the pull request's card. Every mode reads
   * from here — no column is dropped for being empty, because which one is on
   * screen is now the user's own choice via the mode switcher rather than a
   * layout decision.
   */
  const filteredColumns = useMemo(() => {
    if (board === null) return null;
    const visible =
      hiddenRepos.size === 0
        ? board.columns
        : board.columns.map((column) => ({
            ...column,
            items: column.items.filter((item) => !hiddenRepos.has(item.repository)),
          }));

    /**
     * An issue with a pull request open against it is the same piece of work as
     * that pull request, so it gets one row, not two — the pull request's,
     * carrying the issue as a pill. Drafts count: the work exists either way.
     *
     * This runs after the repository filter rather than on the server, so a
     * pull request hidden by the filter stops claiming its issue instead of
     * taking the issue's row off the board with it.
     */
    const claimed = new Set<string>();
    for (const column of visible) {
      if (column.id !== "draft-prs" && column.id !== "open-prs") continue;
      for (const item of column.items) {
        for (const issue of item.linkedIssues) claimed.add(issue.id);
      }
    }
    if (claimed.size === 0) return visible;
    return visible.map((column) =>
      column.id === "issues"
        ? { ...column, items: column.items.filter((item) => !claimed.has(item.id)) }
        : column,
    );
  }, [board, hiddenRepos]);

  const issuesColumn = filteredColumns?.find((column) => column.id === "issues") ?? null;
  const draftColumn = filteredColumns?.find((column) => column.id === "draft-prs") ?? null;
  const openColumn = filteredColumns?.find((column) => column.id === "open-prs") ?? null;
  const discussionsColumn = filteredColumns?.find((column) => column.id === "discussions") ?? null;

  /** Discussions only earns a place in the switcher when there is something to show for it, or a reason it failed to load. */
  const showDiscussionsMode =
    discussionsColumn !== null &&
    (discussionsColumn.items.length > 0 || discussionsColumn.error !== null);

  useEffect(() => {
    if (mode === "discussions" && !showDiscussionsMode) setMode("pull-requests");
  }, [mode, showDiscussionsMode]);

  /**
   * The rows the active mode shows, before the relation, owner and search
   * filters narrow them further. Draft and open pull requests are merged into
   * one list here — the switcher's whole point — sorted back into one
   * chronological order rather than left as "every draft, then every open".
   */
  const modeRows = useMemo((): { rows: BoardRow[]; error: string | null } => {
    if (mode === "pull-requests") {
      const rows: BoardRow[] = [
        ...(draftColumn?.items.map((item) => ({ item, type: "draft-prs" as const })) ?? []),
        ...(openColumn?.items.map((item) => ({ item, type: "open-prs" as const })) ?? []),
      ];
      rows.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
      return { rows, error: draftColumn?.error ?? openColumn?.error ?? null };
    }
    if (mode === "issues") {
      return {
        rows: issuesColumn?.items.map((item) => ({ item, type: "issues" as const })) ?? [],
        error: issuesColumn?.error ?? null,
      };
    }
    if (mode === "discussions") {
      return {
        rows: discussionsColumn?.items.map((item) => ({ item, type: "discussions" as const })) ?? [],
        error: discussionsColumn?.error ?? null,
      };
    }
    return { rows: [], error: null };
  }, [mode, draftColumn, openColumn, issuesColumn, discussionsColumn]);

  /**
   * The chips this mode has any use for, and the relation actually applied.
   * A saved relation the mode does not offer falls back to "All" here rather
   * than being overwritten: switching to Issues should not lose the "Needs my
   * review" the user picked on Pull requests and will find again on the way
   * back.
   */
  const visibleRelations = useMemo(
    () => RELATION_FILTERS.filter((filter) => filter.modes?.includes(mode) ?? true),
    [mode],
  );
  const effectiveRelation = visibleRelations.some((filter) => filter.id === relationFilter)
    ? relationFilter
    : "all";

  /**
   * The orderings this mode has any use for, and the one actually applied. A
   * saved ordering the mode does not offer falls back to "Recently updated"
   * here rather than being overwritten, the same way `effectiveRelation`
   * spares a relation the current mode cannot honour.
   */
  const visibleSortOrders = useMemo(
    () => SORT_ORDERS.filter((order) => order.modes?.includes(mode) ?? true),
    [mode],
  );
  const effectiveSort = visibleSortOrders.some((order) => order.id === sortOrder)
    ? sortOrder
    : "updated";

  /** How many rows each relation chip would show, from the active mode's rows before that chip is applied. */
  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const filter of visibleRelations) {
      // `isRelation` narrows, so the count below needs no cast: a chip id that
      // is not a relation is "all", which counts every row.
      const wanted = isRelation(filter.id) ? filter.id : null;
      counts.set(
        filter.id,
        wanted === null
          ? modeRows.rows.length
          : modeRows.rows.filter((row) => row.item.relations.includes(wanted)).length,
      );
    }
    return counts;
  }, [modeRows, visibleRelations]);

  const relationFiltered = useMemo(() => {
    if (effectiveRelation === "all" || !isRelation(effectiveRelation)) return modeRows.rows;
    const wanted = effectiveRelation;
    return modeRows.rows.filter((row) => row.item.relations.includes(wanted));
  }, [modeRows, effectiveRelation]);

  /** Every distinct owner on the board, independent of the active mode, so switching modes never reshuffles the dropdown. */
  const allOwners = useMemo(() => {
    const seen = new Set<string>();
    for (const column of filteredColumns ?? []) {
      for (const item of column.items) seen.add(item.owner);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [filteredColumns]);

  /** How many of the relation-filtered rows each owner would keep. */
  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of relationFiltered) {
      counts.set(row.item.owner, (counts.get(row.item.owner) ?? 0) + 1);
    }
    return counts;
  }, [relationFiltered]);

  const ownerFiltered = useMemo(() => {
    if (hiddenOwners.size === 0) return relationFiltered;
    return relationFiltered.filter((row) => !hiddenOwners.has(row.item.owner));
  }, [relationFiltered, hiddenOwners]);

  /** Relation, then owner, then repository (already applied in `filteredColumns`), then this search, then the chosen ordering. */
  const searchTerms = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);
  const searchedRows = useMemo(() => {
    if (searchTerms.length === 0) return ownerFiltered;
    return ownerFiltered.filter((row) => matchesSearchTerms(row.item, searchTerms));
  }, [ownerFiltered, searchTerms]);
  const activeOrder = useMemo(
    () => SORT_ORDERS.find((candidate) => candidate.id === effectiveSort) ?? DEFAULT_SORT_ORDER,
    [effectiveSort],
  );
  const displayRows = useMemo(() => {
    // A copy: `searchedRows` is memoised and every filter above it relies on
    // that identity staying stable, so sorting has to run on a fresh array
    // rather than the shared one in place.
    return [...searchedRows].sort((a, b) => compareBySortDate(activeOrder, a, b));
  }, [searchedRows, activeOrder]);
  const listRows = useMemo(() => withHostHeaders(displayRows), [displayRows]);

  const selectColumnMode = useCallback((id: BoardMode) => setMode(id), []);

  /**
   * Applies a selection locally and saves it, so it survives the next unmount.
   * The local set moves first: the filter is what the user is looking at, and
   * waiting on a round trip to redraw it would make every toggle feel remote.
   */
  const commitHidden = useCallback(
    (next: ReadonlySet<string>) => {
      setHiddenRepos(next);
      if (display.status !== "ready") return;
      void display
        .save({ ...display.values, hiddenRepositories: [...next].sort() }, display.revision)
        .then((saved) => {
          if (!saved) console.warn(`[github-board] repository filter could not be saved: ${display.saveError ?? ""}`);
        });
    },
    [display],
  );

  const commitRelation = useCallback(
    (next: string) => {
      setRelationFilter(next);
      if (display.status !== "ready") return;
      void display.save({ ...display.values, relation: next }, display.revision).then((saved) => {
        if (!saved) console.warn(`[github-board] relation filter could not be saved: ${display.saveError ?? ""}`);
      });
    },
    [display],
  );

  const commitSort = useCallback(
    (next: string) => {
      setSortOrder(next);
      if (display.status !== "ready") return;
      void display.save({ ...display.values, sort: next }, display.revision).then((saved) => {
        if (!saved) console.warn(`[github-board] sort order could not be saved: ${display.saveError ?? ""}`);
      });
    },
    [display],
  );

  const toggleRepo = useCallback(
    (repository: string) => {
      const next = new Set(hiddenRepos);
      if (!next.delete(repository)) next.add(repository);
      commitHidden(next);
    },
    [commitHidden, hiddenRepos],
  );

  const selectAllRepos = useCallback(() => {
    commitHidden(new Set());
  }, [commitHidden]);

  const selectNoRepos = useCallback(() => {
    commitHidden(new Set(repositories));
  }, [commitHidden, repositories]);

  const toggleOwner = useCallback((owner: string) => {
    setHiddenOwners((current) => {
      const next = new Set(current);
      if (!next.delete(owner)) next.add(owner);
      return next;
    });
  }, []);

  const selectAllOwners = useCallback(() => setHiddenOwners(new Set()), []);
  const selectNoOwners = useCallback(() => setHiddenOwners(new Set(allOwners)), [allOwners]);

  return {
    mode,
    selectColumnMode,
    showDiscussionsMode,
    visibleRelations,
    effectiveRelation,
    relationCounts,
    commitRelation,
    allOwners,
    ownerCounts,
    hiddenOwners,
    toggleOwner,
    selectAllOwners,
    selectNoOwners,
    repositories,
    hiddenRepos,
    toggleRepo,
    selectAllRepos,
    selectNoRepos,
    visibleSortOrders,
    effectiveSort,
    commitSort,
    searchQuery,
    setSearchQuery,
    displayRows,
    listRows,
    modeRows,
    openFilter,
    setOpenFilter,
    activeOrder,
  };
}
