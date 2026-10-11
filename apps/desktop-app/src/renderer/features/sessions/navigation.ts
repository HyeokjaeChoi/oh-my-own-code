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
export type SessionActivity = {
  status: Record<string, WorkbenchSession["status"]>;
  unread: string[];
  recent: string[];
  selectedId?: string | undefined;
};
export const emptyActivity: SessionActivity = {
  status: {},
  unread: [],
  recent: [],
};
// Unread = a non-selected session finished a run (running/stopping -> idle)
// since it was last opened. Derived from snapshots only; not persisted.
export function trackSessions(
  prev: SessionActivity,
  sessions: WorkbenchSession[],
  selectedId?: string,
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
  return {
    status: Object.fromEntries(sessions.map((s) => [s.id, s.status])),
    unread: [...unread],
    recent: recent.filter((id) => ids.has(id)).slice(0, RECENT_LIMIT),
    selectedId,
  };
}
