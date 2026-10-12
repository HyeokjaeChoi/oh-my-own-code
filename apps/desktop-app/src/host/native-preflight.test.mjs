import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createNativePreflight } from "./native-preflight.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, options = {}) {
  const parent = await fs.realpath(tmpdir());
  const root = await fs.mkdtemp(join(parent, "omoc-preflight-unit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const namespace = {
    root: join(root, "store"),
    documents: join(root, "Documents"),
    metadata: join(root, "store", "metadata"),
    config: join(root, "store", "native", "config"),
    data: join(root, "store", "native", "data"),
    state: join(root, "store", "native", "state"),
    fresh: false,
  };
  for (const path of [
    namespace.root,
    join(namespace.root, "native"),
    namespace.documents,
    namespace.metadata,
    namespace.config,
    namespace.data,
    namespace.state,
    join(namespace.config, "opencode"),
  ])
    await fs.mkdir(path, { mode: 0o700 });
  await fs.writeFile(
    join(namespace.config, "opencode", "opencode.json"),
    "{}\n",
    { mode: 0o600 },
  );
  const database = join(namespace.data, "event-host.sqlite");
  // This is an inert Node fault-injection fixture, never a SQLite/runtime proof.
  await fs.writeFile(database, "copied synthetic bytes", { mode: 0o600 });
  await fs.writeFile(`${database}-wal`, "synthetic companion", { mode: 0o600 });
  await fs.writeFile(
    join(namespace.root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 5,
      nativeVersion: "2.0.18",
      storageGeneration: 1,
      storeId: "11111111-1111-4111-8111-111111111111",
      paths: {
        root: namespace.root,
        metadata: namespace.metadata,
        config: namespace.config,
        data: namespace.data,
        state: namespace.state,
        database,
      },
    }),
    { mode: 0o600 },
  );
  let nonce = "owner-nonce";
  let calls = 0;
  let resources = "resource-identity";
  const children = [];
  const view = {
    runtimeEpoch: "new-epoch",
    revision: 7,
    temporary: false,
    state: "ready",
    recovery: { store: { state: "ready" }, resources: [] },
    retainedOperations: [],
    workspaces: [
      { workspaceId: "workspace", canonicalPath: namespace.documents },
    ],
    sessions: [
      {
        appSessionId: "app-root",
        nativeSessionId: "native-root",
        workspaceId: "workspace",
        lifecycleState: "active",
        status: "idle",
      },
    ],
    tombstones: [],
    messages: [],
    permissions: [],
  };
  const identity = {
    runtimeEpoch: "old-epoch",
    operationId: "create",
    type: "session.create",
    workspaceId: "workspace",
    digest: "d".repeat(64),
  };
  const fork = {
    ...identity,
    operationId: "fork",
    type: "session.fork",
    sessionId: "app-root",
  };
  const receipt = (id, mapping, kind) => ({
    ...id,
    effect: "confirmed",
    result: {
      kind,
      workspaceId: "workspace",
      sessionId: mapping,
      nativeSessionId: mapping === "app-root" ? "native-root" : "native-fork",
    },
  });
  const registry = {
    status: () => ({ state: "ready", revision: view.revision }),
    readView: () => ({
      ...globalThis.structuredClone(view),
      observationSequence: ++calls,
    }),
    lookupIdentity: (key) =>
      globalThis.structuredClone(
        key.operationId === "create"
          ? identity
          : key.operationId === "fork"
            ? fork
            : undefined,
      ),
    lookup: (key) => ({
      status: "found",
      receipt: receipt(
        key.operationId === "create" ? identity : fork,
        key.operationId === "create" ? "app-root" : "app-fork",
        key.operationId === "create" ? "created" : "forked",
      ),
    }),
    lookupForkIdentity: () => globalThis.structuredClone(fork),
  };
  const owner = {
    getNonce: () => nonce,
    assertOwned: async (value) => ({
      state: value === nonce ? "ready" : "recovery_required",
      reason: "owner_unverified",
    }),
  };
  const eventHost = { root: join(root, "resources") };
  await fs.mkdir(eventHost.root, { mode: 0o700 });
  const emit = async (child, request) => {
    if (options.beforeDecision)
      await options.beforeDecision({
        view,
        request,
        child,
        database,
        registry,
      });
    const decision = {
      version: 1,
      nonce: request.nonce,
      allowed: true,
      reason: null,
      counts: {
        sessions: view.sessions.length,
        messages: 0,
        pending: 0,
        inbox: 0,
        kv: 0,
        migrations: 48,
      },
      correlations: [
        {
          nativeSessionId: "native-root",
          appSessionId: "app-root",
          workspaceId: "workspace",
          runtimeEpoch: "old-epoch",
          operationId: "create",
          digest: identity.digest,
        },
      ],
    };
    options.decision?.(decision);
    child.stdout.write(options.rawOutput ?? `${JSON.stringify(decision)}\n`);
    child.stdout.end();
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
  };
  const spawn = (engine, args, setup) => {
    const child = new EventEmitter();
    child.pid = 456;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = (signal) => {
      child.kills.push(signal);
      if (!options.noExit) {
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
      }
      return true;
    };
    child.kills = [];
    children.push({ child, engine, args, setup });
    child.stdin.once("data", (bytes) => {
      const request = JSON.parse(bytes.toString());
      child.request = request;
      if (options.pause) return;
      queueMicrotask(() =>
        emit(child, request).catch(() =>
          child.emit("error", new Error("synthetic failure")),
        ),
      );
    });
    return child;
  };
  const preflight = createNativePreflight({
    namespace,
    owner,
    registry,
    eventHost,
    processIdentity: {
      capture: async (pid) => ({
        pid,
        platform: "darwin",
        bootId: "boot",
        startToken: "birth",
      }),
      observeExit: () => {},
    },
    resourceVerifier: async () => ({
      engine: join(eventHost.root, "runtime/bun"),
      entry: join(eventHost.root, "native-preflight-reader.mjs"),
      inventorySha256: resources,
    }),
    spawn,
    io: {
      ...fs,
      rm: async (...args) => {
        await options.cleanupHook?.({ view });
        return fs.rm(...args);
      },
    },
    deadlineMs: options.deadlineMs ?? 1000,
    stopTimeoutMs: 5,
  });
  t.after(async () => {
    const result = await preflight.close();
    // Only inert fake handles exist in this Node suite.
    if (result.recoveryPath)
      await fs.rm(result.recoveryPath, { recursive: true, force: true });
  });
  return {
    namespace,
    database,
    owner,
    registry,
    identity,
    view,
    children,
    preflight,
    setNonce: (value) => {
      nonce = value;
    },
    setResources: (value) => {
      resources = value;
    },
    digest: async () => digest(await fs.readFile(database)),
  };
}

test("copied-set proof preserves originals, keeps stdin live, closes exact child and never inherits secrets", async (t) => {
  const f = await fixture(t);
  const before = await f.digest();
  assert.equal(await f.preflight.check(), true);
  assert.equal(await f.digest(), before);
  const { child, setup } = f.children[0];
  assert.equal(child.kills.length, 0);
  assert.equal(setup.shell, false);
  assert.equal(setup.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED, "true");
  assert.equal(Object.hasOwn(setup.env, "OPENAI_API_KEY"), false);
  assert.notEqual(child.request.database, f.database);
  assert.equal(child.request.mappings[0].appSessionId, "app-root");
  await assert.rejects(fs.lstat(setup.cwd), { code: "ENOENT" });
  assert.deepEqual(await f.preflight.close(), {
    exited: true,
    cleanup: "complete",
  });
});
test("fresh proof has zero inspector calls; retained/resource recovery denies both namespaces", async (t) => {
  const f = await fixture(t);
  f.namespace.fresh = true;
  assert.equal(await f.preflight.check(), true);
  assert.equal(f.children.length, 0);
  f.view.retainedOperations.push({
    runtimeEpoch: "old-epoch",
    operationId: "unknown",
    type: "session.send",
  });
  assert.equal(await f.preflight.check(), false);
  f.view.retainedOperations = [];
  f.view.recovery.resources.push({
    workspaceId: "workspace",
    state: "unavailable",
    reason: "path_missing",
  });
  assert.equal(await f.preflight.check(), false);
  assert.equal(f.children.length, 0);
});
test("each invocation repeats inspection after startup journal revision; observation-only sequence is excluded", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.preflight.check(), true);
  f.view.revision++;
  assert.equal(await f.preflight.check(), true);
  assert.equal(f.children.length, 2);
});
test("a user provider config in opencode.json does not block startup proof", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.namespace.config, "opencode", "opencode.json"),
    '{"model":"lmstudio/m","providers":{"lmstudio":{"settings":{"baseURL":"http://127.0.0.1:1/v1"}}}}\n',
  );
  assert.equal(await f.preflight.check(), true);
});
test("fork admission uses its own original identity/receipt separately from inherited root metadata", async (t) => {
  const f = await fixture(t);
  f.view.sessions.push({
    ...f.view.sessions[0],
    appSessionId: "app-fork",
    nativeSessionId: "native-fork",
    parentSessionId: "app-root",
  });
  assert.equal(await f.preflight.check(), true);
  f.registry.lookupForkIdentity = () => ({
    ...f.identity,
    type: "session.fork",
    sessionId: "other-parent",
  });
  assert.equal(await f.preflight.check(), false);
});
for (const fault of [
  "digest",
  "receipt",
  "revision",
  "owner",
  "original",
  "optional",
  "config",
  "config-extra",
  "symlink",
  "hardlink",
  "mode",
  "nonce",
  "extra-output",
  "oversized-output",
]) {
  test(`${fault} drift or invalid authority denies; no stale decision authorizes launch`, async (t) => {
    let f;
    const options = {
      beforeDecision: async () => {
        if (fault === "revision") f.view.revision++;
        if (fault === "owner") f.setNonce("replacement");
        if (fault === "original") await fs.appendFile(f.database, "drift");
        if (fault === "optional")
          await fs.writeFile(`${f.database}-journal`, "new", { mode: 0o600 });
      },
      decision: (value) => {
        if (fault === "digest") value.correlations[0].digest = "c".repeat(64);
        if (fault === "nonce") value.nonce = "b".repeat(64);
      },
      ...(fault === "extra-output" && { rawOutput: "{}\n{}\n" }),
      ...(fault === "oversized-output" && { rawOutput: "x".repeat(131073) }),
    };
    f = await fixture(t, options);
    if (fault === "receipt")
      f.registry.lookup = () => ({
        status: "found",
        receipt: { effect: "unknown" },
      });
    if (fault === "config")
      await fs.writeFile(
        join(f.namespace.config, "opencode", "opencode.json"),
        // The user's opencode.json may hold any JSON object; invalid JSON or a
        // non-object still denies.
        "not json",
      );
    if (fault === "config-extra")
      await fs.writeFile(join(f.namespace.config, "auth.json"), "synthetic", {
        mode: 0o600,
      });
    if (fault === "symlink") {
      await fs.rename(f.database, `${f.database}.original`);
      await fs.symlink(`${f.database}.original`, f.database);
    }
    if (fault === "hardlink") await fs.link(f.database, `${f.database}.other`);
    if (fault === "mode") await fs.chmod(f.database, 0o644);
    assert.equal(await f.preflight.check(), false);
    if (
      ["config", "config-extra", "symlink", "hardlink", "mode"].includes(fault)
    )
      assert.equal(f.children.length, 0);
  });
}
test("pending closed result preserves bytes and exact recovery reason", async (t) => {
  const f = await fixture(t, {
    decision: (value) => {
      value.allowed = false;
      value.reason = "pending_inbox";
      value.correlations = [];
      value.counts.inbox = 1;
    },
  });
  const before = await f.digest();
  assert.equal(await f.preflight.check(), false);
  assert.equal(f.preflight.reason(), "pending_inbox");
  assert.equal(await f.digest(), before);
});
test("single-flight rejects competing lookup and close cancels only the exact owned handle", async (t) => {
  const f = await fixture(t, { pause: true });
  const running = f.preflight.check();
  while (!f.children[0]?.child.request)
    await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(await f.preflight.check(), false);
  assert.equal((await f.preflight.close()).cleanup, "complete");
  assert.equal(await running, false);
  assert.deepEqual(f.children[0].child.kills, ["SIGTERM"]);
});
test("deadline exit uncertainty retains copied root and prevents every later proof", async (t) => {
  const f = await fixture(t, { pause: true, noExit: true, deadlineMs: 10 });
  assert.equal(await f.preflight.check(), false);
  const closed = await f.preflight.close();
  assert.equal(closed.exited, false);
  assert.equal(closed.cleanup, "incomplete");
  assert.ok(closed.recoveryPath);
  assert.ok((await fs.lstat(closed.recoveryPath)).isDirectory());
  assert.equal(await f.preflight.check(), false);
  assert.deepEqual(f.children[0].child.kills, [
    "SIGTERM",
    "SIGTERM",
    "SIGKILL",
  ]);
});

test("cleanup cannot publish a receipt proof for a later registry revision", async (t) => {
  const f = await fixture(t, {
    cleanupHook: ({ view }) => {
      view.revision++;
    },
  });
  assert.equal(await f.preflight.check(), false);
  assert.equal((await f.preflight.close()).cleanup, "complete");
});

test("pinned Native global shell directory is inert only when it stays empty", async (t) => {
  const f = await fixture(t);
  const shell = join(f.namespace.data, "opencode", "shell", "global");
  await fs.mkdir(shell, { recursive: true, mode: 0o700 });
  assert.equal(await f.preflight.check(), true);
  await fs.writeFile(join(shell, "unsupported.out"), "synthetic", {
    mode: 0o600,
  });
  const before = f.children.length;
  assert.equal(await f.preflight.check(), false);
  assert.equal(f.children.length, before);
});

test("workspace removal during inspection rejects the original path binding", async (t) => {
  let f;
  f = await fixture(t, {
    beforeDecision: async () => {
      await fs.rmdir(f.namespace.documents);
    },
  });
  assert.equal(await f.preflight.check(), false);
});

test("ordinary imported workspace directory edits preserve directory identity", async (t) => {
  let f;
  f = await fixture(t, {
    beforeDecision: async () => {
      await fs.writeFile(
        join(f.namespace.documents, "project.txt"),
        "ordinary edit",
        { mode: 0o600 },
      );
    },
  });
  await fs.chmod(f.namespace.documents, 0o755);
  assert.equal(await f.preflight.check(), true);
});

test("reconcile plan: planned sessions are provisional and only candidate-explained retention is tolerated", async (t) => {
  const f = await fixture(t, {
    decision: (decision) => {
      decision.counts.sessions += 1;
      decision.correlations.push({
        nativeSessionId: "native-plan",
        appSessionId: "app-plan",
        workspaceId: "workspace",
        runtimeEpoch: "old-epoch",
        operationId: "plan-op",
        digest: "e".repeat(64),
      });
    },
  });
  const candidate = {
    operation: {
      identity: {
        runtimeEpoch: "old-epoch",
        operationId: "plan-op",
        digest: "e".repeat(64),
      },
      reservation: {
        appSessionId: "app-plan",
        plannedNativeSessionId: "native-plan",
        workspace: {
          workspaceId: "workspace",
          canonicalPath: f.namespace.documents,
        },
      },
    },
  };
  let plan = { eligible: true, candidates: [candidate] };
  f.registry.reconcilePlan = () => plan;
  f.view.retainedOperations.push({
    runtimeEpoch: "old-epoch",
    operationId: "plan-op",
    type: "session.create",
  });
  f.view.state = "unavailable";
  f.view.recovery.resources.push({
    workspaceId: "workspace",
    state: "unavailable",
    reason: "unresolved_operation",
  });
  assert.equal(await f.preflight.check(), true);
  const request = f.children.at(-1).child.request;
  assert.equal(request.mappings.length, 1);
  assert.deepEqual(request.provisional, [
    {
      appSessionId: "app-plan",
      nativeSessionId: "native-plan",
      workspaceId: "workspace",
      canonicalPath: f.namespace.documents,
      operationId: "plan-op",
      originalRuntimeEpoch: "old-epoch",
      digest: "e".repeat(64),
    },
  ]);
  // Any retained operation the plan does not explain denies, as before.
  plan = { eligible: false, candidates: [candidate] };
  assert.equal(await f.preflight.check(), false);
  plan = { eligible: true, candidates: [candidate] };
  f.view.retainedOperations.push({
    runtimeEpoch: "old-epoch",
    operationId: "unexplained",
    type: "session.send",
  });
  assert.equal(await f.preflight.check(), false);
});

test("reconcile plan: an unsettled fork is described to the reader only by its mapped parent", async (t) => {
  const f = await fixture(t, {
    decision: (decision) => {
      decision.counts.sessions += 1;
    },
  });
  const candidate = {
    operation: {
      identity: {
        runtimeEpoch: "old-epoch",
        operationId: "fork-op",
        type: "session.fork",
        workspaceId: "workspace",
        sessionId: "app-root",
        digest: "e".repeat(64),
      },
      reservation: {
        appSessionId: "app-fork",
        workspace: {
          workspaceId: "workspace",
          canonicalPath: f.namespace.documents,
        },
      },
    },
  };
  let plan = { eligible: true, candidates: [candidate] };
  f.registry.reconcilePlan = () => plan;
  f.view.retainedOperations.push({
    runtimeEpoch: "old-epoch",
    operationId: "fork-op",
    type: "session.fork",
  });
  f.view.state = "unavailable";
  f.view.recovery.resources.push({
    workspaceId: "workspace",
    state: "unavailable",
    reason: "unresolved_operation",
  });
  assert.equal(await f.preflight.check(), true);
  const request = f.children.at(-1).child.request;
  assert.equal(request.provisional, undefined);
  assert.deepEqual(request.provisionalForks, [
    {
      appSessionId: "app-fork",
      workspaceId: "workspace",
      canonicalPath: f.namespace.documents,
      parentAppSessionId: "app-root",
      parentNativeSessionId: "native-root",
    },
  ]);
  // A fork whose parent is not a mapped session cannot be described: denied.
  candidate.operation.identity.sessionId = "app-missing";
  assert.equal(await f.preflight.check(), false);
});
