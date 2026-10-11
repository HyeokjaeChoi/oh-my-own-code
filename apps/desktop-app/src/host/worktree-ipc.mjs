const ok = (value) => ({ ok: true, value });
const err = (code, extra) => ({ ok: false, code, ...extra });
const id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/.test(v);
const text = (v, max) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const SHAPES = {
  "worktree.create": [["workspaceId", "branch", "base"], ["path"]],
  "worktree.inspect": [["workspaceId"], []],
  "worktree.delete": [["workspaceId"], ["force"]],
};
function parse(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.hasOwn(SHAPES, value.type)
  )
    return undefined;
  const [required, optional] = SHAPES[value.type];
  const allowed = new Set(["type", ...required, ...optional]);
  if (
    Reflect.ownKeys(value).some((k) => !allowed.has(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    return undefined;
  if (!id(value.workspaceId)) return undefined;
  for (const k of ["branch", "base"])
    if (k in value && !text(value[k], 100)) return undefined;
  if ("path" in value && !text(value.path, 1024)) return undefined;
  if ("force" in value && typeof value.force !== "boolean") return undefined;
  return value;
}

// Separate from desktop:v2:workbench: git/filesystem effects are host-owned.
// info(workspaceId) -> { path, ownership } | undefined (registered workspaces only).
// trusted(workspaceId) -> boolean.
export function bindWorktreeIpc({
  ipcMain,
  admit,
  host,
  info,
  trusted,
  confirmDelete,
}) {
  ipcMain.handle("desktop:v1:worktree", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = parse(args[0]);
    if (!r) return err("INVALID_REQUEST");
    const w = info(r.workspaceId);
    if (!w) return err("UNKNOWN_WORKSPACE");
    // Git can run repo-configured code; only trusted workspaces (the terminal rule) may reach it.
    if (!trusted(r.workspaceId)) return err("UNTRUSTED_WORKSPACE");
    try {
      if (r.type === "worktree.create") {
        const made = await host.create({
          repo: w.path,
          branch: r.branch,
          base: r.base,
          dest: r.path,
        });
        return ok(made);
      }
      if (r.type === "worktree.inspect") return ok(await host.inspect(w));
      const found = await host.inspect(w);
      if (found.reasons.length && r.force !== true)
        return err("UNSAFE", { reasons: found.reasons });
      if (!(await confirmDelete({ ...found, force: r.force === true })))
        return err("CANCELLED");
      await host.remove({ ...w, force: r.force === true });
      return ok({ kind: found.kind });
    } catch (e) {
      return err(
        e?.worktreeCode ?? "RUNTIME_ERROR",
        e?.reasons ? { reasons: e.reasons } : {},
      );
    }
  });
}
