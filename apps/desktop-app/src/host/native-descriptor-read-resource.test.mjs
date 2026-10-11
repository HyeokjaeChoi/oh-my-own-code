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

test("scripted: Native whole-read meaning cannot change while ready is pending", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const bytes = Buffer.from("x");
  f.state.result = {
    bytes,
    info: { size: 20 * 1024 * 1024 + 1 },
    identity: Object.freeze({}),
  };
  const page = {};
  const pending = files.read(join(f.root, "note.txt"), page);
  page.length = 1;
  gate.resolve();
  await assert.rejects(pending);
  assert.deepEqual(bytes, Buffer.from([0]));
  await reader.close();
});

test("scripted: Native range is detached and concurrent dispatch refuses", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const pages = [];
  f.state.onRead = (path, page) => pages.push({ ...page });
  f.state.result = {
    bytes: Buffer.from("abcd"),
    info: { size: 4 },
    identity: Object.freeze({}),
  };
  const page = { offset: 0, length: 4 };
  const pending = files.read(join(f.root, "note.txt"), page);
  page.offset = 100;
  page.length = 1;
  await assert.rejects(files.read(join(f.root, "note.txt"), { length: 1 }));
  gate.resolve();
  await pending;
  assert.deepEqual(pages, [{ offset: 0, length: 4 }]);
  await reader.close();
});

test("scripted: Native post-read cancellation erases undisclosed bytes", async (t) => {
  const f = await scripted(t);
  const { reader, completion } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const bytes = Buffer.from("abcd");
  f.state.result = { bytes, info: { size: 4 }, identity: Object.freeze({}) };
  f.state.onFinally = () => reader.cancel();
  await assert.rejects(files.read(join(f.root, "note.txt"), { length: 4 }));
  assert.deepEqual(bytes, Buffer.alloc(4));
  assert.deepEqual(await completion, { complete: true });
});

test("scripted: Native files view preserves original identity for whole reread", async (t) => {
  const f = await scripted(t);
  const { reader, completion } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  assert.throws(() => f.api.createNativeDescriptorFiles(reader.resource));
  const identity = Object.freeze({});
  f.state.result = { bytes: Buffer.from("abcd"), info: { size: 4 }, identity };
  const pages = [];
  f.state.onRead = (path, page) => pages.push({ path, ...page });
  const first = await files.read(join(f.root, "note.txt"), {
    offset: 0,
    length: 4,
  });
  const whole = await files.read(join(f.root, "note.txt"));
  assert.equal(first.bytes.toString(), "abcd");
  assert.equal(whole.bytes.toString(), "abcd");
  assert.ok(!Object.hasOwn(first, "identity"));
  assert.deepEqual(pages, [
    { path: "note.txt", offset: 0, length: 4 },
    { path: "note.txt", offset: 0, length: 20 * 1024 * 1024, identity },
  ]);
  await reader.close();
  assert.deepEqual(await completion, { complete: true });
});

test("scripted: Native files scope and range refuse before actual read", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  let calls = 0,
    traps = 0;
  f.state.onRead = () => calls++;
  const getter = Object.defineProperty({}, "offset", {
    enumerable: true,
    get() {
      traps++;
      return 0;
    },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        traps++;
        return [];
      },
    },
  );
  for (const target of [
    "note.txt",
    join(f.root, "../outside"),
    f.root + "/./note.txt",
    f.root + "-sibling/note.txt",
  ])
    await assert.rejects(files.read(target));
  for (const range of [
    getter,
    proxy,
    { identity: {} },
    { length: 0 },
    { offset: -1 },
    { length: 20 * 1024 * 1024 + 1 },
    { offset: 0, extra: true },
  ])
    await assert.rejects(files.read(join(f.root, "note.txt"), range));
  assert.equal(calls, 0);
  assert.equal(traps, 0);
  await reader.close();
});

test("scripted: Native files accepts only a claimed one-use genuine resource without traps", async (t) => {
  const f = await scripted(t);
  const reader = f.api.createNativeDescriptorRead(f.workspace, f.options);
  let traps = 0;
  const trap = () => {
    traps++;
    throw new Error("input trap");
  };
  const getter = Object.defineProperty({}, "resource", { get: trap });
  const proxy = new Proxy(reader.resource, {
    get: trap,
    ownKeys: trap,
    getPrototypeOf: trap,
  });
  for (const resource of [
    undefined,
    null,
    1,
    {},
    reader,
    getter,
    proxy,
    { ...reader.resource },
    Object.create(reader.resource),
    reader.resource,
  ]) {
    assert.throws(() => f.api.createNativeDescriptorFiles(resource));
  }
  assert.deepEqual(f.state.events, []);
  const completion = f.api.observeNativeDescriptorRead(reader.resource);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  assert.ok(Object.isFrozen(files));
  assert.deepEqual(Object.keys(files).sort(), ["list", "read"]);
  assert.throws(() => f.api.createNativeDescriptorFiles(reader.resource));
  reader.cancel();
  await assert.rejects(reader.ready);
  await assert.rejects(files.list(f.root));
  await assert.rejects(files.read(join(f.root, "note.txt"), { length: 1 }));
  assert.throws(() => f.api.createNativeDescriptorFiles(reader.resource));
  assert.deepEqual(await completion, { complete: true });
  assert.deepEqual(f.state.events, []);
  assert.equal(traps, 0);
});

test("scripted: Native path coercion and range prototypes cannot execute caller traps", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  let traps = 0;
  const trap = () => {
    traps++;
    throw new Error("input trap");
  };
  const path = { [Symbol.toPrimitive]: trap, toString: trap };
  const proxy = new Proxy(
    {},
    {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    },
  );
  for (const target of [path, proxy, new String(join(f.root, "note.txt"))]) {
    await assert.rejects(files.read(target, { length: 1 }));
    await assert.rejects(files.list(target));
  }
  const inherited = Object.create({
    get length() {
      return trap();
    },
  });
  for (const page of [
    inherited,
    Object.assign(Object.create(null), { length: 1 }),
    Object.defineProperty({}, "length", { get: trap }),
    { [Symbol("extra")]: 1 },
    { offset: Number.MAX_SAFE_INTEGER + 1, length: 1 },
    { length: NaN },
    { length: Infinity },
  ]) {
    await assert.rejects(files.read(join(f.root, "note.txt"), page));
  }
  await reader.ready;
  assert.equal(traps, 0);
  assert.ok(!f.state.events.includes("read-enter"));
  assert.ok(!f.state.events.includes("list-enter"));
  await reader.close();
});

for (const distinctPaths of [false, true]) {
  test(`scripted: Native mixed call budget stops at 256; distinct paths=${distinctPaths}`, async (t) => {
    const f = await scripted(t);
    const { reader } = claimed(t, f);
    const files = f.api.createNativeDescriptorFiles(reader.resource);
    f.state.result = {
      bytes: Buffer.from("x"),
      info: { size: 1 },
      identity: Object.freeze({}),
    };
    f.state.listResult = [];
    for (let i = 0; i < 256; i++) {
      const leaf = distinctPaths ? `entry-${i}` : "note.txt";
      const absolute = join(f.root, leaf);
      if (distinctPaths) {
        if (i % 2) await io.mkdir(absolute);
        else await io.writeFile(absolute, "x");
      }
      if (i % 2) await files.list(distinctPaths ? absolute : f.root);
      else await files.read(absolute, { length: 1 });
    }
    const dispatched = () =>
      f.state.events.filter(
        (event) => event === "read-enter" || event === "list-enter",
      ).length;
    assert.equal(dispatched(), 256);
    await assert.rejects(files.read(join(f.root, "note.txt"), { length: 1 }));
    await assert.rejects(files.list(f.root));
    assert.equal(dispatched(), 256);
    await reader.close();
  });
}

test("scripted: Native requested-byte budget charges requested sizes even for empty results", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  f.state.result = {
    bytes: Buffer.alloc(0),
    info: { size: 0 },
    identity: Object.freeze({}),
  };
  f.state.listResult = [];
  await files.read(join(f.root, "note.txt"), { length: 20 * 1024 * 1024 });
  await files.read(join(f.root, "note.txt"), { length: 12 * 1024 * 1024 });
  await assert.rejects(files.read(join(f.root, "note.txt"), { length: 1 }));
  assert.equal(
    f.state.events.filter((event) => event === "read-enter").length,
    2,
  );
  assert.deepEqual(await files.list(f.root), []);
  await reader.close();
});

test("scripted: Native failed reads retain requested-byte charges", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const failure = new Error("scripted read refusal");
  f.state.readError = failure;
  await assert.rejects(
    files.read(join(f.root, "note.txt"), { length: 20 * 1024 * 1024 }),
    (error) => error === failure,
  );
  f.state.readError = undefined;
  f.state.result = {
    bytes: Buffer.alloc(0),
    info: { size: 0 },
    identity: Object.freeze({}),
  };
  await files.read(join(f.root, "note.txt"), { length: 12 * 1024 * 1024 });
  await assert.rejects(files.read(join(f.root, "note.txt"), { length: 1 }));
  assert.equal(
    f.state.events.filter((event) => event === "read-enter").length,
    2,
  );
  await reader.close();
});

test("scripted: Native directory row budget aggregates across calls and paths", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  await io.mkdir(join(f.root, "directory"));
  const rows = Object.freeze(
    Array.from({ length: 4096 }, (_, i) =>
      Object.freeze({ name: `row-${i}`, type: "file" }),
    ),
  );
  f.state.listResult = rows;
  assert.equal(await files.list(f.root), rows);
  assert.equal(await files.list(join(f.root, "directory")), rows);
  f.state.listResult = Object.freeze([
    Object.freeze({ name: "excess", type: "file" }),
  ]);
  await assert.rejects(files.list(f.root));
  await assert.rejects(files.list(join(f.root, "directory")));
  await reader.close();
});

for (const method of ["read", "list"]) {
  test(`scripted: Native queued ${method} cancellation dispatches no leaf operation`, async (t) => {
    const f = await scripted(t);
    const gate = deferred();
    f.state.gate = gate.promise;
    const { reader, completion, status } = claimed(t, f);
    const files = f.api.createNativeDescriptorFiles(reader.resource);
    const pending =
      method === "read"
        ? files.read(join(f.root, "note.txt"), { length: 1 })
        : files.list(f.root);
    const rejection = assert.rejects(pending);
    await Promise.resolve();
    assert.deepEqual(f.state.events, ["factory-enter"]);
    reader.cancel();
    assert.equal(status.settled, false);
    gate.resolve();
    await rejection;
    assert.deepEqual(await completion, { complete: true });
    assert.deepEqual(f.state.events, [
      "factory-enter",
      "factory-ready",
      "close",
    ]);
    assert.equal(f.state.fds.size, 0);
  });
}

test("scripted: Native list refuses rows when cancellation occurs in original finally", async (t) => {
  const f = await scripted(t);
  const { reader, completion } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  f.state.listResult = [{ name: "undisclosed", type: "file" }];
  f.state.onFinally = () => reader.cancel();
  await assert.rejects(files.list(f.root));
  assert.deepEqual(await completion, { complete: true });
});

test("scripted: Native queued files read cannot revive a moved then restored root guard", async (t) => {
  const f = await scripted(t);
  const gate = deferred();
  f.state.gate = gate.promise;
  const { reader, completion } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const rejection = assert.rejects(
    files.read(join(f.root, "note.txt"), { length: 1 }),
  );
  await Promise.resolve();
  await io.rename(f.root, f.root + ".moved");
  await assert.rejects(f.owner.assertCurrent());
  await io.rename(f.root + ".moved", f.root);
  gate.resolve();
  await rejection;
  assert.deepEqual(await completion, { complete: false });
  assert.deepEqual(f.state.events, ["factory-enter"]);
  assert.equal(f.state.fds.size, 0);
});

test("scripted: Native replacement refusal retains original per-path opaque identity", async (t) => {
  const f = await scripted(t);
  const { reader } = claimed(t, f);
  const files = f.api.createNativeDescriptorFiles(reader.resource);
  const original = Object.freeze(Object.create(null));
  const other = Object.freeze(Object.create(null));
  const replacement = Object.freeze(Object.create(null));
  const seen = [];
  let rejectReplacement = false;
  f.state.onRead = (path, page) => {
    seen.push({ path, ...page });
    if (rejectReplacement && path === "note.txt") {
      assert.equal(page.identity, original);
      throw new Error("scripted changed identity");
    }
  };
  f.state.result = {
    bytes: Buffer.from("a"),
    info: { size: 1 },
    identity: original,
  };
  await files.read(join(f.root, "note.txt"), { length: 1 });
  await io.writeFile(join(f.root, "other.txt"), "b");
  f.state.result = {
    bytes: Buffer.from("b"),
    info: { size: 1 },
    identity: other,
  };
  await files.read(join(f.root, "other.txt"), { length: 1 });
  await io.rename(join(f.root, "note.txt"), join(f.root, "old.txt"));
  await io.writeFile(join(f.root, "note.txt"), "replacement");
  rejectReplacement = true;
  f.state.result = {
    bytes: Buffer.from("replacement"),
    info: { size: 11 },
    identity: replacement,
  };
  await assert.rejects(
    files.read(join(f.root, "note.txt"), { offset: 1, length: 1 }),
    /scripted changed identity/,
  );
  await assert.rejects(
    files.read(join(f.root, "note.txt")),
    /scripted changed identity/,
  );
  rejectReplacement = false;
  await io.rm(join(f.root, "note.txt"));
  await io.rename(join(f.root, "old.txt"), join(f.root, "note.txt"));
  f.state.result = {
    bytes: Buffer.from("a"),
    info: { size: 1 },
    identity: original,
  };
  await files.read(join(f.root, "note.txt"), { length: 1 });
  f.state.result = {
    bytes: Buffer.from("b"),
    info: { size: 1 },
    identity: other,
  };
  await files.read(join(f.root, "other.txt"), { length: 1 });
  assert.ok(!Object.hasOwn(seen[0], "identity"));
  assert.ok(!Object.hasOwn(seen[1], "identity"));
  for (const page of seen.slice(2, 5)) assert.equal(page.identity, original);
  assert.equal(seen[5].identity, other);
  await reader.close();
});

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
