import { describe, expect, it } from "vitest";
import type { BoardItem } from "../../shared/board";
import {
  matchesSearchTerms,
  normalizeSearchText,
  parseSearchQuery,
  repositoryMatchesQuery,
} from "./search";

/** A minimal, valid BoardItem; tests override only the fields they care about. */
function makeItem(overrides: Partial<BoardItem>): BoardItem {
  return {
    id: "node-1",
    number: 1,
    title: "An item",
    url: "https://github.com/owner/repo/issues/1",
    repository: "owner/repo",
    host: "github.com",
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
    ...overrides,
  };
}

describe("normalizeSearchText", () => {
  it("lowercases and turns separators into single spaces", () => {
    expect(normalizeSearchText("octo-org/checkout-frontend")).toBe(
      "octo org checkout frontend",
    );
  });

  it("collapses runs of separators and trims the ends", () => {
    expect(normalizeSearchText("--A__B..C  ")).toBe("a b c");
  });
});

describe("parseSearchQuery", () => {
  it("keeps a plain word as an 'any' term", () => {
    expect(parseSearchQuery("checkout frontend")).toEqual([
      { field: "any", value: "checkout" },
      { field: "any", value: "frontend" },
    ]);
  });

  it("routes each sigil to its own field and normalises the rest", () => {
    expect(parseSearchQuery("/octo-org")).toEqual([
      { field: "repository", value: "octo org" },
    ]);
    expect(parseSearchQuery("@bob")).toEqual([{ field: "author", value: "bob" }]);
  });

  it("keeps only digits for a number term", () => {
    expect(parseSearchQuery("#3669")).toEqual([{ field: "number", value: "3669" }]);
  });

  it("drops a lone sigil rather than emitting an empty-value term", () => {
    expect(parseSearchQuery("/")).toEqual([]);
    expect(parseSearchQuery("#")).toEqual([]);
    expect(parseSearchQuery("@")).toEqual([]);
    expect(parseSearchQuery("   ")).toEqual([]);
  });
});

describe("matchesSearchTerms", () => {
  const item = makeItem({
    title: "Improve the login flow",
    repository: "octo-org/checkout-frontend",
    number: 3669,
    author: "someone",
  });

  it("matches a repository across separator styles: words, or owner/name", () => {
    expect(matchesSearchTerms(item, parseSearchQuery("checkout frontend"))).toBe(true);
    expect(matchesSearchTerms(item, parseSearchQuery("octo-org/"))).toBe(true);
  });

  it("restricts a /repository term to the repository field", () => {
    const titleOnlyMatch = makeItem({
      title: "checkout frontend notes",
      repository: "other-org/other-repo",
    });
    expect(matchesSearchTerms(item, parseSearchQuery("/checkout-frontend"))).toBe(true);
    expect(matchesSearchTerms(titleOnlyMatch, parseSearchQuery("/checkout-frontend"))).toBe(false);
  });

  it("restricts a #number term to the number field", () => {
    const titleMentionsNumber = makeItem({ title: "Version 3669 released", number: 1 });
    expect(matchesSearchTerms(titleMentionsNumber, parseSearchQuery("#3669"))).toBe(false);
    expect(matchesSearchTerms(titleMentionsNumber, parseSearchQuery("3669"))).toBe(true);
  });

  it("restricts an @author term to the author field", () => {
    const titleMentionsName = makeItem({ title: "dave wants this merged", author: "carol" });
    expect(matchesSearchTerms(titleMentionsName, parseSearchQuery("@dave"))).toBe(false);
    expect(matchesSearchTerms(titleMentionsName, parseSearchQuery("dave"))).toBe(true);
  });

  it("ANDs several terms together", () => {
    expect(matchesSearchTerms(item, parseSearchQuery("frontend @someone"))).toBe(true);
    expect(matchesSearchTerms(item, parseSearchQuery("frontend @other"))).toBe(false);
  });

  it("agrees between a #number term and the equivalent bare digits", () => {
    const withNumber = matchesSearchTerms(item, parseSearchQuery("#3669"));
    const bareDigits = matchesSearchTerms(item, parseSearchQuery("3669"));
    expect(withNumber).toBe(true);
    expect(bareDigits).toBe(true);
    expect(withNumber).toBe(bareDigits);
  });

  it("a lone sigil still being typed leaves the list unfiltered", () => {
    expect(matchesSearchTerms(item, parseSearchQuery("/"))).toBe(true);
    expect(matchesSearchTerms(makeItem({}), parseSearchQuery("/"))).toBe(true);
  });

  it("a bare word matches through title, repository, or number", () => {
    const titleMatch = makeItem({ title: "widget launcher", repository: "a/b", number: 1 });
    const repositoryMatch = makeItem({ title: "z", repository: "widget-co/app", number: 2 });
    const numberMatch = makeItem({ title: "z", repository: "a/b", number: 42 });
    expect(matchesSearchTerms(titleMatch, parseSearchQuery("widget"))).toBe(true);
    expect(matchesSearchTerms(repositoryMatch, parseSearchQuery("widget"))).toBe(true);
    expect(matchesSearchTerms(numberMatch, parseSearchQuery("42"))).toBe(true);
  });
});

describe("repositoryMatchesQuery", () => {
  it("matches regardless of which separator style the query uses", () => {
    expect(repositoryMatchesQuery("octo-org/checkout-frontend", "checkout frontend")).toBe(
      true,
    );
    expect(repositoryMatchesQuery("octo-org/checkout-frontend", "octo-org/")).toBe(true);
  });

  it("does not require the query words in order", () => {
    expect(repositoryMatchesQuery("octo-org/checkout-frontend", "frontend checkout")).toBe(
      true,
    );
  });

  it("fails when a query word is not present", () => {
    expect(repositoryMatchesQuery("octo-org/checkout-frontend", "checkout backend")).toBe(
      false,
    );
  });

  it("an empty query matches everything", () => {
    expect(repositoryMatchesQuery("octo-org/checkout-frontend", "")).toBe(true);
  });
});
