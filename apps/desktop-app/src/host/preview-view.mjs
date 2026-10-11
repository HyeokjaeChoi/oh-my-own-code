import { session, WebContentsView } from "electron";

// Electron-bound factory for the isolated preview view (not unit-testable without Electron).
// Isolation: in-memory partition (no persist: prefix => nothing written to disk), no preload,
// sandbox + contextIsolation, no node, all permissions denied, downloads cancelled.
// Two fixed in-memory partitions (url / inert), configured once, instead of one per view.
export function createPreviewViewFactory({ getWindow }) {
  const sessions = new Map();
  function sessionFor(inert) {
    let ses = sessions.get(inert);
    if (ses) return ses;
    ses = session.fromPartition(inert ? "preview-inert" : "preview-url");
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    if (inert)
      // Workspace HTML is a data: document with JS off; it may load nothing else.
      ses.webRequest.onBeforeRequest((d, cb) =>
        cb({ cancel: !d.url.startsWith("data:") }),
      );
    sessions.set(inert, ses);
    return ses;
  }
  return function createView({ inert }) {
    const win = getWindow();
    if (!win) throw new Error("no window");
    const ses = sessionFor(Boolean(inert));
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        javascript: !inert,
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
