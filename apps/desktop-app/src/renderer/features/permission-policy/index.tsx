import { useRef } from "react";
import { Button } from "@workbench/ui";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import type { WorkbenchPermissionPolicyObservation } from "../../shared/api/index.js";
import styles from "./policy.module.css";

type Available = Extract<
  WorkbenchPermissionPolicyObservation,
  { status: "available" }
>;
function Rules({
  source,
  rows,
}: {
  source: "session" | "required";
  rows: Available["sessionRules"];
}) {
  return (
    <ol className={styles.rules} data-permission-policy-source={source}>
      {rows.map((row, index) => (
        <li key={index}>
          <dl>
            <dt>action</dt>
            <dd>{row.action}</dd>
            <dt>resource</dt>
            <dd>{row.resource}</dd>
            <dt>effect</dt>
            <dd>{row.effect}</dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}
const labels = {
  not_observed: "아직 확인하지 않았습니다.",
  checking: "세션 권한 규칙 확인 중…",
  observed: "세션 규칙을 확인했습니다.",
  unavailable:
    "세션 권한 규칙을 확인할 수 없습니다. 규칙이 없다는 뜻은 아닙니다.",
  stale: "이전 결과는 현재 상태가 아닙니다. 다시 확인하세요.",
  error: "세션 규칙을 확인하지 못했습니다. 다시 확인하세요.",
} as const;

export function PermissionPolicy({
  className,
}: {
  className?: string | undefined;
}) {
  const { actions } = useWindowWorkbench();
  const entry = useWorkbenchSelector(selectors.permissionPolicy);
  const current = useWorkbenchSelector(
    selectors.currentPermissionPolicyObservation,
  );
  const canObserve = useWorkbenchSelector(selectors.canObservePermissionPolicy);
  const details = useRef<HTMLDetailsElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const status = entry.request
    ? "checking"
    : current
      ? current.status === "available"
        ? "observed"
        : "unavailable"
      : entry.error === "STALE" || entry.observation
        ? "stale"
        : entry.error === "CANCELLED"
          ? "not_observed"
          : entry.error
            ? "error"
            : "not_observed";
  const available = current?.status === "available" ? current : undefined;
  const cancel = () => {
    actions.cancelPermissionPolicyObservation();
    statusRef.current?.focus();
  };
  const close = () => {
    if (entry.request) actions.cancelPermissionPolicyObservation();
    if (details.current) {
      details.current.open = false;
      details.current.querySelector("summary")?.focus();
    }
  };
  return (
    <details
      ref={details}
      className={`${className ?? ""} ${styles.policy}`}
      data-runtime-task="permission"
      data-permission-policy-status={status}
      data-permission-policy-baseline={
        available
          ? available.baselineMatches
            ? "matches"
            : "mismatch"
          : undefined
      }
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229 &&
          entry.request
        )
          actions.cancelPermissionPolicyObservation();
      }}
    >
      <summary>
        저장된 권한 규칙 관리
        {available && !available.baselineMatches && (
          <span className={styles.mismatch}> · 앱 필수 규칙과 다름</span>
        )}
      </summary>
      <p>
        세션에 저장된 규칙입니다. Agent 규칙·저장된 허용·hook을 합친 최종 실행
        판단은 아닙니다.
      </p>
      <p>도구 수준 규칙이며 OS sandbox가 아닙니다.</p>
      <p ref={statusRef} tabIndex={-1} role="status" className={styles.status}>
        {entry.error === "CANCELLED"
          ? "확인을 취소했습니다. 이전 결과는 현재 상태가 아닙니다."
          : labels[status]}
      </p>
      <div className={styles.actions}>
        {entry.request ? (
          <Button
            size="compact"
            data-permission-policy-action="cancel"
            onClick={cancel}
          >
            확인 취소
          </Button>
        ) : (
          <Button
            size="compact"
            data-permission-policy-action="observe"
            disabled={!canObserve}
            onClick={() => void actions.observePermissionPolicy()}
          >
            세션 권한 규칙 확인
          </Button>
        )}
        <Button size="compact" data-runtime-task-close onClick={close}>
          권한 규칙 닫기
        </Button>
      </div>
      {!canObserve && !entry.request && (
        <p>현재 선택의 연결·신뢰·복구 상태와 새 세션 상태 확인이 필요합니다.</p>
      )}
      {available && (
        <>
          <h4>세션에 저장된 규칙</h4>
          <p>
            {available.sessionRulesState === "absent"
              ? "규칙 필드 없음 (absent)"
              : available.sessionRules.length === 0
                ? "규칙 필드 있음 · 빈 목록 (present)"
                : "규칙 필드 있음 (present)"}
          </p>
          <Rules source="session" rows={available.sessionRules} />
          <h4>앱 필수 규칙</h4>
          <p>
            {available.baselineMatches
              ? "세션 규칙이 앱 필수 규칙과 같습니다."
              : "세션 규칙이 앱 필수 규칙과 다릅니다."}
          </p>
          <Rules source="required" rows={available.requiredBaselineRules} />
        </>
      )}
    </details>
  );
}
