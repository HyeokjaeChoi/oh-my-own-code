export const AGENT_LIMITS: Readonly<{ bytes: 32768; entries: 16; scan: 64 }>;
export function validAgentSourceName(value: unknown): value is string;
export function agentDraftKey(
  workspaceId: string,
  path: string,
  sourceName: string,
): string;
export function agentFileContentFits(value: unknown): value is string;
export type AgentIssue =
  | "empty"
  | "too_large"
  | "control_bytes"
  | "unsupported_frontmatter";
export type AgentValidation = {
  status: "valid" | "invalid" | "unsupported";
  issues: AgentIssue[];
};
export const agentIssueMessages: Readonly<Record<AgentIssue, string>>;
export function validateAgentFile(text: unknown): AgentValidation;
export function parseAgentFile(
  text: unknown,
):
  | { system: string; mode: "primary"; description?: string; color?: string }
  | undefined;
export function agentFileWriteFits(text: unknown): boolean;
