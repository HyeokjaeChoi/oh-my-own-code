import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_FEATURE,
  agentBackupId,
  agentRuntimeAdmission,
  validAgentSavedResult,
  validAgentRuntimeResult,
  validateAgentRuntimeAdmission,
  validateAgentRuntimeDispatch,
  validateAgentRuntimeCompletion,
} from "./workbench-agent-storage.mjs";
import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";

const empty = () => ({ workspaces: [], sessions: [], tombstones: [] });
function records() {
  const identity = {
    runtimeEpoch: "epoch",
    operationId: "register",
    workspaceId: "ws",
    type: "configuration.agent.register",
    digest: "a".repeat(64),
  };
  const operation = {
    type: identity.type,
    requestId: identity.operationId,
    workspaceId: "ws",
    sourceName: "Review_Code",
    digest: "b".repeat(64),
    version: "c".repeat(64),
    directoryVersion: "d".repeat(64),
  };
  const admitted = agentRuntimeAdmission(identity, operation);
  const target = {
    sourceName: operation.sourceName,
    nativeId: admitted.nativeId,
    digest: operation.digest,
    nativeDigest: "e".repeat(64),
    systemDigest: "f".repeat(64),
    registrationRuntimeEpoch: "epoch",
    registrationOperationId: "register",
  };
  const dispatch = { step: "native.agent.register", agentRuntime: target };
  const receipt = {
    ...identity,
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    result: {
      kind: "agent_registered",
      workspaceId: "ws",
      ...target,
      version: operation.version,
      directoryVersion: operation.directoryVersion,
      defaultAgentId: "build",
    },
  };
  delete receipt.digest;
  const registered = {
    identity,
    agentRuntime: admitted,
    dispatches: [dispatch],
    receipt,
    terminal: true,
  };
  const operations = new Map([
    [JSON.stringify(["epoch", "register"]), registered],
  ]);
  return {
    identity,
    operation,
    admitted,
    target,
    dispatch,
    receipt,
    registered,
    operations,
  };
}

test("Agent private admission binds the original request key and closes target fields", () => {
  const r = records();
  assert.equal(
    r.admitted.nativeId,
    nativeAgentRegistrationId({
      ...r.identity,
      sourceName: r.operation.sourceName,
    }),
  );
  assert.throws(() =>
    agentRuntimeAdmission(r.identity, { ...r.operation, requestId: "other" }),
  );
  for (const target of [
    { ...r.admitted, path: "/PRIVATE" },
    { ...r.admitted, nonce: "PRIVATE" },
    { ...r.admitted, nativeId: `omoc-agent-${"0".repeat(64)}` },
    { ...r.admitted, [Symbol("hidden")]: "PRIVATE" },
  ])
    assert.throws(() =>
      validateAgentRuntimeAdmission({
        identity: r.identity,
        agentRuntime: target,
      }),
    );
  assert.throws(() =>
    validateAgentRuntimeAdmission({
      identity: { ...r.identity, sessionId: undefined },
      agentRuntime: r.admitted,
    }),
  );
});

test("Agent result cannot carry private fields, foreign registration identity or current agent default", () => {
  const r = records();
  assert.equal(validAgentRuntimeResult(r.receipt), true);
  for (const change of [
    { system: "PRIVATE" },
    { path: "/PRIVATE" },
    { nonce: "PRIVATE" },
    { permissions: [] },
    { nativeSessionId: "PRIVATE" },
    { registrationRuntimeEpoch: "old" },
    { registrationOperationId: "other" },
    { defaultAgentId: r.target.nativeId },
    { [Symbol("hidden")]: "PRIVATE" },
  ])
    assert.equal(
      validAgentRuntimeResult({
        ...r.receipt,
        result: { ...r.receipt.result, ...change },
      }),
      false,
    );
  const accessor = { ...r.receipt.result };
  Object.defineProperty(accessor, "systemDigest", {
    enumerable: true,
    get: () => assert.fail("must not invoke accessor"),
  });
  assert.equal(
    validAgentRuntimeResult({ ...r.receipt, result: accessor }),
    false,
  );
});

test("Agent remove requires exact original confirmed current epoch proof and consumes removal authority once", () => {
  const r = records();
  const identity = {
    ...r.identity,
    type: "configuration.agent.remove",
    operationId: "remove",
  };
  const operation = {
    identity,
    agentRuntime: { nativeId: r.target.nativeId },
    dispatches: [],
  };
  const dispatch = { step: "native.agent.remove", agentRuntime: r.target };
  validateAgentRuntimeDispatch(operation, dispatch, new Map(), r.operations);
  for (const field of Object.keys(r.target)) {
    assert.throws(() =>
      validateAgentRuntimeDispatch(
        operation,
        {
          ...dispatch,
          agentRuntime: {
            ...r.target,
            [field]:
              field.includes("Digest") || field === "digest"
                ? "0".repeat(64)
                : "foreign",
          },
        },
        new Map(),
        r.operations,
      ),
    );
  }
  assert.throws(() =>
    validateAgentRuntimeDispatch(operation, dispatch, new Map(), new Map()),
  );
  assert.throws(() =>
    validateAgentRuntimeDispatch(
      { ...operation, identity: { ...identity, runtimeEpoch: "new" } },
      dispatch,
      new Map(),
      r.operations,
    ),
  );
  const removed = {
    ...operation,
    terminal: true,
    dispatches: [dispatch],
    receipt: {
      ...r.receipt,
      operationId: "remove",
      type: identity.type,
      result: {
        kind: "agent_removed",
        workspaceId: "ws",
        ...r.target,
        defaultAgentId: "build",
      },
    },
  };
  assert.equal(validAgentRuntimeResult(removed.receipt), true);
  r.operations.set(JSON.stringify(["epoch", "remove"]), removed);
  assert.throws(() =>
    validateAgentRuntimeDispatch(
      { ...operation, identity: { ...identity, operationId: "remove-again" } },
      dispatch,
      new Map(),
      r.operations,
    ),
  );
  validateAgentRuntimeCompletion(
    removed,
    { receipt: removed.receipt, delta: empty() },
    [AGENT_FEATURE],
    new Map(),
    r.operations,
  );
});

test("Agent completion forbids topology changes, reservations and unflushed success", () => {
  const r = records();
  const payload = { receipt: r.receipt, delta: empty() };
  validateAgentRuntimeCompletion(
    r.registered,
    payload,
    [AGENT_FEATURE],
    new Map(),
    r.operations,
  );
  for (const operation of [
    { ...r.registered, dispatches: [] },
    { ...r.registered, reservation: {} },
  ])
    assert.throws(() =>
      validateAgentRuntimeCompletion(
        operation,
        payload,
        [AGENT_FEATURE],
        new Map(),
        r.operations,
      ),
    );
  assert.throws(() =>
    validateAgentRuntimeCompletion(
      r.registered,
      payload,
      [],
      new Map(),
      r.operations,
    ),
  );
  assert.throws(() =>
    validateAgentRuntimeCompletion(
      r.registered,
      {
        ...payload,
        delta: { ...empty(), tombstones: [{ kind: "workspace", id: "ws" }] },
      },
      [AGENT_FEATURE],
      new Map(),
      r.operations,
    ),
  );
});

test("Agent workspace tombstone requires confirmed removal in the same epoch; old registrations stay historical", () => {
  const r = records();
  const removal = {
    identity: {
      ...r.identity,
      operationId: "workspace-remove",
      type: "workspace.remove",
    },
    dispatches: [],
  };
  const payload = {
    receipt: {},
    delta: { ...empty(), tombstones: [{ kind: "workspace", id: "ws" }] },
  };
  assert.throws(
    () =>
      validateAgentRuntimeCompletion(
        removal,
        payload,
        [AGENT_FEATURE],
        new Map(),
        r.operations,
      ),
    { code: "identity_conflict" },
  );
  validateAgentRuntimeCompletion(
    { ...removal, identity: { ...removal.identity, runtimeEpoch: "new" } },
    payload,
    [AGENT_FEATURE],
    new Map(),
    r.operations,
  );
});

test("Agent file result binds exact source and original backup without exposing accessors or symbols", () => {
  const record = {
    runtimeEpoch: "epoch",
    operationId: "save",
    workspaceId: "ws",
    type: "configuration.agent.save",
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    result: {
      kind: "agent_file_saved",
      workspaceId: "ws",
      sourceName: "Review_Code",
      version: "a".repeat(64),
      backupId: agentBackupId("epoch", "save"),
    },
  };
  assert.equal(validAgentSavedResult(record, "Review_Code"), true);
  assert.equal(validAgentSavedResult(record, "other"), false);
  assert.equal(
    validAgentSavedResult({ ...record, operationId: "other" }, "Review_Code"),
    false,
  );
  assert.equal(
    validAgentSavedResult(
      {
        ...record,
        result: { ...record.result, [Symbol("hidden")]: "PRIVATE" },
      },
      "Review_Code",
    ),
    false,
  );
  const accessor = { ...record.result };
  Object.defineProperty(accessor, "sourceName", {
    enumerable: true,
    get: () => assert.fail("must not invoke accessor"),
  });
  assert.equal(
    validAgentSavedResult({ ...record, result: accessor }, "Review_Code"),
    false,
  );
});
