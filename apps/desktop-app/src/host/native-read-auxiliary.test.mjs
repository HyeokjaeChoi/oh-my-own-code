// Node-only contract tests. The copied resource and auxiliary keep production
// logic; only the kernel import is replaced. No Native/Bun/runtime evidence.
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as io from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";

const source = new URL("./", import.meta.url);
const refused = (run) => assert.rejects(async () => run());
const rows = (...names) => names.map((name) => ({ name, type: "file" }));
const up = (f, start = f.root) => ({
  targets: ["AGENTS.md"],
  start,
  stop: f.root,
});

async function scripted(t) {
  const parent = await io.realpath(
    await io.mkdtemp(join(tmpdir(), "omoc-aux-")),
  );
  const root = join(parent, "workspace");
  await io.mkdir(root);
  const workspace = { id: "auxiliary-test", path: root };
  const owner = await createWorkspaceRootAuthority(workspace);
  const host = join(parent, "host");
  await io.mkdir(host);
  await io.symlink(
    fileURLToPath(new URL("../renderer", source)),
    join(parent, "renderer"),
    "dir",
  );
  await io.symlink(
    fileURLToPath(new URL("workspace-root-authority.mjs", source)),
    join(host, "workspace-root-authority.mjs"),
  );
  const kernel = pathToFileURL(join(host, "scripted-kernel.mjs"));
  await io.writeFile(
    kernel,
    `import * as fs from "node:fs";
import { assertWorkspaceRootGuard } from ${JSON.stringify(new URL("workspace-root-authority.mjs", source).href)};
export const state = { events: [], rows: [], buffers: [], identity: Object.freeze({}), fds: new Set() };
export async function createNativeDescriptorReadKernel(workspace, options) {
  state.events.push(["factory"]);
  if (state.gate) await state.gate;
  const fd = fs.openSync(workspace.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  state.fds.add(fd);
  const stat = fs.fstatSync(fd, { bigint: true });
  try { assertWorkspaceRootGuard(options.checkRoot, { workspaceId: workspace.id, workspacePath: workspace.path, dev: String(stat.dev), ino: String(stat.ino) }); }
  catch (error) { fs.closeSync(fd); state.fds.delete(fd); throw error; }
  let closed = false;
  const check = () => { if (closed) throw Error("scripted closed"); options.check(); };
  const kernel = Object.freeze({
    list(path) {
      check(); state.events.push(["list", path]);
      const value = state.onList ? state.onList(path) : state.rows;
      check(); return value;
    },
    read(path, page) {
      check(); state.events.push(["read", path, { ...page }]);
      const value = state.onRead ? state.onRead(path, page) : { bytes: Buffer.from("synthetic"), info: { size: 9 }, identity: state.identity };
      state.buffers.push(value.bytes); check(); return value;
    },
    close() { if (!closed) { closed = true; fs.closeSync(fd); state.fds.delete(fd); } },
  });
  state.onFactoryReturn?.();
  return kernel;
}
`,
  );
  const { state } = await import(kernel.href);
  const original = await io.readFile(
    new URL("native-descriptor-read-resource.mjs", source),
    "utf8",
  );
  const needle = 'from "./native-descriptor-read.mjs"';
  assert.equal(original.split(needle).length, 2, "exactly one kernel import");
  const copy = original.replace(needle, 'from "./scripted-kernel.mjs"');
  assert.equal(copy.replace('from "./scripted-kernel.mjs"', needle), original);
  await io.writeFile(join(host, "native-descriptor-read-resource.mjs"), copy);
  // Unmodified auxiliary resolves the copied resource's private brand registry.
  await io.copyFile(
    new URL("native-read-auxiliary.mjs", source),
    join(host, "native-read-auxiliary.mjs"),
  );
  const api = await import(
    pathToFileURL(join(host, "native-descriptor-read-resource.mjs")).href
  );
  const aux = await import(
    pathToFileURL(join(host, "native-read-auxiliary.mjs")).href
  );
  const readers = [];
  const f = { root, parent, state, api, aux, owner, workspace };
  f.claim = (check = () => {}, claimed = true) => {
    const reader = api.createNativeDescriptorRead(workspace, {
      checkRoot: owner.assertOpened,
      check,
    });
    reader.ready.catch(() => {});
    if (claimed) api.observeNativeDescriptorRead(reader.resource);
    readers.push(reader);
    return reader;
  };
  t.after(async () => {
    for (const reader of readers) await reader.close();
    for (const fd of state.fds) fs.closeSync(fd);
    await owner.close();
    await io.rm(parent, { recursive: true, force: true });
  });
  f.open = (check) => {
    const reader = f.claim(check);
    return {
      reader,
      view: aux.createNativeReadAuxiliary(reader.resource, root),
    };
  };
  return f;
}

test("real brand, claimed one-use resource and canonical root containment reject before leaf IO", async (t) => {
  const f = await scripted(t);
  const unclaimed = f.claim(undefined, false);
  for (const resource of [
    {},
    Object.freeze(Object.create(null)),
    new Proxy(unclaimed.resource, {}),
    unclaimed.resource,
  ])
    assert.throws(() => f.aux.createNativeReadAuxiliary(resource, f.root));
  const { reader, view } = f.open();
  assert.throws(() => f.aux.createNativeReadAuxiliary(reader.resource, f.root));
  for (const value of [view, view.files, view.fs])
    assert.ok(Object.isFrozen(value));
  for (const path of [
    "relative",
    f.parent,
    f.root + "/../outside",
    f.root + "/./note",
    f.root + "/note/",
    f.root + "-sibling/note",
  ])
    for (const run of [
      () => view.files.read(path, { length: 1 }),
      () => view.files.list(path),
      () => view.fs.resolve(path),
      () => view.fs.readDirectory(path),
      () => view.fs.readFileStringSafe(path),
    ])
      await refused(run);
  await reader.ready;
  assert.deepEqual(f.state.events, [["factory"]]);
});

test("files and fs share FIFO serialization and detach caller range before dispatch", async (t) => {
  const f = await scripted(t);
  const gate = Promise.withResolvers();
  f.state.gate = gate.promise;
  const { view } = f.open();
  f.state.rows = rows("AGENTS.md");
  const page = { offset: 2, length: 1 };
  const first = view.files.read(join(f.root, "note"), page);
  const second = view.fs.readDirectory(f.root);
  const third = view.files.list(f.root);
  page.offset = 99;
  page.length = 99;
  gate.resolve();
  const values = await Promise.all([first, second, third]);
  assert.deepEqual(values[1], ["AGENTS.md"]);
  assert.ok(Object.isFrozen(values[1]));
  assert.deepEqual(
    f.state.events.map((e) => e[0]),
    ["factory", "read", "list", "list"],
  );
  assert.deepEqual(f.state.events[1][2], { offset: 2, length: 1 });
});

test("AGENTS text preserves BOM, erases bytes and charges four requested 64KiB reads", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  f.state.rows = rows("AGENTS.md");
  f.state.onRead = () => ({
    bytes: Buffer.from("\uFEFFsynthetic"),
    info: { size: 12 },
    identity: f.state.identity,
  });
  for (let i = 0; i < 4; i++) {
    assert.equal(
      await view.fs.readFileStringSafe(join(f.root, "AGENTS.md")),
      "\uFEFFsynthetic",
    );
    assert.ok(f.state.buffers.at(-1).every((byte) => byte === 0));
  }
  await refused(() => view.fs.readFileStringSafe(join(f.root, "AGENTS.md")));
  const reads = f.state.events.filter((e) => e[0] === "read");
  assert.equal(reads.length, 4);
  assert.ok(reads.every((e) => e[2].length === 64 * 1024));
});

test("post-return cancellation refuses file disclosure and erases the accepted buffer", async (t) => {
  const f = await scripted(t);
  const { reader, view } = f.open();
  const bytes = Buffer.from("secret-synthetic");
  f.state.onRead = () => {
    Promise.resolve().then(() => reader.cancel());
    return { bytes, info: { size: bytes.length }, identity: f.state.identity };
  };
  await refused(() => view.files.read(join(f.root, "note"), { length: 16 }));
  assert.deepEqual(bytes, Buffer.alloc(bytes.length));
  assert.deepEqual(await reader.close(), { complete: true });
});

test("authority loss between read resolution and disclosure rejects and erases bytes", async (t) => {
  const f = await scripted(t);
  let valid = true;
  const failure = new Error("synthetic authority lost");
  const { view } = f.open(() => {
    if (!valid) throw failure;
  });
  const bytes = Buffer.from("synthetic");
  f.state.onRead = () => {
    Promise.resolve().then(() => {
      valid = false;
    });
    return { bytes, info: { size: bytes.length }, identity: f.state.identity };
  };
  await assert.rejects(
    view.files.read(join(f.root, "note"), { length: 9 }),
    (error) => error === failure,
  );
  assert.deepEqual(bytes, Buffer.alloc(bytes.length));
});

test("resolve probes actual listed kind, clears one-byte probes and refuses missing or symlink entries", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  f.state.onList = (path) =>
    path === ""
      ? [
          { name: "note", type: "file" },
          { name: "sub", type: "directory" },
          { name: "link", type: "symlink" },
        ]
      : [];
  assert.equal(await view.fs.resolve(f.root), f.root);
  assert.equal(
    await view.fs.resolve(join(f.root, "note")),
    join(f.root, "note"),
  );
  assert.ok(f.state.buffers.at(-1).every((byte) => byte === 0));
  assert.equal(await view.fs.resolve(join(f.root, "sub")), join(f.root, "sub"));
  assert.deepEqual(
    f.state.events.filter((e) => e[0] !== "factory").map((e) => e.slice(0, 2)),
    [
      ["list", ""],
      ["list", ""],
      ["read", "note"],
      ["list", ""],
      ["list", "sub"],
    ],
  );
  assert.equal(f.state.events.find((e) => e[0] === "read")[2].length, 1);
  await refused(() => view.fs.resolve(join(f.root, "missing")));
  await refused(() => view.fs.resolve(join(f.root, "link")));
  assert.equal(f.state.events.filter((e) => e[0] === "read").length, 1);
});

test("up detaches exact AGENTS target, visits nested start through root and enforces depth32", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  f.state.rows = rows("AGENTS.md");
  const input = up(f, join(f.root, "a", "b"));
  const pending = view.fs.up(input);
  input.start = f.parent;
  input.stop = f.parent;
  input.targets[0] = "other";
  assert.deepEqual(await pending, [
    join(f.root, "a/b/AGENTS.md"),
    join(f.root, "a/AGENTS.md"),
    join(f.root, "AGENTS.md"),
  ]);
  assert.deepEqual(
    f.state.events.filter((e) => e[0] === "list").map((e) => e[1]),
    ["a/b", "a", ""],
  );
  f.state.rows = [];
  assert.deepEqual(
    await view.fs.up(up(f, join(f.root, ...Array(32).fill("d")))),
    [],
  );
  const before = f.state.events.length;
  await refused(() => view.fs.up(up(f, join(f.root, ...Array(33).fill("d")))));
  assert.equal(f.state.events.length, before);
});

test("closed up and range inputs reject getters and proxies without invoking traps or IO", async (t) => {
  const f = await scripted(t);
  const { reader, view } = f.open();
  await reader.ready;
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("input trap");
  };
  const proxy = (value) =>
    new Proxy(value, {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    });
  const getter = Object.defineProperty(up(f), "start", {
    enumerable: true,
    get: trap,
  });
  const targetsGetter = Object.defineProperty(["AGENTS.md"], "0", {
    get: trap,
  });
  for (const input of [
    proxy(up(f)),
    getter,
    { ...up(f), targets: proxy(["AGENTS.md"]) },
    { ...up(f), targets: targetsGetter },
    { ...up(f), extra: true },
    { ...up(f), targets: [] },
    { ...up(f), targets: ["*.md"] },
    { ...up(f), targets: ["AGENTS.md", "other"] },
    { ...up(f), stop: f.parent },
    { ...up(f), start: f.parent },
    Object.create(up(f)),
  ])
    await refused(() => view.fs.up(input));
  for (const page of [
    proxy({ length: 1 }),
    Object.defineProperty({}, "length", { enumerable: true, get: trap }),
    { identity: {} },
    { length: 0 },
    { offset: -1, length: 1 },
    { length: NaN },
  ])
    await refused(() => view.files.read(join(f.root, "note"), page));
  assert.equal(traps, 0);
  assert.deepEqual(f.state.events, [["factory"]]);
});

test("missing AGENTS is undefined; symlink and authority/list failures are never hidden", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  assert.equal(
    await view.fs.readFileStringSafe(join(f.root, "AGENTS.md")),
    undefined,
  );
  assert.deepEqual(await view.fs.up(up(f)), []);
  await refused(() => view.fs.readFileStringSafe(join(f.root, "other.md")));
  f.state.rows = [{ name: "AGENTS.md", type: "symlink" }];
  await refused(() => view.fs.readFileStringSafe(join(f.root, "AGENTS.md")));
  await refused(() => view.fs.up(up(f)));
  const error = new Error("synthetic authority/list failure");
  f.state.onList = () => {
    throw error;
  };
  await assert.rejects(
    view.fs.readFileStringSafe(join(f.root, "AGENTS.md")),
    (got) => got === error,
  );
  assert.equal(f.state.events.filter((e) => e[0] === "read").length, 0);
});

test("instruction exact cap, fatal UTF8 and oversized/incomplete bytes erase buffers; failures charge budget", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  f.state.rows = rows("AGENTS.md");
  const cases = [
    { bytes: Buffer.alloc(65536, 97), size: 65536, success: true },
    { bytes: Buffer.from([0xc3, 0x28]), size: 2 },
    { bytes: Buffer.alloc(65536, 98), size: 65537 },
    { bytes: Buffer.from("short"), size: 6 },
  ];
  for (const entry of cases) {
    f.state.onRead = () => ({
      bytes: entry.bytes,
      info: { size: entry.size },
      identity: f.state.identity,
    });
    const run = () => view.fs.readFileStringSafe(join(f.root, "AGENTS.md"));
    if (entry.success) assert.equal((await run()).length, 65536);
    else await refused(run);
    assert.ok(entry.bytes.every((byte) => byte === 0));
  }
  await refused(() => view.fs.readFileStringSafe(join(f.root, "AGENTS.md")));
  assert.equal(
    f.state.buffers.length,
    4,
    "failed reads also reserve requested 64KiB",
  );
});

test("shared pending queue admits32, rejects overflow before IO and cancels all queued work", async (t) => {
  const f = await scripted(t);
  const gate = Promise.withResolvers();
  f.state.gate = gate.promise;
  const { reader, view } = f.open();
  const pending = Array.from({ length: 32 }, (_, i) =>
    i % 2
      ? view.fs.readDirectory(f.root)
      : view.files.read(join(f.root, "note"), { length: 1 }),
  );
  const joined = Promise.allSettled(pending);
  await refused(() => view.files.list(f.root));
  reader.cancel();
  gate.resolve();
  assert.ok((await joined).every((result) => result.status === "rejected"));
  assert.equal(
    f.state.events.some((e) => e[0] === "read" || e[0] === "list"),
    false,
  );
  assert.deepEqual(await reader.close(), { complete: true });
});

test("post-return list cancellation prevents every fs/list disclosure and further ancestor IO", async (t) => {
  for (const method of [
    "list",
    "readDirectory",
    "resolve",
    "up",
    "readFileStringSafe",
  ]) {
    const f = await scripted(t);
    const { reader, view } = f.open();
    f.state.onList = () => {
      Promise.resolve().then(() => reader.cancel());
      return rows("AGENTS.md");
    };
    await refused(() =>
      method === "list"
        ? view.files.list(f.root)
        : method === "up"
          ? view.fs.up(up(f, join(f.root, "a")))
          : view.fs[method](
              method === "readFileStringSafe"
                ? join(f.root, "AGENTS.md")
                : f.root,
            ),
    );
    assert.equal(f.state.events.filter((e) => e[0] === "list").length, 1);
    assert.equal(f.state.buffers.length, 0);
  }
});

test("factory-return cancellation and instruction-read cancellation cannot disclose success", async (t) => {
  const f = await scripted(t);
  const { reader, view } = f.open();
  f.state.onFactoryReturn = () => {
    Promise.resolve().then(() => reader.cancel());
  };
  await refused(() => view.files.list(f.root));
  assert.equal(
    f.state.events.some((e) => e[0] === "list"),
    false,
  );
  const g = await scripted(t);
  const opened = g.open();
  g.state.rows = rows("AGENTS.md");
  g.state.onRead = () => {
    Promise.resolve().then(() => opened.reader.cancel());
    return {
      bytes: Buffer.from("synthetic"),
      info: { size: 9 },
      identity: g.state.identity,
    };
  };
  await refused(() =>
    opened.view.fs.readFileStringSafe(join(g.root, "AGENTS.md")),
  );
  assert.ok(g.state.buffers[0].every((byte) => byte === 0));
});

test("mismatched sibling root cannot rebase the genuine resource or perform leaf IO", async (t) => {
  const f = await scripted(t);
  const reader = f.claim();
  const wrong = join(f.parent, "other");
  const view = f.aux.createNativeReadAuxiliary(reader.resource, wrong);
  await refused(() => view.files.list(wrong));
  await refused(() => view.fs.resolve(wrong));
  await refused(() => view.files.read(join(f.root, "note"), { length: 1 }));
  assert.deepEqual(f.state.events, [["factory"]]);
});

test("public mixed call budget256, underlying multi-step call budget256 and byte/row budgets remain bounded", async (t) => {
  const f = await scripted(t);
  const { view } = f.open();
  for (let i = 0; i < 256; i++)
    await (i % 2 ? view.files.list(f.root) : view.fs.readDirectory(f.root));
  await refused(() => view.files.list(f.root));
  assert.equal(f.state.events.filter((e) => e[0] === "list").length, 256);
  const g = await scripted(t);
  const second = g.open().view;
  g.state.rows = rows("note");
  for (let i = 0; i < 128; i++) await second.fs.resolve(join(g.root, "note"));
  await refused(() => second.fs.resolve(join(g.root, "note")));
  assert.equal(g.state.events.filter((e) => e[0] !== "factory").length, 256);
  const h = await scripted(t);
  const third = h.open().view;
  h.state.onRead = () => ({
    bytes: Buffer.alloc(0),
    info: { size: 0 },
    identity: h.state.identity,
  });
  await third.files.read(join(h.root, "note"), { length: 20 * 1024 * 1024 });
  await third.files.read(join(h.root, "note"), { length: 12 * 1024 * 1024 });
  await refused(() => third.files.read(join(h.root, "note"), { length: 1 }));
  h.state.rows = Array.from({ length: 4096 }, (_, i) => ({
    name: `synthetic-${i}`,
    type: "file",
  }));
  await third.files.list(h.root);
  await third.fs.readDirectory(h.root);
  h.state.rows = rows("excess");
  await refused(() => third.files.list(h.root));
  assert.equal(h.state.events.filter((e) => e[0] === "read").length, 2);
});
