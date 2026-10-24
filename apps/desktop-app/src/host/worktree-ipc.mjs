import { lstatSync } from "node:fs";
import { join } from "node:path";
const ok = (value) => ({ ok: true, value });
const err = (code, extra) => ({ ok: false, code, ...extra });
const id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/.test(v);
const text = (v, max) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const SHAPES = {
  "worktree.create": [["workspaceId", "branch", "base"], []],
  "worktree.inspect": [["workspaceId"], []],
  "worktree.delete": [["workspaceId"], []],
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
  return value;
}

// Separate from desktop:v2:workbench: git/filesystem effects are host-owned.
// info(workspaceId) -> { path, ownership } | undefined (registered workspaces only).
// trusted(workspaceId) -> boolean.
// activity(workspaceId) -> { sessions, busy, terminals }: affected sessions, whether one is
// running, and open terminal tabs. Re-read right before the trash, never cached.
export function bindWorktreeIpc({
  ipcMain,
  admit,
  host,
  info,
  trusted,
  activity,
  confirmTrust,
  confirmDelete,
}) {
  if (typeof activity !== "function") throw new TypeError("activity required");
  const blockers = (workspaceId) => {
    const found = activity(workspaceId);
    const why = [];
    if (found.busy) why.push("실행 중인 세션이 있습니다");
    if (found.terminals)
      why.push(`열려 있는 터미널 ${found.terminals}개가 있습니다`);
    return { found, why };
  };
  ipcMain.handle("desktop:v1:worktree", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = parse(args[0]);
    if (!r) return err("INVALID_REQUEST");
    const w = info(r.workspaceId);
    if (!w) return err("UNKNOWN_WORKSPACE");
    // Git can run repo-configured code. Create stays trusted-only. Inspect/delete of an untrusted
    // workspace need the native trust confirmation first (per operation) when the folder has a
    // .git entry. Without .git the host runs git only under a ceiling (no parent repo discovery),
    // so a managed plain folder needs no gate and an imported one is refused before any prompt.
    if (!trusted(r.workspaceId)) {
      if (r.type === "worktree.create") return err("UNTRUSTED_WORKSPACE");
      let hasGit = true;
      try {
        lstatSync(join(w.path, ".git"));
      } catch {
        hasGit = false;
      }
      if (!hasGit && w.ownership !== "managed") return err("NOT_DELETABLE");
      if (hasGit && !(await confirmTrust(w.path, r.type)))
        return err("UNTRUSTED_WORKSPACE");
    }
    try {
      if (r.type === "worktree.create") {
        const made = await host.create({
          repo: w.path,
          branch: r.branch,
          base: r.base,
        });
        return ok(made);
      }
      if (r.type === "worktree.inspect") return ok(await host.inspect(w));
      // Delete: every condition is checked, confirmed, then checked again right before the trash.
      const first = blockers(r.workspaceId);
      if (first.why.length) return err("UNSAFE", { reasons: first.why });
      const found = await host.inspect(w);
      if (found.reasons.length)
        return err("UNSAFE", { reasons: found.reasons });
      if (!(await confirmDelete({ ...found, sessions: first.found.sessions })))
        return err("CANCELLED");
      const last = blockers(r.workspaceId);
      if (last.why.length) return err("UNSAFE", { reasons: last.why });
      const current = info(r.workspaceId);
      if (!current || current.path !== w.path) return err("UNKNOWN_WORKSPACE");
      await host.remove(current);
      return ok({ kind: found.kind });
    } catch (e) {
      return err(
        e?.worktreeCode ?? "RUNTIME_ERROR",
        e?.reasons ? { reasons: e.reasons } : {},
      );
    }
  });
}
