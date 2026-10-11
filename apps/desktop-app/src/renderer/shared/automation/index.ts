export {
  AUTOMATION_LIMITS,
  PERMISSION_MODES,
  MODE_LABELS,
  validateSchedule,
  validateJobInput,
  normalizeStoredJob,
  nextOccurrence,
  occurrencesBetween,
  planTick,
  describeSchedule,
  validateAutomationRequest,
} from "./index.mjs";
export type {
  PermissionMode,
  Schedule,
  JobTarget,
  JobInput,
  HistoryEntry,
  JobView,
  AutomationList,
  AutomationRequest,
  AutomationResult,
} from "./index.mjs";
export async function callAutomation<T>(
  request: import("./index.mjs").AutomationRequest,
): Promise<import("./index.mjs").AutomationResult<T>> {
  try {
    return (await window.desktopBridge.automation(
      request,
    )) as import("./index.mjs").AutomationResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
