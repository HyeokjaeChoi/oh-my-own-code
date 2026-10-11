// Node-only ownership evidence: actual pinned Effect and copied production
// observer/lease/resource/root logic. Only the physical kernel import changes.
// Synthetic origins are bookkeeping, not execution or permission grants.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPermissionTestSources } from "../scripts/native-permission-test-fixture.mjs";

const namespace = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-task-read-")),
);
after(() => rm(namespace, { recursive: true, force: true }));
await symlink(
  fileURLToPath(
    new URL(
      "../runtime-event-host/.generated/install/node_modules",
      import.meta.url,
    ),
  ),
  join(namespace, "node_modules"),
  "dir",
);
const sources = await copyPermissionTestSources(namespace, [
  "native-permission-leases.mjs",
  "host/native-descriptor-read-resource.mjs",
  "host/workspace-root-authority.mjs",
]);
const resourcePath = join(
  namespace,
  "host/native-descriptor-read-resource.mjs",
);
const original = await readFile(resourcePath, "utf8");
const physicalImport = 'from "./native-descriptor-read.mjs"';
const scriptedImport = 'from "./task-read-scripted-kernel.mjs"';
assert.equal(original.split(physicalImport).length, 2);
const copied = original.replace(physicalImport, scriptedImport);
assert.equal(copied.replace(scriptedImport, physicalImport), original);
await writeFile(resourcePath, copied);
await writeFile(
  join(namespace, "host/task-read-scripted-kernel.mjs"),
  `
import { assertWorkspaceRootGuard } from "./workspace-root-authority.mjs";
export const states = new Map();
export async function createNativeDescriptorReadKernel(workspace, options) {
  const s = states.get(workspace.id);
  s.events.push("factory");
  if (s.gate) await s.gate;
  options.check();
  assertWorkspaceRootGuard(options.checkRoot, s.identity);
  if (s.failFactory) throw Error("scripted prestart failure");
  let closed = false;
  const check = () => { if (closed) throw Error("scripted closed"); options.check(); assertWorkspaceRootGuard(options.checkRoot, s.identity); };
  return Object.freeze({
    read() {
      check(); s.events.push("read"); s.onRead?.(); check();
      return { bytes: Buffer.from("synthetic"), info: { size: 9 }, identity: s.fileIdentity };
    },
    list() { check(); s.events.push("list"); return []; },
    close() {
      s.events.push("close"); closed = true;
      if (s.failClose || (s.failLateClose && s.events.filter(e => e === "close").length > 1)) throw Error("scripted close failure");
    },
  });
}
`,
);
const load = (path) => import(pathToFileURL(join(namespace, path)).href);
const { createNativeTaskObserver } = await load(
  "native-permission-task-observer.mjs",
);
const { createNativeLeaseRegistry } = await load(
  "native-permission-leases.mjs",
);
const resource = await load("host/native-descriptor-read-resource.mjs");
const { createWorkspaceRootAuthority, invalidateWorkspaceRootGuard } =
  await load("host/workspace-root-authority.mjs");
const { states } = await load("host/task-read-scripted-kernel.mjs");
const { Effect, Fiber, Deferred, Exit, Scheduler } = await load(
  "node_modules/effect/dist/index.js",
);
assert.equal(
  JSON.parse(
    await readFile(join(namespace, "node_modules/effect/package.json"), "utf8"),
  ).version,
  "4.0.0-rc.112",
);
assert.ok(
  sources.some((s) => s.path === "native-permission-task-observer.mjs"),
);
const run = (effect) =>
  Effect.runPromise(effect.pipe(Effect.timeout("5 seconds")));
const gate = () => Effect.runSync(Deferred.make());
const release = (value) => Effect.runSync(Deferred.succeed(value, undefined));
const drain = () => new Promise((resolve) => setImmediate(resolve));

let nextId = 0;

async function fixture(t) {
  const id = `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;
  const path = join(namespace, `task_read_${nextId}`);
  await mkdir(path);
  const workspace = { id, path };
  const root = await createWorkspaceRootAuthority(workspace);
  const metadata = await stat(path, { bigint: true });
  const state = {
    events: [],
    fileIdentity: Object.freeze({}),
    identity: {
      workspaceId: id,
      workspacePath: path,
      dev: String(metadata.dev),
      ino: String(metadata.ino),
    },
  };
  states.set(id, state);
  const observer = createNativeTaskObserver({ runtimeEpoch: "epoch_1" });
  const registry = createNativeLeaseRegistry({ runtimeEpoch: "epoch_1" });
  const readers = [];
  const f = { workspace, root, state, observer, registry, readers };
  f.options = {
    checkRoot: root.assertOpened,
    check() {
      state.events.push("user-check");
    },
  };
  t.after(async () => {
    for (const owner of readers) await owner.close();
    observer.close();
    registry.close();
    await root.close();
    states.delete(id);
  });
  return f;
}

function admitted(f) {
  // This synthetic binding supplies lineage bookkeeping only.
  const origin = f.registry.origins.admit({
    origin: {
      runtimeEpoch: "epoch_1",
      operationId: "cause",
      type: "message.send",
      digest: "a".repeat(64),
    },
    taskScopeId: "11111111-1111-4111-8111-111111111111",
    originKind: "prompt",
    workspaceId: f.workspace.id,
    appSessionId: "app_session",
    nativeSessionId: "ses_native",
    projectId: "project",
    locationId: f.workspace.id,
    locationIncarnation: "location",
    modeGeneration: 1,
    inventoryGeneration: 1,
    inputDigest: "b".repeat(64),
  });
  const scope = f.registry.origins.createScope({ cause: origin, inboxes: [] });
  const handle = f.registry.admit({
    scope,
    projectId: "project",
    locationId: f.workspace.id,
    locationIncarnation: "location",
    sessionId: "session",
    kind: "filesystem",
    modeGeneration: 1,
    inventoryGeneration: 1,
    parentLeaseId: null,
  });
  return { origin, scope, handle };
}

async function task(t, f, kind, action, { start = true, budget } = {}) {
  const api = kind === "observer" ? f.observer : f.registry;
  const h = kind === "observer" ? { handle: Object.freeze({}) } : admitted(f);
  const captured = gate(),
    begin = gate(),
    finish = gate();
  const outcome = Promise.withResolvers();
  const scheduler = new Scheduler.MixedScheduler();
  const shouldYield = scheduler.shouldYield.bind(scheduler);
  let budgetYields = 0;
  scheduler.shouldYield = (fiber) => {
    const value = shouldYield(fiber);
    if (value) budgetYields++;
    return value;
  };
  let body = Effect.gen(function* () {
    const actual = yield* api.capture(h.handle);
    yield* Deferred.succeed(captured, actual);
    yield* Deferred.await(begin);
    if (budget) for (let i = 0; i < 64; i++) yield* Effect.sync(() => {});
    const exit = yield* Effect.exit(Effect.suspend(() => action(h.handle)));
    outcome.resolve(exit);
    yield* Deferred.await(finish);
  });
  if (budget)
    body = body.pipe(
      Effect.provideService(Scheduler.MaxOpsBeforeYield, budget),
      Effect.provideService(Scheduler.Scheduler, scheduler),
    );
  const fiber = Effect.runFork(body);
  assert.equal(await run(Deferred.await(captured)), fiber);
  if (kind === "registry" && start) api.start(h.handle, fiber);
  t.after(async () => {
    release(begin);
    release(finish);
    await run(Fiber.interrupt(fiber));
  });
  return {
    ...h,
    fiber,
    begin,
    finish,
    outcome: outcome.promise,
    budgetYields: () => budgetYields,
  };
}
const open = (f, kind, handle, options = f.options) =>
  (kind === "observer"
    ? f.observer.acquireDescriptorRead(handle, f.workspace, options)
    : f.registry.openDescriptorRead(handle, f.workspace, options)
  ).pipe(
    Effect.tap((owner) =>
      Effect.sync(() => {
        owner.ready.catch(() => {});
        f.readers.push(owner);
      }),
    ),
  );
async function result(task) {
  release(task.begin);
  const exit = await task.outcome;
  assert.ok(Exit.isSuccess(exit), String(exit));
  return exit.value;
}
const refused = async (effect) =>
  assert.ok(
    Exit.isFailure(await Effect.runPromiseExit(Effect.suspend(() => effect))),
  );
const noFactory = (f) =>
  assert.equal(f.state.events.filter((e) => e === "factory").length, 0);

test("current API exists and returns an Effect without caller inputs", async (t) => {
  const f = await fixture(t);
  assert.equal(typeof f.registry.current, "function");
  assert.equal(f.registry.current.length, 0);
  assert.ok(Effect.isEffect(f.registry.current()));
  await refused(f.registry.current());
  noFactory(f);
});

test("current returns the exact opaque original handle across budget16 yields without granting execution", async (t) => {
  const f = await fixture(t);
  const lookup = f.registry.current();
  const current = await task(
    t,
    f,
    "registry",
    (handle) =>
      Effect.gen(function* () {
        const found = yield* lookup;
        assert.equal(found, handle);
        assert.ok(Object.isFrozen(found));
        assert.deepEqual(Object.keys(found), ["toJSON"]);
        assert.throws(
          () => JSON.stringify(found),
          /native_permission_lease_handle/,
        );
        for (let i = 0; i < 64; i++) yield* Effect.sync(() => {});
        assert.equal(yield* f.registry.current(), handle);
        noFactory(f);
        assert.equal(f.state.events.length, 0);
        // Model Main's required ordering: gate before allocating the fixed
        // resource. This canary does not claim actual compiler integration.
        const denied = yield* Effect.exit(
          Effect.gen(function* () {
            yield* Effect.fail(new Error("execution/compiler gate held"));
            return yield* open(f, "registry", found);
          }),
        );
        assert.ok(Exit.isFailure(denied));
        noFactory(f);
        return yield* open(f, "registry", found);
      }),
    { budget: 16 },
  );
  const owner = await result(current);
  assert.ok(current.budgetYields() > 0);
  assert.deepEqual((await owner.ready).list(""), []);
  release(current.finish);
  await run(Fiber.await(current.fiber));
  let complete = false;
  const proof = run(f.registry.observe(current.handle)).then((value) => {
    complete = true;
    return value;
  });
  await drain();
  assert.equal(complete, false);
  assert.deepEqual(await owner.close(), { complete: true });
  assert.equal(f.registry.settle(current.handle, await proof), true);
  await refused(lookup);
});

test("current refuses outside and inherited sibling Fibers and preserves duplicate ownership checks", async (t) => {
  const f = await fixture(t);
  const lookup = f.registry.current();
  const current = await task(t, f, "registry", (handle) =>
    Effect.gen(function* () {
      assert.equal(yield* lookup, handle);
      const sibling = yield* Effect.forkChild(Effect.exit(lookup));
      assert.ok(Exit.isFailure(yield* Fiber.join(sibling)));
      assert.equal(yield* lookup, handle);
    }),
  );
  await refused(lookup);
  assert.throws(() => f.registry.start(current.handle, current.fiber));
  const duplicate = f.registry.admit({
    scope: current.scope,
    projectId: "project",
    locationId: f.workspace.id,
    locationIncarnation: "location",
    sessionId: "session",
    kind: "filesystem",
    modeGeneration: 1,
    inventoryGeneration: 1,
    parentLeaseId: null,
  });
  assert.throws(() => f.registry.start(duplicate, current.fiber), /lease_task/);
  const reservation = f.registry.reserveOrigin(current.origin, "rpc");
  assert.throws(
    () => f.registry.startReservation(reservation, current.fiber),
    /lease_reservation/,
  );
  await result(current);
  release(current.finish);
  await run(Fiber.await(current.fiber));
  await refused(lookup);
  noFactory(f);
  assert.equal(f.state.events.length, 0);
});

test("current refuses captured but not started Fiber", async (t) => {
  const f = await fixture(t);
  const current = await task(t, f, "registry", () => f.registry.current(), {
    start: false,
  });
  release(current.begin);
  assert.ok(Exit.isFailure(await current.outcome));
  noFactory(f);
});

test("current never returns an original RPC reservation as a lease", async (t) => {
  const f = await fixture(t);
  const { origin } = admitted(f);
  const reservation = f.registry.reserveOrigin(origin, "rpc");
  const captured = gate(),
    begin = gate();
  const fiber = Effect.runFork(
    Effect.gen(function* () {
      const actual = yield* f.registry.captureReservation(reservation);
      yield* Deferred.succeed(captured, actual);
      yield* Deferred.await(begin);
      return yield* Effect.exit(f.registry.current());
    }),
  );
  t.after(() => run(Fiber.interrupt(fiber)));
  assert.equal(await run(Deferred.await(captured)), fiber);
  f.registry.startReservation(reservation, fiber);
  release(begin);
  assert.ok(Exit.isFailure(await run(Fiber.join(fiber))));
  const proof = await run(f.registry.observeReservation(reservation));
  assert.equal(f.registry.settleReservation(reservation, proof), true);
  noFactory(f);
});

test("current rechecks cancellation, revoked scope and registry close on the same running Fiber", async (t) => {
  for (const mode of ["cancel", "revoke", "close"]) {
    const f = await fixture(t);
    let origin;
    const current = await task(t, f, "registry", (handle) =>
      Effect.gen(function* () {
        const lookup = f.registry.current();
        assert.equal(yield* lookup, handle);
        if (mode === "cancel") f.registry.cancel(handle);
        if (mode === "revoke") f.registry.origins.revoke(origin);
        if (mode === "close") f.registry.close();
        assert.ok(Exit.isFailure(yield* Effect.exit(lookup)));
        assert.ok(
          Exit.isFailure(yield* Effect.exit(open(f, "registry", handle))),
        );
      }),
    );
    origin = current.origin;
    await result(current);
    noFactory(f);
    assert.equal(f.state.events.length, 0);
  }
});

test("current refuses a usable but superseded scope until the original lease advances", async (t) => {
  const f = await fixture(t);
  let scope;
  const current = await task(t, f, "registry", (handle) =>
    Effect.gen(function* () {
      assert.equal(yield* f.registry.current(), handle);
      const binding = f.registry.origins.lookup('["epoch_1","cause"]').binding;
      const promoted = f.registry.origins.admit({
        ...binding,
        origin: { ...binding.origin, operationId: "promoted" },
        taskScopeId: "22222222-2222-4222-8222-222222222222",
      });
      const inbox = f.registry.origins.bindInbox(promoted, {
        nativeSessionId: "ses_native",
        inboxId: "msg_promoted_input",
      });
      const next = f.registry.origins.promote(scope, [inbox]);
      f.registry.origins.assertUsable(scope);
      assert.ok(Exit.isFailure(yield* Effect.exit(f.registry.current())));
      noFactory(f);
      f.registry.advanceScope(handle, next);
      assert.equal(yield* f.registry.current(), handle);
    }),
  );
  scope = current.scope;
  await result(current);
  noFactory(f);
});

test("same captured Fiber claims original resource before first open under operation-budget yield", async (t) => {
  for (const kind of ["observer", "registry"]) {
    const f = await fixture(t);
    const current = await task(t, f, kind, (h) => open(f, kind, h), {
      budget: 16,
    });
    const owner = await result(current);
    assert.ok(
      current.budgetYields() > 0,
      "actual scheduler exhausted operation budget",
    );
    assert.deepEqual(Object.keys(owner).sort(), [
      "cancel",
      "close",
      "ready",
      "resource",
    ]);
    assert.equal(resource.isNativeDescriptorReadResource(owner.resource), true);
    assert.throws(
      () => resource.observeNativeDescriptorRead(owner.resource),
      "already claimed before IO",
    );
    const access = await owner.ready;
    assert.deepEqual(access.list(""), []);
    assert.equal(f.state.events.filter((e) => e === "factory").length, 1);
    const observed =
      kind === "observer"
        ? f.observer.observe(current.handle, current.fiber)
        : f.registry.observe(current.handle);
    release(current.finish);
    await run(Fiber.await(current.fiber));
    let done = false;
    const proof = run(observed).then((value) => {
      done = true;
      return value;
    });
    await drain();
    assert.equal(done, false, "Fiber exit alone cannot settle original IO");
    assert.deepEqual(await owner.close(), { complete: true });
    const value = await proof;
    if (kind === "observer")
      assert.equal(f.observer.proofFor(value, current.handle).ioCount, 1);
    else assert.equal(f.registry.settle(current.handle, value), true);
  }
});

test("uncaptured outside, sibling, forged and ended Fibers refuse before kernel factory", async (t) => {
  for (const kind of ["observer", "registry"]) {
    const f = await fixture(t);
    const unknown =
      kind === "observer" ? Object.freeze({}) : admitted(f).handle;
    await refused(open(f, kind, unknown));
    // Use a separate registry because each synthetic cause key is unique per registry.
    const g = await fixture(t);
    const current = await task(t, g, kind, (h) =>
      Effect.gen(function* () {
        const sibling = yield* Effect.forkChild(Effect.exit(open(g, kind, h)));
        const exit = yield* Fiber.join(sibling);
        assert.ok(Exit.isFailure(exit));
      }),
    );
    await refused(open(g, kind, current.handle));
    await refused(open(g, kind, Object.freeze({})));
    await result(current);
    release(current.finish);
    await run(Fiber.await(current.fiber));
    await refused(open(g, kind, current.handle));
    noFactory(f);
    noFactory(g);
    assert.equal(g.state.events.length, 0, "authority callbacks must not run");
  }
});

test("captured admitted lease cannot open before real start", async (t) => {
  const f = await fixture(t);
  const current = await task(t, f, "registry", (h) => open(f, "registry", h), {
    start: false,
  });
  release(current.begin);
  assert.ok(Exit.isFailure(await current.outcome));
  noFactory(f);
  assert.equal(f.state.events.length, 0);
});

test("cancellation during pending factory denies ready and retains original IO until factory exit", async (t) => {
  const f = await fixture(t);
  const waiting = Promise.withResolvers();
  f.state.gate = waiting.promise;
  t.after(() => waiting.resolve());
  const current = await task(t, f, "registry", (h) => open(f, "registry", h));
  const owner = await result(current);
  f.registry.cancel(current.handle);
  const observed = f.registry.observe(current.handle);
  release(current.finish);
  await run(Fiber.await(current.fiber));
  let done = false;
  const proof = run(observed).then((value) => {
    done = true;
    return value;
  });
  const closing = owner.close();
  await drain();
  assert.equal(done, false);
  waiting.resolve();
  await assert.rejects(owner.ready);
  assert.deepEqual(
    await closing,
    { complete: false },
    "failed constructor cleanup is unverified",
  );
  assert.equal(f.registry.settle(current.handle, await proof), false);
  assert.equal(f.registry.inspect(current.handle).state, "unverified");
  assert.equal(f.state.events.includes("user-check"), false);
});

test("cancelled, revoked, closed and ended leases deny cached reads before caller check", async (t) => {
  for (const mode of ["cancel", "revoke", "close", "ended"]) {
    const f = await fixture(t);
    const current = await task(t, f, "registry", (h) => open(f, "registry", h));
    const owner = await result(current),
      access = await owner.ready;
    const checks = f.state.events.filter((e) => e === "user-check").length;
    if (mode === "cancel") f.registry.cancel(current.handle);
    if (mode === "revoke") f.registry.origins.revoke(current.origin);
    if (mode === "close") f.registry.close();
    if (mode === "ended") {
      release(current.finish);
      await run(Fiber.await(current.fiber));
    }
    assert.throws(() => access.read("note", { length: 1 }));
    assert.throws(() => access.list(""));
    await refused(open(f, "registry", current.handle));
    assert.equal(
      f.state.events.filter((e) => e === "user-check").length,
      checks,
    );
    assert.equal(f.state.events.includes("read"), false);
    assert.equal(f.state.events.filter((e) => e === "factory").length, 1);
  }
});

test("lease authority is rechecked after caller cancels or revokes inside check", async (t) => {
  for (const mode of ["cancel", "revoke"]) {
    const f = await fixture(t);
    let invalidate = false,
      handle,
      origin;
    const options = {
      checkRoot: f.root.assertOpened,
      check() {
        f.state.events.push("user-check");
        if (invalidate) {
          if (mode === "cancel") f.registry.cancel(handle);
          else f.registry.origins.revoke(origin);
        }
      },
    };
    const current = await task(t, f, "registry", (h) =>
      open(f, "registry", h, options),
    );
    handle = current.handle;
    origin = current.origin;
    const owner = await result(current),
      access = await owner.ready;
    invalidate = true;
    assert.throws(() => access.read("note", { length: 1 }));
    assert.equal(f.state.events.includes("read"), false);
  }
});

test("reentrant authority loss consumes a rejected Promise before failing closed", async (t) => {
  for (const mode of ["cancel", "revoke", "close"]) {
    const f = await fixture(t);
    let invalidate = false,
      handle,
      origin;
    const current = await task(t, f, "registry", (h) =>
      open(f, "registry", h, {
        checkRoot: f.root.assertOpened,
        check() {
          if (!invalidate) return;
          if (mode === "cancel") f.registry.cancel(handle);
          else if (mode === "revoke") f.registry.origins.revoke(origin);
          else f.registry.close();
          return Promise.reject(new Error("synthetic rejected authority"));
        },
      }),
    );
    handle = current.handle;
    origin = current.origin;
    const owner = await result(current),
      access = await owner.ready;
    invalidate = true;
    assert.throws(() => access.list(""));
    await drain(); // Node reports any unhandled rejection as a test failure.
    assert.equal(f.state.events.includes("list"), false);
  }
});

test("failed prestart and reentrant late-close failure cannot publish complete proof", async (t) => {
  for (const mode of ["prestart", "lateclose"]) {
    const f = await fixture(t);
    f.state.failFactory = mode === "prestart";
    f.state.failLateClose = mode === "lateclose";
    const current = await task(t, f, "registry", (h) => open(f, "registry", h));
    const owner = await result(current);
    if (mode === "prestart") await assert.rejects(owner.ready);
    else {
      const access = await owner.ready;
      f.state.onRead = () => owner.cancel();
      assert.throws(() => access.read("note", { length: 1 }));
      assert.equal(f.state.events.filter((e) => e === "close").length, 2);
    }
    assert.deepEqual(await owner.close(), { complete: false });
    release(current.finish);
    await run(Fiber.await(current.fiber));
    const proof = await run(f.registry.observe(current.handle));
    assert.equal(f.registry.settle(current.handle, proof), false);
  }
});

test("extra factory, callback status, Promise and forged guard cannot replace real resource", async (t) => {
  for (const kind of ["observer", "registry"]) {
    const f = await fixture(t);
    let callbacks = 0;
    const factory = () => {
      callbacks++;
      return { complete: true };
    };
    const current = await task(t, f, kind, (h) =>
      Effect.gen(function* () {
        for (const options of [
          { ...f.options, factory },
          { ...f.options, resource: { complete: true } },
          { ...f.options, checkRoot: factory },
          { ...f.options, check: Promise.resolve(true) },
        ]) {
          const exit = yield* Effect.exit(open(f, kind, h, options));
          assert.ok(Exit.isFailure(exit));
        }
      }),
    );
    await result(current);
    noFactory(f);
    assert.equal(callbacks, 0);
  }
});

test("registry detaches original workspace/options before deferred execution", async (t) => {
  const f = await fixture(t);
  let effect;
  const current = await task(t, f, "registry", () => effect);
  const workspace = { ...f.workspace },
    options = { ...f.options };
  effect = f.registry
    .openDescriptorRead(current.handle, workspace, options)
    .pipe(
      Effect.tap((owner) =>
        Effect.sync(() => {
          owner.ready.catch(() => {});
          f.readers.push(owner);
        }),
      ),
    );
  workspace.id = "substituted";
  workspace.path = namespace;
  options.checkRoot = () => {
    throw Error("substituted guard");
  };
  options.check = () => {
    throw Error("substituted authority");
  };
  const owner = await result(current);
  assert.deepEqual((await owner.ready).list(""), []);
  assert.equal(f.state.events.filter((e) => e === "factory").length, 1);
});

test("real root revocation still denies operation through the original captured check", async (t) => {
  const f = await fixture(t);
  const current = await task(t, f, "registry", (h) => open(f, "registry", h));
  const owner = await result(current),
    access = await owner.ready;
  invalidateWorkspaceRootGuard(f.root.assertOpened);
  assert.throws(() => access.read("note", { length: 1 }));
  assert.equal(f.state.events.includes("read"), false);
});

test("another location's checked root refuses before factory despite matching callbacks", async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  const current = await task(t, f, "registry", (h) =>
    f.registry.openDescriptorRead(h, other.workspace, other.options).pipe(
      Effect.tap((owner) =>
        Effect.sync(() => {
          owner.ready.catch(() => {});
          f.readers.push(owner);
        }),
      ),
    ),
  );
  release(current.begin);
  const exit = await current.outcome;
  assert.ok(Exit.isFailure(exit), "different real location ID must be refused");
  noFactory(f);
  noFactory(other);
  assert.equal(
    other.state.events.length,
    0,
    "valid foreign guard does not grant lease authority",
  );
});
