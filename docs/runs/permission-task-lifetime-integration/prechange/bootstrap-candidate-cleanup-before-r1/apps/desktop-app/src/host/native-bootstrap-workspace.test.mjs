import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const load = () => import("./native-bootstrap-workspace.mjs");
// A broken acquisition may unexpectedly succeed. Still close its real FD,
// then fail the rejection assertion; cleanup errors cannot turn it into PASS.
const rejectCandidate = (promise, ...expected) =>
  assert.rejects(
    promise.then(async (owner) => {
      await owner.close().catch(() => {});
    }),
    ...expected,
  );
async function fixture(t) {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-bootstrap-")),
  );
  const path = join(parent, "root");
  await fs.mkdir(path);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { parent, path, workspace: { id: "workspace-1", path } };
}

test("candidate binds actual root metadata, exact Native directory SHA1 and retained close", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, path } = await fixture(t);
  const owner = await createNativeBootstrapWorkspace(workspace);
  t.after(() => owner.close());
  const stat = await fs.lstat(path, { bigint: true });
  assert.ok(Object.isFrozen(owner));
  const expected = {
    workspaceId: workspace.id,
    workspacePath: path,
    projectId: createHash("sha1").update(`directory:${path}`).digest("hex"),
    rootIdentity: { dev: String(stat.dev), ino: String(stat.ino) },
  };
  assert.deepEqual(owner.inspect(), expected);
  const detached = owner.inspect();
  detached.rootIdentity.ino = "foreign";
  assert.deepEqual(owner.inspect(), expected);
  assert.equal(await owner.assertCurrent(), true);
  const closed = owner.close();
  assert.throws(() => owner.inspect());
  assert.equal(owner.close(), closed);
  await closed;
  await assert.rejects(owner.assertCurrent());
});

test("all ancestor marker kinds are refused without following markers", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent, path } = await fixture(t);
  for (const base of [path, parent]) {
    for (const marker of [".git", ".hg"]) {
      for (const kind of ["file", "directory", "symlink"]) {
        const target = join(base, marker);
        if (kind === "file") await fs.writeFile(target, "not a repository");
        if (kind === "directory") await fs.mkdir(target);
        if (kind === "symlink")
          await fs.symlink(join(parent, "missing"), target);
        await rejectCandidate(createNativeBootstrapWorkspace(workspace));
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  }
});

test("root replacement irreversibly revokes candidate", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, path } = await fixture(t);
  const owner = await createNativeBootstrapWorkspace(workspace);
  t.after(() => owner.close());
  await fs.rename(path, path + "-original");
  await fs.mkdir(path);
  await assert.rejects(owner.assertCurrent());
  await fs.rmdir(path);
  await fs.rename(path + "-original", path);
  await assert.rejects(owner.assertCurrent());
  assert.throws(() => owner.inspect());
});

test("closed detached inputs reject proxies, accessors, symbols, extra fields and async checks before IO", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let touched = 0;
  const accessor = {
    id: workspace.id,
    get path() {
      touched++;
      return workspace.path;
    },
  };
  const proxy = new Proxy(workspace, {
    getPrototypeOf() {
      touched++;
      throw Error("proxy trap");
    },
  });
  for (const bad of [
    proxy,
    accessor,
    { ...workspace, extra: true },
    { ...workspace, [Symbol()]: true },
    Object.create(workspace),
  ]) {
    await rejectCandidate(createNativeBootstrapWorkspace(bad));
  }
  for (const bad of [
    { io: fs },
    { check: null },
    { check: async () => {} },
    { check: function* () {} },
    {
      get check() {
        touched++;
        return () => {};
      },
    },
    new Proxy({}, {}),
  ]) {
    await rejectCandidate(createNativeBootstrapWorkspace(workspace, bad));
  }
  assert.equal(touched, 0);
  await rejectCandidate(
    createNativeBootstrapWorkspace(workspace, {
      check: () => Promise.resolve(),
    }),
  );
  await rejectCandidate(
    createNativeBootstrapWorkspace(workspace, {
      check: () => {
        throw Error("check denied");
      },
    }),
    /check denied/,
  );
});

test("aliases, unreadable ancestors and excessive depth are refused", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent, path } = await fixture(t);
  const alias = join(parent, "alias");
  await fs.symlink(path, alias);
  await rejectCandidate(
    createNativeBootstrapWorkspace({ ...workspace, path: alias }),
  );
  const parentAlias = parent + "-alias";
  await fs.symlink(parent, parentAlias);
  t.after(() => fs.unlink(parentAlias));
  await rejectCandidate(
    createNativeBootstrapWorkspace({
      ...workspace,
      path: join(parentAlias, "root"),
    }),
  );
  await fs.chmod(parent, 0);
  try {
    await rejectCandidate(createNativeBootstrapWorkspace(workspace));
  } finally {
    await fs.chmod(parent, 0o700);
  }
  let deep = path;
  for (let i = 0; i < 65; i++) {
    deep = join(deep, "d");
    await fs.mkdir(deep);
  }
  await rejectCandidate(
    createNativeBootstrapWorkspace({ ...workspace, path: deep }),
  );
});

test("ancestor replacement and marker insertion revoke without revival", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  for (const mode of ["swap", ".git", ".hg"]) {
    const { workspace, parent } = await fixture(t);
    const owner = await createNativeBootstrapWorkspace(workspace);
    t.after(() => owner.close());
    if (mode === "swap") {
      await fs.rename(parent, parent + "-moved");
      t.after(() => fs.rm(parent + "-moved", { recursive: true, force: true }));
      await fs.mkdir(parent);
      await fs.mkdir(workspace.path);
    } else await fs.writeFile(join(parent, mode), "marker");
    await assert.rejects(owner.assertCurrent());
    if (mode !== "swap") await fs.unlink(join(parent, mode));
    await assert.rejects(owner.assertCurrent());
    assert.throws(() => owner.inspect());
  }
});

// Instrument the actual Node methods, retaining real handles and real stat
// results. No fake root owner, injected IO proof, Native import or subprocess.
async function instrument(t, name, replacement) {
  const { default: actual } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const original = actual[name];
  actual[name] = replacement(original);
  syncBuiltinESMExports();
  t.after(() => {
    actual[name] = original;
    syncBuiltinESMExports();
  });
}

test("observes each canonical ancestor through filesystem root with both markers", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  const seen = new Set();
  await instrument(t, "lstat", (original) => async (path, ...args) => {
    seen.add(path);
    return original(path, ...args);
  });
  const owner = await createNativeBootstrapWorkspace(workspace);
  t.after(() => owner.close());
  let path = workspace.path;
  for (;;) {
    for (const marker of [".git", ".hg"])
      assert.ok(seen.has(join(path, marker)));
    if (dirname(path) === path) break;
    path = dirname(path);
  }
});

test("marker inserted after an early ancestor observation fails acquisition and closes real FD", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent, path } = await fixture(t);
  let handle,
    inserted = false;
  await instrument(t, "open", (original) => async (...args) => {
    handle = await original(...args);
    return handle;
  });
  await instrument(t, "lstat", (original) => async (target, ...args) => {
    const result = await original(target, ...args);
    if (target === dirname(parent) && !inserted) {
      inserted = true;
      await fs.writeFile(join(path, ".git"), "late marker");
    }
    return result;
  });
  await rejectCandidate(createNativeBootstrapWorkspace(workspace));
  assert.ok(inserted);
  assert.equal(handle.fd, -1);
  await assert.rejects(handle.stat(), { code: "EBADF" });
});

test("ancestor swapped during observation refuses both original and replacement", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent } = await fixture(t);
  let swapped = false;
  await instrument(t, "lstat", (original) => async (target, ...args) => {
    const result = await original(target, ...args);
    if (target === dirname(parent) && !swapped) {
      swapped = true;
      await fs.rename(parent, parent + "-moved");
      await fs.mkdir(parent);
      await fs.mkdir(workspace.path);
    }
    return result;
  });
  t.after(() => fs.rm(parent + "-moved", { recursive: true, force: true }));
  await rejectCandidate(createNativeBootstrapWorkspace(workspace));
  assert.ok(swapped);
});

test("permission failure after acquisition closes retained FD without treating it as marker absence", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent } = await fixture(t);
  let handle;
  await instrument(t, "open", (original) => async (...args) => {
    handle = await original(...args);
    return handle;
  });
  await instrument(t, "lstat", (original) => async (target, ...args) => {
    if (target === join(parent, ".hg"))
      throw Object.assign(Error("permission denied"), { code: "EACCES" });
    return original(target, ...args);
  });
  await rejectCandidate(createNativeBootstrapWorkspace(workspace), {
    code: "EACCES",
  });
  assert.equal(handle.fd, -1);
});

test("post-open check rejection closes actual retained handle", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let handle;
  await instrument(t, "open", (original) => async (...args) => {
    handle = await original(...args);
    return handle;
  });
  await rejectCandidate(
    createNativeBootstrapWorkspace(workspace, {
      check: () => {
        if (handle) throw Error("post-open denial");
      },
    }),
    /post-open denial/,
  );
  assert.equal(handle.fd, -1);
});

test("cleanup failure is exposed; close revokes synchronously and keeps failed close promise", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let handle, actualClose;
  const cleanupError = Error("actual handle close failed");
  await instrument(t, "open", (original) => async (...args) => {
    handle = await original(...args);
    actualClose = handle.close.bind(handle);
    handle.close = () => Promise.reject(cleanupError);
    return handle;
  });
  await rejectCandidate(
    createNativeBootstrapWorkspace(workspace, {
      check: () => {
        if (handle) throw Error("acquisition denied");
      },
    }),
    (error) => error === cleanupError,
  );
  assert.ok(handle.fd >= 0);
  await actualClose();
  const owner = await createNativeBootstrapWorkspace(workspace);
  const failed = owner.close();
  assert.throws(() => owner.inspect());
  assert.equal(owner.close(), failed);
  await assert.rejects(failed, (error) => error === cleanupError);
  await assert.rejects(owner.assertCurrent());
  await actualClose();
});

test("the last check cannot revoke or insert markers just before assertCurrent returns", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { writeFileSync, renameSync, mkdirSync } = await import("node:fs");
  for (const mutation of ["close", ".git", ".hg", "rename"]) {
    const { workspace, path } = await fixture(t);
    let calls = 0,
      finalCall = Infinity,
      armed = false,
      closePromise;
    const owner = await createNativeBootstrapWorkspace(workspace, {
      check: () => {
        calls++;
        if (!armed || calls !== finalCall) return;
        if (mutation === "close") closePromise = owner.close();
        else if (mutation === "rename") {
          renameSync(path, path + "-original");
          mkdirSync(path);
        } else writeFileSync(join(path, mutation), "final callback marker");
      },
    });
    t.after(() => owner.close());
    calls = 0;
    await owner.assertCurrent();
    finalCall = calls;
    calls = 0;
    armed = true;
    await assert.rejects(owner.assertCurrent());
    assert.equal(calls, finalCall);
    assert.throws(() => owner.inspect());
    await assert.rejects(owner.assertCurrent());
    if (closePromise) await closePromise;
  }
});

test("last acquisition callback cannot insert a marker before publication; FD is closed", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { writeFileSync } = await import("node:fs");
  const { workspace, path } = await fixture(t);
  let calls = 0;
  const calibrated = await createNativeBootstrapWorkspace(workspace, {
    check: () => {
      calls++;
    },
  });
  const finalCall = calls;
  await calibrated.close();
  let handle;
  await instrument(t, "open", (original) => async (...args) => {
    handle = await original(...args);
    return handle;
  });
  calls = 0;
  await rejectCandidate(
    createNativeBootstrapWorkspace(workspace, {
      check: () => {
        calls++;
        if (calls === finalCall)
          writeFileSync(join(path, ".hg"), "late acquisition marker");
      },
    }),
  );
  assert.equal(calls, finalCall);
  assert.equal(handle.fd, -1);
});

test("check failure during assertCurrent is permanent and a pending close blocks reentry", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let denied = false;
  const owner = await createNativeBootstrapWorkspace(workspace, {
    check: () => {
      if (denied) throw Error("expired");
    },
  });
  t.after(() => owner.close());
  denied = true;
  await assert.rejects(owner.assertCurrent(), /expired/);
  denied = false;
  await assert.rejects(owner.assertCurrent());
  assert.throws(() => owner.inspect());
  await owner.close();
  const fresh = await createNativeBootstrapWorkspace(workspace);
  const pending = fresh.assertCurrent();
  const closing = fresh.close();
  await assert.rejects(pending);
  await closing;
});

test("fixed actual Native NON-VCS expression and util hash are read as source only", async () => {
  const base = new URL(
    "../../runtime-event-host/.generated/install/node_modules/@opencode/",
    import.meta.url,
  );
  const source = await fs.readFile(
    new URL("core/dist/chunks/config-pd1wrm5b.js", base),
    "utf8",
  );
  const hash = await fs.readFile(new URL("util/dist/hash.js", base), "utf8");
  assert.ok(
    source.includes(
      "const directory = AbsolutePath2.make(yield* fs.resolve(input));",
    ),
  );
  assert.ok(
    source.includes(
      'fs.up({ targets: [".git", ".hg"], start: directory, mode: "first" })',
    ),
  );
  assert.ok(
    source.includes(
      "id: ID17.make(Hash.fast(`directory:${directory}`)),\n      directory,\n      canonical: directory,\n      vcs: undefined",
    ),
  );
  assert.ok(
    hash.includes('return createHash("sha1").update(input).digest("hex");'),
  );
  assert.equal(
    createHash("sha1")
      .update("directory:/synthetic/fresh-managed")
      .digest("hex"),
    "ec242e96e6068be5c3f30e6834eab03077c65142",
  );
});

test("every acquisition check failure closes any acquired actual FD", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let checkpoints = 0;
  const baseline = await createNativeBootstrapWorkspace(workspace, {
    check: () => {
      checkpoints++;
    },
  });
  await baseline.close();
  let handle,
    opened = 0;
  await instrument(t, "open", (original) => async (...args) => {
    opened++;
    handle = await original(...args);
    return handle;
  });
  for (let failAt = 1; failAt <= checkpoints; failAt++) {
    let calls = 0;
    handle = undefined;
    await rejectCandidate(
      createNativeBootstrapWorkspace(workspace, {
        check: () => {
          if (++calls === failAt) throw Error(`checkpoint ${failAt}`);
        },
      }),
      new RegExp(`checkpoint ${failAt}$`),
    );
    if (handle) assert.equal(handle.fd, -1, `FD at checkpoint ${failAt}`);
    if (failAt === 1) assert.equal(opened, 0);
  }
});

test("exactly 64 ancestors is accepted and the next level is refused", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace } = await fixture(t);
  let count = 1,
    ancestor = workspace.path;
  while (dirname(ancestor) !== ancestor) {
    count++;
    ancestor = dirname(ancestor);
  }
  let path = workspace.path;
  while (count++ < 64) {
    path = join(path, "d");
    await fs.mkdir(path);
  }
  const owner = await createNativeBootstrapWorkspace({ ...workspace, path });
  await owner.close();
  path = join(path, "d");
  await fs.mkdir(path);
  await rejectCandidate(createNativeBootstrapWorkspace({ ...workspace, path }));
});

test("changed ancestor metadata and transient marker insertion fail observation", async (t) => {
  const { createNativeBootstrapWorkspace } = await load();
  const { workspace, parent, path } = await fixture(t);
  const owner = await createNativeBootstrapWorkspace(workspace);
  t.after(() => owner.close());
  const before = await fs.stat(parent, { bigint: true });
  await fs.chmod(parent, 0o755);
  const after = await fs.stat(parent, { bigint: true });
  assert.equal(before.ino, after.ino);
  await assert.rejects(owner.assertCurrent());
  await fs.chmod(parent, 0o700);
  await assert.rejects(owner.assertCurrent());
  let inserted = false;
  await instrument(t, "lstat", (original) => async (target, ...args) => {
    const stat = await original(target, ...args);
    if (target === dirname(parent) && !inserted) {
      inserted = true;
      const marker = join(path, ".hg");
      await fs.writeFile(marker, "transient");
      await fs.unlink(marker);
    }
    return stat;
  });
  await rejectCandidate(createNativeBootstrapWorkspace(workspace));
  assert.ok(inserted);
});
