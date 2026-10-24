import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GitBranch, SquarePen, Undo2 } from "lucide-react";
import { Button, Textarea } from "@workbench/ui";
import {
  composerOperation,
  rejectionMessage,
  revertRequestReady,
  selectors,
  sendInFlight,
  transientRejection,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import { selectionKey } from "../../shared/projection/index.js";
import { openSettingsPage } from "../../shared/palette/index.js";
import { revertFilesText } from "../../shared/conversation-context/index.js";
import type {
  ContextSelection,
  WorkbenchMessage,
} from "../../shared/api/index.js";
import { AttachMenuBody, type ContextIntake } from "./intake.js";
import styles from "./context.module.css";

export {
  AttachmentChips,
  useContextIntake,
  type ContextIntake,
} from "./intake.js";
export { useMention } from "./mention.js";

const errors: Record<string, string> = {
  missing_file: "파일이 없습니다.",
  path_missing: "파일 경로가 없습니다.",
  path_denied: "파일을 읽을 수 없습니다.",
  file_changed: "파일이 바뀌었습니다. 다시 확인하세요.",
  protected_source: "보호된 파일은 추가할 수 없습니다.",
  too_large: "파일 크기 한도를 넘었습니다.",
  unsupported_content: "지원하지 않는 파일 형식입니다.",
  selection_changed: "선택한 원본이 바뀌었습니다. 다시 확인하세요.",
  capacity_exceeded: "첨부 개수 또는 크기 한도를 넘었습니다.",
  CONTEXT_EXPIRED: "확인 기간이 끝났습니다. 파일을 다시 확인하세요.",
  CONTEXT_UNVERIFIED: "입력을 확인할 수 없습니다. 다시 확인하세요.",
  CANCELLED: "확인을 중단했습니다.",
  READ_TIMEOUT: "확인 시간이 지났습니다. 다시 확인하세요.",
  READ_BUSY: "다른 파일 확인이 끝난 뒤 다시 확인하세요.",
};

const notReadyReason = "세션이 준비되면 사용할 수 있습니다";

// Run controls shown inside the composer's run strip: extra instruction and
// queue delivery for the current run, plus the explicit queue inspection.
export function RunStripControls({
  running,
  inboxTrigger,
}: {
  running: boolean;
  inboxTrigger: (label: string) => ReactNode;
}) {
  const { actions } = useWindowWorkbench();
  const context = useWorkbenchSelector(selectors.conversationContext);
  const ready = useWorkbenchSelector(selectors.contextEffectsReady);
  const selection = useWorkbenchSelector(selectors.selection);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const messageDraft = useWorkbenchSelector(selectors.draft);
  const reasonId = useId();
  const session = snapshot?.sessions.find((s) => s.id === selection.sessionId);
  const live = ready && session?.status === "running";
  const hasText = Boolean(messageDraft.text.trim());
  const reason = !live
    ? notReadyReason
    : !hasText
      ? "보낼 내용을 먼저 입력하세요"
      : "";
  const count = context.inbox?.entries.length ?? 0;
  return (
    <div className={styles.stripActions} data-context-run-actions>
      {running && (
        <>
          <Button
            type="button"
            intent="secondary"
            size="compact"
            data-context-steer
            aria-describedby={reason ? reasonId : undefined}
            disabled={!live || !hasText}
            onClick={() => void actions.deliverContextMessage("steer")}
          >
            추가 지시
          </Button>
          <Button
            type="button"
            intent="secondary"
            size="compact"
            data-context-queue
            aria-describedby={reason ? reasonId : undefined}
            disabled={!live || !hasText}
            onClick={() => void actions.deliverContextMessage("queue")}
          >
            대기열에 추가
          </Button>
          {reason && (
            <span id={reasonId} className={styles.reason} data-context-reason>
              {reason}
            </span>
          )}
        </>
      )}
      {inboxTrigger(count > 0 ? `대기열 ${count}` : "대기열 보기")}
    </div>
  );
}

export function ContextMessageActions({
  message,
}: {
  message: WorkbenchMessage;
}) {
  const { actions } = useWindowWorkbench();
  const ready = useWorkbenchSelector(selectors.contextEffectsReady);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const idle =
    snapshot?.sessions.find((s) => s.id === snapshot.selectedSessionId)
      ?.status === "idle";
  const canRevert = useWorkbenchSelector((s) =>
    revertRequestReady(s, {
      type: "session.revert",
      workspaceId: s.selection.workspaceId ?? "",
      sessionId: s.selection.sessionId ?? "",
      requestId: "validation",
      messageId: message.id,
    }),
  );
  if (message.role !== "user") return null;
  return (
    <div className={styles.messageActions} data-context-message={message.id}>
      <Button
        type="button"
        size="compact"
        data-message-action
        data-context-revert={message.id}
        aria-label="여기로 되돌리기"
        title="여기로 되돌리기"
        disabled={!canRevert}
        onClick={() => void actions.revertToMessage(message.id)}
      >
        <Undo2 size={16} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="compact"
        data-message-action
        data-context-retry={message.id}
        aria-label="이 입력으로 새 분기 준비"
        title="이 입력으로 새 분기 준비"
        disabled={!ready || !idle}
        onClick={() => actions.previewContextBranch(message.id)}
      >
        <GitBranch size={16} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="compact"
        data-message-action
        data-context-edit={message.id}
        aria-label="입력 수정 후 새 분기 준비"
        title="입력 수정 후 새 분기 준비"
        disabled={!ready || !idle}
        onClick={() => actions.previewContextBranch(message.id)}
      >
        <SquarePen size={16} aria-hidden="true" />
      </Button>
      {message.context && (
        <p data-context-historical="unavailable" className={styles.historical}>
          첨부 {message.context.count}개와 함께 보낸 메시지입니다. 첨부 내용은
          다시 쓸 수 없어, 필요하면 파일을 다시 선택하세요.
        </p>
      )}
    </div>
  );
}

// The composer wraps the attach and current-run bodies in its popovers; they
// render beside (never inside) the message form so Enter can never send.
export function ConversationContextControls({
  menuPanel,
  previewPanel,
  inboxPanel,
  intake,
  noModelsShown,
}: {
  noModelsShown: boolean;
  menuPanel: (body: ReactNode) => ReactNode;
  previewPanel: (body: ReactNode) => ReactNode;
  inboxPanel: (body: ReactNode) => ReactNode;
  intake: ContextIntake;
}) {
  const { actions } = useWindowWorkbench();
  const context = useWorkbenchSelector(selectors.conversationContext);
  const draft = useWorkbenchSelector(selectors.contextDraft);
  const ready = useWorkbenchSelector(selectors.contextEffectsReady);
  const selection = useWorkbenchSelector(selectors.selection);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const messageDraft = useWorkbenchSelector(selectors.draft);
  // A sent draft awaiting its ACK is not input the user is waiting on.
  const sending = useWorkbenchSelector((s) =>
    sendInFlight(
      s,
      selectionKey(s.selection.workspaceId, s.selection.sessionId),
    ),
  );
  const held = Boolean(
    !ready &&
      (draft.items.length > 0 ||
        (!sending && messageDraft.text.trim()) ||
        context.request ||
        context.inboxRequest),
  );
  // Only a lasting hold is explained; brief reads and ACK waits stay quiet.
  const [heldShown, setHeldShown] = useState(false);
  useEffect(() => {
    if (!held) return setHeldShown(false);
    const timer = setTimeout(() => setHeldShown(true), 1500);
    return () => clearTimeout(timer);
  }, [held]);
  const [range, setRange] = useState<ContextSelection>();
  const textPreview = useRef<HTMLPreElement>(null);
  const branchInput = useRef<HTMLTextAreaElement>(null);
  const branchTrigger = useRef<HTMLElement | null>(null);
  const previewBody = useRef<HTMLDivElement>(null);
  const notice = useWorkbenchSelector((s) => s.notice);
  const rejection = useWorkbenchSelector((s) =>
    composerOperation(s.errorOp) ? s.error : "",
  );
  const rejectionOp = useWorkbenchSelector((s) => s.errorOp);
  const revert = useWorkbenchSelector(selectors.revert);
  const canReapply = useWorkbenchSelector((st) =>
    revertRequestReady(st, {
      type: "session.revert.clear",
      workspaceId: st.selection.workspaceId ?? "",
      sessionId: st.selection.sessionId ?? "",
      requestId: "validation",
      messageId: selectors.revert(st)?.messageId ?? "",
    }),
  );
  useEffect(() => {
    if (!rejection || !transientRejection(rejection)) return;
    const timer = setTimeout(actions.clearError, 10000);
    return () => clearTimeout(timer);
  }, [rejection, actions]);
  // Receipts are a brief status, not a standing banner. An unknown outcome
  // must stay until the user acts on it, so it never auto-clears.
  useEffect(() => {
    if (!context.notice) return;
    const timer = setTimeout(actions.clearContextNotice, 8000);
    return () => clearTimeout(timer);
  }, [context.notice, actions]);
  useEffect(() => {
    if (!notice || /자동 재전송하지 않습니다/.test(notice)) return;
    const timer = setTimeout(actions.clearNotice, 8000);
    return () => clearTimeout(timer);
  }, [notice, actions]);
  const branchBefore = context.branch?.before;
  const scopeKey = JSON.stringify([
    snapshot?.runtimeEpoch,
    selection.workspaceId,
    selection.sessionId,
    selection.generation,
  ]);
  useEffect(() => {
    setRange(undefined);
  }, [scopeKey]);
  useEffect(() => {
    setRange(undefined);
  }, [context.preview]);
  useEffect(() => {
    if (!branchBefore) return;
    branchTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      branchInput.current?.focus({ preventScroll: true });
      branchInput.current
        ?.closest("section")
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [branchBefore]);
  const closeBranch = () => {
    actions.closeContextBranch();
    requestAnimationFrame(() => {
      if (
        branchTrigger.current?.isConnected &&
        !branchTrigger.current.matches(":disabled")
      ) {
        branchTrigger.current.focus();
      } else {
        document
          .querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="메시지 작성"]',
          )
          ?.focus();
      }
    });
  };
  // Hiding the native popover returns focus to the chip that opened it.
  const closePreview = () => {
    actions.closeContextPreview();
    previewBody.current?.closest<HTMLElement>("[popover]")?.hidePopover();
  };
  const p = context.preview;
  const readSelection = () => {
    const node = textPreview.current,
      selected = window.getSelection();
    if (
      !node ||
      !selected?.rangeCount ||
      !p ||
      p.value.kind !== "text" ||
      p.descriptor.source !== "file" ||
      node.textContent !== p.value.text
    ) {
      setRange(undefined);
      return;
    }
    const r = selected.getRangeAt(0);
    if (
      r.collapsed ||
      !node.contains(r.startContainer) ||
      !node.contains(r.endContainer)
    ) {
      setRange(undefined);
      return;
    }
    const prefix = r.cloneRange();
    prefix.selectNodeContents(node);
    prefix.setEnd(r.startContainer, r.startOffset);
    const end = r.cloneRange();
    end.selectNodeContents(node);
    end.setEnd(r.endContainer, r.endOffset);
    const startOffset = prefix.toString().length,
      endOffset = end.toString().length;
    setRange(
      startOffset < endOffset
        ? { version: p.descriptor.version, start: startOffset, end: endOffset }
        : undefined,
    );
  };
  return (
    <div
      className={styles.section}
      data-context-tasks
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        )
          return;
        if (context.branch) {
          event.preventDefault();
          event.stopPropagation();
          closeBranch();
          return;
        }
      }}
    >
      {context.branch && (
        <section
          className={styles.branch}
          aria-label="새 분기 준비"
          data-context-branch
        >
          <strong>선택한 입력 직전에서 새 분기를 만듭니다.</strong>
          <p data-context-boundary>분기 경계: {context.branch.before}</p>
          <p>
            현재 작업 공간의 파일은 그대로 둡니다. 분기를 만든 뒤 별도로
            메시지를 보내세요.
          </p>
          {context.branch.historical && (
            <p>이전 첨부 입력을 사용할 수 없습니다. 파일을 다시 선택하세요.</p>
          )}

          <label>
            새 분기에 준비할 입력
            <Textarea
              ref={branchInput}
              aria-label="새 분기에 준비할 입력"
              data-context-branch-text
              value={context.branch.text}
              maxLength={32000}
              onChange={(e) => actions.editContextBranch(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <Button
              type="button"
              intent="primary"
              data-context-branch-confirm
              disabled={!ready}
              onClick={() => void actions.confirmContextBranch()}
            >
              새 분기 만들기 · 전송 안 함
            </Button>
            <Button
              type="button"
              data-context-branch-close
              onClick={closeBranch}
            >
              분기 준비 닫기
            </Button>
          </div>
          <details>
            <summary>선택한 원래 입력</summary>
            <pre>{context.branch.originalText}</pre>
          </details>
        </section>
      )}
      {context.error && (
        <p role="alert" data-context-error={context.error}>
          {errors[context.error] ??
            "현재 입력을 확인할 수 없습니다. 다시 확인하세요."}
        </p>
      )}
      {revert && (
        <div
          role="status"
          className={styles.revertBanner}
          data-revert-banner={revert.messageId}
        >
          <p>
            선택한 메시지부터 되돌렸습니다 · {revertFilesText(revert)}{" "}
            <Button
              size="compact"
              type="button"
              data-revert-reapply
              disabled={!canReapply}
              onClick={() => void actions.reapplyRevert()}
            >
              다시 적용
            </Button>
          </p>
          <p className={styles.revertNote}>
            다음 메시지를 보내면 되돌린 내용이 확정됩니다.
          </p>
        </div>
      )}
      {rejection && !(rejection === "AUTH_REQUIRED" && noModelsShown) && (
        <p role="alert" data-reject-notice={rejection}>
          {rejectionMessage(rejection, rejectionOp)}{" "}
          {rejection === "AUTH_REQUIRED" && (
            <Button size="compact" onClick={() => openSettingsPage("models")}>
              설정 열기
            </Button>
          )}{" "}
          <Button size="compact" onClick={actions.clearError}>
            닫기
          </Button>
        </p>
      )}
      {notice && (
        <p role="status" data-run-notice className={styles.notice}>
          {notice}
        </p>
      )}
      {context.notice && (
        <p role="status" data-context-notice className={styles.notice}>
          {context.notice}
        </p>
      )}
      {heldShown && (
        <p role="status" data-context-held>
          {context.request || context.inboxRequest
            ? "입력을 확인하는 중입니다."
            : "연결을 확인하는 중입니다."}
        </p>
      )}
      {!context.branch &&
        menuPanel(<AttachMenuBody intent={intake} ready={ready} />)}
      {context.request && (
        <p role="status" className={styles.notice}>
          파일을 확인하는 중입니다.{" "}
          <Button
            type="button"
            size="compact"
            data-context-cancel-read
            onClick={actions.cancelContextObservation}
          >
            파일 확인 중단
          </Button>
        </p>
      )}
      {intake.notice && (
        <p role="status" data-context-pick-notice className={styles.notice}>
          {intake.notice}
        </p>
      )}
      {!context.branch &&
        previewPanel(
          <div ref={previewBody} className={styles.body}>
            {p ? (
              <section
                className={styles.preview}
                aria-label="확인 시점의 입력 미리보기"
                data-context-preview={p.value.kind}
              >
                <strong>{p.descriptor.path} · 확인 시점의 입력</strong>
                {p.value.kind === "text" ? (
                  <>
                    <pre
                      ref={textPreview}
                      tabIndex={0}
                      data-context-text
                      onMouseUp={readSelection}
                      onKeyUp={readSelection}
                    >
                      {p.value.text}
                    </pre>
                    {p.descriptor.source === "file" && (
                      <>
                        <p>
                          {range
                            ? `UTF-16 범위 ${range.start}–${range.end}`
                            : "본문에서 참조할 텍스트를 선택하세요."}
                        </p>
                        <Button
                          type="button"
                          intent="secondary"
                          data-context-selection
                          disabled={!ready || !range}
                          onClick={() =>
                            range &&
                            void actions.observeContext(
                              p.descriptor.path,
                              range,
                            )
                          }
                        >
                          선택 영역 확인 후 참조 추가
                        </Button>
                      </>
                    )}
                  </>
                ) : p.value.kind === "image" ? (
                  <img
                    data-context-image
                    src={p.value.dataUrl}
                    alt={`${p.descriptor.name} · 확인 시점의 이미지`}
                  />
                ) : (
                  <p data-context-pdf>
                    PDF 내용 미리보기를 사용할 수 없습니다. 파일 정보만
                    표시합니다.
                  </p>
                )}
                <details>
                  <summary>확인 시점의 version과 SHA-256</summary>
                  <dl>
                    <dt>경로</dt>
                    <dd>{p.descriptor.path}</dd>
                    <dt>크기</dt>
                    <dd>{p.descriptor.size} bytes</dd>
                    <dt>version</dt>
                    <dd>{p.descriptor.version}</dd>
                    <dt>SHA-256</dt>
                    <dd>{p.descriptor.digest}</dd>
                  </dl>
                </details>
                <Button
                  type="button"
                  intent="secondary"
                  data-context-close-preview
                  onClick={closePreview}
                >
                  미리보기 닫기
                </Button>
              </section>
            ) : (
              !context.request && <p>미리볼 입력이 없습니다.</p>
            )}
          </div>,
        )}
      {!context.branch &&
        inboxPanel(
          <div className={styles.body} data-context-inbox>
            <div className={styles.actions}>
              <Button
                type="button"
                intent="secondary"
                data-context-inbox-observe
                disabled={!ready || Boolean(context.inboxRequest)}
                onClick={() => void actions.observeInbox()}
              >
                다시 확인
              </Button>
              {context.inboxRequest && (
                <Button
                  type="button"
                  intent="secondary"
                  onClick={actions.cancelContextObservation}
                >
                  대기열 확인 중단
                </Button>
              )}
            </div>
            {!ready && (
              <p className={styles.reason} data-context-reason>
                {notReadyReason}
              </p>
            )}
            {context.inbox ? (
              <>
                <p className={styles.hint}>마지막 확인 시점 기준입니다.</p>
                {context.inbox.entries.length === 0 ? (
                  <p>대기 중인 항목이 없습니다.</p>
                ) : (
                  <ul className={styles.list}>
                    {context.inbox.entries.map((row) => (
                      <li
                        key={row.id}
                        title={row.id}
                        data-context-inbox-row={row.id}
                      >
                        <span>
                          {row.delivery === "queue"
                            ? "대기열 요청"
                            : "추가 지시"}
                        </span>
                        <pre>{row.textPreview}</pre>
                        {row.textTruncated && <p>텍스트 일부만 표시합니다.</p>}
                        <p>첨부 {row.attachmentCount}개</p>
                        <Button
                          type="button"
                          intent="secondary"
                          data-context-inbox-cancel={row.id}
                          disabled={!ready}
                          onClick={() => void actions.cancelInbox(row.id)}
                        >
                          이 항목 취소 요청
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {context.inbox.otherCount > 0 && (
                  <p>다른 형식의 항목 {context.inbox.otherCount}개</p>
                )}
              </>
            ) : context.inboxRequest ? (
              <p>대기열을 확인하는 중입니다.</p>
            ) : (
              context.error &&
              context.error !== "CANCELLED" && (
                <p>대기열을 불러오지 못했습니다. 다시 확인하세요.</p>
              )
            )}
          </div>,
        )}
    </div>
  );
}
