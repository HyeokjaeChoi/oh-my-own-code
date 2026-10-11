import { Fragment, useId, useRef } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  GIT_BRANCH_RESTORE_TARGET_FIELDS,
  gitBranchRestoreBackupRoles,
  type GitBranchRestoreAction,
  type GitBranchRestoreSource,
  type GitBranchRestoreTarget,
} from "../../shared/api/index.js";
import styles from "./review.module.css";

const disabledReasons: Record<string, string> = {
  HISTORICAL:
    "이전 scope의 초안입니다. 편집은 가능하며 요청은 보낼 수 없습니다.",
  NO_WORKSPACE: "작업 공간을 선택하세요.",
  UNTRUSTED: "신뢰하지 않은 작업 공간입니다. 초안만 편집할 수 있습니다.",
  HELD: "이 작업 공간의 작업이 보류 중입니다. 원래 작업의 종료를 기다립니다.",
  NOT_READY: "최신 snapshot과 작업 공간 상태를 먼저 확인하세요.",
  READ_REQUIRED: "Git 상태 확인을 먼저 누르세요.",
  BRANCH_REQUIRED: "관찰한 local branch를 선택하세요.",
  BRANCH_AUTHOR_REQUIRED: "올바른 full ref와 사용자 이름·email을 입력하세요.",
  SOURCE_PATHS_REQUIRED: "복원 source와 경로를 직접 선택하세요.",
  READ_BUSY: "다른 읽기가 진행 중입니다. 종료 후 직접 다시 요청하세요.",
};
const refusals: Record<string, string> = {
  unsupported_branch_restore_state:
    "선택한 worktree의 Git 작업 상태를 지원하지 않습니다. Marker가 있으면 요청을 거부합니다.",
  unsupported_branch_restore:
    "이 Git 상태의 branch/restore를 지원하지 않습니다.",
  branch_occupied:
    "다른 worktree가 이 branch를 사용합니다. 선택할 수 없습니다.",
  branch_conflict: "이름 또는 경로가 충돌합니다. 변경하지 않습니다.",
  protected_source: "보호된 경로의 변경을 허용할 수 없습니다.",
  unsupported_configuration:
    "지원하지 않는 설정 또는 normalization 규칙입니다.",
  conflict: "Tracked 변경이 있어 branch를 선택할 수 없습니다.",
  no_changes: "적용할 변경이 없습니다.",
  stale_observation: "관찰한 상태가 변경됐습니다. Git 상태를 다시 확인하세요.",
  expired_observation: "Git 관찰이 만료됐습니다. Git 상태를 다시 확인하세요.",
  lock_conflict:
    "다른 Git 작업이 lock을 사용합니다. 종료 후 직접 다시 요청하세요.",
};
const fileText = (v: { bytes: number; digest: string; mode: number } | null) =>
  v
    ? `존재 · ${v.bytes} bytes · mode ${v.mode.toString(8)} · SHA-256 ${v.digest}`
    : "없음";
const byteText = (v: { bytes: number; digest: string } | null) =>
  v ? `존재 · ${v.bytes} bytes · SHA-256 ${v.digest}` : "없음";
const entryText = (v: { mode: number; oid: string } | null) =>
  v ? `${v.mode.toString(8)} / ${v.oid}` : "없음";

export function GitBranchRestoreSection() {
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s);
  const g = state.gitBranchRestore,
    draft = selectors.gitBranchRestoreDraft(state);
  const current = selectors.currentGitBranchRestorePreview(state),
    preview = g.preview;
  const review = selectors.currentGitReviewObservation(state);
  const prefix = useId(),
    statusRef = useRef<HTMLParagraphElement>(null);
  const reason = selectors.gitBranchRestoreDisabledReason(state);
  const status = g.request
    ? "reading"
    : g.error
      ? "stale"
      : (current?.status ?? "idle");
  const focus = () => statusRef.current?.focus();
  const selectedKey = selectors.selectedGitBranchRestoreDraftKey(state);
  const currentKey = selectors.currentGitBranchRestoreDraftKey(state);
  const operations = Object.entries(state.operations).filter(([, i]) =>
    ["git.branch.apply", "git.restore.apply"].includes(i.operation.type),
  );
  return (
    <section
      aria-label="Branch 생성·선택과 파일 복원"
      data-git-branch-restore-state={status}
      data-git-branch-restore-action={draft.action}
      data-git-branch-restore-held={selectors.gitReviewHeld(state)}
    >
      <h4>Local branch와 worktree 복원</h4>
      <p>
        1. Git 상태 확인 → 2. 작업과 입력 선택 → 3. Preview 확인 → 4. 적용 요청
      </p>
      <p>
        생성은 현재 HEAD에 새 branch를 만듭니다. 생성 후 전환하지 않습니다.
        선택은 실제 checkout이며 깨끗한 tracked 상태가 필요합니다. 복원은 선택한
        worktree 파일만 변경합니다.
      </p>
      <dl className={styles.metadata} data-git-branch-restore-scope>
        <dt>현재 관찰한 branch / HEAD</dt>
        <dd>
          {review?.status === "available"
            ? `${review.repository.branch ?? "detached HEAD"} / ${review.repository.head ?? "unborn"}`
            : "최신 Git 관찰 필요"}
        </dd>
        <dt>현재 scope · epoch / revision</dt>
        <dd>
          {state.epoch ?? "없음"} / {state.revision}
        </dd>
        <dt>요청 가능 상태</dt>
        <dd>
          {reason
            ? (disabledReasons[reason] ?? reason)
            : "명시적 Preview 요청 가능"}
        </dd>
      </dl>
      <fieldset className={styles.selection}>
        <legend>편집 가능한 branch/restore 초안</legend>
        <label htmlFor={`${prefix}-draft`}>초안 scope</label>
        <select
          id={`${prefix}-draft`}
          data-git-branch-restore-draft
          value={selectedKey === currentKey ? "" : (selectedKey ?? "")}
          onChange={(e) =>
            actions.selectGitBranchRestoreDraft(e.target.value || undefined)
          }
        >
          <option value="">현재 작업 공간 · 현재 epoch</option>
          {Object.entries(state.gitBranchRestoreDrafts)
            .filter(([key]) => key !== currentKey)
            .map(([key, d]) => (
              <option key={key} value={key}>
                {d.workspacePath} / {d.epoch}
              </option>
            ))}
        </select>
        <label htmlFor={`${prefix}-action`}>작업</label>
        <select
          id={`${prefix}-action`}
          data-git-branch-restore-control="action"
          value={draft.action}
          onChange={(e) =>
            actions.editGitBranchRestore({
              action: e.target.value as GitBranchRestoreAction,
            })
          }
        >
          <option value="create">새 local branch 생성 · 전환 없음</option>
          <option value="select">기존 local branch 선택 · 실제 checkout</option>
          <option value="restore">선택한 파일 복원 · worktree만 변경</option>
        </select>
        {draft.action !== "restore" ? (
          <>
            <label htmlFor={`${prefix}-branch`}>
              Local branch full ref · refs/heads/이름
            </label>
            <input
              id={`${prefix}-branch`}
              data-git-branch-restore-control="branch"
              value={draft.branch}
              spellCheck={false}
              onChange={(e) =>
                actions.editGitBranchRestore({ branch: e.target.value })
              }
            />
            <p>
              Local short name은 refs/heads/ 뒤의 이름입니다. 요청에는 full
              ref를 사용합니다.
            </p>
            {draft.action === "select" && (
              <>
                <label htmlFor={`${prefix}-existing`}>
                  관찰한 local branch 선택
                </label>
                <select
                  id={`${prefix}-existing`}
                  data-git-branch-restore-control="existing-branch"
                  value={
                    review?.status === "available" &&
                    review.branches.some(
                      (b) => `refs/heads/${b.name}` === draft.branch,
                    )
                      ? draft.branch
                      : ""
                  }
                  onChange={(e) =>
                    actions.editGitBranchRestore({ branch: e.target.value })
                  }
                >
                  <option value="">직접 선택하세요</option>
                  {review?.status === "available" &&
                    review.branches.map((b) => (
                      <option key={b.name} value={`refs/heads/${b.name}`}>
                        {b.name} / {b.oid}
                      </option>
                    ))}
                </select>
              </>
            )}
            <label htmlFor={`${prefix}-name`}>
              Reflog 사용자 이름 · 직접 입력
            </label>
            <input
              id={`${prefix}-name`}
              data-git-branch-restore-control="name"
              value={draft.name}
              autoComplete="off"
              onChange={(e) =>
                actions.editGitBranchRestore({ name: e.target.value })
              }
            />
            <label htmlFor={`${prefix}-email`}>Reflog email · 직접 입력</label>
            <input
              id={`${prefix}-email`}
              data-git-branch-restore-control="email"
              value={draft.email}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                actions.editGitBranchRestore({ email: e.target.value })
              }
            />
          </>
        ) : (
          <>
            <label htmlFor={`${prefix}-source`}>복원 source · 직접 선택</label>
            <select
              id={`${prefix}-source`}
              data-git-branch-restore-control="source"
              value={draft.source}
              onChange={(e) =>
                actions.editGitBranchRestore({
                  source: e.target.value as GitBranchRestoreSource | "",
                })
              }
            >
              <option value="">Source를 선택하세요</option>
              <option value="index">INDEX · staged 내용</option>
              <option value="head">HEAD · 현재 commit 내용</option>
            </select>
            <p>
              INDEX에 없는 경로는 INDEX 복원을 할 수 없습니다. HEAD에 없고
              index가 추적하는 경로는 HEAD 복원 시 삭제될 수 있습니다.
            </p>
            {review?.status === "available" &&
              review.files
                .filter((f) => f.kind === "tracked")
                .map((f) => (
                  <label key={f.path} className={styles.indexPath}>
                    <input
                      type="checkbox"
                      data-git-restore-path={f.path}
                      checked={draft.paths.includes(f.path)}
                      onChange={() => actions.toggleGitRestorePath(f.path)}
                    />
                    <span>{f.path}</span>
                  </label>
                ))}
            <label htmlFor={`${prefix}-paths`}>
              복원 경로 · 한 줄에 한 경로 · 변경 없는 tracked 경로도 입력 가능
            </label>
            <textarea
              id={`${prefix}-paths`}
              data-git-branch-restore-control="paths"
              rows={3}
              value={draft.paths.join("\n")}
              onChange={(e) =>
                actions.editGitBranchRestore({
                  paths: e.target.value ? e.target.value.split("\n") : [],
                })
              }
            />
          </>
        )}
      </fieldset>
      <div className={styles.actions}>
        <button
          data-git-branch-restore-command="preview"
          disabled={!selectors.canPreviewGitBranchRestore(state)}
          onClick={() => {
            void actions.previewGitBranchRestore().then(focus);
          }}
        >
          Branch/restore Preview 요청
        </button>
        <button
          data-git-branch-restore-command="cancel-preview"
          disabled={!g.request}
          onClick={() => {
            actions.cancelGitBranchRestorePreview();
            focus();
          }}
        >
          Preview 읽기 취소
        </button>
        <button
          data-git-branch-restore-command="apply"
          disabled={!selectors.canApplyGitBranchRestore(state)}
          onClick={() => {
            void actions.applyGitBranchRestore().then(focus);
          }}
        >
          확인 후 branch/restore 적용 요청
        </button>
      </div>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.status}
        data-git-branch-restore-status
      >
        {g.request
          ? "Preview 읽는 중…"
          : g.error
            ? `Preview 권한 없음 · ${g.error}`
            : current?.status === "available"
              ? "Preview 확인 완료. 적용 요청 후 Main의 기본 취소 확인이 필요합니다."
              : current?.status === "unavailable"
                ? `${refusals[current.reason] ?? "이 상태에서는 요청을 적용할 수 없습니다."} · ${current.reason}`
                : "Git 상태 확인 후 Preview를 직접 요청하세요."}
        {preview &&
          !current &&
          " 마지막 Preview입니다. 현재 상태를 다시 확인해야 합니다."}
      </p>
      {preview && (
        <dl className={styles.metadata} data-git-branch-restore-preview>
          <dt>Preview 원래 scope · workspace / epoch / revision</dt>
          <dd>
            {preview.workspacePath} / {preview.runtimeEpoch} /{" "}
            {preview.revision}
          </dd>
          {preview.status === "available" ? (
            <>
              <dt>Preview ID / digest / occupancy digest</dt>
              <dd>
                {preview.previewId} / {preview.previewDigest} /{" "}
                {preview.occupancyDigest}
              </dd>
              <dt>원래 선택 경로 · restore</dt>
              <dd data-git-branch-restore-selected-paths>
                {preview.action === "restore"
                  ? g.previewPaths?.join("\n")
                  : "해당 없음"}
              </dd>
              {preview.action === "restore" && (
                <>
                  <dt>선택 경로 중 변경 예정 없음</dt>
                  <dd>
                    {g.previewPaths
                      ?.filter(
                        (path) => !preview.paths.some((p) => p.path === path),
                      )
                      .join("\n") || "없음"}
                  </dd>
                </>
              )}
              <dt>작업 / source</dt>
              <dd>
                {preview.action} / {preview.source ?? "없음"}
              </dd>
              <dt>Branch · 변경 전 / 요청 대상</dt>
              <dd>
                {preview.currentBranch ?? "detached HEAD"} /{" "}
                {preview.branch ?? "변경 없음"}
              </dd>
              <dt>HEAD · 변경 전 / 변경 후 / tree OID</dt>
              <dd>
                {preview.headOid} / {preview.nextHeadOid} / {preview.treeOid}
              </dd>
              <dt>원래 HEAD digest / index 존재 / index digest</dt>
              <dd>
                {preview.headDigest} / {String(preview.indexExists)} /{" "}
                {preview.indexDigest}
              </dd>
              <dt>명시적 사용자 / UTC timestamp / identity digest</dt>
              <dd>
                {preview.author
                  ? `${preview.author.name} <${preview.author.email}> / ${preview.timestamp} / ${preview.identityDigest}`
                  : "없음 · restore에는 author와 reflog 변경 없음"}
              </dd>
              <dt>손실</dt>
              <dd>
                {preview.paths.some((p) => p.before !== null)
                  ? "기존 파일의 내용 또는 mode가 바뀌거나 파일이 삭제됩니다. 아래 전체 경로를 확인하세요."
                  : "기존 worktree 파일 손실 없음"}{" "}
                여러 파일의 적용은 한 번에 원자적으로 완료되지 않습니다. 일부
                적용 시 결과가 unknown일 수 있습니다.
              </dd>
              <dt>Backup 계획</dt>
              <dd>
                {gitBranchRestoreBackupRoles(
                  Object.fromEntries(
                    GIT_BRANCH_RESTORE_TARGET_FIELDS.map((key) => [
                      key,
                      preview[key],
                    ]),
                  ) as GitBranchRestoreTarget,
                )
                  .map(
                    (b) =>
                      `${b.role} / ${b.path ?? "metadata"} / ${b.exists ? "원래 epoch·operation·role·path의 결정적 backup · 적용 요청 시 ID 확정" : "원래 없음 · backup null"}`,
                  )
                  .join("\n") || "없음"}
              </dd>
            </>
          ) : (
            <>
              <dt>거부 이유</dt>
              <dd>
                {refusals[preview.reason] ?? "지원하지 않는 상태"} /{" "}
                {preview.reason}
              </dd>
            </>
          )}
        </dl>
      )}
      {preview?.status === "available" && (
        <>
          <ul
            className={styles.rows}
            aria-label="Branch/restore 전체 경로 변경"
          >
            {preview.paths.map((p) => (
              <li key={p.path} data-git-branch-restore-path={p.path}>
                <p>
                  {p.path} ·{" "}
                  {p.before === null
                    ? "생성"
                    : p.after === null
                      ? "삭제 · 기존 내용 손실"
                      : "기존 내용·mode 변경"}
                </p>
                <dl className={styles.metadata}>
                  <dt>변경 전 · 실제 파일</dt>
                  <dd>{fileText(p.before)}</dd>
                  <dt>변경 후 · 실제 파일</dt>
                  <dd>{fileText(p.after)}</dd>
                  <dt>원래 index / source Git entry · mode / OID</dt>
                  <dd>
                    {entryText(p.beforeEntry)} / {entryText(p.afterEntry)}
                  </dd>
                  <dt>Ident 변환</dt>
                  <dd>{String(p.ident)}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <ul
            className={styles.rows}
            aria-label="Branch/restore metadata 변경 순서"
          >
            {preview.metadata.map((m) => (
              <li key={m.role} data-git-branch-restore-metadata={m.role}>
                <p>{m.role}</p>
                <dl className={styles.metadata}>
                  <dt>변경 전</dt>
                  <dd>{byteText(m.before)}</dd>
                  <dt>변경 후</dt>
                  <dd>{byteText(m.after)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {operations.map(([key, intent]) => {
        const identity = intent.gitBranchRestoreMutation;
        const mutation = identity
          ? {
              identity,
              status:
                intent.status === "accepted"
                  ? "applied"
                  : intent.status === "failed"
                    ? "denied"
                    : intent.status,
              code:
                g.mutation?.identity === identity ? g.mutation.code : undefined,
            }
          : undefined;
        if (!mutation)
          return (
            <dl
              key={key}
              className={styles.metadata}
              data-git-branch-restore-result="unknown"
              data-git-branch-restore-operation={key}
            >
              <dt>복구한 원래 epoch / operation ID / workspace ID</dt>
              <dd>
                {intent.epoch} / {intent.id} /{" "}
                {intent.operation.workspaceId ?? "없음"}
              </dd>
              <dt>상태</dt>
              <dd>
                조회 전용 · 원래 payload와 Preview가 없습니다. 결과를 현재
                branch 상태로 표시하거나 요청을 재전송하지 않습니다.
              </dd>
            </dl>
          );
        return (
          <dl
            className={styles.metadata}
            data-git-branch-restore-result={mutation.status}
            key={key}
            data-git-branch-restore-operation={key}
            aria-label="Branch/restore 원래 작업 결과"
          >
            <dt>원래 workspace / epoch / operation ID</dt>
            <dd>
              {mutation.identity.workspacePath} / {mutation.identity.epoch} /{" "}
              {mutation.identity.operationId}
            </dd>
            <dt>원래 작업 / branch / source</dt>
            <dd>
              {mutation.identity.request.action} /{" "}
              {mutation.identity.request.branch ?? "없음"} /{" "}
              {mutation.identity.request.source ?? "없음"}
            </dd>
            <dt>원래 전체 변경 경로</dt>
            <dd>
              {mutation.identity.request.paths.map((p) => p.path).join("\n") ||
                "없음"}
            </dd>
            <dt>상태</dt>
            <dd>
              {mutation.status === "pending"
                ? "Main 확인 또는 적용 대기 중"
                : mutation.status === "unknown"
                  ? "결과 불명확 · 원래 작업 조회만 수행합니다. 자동 재전송하지 않습니다."
                  : mutation.status === "applied"
                    ? "원래 작업의 receipt 확인 완료. 최신 snapshot 이후 Git 상태 확인을 직접 누르세요."
                    : "적용 거부됨"}{" "}
              {mutation.code ?? ""}
            </dd>
            <dt>실제 호출 보류</dt>
            <dd data-git-branch-restore-io-held>
              {Object.values(state.gitBranchRestoreIO).includes(
                mutation.identity.workspaceId,
              )
                ? "호출 종료 대기 · receipt 확인과 별도로 보류 유지"
                : "Renderer 호출 종료"}
            </dd>
            <dt>원래 작업 Backup ID 계획 · confirmed 결과에서 검증</dt>
            <dd>
              {mutation.identity.backups.length
                ? `${mutation.identity.backups.length}개 · 아래 항목의 원래 경로와 ID를 확인하세요.`
                : "없음"}
            </dd>
            {mutation.identity.backups.map((b) => (
              <Fragment key={JSON.stringify([b.role, b.path])}>
                <dt>
                  Backup · {b.role} / {b.path ?? "metadata"}
                </dt>
                <dd
                  data-git-branch-restore-backup={JSON.stringify([
                    b.role,
                    b.path,
                  ])}
                >
                  {b.backupId ?? "null · 원래 없음"}
                </dd>
              </Fragment>
            ))}
          </dl>
        );
      })}
    </section>
  );
}
