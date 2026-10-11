import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { nativeAgentId } from "./native-agents-protocol.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";
import { validateRequest, READ_TYPES } from "./workbench-contract.mjs";

const owner = {
  runtimeEpoch: "epoch",
  operationId: "register",
  workspaceId: "workspace",
  workspacePath: "/synthetic/workspace",
  sourceName: "reviewer",
  digest: "a".repeat(64),
};
const row = () => ({
  sourceName: owner.sourceName,
  nativeId: nativeAgentId(owner),
  digest: owner.digest,
  nativeDigest: "b".repeat(64),
  registrationRuntimeEpoch: owner.runtimeEpoch,
  registrationOperationId: owner.operationId,
  name: owner.sourceName,
  system: "Review",
  systemDigest: "c".repeat(64),
  path: "/synthetic/workspace/.opencode/agents/reviewer.md",
  mode: "primary",
  hidden: false,
  permissions: BASELINE_POLICY.map((r) => ({ ...r })),
  referenceCount: 0,
});
const observation = () => ({
  workspaceId: owner.workspaceId,
  workspacePath: owner.workspacePath,
  runtimeEpoch: owner.runtimeEpoch,
  status: "observed",
  observationId: "observation",
  defaultAgentId: "build",
  owned: [row()],
  unowned: [
    { nativeId: "build", name: "Build", mode: "primary", hidden: false },
  ],
});

test("agent public requests are workspace-only closed source-bound reads and mutations", () => {
  const requests = [
    { type: "configuration.agent.list", workspaceId: "workspace" },
    {
      type: "configuration.agent.read",
      workspaceId: "workspace",
      sourceName: "reviewer",
    },
    {
      type: "configuration.agent.runtime.read",
      workspaceId: "workspace",
      sourceName: "reviewer",
    },
    {
      type: "configuration.agent.register",
      workspaceId: "workspace",
      requestId: "register",
      sourceName: "reviewer",
      observationId: "observation",
      version: "a".repeat(64),
      directoryVersion: "b".repeat(64),
      digest: "c".repeat(64),
    },
    {
      type: "configuration.agent.remove",
      workspaceId: "workspace",
      requestId: "remove",
      nativeId: nativeAgentId(owner),
      observationId: "observation",
    },
    {
      type: "configuration.agent.save",
      workspaceId: "workspace",
      requestId: "save",
      sourceName: "reviewer",
      directoryVersion: "b".repeat(64),
      expectation: "missing",
      text: "Body",
    },
  ];
  for (const value of requests) {
    assert.deepEqual(validateRequest(value), value);
    for (const extra of [
      { sessionId: "session" },
      { path: "/foreign" },
      { nonce: "secret" },
      { sourceName: "../reviewer" },
    ]) {
      if (extra.sourceName && value.type === "configuration.agent.list")
        continue;
      assert.throws(
        () => validateRequest({ ...value, ...extra }),
        (e) => e.appCode === "INVALID_REQUEST",
      );
    }
  }
  for (const type of [
    "configuration.agent.list",
    "configuration.agent.read",
    "configuration.agent.runtime.read",
  ])
    assert.ok(READ_TYPES.includes(type));
});

test("agent public observation binds owned scope, closed minimal foreign rows, baseline and complete reference count", async () => {
  const api = await import(
    "./renderer/shared/configuration-draft/agent-runtime.mjs"
  );
  assert.equal(api.validAgentRuntimeObservation(observation()), true);
  for (const mutate of [
    (v) =>
      v.owned[0].permissions.push({
        action: "*",
        resource: "*",
        effect: "allow",
      }),
    (v) => (v.owned[0].referenceCount = -1),
    (v) => (v.owned[0].registrationRuntimeEpoch = "old"),
    (v) => (v.owned[0].path = "/other/reviewer.md"),
    (v) => (v.unowned[0].system = "PRIVATE"),
    (v) => (v.defaultAgentId = v.owned[0].nativeId),
    (v) => (v.defaultAgentId = null),
    (v) => (v.owned = Array(1)),
    (v) =>
      Object.defineProperty(v.owned, 0, {
        get() {
          throw new Error("getter executed");
        },
      }),
  ]) {
    const v = observation();
    mutate(v);
    assert.equal(api.validAgentRuntimeObservation(v), false);
  }
  assert.equal(
    api.validAgentRuntimeObservation({
      ...observation(),
      status: "unavailable",
      reason: "references_unverified",
    }),
    false,
  );
  assert.equal(
    api.validAgentRuntimeObservation({
      workspaceId: "workspace",
      workspacePath: owner.workspacePath,
      runtimeEpoch: "epoch",
      status: "unavailable",
      reason: "references_unverified",
    }),
    true,
  );
  assert.equal(
    createHash("sha256").update(api.agentRuntimeIdPayload(owner)).digest("hex"),
    nativeAgentId(owner).slice("omoc-agent-".length),
  );
});

test("agent public result has original identity and no prompt, nonce, replay payload or fabricated session", async () => {
  const { validAgentRuntimeMutation, agentRuntimeStep } = await import(
    "./renderer/shared/configuration-draft/agent-runtime.mjs"
  );
  const {
    name: _name,
    system: _system,
    path: _path,
    permissions: _permissions,
    referenceCount: _count,
    mode: _mode,
    hidden: _hidden,
    ...identity
  } = row();
  const value = {
    requestId: "register",
    status: "registered_primary",
    ...identity,
    version: "d".repeat(64),
    directoryVersion: "e".repeat(64),
    defaultAgentId: "build",
  };
  assert.equal(validAgentRuntimeMutation(value), true);
  for (const extra of [
    { system: "PROMPT" },
    { nonce: "SECRET" },
    { sessionId: "session" },
    { defaultAgentId: identity.nativeId },
    { status: "registered_disabled" },
  ])
    assert.equal(validAgentRuntimeMutation({ ...value, ...extra }), false);
  const { version: _version, directoryVersion: _directory, ...removed } = value;
  assert.equal(
    validAgentRuntimeMutation({ ...removed, status: "removed" }),
    true,
  );
  assert.equal(
    validAgentRuntimeMutation({ requestId: "register", status: "unknown" }),
    true,
  );
  assert.equal(
    validAgentRuntimeMutation({
      requestId: "register",
      status: "unknown",
      nativeId: identity.nativeId,
    }),
    false,
  );
  assert.equal(
    agentRuntimeStep("configuration.agent.register"),
    "native.agent.register",
  );
  assert.equal(
    agentRuntimeStep("configuration.agent.remove"),
    "native.agent.remove",
  );
});
