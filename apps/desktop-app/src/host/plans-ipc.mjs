import { validatePlansRequest } from "../renderer/shared/plans/index.mjs";

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });

// Separate from desktop:v2:workbench: approvals/check records are host-owned app metadata.
export function bindPlansIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:plans", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = validatePlansRequest(args[0]);
    if (!r) return err("INVALID_REQUEST");
    const owner = String(event.sender.id);
    try {
      switch (r.type) {
        case "plans.list":
          return ok(await host.list(owner, r.workspaceId));
        case "plans.create":
          return ok(await host.create(owner, r));
        case "plans.approve":
          return ok(await host.approve(owner, r));
        case "plans.link":
          return ok(await host.link(owner, r));
        default:
          return ok(await host.check(owner, r));
      }
    } catch (e) {
      return err(e?.plansCode ?? "RUNTIME_ERROR");
    }
  });
}
