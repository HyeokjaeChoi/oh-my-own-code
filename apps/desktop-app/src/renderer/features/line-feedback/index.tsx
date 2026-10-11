import { useId, useRef } from "react";
import {
  selectors,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import { LINE_FEEDBACK_LIMITS } from "../../shared/api/index.js";
import styles from "./feedback.module.css";

const reasons: Record<string, string> = {
  MISSING_SOURCE:
    "먼저 파일 기준 내용 또는 Git 차이를 직접 읽고 출처를 선택하세요.",
  MISSING_SESSION:
    "대상 세션을 선택하세요. 기존 피드백 초안은 계속 편집할 수 있습니다.",
  UNTRUSTED:
    "신뢰하지 않은 작업 공간입니다. 초안은 편집할 수 있지만 추가할 수 없습니다.",
  HELD: "앱 작업 또는 Recovery로 추가를 보류합니다. 초안은 계속 편집할 수 있습니다.",
  STALE_SOURCE:
    "과거 출처입니다. 현재 출처로 추가하려면 직접 다시 읽고 선택하세요. 기존 초안은 보존됩니다.",
  STALE_TARGET:
    "출처 또는 대상 작성기가 바뀌었습니다. 내용을 확인한 뒤 다시 추가하세요.",
  INVALID_LINE_RANGE:
    "존재하는 줄 범위를 입력하세요. 빈 파일이나 차이가 없는 쪽은 선택할 수 없습니다. 최대 200줄입니다.",
  UNSUPPORTED_DIFF:
    "이 Git patch의 줄을 정확히 연결할 수 없습니다. 추가할 수 없습니다.",
  INVALID_FEEDBACK_SOURCE:
    "보호되었거나 사용할 수 없는 출처입니다. 추가할 수 없습니다.",
  INVALID_FEEDBACK_COMMENT: "의견을 입력하세요.",
  INVALID_FEEDBACK_TEXT: "작성기 또는 의견에 지원하지 않는 텍스트가 있습니다.",
  FEEDBACK_TOO_LARGE:
    "의견 또는 발췌문이 한도를 넘습니다. 내용을 줄이세요. 기존 초안은 보존됩니다.",
  DRAFT_TOO_LARGE:
    "작성기 초안이 32,000자 한도를 넘습니다. 기존 내용을 직접 정리하세요.",
  CACHE_FULL:
    "피드백 초안 16개가 남아 있습니다. 보관 초안에서 필요 없는 초안을 직접 버린 뒤 선택하세요.",
  ADDED:
    "작성기 초안에 추가했습니다. 내용을 확인하고 기존 전송 버튼을 따로 누르세요.",
  DISCARDED: "선택한 피드백 초안을 버렸습니다. 작성기 내용은 유지됩니다.",
};

export function LineFeedbackPanel() {
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s);
  const feedback = selectors.lineFeedback(state);
  const draft = selectors.lineFeedbackDraft(state);
  const preview = selectors.lineFeedbackPreview(state);
  const reason = selectors.lineFeedbackReason(state);
  const source = draft?.source.observation;
  const session = state.lists.sessions.find(
    (s) =>
      s.id === draft?.scope.sessionId &&
      s.workspaceId === draft.scope.workspaceId,
  );
  const prefix = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatus = () => statusRef.current?.focus();
  const status =
    feedback.notice && feedback.notice !== "ADDED"
      ? feedback.notice
      : reason || feedback.notice;
  return (
    <section
      className={styles.feedback}
      aria-label="파일·diff 줄 피드백"
      data-line-feedback-state={reason || "ready"}
      data-escape-key-scope
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          focusStatus();
        }
      }}
    >
      <h3>파일·diff 줄 피드백</h3>
      <p>
        파일은 직접 읽은 기준 내용입니다. 저장하지 않은 파일 편집 내용은
        포함하지 않습니다. Git은 직접 읽은 차이입니다. 추가한 뒤 작성기에서
        확인하고 기존 전송 버튼을 따로 누르세요.
      </p>
      <div className={styles.field}>
        <label htmlFor={`${prefix}-source`}>피드백 출처</label>
        <select
          id={`${prefix}-source`}
          data-line-feedback-source
          value=""
          onChange={(event) => {
            if (event.target.value === "file" || event.target.value === "git") {
              actions.selectLineFeedbackSource(event.target.value);
              focusStatus();
            }
          }}
        >
          <option value="">현재 출처를 직접 선택하세요</option>
          <option value="file">읽은 파일 기준 내용</option>
          <option value="git">현재 Git 차이</option>
        </select>
        <label htmlFor={`${prefix}-history`}>보관 피드백 초안</label>
        <select
          id={`${prefix}-history`}
          data-line-feedback-history
          value={feedback.active ?? ""}
          onChange={(event) => actions.resumeLineFeedback(event.target.value)}
        >
          <option value="">초안을 선택하세요</option>
          {Object.values(feedback.drafts).map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}: {d.source.kind} · {d.source.observation.path} · 세션{" "}
              {d.scope.sessionId ?? "없음"}
            </option>
          ))}
        </select>
      </div>
      <dl className={styles.metadata} data-line-feedback-session>
        <dt>추가 대상 세션</dt>
        <dd>
          {draft
            ? `${session?.title ?? draft.scope.sessionId ?? "선택 안 함"} / ${draft.scope.workspaceId ?? "없음"} / ${draft.scope.sessionId ?? "없음"}`
            : "출처 선택 시 현재 세션을 고정합니다."}
        </dd>
        {source && (
          <>
            <dt>원래 출처 / 작업 공간 / 경로</dt>
            <dd>
              {draft?.source.kind} / {source.workspacePath} / {source.path}
            </dd>
            <dt>Runtime epoch / revision</dt>
            <dd>
              {source.runtimeEpoch} / {source.revision}
            </dd>
            {source.status === "available" && "version" in source && (
              <>
                <dt>원래 version / directoryVersion</dt>
                <dd>
                  {source.version} / {source.directoryVersion}
                </dd>
              </>
            )}
            {"observationId" in source && (
              <>
                <dt>원래 Observation ID / Source digest / 비교 방식</dt>
                <dd>
                  {source.observationId} /{" "}
                  {"sourceDigest" in source ? source.sourceDigest : ""} /{" "}
                  {source.mode}
                </dd>
                {source.mode === "base" && (
                  <>
                    <dt>원래 기준 branch / OID</dt>
                    <dd>
                      {source.baseRef} / {source.baseOid}
                    </dd>
                  </>
                )}
              </>
            )}
          </>
        )}
      </dl>
      <fieldset className={styles.field} disabled={!draft}>
        <legend>줄 범위와 의견</legend>
        <label htmlFor={`${prefix}-side`}>피드백 쪽</label>
        <select
          id={`${prefix}-side`}
          data-line-feedback-side
          value={draft?.selection.side ?? "file"}
          onChange={(event) =>
            actions.editLineFeedback({
              side: event.target.value as "file" | "old" | "new",
            })
          }
        >
          {draft?.source.kind !== "git" ? (
            <option value="file">File · 기준 내용</option>
          ) : (
            <>
              <option value="old">Old · 변경 전</option>
              <option value="new">New · 변경 후</option>
            </>
          )}
        </select>
        <label htmlFor={`${prefix}-start`}>시작 줄</label>
        <input
          id={`${prefix}-start`}
          type="number"
          min="1"
          step="1"
          data-line-feedback-start
          data-line-feedback-range="start"
          value={draft?.selection.start ?? 1}
          onChange={(event) =>
            actions.editLineFeedback({ start: Number(event.target.value) })
          }
        />
        <label htmlFor={`${prefix}-end`}>끝 줄</label>
        <input
          id={`${prefix}-end`}
          type="number"
          min="1"
          step="1"
          data-line-feedback-end
          data-line-feedback-range="end"
          value={draft?.selection.end ?? 1}
          onChange={(event) =>
            actions.editLineFeedback({ end: Number(event.target.value) })
          }
        />
        <label htmlFor={`${prefix}-comment`}>줄 피드백 의견</label>
        <textarea
          id={`${prefix}-comment`}
          data-line-feedback-comment
          value={draft?.comment ?? ""}
          onChange={(event) =>
            actions.editLineFeedback({ comment: event.target.value })
          }
          aria-describedby={`${prefix}-limits`}
        />
        <p id={`${prefix}-limits`}>
          의견 최대 {LINE_FEEDBACK_LIMITS.commentCharacters.toLocaleString()}자
          · Enter는 줄바꿈입니다.
        </p>
      </fieldset>
      <pre
        className={styles.preview}
        data-line-feedback-preview
        tabIndex={0}
        role="region"
        aria-label="선택한 줄 발췌문"
      >
        {preview?.excerpt ?? "선택할 줄이 없거나 줄 범위를 확인해야 합니다."}
      </pre>
      <div className={styles.actions}>
        <button
          data-line-feedback-append
          disabled={!selectors.canAppendLineFeedback(state)}
          onClick={() => {
            actions.appendLineFeedback();
            focusStatus();
          }}
        >
          작성기 초안에 추가
        </button>
        <button
          data-line-feedback-discard
          disabled={!draft}
          onClick={() => {
            actions.discardLineFeedback();
            focusStatus();
          }}
        >
          피드백 초안 버리기
        </button>
      </div>
      {reason && status !== reason && (
        <p>{reasons[reason] ?? "출처와 입력을 확인하세요."}</p>
      )}
      <p
        ref={statusRef}
        id={`${prefix}-status`}
        className={styles.status}
        data-line-feedback-status={status || "ready"}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {reasons[status] ??
          (status
            ? "출처와 입력을 확인하세요."
            : "작성기 초안에 추가할 수 있습니다. 아직 전송하지 않았습니다.")}
      </p>
    </section>
  );
}
