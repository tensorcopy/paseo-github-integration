import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import type { ProjectItem } from "../../shared/board";
import { loadProject } from "../../shared/board";
import type { ProjectsStyles } from "./projects.styles";

type ThemeColors = PluginSurfaceProps["theme"]["colors"];

/** What `loadProject` answered with, plus the reference it was asked for. */
interface ProjectDetail {
  title: string;
  url: string;
  columns: readonly { name: string; items: readonly ProjectItem[] }[];
}

/**
 * One item's leading glyph and colour, by what it is and where it stands.
 * `merged` borrows the accent colour rather than inventing a purple the theme
 * does not expose: the six status/accent tokens are what a plugin gets.
 */
function itemGlyph(item: ProjectItem, colors: ThemeColors): { name: string; color: string } {
  if (item.kind === "draft") return { name: "FileText", color: colors.foregroundMuted };
  if (item.kind === "pull-request") {
    if (item.state === "merged") return { name: "GitMerge", color: colors.accent };
    if (item.state === "closed") return { name: "GitPullRequestClosed", color: colors.statusDanger };
    if (item.state === "draft") return { name: "GitPullRequestDraft", color: colors.foregroundMuted };
    return { name: "GitPullRequest", color: colors.statusSuccess };
  }
  if (item.state === "closed") return { name: "CircleSlash", color: colors.statusDanger };
  return { name: "CircleDot", color: colors.statusSuccess };
}

/**
 * One project rendered as its own board: the columns GitHub's own project
 * view groups items into, folded down to the ones that hold something
 * unless every column is empty. Fetches on mount and on every `owner`/
 * `number` change, which in practice is "once": `ProjectsView` swaps this
 * for `ProjectsListView` on close rather than re-pointing it at another
 * project in place.
 */
export function ProjectBoardView({
  theme,
  styles,
  host,
  owner,
  number,
  onOpenUrl,
  onClose,
}: {
  theme: PluginSurfaceProps["theme"];
  styles: ProjectsStyles;
  host: string;
  owner: string;
  number: number;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const fetchProject = useRpc(loadProject);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetchProject({ host, owner, number, force: false })
      .then((result) => {
        if (live) setDetail({ title: result.title, url: result.url, columns: result.columns });
      })
      .catch((cause: unknown) => {
        if (live) setDetailError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [fetchProject, host, owner, number]);

  /**
   * An empty column is not the interesting case, but a project with nothing
   * in *any* column is: dropping every column then would leave the board
   * blank with no explanation, so the fallback keeps them all.
   */
  const visibleColumns = useMemo(() => {
    if (detail === null) return [];
    const populated = detail.columns.filter((column) => column.items.length > 0);
    return populated.length === 0 ? detail.columns : populated;
  }, [detail]);

  const renderProjectItem = useCallback(
    (item: ProjectItem, spaced: boolean) => {
      const glyph = itemGlyph(item, theme.colors);
      const rowStyle = spaced ? [styles.itemRow, styles.itemRowSpaced] : styles.itemRow;
      return (
        <Pressable
          key={item.id}
          style={rowStyle}
          accessibilityRole={item.url !== null ? "link" : "text"}
          disabled={item.url === null}
          onPress={item.url !== null ? () => onOpenUrl(item.url as string) : undefined}
        >
          <Icon name={glyph.name} size={16} color={glyph.color} />
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.repository !== null && item.number !== null ? (
            <Text style={styles.itemMeta}>
              {item.repository}#{item.number}
            </Text>
          ) : null}
        </Pressable>
      );
    },
    [theme, styles, onOpenUrl],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.detailHeader}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
          <Icon name="ChevronLeft" size={18} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.detailTitle} numberOfLines={1}>
          {detail !== null && detail.title !== "" ? detail.title : "Project"}
        </Text>
        <View style={styles.headerSpacer} />
        {detail !== null && detail.url !== "" ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => onOpenUrl(detail.url)}
          >
            <Text style={styles.buttonLabel}>Open on GitHub</Text>
          </Pressable>
        ) : null}
      </View>
      {detailLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : detailError !== null ? (
        <View style={styles.centered}>
          <Text style={styles.danger}>{detailError}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.boardBody}>
          {visibleColumns.map((column) => (
            <View key={column.name === "" ? "\0no-status" : column.name} style={styles.group}>
              <Text style={styles.groupTitle}>{column.name === "" ? "No status" : column.name}</Text>
              {column.items.map((item, index) => renderProjectItem(item, index > 0))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
