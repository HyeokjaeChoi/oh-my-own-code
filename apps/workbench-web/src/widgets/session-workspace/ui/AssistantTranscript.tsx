import React from "react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type Toolkit,
} from "@assistant-ui/react";
import {
  parseSafeLinkPreview,
  type SyntheticSnapshot,
} from "@workbench/contracts/source";
import { LinkPreview, StatusBadge, type StatusBadgeTone } from "@workbench/ui";
import { toAssistantThreadMessages } from "../../../entities/session/index.js";

type PreviewLinkToolProps = {
  args?: Readonly<Record<string, unknown>> | undefined;
  isError?: boolean | undefined;
  result?: unknown | undefined;
  status?: { type: string } | undefined;
  toolName?: string | undefined;
};

function displayTarget(result: unknown) {
  const candidate = parseSafeLinkPreview(result)?.href;
  if (!candidate) return "대상 확인 불가";
  try {
    const url = new URL(candidate);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "대상 확인 불가";
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "대상 확인 불가";
  }
}

function ToolCallSummary({
  toolName,
  status,
  target,
}: {
  toolName: string;
  status: { label: string; tone: StatusBadgeTone };
  target: string;
}) {
  return (
    <div className="tool-call-summary" aria-label={`${toolName} 도구 호출`}>
      <div className="tool-call-heading">
        <span className="tool-call-name">{toolName}</span>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <p className="tool-call-target">
        <span>대상</span>
        <span>{target}</span>
      </p>
    </div>
  );
}

export function PreviewLinkToolRenderer({
  isError,
  result,
  status,
  toolName = "previewLink",
}: PreviewLinkToolProps) {
  const parsed = parseSafeLinkPreview(result);
  const callStatus =
    isError || status?.type === "incomplete"
      ? { label: "실패", tone: "error" as const }
      : status?.type === "running"
        ? { label: "실행 중", tone: "info" as const }
        : status?.type === "complete"
          ? { label: "확인 완료", tone: "success" as const }
          : { label: "상태 확인 중", tone: "neutral" as const };
  const target = displayTarget(result);

  if (parsed)
    return (
      <div className="tool-result">
        <ToolCallSummary
          toolName={toolName}
          status={callStatus}
          target={target}
        />
        <div className="tool-result-card">
          <p className="tool-result-label">검증된 미리보기</p>
          <LinkPreview
            {...parsed}
            locale="ko-KR"
            className="omoc-link-preview"
            interactive={false}
          />
        </div>
      </div>
    );

  return (
    <div className="tool-result">
      <ToolCallSummary
        toolName={toolName}
        status={callStatus}
        target={target}
      />
      <div
        className="tool-fallback"
        role="note"
        data-tool-fallback="previewLink"
      >
        링크 미리보기 결과를 표시할 수 없습니다. 실행 동작은 없습니다.
      </div>
    </div>
  );
}

const toolKit: Toolkit = {
  previewLink: {
    type: "backend",
    render: PreviewLinkToolRenderer,
  },
};

function NoActionToolFallback({ toolName }: { toolName: string }) {
  return (
    <div className="tool-fallback" role="note" data-tool-fallback={toolName}>
      {toolName === "previewLink"
        ? "도구 결과를 일반 표시로 남깁니다. 실행 동작은 없습니다."
        : "등록되지 않은 도구 결과입니다. 실행 동작 없이 일반 결과로 남깁니다."}
    </div>
  );
}

function MessageView({
  role,
  provenance,
}: {
  role: "user" | "assistant";
  provenance: "message" | "event";
}) {
  return (
    <MessagePrimitive.Root
      className={`transcript-message transcript-message--${role}`}
      data-provenance={provenance}
    >
      <div className="transcript-message-meta">
        <span className="transcript-speaker">
          {role === "user" ? "사용자" : "도우미"}
        </span>
        {provenance === "event" && (
          <span className="transcript-origin">이벤트</span>
        )}
      </div>
      <MessagePrimitive.Parts
        components={{
          Text: ({ text }) => <p className="transcript-text">{text}</p>,
          tools: {
            by_name: { previewLink: PreviewLinkToolRenderer },
            Fallback: NoActionToolFallback,
          },
        }}
      />
    </MessagePrimitive.Root>
  );
}

export function AssistantTranscript({
  projectedSnapshot,
}: {
  projectedSnapshot: SyntheticSnapshot;
}) {
  const messages: ThreadMessageLike[] =
    toAssistantThreadMessages(projectedSnapshot);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: projectedSnapshot.run.status === "running",
    convertMessage: (message) => message,
    onNew: async () => undefined,
  });
  const aui = useAui({ tools: Tools({ toolkit: toolKit }) });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <ThreadPrimitive.Messages>
        {({ message }) => (
          <MessageView
            key={message.id}
            role={message.role === "user" ? "user" : "assistant"}
            provenance={
              message.metadata.custom.provenance === "event"
                ? "event"
                : "message"
            }
          />
        )}
      </ThreadPrimitive.Messages>
    </AssistantRuntimeProvider>
  );
}
