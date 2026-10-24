import { useState } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  SubagentPanel,
  enqueueDelegation,
  useChildRows,
} from "../../features/subagents/index.js";
import { briefTitle } from "../../shared/subagents/index.js";
import {
  approvalMessage,
  approvedPlans,
  findingLines,
  latestChecklist,
  latestPlan,
  nextVersion,
  verifiedChecks,
  type CheckStatus,
} from "../../shared/plan-review/index.js";
import styles from "./plan-review.module.css";
import { Button, Notice, Textarea } from "@workbench/ui";

const REVIEWER = "리뷰어";
// Edit drafts live per session for this window only (not persisted, not sent).
const drafts = new Map<string, { planId: string; text: string }>();
const todoMark: Record<string, string> = {
  completed: "☑",
  in_progress: "▶",
  cancelled: "✕",
};
const statusLabels: Record<CheckStatus, string> = {
  passed: "통과",
  failed: "실패",
  running: "실행 중",
  unknown: "결과 확인 불가",
};
const jump = (messageId: string) =>
  document
    .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    ?.scrollIntoView({ block: "center" });

export function PlanReviewPanel({
  workspaceId,
  sessionId,
}: {
  workspaceId: string;
  sessionId?: string | undefined;
}) {
  const { actions } = useWindowWorkbench();
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const pending = useWorkbenchSelector(selectors.pending);
  const rows = useChildRows(sessionId);
  const [, bump] = useState(0);
  const [note, setNote] = useState("");
  const messages =
    sessionId && snapshot?.selectedSessionId === sessionId
      ? snapshot.messages
      : [];
  const checklist = latestChecklist(messages);
  const plan = latestPlan(messages);
  const approved = approvedPlans(messages);
  const { checks, needsReverify } = verifiedChecks(messages);
  const session = snapshot?.sessions.find((s) => s.id === sessionId);
  const isReviewer = Boolean(session?.title.startsWith(`${REVIEWER}:`));
  const reviewText = isReviewer
    ? messages.filter((m) => m.role === "assistant" && m.text.trim()).at(-1)
        ?.text
    : undefined;
  const findings = reviewText ? findingLines(reviewText) : null;
  const reviewers = rows.filter((r) => r.title.startsWith(`${REVIEWER}:`));
  const draft = sessionId ? drafts.get(sessionId) : undefined;
  const text = plan ? (draft?.planId === plan.id ? draft.text : plan.text) : "";
  const latest = approved.at(-1);

  const approve = async () => {
    if (!sessionId || !text.trim()) return;
    actions.options({ agent: "" });
    const ok = await actions.sendMessageToSession(
      workspaceId,
      sessionId,
      approvalMessage(nextVersion(messages), text),
    );
    setNote(ok ? "" : "계획을 보내지 못했습니다.");
  };
  const review = () => {
    if (!sessionId || !latest) return;
    const brief = {
      role: REVIEWER,
      goal: `승인된 계획 v${latest.version}을 위해 만들어진 변경을 리뷰하세요. 구체적인 지적을 file:line 과 함께 "- " 로 시작하는 줄로 나열하세요. 파일을 수정하지 마세요.`,
      inputs: `상위 세션의 승인된 계획 v${latest.version}:\n${messages.find((m) => m.id === latest.messageId)?.text ?? ""}`,
      acceptance:
        "읽기 전용으로만 조사합니다. 지적이 없으면 지적 없음이라고만 답하세요.",
    };
    enqueueDelegation({
      id: crypto.randomUUID(),
      parentId: sessionId,
      title: briefTitle(brief),
      brief,
      mode: "read_plan",
    });
    bump((n) => n + 1);
  };

  return (
    <div className={`${styles.root} plan-review-panel`}>
      <SubagentPanel workspaceId={workspaceId} sessionId={sessionId} bare />
      {!sessionId && <p className={styles.muted}>세션을 선택하세요.</p>}
      <section aria-label="체크리스트">
        <h3>
          체크리스트
          {checklist ? ` · ${checklist.done}/${checklist.total}` : ""}
        </h3>
        {checklist ? (
          <ul className={styles.list}>
            {checklist.items.map((item, i) => (
              <li key={i} data-todo-status={item.status}>
                {todoMark[item.status] ?? "☐"} {item.content}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>에이전트가 만든 할 일 목록이 없어요.</p>
        )}
      </section>
      <section aria-label="계획">
        <h3>계획</h3>
        {plan ? (
          <>
            <Textarea
              aria-label="계획 본문"
              className={styles.plan}
              value={text}
              onChange={(e) =>
                sessionId &&
                (drafts.set(sessionId, {
                  planId: plan.id,
                  text: e.target.value,
                }),
                bump((n) => n + 1))
              }
            />
            <Button
              size="compact"
              intent="primary"
              disabled={pending || !text.trim()}
              onClick={() => void approve()}
            >
              승인하고 실행
            </Button>
          </>
        ) : (
          <p className={styles.muted}>/plan 으로 계획을 먼저 세우세요.</p>
        )}
        {note && <Notice tone="danger">{note}</Notice>}
        {approved.length > 0 && (
          <ul className={styles.list} aria-label="승인된 계획 버전">
            {approved.map((p) => (
              <li key={p.messageId}>
                v{p.version} · 실행 턴 {p.runs.length}개{" "}
                <Button
                  size="compact"
                  intent="quiet"
                  onClick={() => jump(p.messageId)}
                >
                  메시지로 이동
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="독립 리뷰">
        <h3>독립 리뷰</h3>
        <Button
          size="compact"
          intent="secondary"
          disabled={!latest || pending}
          onClick={review}
        >
          독립 리뷰 요청
        </Button>
        {!latest && (
          <p className={styles.muted}>승인된 계획이 있어야 요청할 수 있어요.</p>
        )}
        {reviewers.length > 0 && (
          <ul className={styles.list} aria-label="리뷰어">
            {reviewers.map((r) => (
              <li key={r.id}>
                리뷰어 · {r.title.slice(REVIEWER.length + 1)} · {r.status}{" "}
                {r.status !== "queued" && (
                  <Button
                    size="compact"
                    intent="quiet"
                    onClick={() => actions.select(workspaceId, r.id)}
                  >
                    결과 열기
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {reviewText && (
          <div aria-label="리뷰어 결과">
            {findings && <p>미해결 지적 {findings.length}건</p>}
            <pre className={styles.result}>{reviewText}</pre>
          </div>
        )}
      </section>
      <section aria-label="검증 기록">
        <h3>검증 기록</h3>
        {needsReverify && <Notice tone="warning">수정 후 재검증 필요</Notice>}
        {checks.length === 0 ? (
          <p className={styles.muted}>
            lint/test/typecheck 실행 기록이 없어요. 에이전트의 완료 주장은
            통과로 표시하지 않아요.
          </p>
        ) : (
          <ul className={styles.list}>
            {checks.map((c) => (
              <li key={c.id} data-check-status={c.status}>
                {c.kind} · {statusLabels[c.status]} · 턴 {c.turn} ·{" "}
                <code>{c.command}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
