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
  const sessions = new Map(); // key -> { ses, ready }
  function sessionFor(mode, workspaceId) {
    const key = mode === "file" ? "file" : String(workspaceId);
    let entry = sessions.get(key);
    if (entry) return entry;
    const name =
      mode === "file"
        ? "preview-files"
        : `preview-url-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
    const ses = session.fromPartition(name);
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
    // WebRTC ICE (STUN/TURN) and dns-prefetch/preconnect never reach webRequest or CSP. Route
    // every non-loopback socket/DNS lookup to a dead local proxy (discard port) so nothing can
    // leave the machine; loopback stays direct so localhost dev servers keep working. Fail
    // closed: views await `ready` before loading anything.
    entry = {
      ses,
      ready: ses.setProxy({
        proxyRules: "http://127.0.0.1:9",
        proxyBypassRules: "localhost,127.0.0.1,[::1]",
      }),
    };
    sessions.set(key, entry);
    return entry;
  }
  return function createView({ mode, workspaceId }) {
    const win = getWindow();
    if (!win) throw new Error("no window");
    const { ses, ready } = sessionFor(mode, workspaceId);
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
    // Keep ICE candidates to the proxied path only (no direct UDP => no STUN/TURN leak).
    view.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return {
      ready,
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
