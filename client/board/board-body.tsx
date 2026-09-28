import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import type { Board, BoardItem, ColumnId, PromptSettings } from "../../shared/board";
import { ItemDetailPanel } from "../detail/detail-panel";
import type { BoardMode } from "../lib/board-modes";
import type { BoardRow } from "../lib/sort";
import { ProjectsView } from "../projects/projects-view";
import { EMPTY_PROMPTS, PromptSettingsView } from "../settings/prompt-settings-view";
import type { Styles } from "../theme/use-styles";
import { openExternalUrl } from "../web";
import type { ChatLink } from "./use-chat-links";

/**
 * Everything below the header and the toolbar: the settings screen when it is
 * open, or the board itself — the list for the active mode, the Projects tab,
 * and the detail panel it can open a card into — when it is not. Kept as one
 * component because the two share the one `styles.body` region the surface
 * lays them into.
 */
export function BoardBody({
  surfaceProps,
  styles,
  showSettings,
  promptValues,
  loginDraft,
  busy,
  applyPrompts,
  applyLogin,
  board,
  mode,
  watchedOwners,
  displayRows,
  renderRow,
  modeRows,
  refresh,
  bodyWidth,
  setBodyWidth,
  detailTarget,
  detailItem,
  detailChatLink,
  detailProgress,
  closeDetails,
  savedFraction,
  commitWidth,
  openSendDialog,
  dropItem,
}: {
  surfaceProps: PluginSurfaceProps;
  styles: Styles;
  showSettings: boolean;
  promptValues: PromptSettings | null;
  loginDraft: string;
  busy: boolean;
  applyPrompts: (next: PromptSettings) => Promise<void>;
  applyLogin: (next: string) => Promise<void>;
  board: Board | null;
  mode: BoardMode;
  watchedOwners: readonly string[];
  displayRows: readonly BoardRow[];
  renderRow: (info: { item: BoardRow }) => React.JSX.Element;
  modeRows: { rows: BoardRow[]; error: string | null };
  refresh: (login?: string, force?: boolean) => Promise<void>;
  bodyWidth: number | null;
  setBodyWidth: (next: number | null) => void;
  detailTarget: { item: BoardItem; type: ColumnId } | null;
  detailItem: BoardItem | null;
  detailChatLink: ChatLink | null;
  detailProgress: Animated.Value;
  closeDetails: () => void;
  savedFraction: number | null;
  commitWidth: (fraction: number) => void;
  openSendDialog: (item: BoardItem, type: ColumnId) => void;
  dropItem: (itemId: string) => void;
}) {
  if (showSettings) {
    return (
      <PromptSettingsView
        styles={styles}
        prompts={promptValues ?? EMPTY_PROMPTS}
        login={loginDraft}
        busy={busy}
        mutedColor={surfaceProps.theme.colors.foregroundMuted}
        onSave={applyPrompts}
        onApplyLogin={applyLogin}
      />
    );
  }

  return (
    <View style={styles.body} onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width)}>
      {board === null ? (
        <View style={styles.centered}>
          {busy ? <ActivityIndicator color={surfaceProps.theme.colors.accent} /> : null}
        </View>
      ) : mode === "projects" ? (
        <ProjectsView
          theme={surfaceProps.theme}
          layout={surfaceProps.layout}
          login={board.login}
          owners={watchedOwners}
          onOpenUrl={openExternalUrl}
        />
      ) : (
        <FlatList
          style={styles.rowList}
          data={displayRows}
          keyExtractor={(row) => row.item.id}
          renderItem={renderRow}
          ListEmptyComponent={
            modeRows.error !== null ? (
              <Text style={[styles.danger, styles.empty]}>{modeRows.error}</Text>
            ) : modeRows.rows.length === 0 ? (
              <Text style={styles.empty}>Nothing here.</Text>
            ) : (
              <Text style={styles.empty}>No items match the current filters.</Text>
            )
          }
          contentContainerStyle={styles.rowListContent}
          refreshControl={
            surfaceProps.layout.compact ? (
              <RefreshControl refreshing={busy} onRefresh={() => void refresh(undefined, true)} />
            ) : undefined
          }
        />
      )}
      {/* Last in the body, so it paints over the list by order alone;
          the header above keeps its own zIndex and stays reachable. The
          scrim only exists where the panel leaves board to blur. */}
      {detailTarget !== null && detailItem !== null && !surfaceProps.layout.compact ? (
        <Animated.View style={[styles.detailScrim, { opacity: detailProgress }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close details"
            style={styles.menuScrim}
            onPress={closeDetails}
          />
        </Animated.View>
      ) : null}
      {detailTarget !== null && detailItem !== null ? (
        <ItemDetailPanel
          // Keyed by card, so a second card never shows the first one's
          // body while its own loads.
          key={detailItem.id}
          item={detailItem}
          type={detailTarget.type}
          chatLink={detailChatLink}
          styles={styles}
          accentColor={surfaceProps.theme.colors.accent}
          foregroundColor={surfaceProps.theme.colors.foreground}
          bodyWidth={surfaceProps.layout.compact ? null : bodyWidth}
          widthFraction={savedFraction}
          onWidthCommitted={commitWidth}
          progress={detailProgress}
          onClose={closeDetails}
          onOpenChat={(chat) => surfaceProps.navigation?.openAgent({ agentId: chat.agentId })}
          onSend={openSendDialog}
          onMerged={dropItem}
        />
      ) : null}
    </View>
  );
}
