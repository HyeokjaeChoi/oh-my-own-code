import { useRef } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import styles from "./extensions.module.css";
import { Button } from "@workbench/ui";

const unavailableReasons = {
  runtime_unavailable: "Native 정보를 확인할 수 없습니다.",
  invalid_response:
    "응답 형식을 확인하지 못했습니다. 빈 목록으로 표시하지 않습니다.",
  limit_reached:
    "목록 확인 한도에 도달했습니다. 일부만 잘라서 표시하지 않습니다.",
} as const;
const blockReasons = {
  no_workspace: "작업 공간을 먼저 선택하세요.",
  untrusted: "신뢰하지 않는 작업 공간입니다. Native 상태를 조회할 수 없습니다.",
  held: "결과가 확인되지 않은 작업 또는 복구 제한이 있습니다. 원래 작업의 확인이 필요합니다.",
  disconnected: "Native 연결이 끊겼습니다. 이전 결과는 현재 상태가 아닙니다.",
  snapshot_required:
    "현재 작업 공간의 새 상태 확인이 필요합니다. 실행 중인 작업이나 권한 요청도 확인하세요.",
  busy: "다른 파일 조회 또는 저장이 끝난 뒤 다시 확인하세요. 취소한 조회의 응답을 기다릴 수도 있습니다.",
} as const;
const stateLabels = {
  not_observed: "아직 조회하지 않았습니다. 확장 상태 확인을 선택하세요.",
  checking: "Native 확장 상태 확인 중…",
  available: "현재 조회 결과입니다. Plugin과 Tools를 각각 확인했습니다.",
  partial: "일부 목록을 확인할 수 없습니다. 확인한 목록만 표시합니다.",
  unavailable: "현재 목록을 확인할 수 없습니다. 항목이 없다는 뜻은 아닙니다.",
  cancelled: "조회를 취소했습니다. 이전 결과는 현재 상태가 아닙니다.",
  stale:
    "이전 결과는 현재 상태가 아닙니다. 새 상태를 확인한 뒤 다시 조회하세요.",
  held: blockReasons.held,
  untrusted: blockReasons.untrusted,
  disconnected: blockReasons.disconnected,
} as const;

export function ConfigurationExtensions() {
  const { actions } = useWindowWorkbench();
  const entry = useWorkbenchSelector(selectors.extensions);
  const current = useWorkbenchSelector(selectors.currentExtensionObservation);
  const canObserve = useWorkbenchSelector(selectors.canObserveExtensions);
  const blocked = useWorkbenchSelector(selectors.extensionReadBlockReason);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const state =
    blocked === "untrusted" || blocked === "held" || blocked === "disconnected"
      ? blocked
      : entry.request
        ? "checking"
        : current
          ? current.status
          : entry.error === "CANCELLED"
            ? "cancelled"
            : entry.error === "STALE" || entry.observation
              ? "stale"
              : entry.error
                ? "unavailable"
                : "not_observed";
  const cancel = () => {
    actions.cancelExtensionObservation();
    statusRef.current?.focus();
  };
  return (
    <section
      className={styles.extensions}
      aria-label="Native 확장 상태"
      data-configuration-extensions="true"
      // While a read is cancellable, Escape belongs to this section, not the dialog.
      data-escape-key-scope={entry.request ? true : undefined}
      data-extensions-state={state}
      data-extensions-blocked={blocked ?? "none"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && entry.request) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <h3>Native 확장 상태</h3>
      <p className={styles.muted}>
        버튼을 선택할 때만 조회합니다. Plugin 목록과 Tools 목록은 독립된 두
        관찰입니다. 같은 시점의 권한 상태를 보장하지 않습니다.
      </p>
      <p className={styles.muted}>
        Native에 등록됨은 도구의 사용 권한이나 실행 성공을 뜻하지 않습니다. 설정
        출처에서 발견한 파일도 자동으로 불러오거나 실행한 파일을 뜻하지
        않습니다.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-extensions-observe="true"
          disabled={!canObserve}
          onClick={() => void actions.observeExtensions()}
        >
          확장 상태 확인
        </Button>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-extensions-cancel="true"
          disabled={!entry.request}
          onClick={cancel}
        >
          조회 취소
        </Button>
      </div>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={styles.status}
        data-extensions-status={state}
      >
        {stateLabels[state]}
      </p>
      {blocked && blocked !== state && <p>{blockReasons[blocked]}</p>}
      {entry.error === "READ_TIMEOUT" && (
        <p>
          조회 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 조회하세요.
        </p>
      )}
      {entry.error === "READ_BUSY" && (
        <p>다른 조회가 처리 중입니다. 처리가 끝난 뒤 다시 조회하세요.</p>
      )}
      {entry.error === "EXTENSIONS_UNVERIFIED" && (
        <p>응답을 검증하지 못했습니다. 현재 목록으로 사용할 수 없습니다.</p>
      )}
      {blocked === "untrusted" && (
        <p data-extensions-trust="untrusted">
          기존 ‘새 세션’을 선택하면 세션 생성 과정에서 신뢰 확인 창이
          표시됩니다. 이 작업은 새 세션을 추가합니다. 신뢰 확인 후 확장 상태
          확인을 다시 선택하세요.
        </p>
      )}
      {current && (
        <p className={styles.path}>관찰한 작업 공간: {current.workspacePath}</p>
      )}
      <section aria-label="Plugin" data-extensions-group="plugins">
        <h4>Plugin</h4>
        {!current ? (
          <p>현재 Plugin 조회 결과가 없습니다.</p>
        ) : current.plugins.status === "unavailable" ? (
          <p>{unavailableReasons[current.plugins.reason]}</p>
        ) : current.plugins.rows.length === 0 ? (
          <p>확인한 Native Plugin 목록에 항목이 없습니다.</p>
        ) : (
          <ul className={styles.rows}>
            {current.plugins.rows.map((row) => (
              <li key={row.id} data-extension-plugin={row.id}>
                <p className={styles.path}>ID: {row.id}</p>
                <p>{row.state === "active" ? "Native 활성" : "Native 실패"}</p>
                {row.state === "failed" && (
                  <p>
                    Native에서 실패를 보고했습니다. 상세 오류는 표시하지
                    않습니다.
                  </p>
                )}
                <p>출처: {row.source.type}</p>
                {"path" in row.source && (
                  <p className={styles.path}>{row.source.path}</p>
                )}
                {"target" in row.source && (
                  <p className={styles.path}>{row.source.target}</p>
                )}
                {"reason" in row.source && (
                  <p>
                    지원하지 않는 출처 형식입니다. 원본은 표시하지 않습니다.
                  </p>
                )}
                <p>
                  Native 보고 기능: server{" "}
                  {row.features.server ? "있음" : "없음"} · tui{" "}
                  {row.features.tui ? "있음" : "없음"} · rpc{" "}
                  {row.features.rpc ? "있음" : "없음"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Tools" data-extensions-group="tools">
        <h4>Tools</h4>
        {!current ? (
          <p>현재 Tools 조회 결과가 없습니다.</p>
        ) : current.tools.status === "unavailable" ? (
          <p>{unavailableReasons[current.tools.reason]}</p>
        ) : current.tools.rows.length === 0 ? (
          <p>확인한 Native Tools 목록에 항목이 없습니다.</p>
        ) : (
          <ul className={styles.rows}>
            {current.tools.rows.map((row) => (
              <li key={row.id} data-extension-tool={row.id}>
                <p>{row.name}</p>
                <p className={styles.path}>ID: {row.id}</p>
                <p>Native에 등록됨</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Hooks" data-extensions-group="hooks">
        <h4>Hooks</h4>
        <p>hook 목록 확인 불가</p>
        <p className={styles.muted}>
          Native가 hook 목록 조회를 지원하지 않습니다. hook이 없거나
          비활성이라는 뜻은 아닙니다.
        </p>
      </section>
    </section>
  );
}
