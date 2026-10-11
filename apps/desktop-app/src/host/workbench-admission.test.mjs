import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateEnvelope, validateCancel } from "../workbench-contract.mjs";
import { createWorkbenchService } from "../workbench-service.mjs";

test("CTX-BRANCH admission captures immutable original before target across readiness", async (t) => {
  const held = deferred();
  let seen;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => held.promise,
    revision: () => 0,
    projectReceipt: () => {},
    execute: async (operation) => {
      seen = {
        operation,
        target: currentScope().record.forkTarget,
        digest: currentScope().record.digest,
      };
      return { ok: true, value: {} };
    },
  });
  t.after(async () => {
    held.resolve();
    await admission.drain();
    admission.close();
  });
  const operation = {
    type: "session.fork",
    workspaceId: "ws",
    sessionId: "parent",
    requestId: "branch",
    before: "message-1",
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    operationId: "branch",
    operation,
  };
  const original = { ...operation };
  const canonical = { ...original, expectedRevision: null };
  const originalDigest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  const pending = admission.handle(envelope, "sender");
  operation.before = "changed";
  held.resolve();
  assert.equal((await pending).ok, true);
  assert.deepEqual(seen.target, { beforeMessageId: "message-1" });
  assert.equal(Object.isFrozen(seen.target), true);
  assert.equal(seen.operation.before, "message-1");
  assert.equal(seen.digest, originalDigest);
  assert.equal(
    (await admission.handle(envelope, "sender")).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    (await admission.handle({ ...envelope, operation: original }, "sender"))
      .value.status,
    "duplicate",
  );
});

test("CTX-BRANCH late before fork stays unknown and duplicate lookup never reexecutes", async (t) => {
  const held = deferred(),
    entered = deferred();
  let calls = 0,
    projected;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    deadlineMs: 25,
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: (_record, _operation, result) => {
      projected = result;
    },
    execute: async () => {
      calls++;
      currentScope().markEffect();
      entered.resolve();
      await held.promise;
      return { ok: true, value: { status: "forked" } };
    },
  });
  t.after(async () => {
    held.resolve();
    await admission.drain();
    admission.close();
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    operationId: "branch-late",
    operation: {
      type: "session.fork",
      workspaceId: "ws",
      sessionId: "parent",
      requestId: "branch-late",
      before: "message-1",
    },
  };
  const pending = admission.handle(envelope, "sender");
  await entered.promise;
  assert.equal((await pending).code, "UNKNOWN_OUTCOME");
  assert.equal(
    (await admission.handle(envelope, "sender")).value.status,
    "duplicate",
  );
  held.resolve();
  await admission.drain();
  assert.equal(projected.code, "UNKNOWN_OUTCOME");
  assert.equal(
    admission.lookup({ runtimeEpoch: "epoch", operationId: "branch-late" })
      .receipt.effect,
    "unknown",
  );
  assert.equal(calls, 1);
});

test("v2 closed identity rejects legacy, extra fields, prototypes and malformed cancellation", () => {
  const read = { version: 2, readId: "r", operation: { type: "snapshot" } };
  assert.deepEqual(validateEnvelope(read), read);
  for (const bad of [
    { type: "snapshot" },
    { ...read, sender: "forged" },
    { ...read, operationId: "op" },
    { ...read, readId: "space id" },
    { ...read, expectedRevision: 0 },
    { ...read, operation: Object.create({ type: "snapshot" }) },
    { ...read, operation: { type: "snapshot", extra: {} } },
    {
      version: 2,
      readId: "r",
      operation: {
        type: "operation.lookup",
        runtimeEpoch: "old",
        operationId: "op",
      },
    },
    {
      version: 2,
      runtimeEpoch: "e",
      operationId: "op",
      expectedRevision: -1,
      operation: { type: "workspace.import" },
    },
  ])
    assert.throws(() => validateEnvelope(bad), { appCode: "INVALID_REQUEST" });
  for (const bad of [
    null,
    { version: 1, runtimeEpoch: "e", readId: "r" },
    { version: 2, runtimeEpoch: "e", readId: "r", sender: "x" },
  ])
    assert.throws(() => validateCancel(bad), { appCode: "INVALID_REQUEST" });
});

test("production service rejects direct legacy renderer requests", async () => {
  const service = createWorkbenchService({});
  try {
    assert.equal(
      (await service.handle({ type: "snapshot" }, "sender")).code,
      "INVALID_REQUEST",
    );
  } finally {
    service.close();
  }
});

import { mkdtemp, realpath, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BASELINE_POLICY, ERRORS } from "../workbench-contract.mjs";
import { createHostAdmission, currentScope } from "./workbench-admission.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
const tick = () => new Promise((r) => setImmediate(r));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
test("drain fences new work after deadline while durable actual outcome or unknown hold survives", async (t) => {
  for (const outcome of ["confirmed", "unknown"]) {
    await t.test(outcome, async (t) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "quit-admission-")),
      );
      const directory = join(root, "metadata");
      await mkdir(directory);
      const options = {
        directory,
        documentsPath: root,
        storeId: "synthetic-quit",
        runtimeEpoch: "quit-epoch",
      };
      let registry = await openWorkspaceRegistry(options);
      const pending = deferred();
      let admission;
      t.after(async () => {
        pending.resolve("native-quit");
        admission?.close();
        await admission?.drain();
        await registry.close();
        await rm(root, { recursive: true, force: true });
      });
      let begins = 0;
      let handlers = 0;
      let sdkCalls = 0;
      let reservation;
      const key = { runtimeEpoch: "quit-epoch", operationId: "before-quit" };
      admission = createHostAdmission({
        runtimeEpoch: key.runtimeEpoch,
        registry: () => ({
          ...registry,
          begin: (...args) => {
            begins++;
            return registry.begin(...args);
          },
        }),
        ready: () => Promise.resolve(),
        revision: () => registry.status().revision,
        deadlineMs: 80,
        execute: async () => {
          handlers++;
          reservation = await registry.reserve({
            ...key,
            ownership: "imported",
            canonicalPath: root,
          });
          currentScope().beforeEffect = () =>
            registry.dispatch({
              ...key,
              step: "native.create",
              nativeSessionId: "native-quit",
            });
          await admission.sdk(
            () => {
              sdkCalls++;
              return pending.promise;
            },
            [],
            true,
            true,
          );
          return { ok: true, value: { status: "created" } };
        },
        projectReceipt: async (record) => {
          const completed = await registry.complete({
            ...key,
            receipt: {
              ...redactReceipt(record),
              delivery: "accepted",
              effect: "confirmed",
              result: {
                kind: "created",
                workspaceId: reservation.workspace.workspaceId,
                appSessionId: reservation.appSessionId,
                nativeSessionId: "native-quit",
              },
            },
            delta: {
              workspaces: [
                { ...reservation.workspace, registrationState: "registered" },
              ],
              sessions: [
                {
                  appSessionId: reservation.appSessionId,
                  workspaceId: reservation.workspace.workspaceId,
                  nativeSessionId: "native-quit",
                  lifecycleState: "active",
                  pinned: false,
                  archived: false,
                },
              ],
              tombstones: [],
            },
            verifiedNativeSessionIds: ["native-quit"],
          });
          Object.assign(record, completed.receipt);
        },
      });
      const request = {
        version: 2,
        ...key,
        operation: { type: "workspace.import" },
      };
      const response = admission.handle(request, "sender");
      await until(() => sdkCalls === 1);
      assert.equal((await response).code, "UNKNOWN_OUTCOME");
      assert.equal(registry.lookup(key).receipt.effect, "unknown");
      let drained = false;
      const drain = admission.drain().then(() => {
        drained = true;
      });
      await tick();
      assert.equal(drained, false);
      const before = registry.status().journal.sequence;
      const late = await admission.handle(
        { ...request, operationId: "after-quit" },
        "sender",
      );
      assert.equal(late.code, "UNAVAILABLE");
      assert.equal(late.receipt, undefined);
      assert.equal(registry.status().journal.sequence, before);
      assert.equal(begins, 1);
      assert.equal(handlers, 1);
      assert.equal(sdkCalls, 1);
      assert.equal(registry.lookup(key).receipt.effect, "unknown");
      if (outcome === "confirmed") pending.resolve("native-quit");
      else pending.reject(new Error("synthetic unknown actual"));
      await drain;
      assert.equal(admission.lookup(key).receipt.effect, outcome);
      if (outcome === "unknown")
        assert.ok(
          registry
            .readView()
            .retainedOperations.some(
              (operation) => operation.operationId === key.operationId,
            ),
        );
      await registry.checkpoint();
      await registry.close();
      registry = await openWorkspaceRegistry({
        ...options,
        runtimeEpoch: "next",
      });
      assert.equal(registry.lookup(key).receipt.effect, outcome);
      assert.equal(
        (
          await admission.handle(
            { ...request, operationId: "after-drain" },
            "sender",
          )
        ).code,
        "UNAVAILABLE",
      );
      assert.equal(begins, 1);
    });
  }
});

test("drain does not abort admitted work and fences reentrant handle, startup and trusted work", async (t) => {
  const pending = deferred();
  let admission;
  let calls = 0;
  admission = createHostAdmission({
    ready: () => Promise.resolve(),
    revision: () => 0,
    deadlineMs: 1000,
    execute: async () => {
      calls++;
      const signal = currentScope().signal;
      await pending.promise;
      assert.equal(signal.aborted, false);
      assert.equal(
        (
          await admission.handle(
            {
              version: 2,
              readId: "reentrant",
              operation: { type: "snapshot" },
            },
            "sender",
          )
        ).code,
        "UNAVAILABLE",
      );
      await assert.rejects(
        admission.startup(() => assert.fail("late startup")),
        { appCode: "UNAVAILABLE" },
      );
      await assert.rejects(
        admission.trusted(() => assert.fail("late trusted")),
        { appCode: "UNAVAILABLE" },
      );
      return { ok: true, value: "settled" };
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    pending.resolve();
    admission.close();
    await admission.drain();
  });
  const response = admission.handle(
    { version: 2, readId: "before", operation: { type: "snapshot" } },
    "sender",
  );
  await until(() => calls === 1);
  const drain = admission.drain();
  const secondDrain = admission.drain();
  assert.equal(
    (
      await admission.handle(
        { version: 2, readId: "after", operation: { type: "snapshot" } },
        "sender",
      )
    ).code,
    "UNAVAILABLE",
  );
  pending.resolve();
  assert.equal((await response).ok, true);
  await Promise.all([drain, secondDrain]);
  assert.equal(calls, 1);
});

test("drain retains timed-out read and trusted SDK actuals until exact settlement", async (t) => {
  for (const kind of ["read", "trusted"]) {
    await t.test(kind, async (t) => {
      const pending = deferred();
      let calls = 0;
      let admission;
      admission = createHostAdmission({
        ready: () => Promise.resolve(),
        revision: () => 0,
        deadlineMs: 30,
        execute: async () => {
          await admission.sdk(() => {
            calls++;
            return pending.promise;
          }, []);
          return { ok: true, value: "late" };
        },
        projectReceipt: () => {},
      });
      t.after(async () => {
        pending.resolve();
        admission.close();
        await admission.drain();
      });
      const request = {
        version: 2,
        readId: "before",
        operation: { type: "snapshot" },
      };
      if (kind === "trusted")
        await assert.rejects(
          admission.trusted(() =>
            admission.sdk(() => {
              calls++;
              return pending.promise;
            }, []),
          ),
          { appCode: "READ_TIMEOUT" },
        );
      else
        assert.equal(
          (await admission.handle(request, "sender")).code,
          "READ_TIMEOUT",
        );
      assert.equal(calls, 1);
      if (kind === "trusted")
        await assert.rejects(
          admission.trusted(() =>
            admission.sdk(() => {
              calls++;
              return Promise.resolve();
            }, []),
          ),
          { appCode: "READ_BUSY" },
        );
      let drained = false;
      const drain = admission.drain().then(() => {
        drained = true;
      });
      await tick();
      assert.equal(drained, false);
      assert.equal(
        (await admission.handle({ ...request, readId: "after" }, "sender"))
          .code,
        "UNAVAILABLE",
      );
      pending.resolve();
      await drain;
      assert.equal(calls, 1);
    });
  }
});

test("drain tracks startup before its callback can reenter and retains every admitted startup", async (t) => {
  const first = deferred();
  const second = deferred();
  const admission = createHostAdmission({
    ready: () => Promise.resolve(),
    revision: () => 0,
    execute: () => {},
    projectReceipt: () => {},
    deadlineMs: 1000,
  });
  t.after(async () => {
    first.resolve();
    second.resolve();
    admission.close();
    await admission.drain();
  });
  const startup1 = admission.startup(() => first.promise);
  let drain;
  let drained = false;
  const startup2 = admission.startup(async () => {
    drain = admission.drain().then(() => {
      drained = true;
    });
    await second.promise;
  });
  await until(() => drain);
  first.resolve();
  await startup1;
  await tick();
  assert.equal(drained, false);
  second.resolve();
  await Promise.all([startup2, drain]);
});

test("drain reentered by admission callbacks prevents ledger allocation and dispatch", async (t) => {
  let admission;
  let drain;
  let handlers = 0;
  admission = createHostAdmission({
    ready: () => Promise.resolve(),
    revision: () => {
      drain = admission.drain();
      return 0;
    },
    execute: () => {
      handlers++;
      return { ok: true };
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const request = {
    version: 2,
    runtimeEpoch: admission.epoch,
    operationId: "reentered",
    operation: { type: "workspace.import" },
  };
  assert.equal((await admission.handle(request, "sender")).code, "UNAVAILABLE");
  await drain;
  assert.equal(handlers, 0);
  assert.equal(admission.lookup(request).status, "missing");
});

test("drain waits admitted rejection receipt append after the mutation actual settles", async (t) => {
  const pending = deferred();
  const rejecting = deferred();
  let entered = false;
  const receipts = new Map();
  const admission = createHostAdmission({
    registry: () => ({
      status: () => ({ state: "ready" }),
      lookup: ({ operationId }) =>
        receipts.has(operationId)
          ? { status: "found", receipt: receipts.get(operationId) }
          : { status: "missing", effect: "unknown" },
      begin: async (record) => {
        if (record.rejectionCode) {
          entered = true;
          await rejecting.promise;
        }
        const receipt = {
          ...record,
          admission: record.rejectionCode ? "rejected" : "admitted",
          delivery: "pending",
          effect: "none",
          revision: 0,
          evidence: [],
          ...(record.rejectionCode && {
            result: { kind: "rejected", code: record.rejectionCode },
          }),
        };
        receipts.set(record.operationId, receipt);
        return {
          status: record.rejectionCode ? "rejected" : "admitted",
          receipt,
        };
      },
    }),
    ready: () => Promise.resolve(),
    revision: () => 0,
    deadlineMs: 1000,
    execute: async () => {
      await pending.promise;
      return { ok: true, value: "done" };
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    pending.resolve();
    rejecting.resolve();
    admission.close();
    await admission.drain();
  });
  const request = {
    version: 2,
    runtimeEpoch: admission.epoch,
    operationId: "first",
    operation: { type: "workspace.import" },
  };
  const response = admission.handle(request, "sender");
  const rejection = admission.handle(
    { ...request, operationId: "busy" },
    "sender",
  );
  await until(() => entered);
  let drained = false;
  const drain = admission.drain().then(() => {
    drained = true;
  });
  pending.resolve();
  assert.equal((await response).ok, true);
  await tick();
  assert.equal(drained, false);
  rejecting.resolve();
  assert.equal((await rejection).code, "BUSY");
  await drain;
  assert.equal(
    admission.lookup({ runtimeEpoch: admission.epoch, operationId: "busy" })
      .receipt.effect,
    "none",
  );
});
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await delay(1);
  }
  assert.fail("expected bounded progress");
}

async function hostFixture(t, { deadlineMs = 100, startup } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "p4-host-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "sample.txt"), "synthetic preview");
  const records = new Map();
  let next = 0;
  const info = (id, patch = {}) => ({
    id,
    title: "PRIVATE TITLE",
    location: { directory: root },
    permissions: BASELINE_POLICY,
    ...patch,
  });
  records.set("native-default", info("native-default"));
  const state = {
    calls: [],
    inFlight: 0,
    max: 0,
    hooks: {},
    pick: root,
    permissions: [],
    inbox: [],
    active: {},
    messages: [],
  };
  if (startup) state.hooks.update = startup;
  const method =
    (name, fn) =>
    async (...args) => {
      state.calls.push({ name, args });
      state.inFlight++;
      state.max = Math.max(state.max, state.inFlight);
      try {
        return await (state.hooks[name]
          ? state.hooks[name](...args)
          : fn(...args));
      } finally {
        state.inFlight--;
      }
    };
  const client = {
    session: {
      get: method("get", ({ sessionID }) => {
        if (!records.has(sessionID))
          throw { _tag: "SessionNotFoundError", sessionID };
        return globalThis.structuredClone(records.get(sessionID));
      }),
      update: method("update", ({ sessionID, ...patch }) =>
        Object.assign(records.get(sessionID), patch),
      ),
      create: method("create", ({ title, location, permissions }) => {
        const result = info(`native-${++next}`, {
          title,
          location,
          permissions,
        });
        records.set(result.id, result);
        return globalThis.structuredClone(result);
      }),
      fork: method("fork", ({ sessionID }) => {
        const result = info(`native-${++next}`, { parentID: sessionID });
        records.set(result.id, result);
        return globalThis.structuredClone(result);
      }),
      list: method("sessions", () => ({
        data: [...records.values()],
        cursor: {},
      })),
      remove: method("remove", ({ sessionID }) => records.delete(sessionID)),
      active: method("active", () => state.active),
      inbox: { list: method("inbox", () => state.inbox) },
      prompt: method("prompt", ({ sessionID, text }) => ({
        id: `inbox-${++next}`,
        sessionID,
        type: "user",
        payload: { text },
      })),
      command: method("command", () => undefined),
      interrupt: method("interrupt", () => ({ interrupted: true })),
      switchAgent: method("switchAgent", () => undefined),
      switchModel: method("switchModel", () => undefined),
    },
    message: {
      list: method("messages", () => ({ data: state.messages, cursor: {} })),
    },
    permission: {
      list: method("permissions", () => state.permissions),
      reply: method("reply", () => undefined),
    },
    command: {
      list: method("commands", () => ({ data: [{ name: "review" }] })),
    },
    skill: { list: method("skills", () => ({ data: [] })) },
    mcp: { list: method("mcp", () => ({ data: [] })) },
    agent: {
      list: method("agents", () => ({
        data: [{ id: "build", name: "Build", mode: "primary" }],
      })),
    },
    model: {
      list: method("models", () => ({
        data: [
          { id: "model", providerID: "provider", name: "Model", enabled: true },
        ],
      })),
    },
    provider: {
      list: method("providers", () => ({
        data: [
          {
            id: "provider",
            integrationID: "integration",
            activation: "enabled",
          },
        ],
      })),
    },
    integration: {
      list: method("integrations", () => ({
        data: [
          {
            id: "integration",
            connections: [{ type: "credential", secret: "PRIVATE TOKEN" }],
          },
        ],
      })),
    },
  };
  const runtime = {
    workspace: root,
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => ({
      client,
      session: records.get("native-default"),
    }),
  };
  const service = createWorkbenchService({
    runtime,
    deadlineMs,
    pickDirectory: method("dialog", () => state.pick),
    confirmTrust: async () => true,
    confirmSessionRemoval: method("confirm", () => true),
  });
  t.after(() => service.close());
  let serial = 0;
  let epoch;
  const read = (operation, readId = `read-${++serial}`, sender = "sender-a") =>
    service.handle(
      { version: 2, ...(epoch && { runtimeEpoch: epoch }), readId, operation },
      sender,
    );
  const mutate = (operation, operationId = `op-${++serial}`, extra = {}) =>
    service.handle(
      { version: 2, runtimeEpoch: epoch, operationId, operation, ...extra },
      "sender-a",
    );
  const lookup = (operationId, target = epoch) =>
    read({ type: "operation.lookup", runtimeEpoch: target, operationId });
  const bootstrap = async () => {
    const result = await read({ type: "snapshot" });
    assert.equal(result.ok, true, JSON.stringify(result));
    epoch = result.value.runtimeEpoch;
    return result.value;
  };
  return {
    root,
    records,
    info,
    state,
    client,
    service,
    read,
    mutate,
    lookup,
    bootstrap,
    get epoch() {
      return epoch;
    },
    set epoch(value) {
      epoch = value;
    },
  };
}

test("actual snapshot SDK call stays quarantined after timeout; expired projection never commits", async (t) => {
  const f = await hostFixture(t);
  const initial = await f.bootstrap();
  const ids = {
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
  };
  const pending = deferred();
  let entered = false;
  f.state.hooks.get = () => {
    entered = true;
    return pending.promise;
  };
  const waiting = f.read({ type: "snapshot", ...ids });
  await until(() => entered);
  for (let i = 0; i < 12; i++)
    assert.equal((await f.read({ type: "snapshot" })).code, "READ_BUSY");
  assert.equal((await waiting).code, "READ_TIMEOUT");
  assert.equal(f.state.inFlight, 1);
  assert.equal((await f.read({ type: "snapshot", ...ids })).code, "READ_BUSY");
  const health = await f.lookup("absent");
  assert.equal(health.value.status, "missing");
  pending.resolve({
    ...f.records.get("native-default"),
    title: "EXPIRED TITLE",
  });
  await until(() => f.state.inFlight === 0);
  await tick();
  delete f.state.hooks.get;
  const next = await f.read({ type: "snapshot", ...ids });
  assert.equal(next.ok, true);
  assert.equal(next.value.sessions[0].title, "PRIVATE TITLE");
  assert.equal(f.state.max, 1);
});

test("coalesced subscribers are bounded8 with immutable IDs and sender-owned cancel", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 300 });
  const initial = await f.bootstrap();
  const op = { type: "snapshot", workspaceId: initial.selectedWorkspaceId };
  const pending = deferred();
  let entered = false;
  f.state.hooks.get = () => {
    entered = true;
    return pending.promise;
  };
  const first = f.read(op, "same");
  await until(() => entered);
  const same = f.read(op, "same");
  assert.equal(first, same);
  assert.equal(
    (await f.read({ type: "diagnostics.list" }, "same")).code,
    "INVALID_REQUEST",
  );
  const joined = Array.from({ length: 7 }, (_, i) => f.read(op, `join-${i}`));
  assert.equal((await f.read(op, "overflow")).code, "READ_BUSY");
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same" },
      "sender-b",
    ).value.status,
    "missing",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: "retired", readId: "same" },
      "sender-a",
    ).code,
    "STALE_EPOCH",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same", extra: true },
      "sender-a",
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same" },
      "sender-a",
    ).value.status,
    "cancelled",
  );
  assert.equal((await first).code, "CANCELLED");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, false);
  pending.resolve(f.records.get("native-default"));
  for (const result of await Promise.all(joined)) assert.equal(result.ok, true);
  assert.equal(f.state.calls.filter((c) => c.name === "get").length, 3); // startup, bootstrap, one coalesced refresh
});

test("last subscriber cancel and sender close retain actual lane until ignored abort settles", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 300 });
  const initial = await f.bootstrap();
  const op = { type: "catalog.list", workspaceId: initial.selectedWorkspaceId };
  const pending = deferred();
  f.state.hooks.commands = () => pending.promise;
  const a = f.read(op, "a");
  await until(() => f.state.inFlight === 1);
  f.service.closeSender("sender-b");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, false);
  f.service.closeSender("sender-a");
  assert.equal((await a).code, "CANCELLED");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, true);
  assert.equal((await f.read(op, "b")).code, "READ_BUSY");
  assert.equal((await f.lookup("absent")).value.status, "missing");
  pending.resolve({ data: [] });
  await until(() => f.state.inFlight === 0);
  await tick();
  delete f.state.hooks.commands;
  assert.equal((await f.read(op)).ok, true);
});

test("ready is service-owned; one mutation waiter admitted before ready and never dispatches after expiry", async (t) => {
  const pending = deferred();
  const f = await hostFixture(t, {
    deadlineMs: 60,
    startup: () => pending.promise,
  });
  const bootstrap = f.read({ type: "snapshot" }, "bootstrap");
  await until(() => f.state.inFlight === 1);
  // Test the admitted host epoch through the reserved local lookup (not bootstrap mutation authorization).
  // A separate admission-unit probe below covers known epoch admission before ready.
  assert.equal((await bootstrap).code, "READ_TIMEOUT");
  assert.equal(f.state.calls.filter((c) => c.name === "update").length, 1);
  await until(() => f.state.calls.at(-1).args.at(-1).signal.aborted); // startup's independent deadline
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, true);
  await tick(); // Settle the aborted snapshot readiness waiter before a fresh read.
  const callsBeforeWait = f.state.calls.length;
  // This new reader waits on service readiness and expires before any SDK call.
  assert.equal((await f.read({ type: "snapshot" })).code, "READ_TIMEOUT");
  assert.equal(f.state.calls.length, callsBeforeWait);
  assert.equal(f.state.inFlight, 1); // Original startup actual still owns its lane.
  pending.resolve();
  await until(() => f.state.inFlight === 0);
  await tick();
  assert.equal(f.state.calls.filter((c) => c.name === "create").length, 0);
});

test("mutation identity, admission1, no late ready dispatch and reserved lookup independent of ready", async (t) => {
  const ready = deferred();
  let dispatches = 0;
  const admission = createHostAdmission({
    ready: () => ready.promise,
    revision: () => 0,
    deadlineMs: 50,
    execute: async () => {
      dispatches++;
      return { ok: true, value: {} };
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const request = {
    version: 2,
    runtimeEpoch: admission.epoch,
    operationId: "intent",
    operation: { type: "workspace.import" },
  };
  const waiting = admission.handle(request, "a");
  const duplicate = await admission.handle(request, "a");
  assert.equal(duplicate.value.status, "duplicate");
  assert.equal(duplicate.receipt.admission, "admitted");
  assert.equal(
    (
      await admission.handle(
        { ...request, operation: { type: "workspace.create" } },
        "a",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    (await admission.handle({ ...request, operationId: "other" }, "a")).code,
    "BUSY",
  );
  const lookup = await admission.handle(
    {
      version: 2,
      runtimeEpoch: admission.epoch,
      readId: "r",
      operation: {
        type: "operation.lookup",
        runtimeEpoch: admission.epoch,
        operationId: "intent",
      },
    },
    "a",
  );
  assert.equal(lookup.value.receipt.effect, "none");
  assert.equal((await waiting).receipt.effect, "none");
  ready.resolve();
  await tick();
  await tick();
  assert.equal(dispatches, 0);
  assert.equal(
    (await admission.handle(request, "a")).value.status,
    "duplicate",
  );
});

test("late native create finalizes SAME host registry and evidence receipt; no duplicate replay", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 70 });
  const initial = await f.bootstrap();
  const pending = deferred();
  f.state.hooks.create = () => pending.promise;
  const op = {
    type: "session.create",
    workspaceId: initial.selectedWorkspaceId,
    title: "SECRET NEW TITLE",
  };
  const waiting = f.mutate(op, "create-late");
  await until(() => f.state.calls.some((c) => c.name === "create"));
  assert.equal((await waiting).code, "UNKNOWN_OUTCOME");
  assert.equal((await f.mutate(op, "create-late")).value.status, "duplicate");
  assert.equal((await f.mutate(op, "second-create")).code, "BUSY");
  assert.equal(f.state.inFlight, 1);
  const result = f.info("late-native", { title: op.title });
  f.records.set(result.id, result);
  pending.resolve(result);
  await until(
    () => f.state.calls.filter((c) => c.name === "update").length >= 2,
  );
  await delay(10);
  const found = await f.lookup("create-late");
  assert.equal(found.value.receipt.result.kind, "created");
  assert.equal(found.value.receipt.result.nativeSessionId, "late-native");
  assert.equal(found.value.receipt.effect, "confirmed");
  assert.equal(JSON.stringify(found).includes(op.title), false);
  assert.equal(JSON.stringify(found).includes(f.root), false);
  const fresh = await f.read({ type: "snapshot" });
  assert.equal(fresh.value.sessions.length, 2);
  assert.equal(f.state.calls.filter((c) => c.name === "create").length, 1);
});

test("all mutation types are pre-effect deduplicated, receipts closed and first normal DTO separate", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 1000 });
  let snapshot = await f.bootstrap();
  const ids = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  const imported = join(f.root, "imported");
  await mkdir(imported);
  f.state.pick = imported;
  let ordinal = 0;
  const exercise = async (op) => {
    const id = `all-${++ordinal}`;
    const first = await f.mutate(op, id);
    const count = f.state.calls.length;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.ok(first.receipt);
    assert.ok(first.value);
    const second = await f.mutate(op, id);
    assert.deepEqual(second.value, { status: "duplicate" });
    assert.equal(f.state.calls.length, count);
    assert.deepEqual(second.receipt, first.receipt);
    assert.equal(
      (
        await f.mutate(
          {
            ...op,
            ...(op.title !== undefined
              ? { title: "CONFLICT" }
              : { extra: "invalid" }),
          },
          id,
        )
      ).ok,
      false,
    );
    const lookup = await f.lookup(id);
    assert.deepEqual(lookup.value.receipt, first.receipt);
    for (const secret of [
      "PRIVATE TITLE",
      "SECRET PROMPT",
      "SECRET ARGUMENT",
      f.root,
      "PRIVATE TOKEN",
    ])
      assert.equal(JSON.stringify(lookup).includes(secret), false);
    return first;
  };
  await exercise({
    type: "session.rename",
    ...ids,
    requestId: "native-rename",
    title: "PRIVATE TITLE",
  });
  await exercise({
    type: "session.pin",
    ...ids,
    requestId: "native-pin",
    pinned: true,
  });
  await exercise({
    type: "session.archive",
    ...ids,
    requestId: "native-archive",
    archived: true,
  });
  await f.mutate(
    {
      type: "session.archive",
      ...ids,
      requestId: "native-restore",
      archived: false,
    },
    "restore",
  );
  await exercise({ type: "session.fork", ...ids, requestId: "native-fork" });
  const send = await exercise({
    type: "message.send",
    ...ids,
    requestId: "native-send",
    text: "SECRET PROMPT",
  });
  assert.equal(send.receipt.result.kind, "delivery");
  assert.ok(send.receipt.result.nativeInboxId);
  // Correlated Native User ACK confirms inbox admission, not provider execution.
  assert.equal(send.receipt.effect, "confirmed");
  await exercise({ type: "session.interrupt", ...ids });
  f.records.get("native-default").time = { idle: Date.now() + 1000 };
  await f.read({ type: "snapshot", ...ids });
  await exercise({
    type: "command.run",
    ...ids,
    requestId: "native-command",
    name: "review",
    arguments: "SECRET ARGUMENT",
  });
  f.state.permissions = [
    { id: "permission-native", sessionID: "native-default" },
  ];
  await exercise({
    type: "permission.respond",
    ...ids,
    requestId: "permission-native",
    decision: "once",
  });
  const importedResult = await exercise({ type: "workspace.import" });
  const importedId = importedResult.value.selectedWorkspaceId;
  const created = await exercise({
    type: "session.create",
    workspaceId: importedId,
    title: "PRIVATE TITLE",
  });
  const childId = created.value.selectedSessionId;
  await exercise({
    type: "session.remove",
    workspaceId: importedId,
    sessionId: childId,
    requestId: "native-remove",
  });
  await exercise({ type: "workspace.remove", workspaceId: importedId });
  f.state.pick = f.root;
  const folder = await exercise({
    type: "workspace.create",
    name: "created-folder",
  });
  assert.equal(folder.receipt.result.kind, "created");
});

test("receipt cap2048 keeps rejected identities; missing and old epoch never imply no effect", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 1000 });
  await f.bootstrap();
  for (let i = 0; i < 2048; i++)
    assert.equal(
      (
        await f.mutate(
          { type: "workspace.remove", workspaceId: "missing" },
          `cap-${i}`,
        )
      ).code,
      "NOT_FOUND",
    );
  assert.equal(
    (await f.mutate({ type: "workspace.import" }, "overflow")).code,
    "LIMIT_REACHED",
  );
  assert.equal(
    (
      await f.mutate(
        { type: "workspace.remove", workspaceId: "missing" },
        "cap-0",
      )
    ).value.status,
    "duplicate",
  );
  assert.equal((await f.lookup("cap-0")).value.receipt.effect, "none");
  assert.deepEqual((await f.lookup("absent")).value, {
    status: "missing",
    runtimeEpoch: f.epoch,
    operationId: "absent",
    effect: "unknown",
  });
  assert.deepEqual((await f.lookup("cap-0", "old-epoch")).value, {
    status: "wrong_epoch",
    runtimeEpoch: "old-epoch",
    operationId: "cap-0",
    effect: "unknown",
  });
});

test("redactor never retains raw DTO, private digest or nested payload", () => {
  const record = {
    runtimeEpoch: "e",
    operationId: "o",
    type: "message.send",
    admission: "dispatched",
    delivery: "accepted",
    effect: "pending",
    revision: 1,
    digest: "PRIVATE",
    text: "PRIVATE",
    evidence: [{ kind: "inbox", id: "native", payload: "PRIVATE" }],
    result: {
      kind: "delivery",
      status: "accepted",
      nativeInboxId: "native",
      snapshot: { text: "PRIVATE" },
      path: "PRIVATE",
    },
  };
  assert.equal(
    JSON.stringify(redactReceipt(record)).includes("PRIVATE"),
    false,
  );
});

test("shared startup/mutation lane and read classes bound actual SDK4 without fanout or queue; lookup8 reserved", async (t) => {
  const pending = deferred();
  const ready = Promise.resolve();
  let calls = 0;
  let inFlight = 0;
  let max = 0;
  let admission;
  const sdk = async () => {
    calls++;
    inFlight++;
    max = Math.max(max, inFlight);
    try {
      return await pending.promise;
    } finally {
      inFlight--;
    }
  };
  admission = createHostAdmission({
    ready: () => ready,
    revision: () => 0,
    deadlineMs: 150,
    execute: async (operation) => {
      await admission.sdk(sdk, []);
      return { ok: true, value: operation.type };
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const epoch = admission.epoch;
  const request = (type, readId) => ({
    version: 2,
    runtimeEpoch: epoch,
    readId,
    operation: {
      type,
      ...(type === "catalog.list" || type === "file.list"
        ? { workspaceId: "w" }
        : {}),
    },
  });
  const startup = admission.startup(() => admission.sdk(sdk, []));
  startup.catch(() => {});
  const reads = ["snapshot", "catalog.list", "file.list"].map((type, i) =>
    admission.handle(request(type, `read-${i}`), "a"),
  );
  await until(() => calls === 4);
  assert.equal(max, 4);
  const overflow = await admission.handle(request("snapshot", "other"), "b");
  assert.equal(overflow.code, "READ_BUSY");
  const lookupOp = {
    type: "operation.lookup",
    runtimeEpoch: epoch,
    operationId: "absent",
  };
  const lookupReads = Array.from({ length: 8 }, (_, i) =>
    admission.handle(
      {
        version: 2,
        runtimeEpoch: epoch,
        readId: `lookup-${i}`,
        operation: lookupOp,
      },
      "a",
    ),
  );
  assert.equal(
    (
      await admission.handle(
        {
          version: 2,
          runtimeEpoch: epoch,
          readId: "lookup-overflow",
          operation: lookupOp,
        },
        "a",
      )
    ).code,
    "READ_BUSY",
  );
  for (const result of await Promise.all(lookupReads))
    assert.equal(result.value.status, "missing");
  for (const result of await Promise.all(reads))
    assert.equal(result.code, "READ_TIMEOUT");
  assert.equal(calls, 4);
  assert.equal(inFlight, 4);
  pending.resolve();
  await Promise.allSettled([startup]);
  await tick();
  assert.equal(inFlight, 0);
  const fresh = await admission.handle(request("snapshot", "fresh"), "a");
  assert.equal(fresh.ok, true);
  assert.equal(calls, 5);
});

test("epoch and revision rejection occurs before effects; closed service cannot resurrect native creation", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 500 });
  const initial = await f.bootstrap();
  const op = {
    type: "session.create",
    workspaceId: initial.selectedWorkspaceId,
  };
  const before = f.state.calls.length;
  assert.equal(
    (await f.mutate(op, "wrong-epoch", { runtimeEpoch: "wrong" })).code,
    "STALE_EPOCH",
  );
  assert.equal(
    (
      await f.mutate(op, "wrong-revision", {
        expectedRevision: initial.revision - 1,
      })
    ).code,
    "STALE_REVISION",
  );
  assert.equal(f.state.calls.length, before);
  const pending = deferred();
  f.state.hooks.create = () => pending.promise;
  const waiting = f.mutate(op, "close-create");
  await until(() => f.state.calls.some((c) => c.name === "create"));
  f.service.close();
  assert.equal((await waiting).code, "UNKNOWN_OUTCOME");
  pending.resolve(f.info("closed-native"));
  await until(() => f.state.inFlight === 0);
  await tick();
  assert.equal((await f.read({ type: "snapshot" })).code, "UNAVAILABLE");
  assert.equal(f.state.calls.filter((c) => c.name === "update").length, 1);
});

test("whole catalog deadline stops sequential siblings, without aggregate fanout", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 65 });
  const initial = await f.bootstrap();
  const count = f.state.calls.length;
  for (const name of [
    "commands",
    "skills",
    "mcp",
    "agents",
    "models",
    "providers",
    "integrations",
  ]) {
    f.state.hooks[name] = async () => {
      await delay(24);
      return { data: [] };
    };
  }
  assert.equal(
    (
      await f.read({
        type: "catalog.list",
        workspaceId: initial.selectedWorkspaceId,
      })
    ).code,
    "READ_TIMEOUT",
  );
  await until(() => f.state.inFlight === 0);
  await tick();
  const started = f.state.calls.slice(count).map((call) => call.name);
  assert.deepEqual(started, ["commands", "skills", "mcp"]);
  assert.equal(f.state.max, 1);
});

test("read cancellation detaches from ready and does not abort service-owned startup", async (t) => {
  const startup = deferred();
  const f = await hostFixture(t, {
    deadlineMs: 300,
    startup: () => startup.promise,
  });
  const waiting = f.read({ type: "snapshot" }, "boot");
  await until(() => f.state.inFlight === 1);
  // The transport epoch is intentionally unavailable before bootstrap; sender close is authoritative.
  f.service.closeSender("sender-a");
  assert.equal((await waiting).code, "CANCELLED");
  assert.equal(f.state.calls[0].args.at(-1).signal.aborted, false);
  startup.resolve();
  await until(() => f.state.calls.some((call) => call.name === "get"));
  await delay(5);
  delete f.state.hooks.update;
  const snapshot = await f.bootstrap();
  assert.equal(snapshot.state, "connected");
  assert.equal(
    f.state.calls.filter((call) => call.name === "update").length,
    1,
  );
});

test("late send, fork, rename and permission acknowledgements reconcile only their original operation", async (t) => {
  for (const type of [
    "message.send",
    "session.fork",
    "session.rename",
    "permission.respond",
  ]) {
    await t.test(type, async (t) => {
      const f = await hostFixture(t, { deadlineMs: 60 });
      const initial = await f.bootstrap();
      const target = {
        workspaceId: initial.selectedWorkspaceId,
        sessionId: initial.selectedSessionId,
        requestId: "native-request",
      };
      const pending = deferred();
      let fired = false;
      let operation;
      let result;
      let method;
      if (type === "message.send") {
        method = "prompt";
        operation = { type, ...target, text: "PRIVATE LATE PROMPT" };
        result = {
          id: "late-inbox",
          sessionID: "native-default",
          type: "user",
          payload: { text: operation.text },
        };
      } else if (type === "session.fork") {
        method = "fork";
        operation = { type, ...target };
        result = f.info("late-fork", { parentID: "native-default" });
        f.records.set(result.id, result);
      } else if (type === "session.rename") {
        method = "update";
        operation = { type, ...target, title: "PRIVATE LATE TITLE" };
      } else {
        method = "reply";
        operation = { type, ...target, decision: "once" };
        f.state.permissions = [
          {
            id: target.requestId,
            sessionID: "native-default",
            detail: "PRIVATE PERMISSION DETAIL",
          },
        ];
      }
      f.state.hooks[method] = () => {
        fired = true;
        return pending.promise;
      };
      const response = f.mutate(operation, "late-intent");
      await until(() => fired);
      assert.equal((await response).code, "UNKNOWN_OUTCOME");
      assert.equal(
        (await f.mutate(operation, "late-intent")).value.status,
        "duplicate",
      );
      assert.equal(
        (await f.lookup("late-intent")).value.receipt.effect,
        "unknown",
      );
      if (type === "session.rename")
        f.records.get("native-default").title = operation.title;
      delete f.state.hooks[method];
      pending.resolve(result);
      await until(() => f.state.inFlight === 0);
      await delay(8);
      const found = await f.lookup("late-intent");
      assert.equal(
        found.value.receipt.delivery,
        "accepted",
        JSON.stringify(found),
      );
      assert.equal(
        found.value.receipt.effect,
        type === "permission.respond" ? "pending" : "confirmed",
      );
      assert.equal(JSON.stringify(found).includes("PRIVATE"), false);
      if (type === "message.send")
        assert.equal(found.value.receipt.result.nativeInboxId, "late-inbox");
      if (type === "permission.respond")
        assert.equal(
          found.value.receipt.result.nativeRequestId,
          "native-request",
        );
      const count = f.state.calls.filter((c) => c.name === method).length;
      assert.equal(
        (await f.mutate(operation, "late-intent")).value.status,
        "duplicate",
      );
      assert.equal(
        f.state.calls.filter((c) => c.name === method).length,
        count,
      );
    });
  }
});

test("a late native dialog never starts a new filesystem effect or SDK dispatch", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 60 });
  await f.bootstrap();
  const pending = deferred();
  f.state.hooks.dialog = () => pending.promise;
  const response = f.mutate(
    { type: "workspace.create", name: "never-created" },
    "dialog-expired",
  );
  await until(() => f.state.calls.some((c) => c.name === "dialog"));
  assert.equal((await response).code, "UNKNOWN_OUTCOME");
  assert.equal(
    (await f.mutate({ type: "workspace.import" }, "another-dialog")).code,
    "BUSY",
  );
  pending.resolve(f.root);
  await delay(8);
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(join(f.root, "never-created")), {
    code: "ENOENT",
  });
  assert.equal(
    (await f.lookup("dialog-expired")).value.receipt.effect,
    "unknown",
  );
  assert.equal(f.state.calls.filter((c) => c.name === "dialog").length, 1);
});

test("only exact typed empty-session fork rejection proves none; lookalike remains unknown", async (t) => {
  for (const typed of [true, false]) {
    await t.test(typed ? "exact rejection" : "lookalike", async (t) => {
      const f = await hostFixture(t);
      const initial = await f.bootstrap();
      f.state.hooks.fork = () => {
        throw {
          _tag: typed ? "InvalidRequestError" : "OtherError",
          kind: "empty_session",
          message: "PRIVATE RAW ERROR",
        };
      };
      const operation = {
        type: "session.fork",
        workspaceId: initial.selectedWorkspaceId,
        sessionId: initial.selectedSessionId,
        requestId: "native-fork",
      };
      const result = await f.mutate(operation, "empty");
      assert.equal(result.code, typed ? "EMPTY_SESSION" : "UNKNOWN_OUTCOME");
      assert.equal(result.receipt.effect, typed ? "none" : "unknown");
      const count = f.state.calls.filter((c) => c.name === "fork").length;
      assert.equal(
        (await f.mutate(operation, "empty")).value.status,
        "duplicate",
      );
      assert.equal(
        f.state.calls.filter((c) => c.name === "fork").length,
        count,
      );
      assert.equal(
        JSON.stringify(await f.lookup("empty")).includes("PRIVATE RAW ERROR"),
        false,
      );
    });
  }
});

test("MCP receipt projection contains only the matching confirmed target and never a speculative or private payload", async () => {
  const { mcpNativeName } = await import("./workbench-mcp.mjs");
  const nativeName = mcpNativeName("workspace", "sample");
  const record = {
    runtimeEpoch: "epoch",
    operationId: "mcp",
    type: "configuration.mcp.register",
    workspaceId: "workspace",
    nativeServerName: nativeName,
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    revision: 3,
    evidence: [],
    digest: "PRIVATE ADMISSION",
    text: "PRIVATE DEFINITION",
    result: {
      kind: "mcp_registered",
      workspaceId: "workspace",
      sourceName: "sample",
      nativeName,
      digest: "a".repeat(64),
      sourceVersion: "b".repeat(64),
      status: "disabled",
      config: { secret: "PRIVATE DEFINITION" },
      error: "PRIVATE RAW ERROR",
    },
  };
  const projected = redactReceipt(record);
  assert.equal(projected.result.kind, "mcp_registered");
  assert.ok(!Object.hasOwn(projected, "nativeServerName"));
  assert.ok(!JSON.stringify(projected).includes("PRIVATE"));
  for (const change of [
    { effect: "unknown" },
    { delivery: "unknown" },
    { admission: "admitted" },
    { type: "session.pin" },
    { workspaceId: "other" },
    { nativeServerName: mcpNativeName("workspace", "other") },
    {
      result: {
        ...record.result,
        nativeName: mcpNativeName("workspace", "other"),
      },
    },
    { result: { ...record.result, sourceName: "bad name" } },
    { result: { ...record.result, status: "connected" } },
  ])
    assert.equal(
      redactReceipt({ ...record, ...change }).result,
      undefined,
      JSON.stringify(change),
    );
  const removed = {
    ...record,
    type: "configuration.mcp.remove",
    admission: "admitted",
    effect: "none",
    result: {
      kind: "mcp_removed",
      workspaceId: "workspace",
      sourceName: "sample",
      nativeName,
    },
  };
  assert.equal(redactReceipt(removed).result.kind, "mcp_removed");
  assert.equal(
    redactReceipt({ ...removed, effect: "unknown" }).result,
    undefined,
  );
  for (const [action, status] of [
    ["connect", "failed"],
    ["connect", "needs_auth"],
    ["connect", "connected"],
    ["disconnect", "disabled"],
  ]) {
    const connection = {
      ...record,
      type: `configuration.mcp.${action}`,
      result: {
        kind: "mcp_connection",
        workspaceId: "workspace",
        sourceName: "sample",
        nativeName,
        action,
        connectionStatus: status,
      },
    };
    assert.equal(redactReceipt(connection).result.connectionStatus, status);
    assert.equal(
      redactReceipt({ ...connection, effect: "unknown" }).result,
      undefined,
    );
  }
});

const skillOperation = (extra = {}) => ({
  type: "configuration.skill.save",
  workspaceId: "ws",
  sourceName: "review",
  requestId: "request",
  text: "# Synthetic skill",
  directoryVersion: "d".repeat(64),
  expectation: "missing",
  ...extra,
});
test("SKILL admission derives exact private name at normal and rejection begin sites", async (t) => {
  const begins = [],
    executed = [];
  const started = deferred(),
    held = deferred();
  let hold = false;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    revision: () => 0,
    ready: () => Promise.resolve(),
    registry: () => ({
      status: () => ({ state: "ready" }),
      lookup: () => ({ status: "missing" }),
      begin: async (input) => {
        begins.push(input);
        const {
          digest: _digest,
          skillSourceName: _name,
          rejectionCode,
          expectedRevision: _revision,
          ...identity
        } = input;
        return {
          status: rejectionCode ? "rejected" : "admitted",
          receipt: {
            ...identity,
            admission: rejectionCode ? "rejected" : "admitted",
            delivery: "pending",
            effect: "none",
            revision: 0,
            evidence: [],
            ...(rejectionCode && {
              result: { kind: "rejected", code: rejectionCode },
            }),
          },
        };
      },
    }),
    execute: async () => {
      assert.equal(Object.hasOwn(currentScope().record, "sessionId"), true);
      assert.equal(currentScope().record.sessionId, undefined);
      executed.push(currentScope().record.skillSourceName);
      if (hold) {
        started.resolve();
        await held.promise;
      }
      return { ok: true, value: { status: "saved" } };
    },
    projectReceipt: async (record) => {
      Object.assign(record, {
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        result: {
          kind: "skill_file_saved",
          workspaceId: "ws",
          sourceName: record.skillSourceName,
          version: "a".repeat(64),
        },
      });
    },
  });
  t.after(() => admission.close());
  const send = (id, operation = skillOperation(), expectedRevision) =>
    admission.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: id,
        operation,
        ...(expectedRevision !== undefined && { expectedRevision }),
      },
      "sender",
    );
  const saved = await send("normal");
  assert.equal(saved.receipt.result.sourceName, "review");
  assert.equal(saved.receipt.skillSourceName, undefined);
  assert.equal(
    (await send("stale", skillOperation({ sourceName: "stale_name" }), 1)).code,
    "STALE_REVISION",
  );
  hold = true;
  const waiting = send("held");
  await started.promise;
  assert.equal(
    (await send("busy", skillOperation({ sourceName: "busy_name" }))).code,
    "BUSY",
  );
  held.resolve();
  await waiting;
  assert.deepEqual(executed, ["review", "review"]);
  assert.deepEqual(
    begins.map((input) => [
      input.operationId,
      input.skillSourceName,
      input.rejectionCode,
    ]),
    [
      ["normal", "review", undefined],
      ["stale", "stale_name", "STALE_REVISION"],
      ["held", "review", undefined],
      ["busy", "busy_name", "BUSY"],
    ],
  );
  assert.equal(
    (await send("session", skillOperation({ sessionId: "forbidden" }))).code,
    "INVALID_REQUEST",
  );
  assert.equal(begins.length, 4);
});

test("SKILL list/read share bounded files lane with existing file reads", async (t) => {
  for (const type of ["configuration.skill.list", "configuration.skill.read"]) {
    const started = deferred(),
      held = deferred();
    const admission = createHostAdmission({
      runtimeEpoch: "epoch",
      ready: () => Promise.resolve(),
      revision: () => 0,
      projectReceipt: () => {},
      execute: async (op) => {
        if (op.type === type) {
          assert.equal(currentScope().kind, "files");
          started.resolve();
          await held.promise;
        }
        return { ok: true, value: {} };
      },
    });
    t.after(() => admission.close());
    const read = (id, operation) =>
      admission.handle(
        { version: 2, runtimeEpoch: "epoch", readId: id, operation },
        "sender",
      );
    const waiting = read("skill", {
      type,
      workspaceId: "ws",
      ...(type.endsWith("read") && { sourceName: "review" }),
    });
    await started.promise;
    assert.equal(
      (
        await read("legacy", {
          type: "configuration.read",
          workspaceId: "ws",
          kind: "instructions",
        })
      ).code,
      "READ_BUSY",
    );
    assert.equal((await read("snapshot", { type: "snapshot" })).ok, true);
    held.resolve();
    assert.equal((await waiting).ok, true);
  }
});

test("SKILL timeout removes speculative success and same key never reexecutes; digest binds whole request", async (t) => {
  let calls = 0;
  const held = deferred();
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    deadlineMs: 25,
    projectReceipt: () => {},
    execute: async () => {
      calls++;
      const owner = currentScope();
      owner.markEffect();
      owner.record.result = {
        kind: "skill_file_saved",
        workspaceId: "ws",
        sourceName: "review",
        version: "a".repeat(64),
      };
      await held.promise;
      return { ok: true, value: {} };
    },
  });
  t.after(() => admission.close());
  const send = (op) =>
    admission.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: "original",
        operation: op,
      },
      "sender",
    );
  const result = await send(skillOperation());
  assert.equal(result.code, "UNKNOWN_OUTCOME");
  assert.equal(result.receipt.result, undefined);
  assert.equal((await send(skillOperation())).receipt.effect, "unknown");
  for (const change of [
    { sourceName: "other" },
    { text: "changed" },
    { directoryVersion: "e".repeat(64) },
  ])
    assert.equal(
      (await send(skillOperation(change))).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(calls, 1);
  assert.equal(
    admission.lookup({ runtimeEpoch: "epoch", operationId: "original" }).receipt
      .result,
    undefined,
  );
  held.resolve();
  await admission.drain({ deadlineMs: 1000 });
});

import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";
const runtimeOperation = (operationId = "runtime-register", extra = {}) => ({
  type: "configuration.skill.register",
  requestId: operationId,
  workspaceId: "ws",
  sourceName: "review",
  observationId: "observation",
  version: "a".repeat(64),
  directoryVersion: "b".repeat(64),
  digest: "c".repeat(64),
  ...extra,
});

test("Native Skill runtime refuses bare mutations and mismatched original request IDs before execution", async (t) => {
  let executions = 0;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    execute: () => {
      executions++;
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const result = await admission.handle(
    {
      version: 2,
      runtimeEpoch: "epoch",
      operationId: "runtime-register",
      operation: runtimeOperation(),
    },
    "sender",
  );
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(executions, 0);
  const durable = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    registry: () => ({ status: () => ({ state: "ready" }) }),
    execute: () => {
      executions++;
    },
    projectReceipt: () => {},
  });
  t.after(() => durable.close());
  assert.equal(
    (
      await durable.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          operationId: "different",
          operation: runtimeOperation(),
        },
        "sender",
      )
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(executions, 0);
});

test("Native Skill runtime explicit read shares files lane while snapshot remains available", async (t) => {
  const started = deferred(),
    held = deferred();
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: () => {},
    execute: async (op) => {
      if (op.type === "configuration.skill.runtime.read") {
        assert.equal(currentScope().kind, "files");
        started.resolve();
        await held.promise;
      }
      return { ok: true, value: {} };
    },
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const read = (readId, operation) =>
    admission.handle(
      { version: 2, runtimeEpoch: "epoch", readId, operation },
      "sender",
    );
  const pending = read("runtime", {
    type: "configuration.skill.runtime.read",
    workspaceId: "ws",
    sourceName: "review",
    sessionId: "session",
  });
  await started.promise;
  assert.equal(
    (
      await read("file", {
        type: "configuration.skill.read",
        workspaceId: "ws",
        sourceName: "review",
      })
    ).code,
    "READ_BUSY",
  );
  assert.equal((await read("snapshot", { type: "snapshot" })).ok, true);
  held.resolve();
  assert.equal((await pending).ok, true);
});

async function runtimeAdmissionFixture(t, io = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "runtime-admission-")),
  );
  const directory = join(root, "metadata");
  await mkdir(directory);
  const registry = await openWorkspaceRegistry({
    directory,
    documentsPath: root,
    storeId: "store",
    runtimeEpoch: "epoch",
    io,
  });
  t.after(async () => {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  });
  const key = { runtimeEpoch: "epoch", operationId: "seed" };
  await registry.begin({
    ...key,
    type: "workspace.import",
    digest: "a".repeat(64),
  });
  const reserved = await registry.reserve({
    ...key,
    ownership: "imported",
    canonicalPath: root,
    plannedNativeSessionId: "native",
  });
  await registry.dispatch({
    ...key,
    step: "native.create",
    nativeSessionId: "native",
  });
  await registry.complete({
    ...key,
    receipt: {
      ...key,
      type: "workspace.import",
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 0,
      evidence: [],
      result: {
        kind: "created",
        workspaceId: reserved.workspace.workspaceId,
        sessionId: reserved.appSessionId,
        nativeSessionId: "native",
      },
    },
    delta: {
      workspaces: [{ ...reserved.workspace, registrationState: "registered" }],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: reserved.workspace.workspaceId,
          nativeSessionId: "native",
          lifecycleState: "active",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: ["native"],
  });
  return { registry, workspaceId: reserved.workspace.workspaceId };
}

test("Native Skill runtime SDK effect waits for actual dispatch flush, persists exact original receipt and never replays", async (t) => {
  const entered = deferred(),
    held = deferred();
  let armed = false,
    calls = 0;
  const f = await runtimeAdmissionFixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:dispatch") {
        entered.resolve();
        await held.promise;
      }
      await file.sync();
    },
  });
  const operation = runtimeOperation("runtime-register", {
    workspaceId: f.workspaceId,
  });
  const key = { runtimeEpoch: "epoch", operationId: operation.requestId };
  const target = {
    sourceName: "review",
    nativeId: nativeSkillRegistrationId({
      ...key,
      workspaceId: f.workspaceId,
      sourceName: "review",
    }),
    digest: operation.digest,
    nativeDigest: "d".repeat(64),
    bodyDigest: "e".repeat(64),
    registrationRuntimeEpoch: "epoch",
    registrationOperationId: operation.requestId,
  };
  let admission;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => f.registry.status().revision,
    registry: () => f.registry,
    deadlineMs: 2000,
    execute: async () => {
      currentScope().beforeEffect = async () => {
        const result = await f.registry.dispatch({
          ...key,
          step: "native.skill.register",
          skillRuntime: target,
        });
        assert.equal(result.status, "dispatched");
      };
      await admission.sdk(
        async () => {
          calls++;
        },
        [],
        true,
      );
      return { ok: true, value: {} };
    },
    projectReceipt: async (record) => {
      const result = await f.registry.complete({
        ...key,
        receipt: {
          ...redactReceipt(record),
          delivery: "accepted",
          effect: "confirmed",
          result: {
            kind: "skill_registered",
            workspaceId: f.workspaceId,
            ...target,
            version: operation.version,
            directoryVersion: operation.directoryVersion,
          },
        },
        delta: { workspaces: [], sessions: [], tombstones: [] },
      });
      Object.assign(record, result.receipt);
    },
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const send = (op = operation) =>
    admission.handle({ version: 2, ...key, operation: op }, "sender");
  armed = true;
  const pending = send();
  await entered.promise;
  assert.equal(calls, 0);
  assert.equal(f.registry.lookup(key).receipt.admission, "admitted");
  held.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.receipt.result.nativeId, target.nativeId);
  assert.equal(result.receipt.result.bodyDigest, target.bodyDigest);
  assert.equal(result.receipt.skillRuntime, undefined);
  assert.equal((await send()).value.status, "duplicate");
  for (const extra of [
    { sourceName: "other" },
    { digest: "0".repeat(64) },
    { version: "0".repeat(64) },
    { directoryVersion: "0".repeat(64) },
    { observationId: "other" },
  ])
    assert.equal(
      (await send({ ...operation, ...extra })).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(calls, 1);
});

test("Native Skill runtime timed-out effect retains durable unknown original key and strips speculative success", async (t) => {
  const f = await runtimeAdmissionFixture(t);
  const entered = deferred(),
    held = deferred();
  let calls = 0;
  const operation = runtimeOperation("runtime-timeout", {
    workspaceId: f.workspaceId,
  });
  const key = { runtimeEpoch: "epoch", operationId: operation.requestId };
  const target = {
    sourceName: "review",
    nativeId: nativeSkillRegistrationId({
      ...key,
      workspaceId: f.workspaceId,
      sourceName: "review",
    }),
    digest: operation.digest,
    nativeDigest: "d".repeat(64),
    bodyDigest: "e".repeat(64),
    registrationRuntimeEpoch: "epoch",
    registrationOperationId: key.operationId,
  };
  let admission, retainedRecord;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    registry: () => f.registry,
    ready: () => Promise.resolve(),
    revision: () => f.registry.status().revision,
    deadlineMs: 300,
    execute: async () => {
      const owner = currentScope();
      retainedRecord = owner.record;
      owner.beforeEffect = async () => {
        await f.registry.dispatch({
          ...key,
          step: "native.skill.register",
          skillRuntime: target,
        });
      };
      await admission.sdk(
        async () => {
          calls++;
          owner.record.result = {
            kind: "skill_registered",
            workspaceId: f.workspaceId,
            ...target,
            version: operation.version,
            directoryVersion: operation.directoryVersion,
          };
          entered.resolve();
          await held.promise;
        },
        [],
        true,
      );
      return { ok: true, value: {} };
    },
    projectReceipt: () =>
      assert.fail("timed-out effect must not fabricate completion"),
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const envelope = { version: 2, ...key, operation };
  const pending = admission.handle(envelope, "sender");
  await entered.promise;
  const result = await pending;
  assert.equal(result.code, "UNKNOWN_OUTCOME");
  assert.equal(result.receipt.result, undefined);
  assert.equal(retainedRecord.result, undefined);
  assert.equal(result.receipt.operationId, key.operationId);
  assert.equal(
    (await admission.handle(envelope, "sender")).receipt.effect,
    "unknown",
  );
  assert.equal(calls, 1);
  held.resolve();
  await admission.drain();
  assert.equal(f.registry.lookup(key).receipt.effect, "unknown");
  assert.equal(f.registry.lookup(key).receipt.result, undefined);
});

import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";
const agentOperation = (operationId = "runtime-register", extra = {}) => ({
  type: "configuration.agent.register",
  requestId: operationId,
  workspaceId: "ws",
  sourceName: "review",
  observationId: "observation",
  version: "a".repeat(64),
  directoryVersion: "b".repeat(64),
  digest: "c".repeat(64),
  ...extra,
});

test("Native Agent runtime refuses bare mutations and mismatched original request IDs before execution", async (t) => {
  let executions = 0;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    execute: () => {
      executions++;
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const result = await admission.handle(
    {
      version: 2,
      runtimeEpoch: "epoch",
      operationId: "runtime-register",
      operation: agentOperation(),
    },
    "sender",
  );
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(executions, 0);
  const durable = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    registry: () => ({ status: () => ({ state: "ready" }) }),
    execute: () => {
      executions++;
    },
    projectReceipt: () => {},
  });
  t.after(() => durable.close());
  assert.equal(
    (
      await durable.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          operationId: "different",
          operation: agentOperation(),
        },
        "sender",
      )
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(executions, 0);
});

test("Native Agent runtime explicit read shares files lane while snapshot remains available", async (t) => {
  const started = deferred(),
    held = deferred();
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: () => {},
    execute: async (op) => {
      if (op.type === "configuration.agent.runtime.read") {
        assert.equal(currentScope().kind, "files");
        started.resolve();
        await held.promise;
      }
      return { ok: true, value: {} };
    },
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const read = (readId, operation) =>
    admission.handle(
      { version: 2, runtimeEpoch: "epoch", readId, operation },
      "sender",
    );
  const pending = read("runtime", {
    type: "configuration.agent.runtime.read",
    workspaceId: "ws",
    sourceName: "review",
  });
  await started.promise;
  assert.equal(
    (
      await read("file", {
        type: "configuration.agent.read",
        workspaceId: "ws",
        sourceName: "review",
      })
    ).code,
    "READ_BUSY",
  );
  assert.equal((await read("snapshot", { type: "snapshot" })).ok, true);
  held.resolve();
  assert.equal((await pending).ok, true);
});

async function agentAdmissionFixture(t, io = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "runtime-admission-")),
  );
  const directory = join(root, "metadata");
  await mkdir(directory);
  const registry = await openWorkspaceRegistry({
    directory,
    documentsPath: root,
    storeId: "store",
    runtimeEpoch: "epoch",
    io,
  });
  t.after(async () => {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  });
  const key = { runtimeEpoch: "epoch", operationId: "seed" };
  await registry.begin({
    ...key,
    type: "workspace.import",
    digest: "a".repeat(64),
  });
  const reserved = await registry.reserve({
    ...key,
    ownership: "imported",
    canonicalPath: root,
    plannedNativeSessionId: "native",
  });
  await registry.dispatch({
    ...key,
    step: "native.create",
    nativeSessionId: "native",
  });
  await registry.complete({
    ...key,
    receipt: {
      ...key,
      type: "workspace.import",
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 0,
      evidence: [],
      result: {
        kind: "created",
        workspaceId: reserved.workspace.workspaceId,
        sessionId: reserved.appSessionId,
        nativeSessionId: "native",
      },
    },
    delta: {
      workspaces: [{ ...reserved.workspace, registrationState: "registered" }],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: reserved.workspace.workspaceId,
          nativeSessionId: "native",
          lifecycleState: "active",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: ["native"],
  });
  return { registry, workspaceId: reserved.workspace.workspaceId };
}

test("Native Agent runtime SDK effect waits for actual dispatch flush, persists exact original receipt and never replays", async (t) => {
  const entered = deferred(),
    held = deferred();
  let armed = false,
    calls = 0;
  const f = await agentAdmissionFixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:dispatch") {
        entered.resolve();
        await held.promise;
      }
      await file.sync();
    },
  });
  const operation = agentOperation("runtime-register", {
    workspaceId: f.workspaceId,
  });
  const key = { runtimeEpoch: "epoch", operationId: operation.requestId };
  const target = {
    sourceName: "review",
    nativeId: nativeAgentRegistrationId({
      ...key,
      workspaceId: f.workspaceId,
      sourceName: "review",
    }),
    digest: operation.digest,
    nativeDigest: "d".repeat(64),
    systemDigest: "e".repeat(64),
    registrationRuntimeEpoch: "epoch",
    registrationOperationId: operation.requestId,
  };
  let admission;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => f.registry.status().revision,
    registry: () => f.registry,
    deadlineMs: 2000,
    execute: async () => {
      currentScope().beforeEffect = async () => {
        const result = await f.registry.dispatch({
          ...key,
          step: "native.agent.register",
          agentRuntime: target,
        });
        assert.equal(result.status, "dispatched");
      };
      await admission.sdk(
        async () => {
          calls++;
        },
        [],
        true,
      );
      return { ok: true, value: {} };
    },
    projectReceipt: async (record) => {
      const result = await f.registry.complete({
        ...key,
        receipt: {
          ...redactReceipt(record),
          delivery: "accepted",
          effect: "confirmed",
          result: {
            kind: "agent_registered",
            workspaceId: f.workspaceId,
            ...target,
            defaultAgentId: "build",
            version: operation.version,
            directoryVersion: operation.directoryVersion,
          },
        },
        delta: { workspaces: [], sessions: [], tombstones: [] },
      });
      Object.assign(record, result.receipt);
    },
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const send = (op = operation) =>
    admission.handle({ version: 2, ...key, operation: op }, "sender");
  armed = true;
  const pending = send();
  await entered.promise;
  assert.equal(calls, 0);
  assert.equal(f.registry.lookup(key).receipt.admission, "admitted");
  held.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.receipt.result.nativeId, target.nativeId);
  assert.equal(result.receipt.result.systemDigest, target.systemDigest);
  assert.equal(result.receipt.agentRuntime, undefined);
  assert.equal((await send()).value.status, "duplicate");
  for (const extra of [
    { sourceName: "other" },
    { digest: "0".repeat(64) },
    { version: "0".repeat(64) },
    { directoryVersion: "0".repeat(64) },
    { observationId: "other" },
  ])
    assert.equal(
      (await send({ ...operation, ...extra })).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(calls, 1);
});

test("Native Agent runtime timed-out effect retains durable unknown original key and strips speculative success", async (t) => {
  const f = await agentAdmissionFixture(t);
  const entered = deferred(),
    held = deferred();
  let calls = 0;
  const operation = agentOperation("runtime-timeout", {
    workspaceId: f.workspaceId,
  });
  const key = { runtimeEpoch: "epoch", operationId: operation.requestId };
  const target = {
    sourceName: "review",
    nativeId: nativeAgentRegistrationId({
      ...key,
      workspaceId: f.workspaceId,
      sourceName: "review",
    }),
    digest: operation.digest,
    nativeDigest: "d".repeat(64),
    systemDigest: "e".repeat(64),
    registrationRuntimeEpoch: "epoch",
    registrationOperationId: key.operationId,
  };
  let admission, retainedRecord;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    registry: () => f.registry,
    ready: () => Promise.resolve(),
    revision: () => f.registry.status().revision,
    deadlineMs: 300,
    execute: async () => {
      const owner = currentScope();
      retainedRecord = owner.record;
      owner.beforeEffect = async () => {
        await f.registry.dispatch({
          ...key,
          step: "native.agent.register",
          agentRuntime: target,
        });
      };
      await admission.sdk(
        async () => {
          calls++;
          owner.record.result = {
            kind: "agent_registered",
            workspaceId: f.workspaceId,
            ...target,
            defaultAgentId: "build",
            version: operation.version,
            directoryVersion: operation.directoryVersion,
          };
          entered.resolve();
          await held.promise;
        },
        [],
        true,
      );
      return { ok: true, value: {} };
    },
    projectReceipt: () =>
      assert.fail("timed-out effect must not fabricate completion"),
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const envelope = { version: 2, ...key, operation };
  const pending = admission.handle(envelope, "sender");
  await entered.promise;
  const result = await pending;
  assert.equal(result.code, "UNKNOWN_OUTCOME");
  assert.equal(result.receipt.result, undefined);
  assert.equal(retainedRecord.result, undefined);
  assert.equal(result.receipt.operationId, key.operationId);
  assert.equal(
    (await admission.handle(envelope, "sender")).receipt.effect,
    "unknown",
  );
  assert.equal(calls, 1);
  held.resolve();
  await admission.drain();
  assert.equal(f.registry.lookup(key).receipt.effect, "unknown");
  assert.equal(f.registry.lookup(key).receipt.result, undefined);
});

const agentFileOperation = (extra = {}) => ({
  type: "configuration.agent.save",
  workspaceId: "ws",
  sourceName: "review",
  requestId: "request",
  text: "# Synthetic agent",
  directoryVersion: "d".repeat(64),
  expectation: "missing",
  ...extra,
});

test("AGENT file requires durable admission and original request ID before execution", async (t) => {
  let calls = 0;
  for (const registry of [
    undefined,
    () => ({ status: () => ({ state: "ready" }) }),
  ]) {
    const admission = createHostAdmission({
      runtimeEpoch: "epoch",
      ready: () => Promise.resolve(),
      revision: () => 0,
      registry,
      execute: () => {
        calls++;
      },
      projectReceipt: () => {},
    });
    t.after(() => admission.close());
    const result = await admission.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: "different",
        operation: agentFileOperation(),
      },
      "sender",
    );
    assert.equal(result.code, registry ? "INVALID_REQUEST" : "UNAVAILABLE");
  }
  assert.equal(calls, 0);
});

test("AGENT file staged timeout persists original unknown key and strips speculative saved result", async (t) => {
  const f = await agentAdmissionFixture(t);
  const held = deferred(),
    entered = deferred();
  let calls = 0;
  const operation = agentFileOperation({
    requestId: "agent-file-timeout",
    workspaceId: f.workspaceId,
  });
  const key = { runtimeEpoch: "epoch", operationId: operation.requestId };
  let admission;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    ready: () => Promise.resolve(),
    revision: () => f.registry.status().revision,
    registry: () => f.registry,
    deadlineMs: 300,
    execute: async () => {
      const owner = currentScope();
      owner.beforeEffect = () =>
        f.registry.dispatch({ ...key, step: "filesystem.configuration.stage" });
      await admission.sdk(
        async () => {
          calls++;
          owner.record.result = {
            kind: "agent_file_saved",
            workspaceId: f.workspaceId,
            sourceName: "review",
            version: "a".repeat(64),
          };
          entered.resolve();
          await held.promise;
        },
        [],
        true,
      );
      return { ok: true, value: {} };
    },
    projectReceipt: () => assert.fail("timeout cannot mint a saved result"),
  });
  t.after(async () => {
    held.resolve();
    admission.close();
    await admission.drain();
  });
  const send = (op = operation) =>
    admission.handle({ version: 2, ...key, operation: op }, "sender");
  const pending = send();
  await entered.promise;
  const result = await pending;
  assert.equal(result.code, "UNKNOWN_OUTCOME");
  assert.equal(result.receipt.result, undefined);
  assert.equal((await send()).receipt.effect, "unknown");
  for (const change of [
    { sourceName: "other" },
    { text: "changed" },
    { directoryVersion: "0".repeat(64) },
  ])
    assert.equal(
      (await send({ ...operation, ...change })).code,
      "DUPLICATE_CONFLICT",
    );
  held.resolve();
  await admission.drain();
  assert.equal(f.registry.lookup(key).receipt.effect, "unknown");
  assert.equal(f.registry.lookup(key).receipt.result, undefined);
  assert.equal(calls, 1);
});

test("AGENT file admission derives exact private name at normal and rejection begin sites", async (t) => {
  const begins = [],
    executed = [];
  const started = deferred(),
    held = deferred();
  let hold = false;
  const admission = createHostAdmission({
    runtimeEpoch: "epoch",
    revision: () => 0,
    ready: () => Promise.resolve(),
    registry: () => ({
      status: () => ({ state: "ready" }),
      lookup: () => ({ status: "missing" }),
      begin: async (input) => {
        begins.push(input);
        const {
          digest: _digest,
          agentSourceName: _name,
          rejectionCode,
          expectedRevision: _revision,
          ...identity
        } = input;
        return {
          status: rejectionCode ? "rejected" : "admitted",
          receipt: {
            ...identity,
            admission: rejectionCode ? "rejected" : "admitted",
            delivery: "pending",
            effect: "none",
            revision: 0,
            evidence: [],
            ...(rejectionCode && {
              result: { kind: "rejected", code: rejectionCode },
            }),
          },
        };
      },
    }),
    execute: async () => {
      assert.equal(Object.hasOwn(currentScope().record, "sessionId"), true);
      assert.equal(currentScope().record.sessionId, undefined);
      executed.push(currentScope().record.agentSourceName);
      if (hold) {
        started.resolve();
        await held.promise;
      }
      return { ok: true, value: { status: "saved" } };
    },
    projectReceipt: async (record) => {
      Object.assign(record, {
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        result: {
          kind: "agent_file_saved",
          workspaceId: "ws",
          sourceName: record.agentSourceName,
          version: "a".repeat(64),
        },
      });
    },
  });
  t.after(() => admission.close());
  const send = (id, operation = agentFileOperation(), expectedRevision) =>
    admission.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: id,
        operation: { ...operation, requestId: id },
        ...(expectedRevision !== undefined && { expectedRevision }),
      },
      "sender",
    );
  const saved = await send("normal");
  assert.equal(saved.receipt.result.sourceName, "review");
  assert.equal(saved.receipt.agentSourceName, undefined);
  assert.equal(
    (await send("stale", agentFileOperation({ sourceName: "stale_name" }), 1))
      .code,
    "STALE_REVISION",
  );
  hold = true;
  const waiting = send("held");
  await started.promise;
  assert.equal(
    (await send("busy", agentFileOperation({ sourceName: "busy_name" }))).code,
    "BUSY",
  );
  held.resolve();
  await waiting;
  assert.deepEqual(executed, ["review", "review"]);
  assert.deepEqual(
    begins.map((input) => [
      input.operationId,
      input.agentSourceName,
      input.rejectionCode,
    ]),
    [
      ["normal", "review", undefined],
      ["stale", "stale_name", "STALE_REVISION"],
      ["held", "review", undefined],
      ["busy", "busy_name", "BUSY"],
    ],
  );
  assert.equal(
    (await send("session", agentFileOperation({ sessionId: "forbidden" })))
      .code,
    "INVALID_REQUEST",
  );
  assert.equal(begins.length, 4);
});

test("AGENT file list/read share bounded files lane with existing file reads", async (t) => {
  for (const type of ["configuration.agent.list", "configuration.agent.read"]) {
    const started = deferred(),
      held = deferred();
    const admission = createHostAdmission({
      runtimeEpoch: "epoch",
      ready: () => Promise.resolve(),
      revision: () => 0,
      projectReceipt: () => {},
      execute: async (op) => {
        if (op.type === type) {
          assert.equal(currentScope().kind, "files");
          started.resolve();
          await held.promise;
        }
        return { ok: true, value: {} };
      },
    });
    t.after(() => admission.close());
    const read = (id, operation) =>
      admission.handle(
        { version: 2, runtimeEpoch: "epoch", readId: id, operation },
        "sender",
      );
    const waiting = read("agent", {
      type,
      workspaceId: "ws",
      ...(type.endsWith("read") && { sourceName: "review" }),
    });
    await started.promise;
    assert.equal(
      (
        await read("legacy", {
          type: "configuration.read",
          workspaceId: "ws",
          kind: "instructions",
        })
      ).code,
      "READ_BUSY",
    );
    assert.equal((await read("snapshot", { type: "snapshot" })).ok, true);
    held.resolve();
    assert.equal((await waiting).ok, true);
  }
});

test("runtime options actual durable admission binds variant and keeps unknown original key without replay", async (t) => {
  const { createHash } = await import("node:crypto");
  const f = await agentAdmissionFixture(t);
  const sessionId = f.registry.readView().sessions[0].appSessionId;
  const key = { runtimeEpoch: "epoch", operationId: "variant-unknown" };
  const floor = f.registry.status().revision;
  const operation = {
    type: "message.send",
    workspaceId: f.workspaceId,
    sessionId,
    requestId: key.operationId,
    text: "synthetic request",
    model: "model-hash",
    variant: "opaque/custom#tier",
  };
  const expected = { ...operation, expectedRevision: floor };
  const expectedDigest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(expected)
          .sort()
          .map((key) => [key, expected[key]]),
      ),
    )
    .digest("hex");
  let calls = 0;
  let admission;
  admission = createHostAdmission({
    runtimeEpoch: "epoch",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    deadlineMs: 2000,
    execute: async (request) => {
      assert.deepEqual(request, operation);
      assert.equal(currentScope().record.digest, expectedDigest);
      currentScope().beforeEffect = async () => {
        const result = await f.registry.dispatch({
          ...key,
          step: "native.model",
          nativeSessionId: "native",
        });
        assert.equal(result.status, "dispatched");
      };
      await admission.sdk(
        async () => {
          calls++;
        },
        [],
        true,
      );
      return {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: ERRORS.UNKNOWN_OUTCOME,
      };
    },
    projectReceipt: async (record) => {
      const result = await f.registry.complete({
        ...key,
        receipt: {
          ...redactReceipt(record),
          delivery: "unknown",
          effect: "unknown",
        },
        delta: { workspaces: [], sessions: [], tombstones: [] },
      });
      Object.assign(record, result.receipt);
    },
  });
  t.after(async () => {
    admission.close();
    await admission.drain();
  });
  const envelope = { version: 2, ...key, expectedRevision: floor, operation };
  const first = await admission.handle(envelope, "sender");
  assert.equal(first.ok, false);
  assert.equal(first.receipt.effect, "unknown");
  assert.equal(
    (await admission.handle(envelope, "sender")).value.status,
    "duplicate",
  );
  assert.equal(
    (
      await admission.handle(
        { ...envelope, operation: { ...operation, variant: "different" } },
        "sender",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  const lookup = await admission.handle(
    {
      version: 2,
      runtimeEpoch: "epoch",
      readId: "lookup",
      operation: { type: "operation.lookup", ...key },
    },
    "sender",
  );
  assert.equal(lookup.value.receipt.effect, "unknown");
  assert.equal(JSON.stringify(lookup).includes("opaque/custom#tier"), false);
  assert.equal(calls, 1);
});

test("CTX-CANCEL context and inbox reads share bounded files lane", async (t) => {
  for (const operation of [
    { type: "context.observe", workspaceId: "ws", path: "file.txt" },
    { type: "session.inbox", workspaceId: "ws", sessionId: "session" },
  ]) {
    const started = deferred(),
      held = deferred();
    const admission = createHostAdmission({
      runtimeEpoch: "epoch",
      ready: () => Promise.resolve(),
      revision: () => 0,
      projectReceipt: () => {},
      execute: async (op) => {
        if (op.type === operation.type) {
          assert.equal(currentScope().kind, "files");
          started.resolve();
          await held.promise;
        }
        return { ok: true, value: {} };
      },
    });
    t.after(async () => {
      held.resolve();
      await admission.drain();
      admission.close();
    });
    const read = (readId, op) =>
      admission.handle(
        { version: 2, runtimeEpoch: "epoch", readId, operation: op },
        "sender",
      );
    const pending = read("context", operation);
    await started.promise;
    assert.equal(
      (
        await read("file", {
          type: "file.read",
          workspaceId: "ws",
          path: "file.txt",
        })
      ).code,
      "READ_BUSY",
    );
    assert.equal((await read("snapshot", { type: "snapshot" })).ok, true);
    held.resolve();
    assert.equal((await pending).ok, true);
  }
});
