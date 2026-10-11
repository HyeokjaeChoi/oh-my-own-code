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
          {view.content && (
            <details>
              <summary>읽은 내용</summary>
              <pre>{view.content}</pre>
            </details>
          )}
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
          {view.output && (
            <details>
              <summary>출력</summary>
              <pre>{view.output}</pre>
            </details>
          )}
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
