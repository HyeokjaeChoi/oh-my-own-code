const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);

export function bindNotifyIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:notify", (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = args[0];
    if (!r || typeof r !== "object" || Array.isArray(r))
      return err("INVALID_REQUEST");
    if (r.type === "notify.status") return ok(host.status());
    if (r.type === "notify.clicked") return ok(host.takeClicked());
    if (
      r.type === "notify.show" &&
      typeof r.text === "string" &&
      r.text.length > 0 &&
      r.text.length <= 200 &&
      (r.workspaceId === undefined || id(r.workspaceId)) &&
      (r.sessionId === undefined || id(r.sessionId))
    )
      return ok(host.show(r));
    return err("INVALID_REQUEST");
  });
}
