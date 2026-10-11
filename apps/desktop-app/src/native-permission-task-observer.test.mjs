import { copyPermissionTestSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ChildProcess } from "node:child_process";
import { PassThrough, Readable, Writable } from "node:stream";

const namespace = await mkdtemp(join(tmpdir(), "omoc-task-observer-test-"));
let observerModule;
let library;
try {
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
  await copyPermissionTestSources(namespace, [
    "native-permission-task-observer.mjs",
    "host/native-workspace-file-io.mjs",
    "host/native-descriptor-read-resource.mjs",
  ]);
  observerModule = await import(
    pathToFileURL(join(namespace, "native-permission-task-observer.mjs")).href
  );
  library = await import(
    pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
  );
} catch (error) {
  await rm(namespace, { recursive: true, force: true });
  throw error;
}
after(() => rm(namespace, { recursive: true, force: true }));
const { createNativeTaskObserver } = observerModule;
const { Effect, Fiber, Deferred, Exit } = library;
const make = () => createNativeTaskObserver({ runtimeEpoch: "test_epoch-1" });
const lease = () => Object.freeze({});
const run = (effect) =>
  Effect.runPromise(effect.pipe(Effect.timeout("5 seconds")));
const drain = () => new Promise((resolve) => setImmediate(resolve));
const finished = () => Effect.runFork(Effect.void);
const gate = () => Effect.runSync(Deferred.make());
const release = (deferred) =>
  Effect.runSync(Deferred.succeed(deferred, undefined));

// Capture runs in the observed runtime task; the Deferred proves registration
// completed without depending on scheduler timing or manufacturing identities.
const captured = async (observer, handle, body = Effect.void) => {
  const ready = gate();
  const fiber = Effect.runFork(
    observer.capture(handle).pipe(
      Effect.flatMap((actual) => Deferred.succeed(ready, actual)),
      Effect.andThen(body),
    ),
  );
  assert.equal(await run(Deferred.await(ready)), fiber);
  return fiber;
};

test("observe synchronously seals, returns stable Effect and opaque lease-bound proof", async () => {
  const observer = make();
  const handle = lease();
  const hold = gate();
  const fiber = await captured(observer, handle, Deferred.await(hold));
  assert.throws(() => observer.reserve(handle, "io"));
  const observation = observer.observe(handle, fiber);
  assert.ok(Effect.isEffect(observation));
  assert.equal(observer.observe(handle, fiber), observation);
  assert.throws(() => observer.reserve(handle, "io"));
  assert.throws(() => observer.observe(handle, finished()));
  release(hold);
  const proof = await run(observation);
  assert.deepEqual(Reflect.ownKeys(proof), []);
  assert.ok(Object.isFrozen(proof));
  assert.deepEqual(observer.proofFor(proof, handle), {
    runtimeEpoch: "test_epoch-1",
    taskOutcome: "success",
    complete: true,
    processCount: 0,
    ioCount: 0,
  });
  assert.ok(Object.isFrozen(observer.proofFor(proof, handle)));
  assert.equal(await run(observation), proof);
  assert.throws(() => observer.proofFor(proof, lease()));
  assert.throws(() => observer.proofFor({}, handle));
  observer.close();
  assert.throws(() => observer.proofFor(proof, handle));
});

test("actual Fiber interruption waits finalizers and all IO close, without trusting result fields", async () => {
  const observer = make();
  const handle = lease();
  const stream = new PassThrough();
  observer.bindIO(observer.reserve(handle, "io"), stream);
  const entered = gate();
  const finish = gate();
  const fiber = await captured(
    observer,
    handle,
    Effect.ensuring(
      Effect.never,
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(finish);
      }),
    ),
  );
  const observation = observer.observe(handle, fiber);
  let done = false;
  const pending = run(observation).then((proof) => {
    done = true;
    return proof;
  });
  const interrupt = run(Fiber.interrupt(fiber));
  await run(Deferred.await(entered));
  await drain();
  assert.equal(done, false);
  release(finish);
  await interrupt;
  await drain();
  assert.equal(done, false);
  stream.destroy();
  const proof = await pending;
  assert.deepEqual(observer.proofFor(proof, handle), {
    runtimeEpoch: "test_epoch-1",
    taskOutcome: "failure",
    complete: true,
    processCount: 0,
    ioCount: 1,
  });
  observer.close();
});

test("IO errors and unbound slots are incomplete; process exit and close never prove descendants", async () => {
  for (const mode of ["error", "unbound", "process"]) {
    const observer = make();
    const handle = lease();
    const slot = observer.reserve(
      handle,
      mode === "process" ? "process" : "io",
    );
    const resource =
      mode === "process" ? new ChildProcess() : new PassThrough();
    if (mode !== "unbound")
      observer[mode === "process" ? "bindProcess" : "bindIO"](slot, resource);
    const observation = observer.observe(
      handle,
      await captured(observer, handle),
    );
    if (mode === "error") resource.destroy(new Error("private failure"));
    if (mode === "process") {
      resource.emit("exit", 0, null);
      resource.emit("close", 0, null);
    }
    const proof = await run(observation);
    assert.equal(observer.proofFor(proof, handle).complete, false);
    assert.equal(
      JSON.stringify(observer.proofFor(proof, handle)).includes(
        "private failure",
      ),
      false,
    );
    resource.destroy?.();
    observer.close();
  }
});

test("existing reservations can bind while running; every IO must close", async () => {
  const observer = make();
  const handle = lease();
  const first = observer.reserve(handle, "io");
  const second = observer.reserve(handle, "io");
  const hold = gate();
  const fiber = await captured(observer, handle, Deferred.await(hold));
  assert.throws(() => observer.reserve(handle, "io"));
  const observation = observer.observe(handle, fiber);
  const streams = [new PassThrough(), new PassThrough()];
  observer.bindIO(first, streams[0]);
  observer.bindIO(second, streams[1]);
  release(hold);
  let done = false;
  const pending = run(observation).then((proof) => {
    done = true;
    return proof;
  });
  streams[0].destroy();
  await drain();
  assert.equal(done, false);
  streams[1].destroy();
  assert.equal(observer.proofFor(await pending, handle).complete, true);
  observer.close();
});

test("close revokes synchronously, removes listeners, never kills or bypasses actual finalizers", async () => {
  const observer = make();
  const handle = lease();
  const stream = new PassThrough();
  const child = new ChildProcess();
  let kills = 0;
  child.kill = () => {
    kills++;
  };
  observer.bindProcess(observer.reserve(handle, "process"), child);
  observer.bindIO(observer.reserve(handle, "io"), stream);
  const entered = gate();
  const finish = gate();
  const fiber = await captured(
    observer,
    handle,
    Effect.ensuring(
      Effect.never,
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(finish);
      }),
    ),
  );
  let done = false;
  const pending = run(observer.observe(handle, fiber)).then((proof) => {
    done = true;
    return proof;
  });
  const interrupt = run(Fiber.interrupt(fiber));
  await run(Deferred.await(entered));
  const streamListeners = stream.listenerCount("close");
  observer.close();
  observer.close();
  assert.equal(stream.listenerCount("close"), streamListeners - 1);
  for (const name of ["exit", "close", "error"])
    assert.equal(child.listenerCount(name), 0);
  assert.equal(stream.destroyed, false);
  assert.equal(kills, 0);
  assert.throws(() => observer.reserve(handle, "io"));
  assert.throws(() => observer.observe(handle, fiber));
  await drain();
  assert.equal(done, false);
  release(finish);
  await interrupt;
  const proof = await pending;
  assert.throws(() => observer.proofFor(proof, handle));
  stream.destroy();
});

test("real failures are sanitized; result/status/slot fields grant no evidence", async () => {
  for (const [task, outcome] of [
    [
      Effect.succeed({ complete: false, taskOutcome: "failure", slots: [] }),
      "success",
    ],
    [Effect.fail(new Error("secret payload")), "failure"],
  ]) {
    const observer = make();
    const handle = lease();
    const proof = await run(
      observer.observe(handle, await captured(observer, handle, task)),
    );
    const facts = observer.proofFor(proof, handle);
    assert.equal(facts.complete, true);
    assert.equal(facts.taskOutcome, outcome);
    assert.equal(JSON.stringify(facts).includes("secret"), false);
    assert.throws(() => observer.proofFor(facts, handle));
    assert.throws(() =>
      observer.proofFor({ complete: true, slots: [] }, handle),
    );
    observer.close();
  }
});

test("rejects proxy and obvious fake authority without executing traps or getters", () => {
  let accesses = 0;
  const proxy = (value) =>
    new Proxy(value, {
      get() {
        accesses++;
        throw new Error("trap");
      },
      getPrototypeOf() {
        accesses++;
        throw new Error("trap");
      },
      ownKeys() {
        accesses++;
        throw new Error("trap");
      },
    });
  const observer = make();
  const fiber = finished();
  for (const invalid of [
    null,
    [],
    true,
    "lease",
    { complete: true },
    proxy({}),
  ]) {
    assert.throws(() => observer.reserve(invalid, "io"));
    assert.throws(() => observer.observe(invalid, fiber));
  }
  const accessor = Object.defineProperty({}, "runtimeEpoch", {
    enumerable: true,
    get() {
      accesses++;
      return "x";
    },
  });
  for (const invalid of [
    proxy({ runtimeEpoch: "x" }),
    accessor,
    {},
    { runtimeEpoch: "x", extra: 1 },
    { runtimeEpoch: "bad epoch" },
  ]) {
    assert.throws(() => createNativeTaskObserver(invalid));
  }
  const fake = Object.create(Object.getPrototypeOf(fiber));
  for (const invalid of [
    proxy(fiber),
    fake,
    { ...fiber },
    { await: Effect.void, complete: true },
    true,
    null,
  ]) {
    assert.throws(() => observer.observe(lease(), invalid));
  }
  assert.throws(() => observer.observe(lease(), fiber, []));
  assert.throws(() => observer.proofFor(proxy({}), lease()));
  const slot = observer.reserve(lease(), "io");
  assert.throws(() => observer.bindIO(slot, proxy(new PassThrough())));
  assert.throws(() =>
    observer.bindIO(slot, Object.create(PassThrough.prototype)),
  );
  const processSlot = observer.reserve(lease(), "process");
  assert.throws(() =>
    observer.bindProcess(processSlot, proxy(new ChildProcess())),
  );
  assert.throws(() =>
    observer.bindProcess(processSlot, Object.create(ChildProcess.prototype)),
  );
  assert.equal(accesses, 0);
  observer.close();
});

test("slots, resources, fibers and proofs have single ownership across leases and observers", async () => {
  const observer = make();
  const other = make();
  const handle = lease();
  const slot = observer.reserve(handle, "io");
  const second = observer.reserve(lease(), "io");
  const outside = other.reserve(lease(), "io");
  const stream = new PassThrough();
  assert.throws(() => observer.bindProcess(slot, new ChildProcess()));
  assert.throws(() => observer.bindIO({}, stream));
  assert.throws(() => other.bindIO(slot, stream));
  observer.bindIO(slot, stream);
  assert.throws(() => observer.bindIO(slot, new PassThrough()));
  assert.throws(() => observer.bindIO(second, stream));
  assert.throws(() => other.bindIO(outside, stream));
  const fiber = await captured(observer, handle);
  const observation = observer.observe(handle, fiber);
  assert.throws(() => observer.observe(lease(), fiber));
  assert.throws(() => other.observe(lease(), fiber));
  stream.destroy();
  const proof = await run(observation);
  assert.throws(() => other.proofFor(proof, handle));
  assert.throws(() => observer.proofFor(new Proxy(proof, {}), handle));
  observer.close();
  assert.throws(() => other.bindIO(outside, stream));
  other.close();
});

test("late closed resource bindings and unbound post-Fiber bindings fail closed", async () => {
  const observer = make();
  const handle = lease();
  const slot = observer.reserve(handle, "io");
  const stream = new PassThrough();
  stream.destroy();
  await drain();
  assert.throws(() => observer.bindIO(slot, stream));
  const child = new ChildProcess();
  child.exitCode = 0;
  assert.throws(() =>
    observer.bindProcess(observer.reserve(handle, "process"), child),
  );
  const closedChild = new ChildProcess();
  closedChild._closesGot = 1;
  assert.throws(() =>
    observer.bindProcess(observer.reserve(handle, "process"), closedChild),
  );
  const observation = observer.observe(
    handle,
    await captured(observer, handle),
  );
  assert.throws(() => observer.bindIO(slot, new PassThrough()));
  assert.equal(
    observer.proofFor(await run(observation), handle).complete,
    false,
  );
  observer.close();
});

test("32 slots per lease and 8192 lifetime slots remain bounded", () => {
  const observer = make();
  for (let group = 0; group < 256; group++) {
    const handle = lease();
    for (let i = 0; i < 32; i++)
      observer.reserve(handle, i % 2 ? "io" : "process");
    assert.throws(() => observer.reserve(handle, "io"));
  }
  assert.throws(() => observer.reserve(lease(), "io"));
  assert.throws(() => observer.reserve(lease(), "unknown"));
  observer.close();
});

test("8192 lifetime lease limit also applies to zero-slot observations", async () => {
  const observer = make();
  let last;
  for (let i = 0; i < 8192; i++) {
    const handle = lease();
    const fiber = await captured(observer, handle);
    last = { handle, fiber, effect: observer.observe(handle, fiber) };
  }
  assert.throws(() => observer.observe(lease(), finished()));
  await assert.rejects(async () => run(observer.capture(lease())));
  assert.throws(() => observer.reserve(lease(), "io"));
  assert.equal(observer.observe(last.handle, last.fiber), last.effect);
  assert.equal(
    observer.proofFor(await run(last.effect), last.handle).complete,
    true,
  );
  observer.close();
});

test("a rejected already-closed IO cannot be replaced to erase lost evidence", async () => {
  const observer = make();
  const handle = lease();
  const slot = observer.reserve(handle, "io");
  const stream = new PassThrough();
  stream.destroy();
  await drain();
  assert.throws(() => observer.bindIO(slot, stream));
  assert.throws(() => observer.bindIO(slot, new PassThrough()));
  const proof = await run(
    observer.observe(handle, await captured(observer, handle)),
  );
  assert.equal(observer.proofFor(proof, handle).complete, false);
  observer.close();
});

test("a close event on an open PassThrough is permanently incomplete", async () => {
  const observer = make();
  const handle = lease();
  const stream = new PassThrough();
  const slot = observer.reserve(handle, "io");
  observer.bindIO(slot, stream);
  assert.equal(stream.closed, false);
  stream.emit("close");
  assert.equal(stream.closed, false);
  assert.throws(() => observer.bindIO(slot, new PassThrough()));
  const proof = await run(
    observer.observe(handle, await captured(observer, handle)),
  );
  assert.equal(observer.proofFor(proof, handle).complete, false);
  stream.destroy();
  await drain();
  assert.equal(observer.proofFor(proof, handle).complete, false);
  observer.close();
});

test("close evidence ignores caller closed and errored accessors", async () => {
  for (const mode of ["open", "closed", "error"]) {
    const observer = make();
    const handle = lease();
    const stream = new PassThrough();
    observer.bindIO(observer.reserve(handle, "io"), stream);
    let accesses = 0;
    Object.defineProperties(stream, {
      closed: {
        get() {
          accesses++;
          return mode === "open";
        },
      },
      errored: {
        get() {
          accesses++;
          return null;
        },
      },
    });
    if (mode === "open") stream.emit("close");
    else if (mode === "closed") stream.destroy();
    else {
      // Native state records the error before the asynchronous error event.
      // An early close event must not erase it through an own errored getter.
      stream.on("error", () => {});
      stream.destroy(new Error("private stream error"));
      stream.emit("close");
    }
    const proof = await run(
      observer.observe(handle, await captured(observer, handle)),
    );
    assert.equal(observer.proofFor(proof, handle).complete, mode === "closed");
    assert.equal(accesses, 0);
    observer.close();
    if (mode === "open") stream.destroy();
    await drain();
  }
});

test("binding checks native closed, destroyed and errored state without own getters", async () => {
  for (const state of ["open", "destroyed"]) {
    const observer = make();
    const handle = lease();
    const slot = observer.reserve(handle, "io");
    const stream = new PassThrough();
    if (state === "destroyed") {
      stream.destroy();
      await drain();
    }
    let accesses = 0;
    for (const key of ["closed", "destroyed", "errored"]) {
      Object.defineProperty(stream, key, {
        configurable: true,
        get() {
          accesses++;
          throw new Error("caller accessor");
        },
      });
    }
    if (state === "destroyed") {
      assert.throws(() => observer.bindIO(slot, stream));
      assert.throws(() => observer.bindIO(slot, new PassThrough()));
    } else observer.bindIO(slot, stream);
    assert.equal(accesses, 0);
    observer.close();
    for (const key of ["closed", "destroyed", "errored"]) delete stream[key];
    stream.destroy();
  }
});

test("native closure evidence covers Readable and Writable independently", async () => {
  for (const create of [
    () => new Readable({ read() {} }),
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
  ]) {
    for (const realClose of [false, true]) {
      const observer = make();
      const handle = lease();
      const stream = create();
      observer.bindIO(observer.reserve(handle, "io"), stream);
      if (realClose) stream.destroy();
      else stream.emit("close");
      const proof = await run(
        observer.observe(handle, await captured(observer, handle)),
      );
      assert.equal(observer.proofFor(proof, handle).complete, realClose);
      observer.close();
      stream.destroy();
    }
  }
});

test("descriptor and prototype clone cannot prove completion while original Fiber is live", async () => {
  const observer = make();
  const handle = lease();
  const hold = gate();
  const entered = gate();
  const finish = gate();
  const original = await captured(
    observer,
    handle,
    Deferred.await(hold).pipe(
      Effect.ensuring(
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
        ),
      ),
    ),
  );
  try {
    const clone = Object.create(
      Object.getPrototypeOf(original),
      Object.getOwnPropertyDescriptors(original),
    );
    assert.notEqual(clone, original);
    assert.equal(Object.getPrototypeOf(clone), Object.getPrototypeOf(original));
    assert.deepEqual(
      Object.getOwnPropertyDescriptors(clone),
      Object.getOwnPropertyDescriptors(original),
    );
    assert.equal(original.pollUnsafe(), undefined);
    assert.throws(() => observer.observe(handle, clone));
    clone._exit = Exit.succeed(undefined);
    assert.throws(() => observer.observe(handle, clone));
    assert.equal(original.pollUnsafe(), undefined);
    const observation = observer.observe(handle, original);
    let done = false;
    const pending = run(observation).then((proof) => {
      done = true;
      return proof;
    });
    release(hold);
    await run(Deferred.await(entered));
    assert.equal(original.pollUnsafe(), undefined);
    assert.equal(done, false);
    release(finish);
    const proof = await pending;
    assert.equal(observer.proofFor(proof, handle).complete, true);
    assert.equal(observer.proofFor(proof, handle).taskOutcome, "success");
  } finally {
    release(hold);
    release(finish);
    await run(Fiber.await(original));
    observer.close();
  }
});

test("capture is an Effect and unregistered actual Fibers cannot be observed", async () => {
  const observer = make();
  const handle = lease();
  const request = observer.capture(handle);
  assert.ok(Effect.isEffect(request));
  const original = finished();
  await run(Fiber.await(original));
  assert.throws(() => observer.observe(handle, original));
  const actual = await captured(observer, handle);
  const proof = await run(observer.observe(handle, actual));
  assert.equal(observer.proofFor(proof, handle).complete, true);
  assert.ok(Object.isFrozen(observer));
  assert.deepEqual(Object.keys(observer).sort(), [
    "acquireDescriptorRead",
    "bindFileIO",
    "bindIO",
    "bindProcess",
    "capture",
    "close",
    "observe",
    "proofFor",
    "reserve",
    "reserveRunning",
  ]);
  observer.close();
});

test("captured Fiber identity cannot move to a foreign observer or lease", async () => {
  const observer = make();
  const other = make();
  const handle = lease();
  const foreign = lease();
  const hold = gate();
  const attempts = gate();
  const actual = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      const foreignLease = yield* Effect.exit(observer.capture(foreign));
      const foreignObserver = yield* Effect.exit(other.capture(handle));
      yield* Deferred.succeed(attempts, { foreignLease, foreignObserver });
      yield* Deferred.await(hold);
    }),
  );
  try {
    const result = await run(Deferred.await(attempts));
    assert.ok(Exit.isFailure(result.foreignLease));
    assert.ok(Exit.isFailure(result.foreignObserver));
    await assert.rejects(async () => run(observer.capture(handle)));
    assert.throws(() => observer.observe(foreign, actual));
    assert.throws(() => other.observe(handle, actual));
    assert.throws(() => other.observe(foreign, actual));
    let accesses = 0;
    const proxy = new Proxy(actual, {
      get() {
        accesses++;
        throw new Error("caller trap");
      },
      getPrototypeOf() {
        accesses++;
        throw new Error("caller trap");
      },
      ownKeys() {
        accesses++;
        throw new Error("caller trap");
      },
    });
    assert.throws(() => observer.observe(handle, proxy));
    assert.equal(accesses, 0);
    release(hold);
    const proof = await run(observer.observe(handle, actual));
    assert.equal(observer.proofFor(proof, handle).complete, true);
  } finally {
    release(hold);
    await run(Fiber.await(actual));
    observer.close();
    other.close();
  }
});

test("late capture cannot replace a completed registered Fiber or revive a closed observer", async () => {
  const observer = make();
  const handle = lease();
  const original = await captured(observer, handle);
  await run(Fiber.await(original));
  const observation = observer.observe(handle, original);
  const proof = await run(observation);
  await assert.rejects(async () => run(observer.capture(handle)));
  assert.equal(observer.observe(handle, original), observation);
  assert.equal(observer.proofFor(proof, handle).complete, true);
  const delayed = observer.capture(lease());
  observer.close();
  await assert.rejects(async () => run(delayed));
  await assert.rejects(async () => run(observer.capture(lease())));
  assert.throws(() => observer.proofFor(proof, handle));
});

test("capture rejects proxy and forged leases without invoking caller traps", async () => {
  const observer = make();
  let accesses = 0;
  const proxy = new Proxy(lease(), {
    get() {
      accesses++;
      throw new Error("caller trap");
    },
    getPrototypeOf() {
      accesses++;
      throw new Error("caller trap");
    },
    ownKeys() {
      accesses++;
      throw new Error("caller trap");
    },
  });
  for (const invalid of [proxy, { complete: true }, null, [], true]) {
    await assert.rejects(async () => run(observer.capture(invalid)));
  }
  assert.equal(accesses, 0);
  observer.close();
});

test("capture records task termination before observe and cannot lose unbound-slot evidence", async () => {
  const observer = make();
  const handle = lease();
  const slot = observer.reserve(handle, "io");
  const actual = await captured(observer, handle);
  await run(Fiber.await(actual));
  const stream = new PassThrough();
  try {
    assert.throws(() => observer.bindIO(slot, stream));
    assert.equal(stream.listenerCount("close"), 0);
    assert.throws(() => observer.reserve(handle, "io"));
    const proof = await run(observer.observe(handle, actual));
    assert.equal(observer.proofFor(proof, handle).complete, false);
    assert.equal(observer.proofFor(proof, handle).ioCount, 1);
  } finally {
    observer.close();
    stream.destroy();
  }
});

test("running reservations belong to the captured Fiber and block proof until actual IO closes", async () => {
  const observer = make();
  const handle = lease();
  const stream = new PassThrough();
  const done = gate();
  const ready = gate();
  try {
    const fiber = await captured(
      observer,
      handle,
      Effect.gen(function* () {
        const slot = yield* observer.reserveRunning(handle, "io");
        observer.bindIO(slot, stream);
        yield* Deferred.succeed(ready, undefined);
        yield* Deferred.await(done);
      }),
    );
    await run(Deferred.await(ready));
    await assert.rejects(() => run(observer.reserveRunning(handle, "io")));
    const observing = Effect.runFork(observer.observe(handle, fiber));
    release(done);
    await run(Fiber.await(fiber));
    await drain();
    assert.equal(observing.pollUnsafe(), undefined);
    stream.destroy();
    const proof = await run(Fiber.join(observing));
    assert.equal(observer.proofFor(proof, handle).complete, true);
    assert.equal(observer.proofFor(proof, handle).ioCount, 1);
    await assert.rejects(() => run(observer.reserveRunning(handle, "io")));
  } finally {
    stream.destroy();
    observer.close();
  }
});

test("workspace and mutation labels cannot create resource evidence before or within a captured RPC", async () => {
  const observer = make();
  const handle = lease();
  const done = gate();
  try {
    for (const kind of ["workspace", "mutation", "rpc", "expansion"])
      assert.throws(() => observer.reserve(handle, kind));
    const fiber = await captured(
      observer,
      handle,
      Effect.gen(function* () {
        for (const kind of ["workspace", "mutation", "rpc", "expansion"]) {
          const result = yield* Effect.exit(
            observer.reserveRunning(handle, kind),
          );
          assert.ok(Exit.isFailure(result));
        }
        yield* Deferred.await(done);
      }),
    );
    const observed = observer.observe(handle, fiber);
    release(done);
    const facts = observer.proofFor(await run(observed), handle);
    assert.equal(facts.complete, true);
    assert.equal(facts.ioCount, 0);
    assert.equal(facts.processCount, 0);
  } finally {
    release(done);
    observer.close();
  }
});

async function workspaceReadFixture(t) {
  const fs = await import("node:fs/promises");
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-observed-file-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(join(directory, "note.txt"), "\uFEFFline\r\nlast");
  const { createWorkspaceRootAuthority } = await import(
    pathToFileURL(join(namespace, "host/workspace-root-authority.mjs"))
  );
  const io = await import(
    pathToFileURL(join(namespace, "host/native-workspace-file-io.mjs"))
  );
  const workspace = { id: "w1", path: directory };
  const root = await createWorkspaceRootAuthority(workspace);
  t.after(() => root.close());
  return { fs, workspace, root, io };
}

test("descriptor IO pre-start cancellation settles only the actual claimed original resource without running Bun", async (t) => {
  const { workspace, root } = await workspaceReadFixture(t);
  const descriptor = await import(
    pathToFileURL(join(namespace, "host/native-descriptor-read-resource.mjs"))
  );
  const observer = make(),
    handle = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  let operation;
  const fiber = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      operation = descriptor.createNativeDescriptorRead(workspace, {
        checkRoot: root.assertOpened,
        check() {
          throw new Error("cancelled factory must not start");
        },
      });
      yield* observer.bindFileIO(slot, operation.resource);
      operation.cancel();
      const exit = yield* Effect.exit(Effect.promise(() => operation.ready));
      assert.ok(Exit.isFailure(exit));
      assert.deepEqual(yield* Effect.promise(() => operation.close()), {
        complete: true,
      });
    }),
  );
  const proof = await run(observer.observe(handle, fiber));
  assert.equal(observer.proofFor(proof, handle).complete, true);
  assert.equal(observer.proofFor(proof, handle).ioCount, 1);
  assert.equal(observer.proofFor(proof, handle).taskOutcome, "success");
  assert.throws(() =>
    descriptor.observeNativeDescriptorRead(operation.resource),
  );
});

test("descriptor IO constructor rejection cannot supply task settlement through an error or RPC exit", async (t) => {
  const { workspace, root } = await workspaceReadFixture(t);
  const descriptor = await import(
    pathToFileURL(join(namespace, "host/native-descriptor-read-resource.mjs"))
  );
  const observer = make(),
    handle = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  const fiber = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      const operation = descriptor.createNativeDescriptorRead(workspace, {
        checkRoot: root.assertOpened,
        check() {},
      });
      yield* observer.bindFileIO(slot, operation.resource);
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(Effect.promise(() => operation.ready)),
        ),
      );
      assert.deepEqual(yield* Effect.promise(() => operation.close()), {
        complete: false,
      });
    }),
  );
  const proof = await run(observer.observe(handle, fiber));
  assert.equal(observer.proofFor(proof, handle).complete, false);
  assert.equal(observer.proofFor(proof, handle).ioCount, 1);
  assert.equal(observer.proofFor(proof, handle).taskOutcome, "success");
});

test("actual checked file IO is bound before effects and waits physical descriptor closure", async (t) => {
  const { workspace, root, io } = await workspaceReadFixture(t);
  const observer = make(),
    handle = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  let operation;
  const fiber = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      operation = io.createNativeWorkspaceFileRead(workspace, "note.txt", {
        checkRoot: root.assertOpened,
        check: () => {},
      });
      yield* observer.bindFileIO(slot, operation.resource);
      const result = yield* Effect.promise(() => operation.result);
      assert.equal(result.status, "available");
      assert.equal(result.bytes.toString("utf8"), "\uFEFFline\r\nlast");
    }),
  );
  const proof = await run(observer.observe(handle, fiber));
  assert.deepEqual(observer.proofFor(proof, handle), {
    runtimeEpoch: "test_epoch-1",
    taskOutcome: "success",
    complete: true,
    processCount: 0,
    ioCount: 1,
  });
  await assert.rejects(run(observer.bindFileIO(slot, operation.resource)));
  assert.throws(() => io.observeNativeWorkspaceFileRead(operation.resource));
});

test("file IO binding refuses forged, Proxy, wrong-kind and duplicate resource owners", async (t) => {
  const { workspace, root, io } = await workspaceReadFixture(t);
  const observer = make(),
    handle = lease(),
    other = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  const second = observer.reserve(other, "io");
  const processSlot = observer.reserve(other, "process");
  let traps = 0;
  const fiber = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      assert.ok(
        Exit.isFailure(yield* Effect.exit(observer.bindFileIO(slot, {}))),
      );
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            observer.bindFileIO(
              slot,
              new Proxy(
                {},
                {
                  get() {
                    traps++;
                  },
                },
              ),
            ),
          ),
        ),
      );
      assert.equal(traps, 0);
      const operation = io.createNativeWorkspaceFileRead(
        workspace,
        "note.txt",
        { checkRoot: root.assertOpened, check: () => {} },
      );
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            observer.bindFileIO(processSlot, operation.resource),
          ),
        ),
      );
      yield* observer.bindFileIO(slot, operation.resource);
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(observer.bindFileIO(second, operation.resource)),
        ),
      );
      yield* Effect.promise(() => operation.result);
    }),
  );
  assert.equal(
    observer.proofFor(await run(observer.observe(handle, fiber)), handle)
      .complete,
    true,
  );
});

test("Fiber interruption cannot settle file IO before its actual pending close", async (t) => {
  const { fs, workspace, root, io } = await workspaceReadFixture(t);
  const observer = make(),
    handle = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  let beginClose, releaseClose;
  const entered = new Promise((resolve) => {
    beginClose = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const handles = [];
  let operation;
  const fiber = await captured(
    observer,
    handle,
    Effect.gen(function* () {
      operation = io.createNativeWorkspaceFileRead(workspace, "note.txt", {
        checkRoot: root.assertOpened,
        check: () => {},
        io: {
          lstat: fs.lstat,
          realpath: fs.realpath,
          open: async (...args) => {
            const handle = await fs.open(...args);
            handles.push(handle);
            const close = handle.close.bind(handle);
            handle.close = async () => {
              beginClose();
              await releasePromise;
              await close();
            };
            return handle;
          },
        },
      });
      yield* observer.bindFileIO(slot, operation.resource);
      yield* Effect.promise(() => operation.result);
    }),
  );
  await entered;
  let done = false;
  const waiting = run(observer.observe(handle, fiber)).then((proof) => {
    done = true;
    return proof;
  });
  await run(Fiber.interrupt(fiber));
  operation.cancel();
  await drain();
  assert.equal(done, false);
  assert.ok(handles.some((handle) => handle.fd !== -1));
  releaseClose();
  const proof = await waiting;
  await operation.result.catch(() => {});
  assert.ok(handles.every((handle) => handle.fd === -1));
  assert.equal(observer.proofFor(proof, handle).taskOutcome, "failure");
  assert.equal(observer.proofFor(proof, handle).complete, false);
});

test("sibling Fiber cannot claim a file resource for another captured task", async (t) => {
  const { workspace, root, io } = await workspaceReadFixture(t);
  const observer = make(),
    handle = lease();
  t.after(() => observer.close());
  const slot = observer.reserve(handle, "io");
  const hold = gate();
  const fiber = await captured(observer, handle, Deferred.await(hold));
  const operation = io.createNativeWorkspaceFileRead(workspace, "note.txt", {
    checkRoot: root.assertOpened,
    check: () => {},
  });
  await assert.rejects(run(observer.bindFileIO(slot, operation.resource)));
  operation.cancel();
  await assert.rejects(operation.result);
  release(hold);
  const proof = await run(observer.observe(handle, fiber));
  assert.equal(observer.proofFor(proof, handle).complete, false);
});
