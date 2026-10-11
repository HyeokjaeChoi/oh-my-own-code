import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMessagePartText } from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./conversation.module.css";

type CopyStatus = "idle" | "pending" | "success" | "error";
const copyMessages: Record<CopyStatus, string> = {
  idle: "",
  pending: "복사 중입니다.",
  success: "복사했습니다.",
  error: "복사하지 못했습니다. 텍스트를 선택해 복사해 주세요.",
};

function CopyButton({
  text,
  kind,
}: {
  text: string;
  kind: "code" | "message";
}) {
  const [result, setResult] = useState<{ source: string; status: CopyStatus }>({
    source: text,
    status: "idle",
  });
  const generation = useRef(0);
  const pending = useRef(false);
  // The conversation's existing workspace/session key owns scope. Text changes
  // and unmount retire only status authority; an OS write already sent cannot
  // be cancelled or reported as cancelled.
  useLayoutEffect(() => {
    generation.current++;
    pending.current = false;
    setResult({ source: text, status: "idle" });
    return () => {
      generation.current++;
    };
  }, [text]);
  const status = result.source === text ? result.status : "idle";
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    setResult({ source: text, status: "pending" });
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (typeof clipboard?.writeText !== "function")
        throw new Error("Clipboard unavailable");
      await clipboard.writeText(text);
      if (generation.current === current)
        setResult({ source: text, status: "success" });
    } catch {
      if (generation.current === current)
        setResult({ source: text, status: "error" });
    } finally {
      if (generation.current === current) pending.current = false;
    }
  };
  return (
    <div className={styles.copyControl} data-copy-control={kind}>
      <button type="button" disabled={status === "pending"} onClick={copy}>
        {kind === "code" ? "코드 복사" : "표시된 메시지 복사"}
      </button>
      <span role="status" data-copy-status={status}>
        {copyMessages[status]}
      </span>
    </div>
  );
}

function CodeHeader({ language, code }: CodeHeaderProps) {
  return (
    <div className={styles.codeHeader}>
      <span>{language || "코드"}</span>
      <CopyButton text={code} kind="code" />
    </div>
  );
}

// Semantic data only: no node props, raw HTML, image src or navigation action
// reaches the DOM. Keep the parser's default escaped-HTML behavior.
const components = {
  CodeHeader,
  a: ({
    children,
    href,
  }: {
    children?: ReactNode;
    href?: string | undefined;
  }) => (
    <span className={styles.markdownLink} data-markdown-link>
      {children}
      {href ? <span> ({href})</span> : null}
    </span>
  ),
  img: ({ alt }: { alt?: string | undefined }) => (
    <span className={styles.markdownImage} data-markdown-image>
      이미지: {alt || "설명 없음"}
    </span>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre
      className={styles.markdownCode}
      data-markdown-code
      tabIndex={0}
      role="region"
      aria-label="코드 블록"
    >
      {children}
    </pre>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div
      className={styles.markdownTable}
      data-markdown-table
      tabIndex={0}
      role="region"
      aria-label="Markdown 표"
    >
      <table>{children}</table>
    </div>
  ),
};
const remarkPlugins = [remarkGfm];
const containerProps = {
  "data-markdown-text": "",
  "aria-label": "도우미 메시지",
};

export function AssistantText() {
  const { text } = useMessagePartText();
  return (
    <div>
      <MarkdownTextPrimitive
        className={styles.markdown}
        containerProps={containerProps}
        smooth={false}
        defer={true}
        remarkPlugins={remarkPlugins}
        components={components}
      />
      <CopyButton text={text} kind="message" />
    </div>
  );
}

export function LiteralText() {
  const { text } = useMessagePartText();
  return (
    <div>
      <div className={styles.messageText} data-literal-text>
        {text}
      </div>
      <CopyButton text={text} kind="message" />
    </div>
  );
}
