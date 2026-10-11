import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  parseExternalUrl,
  parseLocalUrl,
  type PreviewFile,
  type PreviewRequest,
  type PreviewResult,
  type PreviewState,
} from "../../shared/preview/index.js";
import styles from "./preview.module.css";

const POLL_MS = 400;
async function call<T>(request: PreviewRequest): Promise<PreviewResult<T>> {
  try {
    return (await window.desktopBridge.preview(request)) as PreviewResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
const errors: Record<string, string> = {
  URL_DENIED:
    "로컬 개발 서버(localhost, 127.0.0.1, [::1])만 미리볼 수 있습니다.",
  NOT_FOUND: "파일을 찾을 수 없습니다.",
  PATH_DENIED: "작업 공간 밖의 파일은 열 수 없습니다.",
  UNSUPPORTED_TYPE: "HTML, Markdown, 이미지 파일만 미리볼 수 있습니다.",
  TOO_LARGE: "파일이 너무 큽니다 (5MB 초과).",
};

export function PreviewPanel({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<PreviewState>();
  const [url, setUrl] = useState("http://localhost:3000/");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<PreviewFile>();
  const [error, setError] = useState<string>();
  const [external, setExternal] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);
  const last = useRef("");
  const fail = (code: string) =>
    setError(errors[code] ?? "미리보기 요청을 처리하지 못했습니다.");

  const sendBounds = useCallback(() => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return;
    const b = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    const key = JSON.stringify(b);
    if (key === last.current) return;
    last.current = key;
    void call({ type: "preview.bounds", ...b });
  }, []);

  // The native view floats above the page at the placeholder's rect, so it must follow layout.
  // Closing on unmount destroys the view with the panel (and a window close destroys it in main).
  useEffect(() => {
    let stopped = false;
    const observer = new ResizeObserver(sendBounds);
    if (stage.current) observer.observe(stage.current);
    window.addEventListener("resize", sendBounds);
    const timer = setInterval(() => {
      sendBounds();
      void call<PreviewState>({ type: "preview.state" }).then((r) => {
        if (stopped || !r.ok) return;
        setState(r.value);
        if (r.value.externalRequest) setExternal(r.value.externalRequest);
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      clearInterval(timer);
      void call({ type: "preview.close" });
    };
  }, [sendBounds]);

  const go = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const target = url.trim();
    if (parseLocalUrl(target)) {
      setFile(undefined);
      last.current = "";
      const r = await call<PreviewState>({
        type: "preview.open",
        workspaceId,
        url: target,
      });
      if (!r.ok) return fail(r.code);
      setState(r.value);
      sendBounds();
    } else if (parseExternalUrl(target)) setExternal(target);
    else fail("URL_DENIED");
  };
  const openFile = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    last.current = "";
    const r = await call<PreviewFile>({
      type: "preview.openFile",
      workspaceId,
      path: path.trim(),
    });
    if (!r.ok) return fail(r.code);
    setFile(r.value);
    if (r.value.kind === "html") {
      setState(r.value.state);
      sendBounds();
    }
  };
  const nav = (action: "back" | "forward" | "reload") =>
    void call<PreviewState>({ type: "preview.nav", action }).then(
      (r) => r.ok && setState(r.value),
    );
  const closeAll = async () => {
    setFile(undefined);
    setState(undefined);
    await call({ type: "preview.close" });
  };
  const confirmExternal = async () => {
    const target = external;
    setExternal(undefined);
    if (target) await call({ type: "preview.openExternal", url: target });
  };

  const isUrl = state?.open && state.mode === "url";
  const status = state?.error
    ? `불러오지 못했습니다: ${state.error} (서버가 실행 중인지 확인하세요)`
    : state?.loading
      ? "불러오는 중…"
      : undefined;
  return (
    <section className={styles.panel} aria-label="미리보기">
      <h2>미리보기</h2>
      <form className={styles.row} onSubmit={(e) => void go(e)}>
        <button
          type="button"
          onClick={() => nav("back")}
          disabled={!isUrl || !state?.canGoBack}
          aria-label="뒤로"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => nav("forward")}
          disabled={!isUrl || !state?.canGoForward}
          aria-label="앞으로"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => nav("reload")}
          disabled={!isUrl}
          aria-label="새로고침"
        >
          ↻
        </button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="미리보기 주소"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit">열기</button>
        <button
          type="button"
          onClick={() => setExternal(state?.url || url.trim())}
          disabled={!parseExternalUrl(state?.url || url.trim())}
        >
          외부에서 열기
        </button>
        <button type="button" onClick={() => void closeAll()}>
          닫기
        </button>
      </form>
      <form className={styles.row} onSubmit={(e) => void openFile(e)}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="작업 공간 파일 경로 (html, md, 이미지)"
          aria-label="미리볼 작업 공간 파일"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={!path.trim()}>
          파일 열기
        </button>
      </form>
      {external && (
        <div
          role="alertdialog"
          aria-label="외부 열기 확인"
          className={styles.row}
        >
          <span>기본 브라우저에서 엽니다: {external}</span>
          <button type="button" onClick={() => void confirmExternal()}>
            열기
          </button>
          <button type="button" onClick={() => setExternal(undefined)}>
            취소
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {status && (
        <p role="status" className={state?.error ? styles.error : styles.muted}>
          {status}
        </p>
      )}
      <div ref={stage} className={styles.stage}>
        {file?.kind === "markdown" && (
          // ponytail: plain text, not rendered Markdown; the existing renderer is bound to assistant-ui message context.
          <pre className={styles.text} tabIndex={0}>
            {file.text}
          </pre>
        )}
        {file?.kind === "image" && (
          <img
            className={styles.image}
            src={file.dataUrl}
            alt="미리보기 이미지"
          />
        )}
        {!file && !state?.open && (
          <p className={styles.muted}>
            로컬 개발 서버 주소(localhost, 127.0.0.1, [::1])나 작업 공간 파일을
            여세요.
          </p>
        )}
      </div>
    </section>
  );
}
