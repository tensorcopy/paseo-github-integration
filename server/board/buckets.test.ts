import { describe, expect, it, vi } from "vitest";
import type { BoardItem } from "../../shared/board";
import { mergeBucketResults } from "./buckets";
import type { BucketResult, GhSearchNode } from "./types";

interface FakeNode extends GhSearchNode {
  id: string;
  fakeUpdatedAt: string;
}

function makeItem(id: string, updatedAt: string): BoardItem {
  return {
    id,
    number: 1,
    title: `item ${id}`,
    url: `https://github.com/owner/repo/issues/${id}`,
    repository: "owner/repo",
    host: "github.com",
    updatedAt,
    createdAt: updatedAt,
    lastCommitAt: null,
    commentsCount: 0,
    labels: [],
    author: null,
    detail: null,
    owner: "owner",
    // mergeBucketResults overwrites this on first sight of the node, so the
    // starting value here is never observed.
    relations: [],
    linkedIssues: [],
    checks: null,
  };
}

function toBoardItem(node: FakeNode): BoardItem | null {
  return makeItem(node.id, node.fakeUpdatedAt);
}

describe("mergeBucketResults", () => {
  it("unions the relations of an item found by several buckets", () => {
    const buckets: BucketResult[] = [
      { relation: "author", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
      { relation: "assigned", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
    ];
    const [merged] = mergeBucketResults(buckets, toBoardItem, 10);
    expect(merged?.relations).toEqual(["author", "assigned"]);
  });

  it("dedupes by node id, keeping a single item and calling toBoardItem once", () => {
    const toBoardItemSpy = vi.fn(toBoardItem);
    const buckets: BucketResult[] = [
      { relation: "author", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
      { relation: "mentioned", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
      { relation: "assigned", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
    ];
    const result = mergeBucketResults(buckets, toBoardItemSpy, 10);
    expect(result).toHaveLength(1);
    expect(toBoardItemSpy).toHaveBeenCalledTimes(1);
  });

  it("sorts an item's relations to RELATION_ORDER regardless of bucket order", () => {
    // "owned" comes after "author" in RELATION_ORDER; feeding "owned" first
    // must not leave the merged relations in insertion order.
    const buckets: BucketResult[] = [
      { relation: "owned", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
      { relation: "author", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
    ];
    const [merged] = mergeBucketResults(buckets, toBoardItem, 10);
    expect(merged?.relations).toEqual(["author", "owned"]);
  });

  it("applies the limit per relation and returns the union newest first", () => {
    const buckets: BucketResult[] = [
      {
        relation: "author",
        nodes: [
          { id: "old-1", fakeUpdatedAt: "2024-01-01T00:00:00Z" },
          { id: "old-2", fakeUpdatedAt: "2024-01-02T00:00:00Z" },
        ],
      },
      {
        relation: "mentioned",
        nodes: [
          { id: "new-1", fakeUpdatedAt: "2024-06-01T00:00:00Z" },
          { id: "new-2", fakeUpdatedAt: "2024-05-01T00:00:00Z" },
        ],
      },
    ];
    const result = mergeBucketResults(buckets, toBoardItem, 2);
    expect(result.map((item) => item.id)).toEqual(["new-1", "new-2", "old-2", "old-1"]);
  });

  it("keeps an older authored item when a newer relation fills the budget", () => {
    // The review queue this models is what a shared budget spent entirely:
    // every review request is newer than the one pull request the viewer wrote.
    const buckets: BucketResult[] = [
      {
        relation: "review-requested",
        nodes: [
          { id: "review-1", fakeUpdatedAt: "2024-06-03T00:00:00Z" },
          { id: "review-2", fakeUpdatedAt: "2024-06-02T00:00:00Z" },
        ],
      },
      { relation: "author", nodes: [{ id: "mine", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
    ];
    const result = mergeBucketResults(buckets, toBoardItem, 2);
    expect(result.map((item) => item.id)).toContain("mine");
  });

  it("drops a node that toBoardItem rejects", () => {
    const buckets: BucketResult[] = [
      { relation: "author", nodes: [{ id: "a", fakeUpdatedAt: "2024-01-01T00:00:00Z" }] },
    ];
    const result = mergeBucketResults(buckets, () => null, 10);
    expect(result).toEqual([]);
  });
});
