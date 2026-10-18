import { useId, useRef } from "react";
import { Button } from "@workbench/ui";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import type { WorkbenchPermissionPolicyObservation } from "../../shared/api/index.js";
import {
  classifyPreset,
  type PermissionPresetId,
} from "../../shared/configuration-draft/index.js";
import styles from "./policy.module.css";

type Available = Extract<
  WorkbenchPermissionPolicyObservation,
  { status: "available" }
>;
const PRESETS: readonly {
  id: PermissionPresetId;
  label: string;
  detail: string;
}[] = [
  {
    id: "ask",
    label: "요청마다 확인",
    detail:
      "기본값. external_directory(작업 공간 밖 접근)를 제외한 모든 도구 사용을 매번 묻습니다.",
  },
  {
    id: "scoped_edit",
    label: "범위 내 편집 허용",
    detail:
      "작업 공간 안 파일 편집(.git/.hg 메타데이터 제외), 읽기·검색, 하위 에이전트 위임은 묻지 않습니다. .env 읽기는 묻고, 셸 명령과 웹 접근은 거부합니다. 그 밖의 도구(MCP 등)는 묻습니다.",
  },
  {
    id: "read_plan",
    label: "읽기/계획",
    detail:
      "읽기·검색과 하위 에이전트 위임은 묻지 않습니다. .env 읽기는 묻고, 편집·셸 명령·웹 접근은 거부합니다. 그 밖의 도구(MCP 등)는 묻습니다.",
  },
  {
    id: "custom",
    label: "사용자 정의",
    detail:
      "세 프리셋과 일치하지 않는 규칙입니다. 다음 전송 전에 선택한 모드의 규칙으로 다시 적용됩니다.",
  },
];

function Presets({
  rules,
  absent,
}: {
  rules: Available["sessionRules"] | undefined;
  absent: boolean;
}) {
  const titleId = useId();
  const current = rules ? classifyPreset(rules) : undefined;
  return (
    <section aria-labelledby={titleId}>
      <h4 id={titleId}>권한 프리셋</h4>
      <p>
        {current
          ? "현재 세션 규칙과 일치하는 프리셋에 표시합니다."
          : absent
            ? "세션에 규칙이 아직 설정되지 않았습니다."
            : "세션 권한 규칙을 확인하면 현재 프리셋이 표시됩니다."}{" "}
        이 목록은 보기 전용입니다. 모드는 작성창의 권한 메뉴에서 바꿉니다.
      </p>
      <ul className={styles.rules} data-permission-presets>
        {PRESETS.map((preset) => (
          <li
            key={preset.id}
            data-permission-preset={preset.id}
            data-current={preset.id === current ? "true" : "false"}
            aria-current={preset.id === current ? "true" : undefined}
          >
            <strong>{preset.label}</strong>
            {preset.id === current && (
              <span className={styles.current}> · 현재</span>
            )}
            <br />
            {preset.detail}
          </li>
        ))}
      </ul>
      <p data-permission-floor>
        세 프리셋은 항상 external_directory(작업 공간 밖 접근)를 거부합니다.
        앱은 매 전송 전에 규칙을 다시 적용하고 확인합니다. 사용자 정의 규칙에는
        이 보장이 없습니다.
      </p>
    </section>
  );
}

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
  // A matched preset is a known-good rule set; only unknown rules are flagged.
  const mismatch =
    !!available &&
    !available.baselineMatches &&
    classifyPreset(available.sessionRules) === "custom";
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
        available ? (!mismatch ? "matches" : "mismatch") : undefined
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
        {mismatch && (
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
      <Presets
        rules={
          available?.sessionRulesState === "present"
            ? available.sessionRules
            : undefined
        }
        absent={available?.sessionRulesState === "absent"}
      />
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
          <h4>기본(요청마다 확인) 규칙과 하한선</h4>
          <p>
            {available.baselineMatches
              ? "세션 규칙이 이 기본 규칙과 같습니다."
              : mismatch
                ? "세션 규칙이 이 기본 규칙과도, 위 프리셋과도 다릅니다."
                : "세션 규칙은 이 기본 규칙과 다르지만 위 프리셋과 일치합니다."}
          </p>
          <Rules source="required" rows={available.requiredBaselineRules} />
        </>
      )}
    </details>
  );
}
