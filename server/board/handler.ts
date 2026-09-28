import type { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { BoardColumn, BoardItem, loadBoard } from "../../shared/board";
import {
  type GithubAccount,
  listGithubAccounts,
  withGithubHostname,
} from "../github/host";
import { loadProjectIndex, repositoryIdFor } from "../launch/project-index";
import type { PaseoApi } from "../launch/project-index";
import { fetchDiscussions } from "./discussions";
import { fetchIssues } from "./issues";
import { fetchPullRequests } from "./pull-requests";
import { boardCache, BOARD_TTL_MS } from "./cache";

/**
 * `owner/name` to project id, for the repositories on this board only. The
 * surface needs it to pick a prompt template during the press gesture, so it
 * rides along rather than costing a round trip mid-gesture.
 *
 * The full project list used to ride along too, for the settings view's
 * per-project overrides. That view now calls `paseo.projects.list()` on the
 * client, which is the same list without the detour.
 */
async function describeRepositoryProjects(
  paseo: PaseoApi,
  columns: readonly BoardColumn[],
): Promise<{ repositoryProjects: Record<string, string> }> {
  const index = await loadProjectIndex(paseo);

  const repositoryProjects: Record<string, string> = {};
  for (const column of columns) {
    for (const item of column.items) {
      if (item.repository === "" || repositoryProjects[item.repository] !== undefined) continue;
      const repositoryId = repositoryIdFor(item.repository, item.url);
      if (repositoryId === null) continue;
      const project = index.byRepositoryId[repositoryId];
      if (project !== undefined) repositoryProjects[item.repository] = project.projectId;
    }
  }

  return { repositoryProjects };
}

async function settle(
  id: BoardColumn["id"],
  title: string,
  load: () => Promise<BoardItem[]>,
): Promise<BoardColumn> {
  try {
    return { id, title, items: await load(), error: null };
  } catch (error) {
    return { id, title, items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadAccountColumns(
  account: GithubAccount,
  owners: readonly string[],
  limit: number,
): Promise<BoardColumn[]> {
  return withGithubHostname(account.hostname, async () => {
    const pullRequests = fetchPullRequests(account.login, owners, limit).then(
      (split) => ({ split, error: null as string | null }),
      (error: unknown) => ({
        split: { draft: [] as BoardItem[], open: [] as BoardItem[] },
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const [issues, prs, discussions] = await Promise.all([
      settle("issues", "Issues", () => fetchIssues(account.login, owners, limit)),
      pullRequests,
      settle("discussions", "Discussions", () =>
        fetchDiscussions(account.login, owners, limit),
      ),
    ]);
    return [
      issues,
      { id: "draft-prs", title: "Draft PRs", items: prs.split.draft, error: prs.error },
      { id: "open-prs", title: "Open PRs", items: prs.split.open, error: prs.error },
      discussions,
    ];
  });
}

function mergeColumns(
  accounts: readonly GithubAccount[],
  results: readonly BoardColumn[][],
): BoardColumn[] {
  const ids: readonly BoardColumn["id"][] = ["issues", "draft-prs", "open-prs", "discussions"];
  const titles: Record<BoardColumn["id"], string> = {
    issues: "Issues",
    "draft-prs": "Draft PRs",
    "open-prs": "Open PRs",
    discussions: "Discussions",
  };
  return ids.map((id) => {
    const byId = new Map<string, BoardItem>();
    const errors: string[] = [];
    results.forEach((columns, index) => {
      const column = columns.find((candidate) => candidate.id === id);
      if (column === undefined) return;
      if (column.error !== null) errors.push(`${accounts[index]?.hostname ?? "GitHub"}: ${column.error}`);
      for (const item of column.items) byId.set(item.id, item);
    });
    return {
      id,
      title: titles[id],
      items: [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      error: errors.length === 0 ? null : errors.join(" "),
    };
  });
}

export async function loadBoardHandler(
  { login, owners, limit, force }: z.output<typeof loadBoard.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof loadBoard.output>> {
  const requested = login?.trim();
  const available = await listGithubAccounts();
  const accounts =
    requested === undefined || requested === "" || requested === "@me"
      ? available
      : available.filter((account) => account.login.toLowerCase() === requested.toLowerCase());
  if (accounts.length === 0) {
    throw new Error(`gh has no authenticated account with login "${requested}".`);
  }
  const key = `${accounts.map(({ hostname, login: accountLogin }) => `${hostname}:${accountLogin}`).join(",")}\u0000${limit}\u0000${[...owners].sort().join(",")}`;

  const {
    value: { columns, fetchedAt },
    stale,
  } = await boardCache.read(
    key,
    BOARD_TTL_MS,
    async () => {
      const columns = mergeColumns(
        accounts,
        await Promise.all(accounts.map((account) => loadAccountColumns(account, owners, limit))),
      );
      return { columns, fetchedAt: new Date().toISOString() };
    },
    {
      force,
      // An expired board is shown immediately and refreshed behind the
      // surface: a sweep costs several seconds of `gh` round trips, and the
      // board it would replace is minutes old, not wrong.
      revalidate: true,
      // A column that failed is not worth remembering: caching it would keep the
      // error on screen for the whole window even though a retry might succeed.
      shouldCache: (cached) => cached.columns.every((column) => column.error === null),
    },
  );

  return {
    login: accounts[0]?.login ?? "",
    viewerLogins: accounts.map((account) => account.login),
    ...(await describeRepositoryProjects(paseo, columns)),
    columns,
    fetchedAt,
    stale,
  };
}
