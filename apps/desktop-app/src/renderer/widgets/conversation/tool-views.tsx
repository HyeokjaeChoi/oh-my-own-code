import { createContext, useContext } from "react";
import type { ToolView } from "../../shared/tool-ui/index.js";
import styles from "./conversation.module.css";

export type ToolContextValue = {
  permissions: { id: string; title: string; detail: string; toolId?: string }[];
  openFile(_path: string): void;
};
export const ToolContext = createContext<ToolContextValue>({
  permissions: [],
  openFile: () => undefined,
});
export const useToolContext = () => useContext(ToolContext);

const base = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const clip = (text: string, size = 60) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

// One plain line per tool call; the full input/output stays in the details.
export function toolSummary(view: ToolView, toolName: string): string {
  switch (view.kind) {
    case "read":
      return `${base(view.path)} 읽음`;
    case "diff": {
      const add = view.rows.filter((r) => r.sign === "+").length;
      const del = view.rows.filter((r) => r.sign === "-").length;
      return `${view.path ? base(view.path) : "패치"} 편집 +${add} −${del}`;
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

function PathButton({ path, line }: { path: string; line?: number | null }) {
  const { openFile } = useToolContext();
  return (
    <button
      type="button"
      className={styles.toolPath}
      onClick={() => openFile(path)}
    >
      {path}
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
          {view.content && <pre>{view.content}</pre>}
        </div>
      );
    case "diff":
      return (
        <div>
          {view.path && <PathButton path={view.path} />}
          <pre className={styles.toolDiff}>
            {view.rows.slice(0, 400).map((row, i) => (
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
          </pre>
        </div>
      );
    case "shell":
      return (
        <div>
          <pre>$ {view.command}</pre>
          {view.exitCode !== null && (
            <p className={styles.muted}>종료 코드 {view.exitCode}</p>
          )}
          {view.output && <pre>{view.output}</pre>}
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
