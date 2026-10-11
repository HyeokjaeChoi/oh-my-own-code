import { validateTerminalRequest } from "../renderer/shared/terminal/index.mjs";

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });

// Separate from desktop:v2:workbench: terminals are host-owned processes, not workbench records.
export function bindTerminalIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:terminal", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = validateTerminalRequest(args[0]);
    if (!r) return err("INVALID_REQUEST");
    const owner = String(event.sender.id);
    try {
      switch (r.type) {
        case "terminal.start":
          return ok(
            r.script === undefined
              ? host.start(owner, r)
              : await host.startScript(owner, r),
          );
        case "terminal.scripts":
          return ok(await host.scripts(owner, r.workspaceId));
        case "terminal.list":
          return ok(host.list(owner, r.workspaceId));
        case "terminal.write":
          return ok(host.write(owner, r.terminalId, r.text));
        case "terminal.read":
          return ok(host.read(owner, r.terminalId, r.cursor));
        case "terminal.resize":
          return ok(host.resize(owner, r.terminalId, r.cols, r.rows));
        case "terminal.stop":
          return ok(await host.stop(owner, r.terminalId));
        default:
          return ok(await host.close(owner, r.terminalId));
      }
    } catch (e) {
      return err(e?.terminalCode ?? "RUNTIME_ERROR");
    }
  });
}
