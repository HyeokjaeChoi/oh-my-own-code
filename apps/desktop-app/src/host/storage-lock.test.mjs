import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const identity = (pid) => ({
  pid,
  platform: "darwin",
  bootId: "synthetic-boot",
  startToken: `start-${pid}`,
});
const load = () => import("./storage-lock.mjs");
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "omoc-owner-unit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const held = new Set();
  const states = new Map();
  const calls = [];
  const api = await load();
  function owner(pid, options = {}) {
    const appIdentity = identity(pid);
    states.set(pid, "alive");
    let key;
    const kernel = {
      acquire(root) {
        calls.push("kernel");
        if (held.has(root)) return false;
        held.add(root);
        key = root;
        return true;
      },
      isHeld() {
        return held.has(key);
      },
      release() {
        calls.push("release");
        held.delete(key);
      },
    };
    return api.createStorageOwner({
      root,
      kernel,
      processVerifier: api.createProcessVerifier({
        captureCurrent: () => appIdentity,
        inspect: (expected) => ({
          state: states.get(expected.pid) ?? "unverified",
          identity: expected,
          evidence: "os_identity",
        }),
      }),
      ...options,
    });
  }
  return { root, held, states, calls, owner, api };
}

test("spawn intent without a recorded PID never permits takeover or clean release", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101);
  assert.deepEqual(await a.acquire({ initialize: true }), { state: "ready" });
  assert.deepEqual(await a.markSpawnIntent(a.getNonce()), { state: "ready" });
  assert.deepEqual(await a.release(a.getNonce()), {
    state: "recovery_required",
    reason: "owner_unverified",
  });
  f.states.set(101, "exited");
  f.held.clear(); // Synthetic kernel process exit, never a real PID kill.
  const bytes = await fs.readFile(join(f.root, "owner.json"));
  assert.deepEqual(await f.owner(102).acquire(), {
    state: "recovery_required",
    reason: "owner_unverified",
  });
  assert.deepEqual(await fs.readFile(join(f.root, "owner.json")), bytes);
  assert.equal(f.calls.includes("release"), false);
});

const blocked = (reason) => ({ state: "recovery_required", reason });
const recordPath = (f) => join(f.root, "owner.json");
async function read(f) {
  return JSON.parse(await fs.readFile(recordPath(f), "utf8"));
}
async function rewrite(f, patch) {
  const { createHash } = await import("node:crypto");
  const r = { ...(await read(f)), ...patch };
  delete r.checksum;
  r.checksum = createHash("sha256").update(JSON.stringify(r)).digest("hex");
  await fs.writeFile(recordPath(f), JSON.stringify(r), { mode: 0o600 });
}
async function started(f) {
  const a = f.owner(101);
  assert.deepEqual(await a.acquire({ initialize: true }), { state: "ready" });
  const n = a.getNonce();
  assert.deepEqual(await a.markSpawnIntent(n), { state: "ready" });
  f.states.set(201, "alive");
  assert.deepEqual(await a.recordChild(n, identity(201)), { state: "ready" });
  return { a, n };
}

test("concurrent same-root owners: denied kernel never opens owner record or writes", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101);
  await a.acquire({ initialize: true });
  let storageCalls = 0;
  const b = f.owner(102, {
    io: {
      ...fs,
      open() {
        storageCalls++;
        throw new Error("PRIVATE");
      },
      lstat() {
        storageCalls++;
        throw new Error("PRIVATE");
      },
    },
  });
  assert.deepEqual(await b.acquire(), blocked("owner_conflict"));
  assert.equal(storageCalls, 0);
  assert.equal(b.getNonce(), null);
  assert.deepEqual(await a.assertOwned(a.getNonce()), { state: "ready" });
});

test("simultaneous acquisition returns exactly one owner", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.owner(101).acquire({ initialize: true }),
    f.owner(102).acquire({ initialize: true }),
  ]);
  assert.equal(results.filter((r) => r.state === "ready").length, 1);
  assert.equal(results.filter((r) => r.reason === "owner_conflict").length, 1);
});

test("canonical symlink aliases conflict; separate canonical roots do not", async (t) => {
  const f = await fixture(t);
  const alias = `${f.root}-alias`;
  await fs.symlink(f.root, alias);
  t.after(() => fs.unlink(alias));
  await f.owner(101).acquire({ initialize: true });
  assert.deepEqual(
    await f.owner(102, { root: alias }).acquire(),
    blocked("owner_conflict"),
  );
  const other = join(f.root, "other");
  await fs.mkdir(other, { mode: 0o700 });
  assert.deepEqual(
    await f.owner(103, { root: other }).acquire({ initialize: true }),
    { state: "ready" },
  );
});

test("missing root or missing record in populated store is preserved and blocked", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f
      .owner(101, { root: join(f.root, "missing") })
      .acquire({ initialize: true }),
    blocked("storage_denied"),
  );
  await fs.writeFile(join(f.root, "journal-sentinel"), "KEEP");
  assert.deepEqual(
    await f.owner(102).acquire({ initialize: true }),
    blocked("owner_unverified"),
  );
  assert.equal(
    await fs.readFile(join(f.root, "journal-sentinel"), "utf8"),
    "KEEP",
  );
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
});

test("empty roots require explicit initialization", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.owner(101).acquire(), blocked("owner_unverified"));
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
});

test("corrupt/partial/extra-key/unsupported owner records are never recreated", async (t) => {
  for (const kind of [
    "corrupt",
    "partial",
    "extra",
    "version",
    "checksum",
    "missing-fields",
  ]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      await f.owner(101).acquire({ initialize: true });
      if (kind === "corrupt")
        await fs.writeFile(recordPath(f), "PRIVATE CORRUPT");
      if (kind === "partial")
        await fs.writeFile(recordPath(f), '{"version":5,');
      if (kind === "extra") await rewrite(f, { private: "PRIVATE" });
      if (kind === "version") await rewrite(f, { version: 4 });
      if (kind === "checksum")
        await fs.writeFile(
          recordPath(f),
          JSON.stringify({ ...(await read(f)), nonce: "different" }),
        );
      if (kind === "missing-fields") await fs.writeFile(recordPath(f), "{}");
      const before = await fs.readFile(recordPath(f));
      f.held.clear();
      f.states.set(101, "exited");
      const result = await f.owner(102).acquire({ initialize: true });
      assert.deepEqual(
        result,
        blocked(
          kind === "version" ? "unsupported_version" : "owner_unverified",
        ),
      );
      assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
      assert.deepEqual(await fs.readFile(recordPath(f)), before);
    });
  }
});

test("root binding and owned nonce changes block writes", async (t) => {
  for (const patch of [
    { root: "/synthetic-wrong-root" },
    { rootIdentity: "0:0" },
    { nonce: "different-nonce" },
  ]) {
    await t.test(JSON.stringify(patch), async (t) => {
      const f = await fixture(t);
      const a = f.owner(101);
      await a.acquire({ initialize: true });
      await rewrite(f, patch);
      const bytes = await fs.readFile(recordPath(f));
      assert.deepEqual(
        await a.markSpawnIntent(a.getNonce()),
        blocked("identity_conflict"),
      );
      assert.deepEqual(await fs.readFile(recordPath(f)), bytes);
    });
  }
});

test("dirty takeover requires exact app AND child termination; PID age/absence/reuse do not suffice", async (t) => {
  for (const [appState, childState, expected] of [
    ["alive", "exited", "owner_unverified"],
    ["exited", "alive", "owner_unverified"],
    ["unverified", "exited", "owner_unverified"],
    ["exited", "unverified", "owner_unverified"],
    ["identity_conflict", "exited", "identity_conflict"],
    ["exited", "identity_conflict", "identity_conflict"],
    ["exited", "exited", null],
  ]) {
    await t.test(`${appState}/${childState}`, async (t) => {
      const f = await fixture(t);
      await started(f);
      const previous = await read(f);
      f.states.set(101, appState);
      f.states.set(201, childState);
      f.held.clear();
      const b = f.owner(102);
      assert.deepEqual(
        await b.acquire(),
        expected ? blocked(expected) : { state: "ready" },
      );
      if (expected) assert.deepEqual(await read(f), previous);
      else {
        assert.notEqual(b.getNonce(), previous.nonce);
        assert.equal((await read(f)).cleanShutdown, false);
      }
      assert.equal(f.calls.includes("release"), false);
    });
  }
});

test("process verifier rejects PID-only, replacement identity, stale boot and unsupported evidence", async () => {
  const { createProcessVerifier } = await load();
  for (const result of [
    { state: "exited", identity: { pid: 201 }, evidence: "os_identity" },
    {
      state: "exited",
      identity: { ...identity(201), startToken: "reused" },
      evidence: "os_identity",
    },
    {
      state: "exited",
      identity: { ...identity(201), bootId: "old-boot" },
      evidence: "os_identity",
    },
    { state: "exited", identity: identity(201), evidence: "PID_absent" },
    { state: "alive", identity: identity(201), evidence: "owned_exit" },
  ])
    assert.equal(
      await createProcessVerifier({ inspect: () => result }).verify(
        identity(201),
      ),
      "unverified",
    );
  assert.equal(
    await createProcessVerifier().verify(identity(201)),
    "unverified",
  );
  assert.equal(
    await createProcessVerifier({
      inspect() {
        throw new Error("PRIVATE");
      },
    }).verify(identity(201)),
    "unverified",
  );
  assert.equal(
    await createProcessVerifier({
      inspect: () => ({
        state: "exited",
        identity: identity(201),
        evidence: "owned_exit",
      }),
    }).verify(identity(201)),
    "exited",
  );
});

test("no OS identity adapter means no ready owner", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f
      .owner(101, { processVerifier: f.api.createProcessVerifier() })
      .acquire({ initialize: true }),
    blocked("owner_unverified"),
  );
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
});

test("wrong nonce, reused acquisition nonce, and child identity conflict cannot launch effects", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101);
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  assert.deepEqual(
    await a.markSpawnIntent("foreign"),
    blocked("identity_conflict"),
  );
  f.held.clear();
  f.states.set(101, "exited");
  const b = f.owner(102, { nonce: () => n });
  assert.deepEqual(await b.acquire(), blocked("identity_conflict"));
});

test("child record requires flushed intent and rejects app identity as child", async (t) => {
  for (const withIntent of [true, false]) {
    await t.test(String(withIntent), async (t) => {
      const f = await fixture(t);
      const a = f.owner(101);
      await a.acquire({ initialize: true });
      const n = a.getNonce();
      if (withIntent) await a.markSpawnIntent(n);
      assert.deepEqual(
        await a.recordChild(n, withIntent ? identity(101) : identity(201)),
        blocked("identity_conflict"),
      );
    });
  }
});

test("release waits for exact owned child exit; blocked shutdown can retry only teardown", async (t) => {
  const f = await fixture(t);
  const { a, n } = await started(f);
  assert.deepEqual(await a.release(n), blocked("owner_unverified"));
  assert.equal((await read(f)).cleanShutdown, false);
  assert.equal(f.calls.includes("release"), false);
  assert.deepEqual(await a.assertOwned(n), blocked("owner_unverified"));
  f.states.set(201, "exited");
  assert.deepEqual(await a.release(n), { released: true });
  const saved = await read(f);
  assert.equal(saved.cleanShutdown, true);
  assert.equal(saved.childExitConfirmed, true);
  assert.equal(f.held.size, 0);
  assert.equal(a.getNonce(), null);
  assert.deepEqual(await a.assertOwned(n), blocked("owner_unverified"));
  // A clean record does not bypass a still-live prior app identity.
  assert.deepEqual(await f.owner(102).acquire(), blocked("owner_unverified"));
});

test("no-child clean shutdown releases and can reopen only after app termination", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101);
  await a.acquire({ initialize: true });
  assert.deepEqual(await a.release(a.getNonce()), { released: true });
  assert.equal((await read(f)).cleanShutdown, true);
  f.states.set(101, "exited");
  assert.deepEqual(await f.owner(102).acquire(), { state: "ready" });
});

// Real fs fixture with injected failures; never an OS process or private root.
function faultIO(control) {
  return {
    ...fs,
    async open(path, flags, mode) {
      const h = await fs.open(path, flags, mode);
      return new Proxy(h, {
        get(target, prop) {
          if (["writeFile", "sync", "close"].includes(prop))
            return async (...args) => {
              const point = `${path.endsWith("owner.next") ? "next" : path.endsWith("owner.pending") ? "guard" : "directory"}.${prop}`;
              if (control.point === point)
                control.matches = (control.matches ?? 0) + 1;
              if (
                control.point === point &&
                (!control.at || control.matches === control.at)
              ) {
                control.hits++;
                if (prop === "writeFile") await target.writeFile('{"partial":');
                if (prop === "close") await target.close();
                throw new Error("PRIVATE SYNTHETIC FAILURE");
              }
              return target[prop](...args);
            };
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async rename(...args) {
      if (control.point === "rename") {
        control.hits++;
        throw new Error("PRIVATE");
      }
      return fs.rename(...args);
    },
    async unlink(...args) {
      if (control.point === "unlink") {
        control.hits++;
        throw new Error("PRIVATE");
      }
      return fs.unlink(...args);
    },
  };
}

test("write/file-sync/directory-sync/rename/close/unlink failures poison owner, preserve evidence and block reopen", async (t) => {
  for (const point of [
    "guard.writeFile",
    "guard.sync",
    "next.writeFile",
    "next.sync",
    "next.close",
    "directory.sync",
    "rename",
    "unlink",
  ]) {
    await t.test(point, async (t) => {
      const f = await fixture(t);
      const control = { point: null, hits: 0 };
      const a = f.owner(101, { io: faultIO(control) });
      await a.acquire({ initialize: true });
      const n = a.getNonce();
      control.point = point;
      assert.deepEqual(await a.markSpawnIntent(n), blocked("writer_poisoned"));
      assert.ok(control.hits > 0);
      assert.equal(a.getNonce(), null);
      const entries = await fs.readdir(f.root);
      assert.ok(entries.includes("owner.pending"));
      const saved = await fs.readFile(recordPath(f));
      assert.deepEqual(
        await a.recordChild(n, identity(201)),
        blocked("writer_poisoned"),
      );
      assert.deepEqual(await a.release(n), blocked("writer_poisoned"));
      assert.deepEqual(await fs.readFile(recordPath(f)), saved);
      assert.equal(f.calls.includes("release"), false);
      f.held.clear();
      f.states.set(101, "exited");
      assert.deepEqual(
        await f.owner(102).acquire({ initialize: true }),
        blocked("writer_poisoned"),
      );
    });
  }
});

test("initial record sync failure exposes neither ready nor nonce", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101, { io: faultIO({ point: "next.sync", hits: 0 }) });
  assert.deepEqual(
    await a.acquire({ initialize: true }),
    blocked("writer_poisoned"),
  );
  assert.equal(a.getNonce(), null);
  assert.equal(f.held.size, 1);
});

test("clean shutdown sync failure never releases kernel or claims clean success", async (t) => {
  const f = await fixture(t);
  const control = { point: null, hits: 0 };
  const a = f.owner(101, { io: faultIO(control) });
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  control.point = "next.sync";
  assert.deepEqual(await a.release(n), blocked("writer_poisoned"));
  assert.equal((await read(f)).cleanShutdown, false);
  assert.equal(f.held.size, 1);
  assert.equal(f.calls.includes("release"), false);
});

test("queued child publication cannot pass a paused or failed spawn-intent flush", async (t) => {
  const f = await fixture(t);
  let enter;
  let resume;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  let pause = false;
  const io = {
    ...fs,
    async open(path, flags, mode) {
      const h = await fs.open(path, flags, mode);
      if (!path.endsWith("owner.next")) return h;
      return new Proxy(h, {
        get(target, prop) {
          if (prop === "sync")
            return async () => {
              if (pause) {
                enter();
                await paused;
                throw new Error("PRIVATE");
              }
              return target.sync();
            };
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const a = f.owner(101, { io });
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  pause = true;
  const intent = a.markSpawnIntent(n);
  await entered;
  f.states.set(201, "alive");
  const child = a.recordChild(n, identity(201));
  assert.equal((await read(f)).spawnIntent, false);
  resume();
  assert.deepEqual(await intent, blocked("writer_poisoned"));
  assert.deepEqual(await child, blocked("writer_poisoned"));
  assert.equal((await read(f)).child, null);
});

test("Electron adapter binds canonical userData before singleton and preserves binding after override", async () => {
  const { createElectronOwnerKernel } = await load();
  const calls = [];
  let held = false;
  const app = {
    isReady: () => false,
    hasSingleInstanceLock: () => held,
    setPath: (key, value) => calls.push([key, value]),
    requestSingleInstanceLock: () => {
      calls.push(["acquire"]);
      held = true;
      return true;
    },
    releaseSingleInstanceLock: () => {
      calls.push(["release"]);
      held = false;
    },
  };
  const kernel = createElectronOwnerKernel(app);
  assert.equal(kernel.acquire("/synthetic/canonical"), true);
  app.setPath("userData", "/synthetic/disposable");
  assert.deepEqual(calls.slice(0, 2), [
    ["userData", "/synthetic/canonical"],
    ["acquire"],
  ]);
  assert.equal(kernel.isHeld(), true);
  assert.equal(kernel.acquire("/synthetic/other"), false);
  kernel.release();
  assert.equal(kernel.isHeld(), false);
  assert.ok(Object.isFrozen(kernel));
  assert.equal(
    createElectronOwnerKernel({ hasSingleInstanceLock: () => true }).acquire(
      "/already-owned",
    ),
    false,
  );
});

test("post-rename and post-unlink directory sync failure retain a reopen blocker", async (t) => {
  for (const at of [2, 3]) {
    await t.test(`directory sync ${at}`, async (t) => {
      const f = await fixture(t);
      const control = { point: null, hits: 0, matches: 0, at };
      const a = f.owner(101, { io: faultIO(control) });
      await a.acquire({ initialize: true });
      const n = a.getNonce();
      control.point = "directory.sync";
      assert.deepEqual(await a.release(n), blocked("writer_poisoned"));
      assert.equal(control.hits, 1);
      // Valid JSON can exist without acknowledged durability. It is not success.
      assert.equal((await read(f)).cleanShutdown, true);
      assert.equal(f.held.size, 1);
      await fs.access(join(f.root, "owner.pending"));
      f.held.clear();
      f.states.set(101, "exited");
      assert.deepEqual(
        await f.owner(102).acquire(),
        blocked("writer_poisoned"),
      );
    });
  }
});

test("child identity flush failure preserves spawn gap and rejects later release", async (t) => {
  const f = await fixture(t);
  const control = { point: null, hits: 0 };
  const a = f.owner(101, { io: faultIO(control) });
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  await a.markSpawnIntent(n);
  f.states.set(201, "alive");
  control.point = "next.sync";
  assert.deepEqual(
    await a.recordChild(n, identity(201)),
    blocked("writer_poisoned"),
  );
  assert.equal((await read(f)).spawnIntent, true);
  assert.equal((await read(f)).child, null);
  f.states.set(201, "exited");
  assert.deepEqual(await a.release(n), blocked("writer_poisoned"));
});

test("moved root record rejects takeover instead of relocating storage", async (t) => {
  const f = await fixture(t);
  await f.owner(101).acquire({ initialize: true });
  const other = join(f.root, "relocated");
  await fs.mkdir(other, { mode: 0o700 });
  await fs.copyFile(recordPath(f), join(other, "owner.json"));
  await fs.chmod(join(other, "owner.json"), 0o600);
  f.states.set(101, "exited");
  const before = await fs.readFile(join(other, "owner.json"));
  assert.deepEqual(
    await f.owner(102, { root: other }).acquire(),
    blocked("identity_conflict"),
  );
  assert.deepEqual(await fs.readFile(join(other, "owner.json")), before);
});

test("symlink owner record is rejected without reading or rewriting its target", async (t) => {
  const f = await fixture(t);
  const target = join(f.root, "sentinel");
  await fs.writeFile(target, "KEEP", { mode: 0o600 });
  await fs.symlink(target, recordPath(f));
  assert.deepEqual(
    await f.owner(101).acquire({ initialize: true }),
    blocked("owner_unverified"),
  );
  assert.equal(await fs.readFile(target, "utf8"), "KEEP");
  assert.equal((await fs.lstat(recordPath(f))).isSymbolicLink(), true);
});

test("lost kernel and unverified release cannot publish clean success", async (t) => {
  const f = await fixture(t);
  const { a, n } = await started(f);
  f.states.set(201, "unverified");
  assert.deepEqual(await a.release(n), blocked("owner_unverified"));
  f.held.clear();
  f.states.set(201, "exited");
  assert.deepEqual(await a.release(n), blocked("owner_unverified"));
  assert.equal((await read(f)).cleanShutdown, false);
});

test("public API and returned DTOs are frozen and exactly closed", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(Object.keys(f.api).sort(), [
    "createElectronOwnerKernel",
    "createProcessVerifier",
    "createStorageOwner",
  ]);
  const a = f.owner(101);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(Object.keys(a).sort(), [
    "acquire",
    "assertOwned",
    "getNonce",
    "markSpawnIntent",
    "recordChild",
    "release",
    "status",
  ]);
  assert.ok(Object.isFrozen(await a.acquire({ initialize: true })));
  assert.deepEqual(Object.keys(a.status()), ["state"]);
  assert.ok(Object.isFrozen(await a.release(a.getNonce())));
  assert.deepEqual(a.status(), blocked("owner_unverified"));
});

test("permissions and oversized record errors return closed recovery without rewriting bytes", async (t) => {
  for (const kind of ["root-mode", "record-mode", "oversize"]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      if (kind === "root-mode") {
        await fs.chmod(f.root, 0o777);
        t.after(() => fs.chmod(f.root, 0o700).catch(() => {}));
        assert.deepEqual(
          await f.owner(101).acquire({ initialize: true }),
          blocked("storage_denied"),
        );
        assert.deepEqual(f.calls, []);
        return;
      }
      await f.owner(101).acquire({ initialize: true });
      if (kind === "record-mode") await fs.chmod(recordPath(f), 0o644);
      else await fs.writeFile(recordPath(f), "x".repeat(16385));
      const before = await fs.readFile(recordPath(f));
      f.held.clear();
      f.states.set(101, "exited");
      assert.deepEqual(
        await f.owner(102).acquire(),
        blocked(kind === "record-mode" ? "storage_denied" : "owner_unverified"),
      );
      assert.deepEqual(await fs.readFile(recordPath(f)), before);
    });
  }
});

test("active canonical alias retarget blocks the old handle", async (t) => {
  const f = await fixture(t);
  const alias = `${f.root}-alias`;
  await fs.symlink(f.root, alias);
  t.after(() => fs.unlink(alias));
  const a = f.owner(101, { root: alias });
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  const other = join(f.root, "other");
  await fs.mkdir(other, { mode: 0o700 });
  await fs.unlink(alias);
  await fs.symlink(other, alias);
  assert.deepEqual(await a.markSpawnIntent(n), blocked("identity_conflict"));
  assert.equal((await read(f)).spawnIntent, false);
});

test("kernel release failure exposes no released success", async (t) => {
  const f = await fixture(t);
  const kernel = {
    acquire: () => true,
    isHeld: () => true,
    release() {
      throw new Error("PRIVATE");
    },
  };
  const a = f.owner(101, { kernel });
  await a.acquire({ initialize: true });
  assert.deepEqual(await a.release(a.getNonce()), blocked("owner_unverified"));
  assert.equal((await read(f)).cleanShutdown, true);
  assert.equal(a.getNonce(), null);
  const b = f.api.createElectronOwnerKernel({
    hasSingleInstanceLock: () => true,
  });
  assert.equal(b.acquire("/synthetic"), false);
});

test("unchanged kernel after release is not reported released", async (t) => {
  const f = await fixture(t);
  const a = f.owner(101, {
    kernel: { acquire: () => true, isHeld: () => true, release() {} },
  });
  await a.acquire({ initialize: true });
  assert.deepEqual(await a.release(a.getNonce()), blocked("owner_unverified"));
});

test("sync pre-acquired kernel binds async owner to exactly the same canonical root without another singleton request", async (t) => {
  const f = await fixture(t);
  const canonical = await fs.realpath(f.root);
  let held = false;
  let singletonRequests = 0;
  const paths = [];
  const app = {
    hasSingleInstanceLock: () => held,
    setPath: (key, value) => paths.push([key, value]),
    requestSingleInstanceLock: () => {
      singletonRequests++;
      held = true;
      return true;
    },
    releaseSingleInstanceLock: () => {
      held = false;
    },
  };
  const kernel = f.api.createElectronOwnerKernel(app);
  assert.equal(kernel.acquire(canonical), true); // Main's synchronous phase.
  const a = f.owner(101, { kernel });
  assert.deepEqual(await a.acquire({ initialize: true }), { state: "ready" });
  assert.equal(singletonRequests, 1);
  assert.deepEqual(paths, [["userData", canonical]]);
  assert.equal(kernel.acquire(`${canonical}/different`), false);
  assert.equal(singletonRequests, 1);
  assert.deepEqual(await a.release(a.getNonce()), { released: true });
  assert.equal(kernel.acquire(canonical), false); // No reacquisition after release.
});

test("lost pre-acquired kernel cannot be reused or requested again", async () => {
  const { createElectronOwnerKernel } = await load();
  let held = false;
  let requests = 0;
  const kernel = createElectronOwnerKernel({
    hasSingleInstanceLock: () => held,
    setPath() {},
    requestSingleInstanceLock() {
      requests++;
      held = true;
      return true;
    },
  });
  assert.equal(kernel.acquire("/synthetic/canonical"), true);
  held = false;
  assert.equal(kernel.acquire("/synthetic/canonical"), false);
  assert.equal(requests, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("witness app ACK fences first owner publication and failures preserve no authority", async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    ack = deferred();
  const a = f.owner(101, {
    lifetimeWitness: {
      register(context) {
        entered.resolve(context);
        return ack.promise;
      },
    },
  });
  const acquisition = a.acquire({ initialize: true });
  const context = await Promise.race([
    entered.promise,
    acquisition.then(() => {
      throw new Error("owner published without witness ACK");
    }),
  ]);
  assert.equal(context.role, "app");
  assert.deepEqual(context.identity, identity(101));
  assert.equal(a.getNonce(), null);
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
  ack.resolve(blocked("owner_unverified"));
  assert.deepEqual(await acquisition, blocked("owner_unverified"));
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
});

test("child ACK fences publication and rechecks kernel/record after await", async (t) => {
  for (const drift of ["none", "kernel", "record", "root", "failure"])
    await t.test(drift, async (t) => {
      const f = await fixture(t);
      const entered = deferred(),
        ack = deferred();
      const a = f.owner(101, {
        lifetimeWitness: {
          register(context) {
            if (context.role === "app") return { state: "ready" };
            entered.resolve(context);
            return ack.promise;
          },
        },
      });
      await a.acquire({ initialize: true });
      const n = a.getNonce();
      await a.markSpawnIntent(n);
      f.states.set(201, "alive");
      const publication = a.recordChild(n, identity(201));
      const context = await entered.promise;
      assert.equal(context.ownerNonce, n);
      assert.equal((await read(f)).child, null);
      if (drift === "kernel") f.held.clear();
      if (drift === "record")
        await rewrite(f, { cleanShutdown: false, nonce: "changed" });
      if (drift === "root") {
        const moved = `${f.root}-moved`;
        await fs.rename(f.root, moved);
        await fs.mkdir(f.root, { mode: 0o700 });
        t.after(() => fs.rm(moved, { recursive: true, force: true }));
      }
      ack.resolve(
        drift === "failure" ? blocked("owner_unverified") : { state: "ready" },
      );
      const result = await publication;
      assert.equal(
        result.state,
        drift === "none" ? "ready" : "recovery_required",
      );
      if (drift !== "root")
        assert.equal(
          (await read(f)).child?.pid ?? null,
          drift === "none" ? 201 : null,
        );
    });
});

test("supplemental witness uses SAME complete owner registrations only for unverified", async (t) => {
  for (const priorState of [
    "alive",
    "identity_conflict",
    "unverified",
    "exited",
  ])
    await t.test(priorState, async (t) => {
      const f = await fixture(t);
      await started(f);
      const old = await read(f);
      f.held.clear();
      f.states.set(101, priorState);
      f.states.set(201, "unverified");
      const inputs = [];
      const a = f.owner(102, {
        lifetimeWitness: {
          register: () => ({ state: "ready" }),
          verify(context) {
            inputs.push(context);
            return "exited";
          },
        },
      });
      const result = await a.acquire();
      assert.equal(
        result.state,
        ["exited", "unverified"].includes(priorState)
          ? "ready"
          : "recovery_required",
      );
      assert.equal(
        inputs.length,
        priorState === "unverified" ? 2 : priorState === "exited" ? 1 : 0,
      );
      for (const input of inputs) {
        assert.deepEqual(input.expectedRegistrations, {
          app: old.app,
          child: old.child,
        });
        assert.equal(input.ownerNonce, old.nonce);
      }
    });
});

test("witness cannot repair spawn gap or prove actual child teardown", async (t) => {
  const f = await fixture(t);
  let verifications = 0,
    seals = 0;
  const lifetimeWitness = {
    register: () => ({ state: "ready" }),
    verify() {
      verifications++;
      return "exited";
    },
    closeRegistration() {
      seals++;
      return { state: "ready" };
    },
  };
  const a = f.owner(101, { lifetimeWitness });
  await a.acquire({ initialize: true });
  const n = a.getNonce();
  await a.markSpawnIntent(n);
  f.states.set(101, "unverified");
  f.held.clear();
  assert.deepEqual(
    await f.owner(102, { lifetimeWitness }).acquire(),
    blocked("owner_unverified"),
  );
  assert.equal(verifications, 0);
  const g = await fixture(t);
  const b = g.owner(103, { lifetimeWitness });
  await b.acquire({ initialize: true });
  const m = b.getNonce();
  await b.markSpawnIntent(m);
  g.states.set(203, "alive");
  await b.recordChild(m, identity(203));
  assert.deepEqual(await b.release(m), blocked("owner_unverified"));
  assert.equal(g.calls.includes("release"), false);
  g.states.set(203, "exited");
  assert.deepEqual(await b.release(m), { released: true });
  assert.equal(seals, 1);
  assert.equal(verifications, 0);
});

test("app registration await rechecks kernel, root, old checksum and unexpected first owner", async (t) => {
  for (const drift of ["kernel", "root", "old-checksum", "first-record"])
    await t.test(drift, async (t) => {
      const f = await fixture(t);
      let old;
      if (drift === "old-checksum") {
        await f.owner(100).acquire({ initialize: true });
        old = await read(f);
        f.states.set(100, "exited");
        f.held.clear();
      }
      const entered = deferred(),
        ack = deferred();
      const a = f.owner(101, {
        lifetimeWitness: {
          register(context) {
            entered.resolve(context);
            return ack.promise;
          },
        },
      });
      const acquisition = a.acquire({ initialize: !old });
      await entered.promise;
      if (drift === "kernel") f.held.clear();
      if (drift === "old-checksum") await rewrite(f, { cleanShutdown: true });
      if (drift === "first-record")
        await fs.writeFile(recordPath(f), "KEEP FOREIGN RECORD", {
          mode: 0o600,
        });
      if (drift === "root") {
        const moved = `${f.root}-moved`;
        await fs.rename(f.root, moved);
        await fs.mkdir(f.root, { mode: 0o700 });
        t.after(() => fs.rm(moved, { recursive: true, force: true }));
      }
      let before;
      try {
        before = await fs.readFile(recordPath(f));
      } catch {
        /* Expected empty root. */
      }
      ack.resolve({ state: "ready" });
      assert.equal((await acquisition).state, "recovery_required");
      assert.equal(a.getNonce(), null);
      if (before) assert.deepEqual(await fs.readFile(recordPath(f)), before);
      else await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
    });
});

test("live/conflicting recorded child dominates supplemental complete-set witness", async (t) => {
  for (const childState of ["alive", "identity_conflict"])
    await t.test(childState, async (t) => {
      const f = await fixture(t);
      await started(f);
      const before = await fs.readFile(recordPath(f));
      f.held.clear();
      f.states.set(101, "exited");
      f.states.set(201, childState);
      let calls = 0;
      const b = f.owner(102, {
        lifetimeWitness: {
          verify() {
            calls++;
            return "exited";
          },
          register: () => ({ state: "ready" }),
        },
      });
      assert.deepEqual(
        await b.acquire(),
        blocked(
          childState === "alive" ? "owner_unverified" : "identity_conflict",
        ),
      );
      assert.equal(calls, 0);
      assert.deepEqual(await fs.readFile(recordPath(f)), before);
    });
});

test("registration seal precedes kernel release; failed seal or drift cannot release", async (t) => {
  for (const kind of ["success", "failure", "throw", "drift"])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const a = f.owner(101, {
        lifetimeWitness: {
          register: () => ({ state: "ready" }),
          closeRegistration(nonce) {
            f.calls.push("seal");
            assert.equal(nonce, a.getNonce());
            assert.equal(f.held.size, 1);
            if (kind === "failure") return blocked("owner_unverified");
            if (kind === "throw") throw new Error("synthetic seal failure");
            if (kind === "drift") f.held.clear();
            return { state: "ready" };
          },
        },
      });
      await a.acquire({ initialize: true });
      const n = a.getNonce();
      const before = await fs.readFile(recordPath(f));
      const result = await a.release(n);
      assert.deepEqual(
        result,
        kind === "success" ? { released: true } : blocked("owner_unverified"),
      );
      if (kind === "success")
        assert.deepEqual(f.calls.slice(-2), ["seal", "release"]);
      else {
        assert.equal(f.calls.includes("release"), false);
        assert.deepEqual(await fs.readFile(recordPath(f)), before);
      }
    });
});

test("kernel loss during post-ACK app identity recheck cannot publish owner", async (t) => {
  const f = await fixture(t);
  let acknowledged = false;
  const a = f.owner(101, {
    lifetimeWitness: {
      register() {
        acknowledged = true;
        return { state: "ready" };
      },
    },
    processVerifier: {
      currentIdentity: () => identity(101),
      verify() {
        if (acknowledged) f.held.clear();
        return "alive";
      },
    },
  });
  assert.deepEqual(
    await a.acquire({ initialize: true }),
    blocked("owner_unverified"),
  );
  await assert.rejects(fs.access(recordPath(f)), { code: "ENOENT" });
  assert.equal(a.getNonce(), null);
});
