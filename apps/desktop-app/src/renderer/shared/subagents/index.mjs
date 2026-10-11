// Pure subagent helpers: child-tree derivation, delegation brief, concurrency
// queue, cancel fan-out and task-result parsing. No IO, no store access.
export const DEFAULT_CAP = 3;
const BRIEF_FIELDS = [
  ["role", "역할"],
  ["goal", "목표"],
  ["inputs", "입력/참고 자료"],
  ["ownedPaths", "담당 경로"],
  ["acceptance", "수락 기준"],
];

// status: running | waiting | stopping | failed | done. `waiting` = a pending
// permission request exists for the child. `failed` = status the app cannot
// confirm (unknown/unavailable); Native's per-run outcome is not projected.
export function childStatus(session, permissions = []) {
  if (session.status === "unknown" || session.status === "unavailable")
    return "failed";
  if (session.status === "stopping") return "stopping";
  if (session.status === "running")
    return permissions.some((p) => p.sessionId === session.id)
      ? "waiting"
      : "running";
  return "done";
}

// lineage: app-side {childId: parentId} for user-delegated sessions that Native
// cannot link (session.create has no parentID). queued: virtual rows not yet
// created as sessions. Returns depth-first rows below rootId.
export function deriveChildTree({
  rootId,
  sessions = [],
  permissions = [],
  lineage = {},
  queued = [],
}) {
  const parentOf = (s) => s.parentSessionId ?? lineage[s.id];
  const rows = [];
  const walk = (parentId, depth, seen) => {
    for (const s of sessions)
      if (parentOf(s) === parentId && !seen.has(s.id) && !s.archived) {
        rows.push({
          id: s.id,
          title: s.title,
          parentId,
          depth,
          status: childStatus(s, permissions),
          origin: lineage[s.id] === parentId ? "delegated" : "native",
        });
        walk(s.id, depth + 1, new Set(seen).add(s.id));
      }
  };
  if (rootId) walk(rootId, 0, new Set([rootId]));
  for (const q of queued)
    if (q.parentId === rootId)
      rows.push({
        id: q.id,
        title: q.title,
        parentId: rootId,
        depth: 0,
        status: "queued",
        origin: "delegated",
      });
  return rows;
}

export const isActive = (row) =>
  row.status === "running" || row.status === "waiting";

export function renderBrief(brief) {
  const out = [
    "당신은 상위 세션에서 위임받은 하위 작업자입니다. 이 세션은 새 컨텍스트이며 상위 대화 기록을 가지고 있지 않습니다.",
  ];
  for (const [key, label] of BRIEF_FIELDS) {
    const raw = brief[key];
    const value = (Array.isArray(raw) ? raw.join("\n") : (raw ?? "")).trim();
    if (value) out.push(`## ${label}\n${value}`);
  }
  return out.join("\n\n");
}
export const validBrief = (brief) => Boolean(brief.goal?.trim());
export const briefTitle = (brief) => {
  const base = (brief.role?.trim() || "위임") + ": " + brief.goal.trim();
  return Array.from(base)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .slice(0, 80)
    .join("");
};

// Which queued items may start now. runningCount = delegated children currently
// active (queued items never count). Strict FIFO.
export function drainQueue({ queued, runningCount, cap = DEFAULT_CAP }) {
  const free = Math.max(0, cap - runningCount);
  return { start: queued.slice(0, free), rest: queued.slice(free) };
}

// Fan-out: cancel every active row sequentially (the host interrupts only the
// selected session). Failures never stop the remaining children.
export async function cancelAll(rows, cancelOne) {
  const result = { cancelled: [], failed: [] };
  for (const row of rows.filter(isActive))
    (await cancelOne(row.id).catch(() => false))
      ? result.cancelled.push(row.id)
      : result.failed.push(row.id);
  return result;
}

// Native `subagent` tool output: <subagent sessionID="..." state="completed">text</subagent>
export function parseSubagentResult(output) {
  const m =
    /^<subagent sessionID="([^"]*)" state="([^"]*)">\n?([\s\S]*?)\n?<\/subagent>\s*$/.exec(
      output ?? "",
    );
  return m ? { sessionId: m[1], state: m[2], text: m[3] } : null;
}
