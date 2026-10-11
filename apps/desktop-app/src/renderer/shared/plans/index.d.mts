export const PLAN_DIR: ".omoc/plans";
export const PLAN_LIMITS: Readonly<{
  bytes: 65536;
  listed: 100;
  approvals: 200;
  links: 200;
  checks: 100;
  findingChars: 500;
}>;
export const CHECK_KINDS: readonly CheckKind[];
export const FINDING_AUTHORS: readonly FindingAuthor[];
export const RESOLVERS: readonly Resolver[];
export type CheckKind = "lint" | "test" | "typecheck" | "custom";
export type CheckStatus = "not-run" | "running" | "passed" | "failed";
export type FindingAuthor = "implementer" | "reviewer";
export type Resolver = "user" | "implementer" | "reviewer";
export type ChecklistItem = {
  line: number;
  checked: boolean;
  mark: number;
  text: string;
};
export type Finding = {
  line: number;
  author: FindingAuthor;
  text: string;
  status: "open" | "resolved";
  resolvedBy: Resolver | undefined;
};
export type PlanFile = { path: string; bytes: number; sha256: string };
export type Approval = {
  workspaceId?: string;
  path: string;
  sha256: string;
  version: number;
  approvedAt: string;
};
export type PlanLink = {
  workspaceId?: string;
  sessionId: string;
  path: string;
  sha256: string;
  version: number;
  linkedAt: string;
};
export type PlanCheck = {
  id: string;
  workspaceId?: string;
  path: string;
  kind: CheckKind;
  script: string;
  command: string;
  terminalId: string | null;
  status: CheckStatus;
  exitCode: number | null;
  planSha: string;
  fingerprint: string | null;
  startedAt: string;
  finishedAt: string | null;
  source: "실행 결과";
};
export type PlansList = {
  plans: PlanFile[];
  approvals: Approval[];
  links: PlanLink[];
  checks: PlanCheck[];
};
export type PlansRequest =
  | { type: "plans.list"; workspaceId: string }
  | { type: "plans.create"; workspaceId: string; title: string }
  | { type: "plans.approve"; workspaceId: string; path: string; sha256: string }
  | {
      type: "plans.link";
      workspaceId: string;
      path: string;
      sha256: string;
      sessionId: string;
    }
  | {
      type: "plans.check";
      workspaceId: string;
      path: string;
      kind: CheckKind;
      terminalId: string;
      fingerprint?: string;
    };
export type PlansResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export function isPlanPath(v: unknown): v is string;
export function planSlug(title: unknown): string;
export function planTemplate(title: unknown): string;
export function parseChecklist(text: string): {
  items: ChecklistItem[];
  total: number;
  done: number;
};
export function toggleChecklistItem(
  text: string,
  line: number,
): string | undefined;
export function parseFindings(text: string): Finding[];
export function appendFinding(
  text: string,
  finding: { author: FindingAuthor; text: string },
): string | undefined;
export function setFindingStatus(
  text: string,
  line: number,
  status: "open" | "resolved",
  resolvedBy?: Resolver,
): string | undefined;
export function summarizeFindings(findings: Finding[]): {
  open: number;
  resolved: number;
  awaitingRecheck: number;
};
export function approvalState(
  records: Approval[] | undefined,
  path: string,
  sha256: string,
):
  | { state: "none" }
  | { state: "approved" | "stale"; version: number; record: Approval };
export function nextApprovalVersion(
  records: Approval[] | undefined,
  path: string,
): number;
export function checkStatusFromTerminal(
  term:
    | {
        status: "running" | "exited";
        exitCode: number | null;
        signal?: string | null;
      }
    | undefined,
): CheckStatus;
export function checkStale(
  check: Pick<PlanCheck, "status" | "planSha" | "fingerprint">,
  current: { planSha: string; fingerprint?: string | undefined },
): boolean;
export function verificationSummary(
  checks: PlanCheck[],
  current: { planSha: string; fingerprint?: string | undefined },
): "none" | "running" | "stale" | "failed" | "passed" | "pending";
export function workspaceFingerprint(
  repository: { head: string | null } | undefined,
  files: { path: string; index: string; worktree: string }[] | undefined,
): string | undefined;
export function sha256Hex(text: string): Promise<string>;
export function executionMessage(input: {
  path: string;
  sha256: string;
  version: number;
}): string;
export function validatePlansRequest(value: unknown): PlansRequest | undefined;
