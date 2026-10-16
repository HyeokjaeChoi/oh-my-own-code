import { useEffect, useRef } from "react";
import { Button, EmptyState, Notice, Section } from "@workbench/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WorkbenchCatalog } from "../../shared/api/index.js";
import { ConfigurationExtensions } from "../../features/configuration-extensions/index.js";
import { ConfigurationDraftEditor } from "../../features/configuration-drafts/index.js";
import styles from "./settings.module.css";

export type ExtensionSub =
  | "mcp"
  | "skills"
  | "agents"
  | "instructions"
  | "commands"
  | "native";

type CatalogCollection = WorkbenchCatalog["mcp"];
const sourceNames = { workspace: "작업 공간", runtime: "런타임" } as const;
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

const TITLES: Record<ExtensionSub, string> = {
  mcp: "MCP",
  skills: "스킬",
  agents: "에이전트",
  instructions: "지침 (AGENTS.md)",
  commands: "명령",
  native: "런타임 확장",
};
const ORDER: ExtensionSub[] = [
  "mcp",
  "skills",
  "agents",
  "instructions",
  "commands",
  "native",
];
const CONFIG_KIND: Partial<
  Record<ExtensionSub, "mcp" | "skills" | "agents" | "instructions">
> = {
  mcp: "mcp",
  skills: "skills",
  agents: "agents",
  instructions: "instructions",
};

function summary(sub: ExtensionSub, catalog: WorkbenchCatalog | null) {
  if (sub === "native") return "조회해서 확인";
  if (!catalog) return "확인 중";
  if (sub === "instructions") {
    const n =
      catalog.configuration?.entries.filter((e) => e.kind === "instructions")
        .length ?? 0;
    return n ? `${n}개 발견` : "발견 없음";
  }
  const collection: CatalogCollection = catalog[sub];
  return collection.status === "unavailable"
    ? "사용 불가"
    : `${collection.entries.length}개`;
}

function Collection({
  sub,
  catalog,
}: {
  sub: "mcp" | "skills" | "agents" | "commands";
  catalog: WorkbenchCatalog | null;
}) {
  const collection = catalog?.[sub];
  if (!collection) return null;
  return (
    <Section title="런타임 목록">
      {collection.status === "unavailable" ? (
        <p className={styles.muted}>
          사용 불가 · 신뢰 확인 또는 런타임 지원이 필요합니다.
        </p>
      ) : !collection.entries.length ? (
        <p className={styles.muted}>등록된 항목이 없습니다.</p>
      ) : (
        <ul className={styles.plainList}>
          {collection.entries.map((entry) => (
            <li key={entry.id} className={styles.entry}>
              <strong>{entry.name}</strong>
              {entry.description && (
                <span className={styles.muted}>{entry.description}</span>
              )}
              {sub === "mcp" ? (
                <>
                  <span className={styles.muted}>
                    상태: {mcpStatusLabel(entry.status)}
                  </span>
                  {entry.status === "needs_auth" && (
                    <span className={styles.muted}>
                      기존 MCP 구성에서 외부 인증 설정을 확인하세요.
                    </span>
                  )}
                </>
              ) : sub === "skills" ? (
                <span className={styles.muted}>
                  {observationNames.reported}
                  {entry.source ? ` · ${sourceNames[entry.source]}` : ""}
                  {entry.scope ? ` · ${scopeNames[entry.scope]}` : ""}
                </span>
              ) : (
                entry.status && (
                  <span className={styles.muted}>상태: {entry.status}</span>
                )
              )}
              {sub === "skills" && entry.path && (
                <span className={styles.path}>{entry.path}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ConfigSources({ catalog }: { catalog: WorkbenchCatalog | null }) {
  if (!catalog) return null;
  const configuration = catalog.configuration;
  return (
    <Section
      title="설정 출처"
      description="런타임 설정 문서의 적용 상태는 아직 확인하지 않습니다."
      info="파일 발견과 실제 적용 상태는 다릅니다."
    >
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
                확인한 경로에서 설정 파일이나 디렉터리를 발견하지 못했습니다.
                실제 적용 여부는 확인하지 않습니다.
              </p>
            )}
          <ul className={styles.plainList}>
            {configuration.entries.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <strong>{configurationNames[entry.kind]}</strong>
                <span className={styles.muted}>
                  출처: {sourceNames[entry.source]} · 범위:{" "}
                  {scopeNames[entry.scope]}
                </span>
                {entry.path ? (
                  <span className={styles.path}>{entry.path}</span>
                ) : (
                  <span className={styles.muted}>경로 정보 없음</span>
                )}
                <span className={styles.muted}>
                  {observationNames[entry.state]}
                </span>
                {entry.reason === "path_denied" && (
                  <span className={styles.muted}>
                    경로를 확인할 수 없습니다.
                  </span>
                )}
                {entry.reason === "unsupported_format" && (
                  <span className={styles.muted}>변환 미지원</span>
                )}
                {entry.reason === "not_reported" && (
                  <span className={styles.muted}>
                    {entry.source === "workspace"
                      ? "형식 지원 여부 미확인"
                      : "런타임 설정 정보를 보고하지 않습니다."}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// "확장": list of extension kinds that drill into one sub-view each. The
// configuration editors themselves are unchanged and workspace-scoped.
export function ExtensionsSettings({
  catalog,
  error,
  refresh,
  sub,
  onSubChange,
}: {
  catalog: WorkbenchCatalog | null;
  error: string;
  refresh: () => void;
  sub: ExtensionSub | null;
  onSubChange: (_sub: ExtensionSub | null) => void;
}) {
  const lastSubRef = useRef<ExtensionSub>(undefined);
  const rowRefs = useRef<Partial<Record<ExtensionSub, HTMLButtonElement>>>({});
  // Back returns focus to the row that was opened.
  useEffect(() => {
    if (!sub && lastSubRef.current)
      rowRefs.current[lastSubRef.current]?.focus();
  }, [sub]);
  if (sub) {
    const kind = CONFIG_KIND[sub];
    return (
      <>
        <Button
          size="compact"
          className={styles.back ?? ""}
          onClick={() => onSubChange(null)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          확장
        </Button>
        <h3 className={styles.subTitle}>{TITLES[sub]}</h3>
        {error && <Notice tone="danger">{error}</Notice>}
        {sub === "native" ? (
          <ConfigurationExtensions />
        ) : (
          <>
            {sub !== "instructions" && (
              <Collection sub={sub} catalog={catalog} />
            )}
            {sub === "mcp" && (
              <p className={styles.muted}>
                작업 공간을 목록에서 제거하려면 이 앱이 등록한 MCP 항목을 먼저
                제거하세요. ‘작업 공간 MCP 제어’의 ‘등록 제거’를 사용하세요.
                파일은 유지됩니다.
              </p>
            )}
            {sub === "commands" && (
              <p className={styles.muted}>
                명령 실행과 스킬 언급은 작성기의 명령 목록에서 선택하세요.
              </p>
            )}
            {kind && <ConfigurationDraftEditor fixedKind={kind} />}
          </>
        )}
      </>
    );
  }
  return (
    <>
      {error && (
        <Notice
          tone="danger"
          action={
            <Button size="compact" onClick={refresh}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      )}
      {!catalog && !error && <EmptyState title="목록 확인 중…" />}
      <Section
        title="확장 종류"
        info="설정 출처와 런타임 목록을 확인하고, 이 창 안의 임시 초안을 작성해 파일에 저장할 수 있습니다. 항목을 선택하면 종류별 관리 화면으로 이동합니다."
      >
        <ul className={styles.plainList} aria-label="확장 종류">
          {ORDER.map((item) => (
            <li key={item}>
              <button
                type="button"
                className={styles.navRow}
                ref={(node) => {
                  if (node) rowRefs.current[item] = node;
                }}
                onClick={() => {
                  lastSubRef.current = item;
                  onSubChange(item);
                }}
              >
                <span className={styles.navName}>{TITLES[item]}</span>
                <span className={styles.navStatus}>
                  {summary(item, catalog)}
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          size="compact"
          className={styles.refresh ?? ""}
          onClick={refresh}
        >
          새로고침
        </Button>
      </Section>
      <ConfigSources catalog={catalog} />
    </>
  );
}
