import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  stripAnsi,
  TERMINAL_LIMITS,
  type TerminalInfo,
  type TerminalRead,
  type TerminalResult,
  type TerminalRequest,
} from "../../shared/terminal/index.js";
import styles from "./terminal.module.css";

type Tab = TerminalInfo & { text: string; cursor: number };
const POLL_MS = 300;
const KEEP_CHARS = TERMINAL_LIMITS.outputChars;

async function call<T>(request: TerminalRequest): Promise<TerminalResult<T>> {
  try {
    return (await window.desktopBridge.terminal(request)) as TerminalResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
const errors: Record<string, string> = {
  LIMIT_REACHED: "터미널을 더 만들 수 없습니다.",
  CWD_DENIED: "작업 공간 폴더에서 터미널을 시작할 수 없습니다.",
  NOT_FOUND: "작업 공간 또는 터미널을 찾을 수 없습니다.",
  NOT_RUNNING: "종료된 터미널에는 입력할 수 없습니다.",
};
const statusText = (t: TerminalInfo) =>
  t.status === "running"
    ? "실행 중"
    : t.signal
      ? `종료됨 · 신호 ${t.signal}`
      : `종료됨 · 종료 코드 ${t.exitCode ?? "?"}`;

export function TerminalPanel({ workspaceId }: { workspaceId: string }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string>();
  const [line, setLine] = useState("");
  const [error, setError] = useState<string>();
  const cursors = useRef(new Map<string, number>());
  const output = useRef<HTMLPreElement>(null);
  const fail = (code: string) =>
    setError(errors[code] ?? "터미널 요청을 처리하지 못했습니다.");

  const merge = useCallback((reads: TerminalRead[]) => {
    setTabs((prev) =>
      prev.map((t) => {
        const r = reads.find((x) => x.terminalId === t.terminalId);
        if (!r) return t;
        const text = (t.text + stripAnsi(r.output)).slice(-KEEP_CHARS);
        cursors.current.set(t.terminalId, r.cursor);
        return {
          ...t,
          ...r,
          text: r.truncated ? `[이전 출력 생략]\n${text}` : text,
        };
      }),
    );
  }, []);

  // Restore tabs that survived a panel remount, then poll. Output is pulled by
  // cursor so a slow renderer never loses the main-process ring buffer position.
  useEffect(() => {
    let stopped = false;
    void call<TerminalInfo[]>({ type: "terminal.list", workspaceId }).then(
      (r) => {
        if (stopped || !r.ok) return;
        setTabs(r.value.map((t) => ({ ...t, text: "", cursor: 0 })));
        setActive((a) => a ?? r.value[0]?.terminalId);
      },
    );
    const timer = setInterval(() => {
      for (const [terminalId, cursor] of cursors.current)
        void call<TerminalRead>({
          type: "terminal.read",
          terminalId,
          cursor,
        }).then((r) => !stopped && r.ok && merge([r.value]));
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [workspaceId, merge]);
  // Tabs restored from list start polling at cursor 0.
  useEffect(() => {
    for (const t of tabs)
      if (!cursors.current.has(t.terminalId))
        cursors.current.set(t.terminalId, 0);
  }, [tabs]);
  const current = tabs.find((t) => t.terminalId === active);
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [current?.text]);

  const start = async () => {
    setError(undefined);
    const r = await call<TerminalInfo>({ type: "terminal.start", workspaceId });
    if (!r.ok) return fail(r.code);
    cursors.current.set(r.value.terminalId, 0);
    setTabs((p) => [...p, { ...r.value, text: "", cursor: 0 }]);
    setActive(r.value.terminalId);
  };
  const run = async (type: "terminal.stop" | "terminal.close") => {
    if (!current) return;
    setError(undefined);
    const r = await call<TerminalInfo>({
      type,
      terminalId: current.terminalId,
    });
    if (!r.ok) return fail(r.code);
    if (type === "terminal.close") {
      cursors.current.delete(current.terminalId);
      const rest = tabs.filter((t) => t.terminalId !== current.terminalId);
      setTabs(rest);
      setActive(rest[rest.length - 1]?.terminalId);
    } else
      setTabs((p) =>
        p.map((t) =>
          t.terminalId === r.value.terminalId ? { ...t, ...r.value } : t,
        ),
      );
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || current.status !== "running") return;
    const text = `${line}\n`;
    setLine("");
    setError(undefined);
    const r = await call<TerminalInfo>({
      type: "terminal.write",
      terminalId: current.terminalId,
      text,
    });
    if (!r.ok) fail(r.code);
  };

  return (
    <section className={styles.panel} aria-label="작업 공간 터미널">
      <h2>터미널</h2>
      <div className={styles.tabs} role="tablist" aria-label="터미널 탭">
        {tabs.map((t, i) => (
          <button
            key={t.terminalId}
            role="tab"
            aria-selected={t.terminalId === active}
            onClick={() => setActive(t.terminalId)}
          >
            {i + 1}
            {t.status === "exited" ? " ■" : ""}
          </button>
        ))}
        <button onClick={() => void start()} aria-label="새 터미널">
          +
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {current ? (
        <>
          <pre
            ref={output}
            className={styles.output}
            tabIndex={0}
            aria-label="터미널 출력"
          >
            {current.text}
          </pre>
          <form className={styles.input} onSubmit={(e) => void send(e)}>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              disabled={current.status !== "running"}
              maxLength={TERMINAL_LIMITS.inputChars - 1}
              aria-label="터미널 입력"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" disabled={current.status !== "running"}>
              전송
            </button>
          </form>
          <div className={styles.footer}>
            <span role="status">{statusText(current)}</span>
            <button
              onClick={() => void run("terminal.stop")}
              disabled={current.status !== "running"}
            >
              중지
            </button>
            <button onClick={() => void run("terminal.close")}>닫기</button>
          </div>
        </>
      ) : (
        <p className={styles.muted}>
          + 로 이 작업 공간 폴더에서 터미널을 시작하세요.
        </p>
      )}
      <p className={styles.muted}>
        PTY가 아닌 파이프 기반입니다. 대화형 프로그램(vim, top)과 크기 조절은
        지원하지 않습니다.
      </p>
    </section>
  );
}
