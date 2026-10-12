import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  lstat,
  writeFile,
  symlink,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startEventHost,
  eventHostForResources,
} from "./event-host-supervisor.mjs";
import { validateHostMessage } from "./event-host-protocol.mjs";
import { createDirectHandleObserver } from "./event-host-child.mjs";

class Child extends EventEmitter {
  pid = 4242;
  connected = true;
  messages = [];
  signals = [];
  constructor(behavior = {}) {
    super();
    this.behavior = behavior;
  }
  send(message, callback) {
    this.messages.push(message);
    callback(this.behavior.sendError ? new Error("not sent") : undefined);
    if (this.behavior.sendError) return;
    queueMicrotask(() => {
      if (message.type === "init") {
        if (this.behavior.init) return this.behavior.init(this, message);
        this.emit("message", {
          type: "ready",
          nonce: message.nonce,
          pid: this.pid,
          port: message.port || 43121,
          engineVersion: "1.4.2",
          serverVersion: "2.0.18",
        });
      } else if (message.type === "task-prepare") {
        if (this.behavior.taskPrepare)
          return this.behavior.taskPrepare(this, message);
        this.emit("message", {
          type: "task-preparation",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          request: message.request,
          result: { status: "held", reason: "inventory_unverified" },
        });
      } else if (["task-arm", "task-revoke"].includes(message.type)) {
        if (this.behavior.taskHandoff)
          return this.behavior.taskHandoff(this, message);
        this.emit("message", {
          type: "task-handoff-result",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          action: message.type === "task-arm" ? "arm" : "revoke",
          handoffId: message.request?.handoffId ?? message.handoffId,
          status: this.behavior.handoffStatus ?? "ok",
        });
      } else if (message.type === "observe") {
        if (this.behavior.observe) return this.behavior.observe(this, message);
        this.emit("message", {
          type: "observation",
          nonce: message.nonce,
          requestId: message.requestId,
          pid: this.pid,
          observerGap: !!this.behavior.gap,
          live: this.behavior.live ?? 0,
          allExited: !(this.behavior.live ?? 0),
        });
      } else if (message.type.startsWith("git-branch-restore-")) {
        if (this.behavior.gitBranchRestore)
          return this.behavior.gitBranchRestore(this, message);
        this.emit("message", {
          type: "git-branch-restore-result",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          result: message.type.endsWith("-prepare")
            ? { status: "prepared", token: "b".repeat(64) }
            : message.type.endsWith("-abort")
              ? { status: "aborted" }
              : { status: "unknown", reason: "io_failed" },
        });
      } else if (message.type.startsWith("git-commit-")) {
        if (this.behavior.gitCommit)
          return this.behavior.gitCommit(this, message);
        this.emit("message", {
          type: "git-commit-result",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          result:
            message.type === "git-commit-prepare"
              ? { status: "prepared", token: "c".repeat(64) }
              : message.type === "git-commit-publish"
                ? {
                    status: "committed",
                    commitOid: "b".repeat(40),
                    treeOid: "a".repeat(40),
                    referenceDigest: "e".repeat(64),
                    logDigests: [],
                    backups: [{ role: "branch_ref", backupId: null }],
                  }
                : { status: "aborted" },
        });
      } else if (message.type.startsWith("git-index-")) {
        if (this.behavior.gitIndex)
          return this.behavior.gitIndex(this, message);
        this.emit("message", {
          type: "git-index-result",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          result:
            message.type === "git-index-prepare"
              ? { status: "prepared", token: "d".repeat(64) }
              : message.type === "git-index-publish"
                ? {
                    status: "applied",
                    indexDigest: "e".repeat(64),
                    backupId: null,
                  }
                : { status: "aborted" },
        });
      } else if (message.type.startsWith("configuration-")) {
        if (this.behavior.configuration)
          return this.behavior.configuration(this, message);
        this.emit("message", {
          type: "configuration-result",
          nonce: message.nonce,
          pid: this.pid,
          requestId: message.requestId,
          result:
            message.type === "configuration-prepare"
              ? { status: "staged", token: "d".repeat(64) }
              : message.type === "configuration-publish"
                ? { status: "saved", version: "e".repeat(64) }
                : { status: "aborted" },
        });
      } else if (!this.behavior.stallStop) {
        this.emit("message", {
          type: "scope-closed",
          nonce: message.nonce,
          pid: this.pid,
          observerGap: !!this.behavior.gap,
          live: this.behavior.live ?? 0,
        });
        this.emit("exit", this.behavior.exitCode ?? 0, null);
      }
    });
  }
  kill(signal) {
    this.signals.push(signal);
    if (!this.behavior.stallKill)
      queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}
async function fixture(t, behavior = {}) {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "event-host-unit-")),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "profile");
  const namespace = { root: join(base, "durable"), fresh: true };
  for (const key of ["config", "data", "state"])
    namespace[key] = join(namespace.root, key);
  for (const path of Object.values(namespace).filter(
    (value) => typeof value === "string",
  ))
    await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(namespace.data, "sentinel"), "keep", { mode: 0o600 });
  const child = new Child(behavior),
    log = [];
  const nonce = "owner-nonce";
  const client = {
    server: {
      info: async ({ signal }) => {
        assert.ok(signal);
        log.push("info");
        return { pid: child.pid, version: "2.0.18" };
      },
    },
    session: {
      create() {
        throw new Error("bootstrap_forbidden");
      },
    },
  };
  const options = {
    runtimeEpoch: "main-epoch",
    eventHost: eventHostForResources(
      join(base, "resources"),
      "darwin",
      "arm64",
    ),
    namespace,
    platform: "darwin",
    arch: "arm64",
    startupTimeoutMs: 25,
    stopTimeoutMs: 10,
    requestTimeoutMs: 20,
    owner: {
      getNonce: () => nonce,
      assertOwned: async (token) => {
        assert.equal(token, nonce);
        log.push("owner");
        return { state: "ready" };
      },
      markSpawnIntent: async () => {
        log.push("intent");
        return { state: "ready" };
      },
      recordChild: async (_token, identity) => {
        log.push("record");
        assert.equal(identity.pid, child.pid);
        return { state: "ready" };
      },
    },
    preflight: async () => {
      log.push("preflight");
      return true;
    },
    verifyResources: async () => {
      log.push("verify");
      return {};
    },
    makeRoot: async () => {
      log.push("setup");
      await mkdir(root, { mode: 0o700 });
      return root;
    },
    spawnProcess: (engine, args, opts) => {
      log.push("spawn");
      assert.equal(engine, options.eventHost.enginePath);
      assert.deepEqual(args, [options.eventHost.hostPath]);
      assert.deepEqual(opts.stdio, ["ignore", "ignore", "ignore", "ipc"]);
      assert.equal("OPENCODE_SERVER_PASSWORD" in opts.env, false);
      assert.equal("NODE_OPTIONS" in opts.env, false);
      return child;
    },
    processIdentity: {
      capture: async (pid) => {
        log.push("capture");
        assert.ok(child.listenerCount("exit"));
        assert.ok(child.listenerCount("message"));
        return { pid };
      },
      observeExit: () => {
        log.push("exit-observed");
      },
    },
    makeClient: (url, password) => {
      log.push("client");
      assert.equal(url, "http://127.0.0.1:43121");
      assert.match(password, /^[a-f0-9]{64}$/);
      return client;
    },
  };
  const originalSend = child.send.bind(child);
  child.send = (...args) => {
    log.push(args[0].type);
    originalSend(...args);
  };
  return { options, child, log, root, namespace, client };
}

test("EventHost missing runtime epoch refuses before setup or spawn", async (t) => {
  const f = await fixture(t);
  delete f.options.runtimeEpoch;
  await assert.rejects(startEventHost(f.options), /native_permission_input/);
  assert.equal(f.log.includes("setup"), false);
  assert.equal(f.log.includes("spawn"), false);
});

test("EventHost carries Main epoch in closed initialization and requires overlay on both verification fences", async (t) => {
  const f = await fixture(t);
  const fences = [];
  f.options.runtimeEpoch = "original-main-epoch";
  f.options.verifyResources = async (_resources, options) => {
    fences.push(options);
    return {};
  };
  const runtime = await startEventHost(f.options);
  const message = f.child.messages.find((entry) => entry.type === "init");
  assert.equal(message.runtimeEpoch, "original-main-epoch");
  assert.equal(validateHostMessage(message, "child"), message);
  assert.equal(fences.length, 2);
  assert.ok(
    fences.every((options) => options.requirePermissionOverlay === true),
  );
  await runtime.stop();
});

test("EventHost unverified permission overlay refuses before setup or spawn", async (t) => {
  const f = await fixture(t);
  f.options.verifyResources = async (_resources, options) => {
    assert.equal(options.requirePermissionOverlay, true);
    throw new Error("required permission overlay missing");
  };
  await assert.rejects(startEventHost(f.options), /permission overlay missing/);
  assert.equal(f.log.includes("setup"), false);
  assert.equal(f.log.includes("spawn"), false);
});
async function retained(f, error) {
  assert.equal(error.cleanupComplete, false);
  assert.equal(error.recoveryPath, f.root);
  assert.ok((await lstat(f.root)).isDirectory());
  assert.ok((await lstat(join(f.namespace.data, "sentinel"))).isFile());
  const result = await error.stopOwnedSidecar();
  assert.equal(result.exited, false);
  assert.equal(result.cleanup, "incomplete");
}

test("private Skill RPC reserves a host request through owner checks and native settlement", async (t) => {
  const f = await fixture(t);
  let release, seen;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  f.client.rpc = () => ({
    observe: async (input, options) => {
      seen = { input, options };
      await pending;
      return { status: "ready" };
    },
  });
  const host = await startEventHost(f.options);
  const api = host.workbenchContext().nativeSkills;
  const task = api.observe({
    workspaceId: "workspace-one",
    workspacePath: "/synthetic/workspace",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  assert.equal(
    seen.input.nonce,
    f.child.messages.find((v) => v.type === "init").nonce,
  );
  assert.deepEqual(seen.options.location, {
    directory: "/synthetic/workspace",
  });
  release();
  await task;
  assert.equal((await host.observeIdle()).pendingHostRequests, 0);
  assert.equal((await host.stop()).exited, true);
  await assert.rejects(
    Promise.resolve().then(() =>
      api.observe({
        workspaceId: "workspace-one",
        workspacePath: "/synthetic/workspace",
      }),
    ),
    /event_host_held/,
  );
});

test("exact API, manifest DB, ownership fence, fresh session and clean settled stop", async (t) => {
  const f = await fixture(t);
  const host = await startEventHost(f.options);
  assert.deepEqual(
    Object.keys(host).sort(),
    [
      "snapshot",
      "workbenchContext",
      "stop",
      "observeIdle",
      "processId",
      "workspace",
      "eventHost",
    ].sort(),
  );
  assert.equal(host.workbenchContext().session, undefined);
  assert.equal(
    typeof host.workbenchContext().nativeTaskRequests?.invoke,
    "function",
  );
  assert.equal(typeof host.workbenchContext().client.server.info, "function");
  assert.equal(
    host.workbenchContext().client.server.info,
    host.workbenchContext().client.server.info,
  );
  assert.equal(host.snapshot().state, "connected");
  for (const [before, after] of [
    ["preflight", "setup"],
    ["verify", "setup"],
    ["intent", "spawn"],
    ["capture", "record"],
    ["record", "init"],
    ["init", "info"],
  ])
    assert.ok(
      f.log.indexOf(before) < f.log.indexOf(after),
      `${before} before ${after}`,
    );
  assert.ok(f.log.filter((x) => x === "preflight").length >= 2);
  const input = f.child.messages[0];
  validateHostMessage(input, "child");
  assert.equal(input.database, join(f.namespace.data, "event-host.sqlite"));
  assert.equal(input.configPath, join(f.namespace.config, "opencode"));
  assert.notEqual(input.nonce, input.password);
  assert.deepEqual(await host.stop(), {
    exited: true,
    forced: false,
    cleanup: "complete",
  });
  await assert.rejects(lstat(f.root), { code: "ENOENT" });
  assert.deepEqual(await host.stop(), {
    exited: true,
    forced: false,
    cleanup: "already_stopped",
  });
  assert.ok((await lstat(join(f.namespace.data, "sentinel"))).isFile());
});
for (const condition of ["owner", "preflight", "resource", "abort", "port"])
  test(`${condition} refusal does zero setup/spawn`, async (t) => {
    const f = await fixture(t);
    if (condition === "owner")
      f.options.owner.assertOwned = async () => ({
        state: "recovery_required",
      });
    if (condition === "preflight") f.options.preflight = async () => false;
    if (condition === "resource")
      f.options.verifyResources = async () => {
        throw new Error("corrupt_resource");
      };
    if (condition === "abort") f.options.signal = AbortSignal.abort();
    if (condition === "port") f.options.port = -1;
    await assert.rejects(startEventHost(f.options));
    assert.equal(f.log.includes("setup"), false);
    assert.equal(f.log.includes("spawn"), false);
  });
test("second preflight refusal retains durable bytes and never spawns", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.options.preflight = async () => ++calls === 1;
  await assert.rejects(
    startEventHost(f.options),
    (error) => error.cleanupComplete === true,
  );
  assert.equal(f.log.includes("spawn"), false);
  assert.ok((await lstat(join(f.namespace.data, "sentinel"))).isFile());
});
test("second resource validation detects drift before spawn intent", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.options.verifyResources = async () => {
    if (++calls > 1) throw new Error("resource_drift");
  };
  await assert.rejects(startEventHost(f.options));
  assert.equal(f.log.includes("intent"), false);
});
for (const kind of ["capture", "record", "capture-exit", "record-reject"])
  test(`${kind} spawn gap cannot send init or release cleanup`, async (t) => {
    const f = await fixture(t);
    if (kind === "capture")
      f.options.processIdentity.capture = async () => null;
    if (kind === "record")
      f.options.owner.recordChild = async () => ({
        state: "recovery_required",
      });
    if (kind === "record-reject")
      f.options.owner.recordChild = async () => {
        throw new Error("record_failed");
      };
    if (kind === "capture-exit")
      f.options.processIdentity.capture = async (pid) => {
        f.child.emit("exit", 0, null);
        return { pid };
      };
    let error;
    try {
      await startEventHost(f.options);
    } catch (value) {
      error = value;
    }
    assert.ok(error);
    assert.equal(
      f.child.messages.some((m) => m.type === "init"),
      false,
    );
    await retained(f, error);
  });
for (const mode of ["complete", "return", "error", "promised"]) {
  test(`async SDK log remains held until ${mode} settlement`, async (t) => {
    const f = await fixture(t);
    let completed = false;
    async function* stream() {
      try {
        yield { sequence: 0 };
        if (mode === "error") throw new Error("synthetic stream failure");
        yield { sequence: 1 };
      } finally {
        completed = true;
      }
    }
    f.client.session.log = () =>
      mode === "promised" ? Promise.resolve(stream()) : stream();
    const host = await startEventHost(f.options);
    const log = await host.workbenchContext().client.session.log();
    await assert.rejects(host.observeIdle(), /event_host_not_idle/);
    assert.equal((await log.next()).value.sequence, 0);
    await assert.rejects(host.observeIdle(), /event_host_not_idle/);
    if (mode === "return") await log.return();
    else if (mode === "error")
      await assert.rejects(log.next(), /synthetic stream failure/);
    else {
      for await (const entry of log) assert.equal(entry.sequence, 1);
    }
    assert.equal(completed, true);
    assert.equal((await host.observeIdle()).pendingHostRequests, 0);
    await log.return();
    assert.equal((await host.observeIdle()).pendingHostRequests, 0);
    assert.equal((await host.stop()).cleanup, "complete");
  });
}
for (const kind of [
  "wrongpid",
  "version",
  "malformed",
  "nonce",
  "duplicate",
  "timeout",
  "disconnect",
  "earlyexit",
  "senderror",
  "abort",
])
  test(`${kind} startup remains uncertain`, async (t) => {
    const f = await fixture(t, {
      sendError: kind === "senderror",
      init: (child, input) => {
        const message = {
          type: "ready",
          nonce: input.nonce,
          pid: child.pid,
          port: 43121,
          engineVersion: "1.4.2",
          serverVersion: "2.0.18",
        };
        if (kind === "timeout") return;
        if (kind === "disconnect") return child.emit("disconnect");
        if (kind === "earlyexit") return child.emit("exit", 0, null);
        if (kind === "abort") return controller.abort();
        if (kind === "wrongpid") message.pid++;
        if (kind === "version") message.serverVersion = "unknown";
        if (kind === "nonce") message.nonce = "b".repeat(64);
        if (kind === "malformed") message.secret = "extra";
        child.emit("message", message);
        if (kind === "duplicate") child.emit("message", message);
      },
    });
    const controller = new AbortController();
    if (kind === "abort") f.options.signal = controller.signal;
    let error;
    try {
      await startEventHost(f.options);
    } catch (value) {
      error = value;
    }
    assert.ok(error);
    await retained(f, error);
  });
for (const kind of ["pid", "version", "timeout"])
  test(`authenticated SDK ${kind} rejects before connection`, async (t) => {
    const f = await fixture(t);
    f.client.server.info = async () =>
      kind === "timeout"
        ? new Promise(() => {})
        : {
            pid: kind === "pid" ? 1 : f.child.pid,
            version: kind === "version" ? "unknown" : "2.0.18",
          };
    let error;
    try {
      await startEventHost(f.options);
    } catch (value) {
      error = value;
    }
    assert.ok(error);
    await retained(f, error);
  });
for (const behavior of [
  { gap: true },
  { live: 1 },
  { stallStop: true },
  { stallStop: true, stallKill: true },
  { exitCode: 1 },
])
  test(`uncertain stop ${JSON.stringify(behavior)} never cleans an exited engine`, async (t) => {
    const f = await fixture(t, behavior),
      host = await startEventHost(f.options);
    const result = await host.stop();
    assert.equal(result.exited, false);
    assert.equal(result.cleanup, "incomplete");
    assert.ok((await lstat(f.root)).isDirectory());
    assert.deepEqual(await host.stop(), result);
    assert.ok(f.child.signals.every((signal) => signal === "SIGKILL"));
  });
test("late invalid IPC disconnects and owned-stops connected host", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  f.child.emit("message", { type: "bad" });
  assert.equal(host.snapshot().state, "disconnected");
  assert.equal((await host.stop()).exited, false);
  assert.ok((await lstat(f.root)).isDirectory());
});
test("connected IPC loss holds and uses owned handle", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  f.child.connected = false;
  f.child.emit("disconnect");
  const result = await host.stop();
  assert.equal(result.exited, false);
  assert.deepEqual(f.child.signals, ["SIGKILL"]);
});
for (const kind of ["symlink", "hardlink"])
  test(`existing database ${kind} rejected before spawn`, async (t) => {
    const f = await fixture(t),
      database = join(f.namespace.data, "event-host.sqlite"),
      sentinel = join(f.namespace.data, "sentinel");
    if (kind === "symlink") await symlink(sentinel, database);
    else await link(sentinel, database);
    await assert.rejects(startEventHost(f.options));
    assert.equal(f.log.includes("spawn"), false);
  });
test("protocol rejects oversized, unknown, invalid nonce and wrong types without imports", () => {
  const nonce = "a".repeat(64);
  for (const message of [
    null,
    {},
    { type: "stop", nonce, extra: 1 },
    { type: "stop", nonce: "secret" },
    { type: "stop", nonce, extra: "x".repeat(20000) },
    { type: "scope-closed", nonce, pid: 1, observerGap: false, live: -1 },
  ])
    assert.throws(() =>
      validateHostMessage(
        message,
        message?.type === "scope-closed" ? "parent" : "child",
      ),
    );
  assert.doesNotThrow(() =>
    validateHostMessage({ type: "stop", nonce }, "child"),
  );
});
test("private descriptor publication accepts only closed agent source identity and supported text", () => {
  const operation = {
    runtimeEpoch: "epoch",
    operationId: "agent-save",
    workspaceId: "workspace",
    workspacePath: "/synthetic/workspace",
    kind: "agent",
    sourceName: "reviewer",
    directoryVersion: "b".repeat(64),
    text: "Body",
    expectation: "missing",
  };
  const message = {
    type: "configuration-prepare",
    nonce: "a".repeat(64),
    requestId: "c".repeat(64),
    operation,
  };
  assert.equal(validateHostMessage(message, "child"), message);
  for (const changed of [
    { sourceName: "../reviewer" },
    { directoryVersion: undefined },
    { extra: true },
    { text: '---\n{"model":"foreign"}\n---\nBody' },
    { version: "d".repeat(64) },
  ])
    assert.throws(() =>
      validateHostMessage(
        { ...message, operation: { ...operation, ...changed } },
        "child",
      ),
    );
});
test("direct handle proof settles only actual exit and retains observation gaps", async () => {
  let bunResolve;
  const handle = new EventEmitter(),
    bunHandle = {
      exited: new Promise((resolve) => {
        bunResolve = resolve;
      }),
    };
  const node = Object.fromEntries(
    ["spawn", "exec", "execFile", "fork"].map((key) => [key, () => handle]),
  );
  node.spawnSync = () => ({ status: 0, pid: 7 });
  node.execSync = () => {};
  node.execFileSync = () => {};
  const bun = { spawn: () => bunHandle, spawnSync: () => ({ exitCode: 0 }) };
  const observer = createDirectHandleObserver(node, bun);
  node.spawn();
  bun.spawn();
  assert.equal((await observer.settle(2)).live, 2);
  handle.emit("exit", 0, null);
  bunResolve(0);
  assert.deepEqual(await observer.settle(10), { observerGap: false, live: 0 });
  assert.throws(() => node.execSync());
  assert.deepEqual(await observer.settle(2), { observerGap: true, live: 0 });
});

test("private idle proof precedes SIGKILL but never authorizes clean stop", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  assert.deepEqual(await host.observeIdle(), {
    pid: f.child.pid,
    observerGap: false,
    live: 0,
    allExited: true,
    pendingHostRequests: 0,
    scope: "direct JS ChildProcess/Bun handles only",
  });
  f.child.kill("SIGKILL");
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(host.snapshot().state, "disconnected");
  const stopped = await host.stop();
  assert.equal(stopped.exited, false);
  assert.equal(stopped.cleanup, "incomplete");
  assert.ok((await lstat(f.root)).isDirectory());
});
test("SDK pending call prevents idle proof, stable wrappers preserve method identity", async (t) => {
  const f = await fixture(t);
  let finish;
  f.client.session.get = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const host = await startEventHost(f.options),
    client = host.workbenchContext().client;
  const pending = client.session.get();
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  assert.equal(
    f.child.messages.some((m) => m.type === "observe"),
    false,
  );
  finish({ id: "fixture" });
  await pending;
  assert.equal((await host.observeIdle()).allExited, true);
  assert.equal((await host.stop()).cleanup, "complete");
});
for (const kind of [
  "gap",
  "live",
  "pid",
  "nonce",
  "requestId",
  "timeout",
  "identity",
  "owner",
])
  test(`idle ${kind} cannot supply forced-reopen proof`, async (t) => {
    const f = await fixture(t, {
      observe: (child, input) => {
        if (kind === "timeout") return;
        child.emit("message", {
          type: "observation",
          nonce: kind === "nonce" ? "c".repeat(64) : input.nonce,
          requestId: kind === "requestId" ? "c".repeat(64) : input.requestId,
          pid: kind === "pid" ? 1 : child.pid,
          observerGap: kind === "gap",
          live: kind === "live" ? 1 : 0,
          allExited: kind !== "live",
        });
      },
    });
    const host = await startEventHost(f.options);
    if (kind === "identity")
      f.options.processIdentity.capture = async () => ({ pid: 1 });
    if (kind === "owner")
      f.options.owner.assertOwned = async () => ({
        state: "recovery_required",
      });
    await assert.rejects(host.observeIdle());
    if (kind === "live") assert.equal(host.snapshot().state, "connected");
    else assert.equal(host.snapshot().state, "disconnected");
    await host.stop();
  });
test("idle fence blocks fresh SDK calls until exact correlated observation completes", async (t) => {
  const f = await fixture(t, { observe: () => {} });
  f.client.session.get = async () => ({});
  const host = await startEventHost(f.options),
    proof = host.observeIdle();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.throws(
    () => host.workbenchContext().client.session.get(),
    /event_host_held/,
  );
  const request = f.child.messages.find((m) => m.type === "observe");
  assert.ok(request);
  f.child.emit("message", {
    type: "observation",
    nonce: request.nonce,
    requestId: request.requestId,
    pid: f.child.pid,
    observerGap: false,
    live: 0,
    allExited: true,
  });
  await proof;
  await host.stop();
});
for (const kind of [
  "capture-timeout",
  "record-timeout",
  "early-ipc",
  "spawn-throw",
])
  test(`${kind} cannot initialize or erase spawn intent`, async (t) => {
    const f = await fixture(t);
    if (kind === "capture-timeout")
      f.options.processIdentity.capture = () => new Promise(() => {});
    if (kind === "record-timeout")
      f.options.owner.recordChild = () => new Promise(() => {});
    if (kind === "early-ipc")
      f.options.processIdentity.capture = async (pid) => {
        f.child.emit("message", {
          type: "ready",
          nonce: "a".repeat(64),
          pid,
          port: 43121,
          engineVersion: "1.4.2",
          serverVersion: "2.0.18",
        });
        return { pid };
      };
    if (kind === "spawn-throw")
      f.options.spawnProcess = () => {
        throw new Error("spawn_failed");
      };
    let error;
    try {
      await startEventHost(f.options);
    } catch (value) {
      error = value;
    }
    assert.ok(error);
    assert.equal(
      f.child.messages.some((m) => m.type === "init"),
      false,
    );
    await retained(f, error);
  });
test("production validator is mandatory when no trusted injection supplied", async (t) => {
  const f = await fixture(t);
  delete f.options.verifyResources;
  await assert.rejects(startEventHost(f.options));
  assert.equal(f.log.includes("setup"), false);
  assert.equal(f.log.includes("spawn"), false);
});
for (const suffix of ["-wal", "-shm", "-journal"])
  test(`SQLite ${suffix} symlink denied before spawn`, async (t) => {
    const f = await fixture(t);
    await symlink(
      join(f.namespace.data, "sentinel"),
      join(f.namespace.data, `event-host.sqlite${suffix}`),
    );
    await assert.rejects(startEventHost(f.options));
    assert.equal(f.log.includes("spawn"), false);
  });
test("scope proof without exact physical exit cannot clean root", async (t) => {
  const f = await fixture(t, { stallStop: true, stallKill: true }),
    host = await startEventHost(f.options);
  const originalSend = f.child.send.bind(f.child);
  f.child.send = (message, callback) => {
    originalSend(message, callback);
    if (message.type === "stop")
      queueMicrotask(() =>
        f.child.emit("message", {
          type: "scope-closed",
          nonce: message.nonce,
          pid: f.child.pid,
          observerGap: false,
          live: 0,
        }),
      );
  };
  const result = await host.stop();
  assert.equal(result.exited, false);
  assert.equal(result.forced, true);
  assert.ok((await lstat(f.root)).isDirectory());
});

test("configuration IPC accepts only bounded closed fixed-source messages and results", () => {
  const nonce = "a".repeat(64),
    requestId = "b".repeat(64);
  const operation = {
    runtimeEpoch: "epoch",
    operationId: "op",
    workspaceId: "workspace",
    workspacePath: "/synthetic",
    kind: "instructions",
    text: "a".repeat(32768),
    expectation: "missing",
  };
  const message = {
    type: "configuration-prepare",
    nonce,
    requestId,
    operation,
  };
  assert.equal(validateHostMessage(message, "child"), message);
  for (const bad of [
    { ...message, operation: { ...operation, path: "/private" } },
    { ...message, operation: { ...operation, text: "\ud800" } },
    { ...message, operation: { ...operation, text: "a".repeat(32769) } },
    { ...message, operation: { ...operation, version: "c".repeat(64) } },
    {
      ...message,
      operation: { ...operation, expectation: "version", version: "no" },
    },
    { ...message, operation: { ...operation, approved: true } },
  ])
    assert.throws(() => validateHostMessage(bad, "child"), /invalid_ipc/);
  const response = {
    type: "configuration-result",
    nonce,
    requestId,
    pid: 123,
    result: { status: "saved", version: "c".repeat(64) },
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  assert.throws(
    () =>
      validateHostMessage(
        { ...response, result: { ...response.result, content: "PRIVATE" } },
        "parent",
      ),
    /invalid_ipc/,
  );
  assert.throws(
    () =>
      validateHostMessage(
        {
          ...response,
          result: { ...response.result, backupId: "../../private" },
        },
        "parent",
      ),
    /invalid_ipc/,
  );
});
test("Skill IPC binds a fixed nested source and directory baseline without widening legacy targets", () => {
  const operation = {
    runtimeEpoch: "epoch",
    operationId: "op",
    workspaceId: "workspace",
    workspacePath: "/synthetic",
    kind: "skill",
    sourceName: "small-skill",
    directoryVersion: "c".repeat(64),
    text: "# Body\n",
    expectation: "missing",
  };
  const message = {
    type: "configuration-prepare",
    nonce: "a".repeat(64),
    requestId: "b".repeat(64),
    operation,
  };
  assert.equal(validateHostMessage(message, "child"), message);
  for (const fields of [
    { sourceName: "../outside" },
    { sourceName: "a/b" },
    { directoryVersion: undefined },
    { directoryVersion: "no" },
    { path: "/outside" },
    { kind: "instructions" },
    { text: '---\nname: !!js/function "code"\n---\nbody' },
    { version: "d".repeat(64) },
  ])
    assert.throws(
      () =>
        validateHostMessage(
          { ...message, operation: { ...operation, ...fields } },
          "child",
        ),
      /invalid_ipc/,
    );
  const legacy = { ...operation, kind: "instructions" };
  delete legacy.sourceName;
  delete legacy.directoryVersion;
  assert.equal(
    validateHostMessage({ ...message, operation: legacy }, "child").operation,
    legacy,
  );
  assert.throws(
    () =>
      validateHostMessage(
        { ...message, operation: { ...legacy, sourceName: "small-skill" } },
        "child",
      ),
    /invalid_ipc/,
  );
  for (const result of [
    {
      status: "saved",
      version: "d".repeat(64),
      backupId: `.omoc-configuration-${"e".repeat(64)}.skill.backup`,
    },
    { status: "unknown", reason: "path_missing" },
  ]) {
    const response = {
      type: "configuration-result",
      nonce: message.nonce,
      requestId: message.requestId,
      pid: 123,
      result,
    };
    assert.equal(validateHostMessage(response, "parent"), response);
  }
});

test("private configuration phases hold idle, preserve correlation and do not expose a renderer path API", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options),
    save = host.workbenchContext().configurationSave;
  t.after(() => host.stop());
  const operation = {
    runtimeEpoch: "epoch",
    operationId: "op",
    workspaceId: "workspace",
    workspacePath: f.workspace ?? join(f.root, "workspace"),
    kind: "instructions",
    text: "SYNTHETIC",
    expectation: "missing",
  };
  const staged = await save.prepare(operation);
  assert.equal(staged.status, "staged");
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  await assert.rejects(save.prepare(operation), /configuration_busy/);
  await assert.rejects(
    save.publish({ token: "f".repeat(64) }),
    /invalid_configuration_token/,
  );
  const result = await save.publish({ token: staged.token });
  assert.equal(result.status, "saved");
  assert.equal(
    (await save.abort({ token: staged.token })).reason,
    "invalid_token",
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "configuration-publish").length,
    1,
  );
});

test("configuration lane reserves before asynchronous owner proof and rejects a second correlation", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const original = f.options.owner.assertOwned;
  f.options.owner.assertOwned = async (...args) => {
    await gate;
    return original(...args);
  };
  const save = host.workbenchContext().configurationSave,
    operation = {
      runtimeEpoch: "epoch",
      operationId: "op",
      workspaceId: "workspace",
      workspacePath: join(f.root, "workspace"),
      kind: "instructions",
      text: "SYNTHETIC",
      expectation: "missing",
    };
  const first = save.prepare(operation);
  await assert.rejects(save.prepare(operation), /configuration_busy/);
  resume();
  const staged = await first;
  assert.equal(staged.status, "staged");
  assert.equal(
    f.child.messages.filter((m) => m.type === "configuration-prepare").length,
    1,
  );
  await save.abort({ token: staged.token });
});

test("mismatched configuration response holds and stops exact owned child without replay", async (t) => {
  const f = await fixture(t, {
      configuration(child, message) {
        child.emit("message", {
          type: "configuration-result",
          nonce: message.nonce,
          pid: child.pid,
          requestId: "0".repeat(64),
          result: { status: "staged", token: "d".repeat(64) },
        });
      },
    }),
    host = await startEventHost(f.options);
  const save = host.workbenchContext().configurationSave;
  await assert.rejects(
    save.prepare({
      runtimeEpoch: "epoch",
      operationId: "op",
      workspaceId: "workspace",
      workspacePath: join(f.root, "workspace"),
      kind: "instructions",
      text: "SYNTHETIC",
      expectation: "missing",
    }),
    /configuration_unconfirmed/,
  );
  const stopped = await host.stop();
  assert.equal(stopped.cleanup, "incomplete");
  assert.equal(
    f.child.messages.filter((m) => m.type === "configuration-prepare").length,
    1,
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "configuration-publish").length,
    0,
  );
});

test("Agent publication IPC accepts its exact backup and rejects unsafe/unsupported suffixes", () => {
  const response = {
    type: "configuration-result",
    nonce: "a".repeat(64),
    requestId: "b".repeat(64),
    pid: 123,
    result: {
      status: "saved",
      version: "c".repeat(64),
      backupId: `.omoc-configuration-${"d".repeat(64)}.agent.backup`,
    },
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  for (const backupId of [
    response.result.backupId + "/x",
    response.result.backupId.replace(".agent.", ".unknown."),
    "../" + response.result.backupId,
  ]) {
    assert.throws(
      () =>
        validateHostMessage(
          { ...response, result: { ...response.result, backupId } },
          "parent",
        ),
      /invalid_ipc/,
    );
  }
});

const gitIndexOperation = () => ({
  runtimeEpoch: "epoch",
  operationId: "operation",
  workspaceId: "workspace",
  workspacePath: "/SYNTHETIC/work",
  digest: "a".repeat(64),
  target: {
    action: "stage",
    paths: ["a.txt"],
    previewDigest: "a".repeat(64),
    headOid: null,
    indexExists: false,
    indexDigest:
      "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae",
    nextIndexDigest: "e".repeat(64),
    objectFormat: "sha1",
  },
  artifact: {
    root: "/SYNTHETIC/artifact",
    dev: "1",
    ino: "2",
    manifest: { path: "manifest.json", bytes: 100, digest: "a".repeat(64) },
  },
});
test("private Git index phases share owned lane but never accept configuration token authority", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  const context = host.workbenchContext();
  const prepared = await context.gitIndex.prepare(gitIndexOperation());
  assert.equal(prepared.status, "prepared");
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  await assert.rejects(
    context.configurationSave.publish({ token: prepared.token }),
    /invalid_configuration_token/,
  );
  await assert.rejects(
    context.gitIndex.prepare(gitIndexOperation()),
    /configuration_busy/,
  );
  const result = await context.gitIndex.publish({ token: prepared.token });
  assert.equal(result.status, "applied");
  assert.equal(result.backupId, null);
  assert.equal(
    (await context.gitIndex.abort({ token: prepared.token })).reason,
    "invalid_request",
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-index-publish").length,
    1,
  );
});
test("Git index logical timeout keeps actual caller held until exact owned child exit", async (t) => {
  const f = await fixture(t, {
      gitIndex() {},
      stallStop: true,
      stallKill: true,
    }),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  let settled = false;
  const call = host
    .workbenchContext()
    .gitIndex.prepare(gitIndexOperation())
    .finally(() => {
      settled = true;
    });
  const rejected = assert.rejects(call, /git_index_unconfirmed/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled, false);
  assert.ok(f.child.signals.length > 0);
  f.child.emit("exit", null, "SIGKILL");
  await rejected;
  assert.equal(settled, true);
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-index-prepare").length,
    1,
  );
});

const gitCommitOperation = () => ({
  ...gitIndexOperation(),
  target: {
    objectFormat: "sha1",
    previewDigest: "a".repeat(64),
    indexDigest: "a".repeat(64),
    headOid: null,
    treeOid: "a".repeat(40),
    treeDigest: "a".repeat(64),
    commitOid: "b".repeat(40),
    commitBodyDigest: "a".repeat(64),
    reference: {
      kind: "branch",
      name: "refs/heads/main",
      exists: false,
      digest:
        "f3560bbc703230ea0f066682a64be64c85613c9fd03cc4fb1f0cb8af9642818d",
      nextDigest: "e".repeat(64),
    },
    logs: [],
  },
});
test("Commit shares actual supervisor lane and cannot publish with another policy token", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  const context = host.workbenchContext();
  const prepared = await context.gitCommit.prepare(gitCommitOperation());
  assert.equal(prepared.status, "prepared");
  await assert.rejects(
    context.gitIndex.publish({ token: prepared.token }),
    /invalid_git_index_token/,
  );
  await assert.rejects(
    context.configurationSave.publish({ token: prepared.token }),
    /invalid_configuration_token/,
  );
  await assert.rejects(
    context.gitIndex.prepare(gitIndexOperation()),
    /configuration_busy/,
  );
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  const committed = await context.gitCommit.publish({ token: prepared.token });
  assert.equal(committed.status, "committed");
  assert.equal(
    (await context.gitCommit.abort({ token: prepared.token })).reason,
    "invalid_request",
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-commit-publish").length,
    1,
  );
});
test("Commit logical timeout holds actual call until exact observed owned child exit", async (t) => {
  const f = await fixture(t, {
      gitCommit() {},
      stallStop: true,
      stallKill: true,
    }),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  let settled = false;
  const call = host
    .workbenchContext()
    .gitCommit.prepare(gitCommitOperation())
    .finally(() => {
      settled = true;
    });
  const rejected = assert.rejects(call, /git_commit_unconfirmed/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled, false);
  assert.ok(f.child.signals.length > 0);
  f.child.emit("exit", null, "SIGKILL");
  await rejected;
  assert.equal(settled, true);
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-commit-prepare").length,
    1,
  );
});

const gitBranchRestoreOperation = () => ({
  ...gitIndexOperation(),
  target: {
    action: "create",
    objectFormat: "sha1",
    previewDigest: "a".repeat(64),
    occupancyDigest: "a".repeat(64),
    branch: "refs/heads/next",
    source: null,
    currentBranch: "refs/heads/main",
    headOid: "1".repeat(40),
    nextHeadOid: "1".repeat(40),
    treeOid: "2".repeat(40),
    headDigest: "a".repeat(64),
    indexExists: true,
    indexDigest: "a".repeat(64),
    identityDigest: "a".repeat(64),
    timestamp: 1,
    paths: [],
    metadata: [
      {
        role: "branch_ref",
        before: null,
        after: { bytes: 41, digest: "a".repeat(64) },
      },
    ],
  },
});
test("Branch restore shares one lane and rejects every foreign token kind", async (t) => {
  const f = await fixture(t),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  const context = host.workbenchContext();
  const prepared = await context.gitBranchRestore.prepare(
    gitBranchRestoreOperation(),
  );
  assert.equal(prepared.status, "prepared");
  for (const name of ["gitCommit", "gitIndex", "configurationSave"])
    await assert.rejects(
      context[name].publish({ token: prepared.token }),
      /invalid_.*_token/,
    );
  await assert.rejects(
    context.gitCommit.prepare(gitCommitOperation()),
    /configuration_busy/,
  );
  await assert.rejects(host.observeIdle(), /event_host_not_idle/);
  assert.equal(
    (await context.gitBranchRestore.publish({ token: prepared.token })).status,
    "unknown",
  );
  assert.equal(
    (await context.gitBranchRestore.abort({ token: prepared.token })).reason,
    "invalid_request",
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-branch-restore-publish")
      .length,
    1,
  );
  const commit = await context.gitCommit.prepare(gitCommitOperation());
  await assert.rejects(
    context.gitBranchRestore.publish({ token: commit.token }),
    /invalid_git_branch_restore_token/,
  );
  await context.gitCommit.abort({ token: commit.token });
});
test("Branch restore logical timeout keeps original call held until exact owned exit", async (t) => {
  const f = await fixture(t, {
      gitBranchRestore() {},
      stallStop: true,
      stallKill: true,
    }),
    host = await startEventHost(f.options);
  t.after(() => host.stop());
  let settled = false;
  const call = host
    .workbenchContext()
    .gitBranchRestore.prepare(gitBranchRestoreOperation())
    .finally(() => {
      settled = true;
    });
  const rejected = assert.rejects(call, /git_branch_restore_unconfirmed/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled, false);
  assert.ok(f.child.signals.length > 0);
  f.child.emit("exit", null, "SIGKILL");
  await rejected;
  assert.equal(settled, true);
  assert.equal(
    f.child.messages.filter((m) => m.type === "git-branch-restore-prepare")
      .length,
    1,
  );
});

const taskPreparationRequest = () => ({
  originKind: "prompt",
  origin: {
    runtimeEpoch: "main-epoch",
    operationId: "original-send",
    type: "message.send",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace",
  appSessionId: "session",
  nativeSessionId: "native-session",
  inputDigest: "b".repeat(64),
});
test("private task preparation authenticates held response and revokes on stop", async (t) => {
  const f = await fixture(t);
  const runtime = await startEventHost(f.options);
  const tasks = runtime.workbenchContext().nativeTasks;
  assert.equal(typeof tasks?.prepare, "function");
  assert.deepEqual(await tasks.prepare(taskPreparationRequest()), {
    status: "held",
    reason: "inventory_unverified",
  });
  const messages = f.child.messages.filter((m) => m.type === "task-prepare");
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].request, taskPreparationRequest());
  await runtime.stop();
  await assert.rejects(() => tasks.prepare(taskPreparationRequest()));
  assert.equal(
    f.child.messages.filter((m) => m.type === "task-prepare").length,
    1,
  );
});
test("private task preparation refuses a same-ID response for different original input", async (t) => {
  const f = await fixture(t, {
    taskPrepare(child, message) {
      child.emit("message", {
        type: "task-preparation",
        nonce: message.nonce,
        pid: child.pid,
        requestId: message.requestId,
        request: { ...message.request, inputDigest: "c".repeat(64) },
        result: { status: "held", reason: "inventory_unverified" },
      });
    },
  });
  const runtime = await startEventHost(f.options);
  const tasks = runtime.workbenchContext().nativeTasks;
  assert.equal(typeof tasks?.prepare, "function");
  await assert.rejects(() => tasks.prepare(taskPreparationRequest()));
  await runtime.stop();
});

test("private task preparation rejects wrong epoch before owner await or IPC", async (t) => {
  const f = await fixture(t);
  const runtime = await startEventHost(f.options);
  const ownerChecks = f.log.filter((value) => value === "owned").length;
  const request = taskPreparationRequest();
  request.origin.runtimeEpoch = "old-epoch";
  await assert.rejects(() =>
    runtime.workbenchContext().nativeTasks.prepare(request),
  );
  assert.equal(
    f.child.messages.some((message) => message.type === "task-prepare"),
    false,
  );
  assert.equal(f.log.filter((value) => value === "owned").length, ownerChecks);
  await runtime.stop();
});
test("private task preparation cannot send after stop during owner await", async (t) => {
  const f = await fixture(t);
  const runtime = await startEventHost(f.options);
  let release, entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  f.options.owner.assertOwned = () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = runtime
    .workbenchContext()
    .nativeTasks.prepare(taskPreparationRequest());
  const rejected = assert.rejects(pending);
  await waiting;
  const stopping = runtime.stop();
  release({ state: "ready" });
  await rejected;
  await stopping;
  assert.equal(
    f.child.messages.some((message) => message.type === "task-prepare"),
    false,
  );
});
test("private task preparation rechecks owner after authenticated held response", async (t) => {
  const f = await fixture(t);
  const runtime = await startEventHost(f.options);
  let checks = 0;
  f.options.owner.assertOwned = async () => ({
    state: ++checks === 1 ? "ready" : "recovery_required",
  });
  await assert.rejects(
    () =>
      runtime.workbenchContext().nativeTasks.prepare(taskPreparationRequest()),
    /owner_unverified/,
  );
  assert.equal(checks, 2);
  await runtime.stop();
});

test("private bootstrap preparation transmits only reserved metadata and remains held", async (t) => {
  const f = await fixture(t),
    runtime = await startEventHost(f.options);
  const request = {
    originKind: "bootstrap",
    origin: {
      runtimeEpoch: "main-epoch",
      operationId: "original-create",
      type: "session.create",
      digest: "a".repeat(64),
    },
    workspaceId: "workspace",
    workspacePath: "/checked/workspace",
    appSessionId: "reserved-session",
    plannedNativeSessionId: "ses_planned",
    metadataDigest: "b".repeat(64),
    reservation: {
      kind: "bootstrap",
      step: "native.create",
      reservationDigest: "c".repeat(64),
      parentIdentityDigest: null,
    },
  };
  const tasks = runtime.workbenchContext().nativeTasks;
  const plan = {
    handoffId: "4f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a11",
    stageArgumentDigest: "d".repeat(64),
  };
  assert.deepEqual(await tasks.prepare(request, plan), {
    status: "held",
    reason: "inventory_unverified",
  });
  const sent = f.child.messages.filter((m) => m.type === "task-prepare");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].request, request);
  await runtime.stop();
  await assert.rejects(() => tasks.prepare(request, plan));
  assert.equal(
    f.child.messages.filter((m) => m.type === "task-prepare").length,
    1,
  );
});

const tid = (n) =>
  `5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a${String(n).padStart(2, "0")}`;
const bootstrapTaskRequest = () => ({
  originKind: "bootstrap",
  origin: {
    runtimeEpoch: "main-epoch",
    operationId: "original-create",
    type: "session.create",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace",
  workspacePath: "/checked/workspace",
  appSessionId: "reserved-session",
  plannedNativeSessionId: "ses_planned",
  metadataDigest: "b".repeat(64),
  reservation: {
    kind: "bootstrap",
    step: "native.create",
    reservationDigest: "c".repeat(64),
    parentIdentityDigest: null,
  },
});
const bootstrapPlan = () => ({
  handoffId: tid(3),
  stageArgumentDigest: "d".repeat(64),
});
const preparedBehavior = {
  taskPrepare(child, message) {
    child.emit("message", {
      type: "task-preparation",
      nonce: message.nonce,
      pid: child.pid,
      requestId: message.requestId,
      request: message.request,
      result: {
        status: "prepared",
        taskScopeId: tid(1),
        locationId: tid(2),
        projectId: "project",
        modeGeneration: 1,
        inventoryGeneration: 1,
        launchId: "launch-1",
      },
    });
  },
};
const armRowFor = (prepared) => ({
  handoffId: bootstrapPlan().handoffId,
  taskScopeId: prepared.taskScopeId,
  originalKey: { runtimeEpoch: "main-epoch", operationId: "original-create" },
  originalDigest: "a".repeat(64),
  step: "native.create",
  stageArgumentDigest: bootstrapPlan().stageArgumentDigest,
  targetIdentity: {
    taskScopeId: prepared.taskScopeId,
    origin: bootstrapTaskRequest().origin,
    workspaceId: "workspace",
    projectId: prepared.projectId,
    locationId: prepared.locationId,
    modeGeneration: prepared.modeGeneration,
    inventoryGeneration: prepared.inventoryGeneration,
    originKind: "bootstrap",
  },
  currentLaunchIdentity: prepared.launchId,
});
const observeBound = (prepared) => ({
  kind: "task.observe",
  runtimeEpoch: "main-epoch",
  operationId: "original-create",
  taskScopeId: prepared.taskScopeId,
  phase: "bound",
  launchId: prepared.launchId,
});

test("bootstrap task prepare/arm/revoke cross the private channel exactly and verify only while the host is live", async (t) => {
  let lost = 0;
  const f = await fixture(t, preparedBehavior);
  const runtime = await startEventHost({
    ...f.options,
    onTaskAuthorityLoss: () => lost++,
  });
  const tasks = runtime.workbenchContext().nativeTasks;
  assert.deepEqual(Object.keys(tasks).sort(), [
    "arm",
    "prepare",
    "reconcile",
    "revoke",
    "verify",
  ]);
  const prepared = await tasks.prepare(bootstrapTaskRequest(), bootstrapPlan());
  assert.equal(prepared.status, "prepared");
  assert.equal(
    tasks.verify(observeBound(prepared), {
      runtimeEpoch: "main-epoch",
      task: null,
    }),
    true,
  );
  await tasks.arm(armRowFor(prepared));
  const arms = f.child.messages.filter((m) => m.type === "task-arm");
  assert.equal(arms.length, 1);
  assert.deepEqual(arms[0].request, armRowFor(prepared));
  // Arming is not repeatable and the child never sees an expiry from Main.
  await assert.rejects(() => tasks.arm(armRowFor(prepared)), /task_arm_held/);
  assert.equal(f.child.messages.filter((m) => m.type === "task-arm").length, 1);
  await tasks.revoke(bootstrapPlan().handoffId);
  const revokes = f.child.messages.filter((m) => m.type === "task-revoke");
  assert.equal(revokes.length, 1);
  assert.equal(revokes[0].handoffId, bootstrapPlan().handoffId);
  assert.equal(lost, 0);
  await runtime.stop();
  // Stop drops every live correlation and runs the loss barrier.
  assert.ok(lost >= 1);
  assert.equal(
    tasks.verify(observeBound(prepared), {
      runtimeEpoch: "main-epoch",
      task: null,
    }),
    false,
  );
  await assert.rejects(() => tasks.arm(armRowFor(prepared)));
});

test("bootstrap task authority is cleared when the host exits, disconnects or fails", async (t) => {
  for (const loss of [
    (child) => child.emit("exit", 1, null),
    (child) => child.emit("disconnect"),
    (child) =>
      child.emit("message", { type: "hold", nonce: "x", pid: child.pid }),
  ]) {
    let lost = 0;
    const f = await fixture(t, preparedBehavior);
    const runtime = await startEventHost({
      ...f.options,
      onTaskAuthorityLoss: () => lost++,
    });
    const tasks = runtime.workbenchContext().nativeTasks;
    const prepared = await tasks.prepare(
      bootstrapTaskRequest(),
      bootstrapPlan(),
    );
    assert.equal(
      tasks.verify(observeBound(prepared), {
        runtimeEpoch: "main-epoch",
        task: null,
      }),
      true,
    );
    loss(f.child);
    assert.ok(lost >= 1);
    assert.equal(
      tasks.verify(observeBound(prepared), {
        runtimeEpoch: "main-epoch",
        task: null,
      }),
      false,
    );
    await runtime.stop().catch(() => {});
  }
});

test("bootstrap arm refusal and uncorrelated handoff results never arm or hold silently", async (t) => {
  let f = await fixture(t, { ...preparedBehavior, handoffStatus: "refused" });
  let runtime = await startEventHost(f.options);
  let tasks = runtime.workbenchContext().nativeTasks;
  let prepared = await tasks.prepare(bootstrapTaskRequest(), bootstrapPlan());
  await assert.rejects(
    () => tasks.arm(armRowFor(prepared)),
    /task_arm_refused/,
  );
  // Refused means nothing is armed: the same correlation cannot verify consumed.
  assert.equal(
    tasks.verify(
      {
        kind: "task.handoff",
        runtimeEpoch: "main-epoch",
        operationId: "original-create",
        taskScopeId: prepared.taskScopeId,
        handoffId: bootstrapPlan().handoffId,
        step: "native.create",
        stageArgumentDigest: bootstrapPlan().stageArgumentDigest,
        state: "consumed",
        proofDigest: "0".repeat(64),
      },
      { runtimeEpoch: "main-epoch", task: null },
    ),
    false,
  );
  await runtime.stop();
  // A result for a different handoff or without a request fails the channel.
  f = await fixture(t, {
    ...preparedBehavior,
    taskHandoff(child, message) {
      child.emit("message", {
        type: "task-handoff-result",
        nonce: message.nonce,
        pid: child.pid,
        requestId: message.requestId,
        action: "arm",
        handoffId: tid(9),
        status: "ok",
      });
    },
  });
  runtime = await startEventHost(f.options);
  tasks = runtime.workbenchContext().nativeTasks;
  prepared = await tasks.prepare(bootstrapTaskRequest(), bootstrapPlan());
  await assert.rejects(() => tasks.arm(armRowFor(prepared)));
  assert.equal(
    tasks.verify(observeBound(prepared), {
      runtimeEpoch: "main-epoch",
      task: null,
    }),
    false,
  );
  await runtime.stop().catch(() => {});
});

test("bootstrap prepare needs a plan, refuses a second key use and an out-of-contract prepared reply", async (t) => {
  let f = await fixture(t, preparedBehavior);
  let runtime = await startEventHost(f.options);
  let tasks = runtime.workbenchContext().nativeTasks;
  await assert.rejects(() => tasks.prepare(bootstrapTaskRequest()));
  assert.equal(
    f.child.messages.some((m) => m.type === "task-prepare"),
    false,
  );
  await tasks.prepare(bootstrapTaskRequest(), bootstrapPlan());
  await assert.rejects(
    () =>
      tasks.prepare(bootstrapTaskRequest(), {
        ...bootstrapPlan(),
        handoffId: tid(4),
      }),
    /task_preparation_held/,
  );
  assert.equal(
    f.child.messages.filter((m) => m.type === "task-prepare").length,
    1,
  );
  await runtime.stop();
  // A prepared reply to a prompt request is a protocol fault and drops the host.
  let lost = 0;
  f = await fixture(t, preparedBehavior);
  runtime = await startEventHost({
    ...f.options,
    onTaskAuthorityLoss: () => lost++,
  });
  tasks = runtime.workbenchContext().nativeTasks;
  await assert.rejects(() => tasks.prepare(taskPreparationRequest()));
  assert.ok(lost >= 1);
  await runtime.stop().catch(() => {});
});

test("child diagnostics reach the trusted Main sink; a throwing sink or invalid row never affects the host", async (t) => {
  const seen = [];
  const f = await fixture(t, {
    init(child, message) {
      const diagnostic = (row) =>
        child.emit("message", {
          type: "diagnostic",
          nonce: message.nonce,
          pid: child.pid,
          diagnostic: row,
        });
      diagnostic({
        kind: "reject",
        code: "inventory_unverified",
        step: "a@b:1",
      });
      diagnostic({ kind: "hold", step: "invalidate:x", runtimeHeld: true });
      child.emit("message", {
        type: "ready",
        nonce: message.nonce,
        pid: child.pid,
        port: message.port || 43121,
        engineVersion: "1.4.2",
        serverVersion: "2.0.18",
      });
    },
  });
  const runtime = await startEventHost({
    ...f.options,
    onDiagnostic: (row) => {
      seen.push(row);
      if (seen.length === 1) throw new Error("sink failure");
    },
  });
  assert.deepEqual(seen, [
    { kind: "reject", code: "inventory_unverified", step: "a@b:1" },
    { kind: "hold", step: "invalidate:x", runtimeHeld: true },
  ]);
  await runtime.stop();
});
