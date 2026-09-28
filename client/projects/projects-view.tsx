/**
 * The Projects tab: GitHub Projects (v2) rendered as their own view rather than
 * folded into the four-column board, because a project is not one of the
 * viewer's relationships to an item — it is a container an item can sit in,
 * several at once, including drafts that are not issues at all. See
 * `shared/board.ts` for `listProjects` and `loadProject`.
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { JSX } from "react";
import { useMemo, useState } from "react";

import { ProjectBoardView } from "./project-board-view";
import { ProjectsListView } from "./projects-list-view";
import { buildProjectsStyles } from "./projects.styles";

/** Which project's own board is open, or `null` for the list. */
interface ProjectTarget {
  host: string;
  owner: string;
  number: number;
}

/**
 * Swaps between the two pieces the Projects tab is made of: the list
 * (`ProjectsListView`) and, once a project is picked, its own board
 * (`ProjectBoardView`). This component owns only that choice and the one
 * stylesheet both pieces share; everything else — the list's fetch, the
 * board's fetch, the "needs read:project" empty state — belongs to whichever
 * of the two is showing.
 */
export function ProjectsView(props: {
  theme: PluginSurfaceProps["theme"];
  layout: PluginSurfaceProps["layout"];
  owners: readonly string[];
  onOpenUrl: (url: string) => void;
}): JSX.Element {
  const { theme, layout, owners, onOpenUrl } = props;
  const styles = useMemo(() => buildProjectsStyles(theme, layout), [theme, layout]);
  const [target, setTarget] = useState<ProjectTarget | null>(null);

  if (target !== null) {
    return (
      <ProjectBoardView
        theme={theme}
        styles={styles}
        host={target.host}
        owner={target.owner}
        number={target.number}
        onOpenUrl={onOpenUrl}
        onClose={() => setTarget(null)}
      />
    );
  }

  return (
    <ProjectsListView
      theme={theme}
      styles={styles}
      owners={owners}
      onOpenProject={(host, owner, number) => setTarget({ host, owner, number })}
    />
  );
}
