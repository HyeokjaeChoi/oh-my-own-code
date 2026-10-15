import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@workbench/ui";
import {
  selectors,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import type {
  ContextSelection,
  WorkbenchMessage,
} from "../../shared/api/index.js";
import styles from "./context.module.css";

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
  if (message.role !== "user") return null;
  return (
    <div className={styles.messageActions} data-context-message={message.id}>
      {message.context && (
        <p data-context-historical="unavailable">
          이전 첨부 입력을 사용할 수 없습니다. 파일을 다시 선택하세요.
        </p>
      )}
      <Button
        type="button"
        size="compact"
        data-context-retry={message.id}
        disabled={!ready || !idle}
        onClick={() => actions.previewContextBranch(message.id)}
      >
        이 입력으로 새 분기 준비
      </Button>
      <Button
        type="button"
        size="compact"
        data-context-edit={message.id}
        disabled={!ready || !idle}
        onClick={() => actions.previewContextBranch(message.id)}
      >
        입력 수정 후 새 분기 준비
      </Button>
    </div>
  );
}

// The composer wraps the attach and current-run bodies in its popovers; they
// render beside (never inside) the message form so Enter can never send.
export function ConversationContextControls({
  attachPanel,
  runPanel,
}: {
  attachPanel: (body: ReactNode) => ReactNode;
  runPanel: (body: ReactNode) => ReactNode;
}) {
  const { actions } = useWindowWorkbench();
  const context = useWorkbenchSelector(selectors.conversationContext);
  const draft = useWorkbenchSelector(selectors.contextDraft);
  const ready = useWorkbenchSelector(selectors.contextEffectsReady);
  const sendReady = useWorkbenchSelector(selectors.contextSendReady);
  const selection = useWorkbenchSelector(selectors.selection);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const messageDraft = useWorkbenchSelector(selectors.draft);
  const session = snapshot?.sessions.find((s) => s.id === selection.sessionId);
  const [path, setPath] = useState("");
  const [range, setRange] = useState<ContextSelection>();
  const textPreview = useRef<HTMLPreElement>(null);
  const branchInput = useRef<HTMLTextAreaElement>(null);
  const branchTrigger = useRef<HTMLElement | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const attachBody = useRef<HTMLDivElement>(null);
  const runBody = useRef<HTMLDivElement>(null);
  const reobserveButtons = useRef(new Map<string, HTMLButtonElement>());
  const branchBefore = context.branch?.before;
  const pathId = useId();
  const scopeKey = JSON.stringify([
    snapshot?.runtimeEpoch,
    selection.workspaceId,
    selection.sessionId,
    selection.generation,
  ]);
  useEffect(() => {
    setPath("");
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
  // Native popover hide returns focus to the invoking button.
  const closeTask = (host: HTMLElement | null) =>
    host?.closest<HTMLElement>("[popover]")?.hidePopover();
  const closePreview = () => {
    actions.closeContextPreview();
    const origin = previewTrigger.current?.isConnected
      ? previewTrigger.current
      : p && reobserveButtons.current.get(p.descriptor.capabilityId);
    if (origin?.isConnected && !origin.matches(":disabled")) origin.focus();
    else
      attachBody.current
        ?.querySelector<HTMLElement>("[data-context-path]")
        ?.focus();
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
            현재 Workspace 파일을 유지합니다. 분기를 만든 뒤 별도로 메시지를
            보내세요.
          </p>
          {context.branch.historical && (
            <p>이전 첨부 입력을 사용할 수 없습니다. 파일을 다시 선택하세요.</p>
          )}

          <label>
            새 분기에 준비할 입력
            <textarea
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
      {draft.items.length > 0 && !sendReady && (
        <p role="status" data-context-send-blocked>
          첨부를 보내려면 파일을 다시 확인하고, 입력 형식을 지원하는 모델을
          선택하세요.
        </p>
      )}
      {context.notice && (
        <p role="status" data-context-notice>
          {context.notice}
        </p>
      )}
      {!ready && (
        <p role="status" data-context-held>
          {context.request || context.inboxRequest
            ? "입력을 확인 중입니다. 확인 중단은 실행 취소를 뜻하지 않습니다."
            : "입력 작업을 보류했습니다. 연결·신뢰·요청 상태를 확인하세요. 자동으로 다시 실행하지 않습니다."}
        </p>
      )}
      <>
        {draft.items.length > 0 && (
          <section aria-label="선택한 첨부 입력" data-context-summary>
            <strong>첨부 {draft.items.length}개</strong>
            <ul className={styles.list} data-context-list>
              {draft.items.map((d) => (
                <li
                  key={d.capabilityId}
                  data-context-item={d.capabilityId}
                  data-context-source={d.source}
                  data-context-available={Boolean(
                    draft.authority &&
                      draft.verifiedIds.includes(d.capabilityId),
                  )}
                >
                  <strong title={d.path}>{d.name}</strong>
                  <span>
                    {d.source === "selection" ? "선택 영역 참조" : "파일 첨부"}{" "}
                    · {d.mime} ·{" "}
                    {draft.authority &&
                    draft.verifiedIds.includes(d.capabilityId)
                      ? "확인됨"
                      : "다시 확인 필요"}
                  </span>
                  {d.range && (
                    <span>
                      UTF-16 범위 {d.range.start}–{d.range.end}
                    </span>
                  )}
                  <details>
                    <summary>확인 시점의 version과 SHA-256</summary>
                    <dl>
                      <dt>경로</dt>
                      <dd>{d.path}</dd>
                      <dt>크기</dt>
                      <dd>{d.size} bytes</dd>
                      <dt>source</dt>
                      <dd>{d.source}</dd>
                      <dt>version</dt>
                      <dd>{d.version}</dd>
                      <dt>SHA-256</dt>
                      <dd>{d.digest}</dd>
                    </dl>
                  </details>
                  {(!draft.authority ||
                    !draft.verifiedIds.includes(d.capabilityId)) && (
                    <p>현재 전송 권한이 없습니다. 파일을 다시 확인하세요.</p>
                  )}
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      size="compact"
                      data-context-reobserve={d.capabilityId}
                      ref={(node) => {
                        if (node)
                          reobserveButtons.current.set(d.capabilityId, node);
                        else reobserveButtons.current.delete(d.capabilityId);
                      }}
                      disabled={!ready}
                      onClick={(event) => {
                        previewTrigger.current = event.currentTarget;
                        const pop =
                          attachBody.current?.closest<HTMLElement>("[popover]");
                        if (pop && !pop.matches(":popover-open"))
                          pop.showPopover();
                        void actions.observeContext(d.path);
                      }}
                    >
                      파일 다시 확인 · 미리보기
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      data-context-remove={d.capabilityId}
                      onClick={() => actions.removeContext(d.capabilityId)}
                    >
                      입력 제거
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
      {attachPanel(
        <div ref={attachBody}>
          <div className={styles.body}>
            <h2>파일 첨부와 미리보기</h2>
            <div className={styles.controls}>
              <label htmlFor={pathId}>Workspace 상대 경로</label>
              <input
                id={pathId}
                data-context-path
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="src/example.ts"
                spellCheck={false}
              />
              <Button
                type="button"
                data-context-observe
                disabled={!ready || !path}
                onClick={(event) => {
                  previewTrigger.current = event.currentTarget;
                  void actions.observeContext(path);
                }}
              >
                파일 확인 후 추가
              </Button>
              {context.request && (
                <Button
                  type="button"
                  data-context-cancel-read
                  onClick={actions.cancelContextObservation}
                >
                  파일 확인 중단
                </Button>
              )}
            </div>
            <p>
              확인한 입력을 Native에 보냅니다. Provider가 받은 입력을 증명하지
              않습니다.
            </p>
            {p && (
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
                <Button
                  type="button"
                  data-context-close-preview
                  onClick={closePreview}
                >
                  미리보기 닫기
                </Button>
              </section>
            )}
            <Button
              size="compact"
              onClick={() => closeTask(attachBody.current)}
              data-context-task-close
            >
              첨부 작업 닫기
            </Button>
          </div>
        </div>,
      )}
      {runPanel(
        <div ref={runBody}>
          <div className={styles.body}>
            <section aria-label="현재 실행에 요청" data-context-running>
              <strong>현재 실행에 요청</strong>
              <p>
                현재 작성한 텍스트만 보냅니다. Native의 현재 실행 설정을
                사용합니다.
              </p>
              <div className={styles.actions}>
                <Button
                  type="button"
                  data-context-steer
                  disabled={
                    !ready ||
                    session?.status !== "running" ||
                    !messageDraft.text.trim()
                  }
                  onClick={() => void actions.deliverContextMessage("steer")}
                >
                  현재 실행에 추가 지시
                </Button>
                <Button
                  type="button"
                  data-context-queue
                  disabled={
                    !ready ||
                    session?.status !== "running" ||
                    !messageDraft.text.trim()
                  }
                  onClick={() => void actions.deliverContextMessage("queue")}
                >
                  현재 실행 대기열에 추가
                </Button>
              </div>
            </section>
            <section aria-label="Native 대기열 확인" data-context-inbox>
              <Button
                type="button"
                data-context-inbox-observe
                disabled={!ready}
                onClick={() => void actions.observeInbox()}
              >
                현재 세션 대기열 확인
              </Button>
              {context.inboxRequest && (
                <Button
                  type="button"
                  onClick={actions.cancelContextObservation}
                >
                  대기열 확인 중단
                </Button>
              )}
              {context.inbox ? (
                <>
                  <p>
                    확인 시점의 대기열입니다. 항목이 없어도 취소나 미실행을
                    증명하지 않습니다.
                  </p>
                  <ul className={styles.list}>
                    {context.inbox.entries.map((row) => (
                      <li key={row.id} data-context-inbox-row={row.id}>
                        <span>
                          {row.delivery === "queue"
                            ? "대기열 요청"
                            : "추가 지시"}{" "}
                          · {row.id}
                        </span>
                        <pre>{row.textPreview}</pre>
                        {row.textTruncated && <p>텍스트 일부만 표시합니다.</p>}
                        <p>첨부 {row.attachmentCount}개</p>
                        <Button
                          type="button"
                          data-context-inbox-cancel={row.id}
                          disabled={!ready}
                          onClick={() => void actions.cancelInbox(row.id)}
                        >
                          이 항목 취소 요청
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p>다른 형식의 항목 {context.inbox.otherCount}개</p>
                </>
              ) : (
                <p>대기열은 명시적으로 확인해야 표시됩니다.</p>
              )}
            </section>
            <Button
              size="compact"
              onClick={() => closeTask(runBody.current)}
              data-context-running-close
            >
              현재 실행 작업 닫기
            </Button>
          </div>
        </div>,
      )}
    </div>
  );
}
