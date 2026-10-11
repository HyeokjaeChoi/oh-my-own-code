export const SKILL_LIMITS: Readonly<{ bytes: 32768; entries: 16; scan: 64 }>;
export function validSkillSourceName(value: unknown): value is string;
export function skillDraftKey(
  workspaceId: string,
  path: string,
  sourceName: string,
): string;
export function skillFileContentFits(text: unknown): text is string;
export type SkillIssue =
  | "empty"
  | "too_large"
  | "control_bytes"
  | "unsupported_frontmatter";
export type SkillValidation = {
  status: "valid" | "invalid" | "unsupported";
  issues: SkillIssue[];
};
export const skillIssueMessages: Readonly<Record<SkillIssue, string>>;
export function validateSkillFile(text: unknown): SkillValidation;
export function skillFileWriteFits(text: unknown): boolean;
