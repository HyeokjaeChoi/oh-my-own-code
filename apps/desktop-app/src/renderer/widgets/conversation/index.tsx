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
  type ReactNode,
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
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Plus,
  Shield,
  ListTodo,
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
import {
  OutputPre,
  ToolBody,
  ToolContext,
  toolSummary,
  useToolContext,
} from "./tool-views.js";
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
import { openSettingsPage } from "../../shared/palette/index.js";
import {
  FirstRunCard,
  useProviderList,
} from "../../features/onboarding/index.js";
import {
  clearModelUnavailable,
  findFreeRouter,
  turnFailure,
  loadUnavailableModels,
  retryablePrompt,
  markModelUnavailable,
  showFirstRun,
} from "../../shared/providers/index.js";
import styles from "./conversation.module.css";
import { PopoverPanel, PopoverTrigger } from "./composer-popovers.js";
import { ModelPicker } from "./model-picker.js";
import { AssistantText, CopyButton, LiteralText } from "./markdown.js";
import { parseSafeLinkPreview } from "@workbench/contracts";
import { Button, LinkPreview, Notice, Select } from "@workbench/ui";
import {
  type WorkbenchCatalog,
  type WorkbenchMessage,
  type WorkbenchPermission,
  validAssistantRuntime,
  variantLabel,
  defaultModelText,
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
  workspacePath?: string | undefined;
  permissionMode?: "ask" | "scoped_edit" | "read_plan";
  pending: boolean;
  mutate(
    _operation: MutationRequest,
    _navigate?: boolean,
    _submittedText?: string,
  ): Promise<boolean>;
  openPanel(_panel: "files" | "extensions"): void;
  newSession(): void;
};
/* eslint-enable no-unused-vars */
const shortcutKey =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";
const permissionModes = [
  {
    value: "ask",
    label: "요청마다 확인",
    detail: "편집과 명령 실행 전에 매번 묻습니다",
    risk: "neutral",
  },
  {
    value: "scoped_edit",
    label: "범위 내 편집 허용",
    detail: "작업 공간 안의 파일 편집은 묻지 않습니다",
    risk: "warning",
  },
  {
    value: "read_plan",
    label: "읽기/계획",
    detail: "읽기만 하고 아무것도 바꾸지 않습니다",
    risk: "neutral",
  },
] as const;
const labels: Record<string, string> = {
  pending: "대기 중",
  running: "실행 중",
  completed: "완료",
  error: "오류",
  "needs-permission": "권한 대기",
};
const permissionHeadings: Record<string, string> = {
  edit: "파일 편집",
  write: "파일 쓰기",
  patch: "패치 적용",
  apply_patch: "패치 적용",
  bash: "명령 실행",
  shell: "명령 실행",
  read: "파일 읽기",
  glob: "파일 검색",
  grep: "파일 검색",
  list: "폴더 보기",
  webfetch: "웹 요청",
  websearch: "웹 검색",
  subagent: "하위 에이전트 실행",
  task: "하위 에이전트 실행",
  external_directory: "작업 공간 밖 접근",
};
// Plain sentence for a raw tool/action name; readable titles pass through.
function permissionHeading(title: string) {
  const known = permissionHeadings[title];
  if (known) return `${known} 허용이 필요합니다`;
  return /^[a-z][a-z0-9_.-]*$/.test(title)
    ? `${title} 실행 허용이 필요합니다`
    : title;
}
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
  const summary = toolSummary(view, toolName, ctx.workspaceRoot);
  const status = labels[state] ?? "상태 확인 불가";
  return (
    <div className={`tool-detail ${styles.toolDetail}`} data-tool-state={state}>
      <details
        className={styles.toolCall}
        // Anything that needs attention is never hidden behind a collapsed row.
        open={
          pendingPermissions.length > 0 ||
          state === "error" ||
          (subagent !== null && state === "completed")
            ? true
            : undefined
        }
      >
        <summary className={styles.disclosure}>
          <ChevronRight
            size={14}
            className={styles.chevron}
            aria-hidden="true"
          />
          <span className={styles.summaryText}>{summary}</span>
          {pendingPermissions[0] ? (
            <button
              type="button"
              className={`${styles.summaryState} ${styles.summaryStateLink}`}
              aria-label="권한 요청으로 이동"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const card = document.querySelector<HTMLElement>(
                  `[data-permission-id="${CSS.escape(pendingPermissions[0]!.id)}"]`,
                );
                card?.scrollIntoView({ block: "center" });
                card?.focus();
              }}
            >
              {status}
            </button>
          ) : (
            state !== "completed" && (
              <span className={styles.summaryState}>{status}</span>
            )
          )}
        </summary>
        {state !== "completed" && state !== "needs-permission" && (
          <div className={`tool-heading ${styles.toolHeading}`}>
            <strong>{toolName}</strong>
            <span>{status}</span>
          </div>
        )}
        <ToolBody view={view} />
        {subagent && state === "completed" ? (
          <div className="subagent-result">
            <p className={styles.muted}>
              하위 작업 최종 응답 ({subagent.sessionId})
            </p>
            <OutputPre>{subagent.text}</OutputPre>
          </div>
        ) : null}
        {view.kind === "generic" && (
          <>
            <p className={styles.muted}>입력</p>
            <OutputPre>
              {typeof args.input === "string" ? args.input : ""}
            </OutputPre>
            <p className={styles.muted}>
              {state === "completed" || state === "error"
                ? "결과"
                : "현재까지 받은 출력 · 완료되지 않음"}
            </p>
            <OutputPre>{output || "아직 출력이 없습니다."}</OutputPre>
          </>
        )}
      </details>
      {preview ? (
        <LinkPreview
          {...preview}
          interactive={false}
          locale="ko-KR"
          className={styles.linkPreview ?? ""}
        />
      ) : null}
    </div>
  );
}
// Ticks on its own, so the composer does not re-render every second. The run
// start is not reported, so it counts from when this strip appeared.
function RunElapsed({ sessionId }: { sessionId: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    setSeconds(0);
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [sessionId]);
  return (
    <>
      {" · "}
      {seconds >= 60
        ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
        : `${seconds}초`}
    </>
  );
}
// One sentence for a failed turn on a free model, plus the way out. The retry
// button only appears where it is useful (latest turn, router available).
function FreeFailureNote({
  kind,
  onRetry,
}: {
  kind: "unavailable" | "limit" | "auth" | "refused" | "server";
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className={styles.freeFailure} role="alert" data-free-failure={kind}>
      <p>
        {kind === "unavailable"
          ? "이 모델은 지금 무료로 쓸 수 없습니다."
          : kind === "limit"
            ? "무료 사용 한도에 걸렸습니다. 잠시 후 다시 시도하거나 다른 모델을 고르세요."
            : kind === "auth"
              ? "제공자가 요청을 거부했습니다. 키 또는 요금제를 확인하세요."
              : kind === "refused"
                ? "제공자가 이 요청을 거절했습니다."
                : "제공자 응답 오류입니다. 잠시 후 다시 시도하세요."}
      </p>
      {kind === "auth" && (
        <Button
          size="compact"
          type="button"
          onClick={() => openSettingsPage("models")}
        >
          설정 열기
        </Button>
      )}
      {onRetry && (
        <Button size="compact" type="button" onClick={onRetry}>
          Free Models Router로 다시 보내기
        </Button>
      )}
    </div>
  );
}

function MessageView({
  role,
  messageId,
  runtime,
  original,
  showRuntime,
  running,
  failure,
}: {
  role: "user" | "assistant";
  messageId: string;
  runtime: unknown;
  original?: WorkbenchMessage | undefined;
  showRuntime: boolean;
  running: boolean;
  failure?: ReactNode;
}) {
  const report =
    role === "assistant" && validAssistantRuntime(runtime)
      ? runtime
      : undefined;
  // Copy the same bounded text the transcript displays.
  const text = useMemo(() => {
    const content = original ? mapMessages([original])[0]?.content : undefined;
    const part = Array.isArray(content) ? content[0] : undefined;
    return part && part.type === "text" ? part.text : "";
  }, [original]);
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
      {failure}
      <div className={styles.messageFooter}>
        <div
          className={styles.messageToolbar}
          role="group"
          aria-label="메시지 동작"
        >
          {text && <CopyButton text={text} kind="message" />}
          {original && <ContextMessageActions message={original} />}
        </div>
        {role === "assistant" && showRuntime && (report || !running) && (
          <span
            className={styles.turnMeta}
            data-abnormal={report ? undefined : "true"}
            data-response-runtime={messageId}
            title={
              report
                ? `에이전트 ${report.agent} · ${report.model.providerId}/${report.model.id}${report.model.variant ? ` · ${report.model.variant}` : ""} · 이 응답의 보고입니다. 현재 목록과 다를 수 있습니다.`
                : "이 응답에 실행 정보 보고가 없습니다."
            }
          >
            {report
              ? `${report.agent} · ${report.model.id}${report.model.variant ? ` · ${report.model.variant}` : ""}`
              : "실행 정보 없음"}
          </span>
        )}
      </div>
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
  const modelEntries =
    props.catalog?.models.status === "available"
      ? props.catalog.models.entries
      : [];
  const agentName = (id: string) =>
    props.catalog?.agents.status === "available"
      ? (props.catalog.agents.entries.find((entry) => entry.id === id)?.name ??
        id)
      : id;
  // The session's own report names what "default" resolved to, when known.
  const reportedModel = sessionSetting?.model
    ? modelEntries.find(
        (entry) =>
          entry.providerId === sessionSetting.model?.providerId &&
          entry.modelId === sessionSetting.model?.id,
      )
    : undefined;
  const agentLabel = agent
    ? agentName(agent)
    : sessionSetting?.agent
      ? agentName(sessionSetting.agent)
      : "기본 에이전트";
  const reportedModelName = reportedModel?.name ?? sessionSetting?.model?.id;
  const modelLabel = model
    ? (selectedModel?.name ?? model)
    : defaultModelText(reportedModelName).chip;
  // Requested for the next send vs reported by the session: a difference is
  // shown as a dot on the chip with the detail in its tooltip.
  const modelMismatch =
    Boolean(model && selectedModel && sessionSetting?.model) &&
    (selectedModel?.providerId !== sessionSetting?.model?.providerId ||
      selectedModel?.modelId !== sessionSetting?.model?.id);
  const variantMismatch =
    Boolean(variant && sessionSetting?.model) &&
    sessionSetting?.model?.variant !== variant;
  const modelDetail =
    modelMismatch || variantMismatch
      ? `현재 세션 보고: ${reportedModelName ?? "모델 보고 없음"}${
          sessionSetting?.model?.variant
            ? ` (${sessionSetting.model.variant})`
            : ""
        } · 다음 전송 요청: ${modelLabel}${variant ? ` (${variant})` : ""}`
      : "";
  const agentMismatch = Boolean(
    agent && sessionSetting?.agent && agent !== sessionSetting.agent,
  );
  const agentDetail = agentMismatch
    ? `현재 세션 보고: ${agentName(sessionSetting?.agent ?? "")} · 다음 전송 요청: ${agentLabel}`
    : "";
  const permissionOption =
    permissionModes.find((m) => m.value === (props.permissionMode ?? "ask")) ??
    permissionModes[0];
  const permissionLabel = permissionOption.label;
  const optionsHeld = Boolean(props.archived);
  const [menu, setMenu] = useState(false);
  const [shortViewport, setShortViewport] = useState(
    () => window.matchMedia("(max-height: 440px)").matches,
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const commandMenu = useRef<HTMLDivElement>(null);
  const commandMenuId = useId();
  const hintId = useId();
  const attachId = useId();
  const runId = useId();
  const agentId = useId();
  const modelId = useId();
  const [modelOpen, setModelOpen] = useState(false);
  const permissionId = useId();
  const gitReview = useWorkbenchSelector(currentGitReviewObservation);
  const branchName =
    gitReview?.status === "available" ? gitReview.repository.branch : null;
  const policyRequest = useWorkbenchSelector(
    selectors.permissionPolicy,
  ).request;
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
  const providerList = useProviderList();
  // The card outlives its own trigger: connecting flips the list to connected.
  const [cardHeld, setCardHeld] = useState(false);
  useEffect(() => setCardHeld(false), [props.sessionId]);
  const firstRun =
    showFirstRun(providerList, messages.length) ||
    (cardHeld && messages.length === 0);
  // The standing alert waits for the provider list (no flash) and yields to the first-run card.
  const noModelsShown =
    providerList !== undefined &&
    !firstRun &&
    props.catalog?.models.status === "available" &&
    props.catalog.models.entries.length === 0;
  const [unavailable, setUnavailable] = useState(loadUnavailableModels);
  // Free-model failures come from the structured HTTP status of the turn.
  const failures = useMemo(() => {
    const found = new Map<
      string,
      {
        kind: "unavailable" | "limit" | "auth" | "refused" | "server";
        id?: string;
      }
    >();
    const entries =
      props.catalog?.models.status === "available"
        ? props.catalog.models.entries
        : [];
    for (const message of props.messages) {
      const failed =
        message.role === "assistant" && message.failure
          ? turnFailure(entries, message.runtime?.model, message.failure)
          : undefined;
      if (failed) found.set(message.id, failed);
    }
    return found;
  }, [props.messages, props.catalog]);
  // Only the latest turn counts: a 404 marks its model, a later success on a
  // marked model clears it (older failures in the history stay history).
  useEffect(() => {
    const last = props.messages.at(-1);
    if (last?.role !== "assistant") return;
    let next = unavailable;
    const failed = failures.get(last.id);
    if (failed) {
      if (
        failed.kind === "unavailable" &&
        failed.id &&
        !next.includes(failed.id)
      )
        next = markModelUnavailable(failed.id);
    } else if (
      !last.failure &&
      last.runtime &&
      props.catalog?.models.status === "available"
    ) {
      const entry = props.catalog.models.entries.find(
        (e) =>
          e.providerId === last.runtime?.model.providerId &&
          e.modelId === last.runtime?.model.id,
      );
      if (entry && next.includes(entry.id))
        next = clearModelUnavailable(entry.id);
    }
    if (next !== unavailable) setUnavailable(next);
  }, [failures, unavailable, props.messages, props.catalog]);
  const freeRouter = findFreeRouter(props.catalog?.models);
  const retrying = useRef(false);
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
      workspaceRoot: props.workspacePath,
      openFile: (path: string) => actions.openFiles(path, "file"),
    }),
    // permissions is derived from props each render; memo keys on its sources.
    [props.permissions, props.sessionId, props.workspacePath, actions],
  );
  const closeMenu = () => {
    setMenu(false);
    input.current?.focus();
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
    const trigger = input.current;
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
      if (commandMenu.current?.contains(target)) return;
      const hadMenuFocus = commandMenu.current?.contains(
        document.activeElement,
      );
      setMenu(false);
      if (hadMenuFocus) {
        requestAnimationFrame(() => {
          if (
            !document.activeElement ||
            document.activeElement === document.body
          )
            input.current?.focus();
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
                    // Agent/model once per turn: on the last assistant message.
                    running={running}
                    failure={(() => {
                      const failed = failures.get(message.id);
                      if (!failed) return undefined;
                      const index = props.messages.findIndex(
                        (m) => m.id === message.id,
                      );
                      const prompt = retryablePrompt(props.messages[index - 1]);
                      const canRetry =
                        (failed.kind === "unavailable" ||
                          failed.kind === "limit") &&
                        freeRouter &&
                        prompt &&
                        index === props.messages.length - 1 &&
                        !blocked &&
                        freeRouter.id !== failed.id;
                      return (
                        <FreeFailureNote
                          kind={failed.kind}
                          onRetry={
                            canRetry
                              ? () => {
                                  if (retrying.current) return;
                                  retrying.current = true;
                                  actions.options({ model: freeRouter.id });
                                  void actions
                                    .resendMessage(
                                      prompt,
                                      freeRouter.id,
                                      agent || undefined,
                                    )
                                    .finally(() => {
                                      retrying.current = false;
                                    });
                                }
                              : undefined
                          }
                        />
                      );
                    })()}
                    showRuntime={
                      props.messages[
                        props.messages.findIndex((m) => m.id === message.id) + 1
                      ]?.role !== "assistant"
                    }
                  />
                )}
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Viewport>
          <div className={`compose-region ${styles.composeRegion}`}>
            {messages.length === 0 && (
              <div className={styles.empty}>
                <h1>무엇을 만들까요?</h1>
                <p>
                  신용카드 없이, 어떤 모델로든 — 한국어로 쓰는 코딩 에이전트.
                </p>
                {firstRun && (
                  <FirstRunCard onVerified={() => setCardHeld(true)} />
                )}
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
                    tabIndex={-1}
                    key={permission.id}
                  >
                    <strong
                      className={styles.permissionTitle}
                      title={permission.title}
                    >
                      {permission.childTitle !== undefined &&
                        `하위 에이전트 · ${permission.childTitle} · `}
                      {permissionHeading(permission.title)}
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
              noModelsShown={noModelsShown}
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
              runPanel={(body) => (
                <PopoverPanel
                  id={runId}
                  anchor="--run"
                  align="start"
                  className={styles.popover}
                  label="현재 실행 · 추가 지시와 대기열"
                >
                  {body}
                </PopoverPanel>
              )}
            />
            {/* Always reserved, so the composer never moves between idle and running. */}
            <div className={styles.runSlot} hidden={branchActive}>
              {(running || queueCount > 0) && (
                <div className={styles.runStrip} data-run-strip>
                  {running && (
                    <span className={styles.runDot} aria-hidden="true" />
                  )}
                  <span className={styles.runStatus}>
                    {props.status === "stopping"
                      ? "중단하는 중"
                      : running
                        ? "실행 중"
                        : "대기열 (마지막 확인)"}
                    {running && <RunElapsed sessionId={props.sessionId} />}
                    {queueCount > 0 &&
                      (running ? ` · 대기열 ${queueCount}` : ` ${queueCount}`)}
                  </span>
                </div>
              )}
            </div>
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
              <span id={hintId} className={styles.speaker}>
                Enter 전송 · Shift+Enter 줄바꿈 · 에이전트: {agent || "기본값"}{" "}
                · 모델: {model || "기본값"} · 추론 강도: {variant || "기본값"}
              </span>
              <ComposerPrimitive.Root
                className={styles.composer}
                aria-describedby={hintId}
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
                  placeholder={`작업을 요청하세요. / 또는 ${shortcutKey}/로 명령 보기`}
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
                    // "/" in an empty composer, or ⌘/ (Ctrl+/) with any draft.
                    if (event.key === "/" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      setMenu(true);
                    } else if (event.key === "/" && !draft) setMenu(true);
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
                        props.openPanel("extensions");
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
                            onClick={() =>
                              // A draft already typed becomes the command's arguments.
                              insert(
                                `/${entry.name} ${draft === "/" ? "" : draft}`,
                              )
                            }
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
                    <Plus size={16} aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverTrigger
                    id={runId}
                    anchor="--run"
                    className={styles.roundButton}
                    title="현재 실행 · 추가 지시와 대기열"
                    aria-label="현재 실행 · 추가 지시와 대기열"
                  >
                    <ListTodo size={16} aria-hidden="true" />
                  </PopoverTrigger>
                  <div className={styles.chips}>
                    <PopoverTrigger
                      id={agentId}
                      anchor="--agent"
                      className={styles.chip}
                      aria-label={`Agent: ${agentLabel}`}
                      {...(agentDetail ? { title: agentDetail } : {})}
                    >
                      <span className={styles.chipText}>{agentLabel}</span>
                      {agentDetail && (
                        <span
                          className={styles.mismatchDot}
                          data-runtime-mismatch="agent"
                          aria-hidden="true"
                        />
                      )}
                      <ChevronDown
                        size={12}
                        className={styles.chipChevron}
                        aria-hidden="true"
                      />
                    </PopoverTrigger>
                    <PopoverTrigger
                      id={modelId}
                      anchor="--model"
                      className={styles.chip}
                      aria-label={`모델: ${modelLabel}${variant ? ` · ${variantLabel(variant)}` : ""}${modelDetail ? ` — ${modelDetail}` : ""}`}
                      {...(modelDetail ? { title: modelDetail } : {})}
                    >
                      <span className={styles.chipText}>{modelLabel}</span>
                      {variant && (
                        <span className={styles.chipSecondary}>
                          {variantLabel(variant)}
                        </span>
                      )}
                      {modelDetail && (
                        <span
                          className={styles.mismatchDot}
                          data-runtime-mismatch="model"
                          aria-hidden="true"
                        />
                      )}
                      <ChevronDown
                        size={12}
                        className={styles.chipChevron}
                        aria-hidden="true"
                      />
                    </PopoverTrigger>
                    <PopoverTrigger
                      id={permissionId}
                      anchor="--permission"
                      className={styles.chip}
                      data-risk={permissionOption.risk}
                      aria-label={`권한 모드: ${permissionLabel}`}
                    >
                      <Shield size={14} aria-hidden="true" />
                      <span className={styles.chipText}>{permissionLabel}</span>
                      <ChevronDown
                        size={12}
                        className={styles.chipChevron}
                        aria-hidden="true"
                      />
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
                    <Select
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
                    </Select>
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
                className={`${styles.popover} ${styles.modelPopover}`}
                label="모델 선택"
                onToggle={setModelOpen}
              >
                <fieldset
                  className={styles.runtimeRequests}
                  disabled={optionsHeld}
                  data-runtime-source="requested"
                >
                  <legend className={styles.srOnly}>모델</legend>
                  {modelOpen && (
                    <ModelPicker
                      entries={modelEntries}
                      model={model}
                      variant={variant}
                      variantCleared={variantCleared}
                      reportedName={reportedModelName}
                      disabled={optionsHeld}
                      unavailable={unavailable}
                      onModel={setModel}
                      onVariant={setVariant}
                      close={() => {
                        document.getElementById(modelId)?.hidePopover();
                      }}
                    />
                  )}
                </fieldset>
              </PopoverPanel>
              <PopoverPanel
                id={permissionId}
                anchor="--permission"
                className={styles.popover}
                onToggle={(open) => {
                  if (!open && policyRequest)
                    actions.cancelPermissionPolicyObservation();
                }}
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
            {noModelsShown && (
              <Notice
                tone="danger"
                role="status"
                data-no-models
                action={
                  <Button
                    size="compact"
                    onClick={() => openSettingsPage("models")}
                  >
                    설정 열기
                  </Button>
                }
              >
                사용할 수 있는 모델이 없어 메시지를 보낼 수 없습니다. 설정의
                모델 제공자에서 제공자를 연결하세요.
              </Notice>
            )}
            {invalidSelection && (
              <Notice tone="danger">
                선택한 에이전트, 모델 또는 추론 강도를 사용할 수 없습니다. 다시
                선택하거나 기본값을 선택하세요.
              </Notice>
            )}
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </ToolContext.Provider>
  );
}
