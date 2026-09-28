import { projectScopeCommand } from "../github/host";
import type { GraphqlError } from "../github/graphql";

/**
 * Projects v2 sits behind its own OAuth scope, which `gh auth login` never
 * grants automatically, so a token missing it is the ordinary case rather
 * than a failure. GitHub reports it as a validation error with no `data` at
 * all, before any field runs — see `ghGraphqlRaw` — so this is checked ahead
 * of the per-owner partial-failure handling, not folded into it.
 */
export function projectScopeMessage(hostname: string): string {
  return `GitHub Projects on ${hostname} needs a scope this token does not have. Run \`${projectScopeCommand(hostname)}\`, then reload.`;
}

export function needsProjectScope(errors: readonly GraphqlError[]): boolean {
  return errors.some(
    (error) => error.type === "INSUFFICIENT_SCOPES" || error.message.includes("read:project"),
  );
}
