import { useEffect, useId, useState } from "react";
import {
  selectors,
  mcpDefinitions,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import {
  CONFIGURATION_DRAFT_LIMITS,
  compareConfigurationDraft,
  configurationIssueMessages,
  configurationTargetPath,
  type ConfigurationDraft,
  type ConfigurationDraftKind,
} from "../../shared/configuration-draft/index.js";
import styles from "./drafts.module.css";
import { AgentFilesEditor, AgentRuntimeControls } from "./agent-files.js";
export { AgentFilesEditor, AgentRuntimeControls } from "./agent-files.js";
import { SkillFilesEditor } from "./skill-files.js";
import { Button, Notice, Select, Textarea } from "@workbench/ui";
import { Status } from "./status.js";
export { SkillFilesEditor } from "./skill-files.js";

function SkillRuntimeRowActions({
  nativeId,
  helpId,
}: {
  nativeId: string;
  helpId: string;
}) {
  const { actions } = useWindowWorkbench();
  const canRemove = useWorkbenchSelector((state) =>
    selectors.canRemoveSkill(state, nativeId),
  );
  const canApply = useWorkbenchSelector((state) =>
    selectors.canApplySkill(state, nativeId),
  );
  return (
    <div className={styles.actions}>
      <Button
        size="compact"
        intent="secondary"
        type="button"
        data-skill-runtime-remove={nativeId}
        disabled={!canRemove}
        aria-describedby={`${helpId}-remove-help`}
        onClick={() => {
          void actions.removeSkill(nativeId);
        }}
      >
        Native 등록 제거
      </Button>
      <Button
        size="compact"
        intent="secondary"
        type="button"
        data-skill-runtime-apply={nativeId}
        disabled={!canApply}
        aria-describedby={`${helpId}-apply-help`}
        onClick={() => {
          void actions.applySkill(nativeId);
        }}
      >
        선택한 세션에 적용
      </Button>
    </div>
  );
}
function SkillRuntimeControls() {
  const { actions } = useWindowWorkbench();
  const id = useId();
  const entry = useWorkbenchSelector(selectors.skillRuntime);
  const observation = useWorkbenchSelector(
    selectors.currentSkillRuntimeObservation,
  );
  const canObserve = useWorkbenchSelector(selectors.canObserveSkillRuntime);
  const canRegister = useWorkbenchSelector(selectors.canRegisterSkill);
  const workspace = useWorkbenchSelector((state) =>
    state.lists.workspaces.find((w) => w.id === state.selection.workspaceId),
  );
  const session = useWorkbenchSelector((state) =>
    state.lists.sessions.find(
      (s) =>
        s.workspaceId === state.selection.workspaceId &&
        s.id === state.selection.sessionId,
    ),
  );
  const observed = observation?.status === "observed" ? observation : undefined;
  const action = entry.action;
  const actionCurrent = useWorkbenchSelector(
    selectors.skillRuntimeActionCurrent,
  );
  return (
    <section
      className={styles.skillRuntime}
      aria-labelledby={`${id}-title`}
      data-skill-runtime
    >
      <h4 className={styles.heading} id={`${id}-title`}>
        Native Skills
      </h4>
      <p className={styles.muted}>
        파일 저장, Native 등록, 세션 기록은 별도 상태입니다. Native 상태는
        ‘Native 상태 확인’을 선택할 때 읽습니다. 앱을 다시 열어도 자동 등록하지
        않습니다.
      </p>
      {workspace && !workspace.trusted && (
        <p data-skill-runtime-trust="untrusted">
          신뢰하지 않는 작업 공간입니다. 기존 ‘새 세션’에서 신뢰를 확인하면 새
          대화도 생성됩니다.
        </p>
      )}
      <p id={`${id}-register-help`}>
        불러온 파일과 초안이 같고, 새 Native 관찰의 파일 버전과 일치해야 등록할
        수 있습니다. 파일 설정과 관계없이 autoinvoke: false로 등록합니다.
      </p>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-skill-runtime-observe
          disabled={!canObserve}
          onClick={() => {
            void actions.observeSkillRuntime();
          }}
        >
          Native 상태 확인
        </Button>
        {entry.request && (
          <Button
            size="compact"
            intent="secondary"
            type="button"
            data-skill-runtime-cancel
            onClick={() => actions.cancelSkillRuntimeObservation()}
          >
            Native 상태 확인 취소
          </Button>
        )}
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-skill-runtime-register
          disabled={!canRegister}
          aria-describedby={`${id}-register-help`}
          onClick={() => {
            void actions.registerSkill();
          }}
        >
          자동 호출 없이 Native에 등록
        </Button>
      </div>
      <p role="status" data-skill-runtime-status>
        {entry.request
          ? "Native 상태를 읽는 중입니다."
          : observation?.status === "unavailable"
            ? `Native 상태를 확인할 수 없습니다: ${observation.reason}`
            : observed
              ? "현재 Native 상태를 확인했습니다."
              : "현재 관찰이 없습니다. 파일과 상태를 확인한 뒤 Native 상태 확인을 선택하세요."}
      </p>
      {entry.error && (
        <Notice tone="danger" data-skill-runtime-error role="note">
          Native 상태 확인 실패: {entry.error}. 다시 확인하세요.
        </Notice>
      )}
      {action && (
        <p role="status" data-skill-runtime-action={action.status}>
          {actionCurrent ? "요청 결과: " : "이전 대상의 요청 결과: "}
          {action.status === "pending"
            ? "확인 또는 처리 중입니다. 초안은 계속 편집할 수 있습니다."
            : action.status === "unknown"
              ? "결과를 확인하지 못했습니다. 자동 재전송하지 않습니다. 보류 상태가 해제될 때까지 변경할 수 없습니다."
              : action.status === "registered_disabled"
                ? "자동 호출 없이 Native에 등록했습니다. 새 상태 확인이 필요합니다."
                : action.status === "removed"
                  ? "Native 등록을 제거했습니다. 기존 세션 기록은 남습니다."
                  : action.status === "applied"
                    ? "세션에 Native Skill 기록을 추가했습니다. 모델 시작을 요청하지 않았습니다."
                    : `요청이 거부되었습니다${action.code ? `: ${action.code}` : ""}. 파일과 Native 상태를 다시 확인하세요.`}
        </p>
      )}
      <p id={`${id}-apply-help`}>
        ‘선택한 세션에 적용’은 Native Skill 기록을 추가합니다. resume: false로
        모델 시작을 요청하지 않습니다. 모델이 내용을 사용했다는 증거는 아닙니다.
      </p>
      <p id={`${id}-remove-help`}>
        Native 등록 제거는 기존 세션의 Skill 기록이나 내용을 지우지 않습니다.
      </p>
      {observed && (
        <>
          <p data-skill-runtime-file>
            선택한 파일 관찰:{" "}
            {observed.file
              ? `${observed.file.sourceName} · ${observed.file.status}`
              : "선택한 파일 없음"}
          </p>
          <p>현재 앱이 소유한 Native 등록: {observed.owned.length}개</p>
          <ul className={styles.skillRuntimeRows} data-skill-runtime-owned>
            {observed.owned.map((row) => (
              <li key={row.nativeId} data-skill-runtime-row={row.nativeId}>
                <p>
                  <strong>{row.name}</strong> · 자동 호출 꺼짐 · autoinvoke:
                  false
                </p>
                {row.description && <p>{row.description}</p>}
                <p className={styles.path}>Native ID: {row.nativeId}</p>
                <p className={styles.path}>대상 파일: {row.path}</p>
                <p>
                  적용 대상: {workspace?.name} /{" "}
                  {session?.title ?? "선택한 세션 없음"}
                </p>
                <pre
                  className={styles.diff}
                  tabIndex={0}
                  aria-label={`${row.name} Native 전체 내용`}
                  data-skill-runtime-content
                >
                  {row.content}
                </pre>
                {observed.session?.status === "observed" &&
                  observed.session.messages.some(
                    (message) => message.nativeId === row.nativeId,
                  ) && (
                    <p data-skill-runtime-recorded={row.nativeId}>
                      선택한 세션에 이 Native ID의 기록이 있습니다. 다시
                      적용하지 않습니다.
                    </p>
                  )}
                <SkillRuntimeRowActions nativeId={row.nativeId} helpId={id} />
              </li>
            ))}
          </ul>
          <div data-skill-runtime-unowned>
            <p>앱 소유가 아닌 Native 등록 · 읽기 전용</p>
            <ul className={styles.skillRuntimeRows}>
              {observed.unowned.map((row) => (
                <li key={row.nativeId}>
                  {row.name} · {row.nativeId} · 읽기 전용 · 자동 호출:{" "}
                  {row.autoinvoke === true
                    ? "켜짐"
                    : row.autoinvoke === false
                      ? "꺼짐"
                      : "확인 안 됨"}
                </li>
              ))}
            </ul>
          </div>
          <div data-skill-runtime-history>
            <p>선택한 세션의 Skill 기록</p>
            {observed.session?.status === "observed" ? (
              observed.session.messages.length ? (
                <ul className={styles.skillRuntimeRows}>
                  {observed.session.messages.map((message) => (
                    <li key={message.messageId}>
                      {message.name} · {message.nativeId} · 기록 ID:{" "}
                      {message.messageId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>완전한 관찰에서 Skill 기록이 없습니다.</p>
              )
            ) : (
              <p>
                기록을 확인할 수 없습니다
                {observed.session?.status === "unavailable"
                  ? `: ${observed.session.reason}`
                  : " · 선택한 세션 없음"}
                . 기록이 없다고 판단하지 않습니다.
              </p>
            )}
            <p className={styles.muted}>
              표시된 항목은 관찰한 기록입니다. 직접 적용 또는 fork 출처는
              판단하지 않습니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

const readStatusMessages: Record<
  NonNullable<ConfigurationDraft["fileRead"]>["status"],
  string
> = {
  loading: "파일을 읽는 중입니다.",
  available: "파일 관찰 결과가 있습니다.",
  missing: "대상 파일이 없습니다. 기존 초안은 유지합니다.",
  unsupported: "지원하지 않는 파일입니다. 기존 초안은 유지합니다.",
  unavailable: "파일을 읽을 수 없습니다. 기존 초안은 유지합니다.",
  error: "파일 불러오기를 완료하지 못했습니다. 기존 초안은 유지합니다.",
};

function saveStatusMessage(save: ConfigurationDraft["fileSave"]) {
  if (!save) return "아직 파일에 저장하지 않았습니다.";
  switch (save.status) {
    case "pending":
      return save.current
        ? "파일 저장 확인 또는 처리 중입니다. 초안은 계속 편집할 수 있습니다."
        : `이전 초안 버전 ${save.identity.revision}의 저장 확인 또는 처리 중입니다. 현재 수정 내용은 저장되지 않았습니다.`;
    case "saved":
      return save.current
        ? "파일에 저장됨 · 런타임 적용은 별도"
        : `이전 초안 버전 ${save.identity.revision}은 파일에 저장되었습니다. 현재 수정 내용은 저장되지 않았습니다. 런타임 적용은 별도입니다.`;
    case "denied":
      return save.code === "CANCELLED"
        ? "파일 저장이 취소되었습니다. 작성 중인 내용은 유지합니다. 다시 저장하려면 파일을 불러와 비교하세요."
        : "파일 저장이 거부되었습니다. 작성 중인 내용은 유지합니다. 다시 저장하려면 파일을 불러와 비교하세요.";
    case "conflict":
      return "외부에서 파일이 변경되었습니다. 다시 불러와 비교하세요.";
    case "unknown":
      return "저장 결과를 확인하지 못했습니다. 작성 중인 내용과 보관된 파일을 유지합니다.";
  }
}

function readReasonMessage(reason: string) {
  switch (reason) {
    case "missing_file":
      return "읽기 시점에 대상 파일이 없었습니다.";
    case "path_denied":
      return "허용된 작업 공간 파일 경로를 확인할 수 없습니다.";
    case "file_changed":
      return "읽는 동안 파일이나 작업 공간 경로가 바뀌었습니다. 파일 불러오기를 다시 선택하세요.";
    case "too_large":
      return "파일이 UTF-8 기준 32KiB 한도를 초과합니다.";
    case "unsupported_content":
      return "파일 내용이 앱이 지원하는 텍스트 또는 MCP JSON 형식이 아닙니다. 파일 내용은 표시하지 않습니다.";
    case "CANCELLED":
      return "읽기 요청이 취소되었습니다. 다시 읽으려면 파일 불러오기를 선택하세요.";
    case "READ_BUSY":
      return "읽기 요청이 많습니다. 잠시 후 파일 불러오기를 다시 선택하세요.";
    case "READ_TIMEOUT":
      return "읽기 대기 시간이 초과되었습니다. 파일 불러오기를 다시 선택하세요.";
    case "STALE_EPOCH":
      return "읽기 요청의 상태가 바뀌었습니다. 파일 불러오기를 다시 선택하세요.";
    case "UNAVAILABLE":
      return "현재 파일 읽기를 사용할 수 없습니다. 잠시 후 파일 불러오기를 다시 선택하세요.";
    default:
      return "읽기 결과를 확인할 수 없습니다. 파일 불러오기를 다시 선택하세요.";
  }
}

function mcpErrorMessage(code?: string) {
  switch (code) {
    case "MCP_OWNERSHIP_CONFLICT":
      return "같은 Native 이름의 항목이 있습니다. 현재 앱의 소유권을 확인할 수 없어 변경을 막았습니다. 외부 설정을 확인하세요.";
    case "MCP_UNSUPPORTED":
      return "이 정의를 runtime 등록 형식으로 변환할 수 없습니다. remote는 명시적인 oauth:false가 필요합니다. local의 실제 cwd는 확인 창에서 검사합니다.";
    case "MCP_CHANGED":
    case "FILE_CHANGED":
      return "파일 또는 Native 상태가 바뀌었습니다. 파일을 다시 불러오고 MCP 상태 확인을 다시 선택하세요.";
    case "BUSY":
    case "READ_BUSY":
      return "다른 요청 또는 세션 작업이 진행 중입니다. 작업이 끝난 뒤 MCP 상태 확인을 다시 선택하세요.";
    case "CANCELLED":
      return "요청을 취소했습니다. 다시 실행하려면 MCP 상태 확인을 선택하세요.";
    case "MCP_UNVERIFIED":
      return "현재 Native 상태를 확인할 수 없습니다. MCP 상태 확인을 다시 선택하세요.";
    default:
      return "요청을 허용하거나 결과를 확인할 수 없습니다. 작업 공간 신뢰, 경로와 복구 상태를 확인하세요.";
  }
}
const mcpActionMessages = {
  pending: "확인 또는 처리 중입니다. 초안은 계속 편집할 수 있습니다.",
  registered_disabled:
    "비활성 상태로 등록했습니다. 연결하려면 최신 MCP 상태를 확인한 뒤 연결을 선택하세요.",
  connected: "연결 시도 완료 시점에 connected 상태를 확인했습니다.",
  disconnected:
    "연결 해제 시도 완료 시점에 disabled 상태를 확인했습니다. 이 상태만으로 모든 하위 프로세스의 종료를 증명할 수 없습니다.",
  failed:
    "연결 시도는 완료했지만 failed 상태입니다. 외부 MCP 설정을 확인한 뒤 상태를 다시 확인하세요.",
  needs_auth:
    "연결 시도는 완료했지만 needs_auth 상태입니다. 외부 인증 설정을 확인하세요. 이 앱에서는 인증 창을 열지 않습니다.",
  removed: "등록 제거를 확인했습니다. opencode.json 파일은 별도로 유지합니다.",
  denied: "요청이 거부되었습니다.",
  changed: "확인한 파일 또는 Native 상태가 바뀌었습니다.",
  unknown:
    "요청 결과를 확인하지 못했습니다. 원래 요청 키로 결과만 조회합니다. 자동 재전송하지 않습니다. 초안은 계속 편집할 수 있습니다.",
};
function McpControls() {
  const id = useId();
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((value) => value);
  const [sourceName, setSourceName] = useState("");
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const draft = selectors.configurationDraft("mcp")(state);
  const definitions = mcpDefinitions(draft.text);
  const definition = Object.hasOwn(definitions, sourceName)
    ? definitions[sourceName]
    : undefined;
  const mcp = selectors.mcp(state),
    observation = selectors.currentMcpObservation(state);
  const status = mcp.request
    ? "checking"
    : (observation?.status ??
      (mcp.observation ? "stale" : mcp.error ? "error" : "not_observed"));
  const action = mcp.action;
  const actionCurrent = Boolean(
    action?.current &&
      (action.identity.request.type !== "configuration.mcp.register" ||
        (action.identity.draft?.revision === draft.revision &&
          action.identity.draft.text === draft.text)),
  );
  const unsupported = Boolean(
    definition?.type === "remote" && definition.oauth !== false,
  );
  useEffect(() => () => actions.cancelMcpObservation(), [actions]);
  return (
    <section
      className={styles.mcp}
      aria-label="작업 공간 MCP 제어"
      data-mcp-workspace={workspace?.id ?? ""}
    >
      <h4 className={styles.heading}>작업 공간 MCP</h4>
      <p className={styles.path}>
        작업 공간 경로: {workspace?.path ?? "작업 공간을 선택하세요."}
      </p>
      <p className={styles.muted} id={`${id}-scope`}>
        MCP는 이 작업 공간의 모든 세션과 앞으로 만들 세션에 영향을 줍니다.
        세션을 선택할 필요는 없습니다. 파일 저장, 비활성 등록, 연결과 모델의
        도구 사용은 서로 다른 단계입니다.
      </p>
      <p className={styles.muted} data-mcp-removal-prerequisite>
        작업 공간을 목록에서 제거하려면 이 앱이 등록한 MCP 항목을 먼저
        제거하세요. ‘MCP 상태 확인’ 후 아래 앱 소유 항목의 ‘등록 제거’를 각각
        선택하세요. 파일은 유지됩니다.
      </p>
      <p className={styles.muted}>
        관찰은 선택할 때만 실행합니다. 파일 저장, 선택 변경, 창 재활성화와 앱
        재시작은 MCP를 자동 등록하거나 연결하지 않습니다. 이전 요청 기록은 과거
        결과입니다. 앱을 재시작하면 현재 runtime 소유권은 만료됩니다.
      </p>
      {workspace && !workspace.trusted && (
        <div role="status" aria-label="MCP 작업 공간 신뢰 상태">
          <Notice tone="danger" role="note">
            작업 공간 신뢰를 확인하지 않아 MCP 상태 확인과 변경을 사용할 수
            없습니다.
          </Notice>
          <p className={styles.muted}>
            기존 ‘새 세션’을 선택하면 세션 생성 과정에서 신뢰 확인 창이
            표시됩니다. 이 작업은 새 세션을 추가합니다. 확인 후 ‘MCP 상태
            확인’을 선택하세요.
          </p>
        </div>
      )}
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          type="button"
          data-mcp-action="observe"
          disabled={!selectors.canObserveMcp(state)}
          aria-describedby={`${id}-scope`}
          onClick={() => {
            void actions.observeMcp();
          }}
        >
          MCP 상태 확인
        </Button>
      </div>
      <div
        role="status"
        aria-label="작업 공간 MCP 관찰 상태"
        aria-atomic="true"
        data-mcp-status={status}
      >
        <p className={styles.muted}>
          {status === "checking"
            ? "작업 공간 MCP 상태를 확인 중입니다."
            : status === "observed"
              ? "관찰 시점의 Native MCP 상태입니다."
              : status === "unavailable"
                ? "지원하는 Native 목록 또는 작업 공간 경로를 확인할 수 없습니다. 변경을 막았습니다."
                : status === "stale"
                  ? "이전 관찰은 현재 변경의 기준으로 사용할 수 없습니다. MCP 상태 확인을 다시 선택하세요."
                  : status === "error"
                    ? mcpErrorMessage(mcp.error)
                    : "아직 MCP 상태를 확인하지 않았습니다."}
        </p>
        <p className={styles.muted}>
          Native 목록은 상태만 보고합니다. 전체 설정, 인증 정보, PID, 정확한
          프로세스 종료와 모델의 도구 사용을 증명하지 않습니다.
        </p>
        {observation?.status === "observed" && (
          <p className={styles.path}>Native 관찰 버전: {observation.version}</p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-definition`}>등록할 파일 정의</label>
        <Select
          id={`${id}-definition`}
          value={sourceName}
          onChange={(event) => setSourceName(event.currentTarget.value)}
        >
          <option value="">정의를 선택하세요.</option>
          {Object.keys(definitions).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </div>
      <div data-mcp-server={sourceName || undefined}>
        <p className={styles.muted} id={`${id}-register`}>
          등록은 불러오거나 저장한 opencode.json의 원본 내용과 파일 버전이 현재
          초안 및 관찰 기준에 맞을 때 가능합니다. 원본의 disabled:false 또는
          disabled 생략과 관계없이 항상 disabled:true로 등록합니다. 등록만으로
          연결하거나 local 프로세스를 시작하지 않습니다.
        </p>
        {definition?.type === "local" && (
          <>
            <p className={styles.path}>
              파일의 전체 argv: {JSON.stringify(definition.command)}
            </p>
            <p className={styles.path}>
              파일의 cwd:{" "}
              {definition.cwd === undefined ? "생략됨" : definition.cwd}
            </p>
            <p className={styles.muted}>
              실제로 사용할 canonical cwd와 전체 argv는 host 확인 창에서
              확인하세요.
            </p>
          </>
        )}
        {definition?.type === "remote" && (
          <p className={styles.path}>
            파일의 URL: {definition.url} · oauth:{" "}
            {definition.oauth === false ? "false" : "생략됨"}
          </p>
        )}
        {unsupported && (
          <Notice
            tone="danger"
            role="status"
            aria-label="지원하지 않는 MCP 변환"
          >
            파일 검사에서는 oauth 생략을 허용합니다. runtime 등록은 명시적인
            oauth:false가 필요하므로 현재 정의를 등록할 수 없습니다.
          </Notice>
        )}
        {!definition && (
          <p className={styles.muted}>
            지원하는 파일을 불러온 뒤 기존 정의 하나를 선택하세요. 지원하지 않는
            env, headers와 인증 정보는 등록할 수 없습니다.
          </p>
        )}
        <div className={styles.actions}>
          <Button
            size="compact"
            intent="secondary"
            type="button"
            data-mcp-action="register"
            disabled={!selectors.canRegisterMcp(state, sourceName)}
            aria-describedby={`${id}-scope ${id}-register`}
            onClick={() => {
              void actions.registerMcp(sourceName);
            }}
          >
            선택한 정의를 비활성 등록
          </Button>
        </div>
      </div>
      {observation?.status === "observed" && (
        <ul className={styles.mcpServers} aria-label="Native MCP 항목">
          {observation.servers.map((row) => (
            <li
              key={row.nativeName}
              data-mcp-server={
                row.ownership === "current_runtime"
                  ? row.sourceName
                  : row.nativeName
              }
              data-mcp-ownership={row.ownership}
            >
              <p className={styles.path}>
                {row.ownership === "current_runtime"
                  ? row.sourceName
                  : "외부 항목"}{" "}
                · Native 이름: {row.nativeName}
              </p>
              <p className={styles.muted}>
                관찰 상태: {row.status} ·{" "}
                {row.ownership === "current_runtime"
                  ? "현재 runtime에서 앱이 등록한 항목"
                  : "소유권 미확인 · 읽기 전용"}
              </p>
              {row.ownership === "current_runtime" && (
                <>
                  <p className={styles.path}>
                    등록 시 제출한 정의 digest: {row.submittedDefinitionDigest}
                  </p>
                  <p className={styles.muted}>
                    이 digest는 제출한 데이터의 기록입니다. 현재 Native 전체
                    설정의 증명이 아닙니다.
                  </p>
                  <div className={styles.actions}>
                    <Button
                      size="compact"
                      intent="secondary"
                      type="button"
                      data-mcp-action="connect"
                      disabled={!selectors.canConnectMcp(state, row.sourceName)}
                      aria-describedby={`${id}-scope`}
                      onClick={() => {
                        void actions.connectMcp(row.sourceName);
                      }}
                    >
                      연결
                    </Button>
                    <Button
                      size="compact"
                      intent="secondary"
                      type="button"
                      data-mcp-action="disconnect"
                      disabled={
                        !selectors.canDisconnectMcp(state, row.sourceName)
                      }
                      aria-describedby={`${id}-scope`}
                      onClick={() => {
                        void actions.disconnectMcp(row.sourceName);
                      }}
                    >
                      연결 해제
                    </Button>
                    <Button
                      size="compact"
                      intent="secondary"
                      type="button"
                      data-mcp-action="remove"
                      disabled={!selectors.canRemoveMcp(state, row.sourceName)}
                      aria-describedby={`${id}-scope`}
                      onClick={() => {
                        void actions.removeMcp(row.sourceName);
                      }}
                    >
                      등록 제거
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div
        role="status"
        aria-label="작업 공간 MCP 요청 상태"
        aria-atomic="true"
        data-mcp-action-status={action?.status}
        data-mcp-action-current={String(actionCurrent)}
        data-mcp-action-code={action?.code}
      >
        {action && (
          <>
            <p className={styles.muted}>{mcpActionMessages[action.status]}</p>
            <p className={styles.path}>
              요청 대상: {action.identity.request.sourceName} · Native 이름:{" "}
              {action.identity.nativeName}
            </p>
            {!actionCurrent && (
              <p className={styles.muted}>
                이전 초안의 요청 결과입니다. 현재 초안에는 적용하지 않습니다.
              </p>
            )}
            {action.code && (
              <Notice tone="danger" role="note">
                {mcpErrorMessage(action.code)}
              </Notice>
            )}
          </>
        )}
      </div>
      {!selectors.canObserveMcp(state) && !mcp.request && (
        <p className={styles.muted}>
          현재 상태에서는 새 요청을 사용할 수 없습니다. 작업 공간의 모든 세션이
          대기 상태이고, 권한 요청과 다른 변경이 없어야 합니다. 완료한 요청
          뒤에는 최신 snapshot과 명시적인 MCP 상태 확인이 필요합니다.
        </p>
      )}
    </section>
  );
}

export function ConfigurationDraftEditor() {
  const id = useId();
  const [editorKind, setEditorKind] = useState<
    ConfigurationDraftKind | "skills" | "agents"
  >("instructions");
  const kind: ConfigurationDraftKind =
    editorKind === "skills" || editorKind === "agents"
      ? "instructions"
      : editorKind;
  const { actions } = useWindowWorkbench();
  const selection = useWorkbenchSelector(selectors.selection);
  const lists = useWorkbenchSelector(selectors.lists);
  const epoch = useWorkbenchSelector((state) => state.epoch);
  const workspace = lists.workspaces.find(
    (entry) => entry.id === selection.workspaceId,
  );
  const draft = useWorkbenchSelector(selectors.configurationDraft(kind));
  const canSave = useWorkbenchSelector(
    selectors.canSaveConfigurationDraft(kind),
  );
  const saveHeld = useWorkbenchSelector(
    (state) =>
      state.configurationIO.saves > 0 ||
      Object.values(state.operations).some(
        (intent) =>
          intent.operation.type === "configuration.save" &&
          (intent.status === "pending" ||
            ((intent.status === "unknown" || intent.hostHeld) &&
              (!intent.operation.workspaceId ||
                intent.operation.workspaceId === state.selection.workspaceId))),
      ),
  );
  const instructions = useWorkbenchSelector(selectors.instructions);
  const observation = useWorkbenchSelector(selectors.instructionObservation);
  const canObserve = useWorkbenchSelector(selectors.canObserveInstructions);
  const canApply = useWorkbenchSelector(selectors.canApplyInstructions);
  const canRemove = useWorkbenchSelector(selectors.canRemoveInstructions);
  const selectedSession = lists.sessions.find(
    (entry) =>
      entry.id === selection.sessionId && entry.workspaceId === workspace?.id,
  );
  const instructionHeld = useWorkbenchSelector((state) =>
    Object.values(state.operations).some(
      (intent) =>
        (intent.operation.type === "configuration.instructions.apply" ||
          intent.operation.type === "configuration.instructions.remove") &&
        (intent.status === "pending" ||
          ((intent.status === "unknown" || intent.hostHeld) &&
            (!intent.operation.workspaceId ||
              intent.operation.workspaceId === state.selection.workspaceId))),
    ),
  );
  const instructionAction = instructions.action;
  const instructionActionCurrent =
    instructionAction?.current &&
    (instructionAction.identity.request.type ===
      "configuration.instructions.remove" ||
      (instructionAction.identity.draft?.revision === draft.revision &&
        instructionAction.identity.draft.text === draft.text));
  const instructionStatus = instructions.request
    ? "checking"
    : (observation?.status ??
      (instructions.observation
        ? "stale"
        : instructions.error
          ? "error"
          : "not_observed"));
  const fileMatchesRegistration =
    observation?.status === "registered" &&
    draft.fileRead?.status === "available" &&
    draft.baselineFile?.version === observation.sourceVersion &&
    draft.text === draft.baseline;
  const notice = useWorkbenchSelector(selectors.configurationNotice);
  const validation =
    draft.validation?.revision === draft.revision ? draft.validation : null;
  const invalid = Boolean(validation && validation.status !== "valid");
  const comparison = compareConfigurationDraft(draft.baseline, draft.text);
  const filename = kind === "instructions" ? "AGENTS.md" : "opencode.json";
  const targetPath = workspace?.path
    ? configurationTargetPath(workspace.path, kind)
    : filename;
  const save =
    draft.fileSave &&
    draft.fileSave.identity.epoch === epoch &&
    draft.fileSave.identity.workspaceId === workspace?.id &&
    draft.fileSave.identity.path === workspace?.path &&
    draft.fileSave.identity.kind === kind
      ? draft.fileSave
      : undefined;
  const mcpHeld = useWorkbenchSelector((state) =>
    Object.values(state.operations).some(
      (intent) =>
        intent.operation.type.startsWith("configuration.mcp.") &&
        (intent.status === "pending" ||
          ((intent.status === "unknown" || intent.hostHeld) &&
            (!intent.operation.workspaceId ||
              intent.operation.workspaceId === state.selection.workspaceId))),
    ),
  );
  const saveBlocked =
    mcpHeld ||
    instructionHeld ||
    saveHeld ||
    save?.status === "pending" ||
    save?.status === "unknown";
  const savedBaseline = Boolean(
    save?.status === "saved" &&
      save.version &&
      draft.baselineFile?.version === save.version &&
      draft.baselineFile.path === targetPath,
  );
  // A second save replaces fileSave, not the older observed baseline.
  const baselineSource = savedBaseline
    ? "saved-file"
    : save
      ? "observed-file"
      : "file";
  const baselineLabel = savedBaseline
    ? "마지막으로 저장한 파일"
    : save
      ? "마지막으로 확인한 파일"
      : "마지막으로 불러온 파일";
  // Only a confirmed reference is a backup. The operation's planned name is not.
  // Reuse the target helper's separator, preserving literal POSIX backslashes.
  const backupPath =
    save?.status === "saved" &&
    save.backupId &&
    /^\.omoc-configuration-[a-f0-9]{64}\.(instructions|mcp)\.backup$/.test(
      save.backupId,
    ) &&
    save.backupId.endsWith(`.${kind}.backup`)
      ? `${targetPath.slice(0, -filename.length)}${save.backupId}`
      : undefined;
  const loading = draft.fileRead?.status === "loading";
  const readFailed = Boolean(
    draft.fileRead && !["loading", "available"].includes(draft.fileRead.status),
  );

  useEffect(
    () => () => {
      actions.cancelConfigurationLoad(kind);
      if (kind === "instructions") actions.cancelInstructionObservation();
    },
    [actions, kind, editorKind],
  );

  return (
    <section
      className={styles.editor}
      aria-label="설정 초안"
      data-configuration-draft-kind={editorKind}
    >
      <h3 className={styles.heading}>설정 초안</h3>
      <p className={styles.muted} id={`${id}-retention`}>
        저장 전 수정 내용은 이 창의 임시 초안입니다. 파일에 저장을 선택하면 확인
        창에서 저장을 승인합니다. 런타임 적용과 연결은 별도입니다.
      </p>
      <p className={styles.muted}>
        패널을 닫거나 작업 공간을 바꿔도 이 창에서는 유지합니다. 창을 닫으면
        저장하지 않은 내용은 사라집니다. 새 창에서는 초안을 복원하지 않습니다.
      </p>
      {workspace ? (
        <p className={styles.path}>작업 공간: {workspace.path}</p>
      ) : (
        <p role="status" className={styles.muted}>
          등록된 작업 공간을 선택하면 임시 초안을 작성할 수 있습니다.
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor={`${id}-kind`}>초안 종류</label>
        <Select
          id={`${id}-kind`}
          value={editorKind}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (
              value === "instructions" ||
              value === "mcp" ||
              value === "skills" ||
              value === "agents"
            )
              setEditorKind(value);
          }}
        >
          <option value="instructions">AGENTS.md</option>
          <option value="mcp">OpenCode MCP</option>
          <option value="skills">Skills</option>
          <option value="agents">Agents</option>
        </Select>
      </div>
      {editorKind === "agents" ? (
        <>
          <AgentFilesEditor />
          <AgentRuntimeControls />
        </>
      ) : editorKind === "skills" ? (
        <>
          <SkillFilesEditor />
          <SkillRuntimeControls />
        </>
      ) : (
        <>
          <p className={styles.muted} id={`${id}-format`}>
            {kind === "instructions"
              ? "대상: AGENTS.md · 지침 텍스트 초안입니다."
              : "대상: opencode.json · JSON의 mcp.servers 형식 중 앱이 지원하는 항목만 검사합니다."}
          </p>
          <div className={styles.fileLoad}>
            <p className={styles.path} data-configuration-read-target>
              읽기 대상: {targetPath}
            </p>
            <p className={styles.muted} id={`${id}-load-help`}>
              파일 불러오기는 위에 표시한 파일 하나만 읽습니다. 읽기에 성공하면
              선택한 초안 내용을 파일 내용으로 대체하고, 형식 검증 결과를
              지웁니다. 읽는 동안 초안을 변경하면 불러오기를 취소합니다.
            </p>
            <div className={styles.actions}>
              <Button
                size="compact"
                intent="secondary"
                type="button"
                disabled={!workspace?.path || !epoch || loading || saveBlocked}
                data-configuration-action="load"
                aria-describedby={`${id}-load-help`}
                onClick={async () => {
                  await actions.loadConfigurationDraft(kind);
                }}
              >
                파일 불러오기
              </Button>
            </div>
            <div
              role="status"
              aria-label="설정 파일 읽기 상태"
              aria-atomic="true"
              data-configuration-read-status={draft.fileRead?.status}
            >
              <Status error={readFailed}>
                {draft.fileRead
                  ? savedBaseline && draft.fileRead.status === "available"
                    ? "저장 완료 시점의 파일을 확인했습니다."
                    : readStatusMessages[draft.fileRead.status]
                  : "아직 파일을 읽지 않았습니다. 파일 불러오기를 선택하면 읽습니다."}
              </Status>
              {draft.fileRead && (
                <p className={styles.path} data-configuration-read-path>
                  마지막 파일 관찰 경로: {draft.fileRead.path}
                </p>
              )}
              {draft.fileRead?.reason && (
                <Notice
                  tone="danger"
                  data-configuration-read-reason
                  role="note"
                >
                  {readReasonMessage(draft.fileRead.reason)}
                </Notice>
              )}
            </div>
            <p className={styles.muted}>
              파일 상태는 마지막 읽기 또는 저장 완료 시점의 관찰입니다. Native
              활성 상태를 뜻하지 않습니다. 이후 외부 변경은 자동으로 확인하지
              않습니다.
            </p>
          </div>
          <div className={styles.fileSave}>
            <p className={styles.path} data-configuration-save-target>
              저장 대상: {targetPath}
            </p>
            <p className={styles.muted} id={`${id}-save-help`}>
              파일을 먼저 불러와 비교한 뒤 저장하세요. 저장은 위 파일을
              변경합니다. 파일이 없으면 확인 창에서 새 파일 만들기를 승인합니다.
              빈 AGENTS.md도 저장할 수 있으며, 확인 창에서 기존 지침 지우기를
              승인합니다. 형식 검증은 저장 확인과 별도입니다.
            </p>
            <div className={styles.actions}>
              <Button
                size="compact"
                intent="secondary"
                type="button"
                disabled={!canSave || saveBlocked}
                data-configuration-action="save"
                aria-describedby={`${id}-save-help ${id}-save-status`}
                onClick={async () => {
                  await actions.saveConfigurationDraft(kind);
                }}
              >
                파일에 저장
              </Button>
            </div>
            <div
              id={`${id}-save-status`}
              className={styles.saveStatus}
              role="status"
              aria-label="설정 파일 저장 상태"
              aria-atomic="true"
              data-configuration-save-status={save?.status ?? "idle"}
              data-configuration-save-current={
                save ? String(save.current) : "false"
              }
              data-configuration-save-revision={save?.identity.revision}
              data-configuration-save-code={save?.code}
            >
              {save &&
                !save.current &&
                ["denied", "conflict", "unknown"].includes(save.status) && (
                  <p className={styles.muted} data-configuration-save-history>
                    이전 초안 버전 {save.identity.revision}의 저장 요청
                    결과입니다. 현재 수정 내용은 저장되지 않았습니다.
                  </p>
                )}
              <Status
                error={
                  !!save &&
                  ["denied", "conflict", "unknown"].includes(save.status)
                }
                data-configuration-save-message
              >
                {saveStatusMessage(save)}
              </Status>
              {save?.status === "unknown" && (
                <p className={styles.muted}>
                  원본 파일이 변경되었을 수 있습니다. 저장 재시도와 파일
                  불러오기는 중지합니다. 기존 요청의 결과는 작업 복구 상태에서
                  확인하세요.
                </p>
              )}
              {saveBlocked &&
                save?.status !== "pending" &&
                save?.status !== "unknown" && (
                  <p className={styles.muted}>
                    다른 저장 요청이 진행 중이거나 결과를 확인하지 못했습니다.
                    파일 불러오기·저장·비교 기준 변경은 사용할 수 없습니다.
                  </p>
                )}
              {save?.status === "saved" && save.version && (
                <p className={styles.path} data-configuration-save-version>
                  저장 완료 시점의 관찰 버전: {save.version}
                </p>
              )}
              {backupPath && (
                <p className={styles.path} data-configuration-save-backup>
                  확인된 보관 파일: {backupPath}
                </p>
              )}
            </div>
          </div>
          {kind === "mcp" && (
            <McpControls
              key={JSON.stringify([epoch, workspace?.id, workspace?.path])}
            />
          )}
          {kind === "instructions" && (
            <section
              className={styles.instructions}
              aria-label="선택한 세션의 지침 등록"
              data-instructions-session={selection.sessionId ?? ""}
            >
              <h4 className={styles.heading}>선택한 세션의 지침 등록</h4>
              <p className={styles.path}>대상 파일: {targetPath}</p>
              <p className={styles.path}>
                대상 세션:{" "}
                {selectedSession
                  ? `${selectedSession.title} · ${selectedSession.id}`
                  : "세션을 선택하세요."}
              </p>
              <p className={styles.muted} id={`${id}-instructions-help`}>
                파일 저장과 세션 등록은 별도입니다. 상태 확인은 선택한 세션의
                Native 지침 항목을 읽습니다. 등록은 불러오거나 저장한
                AGENTS.md와 초안이 정확히 같을 때 가능합니다. 등록과 제거는 확인
                창에서 승인합니다.
              </p>
              {workspace && !workspace.trusted && (
                <div
                  id={`${id}-instructions-trust`}
                  role="status"
                  data-instructions-trust="untrusted"
                >
                  <Notice tone="danger" role="note">
                    이 작업 공간의 신뢰를 확인하지 않았습니다. 세션 지침의 상태
                    확인·등록·제거를 사용할 수 없습니다.
                  </Notice>
                  <p className={styles.muted}>
                    기존 ‘새 세션’을 선택하여 세션을 만들 때 작업 공간 신뢰 확인
                    창이 표시됩니다. 신뢰를 확인한 뒤 원래 세션을 다시 선택하고
                    ‘세션 등록 상태 확인’을 누르세요. 새 세션 만들기는 세션을
                    추가하며, 지침을 자동 등록하지 않습니다.
                  </p>
                  <p className={styles.muted}>
                    앱에 저장된 등록 기록만으로 현재 Native 지침 상태를 확인할
                    수 없습니다.
                  </p>
                </div>
              )}
              <div className={styles.actions}>
                <Button
                  size="compact"
                  intent="secondary"
                  type="button"
                  data-instructions-action="observe"
                  disabled={!canObserve}
                  aria-describedby={`${id}-instructions-help${workspace && !workspace.trusted ? ` ${id}-instructions-trust` : ""}`}
                  onClick={() => {
                    void actions.observeInstructions();
                  }}
                >
                  세션 등록 상태 확인
                </Button>
                <Button
                  size="compact"
                  intent="secondary"
                  type="button"
                  data-instructions-action="apply"
                  disabled={!canApply}
                  aria-describedby={`${id}-instructions-help ${id}-instructions-effect${workspace && !workspace.trusted ? ` ${id}-instructions-trust` : ""}`}
                  onClick={() => {
                    void actions.applyInstructions();
                  }}
                >
                  이 세션에 지침 등록
                </Button>
                <Button
                  size="compact"
                  intent="secondary"
                  type="button"
                  data-instructions-action="remove"
                  disabled={!canRemove}
                  aria-describedby={`${id}-instructions-remove${workspace && !workspace.trusted ? ` ${id}-instructions-trust` : ""}`}
                  onClick={() => {
                    void actions.removeInstructions();
                  }}
                >
                  이 세션의 지침 등록 제거
                </Button>
              </div>
              <div
                className={styles.saveStatus}
                role="status"
                aria-label="세션 지침 관찰 상태"
                aria-atomic="true"
                data-instructions-status={instructionStatus}
                data-instructions-origin={
                  observation?.status === "registered"
                    ? observation.origin
                    : undefined
                }
              >
                <Status
                  error={
                    instructionStatus === "changed" ||
                    instructionStatus === "unavailable" ||
                    instructionStatus === "error"
                  }
                >
                  {instructionStatus === "checking"
                    ? "선택한 세션의 지침 등록 상태를 확인 중입니다."
                    : observation?.status === "missing"
                      ? "관찰 시점에 이 세션의 앱 지침 항목이 없었습니다. 새 세션에 자동 등록하지 않습니다."
                      : observation?.status === "changed"
                        ? "관찰 시점의 Native 지침이 앱의 저장 기록과 다릅니다. 현재 상태를 기준으로 등록하거나 제거할 수 있습니다."
                        : observation?.status === "unavailable"
                          ? observation.reason === "ownership_conflict"
                            ? "기존 지침 항목의 소유권을 확인할 수 없습니다. 등록과 제거를 사용할 수 없습니다."
                            : "지원하지 않는 Native 지침 항목입니다. 등록과 제거를 사용할 수 없습니다."
                          : observation?.status === "registered"
                            ? observation.origin === "direct"
                              ? "관찰 시점에 이 세션에 직접 등록한 지침을 확인했습니다."
                              : "관찰 시점에 분기할 때 상속한 지침을 확인했습니다."
                            : instructionStatus === "stale"
                              ? "이전 관찰의 상태가 바뀌었습니다. 세션 등록 상태 확인을 다시 선택하세요."
                              : instructions.error
                                ? "세션 등록 상태를 확인하지 못했습니다. 상태 확인을 다시 선택하세요."
                                : "아직 이 세션의 등록 상태를 확인하지 않았습니다."}
                </Status>
                {observation?.status === "registered" &&
                  observation.origin === "fork" && (
                    <p className={styles.path} data-instructions-parent>
                      분기 시점의 상속 출처 세션:{" "}
                      {observation.inheritedFromSessionId}
                    </p>
                  )}
                {observation && observation.status !== "unavailable" && (
                  <p className={styles.path} data-instructions-version>
                    Native 관찰 버전: {observation.version}
                  </p>
                )}
                {observation &&
                  "digest" in observation &&
                  observation.digest && (
                    <p className={styles.path} data-instructions-digest>
                      관찰한 지침 SHA-256: {observation.digest}
                    </p>
                  )}
                {observation?.status === "registered" && (
                  <>
                    <p className={styles.path}>
                      등록 시 파일 버전: {observation.sourceVersion}
                    </p>
                    <p
                      className={styles.muted}
                      data-instructions-file-match={String(
                        fileMatchesRegistration,
                      )}
                    >
                      {fileMatchesRegistration
                        ? "불러오거나 저장한 파일 버전과 현재 초안이 등록 기록에 맞습니다."
                        : "현재 파일 기준 또는 초안이 등록 기록과 다르거나, 파일을 확인하지 않았습니다. 파일을 불러와 비교하세요."}
                    </p>
                  </>
                )}
              </div>
              <div
                role="status"
                aria-label="세션 지침 요청 상태"
                aria-atomic="true"
                data-instructions-action-status={
                  instructionAction?.status ?? "idle"
                }
                data-instructions-action-current={String(
                  Boolean(instructionActionCurrent),
                )}
                data-instructions-action-code={instructionAction?.code}
              >
                {instructionAction && (
                  <Status
                    error={["denied", "changed", "unknown"].includes(
                      instructionAction.status,
                    )}
                  >
                    {instructionAction.status === "pending"
                      ? "지침 변경 확인 또는 처리 중입니다."
                      : instructionAction.status === "registered"
                        ? "등록 요청의 완료를 확인했습니다. 현재 Native 상태는 세션 등록 상태 확인으로 다시 읽으세요."
                        : instructionAction.status === "removed"
                          ? "등록 제거 요청의 완료를 확인했습니다. 현재 Native 상태는 세션 등록 상태 확인으로 다시 읽으세요."
                          : instructionAction.status === "denied"
                            ? instructionAction.code === "FILE_CHANGED"
                              ? "AGENTS.md 파일이 변경되었습니다. 파일을 다시 불러와 비교하고 세션 등록 상태를 확인하세요."
                              : "지침 변경이 취소되거나 거부되었습니다. 초안은 유지합니다. 다시 변경하려면 상태를 확인하세요."
                            : instructionAction.status === "changed"
                              ? "확인 중 지침 상태가 바뀌었습니다. 상태를 다시 확인하세요."
                              : "지침 변경 결과를 확인하지 못했습니다. Native 항목이 바뀌었을 수 있습니다. 자동 재전송하지 않습니다. 원래 요청의 결과를 복구 상태에서 확인하세요."}
                  </Status>
                )}
                {instructionAction && !instructionActionCurrent && (
                  <p className={styles.muted}>
                    이전 초안에 대한 요청 결과입니다. 현재 초안에 적용한 결과가
                    아닙니다.
                  </p>
                )}
              </div>
              <p className={styles.muted} id={`${id}-instructions-remove`}>
                제거는 선택한 세션의 앱 지침 등록만 지웁니다. AGENTS.md 파일과
                대화 기록은 유지합니다. 이전 context는 지우지 않습니다. 파일이
                없어도 등록을 제거할 수 있습니다.
              </p>
              <p className={styles.muted} id={`${id}-instructions-effect`}>
                등록된 항목은 다음 context preparation의 대상입니다. provider가
                실제로 지침을 받거나 따랐는지는 확인하지 않았습니다. 파일
                불러오기·저장·세션 선택은 자동 등록하지 않습니다. 다른 설정과
                MCP 연결은 별도입니다.
              </p>
            </section>
          )}
          <div className={styles.field}>
            <label htmlFor={`${id}-text`}>설정 초안 내용</label>
            <Textarea
              id={`${id}-text`}
              className={styles.textarea}
              value={draft.text}
              disabled={!workspace}
              rows={8}
              wrap="soft"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={`${id}-retention ${id}-format ${id}-limit ${id}-validation ${id}-save-status`}
              onChange={(event) =>
                actions.editConfigurationDraft(kind, event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
            />
          </div>
          <p className={styles.muted} id={`${id}-limit`}>
            UTF-8 기준 최대 {CONFIGURATION_DRAFT_LIMITS.bytes / 1024}KiB · 이
            창에 최대 {CONFIGURATION_DRAFT_LIMITS.entries}개 초안
          </p>
          <div className={styles.actions}>
            <Button
              size="compact"
              intent="secondary"
              type="button"
              disabled={!workspace}
              onClick={() => actions.validateConfigurationDraft(kind)}
            >
              형식 검증
            </Button>
            <Button
              size="compact"
              intent="secondary"
              type="button"
              disabled={!workspace || loading || saveBlocked}
              data-configuration-action="baseline"
              onClick={() => actions.baselineConfigurationDraft(kind)}
            >
              현재 초안을 비교 기준으로
            </Button>
            <Button
              size="compact"
              intent="secondary"
              type="button"
              disabled={!workspace}
              data-configuration-action="discard"
              onClick={() => actions.discardConfigurationDraft(kind)}
            >
              이 초안 버리기
            </Button>
          </div>
          {notice && (
            <Notice tone="danger" role="status">
              {notice}
            </Notice>
          )}
          <div
            id={`${id}-validation`}
            role="status"
            aria-atomic="true"
            data-draft-validation={validation?.status}
          >
            <Status error={invalid}>
              현재 초안 버전: {draft.revision} ·{" "}
              {validation
                ? `검증 버전: ${validation.revision} · ${
                    validation.status === "valid"
                      ? "형식 검증 통과"
                      : validation.status === "unsupported"
                        ? "지원하지 않는 형식"
                        : "형식 검증 실패"
                  }`
                : "현재 버전 미검증 · 내용 변경 후 다시 검증하세요."}
            </Status>
            {validation && validation.issues.length > 0 && (
              <Notice tone="danger" role="note">
                <ul className={styles.issues}>
                  {validation.issues.map((issue) => (
                    <li key={issue}>{configurationIssueMessages[issue]}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
          <p className={styles.muted}>
            {kind === "instructions"
              ? "검증은 텍스트 형식과 크기만 확인합니다. 지침의 정책이나 실행 안전성을 보장하지 않습니다."
              : "검증 통과는 앱이 지원하는 형식이라는 뜻입니다. Native의 수용이나 서버 연결을 확인한 결과가 아닙니다."}{" "}
            편집과 형식 검증은 파일이나 활성 상태를 바꾸지 않습니다.
          </p>
          <section className={styles.comparison} aria-label="초안 변경 비교">
            <h4 className={styles.heading}>초안 변경 비교</h4>
            <p
              className={styles.muted}
              data-configuration-baseline={
                draft.baselineFile
                  ? baselineSource
                  : draft.baseline === ""
                    ? "new"
                    : "memory"
              }
            >
              {draft.baselineFile
                ? `${baselineLabel} 기준`
                : draft.baseline === ""
                  ? "새 초안 기준 · 실제 파일과 비교하지 않음"
                  : "이 창의 메모리 기준 · 실제 파일과 비교하지 않음"}
            </p>
            {draft.baselineFile && (
              <>
                <p className={styles.path} data-configuration-baseline-path>
                  {baselineLabel} 경로: {draft.baselineFile.path}
                </p>
                <p className={styles.path} data-configuration-baseline-version>
                  {savedBaseline ? "저장 완료 시점" : "마지막 파일 확인 시점"}의
                  관찰 버전: {draft.baselineFile.version}
                </p>
                <p className={styles.muted} data-configuration-baseline-warning>
                  마지막 관찰 뒤 외부에서 파일이 바뀌었을 수 있습니다. 현재
                  디스크 내용과 다를 수 있으며, 외부 변경은 자동으로 확인하지
                  않습니다. 이 비교는 Native 활성 상태를 확인하지 않습니다.
                </p>
              </>
            )}
            <p className={styles.muted}>
              비교 기준 변경과 초안 버리기는 선택한 초안에만 적용합니다. 파일을
              변경하지 않습니다.
            </p>
            {!comparison.bounded ? (
              <Notice tone="danger" role="note">
                비교 크기 한도를 초과했습니다.
              </Notice>
            ) : !comparison.added && !comparison.removed ? (
              <p className={styles.muted}>비교 기준과 다른 내용이 없습니다.</p>
            ) : (
              <>
                <p className={styles.muted}>
                  추가 {comparison.added}줄 · 삭제 {comparison.removed}줄
                </p>
                <p className={styles.muted} id={`${id}-legend`}>
                  + 추가 · - 삭제 · = 문맥 · 이전 줄 → 초안 줄. 공통 앞뒤 줄을
                  기준으로 비교하며, 최소 변경 결과를 보장하지 않습니다.
                </p>
                <pre
                  className={styles.diff}
                  tabIndex={0}
                  aria-label="초안 변경 줄"
                  aria-describedby={`${id}-legend`}
                >
                  {comparison.rows.map((row, index) => (
                    <span
                      className={styles.diffRow}
                      data-diff-kind={row.kind}
                      key={index}
                    >
                      {row.kind === "added"
                        ? "+"
                        : row.kind === "removed"
                          ? "-"
                          : "="}{" "}
                      {row.oldLine ?? "·"} → {row.newLine ?? "·"} {row.text}
                      {"\n"}
                    </span>
                  ))}
                </pre>
                <p className={styles.muted}>
                  변경 줄 {comparison.omitted}개를 생략했습니다.
                </p>
                <p className={styles.muted}>
                  최대 {CONFIGURATION_DRAFT_LIMITS.diffRows}줄 표시
                </p>
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}
