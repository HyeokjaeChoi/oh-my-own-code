import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronRight,
  File,
  Folder,
  FolderUp,
  House,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Eye,
} from "lucide-react";
import { Button, Input, Notice, Select } from "@workbench/ui";
import styles from "./explorer.module.css";
import { requestPreview } from "../../shared/preview/index.js";
import { type WorkbenchFileSearch } from "../../shared/api/index.js";
import { PathText } from "../../shared/panel-text/index.js";
import { WorkspaceFileEditor } from "../../features/workspace-file-editor/index.js";

import {
  selectors,
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
const PREVIEWABLE = /\.(html?|md|markdown|png|jpe?g|gif|webp|svg|pdf)$/i;
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
  const [options, setOptions] = useState(false);
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
          placeholder="파일 검색"
          value={query}
          maxLength={200}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          size="compact"
          className={styles.iconButton}
          aria-label="검색 옵션"
          title="검색 옵션"
          aria-pressed={options}
          onClick={() => setOptions((value) => !value)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          size="compact"
          intent="primary"
          className={styles.iconButton}
          aria-label="검색"
          title="검색"
          disabled={!query.trim()}
        >
          <Search size={16} aria-hidden="true" />
        </Button>
      </div>
      {options && (
        <div className={styles.searchRow}>
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
        </div>
      )}
      {state === "busy" && (
        <p role="status" className={styles.note}>
          검색 중…
        </p>
      )}
      {state === "error" && <Notice tone="danger">검색하지 못했습니다.</Notice>}
      {found && state === "idle" && (
        <>
          {!found.results.length && <p className={styles.note}>결과 없음</p>}
          {found.truncated && (
            <p role="status" className={styles.note}>
              결과가 많아 일부만 표시합니다.
            </p>
          )}
          <ul className={`${styles.list} file-search-results`}>
            {found.results.map((hit) => (
              <li key={`${hit.path}:${hit.line ?? 0}`}>
                <button
                  type="button"
                  title={hit.path}
                  onClick={() => open(hit.path)}
                >
                  <span aria-hidden="true" className={styles.icon}>
                    <File size={16} />
                  </span>
                  <PathText
                    path={`${hit.path}${hit.line ? `:${hit.line}` : ""}`}
                  />
                  {hit.snippet && (
                    <span className={styles.snippet}>{hit.snippet}</span>
                  )}
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
  const [searching, setSearching] = useState(false);
  const load = (path: string, file = false) =>
    actions.openFiles(path, file ? "file" : "directory");
  useEffect(() => {
    actions.openFiles();
    return actions.closeFiles;
  }, [actions, workspaceId]);
  const parent = listing?.path.split("/").slice(0, -1).join("/") ?? "";
  const filePath = useWorkbenchSelector((s) => s.workspaceFile.path);
  const editable = Boolean(preview) && preview?.path === filePath;
  const previewNode = preview ? (
    <section aria-label="파일 내용" className={styles.preview}>
      {!editable && (
        <p className={styles.previewPath}>
          <PathText path={preview.path} />
        </p>
      )}
      {preview.truncated && (
        <p role="status" className={styles.note}>
          파일 크기 제한으로 앞부분만 표시합니다.
        </p>
      )}
      <pre className={`${styles.content} file-content`} tabIndex={0}>
        {preview.content || "(빈 파일)"}
      </pre>
    </section>
  ) : undefined;
  return (
    <section
      className={`${styles.explorer} file-explorer`}
      aria-label="파일 탐색 및 편집"
    >
      <div className={styles.bar}>
        <span className={styles.crumb} title={listing?.path || "/"}>
          <PathText path={listing?.path || "/"} />
        </span>
        <Button
          size="compact"
          className={styles.iconButton}
          aria-label="파일 검색 열기"
          title="검색"
          aria-pressed={searching}
          onClick={() => setSearching((value) => !value)}
        >
          <Search size={16} aria-hidden="true" />
        </Button>
        <Button
          size="compact"
          className={styles.iconButton}
          aria-label="새로고침"
          title="새로고침"
          disabled={busy}
          onClick={() => void actions.refreshFiles()}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </Button>
        <Button
          size="compact"
          className={styles.iconButton}
          aria-label="상위 폴더"
          title="상위 폴더"
          disabled={busy || !listing?.path}
          onClick={() => void load(parent)}
        >
          <FolderUp size={16} aria-hidden="true" />
        </Button>
        <Button
          size="compact"
          className={styles.iconButton}
          aria-label="루트"
          title="루트"
          disabled={busy}
          onClick={() => void load("")}
        >
          <House size={16} aria-hidden="true" />
        </Button>
      </div>
      {searching && <FileSearch open={(path) => void load(path, true)} />}
      {busy && (
        <p role="status" className={styles.note}>
          불러오는 중…
        </p>
      )}
      {status === "checking" && (
        <p role="status" className={styles.note}>
          확인 중 · 마지막으로 관찰한 내용
        </p>
      )}
      {status === "stale" && (
        <p role="status" className={styles.note}>
          최신 내용 확인 실패 · 마지막으로 관찰한 내용
        </p>
      )}
      {status === "missing" && (
        <p role="status" className={styles.note}>
          파일이 없습니다. 새로고침으로 다시 확인하세요.
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {listing && !listing.entries.length && (
        <p className={styles.note}>빈 폴더입니다.</p>
      )}
      <ul
        className={`${styles.list} file-list`}
        data-compact={Boolean(preview)}
      >
        {listing?.entries.map((entry) => (
          <li key={entry.path} className={styles.row}>
            <button
              disabled={busy}
              title={entry.path}
              data-dot={entry.name.startsWith(".") || undefined}
              aria-current={preview?.path === entry.path || undefined}
              onClick={() => void load(entry.path, entry.type === "file")}
            >
              <span aria-hidden="true" className={styles.chevron}>
                {entry.type === "directory" && <ChevronRight size={14} />}
              </span>
              <span aria-hidden="true" className={styles.icon}>
                {entry.type === "directory" ? (
                  <Folder size={16} />
                ) : (
                  <File size={16} />
                )}
              </span>
              <span className={styles.name}>{entry.name}</span>
              <span className={styles.srOnly}>
                {entry.type === "directory" ? "폴더 열기" : "파일 미리보기"}
              </span>
            </button>
            {entry.type === "file" && PREVIEWABLE.test(entry.name) && (
              <button
                type="button"
                className={styles.previewAction}
                aria-label={`${entry.name} 미리보기 탭에서 열기`}
                title="미리보기"
                onClick={() => requestPreview({ path: entry.path })}
              >
                <Eye size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {/* The host may refuse a path for editing: then only the read-only preview shows. */}
      {preview && !editable && previewNode}
      {(editable || filePath || !preview) && (
        <WorkspaceFileEditor view={editable ? previewNode : undefined} />
      )}
    </section>
  );
}
