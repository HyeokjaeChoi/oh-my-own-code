import { SyntheticSnapshotSchema } from "@workbench/contracts";

export const syntheticSnapshot = SyntheticSnapshotSchema.parse({
  source: "synthetic-fixture",
  revision: 1,
  eventCursor: 0,
  workspace: {
    id: "synthetic-workspace",
    name: "Demo project",
    label: "합성 워크스페이스 · 실제 경로 없음",
  },
  session: { id: "synthetic-session", title: "LinkPreview 합성 흐름" },
  run: { id: "synthetic-run", status: "complete" },
  messages: [
    {
      id: "synthetic-user-message",
      sessionId: "synthetic-session",
      role: "user",
      runId: null,
      content: [
        {
          id: "synthetic-user-text",
          type: "text",
          text: "합성 링크 결과를 확인해 주세요.",
        },
      ],
    },
    {
      id: "synthetic-assistant-message",
      sessionId: "synthetic-session",
      role: "assistant",
      runId: "synthetic-run",
      content: [
        {
          id: "synthetic-assistant-text",
          type: "text",
          text: "아래 도구 결과는 고정된 로컬 fixture이며 외부 실행을 하지 않았습니다.",
        },
        {
          id: "synthetic-preview-part",
          type: "tool",
          toolCallId: "synthetic-preview-call",
          toolName: "previewLink",
          args: { href: "https://example.invalid/synthetic" },
          result: {
            id: "synthetic-link-preview",
            href: "https://example.invalid/synthetic",
            title: "안전한 합성 링크",
            description: "실제 프로젝트 데이터 없이 만든 고정 fixture입니다.",
            domain: "example.invalid",
          },
          status: "complete",
        },
      ],
    },
  ],
  events: [
    {
      id: "synthetic-run-complete-event",
      sequence: 1,
      type: "run.status",
      sessionId: "synthetic-session",
      runId: "synthetic-run",
      status: "complete",
    },
    {
      id: "synthetic-message-appended-event",
      sequence: 2,
      type: "message.appended",
      sessionId: "synthetic-session",
      message: {
        id: "synthetic-event-message",
        sessionId: "synthetic-session",
        role: "assistant",
        runId: "synthetic-run",
        content: [
          {
            id: "synthetic-event-text",
            type: "text",
            text: "이 메시지는 합성 이벤트 fixture에서 왔습니다.",
          },
        ],
      },
    },
  ],
});
