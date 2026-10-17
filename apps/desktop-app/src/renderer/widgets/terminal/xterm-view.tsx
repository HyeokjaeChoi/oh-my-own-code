import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  callTerminal as call,
  createResizeSync,
  TERMINAL_LIMITS,
  type TerminalInfo,
  type TerminalRead,
} from "../../shared/terminal/index.js";
import styles from "./terminal.module.css";

const SCROLLBACK = 5000;
const SEND_MS = 8;
const RETRY_MS = 250;
const MAX_SEND_RETRIES = 40;
const MAX_PASTE_CHARS = 1024 * 1024;
// Light-background ANSI colors; xterm's built-in palette is tuned for dark backgrounds.
const LIGHT_ANSI: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#107c10",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14a014",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const SCREEN_READER_ATTR = "data-terminal-screen-reader";
const screenReaderOn = () =>
  document.documentElement.getAttribute(SCREEN_READER_ATTR) === "true";
const isMac = /Mac/i.test(navigator.platform);
const isWin = /Win/i.test(navigator.platform);

function readTheme(el: HTMLElement): { theme: ITheme; font: string } {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const colors = {
    background: v("--omoc-semantic-color-terminal-surface"),
    foreground: v("--omoc-semantic-color-text-primary"),
    cursor: v("--omoc-semantic-color-text-primary"),
    selectionBackground: v("--omoc-semantic-color-selection-background"),
  };
  const theme: ITheme = dark ? {} : { ...LIGHT_ANSI };
  for (const [k, c] of Object.entries(colors))
    if (c) theme[k as keyof ITheme] = c as never;
  return { font: v("--omoc-semantic-type-family-code") ?? "monospace", theme };
}

// Splits at code-point boundaries so the validated IPC text stays well-formed.
function* chunks(text: string, max: number) {
  for (let i = 0; i < text.length; ) {
    let end = Math.min(i + max, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    yield text.slice(i, end);
    i = end;
  }
}

// One xterm.js instance per mounted terminal. Output is pulled by cursor from the host's bounded
// ring (a remount replays it); keystrokes are batched into validated terminal.write calls.
export function XtermView({
  terminalId,
  onInfo,
  onError,
  onLeave,
  hintId,
}: {
  terminalId: string;
  onLeave: () => void;
  hintId: string;
  onInfo: (info: TerminalInfo) => void;
  onError: (code: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onInfo, onError, onLeave });
  callbacks.current = { onInfo, onError, onLeave };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stopped = false;
    const { theme, font } = readTheme(el);
    const term = new Terminal({
      fontFamily: font,
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: SCROLLBACK,
      screenReaderMode: screenReaderOn(),
      theme,
      allowProposedApi: false,
      // OSC 8 hyperlinks from program output are never opened: no confirm(), no window.open.
      linkHandler: { activate: () => {}, allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.textarea?.setAttribute("aria-label", "터미널 입력");
    term.textarea?.setAttribute("aria-describedby", hintId);

    const restyle = () => {
      const next = readTheme(el);
      term.options.theme = next.theme;
      term.options.fontFamily = next.font;
      term.options.screenReaderMode = screenReaderOn();
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", restyle);
    const themeWatch = new MutationObserver(restyle);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", SCREEN_READER_ATTR],
    });

    // Size: fit to the container; the debounced sync tells the host only the latest grid.
    const sizeSync = createResizeSync({
      send: (cols, rows) =>
        call({ type: "terminal.resize", terminalId, cols, rows }),
    });
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (stopped || el.clientWidth === 0 || el.clientHeight === 0) return;
        try {
          fit.fit();
        } catch {
          return;
        }
        sizeSync.request(term.cols, term.rows);
      });
    };
    const resizeWatch = new ResizeObserver(refit);
    resizeWatch.observe(el);
    refit();

    // Input: coalesce keystrokes, chunk to the IPC cap, never send NUL.
    let pending = "";
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let sending = Promise.resolve();
    // A chunk the host rate-limits is retried (not dropped), so large pastes arrive complete.
    const sendChunk = async (text: string) => {
      for (let attempt = 0; attempt < MAX_SEND_RETRIES && !stopped; attempt++) {
        const r = await call({ type: "terminal.write", terminalId, text });
        if (r.ok) return kick();
        if (r.code !== "RATE_LIMITED") return callbacks.current.onError(r.code);
        await new Promise((done) => setTimeout(done, RETRY_MS));
      }
      if (!stopped) callbacks.current.onError("RATE_LIMITED");
    };
    const flush = () => {
      sendTimer = undefined;
      const data = pending
        .replace(LONE_SURROGATE, "\ufffd")
        .replaceAll("\0", "");
      pending = "";
      for (const text of chunks(data, TERMINAL_LIMITS.inputChars))
        sending = sending.then(() => sendChunk(text));
    };
    // Paste: drop control characters (notably ESC, which could end bracketed paste early) and
    // refuse oversized pastes outright instead of letting middle chunks go missing.
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.length > MAX_PASTE_CHARS)
        return callbacks.current.onError("PASTE_TOO_LARGE");
      // eslint-disable-next-line no-control-regex
      term.paste(text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""));
    };
    term.element?.addEventListener("paste", onPaste, true);
    const input = term.onData((d) => {
      pending += d;
      sendTimer ??= setTimeout(flush, SEND_MS);
    });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      // Keyboard-trap escape (WCAG 2.1.2): Tab/Esc belong to the shell, so this chord hands focus on.
      if (e.ctrlKey && e.shiftKey && key === "m") {
        e.preventDefault();
        callbacks.current.onLeave();
        return false;
      }
      const copy =
        key === "c" &&
        (isMac
          ? e.metaKey
          : e.ctrlKey && (e.shiftKey || (isWin && term.hasSelection())));
      if (copy && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      // Let the browser's paste event reach xterm (which handles bracketed paste).
      const paste =
        key === "v" && (isMac ? e.metaKey : e.ctrlKey && (e.shiftKey || isWin));
      return !paste;
    });

    // Output: pull by cursor; wait for xterm to consume each chunk before the next read.
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle = 0;
    let inflight = false;
    let exitedSeen = false;
    // Typing should echo promptly even when the poll has backed off.
    const kick = () => {
      idle = 0;
      if (inflight || stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), 0);
    };
    const poll = async () => {
      inflight = true;
      try {
        await pull();
      } finally {
        inflight = false;
      }
    };
    const pull = async () => {
      const r = await call<TerminalRead>({
        type: "terminal.read",
        terminalId,
        cursor,
      });
      if (stopped) return;
      if (!r.ok) {
        callbacks.current.onError(r.code);
        return;
      }
      const { output, truncated, ...info } = r.value;
      cursor = r.value.cursor;
      callbacks.current.onInfo(info);
      if (truncated) term.write("\r\n\x1b[2m[이전 출력 생략]\x1b[0m\r\n");
      if (output) {
        idle = 0;
        await new Promise<void>((done) => term.write(output, done));
      } else idle = Math.min(idle + 1, 10);
      if (stopped) return;
      if (info.status === "exited") {
        // One more pass drains what arrived with the exit, then stop polling.
        if (exitedSeen && !output) return;
        exitedSeen = true;
      }
      timer = setTimeout(() => void poll(), idle > 3 ? 50 : 16);
    };
    void poll();
    term.focus();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(sendTimer);
      cancelAnimationFrame(frame);
      sizeSync.dispose();
      media.removeEventListener("change", restyle);
      themeWatch.disconnect();
      resizeWatch.disconnect();
      term.element?.removeEventListener("paste", onPaste, true);
      input.dispose();
      term.dispose();
    };
  }, [terminalId]);

  return (
    <div
      ref={host}
      role="group"
      aria-label="터미널 화면"
      className={styles.screen}
    />
  );
}
