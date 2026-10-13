import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createLifetimeWitness } from "./owner-lifetime.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const id = (pid) => ({
  pid,
  platform: "darwin",
  bootId: sha("synthetic boot"),
  startToken: sha(`birth-${pid}`),
});
const ready = { state: "ready" },
  recovery = { state: "recovery_required", reason: "owner_unverified" };
const fact = (kind, role, identity, contextSHA) =>
  Buffer.from(
    `V1\t${kind}\t${role}\t${identity.pid}\t${identity.bootId}\t${identity.startToken}\t${contextSHA}\n`,
  );
function document(c, app = c.identity) {
  return Buffer.from(
    `${JSON.stringify({ version: 1, root: c.root, rootIdentity: c.rootIdentity, ownerNonce: c.ownerNonce, app })}\n`,
  );
}
async function put(path, bytes) {
  const handle = await fs.open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(join(tmpdir(), "omoc-witness-unit-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stat = await fs.stat(root, { bigint: true });
  const c = {
    root,
    rootIdentity: `${stat.dev}:${stat.ino}`,
    ownerNonce: randomUUID(),
    role: "app",
    identity: id(101),
  };
  const resourcesPath = join(root, "resources"),
    resource = join(resourcesPath, "owner-lifetime", "darwin-arm64");
  await fs.mkdir(resource, { recursive: true, mode: 0o700 });
  // Synthetic Mach-O header is data only. spawn is ALWAYS injected below.
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  await fs.writeFile(join(resource, "witness"), bytes, { mode: 0o700 });
  await fs.writeFile(
    join(resource, "manifest.json"),
    JSON.stringify({
      version: 1,
      platform: "darwin",
      arch: "arm64",
      sourceSha256: sha("synthetic source"),
      compiler: "Apple clang version synthetic",
      target: "arm64-apple-macos11",
      executableSha256: sha(bytes),
    }),
    { mode: 0o600 },
  );
  const gen = join(root, "lifetime-witness-v1", c.ownerNonce);
  const options = {
    resourcesPath,
    platform: "darwin",
    arch: "arm64",
    processIdentity: { capture: async (pid) => id(pid) },
    spawn() {
      throw new Error("unexpected synthetic spawn");
    },
    deadlineMs: 1000,
  };
  const make = (patch = {}) => createLifetimeWitness({ ...options, ...patch });
  const full = (child = null, role = "app") => ({
    ...c,
    role,
    identity: role === "app" ? c.identity : child,
    expectedRegistrations: { app: c.identity, child },
  });
  async function proofs(child = null) {
    await fs.mkdir(gen, { recursive: true, mode: 0o700 });
    const context = document(c),
      contextSHA = sha(context),
      values = { "context.json": context };
    for (const role of ["app", ...(child ? ["child"] : [])])
      for (const kind of ["registration", "exit"])
        values[`${role}.${kind}`] = fact(
          kind,
          role,
          role === "app" ? c.identity : child,
          contextSHA,
        );
    values.terminal = Buffer.from(
      `V1\tterminal\t${contextSHA}\t${sha(values["app.registration"])}\t${sha(values["app.exit"])}\t${child ? sha(values["child.registration"]) : "-"}\t${child ? sha(values["child.exit"]) : "-"}\n`,
    );
    for (const [name, bytes] of Object.entries(values))
      await put(join(gen, name), bytes);
    return values;
  }
  return { c, root, gen, resource, options, make, full, proofs };
}
function proxyIO(hook = {}) {
  return {
    ...fs,
    async open(path, flags, mode) {
      const handle = await fs.open(path, flags, mode);
      return new Proxy(handle, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== "function") return value;
          return async (...args) => {
            if (hook.before) await hook.before(path, key, args, target, flags);
            const result = await value.apply(target, args);
            if (hook.after) await hook.after(path, key, args, target, result);
            return result;
          };
        },
      });
    },
    ...(hook.methods ?? {}),
  };
}
async function originalBytes(gen) {
  const values = {};
  for (const name of await fs.readdir(gen)) {
    const path = join(gen, name),
      stat = await fs.lstat(path);
    values[name] = stat.isSymbolicLink()
      ? `link:${await fs.readlink(path)}`
      : await fs.readFile(path);
  }
  return values;
}

// All identities and helper events below are synthetic. No OS probe or helper runs.
function fakeHelper(f, control = {}) {
  const calls = [],
    helpers = [];
  const tasks = [];
  const spawn = (executable, argv, options) => {
    calls.push({ executable, argv, options });
    const helper = new EventEmitter();
    helpers.push(helper);
    helper.pid = 901;
    helper.unrefs = 0;
    helper.kills = [];
    helper.unref = () => {
      helper.unrefs++;
    };
    helper.kill = (signal) => {
      helper.kills.push(signal);
      helper.emit("exit", null, signal);
      return true;
    };
    helper.stdout = new PassThrough();
    helper.stdout.unref = () => {
      helper.unrefs++;
    };
    const emitACK = async (role, identity) => {
      const bytes = fact("registration", role, identity, argv[4]);
      await put(join(f.gen, `${role}.registration`), bytes);
      const dir = await fs.open(f.gen, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      if (control.beforeACK) await control.beforeACK(role, helper);
      if (!control.silent)
        helper.stdout.write(control.ack ?? `READY\t${role}\t${sha(bytes)}\n`);
      if (control.afterACK) await control.afterACK(role, helper);
    };
    helper.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const line = chunk.toString();
        calls.push({ line });
        if (control.writeError) {
          callback(new Error("synthetic failure"));
          return;
        }
        if (line === "SEAL\n") {
          callback();
          return;
        }
        const [, pid, bootId, startToken] = line.trimEnd().split("\t");
        const work = emitACK("child", {
          pid: Number(pid),
          platform: "darwin",
          bootId,
          startToken,
        }).then(() => callback(), callback);
        tasks.push(work);
      },
    });
    helper.stdin.unref = () => {
      helper.unrefs++;
    };
    if (control.throwSpawn) throw new Error("synthetic spawn failure");
    const task = new Promise((resolve) => setImmediate(resolve)).then(() =>
      emitACK("app", f.c.identity),
    );
    // Faults are translated to the owned error channel, with no rejected task leak.
    tasks.push(
      task.catch(() =>
        helper.emit("error", new Error("synthetic helper failure")),
      ),
    );
    return helper;
  };
  return { spawn, calls, helpers, settle: () => Promise.allSettled(tasks) };
}

test("fresh adapters accept complete app-only and app+child immutable facts after present flush", async (t) => {
  for (const child of [null, id(201)])
    await t.test(child ? "app+child" : "app-only", async (t) => {
      const f = await fixture(t);
      await f.proofs(child);
      let syncs = 0;
      const io = proxyIO({
        before(path, key, _args, _handle, flags) {
          if (key === "sync" && path.startsWith(f.gen)) {
            syncs++;
            if (path !== f.gen)
              assert.ok(
                (flags & 2) === 2,
                "immutable proof opened O_RDWR for current flush",
              );
          }
        },
      });
      assert.equal(await f.make({ io }).verify(f.full(child)), "exited");
      assert.equal(syncs, child ? 7 : 5);
      const bytes = await originalBytes(f.gen);
      assert.equal(await f.make().verify(f.full(child)), "exited");
      if (child)
        assert.equal(await f.make().verify(f.full(child, "child")), "exited");
      assert.deepEqual(await originalBytes(f.gen), bytes);
    });
});

test("complete surviving terminal is not rejected based on absent historical ACK or flush memory", async (t) => {
  const f = await fixture(t);
  await f.proofs(id(201));
  // Fixture publishes facts without adapter registration or a surviving helper.
  assert.equal(await f.make().verify(f.full(id(201))), "exited");
  for (const name of [
    "context.json",
    "app.registration",
    "app.exit",
    "child.registration",
    "child.exit",
    "terminal",
    "generation",
  ]) {
    const before = await originalBytes(f.gen);
    const io = proxyIO({
      before(path, key) {
        if (
          key === "sync" &&
          (name === "generation" ? path === f.gen : path === join(f.gen, name))
        )
          throw new Error("present flush failure");
      },
    });
    assert.equal(await f.make({ io }).verify(f.full(id(201))), "unverified");
    assert.deepEqual(await originalBytes(f.gen), before);
  }
});

test("expected membership is closed: missing/extra/replaced child, selected role, app identity and context", async (t) => {
  for (const kind of [
    "missing-child",
    "extra-child",
    "replaced-child",
    "role-mismatch",
    "app-mismatch",
    "root",
    "inode",
    "nonce",
    "unknown-field",
    "version",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        child = id(201);
      await f.proofs(kind === "extra-child" ? null : child);
      let input = f.full(child);
      if (kind === "missing-child") input = f.full();
      if (kind === "extra-child") input = f.full(child);
      if (kind === "replaced-child") input = f.full(id(202));
      if (kind === "role-mismatch") input = { ...input, role: "child" };
      if (kind === "app-mismatch") input.expectedRegistrations.app = id(102);
      if (kind === "root") input.root = join(f.root, "elsewhere");
      if (kind === "inode") input.rootIdentity = "0:0";
      if (kind === "nonce") input.ownerNonce = randomUUID();
      if (kind === "unknown-field") input.surprise = true;
      if (kind === "version")
        await fs.writeFile(join(f.gen, "terminal"), "V2\tterminal\n");
      const before = await originalBytes(f.gen);
      assert.notEqual(await f.make().verify(input), "exited");
      assert.deepEqual(await originalBytes(f.gen), before);
    });
});

test("partial/missing/corrupt/extra proof files and context duplicate members remain unchanged", async (t) => {
  for (const kind of [
    "partial-terminal",
    "partial-app-exit",
    "missing-exit",
    "wrong-hash",
    "extra-file",
    "duplicate-context",
    "oversize",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      await f.proofs();
      if (kind === "partial-terminal")
        await fs.writeFile(join(f.gen, "terminal"), "V1\tterminal\t");
      if (kind === "partial-app-exit")
        await fs.writeFile(join(f.gen, "app.exit"), "V1\texit\tapp\t");
      if (kind === "missing-exit") await fs.unlink(join(f.gen, "app.exit"));
      if (kind === "wrong-hash")
        await fs.writeFile(
          join(f.gen, "terminal"),
          (await fs.readFile(join(f.gen, "terminal"), "utf8")).replace(
            /[a-f0-9]{64}/,
            "0".repeat(64),
          ),
        );
      if (kind === "extra-file") await put(join(f.gen, "unexpected"), "KEEP");
      if (kind === "duplicate-context")
        await fs.writeFile(
          join(f.gen, "context.json"),
          document(f.c)
            .toString()
            .replace('{"version":1,', '{"version":1,"version":1,'),
        );
      if (kind === "oversize")
        await fs.writeFile(join(f.gen, "app.exit"), "x".repeat(4097));
      const before = await originalBytes(f.gen);
      const result = await f.make().verify(f.full());
      assert.notEqual(result, "exited");
      if (kind === "partial-app-exit")
        assert.equal(result, "identity_conflict");
      assert.deepEqual(await originalBytes(f.gen), before);
    });
});

test("symlinks/hardlinks/wrong owner or modes are rejected including context and directories", async (t) => {
  for (const kind of [
    "context-link",
    "exit-link",
    "context-hardlink",
    "exit-hardlink",
    "file-mode",
    "generation-mode",
    "base-link",
    "generation-link",
    "uid",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      await f.proofs();
      const selected = join(
        f.gen,
        kind.startsWith("context") ? "context.json" : "app.exit",
      );
      if (kind.endsWith("hardlink"))
        await fs.link(selected, join(f.root, "retained"));
      else if (kind === "context-link" || kind === "exit-link") {
        await fs.rename(selected, join(f.root, "retained"));
        await fs.symlink(join(f.root, "retained"), selected);
      } else if (kind === "file-mode") await fs.chmod(selected, 0o640);
      else if (kind === "generation-mode") await fs.chmod(f.gen, 0o750);
      else if (kind === "base-link" || kind === "generation-link") {
        const path =
          kind === "base-link" ? join(f.root, "lifetime-witness-v1") : f.gen;
        await fs.rename(path, `${path}-real`);
        await fs.symlink(`${path}-real`, path);
      }
      const io =
        kind === "uid"
          ? {
              ...fs,
              async lstat(path, options) {
                const stat = await fs.lstat(path, options);
                if (path === selected) stat.uid += 1n;
                return stat;
              },
            }
          : fs;
      assert.notEqual(await f.make({ io }).verify(f.full()), "exited");
    });
});

test("current verification rejects second-snapshot bytes/inode/path/directory drift", async (t) => {
  for (const kind of ["bytes", "replacement", "extra", "directory"])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      await f.proofs(id(201));
      let changed = false;
      const io = proxyIO({
        after: async (path, key) => {
          if (changed || path !== f.gen || key !== "sync") return;
          changed = true;
          if (kind === "bytes")
            await fs.writeFile(join(f.gen, "app.exit"), "KEEP CHANGED");
          if (kind === "replacement") {
            const bytes = await fs.readFile(join(f.gen, "app.exit"));
            await fs.unlink(join(f.gen, "app.exit"));
            await put(join(f.gen, "app.exit"), bytes);
          }
          if (kind === "extra") await put(join(f.gen, "child.extra"), "KEEP");
          if (kind === "directory") {
            await fs.rename(f.gen, `${f.gen}-old`);
            await fs.mkdir(f.gen, { mode: 0o700 });
          }
        },
      });
      assert.equal(await f.make({ io }).verify(f.full(id(201))), "unverified");
      assert.equal(changed, true);
    });
});

test("role calls never reuse cached proofs after terminal changes", async (t) => {
  const f = await fixture(t),
    child = id(201);
  await f.proofs(child);
  const adapter = f.make();
  assert.equal(await adapter.verify(f.full(child)), "exited");
  await fs.writeFile(join(f.gen, "terminal"), "partial");
  assert.equal(await adapter.verify(f.full(child, "child")), "unverified");
});

test("app and child registration use fixed private fd/argv protocol; seal has no exit authority", async (t) => {
  const f = await fixture(t),
    fake = fakeHelper(f),
    adapter = f.make({ spawn: fake.spawn });
  assert.ok(Object.isFrozen(adapter));
  assert.deepEqual(Object.keys(adapter), [
    "register",
    "verify",
    "closeRegistration",
  ]);
  assert.deepEqual(await adapter.register(f.c), ready);
  const launch = fake.calls[0];
  assert.equal(launch.executable, join(f.resource, "witness"));
  assert.deepEqual(launch.argv, [
    "--v1",
    "101",
    f.c.identity.bootId,
    f.c.identity.startToken,
    sha(document(f.c)),
    ...f.c.rootIdentity.split(":"),
  ]);
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.detached, true);
  assert.deepEqual(launch.options.env, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  });
  assert.deepEqual(launch.options.stdio.slice(0, 3), [
    "pipe",
    "pipe",
    "ignore",
  ]);
  assert.ok(launch.options.stdio.slice(3).every(Number.isInteger));
  assert.equal(fake.helpers[0].unrefs, 3);
  const child = { ...f.c, role: "child", identity: id(201) };
  assert.deepEqual(await adapter.register(child), ready);
  assert.equal(
    fake.calls[1].line,
    `CHILD\t201\t${id(201).bootId}\t${id(201).startToken}\n`,
  );
  assert.deepEqual(await adapter.closeRegistration(f.c.ownerNonce), ready);
  assert.equal(fake.calls[2].line, "SEAL\n");
  assert.deepEqual(await adapter.closeRegistration(f.c.ownerNonce), ready);
  assert.deepEqual(
    await adapter.register({ ...child, identity: id(202) }),
    recovery,
  );
  assert.equal(await adapter.verify(f.full(id(201))), "unverified");
  assert.deepEqual(fake.helpers[0].kills, []);
  await fake.settle();
});

test("invalid/concurrent/duplicate roles and unmatched child context never spawn or send", async (t) => {
  const f = await fixture(t);
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  const fake = fakeHelper(f, { beforeACK: () => wait }),
    adapter = f.make({ spawn: fake.spawn });
  assert.deepEqual(
    await adapter.register({ ...f.c, role: "child", identity: id(201) }),
    recovery,
  );
  assert.deepEqual(
    await adapter.register({
      ...f.c,
      identity: { ...id(101), unexpected: true },
    }),
    recovery,
  );
  const pending = adapter.register(f.c);
  assert.deepEqual(await adapter.register(f.c), recovery);
  release();
  assert.deepEqual(await pending, ready);
  assert.deepEqual(await adapter.register(f.c), recovery);
  assert.deepEqual(
    await adapter.register({ ...f.c, role: "child", identity: id(101) }),
    recovery,
  );
  assert.deepEqual(
    await adapter.register({
      ...f.c,
      rootIdentity: "0:0",
      role: "child",
      identity: id(201),
    }),
    recovery,
  );
  assert.equal(fake.calls.length, 1);
});

test("host target and helper identities must match before and after ACK; only owned helper can stop", async (t) => {
  for (const kind of [
    "target-before",
    "target-after",
    "helper-after",
    "helper-null",
    "helper-pid",
    "early-exit",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      let acknowledged = false;
      const fake = fakeHelper(f, {
        beforeACK: (_role, helper) => {
          acknowledged = true;
          if (kind === "early-exit") helper.emit("exit", 1);
        },
      });
      const processIdentity = {
        capture: async (pid) => {
          if (kind === "target-before" && pid === 101)
            return { ...id(pid), startToken: sha("reused") };
          if (kind === "target-after" && pid === 101 && acknowledged)
            return null;
          if (kind === "helper-after" && pid === 901 && acknowledged)
            return { ...id(pid), startToken: sha("reused") };
          if (kind === "helper-null" && pid === 901) return null;
          if (kind === "helper-pid" && pid === 901) return id(902);
          return id(pid);
        },
      };
      assert.deepEqual(
        await f.make({ spawn: fake.spawn, processIdentity }).register(f.c),
        recovery,
      );
      await fake.settle();
      await new Promise((resolve) => setImmediate(resolve));
      if (kind === "target-before") assert.equal(fake.calls.length, 0);
      if (
        kind === "helper-after" ||
        kind === "helper-pid" ||
        kind === "helper-null"
      )
        assert.deepEqual(fake.helpers[0].kills, []);
    });
});

test("invalid/oversized/duplicate/FAILED ACK or helper error fails closed and preserves bytes", async (t) => {
  for (const ack of [
    "FAILED\n",
    "READY\tchild\t" + "0".repeat(64) + "\n",
    "READY\tapp\t" + "0".repeat(64) + "\n",
    "x".repeat(257),
    "READY\tapp\tbad\r\n",
    Buffer.from([255, 10]),
  ])
    await t.test(String(ack).slice(0, 30), async (t) => {
      const f = await fixture(t),
        fake = fakeHelper(f, { ack });
      assert.deepEqual(
        await f.make({ spawn: fake.spawn }).register(f.c),
        recovery,
      );
      const bytes = await originalBytes(f.gen);
      await fake.settle();
      assert.deepEqual(await originalBytes(f.gen), bytes);
    });
  for (const event of [
    "duplicate",
    "error",
    "stdout-error",
    "stdin-error",
    "end",
    "partial",
  ])
    await t.test(event, async (t) => {
      const f = await fixture(t),
        fake = fakeHelper(f, {
          afterACK(_role, helper) {
            if (event === "duplicate")
              helper.stdout.write(
                `READY\tapp\t${sha(fact("registration", "app", f.c.identity, sha(document(f.c))))}\n`,
              );
            if (event === "error") helper.emit("error", new Error("synthetic"));
            if (event === "stdout-error")
              helper.stdout.emit("error", new Error("synthetic"));
            if (event === "stdin-error")
              helper.stdin.emit("error", new Error("synthetic"));
            if (event === "end") helper.stdout.end();
            if (event === "partial") helper.stdout.write("READY\t");
          },
        });
      assert.deepEqual(
        await f.make({ spawn: fake.spawn }).register(f.c),
        recovery,
      );
      await fake.settle();
    });
});

test("deadline prevents late ACK authority; helper and pipes own subsequent errors", async (t) => {
  const f = await fixture(t);
  let resume, entered;
  const wait = new Promise((r) => {
      resume = r;
    }),
    started = new Promise((r) => {
      entered = r;
    });
  const fake = fakeHelper(f, {
    beforeACK() {
      entered();
      return wait;
    },
  });
  const adapter = f.make({ spawn: fake.spawn, deadlineMs: 50 });
  const pending = adapter.register(f.c);
  await started;
  assert.deepEqual(await pending, recovery);
  resume();
  await fake.settle();
  assert.deepEqual(
    await adapter.register({ ...f.c, role: "child", identity: id(201) }),
    recovery,
  );
  assert.deepEqual(await adapter.closeRegistration(f.c.ownerNonce), recovery);
  fake.helpers[0].emit("error", new Error("late synthetic"));
  fake.helpers[0].stdin.emit("error", new Error("late synthetic"));
  fake.helpers[0].stdout.emit("error", new Error("late synthetic"));
  assert.equal(await adapter.verify(f.full()), "unverified");
});

test("post-grant child/control failure never kills attached app observer", async (t) => {
  const f = await fixture(t),
    control = {},
    fake = fakeHelper(f, control),
    adapter = f.make({ spawn: fake.spawn });
  assert.deepEqual(await adapter.register(f.c), ready);
  control.writeError = true;
  assert.deepEqual(
    await adapter.register({ ...f.c, role: "child", identity: id(201) }),
    recovery,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.helpers[0].kills, []);
  assert.deepEqual(await adapter.closeRegistration(f.c.ownerNonce), recovery);
});

test("context file flush/close or generation flush failure causes zero spawn and retains context bytes", async (t) => {
  for (const point of ["writeFile", "sync", "close", "directory-sync"])
    await t.test(point, async (t) => {
      const f = await fixture(t),
        fake = fakeHelper(f);
      const io = proxyIO({
        before(path, key, _args, handle) {
          if (
            (basename(path) === "context.json" && key === point) ||
            (path === f.gen && key === "sync" && point === "directory-sync")
          ) {
            if (key === "close")
              return handle.close().then(() => {
                throw new Error("synthetic close failure");
              });
            throw new Error("synthetic flush failure");
          }
        },
      });
      assert.deepEqual(
        await f.make({ spawn: fake.spawn, io }).register(f.c),
        recovery,
      );
      assert.equal(fake.calls.length, 0);
      await fs.access(join(f.gen, "context.json"));
    });
});

test("64 generations block new admission; unexpected old files and oversized records are retained", async (t) => {
  for (const kind of ["generations", "oversize", "unknown", "link"])
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        base = join(f.root, "lifetime-witness-v1");
      await fs.mkdir(base, { mode: 0o700 });
      const prior = join(base, randomUUID());
      await fs.mkdir(prior, { mode: 0o700 });
      if (kind === "generations")
        for (let i = 1; i < 64; i++)
          await fs.mkdir(join(base, randomUUID()), { mode: 0o700 });
      if (kind === "oversize")
        await put(join(prior, "terminal"), "x".repeat(4097));
      if (kind === "unknown") await put(join(prior, "secret-extra"), "KEEP");
      if (kind === "link")
        await fs.symlink(f.resource, join(prior, "context.json"));
      const names = await fs.readdir(base),
        fake = fakeHelper(f);
      assert.deepEqual(
        await f.make({ spawn: fake.spawn }).register(f.c),
        recovery,
      );
      assert.equal(fake.calls.length, 0);
      assert.deepEqual(await fs.readdir(base), names);
    });
});

test("unsupported targets, corrupt/replaced packaged resources and spawn failure produce zero authority", async (t) => {
  for (const kind of [
    "linux",
    "x64",
    "resource-hash",
    "resource-link",
    "spawn",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        fake = fakeHelper(f, { throwSpawn: kind === "spawn" });
      const patch = { spawn: fake.spawn };
      if (kind === "linux") patch.platform = kind;
      if (kind === "x64") patch.arch = kind;
      if (kind === "resource-hash")
        await fs.appendFile(join(f.resource, "witness"), "drift");
      if (kind === "resource-link") {
        await fs.rename(join(f.resource, "witness"), join(f.root, "retained"));
        await fs.symlink(join(f.root, "retained"), join(f.resource, "witness"));
      }
      assert.deepEqual(await f.make(patch).register(f.c), recovery);
      assert.equal(fake.calls.length, kind === "spawn" ? 1 : 0);
      if (["linux", "x64"].includes(kind))
        assert.equal(await f.make(patch).verify(f.full()), "unverified");
      await fake.settle();
    });
});

test("ACK hash cannot substitute for exact current registration/context bytes", async (t) => {
  for (const kind of [
    "context",
    "registration",
    "registration-link",
    "gen-retarget",
  ])
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        fake = fakeHelper(f, {
          beforeACK: async () => {
            if (kind === "context")
              await fs.writeFile(
                join(f.gen, "context.json"),
                "KEEP CHANGED CONTEXT",
              );
            if (kind === "registration")
              await fs.writeFile(
                join(f.gen, "app.registration"),
                "KEEP CHANGED REGISTRATION",
              );
            if (kind === "registration-link") {
              await fs.rename(
                join(f.gen, "app.registration"),
                join(f.root, "retained"),
              );
              await fs.symlink(
                join(f.root, "retained"),
                join(f.gen, "app.registration"),
              );
            }
            if (kind === "gen-retarget") {
              await fs.rename(f.gen, `${f.gen}-old`);
              await fs.mkdir(f.gen, { mode: 0o700 });
            }
          },
        });
      assert.deepEqual(
        await f.make({ spawn: fake.spawn }).register(f.c),
        recovery,
      );
      await fake.settle();
      assert.equal(fake.calls.length, 1);
    });
});

test("late helper identity capture after deadline cannot grant or kill another PID", async (t) => {
  for (const kind of ["exact", "conflict"])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      let resume, entered;
      const paused = new Promise((r) => {
          resume = r;
        }),
        started = new Promise((r) => {
          entered = r;
        });
      let helperCaptures = 0;
      const processIdentity = {
        capture: async (pid) => {
          if (pid === 901 && helperCaptures++ === 0) {
            entered();
            await paused;
          }
          return kind === "conflict" && pid === 901 ? id(902) : id(pid);
        },
      };
      const fake = fakeHelper(f),
        adapter = f.make({
          spawn: fake.spawn,
          processIdentity,
          deadlineMs: 50,
        });
      const pending = adapter.register(f.c);
      await started;
      assert.deepEqual(await pending, recovery);
      resume();
      await fake.settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(
        await adapter.closeRegistration(f.c.ownerNonce),
        recovery,
      );
      if (kind === "conflict") assert.deepEqual(fake.helpers[0].kills, []);
      else assert.deepEqual(fake.helpers[0].kills, ["SIGTERM"]);
    });
});

test("seal write failure or timeout keeps admission closed without stopping granted observer", async (t) => {
  for (const kind of ["error", "timeout"])
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        control = {},
        fake = fakeHelper(f, control),
        adapter = f.make({ spawn: fake.spawn, deadlineMs: 100 });
      assert.deepEqual(await adapter.register(f.c), ready);
      if (kind === "error") control.writeError = true;
      else {
        // A trusted test pipe that never completes the SEAL callback.
        const original = fake.helpers[0].stdin.write.bind(
          fake.helpers[0].stdin,
        );
        fake.helpers[0].stdin.write = (line, ...args) =>
          line === "SEAL\n" ? true : original(line, ...args);
      }
      assert.deepEqual(
        await adapter.closeRegistration(f.c.ownerNonce),
        recovery,
      );
      assert.deepEqual(
        await adapter.register({ ...f.c, role: "child", identity: id(201) }),
        recovery,
      );
      assert.deepEqual(fake.helpers[0].kills, []);
    });
});

test("pending child ACK blocks seal, second child and registration after app exit", async (t) => {
  const f = await fixture(t);
  let resume, entered;
  const wait = new Promise((r) => {
      resume = r;
    }),
    start = new Promise((r) => {
      entered = r;
    });
  const fake = fakeHelper(f, {
    beforeACK(role) {
      if (role === "child") {
        entered();
        return wait;
      }
    },
  });
  const adapter = f.make({ spawn: fake.spawn });
  assert.deepEqual(await adapter.register(f.c), ready);
  const child = { ...f.c, role: "child", identity: id(201) };
  const pending = adapter.register(child);
  await start;
  assert.deepEqual(await adapter.closeRegistration(f.c.ownerNonce), recovery);
  assert.deepEqual(
    await adapter.register({ ...child, identity: id(202) }),
    recovery,
  );
  fake.helpers[0].emit("exit", 1);
  resume();
  assert.deepEqual(await pending, recovery);
  await fake.settle();
  assert.deepEqual(fake.helpers[0].kills, []);
  assert.deepEqual(await adapter.register(child), recovery);
});

test("file descriptor/path drift during a read or flush never establishes an exit", async (t) => {
  for (const timing of ["read", "sync"])
    await t.test(timing, async (t) => {
      const f = await fixture(t);
      await f.proofs();
      let replaced = false;
      const io = proxyIO({
        after: async (path, key) => {
          if (
            path !== join(f.gen, "context.json") ||
            key !== timing ||
            replaced
          )
            return;
          replaced = true;
          const bytes = await fs.readFile(path);
          await fs.rename(path, join(f.root, "retained-context"));
          await put(path, bytes);
        },
      });
      assert.equal(await f.make({ io }).verify(f.full()), "unverified");
      assert.equal(replaced, true);
      assert.deepEqual(
        await fs.readFile(join(f.root, "retained-context")),
        document(f.c),
      );
    });
});

test("registration cannot switch to an identical copied generation behind the helper fd", async (t) => {
  for (const stage of ["app", "child"])
    await t.test(stage, async (t) => {
      const f = await fixture(t);
      const fake = fakeHelper(f, {
        beforeACK: async (role) => {
          if (role !== stage) return;
          const old = `${f.gen}-old`;
          await fs.rename(f.gen, old);
          await fs.mkdir(f.gen, { mode: 0o700 });
          for (const name of await fs.readdir(old))
            await put(join(f.gen, name), await fs.readFile(join(old, name)));
          // Keep the old directory outside the bounded generation namespace so the
          // test isolates inherited descriptor binding, rather than unknown entries.
          await fs.rename(old, join(f.root, "retained-generation"));
        },
      });
      const adapter = f.make({ spawn: fake.spawn });
      if (stage === "child")
        assert.deepEqual(await adapter.register(f.c), ready);
      assert.deepEqual(
        await adapter.register(
          stage === "app" ? f.c : { ...f.c, role: "child", identity: id(201) },
        ),
        recovery,
      );
      await fake.settle();
      await fs.access(join(f.root, "retained-generation", "app.registration"));
    });
});
