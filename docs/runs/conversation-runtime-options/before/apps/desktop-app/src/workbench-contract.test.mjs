import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRequest,
  validateEnvelope,
  portableName,
  policyMatches,
  BASELINE_POLICY,
  READ_TYPES,
} from "./workbench-contract.mjs";
test("extensions observation is a workspace-only v2 read without effect authority", () => {
  const operation = {
    type: "configuration.extensions.read",
    workspaceId: "workspace",
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    readId: "read",
    operation,
  };
  assert.ok(READ_TYPES.includes(operation.type));
  assert.deepEqual(validateEnvelope(envelope), envelope);
  const hidden = { ...operation };
  Object.defineProperty(hidden, "nonce", { value: "b".repeat(64) });
  assert.throws(() => validateRequest(hidden));
  for (const extra of [
    { workspacePath: "/synthetic/workspace" },
    { nonce: "b".repeat(64) },
    { sessionId: "session" },
    { requestId: "request" },
    { install: true },
  ])
    assert.throws(() =>
      validateEnvelope({ ...envelope, operation: { ...operation, ...extra } }),
    );
  for (const extra of [{ operationId: "operation" }, { expectedRevision: 0 }])
    assert.throws(() => validateEnvelope({ ...envelope, ...extra }));
  for (const type of [
    "configuration.extensions.install",
    "configuration.extensions.update",
    "configuration.extensions.execute",
  ])
    assert.throws(() => validateRequest({ ...operation, type }));
});
test("Skill files keep exact nested target and missing-directory baseline closed", () => {
  const sourceName = "small-skill";
  for (const operation of [
    { type: "configuration.skill.list", workspaceId: "w" },
    { type: "configuration.skill.read", workspaceId: "w", sourceName },
  ]) {
    const envelope = {
      version: 2,
      runtimeEpoch: "current",
      readId: "read",
      operation,
    };
    assert.deepEqual(validateEnvelope(envelope), envelope);
    assert.throws(() =>
      validateEnvelope({ ...envelope, operationId: "mutate" }),
    );
    for (const fields of [
      { path: "/outside" },
      { sessionId: "session" },
      { text: "private" },
    ])
      assert.throws(() =>
        validateEnvelope({
          ...envelope,
          operation: { ...operation, ...fields },
        }),
      );
  }
  const operation = {
    type: "configuration.skill.save",
    workspaceId: "w",
    sourceName,
    requestId: "r",
    text: "# Body\n",
    directoryVersion: "d".repeat(64),
    expectation: "missing",
  };
  assert.deepEqual(validateRequest(operation), operation);
  for (const fields of [
    { directoryVersion: undefined },
    { directoryVersion: "not-a-digest" },
    { sourceName: "../escape" },
    { sourceName: "a/b" },
    { sourceName: "UPPER" },
    { version: "f".repeat(64) },
    { kind: "skill" },
    { path: "/outside" },
    { text: '---\nname: !!js/function "code"\n---\nbody' },
    { text: "\uD800" },
    { sessionId: "session" },
  ])
    assert.throws(() => validateRequest({ ...operation, ...fields }), {
      appCode: "INVALID_REQUEST",
    });
  assert.deepEqual(
    validateRequest({
      ...operation,
      expectation: "version",
      version: "f".repeat(64),
    }),
    { ...operation, expectation: "version", version: "f".repeat(64) },
  );
});
test("configuration content reads keep closed fixed-source v2 admission", () => {
  for (const kind of ["instructions", "mcp"]) {
    const envelope = {
      version: 2,
      runtimeEpoch: "current",
      readId: "read-one",
      operation: { type: "configuration.read", workspaceId: "w", kind },
    };
    assert.deepEqual(validateEnvelope(envelope), envelope);
    for (const bad of [
      { ...envelope, operationId: "mutation" },
      { ...envelope, expectedRevision: 1 },
      {
        ...envelope,
        operation: { ...envelope.operation, path: "/private/config" },
      },
      { ...envelope, operation: { ...envelope.operation, kind: "providers" } },
      { ...envelope, runtimeEpoch: undefined },
    ])
      assert.throws(() => validateEnvelope(bad), {
        appCode: "INVALID_REQUEST",
      });
  }
});
test("closed requests reject extra fields, cross-selection, malformed values and bulk permissions", () => {
  for (const value of [
    null,
    [],
    { type: "toString" },
    { type: "snapshot", sessionId: "s" },
    { type: "workspace.import", path: "/tmp" },
    {
      type: "message.send",
      workspaceId: "w",
      sessionId: "s",
      requestId: "r",
      text: " ",
    },
    {
      type: "permission.respond",
      workspaceId: "w",
      sessionId: "s",
      requestId: "r",
      decision: "always",
    },
  ])
    assert.throws(() => validateRequest(value));
  assert.deepEqual(validateRequest({ type: "snapshot" }), { type: "snapshot" });
});
test("portable folder names and exact ask policy", () => {
  for (const name of [
    "..",
    "a/b",
    "a\\b",
    "CON.txt",
    "LPT1",
    "trailing.",
    " name",
    "a:",
    "\0",
  ])
    assert.equal(portableName(name), false, name);
  assert.equal(portableName("ordinary-project"), true);
  assert.equal(policyMatches(BASELINE_POLICY), true);
  assert.equal(
    policyMatches([
      ...BASELINE_POLICY,
      { action: "*", resource: "*", effect: "allow" },
    ]),
    false,
  );
  assert.equal(policyMatches(undefined), false);
});

import { validateSnapshot } from "./workbench-contract.mjs";
const recoverySnapshot = () => ({
  runtimeEpoch: "current",
  revision: 0,
  observationSequence: 1,
  state: "unavailable",
  temporary: false,
  recovery: {
    store: { state: "recovery_required", reason: "owner_conflict" },
    resources: [],
  },
  retainedOperations: [
    { runtimeEpoch: "old", operationId: "op", type: "message.send" },
  ],
  workspaces: [],
  sessions: [],
  messages: [],
  permissions: [],
});
test("v5 snapshot clocks and closed recovery validate before publication", () => {
  assert.deepEqual(validateSnapshot(recoverySnapshot()), recoverySnapshot());
  for (const clock of [
    undefined,
    -1,
    0,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() =>
      validateSnapshot({ ...recoverySnapshot(), observationSequence: clock }),
    );
  for (const revision of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => validateSnapshot({ ...recoverySnapshot(), revision }));
  for (const patch of [
    { recovery: undefined },
    { retainedOperations: undefined },
    { temporary: "false" },
    {
      recovery: {
        store: { state: "ready", reason: "owner_conflict" },
        resources: [],
      },
    },
    {
      recovery: {
        store: { state: "recovery_required", reason: "new_reason" },
        resources: [],
      },
    },
    {
      retainedOperations: [
        ...recoverySnapshot().retainedOperations,
        ...recoverySnapshot().retainedOperations,
      ],
    },
    {
      retainedOperations: [
        { runtimeEpoch: "old", operationId: "op", type: "snapshot" },
      ],
    },
    {
      retainedOperations: [
        {
          runtimeEpoch: "old",
          operationId: "op",
          type: "message.send",
          digest: "secret",
        },
      ],
    },
    {
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "absent",
            state: "unavailable",
            reason: "path_missing",
          },
        ],
      },
    },
  ])
    assert.throws(() => validateSnapshot({ ...recoverySnapshot(), ...patch }));
});

test("configuration save is a closed mutation with exact expected file observation and lossless bounded text", () => {
  const operation = {
    type: "configuration.save",
    workspaceId: "w",
    requestId: "save",
    kind: "instructions",
    text: "",
    expectation: "version",
    version: "a".repeat(64),
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: "save-one",
    expectedRevision: 0,
    operation,
  };
  assert.deepEqual(validateEnvelope(envelope), envelope);
  assert.equal(
    validateRequest({ ...operation, text: "a".repeat(32768) }).text.length,
    32768,
  );
  for (const bad of [
    { ...envelope, readId: "read" },
    { ...envelope, operation: { ...operation, path: "/private" } },
    { ...envelope, operation: { ...operation, approved: true } },
    { ...envelope, operation: { ...operation, expectation: "missing" } },
    { ...envelope, operation: { ...operation, version: "bad" } },
    { ...envelope, operation: { ...operation, text: "\ud800" } },
    { ...envelope, operation: { ...operation, text: "a".repeat(32769) } },
    { ...envelope, operation: { ...operation, kind: "provider" } },
  ])
    assert.throws(() => validateEnvelope(bad), { appCode: "INVALID_REQUEST" });
  const { version: _version, ...missing } = operation;
  assert.deepEqual(validateRequest({ ...missing, expectation: "missing" }), {
    ...missing,
    expectation: "missing",
  });
});

test("instruction API keeps read and mutation identity closed with exact file and registration observations", () => {
  const operation = {
    type: "configuration.instructions.apply",
    workspaceId: "w",
    sessionId: "s",
    requestId: "instruction",
    text: "\uFEFFFollow these instructions.\n",
    fileVersion: "a".repeat(64),
    expectedRegistrationVersion: "b".repeat(64),
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    operationId: "apply",
    operation,
  };
  assert.deepEqual(validateEnvelope(envelope), envelope);
  assert.equal(
    validateEnvelope({ ...envelope, operation: { ...operation, text: "" } })
      .operation.text,
    "",
  );
  for (const change of [
    { key: "foreign" },
    { path: "/private" },
    { approved: true },
    { fileVersion: "bad" },
    { expectedRegistrationVersion: "bad" },
    { text: "\ud800" },
    { text: "가".repeat(11000) },
    { sessionId: undefined },
  ])
    assert.throws(
      () =>
        validateEnvelope({
          ...envelope,
          operation: { ...operation, ...change },
        }),
      { appCode: "INVALID_REQUEST" },
    );
  const read = {
    version: 2,
    runtimeEpoch: "epoch",
    readId: "read",
    operation: {
      type: "configuration.instructions.read",
      workspaceId: "w",
      sessionId: "s",
    },
  };
  assert.deepEqual(validateEnvelope(read), read);
  assert.throws(() => validateEnvelope({ ...read, operationId: "mutation" }), {
    appCode: "INVALID_REQUEST",
  });
  const remove = {
    type: "configuration.instructions.remove",
    workspaceId: "w",
    sessionId: "s",
    requestId: "remove",
    expectedRegistrationVersion: "c".repeat(64),
  };
  assert.deepEqual(validateRequest(remove), remove);
  assert.throws(() => validateRequest({ ...remove, text: "fabricated" }), {
    appCode: "INVALID_REQUEST",
  });
});

test("MCP operations are closed workspace targets with explicit read and immutable file/catalog baseline", () => {
  const operation = {
    type: "configuration.mcp.register",
    workspaceId: "workspace",
    requestId: "register",
    sourceName: "sample",
    text: JSON.stringify({
      mcp: {
        servers: { sample: { type: "local", command: ["node", "server.mjs"] } },
      },
    }),
    fileVersion: "a".repeat(64),
    expectedObservationVersion: "b".repeat(64),
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    operationId: "register",
    operation,
  };
  assert.deepEqual(validateEnvelope(envelope), envelope);
  for (const change of [
    { nativeName: "foreign" },
    { sessionId: "session" },
    { approved: true },
    { sourceName: "../escape" },
    { expectedObservationVersion: "bad" },
    { fileVersion: "bad" },
    { text: "not JSON" },
  ])
    assert.throws(() => validateRequest({ ...operation, ...change }), {
      appCode: "INVALID_REQUEST",
    });
  const read = {
    version: 2,
    runtimeEpoch: "epoch",
    readId: "read",
    operation: { type: "configuration.mcp.read", workspaceId: "workspace" },
  };
  assert.deepEqual(validateEnvelope(read), read);
  assert.throws(() => validateEnvelope({ ...read, operationId: "write" }), {
    appCode: "INVALID_REQUEST",
  });
  for (const action of ["connect", "disconnect", "remove"]) {
    const request = {
      type: `configuration.mcp.${action}`,
      workspaceId: "workspace",
      requestId: action,
      sourceName: "sample",
      expectedObservationVersion: "b".repeat(64),
    };
    assert.deepEqual(validateRequest(request), request);
    assert.throws(() => validateRequest({ ...request, text: "payload" }), {
      appCode: "INVALID_REQUEST",
    });
  }
});
