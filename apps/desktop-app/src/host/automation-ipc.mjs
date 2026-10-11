import { validateAutomationRequest } from "../renderer/shared/automation/index.mjs";

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });

// Closed channel: job definitions are validated here; the renderer never supplies a command line.
export function bindAutomationIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:automation", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = validateAutomationRequest(args[0]);
    if (!r) return err("INVALID_REQUEST");
    try {
      switch (r.type) {
        case "automation.list":
          return ok(await host.list());
        case "automation.create":
          return ok(await host.create(r.job));
        case "automation.update":
          return ok(await host.update(r.jobId, r.job));
        case "automation.setEnabled":
          return ok(await host.setEnabled(r.jobId, r.enabled));
        case "automation.remove":
          return ok(await host.remove(r.jobId));
        default:
          return ok(await host.runNow(r.jobId));
      }
    } catch (e) {
      return err(e?.automationCode ?? "RUNTIME_ERROR");
    }
  });
}
