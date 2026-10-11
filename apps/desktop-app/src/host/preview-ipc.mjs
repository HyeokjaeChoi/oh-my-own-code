import { validatePreviewRequest } from "../renderer/shared/preview/index.mjs";

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });

// Separate from workbench/terminal channels: the preview view is a host-owned native surface.
export function bindPreviewIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:preview", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = validatePreviewRequest(args[0]);
    if (!r) return err("INVALID_REQUEST");
    const owner = String(event.sender.id);
    try {
      switch (r.type) {
        case "preview.open":
          return ok(await host.open(owner, r.workspaceId, r.url));
        case "preview.openFile":
          return ok(await host.openFile(owner, r.workspaceId, r.path));
        case "preview.bounds":
          host.setBounds(owner, {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          });
          return ok(null);
        case "preview.nav":
          return ok(host.nav(owner, r.action));
        case "preview.state":
          return ok(host.state(owner));
        case "preview.openExternal":
          host.clearExternalRequest(owner);
          await host.openExternal(r.url);
          return ok(null);
        default:
          return ok(host.close(owner));
      }
    } catch (e) {
      return err(e?.previewCode ?? "RUNTIME_ERROR");
    }
  });
}
