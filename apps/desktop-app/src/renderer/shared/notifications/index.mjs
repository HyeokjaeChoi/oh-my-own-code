// Pure notification derivation. Text is generic by construction: a title or a count, never
// prompt/response/tool content or paths.
export const NOTIFICATION_LIMIT = 100;
export const NOTIFICATIONS_STORAGE_KEY = "omoc.notifications.v1";
const clean = (s, n = 40) => {
  const t = String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || "제목 없음";
};
export const sessionText = (kind, title) =>
  `세션 '${clean(title)}' ${{ done: "작업 완료", error: "오류 발생", approval: "승인 요청 대기" }[kind]}`;
const RESULT = { ok: "실행 완료", failed: "실행 실패", skipped: "건너뜀" };
export const jobText = (name, entry) =>
  entry.result === "missed"
    ? `자동화 '${clean(name)}' 놓친 실행 ${entry.count ?? 1}건`
    : `자동화 '${clean(name)}' ${RESULT[entry.result] ?? "결과 기록"}`;

// prev/next: { sessions: [{id,workspaceId,title,status}], permissions: [{id,sessionId}] } | undefined
export function deriveSessionNotices(prev, next, now) {
  if (!prev || !next) return [];
  const out = [];
  const before = new Map(prev.sessions.map((s) => [s.id, s]));
  for (const s of next.sessions) {
    const p = before.get(s.id);
    const active = p && (p.status === "running" || p.status === "stopping");
    const base = { workspaceId: s.workspaceId, sessionId: s.id };
    if (active && s.status === "idle")
      out.push({ ...base, id: `done:${s.id}:${now}`, kind: "done", text: sessionText("done", s.title) });
    else if (active && (s.status === "unavailable" || s.status === "unknown"))
      out.push({ ...base, id: `error:${s.id}:${now}`, kind: "error", text: sessionText("error", s.title) });
  }
  const seen = new Set(prev.permissions.map((p) => p.id));
  const titles = new Map(next.sessions.map((s) => [s.id, s]));
  for (const p of next.permissions) {
    const s = titles.get(p.sessionId);
    if (seen.has(p.id) || !s) continue;
    out.push({
      workspaceId: s.workspaceId,
      sessionId: s.id,
      id: `approval:${p.id}`,
      kind: "approval",
      text: sessionText("approval", s.title),
    });
  }
  return out;
}

// Job history entries recorded since this app run started become notices; ids dedupe reloads.
export function deriveJobNotices(jobs, startedAt) {
  const out = [];
  for (const j of jobs)
    for (const e of j.history)
      if (e.recordedAt >= startedAt)
        out.push({
          id: `job:${e.id}`,
          kind: e.result === "failed" ? "error" : "job",
          text: jobText(j.name, e),
          workspaceId: j.target.workspaceId,
        });
  return out;
}

// Adds unseen notices (unread), newest first, capped.
export function mergeNotices(list, notices, now) {
  const have = new Set(list.map((n) => n.id));
  const added = notices
    .filter((n) => !have.has(n.id))
    .map((n) => ({ ...n, at: now, read: false }));
  return {
    added,
    list: [...added, ...list].slice(0, NOTIFICATION_LIMIT),
  };
}
