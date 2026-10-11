// Node-only source emulation. Synthetic pathname openat and copied dirent buffers
// are not Darwin confinement, Native tool authority, or task settlement evidence.
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as io from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";

const sourceURL = new URL("./native-descriptor-read.mjs", import.meta.url);

function dirent(name, type = 8) {
  const bytes = Buffer.from(name);
  const record = Buffer.alloc(Math.ceil((22 + bytes.length) / 4) * 4);
  record.writeBigUInt64LE(1n, 0);
  record.writeUInt16LE(record.length, 16);
  record.writeUInt16LE(bytes.length, 18);
  record[20] = type;
  bytes.copy(record, 21);
  return record;
}

async function synthetic(t, check = () => {}) {
  assert.equal(globalThis.Bun, undefined, "Run only with Node");
  const parent = await io.realpath(
    await io.mkdtemp(join(tmpdir(), "omoc-directory-node-")),
  );
  const root = join(parent, "root");
  await io.mkdir(join(root, "nested", "deep"), { recursive: true });
  await io.writeFile(join(root, "note.txt"), "abc");
  await io.writeFile(join(root, "nested", "한글.txt"), "utf8");
  await io.symlink("missing-target", join(root, "nested", "link"));
  const workspace = { id: "directory-node", path: root };
  const owner = await createWorkspaceRootAuthority(workspace);
  let state, kernel;
  t.after(async () => {
    if (state) {
      state.hook = undefined;
      state.failClose = false;
      state.failClosedir = false;
      state.failLibraryClose = false;
      try {
        kernel?.close();
      } catch {
        // Deliberately sticky failures cannot be replayed by production close.
      }
      for (const fd of state.fds.keys()) fs.closeSync(fd);
      state.fds.clear();
    }
    await owner.close();
    await io.rm(parent, { recursive: true, force: true });
  });
  const adapter = join(parent, "adapter");
  await io.mkdir(adapter);
  const stateURL = pathToFileURL(join(adapter, "state.mjs"));
  await io.writeFile(
    stateURL,
    `export const state = { events: [], fds: new Map(), streams: new Map(), errno: new Int32Array(1), libraryClosed: false };
state.emit = (op, data = {}) => { const event = { op, ...data }; state.events.push(event); state.hook?.(event); };
`,
  );
  ({ state } = await import(stateURL.href));
  state.root = root;
  await io.writeFile(
    join(adapter, "fs.mjs"),
    `import * as actual from "node:fs";
import { state } from "./state.mjs";
export const constants = actual.constants;
export function openSync(path, flags) {
  if (path !== state.root) throw new Error("absolute child open forbidden");
  const fd = actual.openSync(path, flags & ~0x1000000);
  state.fds.set(fd, path); state.emit("openRoot", { fd, path, flags }); return fd;
}
export function fstatSync(fd, options) {
  const value = actual.fstatSync(fd, options), path = state.fds.get(fd);
  state.emit("fstat", { fd, path }); return state.statOverride?.(path, value) ?? value;
}
export function lstatSync(path, options) {
  const value = actual.lstatSync(path, options);
  state.emit("lstat", { path }); return state.statOverride?.(path, value) ?? value;
}
export function realpathSync(path) { const value = actual.realpathSync(path); state.emit("realpath", { path }); return value; }
export function readSync(...args) { return actual.readSync(...args); }
export function closeSync(fd) {
  const path = state.fds.get(fd); state.emit("beforeClose", { fd, path });
  if ([...state.streams.values()].some(stream => stream.fd === fd)) throw new Error("double ownership close");
  if (state.failClose) throw new Error("synthetic close failed with FD held");
  actual.closeSync(fd); state.fds.delete(fd); state.emit("close", { fd, path });
}
`,
  );
  await io.writeFile(
    join(adapter, "ffi.mjs"),
    `import * as actual from "node:fs";
import { join } from "node:path";
import { state } from "./state.mjs";
function record(name, type) {
  const bytes = Buffer.from(name), value = Buffer.alloc(Math.ceil((22 + bytes.length) / 4) * 4);
  value.writeBigUInt64LE(1n); value.writeUInt16LE(value.length, 16); value.writeUInt16LE(bytes.length, 18);
  value[20] = type; bytes.copy(value, 21); return value;
}
export async function openDarwinDescriptorFFI(options) {
  state.emit("ffi", { options });
  return {
    ptr: value => value,
    toArrayBuffer(pointer, offset, length) {
      if (pointer === state.errno) return state.errno.buffer;
      if (!Buffer.isBuffer(pointer) || offset + length > pointer.length) throw new Error("synthetic short dirent");
      const copy = Uint8Array.from(pointer.subarray(offset, offset + length));
      state.emit("copyDirent", { length }); return copy.buffer;
    },
    library: {
      close() { state.libraryClosed = true; state.emit("libraryClose"); if (state.failLibraryClose) throw new Error("library close failure"); },
      symbols: {
        __error: () => state.errno,
        openat(parent, name, flags, ...mode) {
          const part = name.toString("utf8").replace(/\\0$/, "");
          if (!state.fds.has(parent) || !part || part.includes("/") || part === "..") throw new Error("bad synthetic openat");
          const path = join(state.fds.get(parent), part);
          state.emit("openat", { parent, part, path, flags, mode });
          try { const fd = actual.openSync(path, flags & ~0x1000000); state.fds.set(fd, path); state.emit("openedChild", { fd, path }); return fd; }
          catch (error) { state.errno[0] = error.code === "ENOENT" ? 2 : error.code === "EACCES" ? 13 : 40; return -1; }
        },
        fdopendir(fd) {
          state.emit("fdopendir", { fd });
          if (state.failFdopendir) { state.errno[0] = 13; return null; }
          const path = state.fds.get(fd);
          const rows = state.records ?? [record(".", 4), record("..", 4), ...actual.readdirSync(path, { withFileTypes: true }).map(entry => record(entry.name, entry.isDirectory() ? 4 : entry.isSymbolicLink() ? 10 : entry.isFile() ? 8 : 1))];
          const stream = { fd, path, rows, index: 0 }; state.streams.set(stream, stream); return stream;
        },
        readdir(stream) {
          if (state.libraryClosed || !state.streams.has(stream)) throw new Error("invalid stream/library lifetime");
          state.emit("readdir", { fd: stream.fd, index: stream.index, errno: state.errno[0] });
          if (state.readErrno) { state.errno[0] = state.readErrno; return null; }
          return stream.rows[stream.index++] ?? null;
        },
        closedir(stream) {
          if (state.libraryClosed || !state.streams.has(stream)) throw new Error("invalid closedir lifetime/ownership");
          state.emit("beforeClosedir", { fd: stream.fd, path: stream.path });
          if (state.failClosedir) return -1;
          actual.closeSync(stream.fd); state.fds.delete(stream.fd); state.streams.delete(stream);
          state.emit("closedir", { fd: stream.fd, path: stream.path }); return 0;
        },
      },
    },
  };
}
`,
  );
  // Only fs/FFI imports change. All other relative imports use actual modules.
  const source = await io.readFile(sourceURL, "utf8");
  const copy = source.replace(
    /from\s+(["'])([^"']+)\1/g,
    (match, quote, specifier) => {
      if (specifier === "node:fs") return 'from "./fs.mjs"';
      if (specifier === "./darwin-descriptor-ffi.mjs")
        return 'from "./ffi.mjs"';
      return specifier.startsWith(".")
        ? `from ${JSON.stringify(new URL(specifier, sourceURL).href)}`
        : match;
    },
  );
  const copyURL = pathToFileURL(join(adapter, "kernel.mjs"));
  await io.writeFile(copyURL, copy);
  const module = await import(copyURL.href);
  kernel = await module.createNativeDescriptorReadKernel(workspace, {
    checkRoot: owner.assertOpened,
    check: () => {
      state.emit("authority");
      return check(state);
    },
  });
  state.events.length = 0;
  return { parent, root, workspace, owner, state, kernel, module };
}
function rootOnly(f) {
  assert.deepEqual([...f.state.fds.values()], [f.root]);
  assert.equal(f.state.streams.size, 0);
}
function refused(f, action = () => f.kernel.list("nested"), pattern) {
  assert.throws(action, pattern);
  rootOnly(f);
}
function errorFrom(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail("operation must throw, without a partial result");
}
function assertGuardRevoked(f) {
  const stat = fs.statSync(f.root, { bigint: true });
  assert.throws(() =>
    f.owner.assertOpened({
      workspaceId: f.workspace.id,
      workspacePath: f.root,
      dev: String(stat.dev),
      ino: String(stat.ino),
    }),
  );
}

test("synthetic: frozen synchronous root/nested enumeration preserves UTF-8 and symlink kind", async (t) => {
  const f = await synthetic(t);
  assert.ok(Object.isFrozen(f.kernel));
  assert.deepEqual(Object.keys(f.kernel).sort(), ["close", "list", "read"]);
  const root = f.kernel.list();
  assert.ok(!(root instanceof Promise));
  assert.deepEqual(root, [
    { name: "nested", type: "directory" },
    { name: "note.txt", type: "file" },
  ]);
  const rows = f.kernel.list("nested");
  assert.deepEqual(rows, [
    { name: "deep", type: "directory" },
    { name: "link", type: "symlink" },
    { name: "한글.txt", type: "file" },
  ]);
  assert.ok(Object.isFrozen(rows));
  assert.ok(rows.every(Object.isFrozen));
  rootOnly(f);
  assert.equal(f.kernel.read("note.txt").bytes.toString(), "abc");
  rootOnly(f);
  const opens = f.state.events.filter((event) => event.op === "openat");
  for (const event of opens) {
    for (const bit of [
      fs.constants.O_NOFOLLOW,
      fs.constants.O_NONBLOCK,
      0x1000000,
    ])
      assert.equal(event.flags & bit, bit);
    assert.equal(
      event.flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR),
      0,
    );
    assert.deepEqual(event.mode, [0, 0, 0, 0, 0, 0]);
  }
});

test("synthetic: deep walk transfers only target FD; closedir closes exactly once before final checks", async (t) => {
  const f = await synthetic(t);
  assert.deepEqual(f.kernel.list("nested/deep"), []);
  rootOnly(f);
  const events = f.state.events;
  const streamFD = events.find((event) => event.op === "fdopendir").fd;
  const opens = events.filter((event) => event.op === "openat");
  assert.equal(
    opens[0].flags & fs.constants.O_DIRECTORY,
    fs.constants.O_DIRECTORY,
  );
  assert.equal(opens[1].flags & fs.constants.O_DIRECTORY, 0);
  assert.equal(events.filter((e) => e.op === "closedir").length, 1);
  assert.equal(
    events.filter((e) => e.op === "close" && e.fd === streamFD).length,
    0,
  );
  const lastClose = Math.max(
    ...events.map((e, i) => (["close", "closedir"].includes(e.op) ? i : -1)),
  );
  const finalAuthority = events.findLastIndex((e) => e.op === "authority");
  assert.ok(lastClose < finalAuthority);
  assert.deepEqual(
    events
      .slice(finalAuthority + 1)
      .filter((e) => e.op === "lstat")
      .map((e) => e.path),
    [
      f.root,
      join(f.root, "nested"),
      join(f.root, "nested/deep"),
      join(f.root, "nested/deep"),
    ],
  );
  f.kernel.close();
  f.kernel.close();
  assert.equal(f.state.fds.size, 0);
  assert.equal(events.filter((e) => e.op === "libraryClose").length, 1);
});

test("synthetic: fdopendir failure retains target ownership for ordinary close", async (t) => {
  const f = await synthetic(t);
  f.state.failFdopendir = true;
  refused(f, undefined, /path_denied/);
  assert.equal(f.state.events.filter((e) => e.op === "closedir").length, 0);
  assert.equal(f.state.events.filter((e) => e.op === "close").length, 1);
});

test("synthetic: readdir errno is cleared each call and nonzero EOF refuses all rows", async (t) => {
  const f = await synthetic(t);
  f.state.errno[0] = 13;
  f.kernel.list();
  assert.ok(
    f.state.events
      .filter((e) => e.op === "readdir")
      .every((e) => e.errno === 0),
  );
  f.state.hook = (e) => {
    if (e.op === "readdir" && e.index === 3) f.state.readErrno = 5;
  };
  refused(f);
  assert.equal(f.state.events.filter((e) => e.op === "closedir").length, 2);
});

const malformed = {
  "short header": () => Buffer.alloc(20),
  "short record": () => {
    const b = dirent("x");
    b.writeUInt16LE(28, 16);
    return b;
  },
  "unaligned header": () => {
    const b = dirent("x");
    b.writeUInt16LE(25, 16);
    return b;
  },
  "oversized header": () => {
    const b = dirent("x");
    b.writeUInt16LE(1052, 16);
    return b;
  },
  "zero inode": () => {
    const b = dirent("x");
    b.fill(0, 0, 8);
    return b;
  },
  "unknown kind": () => dirent("x", 0),
  "invalid kind": () => dirent("x", 255),
  "invalid UTF-8": () => {
    const b = dirent("x");
    b[21] = 255;
    return b;
  },
  "missing terminator": () => {
    const b = dirent("x");
    b[22] = 1;
    return b;
  },
  "embedded NUL": () => dirent("a\0b"),
  slash: () => dirent("a/b"),
  "dot with file kind": () => dirent("."),
  "invalid name length": () => {
    const b = dirent("x");
    b.writeUInt16LE(1024, 18);
    return b;
  },
};
for (const [name, make] of Object.entries(malformed)) {
  test(`synthetic: ${name} refuses whole enumeration after a valid row`, async (t) => {
    const f = await synthetic(t);
    f.state.records = [dirent("valid"), make()];
    refused(f);
    assert.equal(f.state.events.filter((e) => e.op === "closedir").length, 1);
  });
}

test("synthetic: duplicate names refuse all rows, including conflicting kinds", async (t) => {
  const f = await synthetic(t);
  for (const kind of [8, 4]) {
    f.state.records = [dirent("same"), dirent("same", kind)];
    refused(f);
  }
});

test("synthetic: known special file kinds are other; record copies do not erase adapter memory", async (t) => {
  const f = await synthetic(t);
  f.state.records = [1, 2, 6, 12, 14].map((kind) =>
    dirent(`other${kind}`, kind),
  );
  const saved = f.state.records.map((record) => Buffer.from(record));
  assert.ok(f.kernel.list().every((row) => row.type === "other"));
  assert.deepEqual(f.state.records, saved);
  rootOnly(f);
});

for (const [name, records] of [
  [
    "4097 named rows",
    () => Array.from({ length: 4097 }, (_, i) => dirent(`n${i}`)),
  ],
  [
    "4099 total records",
    () => Array.from({ length: 4099 }, () => dirent(".", 4)),
  ],
]) {
  test(`synthetic: ${name} refuses complete listing`, async (t) => {
    const f = await synthetic(t);
    f.state.records = records();
    refused(f, undefined, /directory_too_large/);
  });
}

test("synthetic: exactly 4096 named rows and 4098 total records succeeds", async (t) => {
  const f = await synthetic(t);
  f.state.records = [
    dirent(".", 4),
    dirent("..", 4),
    ...Array.from({ length: 4096 }, (_, i) => dirent(`n${i}`)),
  ];
  assert.equal(f.kernel.list().length, 4096);
  rootOnly(f);
});

test("synthetic: maximum lexical name bytes succeeds; 1MiB budget is bounded by the row/name limits", async (t) => {
  const f = await synthetic(t);
  // Actual validator caps each name at 255 bytes. 4096 * 255 < 1MiB.
  // Do not replace that actual dependency to manufacture unreachable acceptance.
  f.state.records = Array.from({ length: 4096 }, (_, i) =>
    dirent(`${i}`.padEnd(255, "x")),
  );
  const rows = f.kernel.list();
  assert.equal(rows.length, 4096);
  assert.equal(
    rows.reduce((sum, row) => sum + Buffer.byteLength(row.name), 0),
    4096 * 255,
  );
  rootOnly(f);
  f.state.records = [dirent("x".repeat(256))];
  refused(f, undefined, /unsupported_directory_entry/);
});

for (const field of [
  "size",
  "mtimeNs",
  "ctimeNs",
  "mode",
  "nlink",
  "uid",
  "gid",
]) {
  test(`synthetic: directory ${field} mutation during enumeration refuses all rows`, async (t) => {
    const f = await synthetic(t);
    f.state.hook = (e) => {
      if (e.op === "readdir" && e.index === 3)
        f.state.statOverride = (path, stat) =>
          path === join(f.root, "nested")
            ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
                [field]: stat[field] + 1n,
              })
            : stat;
    };
    refused(f);
  });
}

for (const target of ["root", "ancestor"]) {
  test(`synthetic: final authority callback replaces ${target}; restoration cannot revive shared guard`, async (t) => {
    let armed = false,
      replaced = false;
    const f = await synthetic(t, (state) => {
      if (armed && !replaced && state.events.some((e) => e.op === "closedir")) {
        replaced = true;
        const path = target === "root" ? f.root : join(f.root, "nested");
        fs.renameSync(path, path + "-moved");
        fs.mkdirSync(path);
      }
    });
    armed = true;
    refused(f, () => f.kernel.list("nested/deep"));
    assert.ok(replaced);
    const path = target === "root" ? f.root : join(f.root, "nested");
    fs.rmdirSync(path);
    fs.renameSync(path + "-moved", path);
    assertGuardRevoked(f);
    await assert.rejects(f.owner.assertCurrent());
    refused(f, () => f.kernel.list());
  });
}

test("synthetic: target fullstat mutation in final authority callback refuses result", async (t) => {
  let armed = false;
  const f = await synthetic(t, (state) => {
    if (armed && state.events.some((e) => e.op === "closedir"))
      state.statOverride = (path, stat) =>
        path === join(f.root, "nested")
          ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
              ctimeNs: stat.ctimeNs + 1n,
            })
          : stat;
  });
  armed = true;
  refused(f);
});

test("synthetic: reentrant close revokes immediately but keeps library loaded through closedir", async (t) => {
  const f = await synthetic(t);
  f.state.hook = (e) => {
    if (e.op === "readdir") {
      f.kernel.close();
      assert.equal(f.state.libraryClosed, false);
    }
  };
  assert.throws(() => f.kernel.list("nested"));
  assert.equal(f.state.fds.size, 0);
  assert.equal(f.state.streams.size, 0);
  const events = f.state.events;
  assert.ok(
    events.findIndex((e) => e.op === "closedir") <
      events.findIndex((e) => e.op === "libraryClose"),
  );
  assert.throws(() => f.kernel.list());
});

for (const failure of ["failClosedir", "failClose", "failLibraryClose"]) {
  test(`synthetic: ${failure} is sticky and cleanup is never replayed`, async (t) => {
    const f = await synthetic(t);
    f.state[failure] = true;
    if (failure === "failClosedir") {
      assert.throws(() => f.kernel.list("nested"), /cleanup_unverified/);
      assert.equal(f.state.streams.size, 1);
      assert.equal(f.state.fds.size, 2);
    } else assert.throws(() => f.kernel.close(), /cleanup_unverified/);
    if (failure === "failClose") assert.equal(f.state.fds.size, 1);
    const before = f.state.events.filter((e) =>
      ["beforeClose", "beforeClosedir", "libraryClose"].includes(e.op),
    ).length;
    f.state[failure] = false;
    assert.throws(() => f.kernel.list());
    assert.throws(() => f.kernel.read("note.txt"));
    assert.throws(() => f.kernel.close(), /cleanup_unverified/);
    const after = f.state.events.filter((e) =>
      ["beforeClose", "beforeClosedir", "libraryClose"].includes(e.op),
    ).length;
    // The first close after a stream failure still must close its retained root.
    assert.equal(after - before, failure === "failClosedir" ? 2 : 0);
    assert.throws(() => f.kernel.close(), /cleanup_unverified/);
    assert.equal(
      f.state.events.filter((e) =>
        ["beforeClose", "beforeClosedir", "libraryClose"].includes(e.op),
      ).length,
      after,
    );
  });
}

test("synthetic: actual wrong-kind errors are private and occur after cleanup/final checks", async (t) => {
  const f = await synthetic(t);
  for (const [action, kind] of [
    [() => f.kernel.read("nested"), "directory"],
    [() => f.kernel.list("note.txt"), "file"],
  ]) {
    f.state.events.length = 0;
    const error = errorFrom(action);
    assert.equal(f.module.nativeDescriptorPathKind(error), kind);
    rootOnly(f);
    const lastClose = f.state.events.findLastIndex((e) => e.op === "close");
    assert.ok(
      lastClose < f.state.events.findLastIndex((e) => e.op === "authority"),
    );
    const finalAuthority = f.state.events.findLastIndex(
      (e) => e.op === "authority",
    );
    assert.ok(
      f.state.events
        .slice(finalAuthority + 1)
        .some(
          (e) =>
            e.op === "lstat" &&
            e.path === join(f.root, kind === "file" ? "note.txt" : "nested"),
        ),
    );
    const forged = Object.assign(new Error(error.message), {
      kind,
      type: kind,
      code: "native_permission_path_kind",
    });
    assert.equal(f.module.nativeDescriptorPathKind(forged), undefined);
    assert.equal(
      f.module.nativeDescriptorPathKind(Object.create(error)),
      undefined,
    );
  }
  for (const value of [
    null,
    undefined,
    "file",
    {},
    new Error("native_permission_path_kind"),
  ])
    assert.equal(f.module.nativeDescriptorPathKind(value), undefined);
});

for (const action of ["read", "list"]) {
  test(`synthetic: ${action} wrong-kind cleanup failure cannot disclose kind`, async (t) => {
    const f = await synthetic(t);
    f.state.failClose = true;
    const error = errorFrom(() =>
      action === "read" ? f.kernel.read("nested") : f.kernel.list("note.txt"),
    );
    assert.match(error.message, /cleanup_unverified/);
    assert.equal(f.module.nativeDescriptorPathKind(error), undefined);
    assert.equal(f.state.fds.size, 2);
  });
}

test("synthetic: invalid paths never enter FFI or disclose a forged kind", async (t) => {
  const f = await synthetic(t);
  for (const path of [
    "../outside",
    "/absolute",
    "nested/..",
    "nested//deep",
    "nested/./deep",
    "a\0b",
    {},
    null,
  ]) {
    f.state.events.length = 0;
    refused(f, () => f.kernel.list(path), /invalid_request/);
    assert.equal(f.state.events.length, 0);
  }
});

for (const method of ["read", "list"]) {
  test(`synthetic: ${method} wrong-kind final authority refusal cannot disclose kind`, async (t) => {
    let armed = false;
    const f = await synthetic(t, (state) => {
      if (armed && state.events.some((e) => e.op === "close"))
        throw new Error("synthetic authority expired");
    });
    armed = true;
    const error = errorFrom(() =>
      method === "read" ? f.kernel.read("nested") : f.kernel.list("note.txt"),
    );
    assert.match(error.message, /authority expired/);
    assert.equal(f.module.nativeDescriptorPathKind(error), undefined);
    rootOnly(f);
  });

  test(`synthetic: ${method} wrong-kind final target mutation cannot disclose kind`, async (t) => {
    let armed = false;
    const f = await synthetic(t, (state) => {
      if (armed && state.events.some((e) => e.op === "close"))
        state.statOverride = (path, stat) =>
          path === join(f.root, method === "read" ? "nested" : "note.txt")
            ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
                ctimeNs: stat.ctimeNs + 1n,
              })
            : stat;
    });
    armed = true;
    const error = errorFrom(() =>
      method === "read" ? f.kernel.read("nested") : f.kernel.list("note.txt"),
    );
    assert.equal(f.module.nativeDescriptorPathKind(error), undefined);
    rootOnly(f);
  });
}

test("synthetic: authority check reentrant close leaves stream cleanup valid and prevents replay", async (t) => {
  let armed = false;
  const f = await synthetic(t, (state) => {
    if (armed && state.streams.size) {
      f.kernel.close();
      assert.equal(state.libraryClosed, false);
    }
  });
  armed = true;
  assert.throws(() => f.kernel.list("nested"));
  assert.equal(f.state.fds.size, 0);
  assert.equal(f.state.streams.size, 0);
  const events = f.state.events;
  assert.ok(
    events.findIndex((e) => e.op === "closedir") <
      events.findIndex((e) => e.op === "libraryClose"),
  );
  const count = events.length;
  assert.throws(() => f.kernel.list());
  assert.equal(events.length, count);
});

test("synthetic: kind lookup does not invoke forged getters or Proxy traps", async (t) => {
  const f = await synthetic(t);
  let calls = 0;
  const forged = Object.defineProperty(
    new Error("native_permission_path_kind"),
    "kind",
    {
      get() {
        calls++;
        throw new Error("forged getter invoked");
      },
    },
  );
  const proxy = new Proxy(forged, {
    get() {
      calls++;
      throw new Error("forged Proxy invoked");
    },
    getPrototypeOf() {
      calls++;
      throw new Error("forged prototype invoked");
    },
  });
  assert.equal(f.module.nativeDescriptorPathKind(forged), undefined);
  assert.equal(f.module.nativeDescriptorPathKind(proxy), undefined);
  assert.equal(calls, 0);
});
