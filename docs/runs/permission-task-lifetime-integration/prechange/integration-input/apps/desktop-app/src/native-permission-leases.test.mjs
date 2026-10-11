import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";

const namespace = await mkdtemp(join(tmpdir(), "omoc-permission-leases-test-"));
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
for (const name of [
  "native-permission-leases.mjs",
  "native-permission-origin-scopes.mjs",
  "permission-control-canonical.mjs",
  "native-permission-control-input.mjs",
  "native-permission-task-observer.mjs",
]) {
  await copyFile(new URL(`./${name}`, import.meta.url), join(namespace, name));
}
const { createNativeLeaseRegistry } = await import(
  pathToFileURL(join(namespace, "native-permission-leases.mjs")).href
);
const { Effect, Deferred, Fiber, Exit } = await import(
  pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
);
after(() => rm(namespace, { recursive: true, force: true }));
const registry = () => createNativeLeaseRegistry({ runtimeEpoch: "epoch_1" });
// Synthetic bindings exercise bookkeeping; they are not Main journal proof.
const binding = (operationId, changes = {}) => ({
  origin: {
    runtimeEpoch: "epoch_1",
    operationId,
    type: "message.send",
    digest: "a".repeat(64),
  },
  taskScopeId: `${createHash("sha256").update(operationId).digest("hex").slice(0, 8)}-1111-4111-8111-111111111111`,
  originKind: "prompt",
  workspaceId: "workspace",
  appSessionId: "app_session",
  nativeSessionId: "ses_native",
  projectId: "project",
  locationId: "11111111-1111-4111-8111-111111111111",
  locationIncarnation: "location",
  modeGeneration: 1,
  inventoryGeneration: 1,
  inputDigest: "b".repeat(64),
  ...changes,
});
const scopes = new WeakMap();
const scopeFor = (r) => {
  if (!scopes.has(r)) {
    const cause = r.origins.admit(binding("cause"));
    scopes.set(r, r.origins.createScope({ cause, inboxes: [] }));
  }
  return scopes.get(r);
};
const freshScope = (r, operationId, changes = {}) =>
  r.origins.createScope({
    cause: r.origins.admit(binding(operationId, changes)),
    inboxes: [],
  });
const promote = (r, scope, operationId) => {
  const origin = r.origins.admit(binding(operationId));
  const inbox = r.origins.bindInbox(origin, {
    nativeSessionId: "ses_native",
    inboxId: `msg_${operationId}`,
  });
  return r.origins.promote(scope, [inbox]);
};
const identity = (r, changes = {}) => ({
  scope: scopeFor(r),
  projectId: "project",
  locationId: "11111111-1111-4111-8111-111111111111",
  locationIncarnation: "location",
  sessionId: "session",
  kind: "coordinator",
  modeGeneration: 1,
  inventoryGeneration: 1,
  parentLeaseId: null,
  ...changes,
});
const run = (body) => Effect.runPromise(body.pipe(Effect.timeout("5 seconds")));
const launch = (r, handle, body) =>
  Effect.gen(function* () {
    const captured = yield* Deferred.make();
    const fiber = yield* Effect.forkChild(
      r.capture(handle).pipe(
        Effect.tap(() => Deferred.succeed(captured, undefined)),
        Effect.andThen(body),
      ),
    );
    yield* Deferred.await(captured);
    return fiber;
  });
const task = (r, handle) =>
  Effect.gen(function* () {
    const done = yield* Deferred.make();
    const fiber = yield* launch(r, handle, Deferred.await(done));
    return { done, fiber };
  });

test("lease identity is internally minted, frozen, bounded and rejects accessors", () => {
  const r = registry();
  try {
    const h = r.admit(identity(r));
    const row = r.inspect(h);
    assert.equal(row.state, "admitted");
    assert.equal(row.runtimeEpoch, "epoch_1");
    assert.ok(Object.isFrozen(row));
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        "runtimeEpoch",
        "leaseId",
        "executionScopeId",
        "scopeVersion",
        ...Object.keys(identity(r)).filter((key) => key !== "scope"),
        "state",
      ].sort(),
    );
    assert.throws(() => JSON.stringify(h));
    assert.throws(() => r.inspect({}));
    assert.throws(() => r.inspect(new Proxy(h, {})));
    assert.throws(() => registry().inspect(h));
    for (const changes of [
      { state: "settled" },
      { modeGeneration: 0 },
      { inventoryGeneration: -0 },
      { kind: "tool" },
      { parentLeaseId: "missing" },
    ])
      assert.throws(() => r.admit(identity(r, changes)));
    let calls = 0;
    const accessor = identity(r);
    Object.defineProperty(accessor, "projectId", {
      enumerable: true,
      get() {
        calls++;
        return "project";
      },
    });
    assert.throws(() => r.admit(accessor));
    assert.equal(calls, 0);
  } finally {
    r.close();
  }
});

test("actual Fiber proof settles once; forged or foreign proofs cannot settle", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        assert.equal(r.inspect(h).state, "running");
        assert.throws(() => r.settle(h, {}));
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* r.observe(h);
        assert.throws(() => r.settle(h, {}));
        assert.equal(r.settle(h, proof), true);
        assert.equal(r.settle(h, proof), true);
        assert.equal(r.inspect(h).state, "settled");
        assert.throws(() => r.start(h, t.fiber));
        const other = r.admit(identity(r, { sessionId: "another" }));
        const second = yield* task(r, other);
        r.start(other, second.fiber);
        yield* Deferred.succeed(second.done, undefined);
        yield* Fiber.await(second.fiber);
        assert.throws(() => r.settle(other, proof));
      }),
    );
  } finally {
    r.close();
  }
});

test("parent foreground exit cannot settle while child lives; no late child admission", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const parent = r.admit(identity(r));
        const p = yield* task(r, parent);
        r.start(parent, p.fiber);
        const parentLeaseId = r.inspect(parent).leaseId;
        for (const mismatch of [
          { projectId: "other" },
          { scope: freshScope(r, "other") },
          { locationIncarnation: "other" },
          { modeGeneration: 2 },
          { inventoryGeneration: 2 },
        ])
          assert.throws(() =>
            r.admit(identity(r, { parentLeaseId, ...mismatch })),
          );
        const child = r.admit(
          identity(r, {
            parentLeaseId,
            kind: "background",
            sessionId: "child",
          }),
        );
        const c = yield* task(r, child);
        r.start(child, c.fiber);
        yield* Deferred.succeed(p.done, undefined);
        const proof = yield* r.observe(parent);
        assert.equal(r.settle(parent, proof), false);
        assert.equal(r.inspect(parent).state, "running");
        assert.throws(() =>
          r.admit(identity(r, { parentLeaseId, kind: "background" })),
        );
        yield* Deferred.succeed(c.done, undefined);
        const childProof = yield* r.observe(child);
        assert.equal(r.settle(child, childProof), true);
        assert.equal(r.settle(parent, proof), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("cancellation is intent only; actual IO and Fiber finalizers must finish", async () => {
  const r = registry();
  const stream = new PassThrough();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r, { kind: "filesystem" }));
        const slot = r.reserve(h, "io");
        r.bindIO(slot, stream);
        const finishing = yield* Deferred.make();
        const endFinalizer = yield* Deferred.make();
        const f = yield* launch(
          r,
          h,
          Effect.void.pipe(
            Effect.ensuring(
              Deferred.succeed(finishing, undefined).pipe(
                Effect.andThen(Deferred.await(endFinalizer)),
              ),
            ),
          ),
        );
        r.start(h, f);
        const proofEffect = r.observe(h);
        r.cancel(h);
        assert.equal(r.inspect(h).state, "cancelling");
        yield* Deferred.await(finishing);
        assert.equal(f.pollUnsafe(), undefined);
        assert.throws(() => r.settle(h, {}));
        yield* Deferred.succeed(endFinalizer, undefined);
        yield* Fiber.await(f);
        stream.destroy();
        const proof = yield* proofEffect;
        assert.equal(r.settle(h, proof), true);
      }),
    );
  } finally {
    stream.destroy();
    r.close();
  }
});

test("unbound owned-effect reservation is permanently unverified, never upgraded", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r, { kind: "shell" }));
        r.reserve(h, "process");
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* r.observe(h);
        assert.equal(r.settle(h, proof), false);
        assert.equal(r.inspect(h).state, "unverified");
        assert.throws(() => r.settle(h, proof));
        assert.throws(() => r.observe(h));
      }),
    );
  } finally {
    r.close();
  }
});

test("runtime closure revokes outstanding proofs and cannot claim task completion", async () => {
  const r = registry();
  await run(
    Effect.gen(function* () {
      const h = r.admit(identity(r));
      const t = yield* task(r, h);
      r.start(h, t.fiber);
      r.close();
      r.close();
      assert.equal(t.fiber.pollUnsafe(), undefined);
      assert.equal(r.inspect(h).state, "unverified");
      assert.throws(() => r.admit(identity(r)));
      assert.throws(() => r.settle(h, {}));
      yield* Deferred.succeed(t.done, undefined);
      yield* Fiber.await(t.fiber);
    }),
  );
});

test("late task capture and forged Fiber cannot turn an admitted lease into running work", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r));
        let calls = 0;
        assert.throws(() =>
          r.start(h, {
            pollUnsafe() {
              calls++;
            },
          }),
        );
        assert.equal(calls, 0);
        assert.equal(r.inspect(h).state, "admitted");
        const f = yield* launch(r, h, Effect.void);
        yield* Fiber.await(f);
        assert.throws(() => r.start(h, f));
        assert.equal(r.inspect(h).state, "unverified");
        assert.throws(() => r.observe(h));
      }),
    );
  } finally {
    r.close();
  }
});

test("descriptor-cloned actual Fiber cannot settle its live original lease", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r));
        const t = yield* task(r, h);
        const clone = Object.create(
          Object.getPrototypeOf(t.fiber),
          Object.getOwnPropertyDescriptors(t.fiber),
        );
        assert.throws(() => r.start(h, clone));
        clone._exit = Exit.succeed(undefined);
        assert.equal(t.fiber.pollUnsafe(), undefined);
        assert.equal(r.inspect(h).state, "admitted");
        r.start(h, t.fiber);
        const observing = yield* Effect.forkChild(r.observe(h));
        for (let i = 0; i < 8; i++) yield* Effect.yieldNow;
        assert.equal(observing.pollUnsafe(), undefined);
        assert.throws(() => r.settle(h, {}));
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* Fiber.join(observing);
        assert.equal(r.settle(h, proof), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("a caller-written exit field is not the runtime end callback", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        try {
          t.fiber._exit = Exit.succeed(undefined);
          const observing = yield* Effect.forkChild(r.observe(h));
          for (let i = 0; i < 8; i++) yield* Effect.yieldNow;
          assert.equal(observing.pollUnsafe(), undefined);
          assert.equal(r.inspect(h).state, "running");
        } finally {
          t.fiber._exit = undefined;
          yield* Deferred.succeed(t.done, undefined);
          yield* Fiber.await(t.fiber);
        }
      }),
    );
  } finally {
    r.close();
  }
});

test("failed actual task can settle, while unverified child permanently holds parent", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const parent = r.admit(identity(r));
        const p = yield* task(r, parent);
        r.start(parent, p.fiber);
        const child = r.admit(
          identity(r, {
            parentLeaseId: r.inspect(parent).leaseId,
            kind: "filesystem",
          }),
        );
        r.reserve(child, "io");
        const c = yield* task(r, child);
        r.start(child, c.fiber);
        yield* Deferred.succeed(c.done, undefined);
        assert.equal(r.settle(child, yield* r.observe(child)), false);
        yield* Deferred.succeed(p.done, undefined);
        assert.equal(r.settle(parent, yield* r.observe(parent)), false);
        assert.equal(r.inspect(parent).state, "running");
        const failing = r.admit(identity(r));
        const go = yield* Deferred.make();
        const f = yield* launch(
          r,
          failing,
          Deferred.await(go).pipe(
            Effect.andThen(Effect.fail("synthetic failure")),
          ),
        );
        r.start(failing, f);
        const other = r.admit(identity(r));
        assert.throws(() => r.start(other, f));
        yield* Deferred.succeed(go, undefined);
        assert.equal(r.settle(failing, yield* r.observe(failing)), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("lease lifetime capacity is bounded even after closure, child reservations max32", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const parent = r.admit(identity(r));
        const t = yield* task(r, parent);
        r.start(parent, t.fiber);
        const parentLeaseId = r.inspect(parent).leaseId;
        for (let i = 0; i < 32; i++)
          r.admit(identity(r, { parentLeaseId, sessionId: `child${i}` }));
        assert.throws(() => r.admit(identity(r, { parentLeaseId })));
        for (let i = 33; i < 8192; i++) r.admit(identity(r));
        assert.equal(r.snapshot("project").length, 8192);
        assert.throws(() => r.admit(identity(r)));
        assert.equal(r.snapshot("unrelated").length, 0);
        yield* Deferred.succeed(t.done, undefined);
        yield* Fiber.await(t.fiber);
      }),
    );
  } finally {
    r.close();
  }
});

test("actual owned Node child exit is awaited but cannot prove descendant settlement", async () => {
  const r = registry();
  let child;
  let closed = false;
  let closePromise;
  try {
    await run(
      Effect.gen(function* () {
        const h = r.admit(identity(r, { kind: "shell" }));
        const slot = r.reserve(h, "process");
        child = spawn(
          process.execPath,
          [
            "-e",
            'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
          ],
          { stdio: ["pipe", "ignore", "ignore"], env: {} },
        );
        closePromise = new Promise((resolve) =>
          child.once("close", (code, signal) => {
            closed = true;
            resolve({ code, signal });
          }),
        );
        r.bindProcess(slot, child);
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        yield* Fiber.await(t.fiber);
        const observing = yield* Effect.forkChild(r.observe(h));
        for (let i = 0; i < 8; i++) yield* Effect.yieldNow;
        assert.equal(observing.pollUnsafe(), undefined);
        child.stdin.end();
        const result = yield* Effect.promise(() => closePromise);
        assert.deepEqual(result, { code: 0, signal: null });
        const proof = yield* Fiber.join(observing);
        assert.equal(r.settle(h, proof), false);
        assert.equal(r.inspect(h).state, "unverified");
      }),
    );
  } finally {
    if (child && !closed) {
      child.kill("SIGKILL");
      await closePromise;
    }
    r.close();
  }
});

test("admission requires an owned current scope and exact immutable constraints", () => {
  const r = registry();
  const foreign = registry();
  try {
    const first = scopeFor(r);
    let traps = 0;
    const proxy = new Proxy(first, {
      get() {
        traps++;
        throw new Error("scope trap");
      },
      ownKeys() {
        traps++;
        throw new Error("scope trap");
      },
      getPrototypeOf() {
        traps++;
        throw new Error("scope trap");
      },
    });
    for (const scope of [
      {},
      r.origins.inspect(first),
      scopeFor(foreign),
      proxy,
    ])
      assert.throws(() => r.admit(identity(r, { scope })));
    assert.equal(traps, 0);
    for (const changes of [
      { projectId: "other" },
      { locationIncarnation: "other" },
      { modeGeneration: 2 },
      { inventoryGeneration: 2 },
      { originalOperationKey: "legacy" },
    ])
      assert.throws(() => r.admit(identity(r, changes)));
    const second = promote(r, first, "later");
    assert.throws(() => r.admit(identity(r, { scope: first })));
    assert.doesNotThrow(() => r.origins.assertUsable(first));
    const h = r.admit(identity(r, { scope: second }));
    assert.equal(r.inspect(h).scopeVersion, 2);
    assert.equal(
      r.inspect(h).executionScopeId,
      r.origins.inspect(second).executionScopeId,
    );
    assert.equal(r.snapshot("project").length, 1);
  } finally {
    r.close();
    foreign.close();
  }
});

test("root advancement retains one actual Fiber; existing child snapshot never catches up", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const first = scopeFor(r);
        const parent = r.admit(identity(r));
        assert.throws(() => r.advanceScope(parent, first));
        const p = yield* task(r, parent);
        r.start(parent, p.fiber);
        const parentLeaseId = r.inspect(parent).leaseId;
        const child = r.admit(
          identity(r, {
            parentLeaseId,
            kind: "background",
            sessionId: "child",
          }),
        );
        const c = yield* task(r, child);
        r.start(child, c.fiber);
        const retained = r.admit(
          identity(r, {
            parentLeaseId,
            kind: "background",
            sessionId: "retained",
          }),
        );
        const retainedTask = yield* task(r, retained);
        r.start(retained, retainedTask.fiber);
        const retainedRow = r.inspect(retained);
        const oldParent = r.inspect(parent);
        const oldChild = r.inspect(child);
        const second = promote(r, first, "second");
        assert.throws(() => r.advanceScope(child, second));
        assert.throws(() =>
          r.admit(identity(r, { scope: second, parentLeaseId })),
        );
        r.advanceScope(parent, second);
        assert.deepEqual(r.inspect(child), oldChild);
        assert.equal(oldParent.scopeVersion, 1);
        assert.deepEqual(r.inspect(parent), { ...oldParent, scopeVersion: 2 });
        assert.equal(r.origins.inspect(first).origins.length, 1);
        assert.equal(r.origins.inspect(second).origins.length, 2);
        const latest = r.admit(
          identity(r, {
            scope: second,
            parentLeaseId,
            kind: "background",
            sessionId: "latest",
          }),
        );
        assert.equal(r.inspect(latest).scopeVersion, 2);
        const latestTask = yield* task(r, latest);
        r.start(latest, latestTask.fiber);
        yield* Deferred.succeed(latestTask.done, undefined);
        assert.equal(r.settle(latest, yield* r.observe(latest)), true);
        assert.equal(p.fiber.pollUnsafe(), undefined);
        assert.throws(() => r.start(parent, p.fiber));
        assert.ok(Exit.isFailure(yield* Effect.exit(r.capture(parent))));
        const other = r.admit(identity(r, { scope: second }));
        assert.throws(() => r.start(other, p.fiber));
        // The original task still owns its capture; no replacement task is created.
        assert.throws(
          () => r.advanceScope(child, second),
          /native_permission_lease_lineage/u,
        );
        assert.deepEqual(r.inspect(child), oldChild);
        assert.equal(r.inspect(child).scopeVersion, 1);
        assert.equal(c.fiber.pollUnsafe(), undefined);
        assert.throws(() => r.advanceScope(parent, first));
        assert.throws(() => r.advanceScope(parent, second));
        yield* Deferred.succeed(p.done, undefined);
        const proof = yield* r.observe(parent);
        assert.equal(r.settle(parent, proof), false);
        const third = promote(r, second, "third");
        assert.throws(() => r.advanceScope(parent, third));
        yield* Deferred.succeed(c.done, undefined);
        assert.equal(r.settle(child, yield* r.observe(child)), true);
        assert.deepEqual(r.inspect(child), { ...oldChild, state: "settled" });
        assert.deepEqual(r.inspect(retained), retainedRow);
        assert.equal(r.settle(parent, proof), false);
        yield* Deferred.succeed(retainedTask.done, undefined);
        assert.equal(r.settle(retained, yield* r.observe(retained)), true);
        assert.equal(r.settle(parent, proof), true);
        assert.throws(() => r.advanceScope(parent, third));
      }),
    );
  } finally {
    r.close();
  }
});

test("advancement rejects foreign, forged, Proxy and changed-generation scopes without mutation", async () => {
  const r = registry();
  const foreign = registry();
  try {
    await run(
      Effect.gen(function* () {
        const first = scopeFor(r);
        const h = r.admit(identity(r));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        const before = r.inspect(h);
        const second = promote(r, first, "advance");
        const alternatives = [
          {},
          r.origins.inspect(second),
          new Proxy(second, {}),
          scopeFor(foreign),
          freshScope(r, "unrelated"),
          freshScope(r, "mode", { modeGeneration: 2 }),
          freshScope(r, "inventory", { inventoryGeneration: 2 }),
          freshScope(r, "location", { locationIncarnation: "other" }),
          freshScope(r, "project", { projectId: "other" }),
        ];
        for (const scope of alternatives) {
          assert.throws(() => r.advanceScope(h, scope));
          assert.deepEqual(r.inspect(h), before);
        }
        r.advanceScope(h, second);
        r.cancel(h);
        const third = promote(r, second, "cancelled");
        assert.throws(() => r.advanceScope(h, third));
        assert.equal(t.fiber.pollUnsafe(), undefined);
        yield* Deferred.succeed(t.done, undefined);
        assert.equal(r.settle(h, yield* r.observe(h)), true);
      }),
    );
  } finally {
    r.close();
    foreign.close();
  }
});

test("capture and start refuse stale admission scopes before actual task ownership", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const first = scopeFor(r);
        const uncaptured = r.admit(identity(r));
        const captured = r.admit(identity(r));
        const t = yield* task(r, captured);
        promote(r, first, "stale");
        assert.ok(Exit.isFailure(yield* Effect.exit(r.capture(uncaptured))));
        assert.throws(() => r.start(captured, t.fiber));
        assert.equal(r.inspect(captured).state, "admitted");
        assert.equal(t.fiber.pollUnsafe(), undefined);
        yield* Deferred.succeed(t.done, undefined);
        yield* Fiber.await(t.fiber);
      }),
    );
  } finally {
    r.close();
  }
});

test("revoked or closed origins prevent new work but preserve actual task and IO settlement", async () => {
  for (const closeOrigins of [false, true]) {
    const r = registry();
    const stream = new PassThrough();
    try {
      await run(
        Effect.gen(function* () {
          const origin = r.origins.admit(binding("revocable"));
          const scope = r.origins.createScope({ cause: origin, inboxes: [] });
          const h = r.admit(identity(r, { scope }));
          const waiting = r.admit(identity(r, { scope }));
          const slot = r.reserve(h, "io");
          r.bindIO(slot, stream);
          const t = yield* task(r, h);
          r.start(h, t.fiber);
          if (closeOrigins) r.origins.close();
          else r.origins.revoke(origin);
          assert.throws(() => r.admit(identity(r, { scope })));
          assert.throws(() => r.advanceScope(h, scope));
          assert.ok(Exit.isFailure(yield* Effect.exit(r.capture(waiting))));
          assert.throws(() => r.start(waiting, t.fiber));
          r.cancel(h);
          const observing = yield* Effect.forkChild(r.observe(h));
          assert.equal(t.fiber.pollUnsafe(), undefined);
          yield* Deferred.succeed(t.done, undefined);
          yield* Fiber.await(t.fiber);
          for (let i = 0; i < 8; i++) yield* Effect.yieldNow;
          assert.equal(observing.pollUnsafe(), undefined);
          assert.throws(() => r.settle(h, {}));
          stream.destroy();
          assert.equal(r.settle(h, yield* Fiber.join(observing)), true);
        }),
      );
    } finally {
      stream.destroy();
      r.close();
    }
  }
});

test("actual capture keeps one owner before start and after version advancement", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const first = scopeFor(r);
        const h = r.admit(identity(r));
        const captured = yield* Deferred.make();
        const done = yield* Deferred.make();
        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            const owner = yield* r.capture(h);
            assert.equal(yield* r.capture(h), owner);
            yield* Deferred.succeed(captured, undefined);
            yield* Deferred.await(done);
          }),
        );
        yield* Deferred.await(captured);
        assert.ok(Exit.isFailure(yield* Effect.exit(r.capture(h))));
        r.start(h, fiber);
        const second = promote(r, first, "capture_advance");
        r.advanceScope(h, second);
        assert.ok(Exit.isFailure(yield* Effect.exit(r.capture(h))));
        assert.equal(fiber.pollUnsafe(), undefined);
        yield* Deferred.succeed(done, undefined);
        assert.equal(r.settle(h, yield* r.observe(h)), true);
      }),
    );
  } finally {
    r.close();
  }
});

for (const parentState of ["cancelled", "ended"]) {
  test(`child scope advancement refuses a ${parentState} parent even at the matching current version`, async () => {
    const r = registry();
    try {
      await run(
        Effect.gen(function* () {
          const first = scopeFor(r);
          const parent = r.admit(identity(r));
          const p = yield* task(r, parent);
          r.start(parent, p.fiber);
          const child = r.admit(
            identity(r, {
              parentLeaseId: r.inspect(parent).leaseId,
              kind: "background",
              sessionId: "child",
            }),
          );
          const c = yield* task(r, child);
          r.start(child, c.fiber);
          const before = r.inspect(child);
          const second = promote(r, first, `parent_${parentState}`);
          r.advanceScope(parent, second);
          assert.equal(
            r.inspect(parent).scopeVersion,
            r.origins.inspect(second).version,
          );
          assert.doesNotThrow(() => r.origins.assertCurrent(second));
          if (parentState === "cancelled") {
            r.cancel(parent);
            assert.equal(r.inspect(parent).state, "cancelling");
            assert.equal(p.fiber.pollUnsafe(), undefined);
          } else {
            yield* Deferred.succeed(p.done, undefined);
            yield* Fiber.await(p.fiber);
            assert.equal(r.inspect(parent).state, "running");
            assert.notEqual(p.fiber.pollUnsafe(), undefined);
          }
          assert.equal(c.fiber.pollUnsafe(), undefined);
          assert.throws(
            () => r.advanceScope(child, second),
            /native_permission_lease_lineage/u,
          );
          assert.deepEqual(r.inspect(child), before);
          if (parentState === "cancelled")
            yield* Deferred.succeed(p.done, undefined);
          const parentProof = yield* r.observe(parent);
          assert.equal(r.settle(parent, parentProof), false);
          yield* Deferred.succeed(c.done, undefined);
          assert.equal(r.settle(child, yield* r.observe(child)), true);
          assert.equal(r.settle(parent, parentProof), true);
        }),
      );
    } finally {
      r.close();
    }
  });
}

test("pending queue input holds an ended lease before root settlement", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const cause = r.origins.admit(binding("pending_root"));
        const pending = r.origins.bindInbox(cause, {
          nativeSessionId: "ses_native",
          inboxId: "msg_pending_root",
        });
        const scope = r.origins.createScope({ cause, inboxes: [] });
        const h = r.admit(identity(r, { scope }));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* r.observe(h);
        assert.equal(r.settle(h, proof), false);
        assert.ok(pending);
      }),
    );
  } finally {
    r.close();
  }
});

const reservationTask = (r, handle) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make();
    const done = yield* Deferred.make();
    const fiber = yield* Effect.forkChild(
      r.captureReservation(handle).pipe(
        Effect.tap(() => Deferred.succeed(ready, undefined)),
        Effect.andThen(Deferred.await(done)),
      ),
    );
    yield* Deferred.await(ready);
    r.startReservation(handle, fiber);
    return { fiber, done };
  });

test("queue cancellation after Fiber exit uses an exact observed callback and forbids settled reentry", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const cause = r.origins.admit(binding("cancel_queue"));
        const input = r.origins.bindInbox(cause, {
          nativeSessionId: "ses_native",
          inboxId: "msg_cancel_queue",
        });
        const scope = r.origins.createScope({ cause, inboxes: [] });
        const h = r.admit(identity(r, { scope }));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* r.observe(h);
        assert.equal(r.settle(h, proof), false);
        const cancellation = r.reserveCancellation(input);
        const call = yield* reservationTask(r, cancellation);
        assert.throws(() => r.reservationCompletion(cancellation), /proof/);
        assert.throws(() => r.origins.promote(scope, [input]), /cancelling/);
        assert.throws(() => r.reserveCancellation(input), /transition/);
        assert.equal(r.origins.settleRoot(cause), false);
        yield* Deferred.succeed(call.done, undefined);
        assert.equal(
          r.settleReservation(
            cancellation,
            yield* r.observeReservation(cancellation),
          ),
          true,
        );
        const completion = r.reservationCompletion(cancellation);
        r.origins.cancelInbox(input, completion);
        assert.equal(r.origins.inspectInbox(input).state, "cancelled");
        assert.throws(
          () => r.origins.cancelInbox(input, completion),
          /transition/,
        );
        assert.throws(() => r.origins.promote(scope, [input]), /replay/);
        assert.equal(r.settle(h, proof), true);
        assert.equal(r.origins.settleRoot(cause), true);
        assert.throws(
          () =>
            r.origins.bindInbox(cause, {
              nativeSessionId: "ses_native",
              inboxId: "msg_late",
            }),
          /settled/,
        );
        assert.throws(() => r.admit(identity(r, { scope })), /settled/);
        assert.throws(() => r.reserveOrigin(cause, "rpc"), /settled/);
      }),
    );
  } finally {
    r.close();
  }
});

test("promotion wins exclusively and carrying child IO holds every original root", async () => {
  const r = registry();
  const stream = new PassThrough();
  try {
    await run(
      Effect.gen(function* () {
        const a = r.origins.admit(binding("multi_a"));
        const b = r.origins.admit(binding("multi_b"));
        const inputs = [a, b].map((origin, i) =>
          r.origins.bindInbox(origin, {
            nativeSessionId: "ses_native",
            inboxId: `msg_multi_${i}`,
          }),
        );
        const scope = r.origins.createScope({ cause: a, inboxes: inputs });
        assert.throws(() => r.reserveCancellation(inputs[0]), /transition/);
        const parent = r.admit(identity(r, { scope }));
        const pt = yield* task(r, parent);
        r.start(parent, pt.fiber);
        const child = r.admit(
          identity(r, {
            scope,
            kind: "background",
            parentLeaseId: r.inspect(parent).leaseId,
          }),
        );
        r.bindIO(r.reserve(child, "io"), stream);
        const ct = yield* task(r, child);
        r.start(child, ct.fiber);
        yield* Deferred.succeed(pt.done, undefined);
        const proof = yield* r.observe(parent);
        assert.equal(r.settle(parent, proof), false);
        for (const origin of [a, b])
          assert.equal(r.origins.settleRoot(origin), false);
        assert.throws(() => r.origins.settleInbox(inputs[1]), /outstanding/);
        yield* Deferred.succeed(ct.done, undefined);
        const observing = yield* Effect.forkChild(r.observe(child));
        yield* Effect.yieldNow;
        assert.equal(observing.pollUnsafe(), undefined);
        stream.destroy();
        assert.equal(r.settle(child, yield* Fiber.join(observing)), true);
        assert.equal(r.settle(parent, proof), true);
        for (const input of inputs) r.origins.settleInbox(input);
        for (const origin of [a, b])
          assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    stream.destroy();
    r.close();
  }
});

test("no-effect cancellation before any execution lease still waits for the actual original RPC", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("no_effect"));
        const input = r.origins.bindInbox(origin, {
          nativeSessionId: "ses_native",
          inboxId: "msg_no_effect",
        });
        const rpc = r.reserveOrigin(origin, "rpc");
        const removal = r.reserveCancellation(input);
        const rpcTask = yield* reservationTask(r, rpc);
        const removalTask = yield* reservationTask(r, removal);
        yield* Deferred.succeed(removalTask.done, undefined);
        r.settleReservation(removal, yield* r.observeReservation(removal));
        const receipt = r.reservationCompletion(removal);
        assert.throws(
          () => r.origins.cancelInbox(input, receipt),
          /outstanding/,
        );
        assert.equal(r.origins.settleRoot(origin), false);
        yield* Deferred.succeed(rpcTask.done, undefined);
        r.settleReservation(rpc, yield* r.observeReservation(rpc));
        r.origins.cancelInbox(input, receipt);
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("command expansion reserves before callback and never fabricates a prompt identity", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const value = binding("command_expansion", {
          origin: {
            runtimeEpoch: "epoch_1",
            operationId: "command_expansion",
            type: "command.run",
            digest: "a".repeat(64),
          },
          originKind: "command",
          bindingDigest: "c".repeat(64),
        });
        delete value.inputDigest;
        const origin = r.origins.admit(value);
        const reservation = r.reserveOrigin(origin, "expansion");
        const call = yield* reservationTask(r, reservation);
        assert.equal(r.origins.settleRoot(origin), false);
        const input = r.origins.bindInbox(origin, {
          nativeSessionId: "ses_native",
          inboxId: "msg_actual_expansion",
          inputDigest: "d".repeat(64),
          source: "command_expansion",
        });
        const scope = r.origins.createScope({
          cause: origin,
          inboxes: [input],
        });
        const h = r.admit(identity(r, { scope }));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        const proof = yield* r.observe(h);
        assert.equal(r.settle(h, proof), false);
        yield* Deferred.succeed(call.done, undefined);
        r.settleReservation(
          reservation,
          yield* r.observeReservation(reservation),
        );
        assert.equal(r.settle(h, proof), true);
        r.origins.settleInbox(input);
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("reservation observations reject foreign proof, lost capture, late binding and closure", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("reserved"));
        const a = r.reserveOrigin(origin, "handoff");
        const b = r.reserveOrigin(origin, "child");
        const at = yield* reservationTask(r, a);
        const bt = yield* reservationTask(r, b);
        yield* Deferred.succeed(at.done, undefined);
        const proof = yield* r.observeReservation(a);
        assert.throws(() => r.settleReservation(b, proof));
        assert.throws(() => r.settleReservation(a, {}));
        assert.ok(Exit.isFailure(yield* Effect.exit(r.captureReservation(a))));
        assert.equal(r.origins.settleRoot(origin), false);
        r.close();
        assert.throws(() => r.settleReservation(a, proof));
        assert.throws(() => r.reserveOrigin(origin, "rpc"));
        yield* Deferred.succeed(bt.done, undefined);
      }),
    );
  } finally {
    r.close();
  }
});

test("reserved original RPC IO must close after callback Fiber ends", async () => {
  const r = registry();
  const stream = new PassThrough();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("rpc_io"));
        const handle = r.reserveOrigin(origin, "rpc");
        r.bindIO(r.reserveReservation(handle, "io"), stream);
        const t = yield* reservationTask(r, handle);
        yield* Deferred.succeed(t.done, undefined);
        const observing = yield* Effect.forkChild(r.observeReservation(handle));
        yield* Fiber.await(t.fiber);
        yield* Effect.yieldNow;
        assert.equal(observing.pollUnsafe(), undefined);
        assert.equal(r.origins.settleRoot(origin), false);
        stream.destroy();
        r.settleReservation(handle, yield* Fiber.join(observing));
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    stream.destroy();
    r.close();
  }
});

test("synthetic child input inherits original scope and requires a reserved actual child lease", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("synthetic"));
        const foreign = r.origins.admit(binding("synthetic_foreign"));
        const scope = r.origins.createScope({ cause: origin, inboxes: [] });
        const parent = r.admit(identity(r, { scope }));
        const pt = yield* task(r, parent);
        r.start(parent, pt.fiber);
        const child = r.admit(
          identity(r, {
            scope,
            kind: "direct_tool",
            parentLeaseId: r.inspect(parent).leaseId,
          }),
        );
        const ct = yield* task(r, child);
        r.start(child, ct.fiber);
        const body = {
          nativeSessionId: "ses_native",
          inboxId: "msg_synthetic",
          inputDigest: "e".repeat(64),
          source: "synthetic_child",
        };
        assert.throws(() => r.bindChildInbox(parent, origin, body), /lineage/);
        assert.throws(() => r.bindChildInbox(child, foreign, body), /lineage/);
        const input = r.bindChildInbox(child, origin, body);
        assert.equal(
          r.origins.inspectInbox(input).parentLeaseId,
          r.inspect(child).leaseId,
        );
        const next = r.origins.promote(scope, [input]);
        r.advanceScope(parent, next);
        // Capture the actual child before promotion, before its input effects.
        // Promotion does not relabel the child's immutable birth scope.
        assert.equal(r.inspect(child).scopeVersion, 1);
        assert.equal(r.inspect(parent).scopeVersion, 2);
        assert.equal(r.origins.settleRoot(origin), false);
        yield* Deferred.succeed(pt.done, undefined);
        yield* Deferred.succeed(ct.done, undefined);
        r.settle(child, yield* r.observe(child));
        r.settle(parent, yield* r.observe(parent));
        r.origins.settleInbox(input);
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("failed cancellation callback cannot issue completion or erase pending input", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("failed_cancel"));
        const input = r.origins.bindInbox(origin, {
          nativeSessionId: "ses_native",
          inboxId: "msg_failed_cancel",
        });
        const reservation = r.reserveCancellation(input);
        const ready = yield* Deferred.make();
        const done = yield* Deferred.make();
        const fiber = yield* Effect.forkChild(
          r.captureReservation(reservation).pipe(
            Effect.tap(() => Deferred.succeed(ready, undefined)),
            Effect.andThen(Deferred.await(done)),
            Effect.andThen(Effect.fail(new Error("removal_failed"))),
          ),
        );
        yield* Deferred.await(ready);
        r.startReservation(reservation, fiber);
        yield* Deferred.succeed(done, undefined);
        const proof = yield* r.observeReservation(reservation);
        assert.equal(r.settleReservation(reservation, proof), false);
        assert.throws(() => r.reservationCompletion(reservation), /proof/);
        assert.equal(r.origins.inspectInbox(input).state, "pending");
        assert.equal(r.origins.settleRoot(origin), false);
      }),
    );
  } finally {
    r.close();
  }
});

test("a newly promoted input cannot borrow a prior completed lease as its carrier", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("no_borrow"));
        const scope = r.origins.createScope({ cause: origin, inboxes: [] });
        const h = r.admit(identity(r, { scope }));
        const t = yield* task(r, h);
        r.start(h, t.fiber);
        yield* Deferred.succeed(t.done, undefined);
        r.settle(h, yield* r.observe(h));
        const input = r.origins.bindInbox(origin, {
          nativeSessionId: "ses_native",
          inboxId: "msg_no_borrow",
        });
        const next = r.origins.promote(scope, [input]);
        assert.throws(() => r.origins.settleInbox(input), /proof/);
        assert.equal(r.origins.settleRoot(origin), false);
        const nextLease = r.admit(identity(r, { scope: next }));
        const nt = yield* task(r, nextLease);
        r.start(nextLease, nt.fiber);
        assert.throws(() => r.origins.settleInbox(input), /outstanding/);
        yield* Deferred.succeed(nt.done, undefined);
        r.settle(nextLease, yield* r.observe(nextLease));
        r.origins.settleInbox(input);
        assert.equal(r.origins.inspectInbox(input).scopeVersion, 2);
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    r.close();
  }
});

test("pending child cancellation does not deadlock physically completed parent and child proofs", async () => {
  const r = registry();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(binding("pending_child_cancel"));
        const scope = r.origins.createScope({ cause: origin, inboxes: [] });
        const parent = r.admit(identity(r, { scope }));
        const pt = yield* task(r, parent);
        r.start(parent, pt.fiber);
        const child = r.admit(
          identity(r, {
            scope,
            kind: "direct_tool",
            parentLeaseId: r.inspect(parent).leaseId,
          }),
        );
        const ct = yield* task(r, child);
        r.start(child, ct.fiber);
        const input = r.bindChildInbox(child, origin, {
          nativeSessionId: "ses_native",
          inboxId: "msg_pending_child_cancel",
          inputDigest: "f".repeat(64),
          source: "synthetic_child",
        });
        yield* Deferred.succeed(ct.done, undefined);
        const childProof = yield* r.observe(child);
        assert.equal(r.settle(child, childProof), false);
        yield* Deferred.succeed(pt.done, undefined);
        const parentProof = yield* r.observe(parent);
        assert.equal(r.settle(parent, parentProof), false);
        const removal = r.reserveCancellation(input);
        const rt = yield* reservationTask(r, removal);
        yield* Deferred.succeed(rt.done, undefined);
        r.settleReservation(removal, yield* r.observeReservation(removal));
        r.origins.cancelInbox(input, r.reservationCompletion(removal));
        assert.equal(r.settle(child, childProof), true);
        assert.equal(r.settle(parent, parentProof), true);
        assert.equal(r.origins.settleRoot(origin), true);
      }),
    );
  } finally {
    r.close();
  }
});

const workspaceMutation = () => {
  const value = binding("workspace_rpc", {
    origin: {
      runtimeEpoch: "epoch_1",
      operationId: "workspace_rpc",
      type: "configuration.mcp.connect",
      digest: "a".repeat(64),
    },
    originKind: "mutation",
    targetKind: "workspace",
    method: "mcp.connect",
    bindingDigest: "c".repeat(64),
    affectedSessionIds: [],
    affectedProjectIds: ["project"],
  });
  for (const field of ["inputDigest", "appSessionId", "nativeSessionId"])
    delete value[field];
  return value;
};

test("workspace mutation refuses session execution leases and synthetic input categories", () => {
  const r = registry();
  try {
    const origin = r.origins.admit(workspaceMutation());
    assert.throws(
      () => r.origins.createScope({ cause: origin, inboxes: [] }),
      /workspace_held/,
    );
    for (const kind of ["mutation", "workspace", "expansion"])
      assert.throws(() => r.reserveOrigin(origin, kind));
    assert.equal(r.origins.settleRoot(origin), false);
    assert.deepEqual(r.snapshot("project"), []);
  } finally {
    r.close();
  }
});

test("workspace original RPC and actual IO hold settlement without any session lease", async () => {
  const r = registry();
  const stream = new PassThrough();
  try {
    await run(
      Effect.gen(function* () {
        const origin = r.origins.admit(workspaceMutation());
        const rpc = r.reserveOrigin(origin, "rpc");
        r.bindIO(r.reserveReservation(rpc, "io"), stream);
        const t = yield* reservationTask(r, rpc);
        yield* Deferred.succeed(t.done, undefined);
        const observing = yield* Effect.forkChild(r.observeReservation(rpc));
        yield* Fiber.await(t.fiber);
        yield* Effect.yieldNow;
        assert.equal(observing.pollUnsafe(), undefined);
        assert.equal(r.origins.settleRoot(origin), false);
        assert.deepEqual(r.snapshot("project"), []);
        stream.destroy();
        assert.equal(
          r.settleReservation(rpc, yield* Fiber.join(observing)),
          true,
        );
        assert.equal(r.origins.settleRoot(origin), true);
        assert.throws(() => r.reserveOrigin(origin, "rpc"), /settled/);
      }),
    );
  } finally {
    stream.destroy();
    r.close();
  }
});
