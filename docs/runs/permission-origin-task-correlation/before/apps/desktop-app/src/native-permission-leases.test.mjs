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
const identity = (changes = {}) => ({
  originalOperationKey: "original_epoch:operation",
  projectId: "project",
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
    const h = r.admit(identity());
    const row = r.inspect(h);
    assert.equal(row.state, "admitted");
    assert.equal(row.runtimeEpoch, "epoch_1");
    assert.ok(Object.isFrozen(row));
    assert.deepEqual(
      Object.keys(row).sort(),
      ["runtimeEpoch", "leaseId", ...Object.keys(identity()), "state"].sort(),
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
      assert.throws(() => r.admit(identity(changes)));
    let calls = 0;
    const accessor = identity();
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
        const h = r.admit(identity());
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
        const other = r.admit(identity({ sessionId: "another" }));
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
        const parent = r.admit(identity());
        const p = yield* task(r, parent);
        r.start(parent, p.fiber);
        const parentLeaseId = r.inspect(parent).leaseId;
        for (const mismatch of [
          { projectId: "other" },
          { originalOperationKey: "other" },
          { locationIncarnation: "other" },
          { modeGeneration: 2 },
          { inventoryGeneration: 2 },
        ])
          assert.throws(() =>
            r.admit(identity({ parentLeaseId, ...mismatch })),
          );
        const child = r.admit(
          identity({ parentLeaseId, kind: "background", sessionId: "child" }),
        );
        const c = yield* task(r, child);
        r.start(child, c.fiber);
        yield* Deferred.succeed(p.done, undefined);
        const proof = yield* r.observe(parent);
        assert.equal(r.settle(parent, proof), false);
        assert.equal(r.inspect(parent).state, "running");
        assert.throws(() =>
          r.admit(identity({ parentLeaseId, kind: "background" })),
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
        const h = r.admit(identity({ kind: "filesystem" }));
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
        const h = r.admit(identity({ kind: "shell" }));
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
      const h = r.admit(identity());
      const t = yield* task(r, h);
      r.start(h, t.fiber);
      r.close();
      r.close();
      assert.equal(t.fiber.pollUnsafe(), undefined);
      assert.equal(r.inspect(h).state, "unverified");
      assert.throws(() => r.admit(identity()));
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
        const h = r.admit(identity());
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
        const h = r.admit(identity());
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
        const h = r.admit(identity());
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
        const parent = r.admit(identity());
        const p = yield* task(r, parent);
        r.start(parent, p.fiber);
        const child = r.admit(
          identity({
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
        const failing = r.admit(identity());
        const go = yield* Deferred.make();
        const f = yield* launch(
          r,
          failing,
          Deferred.await(go).pipe(
            Effect.andThen(Effect.fail("synthetic failure")),
          ),
        );
        r.start(failing, f);
        const other = r.admit(identity());
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
        const parent = r.admit(identity());
        const t = yield* task(r, parent);
        r.start(parent, t.fiber);
        const parentLeaseId = r.inspect(parent).leaseId;
        for (let i = 0; i < 32; i++)
          r.admit(identity({ parentLeaseId, sessionId: `child${i}` }));
        assert.throws(() => r.admit(identity({ parentLeaseId })));
        for (let i = 33; i < 8192; i++) r.admit(identity());
        assert.equal(r.snapshot("project").length, 8192);
        assert.throws(() => r.admit(identity()));
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
        const h = r.admit(identity({ kind: "shell" }));
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
