import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawn as spawnProcess } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { createOSProcessIdentityAdapter } from "../sidecar-supervisor.mjs";
import { verifyOwnerLifetimeResources } from "../owner-lifetime-resources.mjs";

const MAX_FILE = 4096,
  MAX_GENERATIONS = 64,
  MAX_TOTAL = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const ID_KEYS = ["pid", "platform", "bootId", "startToken"];
const FILES = [
  "context.json",
  "app.registration",
  "child.registration",
  "app.exit",
  "child.exit",
  "terminal",
];
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ready = () => Object.freeze({ state: "ready" });
const recovery = () =>
  Object.freeze({ state: "recovery_required", reason: "owner_unverified" });
const fail = () => {
  throw new Error("owner_unverified");
};
const conflict = () => {
  throw new Error("identity_conflict");
};
function identity(value) {
  return (
    exact(value, ID_KEYS) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    ["darwin", "win32"].includes(value.platform) &&
    HEX.test(value.bootId) &&
    HEX.test(value.startToken)
  );
}
const orderedIdentity = (value) =>
  Object.fromEntries(ID_KEYS.map((key) => [key, value[key]]));
const sameIdentity = (a, b) =>
  identity(a) && identity(b) && ID_KEYS.every((key) => a[key] === b[key]);
function context(value, verification = false) {
  const keys = [
    "root",
    "rootIdentity",
    "ownerNonce",
    "role",
    "identity",
    ...(verification ? ["expectedRegistrations"] : []),
  ];
  if (
    !exact(value, keys) ||
    typeof value.root !== "string" ||
    !isAbsolute(value.root) ||
    resolve(value.root) !== value.root ||
    [...value.root].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    !/^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.test(value.rootIdentity) ||
    !UUID.test(value.ownerNonce) ||
    !["app", "child"].includes(value.role) ||
    !identity(value.identity)
  )
    fail();
  const copy = {
    root: value.root,
    rootIdentity: value.rootIdentity,
    ownerNonce: value.ownerNonce,
    role: value.role,
    identity: orderedIdentity(value.identity),
  };
  if (verification) {
    const expected = value.expectedRegistrations;
    if (
      !exact(expected, ["app", "child"]) ||
      !identity(expected.app) ||
      (expected.child !== null &&
        (!identity(expected.child) ||
          expected.child.pid === expected.app.pid ||
          expected.child.bootId !== expected.app.bootId))
    )
      fail();
    if (!sameIdentity(value.identity, expected[value.role])) conflict();
    copy.expectedRegistrations = {
      app: orderedIdentity(expected.app),
      child: expected.child === null ? null : orderedIdentity(expected.child),
    };
  }
  return copy;
}
function contextBytes(c, app) {
  return Buffer.from(
    `${JSON.stringify({ version: 1, root: c.root, rootIdentity: c.rootIdentity, ownerNonce: c.ownerNonce, app: orderedIdentity(app) })}\n`,
  );
}
function fact(kind, role, id, contextSHA) {
  // The OS adapter already hashes the unmodified boot UUID and sec:usec text.
  return Buffer.from(
    `V1\t${kind}\t${role}\t${id.pid}\t${id.bootId}\t${id.startToken}\t${contextSHA}\n`,
  );
}
const sameStat = (a, b) =>
  [
    "dev",
    "ino",
    "uid",
    "gid",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ].every((key) => a[key] === b[key]);
function owned(stat, directory) {
  if (
    stat.uid !== BigInt(process.getuid()) ||
    (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
  )
    fail();
}

/**
 * Windows lifetime witness (identity mode). macOS records exit facts through an
 * independent kqueue observer process; Windows has no cheap equivalent that
 * needs no native compiler, and does not need one: the process identity is the
 * kernel creation FILETIME and the adapter (createOSProcessIdentityAdapter)
 * reads it from CIM, which lists every process. A crashed owner is therefore
 * proven gone when CIM has no row for its PID, or a row with another creation
 * time, within the same boot. This witness adds: registration only for a live,
 * exact identity (no stale or foreign PID), one app and at most one child per
 * owner nonce, no registration after sealing, and "exited" only when EVERY
 * registered role is individually proven exited. Any probe failure is
 * "unverified" (store stays blocked). It writes no files, so there is nothing
 * to tamper with; the trade-off is that there is no durable per-run exit record.
 */
export function createWindowsLifetimeWitness({
  processIdentity = createOSProcessIdentityAdapter({ platform: "win32" }),
  deadlineMs = 5000,
} = {}) {
  const sessions = new Map();
  let busy = false;
  const timeout = Number.isFinite(deadlineMs)
    ? Math.max(1, Math.min(20_000, deadlineMs))
    : 5000;
  const withDeadline = (work) =>
    Promise.race([
      work,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("owner_unverified")),
          timeout,
        );
        timer.unref?.();
      }),
    ]);
  const live = async (id) => {
    if (!sameIdentity(await processIdentity.capture(id.pid), id)) fail();
  };
  async function register(value) {
    if (busy) return recovery();
    busy = true;
    try {
      const c = context(value);
      if (c.identity.platform !== "win32") fail();
      await withDeadline(
        (async () => {
          await live(c.identity);
          let session = sessions.get(c.ownerNonce);
          if (c.role === "app") {
            if (session) fail();
            sessions.set(c.ownerNonce, {
              c,
              sealed: false,
              child: null,
            });
            return;
          }
          if (
            !session ||
            session.sealed ||
            session.child ||
            session.c.root !== c.root ||
            session.c.rootIdentity !== c.rootIdentity ||
            c.identity.pid === session.c.identity.pid ||
            c.identity.bootId !== session.c.identity.bootId
          )
            fail();
          await live(session.c.identity);
          session.child = orderedIdentity(c.identity);
        })(),
      );
      return ready();
    } catch {
      return recovery();
    } finally {
      busy = false;
    }
  }
  async function verify(value) {
    try {
      const c = context(value, true);
      const { app, child } = c.expectedRegistrations;
      if ([app, child].some((id) => id && id.platform !== "win32")) fail();
      for (const id of child ? [app, child] : [app]) {
        const result = await withDeadline(processIdentity.inspect(id));
        if (result?.state === "identity_conflict") conflict();
        if (
          result?.state !== "exited" ||
          !sameIdentity(result.identity, id) ||
          !["os_identity", "owned_exit"].includes(result.evidence)
        )
          return "unverified";
      }
      return "exited";
    } catch (error) {
      return error?.message === "identity_conflict"
        ? "identity_conflict"
        : "unverified";
    }
  }
  async function closeRegistration(ownerNonce) {
    const session = sessions.get(ownerNonce);
    if (busy || !session) return recovery();
    session.sealed = true;
    return ready();
  }
  return Object.freeze({ register, verify, closeRegistration });
}

/** Host/test injection only. No journal, owner record, or Native content writes. */
export function createLifetimeWitness({
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
  processIdentity = createOSProcessIdentityAdapter({ platform }),
  spawn = spawnProcess,
  io = fs,
  deadlineMs = 5000,
} = {}) {
  if (platform === "win32")
    return createWindowsLifetimeWitness({
      processIdentity: processIdentity ?? undefined,
      deadlineMs,
    });
  const timeout = Number.isFinite(deadlineMs)
    ? Math.max(1, Math.min(20_000, deadlineMs))
    : 5000;
  const sessions = new Map();
  let busy = false;
  const supported = () => platform === "darwin" && arch === "arm64";
  async function directory(path) {
    const before = await io.lstat(path, { bigint: true });
    owned(before, true);
    if ((await io.realpath(path)) !== path) fail();
    const handle = await io.open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (
        !sameStat(before, await handle.stat({ bigint: true })) ||
        !sameStat(before, await io.lstat(path, { bigint: true }))
      )
        fail();
      return { path, stat: before, handle };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async function unchangedDirectory(dir, immutable = true) {
    const fd = await dir.handle.stat({ bigint: true }),
      path = await io.lstat(dir.path, { bigint: true });
    owned(fd, true);
    owned(path, true);
    const same = immutable
      ? sameStat
      : (a, b) =>
          ["dev", "ino", "uid", "mode"].every((key) => a[key] === b[key]);
    if (
      !same(dir.stat, fd) ||
      !same(dir.stat, path) ||
      (await io.realpath(dir.path)) !== dir.path
    )
      fail();
  }
  async function readFile(path, sync = false) {
    const before = await io.lstat(path, { bigint: true });
    owned(before, false);
    if (before.size < 1n || before.size > BigInt(MAX_FILE)) fail();
    const handle = await io.open(
      path,
      (sync ? constants.O_RDWR : constants.O_RDONLY) |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    try {
      if (!sameStat(before, await handle.stat({ bigint: true }))) fail();
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (
        length !== Number(before.size) ||
        !sameStat(before, await handle.stat({ bigint: true })) ||
        !sameStat(before, await io.lstat(path, { bigint: true }))
      )
        fail();
      if (sync) {
        await handle.sync();
        if (
          !sameStat(before, await handle.stat({ bigint: true })) ||
          !sameStat(before, await io.lstat(path, { bigint: true }))
        )
          fail();
      }
      return { stat: before, bytes: buffer.subarray(0, length) };
    } finally {
      await handle.close();
    }
  }
  async function scan(base, creating = false) {
    const dirs = await io.readdir(base.path);
    if (
      dirs.length > MAX_GENERATIONS ||
      (creating && dirs.length >= MAX_GENERATIONS)
    )
      fail();
    let bytes = 0;
    for (const name of dirs) {
      if (!UUID.test(name)) fail();
      const dir = await directory(join(base.path, name));
      try {
        const names = await io.readdir(dir.path);
        if (names.some((name) => !FILES.includes(name))) fail();
        for (const name of names) {
          const stat = await io.lstat(join(dir.path, name), { bigint: true });
          owned(stat, false);
          if (stat.size > BigInt(MAX_FILE)) fail();
          bytes += Number(stat.size);
          if (bytes > MAX_TOTAL) fail();
        }
        await unchangedDirectory(dir);
      } finally {
        await dir.handle.close();
      }
    }
    await unchangedDirectory(base);
    return bytes;
  }
  async function openTree(c) {
    const dirs = [];
    try {
      dirs.push(await directory(c.root));
      if (`${dirs[0].stat.dev}:${dirs[0].stat.ino}` !== c.rootIdentity)
        conflict();
      dirs.push(await directory(join(c.root, "lifetime-witness-v1")));
      await scan(dirs[1]);
      dirs.push(await directory(join(dirs[1].path, c.ownerNonce)));
      return dirs;
    } catch (error) {
      await Promise.allSettled(dirs.map((dir) => dir.handle.close()));
      throw error;
    }
  }
  async function snapshot(c, sync) {
    const dirs = await openTree(c);
    try {
      const dir = dirs[2],
        names = (await io.readdir(dir.path)).sort();
      const required = [
        "context.json",
        "app.registration",
        "app.exit",
        "terminal",
        ...(c.expectedRegistrations.child
          ? ["child.registration", "child.exit"]
          : []),
      ].sort();
      if (names.join() !== required.join()) fail();
      const files = {};
      for (const name of names)
        files[name] = await readFile(join(dir.path, name), sync);
      validateProofs(c, files);
      if (sync) await dir.handle.sync();
      for (const d of dirs) await unchangedDirectory(d);
      if ((await io.readdir(dir.path)).sort().join() !== names.join()) fail();
      return {
        dirs: dirs.map(({ path, stat }) => ({ path, stat })),
        names,
        files,
      };
    } finally {
      await Promise.all(dirs.map((dir) => dir.handle.close()));
    }
  }
  function validateProofs(c, files) {
    const expected = c.expectedRegistrations;
    const bytes = contextBytes(c, expected.app);
    if (!files["context.json"].bytes.equals(bytes)) conflict();
    const contextSHA = digest(bytes),
      hashes = {};
    for (const role of ["app", ...(expected.child ? ["child"] : [])]) {
      for (const kind of ["registration", "exit"]) {
        const name = `${role}.${kind}`,
          value = files[name].bytes;
        if (!value.equals(fact(kind, role, expected[role], contextSHA)))
          conflict();
        hashes[name] = digest(value);
      }
    }
    const terminal = Buffer.from(
      `V1\tterminal\t${contextSHA}\t${hashes["app.registration"]}\t${hashes["app.exit"]}\t${hashes["child.registration"] ?? "-"}\t${hashes["child.exit"] ?? "-"}\n`,
    );
    if (!files.terminal.bytes.equals(terminal)) fail();
  }
  async function verify(value) {
    if (!supported()) return "unverified";
    try {
      const c = context(value, true);
      // Present flush establishes durability of complete immutable lifetime facts.
      // It never infers a historical ACK, app operation, or journal success.
      const first = await snapshot(c, true);
      let second;
      try {
        second = await snapshot(c, false);
      } catch {
        return "unverified";
      }
      if (
        first.names.join() !== second.names.join() ||
        first.dirs.some(
          (dir, i) =>
            dir.path !== second.dirs[i].path ||
            !sameStat(dir.stat, second.dirs[i].stat),
        ) ||
        first.names.some(
          (name) =>
            !sameStat(first.files[name].stat, second.files[name].stat) ||
            !first.files[name].bytes.equals(second.files[name].bytes),
        )
      )
        fail();
      return "exited";
    } catch (error) {
      return error?.message === "identity_conflict"
        ? "identity_conflict"
        : "unverified";
    }
  }
  function sessionFail(session) {
    session.failed = true;
    session.pending?.reject(new Error("owner_unverified"));
    session.pending = null;
  }
  function attach(session) {
    const child = session.helper;
    child.on("error", () => sessionFail(session));
    child.on("exit", () => {
      session.exited = true;
      sessionFail(session);
    });
    child.on("close", () => {
      session.exited = true;
      sessionFail(session);
    });
    child.stdin?.on("error", () => sessionFail(session));
    child.stdout?.on("error", () => sessionFail(session));
    child.stdout?.on("end", () => sessionFail(session));
    child.stdout?.on("data", (chunk) => {
      if (session.failed) return;
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      if (
        chunk.length + session.buffer.length > 256 ||
        chunk.some((b) => b > 127 || b === 0 || b === 13)
      )
        return sessionFail(session);
      session.buffer += chunk.toString("ascii");
      let index;
      while ((index = session.buffer.indexOf("\n")) !== -1) {
        const line = session.buffer.slice(0, index + 1);
        session.buffer = session.buffer.slice(index + 1);
        const pending = session.pending;
        if (
          !pending ||
          pending.received ||
          line !== `READY\t${pending.role}\t${pending.sha}\n`
        )
          return sessionFail(session);
        pending.received = true;
        pending.resolve();
      }
    });
    if (
      !child.stdin ||
      !child.stdout ||
      !Number.isSafeInteger(child.pid) ||
      child.pid <= 0
    )
      fail();
    child.unref();
    child.stdin.unref?.();
    child.stdout.unref?.();
  }
  async function exactLive(id) {
    if (!sameIdentity(await processIdentity.capture(id.pid), id)) fail();
  }
  function pendingACK(session, c) {
    let resolve, reject;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    // Failures can arrive before the registration lane reaches its await.
    promise.catch(() => {});
    session.pending = {
      role: c.role,
      sha: digest(fact("registration", c.role, c.identity, session.contextSHA)),
      resolve,
      reject,
      received: false,
    };
    return promise;
  }
  async function send(session, line) {
    if (session.failed || session.exited || !session.helper?.stdin?.writable)
      fail();
    await new Promise((resolve, reject) => {
      session.helper.stdin.write(line, "ascii", (error) =>
        error ? reject(error) : resolve(),
      );
    });
    if (session.failed || session.exited) fail();
  }
  async function stopBeforeGrant(session) {
    if (
      !session ||
      session.granted ||
      session.exited ||
      !session.helperIdentity ||
      session.helperIdentity.pid !== session.helper?.pid
    )
      return;
    try {
      if (
        sameIdentity(
          await processIdentity.capture(session.helperIdentity.pid),
          session.helperIdentity,
        ) &&
        !session.exited
      )
        session.helper.kill("SIGTERM"); // Only this owned handle, never an old PID.
    } catch {
      /* Preserve evidence and keep the store blocked. */
    }
  }
  async function registration(c, operation) {
    const alive = () => {
      if (operation.expired) fail();
    };
    await exactLive(c.identity);
    alive();
    let session = sessions.get(c.ownerNonce);
    if (c.role === "app") {
      if (session) fail();
      session = {
        c,
        contextSHA: digest(contextBytes(c, c.identity)),
        helper: null,
        helperIdentity: null,
        granted: false,
        sealed: false,
        failed: false,
        exited: false,
        buffer: "",
        pending: null,
        child: null,
      };
      sessions.set(c.ownerNonce, session);
      operation.session = session;
      const dirs = [];
      try {
        dirs.push(await directory(c.root));
        alive();
        if (`${dirs[0].stat.dev}:${dirs[0].stat.ino}` !== c.rootIdentity)
          conflict();
        const basePath = join(c.root, "lifetime-witness-v1");
        try {
          await io.mkdir(basePath, { mode: 0o700 });
          await dirs[0].handle.sync();
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        alive();
        dirs.push(await directory(basePath));
        const total = await scan(dirs[1], true);
        alive();
        const bytes = contextBytes(c, c.identity);
        if (bytes.length > MAX_FILE || total + bytes.length > MAX_TOTAL) fail();
        await io.mkdir(join(basePath, c.ownerNonce), { mode: 0o700 });
        alive();
        await dirs[1].handle.sync();
        alive();
        dirs.push(await directory(join(basePath, c.ownerNonce)));
        const path = join(dirs[2].path, "context.json");
        const file = await io.open(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          alive();
          await file.writeFile(bytes);
          alive();
          await file.sync();
          alive();
        } finally {
          await file.close();
        }
        await dirs[2].handle.sync();
        alive();
        await exactLive(c.identity);
        alive();
        for (const dir of dirs) {
          await unchangedDirectory(dir, false);
          alive();
        }
        session.generationIdentity = `${dirs[2].stat.dev}:${dirs[2].stat.ino}`;
        const resource = await verifyOwnerLifetimeResources({
          resourcesPath,
          platform,
          arch,
        });
        alive();
        const ack = pendingACK(session, c);
        // fd4 is identity-only. The helper has no inherited app configuration.
        session.helper = spawn(
          resource.executable,
          [
            "--v1",
            String(c.identity.pid),
            c.identity.bootId,
            c.identity.startToken,
            session.contextSHA,
            ...c.rootIdentity.split(":"),
          ],
          {
            shell: false,
            detached: true,
            env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
            stdio: [
              "pipe",
              "pipe",
              "ignore",
              dirs[2].handle.fd,
              dirs[0].handle.fd,
            ],
          },
        );
        attach(session);
        alive();
        const helperIdentity = await processIdentity.capture(
          session.helper.pid,
        );
        if (
          !identity(helperIdentity) ||
          helperIdentity.pid !== session.helper.pid ||
          helperIdentity.pid === c.identity.pid
        )
          fail();
        session.helperIdentity = orderedIdentity(helperIdentity);
        alive();
        await ack;
        alive();
        await confirmACK(session, c);
        alive();
        session.pending = null;
        session.granted = true;
        return ready();
      } finally {
        await Promise.all(dirs.map((dir) => dir.handle.close()));
      }
    }
    operation.session = session;
    if (
      !session ||
      !session.granted ||
      session.sealed ||
      session.failed ||
      session.child ||
      session.c.root !== c.root ||
      session.c.rootIdentity !== c.rootIdentity ||
      c.identity.pid === session.c.identity.pid ||
      c.identity.bootId !== session.c.identity.bootId
    )
      fail();
    await exactLive(session.c.identity);
    alive();
    await exactLive(session.helperIdentity);
    alive();
    const ack = pendingACK(session, c);
    // Reserve the child before any await, including a failed/late ACK.
    session.child = orderedIdentity(c.identity);
    await send(
      session,
      `CHILD\t${c.identity.pid}\t${c.identity.bootId}\t${c.identity.startToken}\n`,
    );
    alive();
    await ack;
    alive();
    await confirmACK(session, c);
    alive();
    session.pending = null;
    return ready();
  }
  async function confirmACK(session, c) {
    if (session.failed || session.exited || session.buffer.length) fail();
    await exactLive(c.identity);
    await exactLive(session.helperIdentity);
    const dirs = await openTree(c);
    try {
      const gen = dirs[2].path;
      if (
        `${dirs[2].stat.dev}:${dirs[2].stat.ino}` !== session.generationIdentity
      )
        conflict();
      const saved = await readFile(join(gen, "context.json"));
      if (!saved.bytes.equals(contextBytes(session.c, session.c.identity)))
        conflict();
      const app = await readFile(join(gen, "app.registration"));
      if (
        !app.bytes.equals(
          fact("registration", "app", session.c.identity, session.contextSHA),
        )
      )
        conflict();
      const proof =
        c.role === "app"
          ? app
          : await readFile(join(gen, "child.registration"));
      if (
        !proof.bytes.equals(
          fact("registration", c.role, c.identity, session.contextSHA),
        ) ||
        digest(proof.bytes) !== session.pending.sha
      )
        conflict();
      for (const dir of dirs) await unchangedDirectory(dir);
    } finally {
      await Promise.all(dirs.map((dir) => dir.handle.close()));
    }
    await exactLive(c.identity);
    await exactLive(session.helperIdentity);
    if (session.failed || session.exited || session.buffer.length) fail();
  }
  async function register(value) {
    if (!supported() || busy) return recovery();
    let c;
    try {
      c = context(value);
    } catch {
      return recovery();
    }
    busy = true;
    const operation = { expired: false, session: null };
    let timer;
    const work = registration(c, operation);
    // Completion remains owned even if the deadline wins.
    work.catch(() => {
      void stopBeforeGrant(operation.session).catch(() => {});
    });
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            operation.expired = true;
            sessionFail(operation.session ?? {});
            reject(new Error("owner_unverified"));
          }, timeout);
        }),
      ]);
    } catch {
      operation.expired = true;
      if (operation.session) {
        operation.session.sealed = true;
        sessionFail(operation.session);
      }
      // Cleanup must not extend authority or wait for an unbounded identity probe.
      void Promise.race([
        stopBeforeGrant(operation.session),
        new Promise((resolve) => {
          const cleanup = setTimeout(resolve, timeout);
          cleanup.unref();
        }),
      ]).catch(() => {});
      return recovery();
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }
  async function closeRegistration(ownerNonce) {
    const session = sessions.get(ownerNonce);
    if (!supported() || busy || !session?.granted || session.failed)
      return recovery();
    if (session.sealed) return ready();
    busy = true;
    session.sealed = true;
    let timer;
    try {
      await Promise.race([
        send(session, "SEAL\n"),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            sessionFail(session);
            reject(new Error("owner_unverified"));
          }, timeout);
        }),
      ]);
      return ready();
    } catch {
      sessionFail(session);
      return recovery();
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }
  return Object.freeze({ register, verify, closeRegistration });
}
