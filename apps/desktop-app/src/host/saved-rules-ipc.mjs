import { validSavedRuleId } from "./saved-rules-host.mjs";

const err = (code) => ({ ok: false, code });
const exact = (r, keys) =>
  Object.keys(r).sort().join() === [...keys, "type"].sort().join();
const wid = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);

// Closed request set for "저장된 허용 규칙"; nothing here can create or edit a rule.
export function bindSavedRulesIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:rules", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = args[0];
    if (
      !r ||
      typeof r !== "object" ||
      Object.getPrototypeOf(r) !== Object.prototype
    )
      return err("INVALID_REQUEST");
    if (
      r.type === "rules.list" &&
      exact(r, ["workspaceId"]) &&
      wid(r.workspaceId)
    )
      return host.list(r.workspaceId);
    if (
      r.type === "rules.remove" &&
      exact(r, ["workspaceId", "id"]) &&
      wid(r.workspaceId) &&
      validSavedRuleId(r.id)
    )
      return host.remove(r.workspaceId, r.id);
    return err("INVALID_REQUEST");
  });
}
