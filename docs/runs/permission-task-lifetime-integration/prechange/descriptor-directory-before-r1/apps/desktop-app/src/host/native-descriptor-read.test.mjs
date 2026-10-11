// Node-only behavioral tests. Synthetic openat below is pathname emulation,
// not Darwin confinement, Native permission, or IO-task settlement evidence.
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as io from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";

const sourceURL = new URL("./native-descriptor-read.mjs", import.meta.url);
const load = () => import(sourceURL.href);
const MiB = 1024 * 1024;

test("synthetic: observed root replacement permanently revokes kernel and shared root guard after restoration", async (t) => {
  const f = await synthetic(t);
  const moved = join(f.parent, "moved-root");
  fs.renameSync(f.root, moved);
  fs.mkdirSync(f.root);
  assert.throws(() => f.kernel.read("nested/note.txt"));
  fs.rmdirSync(f.root);
  fs.renameSync(moved, f.root);
  assert.throws(
    () => f.kernel.read("nested/note.txt"),
    undefined,
    "restoring the original object must not revive the existing kernel",
  );
  const stat = fs.statSync(f.root, { bigint: true });
  assert.throws(
    () =>
      f.owner.assertOpened({
        workspaceId: f.workspace.id,
        workspacePath: f.root,
        dev: String(stat.dev),
        ino: String(stat.ino),
      }),
    undefined,
    "the same shared root guard must not authorize another kernel",
  );
  await assert.rejects(f.owner.assertCurrent());
});

async function rootFixture(t) {
  const parent = await io.realpath(
    await io.mkdtemp(join(tmpdir(), "omoc-descriptor-test-")),
  );
  const root = join(parent, "root");
  await io.mkdir(root);
  await io.mkdir(join(root, "nested"));
  await io.writeFile(join(root, "nested", "note.txt"), "abcdefghij");
  await io.writeFile(join(root, "other.txt"), "other");
  const workspace = { id: "descriptor-test", path: root };
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(async () => {
    await owner.close();
    await io.rm(parent, { recursive: true, force: true });
  });
  return { parent, root, workspace, owner };
}

test("real module refuses Node before invoking the authority callback", async (t) => {
  assert.equal(globalThis.Bun, undefined, "Run this file with Node only");
  const { createNativeDescriptorReadKernel } = await load();
  const { workspace, owner } = await rootFixture(t);
  let calls = 0;
  await assert.rejects(
    createNativeDescriptorReadKernel(workspace, {
      checkRoot: owner.assertOpened,
      check() {
        calls++;
      },
    }),
    /unsupported_runtime/,
  );
  assert.equal(calls, 0);
});

test("factory accepts only exact data objects and a real root guard with a synchronous check", async (t) => {
  const { createNativeDescriptorReadKernel: create } = await load();
  const { workspace, owner } = await rootFixture(t);
  const options = { checkRoot: owner.assertOpened, check() {} };
  let traps = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        traps++;
        throw new Error("proxy trap");
      },
      ownKeys() {
        traps++;
        throw new Error("proxy trap");
      },
      getPrototypeOf() {
        traps++;
        throw new Error("proxy trap");
      },
    },
  );
  const getter = Object.defineProperty({ path: workspace.path }, "id", {
    enumerable: true,
    get() {
      traps++;
      return workspace.id;
    },
  });
  for (const value of [
    null,
    [],
    proxy,
    getter,
    Object.create(workspace),
    { ...workspace, extra: true },
    { id: workspace.id },
    { ...workspace, id: "" },
    { ...workspace, path: workspace.path + "/.." },
  ]) {
    await assert.rejects(create(value, options), /invalid_request/);
  }
  for (const value of [
    undefined,
    null,
    [],
    proxy,
    {},
    { check: options.check },
    { checkRoot: owner.assertOpened },
    { ...options, io: fs },
    { ...options, checkRoot() {} },
    { ...options, check: async () => {} },
    { ...options, check: function* () {} },
    { ...options, check: async function* () {} },
    { ...options, check: new Proxy(() => {}, {}) },
  ]) {
    await assert.rejects(create(workspace, value), /invalid_request/);
  }
  assert.equal(traps, 0, "capture must not execute accessors or Proxy traps");
});

async function synthetic(t, check = () => {}, configure = () => {}) {
  const fixture = await rootFixture(t);
  const directory = join(fixture.parent, "adapter");
  await io.mkdir(directory);
  const stateURL = pathToFileURL(join(directory, "state.mjs"));
  await io.writeFile(
    stateURL,
    `export const state = { events: [], fds: new Map(), hook: undefined, errno: new Int32Array(1), libraryClosed: false };
state.emit = (op, data = {}) => { const event = { op, ...data }; state.events.push(event); state.hook?.(event); };
`,
  );
  const { state } = await import(stateURL.href);
  state.allowedRoot = fixture.root;
  configure(state);
  await io.writeFile(
    join(directory, "fs.mjs"),
    `
import * as actual from "node:fs";
import { state } from "./state.mjs";
export const constants = actual.constants;
export function openSync(path, flags) {
  if (path !== state.allowedRoot) throw new Error("synthetic absolute child open forbidden");
  const fd = actual.openSync(path, flags & ~0x1000000);
  state.fds.set(fd, path); state.emit("openRoot", { fd, path, flags }); return fd;
}
export function fstatSync(fd, options) { const value = actual.fstatSync(fd, options); state.emit("fstat", { fd, path: state.fds.get(fd) }); return state.statOverride?.(state.fds.get(fd), value) ?? value; }
export function lstatSync(path, options) { const value = actual.lstatSync(path, options); state.emit("lstat", { path }); return state.statOverride?.(path, value) ?? value; }
export function realpathSync(path) { const value = actual.realpathSync(path); state.emit("realpath", { path }); return value; }
export function readSync(fd, bytes, offset, length, position) {
  state.emit("beforeRead", { fd, bytes, path: state.fds.get(fd) });
  if (state.readError) throw state.readError;
  const got = actual.readSync(fd, bytes, offset, state.shortRead ? Math.min(length, 2) : length, position);
  state.emit("read", { fd, bytes, got }); return state.zeroRead ? 0 : got;
}
export function closeSync(fd) {
  const path = state.fds.get(fd);
  state.emit("beforeClose", { fd, path });
  if (state.failBeforeClose?.(path)) throw new Error("synthetic close failure before cleanup");
  actual.closeSync(fd); state.fds.delete(fd);
  state.emit("close", { fd, path });
  if (state.failClose?.(path)) throw new Error("synthetic close failure after actual cleanup");
}
`,
  );
  await io.writeFile(
    join(directory, "ffi.mjs"),
    `
import * as actual from "node:fs";
import { join } from "node:path";
import { state } from "./state.mjs";
import { openDarwinDescriptorFFI as realLoader } from ${JSON.stringify(new URL("./darwin-descriptor-ffi.mjs", import.meta.url).href)};
export async function openDarwinDescriptorFFI() {
  state.emit("ffi");
  if (state.useRealLoader) return realLoader();
  return {
    ptr: value => value,
    toArrayBuffer: () => state.errno.buffer,
    library: {
      close() { state.libraryClosed = true; state.emit("libraryClose"); if (state.failLibraryClose) throw new Error("synthetic library close failure"); },
      symbols: {
        __error: () => state.errno,
        openat(parent, name, flags, ...mode) {
          const part = name.toString("utf8").replace(/\\0$/, "");
          if (!state.fds.has(parent) || !part || part.includes("/") || part === "." || part === "..") throw new Error("bad synthetic openat");
          const path = join(state.fds.get(parent), part);
          state.emit("openat", { parent, path, flags, mode });
          try {
            const fd = actual.openSync(path, flags & ~0x1000000);
            state.fds.set(fd, path); state.emit("openedChild", { fd, path }); return fd;
          } catch (error) { state.errno[0] = error.code === "ENOENT" ? 2 : error.code === "EACCES" ? 13 : 40; return -1; }
        },
      },
    },
  };
}
`,
  );
  // Rebase unchanged relative imports. The only substituted dependencies are
  // node:fs and the FFI loader; production code and root guard stay unchanged.
  const source = await io.readFile(sourceURL, "utf8");
  const copy = source.replace(
    /from\s+(["'])([^"']+)\1/g,
    (match, quote, specifier) => {
      if (specifier === "node:fs") return `from "./fs.mjs"`;
      if (specifier === "./darwin-descriptor-ffi.mjs")
        return `from "./ffi.mjs"`;
      if (specifier.startsWith("."))
        return `from ${JSON.stringify(new URL(specifier, sourceURL).href)}`;
      return match;
    },
  );
  const copyURL = pathToFileURL(join(directory, "kernel.mjs"));
  await io.writeFile(copyURL, copy);
  const { createNativeDescriptorReadKernel: create } = await import(
    copyURL.href
  );
  let kernel;
  t.after(() => {
    // Force actual synthetic resource cleanup even when the tested close fails.
    state.hook = undefined;
    state.failClose = undefined;
    state.failBeforeClose = undefined;
    state.failLibraryClose = false;
    try {
      kernel?.close();
    } catch {
      // Failure cases deliberately leave the kernel permanently revoked.
    }
    for (const fd of state.fds.keys()) fs.closeSync(fd);
    state.fds.clear();
  });
  kernel = await create(fixture.workspace, {
    checkRoot: fixture.owner.assertOpened,
    check: () => check(state, fixture),
  });
  return { ...fixture, state, kernel, create };
}

function onlyRoot(f) {
  assert.deepEqual(
    [...f.state.fds.values()],
    [f.root],
    "all temporary FDs must be closed",
  );
}
function refused(f, action, pattern) {
  const buffers = [];
  f.state.hook = (event) => {
    if (event.op === "read") buffers.push(event.bytes);
  };
  assert.throws(action, pattern);
  onlyRoot(f);
  for (const bytes of buffers)
    assert.ok(
      bytes.every((value) => value === 0),
      "undisclosed bytes must be erased",
    );
  f.state.hook = undefined;
}

test("synthetic: frozen synchronous paged reads retain the root and use only relative child opens", async (t) => {
  const f = await synthetic(t);
  const { kernel, state } = f;
  assert.ok(Object.isFrozen(kernel));
  assert.deepEqual(Object.keys(kernel).sort(), ["close", "read"]);
  state.shortRead = true;
  const first = kernel.read("nested/note.txt", { length: 4 });
  assert.ok(!(first instanceof Promise));
  assert.equal(first.bytes.toString(), "abcd");
  assert.ok(Buffer.isBuffer(first.bytes));
  assert.deepEqual(first.info, { size: 10 });
  for (const object of [first, first.info, first.identity])
    assert.ok(Object.isFrozen(object));
  assert.deepEqual(
    Reflect.ownKeys(first.identity),
    [],
    "token must not disclose stat or paths",
  );
  const next = kernel.read("nested/note.txt", {
    offset: 4,
    length: 20 * MiB,
    identity: first.identity,
  });
  assert.equal(next.bytes.toString(), "efghij");
  assert.equal(next.identity, first.identity);
  assert.equal(
    kernel.read("nested/note.txt", { offset: Number.MAX_SAFE_INTEGER }).bytes
      .length,
    0,
  );
  onlyRoot(f);
  const opens = state.events.filter((event) => event.op === "openat");
  assert.ok(opens.length >= 2);
  for (const event of opens) {
    for (const flag of [
      fs.constants.O_NOFOLLOW,
      fs.constants.O_NONBLOCK,
      0x1000000,
    ])
      assert.equal(event.flags & flag, flag);
    assert.deepEqual(event.mode, [0, 0, 0, 0, 0, 0]);
  }
  assert.equal(kernel.close(), undefined);
  assert.equal(state.fds.size, 0);
  assert.equal(state.libraryClosed, true);
  assert.equal(kernel.close(), undefined);
  assert.throws(() => kernel.read("other.txt"));
});

test("synthetic: default page is 256 KiB; empty files and exact 20 MiB bound work", async (t) => {
  const f = await synthetic(t);
  fs.writeFileSync(
    join(f.root, "large.bin"),
    Buffer.alloc(256 * 1024 + 17, 65),
  );
  fs.writeFileSync(join(f.root, "empty.txt"), "");
  const page = f.kernel.read("large.bin");
  assert.equal(page.bytes.length, 256 * 1024);
  assert.equal(page.info.size, 256 * 1024 + 17);
  assert.equal(
    f.kernel.read("large.bin", { offset: 256 * 1024, identity: page.identity })
      .bytes.length,
    17,
  );
  assert.equal(
    f.kernel.read("empty.txt", { length: 20 * MiB }).bytes.length,
    0,
  );
  onlyRoot(f);
});

test("synthetic: lexical path and closed page validation reject without child IO or getter execution", async (t) => {
  const f = await synthetic(t);
  let traps = 0;
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
        throw Error("trap");
      },
      getPrototypeOf() {
        traps++;
        throw Error("trap");
      },
    },
  );
  const before = f.state.events.length;
  for (const path of [
    "",
    "/other.txt",
    "../other.txt",
    "nested/../other.txt",
    "nested//note.txt",
    "a\\b",
    "a\0b",
    "CON",
    "note.txt ",
    "x/",
  ])
    assert.throws(() => f.kernel.read(path));
  for (const page of [
    null,
    [],
    getter,
    proxy,
    { extra: true },
    { offset: -1 },
    { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { offset: NaN },
    { offset: Infinity },
    { offset: "0" },
    { length: 0 },
    { length: -1 },
    { length: 1.5 },
    { length: 20 * MiB + 1 },
    { length: Infinity },
    { length: "1" },
    { identity: {} },
    { identity: null },
  ])
    assert.throws(() => f.kernel.read("other.txt", page));
  assert.equal(traps, 0);
  assert.equal(f.state.events.length, before);
  onlyRoot(f);
  // Lexical validation deliberately allows this name; the fixture is synthetic.
  fs.writeFileSync(join(f.root, ".env"), "synthetic");
  assert.equal(f.kernel.read(".env").bytes.toString(), "synthetic");
});

test("synthetic: issued tokens bind the original object, kernel, path and full file stat", async (t) => {
  const f = await synthetic(t);
  const other = await synthetic(t);
  const page = f.kernel.read("nested/note.txt", { length: 2 });
  for (const token of [
    {},
    { ...page.identity },
    Object.freeze({}),
    other.kernel.read("nested/note.txt").identity,
  ])
    assert.throws(() => f.kernel.read("nested/note.txt", { identity: token }));
  assert.throws(() => f.kernel.read("other.txt", { identity: page.identity }));
  fs.writeFileSync(join(f.root, "nested/note.txt"), "ABCDEFGHIJ");
  assert.throws(() =>
    f.kernel.read("nested/note.txt", { offset: 2, identity: page.identity }),
  );
  onlyRoot(f);
});

test("synthetic: symlink ancestors/leaves, hard links and directories cannot return bytes", async (t) => {
  const f = await synthetic(t);
  fs.symlinkSync("nested", join(f.root, "alias"));
  fs.symlinkSync("other.txt", join(f.root, "alias.txt"));
  fs.linkSync(join(f.root, "other.txt"), join(f.root, "hard.txt"));
  for (const path of [
    "alias/note.txt",
    "alias.txt",
    "hard.txt",
    "other.txt",
    "nested",
    "missing.txt",
  ])
    refused(f, () => f.kernel.read(path));
});

for (const mode of ["throw", "zero", "changedStat", "crossDevice"]) {
  test(`synthetic: ${mode} failure closes temporary FDs and discloses no bytes`, async (t) => {
    const f = await synthetic(t);
    if (mode === "throw")
      f.state.readError = new Error("scripted read failure");
    if (mode === "zero") f.state.zeroRead = true;
    if (mode === "changedStat" || mode === "crossDevice") {
      let seen = 0;
      f.state.statOverride = (path, stat) => {
        if (path !== join(f.root, "nested/note.txt")) return stat;
        seen++;
        if (mode === "crossDevice")
          return Object.assign(Object.create(stat), { dev: stat.dev + 1n });
        return seen > 2
          ? Object.assign(Object.create(stat), { mode: stat.mode ^ 1n })
          : stat;
      };
    }
    refused(f, () => f.kernel.read("nested/note.txt"));
  });
}

for (const attack of [
  "leafReplacement",
  "ancestorReplacement",
  "rootReplacement",
  "leafSymlink",
  "revokeOwner",
  "throwCheck",
  "closeKernel",
]) {
  test(`synthetic: final authority ${attack} after temporary close prevents byte disclosure`, async (t) => {
    let armed = false,
      fired = false,
      f;
    f = await synthetic(t, (state, fixture) => {
      if (
        !armed ||
        fired ||
        state.fds.size !== 1 ||
        !state.events.some((event) => event.op === "read")
      )
        return;
      fired = true;
      const leaf = join(fixture.root, "nested/note.txt");
      if (attack === "leafReplacement") {
        fs.renameSync(leaf, leaf + ".old");
        fs.writeFileSync(leaf, "replacement");
      } else if (attack === "ancestorReplacement") {
        fs.renameSync(
          join(fixture.root, "nested"),
          join(fixture.root, "moved"),
        );
        fs.mkdirSync(join(fixture.root, "nested"));
        fs.writeFileSync(leaf, "replacement");
      } else if (attack === "rootReplacement") {
        fs.renameSync(fixture.root, fixture.root + ".old");
        fs.mkdirSync(fixture.root);
      } else if (attack === "leafSymlink") {
        fs.unlinkSync(leaf);
        fs.symlinkSync("../other.txt", leaf);
      } else if (attack === "revokeOwner") {
        void fixture.owner.close();
      } else if (attack === "throwCheck") {
        throw new Error("scripted final authority denial");
      } else if (attack === "closeKernel") {
        f.kernel.close();
      }
    });
    armed = true;
    const buffers = [];
    f.state.hook = (event) => {
      if (event.op === "read") buffers.push(event.bytes);
    };
    assert.throws(() => f.kernel.read("nested/note.txt"));
    assert.equal(fired, true, "attack must run after all temporary FDs close");
    assert.ok(
      buffers.length > 0,
      "failure must occur after bytes were read privately",
    );
    for (const bytes of buffers) assert.ok(bytes.every((value) => value === 0));
    if (attack === "closeKernel") assert.equal(f.state.fds.size, 0);
    else onlyRoot(f);
  });
}

test("synthetic: read reentry from the final authority callback refuses; final named checks follow it", async (t) => {
  let armed = false,
    fired = false,
    f;
  f = await synthetic(t, (state) => {
    if (
      !armed ||
      fired ||
      state.fds.size !== 1 ||
      !state.events.some((event) => event.op === "read")
    )
      return;
    fired = true;
    assert.throws(() => f.kernel.read("other.txt"));
    state.emit("finalCheck");
  });
  armed = true;
  assert.equal(f.kernel.read("nested/note.txt").bytes.toString(), "abcdefghij");
  assert.equal(fired, true);
  const events = f.state.events;
  const lastCheck = events.findIndex((event) => event.op === "finalCheck");
  assert.ok(
    events
      .slice(0, lastCheck)
      .some((event) => event.op === "close" && event.path.endsWith("note.txt")),
  );
  for (const path of [
    f.root,
    join(f.root, "nested"),
    join(f.root, "nested/note.txt"),
  ]) {
    assert.ok(
      events
        .slice(lastCheck + 1)
        .some((event) => event.op === "lstat" && event.path === path),
    );
    assert.ok(
      events
        .slice(lastCheck + 1)
        .some((event) => event.op === "realpath" && event.path === path),
    );
  }
  onlyRoot(f);
});

test("synthetic: temporary close failure erases bytes, attempts every FD and prevents successful close", async (t) => {
  const f = await synthetic(t);
  const buffers = [];
  f.state.hook = (event) => {
    if (event.op === "read") buffers.push(event.bytes);
  };
  f.state.failClose = (path) => path !== f.root;
  assert.throws(() => f.kernel.read("nested/note.txt"), /cleanup_unverified/);
  onlyRoot(f);
  assert.equal(
    f.state.events.filter(
      (event) => event.op === "close" && event.path !== f.root,
    ).length,
    2,
  );
  for (const bytes of buffers) assert.ok(bytes.every((value) => value === 0));
  f.state.failClose = undefined;
  assert.throws(
    () => f.kernel.read("other.txt"),
    undefined,
    "cleanup uncertainty must poison later reads",
  );
  assert.throws(() => f.kernel.close(), /cleanup_unverified/);
  assert.equal(f.state.fds.size, 0);
  assert.equal(f.state.libraryClosed, true);
  assert.throws(() => f.kernel.close(), /cleanup_unverified/);
  assert.throws(() => f.kernel.read("other.txt"));
});

for (const failure of ["rootClose", "libraryClose"]) {
  test(`synthetic: ${failure} revokes first and cannot report successful close`, async (t) => {
    const f = await synthetic(t);
    let reentryRefused = false;
    f.state.hook = (event) => {
      if (event.op === "close" && event.path === f.root) {
        assert.throws(() => f.kernel.read("other.txt"));
        reentryRefused = true;
      }
    };
    if (failure === "rootClose") f.state.failClose = () => true;
    else f.state.failLibraryClose = true;
    assert.throws(() => f.kernel.close(), /cleanup_unverified/);
    assert.equal(reentryRefused, true);
    assert.equal(f.state.fds.size, 0);
    assert.equal(f.state.libraryClosed, true);
    assert.throws(() => f.kernel.close(), /cleanup_unverified/);
  });
}

test("real runtime gate with instrumented fs rejects Node with no kernel IO", async (t) => {
  let state;
  await assert.rejects(
    synthetic(
      t,
      () => {
        throw new Error("authority callback must not run");
      },
      (value) => {
        state = value;
        state.useRealLoader = true;
      },
    ),
    /unsupported_runtime/,
  );
  assert.deepEqual(state.events, [{ op: "ffi" }]);
  assert.equal(state.fds.size, 0);
});

test("synthetic: identity compares every full-stat field, even if file bytes stay unchanged", async (t) => {
  const f = await synthetic(t);
  const token = f.kernel.read("nested/note.txt", { length: 2 }).identity;
  for (const key of [
    "dev",
    "ino",
    "size",
    "mtimeNs",
    "ctimeNs",
    "mode",
    "nlink",
    "uid",
    "gid",
  ]) {
    f.state.statOverride = (path, stat) =>
      path === join(f.root, "nested/note.txt")
        ? Object.assign(Object.create(stat), { [key]: stat[key] + 1n })
        : stat;
    assert.throws(
      () => f.kernel.read("nested/note.txt", { identity: token }),
      undefined,
      key,
    );
    onlyRoot(f);
  }
  f.state.statOverride = undefined;
  assert.equal(
    f.kernel
      .read("nested/note.txt", { offset: 2, identity: token })
      .bytes.toString(),
    "cdefghij",
  );
});

test("synthetic: callback returning an object or Promise fails closed during read", async (t) => {
  for (const result of [{}, Promise.resolve(), () => {}]) {
    let armed = false;
    const f = await synthetic(t, () => (armed ? result : undefined));
    armed = true;
    assert.throws(() => f.kernel.read("nested/note.txt"), /invalid_request/);
    onlyRoot(f);
  }
});

test("synthetic: explicit null and undefined page numbers cannot use omitted-field defaults", async (t) => {
  const f = await synthetic(t);
  for (const page of [
    { offset: null },
    { length: null },
    { offset: undefined },
    { length: undefined },
  ]) {
    assert.throws(
      () => f.kernel.read("nested/note.txt", page),
      /invalid_request/,
    );
    onlyRoot(f);
  }
});

test("synthetic: a close failure that retains a leaf FD still attempts other cleanup and poisons reads", async (t) => {
  const f = await synthetic(t);
  const leaf = join(f.root, "nested/note.txt");
  const buffers = [];
  f.state.hook = (event) => {
    if (event.op === "read") buffers.push(event.bytes);
  };
  f.state.failBeforeClose = (path) => path === leaf;
  assert.throws(() => f.kernel.read("nested/note.txt"), /cleanup_unverified/);
  assert.deepEqual([...f.state.fds.values()].sort(), [f.root, leaf].sort());
  assert.ok(
    f.state.events.some(
      (event) => event.op === "close" && event.path === join(f.root, "nested"),
    ),
    "ancestor close must be attempted even after leaf close fails",
  );
  assert.ok(buffers.length > 0);
  for (const bytes of buffers) assert.ok(bytes.every((value) => value === 0));
  const reads = f.state.events.filter((event) => event.op === "read").length;
  assert.throws(() => f.kernel.read("other.txt"));
  assert.equal(
    f.state.events.filter((event) => event.op === "read").length,
    reads,
  );
  assert.throws(() => f.kernel.close(), /cleanup_unverified/);
  assert.equal(f.state.libraryClosed, true);
  assert.deepEqual(
    [...f.state.fds.values()],
    [leaf],
    "test teardown alone cleans the deliberately retained synthetic FD",
  );
});
