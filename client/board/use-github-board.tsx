import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

import type { Styles } from "../theme/use-styles";
import { useBoardFilters } from "./use-board-filters";
import { useBoardOverlays } from "./use-board-overlays";
import { useBoardQuery } from "./use-board-query";
import { useBoardSettings } from "./use-board-settings";
import { chatLinkFor, useChatLinks } from "./use-chat-links";

/**
 * Everything the board surface needs beyond its own JSX: the fetch and its
 * query cache (`useBoardQuery`), the host settings this client draws the
 * board from and the one-way legacy migration (`useBoardSettings`), the
 * filter/sort/search pipeline and the mode switcher (`useBoardFilters`), and
 * the mutations a label edit or a merge applies to the board in place plus
 * the overlays — detail panel, label menu, send dialog, settings screen —
 * the surface can show one of at a time (`useBoardOverlays`). Kept as one
 * hook, not one component, so the JSX in `github-board.tsx` reads exactly as
 * it did before the split: every name it references is simply destructured
 * off this hook's return instead of declared inline.
 */
export function useGitHubBoard(props: PluginSurfaceProps, styles: Styles) {
  const settings = useBoardSettings();
  const query = useBoardQuery(props, settings.watchedOwners);
  const filters = useBoardFilters(query.board, settings.display);
  const chatLinks = useChatLinks(props.host.id);
  const overlays = useBoardOverlays(props, styles, {
    board: query.board,
    promptValues: settings.promptValues,
    mutateBoardCache: query.mutateBoardCache,
    activeOrder: filters.activeOrder,
    chatLinkForItem: (item) => chatLinkFor(chatLinks, item.url),
  });

  return {
    board: query.board,
    busy: query.busy,
    error: query.error,
    refresh: query.refresh,
    mode: filters.mode,
    selectColumnMode: filters.selectColumnMode,
    showDiscussionsMode: filters.showDiscussionsMode,
    visibleRelations: filters.visibleRelations,
    effectiveRelation: filters.effectiveRelation,
    relationCounts: filters.relationCounts,
    commitRelation: filters.commitRelation,
    allOwners: filters.allOwners,
    ownerCounts: filters.ownerCounts,
    hiddenOwners: filters.hiddenOwners,
    toggleOwner: filters.toggleOwner,
    selectAllOwners: filters.selectAllOwners,
    selectNoOwners: filters.selectNoOwners,
    repositories: filters.repositories,
    hiddenRepos: filters.hiddenRepos,
    toggleRepo: filters.toggleRepo,
    selectAllRepos: filters.selectAllRepos,
    selectNoRepos: filters.selectNoRepos,
    visibleSortOrders: filters.visibleSortOrders,
    effectiveSort: filters.effectiveSort,
    commitSort: filters.commitSort,
    searchQuery: filters.searchQuery,
    setSearchQuery: filters.setSearchQuery,
    promptValues: settings.promptValues,
    loginDraft: query.loginDraft,
    applyPrompts: settings.applyPrompts,
    applyLogin: query.applyLogin,
    watchedOwners: settings.watchedOwners,
    displayRows: filters.displayRows,
    renderRow: overlays.renderRow,
    modeRows: filters.modeRows,
    bodyWidth: overlays.bodyWidth,
    setBodyWidth: overlays.setBodyWidth,
    detailTarget: overlays.detailTarget,
    detailItem: overlays.detailItem,
    detailChatLink: overlays.detailChatLink,
    detailProgress: overlays.detailProgress,
    closeDetails: overlays.closeDetails,
    savedFraction: settings.savedFraction,
    commitWidth: settings.commitWidth,
    openSendDialog: overlays.openSendDialog,
    dropItem: overlays.dropItem,
    labelTarget: overlays.labelTarget,
    setLabelTarget: overlays.setLabelTarget,
    applyItemLabels: overlays.applyItemLabels,
    sendTarget: overlays.sendTarget,
    setSendTarget: overlays.setSendTarget,
    handleLaunched: overlays.handleLaunched,
    rootRef: overlays.rootRef,
    openFilter: filters.openFilter,
    setOpenFilter: filters.setOpenFilter,
    showSettings: overlays.showSettings,
    setShowSettings: overlays.setShowSettings,
  };
}
