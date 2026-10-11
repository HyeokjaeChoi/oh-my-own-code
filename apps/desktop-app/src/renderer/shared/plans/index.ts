export {
  PLAN_DIR,
  PLAN_LIMITS,
  CHECK_KINDS,
  FINDING_AUTHORS,
  RESOLVERS,
  isPlanPath,
  planSlug,
  planTemplate,
  parseChecklist,
  toggleChecklistItem,
  parseFindings,
  appendFinding,
  setFindingStatus,
  summarizeFindings,
  approvalState,
  nextApprovalVersion,
  checkStatusFromTerminal,
  checkStale,
  scan as scanPlanLines,
  verificationSummary,
  workspaceFingerprint,
  sha256Hex,
  executionMessage,
  validatePlansRequest,
} from "./index.mjs";
export type {
  CheckKind,
  CheckStatus,
  FindingAuthor,
  Resolver,
  ChecklistItem,
  Finding,
  PlanFile,
  Approval,
  PlanLink,
  PlanCheck,
  PlansList,
  PlansRequest,
  PlansResult,
} from "./index.mjs";
export async function callPlans<T>(
  request: import("./index.mjs").PlansRequest,
): Promise<import("./index.mjs").PlansResult<T>> {
  try {
    return (await window.desktopBridge.plans(
      request,
    )) as import("./index.mjs").PlansResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
