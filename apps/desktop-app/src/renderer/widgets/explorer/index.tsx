import { useEffect, useState, type FormEvent } from "react";
import { File, Folder, FolderUp, House, RefreshCw, Search } from "lucide-react";
import { Button, Input, Notice, Select } from "@workbench/ui";
import styles from "./explorer.module.css";
import {
  type WorkbenchCatalog,
  type WorkbenchFileSearch,
} from "../../shared/api/index.js";
import { LineFeedbackPanel } from "../../features/line-feedback/index.js";
import { GitReviewPanel } from "../../features/git-review/index.js";
import { WorkspaceFileEditor } from "../../features/workspace-file-editor/index.js";
import { ConfigurationExtensions } from "../../features/configuration-extensions/index.js";
import { ConfigurationDraftEditor } from "../../features/configuration-drafts/index.js";

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
const collectionNames = {
  commands: "명령",
  skills: "스킬",
  mcp: "MCP",
  agents: "에이전트",
  models: "모델",
} as const;
const configurationNames = {
  instructions: "지침",
  skills: "스킬",
  agents: "에이전트",
  hooks: "훅",
  tools: "도구",
  mcp: "MCP",
  plugins: "플러그인",
  configuration: "설정",
} as const;
const sourceNames = {
  workspace: "작업 공간",
  runtime: "런타임",
} as const;
const scopeNames = {
  workspace: "작업 공간",
  external: "작업 공간 외부",
  runtime: "런타임",
} as const;
const observationNames = {
  discovered: "파일 발견 · 적용 여부 미확인",
  reported: "런타임 보고 · 실행 여부 미확인",
  unavailable: "확인할 수 없음",
} as const;
const configurationReasons = {
  untrusted_workspace:
    "신뢰하지 않은 작업 공간입니다. 파일 위치만 확인하며 구성을 실행하지 않습니다.",
  runtime_unavailable: "런타임 정보를 확인할 수 없습니다.",
  path_denied: "경로를 확인할 수 없습니다.",
  limit_reached: "확인 한도에 도달했습니다. 일부 출처는 표시하지 않습니다.",
} as const;
function mcpStatusLabel(status?: string) {
  switch (status) {
    case "connected":
      return "연결됨 · 런타임 관측";
    case "pending":
      return "확인 중";
    case "disabled":
      return "비활성 · 런타임 관측";
    case "failed":
      return "연결 실패";
    case "needs_auth":
      return "외부 인증 설정 필요";
    case "unavailable":
      return "확인할 수 없음";
    default:
      return "상태 미확인";
  }
}
export function CatalogPanel({
  catalog,
  error,
  refresh,
}: {
  catalog: WorkbenchCatalog | null;
  error: string;
  refresh(): void;
}) {
  const configuration = catalog?.configuration;
  return (
    <section
      className={`${styles.catalog} catalog`}
      aria-label="런타임 확장 목록"
    >
      <div className={styles.heading}>
        <p className={styles.muted}>현재 작업 공간의 런타임 목록</p>
        <Button size="compact" onClick={refresh}>
          새로고침
        </Button>
      </div>
      <p className={styles.muted}>
        설정 출처와 런타임 목록을 확인하고, 창 안의 임시 초안을 작성할 수
        있습니다. 파일을 불러와 비교한 뒤 저장할 수 있습니다. AGENTS.md는 선택한
        세션에 별도로 등록·제거할 수 있습니다. MCP는 작업 공간의 모든 세션을
        대상으로 비활성 등록·연결·연결 해제·등록 제거할 수 있습니다. Skills는
        파일과 Native 상태를 확인한 뒤 비활성 등록·등록 제거·선택 세션 적용을 할
        수 있습니다. Agents는 파일과 Native 상태를 확인한 뒤 등록하거나, 참조가
        없는 앱 등록 항목을 제거할 수 있습니다. Native Plugin·Tools·Hooks 정보는
        별도의 ‘Native 확장 상태’에서 명시적으로 조회합니다.
      </p>
      <p className={styles.muted}>
        작업 공간을 목록에서 제거하려면 이 앱이 등록한 MCP 항목을 먼저
        제거하세요. 초안 종류에서 MCP를 선택한 뒤 ‘작업 공간 MCP 제어’의 ‘등록
        제거’를 사용하세요. 파일은 유지됩니다.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {!catalog && !error && <p role="status">목록 확인 중…</p>}
      {catalog && (
        <section className={styles.group} aria-label="설정 출처">
          <h3>설정 출처</h3>
          <p className={styles.muted}>파일 발견과 실제 적용 상태는 다릅니다.</p>
          <p className={styles.muted}>
            런타임 설정 문서의 적용 상태는 아직 확인하지 않습니다.
          </p>
          {!configuration ? (
            <p className={styles.muted}>설정 출처 정보를 제공하지 않습니다.</p>
          ) : (
            <>
              {configuration.status === "partial" && (
                <p role="status" className={styles.muted}>
                  일부 설정 출처를 확인할 수 없습니다.
                </p>
              )}
              {configuration.status === "unavailable" && (
                <p role="status" className={styles.muted}>
                  설정 출처를 확인할 수 없습니다.
                </p>
              )}
              {configuration.reason && (
                <p className={styles.muted}>
                  {configurationReasons[configuration.reason]}
                </p>
              )}
              {configuration.status === "available" &&
                !configuration.entries.length && (
                  <p className={styles.muted}>
                    확인한 경로에서 설정 파일이나 디렉터리를 발견하지
                    못했습니다. 실제 적용 여부는 확인하지 않습니다.
                  </p>
                )}
              <ul>
                {configuration.entries.map((entry) => (
                  <li key={entry.id}>
                    <strong>{configurationNames[entry.kind]}</strong>
                    <p className={styles.metadata}>
                      <span>출처: {sourceNames[entry.source]}</span>
                      <span>범위: {scopeNames[entry.scope]}</span>
                    </p>
                    {entry.path ? (
                      <p className={styles.path}>{entry.path}</p>
                    ) : (
                      <p className={styles.muted}>경로 정보 없음</p>
                    )}
                    <p className={styles.muted}>
                      {observationNames[entry.state]}
                    </p>
                    {entry.reason === "path_denied" && (
                      <p className={styles.muted}>경로를 확인할 수 없습니다.</p>
                    )}
                    {entry.reason === "unsupported_format" && (
                      <p className={styles.muted}>변환 미지원</p>
                    )}
                    {entry.reason === "not_reported" && (
                      <p className={styles.muted}>
                        {entry.source === "workspace"
                          ? "형식 지원 여부 미확인"
                          : "런타임 설정 정보를 보고하지 않습니다."}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <ConfigurationExtensions />
      <ConfigurationDraftEditor />
      {catalog &&
        (Object.keys(collectionNames) as (keyof typeof collectionNames)[]).map(
          (key) => (
            <section className={styles.group} key={key}>
              <h3>{collectionNames[key]}</h3>
              {catalog[key].status === "unavailable" ? (
                <p className={styles.muted}>
                  사용 불가 · 신뢰 확인 또는 런타임 지원이 필요합니다.
                </p>
              ) : !catalog[key].entries.length ? (
                <p className={styles.muted}>
                  사용 가능 · 등록된 항목이 없습니다.
                </p>
              ) : (
                <ul>
                  {catalog[key].entries.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name}</strong>
                      {entry.description && <p>{entry.description}</p>}
                      {key === "skills" ? (
                        <>
                          <p className={styles.muted}>
                            {observationNames.reported}
                          </p>
                          <p className={styles.metadata}>
                            <span>
                              출처:{" "}
                              {entry.source
                                ? sourceNames[entry.source]
                                : "정보 없음"}
                            </span>
                            <span>
                              범위:{" "}
                              {entry.scope
                                ? scopeNames[entry.scope]
                                : "정보 없음"}
                            </span>
                          </p>
                          {entry.path ? (
                            <p className={styles.path}>{entry.path}</p>
                          ) : (
                            <p className={styles.muted}>경로 정보 없음</p>
                          )}
                        </>
                      ) : key === "mcp" ? (
                        <>
                          <small>상태: {mcpStatusLabel(entry.status)}</small>
                          {entry.status === "needs_auth" && (
                            <p className={styles.muted}>
                              기존 MCP 구성에서 외부 인증 설정을 확인하세요.
                            </p>
                          )}
                        </>
                      ) : (
                        entry.status && <small>상태: {entry.status}</small>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )}
      <p className={styles.muted}>
        명령 실행과 스킬 언급은 작성기의 명령 목록에서 선택하세요.
      </p>
    </section>
  );
}
