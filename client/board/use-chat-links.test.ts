import { describe, expect, it } from "vitest";
import { buildChatLinks, chatLinkFor } from "./use-chat-links";

describe("buildChatLinks", () => {
  it("links a pull request to the first chat in its workspace", () => {
    const links = buildChatLinks(
      [
        {
          id: "workspace-1",
          name: "Fix dashboard",
          githubRuntime: {
            pullRequest: { url: "https://ghe.example.com/an-org/example/pull/42" },
          },
        },
      ],
      [
        {
          agent: {
            id: "follow-up",
            title: "Review",
            workspaceId: "workspace-1",
            createdAt: "2026-09-16T12:00:00Z",
          },
        },
        {
          agent: {
            id: "original",
            title: "Implement",
            workspaceId: "workspace-1",
            createdAt: "2026-09-15T12:00:00Z",
          },
        },
      ],
    );

    expect(chatLinkFor(links, "https://ghe.example.com/an-org/example/pull/42/")).toEqual({
      agentId: "original",
      agentTitle: "Implement",
      workspaceId: "workspace-1",
      workspaceName: "Fix dashboard",
    });
  });

  it("does not link a workspace with no chat", () => {
    const links = buildChatLinks(
      [
        {
          id: "workspace-1",
          name: "No agent",
          githubRuntime: { pullRequest: { url: "https://github.com/an-owner/example/pull/1" } },
        },
      ],
      [],
    );

    expect(links.size).toBe(0);
  });
});
