// Pure scheduling/validation for local recurring jobs. Local-time Date math; no clock reads.
export const AUTOMATION_LIMITS = Object.freeze({
  jobs: 30,
  history: 50,
  retainedSessions: 5,
  promptTimeoutMs: 2 * 60 * 60 * 1000,
  minEveryMinutes: 15,
  maxEveryMinutes: 10080,
  name: 80,
  prompt: 4000,
  occurrenceScan: 1000,
});
export const PERMISSION_MODES = Object.freeze([
  "ask",
  "scoped_edit",
  "read_plan",
]);
export const RESULTS = Object.freeze([
  "ok",
  "failed",
  "skipped",
  "missed",
  "timeout",
]);
const MINUTE = 60000;
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);
const text = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function validateSchedule(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return undefined;
  const keys = Object.keys(s);
  if (keys.length !== 1) return undefined;
  if (keys[0] === "every") {
    return Number.isInteger(s.every) &&
      s.every >= AUTOMATION_LIMITS.minEveryMinutes &&
      s.every <= AUTOMATION_LIMITS.maxEveryMinutes
      ? { every: s.every }
      : undefined;
  }
  if (keys[0] === "daily")
    return typeof s.daily === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(s.daily)
      ? { daily: s.daily }
      : undefined;
  return undefined;
}

// Returns a normalized job definition or undefined. Prompt jobs require a permission mode; script jobs run
// with the user's shell rights, so their mode must be null/absent and is stored as null.
export function validateJobInput(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const allowed = ["name", "target", "schedule", "permissionMode"];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return undefined;
  if (!text(v.name, AUTOMATION_LIMITS.name)) return undefined;
  const schedule = validateSchedule(v.schedule);
  const t = v.target;
  if (!schedule || !t || typeof t !== "object" || !id(t.workspaceId))
    return undefined;
  let target;
  if (
    t.kind === "prompt" &&
    text(t.prompt, AUTOMATION_LIMITS.prompt) &&
    PERMISSION_MODES.includes(v.permissionMode)
  )
    target = { workspaceId: t.workspaceId, kind: "prompt", prompt: t.prompt };
  else if (
    t.kind === "script" &&
    (v.permissionMode ?? null) === null &&
    /^[\w:.-]{1,64}$/.test(t.script ?? "")
  )
    target = { workspaceId: t.workspaceId, kind: "script", script: t.script };
  else return undefined;
  return {
    name: v.name.trim(),
    target,
    schedule,
    permissionMode: target.kind === "prompt" ? v.permissionMode : null,
  };
}

const entry = (e) =>
  e &&
  typeof e === "object" &&
  typeof e.id === "string" &&
  Number.isFinite(e.recordedAt) &&
  RESULTS.includes(e.result);

// Validates/migrates a job loaded from disk; undefined = unusable. Legacy script jobs lose their mode.
export function normalizeStoredJob(j) {
  if (!j || typeof j !== "object" || Array.isArray(j) || !id(j.id))
    return undefined;
  const input = validateJobInput({
    name: j.name,
    target: j.target,
    schedule: j.schedule,
    permissionMode: j.target?.kind === "script" ? null : j.permissionMode,
  });
  if (
    !input ||
    typeof j.enabled !== "boolean" ||
    !Number.isFinite(j.anchor) ||
    !Array.isArray(j.history)
  )
    return undefined;
  return {
    id: j.id,
    ...input,
    enabled: j.enabled,
    anchor: j.anchor,
    history: j.history.filter(entry).slice(-AUTOMATION_LIMITS.history),
    sessionIds: (Array.isArray(j.sessionIds) ? j.sessionIds : [])
      .filter(id)
      .slice(-AUTOMATION_LIMITS.retainedSessions),
  };
}

// Smallest occurrence strictly after `after` (ms). `anchor` fixes the phase of "every".
export function nextOccurrence(schedule, after, anchor) {
  if ("every" in schedule) {
    const step = schedule.every * MINUTE;
    if (after < anchor) return anchor + step;
    return anchor + (Math.floor((after - anchor) / step) + 1) * step;
  }
  const [h, m] = schedule.daily.split(":").map(Number);
  const d = new Date(after);
  d.setHours(h, m, 0, 0);
  // Re-apply the wall-clock time after each day step so DST shifts do not drift it.
  while (d.getTime() <= after) {
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
  }
  return d.getTime();
}

// Occurrences in (from, to], oldest first, capped.
export function occurrencesBetween(schedule, anchor, from, to) {
  const out = [];
  let t = nextOccurrence(schedule, Math.max(from, anchor), anchor);
  while (t <= to && out.length < AUTOMATION_LIMITS.occurrenceScan) {
    out.push(t);
    t = nextOccurrence(schedule, t, anchor);
  }
  return out;
}

// Decides what a scheduler pass does. Only the newest occurrence inside `graceMs` of now may run,
// and never on startup; everything else elapsed since lastCheck is reported as missed, never backfilled.
export function planTick({
  schedule,
  anchor,
  lastCheck,
  now,
  startup = false,
  graceMs = 120000,
}) {
  const all = occurrencesBetween(schedule, anchor, lastCheck, now);
  let due;
  if (!startup && all.length && now - all.at(-1) <= graceMs) due = all.pop();
  return {
    due,
    missed: all.length
      ? { count: all.length, first: all[0], last: all.at(-1) }
      : undefined,
  };
}

export function describeSchedule(s) {
  return "every" in s
    ? s.every % 60 === 0
      ? `${s.every / 60}시간마다`
      : `${s.every}분마다`
    : `매일 ${s.daily}`;
}
export const MODE_LABELS = Object.freeze({
  ask: "매번 확인",
  scoped_edit: "범위 내 편집 허용",
  read_plan: "읽기·계획만",
});

const KINDS = {
  "automation.list": [[], []],
  "automation.create": [["job"], []],
  "automation.update": [["jobId", "job"], []],
  "automation.setEnabled": [["jobId", "enabled"], []],
  "automation.remove": [["jobId"], []],
  "automation.runNow": [["jobId"], []],
};
export function validateAutomationRequest(v) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype ||
    !Object.hasOwn(KINDS, v.type)
  )
    return undefined;
  const [req] = KINDS[v.type];
  const allowed = new Set(["type", ...req]);
  if (
    Reflect.ownKeys(v).some((k) => !allowed.has(k)) ||
    req.some((k) => !Object.hasOwn(v, k))
  )
    return undefined;
  if ("jobId" in v && !id(v.jobId)) return undefined;
  if ("enabled" in v && typeof v.enabled !== "boolean") return undefined;
  if ("job" in v) {
    const job = validateJobInput(v.job);
    if (!job) return undefined;
    return { ...v, job };
  }
  return v;
}
