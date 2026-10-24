import { useCallback, useEffect, useRef, useState } from "react";
import {
  callTerminal as call,
  TERMINAL_STARTED_EVENT,
  lastStartedTerminal,
  type TerminalInfo,
} from "../../shared/terminal/index.js";
import type { ProjectActions } from "../../shared/project-actions/index.js";
import { requestPreview } from "../../shared/preview/index.js";
import { XtermView } from "./xterm-view.js";
import styles from "./terminal.module.css";
import { SquareTerminal, Plus } from "lucide-react";
import { Button, EmptyState, Notice } from "@workbench/ui";
import { useWorkbenchSelector } from "../../entities/workbench/index.js";

// A workspace auto-starts its shell once per app run, so closing the last shell
// and switching tabs does not respawn one.
const autoStartedWorkspaces = new Set<string>();
const LIST_MS = 1000;
const HINT_ID = "omoc-terminal-hint";

const errors: Record<string, string> = {
  LIMIT_REACHED: "터미널을 더 만들 수 없습니다.",
  CWD_DENIED: "작업 공간 폴더에서 터미널을 시작할 수 없습니다.",
  NOT_FOUND: "작업 공간 또는 터미널을 찾을 수 없습니다.",
  UNKNOWN_SCRIPT: "package.json에 없는 스크립트입니다.",
  NOT_RUNNING: "종료된 터미널에는 입력할 수 없습니다.",
  RATE_LIMITED: "입력이 너무 빠릅니다. 잠시 후 다시 시도하세요.",
  PTY_UNAVAILABLE: "이 빌드에서는 터미널을 사용할 수 없습니다.",
  SPAWN_FAILED: "셸을 시작하지 못했습니다.",
  PASTE_TOO_LARGE: "붙여넣기가 너무 커서 취소했습니다. (최대 1 MiB)",
};
const statusText = (t: TerminalInfo) =>
  t.status === "running"
    ? "실행 중"
    : t.signal
      ? `종료됨 · 신호 ${t.signal}`
      : `종료됨 · 종료 코드 ${t.exitCode ?? "?"}`;

export function TerminalPanel({ workspaceId }: { workspaceId: string }) {
  const [tabs, setTabs] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<string>();
  const [error, setError] = useState<string>();
  const [project, setProject] = useState<ProjectActions>();
  const [devUrls, setDevUrls] = useState<Record<string, string>>({});
  const footer = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const trusted = useWorkbenchSelector(
    (state) =>
      state.lists.workspaces.find((w) => w.id === workspaceId)?.trusted,
  );
  const fail = useCallback(
    (code: string) =>
      setError(errors[code] ?? "터미널 요청을 처리하지 못했습니다."),
    [],
  );
  const update = useCallback(
    (info: TerminalInfo) =>
      setTabs((p) =>
        p.map((t) =>
          t.terminalId === info.terminalId &&
          JSON.stringify(t) !== JSON.stringify(info)
            ? { ...t, ...info }
            : t,
        ),
      ),
    [],
  );

  // Restore tabs that survived a panel remount (or were started by the palette) and keep statuses fresh.
  useEffect(() => {
    let stopped = false;
    const refresh = (select: boolean) =>
      void call<TerminalInfo[]>({ type: "terminal.list", workspaceId }).then(
        (r) => {
          if (stopped || !r.ok) return;
          setLoaded(true);
          setTabs((prev) => [
            ...prev.map(
              (p) => r.value.find((t) => t.terminalId === p.terminalId) ?? p,
            ),
            ...r.value.filter(
              (t) => !prev.some((p) => p.terminalId === t.terminalId),
            ),
          ]);
          const started = lastStartedTerminal(workspaceId);
          const pick =
            started && r.value.some((t) => t.terminalId === started)
              ? started
              : select
                ? r.value.at(-1)?.terminalId
                : undefined;
          setActive(
            (a) => (select || !a ? pick : a) ?? a ?? r.value[0]?.terminalId,
          );
        },
      );
    refresh(false);
    const onStarted = () => refresh(true);
    window.addEventListener(TERMINAL_STARTED_EVENT, onStarted);
    void call<ProjectActions>({ type: "terminal.scripts", workspaceId }).then(
      (r) => !stopped && r.ok && setProject(r.value),
    );
    const timer = setInterval(() => refresh(false), LIST_MS);
    return () => {
      stopped = true;
      window.removeEventListener(TERMINAL_STARTED_EVENT, onStarted);
      clearInterval(timer);
    };
  }, [workspaceId]);
  const current = tabs.find((t) => t.terminalId === active);

  const start = async (script?: string) => {
    setError(undefined);
    const r = await call<TerminalInfo>({
      type: "terminal.start",
      workspaceId,
      ...(script ? { script } : {}),
    });
    if (!r.ok) return fail(r.code);
    setTabs((p) => [...p, r.value]);
    setActive(r.value.terminalId);
  };
  // First open: start a shell when trusted and none exists. An untrusted
  // workspace keeps the explicit 터미널 열기 button (the host enforces trust).
  useEffect(() => {
    if (!loaded || tabs.length || !trusted) return;
    if (autoStartedWorkspaces.has(workspaceId)) return;
    autoStartedWorkspaces.add(workspaceId);
    void start();
  }, [loaded, tabs.length, trusted, workspaceId]);
  const run = async (type: "terminal.stop" | "terminal.close") => {
    if (!current) return;
    setError(undefined);
    const r = await call<TerminalInfo>({
      type,
      terminalId: current.terminalId,
    });
    if (!r.ok) return fail(r.code);
    if (type === "terminal.close") {
      const rest = tabs.filter((t) => t.terminalId !== current.terminalId);
      setTabs(rest);
      setActive(rest[rest.length - 1]?.terminalId);
    } else update(r.value);
  };

  return (
    <section className={styles.panel} aria-label="작업 공간 터미널">
      <div className={styles.strip}>
        <div className={styles.tabs} role="tablist" aria-label="터미널 탭">
          {tabs.map((t, i) => (
            <button
              type="button"
              key={t.terminalId}
              role="tab"
              className={styles.tab}
              aria-selected={t.terminalId === active}
              onClick={() => setActive(t.terminalId)}
            >
              {t.label ?? "셸"}
              {tabs.length > 1 ? ` ${i + 1}` : ""}
              {t.status === "exited" ? " ■" : ""}
            </button>
          ))}
        </div>
        <Button
          size="compact"
          intent="quiet"
          className={styles.add}
          onClick={() => void start()}
          aria-label="새 터미널"
          title="새 터미널"
        >
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>
      {project && project.scripts.length > 0 && (
        <details className={styles.scriptBox}>
          <summary>프로젝트 스크립트 ({project.packageManager})</summary>
          <ul className={styles.scripts}>
            {project.scripts.map((s) => (
              <li key={s.name}>
                <Button
                  size="compact"
                  intent="secondary"
                  onClick={() => void start(s.name)}
                  aria-label={`${project.packageManager} run ${s.name} 실행`}
                  title={s.command}
                >
                  {s.name}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <Notice tone="danger" className={styles.error}>
          {error}
        </Notice>
      )}
      {current ? (
        <>
          <XtermView
            key={current.terminalId}
            terminalId={current.terminalId}
            onInfo={update}
            onError={fail}
            onDevUrl={(url) =>
              setDevUrls((p) => ({ ...p, [current.terminalId]: url }))
            }
            hintId={HINT_ID}
            onLeave={() =>
              footer.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus()
            }
          />
          <div className={styles.footer} ref={footer}>
            <span role="status">{statusText(current)}</span>
            {devUrls[current.terminalId] && current.status === "running" && (
              <Button
                size="compact"
                intent="secondary"
                onClick={() =>
                  requestPreview({ url: devUrls[current.terminalId]! })
                }
                title={devUrls[current.terminalId]}
              >
                미리보기에서 열기
              </Button>
            )}
            <span id={HINT_ID} className={styles.hint}>
              포커스 이동: Ctrl+Shift+M
            </span>
            <Button
              size="compact"
              intent="quiet"
              onClick={() => void run("terminal.stop")}
              disabled={current.status !== "running"}
            >
              중지
            </Button>
            <Button
              size="compact"
              intent="quiet"
              onClick={() => void run("terminal.close")}
            >
              닫기
            </Button>
          </div>
        </>
      ) : (
        <EmptyState
          className={styles.empty ?? ""}
          icon={<SquareTerminal size={20} />}
          title={
            loaded
              ? "실행 중인 터미널이 없습니다"
              : "터미널을 확인하는 중입니다"
          }
          action={
            <Button
              size="compact"
              intent="primary"
              disabled={!loaded}
              onClick={() => void start()}
            >
              터미널 열기
            </Button>
          }
        />
      )}
    </section>
  );
}
