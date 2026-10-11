import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";

async function fixture(t) {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-root-object-")),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  await fs.mkdir(root);
  await fs.writeFile(join(root, "note.txt"), "original");
  return { parent, root, workspace: { id: "w1", path: root } };
}
const load = () => import("./workspace-root-authority.mjs");

test("physical adapter revocation is permanent across all consumers and does not claim FD settlement", async (t) => {
  const { createWorkspaceRootAuthority, invalidateWorkspaceRootGuard } =
    await load();
  const { workspace, root } = await fixture(t);
  let closes = 0;
  const owner = await createWorkspaceRootAuthority(workspace, {
    io: {
      ...fs,
      async open(...args) {
        const handle = await fs.open(...args);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closes++;
          return close();
        };
        return handle;
      },
    },
  });
  t.after(() => owner.close());
  const stat = await fs.stat(root, { bigint: true });
  const row = {
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  assert.equal(owner.assertOpened(row), true);
  assert.throws(() => invalidateWorkspaceRootGuard(() => {}));
  invalidateWorkspaceRootGuard(owner.assertOpened);
  invalidateWorkspaceRootGuard(owner.assertOpened);
  assert.throws(() => owner.assertOpened(row));
  await assert.rejects(owner.assertCurrent());
  assert.equal(closes, 0, "revocation must not invent actual close completion");
  await owner.close();
  assert.equal(closes, 1);
});

test("root owner binds actual opened directory identity and close revokes immediately", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  const stat = await fs.stat(root, { bigint: true });
  const row = {
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  assert.equal(owner.assertOpened(row), true);
  for (const change of [
    { workspaceId: "w2" },
    { workspacePath: root + "-other" },
    { ino: String(stat.ino + 1n) },
    { dev: "00" },
    { extra: true },
  ])
    assert.throws(() => owner.assertOpened({ ...row, ...change }));
  const pending = owner.close();
  assert.throws(() => owner.assertOpened(row));
  assert.equal(owner.close(), pending);
  await pending;
});

test("observer refuses a replacement at the same pathname before opening any descendant", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  await fs.rename(root, root + "-original");
  await fs.mkdir(root);
  await fs.writeFile(join(root, "note.txt"), "foreign");
  const opened = [];
  const io = {
    ...fs,
    open: async (path, ...args) => {
      opened.push(path);
      return fs.open(path, ...args);
    },
  };
  const result = await readWorkspaceFile(workspace, "note.txt", {
    io,
    checkRoot: owner.assertOpened,
  });
  assert.deepEqual(result.status, "unavailable");
  assert.equal(result.reason, "path_denied");
  assert.deepEqual(opened, [root]);
  assert.equal(await fs.readFile(join(root, "note.txt"), "utf8"), "foreign");
});

test("observer checks retained owner after reentrant authority checks and keeps bytes private", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  const accepted = await readWorkspaceFile(workspace, "note.txt", {
    checkRoot: owner.assertOpened,
  });
  assert.equal(accepted.content, "original");
  let rootOpened = false,
    reads = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (args[0] === root) rootOpened = true;
      if (args[0] !== root) {
        const read = handle.read.bind(handle);
        handle.read = (...values) => {
          reads++;
          return read(...values);
        };
      }
      return handle;
    },
  };
  const result = await readWorkspaceFile(workspace, "note.txt", {
    io,
    checkRoot: owner.assertOpened,
    check: () => {
      if (rootOpened) void owner.close();
    },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(Object.hasOwn(result, "content"), false);
  assert.equal(reads, 0);
});

test("root owner refuses malformed descriptor inputs and cleans failed acquisition", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { workspace } = await fixture(t);
  let invoked = 0,
    opened = 0,
    closed = 0;
  const getter = () => {
    invoked++;
    throw new Error("caller");
  };
  for (const candidate of [
    new Proxy(workspace, { ownKeys: getter, getPrototypeOf: getter }),
    Object.defineProperty({ ...workspace }, "path", { get: getter }),
    { ...workspace, extra: true },
  ])
    await assert.rejects(createWorkspaceRootAuthority(candidate));
  assert.equal(invoked, 0);
  const io = {
    ...fs,
    open: async (...args) => {
      opened++;
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closed++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(
    createWorkspaceRootAuthority(workspace, {
      io,
      check: () => {
        if (opened) throw new Error("revoked");
      },
    }),
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test("root replacement during acquisition is refused and the opened replacement FD is closed", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  let opened = 0,
    closed = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      await fs.rename(root, root + "-original");
      await fs.mkdir(root);
      await fs.writeFile(join(root, "note.txt"), "replacement");
      const handle = await fs.open(...args);
      opened++;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closed++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(createWorkspaceRootAuthority(workspace, { io }), {
    message: "native_permission_root_unverified",
  });
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  assert.equal(
    await fs.readFile(join(root, "note.txt"), "utf8"),
    "replacement",
  );
});

test("a symlink root is refused before open and revocation does not reopen the path", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { parent, root, workspace } = await fixture(t);
  const alias = join(parent, "alias");
  await fs.symlink(root, alias);
  let opens = 0,
    closes = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      opens++;
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(
    createWorkspaceRootAuthority({ ...workspace, path: alias }, { io }),
  );
  assert.equal(opens, 0);
  const owner = await createWorkspaceRootAuthority(workspace, { io });
  const stat = await fs.stat(root, { bigint: true });
  const row = {
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  const proxy = new Proxy(row, {
    ownKeys: () => {
      throw new Error("unexpected caller trap");
    },
  });
  assert.throws(() => owner.assertOpened(proxy), {
    message: "native_permission_root_unverified",
  });
  assert.equal(owner.assertOpened(row), true);
  await owner.close();
  await owner.close();
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.throws(() => owner.assertOpened(row));
});

test("final owned guard inspection never invokes supplied lookalikes, wrappers or proxies", async (t) => {
  const {
    createWorkspaceRootAuthority,
    isWorkspaceRootGuard,
    assertWorkspaceRootGuard,
  } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  const stat = await fs.stat(root, { bigint: true });
  const row = Object.freeze({
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  });
  let called = 0;
  const fake = () => {
    called++;
    return true;
  };
  const proxy = new Proxy(owner.assertOpened, {
    apply: () => {
      called++;
      return true;
    },
    get: () => {
      called++;
      throw new Error("caller");
    },
  });
  for (const guard of [fake, owner.assertOpened.bind(null), proxy, {}]) {
    assert.equal(isWorkspaceRootGuard(guard), false);
    assert.throws(() => assertWorkspaceRootGuard(guard, row));
  }
  assert.equal(called, 0);
  assert.equal(isWorkspaceRootGuard(owner.assertOpened), true);
  assert.equal(assertWorkspaceRootGuard(owner.assertOpened, row), true);
  await owner.close();
  assert.throws(() => assertWorkspaceRootGuard(owner.assertOpened, row));
});

// Instrument actual Node handles; the injected IO never substitutes identities.
async function observedOwner(t, options = {}) {
  const { createWorkspaceRootAuthority } = await load();
  const value = await fixture(t);
  const calls = [];
  let handle, pause;
  const io = {
    ...fs,
    lstat: async (...args) => {
      calls.push("lstat");
      const result = await fs.lstat(...args);
      if (pause) await pause("lstat");
      return result;
    },
    realpath: async (...args) => {
      calls.push("realpath");
      const result = await fs.realpath(...args);
      if (pause) await pause("realpath");
      return result;
    },
    open: async (...args) => {
      calls.push("open");
      handle = await fs.open(...args);
      const stat = handle.stat.bind(handle);
      handle.stat = async (...values) => {
        calls.push("stat");
        const result = await stat(...values);
        if (pause) await pause("stat");
        return result;
      };
      return handle;
    },
  };
  const owner = await createWorkspaceRootAuthority(value.workspace, {
    io,
    ...options,
  });
  t.after(() => owner.close());
  const stat = await handle.stat({ bigint: true });
  calls.length = 0;
  return {
    ...value,
    owner,
    handle,
    calls,
    setPause: (callback) => {
      pause = callback;
    },
    row: {
      workspaceId: value.workspace.id,
      workspacePath: value.root,
      dev: String(stat.dev),
      ino: String(stat.ino),
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const unverified = { message: "native_permission_root_unverified" };

test("assertCurrent checks actual retained and named identity before and after check", async (t) => {
  let runtime = false;
  const value = await observedOwner(t, {
    check: () => {
      if (runtime) value.calls.push("check");
    },
  });
  runtime = true;
  assert.equal(await value.owner.assertCurrent(), true);
  assert.deepEqual(value.calls, [
    "check",
    "stat",
    "lstat",
    "realpath",
    "check",
    "stat",
    "lstat",
    "realpath",
  ]);
  value.calls.length = 0;
  assert.equal(value.owner.assertOpened(value.row), true);
  assert.deepEqual(value.calls, []);
});

for (const mutation of ["replacement", "symlink", "ancestor relocation"]) {
  test(`assertCurrent irreversibly revokes after ${mutation}, retaining FD until close`, async (t) => {
    const value = await observedOwner(t);
    const { owner, root, parent, row, handle, calls } = value;
    const moved = root + "-moved";
    if (mutation === "ancestor relocation") {
      // Move the whole parent, then expose its original object through an alias.
      const relocated = parent + "-moved";
      t.after(() => fs.rm(relocated, { recursive: true, force: true }));
      await fs.rename(parent, relocated);
      await fs.symlink(relocated, parent);
    } else {
      await fs.rename(root, moved);
      if (mutation === "replacement") await fs.mkdir(root);
      else await fs.symlink(moved, root);
    }
    await assert.rejects(owner.assertCurrent(), unverified);
    assert.throws(() => owner.assertOpened(row), unverified);
    assert.equal((await handle.stat()).isDirectory(), true);
    if (mutation === "ancestor relocation") {
      await fs.unlink(parent);
      await fs.rename(parent + "-moved", parent);
    } else {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rename(moved, root);
    }
    calls.length = 0;
    await assert.rejects(owner.assertCurrent(), unverified);
    assert.throws(() => owner.assertOpened(row), unverified);
    assert.deepEqual(calls, []);
    const closing = owner.close();
    assert.equal(owner.close(), closing);
    await closing;
    assert.equal(handle.fd, -1);
    await assert.rejects(handle.stat(), { code: "EBADF" });
  });
}

for (const operation of ["stat", "lstat", "realpath"]) {
  for (const phase of [1, 2]) {
    test(`close during pending ${operation} phase ${phase} stops subsequent IO`, async (t) => {
      const { owner, row, calls, handle, setPause } = await observedOwner(t);
      const entered = deferred(),
        release = deferred();
      let seen = 0;
      setPause(async (name) => {
        if (name === operation && ++seen === phase) {
          entered.resolve();
          await release.promise;
        }
      });
      const pending = owner.assertCurrent();
      const rejected = assert.rejects(pending, unverified);
      await entered.promise;
      const beforeClose = [...calls];
      const closing = owner.close();
      assert.throws(() => owner.assertOpened(row), unverified);
      await closing;
      release.resolve();
      await rejected;
      assert.deepEqual(calls, beforeClose);
      assert.equal(handle.fd, -1);
      await assert.rejects(owner.assertCurrent(), unverified);
      assert.deepEqual(calls, beforeClose);
    });
  }
}

test("a check that closes reentrantly stops before the first identity pass", async (t) => {
  let runtime = false,
    closing;
  const value = await observedOwner(t, {
    check: () => {
      if (runtime) closing = value.owner.close();
    },
  });
  runtime = true;
  await assert.rejects(value.owner.assertCurrent(), unverified);
  assert.deepEqual(value.calls, []);
  await closing;
  assert.equal(value.handle.fd, -1);
});

test("a replacement in check is detected by the second actual identity pass", async (t) => {
  let runtime = false,
    replace;
  // The callback stays synchronous, as in existing authority checks.
  const { renameSync, mkdirSync } = await import("node:fs");
  const value = await observedOwner(t, {
    check: () => {
      if (runtime) replace();
    },
  });
  replace = () => {
    renameSync(value.root, value.root + "-moved");
    mkdirSync(value.root);
  };
  runtime = true;
  await assert.rejects(value.owner.assertCurrent(), unverified);
  assert.throws(() => value.owner.assertOpened(value.row), unverified);
  assert.equal((await value.handle.stat()).isDirectory(), true);
});

test("revocation by another assertion stops a pending identity check without closing the handle", async (t) => {
  const { owner, root, calls, handle, setPause } = await observedOwner(t);
  const entered = deferred(),
    release = deferred();
  let blocked = false;
  setPause(async (name) => {
    if (name === "stat" && !blocked) {
      blocked = true;
      entered.resolve();
      await release.promise;
    }
  });
  const pending = owner.assertCurrent();
  const rejected = assert.rejects(pending, unverified);
  await entered.promise;
  await fs.rename(root, root + "-moved");
  await assert.rejects(owner.assertCurrent(), { code: "ENOENT" });
  const beforeRelease = [...calls];
  await fs.rename(root + "-moved", root);
  release.resolve();
  await rejected;
  assert.deepEqual(calls, beforeRelease);
  assert.equal((await handle.stat()).isDirectory(), true);
  await owner.close();
  assert.equal(handle.fd, -1);
});

test("a throwing runtime check permanently revokes the pure guard and retains the handle", async (t) => {
  let runtime = false;
  const failure = new Error("authority_revoked");
  const value = await observedOwner(t, {
    check: () => {
      if (runtime) throw failure;
    },
  });
  runtime = true;
  await assert.rejects(
    value.owner.assertCurrent(),
    (error) => error === failure,
  );
  runtime = false;
  assert.throws(() => value.owner.assertOpened(value.row), unverified);
  value.calls.length = 0;
  await assert.rejects(value.owner.assertCurrent(), unverified);
  assert.deepEqual(value.calls, []);
  assert.equal((await value.handle.stat()).isDirectory(), true);
});

test("a retained stat failure permanently revokes without reopening the original path", async (t) => {
  const { owner, row, calls, handle } = await observedOwner(t);
  const stat = handle.stat;
  const failure = new Error("injected_stat_failure");
  handle.stat = async () => {
    throw failure;
  };
  await assert.rejects(owner.assertCurrent(), (error) => error === failure);
  handle.stat = stat;
  assert.throws(() => owner.assertOpened(row), unverified);
  await assert.rejects(owner.assertCurrent(), unverified);
  assert.deepEqual(calls, []);
  assert.equal((await handle.stat()).isDirectory(), true);
});

test("close settlement stays pending and injected close failure remains rejected and idempotent", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { workspace } = await fixture(t);
  const entered = deferred(),
    release = deferred();
  const failure = new Error("injected_close_failure");
  let handle,
    actualClose,
    closes = 0;
  const owner = await createWorkspaceRootAuthority(workspace, {
    io: {
      ...fs,
      open: async (...args) => {
        handle = await fs.open(...args);
        actualClose = handle.close.bind(handle);
        handle.close = async () => {
          closes++;
          entered.resolve();
          await release.promise;
          throw failure;
        };
        return handle;
      },
    },
  });
  t.after(() => actualClose());
  const closing = owner.close();
  let settled = false;
  const rejected = assert.rejects(closing, (error) => error === failure);
  void closing.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await entered.promise;
  assert.equal(settled, false);
  assert.equal((await handle.stat()).isDirectory(), true);
  await assert.rejects(owner.assertCurrent(), unverified);
  assert.equal(owner.close(), closing);
  release.resolve();
  await rejected;
  assert.equal(settled, true);
  assert.equal(owner.close(), closing);
  await assert.rejects(owner.close(), (error) => error === failure);
  assert.equal(closes, 1);
  assert.equal((await handle.stat()).isDirectory(), true);
});

test("assertCurrent refuses revoked caller authority before its first metadata IO", async (t) => {
  let revoked = false;
  const failure = new Error("caller_authority_revoked");
  const value = await observedOwner(t, {
    check: () => {
      if (revoked) throw failure;
    },
  });
  revoked = true;
  await assert.rejects(
    value.owner.assertCurrent(),
    (error) => error === failure,
  );
  assert.deepEqual(value.calls, []);
  assert.throws(() => value.owner.assertOpened(value.row), unverified);
});

test("root acquisition records actual cleanup, never caller-written settlement", async (t) => {
  const { createWorkspaceRootAuthority, workspaceRootFailureClosed } =
    await load();
  assert.equal(typeof workspaceRootFailureClosed, "function");
  assert.equal(workspaceRootFailureClosed({ cleanupComplete: true }), false);
  assert.equal(workspaceRootFailureClosed(new Error("forged")), false);
  const { workspace } = await fixture(t);
  const rejection = new Error("reject_after_open");
  let opened = false,
    actualHandle;
  await assert.rejects(
    createWorkspaceRootAuthority(workspace, {
      io: {
        ...fs,
        open: async (...args) => {
          actualHandle = await fs.open(...args);
          opened = true;
          return actualHandle;
        },
      },
      check: () => {
        if (opened) throw rejection;
      },
    }),
    (error) => error === rejection,
  );
  assert.equal(actualHandle.fd, -1);
  assert.equal(workspaceRootFailureClosed(rejection), true);
  const closeFailure = new Error("actual_root_close_failed");
  let actualClose;
  opened = false;
  t.after(() => actualClose?.());
  await assert.rejects(
    createWorkspaceRootAuthority(workspace, {
      io: {
        ...fs,
        open: async (...args) => {
          actualHandle = await fs.open(...args);
          actualClose = actualHandle.close.bind(actualHandle);
          actualHandle.close = async () => {
            throw closeFailure;
          };
          opened = true;
          return actualHandle;
        },
      },
      check: () => {
        if (opened) throw rejection;
      },
    }),
    (error) => error === closeFailure,
  );
  assert.notEqual(actualHandle.fd, -1);
  assert.equal(workspaceRootFailureClosed(closeFailure), false);
  // Reusing an old error cannot launder a later unproved cleanup.
  assert.equal(workspaceRootFailureClosed(rejection), false);
});
