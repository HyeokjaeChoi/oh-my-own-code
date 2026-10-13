import { redactText } from "../renderer/shared/data-transfer/index.mjs";

// Main-side view of Native's per-project "always allow" rules. Native owns the
// rows (`permission.saved.*`); this lists and removes them for one registered,
// trusted workspace. Saved rules are allow-only: the deny floor and the .git
// guard are session policy, never rows here, so nothing in this module can edit them.
const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const MAX_ROWS = 500;
const GLOBAL_PROJECT = "global";
const safe = (v, n) => redactText(clip(v, n)).text;

export const validSavedRuleId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(v);

export function createSavedRulesHost({ context, resolveWorkspace, owned }) {
  async function project(workspaceId) {
    const c = context();
    const directory = resolveWorkspace(workspaceId);
    if (!c?.client || typeof directory !== "string") return undefined;
    const info = await c.client.location.get({ location: { directory } });
    const id = info?.project?.id;
    return typeof id === "string" && id ? { client: c.client, id } : undefined;
  }
  async function rows(p) {
    const all = await p.client.permission.saved.list({ projectID: p.id });
    if (!Array.isArray(all)) throw new Error("invalid_saved_list");
    return all.filter((r) => r?.projectID === p.id && validSavedRuleId(r.id));
  }
  return {
    async list(workspaceId) {
      try {
        const p = await project(workspaceId);
        if (!p) return err("UNAVAILABLE");
        return ok({
          // Rules belong to the Native project (shared by its worktrees); the
          // shared "global" project is never removable from here.
          global: p.id === GLOBAL_PROJECT,
          rules: (await rows(p)).slice(0, MAX_ROWS).map((r) => ({
            id: r.id,
            action: safe(r.action, 200),
            resource: safe(r.resource, 500),
          })),
        });
      } catch {
        return err("UNAVAILABLE");
      }
    },
    async remove(workspaceId, id) {
      if (!owned()) return err("UNAVAILABLE");
      try {
        const p = await project(workspaceId);
        if (!p) return err("UNAVAILABLE");
        if (p.id === GLOBAL_PROJECT) return err("GLOBAL_PROJECT");
        // Only a row Native lists for this workspace's own project can be removed.
        if (!(await rows(p)).some((r) => r.id === id)) return err("NOT_FOUND");
        await p.client.permission.saved.remove({ id });
        return ok({ removed: true });
      } catch {
        return err("UNAVAILABLE");
      }
    },
  };
}
