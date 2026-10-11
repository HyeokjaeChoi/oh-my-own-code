export type PermissionMode = "ask" | "scoped_edit" | "read_plan";
export type Schedule = { every: number } | { daily: string };
export type JobTarget =
  | { workspaceId: string; kind: "prompt"; prompt: string }
  | { workspaceId: string; kind: "script"; script: string };
export type JobInput = {
  name: string;
  target: JobTarget;
  schedule: Schedule;
  /** Required for prompt jobs; null for scripts (they run with shell rights). */
  permissionMode: PermissionMode | null;
};
export type HistoryEntry = {
  id: string;
  scheduledAt: number;
  startedAt: number | null;
  recordedAt: number;
  result: "ok" | "failed" | "skipped" | "missed" | "timeout";
  reason: string;
  count?: number;
  last?: number;
};
export type JobView = JobInput & {
  id: string;
  enabled: boolean;
  running: boolean;
  nextAt: number | null;
  history: HistoryEntry[];
};
export type AutomationList = {
  startedAt: number;
  jobs: JobView[];
  storeError?: boolean;
  recovered?: { count: number; backup: string };
};
export type AutomationRequest =
  | { type: "automation.list" }
  | { type: "automation.create"; job: JobInput }
  | { type: "automation.update"; jobId: string; job: JobInput }
  | { type: "automation.setEnabled"; jobId: string; enabled: boolean }
  | { type: "automation.remove"; jobId: string }
  | { type: "automation.runNow"; jobId: string };
export type AutomationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export const AUTOMATION_LIMITS: Readonly<{
  jobs: number;
  history: number;
  retainedSessions: number;
  promptTimeoutMs: number;
  clockBackMs: number;
  minEveryMinutes: number;
  maxEveryMinutes: number;
  name: number;
  prompt: number;
  occurrenceScan: number;
}>;
export const PERMISSION_MODES: readonly PermissionMode[];
export const MODE_LABELS: Readonly<Record<PermissionMode, string>>;
export function normalizeStoredJob(value: unknown):
  | (JobInput & {
      id: string;
      enabled: boolean;
      anchor: number;
      history: HistoryEntry[];
      sessionIds: { sessionId: string; workspaceId: string }[];
    })
  | undefined;
export function validateSchedule(value: unknown): Schedule | undefined;
export function validateJobInput(value: unknown): JobInput | undefined;
export function nextOccurrence(
  schedule: Schedule,
  after: number,
  anchor: number,
): number;
export function occurrencesBetween(
  schedule: Schedule,
  anchor: number,
  from: number,
  to: number,
): number[];
export function planTick(args: {
  schedule: Schedule;
  anchor: number;
  lastCheck: number;
  now: number;
  startup?: boolean;
  graceMs?: number;
}): {
  due: number | undefined;
  missed: { count: number; first: number; last: number } | undefined;
};
export function describeSchedule(schedule: Schedule): string;
export function validateAutomationRequest(
  value: unknown,
): AutomationRequest | undefined;
