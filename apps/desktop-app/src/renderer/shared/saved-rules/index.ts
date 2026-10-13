export type SavedRule = { id: string; action: string; resource: string };
export type SavedRulesRequest =
  | { type: "rules.list"; workspaceId: string }
  | { type: "rules.remove"; workspaceId: string; id: string };

export const savedRulesErrorText = (code: string) =>
  code === "NOT_FOUND"
    ? "이미 삭제된 규칙입니다. 목록을 새로 불러왔습니다."
    : "Native에 연결할 수 없어 규칙을 처리하지 못했습니다.";

export async function callSavedRules<T>(
  request: SavedRulesRequest,
): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try {
    return (await window.desktopBridge.rules(request)) as {
      ok: true;
      value: T;
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
