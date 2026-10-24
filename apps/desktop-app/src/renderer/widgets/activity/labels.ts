export const operationLabels: Record<string, string> = {
  "workspace.import": "폴더 가져오기",
  "workspace.create": "작업 공간 만들기",
  "workspace.remove": "작업 공간 목록에서 제거",
  "session.create": "새 세션 만들기",
  "session.rename": "세션 이름 변경",
  "session.pin": "세션 고정 변경",
  "permission.mode.set": "권한 모드 변경",
  "session.archive": "세션 보관 변경",
  "session.fork": "대화 분기",
  "session.remove": "대화 삭제",
  "session.revert": "되돌리기",
  "session.revert.clear": "다시 적용",
  "message.send": "메시지 전송",
  "command.run": "명령 실행",
  "session.interrupt": "실행 중단 요청",
  "permission.respond": "권한 요청 응답",
};

export const activityFilters = [
  ["all", "전체"],
  ["chat", "대화"],
  ["files", "파일·Git"],
  ["config", "설정"],
  ["failed", "실패만"],
] as const;
export type ActivityFilter = (typeof activityFilters)[number][0];
// Unknown operations match only "전체" (and "실패만" by status), never a guessed bucket.
export function activityMatches(
  filter: ActivityFilter,
  event: { operation: string; status: string },
): boolean {
  const op = event.operation;
  switch (filter) {
    case "all":
      return true;
    case "failed":
      return event.status === "error" || event.status === "unknown";
    case "chat":
      return /^(message\.|command\.|session\.(interrupt|fork|revert)|permission\.respond)/.test(
        op,
      );
    case "files":
      return /^(file\.|git\.|workspace\.)/.test(op);
    case "config":
      return /^(configuration\.|permission\.mode)/.test(op);
  }
}
