import type { WorkbenchSession } from "../../shared/api/index.js";
export function visibleSessions(
  sessions: WorkbenchSession[],
  workspaceId: string,
  query = "",
  archived = false,
) {
  const search = query.trim().toLocaleLowerCase();
  return sessions
    .filter(
      (session) =>
        session.workspaceId === workspaceId &&
        Boolean(session.archived) === archived &&
        session.title.toLocaleLowerCase().includes(search),
    )
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}
// Recently opened sessions (most recent first), excluding the open one,
// archived ones and other workspaces. Quick-reopen list in the sidebar.
export function recentSessions<T extends WorkbenchSession>(
  sessions: T[],
  recent: string[],
  workspaceId: string,
  selectedId?: string,
  limit = RECENT_LIMIT,
): T[] {
  return recent
    .map((id) => sessions.find((session) => session.id === id))
    .filter(
      (session): session is T =>
        session !== undefined &&
        session.workspaceId === workspaceId &&
        !session.archived &&
        session.id !== selectedId,
    )
    .slice(0, limit);
}
export function sessionSuccessor(
  sessions: WorkbenchSession[],
  workspaceId: string,
  selectedId?: string,
  removedId?: string,
) {
  const visible = visibleSessions(sessions, workspaceId).filter(
    (session) => session.id !== removedId,
  );
  return (
    visible.find((session) => session.id === selectedId)?.id ?? visible[0]?.id
  );
}
export function validSessionTitle(title: string) {
  const value = title.trim();
  return (
    value.length > 0 &&
    value.length <= 120 &&
    !Array.from(title).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
export const RECENT_LIMIT = 5;
// Stored list is longer than the display limit: archived, removed, open and
// other-workspace entries are filtered out at display time.
export const RECENT_STORE_LIMIT = 50;
export type SessionActivity = {
  status: Record<string, WorkbenchSession["status"]>;
  unread: string[];
  recent: string[];
  selectedId?: string | undefined;
  /** Last observed status change per session (ms). Unknown until one is seen. */
  active: Record<string, number>;
};
export const emptyActivity: SessionActivity = {
  status: {},
  unread: [],
  recent: [],
  active: {},
};
export const ACTIVE_LIMIT = 200;
const MINUTE = 60_000;
// "방금", "3분", "2시간", "어제", "5일", "3주". Compact, no "전".
export function relativeTime(then: number, now: number): string {
  const ago = Math.max(0, now - then);
  if (ago < MINUTE) return "방금";
  if (ago < 60 * MINUTE) return `${Math.floor(ago / MINUTE)}분`;
  if (ago < 24 * 60 * MINUTE) return `${Math.floor(ago / (60 * MINUTE))}시간`;
  const days = Math.floor(ago / (24 * 60 * MINUTE));
  if (days === 1) return "어제";
  return days < 7 ? `${days}일` : `${Math.floor(days / 7)}주`;
}
// Native's own last-activity time leads; observed status changes cover what it
// has not reported yet (and a run seen after its last list read).
export const sessionTime = (
  session: WorkbenchSession,
  active: Record<string, number>,
): number | undefined => {
  const times = [session.updatedAt, active[session.id]].filter(
    (t): t is number => typeof t === "number",
  );
  return times.length ? Math.max(...times) : undefined;
};
// Unread = a non-selected session finished a run (running/stopping -> idle)
// since it was last opened. Derived from snapshots only; not persisted.
export function trackSessions(
  prev: SessionActivity,
  sessions: WorkbenchSession[],
  selectedId?: string,
  now = Date.now(),
): SessionActivity {
  const ids = new Set(sessions.map((s) => s.id));
  const unread = new Set(prev.unread.filter((id) => ids.has(id)));
  for (const s of sessions)
    if (
      s.id !== selectedId &&
      s.status === "idle" &&
      (prev.status[s.id] === "running" || prev.status[s.id] === "stopping")
    )
      unread.add(s.id);
  if (selectedId) unread.delete(selectedId);
  const recent =
    selectedId && selectedId !== prev.selectedId
      ? [selectedId, ...prev.recent.filter((id) => id !== selectedId)]
      : prev.recent;
  // Merge, never rebuild: sessions outside the current list keep their time.
  // A move into or out of unknown/unavailable (a reconnect) is not activity.
  const lost = (status?: WorkbenchSession["status"]) =>
    status === "unknown" || status === "unavailable";
  const merged = { ...prev.active };
  for (const s of sessions) {
    const previous = prev.status[s.id];
    if (
      previous !== undefined &&
      previous !== s.status &&
      !lost(previous) &&
      !lost(s.status)
    )
      merged[s.id] = now;
  }
  const active = Object.fromEntries(
    Object.entries(merged)
      .sort(([, a], [, b]) => b - a)
      .slice(0, ACTIVE_LIMIT),
  );
  return {
    active,
    status: Object.fromEntries(sessions.map((s) => [s.id, s.status])),
    unread: [...unread],
    recent: recent.filter((id) => ids.has(id)).slice(0, RECENT_STORE_LIMIT),
    selectedId,
  };
}

export const NEW_SESSION_TITLE = "새 세션";
// Sessions start as "Untitled session"; the first managed session is "Workbench".
// Native auto-titles are observed but never committed to app metadata, so the
// renderer shows the first user prompt instead of those placeholders.
export function isPlaceholderTitle(title: string) {
  return title === "Untitled session" || title === "Workbench";
}
export function titleFromPrompt(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}
// `storedTitle` is the authoritative title; `title` is display-only.
export type DisplaySession = WorkbenchSession & { storedTitle: string };
export function withDisplayTitles(
  sessions: WorkbenchSession[],
  derived: Record<string, string>,
): DisplaySession[] {
  return sessions.map((s) => ({
    ...s,
    storedTitle: s.title,
    title: isPlaceholderTitle(s.title)
      ? (derived[s.id] ?? NEW_SESSION_TITLE)
      : s.title,
  }));
}
