import { readAgentFile } from "./workbench-agents.mjs";
import { setupNativeAgents } from "../builtins/workbench-skills/agents.mjs";
import { createNativeAgentsClient } from "../native-agents-client.mjs";
import {
  nativeSkillRegistrationId,
  NATIVE_SKILLS_RPC,
} from "../native-skills-protocol.mjs";
import nativeSkillsPlugin from "../builtins/workbench-skills/server.mjs";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createNativeTaskLedger } from "../native-permission-task-ledger.mjs";
import {
  bootstrapMetadataDigest,
  bootstrapStageDigest,
} from "../native-permission-bootstrap-digest.mjs";
import { reconcileBootstrapTasks } from "../native-bootstrap-reconciler.mjs";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { createWorkbenchService } from "../workbench-service.mjs";
import { mcpNativeName } from "./workbench-mcp.mjs";
import { BASELINE_POLICY } from "../workbench-contract.mjs";
import { compileModeRules } from "../permission-mode.mjs";
import { startSidecar } from "../sidecar-supervisor.mjs";
import { validateStorageReceipt } from "./storage-journal.mjs";
import {
  configurationFileVersion,
  configurationBackupId,
} from "./configuration-file-observation.mjs";
import {
  INSTRUCTION_KEY,
  instructionDigest,
} from "./workbench-instructions.mjs";

// In-memory stand-in for the child's Control (the real arm/consume checks are
// covered against the real Control elsewhere). Main sees the REAL ledger, so
// preparation, arm, revoke and every journal verification go through the same
// code as production; only the Native side of the handoff is simulated.
function fakeBootstrapChild(knobs = {}) {
  const child = { knobs, events: [], live: true };
  let armed;
  child.channel = {
    async prepare() {
      child.events.push("prepare");
      if (knobs.held) return { status: "held", reason: "inventory_unverified" };
      return {
        status: "prepared",
        taskScopeId: randomUUID(),
        locationId: randomUUID(),
        projectId: "project",
        modeGeneration: 1,
        inventoryGeneration: 1,
        launchId: "launch-1",
      };
    },
    async arm(row) {
      child.events.push("arm");
      if (knobs.refuseArm || armed) return "refused";
      armed = { row, state: "armed" };
      return "ok";
    },
    async revoke(id) {
      child.events.push("revoke");
      if (!armed || armed.row.handoffId !== id) return "ok";
      if (armed.state === "consumed") return "refused";
      armed.state = "revoked";
      return "ok";
    },
  };
  // What the overlay does on Session.create / Session.fork.
  child.consume = (step, input) => {
    if (
      !armed ||
      armed.state !== "armed" ||
      armed.row.step !== step ||
      armed.row.stageArgumentDigest !== bootstrapStageDigest(step, input)
    )
      throw new Error("native_permission_held");
    armed.state = "consumed";
    armed = undefined;
    child.events.push(`consume:${step}`);
  };
  child.ledger = createNativeTaskLedger({
    runtimeEpoch: knobs.epoch ?? "epoch",
    isLive: () => child.live,
    channel: child.channel,
    onUnconfirmed: () => {
      child.live = false;
    },
  });
  child.tasks = {
    prepare: child.ledger.prepare,
    arm: child.ledger.arm,
    revoke: child.ledger.revoke,
    verify: child.ledger.verify,
  };
  return child;
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function instructionFixture(t, options = {}) {
  const f = await fixture(t, {
    confirmInstructions: async () => true,
    ...options,
  });
  const snap = await f.ready();
  const scope = {
    workspaceId: snap.selectedWorkspaceId,
    sessionId: snap.selectedSessionId,
  };
  const path = join(snap.workspaces[0].path, "AGENTS.md");
  const text = "\uFEFFUse the synthetic project instructions.\n";
  await fs.writeFile(path, text);
  const file = await f.read({
    type: "configuration.read",
    workspaceId: scope.workspaceId,
    kind: "instructions",
  });
  assert.equal(file.ok, true, JSON.stringify(file));
  const observe = (target = scope) =>
    f.read({ type: "configuration.instructions.read", ...target });
  const observed = await observe();
  assert.equal(observed.ok, true, JSON.stringify(observed));
  const apply = {
    type: "configuration.instructions.apply",
    ...scope,
    requestId: "instruction-request",
    text,
    fileVersion: file.value.version,
    expectedRegistrationVersion: observed.value.version,
  };
  return {
    ...f,
    scope,
    path,
    text,
    observe,
    apply,
    nativeId: f.registry
      .readView()
      .sessions.find((s) => s.appSessionId === scope.sessionId).nativeSessionId,
  };
}

test("instruction apply/remove confirms exact Native entry, committed direct origin and scoped redacted receipt", async (t) => {
  const f = await instructionFixture(t);
  const beforeMetadata = globalThis.structuredClone(
    f.records.get(f.nativeId).metadata,
  );
  const bytes = await fs.readFile(f.path);
  const applied = await f.mutate(f.apply, "instructions-apply");
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.receipt.effect, "confirmed");
  assert.deepEqual(applied.receipt.result, {
    kind: "instruction_registered",
    ...f.scope,
    digest: instructionDigest(f.text),
    sourceVersion: f.apply.fileVersion,
  });
  assert.equal((await f.observe()).value.origin, "direct");
  assert.deepEqual(f.records.get(f.nativeId).metadata, beforeMetadata);
  assert.deepEqual(await fs.readFile(f.path), bytes);
  const sequence = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.ok(
    sequence.findIndex((p) => p.feature === "configuration_instructions_v1") <
      sequence.findIndex(
        (p) => p.identity?.operationId === "instructions-apply",
      ),
  );
  assert.ok(
    sequence.some(
      (p) =>
        p.step === "native.instructions.put" &&
        p.nativeSessionId === f.nativeId,
    ),
  );
  const observed = (await f.observe()).value;
  const removed = await f.mutate(
    {
      type: "configuration.instructions.remove",
      ...f.scope,
      requestId: "remove",
      expectedRegistrationVersion: observed.version,
    },
    "instructions-remove",
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(removed.receipt.result.kind, "instruction_removed");
  assert.equal((await f.observe()).value.status, "missing");
  assert.deepEqual(f.registry.readView().sessions[0].instructionRegistration, {
    state: "absent",
    key: INSTRUCTION_KEY,
  });
  assert.deepEqual(await fs.readFile(f.path), bytes);
});

for (const scenario of [
  "deny",
  "file-conflict",
  "baseline-conflict",
  "confirmation-race",
  "unowned",
  "malformed",
  "pending",
  "policy",
])
  test(`instruction ${scenario} fails before Native effect`, async (t) => {
    let f;
    f = await instructionFixture(t, {
      confirmInstructions: async () => {
        if (scenario === "confirmation-race")
          await fs.writeFile(f.path, "External replacement");
        return scenario !== "deny";
      },
    });
    let request = { ...f.apply };
    if (scenario === "file-conflict") request.fileVersion = "a".repeat(64);
    if (scenario === "baseline-conflict")
      request.expectedRegistrationVersion = "b".repeat(64);
    if (scenario === "unowned")
      f.instructionEntries.set(f.nativeId, [
        { key: INSTRUCTION_KEY, value: f.text },
      ]);
    if (scenario === "malformed")
      f.state.hooks["instruction-list"] = () => ({ data: [] });
    if (scenario === "pending")
      f.state.hooks.permissions = () => [
        { id: "permission", sessionID: f.nativeId },
      ];
    if (scenario === "policy") {
      f.records.get(f.nativeId).permissions = [];
      f.state.failPolicy = true;
    }
    const result = await f.mutate(request, `instruction-${scenario}`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.receipt.effect, "none", JSON.stringify(result));
    assert.ok(!f.state.calls.includes("instruction-put"));
    assert.ok(!f.state.calls.includes("instruction-remove"));
    assert.equal(
      f.registry.readView().sessions[0].instructionRegistration,
      undefined,
    );
  });

test("unowned and owned drift block send/command/fork before policy or selection effects; explicit owned repair is allowed", async (t) => {
  const f = await instructionFixture(t);
  f.instructionEntries.set(f.nativeId, [
    { key: INSTRUCTION_KEY, value: "unowned" },
  ]);
  for (const type of ["message.send", "command.run", "session.fork"]) {
    const before = f.state.calls.filter((x) =>
      ["update", "agent", "model", "prompt", "fork"].includes(x),
    ).length;
    const result = await f.mutate(
      {
        type,
        ...f.scope,
        requestId: type,
        ...(type === "message.send" && {
          text: "hi",
          agent: "build",
          model: "p:m",
        }),
        ...(type === "command.run" && { name: "command", arguments: "args" }),
      },
      `blocked-${type}`,
    );
    assert.equal(
      result.code,
      "INSTRUCTIONS_UNVERIFIED",
      JSON.stringify(result),
    );
    assert.equal(result.receipt.effect, "none");
    assert.equal(
      f.state.calls.filter((x) =>
        ["update", "agent", "model", "prompt", "fork"].includes(x),
      ).length,
      before,
    );
  }
  f.instructionEntries.delete(f.nativeId);
  assert.equal((await f.mutate(f.apply, "initial-owned")).ok, true);
  f.instructionEntries.set(f.nativeId, [
    { key: INSTRUCTION_KEY, value: "owned but drifted" },
  ]);
  assert.equal((await f.observe()).value.status, "changed");
  const blocked = await f.mutate(
    { type: "message.send", ...f.scope, requestId: "drift", text: "hi" },
    "drift-send",
  );
  assert.equal(blocked.code, "INSTRUCTIONS_UNVERIFIED");
  const baseline = (await f.observe()).value;
  const repaired = await f.mutate(
    { ...f.apply, expectedRegistrationVersion: baseline.version },
    "repair",
  );
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal((await f.observe()).value.status, "registered");
});

test("instruction fork inherits verified immediate origin; identical child apply records direct; parent change does not relabel child", async (t) => {
  const f = await instructionFixture(t);
  assert.equal((await f.mutate(f.apply, "parent-apply")).ok, true);
  const result = await f.mutate(
    { type: "session.fork", ...f.scope, requestId: "fork" },
    "instruction-fork",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const child = {
    workspaceId: f.scope.workspaceId,
    sessionId: result.receipt.result.sessionId,
  };
  const inherited = (await f.observe(child)).value;
  assert.equal(inherited.origin, "fork");
  assert.equal(inherited.inheritedFromSessionId, f.scope.sessionId);
  const childApply = await f.mutate(
    { ...f.apply, ...child, expectedRegistrationVersion: inherited.version },
    "child-direct",
  );
  assert.equal(childApply.ok, true, JSON.stringify(childApply));
  assert.equal((await f.observe(child)).value.origin, "direct");
  assert.equal(
    (await f.observe(child)).value.inheritedFromSessionId,
    undefined,
  );
  const parent = (await f.observe()).value;
  assert.equal(
    (
      await f.mutate(
        {
          type: "configuration.instructions.remove",
          ...f.scope,
          requestId: "parent-remove",
          expectedRegistrationVersion: parent.version,
        },
        "parent-remove",
      )
    ).ok,
    true,
  );
  assert.equal((await f.observe(child)).value.origin, "direct");
  const empty = await f.mutate(
    { type: "session.create", workspaceId: child.workspaceId },
    "empty",
  );
  assert.equal(empty.ok, true, JSON.stringify(empty));
  assert.equal(
    (
      await f.observe({
        workspaceId: child.workspaceId,
        sessionId: empty.receipt.result.sessionId,
      })
    ).value.status,
    "missing",
  );
});

test("instruction ACK with wrong post-list is unknown and duplicate never replays or projects ownership", async (t) => {
  const f = await instructionFixture(t);
  f.state.hooks["instruction-put"] = ({ sessionID, key }) =>
    f.instructionEntries.set(sessionID, [{ key, value: "wrong" }]);
  const result = await f.mutate(f.apply, "unknown-instruction");
  assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
  assert.equal(result.receipt.result, undefined);
  assert.equal(
    f.registry.readView().sessions[0].instructionRegistration,
    undefined,
  );
  const count = f.state.calls.filter((x) => x === "instruction-put").length;
  const duplicate = await f.mutate(f.apply, "unknown-instruction");
  assert.equal(duplicate.receipt.effect, "unknown");
  assert.equal(
    f.state.calls.filter((x) => x === "instruction-put").length,
    count,
  );
  assert.ok(
    (await f.snapshot()).retainedOperations.some(
      (op) => op.operationId === "unknown-instruction",
    ),
  );
});

test("instruction dispatch flush precedes SDK; correct baseline keeps both policy stages and rechecks drift after selection", async (t) => {
  let armed = false,
    entered = false;
  const pause = deferred();
  t.after(() => pause.resolve());
  const f = await instructionFixture(t, {
    io: {
      syncFile: async (file, context) => {
        if (armed && context === "append:dispatch") {
          entered = true;
          await pause.promise;
        }
        await file.sync();
      },
    },
  });
  armed = true;
  const pending = f.mutate(f.apply, "flush-before-put");
  await until(() => entered);
  assert.equal(f.state.calls.filter((x) => x === "instruction-put").length, 0);
  assert.equal(
    f.registry.readView().sessions[0].instructionRegistration,
    undefined,
  );
  pause.resolve();
  assert.equal((await pending).ok, true);
  armed = false;
  const catalog = await f.read({ type: "catalog.list", ...f.scope });
  assert.equal(catalog.ok, true, JSON.stringify(catalog));
  const model = catalog.value.models.entries[0].id;
  f.state.hooks.model = () =>
    f.instructionEntries.set(f.nativeId, [
      { key: INSTRUCTION_KEY, value: "selection drift" },
    ]);
  const sent = await f.mutate(
    {
      type: "message.send",
      ...f.scope,
      requestId: "selection",
      text: "not sent",
      agent: "build",
      model,
    },
    "instruction-selection",
  );
  assert.equal(sent.receipt.effect, "unknown", JSON.stringify(sent));
  assert.ok(!f.state.calls.includes("prompt"));
  const lines = (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const steps = lines
    .filter((p) => p.operationId === "instruction-selection")
    .map((p) => p.step)
    .filter(Boolean);
  assert.deepEqual(steps, [
    "native.policy.before_selection",
    "native.agent",
    "native.model",
    "native.policy.after_selection",
  ]);
});

test("denied and uncertain same-content child apply preserve committed fork origin", async (t) => {
  let allow = true;
  const f = await instructionFixture(t, {
    confirmInstructions: async () => allow,
  });
  assert.equal((await f.mutate(f.apply, "parent")).ok, true);
  const forked = await f.mutate(
    { type: "session.fork", ...f.scope, requestId: "fork" },
    "fork",
  );
  assert.equal(forked.ok, true, JSON.stringify(forked));
  const scope = {
    workspaceId: f.scope.workspaceId,
    sessionId: forked.receipt.result.sessionId,
  };
  const baseline = (await f.observe(scope)).value;
  const request = {
    ...f.apply,
    ...scope,
    expectedRegistrationVersion: baseline.version,
  };
  allow = false;
  const denied = await f.mutate(request, "denied-child");
  assert.equal(denied.code, "CANCELLED");
  assert.equal((await f.observe(scope)).value.origin, "fork");
  allow = true;
  f.state.hooks["instruction-put"] = () => {
    throw new Error("uncertain native ACK");
  };
  const unknown = await f.mutate(request, "unknown-child");
  assert.equal(unknown.receipt.effect, "unknown");
  assert.equal(unknown.receipt.result, undefined);
  const durable = f.registry
    .readView()
    .sessions.find(
      (s) => s.appSessionId === scope.sessionId,
    ).instructionRegistration;
  assert.equal(durable.origin, "fork");
  assert.equal(durable.inheritedFromSessionId, f.scope.sessionId);
});

test("restart preserves registration but performs no automatic entry mutation; original session read follows explicit workspace trust", async (t) => {
  const f = await instructionFixture(t);
  assert.equal((await f.mutate(f.apply, "registered-before-restart")).ok, true);
  f.service.close();
  await f.service.drain();
  await f.registry.checkpoint();
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "next",
  });
  const service = createWorkbenchService({
    registry,
    runtime: f.runtime,
    runtimeEpoch: "next",
    confirmTrust: async () => true,
  });
  const call = (operation, read = true) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "next",
        [read ? "readId" : "operationId"]: `restart-${++counter}`,
        operation,
      },
      "sender",
    );
  let counter = 0;
  const before = f.state.calls.length;
  try {
    let snapshot;
    await until(async () => {
      snapshot = await call({ type: "snapshot", ...f.scope });
      return snapshot.value?.state === "connected";
    });
    // The managed workspace's trust persists across restart.
    assert.equal(snapshot.value.workspaces[0].trusted, true);
    assert.equal(
      registry.readView().sessions[0].instructionRegistration.origin,
      "direct",
    );
    assert.ok(
      !f.state.calls
        .slice(before)
        .some((name) => name.startsWith("instruction-")),
    );
    const trusted = await call(
      {
        type: "session.create",
        workspaceId: f.scope.workspaceId,
        title: "Explicit trust",
      },
      false,
    );
    assert.equal(trusted.ok, true, JSON.stringify(trusted));
    const observed = await call({
      type: "configuration.instructions.read",
      ...f.scope,
    });
    assert.equal(observed.ok, true, JSON.stringify(observed));
    assert.equal(observed.value.origin, "direct");
    assert.equal(observed.value.digest, instructionDigest(f.text));
    assert.ok(
      !f.state.calls
        .slice(before)
        .some((name) =>
          ["instruction-put", "instruction-remove"].includes(name),
        ),
    );
  } finally {
    service.close();
    await service.drain();
    await registry.close();
  }
});

for (const fault of ["failed", "delayed"])
  test(`instruction completion ${fault} has no speculative success metadata/result`, async (t) => {
    let armed = false,
      entered = false;
    const pause = deferred();
    t.after(() => pause.resolve());
    const f = await instructionFixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === "append:completion") {
            entered = true;
            if (fault === "failed")
              throw new Error("synthetic completion failure");
            await pause.promise;
          }
          await file.sync();
        },
      },
    });
    armed = true;
    const pending = f.mutate(f.apply, `completion-${fault}`);
    await until(() => entered);
    const result = await pending;
    assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
    assert.equal(result.receipt.result, undefined);
    assert.equal(
      f.registry.readView().sessions[0].instructionRegistration,
      undefined,
    );
    assert.equal(
      f.state.calls.filter((x) => x === "instruction-put").length,
      1,
    );
    assert.equal(f.instructionEntries.get(f.nativeId)[0].value, f.text);
    if (fault === "delayed") {
      pause.resolve();
      await f.service.drain();
      const original = f.registry.lookup({
        runtimeEpoch: "epoch",
        operationId: `completion-${fault}`,
      });
      assert.equal(original.receipt.effect, "confirmed");
      assert.equal(original.receipt.result.kind, "instruction_registered");
    }
  });
async function until(fn) {
  for (let n = 0; n < 500; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  assert.fail("bounded condition not reached");
}
async function fixture(
  t,
  {
    io = {},
    bootstrap = true,
    pickDirectory,
    runtimeReady,
    recoveryReason,
    configurationSave,
    confirmConfigurationSave,
    confirmInstructions,
    confirmMcp,
    confirmSkillRuntime,
    confirmSessionRevert,
    createNativeSkills,
    createNativeAgents,
    createNativeExtensions,
    confirmAgentRuntime,
    projectRegistry,
    nativeTasks,
    taskChild,
    idleCheckpoint,
  } = {},
) {
  runtimeReady?.catch(() => {});
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "p7-host-integration-")),
  );
  const directory = join(root, "private");
  const documentsPath = join(root, "Documents");
  await fs.mkdir(directory);
  await fs.mkdir(documentsPath);
  const options = {
    directory,
    documentsPath,
    storeId: "synthetic",
    runtimeEpoch: "epoch",
    io,
    ...(idleCheckpoint === false && { idleCheckpoint }),
    ...(taskChild && {
      taskAuthoritySource: (record, context) =>
        taskChild.verify
          ? taskChild.verify(record, context)
          : taskChild.ledger.verify(record, context),
    }),
  };
  const registry = await openWorkspaceRegistry(options);
  const records = new Map();
  const instructionEntries = new Map();
  const mcpServers = new Map();
  const state = {
    calls: [],
    failPolicy: false,
    active: {},
    inbox: [],
    hooks: {},
  };
  const method =
    (name, fn) =>
    async (...args) => {
      state.calls.push(name);
      if (state.hooks[name]) return state.hooks[name](...args);
      return fn(...args);
    };
  const client = {
    session: {
      create: method("create", (input) => {
        taskChild?.consume("native.create", input);
        const info = {
          ...input,
          ...(taskChild && { projectID: "project" }),
          permissions: BASELINE_POLICY,
        };
        records.set(info.id, info);
        return info;
      }),
      get: method("get", ({ sessionID }) => {
        const info = records.get(sessionID);
        if (!info)
          throw Object.assign(new Error("absent"), {
            _tag: "SessionNotFoundError",
            sessionID,
          });
        return { ...info };
      }),
      fork: method("fork", (input) => {
        taskChild?.consume("native.fork", input);
        const { sessionID } = input;
        const parent = records.get(sessionID);
        const info = {
          ...parent,
          id: `ses_fork_${state.calls.filter((name) => name === "fork").length}`,
          metadata: { ...parent.metadata },
          time: { created: Date.now() },
          fork: {
            sessionID,
            boundary: { type: "through", messageID: "synthetic-message" },
          },
        };
        records.set(info.id, info);
        instructionEntries.set(
          info.id,
          globalThis.structuredClone(instructionEntries.get(sessionID) ?? []),
        );
        return info;
      }),
      update: method("update", ({ sessionID, ...patch }) => {
        if (state.failPolicy) throw new Error("synthetic policy");
        Object.assign(records.get(sessionID), patch);
      }),
      active: method("active", () => state.active),
      inbox: { list: method("inbox", () => state.inbox) },
      instructions: {
        entry: {
          list: method("instruction-list", ({ sessionID }) =>
            globalThis.structuredClone(instructionEntries.get(sessionID) ?? []),
          ),
          put: method("instruction-put", ({ sessionID, key, value }) => {
            const entries = (instructionEntries.get(sessionID) ?? []).filter(
              (entry) => entry.key !== key,
            );
            instructionEntries.set(sessionID, [...entries, { key, value }]);
          }),
          remove: method("instruction-remove", ({ sessionID, key }) => {
            instructionEntries.set(
              sessionID,
              (instructionEntries.get(sessionID) ?? []).filter(
                (entry) => entry.key !== key,
              ),
            );
          }),
        },
      },
      switchAgent: method("agent", () => {}),
      switchModel: method("model", () => {}),
      prompt: method("prompt", ({ sessionID, text }) => ({
        id: "inbox-1",
        sessionID,
        type: "user",
        payload: { text },
      })),
      interrupt: method("interrupt", () => ({ interrupted: true })),
      remove: method("remove", ({ sessionID }) => {
        records.delete(sessionID);
      }),
      list: method("list", () => ({ data: [...records.values()], cursor: {} })),
    },
    message: { list: method("messages", () => ({ data: [] })) },
    permission: {
      list: method("permissions", () => []),
      reply: method("reply", () => {}),
    },
    agent: {
      list: method("agents", () => ({
        data: [{ id: "build", name: "Build", mode: "primary" }],
      })),
    },
    model: {
      list: method("models", () => ({
        data: [{ id: "m", providerID: "p", name: "Model", enabled: true }],
      })),
    },
    provider: {
      list: method("providers", () => ({
        data: [{ id: "p", integrationID: "i" }],
      })),
    },
    integration: {
      list: method("integrations", () => ({
        data: [{ id: "i", connections: [{ type: "credential" }] }],
      })),
    },
    command: { list: method("commands", () => ({ data: [] })) },
    skill: { list: method("skills", () => ({ data: [] })) },
    mcp: {
      list: method("mcp", ({ location }) => ({
        location,
        data: [...mcpServers.values()].map(({ name, status }) => ({
          name,
          status: { status },
        })),
      })),
      add: method("mcp-add", ({ server, config }) => {
        mcpServers.set(server, { name: server, config, status: "disabled" });
      }),
      connect: method("mcp-connect", ({ server }) => {
        mcpServers.get(server).status = "connected";
      }),
      disconnect: method("mcp-disconnect", ({ server }) => {
        mcpServers.get(server).status = "disabled";
      }),
      remove: method("mcp-remove", ({ server }) => {
        mcpServers.delete(server);
      }),
    },
  };
  const nativeSkills = createNativeSkills?.({ client, state, method, t });
  const nativeAgents = createNativeAgents?.({ client, state, method, t });
  const nativeExtensions = createNativeExtensions?.({
    client,
    state,
    method,
    t,
  });
  const context = {
    client,
    configurationSave,
    nativeSkills,
    nativeAgents,
    nativeExtensions,
    nativeTasks: nativeTasks ?? taskChild?.tasks,
  };
  const runtime = {
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => context,
    workspace: root,
  };
  const service = createWorkbenchService({
    registry: projectRegistry ? projectRegistry(registry) : registry,
    runtimeReady: runtimeReady ?? Promise.resolve(runtime),
    runtimeEpoch: "epoch",
    bootstrap,
    pickDirectory,
    recoveryReason,
    confirmTrust: async () => true,
    confirmConfigurationSave,
    confirmInstructions,
    confirmMcp,
    confirmSkillRuntime,
    confirmSessionRevert,
    confirmAgentRuntime,
    deadlineMs: 2000,
  });
  let readId = 0;
  const read = (operation) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: `read-${++readId}`,
        operation,
      },
      "sender",
    );
  const snapshot = async () => {
    const result = await read({ type: "snapshot" });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  const mutate = (operation, operationId = "operation", extra = {}) =>
    service.handle(
      { version: 2, runtimeEpoch: "epoch", operationId, operation, ...extra },
      "sender",
    );
  const lookup = (operationId, epoch = "epoch") =>
    read({ type: "operation.lookup", runtimeEpoch: epoch, operationId });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
    // A reopened registry registered later may still finish a queued write.
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return {
    root,
    directory,
    documentsPath,
    registry,
    options,
    service,
    state,
    records,
    instructionEntries,
    mcpServers,
    runtime,
    context,
    read,
    snapshot,
    mutate,
    lookup,
    ready: async () => {
      let snap;
      await until(async () => {
        snap = await snapshot();
        return (
          snap.state === "connected" || snap.recovery.store.state !== "ready"
        );
      });
      return snap;
    },
  };
}

const extensionFixtureApi = ({ method }) => ({
  observe: method("extensions-observe", (scope) => ({
    ...scope,
    status: "partial",
    plugins: { status: "available", rows: [] },
    tools: { status: "unavailable", reason: "runtime_unavailable" },
    hooks: { status: "not_reported", reason: "inventory_not_supported" },
  })),
});
test("durable extension read preserves journal/session mapping and accepts independent unavailable group", async (t) => {
  const f = await fixture(t, { createNativeExtensions: extensionFixtureApi });
  const snapshot = await f.ready();
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  const records = globalThis.structuredClone([...f.records.values()]);
  f.state.calls.length = 0;
  const result = await f.read({
    type: "configuration.extensions.read",
    workspaceId: snapshot.selectedWorkspaceId,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "partial");
  assert.equal(result.value.revision, snapshot.revision);
  assert.equal(Object.hasOwn(result, "receipt"), false);
  assert.deepEqual(f.state.calls, ["extensions-observe"]);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  assert.deepEqual([...f.records.values()], records);
});
test("durable extension read cannot clear or bypass original unresolved operation hold", async (t) => {
  const f = await fixture(t, { createNativeExtensions: extensionFixtureApi });
  const snapshot = await f.ready();
  f.state.hooks.prompt = () => {
    throw new Error("synthetic lost acknowledgement");
  };
  const mutation = await f.mutate(
    {
      type: "message.send",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      requestId: "held-extension",
      text: "synthetic",
    },
    "held-extension",
  );
  assert.equal(mutation.receipt.effect, "unknown", JSON.stringify(mutation));
  f.state.calls.length = 0;
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  const result = await f.read({
    type: "configuration.extensions.read",
    workspaceId: snapshot.selectedWorkspaceId,
  });
  assert.equal(result.code, "UNAVAILABLE");
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  assert.equal(
    (await f.snapshot()).retainedOperations.some(
      (row) => row.operationId === "held-extension",
    ),
    true,
  );
});
test("production task channel cannot bootstrap a Native session without verified task authority", async (t) => {
  let preparations = 0;
  const f = await fixture(t, {
    nativeTasks: {
      async prepare() {
        preparations++;
        return { status: "held", reason: "inventory_unverified" };
      },
    },
  });
  const snapshot = await f.ready();
  assert.equal(f.state.calls.includes("create"), false);
  assert.equal(snapshot.sessions.length, 0);
  assert.equal(snapshot.recovery.store.state, "recovery_required");
  assert.equal(snapshot.recovery.store.reason, "native_startup_unverified");
  assert.equal(
    preparations,
    0,
    "prompt preparation cannot stand in for a bootstrap task",
  );
  assert.equal(f.registry.readView().retainedOperations.length, 0);
  assert.deepEqual(await fs.readdir(join(f.documentsPath)), []);
});

for (const type of ["session.create", "session.fork"])
  test(`production task channel holds ${type} before reservation and Native effect`, async (t) => {
    const f = await fixture(t);
    const snapshot = await f.ready();
    const before = f.registry.readView();
    const nativeCount = f.records.size;
    let preparations = 0;
    f.context.nativeTasks = {
      async prepare() {
        preparations++;
        return { status: "held", reason: "inventory_unverified" };
      },
    };
    f.state.calls.length = 0;
    const operation = {
      type,
      workspaceId: snapshot.selectedWorkspaceId,
      ...(type === "session.fork" && {
        sessionId: snapshot.selectedSessionId,
        requestId: "held-bootstrap",
      }),
    };
    const response = await f.mutate(operation, "held-bootstrap");
    assert.equal(response.code, "POLICY_UNVERIFIED", JSON.stringify(response));
    assert.equal(f.state.calls.includes("create"), false);
    assert.equal(f.state.calls.includes("fork"), false);
    assert.equal(f.records.size, nativeCount);
    assert.equal(preparations, 0);
    assert.equal(response.receipt.effect, "none");
    assert.deepEqual(f.registry.readView().sessions, before.sessions);
    const lines = (
      await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    const owned = lines.filter(
      ({ payload }) => payload.operationId === "held-bootstrap",
    );
    assert.equal(
      owned.some(
        ({ payload }) =>
          payload.kind === "reservation" || payload.kind === "dispatch",
      ),
      false,
    );
  });

test("managed bootstrap reserves stable UUID before mkdir/create; observations do not append", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  assert.equal(initial.sessions.length, 1, JSON.stringify(initial));
  const w = initial.workspaces[0];
  const s = initial.sessions[0];
  assert.equal(w.path, join(f.documentsPath, "OhMyOwnCode", s.id));
  assert.equal(initial.temporary, false);
  const before = f.registry.status().journal.sequence;
  const newer = await f.snapshot();
  assert.equal(newer.revision, initial.revision);
  assert.ok(newer.observationSequence > initial.observationSequence);
  assert.equal(f.registry.status().journal.sequence, before);
  const lines = (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(
    lines.findIndex((r) => r.payload.kind === "reservation") <
      lines.findIndex((r) => r.payload.step === "filesystem.managed_folder"),
  );
  assert.ok(
    lines.findIndex((r) => r.payload.step === "native.create") <
      lines.findIndex((r) => r.payload.kind === "completion"),
  );
  assert.equal(f.state.calls.filter((x) => x === "create").length, 1);
});

for (const kind of ["admission", "dispatch", "completion"])
  test(`paused ${kind} flush preserves committed snapshot/lookup and actual call order`, async (t) => {
    const pause = deferred();
    t.after(() => pause.resolve());
    let armed = false;
    let entered = false;
    const f = await fixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === `append:${kind}`) {
            entered = true;
            await pause.promise;
          }
          await file.sync();
        },
      },
    });
    const initial = await f.ready();
    const target = {
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
    };
    armed = true;
    const pending = f.mutate({
      type: "session.rename",
      ...target,
      requestId: "r",
      title: "Changed",
    });
    await until(() => entered);
    const snap = await f.snapshot();
    assert.equal(snap.sessions[0].title, initial.sessions[0].title);
    const found = await f.lookup("operation");
    assert.ok(
      found.value.status !== "found" ||
        found.value.receipt.effect !== "confirmed",
    );
    const renames = f.state.calls.filter((x) => x === "update").length;
    assert.equal(renames, kind === "completion" ? 2 : 1);
    pause.resolve();
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await f.snapshot()).sessions[0].title, "Changed");
  });

for (const kind of ["admission", "dispatch", "completion"])
  test(`${kind} failure poisons writer globally and later effects have zero calls`, async (t) => {
    let armed = false;
    const f = await fixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === `append:${kind}`) throw new Error("fault");
          await file.sync();
        },
      },
    });
    const initial = await f.ready();
    const target = {
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
    };
    const prior = f.state.calls.filter((x) => x === "update").length;
    armed = true;
    const result = await f.mutate({
      type: "session.rename",
      ...target,
      requestId: "r",
      title: "Unpublished",
    });
    assert.equal(result.code, "UNAVAILABLE", JSON.stringify(result));
    assert.equal(f.registry.status().reason, "writer_poisoned");
    assert.equal(
      f.state.calls.filter((x) => x === "update").length - prior,
      kind === "completion" ? 1 : 0,
    );
    const calls = f.state.calls.length;
    assert.equal(
      (await f.mutate({ type: "session.interrupt", ...target }, "later")).code,
      "UNAVAILABLE",
    );
    assert.equal(f.state.calls.length, calls);
    const snap = await f.snapshot();
    assert.equal(snap.recovery.store.reason, "writer_poisoned");
    assert.equal(snap.sessions[0].title, initial.sessions[0].title);
    assert.deepEqual(snap.messages, []);
    assert.deepEqual(snap.permissions, []);
  });

test("session.revert and reapply are journaled (native.revert.*), confirmed by a metadata receipt and survive lookup", async (t) => {
  const f = await fixture(t, { confirmSessionRevert: async () => true });
  const initial = await f.ready();
  const target = {
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
  };
  const nativeId = [...f.records.keys()][0];
  const calls = [];
  f.context.client.session.message = {
    get: async ({ messageID }) => ({ id: messageID, type: "user" }),
  };
  f.context.client.message.list = async () => ({
    data: [{ id: "msg_9", type: "user", text: "x" }],
    cursor: {},
  });
  f.context.client.session.revert = {
    stage: async (input) => {
      calls.push(["stage", input]);
      f.records.get(nativeId).revert = { messageID: input.messageID };
    },
    clear: async (input) => {
      calls.push(["clear", input]);
      delete f.records.get(nativeId).revert;
    },
  };
  const staged = await f.mutate(
    { type: "session.revert", ...target, requestId: "rv", messageId: "msg_9" },
    "revert-op",
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.deepEqual(calls, [
    ["stage", { sessionID: nativeId, messageID: "msg_9" }],
  ]);
  const found = await f.lookup("revert-op");
  assert.equal(found.value.status, "found", JSON.stringify(found));
  assert.equal(found.value.receipt.effect, "confirmed");
  assert.equal(found.value.receipt.result.kind, "metadata");
  const cleared = await f.mutate(
    {
      type: "session.revert.clear",
      ...target,
      requestId: "rc",
      messageId: "msg_9",
    },
    "clear-op",
  );
  assert.equal(cleared.ok, true, JSON.stringify(cleared));
  assert.equal(calls[1][0], "clear");
  assert.equal((await f.lookup("clear-op")).value.receipt.effect, "confirmed");
});

test("BUSY rejection rebase survives concurrent atomic completion; digest conflict never dispatches", async (t) => {
  const pause = deferred();
  t.after(() => pause.resolve());
  let entered = false;
  const f = await fixture(t);
  const initial = await f.ready();
  f.state.hooks.update = async ({ sessionID, title }) => {
    entered = true;
    await pause.promise;
    f.records.get(sessionID).title = title;
  };
  const op = {
    type: "session.rename",
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
    requestId: "r",
    title: "Changed",
  };
  const pending = f.mutate(op);
  await until(() => entered);
  const busy = await f.mutate({ ...op, title: "Other" }, "busy");
  assert.equal(busy.code, "BUSY");
  pause.resolve();
  assert.equal((await pending).ok, true);
  assert.equal((await f.lookup("busy")).value.receipt.result.code, "BUSY");
  const calls = f.state.calls.length;
  assert.equal(
    (await f.mutate({ ...op, title: "Conflict" })).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(f.state.calls.length, calls);
});

test("verified create with later policy failure publishes unavailable partial mapping and unknown hold", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  f.state.failPolicy = true;
  const result = await f.mutate({
    type: "session.create",
    workspaceId: initial.selectedWorkspaceId,
    title: "Partial",
  });
  assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
  const snap = await f.snapshot();
  const partial = snap.sessions.find((s) => s.title === "Partial");
  assert.ok(partial, JSON.stringify(snap));
  assert.equal(partial.status, "unavailable");
  assert.ok(
    snap.recovery.resources.some(
      (r) =>
        r.sessionId === partial.id && r.reason === "partial_native_mapping",
    ),
  );
  const calls = f.state.calls.length;
  assert.equal(
    (
      await f.mutate(
        {
          type: "session.pin",
          workspaceId: partial.workspaceId,
          sessionId: partial.id,
          requestId: "r",
          pinned: true,
        },
        "blocked",
      )
    ).code,
    "UNAVAILABLE",
  );
  assert.equal(f.state.calls.length, calls);
});

for (const reason of [
  "owner_conflict",
  "corrupt_journal",
  "unconfirmed_tail",
  "pending_inbox",
  "native_startup_unverified",
])
  test(`${reason} facade remains readable before native ready with zero start/effect calls`, async (t) => {
    let starts = 0;
    const f = await fixture(t, {
      bootstrap: false,
      recoveryReason: reason,
      runtimeReady: Promise.reject(
        Object.assign(new Error("blocked"), { storageReason: reason }),
      ),
    });
    const snap = await f.snapshot();
    assert.equal(snap.recovery.store.reason, reason);
    assert.equal(snap.state, "unavailable");
    assert.equal(
      (await f.mutate({ type: "workspace.create" }, "blocked")).code,
      "UNAVAILABLE",
    );
    await assert.rejects(
      startSidecar({
        namespace: { root: f.root },
        owner: {
          getNonce: () => "n",
          assertOwned: async () => ({ state: "ready" }),
        },
        preflight: async () => false,
        spawnProcess: () => {
          starts++;
        },
      }),
    );
    assert.equal(starts, 0);
    assert.equal(f.state.calls.length, 0);
  });

test("complete valid but unconfirmed tail never automatically adopts mapping or success at restart", async (t) => {
  const f = await fixture(t, { idleCheckpoint: false });
  const initial = await f.ready();
  f.service.close();
  await f.service.drain();
  await f.registry.close();
  const restarted = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  t.after(() => restarted.close());
  const view = restarted.readView();
  assert.equal(view.recovery.store.reason, "unconfirmed_tail");
  assert.equal(view.sessions.length, 0);
  assert.ok(view.retainedOperations.length);
  const key = view.retainedOperations[0];
  assert.notEqual(
    restarted.lookup({
      runtimeEpoch: key.runtimeEpoch,
      operationId: key.operationId,
    }).receipt.effect,
    "confirmed",
  );
  assert.equal(initial.sessions.length, 1);
});

for (const stage of [
  "native.policy.before_selection",
  "native.agent",
  "native.model",
  "native.policy.after_selection",
  "native.send",
])
  test(`every ${stage} dispatch flush precedes actual effect and poison retains earlier ambiguity`, async (t) => {
    let armed = false;
    let payload;
    const f = await fixture(t, {
      io: {
        write: async (file, bytes) => {
          payload = JSON.parse(bytes).payload;
          await file.writeFile(bytes);
        },
        syncFile: async (file, context) => {
          if (armed && context === "append:dispatch" && payload.step === stage)
            throw new Error("step fault");
          await file.sync();
        },
      },
    });
    const initial = await f.ready();
    armed = true;
    const catalog = await f.read({
      type: "catalog.list",
      workspaceId: initial.selectedWorkspaceId,
    });
    const model = catalog.value.models.entries[0].id;
    const before = f.state.calls.length;
    const result = await f.mutate({
      type: "message.send",
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
      requestId: "r",
      text: "synthetic",
      agent: "build",
      model,
    });
    assert.equal(
      f.registry.status().reason,
      "writer_poisoned",
      JSON.stringify(result),
    );
    const calls = f.state.calls.slice(before);
    const expected = ["update", "agent", "model", "update", "prompt"];
    const index = [
      "native.policy.before_selection",
      "native.agent",
      "native.model",
      "native.policy.after_selection",
      "native.send",
    ].indexOf(stage);
    assert.deepEqual(
      calls.filter((name) => expected.includes(name)),
      expected.slice(0, index),
    );
    if (index === 0) {
      assert.equal(result.receipt, undefined);
      assert.equal((await f.lookup("operation")).value.receipt.effect, "none");
    } else assert.equal(result.receipt.effect, "unknown");
    const later = f.state.calls.length;
    assert.equal(
      (
        await f.mutate(
          {
            type: "session.interrupt",
            workspaceId: initial.selectedWorkspaceId,
            sessionId: initial.selectedSessionId,
          },
          "later",
        )
      ).code,
      "UNAVAILABLE",
    );
    assert.equal(f.state.calls.length, later);
  });

test("late native settlement retains mutation slot and durable original receipt identity", async (t) => {
  const pause = deferred();
  t.after(() => pause.resolve());
  let entered = false;
  const f = await fixture(t);
  const initial = await f.ready();
  f.state.hooks.update = async ({ sessionID, title }) => {
    entered = true;
    await pause.promise;
    f.records.get(sessionID).title = title;
  };
  const op = {
    type: "session.rename",
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
    requestId: "r",
    title: "Late",
  };
  const pending = f.mutate(op, "original");
  await until(() => entered);
  assert.equal(
    (await f.mutate({ ...op, title: "Other" }, "other")).code,
    "BUSY",
  );
  // The original already timed out with an unknown effect; the replay says so.
  const replayed = await f.mutate(op, "original");
  assert.equal(replayed.code, "UNKNOWN_OUTCOME");
  assert.equal(replayed.receipt.effect, "unknown");
  pause.resolve();
  assert.equal((await pending).receipt.operationId, "original");
  assert.equal((await f.lookup("original")).value.receipt.effect, "confirmed");
});

for (const mismatch of [false, true])
  test(`explicit checkpoint reopen uses exact original identity+digest without create; mismatch=${mismatch}`, async (t) => {
    const f = await fixture(t);
    const initial = await f.ready();
    await f.registry.checkpoint();
    f.service.close();
    await f.service.drain();
    await f.registry.close();
    const registry = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    const nativeId = [...f.records.keys()][0];
    if (mismatch) f.records.get(nativeId).metadata.digest = "f".repeat(64);
    const service = createWorkbenchService({
      registry,
      runtime: f.runtime,
      runtimeEpoch: "new",
      bootstrap: true,
    });
    t.after(async () => {
      service.close();
      await service.drain();
      await registry.close();
    });
    let id = 0;
    let snap;
    await until(async () => {
      const result = await service.handle(
        { version: 2, readId: `r-${++id}`, operation: { type: "snapshot" } },
        "new-sender",
      );
      assert.equal(result.ok, true);
      snap = result.value;
      return (
        snap.state === "connected" || snap.recovery.store.state !== "ready"
      );
    });
    assert.equal(f.state.calls.filter((name) => name === "create").length, 1);
    assert.equal(snap.sessions[0].id, initial.sessions[0].id);
    assert.equal(snap.workspaces[0].path, initial.workspaces[0].path);
    if (mismatch) {
      assert.equal(snap.recovery.store.reason, "identity_conflict");
      assert.deepEqual(snap.messages, []);
    } else assert.equal(snap.recovery.store.state, "ready");
  });

async function savedForks(t, count = 2) {
  const f = await fixture(t);
  const initial = await f.ready();
  const receipts = [];
  let parentId = initial.selectedSessionId;
  for (let n = 0; n < count; n++) {
    const result = await f.mutate(
      {
        type: "session.fork",
        workspaceId: initial.selectedWorkspaceId,
        sessionId: parentId,
        requestId: `fork-${n}`,
      },
      `fork-${n}`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.effect, "confirmed");
    receipts.push(result.receipt);
    parentId = result.receipt.result.sessionId;
  }
  await f.registry.checkpoint();
  f.service.close();
  await f.service.drain();
  await f.registry.close();
  return { ...f, initial, forkReceipts: receipts };
}

async function reopenForks(t, f, adapt = (registry) => registry, options = {}) {
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const callsBefore = f.state.calls.length;
  const service = createWorkbenchService({
    registry: adapt(registry),
    runtime: f.runtime,
    runtimeEpoch: "new",
    bootstrap: true,
    ...options,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
  });
  let id = 0;
  let snapshot;
  await until(async () => {
    const result = await service.handle(
      { version: 2, readId: `r-${++id}`, operation: { type: "snapshot" } },
      "new-sender",
    );
    assert.equal(result.ok, true);
    snapshot = result.value;
    return (
      snapshot.state === "connected" ||
      snapshot.recovery.store.state !== "ready"
    );
  });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  const calls = f.state.calls.slice(callsBefore);
  assert.ok(
    calls.every((name) =>
      ["get", "active", "inbox", "messages", "permissions", "list"].includes(
        name,
      ),
    ),
    JSON.stringify(calls),
  );
  return { registry, service, snapshot, calls };
}

for (const count of [1, 2])
  test(`confirmed inherited-metadata fork checkpoint reopen validates ${count} lineage links without replay`, async (t) => {
    const f = await savedForks(t, count);
    const metadata = [...f.records.values()][0].metadata;
    for (const info of f.records.values())
      assert.deepEqual(info.metadata, metadata);
    const { registry, service, snapshot } = await reopenForks(t, f, (r) => ({
      ...r,
      // Child-first iteration must validate the ancestor chain independently
      // of registry insertion order.
      readView: () => {
        const view = r.readView();
        view.sessions.reverse();
        return view;
      },
    }));
    assert.equal(snapshot.recovery.store.state, "ready");
    assert.equal(snapshot.state, "connected");
    assert.equal(snapshot.sessions.length, count + 1);
    assert.equal(snapshot.revision, registry.status().revision);
    assert.deepEqual(snapshot.retainedOperations, []);
    for (const receipt of f.forkReceipts) {
      const child = snapshot.sessions.find(
        (s) => s.id === receipt.result.sessionId,
      );
      assert.equal(child.parentSessionId, receipt.sessionId);
      const result = await service.handle(
        {
          version: 2,
          runtimeEpoch: "new",
          readId: `lookup-${receipt.operationId}`,
          operation: {
            type: "operation.lookup",
            runtimeEpoch: receipt.runtimeEpoch,
            operationId: receipt.operationId,
          },
        },
        "new-sender",
      );
      assert.equal(result.value.status, "found");
      assert.deepEqual(result.value.receipt, receipt);
    }
    assert.equal(f.state.calls.filter((name) => name === "create").length, 1);
    assert.equal(f.state.calls.filter((name) => name === "fork").length, count);
  });

for (const mismatch of [
  "native child id",
  "native path",
  "native fork parent",
  "missing native fork",
  "parentID cannot replace fork.sessionID",
  "inherited metadata digest",
  "inherited metadata app id",
  "inherited metadata extra field",
  "missing inherited metadata",
  "missing fork identity",
  "fork identity digest",
  "fork identity parent",
  "fork receipt missing",
  "fork receipt unknown",
  "fork receipt type",
  "fork receipt operation key",
  "fork receipt result kind",
  "fork receipt parent",
  "fork receipt child",
  "fork receipt native id",
  "fork receipt workspace",
  "ancestor receipt missing",
  "ancestor metadata digest",
  "missing parent mapping",
  "unavailable parent mapping",
  "parent outside workspace",
  "cyclic parent mapping",
])
  test(`fork checkpoint reopen rejects ${mismatch} without effects or receipt promotion`, async (t) => {
    const f = await savedForks(t);
    const receipt = f.forkReceipts.at(-1);
    const childId = receipt.result.sessionId;
    const native = f.records.get(receipt.result.nativeSessionId);
    const parentNative = f.records.get(
      f.forkReceipts[0].result.nativeSessionId,
    );
    switch (mismatch) {
      case "native child id":
        native.id = "wrong-native";
        break;
      case "native path":
        native.location = { directory: f.root };
        break;
      case "native fork parent":
        native.fork.sessionID = "wrong-parent";
        break;
      case "missing native fork":
        delete native.fork;
        break;
      case "parentID cannot replace fork.sessionID":
        native.parentID = parentNative.id;
        native.fork.sessionID = "wrong-parent";
        break;
      case "inherited metadata digest":
        native.metadata.digest = "f".repeat(64);
        break;
      case "inherited metadata app id":
        native.metadata.appSessionId = childId;
        break;
      case "inherited metadata extra field":
        native.metadata.extra = true;
        break;
      case "missing inherited metadata":
        delete native.metadata;
        break;
      case "ancestor metadata digest":
        parentNative.metadata.digest = "f".repeat(64);
        break;
      case "cyclic parent mapping":
        parentNative.fork.sessionID = native.id;
        break;
    }
    let hydrate = true;
    // Inject adversarial host reads without changing journal/registry tables.
    // Only hydration receives malformed mappings; recovery DTOs use real data.
    const { service, snapshot, calls } = await reopenForks(t, f, (r) => ({
      ...r,
      readView: () => {
        const view = r.readView();
        if (!hydrate) return view;
        hydrate = false;
        const child = view.sessions.find((s) => s.appSessionId === childId);
        const parent = view.sessions.find(
          (s) => s.appSessionId === child.parentSessionId,
        );
        if (mismatch === "missing parent mapping")
          view.sessions = view.sessions.filter((s) => s !== parent);
        if (mismatch === "parent outside workspace")
          parent.workspaceId = "other";
        if (mismatch === "unavailable parent mapping")
          parent.status = "unavailable";
        if (mismatch === "cyclic parent mapping")
          parent.parentSessionId = childId;
        view.sessions.reverse();
        return view;
      },
      lookupForkIdentity: (key) => {
        const identity = r.lookupForkIdentity(key);
        if (
          mismatch === "cyclic parent mapping" &&
          key.appSessionId === receipt.sessionId
        )
          identity.sessionId = childId;
        if (key.appSessionId !== childId) return identity;
        if (mismatch === "missing fork identity") return undefined;
        if (mismatch === "fork identity digest")
          identity.digest = "f".repeat(64);
        if (mismatch === "fork identity parent")
          identity.sessionId = f.initial.selectedSessionId;
        return identity;
      },
      lookupIdentity: (key) => {
        const identity = r.lookupIdentity(key);
        if (
          mismatch === "cyclic parent mapping" &&
          key.operationId === f.forkReceipts[0].operationId
        )
          identity.sessionId = childId;
        return identity;
      },
      lookup: (key) => {
        const result = r.lookup(key);
        if (
          mismatch === "cyclic parent mapping" &&
          key.operationId === f.forkReceipts[0].operationId
        )
          result.receipt.sessionId = childId;
        if (
          mismatch === "ancestor receipt missing" &&
          result.receipt?.result?.sessionId === f.initial.selectedSessionId
        )
          return { ...key, status: "missing", effect: "unknown" };
        if (key.operationId !== receipt.operationId) return result;
        if (mismatch === "fork receipt missing")
          return { ...key, status: "missing", effect: "unknown" };
        const value = result.receipt;
        if (mismatch === "fork receipt unknown") value.effect = "unknown";
        if (mismatch === "fork receipt type") value.type = "session.create";
        if (mismatch === "fork receipt operation key")
          value.operationId = "wrong-operation";
        if (mismatch === "fork receipt result kind")
          value.result.kind = "created";
        if (mismatch === "fork receipt parent")
          value.sessionId = f.initial.selectedSessionId;
        if (mismatch === "fork receipt child")
          value.result.sessionId = "wrong-child";
        if (mismatch === "fork receipt native id")
          value.result.nativeSessionId = "wrong-native";
        if (mismatch === "fork receipt workspace")
          value.result.workspaceId = "other";
        return result;
      },
    }));
    assert.equal(snapshot.recovery.store.reason, "identity_conflict");
    assert.equal(snapshot.state, "unavailable");
    assert.deepEqual(snapshot.messages, []);
    assert.deepEqual(snapshot.permissions, []);
    const callsBefore = f.state.calls.length;
    const blocked = await service.handle(
      {
        version: 2,
        runtimeEpoch: "new",
        operationId: "blocked",
        operation: { type: "workspace.create", name: "Blocked" },
      },
      "new-sender",
    );
    assert.equal(blocked.code, "UNAVAILABLE");
    assert.equal(f.state.calls.length, callsBefore);
    assert.ok(calls.every((name) => name === "get"));
    if (mismatch === "cyclic parent mapping") assert.equal(calls.length, 2);
    // The local recovery block must also prevent a new admission append.
    assert.equal(
      (
        await service.handle(
          {
            version: 2,
            runtimeEpoch: "new",
            readId: "missing-blocked",
            operation: {
              type: "operation.lookup",
              runtimeEpoch: "new",
              operationId: "blocked",
            },
          },
          "new-sender",
        )
      ).value.status,
      "missing",
    );
  });

test("confirmed fork lookup never authorizes blocked startup", async (t) => {
  const f = await savedForks(t);
  const { snapshot, calls } = await reopenForks(t, f, undefined, {
    recoveryReason: "owner_conflict",
  });
  assert.equal(snapshot.recovery.store.reason, "owner_conflict");
  assert.deepEqual(calls, []);
});

test("retained key bootstrap resolves original epoch through current-envelope lookup without native", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  // This test needs actual unknown admission, not a correlated positive User ACK.
  f.state.hooks.prompt = () => {
    throw new Error("synthetic lost Native ACK");
  };
  await f.mutate(
    {
      type: "message.send",
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
      requestId: "r",
      text: "synthetic",
    },
    "retained",
  );
  await f.registry.checkpoint();
  f.service.close();
  await f.service.drain();
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  const before = f.state.calls.length;
  const service = createWorkbenchService({
    registry,
    runtimeEpoch: "new",
    runtimeReady: new Promise(() => {}),
    bootstrap: false,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
  });
  const snap = (
    await service.handle(
      { version: 2, readId: "boot", operation: { type: "snapshot" } },
      "sender",
    )
  ).value;
  assert.ok(
    snap.retainedOperations.some(
      (k) =>
        k.runtimeEpoch === "epoch" &&
        k.operationId === "retained" &&
        k.type === "message.send",
    ),
  );
  const found = await service.handle(
    {
      version: 2,
      runtimeEpoch: "new",
      readId: "lookup",
      operation: {
        type: "operation.lookup",
        runtimeEpoch: "epoch",
        operationId: "retained",
      },
    },
    "sender",
  );
  assert.equal(found.value.status, "found");
  assert.equal(found.value.receipt.runtimeEpoch, "epoch");
  assert.equal(f.state.calls.length, before);
});

for (const type of ["session.create", "session.remove"])
  test(`${type} completion flush never exposes uncommitted mapping/tombstone`, async (t) => {
    const pause = deferred();
    t.after(() => pause.resolve());
    let armed = false;
    let entered = false;
    const f = await fixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === "append:completion") {
            entered = true;
            await pause.promise;
          }
          await file.sync();
        },
      },
    });
    const initial = await f.ready();
    armed = true;
    const request =
      type === "session.create"
        ? { type, workspaceId: initial.selectedWorkspaceId, title: "New" }
        : {
            type,
            workspaceId: initial.selectedWorkspaceId,
            sessionId: initial.selectedSessionId,
            requestId: "r",
          };
    // The deletion prompt remains local; its affirmative result is explicit.
    if (type === "session.remove") {
      // This service instance was made without a removal grant. Create a scoped
      // service over the same live owner to inject that dialog decision below.
      f.service.close();
      await f.service.drain();
      armed = false;
      await f.registry.checkpoint();
      const service = createWorkbenchService({
        registry: f.registry,
        runtime: f.runtime,
        runtimeEpoch: "epoch",
        confirmSessionRemoval: async () => true,
      });
      t.after(() => {
        service.close();
        return service.drain();
      });
      let id = 0;
      await until(async () => {
        const result = await service.handle(
          {
            version: 2,
            readId: `boot-${++id}`,
            operation: { type: "snapshot" },
          },
          "remove-sender",
        );
        return result.value?.state === "connected";
      });
      armed = true;
      const pending = service.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          operationId: "remove",
          operation: request,
        },
        "remove-sender",
      );
      await until(() => entered);
      const snapshot = await service.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          readId: "during",
          operation: { type: "snapshot" },
        },
        "remove-sender",
      );
      assert.equal(snapshot.value.sessions.length, 1);
      assert.notEqual(
        f.registry.lookup({ runtimeEpoch: "epoch", operationId: "remove" })
          .receipt.effect,
        "confirmed",
      );
      pause.resolve();
      assert.equal((await pending).ok, true);
      const after = await service.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          readId: "after",
          operation: { type: "snapshot" },
        },
        "remove-sender",
      );
      assert.equal(after.value.sessions.length, 0);
    } else {
      const pending = f.mutate(request);
      await until(() => entered);
      assert.equal((await f.snapshot()).sessions.length, 1);
      assert.notEqual(
        (await f.lookup("operation")).value.receipt.effect,
        "confirmed",
      );
      pause.resolve();
      assert.equal((await pending).ok, true);
      assert.equal((await f.snapshot()).sessions.length, 2);
    }
  });

test("unavailable shared workspace blocks descendants but permits unrelated registered resource", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  const created = await f.mutate(
    { type: "workspace.create", name: "Other" },
    "other-workspace",
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  const other = created.value.workspaces.find(
    (w) => w.id !== initial.selectedWorkspaceId,
  );
  const session = await f.mutate(
    { type: "session.create", workspaceId: other.id, title: "Other session" },
    "other-session",
  );
  assert.equal(session.ok, true, JSON.stringify(session));
  f.state.failPolicy = true;
  await f.mutate(
    {
      type: "session.create",
      workspaceId: initial.selectedWorkspaceId,
      title: "Partial",
    },
    "partial",
  );
  f.state.failPolicy = false;
  const before = f.state.calls.length;
  assert.equal(
    (
      await f.mutate(
        {
          type: "session.pin",
          workspaceId: initial.selectedWorkspaceId,
          sessionId: initial.selectedSessionId,
          requestId: "r",
          pinned: true,
        },
        "blocked",
      )
    ).code,
    "UNAVAILABLE",
  );
  assert.equal(f.state.calls.length, before);
  const allowed = await f.mutate(
    {
      type: "session.pin",
      workspaceId: other.id,
      sessionId: session.value.selectedSessionId,
      requestId: "r",
      pinned: true,
    },
    "allowed",
  );
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
});

test("read invalidation uses touched workspace generation; independent workspace completion preserves slow read", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  const made = await f.mutate(
    { type: "workspace.create", name: "Other" },
    "workspace",
  );
  const wid = made.value.selectedWorkspaceId;
  const created = await f.mutate(
    { type: "session.create", workspaceId: wid, title: "Other" },
    "session",
  );
  const sid = created.value.selectedSessionId;
  const pause = deferred();
  t.after(() => pause.resolve());
  let entered = false;
  f.state.hooks.messages = async () => {
    entered = true;
    await pause.promise;
    return {
      data: [
        {
          id: "native-msg",
          type: "assistant",
          content: [{ type: "text", text: "fresh" }],
        },
      ],
    };
  };
  const pending = f.read({
    type: "snapshot",
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
  });
  await until(() => entered);
  const renamed = await f.mutate(
    {
      type: "session.rename",
      workspaceId: wid,
      sessionId: sid,
      requestId: "r",
      title: "Other renamed",
    },
    "rename",
  );
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  pause.resolve();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.messages[0].text, "fresh");
});

test("staged managed workspace uses reserved folderSessionId for its first actual session", async (t) => {
  const f = await fixture(t);
  await f.ready();
  const made = await f.mutate(
    { type: "workspace.create", name: "Staged" },
    "staged-workspace",
  );
  assert.equal(made.ok, true, JSON.stringify(made));
  const wid = made.value.selectedWorkspaceId;
  const folderId = f.registry
    .readView()
    .workspaces.find((w) => w.workspaceId === wid).folderSessionId;
  const first = await f.mutate(
    { type: "session.create", workspaceId: wid, title: "First" },
    "staged-first",
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.selectedSessionId, folderId);
  const second = await f.mutate(
    { type: "session.create", workspaceId: wid, title: "Second" },
    "staged-second",
  );
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.notEqual(second.value.selectedSessionId, folderId);
  assert.equal(
    second.value.workspaces.find((w) => w.id === wid).path,
    join(f.documentsPath, "OhMyOwnCode", folderId),
  );
});

test("partial completion bytes after native success remain corrupt evidence; checkpoint recovery never promotes success", async (t) => {
  let armed = false;
  const f = await fixture(t, {
    io: {
      write: async (file, bytes) => {
        const payload = JSON.parse(bytes).payload;
        if (armed && payload?.kind === "completion") {
          await file.writeFile(bytes.subarray(0, Math.floor(bytes.length / 2)));
          throw new Error("partial write");
        }
        await file.writeFile(bytes);
      },
    },
  });
  const initial = await f.ready();
  await f.registry.checkpoint();
  armed = true;
  const result = await f.mutate(
    {
      type: "session.rename",
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
      requestId: "r",
      title: "Native only",
    },
    "partial-write",
  );
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(f.registry.status().reason, "writer_poisoned");
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  f.service.close();
  await f.service.drain();
  await f.registry.close();
  const restarted = await openWorkspaceRegistry({
    ...f.options,
    io: {},
    runtimeEpoch: "new",
  });
  t.after(() => restarted.close());
  assert.equal(restarted.status().reason, "corrupt_journal");
  assert.equal(
    restarted.readView().sessions[0].title,
    initial.sessions[0].title,
  );
  assert.notEqual(
    restarted.lookup({ runtimeEpoch: "epoch", operationId: "partial-write" })
      .receipt.effect,
    "confirmed",
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
});

test("native read metadata never mutates committed title, permissions or durable revision", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  const nativeId = [...f.records.keys()][0];
  f.records.get(nativeId).title = "Uncommitted native title";
  f.state.hooks.messages = async () => ({
    data: [
      {
        id: "m",
        type: "assistant",
        content: [{ type: "text", text: "stream" }],
      },
    ],
  });
  const prior = f.registry.status().journal.sequence;
  const newer = await f.snapshot();
  assert.equal(newer.sessions[0].title, initial.sessions[0].title);
  assert.equal(newer.messages[0].text, "stream");
  assert.equal(newer.revision, initial.revision);
  assert.ok(newer.observationSequence > initial.observationSequence);
  assert.equal(f.registry.status().journal.sequence, prior);
});

test("durable exact typed-empty fork rejection is a definite no-effect outcome and leaves the session idle", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  let forks = 0;
  f.runtime.workbenchContext().client.session.fork = async () => {
    forks++;
    throw { _tag: "InvalidRequestError", kind: "empty_session" };
  };
  const operation = {
    type: "session.fork",
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
    requestId: "r",
  };
  const result = await f.mutate(operation, "empty-fork");
  assert.equal(result.code, "EMPTY_SESSION");
  assert.equal(result.receipt.effect, "none");
  assert.equal(result.receipt.admission, "rejected");
  const snap = await f.snapshot();
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].status, "idle");
  assert.ok(
    !snap.retainedOperations.some((k) => k.operationId === "empty-fork"),
  );
  assert.equal(
    (await f.mutate(operation, "empty-fork")).receipt.effect,
    "none",
  );
  assert.equal(forks, 1);
  assert.equal((await f.lookup("empty-fork")).value.receipt.effect, "none");
});

test("configuration denial and post-confirm external conflict have no target effect or kernel call", async (t) => {
  let kernelCalls = 0;
  const adapter = {
    prepare: async () => {
      kernelCalls++;
    },
    publish: async () => {
      kernelCalls++;
    },
    abort: async () => {},
  };
  const f = await fixture(t, {
    configurationSave: adapter,
    confirmConfigurationSave: async () => false,
  });
  const snapshot = await f.ready();
  const workspaceId = snapshot.selectedWorkspaceId;
  const workspace = snapshot.workspaces.find((w) => w.id === workspaceId);
  const path = join(workspace.path, "AGENTS.md");
  await fs.writeFile(path, "SYNTHETIC-ORIGINAL");
  const observed = await f.read({
    type: "configuration.read",
    workspaceId,
    kind: "instructions",
  });
  assert.equal(observed.ok, true);
  const operation = {
    type: "configuration.save",
    workspaceId,
    kind: "instructions",
    requestId: "save",
    text: "SYNTHETIC-NEW",
    expectation: "version",
    version: observed.value.version,
  };
  const denied = await f.mutate(operation, "save-denied");
  assert.equal(denied.code, "CANCELLED");
  assert.equal(denied.receipt.effect, "none");
  assert.equal(await fs.readFile(path, "utf8"), "SYNTHETIC-ORIGINAL");
  assert.equal(kernelCalls, 0);
  await fs.writeFile(path, "SYNTHETIC-EXTERNAL");
  const conflict = await f.mutate(operation, "save-conflict");
  assert.equal(conflict.code, "FILE_CHANGED");
  assert.equal(conflict.receipt.effect, "none");
  assert.equal(await fs.readFile(path, "utf8"), "SYNTHETIC-EXTERNAL");
  assert.equal(kernelCalls, 0);
  assert.deepEqual((await f.snapshot()).retainedOperations, []);
});

test("configuration staged uncertainty retains original key, no publication/replay and only matching resource hold", async (t) => {
  let preparations = 0,
    publications = 0;
  const f = await fixture(t, {
    configurationSave: {
      prepare: async () => {
        preparations++;
        return { status: "unknown", reason: "io_failed" };
      },
      publish: async () => {
        publications++;
      },
      abort: async () => {},
    },
    confirmConfigurationSave: async () => true,
  });
  const snapshot = await f.ready();
  const workspaceId = snapshot.selectedWorkspaceId;
  const operation = {
    type: "configuration.save",
    workspaceId,
    kind: "instructions",
    requestId: "save",
    text: "SYNTHETIC-NEW",
    expectation: "missing",
  };
  const result = await f.mutate(operation, "save-unknown");
  assert.equal(result.ok, true);
  assert.equal(result.value.status, "unknown");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  const duplicate = await f.mutate(operation, "save-unknown");
  assert.equal(duplicate.receipt.effect, "unknown");
  assert.equal(preparations, 1);
  assert.equal(publications, 0);
  const observed = await f.snapshot();
  assert.ok(
    observed.retainedOperations.some(
      (key) =>
        key.operationId === "save-unknown" && key.runtimeEpoch === "epoch",
    ),
  );
  assert.ok(
    observed.recovery.resources.some(
      (r) =>
        r.workspaceId === workspaceId && r.reason === "unresolved_operation",
    ),
  );
  const lookup = await f.lookup("save-unknown");
  assert.equal(lookup.value.status, "found");
  assert.equal(lookup.value.receipt.effect, "unknown");
});

for (const mode of ["failure", "delay"])
  test(`configuration completion ${mode} never projects speculative saved result`, async (t) => {
    const pause = deferred();
    t.after(() => pause.resolve());
    let armed = false,
      entered = false,
      prepared,
      publications = 0;
    const f = await fixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === "append:completion") {
            entered = true;
            if (mode === "failure")
              throw new Error("synthetic completion failure");
            await pause.promise;
          }
          await file.sync();
        },
      },
      configurationSave: {
        prepare: async (input) => {
          prepared = input;
          return { status: "staged", token: "a".repeat(64) };
        },
        publish: async () => {
          publications++;
          const path = join(prepared.workspacePath, "AGENTS.md");
          await fs.writeFile(path, prepared.text, { flag: "wx", mode: 0o600 });
          return {
            status: "saved",
            version: configurationFileVersion(
              {
                workspaceId: prepared.workspaceId,
                workspacePath: prepared.workspacePath,
                kind: prepared.kind,
                path,
              },
              await fs.stat(prepared.workspacePath, { bigint: true }),
              await fs.stat(path, { bigint: true }),
              Buffer.from(prepared.text),
            ),
          };
        },
        abort: async () => {},
      },
      confirmConfigurationSave: async () => true,
    });
    const initial = await f.ready();
    const workspaceId = initial.selectedWorkspaceId;
    const operationId = `completion-${mode}`;
    const operation = {
      type: "configuration.save",
      workspaceId,
      kind: "instructions",
      requestId: "save",
      text: "SYNTHETIC PUBLISHED",
      expectation: "missing",
    };
    armed = true;
    const pending = f.mutate(operation, operationId);
    await until(() => entered);
    const before = await f.lookup(operationId);
    assert.equal(before.value.status, "found");
    assert.equal(before.value.receipt.effect, "unknown");
    assert.equal(before.value.receipt.result, undefined);
    const response = await pending; // Delay passes the actual service deadline.
    assert.equal(response.ok, false);
    assert.equal(response.receipt.effect, "unknown");
    assert.equal(response.receipt.result, undefined);
    assert.equal(response.receipt.operationId, operationId);
    assert.equal(response.receipt.runtimeEpoch, "epoch");
    validateStorageReceipt(response.receipt);
    const held = await f.snapshot();
    assert.ok(
      held.retainedOperations.some(
        (r) => r.operationId === operationId && r.runtimeEpoch === "epoch",
      ),
    );
    assert.ok(
      held.recovery.resources.some(
        (r) =>
          r.workspaceId === workspaceId && r.reason === "unresolved_operation",
      ),
    );
    assert.equal(
      await fs.readFile(join(prepared.workspacePath, "AGENTS.md"), "utf8"),
      operation.text,
    );
    const duplicate = await f.mutate(operation, operationId);
    if (mode === "failure") assert.equal(duplicate.code, "UNAVAILABLE");
    else {
      assert.equal(duplicate.receipt.effect, "unknown");
      assert.equal(duplicate.receipt.result, undefined);
    }
    assert.equal(publications, 1);
    pause.resolve();
    await f.service.drain();
    // A delayed flush can later confirm the original key. Never replay it.
    const settled = f.registry.lookup({ runtimeEpoch: "epoch", operationId });
    assert.equal(settled.status, "found");
    validateStorageReceipt(settled.receipt);
    if (mode === "failure") {
      assert.equal(settled.receipt.effect, "unknown");
      assert.equal(settled.receipt.result, undefined);
    }
    assert.equal(publications, 1);
  });

async function mcpFixture(t, options = {}) {
  const f = await fixture(t, { confirmMcp: async () => true, ...options });
  const snapshot = await f.ready();
  const workspaceId = snapshot.selectedWorkspaceId;
  const path = join(snapshot.workspaces[0].path, "opencode.json");
  const text = JSON.stringify({
    mcp: {
      servers: {
        sample: {
          type: "local",
          command: ["node", "synthetic-server.mjs"],
          disabled: false,
        },
      },
    },
  });
  await fs.writeFile(path, text);
  const file = await f.read({
    type: "configuration.read",
    workspaceId,
    kind: "mcp",
  });
  assert.equal(file.ok, true, JSON.stringify(file));
  const observe = () => f.read({ type: "configuration.mcp.read", workspaceId });
  const observed = await observe();
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.status, "observed");
  const register = {
    type: "configuration.mcp.register",
    workspaceId,
    sourceName: "sample",
    requestId: "register",
    text,
    fileVersion: file.value.version,
    expectedObservationVersion: observed.value.version,
  };
  return {
    ...f,
    workspaceId,
    path,
    text,
    observe,
    register,
    nativeName: mcpNativeName(workspaceId, "sample"),
  };
}

test("MCP inactive registration and explicit connection lifecycle are durable, scoped and status-observed", async (t) => {
  const f = await mcpFixture(t);
  const bytes = await fs.readFile(f.path);
  const registered = await f.mutate(f.register, "mcp-register");
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(registered.value.status, "registered_disabled");
  assert.equal(registered.receipt.result.kind, "mcp_registered");
  assert.equal(registered.receipt.effect, "confirmed");
  assert.equal(f.mcpServers.get(f.nativeName).config.disabled, true);
  assert.ok(!f.state.calls.includes("mcp-connect"));
  assert.equal(
    (await f.observe()).value.servers[0].ownership,
    "current_runtime",
  );
  for (const [action, status] of [
    ["connect", "connected"],
    ["disconnect", "disabled"],
    ["remove", undefined],
  ]) {
    const observed = (await f.observe()).value;
    const result = await f.mutate(
      {
        type: `configuration.mcp.${action}`,
        workspaceId: f.workspaceId,
        sourceName: "sample",
        requestId: action,
        expectedObservationVersion: observed.version,
      },
      `mcp-${action}`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.effect, "confirmed");
    assert.equal(f.mcpServers.get(f.nativeName)?.status, status);
  }
  assert.deepEqual(await fs.readFile(f.path), bytes);
  assert.equal((await f.observe()).value.servers.length, 0);
  const sequence = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.ok(sequence.some((row) => row.feature === "configuration_mcp_v1"));
  for (const step of ["add", "connect", "disconnect", "remove"])
    assert.ok(
      sequence.some(
        (row) =>
          row.step === `native.mcp.${step}` &&
          row.nativeServerName === f.nativeName,
      ),
    );
  assert.equal(
    (await f.mutate(f.register, "mcp-register")).value.status,
    "duplicate",
  );
  assert.equal(f.state.calls.filter((name) => name === "mcp-add").length, 1);
});

for (const scenario of ["denied", "collision", "file-changed"])
  test(`MCP ${scenario} is rejected before any effect`, async (t) => {
    const f = await mcpFixture(t, {
      confirmMcp: async () => scenario !== "denied",
    });
    if (scenario === "collision")
      f.mcpServers.set(f.nativeName, {
        name: f.nativeName,
        status: "disabled",
        config: { foreign: true },
      });
    if (scenario === "file-changed") await fs.writeFile(f.path, f.text + " ");
    const request =
      scenario === "collision"
        ? {
            ...f.register,
            expectedObservationVersion: (await f.observe()).value.version,
          }
        : f.register;
    const result = await f.mutate(request, `mcp-${scenario}`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.receipt.effect, "none");
    assert.ok(!f.state.calls.includes("mcp-add"));
  });

test("MCP observation is workspace-scoped, read-only and rejects a different Native location", async (t) => {
  const f = await mcpFixture(t);
  assert.ok(
    !f.state.calls.some((name) =>
      ["mcp-add", "mcp-connect", "mcp-disconnect", "mcp-remove"].includes(name),
    ),
  );
  const observed = (await f.observe()).value;
  assert.equal(observed.workspaceId, f.workspaceId);
  assert.equal(observed.servers.length, 0);
  f.state.hooks.mcp = () => ({ location: { directory: "/foreign" }, data: [] });
  const wrong = await f.observe();
  assert.equal(wrong.ok, true);
  assert.deepEqual(wrong.value, {
    workspaceId: f.workspaceId,
    status: "unavailable",
    reason: "scope_mismatch",
  });
  const bare = await f.service.handle({
    type: "configuration.mcp.read",
    workspaceId: f.workspaceId,
  });
  assert.equal(bare.code, "INVALID_REQUEST");
});

const mcpRequest = (f, action, observation) => ({
  type: `configuration.mcp.${action}`,
  workspaceId: f.workspaceId,
  sourceName: "sample",
  requestId: action,
  expectedObservationVersion: observation.version,
});

for (const scenario of ["file", "catalog", "permissions", "policy", "inbox"])
  test(`MCP ${scenario} changed during confirmation is rejected before SDK mutation`, async (t) => {
    let f;
    f = await mcpFixture(t, {
      confirmMcp: async () => {
        const nativeId = f.registry.readView().sessions[0].nativeSessionId;
        if (scenario === "file") await fs.writeFile(f.path, f.text + " ");
        if (scenario === "catalog")
          f.mcpServers.set("external", {
            name: "external",
            status: "disabled",
          });
        if (scenario === "permissions")
          f.state.hooks.permissions = () => [
            { id: "pending", sessionID: nativeId },
          ];
        if (scenario === "policy") {
          f.records.get(nativeId).permissions = [];
          f.state.failPolicy = true;
        }
        if (scenario === "inbox")
          f.state.inbox = [{ id: "inbox", sessionID: nativeId }];
        return true;
      },
    });
    const result = await f.mutate(f.register, `mcp-race-${scenario}`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.receipt.effect, "none");
    assert.ok(!f.state.calls.includes("mcp-add"));
    assert.equal(
      (await f.lookup(`mcp-race-${scenario}`)).value.receipt.effect,
      "none",
    );
  });

for (const scenario of [
  "busy",
  "permissions",
  "policy",
  "correlation",
  "inbox",
])
  test(`MCP checks ${scenario} in another session of the same workspace`, async (t) => {
    const f = await mcpFixture(t);
    const created = await f.mutate(
      { type: "session.create", workspaceId: f.workspaceId },
      "mcp-other-session",
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const nativeId = f.registry
      .readView()
      .sessions.find(
        (s) => s.appSessionId === created.value.selectedSessionId,
      ).nativeSessionId;
    if (scenario === "busy")
      f.state.active = { [nativeId]: { status: "busy" } };
    if (scenario === "permissions")
      f.state.hooks.permissions = ({ sessionID }) =>
        sessionID === nativeId ? [{ id: "pending", sessionID }] : [];
    if (scenario === "policy") {
      f.records.get(nativeId).permissions = [];
      f.state.failPolicy = true;
    }
    if (scenario === "correlation") f.records.get(nativeId).metadata = {};
    if (scenario === "inbox")
      f.state.inbox = [{ id: "pending", sessionID: nativeId }];
    const result = await f.mutate(f.register, `mcp-other-${scenario}`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.receipt.effect, "none");
    assert.ok(!f.state.calls.includes("mcp-add"));
  });

for (const status of ["failed", "needs_auth"])
  test(`MCP observed ${status} confirms only the connection attempt`, async (t) => {
    const f = await mcpFixture(t);
    assert.equal((await f.mutate(f.register, "mcp-inactive")).ok, true);
    f.state.hooks["mcp-connect"] = ({ server }) => {
      f.mcpServers.get(server).status = status;
    };
    const request = mcpRequest(f, "connect", (await f.observe()).value);
    const result = await f.mutate(request, `mcp-connect-${status}`);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.connectionStatus, status);
    assert.equal(result.receipt.effect, "confirmed");
    assert.equal(result.receipt.result.connectionStatus, status);
    assert.equal((await f.observe()).value.servers[0].status, status);
  });

test("MCP owned already absent remove has no SDK effect and clears live ownership only after completion", async (t) => {
  const f = await mcpFixture(t);
  assert.equal((await f.mutate(f.register, "mcp-inactive")).ok, true);
  f.mcpServers.delete(f.nativeName);
  const observed = (await f.observe()).value;
  assert.equal(observed.servers[0].status, "absent");
  const request = mcpRequest(f, "remove", observed);
  const result = await f.mutate(request, "mcp-absent-remove");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.admission, "admitted");
  assert.equal(result.receipt.effect, "none");
  assert.equal(result.receipt.result.kind, "mcp_removed");
  assert.ok(!f.state.calls.includes("mcp-remove"));
  assert.deepEqual((await f.observe()).value.servers, []);
  assert.equal(
    (await f.mutate(request, "mcp-absent-remove")).value.status,
    "duplicate",
  );
});

for (const scenario of [
  "wrong-status",
  "malformed",
  "other-drift",
  "policy-after-effect",
])
  test(`MCP ACK with ${scenario} stays unknown and keeps an original workspace-wide hold`, async (t) => {
    const f = await mcpFixture(t);
    const extraSession = await f.mutate(
      { type: "session.create", workspaceId: f.workspaceId },
      "mcp-second-session",
    );
    assert.equal(extraSession.ok, true);
    f.state.hooks["mcp-add"] = ({ server, config }) => {
      f.mcpServers.set(server, {
        name: server,
        config,
        status: scenario === "wrong-status" ? "connected" : "disabled",
      });
      if (scenario === "malformed")
        f.state.hooks.mcp = () => ({
          location: { directory: "/foreign" },
          data: [],
        });
      if (scenario === "other-drift")
        f.mcpServers.set("external", { name: "external", status: "disabled" });
      if (scenario === "policy-after-effect")
        [...f.records.values()][0].permissions = [];
    };
    const operationId = `mcp-unknown-${scenario}`;
    const result = await f.mutate(f.register, operationId);
    assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
    assert.equal(result.receipt.result, undefined);
    validateStorageReceipt(result.receipt);
    const lookup = (await f.lookup(operationId)).value;
    assert.equal(lookup.receipt.runtimeEpoch, "epoch");
    assert.equal(lookup.receipt.effect, "unknown");
    const duplicate = await f.mutate(f.register, operationId);
    assert.equal(duplicate.receipt.effect, "unknown");
    assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
    const snap = await f.snapshot();
    assert.ok(
      snap.retainedOperations.some(
        (x) =>
          x.operationId === operationId &&
          x.runtimeEpoch === "epoch" &&
          x.workspaceId === f.workspaceId &&
          x.sessionId === undefined,
      ),
    );
    assert.ok(
      snap.recovery.resources.some(
        (x) =>
          x.workspaceId === f.workspaceId &&
          x.reason === "unresolved_operation",
      ),
    );
    const blocked = await f.mutate(
      {
        type: "session.pin",
        workspaceId: f.workspaceId,
        sessionId: extraSession.value.selectedSessionId,
        requestId: "pin",
        pinned: true,
      },
      "mcp-blocked-other-session",
    );
    assert.equal(blocked.code, "UNAVAILABLE");
    const freshKey = await f.mutate(f.register, operationId + "-new");
    assert.equal(freshKey.code, "UNAVAILABLE");
    assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
    // No live authority is projected even if Native contains the target.
    f.state.hooks.mcp = undefined;
    for (const info of f.records.values()) info.permissions = BASELINE_POLICY;
    const current = await f.observe();
    assert.equal(current.code, "UNAVAILABLE");
    assert.ok(
      f.registry.readView().workspaces.every((row) => row.mcp === undefined),
    );
  });

for (const mode of ["failure", "delay"])
  test(`MCP completion ${mode} never publishes speculative receipt or live ownership`, async (t) => {
    const pause = deferred();
    t.after(() => pause.resolve());
    let armed = false,
      entered = false;
    const f = await mcpFixture(t, {
      io: {
        syncFile: async (file, context) => {
          if (armed && context === "append:completion") {
            entered = true;
            if (mode === "failure")
              throw new Error("synthetic completion failure");
            await pause.promise;
          }
          await file.sync();
        },
      },
    });
    armed = true;
    const operationId = `mcp-completion-${mode}`;
    const pending = f.mutate(f.register, operationId);
    await until(() => entered);
    const before = await f.lookup(operationId);
    assert.equal(before.value.receipt.effect, "unknown");
    assert.equal(before.value.receipt.result, undefined);
    const response = await pending;
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.receipt.effect, "unknown");
    assert.equal(response.receipt.result, undefined);
    validateStorageReceipt(response.receipt);
    assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
    if (mode === "delay") {
      const observed = await f.observe();
      assert.equal(observed.code, "UNAVAILABLE");
      assert.equal(
        (await f.mutate(f.register, operationId)).receipt.effect,
        "unknown",
      );
    }
    pause.resolve();
    if (mode === "failure") await f.service.drain();
    else
      await until(
        () =>
          f.registry.lookup({ runtimeEpoch: "epoch", operationId }).receipt
            ?.effect === "confirmed",
      );
    const settled = f.registry.lookup({ runtimeEpoch: "epoch", operationId });
    assert.equal(settled.status, "found");
    if (mode === "failure") {
      assert.equal(settled.receipt.effect, "unknown");
      assert.equal(settled.receipt.result, undefined);
    } else {
      assert.equal(settled.receipt.effect, "confirmed");
      const observedAfterSettlement = await f.observe();
      assert.equal(
        observedAfterSettlement.ok,
        true,
        JSON.stringify(observedAfterSettlement),
      );
      assert.equal(
        observedAfterSettlement.value.servers[0].ownership,
        "current_runtime",
      );
    }
    assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
  });

test("MCP dispatch must flush before SDK; independent workspace reads remain available", async (t) => {
  const pause = deferred();
  t.after(() => pause.resolve());
  let armed = false,
    entered = false;
  const f = await mcpFixture(t, {
    io: {
      syncFile: async (file, context) => {
        if (armed && context === "append:dispatch") {
          entered = true;
          await pause.promise;
        }
        await file.sync();
      },
    },
  });
  const other = await f.mutate(
    { type: "workspace.create", name: "Other" },
    "mcp-other-workspace",
  );
  assert.equal(other.ok, true);
  const wid = other.value.selectedWorkspaceId;
  const readPath = join(
    other.value.workspaces.find((w) => w.id === wid).path,
    "AGENTS.md",
  );
  await fs.writeFile(readPath, "Independent content");
  armed = true;
  const pending = f.mutate(f.register, "mcp-paused-dispatch");
  await until(() => entered);
  assert.ok(!f.state.calls.includes("mcp-add"));
  const read = await f.read({
    type: "configuration.read",
    workspaceId: wid,
    kind: "instructions",
  });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.value.content, "Independent content");
  const busy = f.mutate(
    { type: "session.create", workspaceId: f.workspaceId },
    "mcp-concurrent-session",
  );
  pause.resolve();
  assert.equal((await busy).code, "BUSY");
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.effect, "confirmed");
  assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
});

test("MCP restart forgets live authority, performs no automatic mutation, and keeps old receipts historical", async (t) => {
  const f = await mcpFixture(t);
  assert.equal((await f.mutate(f.register, "mcp-before-restart")).ok, true);
  f.service.close();
  await f.service.drain();
  await f.registry.checkpoint();
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "mcp-next",
  });
  const service = createWorkbenchService({
    registry,
    runtime: f.runtime,
    runtimeEpoch: "mcp-next",
    confirmTrust: async () => true,
    confirmMcp: async () => true,
  });
  let id = 0;
  const call = (operation, mutation = false) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "mcp-next",
        [mutation ? "operationId" : "readId"]: `mcp-restart-${++id}`,
        operation,
      },
      "sender",
    );
  try {
    const before = f.state.calls.length;
    await until(
      async () =>
        (await call({ type: "snapshot" })).value?.state === "connected",
    );
    assert.ok(!f.state.calls.slice(before).some((x) => x.startsWith("mcp")));
    const old = await call({
      type: "operation.lookup",
      runtimeEpoch: "epoch",
      operationId: "mcp-before-restart",
    });
    assert.equal(old.value.receipt.effect, "confirmed");
    assert.equal(old.value.receipt.result.kind, "mcp_registered");
    const trusted = await call(
      { type: "session.create", workspaceId: f.workspaceId },
      true,
    );
    assert.equal(trusted.ok, true, JSON.stringify(trusted));
    const observed = await call({
      type: "configuration.mcp.read",
      workspaceId: f.workspaceId,
    });
    assert.equal(observed.value.servers[0].ownership, "unowned");
    const connect = await call(mcpRequest(f, "connect", observed.value), true);
    assert.equal(connect.code, "MCP_OWNERSHIP_CONFLICT");
    const register = await call(
      { ...f.register, expectedObservationVersion: observed.value.version },
      true,
    );
    assert.equal(register.code, "MCP_OWNERSHIP_CONFLICT");
    assert.equal(f.state.calls.filter((x) => x === "mcp-add").length, 1);
    assert.ok(!f.state.calls.includes("mcp-connect"));
  } finally {
    service.close();
    await service.drain();
    await registry.close();
  }
});

test("MCP live registration keeps workspace removal inert until explicit registration removal", async (t) => {
  const f = await mcpFixture(t);
  assert.equal((await f.mutate(f.register, "mcp-removal-register")).ok, true);
  const before = f.state.calls.filter((x) => x === "remove").length;
  const rejected = await f.mutate(
    { type: "workspace.remove", workspaceId: f.workspaceId },
    "mcp-remove-workspace",
  );
  assert.equal(rejected.code, "BUSY", JSON.stringify(rejected));
  assert.equal(rejected.receipt.effect, "none");
  assert.equal(f.state.calls.filter((x) => x === "remove").length, before);
  assert.ok(
    f.registry
      .readView()
      .workspaces.some((w) => w.workspaceId === f.workspaceId),
  );
  const observed = (await f.observe()).value;
  assert.equal(
    (
      await f.mutate(
        mcpRequest(f, "remove", observed),
        "mcp-remove-registration",
      )
    ).ok,
    true,
  );
  const removed = await f.mutate(
    { type: "workspace.remove", workspaceId: f.workspaceId },
    "mcp-remove-workspace-after",
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.ok(
    !f.registry
      .readView()
      .workspaces.some((w) => w.workspaceId === f.workspaceId),
  );
});

test("MCP unknown hold leaves independent workspace reads and mutations available", async (t) => {
  const f = await mcpFixture(t);
  const other = await f.mutate(
    { type: "workspace.create", name: "Independent" },
    "mcp-independent-workspace",
  );
  assert.equal(other.ok, true);
  const wid = other.value.selectedWorkspaceId;
  const created = await f.mutate(
    { type: "session.create", workspaceId: wid },
    "mcp-independent-session",
  );
  assert.equal(created.ok, true);
  const path = join(
    other.value.workspaces.find((w) => w.id === wid).path,
    "AGENTS.md",
  );
  await fs.writeFile(path, "Independent after unknown");
  f.state.hooks["mcp-add"] = () => {};
  const unknown = await f.mutate(f.register, "mcp-resource-unknown");
  assert.equal(unknown.receipt.effect, "unknown");
  const read = await f.read({
    type: "configuration.read",
    workspaceId: wid,
    kind: "instructions",
  });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.value.content, "Independent after unknown");
  const allowed = await f.mutate(
    {
      type: "session.pin",
      workspaceId: wid,
      sessionId: created.value.selectedSessionId,
      requestId: "pin",
      pinned: true,
    },
    "mcp-independent-pin",
  );
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(allowed.receipt.effect, "confirmed");
  assert.equal(
    (await f.lookup("mcp-resource-unknown")).value.receipt.effect,
    "unknown",
  );
});

for (const timing of [
  "before-confirmation",
  "during-confirmation",
  "unchanged",
])
  test(`MCP connect refuses cwd symlink replacement ${timing} before SDK dispatch`, async (t) => {
    let f;
    let armed = false;
    let confirmations = 0;
    const replace = async () => {
      await fs.rmdir(f.cwd);
      await fs.symlink(f.outside, f.cwd);
    };
    f = await mcpFixture(t, {
      confirmMcp: async ({ action }) => {
        if (action === "connect") {
          confirmations++;
          if (armed && timing === "during-confirmation") await replace();
        }
        return true;
      },
    });
    const workspacePath = (await f.snapshot()).workspaces[0].path;
    f.cwd = join(workspacePath, "inside");
    f.outside = join(f.directory, "outside");
    await fs.mkdir(f.cwd);
    await fs.mkdir(f.outside);
    const parsed = JSON.parse(f.text);
    parsed.mcp.servers.sample.cwd = "inside";
    const text = JSON.stringify(parsed);
    await fs.writeFile(f.path, text);
    const file = await f.read({
      type: "configuration.read",
      workspaceId: f.workspaceId,
      kind: "mcp",
    });
    const registered = await f.mutate(
      { ...f.register, text, fileVersion: file.value.version },
      `cwd-register-${timing}`,
    );
    assert.equal(registered.ok, true, JSON.stringify(registered));
    assert.equal(f.mcpServers.get(f.nativeName).config.cwd, f.cwd);
    const observed = (await f.observe()).value;
    armed = true;
    if (timing === "before-confirmation") await replace();
    const operationId = `cwd-connect-${timing}`;
    const result = await f.mutate(
      {
        type: "configuration.mcp.connect",
        workspaceId: f.workspaceId,
        sourceName: "sample",
        requestId: operationId,
        expectedObservationVersion: observed.version,
      },
      operationId,
    );
    if (timing === "unchanged") {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.receipt.result.connectionStatus, "connected");
      assert.equal(
        f.state.calls.filter((call) => call === "mcp-connect").length,
        1,
      );
      assert.equal(confirmations, 1);
      return;
    }
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, "MCP_UNSUPPORTED");
    assert.equal(result.receipt.effect, "none");
    assert.deepEqual(result.receipt.result, {
      kind: "rejected",
      code: "MCP_UNSUPPORTED",
    });
    assert.equal(
      f.state.calls.filter((call) => call === "mcp-connect").length,
      0,
    );
    assert.equal(confirmations, timing === "before-confirmation" ? 0 : 1);
    assert.equal(f.mcpServers.get(f.nativeName).status, "disabled");
    const lookup = await f.lookup(operationId);
    assert.equal(lookup.value.receipt.effect, "none");
    const records = (
      await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).payload);
    assert.ok(!records.some((record) => record.step === "native.mcp.connect"));
  });

import { readSkillFile } from "./workbench-skills.mjs";
import { skillBackupId } from "./workbench-skill-storage.mjs";

// This Node fixture controls adapter outcomes. It is not a second publication kernel.
async function skillServiceFixture(
  t,
  { mode = "saved", existing = false, confirm, io = {} } = {},
) {
  const calls = [],
    confirmations = [];
  let prepared, f;
  const adapter = {
    prepare: async (input) => {
      prepared = input;
      calls.push("stage");
      const payloads = (
        await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).payload);
      assert.equal(payloads.at(-1).step, "filesystem.configuration.stage");
      if (mode === "stage-unknown")
        return { status: "unknown", reason: "io_failed" };
      return { status: "staged", token: "a".repeat(64) };
    },
    publish: async ({ token }) => {
      assert.equal(token, "a".repeat(64));
      calls.push("publish");
      const payloads = (
        await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).payload);
      assert.equal(payloads.at(-1).step, "filesystem.configuration.publish");
      assert.equal(
        f.registry.lookup({
          runtimeEpoch: prepared.runtimeEpoch,
          operationId: prepared.operationId,
        }).receipt.result,
        undefined,
      );
      if (mode === "directory-change") {
        await fs.rename(f.sourcePath, f.sourcePath + ".old");
        await fs.mkdir(f.sourcePath);
      }
      // Only place controlled synthetic bytes for the service's real final reread.
      await fs.writeFile(
        f.path,
        mode === "wrong-content"
          ? "# Different synthetic bytes"
          : prepared.text,
      );
      if (mode === "publish-unknown")
        return { status: "unknown", reason: "io_failed" };
      const observed = await readSkillFile(
        { id: prepared.workspaceId, path: prepared.workspacePath },
        prepared.sourceName,
      );
      assert.equal(observed.status, "available");
      return {
        status: "saved",
        version: mode === "wrong-version" ? "f".repeat(64) : observed.version,
        ...(prepared.expectation === "version" && {
          backupId: skillBackupId(prepared.runtimeEpoch, prepared.operationId),
        }),
      };
    },
    abort: async () => {
      calls.push("abort");
    },
  };
  f = await fixture(t, {
    configurationSave: adapter,
    io,
    confirmConfigurationSave: async (input) => {
      confirmations.push(input);
      return confirm ? confirm(input, f) : true;
    },
  });
  const initial = await f.ready();
  const workspaceId = initial.selectedWorkspaceId;
  const workspacePath = initial.workspaces.find(
    (w) => w.id === workspaceId,
  ).path;
  const sourcePath = join(workspacePath, ".opencode", "skills", "review");
  await fs.mkdir(sourcePath, { recursive: true });
  const path = join(sourcePath, "SKILL.md");
  if (existing) await fs.writeFile(path, "# Original synthetic Skill\n");
  Object.assign(f, { workspaceId, workspacePath, sourcePath, path });
  const observed = await f.read({
    type: "configuration.skill.read",
    workspaceId,
    sourceName: "review",
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.status, existing ? "available" : "missing");
  const operation = {
    type: "configuration.skill.save",
    workspaceId,
    sourceName: "review",
    requestId: "skill-request",
    text: "# Updated synthetic Skill\n",
    directoryVersion: observed.value.directoryVersion,
    expectation: existing ? "version" : "missing",
    ...(existing && { version: observed.value.version }),
  };
  return Object.assign(f, {
    operation,
    observed: observed.value,
    calls,
    confirmations,
    prepared: () => prepared,
  });
}

async function skillPayloads(f) {
  return (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload)
    .filter(
      (p) =>
        p.identity?.type === "configuration.skill.save" ||
        p.feature === "configuration_skill_files_v1" ||
        p.operationId?.startsWith("skill-"),
    );
}

test("SKILL service explicit list/read distinguishes absent parent, denied traversal and directory-bound missing leaf without Native calls", async (t) => {
  const f = await fixture(t);
  const initial = await f.ready();
  const workspaceId = initial.selectedWorkspaceId;
  const workspacePath = initial.workspaces.find(
    (w) => w.id === workspaceId,
  ).path;
  const list = () => f.read({ type: "configuration.skill.list", workspaceId });
  const read = (sourceName) =>
    f.read({ type: "configuration.skill.read", workspaceId, sourceName });
  const before = [...f.state.calls];
  const absent = await list();
  assert.equal(absent.ok, true);
  assert.equal(absent.value.status, "missing");
  assert.equal(absent.value.reason, "path_missing");
  const parent = await read("review");
  assert.equal(parent.value.status, "unavailable");
  assert.equal(parent.value.reason, "path_missing");
  assert.equal(parent.value.directoryVersion, undefined);
  const sourcePath = join(workspacePath, ".opencode", "skills", "review");
  await fs.mkdir(sourcePath, { recursive: true });
  const missing = await read("review");
  assert.equal(missing.value.status, "missing");
  assert.equal(missing.value.reason, "missing_file");
  assert.match(missing.value.directoryVersion, /^[a-f0-9]{64}$/);
  const entries = await list();
  assert.equal(entries.value.status, "available");
  assert.equal(entries.value.truncated, false);
  assert.deepEqual(entries.value.entries, [
    { sourceName: "review", path: join(sourcePath, "SKILL.md") },
  ]);
  const text =
    '---\nname: "Unrestricted readable data"\nunsupported: true\n---\n# Exact safe bytes\n';
  await fs.writeFile(join(sourcePath, "SKILL.md"), text);
  const available = await read("review");
  assert.equal(available.value.status, "available");
  assert.equal(available.value.content, text);
  assert.equal(
    available.value.directoryVersion,
    missing.value.directoryVersion,
  );
  await fs.symlink(
    sourcePath,
    join(workspacePath, ".opencode", "skills", "alias"),
  );
  const denied = await read("alias");
  assert.equal(denied.value.status, "unavailable");
  assert.equal(denied.value.reason, "path_denied");
  assert.equal(denied.value.directoryVersion, undefined);
  assert.deepEqual(f.state.calls, before);
});

test("SKILL service confirmation cancellation keeps exact draft and performs zero stage/publication/Native calls", async (t) => {
  const f = await skillServiceFixture(t, { confirm: () => false });
  const before = [...f.state.calls];
  const result = await f.mutate(f.operation, "skill-cancel");
  assert.equal(result.code, "CANCELLED");
  assert.equal(result.receipt.effect, "none");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(noGets(f.state.calls), noGets(before));
  assert.equal(f.confirmations[0].sourceName, "review");
  assert.equal(
    f.confirmations[0].directoryVersion,
    f.operation.directoryVersion,
  );
  assert.equal(f.confirmations[0].targetPath, f.path);
  assert.equal(f.confirmations[0].text, f.operation.text);
  assert.equal((await fs.readdir(f.sourcePath)).length, 0);
  assert.equal(
    (await skillPayloads(f)).some((p) => p.kind === "dispatch"),
    false,
  );
  assert.deepEqual((await f.snapshot()).retainedOperations, []);
});

test("SKILL service replacement of same empty source folder during confirm rejects before stage", async (t) => {
  const f = await skillServiceFixture(t, {
    confirm: async (_input, f) => {
      await fs.rename(f.sourcePath, f.sourcePath + ".old");
      await fs.mkdir(f.sourcePath);
      return true;
    },
  });
  const before = [...f.state.calls];
  const result = await f.mutate(f.operation, "skill-replaced-directory");
  assert.equal(result.code, "FILE_CHANGED");
  assert.equal(result.receipt.effect, "none");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(noGets(f.state.calls), noGets(before));
  assert.deepEqual(await fs.readdir(f.sourcePath), []);
  assert.equal(
    (await skillPayloads(f)).some((p) => p.kind === "dispatch"),
    false,
  );
});

for (const existing of [false, true]) {
  test(`SKILL service stage/publish and real final reread confirm exact result; existing=${existing}`, async (t) => {
    const f = await skillServiceFixture(t, { existing });
    const before = [...f.state.calls];
    const result = await f.mutate(f.operation, "skill-save");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.status, "saved");
    assert.deepEqual(f.calls, ["stage", "publish"]);
    assert.deepEqual(noGets(f.state.calls), noGets(before));
    const read = await f.read({
      type: "configuration.skill.read",
      workspaceId: f.workspaceId,
      sourceName: "review",
    });
    const expected = {
      kind: "skill_file_saved",
      workspaceId: f.workspaceId,
      sourceName: "review",
      version: read.value.version,
      ...(existing && { backupId: skillBackupId("epoch", "skill-save") }),
    };
    assert.deepEqual(result.receipt.result, expected);
    assert.equal(result.receipt.skillSourceName, undefined);
    assert.equal(result.receipt.admission, "dispatched");
    assert.equal(result.receipt.delivery, "accepted");
    assert.equal(result.receipt.effect, "confirmed");
    assert.equal(await fs.readFile(f.path, "utf8"), f.operation.text);
    assert.equal(f.prepared().directoryVersion, f.operation.directoryVersion);
    assert.equal(f.prepared().sourceName, "review");
    assert.equal(f.prepared().kind, "skill");
    const payloads = await skillPayloads(f);
    assert.deepEqual(
      payloads.filter((p) => p.kind === "dispatch").map((p) => p.step),
      ["filesystem.configuration.stage", "filesystem.configuration.publish"],
    );
    assert.equal(payloads[0].feature, "configuration_skill_files_v1");
    assert.equal(payloads[1].skillSourceName, "review");
    assert.deepEqual(payloads.at(-1).delta, {
      workspaces: [],
      sessions: [],
      tombstones: [],
    });
    const serialized = JSON.stringify(payloads);
    for (const privateValue of [
      f.operation.text,
      f.path,
      f.operation.directoryVersion,
    ])
      assert.equal(serialized.includes(privateValue), false);
    const duplicate = await f.mutate(f.operation, "skill-save");
    assert.deepEqual(duplicate.receipt.result, expected);
    assert.deepEqual(f.calls, ["stage", "publish"]);
    assert.deepEqual((await f.snapshot()).retainedOperations, []);
    await f.registry.checkpoint();
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.deepEqual(
      reopened.lookup({ runtimeEpoch: "epoch", operationId: "skill-save" })
        .receipt.result,
      expected,
    );
  });
}

for (const mode of [
  "stage-unknown",
  "publish-unknown",
  "wrong-content",
  "wrong-version",
  "directory-change",
]) {
  test(`SKILL service ${mode} retains original unknown key without success or duplicate replay`, async (t) => {
    const f = await skillServiceFixture(t, { mode });
    const before = [...f.state.calls];
    const result = await f.mutate(f.operation, "skill-unknown");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.status, "unknown");
    assert.equal(result.receipt.effect, "unknown");
    assert.equal(result.receipt.result, undefined);
    assert.equal(result.receipt.runtimeEpoch, "epoch");
    assert.equal(result.receipt.operationId, "skill-unknown");
    assert.deepEqual(
      f.calls,
      mode === "stage-unknown" ? ["stage"] : ["stage", "publish"],
    );
    const calls = [...f.calls];
    const duplicate = await f.mutate(f.operation, "skill-unknown");
    assert.equal(duplicate.receipt.effect, "unknown");
    assert.equal(duplicate.receipt.result, undefined);
    assert.deepEqual(f.calls, calls);
    assert.deepEqual(noGets(f.state.calls), noGets(before));
    const lookup = await f.lookup("skill-unknown");
    assert.equal(lookup.value.receipt.effect, "unknown");
    assert.equal(lookup.value.receipt.result, undefined);
    const held = await f.snapshot();
    assert.deepEqual(
      held.retainedOperations.filter(
        (op) => op.operationId === "skill-unknown",
      ),
      [
        {
          runtimeEpoch: "epoch",
          operationId: "skill-unknown",
          type: "configuration.skill.save",
          workspaceId: f.workspaceId,
          authorityHold: true,
        },
      ],
    );
    assert.ok(
      held.recovery.resources.some(
        (r) =>
          r.workspaceId === f.workspaceId &&
          r.reason === "unresolved_operation",
      ),
    );
    const next = await f.mutate(
      { ...f.operation, sourceName: "other" },
      "skill-new-key",
    );
    assert.equal(next.code, "UNAVAILABLE");
    assert.deepEqual(f.calls, calls);
  });
}

test("SKILL service missing parent cannot be admitted as missing leaf publication", async (t) => {
  const f = await skillServiceFixture(t);
  await fs.rename(f.sourcePath, f.sourcePath + ".old");
  const before = [...f.state.calls];
  const result = await f.mutate(f.operation, "skill-parent-missing");
  assert.equal(result.code, "FILE_DENIED");
  assert.equal(result.receipt.effect, "none");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(noGets(f.state.calls), noGets(before));
  assert.equal(
    (await skillPayloads(f)).some((p) => p.kind === "dispatch"),
    false,
  );
});

test("SKILL service completion flush failure after publication exposes only original unknown receipt", async (t) => {
  let armed = false;
  const f = await skillServiceFixture(t, {
    io: {
      syncFile: async (file, context) => {
        if (armed && context === "append:completion")
          throw new Error("synthetic completion flush failure");
        await file.sync();
      },
    },
  });
  armed = true;
  const before = [...f.state.calls];
  const result = await f.mutate(f.operation, "skill-flush-failed");
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  assert.equal(result.receipt.operationId, "skill-flush-failed");
  assert.equal(result.receipt.runtimeEpoch, "epoch");
  assert.deepEqual(f.calls, ["stage", "publish"]);
  assert.deepEqual(noGets(f.state.calls), noGets(before));
  assert.equal(await fs.readFile(f.path, "utf8"), f.operation.text);
  const lookup = await f.lookup("skill-flush-failed");
  assert.equal(lookup.value.receipt.effect, "unknown");
  assert.equal(lookup.value.receipt.result, undefined);
  assert.equal(
    (await f.mutate(f.operation, "skill-flush-failed")).code,
    "UNAVAILABLE",
  );
  assert.deepEqual(f.calls, ["stage", "publish"]);
});

// Synthetic endpoint adapter runs the actual fixed producer; it is not Native acceptance.
function skillsAdapter({ client, state, method, t }) {
  const instances = new Map(),
    histories = new Map(),
    nonce = "b".repeat(64);
  async function instance(directory) {
    if (instances.has(directory)) return instances.get(directory);
    const transforms = new Set(),
      native = new Map();
    let handlers;
    const ctx = {
      location: { directory },
      options: { nonce },
      skill: {
        list: async () => ({
          location: { directory },
          data: [...native.values()],
        }),
        transform: async (fn) => {
          transforms.add(fn);
          return { dispose: () => transforms.delete(fn) };
        },
        reload: async () => {
          native.clear();
          for (const fn of transforms)
            fn({
              list: () => [...native.values()],
              add: (row) => native.set(row.id, { ...row }),
            });
        },
      },
      rpc: {
        register: async (definition, methods) => {
          if (definition === NATIVE_SKILLS_RPC) handlers = methods;
          return { dispose: () => {} };
        },
      },
    };
    const close = await nativeSkillsPlugin.setup(ctx);
    t.after(close);
    const value = { native, handlers, directory };
    instances.set(directory, value);
    return value;
  }
  const rpc = async (methodName, input) => {
    const value = await instance(
      input.workspacePath ?? input.owner.workspacePath,
    );
    const result = await value.handlers[methodName](
      { ...input, nonce },
      {
        error: (type, message, data) =>
          Object.assign(new Error(message), { type, data }),
      },
    );
    if (result instanceof Error) throw result;
    return result;
  };
  client.skill.list = method("native-skill-list", async ({ location }) => ({
    location,
    data: [...(await instance(location.directory)).native.values()],
  }));
  const previousMessages = client.message.list;
  client.message.list = method("native-skill-history", (input) =>
    input.type === "skill"
      ? {
          data: input.cursor ? [] : [...(histories.get(input.sessionID) ?? [])],
          cursor: input.cursor
            ? {}
            : histories.get(input.sessionID)?.length
              ? { next: "after-last" }
              : {},
        }
      : previousMessages(input),
  );
  client.session.skill = method("skill-apply", async (input) => {
    assert.equal(input.resume, false);
    const record = [...instances.values()]
      .flatMap((v) => [...v.native.values()])
      .find((v) => v.id === input.id);
    assert.ok(record);
    const history = histories.get(input.sessionID) ?? [];
    history.push({
      id: `msg_skill_${history.length + 1}`,
      type: "skill",
      skill: record.id,
      name: record.name,
      text: record.content,
    });
    histories.set(input.sessionID, history);
  });
  state.skillRunRpc = rpc;
  state.skillHistories = histories;
  state.skillInstances = instances;
  return {
    observe: method("skill-observe", (input) => rpc("observe", input)),
    registerDisabled: method("skill-register", (input) =>
      rpc("registerDisabled", input),
    ),
    removeOwned: method("skill-remove", (input) => rpc("removeOwned", input)),
  };
}
async function runtimeSkillFixture(t, options = {}) {
  const f = await fixture(t, {
    createNativeSkills: skillsAdapter,
    confirmSkillRuntime: async () => true,
    ...options,
  });
  const snap = await f.ready();
  const workspaceId = snap.selectedWorkspaceId,
    sessionId = snap.selectedSessionId,
    sourceName = "demo",
    path = join(snap.workspaces[0].path, ".opencode/skills/demo/SKILL.md");
  const text =
    '\uFEFF---\r\nname: "Synthetic Skill"\r\nmetadata:\r\n  opencode/autoinvoke: true\r\n---\r\n# Body\r\n';
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, text);
  const observe = async (withSession = false) => {
    const result = await f.read({
      type: "configuration.skill.runtime.read",
      workspaceId,
      sourceName,
      ...(withSession && { sessionId }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  const first = await observe();
  const register = {
    type: "configuration.skill.register",
    workspaceId,
    requestId: "register",
    sourceName,
    observationId: first.observationId,
    version: first.file.version,
    directoryVersion: first.file.directoryVersion,
    digest: first.file.digest,
  };
  return {
    ...f,
    workspaceId,
    sessionId,
    sourceName,
    path,
    text,
    observe,
    register,
  };
}
test("Native Skills durable explicit inactive registration, one session record, duplicate and removal preserve file/history", async (t) => {
  const f = await runtimeSkillFixture(t);
  const before = await fs.readFile(f.path);
  const registered = await f.mutate(
    { ...f.register, requestId: "runtime-register" },
    "runtime-register",
  );
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(registered.receipt.effect, "confirmed");
  assert.equal(registered.receipt.result.kind, "skill_registered");
  const nativeId = registered.value.nativeId;
  assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 1);
  const duplicate = await f.mutate(
    { ...f.register, requestId: "runtime-register" },
    "runtime-register",
  );
  assert.equal(duplicate.receipt.effect, "confirmed");
  assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 1);
  const observed = await f.observe(true);
  assert.equal(observed.owned[0].autoinvoke, false);
  assert.equal(observed.session.messages.length, 0);
  const applied = await f.mutate(
    {
      type: "configuration.skill.apply",
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      requestId: "runtime-apply",
      nativeId,
      observationId: observed.observationId,
    },
    "runtime-apply",
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.receipt.effect, "confirmed");
  assert.equal(applied.receipt.result.kind, "skill_applied");
  const afterApply = await f.observe(true);
  assert.equal(afterApply.session.messages.length, 1);
  const again = await f.mutate(
    {
      type: "configuration.skill.apply",
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      requestId: "runtime-again",
      nativeId,
      observationId: afterApply.observationId,
    },
    "runtime-again",
  );
  assert.equal(again.code, "SKILL_ALREADY_APPLIED");
  assert.equal(f.state.calls.filter((v) => v === "skill-apply").length, 1);
  const removalObservation = await f.observe();
  const removed = await f.mutate(
    {
      type: "configuration.skill.remove",
      workspaceId: f.workspaceId,
      requestId: "runtime-remove",
      nativeId,
      observationId: removalObservation.observationId,
    },
    "runtime-remove",
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(removed.receipt.effect, "confirmed");
  assert.equal(removed.receipt.result.kind, "skill_removed");
  const final = await f.observe(true);
  assert.equal(final.owned.length, 0);
  assert.equal(final.session.messages.length, 1);
  assert.deepEqual(await fs.readFile(f.path), before);
});
for (const scenario of ["cancel", "file-race", "lost-observation"])
  test(`Native Skills ${scenario} refuses before producer effect`, async (t) => {
    let f;
    f = await runtimeSkillFixture(t, {
      confirmSkillRuntime: async () => {
        if (scenario === "file-race")
          await fs.writeFile(f.path, "External replacement");
        return scenario !== "cancel";
      },
    });
    const result = await f.mutate(
      {
        ...f.register,
        requestId: `runtime-${scenario}`,
        ...(scenario === "lost-observation" && { observationId: "absent" }),
      },
      `runtime-${scenario}`,
    );
    assert.equal(result.ok, false);
    assert.equal(
      result.code,
      scenario === "cancel"
        ? "CANCELLED"
        : scenario === "file-race"
          ? "FILE_CHANGED"
          : "SKILL_CHANGED",
    );
    assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 0);
  });

test("Native Skill lost registration ACK retains original key and never replays actual producer", async (t) => {
  const f = await runtimeSkillFixture(t);
  f.state.hooks["skill-register"] = async (input) => {
    await f.state.skillRunRpc("registerDisabled", input);
    throw new Error("synthetic lost ACK");
  };
  const operation = { ...f.register, requestId: "lost-ack" };
  const result = await f.mutate(operation, "lost-ack");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 1);
  assert.equal([...f.state.skillInstances.values()][0].native.size, 1);
  const duplicate = await f.mutate(operation, "lost-ack");
  assert.equal(duplicate.receipt.effect, "unknown");
  assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 1);
  const lookup = await f.lookup("lost-ack");
  assert.equal(lookup.value.status, "found");
  assert.equal(lookup.value.receipt.effect, "unknown");
  const snapshot = await f.snapshot();
  assert.ok(
    snapshot.retainedOperations.some(
      (v) => v.operationId === "lost-ack" && v.runtimeEpoch === "epoch",
    ),
  );
  assert.ok(
    snapshot.recovery.resources.some(
      (v) =>
        v.workspaceId === f.workspaceId && v.reason === "unresolved_operation",
    ),
  );
});
test("Native Skill post-apply history proof failure is unknown despite one actual endpoint call", async (t) => {
  const f = await runtimeSkillFixture(t);
  const registered = await f.mutate(
    { ...f.register, requestId: "register-history" },
    "register-history",
  );
  assert.equal(registered.receipt.effect, "confirmed");
  const observation = await f.observe(true),
    nativeId = registered.value.nativeId;
  f.state.hooks["native-skill-history"] = (input) => ({
    data:
      f.state.calls.includes("skill-apply") || input.cursor
        ? []
        : [...(f.state.skillHistories.get(input.sessionID) ?? [])],
    cursor: {},
  });
  const operation = {
    type: "configuration.skill.apply",
    workspaceId: f.workspaceId,
    sessionId: f.sessionId,
    requestId: "apply-history",
    nativeId,
    observationId: observation.observationId,
  };
  const result = await f.mutate(operation, "apply-history");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  assert.equal(f.state.calls.filter((v) => v === "skill-apply").length, 1);
  assert.equal([...f.state.skillHistories.values()][0].length, 1);
  const duplicate = await f.mutate(operation, "apply-history");
  assert.equal(duplicate.receipt.effect, "unknown");
  assert.equal(f.state.calls.filter((v) => v === "skill-apply").length, 1);
});
test("Native Skill incomplete selected history rejects apply before SDK dispatch", async (t) => {
  const f = await runtimeSkillFixture(t);
  const registered = await f.mutate(
    { ...f.register, requestId: "register-incomplete" },
    "register-incomplete",
  );
  assert.equal(registered.receipt.effect, "confirmed");
  const observation = await f.observe(true);
  f.state.hooks["native-skill-history"] = () => ({
    data: [],
    cursor: { next: "same" },
  });
  const result = await f.mutate(
    {
      type: "configuration.skill.apply",
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      requestId: "apply-incomplete",
      nativeId: registered.value.nativeId,
      observationId: observation.observationId,
    },
    "apply-incomplete",
  );
  assert.equal(result.code, "SKILL_UNVERIFIED");
  assert.equal(result.receipt.effect, "none");
  assert.equal(f.state.calls.filter((v) => v === "skill-apply").length, 0);
});

test("Native Skill known ID collision rejects before flushed effect and never claims foreign ownership", async (t) => {
  const f = await runtimeSkillFixture(t),
    operationId = "runtime-collision";
  const nativeId = nativeSkillRegistrationId({
    runtimeEpoch: "epoch",
    operationId,
    workspaceId: f.workspaceId,
    sourceName: f.sourceName,
  });
  const instance = [...f.state.skillInstances.values()][0];
  instance.native.set(nativeId, {
    id: nativeId,
    name: "Foreign",
    autoinvoke: false,
    path: f.path,
    content: "Foreign body",
  });
  const observation = await f.observe();
  assert.equal(observation.owned.length, 0);
  assert.equal(observation.unowned[0].nativeId, nativeId);
  const result = await f.mutate(
    {
      ...f.register,
      requestId: operationId,
      observationId: observation.observationId,
    },
    operationId,
  );
  assert.equal(result.code, "SKILL_OWNERSHIP_CONFLICT");
  assert.equal(result.receipt.effect, "none");
  assert.equal(f.state.calls.filter((v) => v === "skill-register").length, 0);
  assert.equal(instance.native.get(nativeId).content, "Foreign body");
});

// Actual fixed producer and Main private adapter; synthetic endpoint semantics only.
function agentsAdapter({ client, state, method, t }) {
  const instances = new Map(),
    nonce = "c".repeat(64);
  async function instance(directory) {
    if (instances.has(directory)) return instances.get(directory);
    const transforms = new Set();
    const base = [
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        system: "Builtin",
        request: { settings: {}, headers: {}, body: {} },
        permissions: globalThis.structuredClone(BASELINE_POLICY),
      },
    ];
    let native = new Map(),
      handlers;
    const recompute = () => {
      native = new Map(base.map((r) => [r.id, globalThis.structuredClone(r)]));
      const editor = {
        list: () => [...native.values()],
        update: (id, fn) => {
          const row = native.get(id) ?? {
            id,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            request: { settings: { old: true }, headers: {}, body: {} },
            model: "inherited",
          };
          fn(row);
          native.set(id, row);
        },
        remove: (id) => native.delete(id),
      };
      for (const fn of transforms) fn(editor);
    };
    const ctx = {
      options: { nonce },
      location: { directory },
      agent: {
        list: async () => ({
          location: { directory },
          data: globalThis.structuredClone([...native.values()]),
        }),
        transform: async (fn) => {
          transforms.add(fn);
          recompute();
          return {
            dispose: () => {
              transforms.delete(fn);
              recompute();
            },
          };
        },
        reload: async () => recompute(),
      },
      rpc: {
        register: async (_rpc, methods) => {
          handlers = methods;
          return { dispose: () => {} };
        },
      },
    };
    recompute();
    const registration = await setupNativeAgents(ctx);
    t.after(() => registration.dispose());
    const value = { list: ctx.agent.list, handlers };
    instances.set(directory, value);
    return value;
  }
  client.agent.list = method("native-agent-list", async ({ location }) =>
    (await instance(location.directory)).list(),
  );
  client.rpc = () =>
    Object.fromEntries(
      ["observe", "register", "remove"].map((name) => [
        name,
        async (input, { location }) => {
          const value = await instance(location.directory);
          const result = await value.handlers[name](input, {
            error: (type, message, data) =>
              Object.assign(new Error(message), { type, data }),
          });
          if (result instanceof Error) throw result;
          return result;
        },
      ]),
    );
  const api = createNativeAgentsClient({
    client,
    nonce,
    assertLive: async () => {},
  });
  state.agentInstances = instances;
  state.agentApi = api;
  return Object.freeze(
    Object.fromEntries(
      ["observe", "register", "remove"].map((name) => [
        name,
        method(`agent-${name}`, api[name]),
      ]),
    ),
  );
}
async function runtimeAgentFixture(t, options = {}) {
  const f = await fixture(t, {
    createNativeAgents: agentsAdapter,
    confirmAgentRuntime: async () => true,
    ...options,
  });
  const snap = await f.ready();
  const workspaceId = snap.selectedWorkspaceId,
    sessionId = snap.selectedSessionId,
    sourceName = "reviewer";
  const path = join(snap.workspaces[0].path, ".opencode/agents/reviewer.md");
  const text =
    '\uFEFF---\r\n{"description":"Synthetic review","mode":"primary","color":"#123abc"}\r\n---\r\n# Review\r\n';
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, text);
  const observe = async () => {
    const value = await f.read({
      type: "configuration.agent.runtime.read",
      workspaceId,
      sourceName,
    });
    assert.equal(value.ok, true, JSON.stringify(value));
    return value.value;
  };
  const first = await observe();
  assert.equal(first.status, "observed");
  return {
    ...f,
    workspaceId,
    sessionId,
    sourceName,
    path,
    text,
    observe,
    register: {
      type: "configuration.agent.register",
      workspaceId,
      requestId: "agent-register",
      sourceName,
      observationId: first.observationId,
      version: first.file.version,
      directoryVersion: first.file.directoryVersion,
      digest: first.file.digest,
    },
  };
}
test("Native Agents public durable register/remove keeps exact baseline/default/file/session and original duplicate", async (t) => {
  const f = await runtimeAgentFixture(t);
  const sessions = globalThis.structuredClone([...f.records.values()]);
  const bytes = await fs.readFile(f.path);
  const registered = await f.mutate(f.register, f.register.requestId);
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(registered.value.status, "registered_primary");
  assert.equal(registered.receipt.effect, "confirmed");
  assert.equal(registered.receipt.result.kind, "agent_registered");
  assert.equal(registered.value.defaultAgentId, "build");
  assert.deepEqual([...f.records.values()], sessions);
  const after = await f.observe();
  assert.equal(after.owned.length, 1);
  assert.deepEqual(after.owned[0].permissions, BASELINE_POLICY);
  assert.equal(after.owned[0].referenceCount, 0);
  assert.equal(after.defaultAgentId, "build");
  const count = f.state.calls.filter((n) => n === "agent-register").length;
  const duplicate = await f.mutate(f.register, f.register.requestId);
  assert.equal(duplicate.value.status, "duplicate");
  assert.deepEqual(duplicate.receipt.result, registered.receipt.result);
  assert.equal(
    f.state.calls.filter((n) => n === "agent-register").length,
    count,
  );
  const blocked = await f.mutate(
    { type: "workspace.remove", workspaceId: f.workspaceId },
    "agent-workspace-remove",
  );
  assert.equal(blocked.code, "BUSY");
  const current = await f.observe();
  const removed = await f.mutate(
    {
      type: "configuration.agent.remove",
      workspaceId: f.workspaceId,
      requestId: "agent-remove",
      nativeId: registered.value.nativeId,
      observationId: current.observationId,
    },
    "agent-remove",
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(removed.value.status, "removed");
  assert.equal(removed.receipt.result.kind, "agent_removed");
  assert.equal((await f.observe()).owned.length, 0);
  assert.deepEqual(await fs.readFile(f.path), bytes);
  assert.deepEqual([...f.records.values()], sessions);
  const journal = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
  assert.ok(journal.includes('"feature":"configuration_agents_v1"'));
  assert.ok(journal.includes('"step":"native.agent.register"'));
  assert.equal(journal.includes("# Review"), false);
});

for (const scenario of [
  "cancel",
  "file-race",
  "lost-observation",
  "new-reference",
])
  test(`Native Agents ${scenario} rejects before private effect`, async (t) => {
    let f;
    f = await runtimeAgentFixture(t, {
      confirmAgentRuntime: async () => {
        if (scenario === "file-race")
          await fs.writeFile(f.path, "Changed externally");
        if (scenario === "new-reference")
          f.records.set("foreign", {
            id: "foreign",
            agent: f.target,
            location: { directory: "/elsewhere" },
            time: { archived: 1 },
          });
        return scenario !== "cancel";
      },
    });
    if (scenario === "new-reference") {
      const registered = await f.mutate(f.register, f.register.requestId);
      assert.equal(registered.ok, true, JSON.stringify(registered));
      f.records.delete("foreign");
      f.target = registered.value.nativeId;
      const observed = await f.observe();
      const result = await f.mutate(
        {
          type: "configuration.agent.remove",
          workspaceId: f.workspaceId,
          requestId: "new-reference-remove",
          nativeId: f.target,
          observationId: observed.observationId,
        },
        "new-reference-remove",
      );
      assert.equal(result.ok, false);
      assert.ok(["AGENT_CHANGED", "AGENT_IN_USE"].includes(result.code));
      assert.equal(result.receipt.effect, "none");
      assert.equal(f.state.calls.includes("agent-remove"), false);
      return;
    }
    const key = `agent-${scenario}`;
    const result = await f.mutate(
      {
        ...f.register,
        requestId: key,
        ...(scenario === "lost-observation" && { observationId: "absent" }),
      },
      key,
    );
    assert.equal(result.ok, false);
    assert.equal(
      result.code,
      scenario === "cancel"
        ? "CANCELLED"
        : scenario === "file-race"
          ? "FILE_CHANGED"
          : "AGENT_CHANGED",
    );
    assert.equal(result.receipt.effect, "none");
    assert.equal(f.state.calls.includes("agent-register"), false);
  });

test("Native Agents incomplete global references never authorize removal or zero reference count", async (t) => {
  const f = await runtimeAgentFixture(t);
  const registered = await f.mutate(f.register, f.register.requestId);
  assert.equal(registered.ok, true, JSON.stringify(registered));
  const observed = await f.observe();
  f.state.hooks.list = () => ({ data: [], cursor: { next: "repeat" } });
  const read = await f.read({
    type: "configuration.agent.runtime.read",
    workspaceId: f.workspaceId,
  });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.value.status, "unavailable");
  assert.equal(read.value.reason, "references_unverified");
  assert.equal(Object.hasOwn(read.value, "owned"), false);
  const result = await f.mutate(
    {
      type: "configuration.agent.remove",
      workspaceId: f.workspaceId,
      requestId: "incomplete-remove",
      nativeId: registered.value.nativeId,
      observationId: observed.observationId,
    },
    "incomplete-remove",
  );
  assert.equal(result.code, "AGENT_CHANGED");
  assert.equal(result.receipt.effect, "none");
  assert.equal(f.state.calls.includes("agent-remove"), false);
});

test("Native Agents lost post-effect ACK retains only original unknown key and never repeats producer", async (t) => {
  const f = await runtimeAgentFixture(t);
  f.state.hooks["agent-register"] = async (input) => {
    const instance = f.state.agentInstances.get(input.owner.workspacePath);
    const result = await instance.handlers.register(
      { ...input, nonce: "c".repeat(64) },
      {
        error: (type, message, data) =>
          Object.assign(new Error(message), { type, data }),
      },
    );
    assert.equal(result.status, "registered");
    throw new Error("Synthetic post-effect ACK loss");
  };
  const operation = { ...f.register, requestId: "agent-lost-ack" };
  const result = await f.mutate(operation, operation.requestId);
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  const instance = f.state.agentInstances.values().next().value;
  assert.equal((await instance.list()).data.length, 2);
  const duplicate = await f.mutate(operation, operation.requestId);
  assert.equal(duplicate.receipt.effect, "unknown");
  assert.equal(f.state.calls.filter((n) => n === "agent-register").length, 1);
  const lookup = await f.lookup(operation.requestId);
  assert.equal(lookup.value.receipt.effect, "unknown");
  const snapshot = await f.snapshot();
  assert.ok(
    snapshot.retainedOperations.some(
      (v) =>
        v.operationId === operation.requestId && v.runtimeEpoch === "epoch",
    ),
  );
  assert.equal(
    snapshot.recovery.resources.some(
      (v) =>
        v.workspaceId === f.workspaceId && v.reason === "unresolved_operation",
    ),
    true,
  );
});

test("Native Agents reference appearing after flushed intent keeps unknown while Main adapter refuses private RPC", async (t) => {
  const f = await runtimeAgentFixture(t);
  const registered = await f.mutate(f.register, f.register.requestId);
  const observed = await f.observe();
  f.state.hooks["agent-remove"] = async (input) => {
    f.records.set("foreign", {
      id: "foreign",
      agent: input.nativeId,
      time: { archived: 1 },
    });
    return f.state.agentApi.remove(input);
  };
  const result = await f.mutate(
    {
      type: "configuration.agent.remove",
      workspaceId: f.workspaceId,
      requestId: "late-reference",
      nativeId: registered.value.nativeId,
      observationId: observed.observationId,
    },
    "late-reference",
  );
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  const instance = f.state.agentInstances.values().next().value;
  assert.ok(
    (await instance.list()).data.some(
      (r) => r.id === registered.value.nativeId,
    ),
  );
  assert.equal(
    (await f.lookup("late-reference")).value.receipt.effect,
    "unknown",
  );
});

test("Agent file service binds flat source/directory/original backup and keeps Native idle", async (t) => {
  let prepared, f;
  const calls = [],
    confirmations = [];
  const adapter = {
    prepare: async (input) => {
      prepared = globalThis.structuredClone(input);
      calls.push("stage");
      return { status: "staged", token: "d".repeat(64) };
    },
    publish: async () => {
      calls.push("publish");
      assert.equal(prepared.kind, "agent");
      await fs.writeFile(
        join(
          prepared.workspacePath,
          ".opencode/agents",
          `${prepared.sourceName}.md`,
        ),
        prepared.text,
      );
      const observed = await readAgentFile(
        { id: prepared.workspaceId, path: prepared.workspacePath },
        prepared.sourceName,
      );
      return {
        status: "saved",
        version: observed.version,
        backupId: configurationBackupId(
          prepared.runtimeEpoch,
          prepared.operationId,
          "agent",
        ),
      };
    },
    abort: async () => calls.push("abort"),
  };
  f = await fixture(t, {
    configurationSave: adapter,
    confirmConfigurationSave: async (input) => {
      confirmations.push(input);
      return true;
    },
  });
  const snap = await f.ready(),
    workspaceId = snap.selectedWorkspaceId,
    root = snap.workspaces[0].path;
  await fs.mkdir(join(root, ".opencode/agents"), { recursive: true });
  const path = join(root, ".opencode/agents/reviewer.md");
  await fs.writeFile(path, "# Original\n");
  const read = await f.read({
    type: "configuration.agent.read",
    workspaceId,
    sourceName: "reviewer",
  });
  assert.equal(read.ok, true, JSON.stringify(read));
  const before = [...f.state.calls];
  const operation = {
    type: "configuration.agent.save",
    workspaceId,
    requestId: "agent-file-save",
    sourceName: "reviewer",
    text: "# Changed\n",
    expectation: "version",
    version: read.value.version,
    directoryVersion: read.value.directoryVersion,
  };
  const result = await f.mutate(operation, operation.requestId);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "saved");
  assert.equal(result.receipt.result.kind, "agent_file_saved");
  assert.equal(result.receipt.result.sourceName, "reviewer");
  assert.equal(
    result.receipt.result.backupId,
    configurationBackupId("epoch", operation.requestId, "agent"),
  );
  assert.deepEqual(calls, ["stage", "publish"]);
  assert.deepEqual(noGets(f.state.calls), noGets(before));
  assert.equal(confirmations[0].targetPath, path);
  assert.equal(prepared.directoryVersion, read.value.directoryVersion);
  assert.equal(prepared.kind, "agent");
  const duplicate = await f.mutate(operation, operation.requestId);
  assert.equal(duplicate.receipt.effect, "confirmed");
  assert.deepEqual(calls, ["stage", "publish"]);
});

// Main-owned generic file service tests: production admission/registry with inert SDK fixtures.
async function workspaceFileFixture(t, options = {}) {
  const f = await fixture(t, options);
  const snapshot = await f.ready();
  const workspaceId = snapshot.selectedWorkspaceId;
  const root = snapshot.workspaces.find((w) => w.id === workspaceId).path;
  await fs.mkdir(join(root, "src"));
  const path = "src/ordinary.txt",
    target = join(root, path);
  await fs.writeFile(target, "\uFEFFOriginal\r\n");
  const observed = await f.read({ type: "file.edit.read", workspaceId, path });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.status, "available", JSON.stringify(observed));
  const request = {
    type: "file.save",
    workspaceId,
    path,
    requestId: "file-save",
    text: "Changed\r\n",
    expectation: "version",
    version: observed.value.version,
    directoryVersion: observed.value.directoryVersion,
  };
  return { ...f, workspaceId, root, target, observed: observed.value, request };
}
test("workspace file authority uses explicit retained authorityHold without discarding original keys", async (t) => {
  // Inject only the private registry projection, not a recovery capability.
  // Storage's independent tests prove when false may actually be persisted.
  let retained = [];
  const f = await workspaceFileFixture(t, {
    projectRegistry: (registry) => ({
      ...registry,
      readView() {
        const view = registry.readView();
        return {
          ...view,
          retainedOperations: [...view.retainedOperations, ...retained],
        };
      },
    }),
  });
  const original = {
    runtimeEpoch: "original-epoch",
    operationId: "original-permission-request",
    type: "permission.respond",
    workspaceId: f.workspaceId,
  };
  const read = () =>
    f.read({
      type: "file.edit.read",
      workspaceId: f.workspaceId,
      path: f.request.path,
    });
  retained = [{ ...original, authorityHold: false }];
  const released = await read();
  assert.equal(released.ok, true, JSON.stringify(released));
  assert.equal(released.value.status, "available");
  assert.deepEqual((await f.snapshot()).retainedOperations, retained);
  for (const row of [{ ...original, authorityHold: true }, original]) {
    retained = [row];
    const held = await read();
    assert.equal(held.code, "UNAVAILABLE", JSON.stringify(held));
  }
  retained = [
    { ...original, workspaceId: "other-workspace", authorityHold: true },
  ];
  assert.equal((await read()).ok, true);
});

test("workspace file explicit baseline is separate from preview and protected/missing leaves have no write proof", async (t) => {
  const f = await workspaceFileFixture(t);
  assert.equal(f.observed.runtimeEpoch, "epoch");
  assert.equal(Number.isSafeInteger(f.observed.revision), true);
  assert.equal(f.observed.path, "src/ordinary.txt");
  assert.equal(f.observed.targetPath, f.target);
  assert.equal(f.observed.content, "\uFEFFOriginal\r\n");
  const preview = await f.read({
    type: "file.read",
    workspaceId: f.workspaceId,
    path: f.request.path,
  });
  assert.equal(preview.ok, true);
  assert.equal(Object.hasOwn(preview.value, "version"), false);
  const missing = await f.read({
    type: "file.edit.read",
    workspaceId: f.workspaceId,
    path: "missing.txt",
  });
  assert.equal(missing.value.reason, "missing_file");
  assert.equal(Object.hasOwn(missing.value, "version"), false);
  const protectedFile = await f.read({
    type: "file.edit.read",
    workspaceId: f.workspaceId,
    path: "AGENTS.md",
  });
  assert.equal(protectedFile.value.reason, "protected_source");
  assert.equal(Object.hasOwn(protectedFile.value, "content"), false);
});
for (const scenario of [
  "deny",
  "before-conflict",
  "confirm-conflict",
  "pending",
  "active",
  "unknown-stage",
])
  test(`workspace file ${scenario} preserves original identity and refuses false confirmation`, async (t) => {
    let f,
      stageCalls = 0,
      publishCalls = 0;
    f = await workspaceFileFixture(t, {
      configurationSave: {
        prepare: async () => {
          stageCalls++;
          return { status: "unknown", reason: "io_failed" };
        },
        publish: async () => {
          publishCalls++;
        },
        abort: async () => {},
      },
      confirmConfigurationSave: async (info) => {
        assert.equal(info.kind, "file");
        assert.equal(info.targetPath, f.target);
        if (scenario === "confirm-conflict")
          await fs.writeFile(f.target, "External\r\n");
        return scenario !== "deny";
      },
    });
    if (scenario === "before-conflict")
      await fs.writeFile(f.target, "External\r\n");
    if (scenario === "pending")
      f.state.hooks.permissions = () => [{ id: "pending" }];
    if (scenario === "active")
      f.state.hooks.active = () =>
        Object.fromEntries(
          [...f.records.keys()].map((id) => [id, { type: "busy" }]),
        );
    const result = await f.mutate(f.request, f.request.requestId);
    assert.equal(
      result.ok,
      scenario === "unknown-stage",
      JSON.stringify(result),
    );
    if (scenario === "unknown-stage") {
      assert.equal(result.receipt.effect, "unknown");
      assert.equal(stageCalls, 1);
      const again = await f.mutate(f.request, f.request.requestId);
      assert.equal(again.receipt.effect, "unknown");
      assert.equal(stageCalls, 1);
      const original = await f.lookup(f.request.requestId);
      assert.equal(original.value.receipt.effect, "unknown");
      assert.equal(JSON.stringify(original).includes("Changed"), false);
      const snapshot = await f.snapshot();
      assert.ok(
        snapshot.retainedOperations.some(
          (k) =>
            k.operationId === f.request.requestId && k.type === "file.save",
        ),
      );
    } else {
      assert.equal(
        result.code,
        scenario.includes("conflict")
          ? "FILE_CHANGED"
          : scenario === "deny"
            ? "CANCELLED"
            : "BUSY",
        JSON.stringify(result),
      );
      assert.equal(result.receipt.effect, "none");
      assert.equal(stageCalls, 0);
    }
    assert.equal(publishCalls, 0);
    assert.equal(
      await fs.readFile(f.target, "utf8"),
      scenario.includes("conflict") ? "External\r\n" : "\uFEFFOriginal\r\n",
    );
  });

// This adapter is an inert service fixture. The staged-Bun probe tests the actual publisher.
async function workspaceFilePublisherFixture(
  t,
  { pauseAt, badProof = false } = {},
) {
  const gate = deferred(),
    reached = deferred();
  t.after(() => gate.resolve());
  const calls = [],
    confirmations = [];
  let f,
    prepared,
    armed = false;
  const waitAt = async (phase) => {
    if (pauseAt === phase) {
      reached.resolve();
      await gate.promise;
    }
  };
  f = await workspaceFileFixture(t, {
    io: {
      write: async (file, bytes) => {
        const payload = JSON.parse(bytes).payload;
        if (armed && payload?.operationId === "file-save") {
          if (payload.kind === "completion") await waitAt("completion");
          if (payload.step === "filesystem.configuration.stage")
            await waitAt("stage-flush");
          if (payload.step === "filesystem.configuration.publish")
            await waitAt("publish-flush");
        }
        await file.writeFile(bytes);
      },
    },
    confirmConfigurationSave: async (info) => {
      confirmations.push(info);
      await waitAt("confirmation");
      return true;
    },
    configurationSave: {
      prepare: async (input) => {
        calls.push("stage");
        prepared = input;
        await waitAt("prepare");
        return { status: "staged", token: "a".repeat(64) };
      },
      publish: async ({ token }) => {
        assert.equal(token, "a".repeat(64));
        calls.push("publish");
        await fs.copyFile(
          f.target,
          join(
            f.directory,
            configurationBackupId("epoch", "file-save", "file"),
          ),
        );
        await fs.writeFile(
          f.target,
          badProof ? "External after publication\r\n" : prepared.text,
        );
        const current = await readWorkspaceFile(
          { id: f.workspaceId, path: f.root },
          prepared.path,
        );
        return {
          status: "saved",
          version: current.version,
          backupId: configurationBackupId("epoch", "file-save", "file"),
        };
      },
      abort: async () => {
        calls.push("abort");
      },
    },
  });
  armed = true;
  return { ...f, calls, confirmations, gate, reached };
}
test("workspace file confirmed receipt correlates actual admission digest, both dispatch targets and original lookup", async (t) => {
  const f = await workspaceFilePublisherFixture(t);
  const expectedRevision = f.observed.revision;
  const nativeCallsBefore = f.state.calls.length;
  const result = await f.mutate(f.request, "file-save", { expectedRevision });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "saved", JSON.stringify(result));
  assert.equal(result.receipt.effect, "confirmed", JSON.stringify(result));
  const canonical = { ...f.request, expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  assert.equal(
    f.registry.lookupIdentity({
      runtimeEpoch: "epoch",
      operationId: "file-save",
    }).digest,
    digest,
  );
  assert.deepEqual(result.receipt.result, {
    kind: "file_saved",
    workspaceId: f.workspaceId,
    path: f.request.path,
    version: result.value.version,
    digest,
    backupId: configurationBackupId("epoch", "file-save", "file"),
  });
  assert.deepEqual(f.calls, ["stage", "publish"]);
  assert.equal(f.confirmations[0].previousText, "\uFEFFOriginal\r\n");
  assert.equal(f.confirmations[0].text, f.request.text);
  assert.equal(await fs.readFile(f.target, "utf8"), f.request.text);
  assert.equal(
    await fs.readFile(join(f.directory, result.value.backupId), "utf8"),
    "\uFEFFOriginal\r\n",
  );
  const journal = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse)
    .map((r) => r.payload);
  const dispatches = journal.filter(
    (r) => r.operationId === "file-save" && r.kind === "dispatch",
  );
  assert.deepEqual(
    dispatches.map((r) => r.step),
    ["filesystem.configuration.stage", "filesystem.configuration.publish"],
  );
  for (const r of dispatches)
    assert.deepEqual(r.fileTarget, {
      path: f.request.path,
      version: f.request.version,
      directoryVersion: f.request.directoryVersion,
    });
  assert.equal(JSON.stringify(journal).includes("Changed"), false);
  assert.ok(
    f.state.calls
      .slice(nativeCallsBefore)
      .every((name) =>
        ["get", "active", "inbox", "permissions"].includes(name),
      ),
    JSON.stringify(f.state.calls.slice(nativeCallsBefore)),
  );
  const duplicate = await f.mutate(f.request, "file-save", {
    expectedRevision,
  });
  assert.deepEqual(duplicate.receipt, result.receipt);
  assert.deepEqual(f.calls, ["stage", "publish"]);
  const conflict = await f.mutate(
    { ...f.request, text: "different" },
    "file-save",
    { expectedRevision },
  );
  assert.equal(conflict.ok, false);
  assert.deepEqual(f.calls, ["stage", "publish"]);
  assert.deepEqual((await f.lookup("file-save")).value.receipt, result.receipt);
});
for (const phase of [
  "confirmation",
  "stage-flush",
  "prepare",
  "publish-flush",
  "completion",
])
  test(`workspace file paused ${phase} fences same-workspace read while unrelated baseline remains usable`, async (t) => {
    const f = await workspaceFilePublisherFixture(t, { pauseAt: phase });
    const made = await f.mutate(
      { type: "workspace.create", name: "Independent" },
      "independent",
    );
    assert.equal(made.ok, true, JSON.stringify(made));
    const other = made.value.workspaces.find((w) => w.id !== f.workspaceId);
    const trusted = await f.mutate(
      { type: "session.create", workspaceId: other.id, title: "Independent" },
      "independent-session",
    );
    assert.equal(trusted.ok, true, JSON.stringify(trusted));
    await fs.writeFile(join(other.path, "other.txt"), "Independent\n");
    const pending = f.mutate(f.request, "file-save");
    await f.reached.promise;
    const same = await f.read({
      type: "file.edit.read",
      workspaceId: f.workspaceId,
      path: f.request.path,
    });
    assert.equal(same.ok, false, JSON.stringify(same));
    const independent = await f.read({
      type: "file.edit.read",
      workspaceId: other.id,
      path: "other.txt",
    });
    assert.equal(independent.ok, true, JSON.stringify(independent));
    assert.equal(independent.value.content, "Independent\n");
    assert.notEqual(
      (await f.lookup("file-save")).value.receipt.effect,
      "confirmed",
    );
    if (phase !== "completion")
      assert.equal(await fs.readFile(f.target, "utf8"), "\uFEFFOriginal\r\n");
    f.gate.resolve();
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.effect, "confirmed", JSON.stringify(result));
    assert.deepEqual(f.calls, ["stage", "publish"]);
  });
test("workspace file claimed saved with mismatched final bytes remains original-key unknown and never republishes", async (t) => {
  const f = await workspaceFilePublisherFixture(t, { badProof: true });
  const result = await f.mutate(f.request, "file-save");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "unknown");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(result.receipt.result, undefined);
  assert.equal(
    (await f.mutate(f.request, "file-save")).receipt.effect,
    "unknown",
  );
  assert.deepEqual(f.calls, ["stage", "publish"]);
  assert.equal(
    await fs.readFile(f.target, "utf8"),
    "External after publication\r\n",
  );
  assert.equal((await f.lookup("file-save")).value.receipt.effect, "unknown");
});

test("workspace file staged token is aborted when authority changes before publication", async (t) => {
  let f;
  const calls = [];
  f = await workspaceFileFixture(t, {
    confirmConfigurationSave: async () => true,
    configurationSave: {
      prepare: async () => {
        calls.push("stage");
        await f.registry.begin({
          runtimeEpoch: "epoch",
          operationId: "interference",
          type: "workspace.create",
          digest: "b".repeat(64),
        });
        return { status: "staged", token: "c".repeat(64) };
      },
      publish: async () => {
        calls.push("publish");
      },
      abort: async ({ token }) => {
        assert.equal(token, "c".repeat(64));
        calls.push("abort");
      },
    },
  });
  const result = await f.mutate(f.request, "file-save");
  assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
  assert.deepEqual(calls, ["stage", "abort"]);
  assert.equal(await fs.readFile(f.target, "utf8"), "\uFEFFOriginal\r\n");
});

test("workspace trust granted by dialog persists across restart; untrusted imports stay untrusted", async (t) => {
  let selected;
  const f = await fixture(t, {
    bootstrap: false,
    pickDirectory: async () => selected,
  });
  await f.ready();
  const ids = [];
  for (const name of ["trusted", "plain"]) {
    selected = join(f.root, name);
    await fs.mkdir(selected);
    const imported = await f.mutate(
      { type: "workspace.import" },
      `import-${name}`,
    );
    assert.equal(imported.ok, true, JSON.stringify(imported));
    ids.push(imported.value.selectedWorkspaceId);
  }
  const created = await f.mutate(
    { type: "session.create", workspaceId: ids[0] },
    "trust-first",
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  f.service.close();
  await f.service.drain();
  const reopened = createWorkbenchService({
    registry: f.registry,
    runtime: f.runtime,
    runtimeEpoch: "epoch",
    bootstrap: false,
  });
  try {
    const snapshot = await reopened.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: "trust-snapshot",
        operation: { type: "snapshot" },
      },
      "sender",
    );
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    const trust = Object.fromEntries(
      snapshot.value.workspaces.map((w) => [w.id, w.trusted]),
    );
    assert.deepEqual(trust, { [ids[0]]: true, [ids[1]]: false });
  } finally {
    reopened.close();
    await reopened.drain();
  }
});

test("durable duplicate import reuses canonical workspace across alias, duplicate key and checkpoint reopen", async (t) => {
  let selected;
  let picks = 0;
  const f = await fixture(t, {
    bootstrap: false,
    pickDirectory: async () => {
      picks++;
      return selected;
    },
  });
  await f.ready();
  selected = join(f.root, "imported");
  await fs.mkdir(selected);
  const sentinel = join(selected, "sentinel");
  const bytes = Buffer.from("synthetic original\r\n");
  await fs.writeFile(sentinel, bytes);
  const first = await f.mutate({ type: "workspace.import" }, "import-first");
  assert.equal(first.ok, true, JSON.stringify(first));
  const wid = first.value.selectedWorkspaceId;
  const original = globalThis.structuredClone(
    f.registry.readView().workspaces[0],
  );
  const alias = join(f.root, "import-alias");
  await fs.symlink(selected, alias);
  selected = alias;
  const again = await f.mutate({ type: "workspace.import" }, "import-alias");
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.value.selectedWorkspaceId, wid);
  assert.equal(again.value.workspaces.length, 1);
  assert.equal(again.receipt.effect, "confirmed");
  assert.equal(again.receipt.result.workspaceId, wid);
  assert.deepEqual(f.registry.readView().workspaces[0], original);
  assert.deepEqual(f.registry.readView().sessions, []);
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  assert.deepEqual(f.state.calls, []);
  const duplicate = await f.mutate(
    { type: "workspace.import" },
    "import-alias",
  );
  assert.deepEqual(duplicate.receipt, again.receipt);
  assert.equal(picks, 2);
  assert.deepEqual(
    (await f.lookup("import-alias")).value.receipt,
    again.receipt,
  );
  assert.deepEqual(await fs.readFile(sentinel), bytes);
  f.service.close();
  await f.service.drain();
  await f.registry.checkpoint();
  await f.registry.close();
  const reopened = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "reopened",
  });
  const service = createWorkbenchService({
    registry: reopened,
    runtimeReady: Promise.resolve(f.runtime),
    runtimeEpoch: "reopened",
    bootstrap: false,
    pickDirectory: async () => alias,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await reopened.close();
  });
  const after = await service.handle(
    {
      version: 2,
      runtimeEpoch: "reopened",
      readId: "ready",
      operation: { type: "snapshot" },
    },
    "sender",
  );
  assert.equal(after.ok, true);
  let reopenedReadId = 0;
  await until(async () => {
    const snapshot = await service.handle(
      {
        version: 2,
        runtimeEpoch: "reopened",
        readId: `ready-${++reopenedReadId}`,
        operation: { type: "snapshot" },
      },
      "sender",
    );
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    return snapshot.value.state === "connected";
  });
  const result = await service.handle(
    {
      version: 2,
      runtimeEpoch: "reopened",
      operationId: "import-reopened",
      operation: { type: "workspace.import" },
    },
    "sender",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.selectedWorkspaceId, wid);
  assert.deepEqual(reopened.readView().workspaces[0], original);
  assert.deepEqual(await fs.readFile(sentinel), bytes);
  assert.deepEqual(f.state.calls, []);
});

test("durable reimport preserves managed ownership and reserved first-session identity", async (t) => {
  let selected;
  const f = await fixture(t, {
    bootstrap: false,
    pickDirectory: async () => selected,
  });
  await f.ready();
  const made = await f.mutate(
    { type: "workspace.create", name: "Original" },
    "managed-original",
  );
  assert.equal(made.ok, true, JSON.stringify(made));
  const wid = made.value.selectedWorkspaceId;
  const original = globalThis.structuredClone(
    f.registry.readView().workspaces[0],
  );
  selected = original.canonicalPath;
  const result = await f.mutate({ type: "workspace.import" }, "managed-import");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.selectedWorkspaceId, wid);
  assert.deepEqual(f.registry.readView().workspaces[0], original);
  assert.equal(f.state.calls.length, 0);
  const first = await f.mutate(
    { type: "session.create", workspaceId: wid, title: "First" },
    "managed-first",
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.selectedSessionId, original.folderSessionId);
  const before = globalThis.structuredClone(f.registry.readView().sessions);
  const trusted = await f.mutate(
    { type: "workspace.import" },
    "managed-trusted-import",
  );
  assert.equal(trusted.ok, true, JSON.stringify(trusted));
  assert.equal(
    trusted.value.workspaces.find((w) => w.id === wid).trusted,
    true,
  );
  assert.deepEqual(f.registry.readView().sessions, before);
  assert.equal(f.state.calls.filter((c) => c === "create").length, 1);
});

test("durable import at100 registrations opens an existing target and refuses a101st distinct path", async (t) => {
  let selected;
  const f = await fixture(t, {
    bootstrap: false,
    pickDirectory: async () => selected,
  });
  await f.ready();
  let original;
  for (let n = 0; n < 100; n++) {
    selected = join(f.root, `import-${n}`);
    await fs.mkdir(selected);
    const result = await f.mutate(
      { type: "workspace.import" },
      `capacity-${n}`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    if (n === 0) original = result.value.selectedWorkspaceId;
  }
  selected = join(f.root, "import-0");
  const existing = await f.mutate(
    { type: "workspace.import" },
    "capacity-existing",
  );
  assert.equal(existing.ok, true, JSON.stringify(existing));
  assert.equal(existing.value.selectedWorkspaceId, original);
  selected = join(f.root, "import-over-limit");
  await fs.mkdir(selected);
  const rejected = await f.mutate(
    { type: "workspace.import" },
    "capacity-distinct",
  );
  assert.equal(rejected.code, "LIMIT_REACHED", JSON.stringify(rejected));
  assert.equal(rejected.receipt.effect, "none");
  assert.equal(f.registry.readView().workspaces.length, 100);
  assert.equal(f.state.calls.length, 0);
});

test("durable duplicate import cannot clear an existing unresolved resource hold", async (t) => {
  let selected;
  const f = await fixture(t, {
    bootstrap: false,
    pickDirectory: async () => selected,
  });
  await f.ready();
  selected = join(f.root, "held-import");
  await fs.mkdir(selected);
  const first = await f.mutate({ type: "workspace.import" }, "held-original");
  assert.equal(first.ok, true, JSON.stringify(first));
  const wid = first.value.selectedWorkspaceId;
  const original = globalThis.structuredClone(
    f.registry.readView().workspaces[0],
  );
  await f.registry.begin({
    runtimeEpoch: "epoch",
    operationId: "held-operation",
    type: "session.create",
    workspaceId: wid,
    digest: "a".repeat(64),
  });
  const result = await f.mutate({ type: "workspace.import" }, "held-repeat");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.receipt.effect, "none");
  assert.deepEqual(f.registry.readView().workspaces[0], original);
  assert.equal(
    f.registry
      .readView()
      .retainedOperations.some((r) => r.operationId === "held-operation"),
    true,
  );
  assert.equal(f.state.calls.length, 0);
});

test("context durable checked bytes remain original after external edit and journal retains no bytes", async (t) => {
  const f = await fixture(t);
  const snap = await f.ready(),
    scope = {
      workspaceId: snap.selectedWorkspaceId,
      sessionId: snap.selectedSessionId,
    };
  const root = snap.workspaces.find((w) => w.id === scope.workspaceId).path;
  const text = "\uFEFFcaptured\r\n";
  await fs.writeFile(join(root, "context.txt"), text);
  f.state.hooks.models = () => ({
    data: [
      {
        id: "m",
        providerID: "p",
        name: "Model",
        enabled: true,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
      },
    ],
  });
  const catalog = await f.read({
    type: "catalog.list",
    workspaceId: scope.workspaceId,
  });
  const model = catalog.value.models.entries[0].id;
  const observed = await f.read({
    type: "context.observe",
    workspaceId: scope.workspaceId,
    path: "context.txt",
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  await fs.writeFile(join(root, "context.txt"), "later external edit");
  let sent;
  f.state.hooks.prompt = ({ sessionID, text, files }) => {
    sent = files;
    const result = {
      id: "context-in",
      sessionID,
      type: "user",
      delivery: "steer",
      payload: {
        text,
        files: files.map((file) => ({
          name: file.name,
          mime: "text/plain",
          source: { type: "inline" },
          data: file.uri.split(",")[1],
        })),
      },
    };
    f.state.inbox = [result];
    return result;
  };
  const request = {
    type: "message.send",
    ...scope,
    requestId: "context-send",
    text: "inspect captured",
    model,
    attachments: [observed.value.descriptor],
  };
  const result = await f.mutate(request, "context-send", {
    expectedRevision: observed.value.revision,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "accepted");
  assert.equal(
    Buffer.from(sent[0].uri.split(",")[1], "base64").toString("utf8"),
    text,
  );
  const journal = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
  assert.equal(journal.includes(Buffer.from(text).toString("base64")), false);
  assert.equal(journal.includes("later external edit"), false);
  assert.equal(journal.includes("capabilityId"), false);
  assert.equal(
    await fs.readFile(join(root, "context.txt"), "utf8"),
    "later external edit",
  );
});
test("context durable cancel confirms request ACK with exact original target and both flushed policies", async (t) => {
  const f = await fixture(t);
  const snap = await f.ready(),
    scope = {
      workspaceId: snap.selectedWorkspaceId,
      sessionId: snap.selectedSessionId,
    };
  const nativeId = f.registry
    .readView()
    .sessions.find((s) => s.appSessionId === scope.sessionId).nativeSessionId;
  f.state.inbox = [
    {
      id: "pending-context",
      sessionID: nativeId,
      type: "user",
      delivery: "queue",
      payload: { text: "synthetic pending" },
    },
  ];
  let cancels = 0;
  f.runtime.workbenchContext().client.session.inbox.cancel = async () => {
    cancels++;
  };
  const request = {
    type: "session.inbox.cancel",
    ...scope,
    requestId: "cancel-context",
    inboxId: "pending-context",
  };
  const result = await f.mutate(request, "cancel-context", {
    expectedRevision: snap.revision,
  });
  assert.equal(
    result.ok,
    true,
    JSON.stringify({
      result,
      calls: f.state.calls,
      record: f.records.get(nativeId),
      identity: f.registry.lookupIdentity({
        runtimeEpoch: f.records.get(nativeId).metadata.originalRuntimeEpoch,
        operationId: f.records.get(nativeId).metadata.operationId,
      }),
    }),
  );
  assert.equal(result.receipt.effect, "confirmed");
  assert.deepEqual(result.receipt.result, {
    kind: "inbox_cancel_requested",
    ...scope,
    inboxId: "pending-context",
    digest: createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys({ ...request, expectedRevision: snap.revision })
            .sort()
            .map((k) => [
              k,
              { ...request, expectedRevision: snap.revision }[k],
            ]),
        ),
      )
      .digest("hex"),
  });
  assert.equal(f.state.inbox.length, 1);
  const duplicate = await f.mutate(request, "cancel-context", {
    expectedRevision: snap.revision,
  });
  assert.equal(duplicate.receipt.effect, "confirmed");
  assert.equal(cancels, 1);
  const records = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const steps = records.filter(
    (r) => r.operationId === "cancel-context" && r.step,
  );
  assert.deepEqual(
    steps.map((r) => r.step),
    [
      "native.policy.before_selection",
      "native.policy.after_selection",
      "native.inbox.cancel",
    ],
  );
  assert.deepEqual(steps[2].inboxTarget, { inboxId: "pending-context" });
  assert.equal(Object.hasOwn(steps[2], "nativeSessionId"), false);
});
test("context durable explicit current-run queue preserves original acknowledged request and no switches", async (t) => {
  const f = await fixture(t);
  const snap = await f.ready(),
    scope = {
      workspaceId: snap.selectedWorkspaceId,
      sessionId: snap.selectedSessionId,
    };
  const nativeId = f.registry
    .readView()
    .sessions.find((s) => s.appSessionId === scope.sessionId).nativeSessionId;
  let count = 0;
  f.state.hooks.prompt = ({ sessionID, text, delivery }) => {
    const result = {
      id: `running-in-${++count}`,
      sessionID,
      type: "user",
      delivery: delivery ?? "steer",
      payload: { text },
    };
    f.state.inbox.push(result);
    return result;
  };
  const first = await f.mutate(
    {
      type: "message.send",
      ...scope,
      requestId: "original-run",
      text: "original",
    },
    "original-run",
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  f.state.active = { [nativeId]: { type: "running" } };
  const start = f.state.calls.length;
  const next = await f.mutate(
    {
      type: "message.send",
      ...scope,
      requestId: "queue-run",
      text: "next instruction",
      delivery: "queue",
    },
    "queue-run",
  );
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(next.value.status, "accepted");
  assert.equal(count, 2);
  assert.equal(
    f.state.calls
      .slice(start)
      .some((name) => ["agent", "model", "models"].includes(name)),
    false,
  );
  const key = (await f.lookup("original-run")).value;
  assert.equal(key.status, "found");
  assert.equal(key.receipt.operationId, "original-run");
});

for (const change of ["unchanged", "message", "type", "missing"])
  test(`context before-user confirmed branch reopen ${change} boundary is correlated without effects`, async (t) => {
    const f = await fixture(t);
    const initial = await f.ready();
    const workspaceId = initial.selectedWorkspaceId;
    const sessionId = initial.selectedSessionId;
    const parentId = f.registry
      .readView()
      .sessions.find((s) => s.appSessionId === sessionId).nativeSessionId;
    const client = f.runtime.workbenchContext().client;
    client.session.message = {
      get: async ({ sessionID, messageID }) => ({
        id: messageID,
        sessionID,
        type: "user",
        payload: { text: "original" },
      }),
    };
    f.state.hooks.fork = ({ sessionID, before }) => {
      assert.equal(sessionID, parentId);
      assert.equal(before, "user-before");
      const parent = f.records.get(sessionID);
      const child = {
        ...parent,
        id: "ses_before_child",
        parentID: sessionID,
        metadata: { ...parent.metadata },
        fork: { sessionID, boundary: { type: "before", messageID: before } },
      };
      f.records.set(child.id, child);
      f.instructionEntries.set(child.id, []);
      return child;
    };
    const result = await f.mutate(
      {
        type: "session.fork",
        workspaceId,
        sessionId,
        requestId: "before-branch",
        before: "user-before",
      },
      "before-branch",
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.effect, "confirmed", JSON.stringify(result));
    await f.registry.checkpoint();
    f.service.close();
    await f.service.drain();
    await f.registry.close();
    const child = f.records.get("ses_before_child");
    if (change === "message") child.fork.boundary.messageID = "different-user";
    if (change === "type") child.fork.boundary.type = "through";
    if (change === "missing") delete child.fork.boundary;
    const reopened = await reopenForks(t, { ...f, initial });
    if (change === "unchanged") {
      assert.equal(reopened.snapshot.recovery.store.state, "ready");
      assert.ok(
        reopened.snapshot.sessions.some(
          (s) => s.id === result.receipt.result.sessionId,
        ),
      );
    } else {
      assert.equal(reopened.snapshot.recovery.store.state, "recovery_required");
      assert.equal(
        reopened.snapshot.recovery.store.reason,
        "identity_conflict",
      );
    }
  });

test("durable permission policy read checks mapping without appending or reinstalling rules", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.ready();
  const scope = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const records = globalThis.structuredClone([...f.records]);
  f.state.calls.length = 0;
  const observed = await f.read({ type: "permission.policy.read", ...scope });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.status, "available");
  assert.equal(observed.value.baselineMatches, true);
  assert.equal(observed.value.revision, snapshot.revision);
  assert.equal(Object.hasOwn(observed, "receipt"), false);
  assert.deepEqual(f.state.calls, ["get"]);
  assert.deepEqual([...f.records], records);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});
test("durable permission policy mismatch is observed without silently repairing Native rules", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.ready();
  const scope = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  const native = f.registry
    .readView()
    .sessions.find((s) => s.appSessionId === scope.sessionId).nativeSessionId;
  f.records.get(native).permissions = [];
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  f.state.calls.length = 0;
  const result = await f.read({ type: "permission.policy.read", ...scope });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.baselineMatches, false);
  assert.equal(result.value.sessionRulesState, "present");
  assert.deepEqual(result.value.sessionRules, []);
  assert.deepEqual(f.records.get(native).permissions, []);
  assert.deepEqual(f.state.calls, ["get"]);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});
test("durable permission policy forged original metadata cannot expose rules", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.ready();
  const scope = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  const native = f.registry
    .readView()
    .sessions.find((s) => s.appSessionId === scope.sessionId).nativeSessionId;
  f.records.get(native).metadata.digest = "f".repeat(64);
  f.state.calls.length = 0;
  const result = await f.read({ type: "permission.policy.read", ...scope });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
  assert.deepEqual(f.state.calls, ["get"]);
});
test("durable permission policy read cannot bypass original unresolved effect", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.ready();
  const scope = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  f.state.hooks.prompt = () => {
    throw new Error("synthetic lost acknowledgement");
  };
  const result = await f.mutate(
    {
      type: "message.send",
      ...scope,
      requestId: "held-policy",
      text: "synthetic",
    },
    "held-policy",
  );
  assert.equal(result.receipt.effect, "unknown", JSON.stringify(result));
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  f.state.calls.length = 0;
  const read = await f.read({ type: "permission.policy.read", ...scope });
  assert.equal(read.code, "UNAVAILABLE");
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
});

test("durable permission policy restored managed scope stays trusted after restart", async (t) => {
  const f = await fixture(t);
  await f.ready();
  f.service.close();
  await f.service.drain();
  const reopened = createWorkbenchService({
    registry: f.registry,
    runtime: f.runtime,
    runtimeEpoch: "epoch",
    bootstrap: false,
  });
  try {
    const snapshot = await reopened.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: "restored-snapshot",
        operation: { type: "snapshot" },
      },
      "sender",
    );
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    assert.equal(snapshot.value.workspaces[0].trusted, true);
  } finally {
    reopened.close();
    await reopened.drain();
  }
});

test("durable send is a plain journaled Native call without task preparation", async (t) => {
  let preparations = 0;
  const f = await fixture(t);
  const snapshot = await f.ready();
  // Even with the production-like task channel attached, send no longer asks
  // it to prepare or hold: dispatch -> effect -> complete only.
  f.context.nativeTasks = {
    async prepare() {
      preparations++;
      return { status: "held", reason: "inventory_unverified" };
    },
  };
  f.state.calls.length = 0;
  const operation = {
    type: "message.send",
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
    requestId: "task-plain",
    text: "\uFEFFexact\r\n",
  };
  const result = await f.mutate(operation, operation.requestId);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "accepted");
  assert.equal(preparations, 0);
  assert.ok(f.state.calls.includes("prompt"));
  assert.equal(f.registry.readView().tasks.length, 0);
  const original = await f.lookup(operation.requestId);
  assert.equal(original.value.receipt.admission, "dispatched");
  f.state.calls.length = 0;
  const duplicate = await f.mutate(operation, operation.requestId);
  assert.equal(duplicate.value.status, "duplicate");
  assert.deepEqual(duplicate.receipt, result.receipt);
  assert.deepEqual(f.state.calls, []);
});

test("stored permission mode is retained and never reset to baseline by send", async (t) => {
  const control = {
    version: 1,
    mode: "read_plan",
    modeGeneration: 3,
    settings: [],
    floorDigest: "a".repeat(64),
    compilerVersion: 1,
    policyDigest: "b".repeat(64),
  };
  const f = await fixture(t);
  const snapshot = await f.ready();
  f.service.close();
  await f.service.drain();
  // Private projection seam isolates Main hydration; this does not prove a
  // production mode mutation or a verified compiler/inventory generation.
  const projected = new Proxy(f.registry, {
    get(target, key) {
      if (key === "readView")
        return () => {
          const view = target.readView();
          view.sessions = view.sessions.map((row) => ({
            ...row,
            permissionControl: { ...control, settings: [] },
          }));
          return view;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const reopened = createWorkbenchService({
    registry: projected,
    runtimeReady: Promise.resolve(f.runtime),
    runtimeEpoch: "epoch",
    confirmTrust: async () => true,
  });
  const mutate = (operation, operationId) =>
    reopened.handle(
      { version: 2, runtimeEpoch: "epoch", operationId, operation },
      "mode-sender",
    );
  try {
    await until(async () => {
      const result = await reopened.handle(
        {
          version: 2,
          runtimeEpoch: "epoch",
          readId: "mode-snapshot",
          operation: { type: "snapshot" },
        },
        "mode-sender",
      );
      return result.ok && result.value.state === "connected";
    });
    // Use the existing explicit trust path, retaining the original selected
    // session. A new session is a real side effect, not a fake trust setter.
    const created = await mutate(
      { type: "session.create", workspaceId: snapshot.selectedWorkspaceId },
      "mode-trust",
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    f.state.calls.length = 0;
    const operation = {
      type: "message.send",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      requestId: "mode-no-reset",
      text: "check",
    };
    const result = await mutate(operation, operation.requestId);
    assert.equal(result.code, "POLICY_UNVERIFIED", JSON.stringify(result));
    assert.equal(f.state.calls.includes("policy"), false);
    assert.equal(f.state.calls.includes("prompt"), false);
    f.state.calls.length = 0;
    const fork = await mutate(
      {
        type: "session.fork",
        workspaceId: operation.workspaceId,
        sessionId: operation.sessionId,
        requestId: "mode-fork",
      },
      "mode-fork",
    );
    assert.equal(fork.code, "POLICY_UNVERIFIED", JSON.stringify(fork));
    assert.equal(f.state.calls.includes("fork"), false);
    assert.equal(f.state.calls.includes("policy"), false);
  } finally {
    reopened.close();
    await reopened.drain();
  }
});

// The pre-admission policy check performs read-only Native session.get calls.
const noGets = (calls) => calls.filter((name) => name !== "get");
const driftOther = async (f, workspaceId) => {
  const extra = await f.mutate(
    { type: "session.create", workspaceId },
    `extra-${Math.random()}`,
  );
  assert.equal(extra.ok, true, JSON.stringify(extra));
  const nativeId = f.registry
    .readView()
    .sessions.find(
      (x) => x.appSessionId === extra.value.selectedSessionId,
    ).nativeSessionId;
  f.records.get(nativeId).permissions = compileModeRules("scoped_edit");
  return nativeId;
};
const modeSetOps = async (f) =>
  (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload)
    .filter((p) => p.identity?.type === "permission.mode.set");

test("MCP register with a drifted other session re-applies policy in its own journaled op and completes", async (t) => {
  const f = await mcpFixture(t);
  const other = await driftOther(f, f.workspaceId);
  const result = await f.mutate(f.register, "mcp-drift");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.effect, "confirmed");
  assert.deepEqual(f.records.get(other).permissions, compileModeRules("ask"));
  assert.ok((await modeSetOps(f)).length > 0);
});

test("instruction apply with a drifted other session re-applies policy in its own journaled op and completes", async (t) => {
  const f = await instructionFixture(t);
  const other = await driftOther(f, f.scope.workspaceId);
  const result = await f.mutate(f.apply, "instructions-drift");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.effect, "confirmed");
  assert.deepEqual(f.records.get(other).permissions, compileModeRules("ask"));
  assert.ok((await modeSetOps(f)).length > 0);
});

test("instruction apply on an idle session with a drifted running session is never POLICY_UNVERIFIED from sync", async (t) => {
  const f = await instructionFixture(t);
  const other = await driftOther(f, f.scope.workspaceId);
  f.state.active = { [other]: { type: "running" } };
  const result = await f.mutate(f.apply, "instructions-busy-other");
  assert.notEqual(result.code, "POLICY_UNVERIFIED", JSON.stringify(result));
});

test("MCP observation read succeeds while another session has drifted", async (t) => {
  const f = await mcpFixture(t);
  await driftOther(f, f.workspaceId);
  const result = await f.observe();
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a BUSY mode.set during policy sync settles once Native reports idle", async (t) => {
  const f = await instructionFixture(t);
  f.records.get(f.nativeId).permissions = compileModeRules("scoped_edit");
  f.state.active = { [f.nativeId]: { type: "running" } };
  setTimeout(() => (f.state.active = {}), 400);
  const result = await f.mutate(f.apply, "instructions-busy-settles");
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a mode the user changes between BUSY and the retry is never overwritten", async (t) => {
  const f = await instructionFixture(t);
  f.records.get(f.nativeId).permissions = compileModeRules("scoped_edit");
  f.state.active = { [f.nativeId]: { type: "running" } };
  const pending = f.mutate(f.apply, "instructions-busy-user-mode");
  await new Promise((resolve) => setTimeout(resolve, 100));
  f.state.active = {};
  const set = await f.mutate(
    {
      type: "permission.mode.set",
      ...f.scope,
      mode: "read_plan",
      requestId: "user-mode",
    },
    "user-mode",
  );
  assert.equal(set.ok, true, JSON.stringify(set));
  await pending;
  assert.deepEqual(
    f.records.get(f.nativeId).permissions,
    compileModeRules("read_plan"),
  );
});

test("a BUSY mode.set during policy sync surfaces BUSY, not POLICY_UNVERIFIED", async (t) => {
  const f = await instructionFixture(t);
  f.records.get(f.nativeId).permissions = compileModeRules("scoped_edit");
  f.state.active = { [f.nativeId]: { type: "running" } };
  const result = await f.mutate(f.apply, "instructions-busy-self");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.notEqual(result.code, "POLICY_UNVERIFIED", JSON.stringify(result));
});

test("mode.set native.policy dispatch for a sibling-tracked native id is rejected", async (t) => {
  const f = await instructionFixture(t);
  const other = await driftOther(f, f.scope.workspaceId);
  const original = f.registry.dispatch;
  f.registry.dispatch = (input) =>
    original(
      input.step === "native.policy"
        ? { ...input, nativeSessionId: other }
        : input,
    );
  const result = await f.mutate(
    { type: "permission.mode.set", ...f.scope, mode: "ask", requestId: "sib" },
    "sibling-native",
  );
  f.registry.dispatch = original;
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(!f.records.get(other).permissions.some((r) => r.effect === "x"));
});

test("skill save with a drifted session re-applies policy in its own journaled op and completes", async (t) => {
  const f = await skillServiceFixture(t);
  const other = await driftOther(f, f.workspaceId);
  const result = await f.mutate(f.operation, "skill-drift");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(f.records.get(other).permissions, compileModeRules("ask"));
  assert.ok((await modeSetOps(f)).length > 0);
});

test("mode.set with failed child propagation is UNKNOWN_OUTCOME and re-applies the recorded previous mode (ask, not narrower-of)", async (t) => {
  const f = await fixture(t);
  const snap = await f.ready();
  const sessionId = snap.selectedSessionId;
  const nativeId = f.registry
    .readView()
    .sessions.find((x) => x.appSessionId === sessionId).nativeSessionId;
  f.records.set("child", {
    ...f.records.get(nativeId),
    id: "child",
    parentID: nativeId,
    title: "Agent",
  });
  f.state.hooks.update = async ({ sessionID, permissions }) => {
    if (sessionID === "child") throw new Error("child propagation");
    f.records.get(sessionID).permissions = permissions;
  };
  const result = await f.mutate(
    {
      type: "permission.mode.set",
      workspaceId: snap.selectedWorkspaceId,
      sessionId,
      mode: "read_plan",
      requestId: "mode-unknown",
    },
    "mode-unknown",
  );
  assert.equal(result.receipt?.effect, "unknown", JSON.stringify(result));
  assert.deepEqual(
    f.records.get(nativeId).permissions,
    compileModeRules("ask"),
  );
});

// ---- Bootstrap task authority (Native create/fork through the original task) ----
const journalPayloads = async (f) =>
  (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
// One label per journaled fact of this original operation, in durable order.
const trail = (payloads, operationId) =>
  payloads
    .filter(
      (payload) =>
        (payload.operationId ?? payload.identity?.operationId) === operationId,
    )
    .map((payload) =>
      payload.kind === "dispatch"
        ? `dispatch:${payload.step}`
        : payload.kind === "task.handoff"
          ? `handoff:${payload.state}`
          : payload.kind === "task_proof"
            ? `proof:${payload.outcome}`
            : payload.kind === "task.settle"
              ? `settle:${payload.outcome}`
              : payload.kind,
    );
const SETTLED_TRAIL = [
  "dispatch:native.create",
  "task.prepare",
  "task.observe",
  "handoff:armed",
  "handoff:consumed",
  "handoff:completed",
  "task.bootstrap-binding",
  "proof:settled",
  "settle:settled",
];
async function bootstrapped(t, knobs, extra) {
  const child = fakeBootstrapChild(knobs);
  const f = await fixture(t, { taskChild: child, ...extra });
  return { f, child };
}

test("fresh profile bootstraps its default session through the journaled original task", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  assert.equal(snapshot.state, "connected", JSON.stringify(snapshot.recovery));
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.retainedOperations.length, 0);
  assert.deepEqual(child.events, ["prepare", "arm", "consume:native.create"]);
  assert.equal(f.state.calls.filter((name) => name === "create").length, 1);
  const [task] = f.registry.readView().tasks;
  assert.equal(task.phase, "settled");
  assert.equal(task.authorityHold, false);
  assert.equal(task.identity.originKind, "bootstrap");
  assert.equal(task.identity.appSessionId, snapshot.selectedSessionId);
  const records = await journalPayloads(f);
  const labels = trail(records, task.identity.origin.operationId);
  assert.deepEqual(
    labels.filter((label) => !label.startsWith("dispatch:filesystem")),
    ["admission", "reservation", ...SETTLED_TRAIL, "completion"],
    JSON.stringify(labels),
  );
});

test("held preparation refuses the default bootstrap before dispatch and never reaches Native", async (t) => {
  const { f, child } = await bootstrapped(t, { held: true });
  const snapshot = await f.ready();
  assert.equal(f.state.calls.includes("create"), false);
  assert.deepEqual(child.events, ["prepare"]);
  assert.equal(snapshot.sessions.length, 0);
  assert.deepEqual(f.registry.readView().tasks, []);
  const records = await journalPayloads(f);
  assert.equal(
    records.some(
      (payload) =>
        (payload.kind === "dispatch" && payload.step === "native.create") ||
        String(payload.kind).startsWith("task"),
    ),
    false,
  );
  // The reserved folder keeps the original workspace.create retained (an
  // effect-none receipt is impossible once filesystem steps were dispatched):
  // the profile holds in recovery rather than guessing or re-issuing.
  assert.equal(snapshot.recovery.store.reason, "native_startup_unverified");
  assert.equal(
    f.registry
      .readView()
      .retainedOperations.every((row) => row.type === "workspace.create"),
    true,
  );
});

test("session.create runs the full original task and is bound to exactly one Native call", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  child.events.length = 0;
  f.state.calls.length = 0;
  const response = await f.mutate(
    {
      type: "session.create",
      workspaceId: snapshot.selectedWorkspaceId,
      title: "Second",
    },
    "create-second",
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.receipt.effect, "confirmed");
  assert.deepEqual(child.events, ["prepare", "arm", "consume:native.create"]);
  assert.equal(f.state.calls.filter((name) => name === "create").length, 1);
  const labels = trail(await journalPayloads(f), "create-second");
  assert.deepEqual(labels, [
    "admission",
    "reservation",
    "dispatch:native.create",
    "task.prepare",
    "task.observe",
    "handoff:armed",
    "handoff:consumed",
    "handoff:completed",
    "task.bootstrap-binding",
    "proof:settled",
    "settle:settled",
    "completion",
  ]);
  const task = f.registry
    .readView()
    .tasks.find((row) => row.identity.origin.operationId === "create-second");
  assert.equal(task.phase, "settled");
  assert.equal(
    task.identity.nativeSessionId,
    [...f.records.values()].find((info) => info.title === "Second").id,
  );
  // A replay of the same operation id never reaches Native or the child again.
  child.events.length = 0;
  f.state.calls.length = 0;
  const duplicate = await f.mutate(
    {
      type: "session.create",
      workspaceId: snapshot.selectedWorkspaceId,
      title: "Second",
    },
    "create-second",
  );
  assert.deepEqual(duplicate.receipt, response.receipt);
  assert.deepEqual(child.events, []);
  assert.equal(f.state.calls.includes("create"), false);
});

test("session.fork journals the parent identity, inherits metadata and settles the child", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  child.events.length = 0;
  const response = await f.mutate(
    {
      type: "session.fork",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      requestId: "fork-one",
    },
    "fork-one",
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.deepEqual(child.events, ["prepare", "arm", "consume:native.fork"]);
  const task = f.registry
    .readView()
    .tasks.find((row) => row.identity.origin.operationId === "fork-one");
  assert.equal(task.phase, "settled");
  assert.equal(task.binding.step, "native.fork");
  const parentSdk = [...f.records.values()][0];
  const { bootstrapParentDigest } = await import(
    "../native-permission-bootstrap-digest.mjs"
  );
  assert.equal(
    task.binding.parentIdentityDigest,
    bootstrapParentDigest({
      id: parentSdk.id,
      projectID: "project",
      directory: parentSdk.location.directory,
    }),
  );
  const forked = [...f.records.values()].find((info) => info.fork);
  assert.equal(task.identity.nativeSessionId, forked.id);
  assert.deepEqual(forked.metadata, parentSdk.metadata);
  const sessions = (await f.snapshot()).sessions;
  const child_ = sessions.find((row) => row.parentSessionId);
  assert.equal(child_.parentSessionId, snapshot.selectedSessionId);
  assert.equal(child_.status, "idle");
});

const createOperation = (snapshot, title = "Second") => ({
  type: "session.create",
  workspaceId: snapshot.selectedWorkspaceId,
  title,
});
test("held preparation for session.create is a clean refusal before reservation-side effects", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  child.knobs.held = true;
  child.events.length = 0;
  f.state.calls.length = 0;
  const response = await f.mutate(createOperation(snapshot), "create-held");
  assert.equal(response.code, "POLICY_UNVERIFIED", JSON.stringify(response));
  assert.equal(response.receipt.effect, "none");
  assert.deepEqual(child.events, ["prepare"]);
  assert.equal(f.state.calls.includes("create"), false);
  const labels = trail(await journalPayloads(f), "create-held");
  assert.equal(labels.includes("dispatch:native.create"), false);
  assert.equal(
    labels.some((label) => label.startsWith("task")),
    false,
  );
  assert.equal(f.registry.readView().tasks.length, 1, "only the default task");
  assert.deepEqual((await f.snapshot()).retainedOperations, []);
});

test("session.create refuses cleanly when a session is already recorded under the planned id", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  child.events.length = 0;
  f.state.calls.length = 0;
  // An imported or otherwise pre-existing session answers for the planned id.
  f.state.hooks.get = ({ sessionID }) => ({
    id: sessionID,
    projectID: "project",
    location: { directory: "/" },
  });
  const response = await f.mutate(createOperation(snapshot), "create-recorded");
  assert.equal(response.code, "POLICY_UNVERIFIED", JSON.stringify(response));
  assert.equal(response.receipt.effect, "none");
  assert.deepEqual(child.events, []);
  assert.equal(f.state.calls.includes("create"), false);
  assert.equal(
    trail(await journalPayloads(f), "create-recorded").includes(
      "dispatch:native.create",
    ),
    false,
  );
});

// Backlog #13: a transient Native read failure during the post-create policy
// readback must settle within the bounded attempts; a persistent one (or a real
// mismatch) still fails closed with POLICY_UNVERIFIED.
for (const [name, transient, ok] of [
  ["transient", 1, true],
  ["persistent", 99, false],
])
  test(`session.create bootstrap readback: ${name} Native read failure ${ok ? "settles" : "fails closed"}`, async (t) => {
    const { f } = await bootstrapped(t);
    const snapshot = await f.ready();
    let present = 0;
    let failures = transient;
    f.state.hooks.get = ({ sessionID }) => {
      const record = f.records.get(sessionID);
      if (!record)
        throw Object.assign(new Error("absent"), {
          _tag: "SessionNotFoundError",
          sessionID,
        });
      // 1st present read is the post-create check; later ones are readbacks.
      if (present++ >= 1 && failures-- > 0) throw new Error("transient read");
      return { ...record };
    };
    const response = await f.mutate(
      createOperation(snapshot),
      `create-readback-${name}`,
    );
    if (ok) assert.equal(response.ok, true, JSON.stringify(response));
    else assert.equal(response.code, "POLICY_UNVERIFIED");
  });

// Backlog #14: Native sessions outlive workspace.remove, so the removed
// workspace's project is held in the permission control until re-import.
for (const scenario of ["unshared", "shared", "refused"])
  test(`workspace.remove project hold: ${scenario}`, async (t) => {
    let selected;
    const { f } = await bootstrapped(t, undefined, {
      pickDirectory: async () => selected,
    });
    const snapshot = await f.ready();
    const holds = [];
    f.context.nativeProjects = {
      hold: async (id, held) => {
        holds.push([id, held]);
        return scenario === "refused" ? "refused" : "ok";
      },
    };
    selected = join(f.root, "removable");
    await fs.mkdir(selected);
    const imported = await f.mutate(
      { type: "workspace.import" },
      "hold-import",
    );
    assert.equal(imported.ok, true, JSON.stringify(imported));
    const workspaceId = imported.value.selectedWorkspaceId;
    const created = await f.mutate(
      { type: "session.create", workspaceId },
      "hold-create",
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const nativeId = [...f.records.keys()].at(-1);
    if (scenario !== "shared") f.records.get(nativeId).projectID = "project-b";
    const removed = await f.mutate(
      { type: "workspace.remove", workspaceId },
      "hold-remove",
    );
    if (scenario === "refused") {
      assert.equal(removed.code, "UNAVAILABLE", JSON.stringify(removed));
      assert.ok(
        (await f.snapshot()).workspaces.some((w) => w.id === workspaceId),
      );
      return;
    }
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.equal(
      (await f.snapshot()).workspaces.length,
      snapshot.workspaces.length,
    );
    if (scenario === "shared") {
      // Another registered workspace still uses the project: nothing held.
      assert.deepEqual(holds, []);
      return;
    }
    assert.deepEqual(holds, [["project-b", true]]);
    const again = await f.mutate({ type: "workspace.import" }, "hold-reimport");
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual(holds, [
      ["project-b", true],
      ["project-b", false],
    ]);
  });

// Backlog #14 review: Native project ids are shared across worktrees of a repo.
async function holdFixture(t) {
  let selected;
  const { f } = await bootstrapped(t, undefined, {
    pickDirectory: async () => selected,
  });
  await f.ready();
  const holds = [];
  let refuseOn;
  f.context.nativeProjects = {
    hold: async (id, held) => {
      holds.push([id, held]);
      return refuseOn === id && held ? "refused" : "ok";
    },
  };
  const projects = [];
  f.context.client.project = { list: async () => projects };
  let n = 0;
  const addWorkspace = async (withSession, projectID) => {
    selected = join(f.root, `wt-${n++}`);
    await fs.mkdir(selected);
    const path = await fs.realpath(selected);
    const imported = await f.mutate({ type: "workspace.import" }, `imp-${n}`);
    assert.equal(imported.ok, true, JSON.stringify(imported));
    const workspaceId = imported.value.selectedWorkspaceId;
    let nativeId;
    if (withSession) {
      const created = await f.mutate(
        { type: "session.create", workspaceId },
        `cr-${n}`,
      );
      assert.equal(created.ok, true, JSON.stringify(created));
      nativeId = [...f.records.keys()].at(-1);
      f.records.get(nativeId).projectID = projectID;
    }
    return { workspaceId, path, nativeId };
  };
  const remove = (workspaceId) =>
    f.mutate({ type: "workspace.remove", workspaceId }, `rm-${workspaceId}`);
  return {
    f,
    holds,
    projects,
    addWorkspace,
    remove,
    refuse: (id) => (refuseOn = id),
    pick: (path) => (selected = path),
  };
}

test("removing a worktree keeps a sessionless sibling usable (project shared via Native path resolution)", async (t) => {
  const h = await holdFixture(t);
  const a = await h.addWorkspace(true, "shared-p");
  const b = await h.addWorkspace(false);
  h.projects.push({ id: "shared-p", canonical: a.path, sandboxes: [b.path] });
  const removed = await h.remove(a.workspaceId);
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(h.holds, []);
});

test("a workspace imported later on a held project clears the hold; unrelated projects stay held", async (t) => {
  const h = await holdFixture(t);
  const a = await h.addWorkspace(true, "proj-a");
  const c = await h.addWorkspace(true, "proj-c");
  assert.equal((await h.remove(a.workspaceId)).ok, true);
  assert.equal((await h.remove(c.workspaceId)).ok, true);
  assert.deepEqual(h.holds, [
    ["proj-a", true],
    ["proj-c", true],
  ]);
  // A new worktree of proj-a is registered: only proj-a is released.
  const dir = join(h.f.root, "later");
  await fs.mkdir(dir);
  h.projects.push({
    id: "proj-a",
    canonical: await fs.realpath(dir),
    sandboxes: [],
  });
  h.pick(dir);
  assert.equal(
    (await h.f.mutate({ type: "workspace.import" }, "later")).ok,
    true,
  );
  assert.deepEqual(h.holds.slice(2), [["proj-a", false]]);
  // A session created on proj-c by another workspace releases proj-c.
  const d = await h.addWorkspace(true, "proj-c");
  assert.deepEqual(h.holds.slice(3), []);
  assert.ok(d.nativeId);
});

test("session.create on a held project releases it", async (t) => {
  const h = await holdFixture(t);
  const a = await h.addWorkspace(true, "proj-a");
  const b = await h.addWorkspace(false);
  assert.equal((await h.remove(a.workspaceId)).ok, true);
  assert.deepEqual(h.holds, [["proj-a", true]]);
  const orig = h.f.state.hooks.create;
  h.f.state.hooks.create = (input) => {
    const info = {
      ...input,
      projectID: "proj-a",
      permissions: BASELINE_POLICY,
    };
    h.f.records.set(info.id, info);
    return info;
  };
  void orig;
  const created = await h.f.mutate(
    { type: "session.create", workspaceId: b.workspaceId },
    "cr-held",
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(h.holds.slice(1), [["proj-a", false]]);
});

test("global is never held and a failed lookup for another workspace's session holds nothing", async (t) => {
  const h = await holdFixture(t);
  const a = await h.addWorkspace(true, "global");
  assert.equal((await h.remove(a.workspaceId)).ok, true);
  assert.deepEqual(h.holds, []);
  const b = await h.addWorkspace(true, "proj-b");
  const other = await h.addWorkspace(true, "proj-x");
  const get = h.f.state.hooks.get;
  h.f.state.hooks.get = ({ sessionID }) => {
    if (sessionID === other.nativeId) throw new Error("transient");
    const record = h.f.records.get(sessionID);
    return { ...record };
  };
  void get;
  assert.equal((await h.remove(b.workspaceId)).ok, true);
  assert.deepEqual(h.holds, []);
});

test("a partially failing multi-project hold rolls back and keeps the workspace", async (t) => {
  const h = await holdFixture(t);
  const a = await h.addWorkspace(true, "proj-a");
  const second = await h.f.mutate(
    { type: "session.create", workspaceId: a.workspaceId },
    "cr-second",
  );
  assert.equal(second.ok, true, JSON.stringify(second));
  h.f.records.get([...h.f.records.keys()].at(-1)).projectID = "proj-b";
  h.refuse("proj-b");
  const removed = await h.remove(a.workspaceId);
  assert.equal(removed.code, "UNAVAILABLE", JSON.stringify(removed));
  assert.deepEqual(h.holds, [
    ["proj-a", true],
    ["proj-b", true],
    ["proj-a", false],
  ]);
  assert.ok(
    (await h.f.snapshot()).workspaces.some((w) => w.id === a.workspaceId),
  );
});

// Backlog #13 review: a mismatching readback is retried, and still fails closed.
for (const [name, mismatches, ok] of [
  ["persistent", 99, false],
  ["transient", 1, true],
])
  test(`session.create bootstrap readback: ${name} permission mismatch ${ok ? "settles" : "fails closed"}`, async (t) => {
    const { f } = await bootstrapped(t);
    const snapshot = await f.ready();
    let present = 0;
    let left = mismatches;
    f.state.hooks.get = ({ sessionID }) => {
      const record = f.records.get(sessionID);
      if (!record)
        throw Object.assign(new Error("absent"), {
          _tag: "SessionNotFoundError",
          sessionID,
        });
      if (present++ >= 1 && left-- > 0) return { ...record, permissions: [] };
      return { ...record };
    };
    const response = await f.mutate(
      createOperation(snapshot),
      `create-mismatch-${name}`,
    );
    if (ok) assert.equal(response.ok, true, JSON.stringify(response));
    else assert.equal(response.code, "POLICY_UNVERIFIED");
  });

test("arm refusal revokes, proves no effect and never reaches Native", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  child.knobs.refuseArm = true;
  child.events.length = 0;
  f.state.calls.length = 0;
  const response = await f.mutate(createOperation(snapshot), "create-no-arm");
  // Dispatch was durably flushed first, so the receipt stays unknown.
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.receipt.effect, "unknown");
  assert.deepEqual(child.events, ["prepare", "arm"]);
  assert.equal(f.state.calls.includes("create"), false);
  assert.deepEqual(
    trail(await journalPayloads(f), "create-no-arm").filter(
      (label) =>
        label.startsWith("task") ||
        label.includes("handoff") ||
        label.startsWith("proof") ||
        label.startsWith("settle"),
    ),
    [
      "task.prepare",
      "task.observe",
      "handoff:armed",
      "handoff:revoked",
      "proof:no_effect",
      "settle:no_effect",
    ],
  );
  const task = f.registry
    .readView()
    .tasks.find((row) => row.identity.origin.operationId === "create-no-arm");
  assert.equal(task.phase, "settled");
  // The original operation key is never re-issued, even by the same id.
  child.events.length = 0;
  const again = await f.mutate(createOperation(snapshot), "create-no-arm");
  assert.deepEqual(child.events, []);
  assert.equal(f.state.calls.includes("create"), false);
  assert.equal(again.receipt.effect, "unknown");
});

test("a Native failure after the handoff was consumed holds the task unsettled and never retries", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  f.state.hooks.create = (input) => {
    child.consume("native.create", input);
    throw new Error("synthetic lost acknowledgement");
  };
  child.events.length = 0;
  f.state.calls.length = 0;
  const response = await f.mutate(createOperation(snapshot), "create-lost");
  assert.equal(response.receipt.effect, "unknown", JSON.stringify(response));
  assert.equal(f.state.calls.filter((name) => name === "create").length, 1);
  // Nothing after the Native call was written: no revoke, consumed, completed,
  // binding, proof or settle record, and the effect was dispatched exactly once.
  assert.deepEqual(trail(await journalPayloads(f), "create-lost"), [
    "admission",
    "reservation",
    "dispatch:native.create",
    "task.prepare",
    "task.observe",
    "handoff:armed",
    "completion",
  ]);
  assert.deepEqual(child.events, ["prepare", "arm", "consume:native.create"]);
  const task = f.registry
    .readView()
    .tasks.find((row) => row.identity.origin.operationId === "create-lost");
  assert.equal(task.phase, "bound");
  assert.equal(task.proof, null);
  const view = await f.snapshot();
  assert.equal(
    view.retainedOperations.find((row) => row.operationId === "create-lost")
      .authorityHold,
    true,
  );
  // A restart (new runtime epoch, no live task authority) keeps it held: the
  // unknown outcome stays unknown and nothing is replayed.
  await f.registry.checkpoint();
  const reopened = await reopenForks(t, f);
  assert.equal(
    reopened.snapshot.recovery.store.reason,
    "native_startup_unverified",
  );
  assert.equal(
    reopened.registry
      .readView()
      .tasks.find((row) => row.identity.origin.operationId === "create-lost")
      .authorityHold,
    true,
  );
  assert.deepEqual(
    reopened.calls.filter((name) =>
      ["create", "fork", "update"].includes(name),
    ),
    [],
  );
});

test("fork of a non-ask parent is refused cleanly before any task preparation or Native effect", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  const mode = await f.mutate(
    {
      type: "permission.mode.set",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      mode: "scoped_edit",
      requestId: "mode-scoped",
    },
    "mode-scoped",
  );
  assert.equal(mode.ok, true, JSON.stringify(mode));
  const parent = [...f.records.values()][0];
  assert.deepEqual(parent.permissions, compileModeRules("scoped_edit"));
  child.events.length = 0;
  f.state.calls.length = 0;
  const response = await f.mutate(
    {
      type: "session.fork",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      requestId: "fork-scoped",
    },
    "fork-scoped",
  );
  assert.equal(response.code, "POLICY_UNVERIFIED", JSON.stringify(response));
  assert.equal(response.receipt.effect, "none");
  assert.deepEqual(child.events, []);
  assert.equal(f.state.calls.includes("fork"), false);
  assert.equal(f.state.calls.includes("update"), false);
  const labels = trail(await journalPayloads(f), "fork-scoped");
  assert.equal(labels.includes("dispatch:native.fork"), false);
  assert.equal(
    f.registry
      .readView()
      .tasks.some((row) => row.identity.origin.operationId === "fork-scoped"),
    false,
  );
  assert.deepEqual((await f.snapshot()).retainedOperations, []);
});

test("a parent with stored permission control is refused before any task preparation", async (t) => {
  const { f, child } = await bootstrapped(t);
  const snapshot = await f.ready();
  f.service.close();
  await f.service.drain();
  const projected = new Proxy(f.registry, {
    get(target, key) {
      if (key === "readView")
        return () => {
          const view = target.readView();
          view.sessions = view.sessions.map((row) => ({
            ...row,
            permissionControl: {
              version: 1,
              mode: "read_plan",
              modeGeneration: 3,
              settings: [],
              floorDigest: "a".repeat(64),
              compilerVersion: 1,
              policyDigest: "b".repeat(64),
            },
          }));
          return view;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const reopened = createWorkbenchService({
    registry: projected,
    runtimeReady: Promise.resolve(f.runtime),
    runtimeEpoch: "epoch",
    confirmTrust: async () => true,
  });
  t.after(async () => {
    reopened.close();
    await reopened.drain();
  });
  const mutate = (operation, operationId) =>
    reopened.handle(
      { version: 2, runtimeEpoch: "epoch", operationId, operation },
      "mode-sender",
    );
  await until(async () => {
    const result = await reopened.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: "pc-snapshot",
        operation: { type: "snapshot" },
      },
      "mode-sender",
    );
    return result.ok && result.value.state === "connected";
  });
  child.events.length = 0;
  f.state.calls.length = 0;
  const fork = await mutate(
    {
      type: "session.fork",
      workspaceId: snapshot.selectedWorkspaceId,
      sessionId: snapshot.selectedSessionId,
      requestId: "fork-pc",
    },
    "fork-pc",
  );
  assert.equal(fork.code, "POLICY_UNVERIFIED", JSON.stringify(fork));
  assert.deepEqual(child.events, []);
  assert.equal(f.state.calls.includes("fork"), false);
  assert.equal(f.state.calls.includes("create"), false);
});

for (const step of [1, 2, 3, 4, 5, 6, 7, 8])
  test(`storage loss at bootstrap journal step ${step} never replays and keeps the outcome held`, async (t) => {
    const child = fakeBootstrapChild();
    let writes = 0;
    let recording = false;
    const f = await fixture(t, {
      taskChild: child,
      projectRegistry: (registry) =>
        new Proxy(registry, {
          get(target, key) {
            if (key === "recordTask" && recording)
              return async (record) => {
                if (record.operationId === "create-crash" && ++writes >= step)
                  throw new Error("synthetic storage loss");
                return target.recordTask(record);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
    });
    const snapshot = await f.ready();
    recording = true;
    f.state.calls.length = 0;
    child.events.length = 0;
    const response = await f.mutate(createOperation(snapshot), "create-crash");
    // Steps 1-3 precede the arm: Native is never called. From step 4 on it was
    // called exactly once and the outcome stays unknown.
    assert.equal(
      f.state.calls.filter((name) => name === "create").length,
      step <= 3 ? 0 : 1,
      JSON.stringify(response),
    );
    assert.equal(response.receipt.effect, "unknown");
    assert.equal(
      child.events.filter((event) => event.startsWith("consume")).length,
      step <= 3 ? 0 : 1,
    );
    const labels = trail(await journalPayloads(f), "create-crash");
    assert.equal(
      labels.filter((label) => label === "dispatch:native.create").length,
      1,
    );
    assert.equal(labels.includes("settle:settled"), false);
    const task = f.registry
      .readView()
      .tasks.find((row) => row.identity.origin.operationId === "create-crash");
    if (step > 1) assert.notEqual(task?.phase, "settled");
    // Crash: reopen from the journal. Nothing is replayed or re-dispatched.
    const callsBefore = f.state.calls.length;
    await f.registry.checkpoint();
    const reopened = await reopenForks(t, f);
    assert.equal(
      reopened.snapshot.recovery.store.reason,
      "native_startup_unverified",
    );
    assert.deepEqual(
      reopened.calls.filter((name) =>
        ["create", "fork", "update"].includes(name),
      ),
      [],
    );
    assert.equal(f.state.calls.length, callsBefore + reopened.calls.length);
    assert.equal(
      reopened.registry
        .readView()
        .retainedOperations.some((row) => row.operationId === "create-crash"),
      true,
    );
  });

for (const refused of ["task.prepare", "task.observe", "task.handoff"])
  test(`a failing ${refused} verification keeps Native unreachable and the task unproven`, async (t) => {
    const child = fakeBootstrapChild();
    const base = child.ledger.verify;
    let deny = false;
    child.verify = (record, context) =>
      deny && record.kind === refused ? false : base(record, context);
    const f = await fixture(t, { taskChild: child });
    const snapshot = await f.ready();
    deny = true;
    f.state.calls.length = 0;
    child.events.length = 0;
    const response = await f.mutate(createOperation(snapshot), "create-forged");
    assert.equal(f.state.calls.includes("create"), false);
    assert.equal(response.receipt.effect, "unknown");
    const labels = trail(await journalPayloads(f), "create-forged");
    assert.equal(labels.includes("handoff:consumed"), false);
    assert.equal(labels.includes("proof:settled"), false);
    assert.equal(labels.includes("settle:settled"), false);
    assert.equal(
      child.events.some((event) => event.startsWith("consume")),
      false,
    );
  });

test("the registry refuses a second task.prepare for the same original operation and a forged identity", async (t) => {
  const { f } = await bootstrapped(t);
  const snapshot = await f.ready();
  const response = await f.mutate(createOperation(snapshot), "create-once");
  assert.equal(response.ok, true, JSON.stringify(response));
  const [task] = f.registry
    .readView()
    .tasks.filter((row) => row.identity.origin.operationId === "create-once");
  const record = {
    kind: "task.prepare",
    runtimeEpoch: "epoch",
    operationId: "create-once",
    taskScopeId: task.identity.taskScopeId,
    identity: (({ appSessionId: _a, nativeSessionId: _n, ...rest }) => rest)(
      task.identity,
    ),
    binding: task.binding,
  };
  assert.equal((await f.registry.recordTask(record)).status, "duplicate");
  const forged = {
    ...record,
    taskScopeId: randomUUID(),
    identity: { ...record.identity, taskScopeId: randomUUID() },
  };
  await assert.rejects(async () => f.registry.recordTask(forged));
  // No live correlation exists after settle: nothing else can be appended.
  await assert.rejects(async () =>
    f.registry.recordTask({
      kind: "task.observe",
      runtimeEpoch: "epoch",
      operationId: "create-once",
      taskScopeId: task.identity.taskScopeId,
      phase: "bound",
      launchId: "launch-2",
    }),
  );
});

// ---- Startup crash reconciliation of unsettled bootstrap creates ----------
// Journal writes of one bootstrap create, in order: 1 task.prepare, 2 observe,
// 3 handoff armed, 4 handoff consumed, 5 handoff completed, 6 binding, 7 proof,
// 8 settle. A storage loss BEFORE write N leaves exactly writes 1..N-1 durable.
// The crashed process is then replaced by a registry reopened from the journal
// with a fresh live ledger; only that ledger's own read-only session.get may
// ever resolve the task, and nothing is created, forked, updated or armed.
const crashedFixture = async (
  t,
  step,
  { fromStart = false, operation = createOperation } = {},
) => {
  const child = fakeBootstrapChild();
  let writes = 0;
  let recording = fromStart;
  const f = await fixture(t, {
    taskChild: child,
    projectRegistry: (registry) =>
      new Proxy(registry, {
        get(target, key) {
          if (key === "recordTask" && recording)
            return async (record) => {
              if (
                (fromStart || record.operationId === "create-crash") &&
                ++writes >= step
              )
                throw new Error("synthetic storage loss");
              return target.recordTask(record);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  });
  let snapshot;
  if (fromStart) {
    // The crashed default bootstrap never reaches "connected": wait for it to
    // leave its operation retained, then let the failure path finish.
    await until(() => f.registry.readView().retainedOperations.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    snapshot = await f.snapshot();
  } else snapshot = await f.ready();
  if (!fromStart) {
    recording = true;
    await f.mutate(operation(snapshot), "create-crash");
  }
  await f.registry.checkpoint();
  return { f, snapshot, child };
};
const nativeMutations = (f) =>
  f.state.calls.filter((name) =>
    ["create", "fork", "update", "prompt", "interrupt"].includes(name),
  );
const notFound = (sessionID) =>
  Object.assign(new Error("absent"), {
    _tag: "SessionNotFoundError",
    sessionID,
  });
async function openReconciling(t, f, { read, wrap } = {}) {
  const reads = [];
  const ledger = createNativeTaskLedger({
    runtimeEpoch: "new",
    isLive: () => true,
    channel: {},
    onUnconfirmed() {},
    readSession: async (sessionID) => {
      reads.push(sessionID);
      if (read) return read(sessionID);
      const info = f.records.get(sessionID);
      if (!info) throw notFound(sessionID);
      return globalThis.structuredClone(info);
    },
    listSessions: async () =>
      globalThis.structuredClone([...f.records.values()]),
  });
  const opened = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
    taskAuthoritySource: ledger.verify,
  });
  t.after(() => opened.close());
  const registry = wrap ? wrap(opened) : opened;
  return {
    registry,
    ledger,
    reads,
    run: () =>
      reconcileBootstrapTasks({
        registry,
        nativeTasks: { reconcile: ledger.reconcile },
      }),
  };
}
const journalBytes = (f) => fs.readFile(join(f.directory, "journal.jsonl"));
const planned = (rig, operationId = "create-crash") =>
  rig.registry
    .reconcilePlan()
    .candidates.find((c) => c.operation.identity.operationId === operationId)
    ?.operation.reservation.plannedNativeSessionId;
async function assertReplays(t, f, expected) {
  // Strict journal replay of the reconciliation record derives the same state.
  const third = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "third",
  });
  t.after(() => third.close());
  const view = third.readView();
  assert.deepEqual(view.retainedOperations, expected.retained ?? []);
  assert.equal(view.sessions.length, expected.sessions);
  assert.equal(third.reconcilePlan().candidates.length, 0);
  return view;
}

for (const step of [4, 5, 6, 7, 8])
  test(`reconcile: a create whose Native session exists is bound and settled (crash before journal write ${step})`, async (t) => {
    const { f, snapshot } = await crashedFixture(t, step);
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    const id = planned(rig);
    assert.ok(id, "unsettled create is an eligible candidate");
    assert.equal(rig.registry.reconcilePlan().eligible, true);
    await rig.run();
    // Only the planned id was read; no Native effect was issued.
    assert.deepEqual(rig.reads, [id]);
    assert.deepEqual(nativeMutations(f), before);
    const view = rig.registry.readView();
    assert.deepEqual(view.retainedOperations, []);
    const task = view.tasks.find(
      (row) => row.identity.origin.operationId === "create-crash",
    );
    assert.equal(task.phase, "settled");
    assert.equal(task.identity.nativeSessionId, id);
    const receipt = rig.registry.lookup({
      runtimeEpoch: "epoch",
      operationId: "create-crash",
    }).receipt;
    assert.equal(receipt.effect, "confirmed");
    assert.equal(receipt.result.kind, "created");
    assert.equal(receipt.result.nativeSessionId, id);
    const mapped = view.sessions.find((row) => row.nativeSessionId === id);
    assert.equal(mapped.lifecycleState, "active");
    assert.equal(mapped.appSessionId, receipt.result.sessionId);
    await assertReplays(t, f, { sessions: snapshot.sessions.length + 1 });
    // The restarted workbench adopts the session and never re-issues create.
    const reopened = await reopenForks(t, f);
    assert.equal(reopened.snapshot.state, "connected");
    assert.equal(
      reopened.snapshot.sessions.length,
      snapshot.sessions.length + 1,
    );
    assert.deepEqual(nativeMutations(f), before);
    // A second launch has nothing left to reconcile.
    assert.deepEqual(rig.registry.reconcilePlan(), {
      eligible: true,
      candidates: [],
    });
  });

for (const step of [2, 3])
  test(`reconcile: a create whose session id is absent proves no effect and resolves (crash before journal write ${step})`, async (t) => {
    const { f, snapshot } = await crashedFixture(t, step);
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    const id = planned(rig);
    await rig.run();
    assert.deepEqual(rig.reads, [id]);
    assert.deepEqual(nativeMutations(f), before);
    const view = rig.registry.readView();
    assert.deepEqual(view.retainedOperations, []);
    const task = view.tasks.find(
      (row) => row.identity.origin.operationId === "create-crash",
    );
    assert.equal(task.phase, "settled");
    assert.equal(task.proof.outcome, "no_effect");
    assert.equal(task.proof.kind, "task_reconciled");
    assert.equal(
      task.handoffs.every((handoff) => handoff.state === "revoked"),
      true,
    );
    const receipt = rig.registry.lookup({
      runtimeEpoch: "epoch",
      operationId: "create-crash",
    }).receipt;
    assert.equal(receipt.effect, "none");
    assert.equal(receipt.admission, "rejected");
    assert.equal(view.sessions.length, snapshot.sessions.length);
    await assertReplays(t, f, { sessions: snapshot.sessions.length });
    // The original key stays burned: the same id can never be issued again.
    assert.equal(rig.registry.reconcilePlan().candidates.length, 0);
  });

test("reconcile: a crash before any task record leaves a non-recognised trail held", async (t) => {
  const { f } = await crashedFixture(t, 1);
  const rig = await openReconciling(t, f);
  assert.equal(rig.registry.reconcilePlan().eligible, false);
  const before = await journalBytes(f);
  await assert.rejects(rig.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(rig.reads, []);
  assert.deepEqual(await journalBytes(f), before);
});

const tampered = {
  "metadata digest drift": (info) => {
    info.metadata = { ...info.metadata, digest: "f".repeat(64) };
  },
  "extra metadata": (info) => {
    info.metadata = { ...info.metadata, extra: "x" };
  },
  "wrong permissions": (info) => {
    info.permissions = [{ action: "*", resource: "*", effect: "allow" }];
  },
  "floor not last": (info) => {
    info.permissions = [...info.permissions].reverse();
  },
  "extra permission rule": (info) => {
    info.permissions = [
      ...info.permissions,
      { action: "subagent", resource: "*", effect: "deny" },
    ];
  },
  "other directory": (info) => {
    info.location = { directory: "/somewhere/else" };
  },
  "other project": (info) => {
    info.projectID = "other-project";
  },
  "has a parent": (info) => {
    info.parentID = "ses_parent";
  },
  "is a fork": (info) => {
    info.fork = { sessionID: "ses_parent", boundary: { type: "before" } };
  },
};
for (const [name, mutate] of Object.entries(tampered))
  test(`reconcile: a Native session with ${name} is never adopted and stays held`, async (t) => {
    const { f } = await crashedFixture(t, 4);
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f, {
      read: (id) => {
        const info = globalThis.structuredClone(f.records.get(id));
        mutate(info);
        return info;
      },
    });
    const journal = await journalBytes(f);
    await assert.rejects(rig.run(), {
      storageReason: "native_startup_unverified",
    });
    assert.equal(rig.reads.length, 1);
    assert.deepEqual(await journalBytes(f), journal);
    assert.deepEqual(nativeMutations(f), before);
    assert.equal(
      rig.registry
        .readView()
        .retainedOperations.some((row) => row.operationId === "create-crash"),
      true,
    );
  });

test("reconcile: any read error other than the typed not-found holds without writing", async (t) => {
  for (const failure of [
    new Error("network down"),
    Object.assign(new Error("other"), {
      _tag: "SessionNotFoundError",
      sessionID: "ses_other",
    }),
    Object.assign(new Error("denied"), { status: 401 }),
  ]) {
    const { f } = await crashedFixture(t, 3);
    const rig = await openReconciling(t, f, {
      read: () => {
        throw failure;
      },
    });
    const journal = await journalBytes(f);
    await assert.rejects(rig.run(), {
      storageReason: "native_startup_unverified",
    });
    assert.equal(rig.reads.length, 1);
    assert.deepEqual(await journalBytes(f), journal);
  }
});

test("reconcile: absence contradicts a consumed handoff and a session contradicts a never-armed trail", async (t) => {
  // handoff consumed (write 5 lost) but the session is gone: contradiction.
  const consumed = await crashedFixture(t, 5);
  const gone = await openReconciling(t, consumed.f, {
    read: (id) => {
      throw notFound(id);
    },
  });
  const journal = await journalBytes(consumed.f);
  await assert.rejects(gone.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(await journalBytes(consumed.f), journal);
  // never armed (write 3 lost) yet a session answers for the planned id.
  const unarmed = await crashedFixture(t, 3);
  const stray = await openReconciling(t, unarmed.f, {
    read: (id) => ({
      id,
      projectID: "project",
      location: { directory: unarmed.snapshot.workspaces[0].path },
      metadata: {},
      permissions: BASELINE_POLICY,
    }),
  });
  const unarmedJournal = await journalBytes(unarmed.f);
  await assert.rejects(stray.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(await journalBytes(unarmed.f), unarmedJournal);
});

test("reconcile: any non-bootstrap retained operation holds everything without reading Native", async (t) => {
  const { f } = await crashedFixture(t, 4);
  // Leave one unrelated operation retained (admitted, dispatched, unresolved).
  await f.registry.begin({
    runtimeEpoch: "epoch",
    operationId: "stuck-op",
    type: "workspace.import",
    digest: "e".repeat(64),
  });
  await f.registry.checkpoint();
  const rig = await openReconciling(t, f);
  assert.equal(rig.registry.reconcilePlan().eligible, false);
  const journal = await journalBytes(f);
  await assert.rejects(rig.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(rig.reads, []);
  assert.deepEqual(await journalBytes(f), journal);
  assert.equal(
    rig.registry
      .readView()
      .retainedOperations.some((row) => row.operationId === "create-crash"),
    true,
  );
});

test("reconcile: a crash during reconciliation is idempotent and never re-issues create", async (t) => {
  const { f, snapshot } = await crashedFixture(t, 4);
  const before = nativeMutations(f);
  let failures = 0;
  const first = await openReconciling(t, f, {
    wrap: (registry) =>
      new Proxy(registry, {
        get(target, key) {
          if (key === "recordTask")
            return async () => {
              failures++;
              throw new Error("synthetic storage loss");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  });
  const journal = await journalBytes(f);
  await assert.rejects(first.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.equal(failures, 1);
  assert.deepEqual(await journalBytes(f), journal);
  // The next launch repeats only the read and completes the same single record.
  const second = await openReconciling(t, f);
  await second.run();
  assert.equal(second.reads.length, 1);
  assert.deepEqual(nativeMutations(f), before);
  await assertReplays(t, f, { sessions: snapshot.sessions.length + 1 });
  // A third launch sees nothing to do.
  const third = await openReconciling(t, f);
  assert.deepEqual(third.registry.reconcilePlan(), {
    eligible: true,
    candidates: [],
  });
  await assert.rejects(third.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(third.reads, []);
});

test("reconcile: task_reconciled cannot be forged without, or against, the live ledger's own read", async (t) => {
  const { f } = await crashedFixture(t, 4);
  const rig = await openReconciling(t, f);
  const [candidate] = rig.registry.reconcilePlan().candidates;
  const taskScopeId = candidate.task.identity.taskScopeId;
  const bootstrap = {
    appSessionId: candidate.operation.reservation.appSessionId,
    nativeSessionId: candidate.operation.reservation.plannedNativeSessionId,
    metadataDigest: "a".repeat(64),
    title: "Forged",
  };
  const forged = (over = {}) => ({
    kind: "task_reconciled",
    runtimeEpoch: "epoch",
    operationId: "create-crash",
    taskScopeId,
    ticketDigest: "b".repeat(64),
    proofDigest: "c".repeat(64),
    outcome: "settled",
    bootstrap,
    ...over,
  });
  const journal = await journalBytes(f);
  // No live read at all.
  await assert.rejects(rig.registry.recordTask(forged()), {
    code: "task_authority_required",
  });
  // A real read, then a record that claims something else than the read proved.
  const decision = await rig.ledger.reconcile({
    operation: candidate.operation,
    task: candidate.task,
    state: candidate.state,
  });
  assert.equal(decision.outcome, "settled");
  const honest = forged({
    ticketDigest: decision.ticketDigest,
    proofDigest: decision.proofDigest,
    bootstrap: decision.bootstrap,
  });
  for (const over of [
    { ticketDigest: "d".repeat(64) },
    { proofDigest: "d".repeat(64) },
    { outcome: "no_effect", bootstrap: {} },
    { bootstrap: { ...decision.bootstrap, title: "Other" } },
    { bootstrap: { ...decision.bootstrap, metadataDigest: "e".repeat(64) } },
    { taskScopeId: randomUUID() },
  ])
    await assert.rejects(rig.registry.recordTask({ ...honest, ...over }));
  assert.deepEqual(await journalBytes(f), journal);
  // The exact record the ledger decided is accepted.
  const result = await rig.registry.recordTask(honest);
  assert.equal(result.status, "recorded");
  assert.deepEqual(rig.registry.readView().retainedOperations, []);
});

for (const step of [5, 7, 8])
  test(`reconcile: a crashed default-workspace bootstrap with a created session registers the workspace and session (crash before journal write ${step})`, async (t) => {
    const { f } = await crashedFixture(t, step, { fromStart: true });
    assert.equal(
      f.registry
        .readView()
        .retainedOperations.every((row) => row.type === "workspace.create"),
      true,
    );
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    const [candidate] = rig.registry.reconcilePlan().candidates;
    assert.equal(candidate.operation.identity.type, "workspace.create");
    await rig.run();
    const view = rig.registry.readView();
    assert.deepEqual(view.retainedOperations, []);
    assert.equal(view.workspaces.length, 1);
    assert.equal(view.workspaces[0].registrationState, "registered");
    assert.equal(view.sessions.length, 1);
    assert.equal(view.sessions[0].lifecycleState, "active");
    await assertReplays(t, f, { sessions: 1 });
    const reopened = await reopenForks(t, f);
    assert.equal(reopened.snapshot.state, "connected");
    assert.equal(reopened.snapshot.sessions.length, 1);
    // The restart did not bootstrap a second default workspace or session.
    assert.deepEqual(nativeMutations(f), before);
    assert.equal(reopened.snapshot.workspaces.length, 1);
  });

test("abandoned-create repair leaves a bootstrap create with a native/task trail to the reconciler", async (t) => {
  const { f } = await crashedFixture(t, 5, { fromStart: true });
  const rig = await openReconciling(t, f);
  const bytes = await journalBytes(f);
  const plan = rig.registry.reconcilePlan();
  assert.equal(plan.candidates.length, 1);
  await rig.registry.resolveAbandonedManagedCreates();
  assert.deepEqual(await journalBytes(f), bytes);
  assert.deepEqual(rig.registry.reconcilePlan(), plan);
  assert.equal(rig.registry.readView().retainedOperations.length, 1);
});

test("held default bootstrap (folder only, no native work) is resolved by the startup repair", async (t) => {
  const { f } = await bootstrapped(t, { held: true });
  await f.ready();
  await f.registry.checkpoint();
  assert.equal(f.registry.readView().retainedOperations.length, 1);
  const reopen = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  t.after(() => reopen.close());
  assert.equal(reopen.crashRecoveryPlan().state, "hold");
  await reopen.resolveAbandonedManagedCreates();
  assert.equal(reopen.crashRecoveryPlan().state, "none");
  assert.deepEqual(reopen.readView().retainedOperations, []);
  assert.equal(reopen.readView().sessions.length, 0);
  assert.equal(reopen.readView().workspaces[0].registrationState, "registered");
});

for (const step of [2, 3])
  test(`reconcile: a proven-absent default-workspace bootstrap registers the empty workspace and the app stays usable (crash before journal write ${step})`, async (t) => {
    const { f, child } = await crashedFixture(t, step, { fromStart: true });
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    const [candidate] = rig.registry.reconcilePlan().candidates;
    assert.equal(candidate.operation.identity.type, "workspace.create");
    await rig.run();
    assert.equal(rig.reads.length, 1);
    const view = rig.registry.readView();
    // The operation and its task resolve together: nothing settled-yet-retained.
    assert.deepEqual(view.retainedOperations, []);
    const [task] = view.tasks;
    assert.equal(task.phase, "settled");
    assert.equal(task.proof.outcome, "no_effect");
    assert.equal(view.workspaces.length, 1);
    assert.equal(view.workspaces[0].registrationState, "registered");
    assert.equal(view.sessions.length, 0);
    const receipt = rig.registry.lookup({
      runtimeEpoch: "epoch",
      operationId: candidate.operation.identity.operationId,
    }).receipt;
    assert.equal(receipt.effect, "confirmed");
    assert.equal(receipt.result.kind, "created");
    assert.equal(receipt.result.sessionId, undefined);
    assert.equal(receipt.result.nativeSessionId, undefined);
    await assertReplays(t, f, { sessions: 0 });
    // Restart: no second default workspace, no Native effect, and the first
    // session bootstraps fresh on use inside the registered managed folder.
    const reopened = await reopenForks(t, f, undefined, {
      confirmTrust: async () => true,
    });
    assert.equal(reopened.snapshot.state, "connected");
    assert.equal(reopened.snapshot.workspaces.length, 1);
    assert.equal(reopened.snapshot.sessions.length, 0);
    assert.deepEqual(nativeMutations(f), before);
    // First use under the new launch's own live task authority.
    const next = fakeBootstrapChild({ epoch: "new" });
    child.consume = next.consume;
    child.verify = next.ledger.verify;
    f.context.nativeTasks = next.tasks;
    const created = await reopened.service.handle(
      {
        version: 2,
        runtimeEpoch: "new",
        operationId: "first-use",
        operation: {
          type: "session.create",
          workspaceId: reopened.snapshot.workspaces[0].id,
          title: "First",
        },
      },
      "sender",
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    // A second launch has nothing left to reconcile (idempotent).
    assert.deepEqual(rig.registry.reconcilePlan(), {
      eligible: true,
      candidates: [],
    });
    await reopened.registry.checkpoint();
    await assertReplays(t, f, { sessions: 1 });
  });

test("reconcile: a proven-absent workspace.import (crash before arm) registers the imported workspace and is idempotent", async (t) => {
  const child = fakeBootstrapChild();
  const f = await fixture(t, { taskChild: child, bootstrap: false });
  const directory = join(f.root, "imported");
  await fs.mkdir(directory);
  const canonicalPath = await fs.realpath(directory);
  const key = { runtimeEpoch: "epoch", operationId: "import-crash" };
  const digest = "c".repeat(64);
  await f.registry.begin({ ...key, type: "workspace.import", digest });
  const reserved = await f.registry.reserve({
    ...key,
    ownership: "imported",
    canonicalPath,
    plannedNativeSessionId: "ses_import",
  });
  await f.registry.dispatch({ ...key, step: "native.create" });
  const metadata = {
    operationId: key.operationId,
    originalRuntimeEpoch: key.runtimeEpoch,
    appSessionId: reserved.appSessionId,
    workspaceId: reserved.workspace.workspaceId,
    digest,
  };
  const request = {
    originKind: "bootstrap",
    origin: { ...key, type: "workspace.import", digest },
    workspaceId: reserved.workspace.workspaceId,
    workspacePath: canonicalPath,
    appSessionId: reserved.appSessionId,
    metadataDigest: bootstrapMetadataDigest(metadata),
    reservation: {
      kind: "bootstrap",
      step: "native.create",
      reservationDigest: f.registry.reservationDigest(key),
      parentIdentityDigest: null,
    },
    plannedNativeSessionId: "ses_import",
  };
  const prepared = await child.ledger.prepare(request, {
    handoffId: randomUUID(),
    stageArgumentDigest: bootstrapStageDigest("native.create", {
      id: "ses_import",
      metadata,
      title: "Workbench",
      location: { directory: canonicalPath },
      permissions: BASELINE_POLICY,
    }),
  });
  assert.equal(prepared.status, "prepared");
  await f.registry.recordTask({
    kind: "task.prepare",
    ...key,
    taskScopeId: prepared.taskScopeId,
    identity: {
      taskScopeId: prepared.taskScopeId,
      origin: request.origin,
      workspaceId: request.workspaceId,
      projectId: prepared.projectId,
      locationId: prepared.locationId,
      modeGeneration: prepared.modeGeneration,
      inventoryGeneration: prepared.inventoryGeneration,
      originKind: "bootstrap",
    },
    binding: request.reservation,
  });
  await f.registry.checkpoint();
  const before = nativeMutations(f);
  const rig = await openReconciling(t, f);
  assert.equal(rig.registry.reconcilePlan().candidates.length, 1);
  await rig.run();
  assert.deepEqual(rig.reads, ["ses_import"]);
  const view = rig.registry.readView();
  assert.deepEqual(view.retainedOperations, []);
  assert.equal(view.workspaces.length, 1);
  assert.equal(view.workspaces[0].registrationState, "registered");
  assert.equal(view.workspaces[0].ownership, "imported");
  assert.equal(view.tasks[0].phase, "settled");
  const receipt = rig.registry.lookup(key).receipt;
  assert.equal(receipt.effect, "confirmed");
  assert.equal(receipt.result.kind, "created");
  await assertReplays(t, f, { sessions: 0 });
  const reopened = await reopenForks(t, f);
  assert.equal(reopened.snapshot.state, "connected");
  assert.equal(reopened.snapshot.workspaces.length, 1);
  assert.deepEqual(nativeMutations(f), before);
  // A second launch finds nothing to reconcile.
  const again = await openReconciling(t, f);
  assert.deepEqual(again.registry.reconcilePlan(), {
    eligible: true,
    candidates: [],
  });
  assert.deepEqual(again.reads, []);
});

const forkOperation = (snapshot) => ({
  type: "session.fork",
  workspaceId: snapshot.selectedWorkspaceId,
  sessionId: snapshot.selectedSessionId,
  requestId: "fork-crash",
});
const forkRecord = (f) =>
  [...f.records.values()].find((info) => info.fork !== undefined);
for (const step of [4, 5, 6, 7, 8])
  test(`reconcile: a fork whose child exists is found by its parent, bound and settled (crash before journal write ${step})`, async (t) => {
    const { f, snapshot } = await crashedFixture(t, step, {
      operation: forkOperation,
    });
    const child = forkRecord(f);
    assert.ok(child, "Native forked before the crash");
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    assert.equal(rig.registry.reconcilePlan().eligible, true);
    await rig.run();
    // Only reads: the parent, never a create/fork/update.
    assert.deepEqual(
      rig.reads,
      [snapshot.selectedSessionId].map(() => rig.reads[0]),
    );
    assert.equal(rig.reads.length, 1);
    assert.deepEqual(nativeMutations(f), before);
    const view = rig.registry.readView();
    assert.deepEqual(view.retainedOperations, []);
    const mapped = view.sessions.find(
      (row) => row.nativeSessionId === child.id,
    );
    assert.equal(mapped.lifecycleState, "active");
    assert.equal(mapped.parentSessionId, snapshot.selectedSessionId);
    const receipt = rig.registry.lookup({
      runtimeEpoch: "epoch",
      operationId: "create-crash",
    }).receipt;
    assert.equal(receipt.effect, "confirmed");
    assert.equal(receipt.result.kind, "forked");
    assert.equal(receipt.result.nativeSessionId, child.id);
    await assertReplays(t, f, { sessions: snapshot.sessions.length + 1 });
    const reopened = await reopenForks(t, f);
    assert.equal(reopened.snapshot.state, "connected");
    assert.equal(
      reopened.snapshot.sessions.length,
      snapshot.sessions.length + 1,
    );
    assert.deepEqual(nativeMutations(f), before);
    assert.deepEqual(rig.registry.reconcilePlan(), {
      eligible: true,
      candidates: [],
    });
  });

for (const step of [2, 3])
  test(`reconcile: a fork with no child proves no effect and resolves (crash before journal write ${step})`, async (t) => {
    const { f, snapshot } = await crashedFixture(t, step, {
      operation: forkOperation,
    });
    assert.equal(forkRecord(f), undefined);
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    await rig.run();
    assert.deepEqual(nativeMutations(f), before);
    const view = rig.registry.readView();
    assert.deepEqual(view.retainedOperations, []);
    assert.equal(view.tasks.at(-1).proof.outcome, "no_effect");
    const receipt = rig.registry.lookup({
      runtimeEpoch: "epoch",
      operationId: "create-crash",
    }).receipt;
    assert.equal(receipt.effect, "none");
    assert.equal(receipt.admission, "rejected");
    assert.equal(view.sessions.length, snapshot.sessions.length);
    await assertReplays(t, f, { sessions: snapshot.sessions.length });
    const reopened = await reopenForks(t, f);
    assert.equal(reopened.snapshot.state, "connected");
    assert.equal(reopened.snapshot.sessions.length, snapshot.sessions.length);
  });

// A registered parent's reconciled fork child is settled with its inheritance
// unverified (no Native instruction list at startup) and promoted, or made
// unavailable, by the first ordinary admitted read after admission.
async function pendingForkChild(t) {
  const child = fakeBootstrapChild();
  let recording = false;
  let writes = 0;
  const f = await instructionFixture(t, {
    taskChild: child,
    projectRegistry: (registry) =>
      new Proxy(registry, {
        get(target, key) {
          if (key === "recordTask" && recording)
            return async (record) => {
              if (record.operationId === "create-crash" && ++writes >= 4)
                throw new Error("synthetic storage loss");
              return target.recordTask(record);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  });
  assert.equal((await f.mutate(f.apply, "parent-apply")).ok, true);
  recording = true;
  await f.mutate(
    { type: "session.fork", ...f.scope, requestId: "fork-crash" },
    "create-crash",
  );
  await f.registry.checkpoint();
  const rig = await openReconciling(t, f);
  await rig.run();
  const nativeId = forkRecord(f).id;
  const row = rig.registry
    .readView()
    .sessions.find((r) => r.nativeSessionId === nativeId);
  assert.equal(row.lifecycleState, "active");
  assert.deepEqual(row.instructionRegistration, {
    ...f.registry
      .readView()
      .sessions.find((r) => r.appSessionId === f.scope.sessionId)
      .instructionRegistration,
    state: "pending_verification",
    origin: "fork",
    inheritedFromSessionId: f.scope.sessionId,
  });
  // The relaunched child: a fresh live ledger for the new epoch.
  const relaunched = createNativeTaskLedger({
    runtimeEpoch: "next",
    isLive: () => true,
    channel: child.channel,
    onUnconfirmed() {},
  });
  Object.assign(child.tasks, {
    prepare: relaunched.prepare,
    arm: relaunched.arm,
    revoke: relaunched.revoke,
    verify: relaunched.verify,
  });
  child.verify = relaunched.verify;
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "next",
  });
  const service = createWorkbenchService({
    registry,
    runtime: f.runtime,
    runtimeEpoch: "next",
    confirmTrust: async () => true,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
  });
  let n = 0;
  const call = (operation, read = true) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "next",
        [read ? "readId" : "operationId"]: `pending-${++n}`,
        operation,
      },
      "sender",
    );
  const calls = f.state.calls.length;
  await until(
    async () => (await call({ type: "snapshot" })).value?.state === "connected",
  );
  // Startup (admission) never lists a session's instructions.
  assert.ok(
    !f.state.calls.slice(calls).some((name) => name.startsWith("instruction")),
  );
  const trusted = await call(
    { type: "session.create", workspaceId: row.workspaceId },
    false,
  );
  assert.equal(trusted.ok, true, JSON.stringify(trusted));
  const reopened = { call, registry };
  return { f, rig, reopened, row, nativeId };
}
test("reconcile: a registered parent's fork child starts pending verification and is promoted by the first admitted read", async (t) => {
  const { f, reopened, row } = await pendingForkChild(t);
  const target = { workspaceId: row.workspaceId, sessionId: row.appSessionId };
  const seen = await reopened.call({
    type: "configuration.instructions.read",
    ...target,
  });
  assert.equal(seen.ok, true, JSON.stringify(seen));
  assert.equal(seen.value.status, "registered");
  assert.equal(seen.value.origin, "fork");
  assert.equal(seen.value.inheritedFromSessionId, f.scope.sessionId);
  // The promoted row is journaled by the next write that carries the session.
  const pinned = await reopened.call(
    { type: "session.pin", ...target, requestId: "pin", pinned: true },
    false,
  );
  assert.equal(pinned.ok, true, JSON.stringify(pinned));
  assert.equal(
    reopened.registry
      .readView()
      .sessions.find((x) => x.appSessionId === row.appSessionId)
      .instructionRegistration.state,
    "registered",
  );
});
test("reconcile: forking a pending fork child (promoted only in memory) completes", async (t) => {
  const { reopened, row } = await pendingForkChild(t);
  const target = { workspaceId: row.workspaceId, sessionId: row.appSessionId };
  const seen = await reopened.call({
    type: "configuration.instructions.read",
    ...target,
  });
  assert.equal(seen.value?.status, "registered", JSON.stringify(seen));
  const forked = await reopened.call(
    { type: "session.fork", ...target, requestId: "fork-pending" },
    false,
  );
  assert.equal(forked.ok, true, JSON.stringify(forked));
});
test("reconcile: a pending fork child whose entry drifted becomes unavailable", async (t) => {
  const { f, reopened, row, nativeId } = await pendingForkChild(t);
  f.instructionEntries.set(nativeId, [
    { key: INSTRUCTION_KEY, value: "drifted" },
  ]);
  const seen = await reopened.call({
    type: "configuration.instructions.read",
    workspaceId: row.workspaceId,
    sessionId: row.appSessionId,
  });
  assert.notEqual(seen.value?.status, "registered", JSON.stringify(seen));
  // The session stays unusable (and is never promoted) afterwards.
  const again = await reopened.call({
    type: "configuration.instructions.read",
    workspaceId: row.workspaceId,
    sessionId: row.appSessionId,
  });
  assert.equal(again.ok, false, JSON.stringify(again));
  // The durable row stays pending: never promoted without a match.
  assert.equal(
    f.registry
      .readView()
      .sessions.find((x) => x.appSessionId === row.appSessionId)
      ?.instructionRegistration?.state ?? "pending_verification",
    "pending_verification",
  );
});

const forkTampers = {
  "a consumed handoff but no child": (f) => f.records.delete(forkRecord(f).id),
  "two matching children": (f) => {
    const child = forkRecord(f);
    f.records.set("ses_twin", { ...child, id: "ses_twin" });
  },
  "a child with other metadata": (f) => {
    forkRecord(f).metadata = { operationId: "other" };
  },
  "a child with weaker permissions": (f) => {
    forkRecord(f).permissions = [
      { action: "*", resource: "*", effect: "allow" },
    ];
  },
  "a child whose floor is not last": (f) => {
    forkRecord(f).permissions = [...forkRecord(f).permissions].reverse();
  },
  "a child in another directory": (f) => {
    forkRecord(f).location = { directory: "/somewhere/else" };
  },
};
for (const [name, mutate] of Object.entries(forkTampers))
  test(`reconcile: a fork with ${name} stays held without writing`, async (t) => {
    // Write 5 lost keeps the consumed handoff (write 4) durable.
    const { f } = await crashedFixture(t, 5, { operation: forkOperation });
    mutate(f);
    const before = nativeMutations(f);
    const rig = await openReconciling(t, f);
    const journal = await journalBytes(f);
    await assert.rejects(rig.run(), {
      storageReason: "native_startup_unverified",
    });
    assert.deepEqual(await journalBytes(f), journal);
    assert.deepEqual(nativeMutations(f), before);
    assert.equal(
      rig.registry
        .readView()
        .retainedOperations.some((row) => row.operationId === "create-crash"),
      true,
    );
  });

test("reconcile: a fork read error holds, and a crash during fork reconciliation repeats only reads", async (t) => {
  const { f, snapshot } = await crashedFixture(t, 4, {
    operation: forkOperation,
  });
  const before = nativeMutations(f);
  const broken = await openReconciling(t, f, {
    read: () => {
      throw new Error("network down");
    },
  });
  const journal = await journalBytes(f);
  await assert.rejects(broken.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.deepEqual(await journalBytes(f), journal);
  let failures = 0;
  const first = await openReconciling(t, f, {
    wrap: (registry) =>
      new Proxy(registry, {
        get(target, key) {
          if (key === "recordTask")
            return async () => {
              failures++;
              throw new Error("synthetic storage loss");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  });
  await assert.rejects(first.run(), {
    storageReason: "native_startup_unverified",
  });
  assert.equal(failures, 1);
  assert.deepEqual(await journalBytes(f), journal);
  const second = await openReconciling(t, f);
  await second.run();
  assert.equal(second.reads.length, 1);
  assert.deepEqual(second.registry.readView().retainedOperations, []);
  await assertReplays(t, f, { sessions: snapshot.sessions.length + 1 });
  assert.deepEqual(nativeMutations(f), before);
});

test("reconcile: the workbench stays unadmitted until reconciliation finishes, then continues the same launch without re-creating", async (t) => {
  const { f, snapshot } = await crashedFixture(t, 5);
  const before = nativeMutations(f);
  const rig = await openReconciling(t, f);
  const gate = deferred();
  const service = createWorkbenchService({
    registry: rig.registry,
    runtimeReady: gate.promise.then(() => f.runtime),
    runtimeEpoch: "new",
    bootstrap: true,
    recoverRetained: true,
  });
  t.after(async () => {
    service.close();
    await service.drain();
  });
  const read = (id) =>
    service.handle(
      { version: 2, readId: `r-${id}`, operation: { type: "snapshot" } },
      "sender",
    );
  // While Main is still reconciling (runtime not yet resolved) nothing is
  // admitted: mutations and reads see an unavailable, not-connected runtime.
  const waiting = await read(1);
  assert.equal(waiting.value.state === "connected", false);
  const refused = await service.handle(
    {
      version: 2,
      runtimeEpoch: "new",
      operationId: "early",
      operation: createOperation(snapshot),
    },
    "sender",
  );
  assert.equal(refused.ok, false);
  assert.deepEqual(nativeMutations(f), before);
  await rig.run();
  gate.resolve();
  let id = 1;
  let connected;
  await until(async () => {
    connected = (await read(++id)).value;
    return connected.state === "connected";
  });
  assert.equal(connected.recovery.store.state, "ready");
  assert.deepEqual(connected.retainedOperations, []);
  assert.equal(connected.sessions.length, snapshot.sessions.length + 1);
  assert.deepEqual(nativeMutations(f), before);
  // Without Main's recovery flag the same retained state still holds at once.
  const held = await openReconciling(t, (await crashedFixture(t, 5)).f);
  const strict = createWorkbenchService({
    registry: held.registry,
    runtimeReady: Promise.resolve(f.runtime),
    runtimeEpoch: "new",
    bootstrap: true,
  });
  t.after(async () => {
    strict.close();
    await strict.drain();
  });
  let strictSnapshot;
  await until(async () => {
    strictSnapshot = (
      await strict.handle(
        { version: 2, readId: "strict", operation: { type: "snapshot" } },
        "sender",
      )
    ).value;
    return strictSnapshot.recovery.store.state !== "ready";
  });
  assert.equal(
    strictSnapshot.recovery.store.reason,
    "native_startup_unverified",
  );
});

test("the armed trail is checkpointed before Native may create, so a hard kill at the Native call is reconcilable", async (t) => {
  const order = [];
  const child = fakeBootstrapChild();
  const consume = child.consume;
  child.consume = (step, input) => {
    order.push("consume");
    return consume(step, input);
  };
  const f = await fixture(t, {
    taskChild: child,
    projectRegistry: (registry) =>
      new Proxy(registry, {
        get(target, key) {
          if (key === "checkpoint")
            return async () => {
              order.push("checkpoint");
              return target.checkpoint();
            };
          if (key === "recordTask")
            return async (record) => {
              order.push(
                record.kind === "task.handoff"
                  ? `handoff:${record.state}`
                  : record.kind,
              );
              return target.recordTask(record);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  });
  const snapshot = await f.ready();
  order.length = 0;
  // Hard kill exactly at the Native call: Native completes the create, then the
  // process dies before it can journal anything else or checkpoint again.
  let killed;
  f.state.hooks.create = async (input) => {
    child.consume("native.create", input);
    f.records.set(input.id, {
      ...input,
      projectID: "project",
      permissions: BASELINE_POLICY,
    });
    killed = join(f.root, "killed");
    await fs.cp(f.directory, killed, { recursive: true });
    throw new Error("process killed");
  };
  await f.mutate(createOperation(snapshot), "create-crash");
  const armed = order.indexOf("handoff:armed");
  assert.ok(armed >= 0);
  assert.deepEqual(order.slice(armed, armed + 3), [
    "handoff:armed",
    "checkpoint",
    "consume",
  ]);
  delete f.state.hooks.create;
  // The copy is what a restart would find: a confirmed prefix, no tail.
  const before = nativeMutations(f);
  const rig = await openReconciling(t, {
    ...f,
    options: { ...f.options, directory: killed },
  });
  assert.equal(
    rig.registry.status().state,
    "ready",
    JSON.stringify(rig.registry.status()),
  );
  const view = rig.registry.readView();
  assert.equal(
    view.retainedOperations.some((row) => row.operationId === "create-crash"),
    true,
  );
  await rig.run();
  assert.equal(rig.reads.length, 1);
  assert.deepEqual(rig.registry.readView().retainedOperations, []);
  assert.equal(
    rig.registry.readView().sessions.length,
    snapshot.sessions.length + 1,
  );
  assert.deepEqual(nativeMutations(f), before);
});

// A crash leaves the journal exactly as it is on disk: no shutdown intent and
// no final checkpoint. Copy it once the idle checkpoint has run, then reopen.
async function crashCopyAfterIdle(t, f) {
  await until(() => {
    const { sequence, checkpointSequence } = f.registry.status().journal;
    return sequence === checkpointSequence;
  });
  const crashed = join(f.root, "crashed");
  await fs.cp(f.directory, crashed, { recursive: true });
  const restarted = await openWorkspaceRegistry({
    ...f.options,
    directory: crashed,
    runtimeEpoch: "new",
  });
  t.after(() => restarted.close());
  return restarted;
}
for (const kind of ["bootstrap create", "session.rename"])
  test(`idle checkpoint after a ${kind}: a crash afterwards relaunches ready`, async (t) => {
    const f = await fixture(t, { taskChild: fakeBootstrapChild() });
    const snapshot = await f.ready();
    const result =
      kind === "session.rename"
        ? await f.mutate({
            type: "session.rename",
            workspaceId: snapshot.selectedWorkspaceId,
            sessionId: snapshot.selectedSessionId,
            requestId: "rename-then-crash",
            title: "Renamed",
          })
        : await f.mutate(createOperation(snapshot), "create-then-crash");
    assert.equal(result.ok, true, JSON.stringify(result));
    const restarted = await crashCopyAfterIdle(t, f);
    assert.equal(
      restarted.status().state,
      "ready",
      JSON.stringify(restarted.status()),
    );
    const view = restarted.readView();
    assert.deepEqual(view.retainedOperations, []);
    if (kind === "session.rename")
      assert.equal(
        view.sessions.find((s) => s.appSessionId === snapshot.selectedSessionId)
          ?.title,
        "Renamed",
      );
    else assert.equal(view.sessions.length, snapshot.sessions.length + 1);
  });
