import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import type { ProjectSummary } from "../../shared/board";
import { listProjects } from "../../shared/board";
import { relativeTime } from "../lib/time";
import type { ProjectsStyles } from "./projects.styles";

/**
 * The one command that turns `needsScope` false. Spelled out as a constant
 * rather than trusting the server's `error` sentence to always contain it,
 * so the copy button and the acceptance of this view do not depend on wording
 * the server is free to change.
 */
const SCOPE_COMMAND = "gh auth refresh -h github.com -s read:project";

/**
 * The Projects tab's landing view: every project the viewer's owners have,
 * the "needs read:project scope" empty state when GitHub reports it, and the
 * fetch behind both. Pressing a project hands its owner and number up to
 * `ProjectsView`, which is what decides to show `ProjectBoardView` instead.
 */
export function ProjectsListView({
  theme,
  styles,
  owners,
  onOpenProject,
}: {
  theme: PluginSurfaceProps["theme"];
  styles: ProjectsStyles;
  owners: readonly string[];
  onOpenProject: (host: string, owner: string, number: number) => void;
}) {
  const fetchProjects = useRpc(listProjects);

  const [projects, setProjects] = useState<readonly ProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [needsScope, setNeedsScope] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  /**
   * `owners` is the caller's live settings array, a fresh reference on every
   * render whether or not its contents changed. The effect keys off its join
   * instead, so a re-render that leaves the list itself unchanged does not
   * repeat the search.
   */
  const ownersKey = owners.join("\n");

  const loadProjects = useCallback(
    async function loadProjects(force: boolean) {
      setListLoading(true);
      setListError(null);
      try {
        const result = await fetchProjects({ owners: [...owners], force });
        setProjects(result.projects);
        setListError(result.error);
        setNeedsScope(result.needsScope);
      } catch (cause) {
        setProjects([]);
        setListError(cause instanceof Error ? cause.message : String(cause));
        setNeedsScope(false);
      } finally {
        setListLoading(false);
      }
    },
    [fetchProjects, ownersKey],
  );

  useEffect(() => {
    void loadProjects(false);
  }, [loadProjects]);

  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => () => clearTimeout(copiedTimeout.current ?? undefined), []);
  const copyCommand = useCallback(async function copyCommand() {
    try {
      await copyText(SCOPE_COMMAND);
      setCopied(true);
      clearTimeout(copiedTimeout.current ?? undefined);
      copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied or unavailable clipboard access. The command stays selectable
      // text in its box either way, so the user can still copy it by hand.
    }
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Projects</Text>
        <View style={styles.headerSpacer} />
        {listLoading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadProjects(true)}
            style={styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
          </Pressable>
        )}
      </View>

      {listLoading && projects === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : needsScope ? (
        <View style={styles.scopeState}>
          <Icon name="Lock" size={28} color={theme.colors.foregroundMuted} />
          <Text style={styles.scopeTitle}>Projects need one more scope</Text>
          <Text style={styles.scopeBody}>
            {listError ?? "The GitHub token is missing the read:project scope Projects v2 needs."}
          </Text>
          <View style={styles.scopeCommandBox}>
            <Text style={styles.scopeCommand} selectable>
              {SCOPE_COMMAND}
            </Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.button} onPress={copyCommand}>
            <Text style={styles.buttonLabel}>{copied ? "Copied" : "Copy command"}</Text>
          </Pressable>
        </View>
      ) : listError !== null ? (
        <View style={styles.centered}>
          <Icon name="AlertTriangle" size={24} color={theme.colors.statusDanger} />
          <Text style={styles.danger}>{listError}</Text>
        </View>
      ) : projects === null || projects.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No projects yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listBody}>
          {projects.map((project) => (
            <Pressable
              key={project.id}
              style={styles.projectRow}
              accessibilityRole="button"
              onPress={() => onOpenProject(project.host, project.owner, project.number)}
            >
              <View style={styles.projectRowMain}>
                <Text style={styles.projectTitle} numberOfLines={1}>
                  {project.title}
                </Text>
              </View>
              {project.shortDescription !== null && project.shortDescription !== "" ? (
                <Text style={styles.projectDescription} numberOfLines={1}>
                  {project.shortDescription}
                </Text>
              ) : null}
              <View style={styles.projectMetaRow}>
                <Text style={styles.projectMeta}>
                  {project.owner} · {project.host}
                </Text>
                <Text style={styles.projectMeta}>·</Text>
                <Text style={styles.projectMeta}>
                  {project.itemCount} {project.itemCount === 1 ? "item" : "items"}
                </Text>
                <Text style={styles.projectMeta}>·</Text>
                <Text style={styles.projectMeta}>{relativeTime(project.updatedAt)}</Text>
                {project.closed ? (
                  <>
                    <Text style={styles.projectMeta}>·</Text>
                    <Text style={styles.closedBadge}>Closed</Text>
                  </>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
