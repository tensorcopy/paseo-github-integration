import { describe, expect, it } from "vitest";
import type { BoardItem } from "../../shared/board";
import type { BoardRow } from "../lib/sort";
import { withHostHeaders } from "./host-sections";

function makeRow(id: string, host: string): BoardRow {
  return {
    item: {
      id,
      number: 1,
      title: id,
      url: `https://${host}/owner/repo/pull/1`,
      repository: "owner/repo",
      host,
      updatedAt: "2024-01-01T00:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      lastCommitAt: null,
      commentsCount: 0,
      labels: [],
      author: null,
      detail: null,
      owner: "owner",
      relations: ["author"],
      linkedIssues: [],
      checks: null,
    } satisfies BoardItem,
    type: "open-prs",
  };
}

describe("withHostHeaders", () => {
  it("adds no heading when every row is from one host", () => {
    const rows = [makeRow("a", "github.com"), makeRow("b", "github.com")];
    expect(withHostHeaders(rows)).toEqual([
      { kind: "row", key: "a", row: rows[0] },
      { kind: "row", key: "b", row: rows[1] },
    ]);
  });

  it("groups each host under one heading, in the order the hosts first appear", () => {
    const rows = [
      makeRow("a", "ghe.example.com"),
      makeRow("b", "github.com"),
      makeRow("c", "ghe.example.com"),
    ];
    expect(withHostHeaders(rows)).toEqual([
      { kind: "host", key: "host:ghe.example.com", host: "ghe.example.com", count: 2 },
      { kind: "row", key: "a", row: rows[0] },
      { kind: "row", key: "c", row: rows[2] },
      { kind: "host", key: "host:github.com", host: "github.com", count: 1 },
      { kind: "row", key: "b", row: rows[1] },
    ]);
  });
});
