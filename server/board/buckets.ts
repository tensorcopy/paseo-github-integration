import type { BoardItem } from "../../shared/board";
import { aliasName, ghGraphqlRaw, nodesOf } from "../github/graphql";
import { RELATION_ORDER } from "./types";
import type { BucketResult, GhSearchNode, RelationBucket } from "./types";

/**
 * The relation buckets GitHub search can answer for a login directly.
 * `review-requested` is pull requests only — issues have no such qualifier —
 * so it is left off entirely rather than run and always come back empty.
 */
export function personalBuckets(login: string, includeReviewRequested: boolean): RelationBucket[] {
  const buckets: RelationBucket[] = [];
  if (includeReviewRequested) {
    buckets.push({ relation: "review-requested", qualifier: `review-requested:${login}` });
  }
  buckets.push({ relation: "mentioned", qualifier: `mentions:${login}` });
  buckets.push({ relation: "assigned", qualifier: `assignee:${login}` });
  buckets.push({ relation: "author", qualifier: `author:${login}` });
  return buckets;
}

/**
 * One bucket per watched owner, each carrying the `owned` relation. An owner
 * can hold thousands of open items, so every bucket is truncated at `limit`
 * the same as a personal one rather than fetched in full.
 */
export function ownedBuckets(owners: readonly string[]): RelationBucket[] {
  return owners.map((owner) => ({ relation: "owned", qualifier: `user:${owner}` }));
}

/**
 * Runs every bucket as one aliased request — the same trick the old
 * author/owned pair used, generalised past two names. A bucket GitHub refuses
 * (a mistyped or deleted owner) is warned about and dropped rather than
 * costing the whole column; the column only fails when every bucket did.
 */
export async function runBuckets(
  type: "ISSUE" | "DISCUSSION",
  selection: string,
  buckets: readonly RelationBucket[],
  scope: string,
  limit: number,
): Promise<BucketResult[]> {
  if (buckets.length === 0) return [];
  const vars = buckets.map((_, index) => `$${aliasName(index)}: String!`).join(", ");
  const aliases = buckets
    .map(
      (_, index) =>
        `${aliasName(index)}: search(query: $${aliasName(index)}, type: ${type}, first: $limit) { nodes { ${selection} } }`,
    )
    .join("\n  ");
  const query = `query(${vars}, $limit: Int!) {\n  ${aliases}\n}`;

  const args = ["api", "graphql", "-f", `query=${query}`];
  buckets.forEach((bucket, index) => {
    args.push("-f", `${aliasName(index)}=${scope} ${bucket.qualifier}`.trim());
  });
  args.push("-F", `limit=${limit}`);

  const { data, errors } = await ghGraphqlRaw(args);

  const results: BucketResult[] = [];
  const failures: string[] = [];
  buckets.forEach((bucket, index) => {
    const alias = aliasName(index);
    const failure = errors.find((error) => Array.isArray(error.path) && error.path[0] === alias);
    if (failure !== undefined) {
      console.warn(`github-board: bucket "${bucket.qualifier}" (${bucket.relation}) failed: ${failure.message}`);
      failures.push(failure.message);
      return;
    }
    results.push({ relation: bucket.relation, nodes: nodesOf(data?.[alias]) });
  });

  if (results.length === 0 && failures.length > 0) throw new Error(failures.join(" "));
  return results;
}

/**
 * Unions every bucket's nodes by id and keeps every relation that found the
 * item, deduplicated and sorted to `RELATION_IDS` order. `toBoardItem` returns
 * null for a node the caller wants dropped entirely (an archived discussion,
 * an empty node from the other inline fragment matching nothing), which is
 * why it runs before the relation is ever recorded.
 *
 * `limit` is a budget per relation, not one shared by the union. A shared
 * budget is spent by whichever relation happens to have the most recently
 * updated items: a full review queue is newer than almost anything else, so
 * it took the whole list and left the viewer's own pull requests off a board
 * that exists to show them.
 */
export function mergeBucketResults<TNode extends GhSearchNode>(
  buckets: readonly BucketResult[],
  toBoardItem: (node: TNode) => BoardItem | null,
  limit: number,
): BoardItem[] {
  const byId = new Map<string, BoardItem>();
  for (const bucket of buckets) {
    for (const raw of bucket.nodes) {
      if (typeof raw !== "object" || raw === null) continue;
      // A generic node shape the caller's own callback narrows further; the
      // `id` check right below is the only guarantee made about it here.
      const node = raw as TNode;
      if (typeof node.id !== "string") continue;
      const existing = byId.get(node.id);
      if (existing !== undefined) {
        if (!existing.relations.includes(bucket.relation)) existing.relations.push(bucket.relation);
        continue;
      }
      const item = toBoardItem(node);
      if (item === null) continue;
      item.relations = [bucket.relation];
      byId.set(node.id, item);
    }
  }
  for (const item of byId.values()) {
    item.relations.sort((a, b) => RELATION_ORDER[a] - RELATION_ORDER[b]);
  }

  const items = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const kept = new Set<string>();
  for (const relation of new Set(buckets.map((bucket) => bucket.relation))) {
    for (const item of items.filter((item) => item.relations.includes(relation)).slice(0, limit)) {
      kept.add(item.id);
    }
  }
  return items.filter((item) => kept.has(item.id));
}
