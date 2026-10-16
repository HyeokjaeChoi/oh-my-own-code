import { GitBranchRestoreSection } from "./branch-restore.js";
import { useId, useRef } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import type {
  GitDiffMode,
  GitDiffReason,
  GitFileState,
} from "../../shared/git-review/index.js";
import {
  validGitIndexPaths,
  type GitIndexReason,
  type GitIndexEntry,
} from "../../shared/api/index.js";
import styles from "./review.module.css";
import { Button, Input, Select, Textarea } from "@workbench/ui";

const indexReasons: Partial<Record<GitIndexReason, string>> = {
  platform_unavailable: "현재 운영 체제에서 index 변경을 지원하지 않습니다.",
  read_failed:
    "Index 변경을 준비하지 못했습니다. 파일 접근과 읽기 전용 설정을 확인하세요.",
  path_denied: "이 경로의 index 변경을 허용할 수 없습니다.",
  expired_preview: "Preview가 만료됐습니다. Preview를 다시 요청하세요.",
  stale_preview: "Preview 기준이 변경됐습니다. Git 상태를 다시 확인하세요.",
  lock_conflict: "다른 작업이 index.lock을 사용합니다. 잠금을 지우지 않습니다.",
  no_changes: "선택한 경로의 index 변경이 없습니다. 적용할 수 없습니다.",
  busy: "다른 작업이 진행 중입니다. 잠시 후 직접 다시 시도하세요.",
  unsupported_index_mutation:
    "현재 Git 또는 index 형식은 변경을 지원하지 않습니다.",
  protected_source: "보호된 경로입니다. Index 변경을 요청할 수 없습니다.",
};
const indexEntryText = (e: GitIndexEntry | null) =>
  e ? `${e.mode.toString(8)} / ${e.oid}` : "없음";

const states: Record<GitFileState, string> = {
  none: "변경 없음",
  added: "추가",
  modified: "수정",
  deleted: "삭제",
  type_changed: "종류 변경",
  unmerged: "충돌",
};
const reasons: Record<GitDiffReason, string> = {
  not_repository: "Git 저장소가 아닙니다.",
  not_repository_root: "등록한 폴더가 실제 worktree 루트가 아닙니다.",
  platform_unavailable: "현재 운영 체제에서 Git 읽기를 지원하지 않습니다.",
  git_unavailable: "검증된 Git 실행 파일을 사용할 수 없습니다.",
  unsupported_repository: "이 저장소 형식은 지원하지 않습니다.",
  unsupported_configuration:
    "이 저장소의 설정 또는 변환 규칙은 지원하지 않습니다.",
  path_denied: "경로 접근을 허용할 수 없습니다.",
  path_changed: "경로가 변경되었습니다. Git 상태를 다시 확인하세요.",
  metadata_changed:
    "Git metadata가 변경되었습니다. Git 상태를 다시 확인하세요.",
  too_large: "읽기 한도를 초과했습니다. 일부 결과를 대신 표시하지 않습니다.",
  read_failed: "Git 내용을 읽지 못했습니다.",
  process_unverified:
    "Git 읽기 종료를 확인하지 못했습니다. 이 작업 공간의 읽기를 보류합니다.",
  protected_source: "보호된 파일의 내용은 표시하지 않습니다.",
  binary: "Binary 또는 지원하지 않는 텍스트입니다. Patch를 표시하지 않습니다.",
  missing_file: "비교할 파일을 찾을 수 없습니다.",
  conflict: "충돌한 파일입니다. 해결된 patch로 표시할 수 없습니다.",
  not_staged:
    "Untracked 파일은 staged 차이가 없습니다. Unstaged 또는 기준 branch를 선택하세요.",
  expired_observation: "관찰이 만료됐습니다. Git 상태를 다시 확인하세요.",
  stale_observation: "관찰한 내용이 변경됐습니다. Git 상태를 다시 확인하세요.",
};
const errors: Record<string, string> = {
  GIT_INDEX_UNVERIFIED:
    "Index Preview를 검증하지 못했습니다. 직접 다시 확인하세요.",
  READ_BUSY: "다른 읽기가 진행 중입니다. 잠시 후 직접 다시 시도하세요.",
  READ_TIMEOUT: "읽기 시간이 초과됐습니다. 직접 다시 시도하세요.",
  CANCELLED: "읽기를 취소했습니다.",
  STALE: "현재 기준이 바뀌었습니다. Git 상태를 다시 확인하세요.",
  GIT_UNVERIFIED: "Git 응답의 형식 또는 범위를 확인하지 못했습니다.",
};
function errorMessage(code: string) {
  return (
    errors[code] ??
    "Git 읽기를 완료하지 못했습니다. Git 상태를 다시 확인하세요."
  );
}
const commitDisabled: Record<string, string> = {
  HISTORICAL: "보존한 초안입니다. 현재 작업 공간 초안을 선택하세요.",
  NO_WORKSPACE: "작업 공간을 선택하세요.",
  UNTRUSTED:
    "신뢰한 작업 공간에서만 Commit을 만들 수 있습니다. 초안은 편집할 수 있습니다.",
  HELD: "Recovery 또는 진행 중인 작업으로 보류합니다. 초안은 편집할 수 있습니다.",
  NOT_READY:
    "연결된 현재 상태와 작업 공간의 모든 세션이 idle인지 확인해야 합니다.",
  READ_REQUIRED: "Git 상태 새로고침을 먼저 누르세요.",
  AUTHOR_REQUIRED:
    "작성자 이름과 이메일을 직접 입력하세요. 앞뒤 공백과 지원하지 않는 문자는 사용할 수 없습니다.",
  MESSAGE_REQUIRED: "비어 있지 않은 Commit 메시지를 입력하세요.",
  READ_BUSY: "다른 읽기가 진행 중입니다. 완료 후 직접 다시 시도하세요.",
};
const commitRefusals: Record<string, string> = {
  no_changes: "현재 staged tree에 Commit할 변경이 없습니다.",
  unsupported_commit_state:
    "진행 중인 merge, rebase 또는 다른 Git 작업을 먼저 해결하세요.",
  unsupported_commit: "이 저장소의 Commit 형식을 지원하지 않습니다.",
  identity_changed:
    "작성자 원본을 보존하지 못했습니다. Commit을 만들지 않습니다.",
};
function GitCommitSection() {
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s),
    g = selectors.gitCommit(state),
    draft = selectors.gitCommitDraft(state),
    current = selectors.currentGitCommitPreview(state),
    preview = g.preview,
    reason = selectors.gitCommitDisabledReason(state),
    draftKey = selectors.gitCommitDraftKey(state),
    currentKey = selectors.currentGitCommitDraftKey(state);
  const prefix = useId(),
    statusRef = useRef<HTMLParagraphElement>(null);
  const status = g.request
    ? "loading"
    : current
      ? current.status
      : preview
        ? "stale"
        : "empty";
  const operations = Object.values(state.operations).filter(
    (i) => i.operation.type === "git.commit.apply",
  );
  return (
    <section
      aria-label="전체 staged 변경 Commit"
      data-git-commit-state={status}
    >
      <h4>전체 staged 변경 Commit</h4>
      <p>
        현재 index의 모든 staged 변경을 한 번에 Commit합니다. 경로 선택과
        관계없이 전체가 포함됩니다. 자동 Stage는 없습니다.
      </p>
      <p>
        로컬 Commit만 만듭니다. 서명과 hooks를 실행하지 않습니다. 네트워크로
        전송하지 않습니다. 적용 버튼 뒤의 Main 확인에서 취소할 수 있습니다.
      </p>
      <fieldset className={styles.selection}>
        <legend>Commit 초안</legend>
        <label htmlFor={`${prefix}-draft`}>보존한 Commit 초안</label>
        <Select
          id={`${prefix}-draft`}
          value={draftKey === currentKey ? "" : (draftKey ?? "")}
          onChange={(e) =>
            actions.selectGitCommitDraft(e.target.value || undefined)
          }
        >
          <option value="">현재 작업 공간 초안</option>
          {Object.entries(state.gitCommitDrafts)
            .filter(([key]) => key !== currentKey)
            .map(([key, d]) => (
              <option key={key} value={key}>
                {d.workspacePath} · {d.epoch} · 보존한 초안
              </option>
            ))}
        </Select>
        {draftKey !== currentKey && (
          <p role="status">
            보존한 초안은 편집과 복사만 가능합니다. 현재 요청에 사용하지
            않습니다.
          </p>
        )}
        <label htmlFor={`${prefix}-name`}>Commit 작성자 이름</label>
        <Input
          id={`${prefix}-name`}
          autoComplete="off"
          spellCheck={false}
          value={draft.name}
          onChange={(e) => actions.editGitCommit({ name: e.target.value })}
        />
        <label htmlFor={`${prefix}-email`}>Commit 작성자 이메일</label>
        <Input
          id={`${prefix}-email`}
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={draft.email}
          onChange={(e) => actions.editGitCommit({ email: e.target.value })}
        />
        <label htmlFor={`${prefix}-message`}>Commit 메시지</label>
        <Textarea
          id={`${prefix}-message`}
          rows={5}
          spellCheck={false}
          value={draft.message}
          onChange={(e) => actions.editGitCommit({ message: e.target.value })}
        />
        <p>
          작성자와 committer는 같은 이름, 이메일과 UTC 시각을 사용합니다. 이름과
          이메일은 자동으로 채우거나 다듬지 않습니다. 메시지 끝에 LF가 없으면 LF
          하나만 추가합니다.
        </p>
      </fieldset>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          disabled={!selectors.canPreviewGitCommit(state)}
          aria-describedby={`${prefix}-disabled`}
          onClick={() => {
            void actions
              .previewGitCommit()
              .then(() => statusRef.current?.focus());
          }}
        >
          전체 staged Commit 미리보기
        </Button>
        <Button
          size="compact"
          intent="secondary"
          disabled={!g.request}
          onClick={() => {
            actions.cancelGitCommitPreview();
            statusRef.current?.focus();
          }}
        >
          Commit 미리보기 취소
        </Button>
        <Button
          size="compact"
          intent="secondary"
          disabled={!selectors.canApplyGitCommit(state)}
          aria-describedby={`${prefix}-disabled`}
          onClick={() => {
            void actions
              .applyGitCommit()
              .then(() => statusRef.current?.focus());
          }}
        >
          전체 staged Commit 적용
        </Button>
      </div>
      <p id={`${prefix}-disabled`}>
        {reason
          ? commitDisabled[reason]
          : current?.status === "available"
            ? "미리보기를 검토한 후 적용하세요. 미리보기는 최대 60초 동안 유효합니다."
            : "현재 전체 staged Commit 미리보기가 필요합니다."}
      </p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.status}
      >
        {g.request
          ? "Commit 미리보기 읽는 중…"
          : g.error === "EXPIRED"
            ? "Commit 미리보기가 만료됐습니다. 직접 다시 미리보기 하세요."
            : g.error === "GIT_COMMIT_UNVERIFIED"
              ? "Commit 미리보기를 검증하지 못했습니다."
              : g.error
                ? errorMessage(g.error)
                : current?.status === "unavailable"
                  ? (commitRefusals[current.reason] ??
                    (reasons as Partial<Record<string, string>>)[
                      current.reason
                    ] ??
                    "Commit 미리보기를 사용할 수 없습니다.")
                  : current?.status === "available"
                    ? "전체 staged Commit 미리보기 완료"
                    : "Commit 미리보기를 직접 확인하세요."}
        {preview &&
          !current &&
          " 마지막 미리보기입니다. 현재 적용의 기준으로 사용할 수 없습니다."}
      </p>
      {preview?.status === "available" && (
        <>
          <dl className={styles.metadata} aria-label="Commit 미리보기 출처">
            <dt>작업 공간</dt>
            <dd>{preview.workspacePath}</dd>
            <dt>Runtime epoch / revision</dt>
            <dd>
              {preview.runtimeEpoch} / {preview.revision}
            </dd>
            <dt>작성자 / committer</dt>
            <dd>
              {preview.author.name} &lt;{preview.author.email}&gt;
            </dd>
            <dt>UTC 시각 / Unix seconds</dt>
            <dd>
              {preview.timestamp <= 8640000000000
                ? new Date(preview.timestamp * 1000).toISOString()
                : "UTC 시각 표시 범위 초과"}{" "}
              / {preview.timestamp}
            </dd>
            <dt>대상</dt>
            <dd>
              {preview.reference.kind === "head"
                ? "Detached HEAD · HEAD 교체"
                : `${preview.headOid === null ? "Unborn · 첫 Commit" : "Branch"} · ${preview.reference.name} 갱신 · symbolic HEAD 유지`}
            </dd>
            <dt>원본 reference 파일</dt>
            <dd>
              {preview.reference.exists
                ? "존재함 · 원본 backup 보존"
                : "없음 · 새 파일 생성 · backup 없음 (packed reference와 구분)"}
            </dd>
            <dt>Parent OID</dt>
            <dd>{preview.headOid ?? "없음 · 첫 Commit"}</dd>
            <dt>Tree OID</dt>
            <dd>{preview.treeOid}</dd>
            <dt>Commit OID</dt>
            <dd>{preview.commitOid}</dd>
            <dt>Object format</dt>
            <dd>{preview.objectFormat}</dd>
            <dt>Preview ID / digest</dt>
            <dd>
              {preview.previewId}
              {"\n"}
              {preview.previewDigest}
            </dd>
            <dt>Index digest / tree digest / commit body digest</dt>
            <dd>
              {preview.indexDigest}
              {"\n"}
              {preview.treeDigest}
              {"\n"}
              {preview.commitBodyDigest}
            </dd>
            <dt>Reference digest: 원본 → 변경 후</dt>
            <dd>
              {preview.reference.digest}
              {" → "}
              {preview.reference.nextDigest}
            </dd>
            <dt>Reflog 효과 (표시 순서대로 적용 후 reference 갱신)</dt>
            <dd>
              {preview.logs.length
                ? preview.logs
                    .map(
                      (x) =>
                        `${x.role} · ${x.exists ? "원본 backup 보존" : "새 파일 · backup 없음"} · ${x.nextBytes} bytes\n${x.digest} → ${x.nextDigest}`,
                    )
                    .join("\n")
                : "Reflog 변경 없음"}
            </dd>
          </dl>
          <h5>실제 Commit 메시지 (끝 LF 포함)</h5>
          <pre
            className={styles.commitMessage}
            tabIndex={0}
            aria-label="실제 Commit 메시지"
          >
            {preview.canonicalMessage}
          </pre>
          <p>
            메시지 UTF-8:{" "}
            {new TextEncoder().encode(preview.canonicalMessage).length} bytes ·
            끝 LF 1개 이상. 원래 BOM과 CRLF를 유지합니다.
          </p>
          <p>전체 staged 경로: {preview.entries.length}개</p>
          <ol className={styles.rows} aria-label="전체 staged Commit 경로">
            {preview.entries.map((e) => (
              <li key={e.path}>
                <strong>{e.path}</strong>
                <div>
                  변경 전:{" "}
                  {e.before
                    ? `${e.before.mode.toString(8)} · ${e.before.oid}`
                    : "없음"}
                </div>
                <div>
                  변경 후:{" "}
                  {e.after
                    ? `${e.after.mode.toString(8)} · ${e.after.oid}`
                    : "삭제"}
                </div>
              </li>
            ))}
          </ol>
          <p>
            원본 index와 worktree 내용은 유지합니다. Reflog와 reference 전체는
            하나의 atomic 변경이 아닙니다. 일부 변경 뒤 실패하면 결과를 확인할
            때까지 보류합니다.
          </p>
        </>
      )}
      {operations.length > 0 && (
        <ul className={styles.rows} aria-label="Commit 요청 결과">
          {operations.map((i) => (
            <li
              key={JSON.stringify([i.epoch, i.id])}
              data-git-commit-operation-state={i.status}
            >
              <dl className={styles.metadata}>
                <dt>원래 Runtime epoch / Operation ID</dt>
                <dd>
                  {i.epoch} / {i.id}
                </dd>
                <dt>원래 작업 공간</dt>
                <dd>
                  {i.gitCommitMutation?.workspacePath ??
                    i.operation.workspaceId}
                </dd>
                <dt>결과</dt>
                <dd>
                  {i.status === "accepted"
                    ? "Commit 완료를 확인했습니다. Git 상태를 직접 새로고침하세요."
                    : i.status === "failed"
                      ? "Commit 요청을 거부했습니다."
                      : i.status === "pending"
                        ? "Main 확인 또는 Commit 처리 대기 중"
                        : "결과를 확인하지 못했습니다. 원래 요청 키로 조회만 합니다. 다시 전송하지 않습니다."}
                  {state.gitCommitIO[JSON.stringify([i.epoch, i.id])] &&
                    " 원래 호출이 끝날 때까지 IO 보류를 유지합니다."}
                </dd>
                {i.receipt?.result?.kind === "git_commit_created" && (
                  <>
                    <dt>확인한 Commit / Tree</dt>
                    <dd>
                      {i.receipt.result.commitOid}
                      {"\n"}
                      {i.receipt.result.treeOid}
                    </dd>
                    <dt>보존한 backup</dt>
                    <dd>
                      {i.receipt.result.backups
                        .map(
                          (x) =>
                            `${x.role}: ${x.backupId ?? "없음 · 원본 파일 없음"}`,
                        )
                        .join("\n")}
                    </dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function GitReviewPanel() {
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s),
    g = selectors.gitReview(state),
    index = selectors.gitIndex(state),
    currentIndex = selectors.currentGitIndexPreview(state);
  const indexPreview = index.preview;
  const indexStatus = index.request
    ? "loading"
    : currentIndex
      ? currentIndex.status
      : indexPreview
        ? "stale"
        : "empty";
  const current = selectors.currentGitReviewObservation(state);
  const observation = g.observation;
  const detail = g.detail;
  const currentDetail = selectors.currentGitDiffObservation(state);
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const held = selectors.gitReviewHeld(state);
  const available = current?.status === "available";
  const statusRef = useRef<HTMLParagraphElement>(null),
    detailRef = useRef<HTMLParagraphElement>(null),
    indexRef = useRef<HTMLParagraphElement>(null);
  const prefix = useId();
  const status = g.request
    ? "loading"
    : g.error
      ? "stale"
      : current
        ? current.status
        : observation
          ? "stale"
          : "empty";
  const detailStatus = g.detailRequest
    ? "loading"
    : g.detailError
      ? "error"
      : currentDetail
        ? currentDetail.status
        : detail
          ? "stale"
          : "empty";
  const selectRow = (path: string, mode: "staged" | "unstaged") => {
    actions.selectGitMode(mode);
    actions.selectGitPath(path);
  };
  return (
    <section
      className={styles.review}
      aria-label="Git 변경 검토"
      data-git-review-state={status}
    >
      <h3>Git 변경 검토</h3>
      <p>상태와 차이는 마지막 관찰입니다. 버튼을 눌러 확인하세요.</p>
      <dl className={styles.metadata} aria-label="Git 작업 공간">
        <dt>선택한 작업 공간</dt>
        <dd>{workspace?.path ?? "작업 공간을 선택하세요."}</dd>
      </dl>
      {workspace && !workspace.trusted && (
        <p>
          실행 신뢰가 없는 작업 공간입니다. Git 읽기는 구성을 실행하지 않습니다.
        </p>
      )}
      {held && (
        <p role="status">
          Recovery 또는 앱 작업 처리로 Git 읽기를 보류합니다. 파일 초안은 계속
          편집할 수 있습니다.
        </p>
      )}
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          disabled={!selectors.canObserveGitReview(state)}
          onClick={() => {
            void actions
              .observeGitReview()
              .then(() => statusRef.current?.focus());
          }}
        >
          Git 상태 새로고침
        </Button>
        <Button
          size="compact"
          intent="secondary"
          disabled={!g.request}
          onClick={() => {
            actions.cancelGitReview();
            statusRef.current?.focus();
          }}
        >
          Git 상태 읽기 취소
        </Button>
      </div>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.status}
      >
        {g.request
          ? "Git 상태 읽는 중…"
          : g.error
            ? errorMessage(g.error)
            : current?.status === "unavailable"
              ? reasons[current.reason]
              : available
                ? "Git 상태 관찰 완료"
                : "Git 상태를 직접 확인하세요."}
        {observation &&
          !current &&
          " 마지막 관찰만 표시합니다. 현재 읽기의 기준으로 사용할 수 없습니다."}
        {!g.retryReady && " 다시 시도 준비 중…"}
      </p>
      {observation && (
        <dl className={styles.metadata} aria-label="관찰한 Git 출처">
          <dt>관찰한 작업 공간</dt>
          <dd>{observation.workspacePath}</dd>
          <dt>Runtime epoch / revision</dt>
          <dd>
            {observation.runtimeEpoch} / {observation.revision}
          </dd>
          {observation.status === "available" && (
            <>
              <dt>Worktree 루트</dt>
              <dd>{observation.repository.worktreePath}</dd>
              <dt>Git directory</dt>
              <dd>{observation.repository.gitDirectory}</dd>
              <dt>Common directory</dt>
              <dd>{observation.repository.commonDirectory}</dd>
              <dt>HEAD</dt>
              <dd>
                {observation.repository.head ?? "Unborn · 아직 commit 없음"}
              </dd>
              <dt>Branch</dt>
              <dd>{observation.repository.branch ?? "Detached HEAD"}</dd>
              <dt>Observation ID</dt>
              <dd>{observation.observationId}</dd>
            </>
          )}
        </dl>
      )}
      <p>
        Staged는 HEAD → index, Unstaged는 index → worktree입니다. Rename은
        삭제와 추가 경로로 나누어 표시합니다.
      </p>
      <GitCommitSection />
      <GitBranchRestoreSection />
      <section
        aria-label="선택한 Git index 변경"
        data-git-index-state={indexStatus}
      >
        <h4>선택한 경로의 Stage / Unstage</h4>
        <p>
          Stage는 선택한 경로의 staged 내용을 현재 worktree 내용으로 교체합니다.
          Unstage는 staged 내용을 HEAD 상태로 되돌립니다. 기존 staged 내용은
          사라질 수 있습니다. Worktree 파일은 바꾸지 않습니다.
        </p>
        <fieldset className={styles.selection}>
          <legend>Index 경로 선택</legend>
          {current?.status === "available" ? (
            current.files.map((f) => (
              <label key={f.path} className={styles.indexPath}>
                <input
                  type="checkbox"
                  aria-label={`Index 경로 선택: ${f.path}`}
                  checked={index.paths.includes(f.path)}
                  disabled={
                    !selectors.canSelectGitIndexPaths(state) ||
                    f.kind === "conflict" ||
                    !validGitIndexPaths([f.path])
                  }
                  onChange={() => actions.toggleGitIndexPath(f.path)}
                />
                <span>
                  {f.path}
                  {!validGitIndexPaths([f.path])
                    ? " · 보호된 경로"
                    : f.kind === "conflict"
                      ? " · 충돌"
                      : ""}
                </span>
              </label>
            ))
          ) : (
            <p>현재 Git 상태를 먼저 확인하세요.</p>
          )}
          <label htmlFor={`${prefix}-index-action`}>Index 작업</label>
          <Select
            id={`${prefix}-index-action`}
            aria-label="Index 작업"
            value={index.action}
            disabled={!selectors.canSelectGitIndexPaths(state)}
            onChange={(e) =>
              actions.selectGitIndexAction(
                e.target.value === "unstage" ? "unstage" : "stage",
              )
            }
          >
            <option value="stage">Stage · worktree 내용으로 교체</option>
            <option value="unstage">Unstage · HEAD 상태로 복원</option>
          </Select>
          <p>선택한 경로: {index.paths.length}개</p>
        </fieldset>
        <div className={styles.actions}>
          <Button
            size="compact"
            intent="secondary"
            disabled={!selectors.canPreviewGitIndex(state)}
            onClick={() => {
              void actions
                .previewGitIndex()
                .then(() => indexRef.current?.focus());
            }}
          >
            Index 변경 미리보기
          </Button>
          <Button
            size="compact"
            intent="secondary"
            disabled={!index.request}
            onClick={() => {
              actions.cancelGitIndexPreview();
              indexRef.current?.focus();
            }}
          >
            Index 미리보기 취소
          </Button>
          <Button
            size="compact"
            intent="secondary"
            disabled={!selectors.canApplyGitIndex(state)}
            onClick={() => {
              void actions
                .applyGitIndex()
                .then(() => indexRef.current?.focus());
            }}
          >
            Index 변경 적용
          </Button>
        </div>
        <p>
          적용 버튼 다음에 Main 확인 창이 열립니다. 확인을 거부하면 변경하지
          않습니다. 이 작업은 commit을 만들지 않습니다.
        </p>
        <p
          ref={indexRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={styles.status}
          data-git-index-status
        >
          {index.request
            ? "Index 변경 미리보기 읽는 중…"
            : index.error
              ? errorMessage(index.error)
              : currentIndex?.status === "unavailable"
                ? (indexReasons[currentIndex.reason] ??
                  reasons[currentIndex.reason as GitDiffReason] ??
                  "Index 변경을 지원하지 않습니다.")
                : currentIndex?.status === "available"
                  ? "Preview를 확인한 뒤 적용하세요."
                  : "경로와 작업을 선택한 뒤 Preview를 요청하세요."}
          {indexPreview &&
            !currentIndex &&
            " 이전 Preview입니다. 현재 변경의 기준으로 사용할 수 없습니다."}
          {index.mutation &&
            ` 원래 작업 (${index.mutation.identity.workspacePath}): ${index.mutation.status === "applied" ? "Index 변경 확인 완료. 최신 snapshot 이후 Git 상태를 직접 확인하세요." : index.mutation.status === "unknown" ? "결과 불명확. 원래 작업 조회만 수행합니다. 자동 재전송하지 않습니다." : index.mutation.status === "pending" ? "Main 확인 또는 적용 대기 중." : "적용을 거부했습니다."}`}
        </p>
        {indexPreview && (
          <dl
            className={styles.metadata}
            aria-label="Index Preview 출처"
            data-git-index-preview={currentIndex ? "current" : "historical"}
          >
            <dt>관찰한 작업 공간</dt>
            <dd>{indexPreview.workspacePath}</dd>
            <dt>Runtime epoch / revision</dt>
            <dd>
              {indexPreview.runtimeEpoch} / {indexPreview.revision}
            </dd>
            {indexPreview.status === "available" ? (
              <>
                <dt>작업</dt>
                <dd>{indexPreview.action === "stage" ? "Stage" : "Unstage"}</dd>
                <dt>HEAD</dt>
                <dd>{indexPreview.headOid ?? "Unborn · 아직 commit 없음"}</dd>
                <dt>원래 index</dt>
                <dd>
                  {indexPreview.indexExists
                    ? "있음 · 성공하면 원래 index backup 보존"
                    : "없음 · 원래 index backup은 생성하지 않음"}
                </dd>
                <dt>Index digest · 변경 전 → 후</dt>
                <dd>
                  {indexPreview.indexDigest}
                  {" → "}
                  {indexPreview.nextIndexDigest}
                </dd>
                <dt>Preview ID / digest</dt>
                <dd>
                  {indexPreview.previewId}
                  {" / "}
                  {indexPreview.previewDigest}
                </dd>
                <dt>Object format</dt>
                <dd>{indexPreview.objectFormat}</dd>
              </>
            ) : (
              <>
                <dt>변경 불가 이유</dt>
                <dd>
                  {indexReasons[indexPreview.reason] ??
                    reasons[indexPreview.reason as GitDiffReason]}
                </dd>
              </>
            )}
          </dl>
        )}
        {indexPreview?.status === "available" && (
          <ul
            className={styles.rows}
            aria-label="선택한 index 항목 변경"
            data-git-index-entries
          >
            {indexPreview.entries.map((row) => (
              <li key={row.path}>
                <p>{row.path}</p>
                <dl className={styles.metadata}>
                  <dt>변경 전 · mode / OID</dt>
                  <dd>{indexEntryText(row.before)}</dd>
                  <dt>변경 후 · mode / OID</dt>
                  <dd>{indexEntryText(row.after)}</dd>
                  <dt>변경 여부</dt>
                  <dd>
                    {indexEntryText(row.before) === indexEntryText(row.after)
                      ? "변경 없음"
                      : "변경 예정"}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
        {index.mutation && (
          <dl
            className={styles.metadata}
            aria-label="Index 작업 결과"
            data-git-index-result={index.mutation.status}
          >
            <dt>원래 작업 공간</dt>
            <dd>{index.mutation.identity.workspacePath}</dd>
            <dt>원래 작업 · epoch / operation ID</dt>
            <dd>
              {index.mutation.identity.epoch} /{" "}
              {index.mutation.identity.operationId}
            </dd>
            <dt>원래 선택 경로</dt>
            <dd>{index.mutation.identity.request.paths.join("\n")}</dd>
            <dt>상태</dt>
            <dd>
              {index.mutation.status === "pending"
                ? "Main 확인 또는 적용 대기 중"
                : index.mutation.status === "unknown"
                  ? "결과 불명확 · 원래 작업 조회만 수행합니다. 자동 재전송하지 않습니다."
                  : index.mutation.status === "applied"
                    ? "Index 변경 확인 완료 · 최신 snapshot 이후 Git 상태를 직접 확인하세요."
                    : "적용 거부됨"}
              {index.mutation.code ? ` · ${index.mutation.code}` : ""}
            </dd>
            {index.mutation.status === "applied" && (
              <>
                <dt>원래 index backup</dt>
                <dd>
                  {index.mutation.identity.backupId ??
                    "원래 index 없음 · backup 없음"}
                </dd>
              </>
            )}
          </dl>
        )}
      </section>
      {observation?.status === "available" && (
        <>
          {observation.files.length === 0 && (
            <p>관찰한 staged·unstaged 변경이 없습니다.</p>
          )}
          {(["staged", "unstaged"] as const).map((mode) => {
            const rows = observation.files.filter((f) =>
              mode === "staged"
                ? f.index !== "none"
                : f.worktree !== "none" || f.kind === "untracked",
            );
            return (
              <section
                key={mode}
                aria-label={
                  mode === "staged" ? "Staged 변경 목록" : "Unstaged 변경 목록"
                }
              >
                <h4>
                  {mode === "staged" ? "Staged · index" : "Unstaged · worktree"}
                </h4>
                {!rows.length && <p>관찰한 변경이 없습니다.</p>}
                <ul className={styles.rows}>
                  {rows.map((f) => (
                    <li key={f.path}>
                      <Button
                        size="compact"
                        intent="secondary"
                        disabled={!available}
                        aria-label={`${mode === "staged" ? "Staged" : "Unstaged"} 차이 선택: ${f.path}`}
                        aria-pressed={g.path === f.path && g.mode === mode}
                        onClick={() => selectRow(f.path, mode)}
                      >
                        {f.path}
                      </Button>
                      <dl className={styles.metadata}>
                        <dt>Index</dt>
                        <dd>{states[f.index]}</dd>
                        <dt>Worktree</dt>
                        <dd>{states[f.worktree]}</dd>
                        <dt>파일 상태</dt>
                        <dd>
                          {f.kind === "untracked"
                            ? "Untracked · 추적 안 됨"
                            : f.kind === "conflict"
                              ? "충돌"
                              : "Tracked · 추적 중"}
                        </dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
      <fieldset className={styles.selection} disabled={!available}>
        <legend>선택한 파일의 Git 차이</legend>
        <label htmlFor={`${prefix}-path`}>Git 비교 경로</label>
        <Select
          id={`${prefix}-path`}
          value={g.path}
          onChange={(e) => actions.selectGitPath(e.target.value)}
        >
          <option value="">경로를 선택하세요</option>
          {observation?.status === "available" &&
            observation.files.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
        </Select>
        <label htmlFor={`${prefix}-mode`}>Git 비교 방식</label>
        <Select
          id={`${prefix}-mode`}
          value={g.mode}
          onChange={(e) => actions.selectGitMode(e.target.value as GitDiffMode)}
        >
          <option value="staged">Staged · HEAD → index</option>
          <option value="unstaged">Unstaged · index → worktree</option>
          <option value="base">Local branch TIP → worktree</option>
        </Select>
        <label htmlFor={`${prefix}-base`}>Git 기준 branch</label>
        <Select
          id={`${prefix}-base`}
          disabled={g.mode !== "base"}
          value={g.baseRef}
          onChange={(e) => actions.selectGitBase(e.target.value)}
        >
          <option value="">기준 branch를 직접 선택하세요</option>
          {observation?.status === "available" &&
            observation.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </Select>
      </fieldset>
      <p>
        기준 branch는 관찰한 TIP commit과 worktree를 직접 비교합니다.
        Merge-base를 계산하지 않습니다.
      </p>
      <dl className={styles.metadata} aria-label="Git 비교 선택">
        <dt>경로</dt>
        <dd>{g.path || "선택 안 함"}</dd>
        <dt>비교 방식</dt>
        <dd>{g.mode}</dd>
        <dt>기준 branch / 관찰한 OID</dt>
        <dd>
          {g.baseRef || "선택 안 함"}
          {available &&
            g.baseRef &&
            ` / ${current.branches.find((b) => b.name === g.baseRef)?.oid ?? "확인 불가"}`}
        </dd>
      </dl>
      <div className={styles.actions}>
        <Button
          size="compact"
          intent="secondary"
          disabled={!selectors.canReadGitDiff(state)}
          onClick={() => {
            void actions.readGitDiff().then(() => detailRef.current?.focus());
          }}
        >
          선택한 Git 차이 읽기
        </Button>
        <Button
          size="compact"
          intent="secondary"
          disabled={!g.detailRequest}
          onClick={() => {
            actions.cancelGitDiff();
            detailRef.current?.focus();
          }}
        >
          Git 차이 읽기 취소
        </Button>
      </div>
      <section aria-label="Git 차이 결과" data-git-diff-state={detailStatus}>
        <p
          ref={detailRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={styles.status}
        >
          {g.detailRequest
            ? "Git 차이 읽는 중…"
            : g.detailError
              ? errorMessage(g.detailError)
              : detail?.status === "unavailable"
                ? reasons[detail.reason]
                : currentDetail?.status === "available"
                  ? "Git 차이 관찰 완료"
                  : "경로와 비교 방식을 선택한 뒤 차이 읽기를 누르세요."}
          {detail &&
            !currentDetail &&
            " 마지막 차이입니다. 현재 내용은 다시 확인해야 합니다."}
          {!g.detailRetryReady && " 다시 시도 준비 중…"}
        </p>
        {detail && (
          <>
            <dl className={styles.metadata} aria-label="Git 차이 출처">
              <dt>관찰한 작업 공간</dt>
              <dd>{detail.workspacePath}</dd>
              <dt>Runtime epoch / revision</dt>
              <dd>
                {detail.runtimeEpoch} / {detail.revision}
              </dd>
              <dt>관찰 ID</dt>
              <dd>{detail.observationId}</dd>
              <dt>비교 경로 / 방식</dt>
              <dd>
                {detail.path} / {detail.mode}
              </dd>
              {detail.mode === "base" && (
                <>
                  <dt>기준 branch / 원래 OID</dt>
                  <dd>
                    {detail.baseRef} / {detail.baseOid}
                  </dd>
                </>
              )}
            </dl>
            {detail.status === "available" && (
              <pre
                className={styles.patch}
                tabIndex={0}
                role="region"
                aria-label="Git patch"
              >
                {detail.patch || "(이 비교에서 텍스트 차이 없음)"}
              </pre>
            )}
          </>
        )}
      </section>
    </section>
  );
}
