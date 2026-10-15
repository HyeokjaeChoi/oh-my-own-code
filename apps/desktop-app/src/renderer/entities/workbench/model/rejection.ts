// Plain-Korean text for a host rejection code. Pure; never claims success.
const messages: Record<string, string> = {
  BUSY: "다른 작업을 처리 중입니다. 잠시 후 다시 보내 주세요.",
  AUTH_REQUIRED:
    "사용할 수 있는 모델 자격 증명이 없어 보낼 수 없습니다. 설정의 모델 제공자에서 제공자를 연결하세요.",
  UNAVAILABLE:
    "런타임에 연결되어 있지 않습니다. 연결을 확인한 뒤 다시 시도하세요. 자동으로 다시 보내지 않습니다.",
  STALE_EPOCH:
    "런타임이 다시 시작되어 요청이 적용되지 않았습니다. 상태를 확인한 뒤 다시 시도하세요.",
  STALE_REVISION:
    "화면 상태가 오래되어 요청이 적용되지 않았습니다. 잠시 후 다시 시도하세요.",
  STALE_PERMISSION: "이 권한 요청은 이미 처리되었거나 만료되었습니다.",
  POLICY_UNVERIFIED:
    "권한 정책을 확인할 수 없어 요청을 보류했습니다. 설정의 권한 규칙을 확인하세요.",
  INVALID_REQUEST: "요청 내용이 올바르지 않습니다. 입력을 확인하세요.",
  INVALID_SELECTION:
    "선택한 Agent, 모델 또는 Variant를 사용할 수 없습니다. 다시 선택하세요.",
  NOT_FOUND: "작업 공간 또는 세션을 찾을 수 없습니다.",
  ARCHIVED_SESSION: "보관된 세션입니다. 복원한 뒤 다시 시도하세요.",
  EMPTY_SESSION: "대화 내용이 없어 분기할 수 없습니다.",
  HAS_DESCENDANTS: "하위 대화를 먼저 삭제하세요.",
  DUPLICATE_CONFLICT: "같은 요청이 이미 다른 내용으로 사용되었습니다.",
  LIMIT_REACHED: "일시적인 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
  CANCELLED: "요청이 취소되었습니다.",
  RUNTIME_ERROR: "런타임 작업이 실패했습니다. 다시 시도하세요.",
  UNKNOWN_OUTCOME:
    "요청 결과를 확인할 수 없습니다. 자동으로 다시 보내지 않습니다.",
};

export function rejectionMessage(code: string): string {
  const known = messages[code];
  if (known) return known;
  if (code.startsWith("POLICY_"))
    return "권한 정책에 의해 요청이 보류되었습니다. 설정의 권한 규칙을 확인하세요.";
  return `요청이 거절되었습니다 (${code})`;
}

// Retry-soon codes may clear on their own; everything else waits for the user.
export const transientRejection = (code: string) =>
  ["BUSY", "STALE_EPOCH", "STALE_REVISION", "LIMIT_REACHED"].includes(code);

// Operations whose rejection is shown beside the composer, not in the page status line.
export const composerOperation = (type?: string) =>
  type === "message.send" ||
  type === "permission.respond" ||
  type === "session.interrupt" ||
  type === "session.fork" ||
  type === "session.inbox.cancel";
