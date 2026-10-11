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
