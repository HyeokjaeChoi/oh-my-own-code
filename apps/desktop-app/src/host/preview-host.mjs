import {
  navigationDecision,
  parseExternalUrl,
  parseLocalUrl,
} from "../renderer/shared/preview/index.mjs";
import { createPreviewFiles, previewKind } from "./preview-files.mjs";

const fail = (code) => Object.assign(new Error(code), { previewCode: code });
const IDLE = {
  open: false,
  mode: "url",
  url: "",
  file: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  externalRequest: null,
};

// Owns one isolated native preview view per owner (renderer window). `createView({mode, workspaceId})`
// is injected: it returns { webContents, setBounds(rect), destroy() } and applies the session/webPreferences
// lockdown (see preview-view.mjs). Workspace files are served by `files` under a per-open token origin.
// Everything policy-related that can be unit-tested lives here.
export function createPreviewHost({
  createView,
  resolveWorkspace,
  openExternal,
}) {
  const files = createPreviewFiles({ resolveWorkspace });
  const views = new Map(); // owner -> { view, mode, token?, origin?, error, externalRequest, bounds }

  function destroy(owner) {
    const e = views.get(owner);
    if (!e) return;
    views.delete(owner);
    if (e.token) files.revoke(e.token);
    try {
      e.view.destroy();
    } catch {
      // already gone
    }
  }
  const fileOf = (url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.slice(1));
    } catch {
      return "";
    }
  };
  function snapshot(owner) {
    const e = views.get(owner);
    if (!e) return { ...IDLE };
    const wc = e.view.webContents;
    return {
      open: true,
      mode: e.mode,
      url: e.mode === "file" ? "" : wc.getURL(),
      file: e.mode === "file" ? fileOf(wc.getURL()) : "",
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: e.error,
      externalRequest: e.externalRequest,
    };
  }
  // url views are reused per workspace; file views are always fresh (new token, new origin).
  function ensure(owner, mode, workspaceId, site) {
    const cur = views.get(owner);
    if (mode === "url" && cur?.mode === mode && cur.workspaceId === workspaceId)
      return cur;
    destroy(owner);
    const view = createView({ mode, workspaceId });
    const e = {
      view,
      mode,
      workspaceId,
      token: site?.token,
      origin: site?.origin,
      error: null,
      externalRequest: null,
    };
    views.set(owner, e);
    if (cur?.bounds) view.setBounds((e.bounds = cur.bounds));
    const wc = view.webContents;
    const guard = (event) => {
      const decision = navigationDecision(e.mode, event.url, e.origin);
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
    async open(owner, workspaceId, url) {
      const local = parseLocalUrl(url);
      if (!local) throw fail("URL_DENIED");
      const e = ensure(owner, "url", workspaceId);
      e.error = null;
      await e.view.ready; // session lockdown (proxy) applied; rejects => open fails closed
      try {
        await e.view.webContents.loadURL(local);
      } catch {
        // did-fail-load recorded the error; a failed load still leaves the view usable for retry.
      }
      return snapshot(owner);
    },
    async openFile(owner, workspaceId, path) {
      const kind = previewKind(path);
      if (!kind) throw fail("UNSUPPORTED_TYPE");
      // Refuses absolute/escaping/symlinked/missing paths before any view is created.
      const site = await files.register(workspaceId, path);
      let e;
      try {
        e = ensure(owner, "file", workspaceId, site);
      } catch (err) {
        files.revoke(site.token);
        throw err;
      }
      try {
        await e.view.ready;
      } catch (err) {
        destroy(owner);
        files.revoke(site.token);
        throw err;
      }
      try {
        await e.view.webContents.loadURL(site.entry);
      } catch {
        // surfaced through did-fail-load
      }
      return { kind, state: snapshot(owner) };
    },
    serve: (url) => files.serve(url),
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
      if (action === "back" && wc.navigationHistory.canGoBack()) wc.goBack();
      else if (action === "forward" && wc.navigationHistory.canGoForward())
        wc.goForward();
      else if (action === "reload") wc.reload();
      return snapshot(owner);
    },
    state: snapshot,
    // Only the page's current http(s) URL or a link the page asked for (confirmed in the UI).
    openExternal(owner, url) {
      const e = views.get(owner);
      const u = parseExternalUrl(url) ?? parseLocalUrl(url);
      const known = e && [e.externalRequest, e.view.webContents.getURL()];
      if (!u || !known?.includes(u)) throw fail("URL_DENIED");
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
