import { useEffect, useState, type FormEvent } from "react";
import { File, Folder, FolderUp, House, RefreshCw, Search } from "lucide-react";
import { Button, Input, Notice, Select } from "@workbench/ui";
import styles from "./explorer.module.css";
import { type WorkbenchFileSearch } from "../../shared/api/index.js";
import { LineFeedbackPanel } from "../../features/line-feedback/index.js";
import { GitReviewPanel } from "../../features/git-review/index.js";
import { WorkspaceFileEditor } from "../../features/workspace-file-editor/index.js";

import {
  selectors,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
function FileSearch({ open }: { open: (path: string) => void }) {
  const { actions } = useWindowWorkbench();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"name" | "content">("name");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState<WorkbenchFileSearch>();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setState("busy");
    const result = await actions.searchFiles(query, mode, caseSensitive);
    if (!result.ok && result.code === "CANCELLED") return;
    setFound(result.ok ? result.value : undefined);
    setState(result.ok ? "idle" : "error");
  };
  return (
    <form
      className={styles.search}
      role="search"
      aria-label="파일 검색"
      onSubmit={(event) => void submit(event)}
    >
      <div className={styles.searchRow}>
        <Input
          className={styles.searchInput}
          aria-label="검색어"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="검색 방식"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as "name" | "content")
          }
        >
          <option value="name">파일 이름</option>
          <option value="content">내용</option>
        </Select>
        <Button
          size="compact"
          aria-label="대소문자"
          title="대소문자 구분"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          Aa
        </Button>
        <Button
          type="submit"
          size="compact"
          aria-label="검색"
          title="검색"
          disabled={!query.trim()}
        >
          <Search size={18} aria-hidden="true" />
        </Button>
      </div>
      {state === "busy" && <p role="status">검색 중…</p>}
      {state === "error" && <Notice tone="danger">검색하지 못했습니다.</Notice>}
      {found && state === "idle" && (
        <>
          {!found.results.length && <p className={styles.muted}>결과 없음</p>}
          {found.truncated && (
            <p role="status">결과가 많아 일부만 표시합니다.</p>
          )}
          <ul className={`${styles.list} file-search-results`}>
            {found.results.map((hit) => (
              <li key={`${hit.path}:${hit.line ?? 0}`}>
                <button
                  type="button"
                  title={hit.path}
                  onClick={() => open(hit.path)}
                >
                  <span aria-hidden="true">
                    <File size={17} />
                  </span>
                  <span>
                    {hit.path}
                    {hit.line ? `:${hit.line}` : ""}
                    {hit.snippet ? ` ${hit.snippet}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </form>
  );
}
export function FileExplorer({ workspaceId }: { workspaceId: string }) {
  const { actions } = useWindowWorkbench();
  const { listing, preview, error, busy, status } = useWorkbenchSelector(
    selectors.files,
  );
  const load = (path: string, file = false) =>
    actions.openFiles(path, file ? "file" : "directory");
  useEffect(() => {
    actions.openFiles();
    return actions.closeFiles;
  }, [actions, workspaceId]);
  const parent = listing?.path.split("/").slice(0, -1).join("/") ?? "";
  return (
    <section
      className={`${styles.explorer} file-explorer`}
      aria-label="파일 탐색 및 편집"
    >
      <p className={styles.muted}>읽기 전용 · 텍스트 미리보기</p>
      <div className={styles.toolbar}>
        <Button
          size="compact"
          aria-label="루트"
          title="루트"
          disabled={busy}
          onClick={() => void load("")}
        >
          <House size={18} aria-hidden="true" />
        </Button>
        <Button
          size="compact"
          aria-label="상위 폴더"
          title="상위 폴더"
          disabled={busy || !listing?.path}
          onClick={() => void load(parent)}
        >
          <FolderUp size={18} aria-hidden="true" />
        </Button>
        <Button
          size="compact"
          aria-label="새로고침"
          title="새로고침"
          disabled={busy}
          onClick={() => void actions.refreshFiles()}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </Button>
      </div>
      <FileSearch open={(path) => void load(path, true)} />
      <p className={styles.path}>{listing?.path || "/"}</p>
      {busy && <p role="status">불러오는 중…</p>}
      {status === "checking" && (
        <p role="status">확인 중 · 마지막으로 관찰한 내용</p>
      )}
      {status === "stale" && (
        <p role="status">최신 내용 확인 실패 · 마지막으로 관찰한 내용</p>
      )}
      {status === "missing" && (
        <p role="status">파일이 없습니다. 새로고침으로 다시 확인하세요.</p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {listing && !listing.entries.length && (
        <p className={styles.muted}>빈 폴더입니다.</p>
      )}
      <ul className={`${styles.list} file-list`}>
        {listing?.entries.map((entry) => (
          <li key={entry.path}>
            <button
              disabled={busy}
              title={entry.path}
              onClick={() => void load(entry.path, entry.type === "file")}
            >
              <span aria-hidden="true">
                {entry.type === "directory" ? (
                  <Folder size={17} />
                ) : (
                  <File size={17} />
                )}
              </span>
              <span>{entry.name}</span>
              <span className={styles.srOnly}>
                {entry.type === "directory" ? "폴더 열기" : "파일 미리보기"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {preview && (
        <section aria-label="파일 내용">
          <h3 className={styles.path}>{preview.path}</h3>
          {preview.truncated && (
            <p role="status">파일 크기 제한으로 앞부분만 표시합니다.</p>
          )}
          <pre className={`${styles.content} file-content`}>
            {preview.content || "(빈 파일)"}
          </pre>
        </section>
      )}
      <WorkspaceFileEditor />
      <GitReviewPanel />
      <LineFeedbackPanel />
    </section>
  );
}
