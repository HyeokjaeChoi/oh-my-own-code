import { randomUUID } from "node:crypto";
import { session, WebContentsView } from "electron";

// Electron-bound factory for the isolated preview view (not unit-testable without Electron).
// Isolation: in-memory partition (no persist: prefix => nothing written to disk), no preload,
// sandbox + contextIsolation, no node, all permissions denied, downloads cancelled.
export function createPreviewViewFactory({ getWindow }) {
  return function createView({ inert }) {
    const win = getWindow();
    if (!win) throw new Error("no window");
    const ses = session.fromPartition(`preview-${randomUUID()}`);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    if (inert)
      // Workspace HTML is a data: document with JS off; it may load nothing else.
      ses.webRequest.onBeforeRequest((d, cb) =>
        cb({ cancel: !d.url.startsWith("data:") }),
      );
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
