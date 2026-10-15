import { PermissionPolicy } from "../../features/permission-policy/index.js";
import {
  ConversationContextControls,
  ContextMessageActions,
} from "../../features/conversation-context/index.js";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  ArrowUp,
  Folder,
  GitBranch,
  Plus,
  Shield,
  Slash,
  Square,
  X,
} from "lucide-react";
import { mapMessages } from "../../shared/projection/index.js";
import { parseSubagentResult } from "../../shared/subagents/index.js";
import {
  deriveToolView,
  effectiveToolStatus,
  permissionsForTool,
} from "../../shared/tool-ui/index.js";
import { ToolBody, ToolContext, useToolContext } from "./tool-views.js";
import {
  currentGitReviewObservation,
  selectors,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import {
  useComposerDraft,
  useDefaultModel,
} from "../../features/composer/index.js";
import type { MutationRequest } from "../../shared/transport/index.js";
import styles from "./conversation.module.css";
import { PopoverPanel, PopoverTrigger } from "./composer-popovers.js";
import { AssistantText, LiteralText } from "./markdown.js";
import { parseSafeLinkPreview } from "@workbench/contracts";
import { Button, LinkPreview } from "@workbench/ui";
import {
  type WorkbenchCatalog,
  type WorkbenchMessage,
  type WorkbenchPermission,
  validAssistantRuntime,
  type RuntimeModel,
} from "../../shared/api/index.js";

/* eslint-disable no-unused-vars -- Names document type-only callback parameters. */
type Props = {
  workspaceId: string;
  sessionId: string;
  messages: WorkbenchMessage[];
  permissions: WorkbenchPermission[];
  catalog: WorkbenchCatalog | null;
  status: string;
  disabled: boolean;
  executionAvailable: boolean;
  newSessionDisabled?: boolean;
  archived?: boolean;
  workspaceName?: string | undefined;
  permissionMode?: "ask" | "scoped_edit" | "read_plan";
  pending: boolean;
  mutate(
    _operation: MutationRequest,
    _navigate?: boolean,
    _submittedText?: string,
  ): Promise<boolean>;
  openPanel(_panel: "files" | "catalog"): void;
  newSession(): void;
};
/* eslint-enable no-unused-vars */
const permissionModes = [
  {
    value: "ask",
    label: "요청마다 확인",
    detail: "편집과 명령 실행 전에 매번 묻습니다",
  },
  {
    value: "scoped_edit",
    label: "범위 내 편집 허용",
    detail: "작업 공간 안의 파일 편집은 묻지 않습니다",
  },
  {
    value: "read_plan",
    label: "읽기/계획",
    detail: "읽기만 하고 아무것도 바꾸지 않습니다",
  },
] as const;
const labels: Record<string, string> = {
  pending: "대기 중",
  running: "실행 중",
  completed: "완료",
  error: "오류",
  "needs-permission": "권한 대기",
};
function ToolDetail({
  toolName,
  toolCallId,
  args,
  result,
}: ToolCallMessagePartProps) {
  const ctx = useToolContext();
  const rawState = typeof args.state === "string" ? args.state : "pending";
  const pendingPermissions = permissionsForTool(ctx.permissions, toolCallId);
  const state = effectiveToolStatus(rawState, pendingPermissions);
  const output =
    typeof result === "string"
      ? result
      : typeof args.output === "string"
        ? args.output
        : "";
  let decoded: unknown = null;
  try {
    if (output.length <= 8192) decoded = JSON.parse(output);
  } catch {
    /* General escaped output below. */
  }
  const subagent = toolName === "subagent" ? parseSubagentResult(output) : null;
  const preview = state === "completed" ? parseSafeLinkPreview(decoded) : null;
  const view = deriveToolView({
    name: toolName,
    input: typeof args.input === "string" ? args.input : "",
    output,
    status: rawState,
  });
  return (
    <div className={`tool-detail ${styles.toolDetail}`}>
      <div className={`tool-heading ${styles.toolHeading}`}>
        <strong>{toolName}</strong>
        <span>{labels[state] ?? "상태 확인 불가"}</span>
      </div>
      <ToolBody view={view} />
      {pendingPermissions.map((p) => (
        <div className={styles.toolPermission} key={p.id}>
          <strong>{p.title}</strong>
          <p className={styles.muted}>
            {p.detail} · 아래 권한 요청에서 응답하세요.
          </p>
        </div>
      ))}
      {preview ? (
        <LinkPreview
          {...preview}
          interactive={false}
          locale="ko-KR"
          className={styles.linkPreview ?? ""}
        />
      ) : null}
      {subagent && state === "completed" ? (
        <div className="subagent-result">
          <p className={styles.muted}>
            하위 세션 최종 응답 ({subagent.sessionId})
          </p>
          <pre>{subagent.text}</pre>
        </div>
      ) : null}
      <details>
        <summary>도구 입력과 결과</summary>
        <p className={styles.muted}>입력</p>
        <pre>{typeof args.input === "string" ? args.input : ""}</pre>
        <p className={styles.muted}>
          {state === "completed" || state === "error"
            ? "결과"
            : "현재까지 받은 출력 · 완료되지 않음"}
        </p>
        <pre>{output || "아직 출력이 없습니다."}</pre>
      </details>
    </div>
  );
}
function ReportedModel({ model }: { model: RuntimeModel }) {
  return (
    <>
      <dt>Provider</dt>
      <dd>{model.providerId}</dd>
      <dt>모델</dt>
      <dd>{model.id}</dd>
      <dt>Variant</dt>
      <dd>{model.variant ?? "보고 없음"}</dd>
    </>
  );
}
function MessageView({
  role,
  messageId,
  runtime,
  original,
}: {
  role: "user" | "assistant";
  messageId: string;
  runtime: unknown;
  original?: WorkbenchMessage | undefined;
}) {
  const report =
    role === "assistant" && validAssistantRuntime(runtime)
      ? runtime
      : undefined;
  return (
    <MessagePrimitive.Root
      data-message-role={role}
      data-message-id={messageId}
      className={`${styles.message} ${role === "user" ? styles.userMessage : styles.assistantMessage}`}
    >
      <span className={styles.speaker}>
        {role === "user" ? "나" : "도우미"}
      </span>
      <MessagePrimitive.Parts
        components={{
          Text: role === "assistant" ? AssistantText : LiteralText,
          tools: { Fallback: ToolDetail },
        }}
      />
      {original && <ContextMessageActions message={original} />}
      {role === "assistant" && (
        <details
          className={styles.runtimeReport}
          data-response-runtime={messageId}
        >
          <summary>응답이 보고한 실행 정보</summary>
          {report ? (
            <dl>
              <dt>Agent</dt>
              <dd>{report.agent}</dd>
              <ReportedModel model={report.model} />
            </dl>
          ) : (
            <p>이 응답에 실행 정보 보고가 없습니다.</p>
          )}
          <p>이 응답의 보고입니다. 현재 목록과 다를 수 있습니다.</p>
        </details>
      )}
    </MessagePrimitive.Root>
  );
}

export function Conversation(props: Props) {
  const { actions } = useWindowWorkbench();
  const {
    text: draft,
    agent,
    model,
    variant,
    variantCleared,
  } = useWorkbenchSelector(selectors.draft);
  const contextDraft = useWorkbenchSelector(selectors.contextDraft);
  const contextState = useWorkbenchSelector(selectors.conversationContext);
  const contextReady = useWorkbenchSelector(selectors.contextSendReady);
  const branchActive = useWorkbenchSelector((s) =>
    Boolean(s.conversationContext.branch),
  );
  const sessionSetting = useWorkbenchSelector(selectors.currentSessionSetting);
  const invalidSelection = useWorkbenchSelector(
    selectors.requestOptionsInvalid,
  );
  const setAgent = (agent: string) => actions.options({ agent });
  const setModel = (model: string) => actions.options({ model });
  const setVariant = (variant: string) => actions.options({ variant });
  const selectedModel =
    props.catalog?.models.status === "available"
      ? props.catalog.models.entries.find((entry) => entry.id === model)
      : undefined;
  const variants = selectedModel?.variants;
  const agentLabel = agent
    ? props.catalog?.agents.status === "available"
      ? (props.catalog.agents.entries.find((entry) => entry.id === agent)
          ?.name ?? agent)
      : agent
    : "기본 에이전트";
  const modelLabel = model ? (selectedModel?.name ?? model) : "기본 모델";
  const permissionLabel =
    permissionModes.find((m) => m.value === (props.permissionMode ?? "ask"))
      ?.label ?? "요청마다 확인";
  const optionsHeld = Boolean(props.archived);
  const [menu, setMenu] = useState(false);
  const [shortViewport, setShortViewport] = useState(
    () => window.matchMedia("(max-height: 440px)").matches,
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const slashButton = useRef<HTMLButtonElement>(null);
  const commandMenu = useRef<HTMLDivElement>(null);
  const menuOpenedFromInput = useRef(false);
  const commandMenuId = useId();
  const attachId = useId();
  const runId = useId();
  const agentId = useId();
  const modelId = useId();
  const permissionId = useId();
  const gitReview = useWorkbenchSelector(currentGitReviewObservation);
  const branchName =
    gitReview?.status === "available" ? gitReview.repository.branch : null;
  const queueCount = contextState.inbox?.entries.length ?? 0;
  useEffect(() => {
    if (branchActive) setMenu(false);
  }, [branchActive]);
  const composing = useRef(false);
  useEffect(() => {
    const viewport = window.matchMedia("(max-height: 440px)");
    const update = () => setShortViewport(viewport.matches);
    update();
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, []);
  const messages = useMemo(() => mapMessages(props.messages), [props.messages]);
  const running = props.status === "running" || props.status === "stopping";
  // Sending may be blocked by an unknown receipt while interruption is needed.
  const canInterrupt =
    props.executionAvailable &&
    Boolean(props.workspaceId && props.sessionId) &&
    !props.archived &&
    !props.pending &&
    props.status === "running";
  const progress = !props.executionAvailable
    ? "현재 세션 실행 상태를 확인할 수 없습니다."
    : props.archived
      ? "보관된 세션입니다."
      : props.status === "stopping"
        ? "현재 세션 실행 중단을 확인 중입니다."
        : props.status === "running"
          ? "현재 세션 실행 중입니다."
          : props.pending
            ? "요청을 확인 중입니다."
            : props.status === "idle"
              ? "현재 세션은 실행 대기 상태입니다."
              : "현재 세션 실행 상태가 불명확합니다.";
  const blocked =
    branchActive ||
    props.disabled ||
    props.pending ||
    Boolean(props.archived) ||
    invalidSelection ||
    !contextReady;
  const permissions = props.permissions.filter(
    (permission) => permission.sessionId === props.sessionId,
  );
  const toolContext = useMemo(
    () => ({
      permissions,
      openFile: (path: string) => actions.openFiles(path, "file"),
    }),
    // permissions is derived from props each render; memo keys on its sources.
    [props.permissions, props.sessionId, actions],
  );
  const closeMenu = () => {
    setMenu(false);
    if (menuOpenedFromInput.current) input.current?.focus();
    else slashButton.current?.focus();
  };
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: running,
    isSendDisabled: blocked,
    onNew: async (message) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (!text.trim() || blocked) return;
      const requestId = crypto.randomUUID();
      const command = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
      const entry =
        command && props.catalog?.commands.status === "available"
          ? props.catalog.commands.entries.find(
              (item) => item.name === command[1],
            )
          : undefined;

      if (entry && contextDraft.items.length === 0) {
        await props.mutate(
          {
            type: "command.run",
            workspaceId: props.workspaceId,
            sessionId: props.sessionId,
            requestId,
            name: entry.name,
            arguments: command?.[2] ?? "",
          },
          false,
          text,
        );
      } else {
        await actions.sendContextMessage(text);
      }
    },
    onCancel: async () => {
      if (!canInterrupt) return;
      await props.mutate({
        type: "session.interrupt",
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
      });
    },
  });
  useComposerDraft(runtime, props.workspaceId, props.sessionId);
  useDefaultModel(props.workspaceId, props.sessionId);
  const insert = (text: string) => {
    actions.draft(text);
    runtime.thread.composer.setText(text);
    setMenu(false);
    input.current?.focus();
  };
  // Native buttons keep Tab navigation; arrows offer quick command selection.
  const menuButtons = () =>
    Array.from(
      commandMenu.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-command]:not(:disabled)",
      ) ?? [],
    );
  // The browser top layer escapes the Composer scrollport without reflow.
  useLayoutEffect(() => {
    if (!menu) return;
    const panel = commandMenu.current;
    const trigger = slashButton.current;
    if (!panel || !trigger) return;
    panel.showPopover();
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const gutter = 8;
      const gap = 8;
      const width = Math.min(360, window.innerWidth - gutter * 2);
      const above = Math.max(0, anchor.top - gap - gutter);
      const below = Math.max(
        0,
        window.innerHeight - anchor.bottom - gap - gutter,
      );
      const opensAbove = above >= below;
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${Math.min(360, opensAbove ? above : below)}px`;
      const height = panel.getBoundingClientRect().height;
      panel.style.left = `${Math.max(gutter, Math.min(anchor.left, window.innerWidth - width - gutter))}px`;
      panel.style.top = `${opensAbove ? Math.max(gutter, anchor.top - gap - height) : anchor.bottom + gap}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(trigger);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      // A Radix layer above this custom menu owns its own outside dismissal.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return;
      const target = event.target;
      if (
        commandMenu.current?.contains(target) ||
        slashButton.current?.contains(target)
      )
        return;
      const hadMenuFocus = commandMenu.current?.contains(
        document.activeElement,
      );
      setMenu(false);
      if (hadMenuFocus) {
        requestAnimationFrame(() => {
          if (
            !document.activeElement ||
            document.activeElement === document.body
          ) {
            if (menuOpenedFromInput.current) input.current?.focus();
            else slashButton.current?.focus();
          }
        });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  return (
    <ToolContext.Provider value={toolContext}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root
          className={`conversation ${styles.conversation} ${messages.length === 0 ? styles.emptyConversation : ""}`}
        >
          <ThreadPrimitive.Viewport
            className={`transcript ${styles.transcript}`}
          >
            <span
              className={styles.speaker}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {progress}
            </span>
            {/* Only the short status announces changes, never tokens or history. */}
            <div
              className={styles.readingColumn}
              role="log"
              aria-label="현재 세션 대화 기록"
              aria-live="off"
              aria-atomic="false"
              aria-relevant="additions"
              aria-busy={running}
            >
              {props.messages.length > 300 && (
                <p className={styles.muted}>최근 300개 메시지를 표시합니다.</p>
              )}
              <ThreadPrimitive.Messages>
                {({ message }) => (
                  <MessageView
                    key={message.id}
                    role={message.role === "user" ? "user" : "assistant"}
                    messageId={message.id}
                    runtime={message.metadata?.custom.runtime}
                    original={props.messages.find((m) => m.id === message.id)}
                  />
                )}
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Viewport>
          <div className={`compose-region ${styles.composeRegion}`}>
            {messages.length === 0 && (
              <div className={styles.empty}>
                <h1>무엇을 만들까요?</h1>
              </div>
            )}
            {props.archived && (
              <p className={styles.muted} role="status">
                보관된 세션입니다. 대화를 계속하려면 세션을 복원하세요.
              </p>
            )}
            {permissions.length > 0 && (
              <div
                className={styles.permissionQueue}
                aria-label="대기 중인 권한 요청"
              >
                {permissions.map((permission) => (
                  <section
                    className={styles.permission}
                    aria-label="실행 권한 요청"
                    data-permission-id={permission.id}
                    key={permission.id}
                  >
                    <strong className={styles.permissionTitle}>
                      {permission.childTitle !== undefined &&
                        `하위 에이전트 · ${permission.childTitle} · `}
                      {permission.title}
                    </strong>
                    <p className={styles.permissionDetail}>
                      {permission.detail}
                    </p>
                    <p className={styles.muted}>
                      거절하면 이 세션의 다른 대기 중 권한 요청도 취소됩니다.
                    </p>
                    <div className={styles.actions}>
                      <Button
                        intent="primary"
                        type="button"
                        className={styles.permissionAllow}
                        disabled={props.pending || props.disabled}
                        onClick={() =>
                          void props.mutate({
                            type: "permission.respond",
                            workspaceId: props.workspaceId,
                            sessionId: props.sessionId,
                            requestId: permission.id,
                            decision: "once",
                          })
                        }
                      >
                        이번만 허용
                      </Button>
                      <Button
                        type="button"
                        disabled={props.pending || props.disabled}
                        onClick={() =>
                          void props.mutate({
                            type: "permission.respond",
                            workspaceId: props.workspaceId,
                            sessionId: props.sessionId,
                            requestId: permission.id,
                            decision: "always",
                          })
                        }
                      >
                        이 프로젝트에서 항상 허용
                      </Button>
                      <Button
                        type="button"
                        disabled={props.pending || props.disabled}
                        onClick={() =>
                          void props.mutate({
                            type: "permission.respond",
                            workspaceId: props.workspaceId,
                            sessionId: props.sessionId,
                            requestId: permission.id,
                            decision: "reject",
                          })
                        }
                      >
                        거절
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            )}
            <ConversationContextControls
              attachPanel={(body) => (
                <PopoverPanel
                  id={attachId}
                  anchor="--attach"
                  align="start"
                  className={styles.popover}
                  label="파일 첨부와 미리보기"
                  onToggle={(open) => {
                    if (!open) actions.closeContextPreview();
                  }}
                >
                  {body}
                </PopoverPanel>
              )}
              runPanel={(body) =>
                (running || queueCount > 0) && (
                  <PopoverPanel
                    id={runId}
                    anchor="--run"
                    align="start"
                    className={styles.popover}
                    label="현재 실행 · 추가 지시와 대기열"
                  >
                    {body}
                  </PopoverPanel>
                )
              }
            />
            <div className={styles.composerCard} hidden={branchActive}>
              {(props.workspaceName || branchName) && (
                <div className={styles.contextStrip} data-composer-context>
                  {props.workspaceName && (
                    <span title={props.workspaceName}>
                      <Folder size={14} aria-hidden="true" />
                      {props.workspaceName}
                    </span>
                  )}
                  {branchName && (
                    <span title={branchName}>
                      <GitBranch size={14} aria-hidden="true" />
                      {branchName}
                    </span>
                  )}
                </div>
              )}
              {(running || queueCount > 0) && (
                <div className={styles.runStrip} data-run-strip>
                  <span className={styles.runStatus}>
                    {props.status === "stopping"
                      ? "중단하는 중"
                      : running
                        ? "실행 중"
                        : "실행 대기"}
                    {queueCount > 0 && ` · 대기열 ${queueCount}`}
                  </span>
                  <PopoverTrigger
                    id={runId}
                    anchor="--run"
                    className={styles.runAction}
                    aria-label="현재 실행 · 추가 지시와 대기열"
                  >
                    추가 지시와 대기열
                  </PopoverTrigger>
                </div>
              )}
              <ComposerPrimitive.Root
                className={styles.composer}
                hidden={branchActive}
                data-composer-state={
                  branchActive ? "branch-retained" : "message"
                }
              >
                <ComposerPrimitive.Input
                  ref={input}
                  onChange={(event) => actions.draft(event.target.value)}
                  className={styles.input}
                  aria-label="메시지 작성"
                  aria-controls={menu ? commandMenuId : undefined}
                  readOnly={Boolean(props.archived)}
                  placeholder="작업을 요청하세요. /로 명령 보기"
                  maxLength={32000}
                  minRows={3}
                  maxRows={shortViewport ? 3 : 6}
                  submitMode="enter"
                  cancelOnEscape={false}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (composing.current ||
                        event.nativeEvent.isComposing ||
                        event.keyCode === 229)
                    ) {
                      event.preventDefault();
                      return;
                    }
                    if (
                      composing.current ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    )
                      return;
                    if (event.key === "Escape" && menu) {
                      event.preventDefault();
                      closeMenu();
                    }
                    if (
                      menu &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      const buttons = menuButtons();
                      const button =
                        event.key === "ArrowDown" ? buttons[0] : buttons.at(-1);
                      if (button) {
                        event.preventDefault();
                        button.focus();
                      }
                    }
                    if (event.key === "/" && !draft) {
                      menuOpenedFromInput.current = true;
                      setMenu(true);
                    }
                  }}
                />
                {menu && (
                  <div
                    className={`slash-menu ${styles.commandMenu}`}
                    id={commandMenuId}
                    ref={commandMenu}
                    popover="manual"
                    role="region"
                    aria-label="앱 동작 및 런타임 명령"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeMenu();
                      }
                      if (
                        ["ArrowDown", "ArrowUp", "Home", "End"].includes(
                          event.key,
                        )
                      ) {
                        const buttons = menuButtons();
                        if (!buttons.length) return;
                        event.preventDefault();
                        const index = buttons.indexOf(
                          event.target as HTMLButtonElement,
                        );
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? buttons.length - 1
                              : (index +
                                  (event.key === "ArrowUp" ? -1 : 1) +
                                  buttons.length) %
                                buttons.length;
                        buttons[next]?.focus();
                      }
                    }}
                  >
                    <div className={styles.menuHeading}>
                      <strong>앱 동작</strong>
                      <Button
                        type="button"
                        onClick={closeMenu}
                        aria-label="명령 목록 닫기"
                      >
                        <X size={18} aria-hidden="true" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      data-command
                      disabled={
                        props.newSessionDisabled || props.pending || running
                      }
                      onClick={() => {
                        closeMenu();
                        props.newSession();
                      }}
                    >
                      새 세션 만들기
                    </Button>
                    <Button
                      type="button"
                      data-command
                      onClick={() => {
                        closeMenu();
                        props.openPanel("files");
                      }}
                    >
                      파일 보기
                    </Button>
                    <Button
                      type="button"
                      data-command
                      onClick={() => {
                        closeMenu();
                        props.openPanel("catalog");
                      }}
                    >
                      확장 목록 보기
                    </Button>
                    <strong>런타임 명령</strong>
                    {props.catalog?.commands.status === "available" ? (
                      props.catalog.commands.entries.length ? (
                        props.catalog.commands.entries.map((entry) => (
                          <Button
                            type="button"
                            data-command
                            key={entry.id}
                            onClick={() => insert(`/${entry.name} `)}
                          >
                            <span>/{entry.name}</span>
                            <small>{entry.description}</small>
                          </Button>
                        ))
                      ) : (
                        <p>등록된 명령이 없습니다.</p>
                      )
                    ) : (
                      <p>명령 목록을 사용할 수 없습니다.</p>
                    )}
                    <strong>스킬 언급</strong>
                    <p className={styles.muted}>
                      메시지에 스킬 이름을 추가합니다.
                    </p>
                    {props.catalog?.skills.status === "available" ? (
                      props.catalog.skills.entries.length ? (
                        props.catalog.skills.entries.map((entry) => (
                          <Button
                            type="button"
                            data-command
                            key={entry.id}
                            onClick={() =>
                              insert(
                                `${draft === "/" ? "" : draft}${draft && draft !== "/" ? "\n" : ""}스킬 ${entry.name}을 참고해 주세요. `,
                              )
                            }
                          >
                            {entry.name}
                          </Button>
                        ))
                      ) : (
                        <p>등록된 스킬이 없습니다.</p>
                      )
                    ) : (
                      <p>스킬 목록을 사용할 수 없습니다.</p>
                    )}
                  </div>
                )}
                <div className={styles.toolbar}>
                  <PopoverTrigger
                    id={attachId}
                    anchor="--attach"
                    className={styles.roundButton}
                    title="파일 첨부와 미리보기"
                    aria-label={`파일 첨부와 미리보기${contextDraft.items.length ? ` (${contextDraft.items.length})` : ""}`}
                  >
                    <Plus size={20} aria-hidden="true" />
                  </PopoverTrigger>
                  <Button
                    type="button"
                    className={styles.slashTrigger}
                    title="앱 동작과 명령"
                    ref={slashButton}
                    aria-label="앱 동작과 명령 열기"
                    aria-expanded={menu}
                    aria-controls={commandMenuId}
                    onClick={() => {
                      if (menu) closeMenu();
                      else {
                        menuOpenedFromInput.current = false;
                        setMenu(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && menu) {
                        event.preventDefault();
                        event.stopPropagation();
                        closeMenu();
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        menuOpenedFromInput.current = false;
                        setMenu(true);
                        requestAnimationFrame(() => menuButtons()[0]?.focus());
                      }
                    }}
                  >
                    <Slash size={18} aria-hidden="true" />
                  </Button>
                  <div className={styles.chips}>
                    <PopoverTrigger
                      id={agentId}
                      anchor="--agent"
                      className={styles.chip}
                      aria-label={`Agent: ${agentLabel}`}
                    >
                      <span className={styles.agentDot} aria-hidden="true" />
                      <span className={styles.chipText}>{agentLabel}</span>
                    </PopoverTrigger>
                    <PopoverTrigger
                      id={modelId}
                      anchor="--model"
                      className={styles.chip}
                      aria-label={`모델: ${modelLabel}${variant ? ` · ${variant}` : ""}`}
                    >
                      <span className={styles.chipText}>{modelLabel}</span>
                      {variant && (
                        <span className={styles.chipSecondary}>{variant}</span>
                      )}
                    </PopoverTrigger>
                    <PopoverTrigger
                      id={permissionId}
                      anchor="--permission"
                      className={styles.chip}
                      aria-label={`권한 모드: ${permissionLabel}`}
                    >
                      <Shield size={14} aria-hidden="true" />
                      <span className={styles.chipText}>{permissionLabel}</span>
                    </PopoverTrigger>
                  </div>
                  {running ? (
                    <ComposerPrimitive.Cancel
                      disabled={!canInterrupt}
                      className={styles.primary}
                      aria-label="현재 세션 실행 중단"
                    >
                      <Square
                        size={16}
                        fill="currentColor"
                        aria-hidden="true"
                      />
                    </ComposerPrimitive.Cancel>
                  ) : (
                    <ComposerPrimitive.Send
                      className={styles.primary}
                      title="전송 (Enter) · 줄바꿈 Shift+Enter"
                      aria-label="메시지 보내기"
                      disabled={blocked}
                    >
                      <ArrowUp size={18} aria-hidden="true" />
                    </ComposerPrimitive.Send>
                  )}
                </div>
              </ComposerPrimitive.Root>
              {/* Popovers live outside the form so Enter in their fields never sends. */}
              <PopoverPanel
                id={agentId}
                anchor="--agent"
                className={styles.popover}
                label="Agent 선택"
              >
                <fieldset
                  className={styles.runtimeRequests}
                  disabled={optionsHeld}
                  data-runtime-source="requested"
                >
                  <legend>Agent</legend>
                  <label className={styles.field}>
                    Agent 요청
                    <select
                      className={styles.select}
                      aria-label="Agent 요청"
                      value={agent}
                      onChange={(event) => setAgent(event.target.value)}
                    >
                      <option value="">기본값 · 요청 안 함</option>
                      {agent &&
                        !props.catalog?.agents.entries.some(
                          (entry) => entry.id === agent,
                        ) && <option value={agent}>{agent} (사용 불가)</option>}
                      {props.catalog?.agents.status === "available" &&
                        props.catalog.agents.entries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className={styles.runtimeHint}>
                    선택은 다음 전송에만 요청합니다. 기본값은 값을 요청하지
                    않습니다.
                  </p>
                </fieldset>
              </PopoverPanel>
              <PopoverPanel
                id={modelId}
                anchor="--model"
                className={styles.popover}
                label="모델 선택"
              >
                <fieldset
                  className={styles.runtimeRequests}
                  disabled={optionsHeld}
                  data-runtime-source="requested"
                >
                  <legend>모델</legend>
                  <label className={styles.field}>
                    모델 요청
                    <select
                      className={styles.select}
                      aria-label="모델 요청"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    >
                      <option value="">기본값 · 요청 안 함</option>
                      {model && !selectedModel && (
                        <option value={model}>{model} (사용 불가)</option>
                      )}
                      {props.catalog?.models.status === "available" &&
                        props.catalog.models.entries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Variant 요청
                    <select
                      className={styles.select}
                      aria-label="Variant 요청"
                      value={variant}
                      disabled={!model && !variant}
                      onChange={(event) => setVariant(event.target.value)}
                    >
                      <option value="">기본값 · 요청 안 함</option>
                      {variant &&
                        (variants?.status !== "available" ||
                          !variants.ids.includes(variant)) && (
                          <option value={variant}>{variant} (사용 불가)</option>
                        )}
                      {variants?.status === "available" &&
                        variants.ids.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className={styles.runtimeHint}>
                    선택은 다음 전송에만 요청합니다. 기본값은 값을 요청하지
                    않습니다.
                  </p>
                  {model && variants?.status !== "available" && (
                    <p className={styles.runtimeHint}>
                      Variant 목록을 확인할 수 없습니다. Variant 요청 없이
                      모델을 사용할 수 있습니다.
                    </p>
                  )}
                  {variantCleared && (
                    <p
                      className={styles.runtimeHint}
                      role="status"
                      data-variant-cleared="true"
                    >
                      모델을 바꿔 이전 Variant 요청을 지웠습니다.
                    </p>
                  )}
                </fieldset>
                <p className={styles.sessionLine} data-runtime-source="session">
                  {sessionSetting
                    ? `현재 세션: ${sessionSetting.agent ?? "Agent 보고 없음"} · ${
                        sessionSetting.model
                          ? `${sessionSetting.model.providerId}/${sessionSetting.model.id}${
                              sessionSetting.model.variant
                                ? ` (${sessionSetting.model.variant})`
                                : ""
                            }`
                          : "모델 보고 없음"
                      } · Native 보고이며 다음 요청과 다를 수 있습니다.`
                    : "현재 세션: 설정 보고가 없습니다."}
                </p>
              </PopoverPanel>
              <PopoverPanel
                id={permissionId}
                anchor="--permission"
                className={styles.popover}
                label="권한 모드"
              >
                <div
                  role="radiogroup"
                  aria-label="권한 모드"
                  className={styles.permissionModes}
                >
                  {permissionModes.map((option) => (
                    <label
                      key={option.value}
                      className={styles.permissionOption}
                    >
                      <input
                        type="radio"
                        name={permissionId}
                        value={option.value}
                        checked={
                          (props.permissionMode ?? "ask") === option.value
                        }
                        disabled={props.pending || props.disabled}
                        onChange={() =>
                          void props.mutate({
                            type: "permission.mode.set",
                            workspaceId: props.workspaceId,
                            sessionId: props.sessionId,
                            requestId: crypto.randomUUID(),
                            mode: option.value,
                          })
                        }
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <p className={styles.runtimeHint}>
                  다음 요청부터 적용됩니다. 대기 중인 요청은 바뀌지 않습니다.
                </p>
                <PermissionPolicy className={styles.runtimeReport} />
              </PopoverPanel>
            </div>
            {invalidSelection && (
              <p className={styles.selectionError} role="alert">
                선택한 Agent, 모델 또는 Variant를 사용할 수 없습니다. 다시
                선택하거나 요청 안 함을 선택하세요.
              </p>
            )}
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </ToolContext.Provider>
  );
}
