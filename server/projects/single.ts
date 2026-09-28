import type { z } from "zod";
import type { ProjectItem, loadProject } from "../../shared/board";
import { ghGraphqlRaw, nodesOf } from "../github/graphql";
import { withGithubHostname } from "../github/host";
import { Cache } from "../cache/cache";
import { labelNodeNames } from "../board/item";
import { needsProjectScope, projectScopeMessage } from "./scope";

/** The Status field's own single-select name, read by `fieldValueByName` and `field`. */
const STATUS_FIELD_NAME = "Status";

/** The union `content` resolves to; `__typename` is what tells the three apart. */
interface GhProjectContentNode {
  __typename?: unknown;
  id?: unknown;
  number?: unknown;
  title?: unknown;
  url?: unknown;
  state?: unknown;
  isDraft?: unknown;
  repository?: { nameWithOwner?: unknown };
  author?: { login?: unknown };
  labels?: { nodes?: unknown };
  updatedAt?: unknown;
}

interface GhProjectItemNode {
  fieldValueByName?: { name?: unknown } | null;
  content?: GhProjectContentNode | null;
}

interface GhProjectV2Node {
  title?: unknown;
  url?: unknown;
  field?: { options?: unknown } | null;
  items?: { nodes?: unknown };
}

const PROJECT_QUERY = `fragment ProjectFields on ProjectV2 {
  title
  url
  field(name: "${STATUS_FIELD_NAME}") {
    ... on ProjectV2SingleSelectField {
      options { name }
    }
  }
  items(first: 100) {
    nodes {
      fieldValueByName(name: "${STATUS_FIELD_NAME}") {
        ... on ProjectV2ItemFieldSingleSelectValue { name }
      }
      content {
        __typename
        ... on Issue {
          id
          number
          title
          url
          state
          repository { nameWithOwner }
          author { login }
          labels(first: 20) { nodes { name } }
          updatedAt
        }
        ... on PullRequest {
          id
          number
          title
          url
          state
          isDraft
          repository { nameWithOwner }
          author { login }
          labels(first: 20) { nodes { name } }
          updatedAt
        }
        ... on DraftIssue {
          id
          title
          updatedAt
        }
      }
    }
  }
}

query($owner: String!, $number: Int!) {
  asUser: user(login: $owner) { projectV2(number: $number) { ...ProjectFields } }
  asOrg: organization(login: $owner) { projectV2(number: $number) { ...ProjectFields } }
}`;

/** The Status field's option order, when GitHub could resolve it at all. */
function statusOptionNamesOf(field: GhProjectV2Node["field"]): string[] {
  const options = field?.options;
  if (!Array.isArray(options)) return [];
  const names: string[] = [];
  for (const raw of options) {
    if (typeof raw !== "object" || raw === null) continue;
    const option = raw as { name?: unknown };
    if (typeof option.name === "string") names.push(option.name);
  }
  return names;
}

/** Pull requests carry `isDraft`; a draft note has no open/closed state at all. */
function projectItemStateOf(
  kind: ProjectItem["kind"],
  node: GhProjectContentNode,
): ProjectItem["state"] {
  if (kind === "draft") return null;
  if (kind === "pull-request" && node.isDraft === true) return "draft";
  if (node.state === "OPEN") return "open";
  if (node.state === "MERGED") return "merged";
  if (node.state === "CLOSED") return "closed";
  return null;
}

function toProjectItem(node: GhProjectContentNode): ProjectItem | null {
  const kind: ProjectItem["kind"] | null =
    node.__typename === "Issue"
      ? "issue"
      : node.__typename === "PullRequest"
        ? "pull-request"
        : node.__typename === "DraftIssue"
          ? "draft"
          : null;
  if (kind === null) return null;

  return {
    id: typeof node.id === "string" ? node.id : "",
    kind,
    title: typeof node.title === "string" ? node.title : "",
    url: kind !== "draft" && typeof node.url === "string" ? node.url : null,
    repository:
      kind !== "draft" && typeof node.repository?.nameWithOwner === "string"
        ? node.repository.nameWithOwner
        : null,
    number: kind !== "draft" && typeof node.number === "number" ? node.number : null,
    state: projectItemStateOf(kind, node),
    author: typeof node.author?.login === "string" ? node.author.login : null,
    labels: labelNodeNames(node.labels?.nodes),
    updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : "",
  };
}

/**
 * Groups a project's items by its Status field, in the field's own option
 * order when it could be read at all — a project without a Status field, or
 * one `fieldValueByName` failed to resolve, still groups by whatever name (or
 * lack of one) each item actually carries; only the *order* falls back to
 * insertion order, with the no-status group always last regardless.
 */
function groupProjectItems(project: GhProjectV2Node): Array<{ name: string; items: ProjectItem[] }> {
  const order = statusOptionNamesOf(project.field);
  const groups = new Map<string, ProjectItem[]>();
  for (const raw of nodesOf(project.items)) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as GhProjectItemNode;
    if (typeof row.content !== "object" || row.content === null) continue;
    const item = toProjectItem(row.content);
    if (item === null) continue;
    const statusName = typeof row.fieldValueByName?.name === "string" ? row.fieldValueByName.name : "";
    const bucket = groups.get(statusName);
    if (bucket === undefined) groups.set(statusName, [item]);
    else bucket.push(item);
  }

  const names = [...groups.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    const orderA = order.indexOf(a);
    const orderB = order.indexOf(b);
    if (orderA === -1 && orderB === -1) return 0;
    if (orderA === -1) return 1;
    if (orderB === -1) return -1;
    return orderA - orderB;
  });

  return names.map((name) => ({ name, items: groups.get(name) ?? [] }));
}

const PROJECT_TTL_MS = 5 * 60_000;

type LoadProjectResult = z.input<typeof loadProject.output>;

const projectCache = new Cache<LoadProjectResult>("project");

export async function loadProjectHandler({
  host,
  owner,
  number,
  force,
}: z.output<typeof loadProject.input>): Promise<LoadProjectResult> {
  const key = `${host}\u0000${owner}\u0000${number}`;
  return projectCache.get(
    key,
    PROJECT_TTL_MS,
    () =>
      withGithubHostname(host, async () => {
        const { data, errors } = await ghGraphqlRaw([
          "api",
          "graphql",
          "-f",
          `query=${PROJECT_QUERY}`,
          "-f",
          `owner=${owner}`,
          "-F",
          `number=${number}`,
        ]);

        if (data === null) {
          if (needsProjectScope(errors)) throw new Error(projectScopeMessage(host));
          throw new Error(
            errors.map((error) => error.message).join(" ") || "GitHub returned no data.",
          );
        }

        const asUser = data.asUser as { projectV2?: GhProjectV2Node | null } | null;
        const asOrg = data.asOrg as { projectV2?: GhProjectV2Node | null } | null;
        const project = asUser?.projectV2 ?? asOrg?.projectV2;

        if (project === null || project === undefined) {
          const message = errors.map((error) => error.message).join(" ");
          throw new Error(message !== "" ? message : `Project ${owner}/${number} was not found.`);
        }

        return {
          title: typeof project.title === "string" ? project.title : "",
          url: typeof project.url === "string" ? project.url : "",
          columns: groupProjectItems(project),
        };
      }),
    { force },
  );
}
