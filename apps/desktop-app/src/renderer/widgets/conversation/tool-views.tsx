import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ToolView } from "../../shared/tool-ui/index.js";
import styles from "./conversation.module.css";

export type ToolContextValue = {
  workspaceRoot?: string | undefined;
  permissions: { id: string; title: string; detail: string; toolId?: string }[];
  openFile(_path: string): void;
};
export const ToolContext = createContext<ToolContextValue>({
  permissions: [],
  openFile: () => undefined,
});
export const useToolContext = () => useContext(ToolContext);

export function displayPath(path: string, root?: string): string {
  if (!root) return path;
  const r = root.replace(/[\\/]+$/, "");
  return path.length > r.length + 1 &&
    path.startsWith(r) &&
    /[\\/]/.test(path[r.length] ?? "")
    ? path.slice(r.length + 1)
    : path;
}
const clip = (text: string, size = 60) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

// One plain line per tool call; the full input/output stays in the details.
export function toolSummary(
  view: ToolView,
  toolName: string,
  root?: string,
): string {
  const name = (path: string) => displayPath(path, root);
  switch (view.kind) {
    case "read":
      return `${name(view.path)} 읽음`;
    case "diff": {
      const add = view.rows.filter((r) => r.sign === "+").length;
      const del = view.rows.filter((r) => r.sign === "-").length;
      return `${view.path ? name(view.path) : "패치"} 편집 +${add} −${del}`;
    }
    case "shell": {
      const command = clip(view.command.split("\n")[0] ?? "");
      return view.exitCode === null
        ? `명령 실행 · ${command}`
        : `명령 실행 · ${command} · ${view.exitCode === 0 ? "성공" : `종료 코드 ${view.exitCode}`}`;
    }
    case "search":
      return `${view.pattern ? "검색" : "목록"} · ${clip(view.pattern || view.scope || ".", 40)} · ${view.matches.length}건`;
    case "web":
      return `웹 · ${clip(view.url ?? view.query ?? "")}`;
    case "todo":
      return `할 일 ${view.items.length}개`;
    default:
      return toolName;
  }
}

// Output capped at 240px; "전체 보기" appears only when something is cut off.
export function OutputPre({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const check = () =>
      setClipped(
        element.clientHeight > 0 &&
          (expanded || element.scrollHeight > element.clientHeight + 1),
      );
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, children]);
  return (
    <>
      <pre ref={ref} className={className} data-expanded={expanded}>
        {children}
      </pre>
      {clipped && (
        <button
          type="button"
          className={styles.showAll}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "접기" : "전체 보기"}
        </button>
      )}
    </>
  );
}

function PathButton({ path, line }: { path: string; line?: number | null }) {
  const { openFile, workspaceRoot } = useToolContext();
  return (
    <button
      type="button"
      className={styles.toolPath}
      title={path}
      onClick={() => openFile(path)}
    >
      {displayPath(path, workspaceRoot)}
      {line ? `:${line}` : ""}
    </button>
  );
}

// All text is rendered as React text nodes (escaped); never as HTML.
export function ToolBody({ view }: { view: ToolView }) {
  switch (view.kind) {
    case "read":
      return (
        <div>
          <PathButton path={view.path} />
          {view.range && (
            <span className={styles.muted}>
              {" "}
              줄 {view.range.start}
              {view.range.end ? `–${view.range.end}` : "부터"}
            </span>
          )}
          {view.content && <OutputPre>{view.content}</OutputPre>}
        </div>
      );
    case "diff":
      return (
        <div>
          {view.path && <PathButton path={view.path} />}
          <OutputPre className={styles.toolDiff}>
            {view.rows.map((row, i) => (
              <span
                key={i}
                data-sign={row.sign.trim()}
                className={
                  row.sign === "+"
                    ? styles.diffAdd
                    : row.sign === "-"
                      ? styles.diffDel
                      : undefined
                }
              >
                {row.text}
                {"\n"}
              </span>
            ))}
          </OutputPre>
          {view.hiddenRows > 0 && (
            <p className={styles.muted} data-truncated="true">
              … {view.hiddenRows}줄 더 있음 (표시 한도)
            </p>
          )}
        </div>
      );
    case "shell":
      return (
        <div>
          <OutputPre>$ {view.command}</OutputPre>
          {view.exitCode !== null && (
            <p className={styles.muted}>종료 코드 {view.exitCode}</p>
          )}
          {view.output && <OutputPre>{view.output}</OutputPre>}
        </div>
      );
    case "search":
      return (
        <div>
          <p className={styles.muted}>
            {view.pattern || "목록"} {view.scope ? `· ${view.scope}` : ""} ·{" "}
            {view.matches.length}건
          </p>
          <ul className={styles.toolMatches}>
            {view.matches.map((m, i) => (
              <li key={i}>
                {m.path ? <PathButton path={m.path} line={m.line} /> : null}{" "}
                <span>{m.path ? m.text : m.text}</span>
              </li>
            ))}
          </ul>
          {view.hiddenMatches > 0 && (
            <p className={styles.muted} data-truncated="true">
              … {view.hiddenMatches}건 더 있음 (표시 한도)
            </p>
          )}
        </div>
      );
    case "web":
      return <p>{view.url ?? view.query}</p>;
    case "todo":
      return (
        <ul className={styles.toolTodos}>
          {view.items.map((t, i) => (
            <li key={i} data-todo-status={t.status}>
              {t.status === "completed" ? "☑" : "☐"} {t.content}
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}
