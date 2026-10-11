import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";
import {
  createNativeWorkspaceFileRead,
  observeNativeWorkspaceFileRead,
} from "./native-workspace-file-io.mjs";

async function fixture(t) {
  const path = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-native-read-")),
  );
  const workspace = { id: "owned", path };
  const bytes = Buffer.from("\uFEFFline\r\nlast\n");
  await fs.mkdir(join(path, "nested"));
  await fs.writeFile(join(path, "nested/note.txt"), bytes);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(async () => {
    await owner.close();
    await fs.rm(path, { recursive: true, force: true });
  });
  return {
    workspace,
    bytes,
    owner,
    options: { checkRoot: owner.assertOpened, check() {} },
  };
}

test("production reads exact BOM/CRLF bytes and proves all three original handles closed", async (t) => {
  const f = await fixture(t);
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    f.options,
  );
  assert.ok(Object.isFrozen(read));
  assert.ok(Object.isFrozen(read.resource));
  assert.deepEqual(Reflect.ownKeys(read.resource), []);
  const proof = observeNativeWorkspaceFileRead(read.resource);
  const result = await read.result;
  assert.equal(result.status, "available");
  assert.deepEqual(result.bytes, f.bytes);
  assert.deepEqual(await proof, { complete: true, handleCount: 3 });
  assert.ok(Object.isFrozen(await proof));
  assert.deepEqual(Reflect.ownKeys(await proof).sort(), [
    "complete",
    "handleCount",
  ]);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function pending(proof) {
  let settled = false;
  proof.then(() => {
    settled = true;
  });
  await turn();
  assert.equal(settled, false);
}
function adapter(f, hooks = {}) {
  const originals = [];
  const io = {
    lstat: (...args) =>
      hooks.lstat ? hooks.lstat(...args) : fs.lstat(...args),
    realpath: (...args) =>
      hooks.realpath ? hooks.realpath(...args) : fs.realpath(...args),
    async open(...args) {
      const handle = await fs.open(...args);
      originals.push(handle);
      if (hooks.open) await hooks.open(handle, ...args);
      return {
        get fd() {
          return handle.fd;
        },
        read: (...args) =>
          hooks.read ? hooks.read(handle, ...args) : handle.read(...args),
        stat: (...args) =>
          hooks.stat ? hooks.stat(handle, ...args) : handle.stat(...args),
        close: () => (hooks.close ? hooks.close(handle) : handle.close()),
      };
    },
  };
  return { io, originals, options: { ...f.options, io } };
}

test("closed inputs reject proxies/getters/extra fields without callbacks", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw new Error("callback");
  };
  const proxy = new Proxy(
    {},
    { get: forbidden, getPrototypeOf: forbidden, ownKeys: forbidden },
  );
  const getter = Object.defineProperty({}, "check", {
    enumerable: true,
    get: forbidden,
  });
  for (const [workspace, path, options] of [
    [proxy, "nested/note.txt", f.options],
    [
      {
        ...f.workspace,
        get extra() {
          return forbidden();
        },
      },
      "nested/note.txt",
      f.options,
    ],
    [f.workspace, proxy, f.options],
    [f.workspace, "nested/note.txt", proxy],
    [f.workspace, "nested/note.txt", getter],
    [f.workspace, "nested/note.txt", { ...f.options, maxBytes: 1 }],
    [
      f.workspace,
      "nested/note.txt",
      { ...f.options, check: async () => forbidden() },
    ],
    [
      f.workspace,
      "nested/note.txt",
      { ...f.options, check: new Proxy(forbidden, {}) },
    ],
    [f.workspace, "nested/note.txt", { ...f.options, checkRoot: forbidden }],
    [
      f.workspace,
      "nested/note.txt",
      { ...f.options, checkRoot: new Proxy(f.owner.assertOpened, {}) },
    ],
    [f.workspace, "nested/note.txt", { ...f.options, io: proxy }],
    [
      f.workspace,
      "nested/note.txt",
      {
        ...f.options,
        io: {
          get open() {
            return forbidden();
          },
          lstat: forbidden,
          realpath: forbidden,
        },
      },
    ],
    [f.workspace, "nested/note.txt", { checkRoot: f.owner.assertOpened }],
  ])
    assert.throws(
      () => createNativeWorkspaceFileRead(workspace, path, options),
      { appCode: "INVALID_REQUEST" },
    );
  assert.equal(calls, 0);
});

test("opaque tokens refuse forged, proxy, wrong and revoked proxy identities synchronously", async (t) => {
  const f = await fixture(t);
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    f.options,
  );
  const proof = observeNativeWorkspaceFileRead(read.resource);
  let traps = 0;
  const revoked = Proxy.revocable(read.resource, {});
  revoked.revoke();
  for (const token of [
    null,
    undefined,
    1,
    "token",
    {},
    read,
    read.result,
    Object.create(read.resource),
    new Proxy(read.resource, {
      get() {
        traps++;
      },
    }),
    revoked.proxy,
  ]) {
    assert.throws(() => observeNativeWorkspaceFileRead(token), {
      appCode: "INVALID_REQUEST",
    });
  }
  assert.equal(traps, 0);
  await read.result;
  assert.deepEqual(await proof, { complete: true, handleCount: 3 });
});

test("detaches workspace/options/adapter before microtask and never opens synchronously", async (t) => {
  const f = await fixture(t);
  let checks = 0;
  const a = adapter(f);
  const workspace = { ...f.workspace };
  const options = {
    ...a.options,
    check() {
      checks++;
    },
  };
  const read = createNativeWorkspaceFileRead(
    workspace,
    "nested/note.txt",
    options,
  );
  const proof = observeNativeWorkspaceFileRead(read.resource);
  assert.equal(checks, 0);
  assert.equal(a.originals.length, 0);
  workspace.path = "/unadmitted";
  options.check = () => {
    throw new Error("changed");
  };
  options.checkRoot = () => false;
  a.io.open = () => {
    throw new Error("changed");
  };
  assert.deepEqual((await read.result).bytes, f.bytes);
  assert.deepEqual(await proof, {
    complete: false,
    handleCount: 3,
  });
  assert.ok(checks > 0);
  assert.ok(a.originals.every((handle) => handle.fd === -1));
});

test("protected/traversal/missing/symlink/hardlink/oversize preserve primitive refusal", async (t) => {
  const f = await fixture(t);
  for (const path of ["../escape", "/absolute", "nested/../note.txt"]) {
    assert.throws(
      () => createNativeWorkspaceFileRead(f.workspace, path, f.options),
      { appCode: "INVALID_REQUEST" },
    );
  }
  await fs.symlink("note.txt", join(f.workspace.path, "nested/link.txt"));
  await fs.writeFile(join(f.workspace.path, "nested/hard-source.txt"), "held");
  await fs.link(
    join(f.workspace.path, "nested/hard-source.txt"),
    join(f.workspace.path, "nested/hard.txt"),
  );
  await fs.writeFile(join(f.workspace.path, "large.txt"), Buffer.alloc(65537));
  for (const [path, status, reason, count] of [
    [".env", "unsupported", "protected_source", 0],
    ["missing.txt", "unavailable", "missing_file", 1],
    ["nested/link.txt", "unavailable", "path_denied", 2],
    ["nested/hard.txt", "unavailable", "path_denied", 2],
    ["large.txt", "unsupported", "too_large", 2],
  ]) {
    const read = createNativeWorkspaceFileRead(f.workspace, path, f.options);
    const proof = observeNativeWorkspaceFileRead(read.resource);
    const result = await read.result;
    assert.equal(result.status, status);
    assert.equal(result.reason, reason);
    assert.equal(Object.hasOwn(result, "bytes"), false);
    assert.deepEqual(await proof, {
      complete: true,
      handleCount: count,
    });
  }
});

test("cancel before microtask revokes check and performs zero IO", async (t) => {
  const f = await fixture(t);
  let checks = 0;
  const read = createNativeWorkspaceFileRead(f.workspace, "nested/note.txt", {
    ...f.options,
    check() {
      checks++;
    },
  });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  read.cancel();
  read.cancel();
  await assert.rejects(read.result, {
    appCode: "UNAVAILABLE",
    message: "native_permission_file_io_cancelled",
  });
  assert.deepEqual(await proof, { complete: true, handleCount: 0 });
  assert.equal(checks, 0);
});

test("pending read cancellation retains proof until actual read and every close settle", async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    release = deferred(),
    closing = deferred(),
    closed = deferred();
  let reads = 0,
    closes = 0;
  const a = adapter(f, {
    async read(handle, ...args) {
      reads++;
      entered.resolve();
      await release.promise;
      return handle.read(...args);
    },
    async close(handle) {
      closes++;
      if (closes === 1) {
        closing.resolve();
        await closed.promise;
      }
      await handle.close();
    },
  });
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    a.options,
  );
  const rejected = assert.rejects(read.result, { appCode: "UNAVAILABLE" });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await entered.promise;
  read.cancel();
  await pending(proof);
  assert.equal(closes, 0);
  release.resolve();
  await closing.promise;
  await pending(proof);
  assert.ok(a.originals.some((handle) => handle.fd !== -1));
  closed.resolve();
  await rejected;
  assert.deepEqual(await proof, { complete: false, handleCount: 3 });
  assert.equal(reads, 1);
  assert.equal(closes, 3);
  assert.ok(a.originals.every((handle) => handle.fd === -1));
});

test("cancel during actual pending open closes newly acquired original", async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    release = deferred();
  const a = adapter(f, {
    async open() {
      entered.resolve();
      await release.promise;
    },
  });
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    a.options,
  );
  const rejected = assert.rejects(read.result, { appCode: "UNAVAILABLE" });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await entered.promise;
  read.cancel();
  await pending(proof);
  release.resolve();
  await rejected;
  assert.deepEqual(await proof, { complete: false, handleCount: 1 });
  assert.equal(a.originals[0].fd, -1);
});

test("failed close and false close ACK never prove descriptor closure; other handles close", async (t) => {
  for (const rejects of [false, true]) {
    const f = await fixture(t);
    let closes = 0;
    const a = adapter(f, {
      async close(handle) {
        closes++;
        if (closes === 1) {
          if (rejects) throw new Error("close refused");
          return;
        }
        await handle.close();
      },
    });
    const read = createNativeWorkspaceFileRead(
      f.workspace,
      "nested/note.txt",
      a.options,
    );
    const proof = observeNativeWorkspaceFileRead(read.resource);
    const result = await read.result;
    assert.equal(result.status, rejects ? "unavailable" : "available");
    assert.deepEqual(await proof, {
      complete: false,
      handleCount: 3,
    });
    assert.equal(closes, 3);
    assert.equal(a.originals.filter((handle) => handle.fd !== -1).length, 1);
    // Test owns this synthetic leaked descriptor, not the implementation.
    await a.originals[2].close();
  }
});

test("authority appCode propagates unchanged and all handles close after check refusal", async (t) => {
  const f = await fixture(t);
  const a = adapter(f);
  const error = Object.assign(new Error("authority revoked"), {
    appCode: "CONFLICT",
  });
  const read = createNativeWorkspaceFileRead(f.workspace, "nested/note.txt", {
    ...a.options,
    check() {
      if (a.originals.length === 3) throw error;
    },
  });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await assert.rejects(read.result, (actual) => actual === error);
  assert.deepEqual(await proof, {
    complete: false,
    handleCount: 3,
  });
  assert.ok(a.originals.every((handle) => handle.fd === -1));
});

test("pending metadata rejection settles before observer; injected IO cannot certify no handles", async (t) => {
  const f = await fixture(t);
  for (const operation of ["lstat", "realpath", "stat"]) {
    const entered = deferred(),
      release = deferred();
    const a = adapter(f, {
      async [operation]() {
        entered.resolve();
        return release.promise;
      },
    });
    const read = createNativeWorkspaceFileRead(
      f.workspace,
      "nested/note.txt",
      a.options,
    );
    const proof = observeNativeWorkspaceFileRead(read.resource);
    await entered.promise;
    await pending(proof);
    release.reject(new Error("actual metadata refused"));
    assert.equal((await read.result).status, "unavailable");
    assert.deepEqual(await proof, {
      complete: false,
      handleCount: operation === "stat" ? 1 : 0,
    });
    assert.ok(a.originals.every((handle) => handle.fd === -1));
  }
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    ".env",
    adapter(f).options,
  );
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await read.result;
  assert.deepEqual(await proof, {
    complete: false,
    handleCount: 0,
  });
});

test("real guard bound to another root or closed owner refuses bytes", async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  for (const checkRoot of [other.owner.assertOpened, f.owner.assertOpened]) {
    if (checkRoot === f.owner.assertOpened) await f.owner.close();
    const read = createNativeWorkspaceFileRead(f.workspace, "nested/note.txt", {
      ...f.options,
      checkRoot,
    });
    const proof = observeNativeWorkspaceFileRead(read.resource);
    const result = await read.result;
    assert.equal(result.status, "unavailable");
    assert.equal(Object.hasOwn(result, "bytes"), false);
    assert.deepEqual(await proof, {
      complete: true,
      handleCount: 1,
    });
  }
});

test("deferred check decision is rejected before any actual IO", async (t) => {
  const f = await fixture(t);
  const a = adapter(f);
  for (const check of [
    () => Promise.resolve(),
    () => Promise.reject(new Error("late authority")),
    () => ({
      then() {
        throw new Error("must not invoke");
      },
    }),
  ]) {
    const read = createNativeWorkspaceFileRead(f.workspace, "nested/note.txt", {
      ...a.options,
      check,
    });
    const proof = observeNativeWorkspaceFileRead(read.resource);
    await assert.rejects(read.result, { appCode: "INVALID_REQUEST" });
    assert.deepEqual(await proof, {
      complete: false,
      handleCount: 0,
    });
    assert.equal(a.originals.length, 0);
  }
});

test("read rejection and close rejection after cancellation retain actual settlement", async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    release = deferred(),
    closing = deferred(),
    closeRelease = deferred();
  let closes = 0;
  const a = adapter(f, {
    read() {
      entered.resolve();
      return release.promise;
    },
    async close(handle) {
      closes++;
      if (closes === 1) {
        closing.resolve();
        await closeRelease.promise;
      }
      await handle.close();
    },
  });
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    a.options,
  );
  const rejection = assert.rejects(read.result, { appCode: "UNAVAILABLE" });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await entered.promise;
  read.cancel();
  await pending(proof);
  release.reject(new Error("read failed"));
  await closing.promise;
  await pending(proof);
  closeRelease.reject(new Error("close failed"));
  await rejection;
  assert.deepEqual(await proof, { complete: false, handleCount: 3 });
  assert.equal(closes, 3);
  assert.ok(a.originals.slice(0, 2).every((handle) => handle.fd === -1));
  assert.notEqual(a.originals[2].fd, -1);
  await a.originals[2].close();
});

test("actual primitive result is withheld until pending close completes without cancellation", async (t) => {
  const f = await fixture(t);
  const closing = deferred(),
    release = deferred();
  let closes = 0;
  const a = adapter(f, {
    async close(handle) {
      if (++closes === 1) {
        closing.resolve();
        await release.promise;
      }
      await handle.close();
    },
  });
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    a.options,
  );
  const proof = observeNativeWorkspaceFileRead(read.resource);
  await closing.promise;
  await pending(proof);
  await pending(read.result);
  release.resolve();
  assert.deepEqual((await read.result).bytes, f.bytes);
  assert.deepEqual(await proof, { complete: false, handleCount: 3 });
  assert.ok(a.originals.every((handle) => handle.fd === -1));
});

test("missing claim and late microtask claim refuse before every IO/check callback", async (t) => {
  const f = await fixture(t);
  for (const path of ["nested/note.txt", ".env"]) {
    let effects = 0;
    const forbidden = () => {
      effects++;
      throw new Error("unclaimed IO");
    };
    const read = createNativeWorkspaceFileRead(f.workspace, path, {
      ...f.options,
      check: forbidden,
      io: { open: forbidden, lstat: forbidden, realpath: forbidden },
    });
    // This is already too late: the factory's start microtask runs first.
    await Promise.resolve();
    assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
      appCode: "INVALID_REQUEST",
    });
    await assert.rejects(read.result, { appCode: "INVALID_REQUEST" });
    assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
      appCode: "INVALID_REQUEST",
    });
    assert.equal(effects, 0);
  }
});

test("claim is synchronous and one-use before, during and after actual read", async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    release = deferred();
  const a = adapter(f, {
    async read(handle, ...args) {
      entered.resolve();
      await release.promise;
      return handle.read(...args);
    },
  });
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    a.options,
  );
  const proof = observeNativeWorkspaceFileRead(read.resource);
  assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
    appCode: "INVALID_REQUEST",
  });
  await entered.promise;
  assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
    appCode: "INVALID_REQUEST",
  });
  await pending(proof);
  release.resolve();
  await read.result;
  assert.equal((await proof).handleCount, 3);
  assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
    appCode: "INVALID_REQUEST",
  });
});

test("premature direct claim cannot be transferred to another observer slot", async (t) => {
  const f = await fixture(t);
  const read = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    f.options,
  );
  const directClaim = observeNativeWorkspaceFileRead(read.resource);
  assert.throws(() => observeNativeWorkspaceFileRead(read.resource), {
    appCode: "INVALID_REQUEST",
  });
  await read.result;
  assert.deepEqual(await directClaim, { complete: true, handleCount: 3 });
});

test("root revoked in final close callback cannot disclose observed bytes", async (t) => {
  const f = await fixture(t);
  let count = 0;
  const baseline = createNativeWorkspaceFileRead(
    f.workspace,
    "nested/note.txt",
    {
      ...f.options,
      check() {
        count++;
      },
    },
  );
  const baselineProof = observeNativeWorkspaceFileRead(baseline.resource);
  assert.equal((await baseline.result).status, "available");
  assert.equal((await baselineProof).complete, true);
  let calls = 0,
    close;
  const read = createNativeWorkspaceFileRead(f.workspace, "nested/note.txt", {
    ...f.options,
    check() {
      if (++calls === count) close = f.owner.close();
    },
  });
  const proof = observeNativeWorkspaceFileRead(read.resource);
  const result = await read.result;
  assert.equal(calls, count);
  await close;
  assert.throws(() => f.owner.assertOpened());
  assert.notEqual(result.status, "available");
  assert.equal(Object.hasOwn(result, "bytes"), false);
  assert.equal(
    (await proof).complete,
    true,
    "physical completion is separate from authority to disclose",
  );
});
