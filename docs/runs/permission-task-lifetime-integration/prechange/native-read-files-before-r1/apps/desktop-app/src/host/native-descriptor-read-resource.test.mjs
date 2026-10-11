// Node-only wrapper lifecycle tests. The scripted kernel is not evidence for
// Bun, Native, Darwin confinement, permission grants, or whole-task settlement.
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as io from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promiseHooks } from "node:v8";
import {
  createWorkspaceRootAuthority,
  isWorkspaceRootGuard,
} from "./workspace-root-authority.mjs";
import * as actual from "./native-descriptor-read-resource.mjs";

const sourceURL = new URL(
  "./native-descriptor-read-resource.mjs",
  import.meta.url,
);
const kernelImport = 'from "./native-descriptor-read.mjs"';
const deferred = () => Promise.withResolvers();

test("scripted: directory rows do not settle the retained root before close", async (t) => {
  const f = await scripted(t);
  const { reader, completion, status } = claimed(t, f);
  const access = await reader.ready;
  const rows = Object.freeze([
    Object.freeze({ name: "note.txt", type: "file" }),
  ]);
  f.state.listResult = rows;
  assert.equal(access.list(), rows);
  assert.equal(status.settled, false);
  assert.equal(f.state.fds.size, 1);
  assert.deepEqual(await access.close(), { complete: true });
  assert.equal(await completion, await reader.close());
  assert.throws(() => access.list());
});
for (const lateFailure of [false, true]) {
  test(`scripted: directory cancellation waits original finally; late close failure=${lateFailure}`, async (t) => {
    const f = await scripted(t);
    const { reader, completion, status } = claimed(t, f);
    const access = await reader.ready;
    f.state.failLateClose = lateFailure;
    f.state.onList = () => {
      reader.cancel();
      assert.equal(
        status.settled,
        false,
        "cancel must not publish while directory FD is active",
      );
    };
    f.state.onFinally = () =>
      assert.equal(
        status.settled,
        false,
        "original finally must finish before publication",
      );
    assert.throws(() => access.list());
    assert.deepEqual(await completion, { complete: !lateFailure });
    assert.equal(f.state.fds.size, 0);
    assert.equal(status.settled, true);
    assert.deepEqual(await reader.close(), { complete: !lateFailure });
  });
}

// Promise hooks observe synchronous settlement, including inside a synchronous
// original read. A .then callback alone cannot distinguish early publication.
function settlement(t, promise) {
  const state = { settled: false };
  const stop = promiseHooks.createHook({
    settled(value) {
      if (value === promise) state.settled = true;
    },
  });
  t.after(stop);
  return state;
}

async function fixture(t) {
  const parent = await io.realpath(
    await io.mkdtemp(join(tmpdir(), "omoc-read-resource-")),
  );
  const root = join(parent, "root");
  await io.mkdir(root);
  await io.writeFile(join(root, "note.txt"), "synthetic bytes");
  const workspace = { id: "resource-test", path: root };
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(async () => {
    await owner.close();
    await io.rm(parent, { recursive: true, force: true });
  });
  return {
    parent,
    root,
    workspace,
    owner,
    options: { checkRoot: owner.assertOpened, check() {} },
  };
}

async function scripted(t) {
  const f = await fixture(t);
  const directory = join(f.parent, "host");
  await io.mkdir(directory);
  // Keep all other source imports unchanged. Symlinks resolve the original
  // modules, including the exact shared private root-guard brand registry.
  await io.symlink(
    fileURLToPath(new URL("./workspace-root-authority.mjs", sourceURL)),
    join(directory, "workspace-root-authority.mjs"),
  );
  await io.symlink(
    fileURLToPath(new URL("../renderer", sourceURL)),
    join(f.parent, "renderer"),
    "dir",
  );
  const kernelURL = pathToFileURL(join(directory, "scripted-kernel.mjs"));
  await io.writeFile(
    kernelURL,
    `import * as fs from "node:fs";
import { join } from "node:path";
import { assertWorkspaceRootGuard } from ${JSON.stringify(new URL("./workspace-root-authority.mjs", sourceURL).href)};
export const state = { events: [], fds: new Set(), closeCalls: 0, sticky: false };
export async function createNativeDescriptorReadKernel(workspace, options) {
  state.events.push("factory-enter");
  state.workspace = workspace;
  state.options = options;
  state.onFactory?.(workspace, options);
  if (state.gate) await state.gate;
  if (state.factoryError) throw state.factoryError;
  if (state.checkFactory) options.check();
  const root = fs.openSync(workspace.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  state.fds.add(root);
  const held = fs.fstatSync(root, { bigint: true });
  let closed = false;
  try {
    assertWorkspaceRootGuard(options.checkRoot, {
      workspaceId: workspace.id, workspacePath: workspace.path,
      dev: String(held.dev), ino: String(held.ino),
    });
  } catch (error) {
    fs.closeSync(root); state.fds.delete(root); throw error;
  }
  state.events.push("factory-ready");
  return Object.freeze({
    list(path = "") {
      if (closed || state.sticky) throw new Error("scripted revoked");
      options.check();
      const directory = fs.openSync(join(workspace.path, path), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      state.fds.add(directory); state.events.push("list-enter");
      try {
        state.onList?.(path);
        options.check();
        if (state.listError) throw state.listError;
        return state.listResult;
      } finally {
        state.events.push("list-finally");
        fs.closeSync(directory); state.fds.delete(directory);
        if (state.failLateClose) state.sticky = true;
        state.onFinally?.();
        if (state.sticky) throw new Error("scripted sticky cleanup failure");
      }
    },
    read(path, page) {
      if (closed || state.sticky) throw new Error("scripted revoked");
      options.check();
      const leaf = fs.openSync(join(workspace.path, path), fs.constants.O_RDONLY);
      state.fds.add(leaf);
      state.events.push("read-enter");
      try {
        state.onRead?.(path, page);
        options.check();
        if (state.readError) throw state.readError;
        return state.result;
      } finally {
        state.events.push("read-finally");
        fs.closeSync(leaf); state.fds.delete(leaf);
        if (state.failLateClose) state.sticky = true;
        state.onFinally?.();
        if (state.sticky) throw new Error("scripted sticky cleanup failure");
      }
    },
    close() {
      state.closeCalls++;
      state.events.push("close");
      if (!closed) {
        closed = true; fs.closeSync(root); state.fds.delete(root);
        state.onClose?.();
      }
      if (state.failClose) state.sticky = true;
      if (state.sticky) throw new Error("scripted sticky cleanup failure");
    },
  });
}
`,
  );
  const { state } = await import(kernelURL.href);
  t.after(() => {
    for (const fd of state.fds) fs.closeSync(fd);
    state.fds.clear();
  });
  const source = await io.readFile(sourceURL, "utf8");
  assert.equal(
    source.split(kernelImport).length,
    2,
    "replace exactly one import",
  );
  const copy = source.replace(kernelImport, 'from "./scripted-kernel.mjs"');
  assert.equal(
    copy.replace('from "./scripted-kernel.mjs"', kernelImport),
    source,
  );
  const copyURL = pathToFileURL(join(directory, "resource.mjs"));
  await io.writeFile(copyURL, copy);
  const api = await import(copyURL.href);
  return { ...f, state, api };
}

function claimed(t, f, check = f.options.check) {
  const reader = f.api.createNativeDescriptorRead(f.workspace, {
    ...f.options,
    check,
  });
  const completion = f.api.observeNativeDescriptorRead(reader.resource);
  const status = settlement(t, completion);
  return { reader, completion, status };
}

test("actual: exact data objects and real guard are checked synchronously without traps", async (t) => {
  const f = await fixture(t);
  let traps = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("trap");
      },
      ownKeys() {
        traps++;
        throw Error("trap");
      },
      getPrototypeOf() {
        traps++;
        throw Error("trap");
      },
    },
  );
  const getter = Object.defineProperty({ path: f.root }, "id", {
    enumerable: true,
    get() {
      traps++;
      return f.workspace.id;
    },
  });
  for (const workspace of [
    undefined,
    null,
    [],
    proxy,
    getter,
    Object.create(f.workspace),
    Object.assign(Object.create(null), f.workspace),
    { ...f.workspace, extra: true },
    { id: f.workspace.id },
    { ...f.workspace, [Symbol("extra")]: true },
    Object.defineProperty({ ...f.workspace }, "id", { enumerable: false }),
    { ...f.workspace, id: "" },
    { ...f.workspace, id: "a/b" },
    { ...f.workspace, id: "a".repeat(129) },
    { ...f.workspace, path: "relative" },
    { ...f.workspace, path: f.root + "/.." },
  ])
    assert.throws(() =>
      actual.createNativeDescriptorRead(workspace, f.options),
    );
  const optionGetter = Object.defineProperty(
    { checkRoot: f.owner.assertOpened },
    "check",
    {
      enumerable: true,
      get() {
        traps++;
        return () => {};
      },
    },
  );
  for (const options of [
    undefined,
    null,
    [],
    proxy,
    optionGetter,
    {},
    Object.create(f.options),
    { check: f.options.check },
    { checkRoot: f.owner.assertOpened },
    { ...f.options, io: fs },
    { ...f.options, checkRoot() {} },
    { ...f.options, checkRoot: new Proxy(f.owner.assertOpened, {}) },
    { ...f.options, check: null },
    { ...f.options, check: async () => {} },
    { ...f.options, check: function* () {} },
    { ...f.options, check: async function* () {} },
    { ...f.options, check: new Proxy(() => {}, {}) },
  ])
    assert.throws(() =>
      actual.createNativeDescriptorRead(f.workspace, options),
    );
  assert.equal(traps, 0);
  assert.equal(isWorkspaceRootGuard(f.owner.assertOpened), true);
});

test("actual: private brand rejects forged, copied and proxied resources without traps", async (t) => {
  const f = await fixture(t);
  const reader = actual.createNativeDescriptorRead(f.workspace, f.options);
  assert.ok(Object.isFrozen(reader));
  assert.deepEqual(Object.keys(reader).sort(), [
    "cancel",
    "close",
    "ready",
    "resource",
  ]);
  assert.ok(reader.ready instanceof Promise);
  assert.ok(Object.isFrozen(reader.resource));
  assert.equal(Object.getPrototypeOf(reader.resource), null);
  assert.deepEqual(Reflect.ownKeys(reader.resource), []);
  assert.equal(actual.isNativeDescriptorReadResource(reader.resource), true);
  let traps = 0;
  const proxy = new Proxy(reader.resource, {
    get() {
      traps++;
      throw Error("trap");
    },
  });
  for (const forged of [
    undefined,
    null,
    1,
    {},
    reader,
    { ...reader.resource },
    Object.freeze(Object.create(null)),
    Object.create(reader.resource),
    proxy,
  ]) {
    assert.equal(actual.isNativeDescriptorReadResource(forged), false);
    assert.throws(() => actual.observeNativeDescriptorRead(forged));
  }
  const completion = actual.observeNativeDescriptorRead(reader.resource);
  assert.throws(() => actual.observeNativeDescriptorRead(reader.resource));
  assert.equal(reader.cancel(), undefined);
  await assert.rejects(reader.ready);
  assert.deepEqual(await completion, { complete: true });
  assert.equal(traps, 0);
});

test("actual: claimed prestart cancellation has zero callbacks and verified no-factory completion", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const reader = actual.createNativeDescriptorRead(f.workspace, {
    ...f.options,
    check() {
      calls++;
    },
  });
  const completion = actual.observeNativeDescriptorRead(reader.resource);
  reader.cancel();
  assert.equal(reader.close(), completion);
  await assert.rejects(reader.ready);
  assert.deepEqual(await completion, { complete: true });
  assert.equal(calls, 0);
});

test("actual: Node unsupported factory is unverified, regardless of its error text", async (t) => {
  assert.equal(globalThis.Bun, undefined, "Run only with Node");
  const f = await fixture(t);
  let checks = 0;
  const reader = actual.createNativeDescriptorRead(f.workspace, {
    ...f.options,
    check() {
      checks++;
    },
  });
  const completion = actual.observeNativeDescriptorRead(reader.resource);
  await assert.rejects(reader.ready); // No error-message cleanup inference.
  assert.deepEqual(await completion, { complete: false });
  assert.equal(checks, 0);
  assert.equal(reader.close(), completion);
});

test("scripted: an unclaimed reader never enters the factory and late claims fail", async (t) => {
  const f = await scripted(t);
  const reader = f.api.createNativeDescriptorRead(f.workspace, f.options);
  const rejection = assert.rejects(reader.ready);
  assert.deepEqual(f.state.events, []);
  await Promise.resolve();
  assert.throws(() => f.api.observeNativeDescriptorRead(reader.resource));
  await rejection;
  assert.deepEqual(f.state.events, []);
  assert.deepEqual(await reader.close(), { complete: false });
});

for (const action of ["cancel", "close"]) {
  test(`scripted: claimed prestart ${action} bypasses factory and joins completion`, async (t) => {
    const f = await scripted(t);
    const { reader, completion } = claimed(t, f);
    reader[action]();
    assert.equal(reader.close(), completion);
    await assert.rejects(reader.ready);
    assert.deepEqual(f.state.events, []);
    assert.deepEqual(await completion, { complete: true });
    assert.ok(Object.isFrozen(await completion));
  });
}

test("scripted: claim starts only on microtask, captures inputs, retains root until close", async (t) => {
  const f = await scripted(t);
  const { reader, completion, status } = claimed(t, f);
  assert.deepEqual(f.state.events, []);
  f.workspace.id = "changed-after-capture";
  const access = await reader.ready;
  assert.equal(f.state.workspace.id, "resource-test");
  assert.ok(Object.isFrozen(f.state.workspace));
  assert.equal(f.state.options.checkRoot, f.owner.assertOpened);
  assert.ok(Object.isFrozen(access));
  assert.deepEqual(Object.keys(access).sort(), ["close", "list", "read"]);
  assert.equal(f.state.fds.size, 1);
  const page = Object.freeze({ length: 2 });
  const result = Object.freeze({ bytes: Buffer.from("ok") });
  f.state.result = result;
  f.state.onRead = (path, got) => {
    assert.equal(path, "note.txt");
    assert.equal(got, page);
  };
  assert.equal(access.read("note.txt", page), result);
  assert.equal(f.state.fds.size, 1);
  assert.equal(
    status.settled,
    false,
    "ready/read/consumer ACK cannot settle IO lifetime",
  );
  assert.equal(access.close(), completion);
  assert.equal(reader.close(), completion);
  assert.throws(() => access.read("note.txt"));
  assert.deepEqual(await completion, { complete: true });
  assert.equal(f.state.fds.size, 0);
  assert.equal(f.state.closeCalls, 1);
});

for (const action of ["cancel", "close"]) {
  test(`scripted: ${action} during pending factory waits for real ready and cleanup`, async (t) => {
    const f = await scripted(t);
    const gate = deferred();
    f.state.gate = gate.promise;
    const { reader, completion, status } = claimed(t, f);
    const rejected = assert.rejects(reader.ready);
    await Promise.resolve();
    assert.deepEqual(f.state.events, ["factory-enter"]);
    reader[action]();
    assert.equal(reader.close(), completion);
    assert.equal(
      status.settled,
      false,
      "cancel is not physical completion proof",
    );
    assert.throws(() => f.state.options.check());
    gate.resolve();
    await rejected;
    assert.deepEqual(await completion, { complete: true });
    assert.deepEqual(f.state.events, [
      "factory-enter",
      "factory-ready",
      "close",
    ]);
    assert.equal(f.state.fds.size, 0);
  });
}

for (const forgedError of [
  Object.assign(new Error("unsupported_runtime"), {
    complete: true,
    closed: true,
  }),
  Object.assign(new Error("native_permission_file_io_cancelled"), {
    complete: true,
  }),
]) {
  test(`scripted: constructor rejection cannot use fake proof: ${forgedError.message}`, async (t) => {
    const f = await scripted(t);
    f.state.factoryError = forgedError;
    const { reader, completion } = claimed(t, f);
    await assert.rejects(reader.ready, (error) => error === forgedError);
    assert.deepEqual(await completion, { complete: false });
    assert.equal(reader.close(), completion);
    assert.equal(f.state.closeCalls, 0);
  });
}

test("scripted: reentrant factory check cancellation is rejected before original acquisition", async (t) => {
  const f = await scripted(t);
  f.state.checkFactory = true;
  let reader;
  ({ reader } = claimed(t, f, () => reader.cancel()));
  await assert.rejects(reader.ready);
  assert.deepEqual(await reader.close(), { complete: false });
  assert.deepEqual(f.state.events, ["factory-enter"]);
  assert.equal(f.state.fds.size, 0);
});

for (const action of ["cancel", "close"]) {
  for (const lateFailure of [false, true]) {
    test(`scripted: reentrant read ${action}, late cleanup failure=${lateFailure}`, async (t) => {
      const f = await scripted(t);
      const { reader, completion, status } = claimed(t, f);
      const access = await reader.ready;
      f.state.failLateClose = lateFailure;
      f.state.onRead = () => {
        reader[action]();
        assert.equal(reader.close(), completion);
        assert.equal(access.close(), completion);
        assert.equal(
          status.settled,
          false,
          "original read still owns temporary FD",
        );
        assert.equal(
          f.state.fds.size,
          1,
          "root closed, original leaf still retained",
        );
        assert.throws(() => access.read("note.txt"));
        assert.equal(status.settled, false);
      };
      f.state.onFinally = () => {
        assert.equal(
          status.settled,
          false,
          "cannot publish before original finally exits",
        );
      };
      assert.throws(() => access.read("note.txt"));
      assert.deepEqual(await completion, { complete: !lateFailure });
      assert.deepEqual(f.state.events, [
        "factory-enter",
        "factory-ready",
        "read-enter",
        "close",
        "read-finally",
        "close",
      ]);
      assert.equal(f.state.fds.size, 0);
      assert.equal(reader.close(), completion);
      assert.throws(() => access.read("note.txt"));
    });
  }
}

test("scripted: read-check cancellation revokes before reentrant original read or IO", async (t) => {
  const f = await scripted(t);
  let armed = false;
  let access;
  const { reader, completion, status } = claimed(t, f, () => {
    if (!armed) return;
    reader.cancel();
    assert.equal(status.settled, false);
    assert.throws(() => access.read("note.txt"));
  });
  access = await reader.ready;
  armed = true;
  assert.throws(() => access.read("note.txt"));
  assert.deepEqual(await completion, { complete: true });
  assert.ok(!f.state.events.includes("read-enter"));
  assert.equal(f.state.fds.size, 0);
});

test("scripted: read failure alone leaves retained root and completion pending until close", async (t) => {
  const f = await scripted(t);
  const { reader, completion, status } = claimed(t, f);
  const access = await reader.ready;
  const error = new Error("scripted read failure");
  f.state.readError = error;
  assert.throws(
    () => access.read("note.txt"),
    (value) => value === error,
  );
  assert.equal(status.settled, false);
  assert.equal(f.state.fds.size, 1);
  assert.equal(reader.close(), completion);
  assert.deepEqual(await completion, { complete: true });
});

test("scripted: sticky close failure stays unverified and repeated closes join once", async (t) => {
  const f = await scripted(t);
  const { reader, completion } = claimed(t, f);
  const access = await reader.ready;
  f.state.failClose = true;
  f.state.onClose = () => assert.throws(() => access.read("note.txt"));
  assert.equal(access.close(), completion);
  f.state.failClose = false;
  reader.cancel();
  assert.equal(reader.close(), completion);
  assert.equal(access.close(), completion);
  assert.deepEqual(await completion, { complete: false });
  assert.equal(f.state.closeCalls, 1);
  assert.throws(() => access.read("note.txt"));
});

test("scripted: one-use claim rejects reuse before IO and throughout pending factory", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader, completion } = claimed(t, f);
  assert.throws(() => f.api.observeNativeDescriptorRead(reader.resource));
  assert.deepEqual(f.state.events, []);
  await Promise.resolve();
  assert.throws(() => f.api.observeNativeDescriptorRead(reader.resource));
  reader.cancel();
  gate.resolve();
  await assert.rejects(reader.ready);
  await completion;
  assert.throws(() => f.api.observeNativeDescriptorRead(reader.resource));
});

test("scripted: cancellation plus a rejecting pending factory cannot claim cleanup proof", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader, completion, status } = claimed(t, f);
  const rejected = assert.rejects(reader.ready);
  await Promise.resolve();
  reader.cancel();
  assert.equal(status.settled, false);
  gate.reject(
    Object.assign(new Error("fake closed constructor"), {
      complete: true,
      closed: true,
    }),
  );
  await rejected;
  assert.deepEqual(await completion, { complete: false });
  assert.deepEqual(f.state.events, ["factory-enter"]);
});

test("scripted: restored root name cannot revive the actual shared revoked guard", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader, completion } = claimed(t, f);
  const rejected = assert.rejects(reader.ready);
  await Promise.resolve();
  await io.rename(f.root, f.root + ".moved");
  await assert.rejects(f.owner.assertCurrent());
  await io.rename(f.root + ".moved", f.root);
  assert.equal(isWorkspaceRootGuard(f.owner.assertOpened), true);
  gate.resolve();
  await rejected;
  assert.deepEqual(await completion, { complete: false });
  assert.deepEqual(f.state.events, ["factory-enter"]);
  assert.equal(
    f.state.fds.size,
    0,
    "scripted acquisition cleans its actual test FD",
  );
});
