import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  PREVIEW_LIMITS,
  navigationDecision,
  parseExternalUrl,
  parseLocalUrl,
} from "../renderer/shared/preview/index.mjs";

const fail = (code) => Object.assign(new Error(code), { previewCode: code });
const IMAGES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml", // rendered via <img> data URL: scripts never run
};
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const IDLE = {
  open: false,
  mode: "url",
  url: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  externalRequest: null,
};

// Owns one isolated native preview view per owner (renderer window). `createView({inert})` is
// injected: it returns { webContents, setBounds(rect), destroy() } and applies the session/webPreferences
// lockdown (see preview-view.mjs). Everything policy-related that can be unit-tested lives here.
export function createPreviewHost({
  createView,
  resolveWorkspace,
  openExternal,
}) {
  const views = new Map(); // owner -> { view, mode, error, externalRequest, bounds }

  function destroy(owner) {
    const e = views.get(owner);
    if (!e) return;
    views.delete(owner);
    try {
      e.view.destroy();
    } catch {
      // already gone
    }
  }
  function snapshot(owner) {
    const e = views.get(owner);
    if (!e) return { ...IDLE };
    const wc = e.view.webContents;
    return {
      open: true,
      mode: e.mode,
      url: e.mode === "inert" ? "" : wc.getURL(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: e.error,
      externalRequest: e.externalRequest,
    };
  }
  function ensure(owner, mode) {
    const cur = views.get(owner);
    if (cur?.mode === mode) return cur;
    destroy(owner);
    const view = createView({ inert: mode === "inert" });
    const e = { view, mode, error: null, externalRequest: null };
    views.set(owner, e);
    if (cur?.bounds) view.setBounds((e.bounds = cur.bounds));
    const wc = view.webContents;
    const guard = (event) => {
      const decision = navigationDecision(e.mode, event.url);
      if (decision === "allow") return;
      event.preventDefault();
      if (decision === "external") e.externalRequest = event.url;
    };
    wc.on("will-frame-navigate", guard);
    wc.on("will-redirect", guard);
    wc.setWindowOpenHandler(({ url }) => {
      const external = parseExternalUrl(url) ?? parseLocalUrl(url);
      if (external) e.externalRequest = external;
      return { action: "deny" };
    });
    wc.on("did-start-loading", () => {
      e.error = null;
    });
    wc.on("did-fail-load", (_ev, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) e.error = desc || "LOAD_FAILED"; // -3: aborted
    });
    return e;
  }

  return {
    async open(owner, url) {
      const local = parseLocalUrl(url);
      if (!local) throw fail("URL_DENIED");
      const e = ensure(owner, "url");
      e.error = null;
      try {
        await e.view.webContents.loadURL(local);
      } catch {
        // did-fail-load recorded the error; a failed load still leaves the view usable for retry.
      }
      return snapshot(owner);
    },
    async openFile(owner, workspaceId, path) {
      const root = resolveWorkspace(workspaceId);
      if (!root) throw fail("NOT_FOUND");
      const ext = extname(path).toLowerCase();
      const kind =
        ext === ".md" || ext === ".markdown"
          ? "markdown"
          : ext === ".html" || ext === ".htm"
            ? "html"
            : IMAGES[ext]
              ? "image"
              : undefined;
      if (!kind) throw fail("UNSUPPORTED_TYPE");
      let real;
      try {
        const base = realpathSync(root);
        real = realpathSync(resolve(base, path));
        if (!inside(base, real)) throw fail("PATH_DENIED");
        const st = statSync(real);
        if (!st.isFile()) throw fail("NOT_FOUND");
        if (st.size > PREVIEW_LIMITS.fileBytes) throw fail("TOO_LARGE");
      } catch (err) {
        throw err?.previewCode ? err : fail("NOT_FOUND");
      }
      const bytes = readFileSync(real);
      if (kind === "image") {
        destroy(owner);
        return {
          kind,
          dataUrl: `data:${IMAGES[ext]};base64,${bytes.toString("base64")}`,
        };
      }
      const text = bytes.toString("utf8");
      if (kind === "markdown") {
        destroy(owner);
        return { kind, text };
      }
      // HTML: a fresh inert view (JS disabled, every request except data: blocked, no navigation).
      // data: URL instead of file: or a custom protocol: no filesystem or origin authority is granted
      // to the document, so relative links/assets simply do not resolve.
      const e = ensure(owner, "inert");
      e.error = null;
      try {
        await e.view.webContents.loadURL(
          `data:text/html;charset=utf-8;base64,${Buffer.from(text).toString("base64")}`,
        );
      } catch {
        // surfaced through did-fail-load
      }
      return { kind, state: snapshot(owner) };
    },
    setBounds(owner, rect) {
      const e = views.get(owner);
      if (!e) return;
      e.bounds = rect;
      e.view.setBounds(rect);
    },
    nav(owner, action) {
      const e = views.get(owner);
      if (!e) throw fail("NOT_OPEN");
      const wc = e.view.webContents;
      if (e.mode === "inert") return snapshot(owner);
      if (action === "back" && wc.navigationHistory.canGoBack()) wc.goBack();
      else if (action === "forward" && wc.navigationHistory.canGoForward())
        wc.goForward();
      else if (action === "reload") wc.reload();
      return snapshot(owner);
    },
    state: snapshot,
    openExternal(url) {
      const u = parseExternalUrl(url) ?? parseLocalUrl(url);
      if (!u) throw fail("URL_DENIED");
      return openExternal(u);
    },
    clearExternalRequest(owner) {
      const e = views.get(owner);
      if (e) e.externalRequest = null;
    },
    close(owner) {
      destroy(owner);
      return { ...IDLE };
    },
    closeOwner: destroy,
    closeAll() {
      for (const owner of [...views.keys()]) destroy(owner);
    },
  };
}
