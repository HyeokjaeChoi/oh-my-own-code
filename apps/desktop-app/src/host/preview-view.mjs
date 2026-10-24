import { createHash } from "node:crypto";
import { protocol, session, WebContentsView } from "electron";
import {
  PREVIEW_SCHEME,
  previewRequestAllowed,
} from "../renderer/shared/preview/index.mjs";

// Must run before app ready. `standard` gives the scheme host-based origins and relative URLs;
// no secure/fetch/bypassCSP/service-worker privileges.
export function registerPreviewScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: { standard: true, corsEnabled: true },
    },
  ]);
}

// Electron-bound factory for the isolated preview view (not unit-testable without Electron).
// Isolation: in-memory partition (no persist: prefix => nothing written to disk), no preload,
// sandbox + contextIsolation, no node, all permissions denied, downloads cancelled, and every
// network request outside the loopback allowlist cancelled (webRequest).
// One file partition (serves `omoc-preview:` only there) plus one URL partition per workspace
// (hashed id), so cookies/storage from a localhost app never leak across workspaces.
export function createPreviewViewFactory({ getWindow, serve }) {
  const sessions = new Map();
  function sessionFor(mode, workspaceId) {
    const key = mode === "file" ? "file" : String(workspaceId);
    let ses = sessions.get(key);
    if (ses) return ses;
    const name =
      mode === "file"
        ? "preview-files"
        : `preview-url-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
    ses = session.fromPartition(name);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((d, cb) =>
      cb({ cancel: !previewRequestAllowed(d.url, mode) }),
    );
    if (mode === "file")
      ses.protocol.handle(PREVIEW_SCHEME, async (req) => {
        const r = await serve(req.url);
        return new globalThis.Response(r.body, {
          status: r.status,
          headers: r.headers,
        });
      });
    sessions.set(key, ses);
    return ses;
  }
  return function createView({ mode, workspaceId }) {
    const win = getWindow();
    if (!win) throw new Error("no window");
    const ses = sessionFor(mode, workspaceId);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return {
      webContents: view.webContents,
      setBounds: (b) => view.setBounds(b),
      destroy() {
        try {
          win.contentView.removeChildView(view);
        } catch {
          // window already destroyed
        }
        if (!view.webContents.isDestroyed()) view.webContents.close();
      },
    };
  };
}
