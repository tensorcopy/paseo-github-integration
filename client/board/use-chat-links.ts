import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

const PAGE_LIMIT = 200;
const MAX_PAGES = 10;
const BACKSTOP_REFRESH_MS = 60_000;
const EVENT_DEBOUNCE_MS = 500;

type PaseoApi = ReturnType<typeof usePaseo>;
type Workspace = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];
type AgentEntry = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number];

export interface ChatLink {
  agentId: string;
  agentTitle: string;
  workspaceId: string;
  workspaceName: string;
}

export interface WorkspaceChatSource {
  id: string;
  name: string;
  githubRuntime?: { pullRequest?: { url: string } | null | undefined } | null | undefined;
}

export interface AgentChatSource {
  agent: {
    id: string;
    title?: string | null | undefined;
    workspaceId?: string | undefined;
    createdAt: string;
  };
}

function normalizePullRequestUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

async function loadWorkspaces(paseo: PaseoApi): Promise<Workspace[]> {
  const entries: Workspace[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.workspaces.list({
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    entries.push(...result.entries);
    cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
    if (!cursor) break;
  }
  return entries;
}

async function loadAgents(paseo: PaseoApi): Promise<AgentEntry[]> {
  const entries: AgentEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    entries.push(...result.entries);
    cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
    if (!cursor) break;
  }
  return entries;
}

/**
 * Match each PR tracked by Paseo's workspace runtime to the first chat created
 * in that workspace. The first agent is the originating conversation; later
 * agents may be reviewers or follow-up repair work.
 */
export function buildChatLinks(
  workspaces: readonly WorkspaceChatSource[],
  agents: readonly AgentChatSource[],
): Map<string, ChatLink> {
  const firstAgentByWorkspace = new Map<string, AgentChatSource["agent"]>();
  for (const { agent } of agents) {
    if (!agent.workspaceId) continue;
    const current = firstAgentByWorkspace.get(agent.workspaceId);
    if (current === undefined || agent.createdAt.localeCompare(current.createdAt) < 0) {
      firstAgentByWorkspace.set(agent.workspaceId, agent);
    }
  }

  const links = new Map<string, ChatLink>();
  for (const workspace of workspaces) {
    const url = workspace.githubRuntime?.pullRequest?.url;
    if (!url) continue;
    const agent = firstAgentByWorkspace.get(workspace.id);
    if (agent === undefined) continue;

    const key = normalizePullRequestUrl(url);
    const existing = links.get(key);
    const candidate: ChatLink = {
      agentId: agent.id,
      agentTitle: agent.title?.trim() || agent.id.slice(0, 7),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    };
    if (existing === undefined) {
      links.set(key, candidate);
      continue;
    }

    const existingAgent = agents.find(({ agent: entry }) => entry.id === existing.agentId)?.agent;
    if (existingAgent !== undefined && agent.createdAt.localeCompare(existingAgent.createdAt) < 0) {
      links.set(key, candidate);
    }
  }
  return links;
}

export function useChatLinks(hostId: string): Map<string, ChatLink> {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["github-board-chat-links", hostId], [hostId]);
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const [workspaces, agents] = await Promise.all([loadWorkspaces(paseo), loadAgents(paseo)]);
      return buildChatLinks(workspaces, agents);
    },
    refetchInterval: BACKSTOP_REFRESH_MS,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void queryClient.invalidateQueries({ queryKey });
      }, EVENT_DEBOUNCE_MS);
    };
    const unsubscribeAgents = paseo.agents.subscribe(invalidate);
    const unsubscribeWorkspaces = paseo.workspaces.subscribe(invalidate);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribeAgents();
      unsubscribeWorkspaces();
    };
  }, [paseo, queryClient, queryKey]);

  return data ?? new Map();
}

export function chatLinkFor(links: ReadonlyMap<string, ChatLink>, url: string): ChatLink | null {
  return links.get(normalizePullRequestUrl(url)) ?? null;
}
