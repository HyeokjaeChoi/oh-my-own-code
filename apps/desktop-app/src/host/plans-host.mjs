import { renameReplacing } from "../platform-paths.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  PLAN_DIR,
  PLAN_LIMITS,
  approvalState,
  checkStatusFromTerminal,
  isPlanPath,
  nextApprovalVersion,
  planSlug,
  planTemplate,
} from "../renderer/shared/plans/index.mjs";

const fail = (code) => Object.assign(new Error(code), { plansCode: code });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const EMPTY = () => ({ approvals: [], links: [], checks: [] });

// Plan approvals, session links and verification results. Plan text stays in the
// workspace file; this keeps only hashes and host-observed process outcomes.
// terminals(owner, workspaceId) -> terminal-host views (exit code is the only check authority).
export function createPlansHost({
  resolveWorkspace,
  storeFile,
  terminals,
  now = () => new Date().toISOString(),
}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  async function load() {
    try {
      const v = JSON.parse(await readFile(storeFile(), "utf8"));
      return { ...EMPTY(), ...(v && typeof v === "object" ? v : {}) };
    } catch {
      return EMPTY();
    }
  }
  async function save(value) {
    const file = storeFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(value));
    await renameReplacing(`${file}.tmp`, file);
  }
  const rootOf = async (workspaceId) => {
    const root = resolveWorkspace(workspaceId);
    if (typeof root !== "string") throw fail("NOT_FOUND");
    try {
      return await realpath(root);
    } catch {
      throw fail("NOT_FOUND");
    }
  };
  // Regular file strictly inside the workspace root, no symlink at the leaf.
  async function readPlan(root, path) {
    if (!isPlanPath(path)) throw fail("INVALID_PATH");
    let handle;
    try {
      const target = join(root, path);
      const real = await realpath(target);
      if (!inside(root, real)) throw fail("PATH_DENIED");
      if ((await lstat(target)).isSymbolicLink()) throw fail("PATH_DENIED");
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile()) throw fail("NOT_FOUND");
      if (info.size > PLAN_LIMITS.bytes) throw fail("TOO_LARGE");
      const buf = await handle.readFile();
      return { sha256: sha(buf), bytes: buf.length };
    } catch (e) {
      throw e?.plansCode ? e : fail("NOT_FOUND");
    } finally {
      await handle?.close();
    }
  }
  async function listFiles(root) {
    let dir;
    try {
      const target = join(root, PLAN_DIR);
      dir = await realpath(target);
      if (!inside(root, dir)) return [];
      const names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
      return names.sort();
    } catch {
      return [];
    }
  }
  async function view(workspaceId, owner, mutate) {
    const root = await rootOf(workspaceId);
    return serial(async () => {
      const store = await load();
      const mine = (r) => r.workspaceId === workspaceId;
      // Running checks resolve strictly from the terminal host's observed exit.
      const views = new Map(
        terminals(owner, workspaceId).map((t) => [t.terminalId, t]),
      );
      let dirty = false;
      for (const c of store.checks.filter(mine)) {
        if (c.status !== "running") continue;
        const t = views.get(c.terminalId);
        const status = checkStatusFromTerminal(t);
        if (status === "running") continue;
        c.status = status;
        c.exitCode = t?.exitCode ?? null;
        c.finishedAt = status === "not-run" ? null : now();
        dirty = true;
      }
      const extra = mutate ? await mutate(store, root) : undefined;
      if (mutate || dirty) await save(store);
      const paths = new Set(
        (await listFiles(root)).map((n) => `${PLAN_DIR}/${n}`),
      );
      for (const r of [...store.approvals, ...store.links, ...store.checks])
        if (mine(r)) paths.add(r.path);
      const plans = [];
      for (const path of [...paths].slice(0, PLAN_LIMITS.listed)) {
        try {
          plans.push({ path, ...(await readPlan(root, path)) });
        } catch {
          // Missing or unreadable plans simply drop out of the list.
        }
      }
      return {
        plans,
        approvals: store.approvals.filter(mine),
        links: store.links.filter(mine),
        checks: store.checks.filter(mine),
        ...extra,
      };
    });
  }
  const cap = (list, max) => (list.length > max ? list.slice(-max) : list);

  return {
    list: (owner, workspaceId) => view(workspaceId, owner),
    async create(owner, { workspaceId, title }) {
      const root = await rootOf(workspaceId);
      const dir = join(root, PLAN_DIR);
      await mkdir(dir, { recursive: true });
      if (!inside(root, await realpath(dir))) throw fail("PATH_DENIED");
      const base = planSlug(title);
      for (let n = 1; n <= 20; n++) {
        const name = `${n === 1 ? base : `${base}-${n}`}.md`;
        try {
          await writeFile(join(dir, name), planTemplate(title), { flag: "wx" });
          return view(workspaceId, owner).then((v) => ({
            ...v,
            created: `${PLAN_DIR}/${name}`,
          }));
        } catch (e) {
          if (e?.code !== "EEXIST") throw fail("RUNTIME_ERROR");
        }
      }
      throw fail("EXISTS");
    },
    // Approves what the user saw: the file must still hash to the expected value.
    approve: (owner, { workspaceId, path, sha256 }) =>
      view(workspaceId, owner, async (store, root) => {
        const cur = await readPlan(root, path);
        if (cur.sha256 !== sha256) throw fail("STALE");
        const mine = store.approvals.filter(
          (r) => r.workspaceId === workspaceId,
        );
        if (approvalState(mine, path, sha256).state === "approved") return;
        store.approvals = cap(
          [
            ...store.approvals,
            {
              workspaceId,
              path,
              sha256,
              version: nextApprovalVersion(mine, path),
              approvedAt: now(),
            },
          ],
          PLAN_LIMITS.approvals,
        );
      }),
    link: (owner, { workspaceId, path, sha256, sessionId }) =>
      view(workspaceId, owner, async (store, root) => {
        const cur = await readPlan(root, path);
        if (cur.sha256 !== sha256) throw fail("STALE");
        const st = approvalState(
          store.approvals.filter((r) => r.workspaceId === workspaceId),
          path,
          sha256,
        );
        if (st.state !== "approved") throw fail("NOT_APPROVED");
        store.links = cap(
          [
            ...store.links,
            {
              workspaceId,
              sessionId,
              path,
              sha256,
              version: st.version,
              linkedAt: now(),
            },
          ],
          PLAN_LIMITS.links,
        );
      }),
    // The terminal must be a project-script run owned by this renderer in this workspace.
    check: (owner, { workspaceId, path, kind, terminalId, fingerprint }) =>
      view(workspaceId, owner, async (store, root) => {
        const t = terminals(owner, workspaceId).find(
          (x) => x.terminalId === terminalId,
        );
        if (!t || !t.script) throw fail("NOT_A_SCRIPT_RUN");
        const cur = await readPlan(root, path);
        const entry = {
          id: randomUUID(),
          workspaceId,
          path,
          kind,
          script: t.script,
          command: t.label ?? t.script,
          terminalId,
          status: checkStatusFromTerminal(t),
          exitCode: t.exitCode ?? null,
          planSha: cur.sha256,
          fingerprint: fingerprint ?? null,
          startedAt: now(),
          finishedAt: t.status === "exited" ? now() : null,
          source: "실행 결과",
        };
        store.checks = cap(
          [
            ...store.checks.filter(
              (c) =>
                !(
                  c.workspaceId === workspaceId &&
                  c.path === path &&
                  c.kind === kind &&
                  c.script === entry.script
                ),
            ),
            entry,
          ],
          PLAN_LIMITS.checks,
        );
      }),
  };
}
