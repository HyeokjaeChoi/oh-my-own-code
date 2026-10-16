import { useEffect, useId } from "react";
import {
  selectors,
  agentTargetPath,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import {
  compareConfigurationDraft,
  AGENT_LIMITS,
  agentIssueMessages,
} from "../../shared/configuration-draft/index.js";
import styles from "./drafts.module.css";
import { Button, Notice, Select, Textarea } from "@workbench/ui";

const reasonMessages: Record<string, string> = {
  path_missing:
    "관찰 시점에 기존 .opencode/agents 폴더를 찾지 못했습니다. 폴더 생성은 지원하지 않습니다.",
  missing_file:
    "관찰 시점에 선택한 Markdown 파일이 없었습니다. 새 저장은 기존 agents 폴더 안에 파일만 만듭니다.",
  path_denied: "폴더 또는 파일에 접근할 수 없습니다. 빈 목록이 아닙니다.",
  file_changed: "폴더 또는 파일이 바뀌었습니다. 다시 확인하세요.",
  too_large: "파일 크기가 32KiB를 넘습니다. 내용을 불러오지 않았습니다.",
  unsupported_content:
    "안전한 UTF-8 파일로 읽을 수 없습니다. 기존 초안은 유지합니다.",
};

export function AgentFilesEditor() {
  const id = useId(),
    { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s);
  const files = selectors.agentFiles(state),
    draft = selectors.agentDraft(state);
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const listing = files.listing,
    sourceName = files.sourceName;
  const canRead = selectors.canReadAgentFiles(state);
  const validation =
    draft.validation?.revision === draft.revision
      ? draft.validation
      : undefined;
  const comparison = compareConfigurationDraft(draft.baseline, draft.text);
  const target = workspace ? agentTargetPath(workspace.path, sourceName) : "";
  const save = selectors.agentSave(state);
  const listStatus = files.request
    ? "loading"
    : files.error
      ? "error"
      : listing && !selectors.agentListCurrent(state)
        ? "stale"
        : (listing?.status ?? "not_observed");
  const readStatus = draft.request
    ? "loading"
    : draft.error
      ? "error"
      : (draft.read?.status ?? "not_observed");
  const stale = Boolean(draft.read && !selectors.agentReadCurrent(state));
  useEffect(() => () => actions.cancelAgentRead(), [actions]);
  return (
    <section
      className={styles.fileLoad}
      aria-label="Agent 파일 편집"
      data-agent-source={sourceName}
      data-agent-dirty={String(draft.text !== draft.baseline)}
    >
      <h4 className={styles.heading}>Agent 파일</h4>
      <p className={styles.muted} id={`${id}-scope`}>
        기존 .opencode/agents 안의 평면 Markdown 파일만 선택할 수 있습니다. 폴더
        생성과 삭제는 지원하지 않습니다. 목록 확인은 파일 내용을 읽지 않습니다.
        파일 선택도 내용을 읽지 않습니다.
      </p>
      <p className={styles.muted} data-agent-native="not_observed">
        저장은 파일만 바꿉니다. Native 상태는 아래에서 직접 확인하세요. 등록은
        별도 확인을 거쳐 자동 호출 없이 수행합니다. 등록해도 기본 Agent와 현재
        세션은 그대로입니다. 모델을 시작하지 않습니다.
      </p>
      {workspace && !workspace.trusted && (
        <p
          id={`${id}-trust`}
          role="status"
          className={styles.muted}
          data-agent-trust="untrusted"
        >
          신뢰하지 않은 작업 공간에서는 목록 확인·파일 읽기·저장을 할 수
          없습니다. 기존 ‘새 세션’은 신뢰 확인 뒤 새 대화를 만듭니다. 신뢰를
          확인한 뒤 Agent 목록과 파일을 직접 불러오세요. 이 과정에서 Agent을
          자동 등록하거나 실행하지 않습니다.
        </p>
      )}
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-action="list"
          aria-describedby={
            workspace && !workspace.trusted ? `${id}-trust` : undefined
          }
          disabled={!canRead}
          onClick={() => {
            void actions.listAgentFiles();
          }}
        >
          Agent 파일 목록 확인
        </Button>
      </div>
      <div
        role="status"
        aria-label="Agent 파일 목록 상태"
        data-agent-list-status={listStatus}
        data-agent-list-reason={
          listing && "reason" in listing ? listing.reason : undefined
        }
      >
        <p className={styles.muted}>
          {listStatus === "loading"
            ? "Agent 파일 목록을 확인 중입니다."
            : listStatus === "stale"
              ? "이전 목록입니다. Agent 파일 목록 확인을 다시 선택하세요."
              : files.error
                ? "목록을 확인하지 못했습니다. 다시 확인하세요."
                : listing?.status === "available"
                  ? listing.entries.length
                    ? `기존 파일 ${listing.entries.length}개를 확인했습니다.`
                    : "관찰 시점에 지원하는 기존 파일이 없습니다."
                  : listing
                    ? reasonMessages[listing.reason]
                    : "아직 목록을 확인하지 않았습니다."}
        </p>
        {listing?.status === "available" && listing.truncated && (
          <Notice tone="danger" data-agent-list-truncated="true" role="note">
            목록 일부만 표시합니다. 최대 {AGENT_LIMITS.scan}개 항목을 검사하고{" "}
            {AGENT_LIMITS.entries}개 파일을 표시합니다.
          </Notice>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-source`}>Agent 원본 파일</label>
        <Select
          id={`${id}-source`}
          value={sourceName ?? ""}
          data-agent-source-select
          onChange={(e) => actions.selectAgentFile(e.currentTarget.value)}
        >
          <option value="">원본 파일을 선택하세요.</option>
          {listing?.status === "available" &&
            listing.entries.map((row) => (
              <option key={row.sourceName} value={row.sourceName}>
                {row.sourceName}
              </option>
            ))}
        </Select>
      </div>
      <p className={styles.path} data-agent-path>
        {target}
      </p>
      <p className={styles.muted} id={`${id}-read-help`}>
        불러오기는 선택한 파일 하나만 읽습니다. 성공하면 초안 내용을 파일
        내용으로 바꿉니다. 읽는 동안 편집하거나 대상을 바꾸면 결과를 사용하지
        않습니다. 외부 변경은 자동 확인하지 않습니다.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-action="read"
          disabled={!canRead || !sourceName}
          aria-describedby={`${id}-read-help${workspace && !workspace.trusted ? ` ${id}-trust` : ""}`}
          onClick={() => {
            void actions.readAgentFile();
          }}
        >
          Agent 파일 불러오기
        </Button>
      </div>
      <div
        role="status"
        aria-label="Agent 파일 읽기 상태"
        data-agent-read-status={readStatus}
        data-agent-read-reason={
          draft.read && "reason" in draft.read ? draft.read.reason : undefined
        }
      >
        <p className={styles.muted}>
          {draft.request
            ? "파일을 읽는 중입니다."
            : draft.error
              ? "파일을 읽지 못했습니다. 기존 초안은 유지합니다."
              : draft.read?.status === "available"
                ? "파일의 원본 내용을 불러왔습니다. 형식 검증을 선택하세요."
                : draft.read
                  ? reasonMessages[draft.read.reason]
                  : "아직 파일을 읽지 않았습니다."}
        </p>
        {stale && (
          <p className={styles.muted} data-agent-read-stale="true">
            현재 저장 기준이 아닙니다. 최신 상태를 확인한 뒤 파일을 명시적으로
            다시 불러오세요.
          </p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-text`}>Agent 초안 내용</label>
        <Textarea
          id={`${id}-text`}
          className={styles.textarea}
          value={draft.text}
          disabled={!workspace || !sourceName}
          rows={8}
          wrap="soft"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={Boolean(validation && validation.status !== "valid")}
          aria-describedby={`${id}-scope ${id}-validation ${id}-save`}
          onChange={(e) => actions.editAgentFile(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.stopPropagation();
          }}
        />
      </div>
      <p className={styles.muted}>
        UTF-8 최대 32KiB. 지원하지 않는 frontmatter도 안전하게 읽은 원문을
        편집할 수 있습니다. 일반 Markdown 또는 description, mode: primary,
        color만 포함한 JSON frontmatter를 지원합니다. mode를 생략하면 primary로
        등록합니다.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-action="validate"
          disabled={!sourceName}
          onClick={() => actions.validateAgentFile()}
        >
          형식 검증
        </Button>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-action="save"
          aria-describedby={
            workspace && !workspace.trusted ? `${id}-trust` : undefined
          }
          disabled={!selectors.canSaveAgentFile(state)}
          onClick={() => {
            void actions.saveAgentFile();
          }}
        >
          Agent 파일에 저장
        </Button>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-action="discard"
          disabled={!sourceName}
          onClick={() => actions.discardAgentFile()}
        >
          이 초안 버리기
        </Button>
      </div>
      <div
        id={`${id}-validation`}
        role="status"
        data-agent-validation={validation?.status ?? "not_validated"}
      >
        <p className={styles.muted}>
          {validation
            ? validation.status === "valid"
              ? "형식 검증 통과"
              : validation.status === "unsupported"
                ? "지원하지 않는 형식"
                : "형식 검증 실패"
            : "현재 초안은 미검증입니다."}
        </p>
        {validation?.issues.length ? (
          <Notice tone="danger" role="note">
            <ul className={styles.issues}>
              {validation.issues.map((issue) => (
                <li key={issue}>{agentIssueMessages[issue]}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </div>
      <div
        id={`${id}-save`}
        role="status"
        aria-label="Agent 파일 저장 상태"
        data-agent-save-status={save?.status ?? (draft.save ? "stale" : "idle")}
        data-agent-save-current={String(Boolean(save?.current))}
      >
        <p className={styles.muted}>
          {save?.status === "pending"
            ? "저장 확인 또는 처리 중입니다. 초안은 계속 편집할 수 있습니다."
            : save?.status === "saved"
              ? "파일 저장을 확인했습니다. Native에 등록하거나 활성화하지 않았습니다. 다시 저장하려면 파일을 불러오세요."
              : save?.status === "unknown"
                ? "저장 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다. 원래 요청의 결과를 복구 상태에서 확인하세요."
                : save?.status === "conflict"
                  ? "원본 파일 또는 폴더가 바뀌었습니다. 다시 불러와 비교하세요."
                  : save?.status === "denied"
                    ? "저장이 취소되거나 거부되었습니다. 초안을 유지합니다."
                    : draft.save
                      ? "이전 대상 선택의 저장 기록입니다. 원래 요청 결과는 복구 상태에서 확인하세요. 다시 저장하려면 파일을 불러오세요."
                      : "아직 저장하지 않았습니다. 저장 확인 창에서 전체 대상과 내용, backup 안내를 확인하세요."}
        </p>
        {save && !save.current && (
          <p className={styles.muted}>
            이전 초안의 요청 결과입니다. 현재 수정 내용의 저장 결과가 아닙니다.
          </p>
        )}
        {save?.status === "saved" && save.backupId && (
          <p className={styles.path} data-agent-backup>
            {target.slice(0, target.lastIndexOf("/") + 1)}
            {save.backupId}
          </p>
        )}
      </div>
      <section className={styles.comparison} aria-label="Agent 초안 변경 비교">
        <h4 className={styles.heading}>초안 변경 비교</h4>
        <p
          className={styles.muted}
          data-agent-baseline={
            draft.read?.status === "available"
              ? "read-file"
              : draft.read?.status === "missing"
                ? "missing-file"
                : "memory"
          }
        >
          마지막으로 명시적으로 읽은 원본과 비교합니다. 저장 receipt는 새 파일
          관찰 기준이 아닙니다.
        </p>
        {draft.read?.status === "available" && (
          <p className={styles.path}>읽은 파일 버전: {draft.read.version}</p>
        )}
        <p className={styles.muted}>
          추가 {comparison.added}줄 · 삭제 {comparison.removed}줄 · 변경 줄{" "}
          {comparison.omitted}개 생략
        </p>
        <pre
          className={styles.diff}
          tabIndex={0}
          aria-label="Agent 초안 변경 줄"
        >
          {comparison.rows.map((row, index) => (
            <span
              className={styles.diffRow}
              data-diff-kind={row.kind}
              key={index}
            >
              {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : "="}{" "}
              {row.oldLine ?? "·"} → {row.newLine ?? "·"} {row.text}
              {"\n"}
            </span>
          ))}
        </pre>
      </section>
    </section>
  );
}

function AgentRuntimeRemove({
  nativeId,
  helpId,
}: {
  nativeId: string;
  helpId: string;
}) {
  const { actions } = useWindowWorkbench();
  const allowed = useWorkbenchSelector((s) =>
    selectors.canRemoveAgent(s, nativeId),
  );
  return (
    <div className={styles.actions}>
      <Button
        size="compact"
        intent="secondary"
        type="button"
        data-agent-runtime-remove={nativeId}
        disabled={!allowed}
        aria-describedby={helpId}
        onClick={() => {
          void actions.removeAgent(nativeId);
        }}
      >
        Native 등록 제거
      </Button>
    </div>
  );
}

export function AgentRuntimeControls() {
  const { actions } = useWindowWorkbench();
  const id = useId();
  const state = useWorkbenchSelector((s) => s);
  const entry = selectors.agentRuntime(state);
  const observation = selectors.currentAgentRuntimeObservation(state);
  const observed = observation?.status === "observed" ? observation : undefined;
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const action = entry.action;
  const actionCurrent = selectors.agentRuntimeActionCurrent(state);
  useEffect(() => () => actions.cancelAgentRuntimeObservation(), [actions]);
  return (
    <section
      className={styles.agentRuntime}
      aria-labelledby={`${id}-title`}
      data-agent-runtime
    >
      <h4 className={styles.heading} id={`${id}-title`}>
        Native Agents
      </h4>
      <p className={styles.muted}>
        파일 저장, Native 등록, 다음 요청의 Agent 선택은 별도입니다. 상태 확인을
        직접 선택할 때만 Native 상태를 읽습니다. 앱을 다시 열어도 자동 등록하지
        않습니다. 이전 등록 receipt는 현재 소유권을 증명하지 않습니다.
      </p>
      {workspace && !workspace.trusted && (
        <p data-agent-runtime-trust="untrusted">
          신뢰하지 않는 작업 공간입니다. 기존 ‘새 세션’에서 신뢰를 확인하면 새
          대화도 생성됩니다. 이후 파일과 Native 상태를 직접 확인하세요.
        </p>
      )}
      <p id={`${id}-register-help`}>
        불러온 파일과 초안이 같고, 새 Native 관찰의 원본·digest·파일 버전·폴더
        버전이 일치해야 등록할 수 있습니다. 기존 등록은 교체할 수 없습니다. 먼저
        등록을 제거하고 상태를 다시 확인하세요.
      </p>
      <p data-agent-runtime-policy-help>
        primary · hidden: false. 권한 2개는 * / * / ask, external_directory / *
        / deny입니다. request settings·headers·body는 모두 비어 있습니다. model
        override는 없습니다. 기본 Agent와 현재 세션은 그대로입니다.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-runtime-observe
          disabled={!selectors.canObserveAgentRuntime(state)}
          onClick={() => {
            void actions.observeAgentRuntime();
          }}
        >
          Native 상태 확인
        </Button>
        {entry.request && (
          <Button
            size="compact"
            intent="secondary"
            type="button"
            data-agent-runtime-cancel
            onClick={() => actions.cancelAgentRuntimeObservation()}
          >
            Native 상태 확인 취소
          </Button>
        )}
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-agent-runtime-register
          disabled={!selectors.canRegisterAgent(state)}
          aria-describedby={`${id}-register-help`}
          onClick={() => {
            void actions.registerAgent();
          }}
        >
          primary Agent로 Native에 등록
        </Button>
      </div>
      <p role="status" data-agent-runtime-status>
        {entry.request
          ? "Native 상태를 읽는 중입니다."
          : observation?.status === "unavailable"
            ? `Native 상태를 확인할 수 없습니다: ${observation.reason}. 등록이나 제거를 할 수 없습니다.`
            : observed
              ? "현재 Native 상태를 확인했습니다."
              : "현재 관찰이 없습니다. 파일과 상태를 확인한 뒤 Native 상태 확인을 선택하세요."}
      </p>
      {entry.error && (
        <Notice tone="danger" data-agent-runtime-error role="note">
          Native 상태 확인 실패: {entry.error}. 다시 확인하세요.
        </Notice>
      )}
      {action && (
        <p
          role="status"
          data-agent-runtime-action={action.status}
          data-agent-runtime-action-current={String(actionCurrent)}
        >
          {actionCurrent ? "요청 결과: " : "이전 대상의 요청 결과: "}
          {action.status === "pending"
            ? "확인 또는 처리 중입니다. 초안은 계속 편집할 수 있습니다."
            : action.status === "unknown"
              ? "결과를 확인하지 못했습니다. 자동 재전송하지 않습니다. 복구 상태에서 원래 요청을 확인하세요."
              : action.status === "registered_primary"
                ? "Native 등록을 확인했습니다. 기본 Agent와 현재 세션은 그대로입니다. 새 상태 확인이 필요합니다."
                : action.status === "removed"
                  ? "Native 등록을 제거했습니다. 원본 파일과 세션 기록은 그대로입니다. 새 상태 확인이 필요합니다."
                  : `요청이 거부되었습니다${action.code ? `: ${action.code}` : ""}. 파일과 Native 상태를 다시 확인하세요.`}
        </p>
      )}
      <p id={`${id}-remove-help`}>
        전체 Native 세션의 참조가 0개일 때만 제거할 수 있습니다. archived 세션과
        다른 작업 공간의 세션도 포함합니다. 사용 중이면 기존 Agent 선택에서 다음
        요청의 Agent를 바꾸고 요청을 보내야 Native 세션의 선택이 바뀝니다.
        선택만으로 즉시 바뀌지 않습니다. 자동 전환이나 세션 삭제는 하지
        않습니다.
      </p>
      {observed && (
        <>
          <p className={styles.path} data-agent-runtime-default>
            기본 Native Agent: {observed.defaultAgentId ?? "없음"} · 등록과 제거
            후에도 유지
          </p>
          <p data-agent-runtime-file>
            선택한 파일 관찰:{" "}
            {observed.file
              ? `${observed.file.sourceName} · ${observed.file.status}`
              : "선택한 파일 없음"}
          </p>
          <p>현재 앱이 소유한 Native 등록: {observed.owned.length}개</p>
          <ul className={styles.agentRuntimeRows} data-agent-runtime-owned>
            {observed.owned.map((row) => (
              <li key={row.nativeId} data-agent-runtime-row={row.nativeId}>
                <p>
                  <strong>{row.name}</strong> · primary · hidden: false
                </p>
                {row.description && <p>{row.description}</p>}
                {row.color && <p>color: {row.color}</p>}
                <p className={styles.path}>Native ID: {row.nativeId}</p>
                <p className={styles.path} data-agent-runtime-path>
                  대상 파일: {row.path}
                </p>
                <p className={styles.path}>
                  원본 digest: {row.digest} · system digest: {row.systemDigest}
                </p>
                <pre
                  className={styles.diff}
                  tabIndex={0}
                  aria-label={`${row.name} Native 전체 system`}
                  data-agent-runtime-system
                >
                  {row.system}
                </pre>
                <pre
                  className={styles.diff}
                  tabIndex={0}
                  aria-label={`${row.name} Native 권한 2개`}
                  data-agent-runtime-policy
                >
                  {row.permissions
                    .map((r) => `${r.action} / ${r.resource} / ${r.effect}`)
                    .join("\n")}
                </pre>
                <p data-agent-runtime-request>
                  request: settings: &#123;&#125;, headers: &#123;&#125;, body:
                  &#123;&#125; · model override 없음
                </p>
                <p data-agent-runtime-references={row.referenceCount}>
                  {row.referenceCount > 0
                    ? `등록 사용 중: 전체 Native 세션 ${row.referenceCount}개가 참조합니다. 제거할 수 없습니다.`
                    : "완전한 전체 Native 세션 관찰에서 참조 0개를 확인했습니다."}
                </p>
                <AgentRuntimeRemove
                  nativeId={row.nativeId}
                  helpId={`${id}-remove-help`}
                />
              </li>
            ))}
          </ul>
          <div data-agent-runtime-unowned>
            <p>앱 소유가 아닌 Native 등록 · 읽기 전용</p>
            <ul className={styles.agentRuntimeRows}>
              {observed.unowned.map((row) => (
                <li key={row.nativeId}>
                  {row.name} · {row.nativeId} · mode: {row.mode} · hidden:{" "}
                  {String(row.hidden)} · 읽기 전용
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
