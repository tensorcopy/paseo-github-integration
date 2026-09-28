import type { BoardItem, LinkedIssue } from "../../shared/board";
import { encodeItemId, hostnameFromUrl } from "../github/item-id";
import { attachChecks } from "./checks";
import { ownedBuckets, personalBuckets, runBuckets, mergeBucketResults } from "./buckets";
import { toItem } from "./item";
import type { GhSearchNode } from "./types";
import { UNARCHIVED_ONLY } from "./types";

/**
 * Pull requests carry `closingIssuesReferences` — the link from a pull request
 * to the issues it closes, and the only source that sees both closing keywords
 * in the body and issues attached by hand from the Development panel. The board
 * needs it to fold an issue into the pull request that closes it.
 */
const PULL_REQUEST_SELECTION = `... on PullRequest {
  id
  number
  title
  url
  updatedAt
  createdAt
  isDraft
  author { login }
  comments { totalCount }
  labels(first: 20) { nodes { name } }
  repository { nameWithOwner isArchived }
  closingIssuesReferences(first: 20) {
    nodes { id number repository { nameWithOwner } }
  }
  commits(last: 1) {
    nodes { commit { committedDate } }
  }
}`;

interface GhPullRequestNode extends GhSearchNode {
  isDraft?: unknown;
  closingIssuesReferences?: { nodes?: unknown };
  commits?: { nodes?: unknown };
}

function toLinkedIssues(node: GhPullRequestNode): LinkedIssue[] {
  const nodes = node.closingIssuesReferences?.nodes;
  if (!Array.isArray(nodes)) return [];
  const hostname = hostnameFromUrl(typeof node.url === "string" ? node.url : "");
  return nodes
    .filter((issue): issue is Record<string, unknown> => typeof issue === "object" && issue !== null)
    .map((issue) => ({
      id: typeof issue.id === "string" ? encodeItemId(hostname, issue.id) : "",
      number: typeof issue.number === "number" ? issue.number : 0,
      repository:
        typeof (issue.repository as { nameWithOwner?: unknown } | undefined)?.nameWithOwner ===
        "string"
          ? ((issue.repository as { nameWithOwner: string }).nameWithOwner)
          : "",
    }))
    .filter((issue) => issue.id !== "");
}

/**
 * The head commit's date, from the single `commits(last: 1)` node requested
 * on every pull request. Null when GitHub reports no commit at all, which
 * happens on a pull request whose branch was force-pushed away underneath it.
 */
function toLastCommitAt(node: GhPullRequestNode): string | null {
  const nodes = node.commits?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const commit = (nodes[0] as { commit?: { committedDate?: unknown } } | undefined)?.commit;
  return typeof commit?.committedDate === "string" ? commit.committedDate : null;
}

/**
 * One search backs two columns. Splitting client-side would ship draft pull
 * requests the open column discards, so the split happens here — after the
 * merge, so the `limit` is spent on the pull requests that exist rather than on
 * one column's share of them.
 */
export async function fetchPullRequests(
  login: string,
  owners: readonly string[],
  limit: number,
): Promise<{ draft: BoardItem[]; open: BoardItem[] }> {
  const scope = `is:pr state:open ${UNARCHIVED_ONLY} sort:updated-desc`;
  const buckets = [...personalBuckets(login, true), ...ownedBuckets(owners)];
  const results = await runBuckets("ISSUE", PULL_REQUEST_SELECTION, buckets, scope, limit);

  const drafts = new Set<string>();
  const merged = mergeBucketResults<GhPullRequestNode>(
    results,
    (row) => {
      const id = encodeItemId(
        hostnameFromUrl(typeof row.url === "string" ? row.url : ""),
        typeof row.id === "string" ? row.id : String(row.url),
      );
      if (row.isDraft === true) drafts.add(id);
      return { ...toItem(row, null, toLastCommitAt(row)), linkedIssues: toLinkedIssues(row) };
    },
    limit,
  );

  // Checks are fetched for the open column alone: a draft says its work is not
  // finished, so its CI is nobody's business yet, and asking for fewer ids
  // keeps the extra request as small as the thing it feeds.
  return {
    draft: merged.filter((item) => drafts.has(item.id)),
    open: await attachChecks(merged.filter((item) => !drafts.has(item.id))),
  };
}
