import { openExtensionsSub } from "../../shared/palette/index.js";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
  resourceMutationDisabled,
} from "../../entities/workbench/index.js";
import {
  workspaceFilePathReason,
  workspaceFileIssueMessages,
} from "../../shared/workspace-file/index.js";
import styles from "./editor.module.css";
import {
  Button,
  EmptyState,
  InfoTip,
  Notice,
  Select,
  Textarea,
} from "@workbench/ui";

const errors: Record<string, string> = {
  FILE_CHANGED:
    "파일이 외부에서 변경되었습니다. 초안은 유지됩니다. ‘다시 읽기’로 비교하세요.",
  FILE_DENIED:
    "파일 쓰기 권한 또는 경로 권한을 확인할 수 없습니다. 초안은 유지됩니다.",
  FILE_MISSING: "기존 파일이 없습니다. 여기에서는 새 파일을 만들 수 없습니다.",
  CANCELLED: "파일 읽기를 취소했습니다.",
  INVALID_RESPONSE:
    "파일 정보를 확인할 수 없습니다. 저장 기준을 다시 불러오세요.",
  missing_file: "기존 파일이 없습니다. 여기에서는 새 파일을 만들 수 없습니다.",
  path_missing: "파일 경로가 없습니다. 초안은 유지됩니다.",
  path_denied: "파일을 읽을 권한 또는 경로 권한을 확인할 수 없습니다.",
  file_changed: "파일이 변경되었습니다. ‘다시 읽기’로 확인하세요.",
  too_large: "편집할 파일은 UTF-8 기준 64KiB 이하여야 합니다.",
  unsupported_content: "이 파일은 지원하는 UTF-8 텍스트가 아닙니다.",
  protected_source:
    "보호된 설정 파일입니다. 지원되는 구성은 런타임 목록의 지침·MCP·Skills·Agents 전용 편집기를 사용하세요. 그 밖의 보호된 파일은 해당 전용 도구에서 편집하세요.",
};
// Browsers normalize textarea newlines. Keep unchanged original bytes, including
// mixed LF/CRLF; newly typed line breaks use the file's existing convention.
function exactTextareaEdit(original: string, input: string): string {
  const normalized = original.replace(/\r\n?/g, "\n");
  let start = 0,
    end = 0;
  while (
    start < normalized.length &&
    start < input.length &&
    normalized[start] === input[start]
  )
    start++;
  while (
    end < normalized.length - start &&
    end < input.length - start &&
    normalized[normalized.length - end - 1] === input[input.length - end - 1]
  )
    end++;
  const offsets = [0];
  for (let n = 0; n < original.length; n++) {
    if (original[n] === "\r" && original[n + 1] === "\n") n++;
    offsets.push(n + 1);
  }
  const inserted = input
    .slice(start, input.length - end)
    .replace(/\n/g, original.includes("\r\n") ? "\r\n" : "\n");
  return (
    original.slice(0, offsets[start]) +
    inserted +
    original.slice(offsets[normalized.length - end])
  );
}
// Protected sources are the files the extension editors own.
const protectedKind = (path: string) =>
  path.endsWith("AGENTS.md")
    ? "instructions"
    : path.endsWith("opencode.json")
      ? "mcp"
      : path.includes("/skills/")
        ? "skills"
        : path.includes("/agents/")
          ? "agents"
          : "";

// `view` is the read-only rendering of the selected file. It stays until the user
// asks to edit (or a draft already exists); editor logic is unchanged.
export function WorkspaceFileEditor({ view }: { view?: ReactNode } = {}) {
  const { actions } = useWindowWorkbench();
  const state = useWorkbenchSelector((s) => s);
  const draft = selectors.workspaceFileDraft(state),
    save = selectors.workspaceFileSave(state);
  const path = state.workspaceFile.path,
    target = selectors.workspaceFileTargetPath(state);
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  const canRead = selectors.canReadWorkspaceFile(state),
    canSave = selectors.canSaveWorkspaceFile(state);
  const held =
    resourceMutationDisabled(state, workspace?.id) ||
    Object.values(state.workspaceFileIO).includes(workspace?.id ?? "");
  const protectedPath =
    path && workspaceFilePathReason(path) === "protected_source";
  const reason =
    draft.error ??
    (draft.read && draft.read.status !== "available"
      ? draft.read.reason
      : undefined);
  const status = draft.request
    ? "loading"
    : save?.status === "pending"
      ? "loading"
      : save?.status === "unknown"
        ? "unknown"
        : save?.status === "conflict"
          ? "changed"
          : save?.status === "denied"
            ? "denied"
            : save?.status === "saved"
              ? "saved"
              : reason === "path_denied" || reason === "FILE_DENIED"
                ? "denied"
                : protectedPath || (reason && reason !== "CANCELLED")
                  ? "unavailable"
                  : draft.baseline !== undefined &&
                      draft.text !== draft.baseline
                    ? "changed"
                    : "ready";
  const [asked, setAsked] = useState(false);
  useEffect(() => setAsked(false), [path]);
  const uid = useId(),
    statusRef = useRef<HTMLDivElement>(null);
  const bytes = new TextEncoder().encode(draft.text).length;
  const retainedDrafts = Object.keys(state.workspaceFileDrafts).flatMap(
    (key) => {
      const [epoch, workspaceId, root, file] = JSON.parse(key) as string[];
      return workspaceId === workspace?.id &&
        file &&
        (epoch !== state.epoch || root !== workspace?.path)
        ? [{ key, file, root }]
        : [];
    },
  );
  const currentPaths = Object.keys(state.workspaceFileDrafts).flatMap((key) => {
    const [epoch, workspaceId, root, file] = JSON.parse(key) as string[];
    return epoch === state.epoch &&
      workspaceId === workspace?.id &&
      root === workspace?.path &&
      file
      ? [file]
      : [];
  });
  const paths = [...new Set([...(path ? [path] : []), ...currentPaths])];
  const archived = retainedDrafts.some(
    (d) => d.key === state.workspaceFile.draftKey,
  );
  const dirty = draft.baseline !== undefined && draft.text !== draft.baseline;
  const editing =
    !view ||
    asked ||
    archived ||
    draft.baseline !== undefined ||
    draft.text !== "" ||
    Boolean(draft.request) ||
    Boolean(save) ||
    Boolean(reason) ||
    // Held or untrusted: no read is possible, the draft stays directly editable.
    !canRead;
  const statusText = draft.request
    ? "편집용 파일을 불러오는 중입니다. Escape로 읽기를 취소할 수 있습니다."
    : save?.status === "pending"
      ? "파일 저장 결과를 확인하는 중입니다. 전송한 저장 요청은 취소할 수 없습니다."
      : save?.status === "unknown"
        ? "저장 결과를 확인할 수 없습니다. 원래 요청의 결과만 조회하며 자동으로 다시 저장하지 않습니다. 초안은 유지됩니다."
        : save?.status === "saved"
          ? save.current
            ? "파일 저장을 확인했습니다. 다시 저장하려면 다시 읽으세요."
            : "이전 초안의 저장을 확인했습니다. 더 최근에 수정한 초안은 유지됩니다. ‘다시 읽기’로 비교하세요."
          : save?.status === "conflict" || save?.status === "denied"
            ? (errors[save.code ?? ""] ??
              "저장할 수 없습니다. 초안은 유지됩니다. 파일과 권한을 다시 확인하세요.")
            : reason
              ? (errors[reason] ??
                "파일 정보를 확인할 수 없습니다. 초안은 유지됩니다.")
              : protectedPath
                ? errors.protected_source
                : !draft.observation
                  ? "저장 기준이 없습니다. ‘편집’을 눌러 확인하세요."
                  : draft.text !== draft.baseline
                    ? "초안을 수정했습니다. 내용을 확인한 뒤 저장하세요."
                    : "편집할 파일을 불러왔습니다.";
  return (
    <section
      className={`${styles.editor} workspace-file-editor`}
      aria-label="파일 편집"
      lang="ko"
      data-workspace-file-editor="true"
      onKeyDown={(event) => {
        if (event.key === "Escape" && draft.request) {
          event.preventDefault();
          event.stopPropagation();
          actions.cancelWorkspaceFileRead();
          statusRef.current?.focus();
        }
      }}
    >
      <div className={styles.head}>
        <p className={styles.path} data-workspace-file-target="true">
          {target ?? "파일을 선택하세요."}
        </p>
        <InfoTip label="편집 안내">
          <p>
            파일을 선택한 뒤 ‘편집’을 누르세요. 미리보기는 저장 기준으로
            사용하지 않습니다.
          </p>
          <p>
            ‘내용 확인’은 문자와 크기만 검사합니다. 문법이나 언어의 정확성은
            검사하지 않습니다. 저장은 기존 파일을 바꾸고 백업을 남깁니다.
          </p>
        </InfoTip>
      </div>
      {!path && !archived ? (
        <EmptyState title="파일을 선택하세요" />
      ) : (
        <>
          {paths.length + retainedDrafts.length > 1 && (
            <Select
              aria-label="편집할 파일"
              value={
                archived
                  ? `draft:${state.workspaceFile.draftKey}`
                  : (path ?? "")
              }
              data-workspace-file-select="true"
              onChange={(e) =>
                e.target.value.startsWith("draft:")
                  ? actions.selectWorkspaceFileDraft(e.target.value.slice(6))
                  : actions.selectWorkspaceFile(e.target.value)
              }
            >
              {paths.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
              {retainedDrafts.map((d) => (
                <option key={d.key} value={`draft:${d.key}`}>
                  {d.file} · 이전 연결의 초안 ({d.root})
                </option>
              ))}
            </Select>
          )}
          {archived && (
            <Notice tone="info" data-workspace-file-retained="true">
              이전 연결의 초안입니다. 내용을 선택하고 수정할 수 있습니다. 파일을
              읽거나 저장하려면 목록에서 현재 연결의 파일을 선택하세요.
            </Notice>
          )}
          {workspace && !workspace.trusted && (
            <Notice tone="warning" data-workspace-file-trust="untrusted">
              신뢰하지 않는 작업 공간입니다. 기존 ‘새 세션’에서 신뢰를 확인할 수
              있습니다. 이 작업은 새 세션을 만듭니다. 신뢰 확인 후 ‘다시 읽기’를
              직접 눌러야 합니다. 파일이나 구성을 자동으로 불러오지 않습니다.
            </Notice>
          )}
          {held && (
            <Notice tone="warning" data-workspace-file-held="true">
              이전 파일 요청의 종료 또는 작업 공간의 복구 확인을 기다립니다.
              초안은 선택하고 수정할 수 있습니다. 파일 읽기와 저장은 사용할 수
              없습니다.
            </Notice>
          )}
          {protectedPath && (
            <Notice
              tone="warning"
              action={
                <Button
                  size="compact"
                  intent="secondary"
                  onClick={() => openExtensionsSub(protectedKind(path))}
                >
                  전용 편집기 보기
                </Button>
              }
            >
              {errors.protected_source}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button
              size="compact"
              intent="secondary"
              data-workspace-file-open="true"
              disabled={!path || !canRead || Boolean(protectedPath)}
              onClick={() => {
                if (!path) return;
                setAsked(true);
                void actions.readWorkspaceFile(path);
              }}
            >
              {editing ? "다시 읽기" : "편집"}
            </Button>
            {draft.request && (
              <Button
                size="compact"
                intent="quiet"
                onClick={actions.cancelWorkspaceFileRead}
              >
                읽기 취소
              </Button>
            )}
            {editing && bytes > 65536 * 0.8 && (
              <span
                id={`${uid}-bytes`}
                className={styles.bytes}
                data-workspace-file-bytes="true"
              >
                UTF-8 {bytes.toLocaleString("ko-KR")} / 65,536 bytes
              </span>
            )}
          </div>
          {!editing ? (
            view
          ) : (
            <>
              {!canRead && view}
              <Textarea
                id={`${uid}-text`}
                className={styles.textarea}
                aria-label="파일 초안"
                data-workspace-file-text="true"
                value={draft.text}
                disabled={!path}
                spellCheck={false}
                aria-describedby={`${uid}-help ${uid}-status`}
                aria-invalid={draft.validation?.status === "invalid"}
                onChange={(e) =>
                  actions.editWorkspaceFile(
                    exactTextareaEdit(draft.text, e.target.value),
                  )
                }
              />
              <p id={`${uid}-help`} className={styles.srOnly}>
                ‘내용 확인’은 문자와 크기만 검사합니다. 문법이나 언어의 정확성은
                검사하지 않습니다. 저장은 기존 파일을 바꾸고 백업을 남깁니다.
              </p>
              <div
                id={`${uid}-status`}
                className={styles.status}
                ref={statusRef}
                tabIndex={-1}
                role="status"
                aria-live="polite"
                aria-label="파일 편집 상태"
                data-workspace-file-state={status}
              >
                {statusText}
              </div>
              {draft.validation && (
                <p
                  className={styles.validation}
                  data-workspace-file-validation={draft.validation.status}
                >
                  {draft.validation.status === "valid"
                    ? "문자와 크기 확인 완료"
                    : draft.validation.issues
                        .map((issue) => workspaceFileIssueMessages[issue])
                        .join(" ")}
                </p>
              )}
              {dirty && (
                <details>
                  <summary>마지막으로 읽은 원본과 비교</summary>
                  <pre className={styles.baseline}>
                    {draft.baseline || "(빈 파일)"}
                  </pre>
                </details>
              )}
              <div className={styles.saveBar}>
                <Button
                  size="compact"
                  intent="quiet"
                  disabled={!path || !canRead || Boolean(draft.request)}
                  onClick={actions.validateWorkspaceFile}
                >
                  내용 확인
                </Button>
                <Button
                  size="compact"
                  intent="quiet"
                  disabled={
                    !path ||
                    save?.status === "pending" ||
                    save?.status === "unknown"
                  }
                  onClick={actions.discardWorkspaceFile}
                >
                  초안 버리기
                </Button>
                <Button
                  size="compact"
                  intent={dirty ? "primary" : "quiet"}
                  className={styles.save}
                  data-workspace-file-save="true"
                  disabled={!canSave}
                  onClick={() => void actions.saveWorkspaceFile()}
                >
                  저장
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
