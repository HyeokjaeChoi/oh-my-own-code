import { useEffect, useId } from "react";
import {
  selectors,
  skillTargetPath,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import {
  compareConfigurationDraft,
  SKILL_LIMITS,
  skillIssueMessages,
} from "../../shared/configuration-draft/index.js";
import styles from "./drafts.module.css";

const reasonMessages: Record<string, string> = {
  path_missing:
    "관찰 시점에 기존 Skill 폴더를 찾지 못했습니다. 폴더 생성은 지원하지 않습니다.",
  missing_file:
    "관찰 시점에 기존 폴더 안에 SKILL.md가 없었습니다. 새 저장은 이 폴더 안의 파일만 만들 수 있습니다.",
  path_denied: "폴더 또는 파일에 접근할 수 없습니다. 빈 목록이 아닙니다.",
  file_changed: "폴더 또는 파일이 바뀌었습니다. 다시 확인하세요.",
  too_large: "파일 크기가 32KiB를 넘습니다. 내용을 불러오지 않았습니다.",
  unsupported_content:
    "안전한 UTF-8 파일로 읽을 수 없습니다. 기존 초안은 유지합니다.",
};

export function SkillFilesEditor() {
  const id = useId(),
    { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s);
  const files = selectors.skillFiles(state),
    draft = selectors.skillDraft(state);
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const listing = files.listing,
    sourceName = files.sourceName;
  const canRead = selectors.canReadSkillFiles(state);
  const validation =
    draft.validation?.revision === draft.revision
      ? draft.validation
      : undefined;
  const comparison = compareConfigurationDraft(draft.baseline, draft.text);
  const target = workspace ? skillTargetPath(workspace.path, sourceName) : "";
  const save = selectors.skillSave(state);
  const listStatus = files.request
    ? "loading"
    : files.error
      ? "error"
      : listing && !selectors.skillListCurrent(state)
        ? "stale"
        : (listing?.status ?? "not_observed");
  const readStatus = draft.request
    ? "loading"
    : draft.error
      ? "error"
      : (draft.read?.status ?? "not_observed");
  const stale = Boolean(draft.read && !selectors.skillReadCurrent(state));
  useEffect(() => () => actions.cancelSkillRead(), [actions]);
  return (
    <section
      className={styles.fileLoad}
      aria-label="Skill 파일 편집"
      data-skill-source={sourceName}
      data-skill-dirty={String(draft.text !== draft.baseline)}
    >
      <h4 className={styles.heading}>Skill 파일</h4>
      <p className={styles.muted} id={`${id}-scope`}>
        기존 .opencode/skills 원본 폴더만 선택할 수 있습니다. 폴더 생성과 삭제는
        지원하지 않습니다. 목록 확인은 파일 내용을 읽지 않습니다. 파일 선택도
        내용을 읽지 않습니다.
      </p>
      <p className={styles.muted} data-skill-native="not_observed">
        저장은 파일만 바꿉니다. Native 상태는 아래에서 직접 확인하세요. 등록은
        별도 확인을 거쳐 자동 호출 없이 수행합니다. 파일의 opencode/autoinvoke
        값으로 자동 실행하지 않습니다. 선택한 세션에 적용해도 모델을 시작하지
        않습니다.
      </p>
      {workspace && !workspace.trusted && (
        <p
          id={`${id}-trust`}
          role="status"
          className={styles.muted}
          data-skill-trust="untrusted"
        >
          신뢰하지 않은 작업 공간에서는 목록 확인·파일 읽기·저장을 할 수
          없습니다. 기존 ‘새 세션’은 신뢰 확인 뒤 새 대화를 만듭니다. 신뢰를
          확인한 뒤 Skill 목록과 파일을 직접 불러오세요. 이 과정에서 Skill을
          자동 등록하거나 실행하지 않습니다.
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          data-skill-action="list"
          aria-describedby={
            workspace && !workspace.trusted ? `${id}-trust` : undefined
          }
          disabled={!canRead}
          onClick={() => {
            void actions.listSkillFiles();
          }}
        >
          Skill 파일 목록 확인
        </button>
      </div>
      <div
        role="status"
        aria-label="Skill 파일 목록 상태"
        data-skill-list-status={listStatus}
        data-skill-list-reason={
          listing && "reason" in listing ? listing.reason : undefined
        }
      >
        <p className={styles.muted}>
          {listStatus === "loading"
            ? "Skill 폴더 목록을 확인 중입니다."
            : listStatus === "stale"
              ? "이전 목록입니다. Skill 파일 목록 확인을 다시 선택하세요."
              : files.error
                ? "목록을 확인하지 못했습니다. 다시 확인하세요."
                : listing?.status === "available"
                  ? listing.entries.length
                    ? `기존 폴더 ${listing.entries.length}개를 확인했습니다.`
                    : "관찰 시점에 지원하는 기존 폴더가 없습니다."
                  : listing
                    ? reasonMessages[listing.reason]
                    : "아직 목록을 확인하지 않았습니다."}
        </p>
        {listing?.status === "available" && listing.truncated && (
          <p className={styles.error} data-skill-list-truncated="true">
            목록 일부만 표시합니다. 최대 {SKILL_LIMITS.scan}개 항목을 검사하고{" "}
            {SKILL_LIMITS.entries}개 폴더를 표시합니다.
          </p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-source`}>Skill 원본 폴더</label>
        <select
          id={`${id}-source`}
          className={styles.select}
          value={sourceName ?? ""}
          data-skill-source-select
          onChange={(e) => actions.selectSkillFile(e.currentTarget.value)}
        >
          <option value="">원본 폴더를 선택하세요.</option>
          {listing?.status === "available" &&
            listing.entries.map((row) => (
              <option key={row.sourceName} value={row.sourceName}>
                {row.sourceName}
              </option>
            ))}
        </select>
      </div>
      <p className={styles.path} data-skill-path>
        {target}
      </p>
      <p className={styles.muted} id={`${id}-read-help`}>
        불러오기는 선택한 파일 하나만 읽습니다. 성공하면 초안 내용을 파일
        내용으로 바꿉니다. 읽는 동안 편집하거나 대상을 바꾸면 결과를 사용하지
        않습니다. 외부 변경은 자동 확인하지 않습니다.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          data-skill-action="read"
          disabled={!canRead || !sourceName}
          aria-describedby={`${id}-read-help${workspace && !workspace.trusted ? ` ${id}-trust` : ""}`}
          onClick={() => {
            void actions.readSkillFile();
          }}
        >
          Skill 파일 불러오기
        </button>
      </div>
      <div
        role="status"
        aria-label="Skill 파일 읽기 상태"
        data-skill-read-status={readStatus}
        data-skill-read-reason={
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
          <p className={styles.muted} data-skill-read-stale="true">
            현재 저장 기준이 아닙니다. 최신 상태를 확인한 뒤 파일을 명시적으로
            다시 불러오세요.
          </p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-text`}>Skill 초안 내용</label>
        <textarea
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
          onChange={(e) => actions.editSkillFile(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.stopPropagation();
          }}
        />
      </div>
      <p className={styles.muted}>
        UTF-8 최대 32KiB. 지원하지 않는 frontmatter도 안전하게 읽은 원문을
        편집할 수 있습니다. name은 원본 폴더 ID를 바꾸지 않습니다.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          data-skill-action="validate"
          disabled={!sourceName}
          onClick={() => actions.validateSkillFile()}
        >
          형식 검증
        </button>
        <button
          type="button"
          data-skill-action="save"
          aria-describedby={
            workspace && !workspace.trusted ? `${id}-trust` : undefined
          }
          disabled={!selectors.canSaveSkillFile(state)}
          onClick={() => {
            void actions.saveSkillFile();
          }}
        >
          Skill 파일에 저장
        </button>
        <button
          type="button"
          data-skill-action="discard"
          disabled={!sourceName}
          onClick={() => actions.discardSkillFile()}
        >
          이 초안 버리기
        </button>
      </div>
      <div
        id={`${id}-validation`}
        role="status"
        data-skill-validation={validation?.status ?? "not_validated"}
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
          <ul className={styles.issues}>
            {validation.issues.map((issue) => (
              <li key={issue}>{skillIssueMessages[issue]}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div
        id={`${id}-save`}
        role="status"
        aria-label="Skill 파일 저장 상태"
        data-skill-save-status={save?.status ?? (draft.save ? "stale" : "idle")}
        data-skill-save-current={String(Boolean(save?.current))}
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
          <p className={styles.path} data-skill-backup>
            {target.slice(0, -"SKILL.md".length)}
            {save.backupId}
          </p>
        )}
      </div>
      <section className={styles.comparison} aria-label="Skill 초안 변경 비교">
        <h4 className={styles.heading}>초안 변경 비교</h4>
        <p
          className={styles.muted}
          data-skill-baseline={
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
          aria-label="Skill 초안 변경 줄"
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
