// Pure timeline derivation from data the renderer already holds. No new store.
// Messages/tools/permissions carry no timestamps (order only); activity events do.
// Untimed entries keep source order and come first; timed entries follow, sorted
// by time with a stable tie-break on source order.
export const timelineKinds = [
  "message",
  "tool",
  "permission",
  "child",
  "activity",
  "error",
];
const toolStatus = {
  pending: "대기",
  running: "실행 중",
  completed: "완료",
  error: "오류",
};
export function deriveTimeline({
  sessionId,
  messages = [],
  permissions = [],
  sessions = [],
  events = [],
}) {
  const out = [];
  const add = (entry) => out.push({ ...entry, seq: out.length });
  for (const m of messages) {
    add({
      time: null,
      kind: "message",
      sessionId,
      title: `${m.role === "user" ? "나" : "도우미"}: ${(m.text ?? "").trim().slice(0, 80)}`,
      status: m.role,
      target: { type: "message", messageId: m.id },
    });
    for (const t of m.tools ?? [])
      add({
        time: null,
        kind: t.status === "error" ? "error" : "tool",
        sessionId,
        title: t.name,
        status: toolStatus[t.status] ?? t.status,
        target: { type: "message", messageId: m.id, toolId: t.id },
      });
  }
  for (const p of permissions)
    add({
      time: null,
      kind: "permission",
      sessionId: p.sessionId,
      title: p.title,
      status: "대기",
      target: { type: "permission", permissionId: p.id },
    });
  for (const s of sessions)
    if (sessionId && s.parentSessionId === sessionId)
      add({
        time: null,
        kind: "child",
        sessionId: s.id,
        title: s.title,
        status: s.status,
        target: { type: "session", sessionId: s.id },
      });
  for (const e of events)
    add({
      time: Number.isFinite(e.timestamp) ? e.timestamp : null,
      kind: e.status === "error" ? "error" : "activity",
      sessionId: e.sessionId,
      title: e.operation,
      status: e.status,
      target: e.sessionId ? { type: "session", sessionId: e.sessionId } : null,
    });
  return out.sort((a, b) =>
    (a.time === null) !== (b.time === null)
      ? a.time === null
        ? -1
        : 1
      : (a.time ?? 0) - (b.time ?? 0) || a.seq - b.seq,
  );
}
// kinds/sessionIds: Set or undefined (= all).
export const filterTimeline = (entries, { kinds, sessionIds } = {}) =>
  entries.filter(
    (e) =>
      (!kinds || kinds.has(e.kind)) &&
      (!sessionIds ||
        (e.sessionId !== undefined && sessionIds.has(e.sessionId))),
  );
