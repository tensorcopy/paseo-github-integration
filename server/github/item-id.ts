import { withGithubHostname } from "./host";

const SEPARATOR = "\u0000";

export function encodeItemId(hostname: string, nodeId: string): string {
  return `${hostname}${SEPARATOR}${nodeId}`;
}

export function decodeItemId(id: string): { hostname: string; nodeId: string } {
  const separator = id.indexOf(SEPARATOR);
  if (separator <= 0 || separator === id.length - 1) {
    throw new Error("This item has no GitHub host. Refresh the dashboard and try again.");
  }
  return { hostname: id.slice(0, separator), nodeId: id.slice(separator + 1) };
}

export function withItemId<T>(id: string, run: (nodeId: string) => Promise<T>): Promise<T> {
  const { hostname, nodeId } = decodeItemId(id);
  return withGithubHostname(hostname, () => run(nodeId));
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(`GitHub returned an invalid item URL: ${url}`);
  }
}
