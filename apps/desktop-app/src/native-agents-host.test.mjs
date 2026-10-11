import test from "node:test";
import assert from "node:assert/strict";
import {
  readNativeAgentSessions,
  parseAgentRuntimeRecord,
} from "./host/workbench-native-agents.mjs";
import { createNativeAgentsClient } from "./native-agents-client.mjs";
import { nativeAgentId, nativeAgentDigest } from "./native-agents-protocol.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

const owner = {
  runtimeEpoch: "epoch",
  operationId: "reg",
  workspaceId: "workspace",
  workspacePath: "/tmp/workspace",
  sourceName: "reviewer",
  digest: "a".repeat(64),
};
const record = () => parseAgentRuntimeRecord("Body", owner);
test("complete global agent reference proof includes archived and foreign sessions with cursor-only continuation", async () => {
  const inputs = [];
  const pages = [
    {
      data: [
        {
          id: "foreign",
          agent: nativeAgentId(owner),
          time: { archived: 1 },
          location: { directory: "/other" },
        },
      ],
      cursor: { next: "next" },
    },
    { data: [{ id: "current", agent: "build" }], cursor: { next: "end" } },
    { data: [], cursor: {} },
  ];
  const rows = await readNativeAgentSessions({
    session: {
      list: async (input) => {
        inputs.push(input);
        return pages.shift();
      },
    },
  });
  assert.deepEqual(rows, [
    { id: "foreign", agent: nativeAgentId(owner) },
    { id: "current", agent: "build" },
  ]);
  assert.deepEqual(inputs, [
    { limit: 64, order: "asc" },
    { limit: 64, cursor: "next" },
    { limit: 64, cursor: "end" },
  ]);
});
test("incomplete/repeating/duplicate/sparse/malformed Native session pages never establish zero references", async () => {
  for (const pages of [
    [
      { data: [], cursor: { next: "x" } },
      { data: [], cursor: { next: "x" } },
    ],
    [
      { data: [{ id: "a" }], cursor: { next: "x" } },
      { data: [{ id: "a" }], cursor: {} },
    ],
    [{ data: Array(1), cursor: {} }],
    [{ data: [{ id: "a", agent: 42 }], cursor: {} }],
    Array.from({ length: 16 }, (_, i) => ({
      data: [{ id: `s${i}` }],
      cursor: { next: `c${i}` },
    })),
  ]) {
    await assert.rejects(
      readNativeAgentSessions({ session: { list: async () => pages.shift() } }),
      /native_agent_references_unverified/,
    );
  }
});
test("Main-only Agent adapter refuses archived/foreign references before private remove RPC", async () => {
  let rpcCalls = 0,
    checks = 0;
  const value = record();
  const input = {
    owner: { ...owner, operationId: "remove" },
    registration: owner,
    nativeId: value.id,
    recordDigest: nativeAgentDigest(value),
  };
  const api = createNativeAgentsClient({
    client: {
      session: {
        list: async () => ({
          data: [{ id: "archived", agent: value.id, time: { archived: 1 } }],
          cursor: {},
        }),
      },
      rpc: () => ({
        remove: async () => {
          rpcCalls++;
        },
      }),
    },
    nonce: "b".repeat(64),
    assertLive: async () => {
      checks++;
    },
  });
  await assert.rejects(api.remove(input), (e) => e.code === "AGENT_IN_USE");
  assert.equal(rpcCalls, 0);
  assert.ok(checks >= 2);
});
test("agent conversion and private adapter keep original key/default/baseline and immutable payload", async () => {
  const value = record();
  assert.deepEqual(value.permissions, BASELINE_POLICY);
  assert.deepEqual(value.request, { settings: {}, headers: {}, body: {} });
  assert.equal(Object.hasOwn(value, "model"), false);
  let observed;
  const input = {
    owner: { ...owner },
    record: value,
    recordDigest: nativeAgentDigest(value),
    expectedNativeId: null,
  };
  const api = createNativeAgentsClient({
    client: {
      rpc: () => ({
        register: async (payload, options) => {
          observed = { payload, options };
          return {
            status: "registered",
            owner: payload.owner,
            record: payload.record,
            recordDigest: payload.recordDigest,
            defaultAgentId: "build",
          };
        },
      }),
    },
    nonce: "b".repeat(64),
    assertLive: async () => {
      input.owner.operationId = "mutated";
    },
  });
  const result = await api.register(input);
  assert.equal(result.owner.operationId, "reg");
  assert.equal(observed.options.location.directory, owner.workspacePath);
  assert.equal(observed.payload.nonce, "b".repeat(64));
  assert.equal(Object.hasOwn(api, "nonce"), false);
});

test("public Agent projection requires exact private ownership, public Native rows and global references", async () => {
  const { projectNativeAgentRows } = await import(
    "./host/workbench-native-agents.mjs"
  );
  const value = record();
  const built = { id: "build", name: "Build", mode: "primary", hidden: false };
  const native = [built, value];
  const observed = {
    status: "ready",
    version: 1,
    workspaceId: owner.workspaceId,
    workspacePath: owner.workspacePath,
    rows: [{ owner, record: value, recordDigest: nativeAgentDigest(value) }],
    native: native.map(({ id, name, mode, hidden }) => ({
      id,
      name,
      mode,
      hidden,
    })),
    defaultAgentId: "build",
  };
  const scope = {
    workspaceId: owner.workspaceId,
    workspacePath: owner.workspacePath,
    runtimeEpoch: owner.runtimeEpoch,
  };
  const rows = projectNativeAgentRows(
    observed,
    { location: { directory: owner.workspacePath }, data: native },
    [{ id: "foreign", agent: value.id }],
    scope,
  );
  assert.equal(rows.owned[0].referenceCount, 1);
  assert.equal(rows.owned[0].system, "Body");
  assert.deepEqual(rows.unowned, [
    { nativeId: "build", name: "Build", mode: "primary", hidden: false },
  ]);
  assert.equal(Object.hasOwn(rows.unowned[0], "system"), false);
  const changed = globalThis.structuredClone(native);
  changed[1].permissions.push({ action: "*", resource: "*", effect: "allow" });
  assert.throws(
    () =>
      projectNativeAgentRows(
        observed,
        { location: { directory: owner.workspacePath }, data: changed },
        [],
        scope,
      ),
    (e) => e.appCode === "AGENT_UNVERIFIED",
  );
  assert.throws(
    () =>
      projectNativeAgentRows(
        observed,
        { location: { directory: owner.workspacePath }, data: native },
        [],
        { ...scope, runtimeEpoch: "other" },
      ),
    (e) => e.appCode === "AGENT_UNVERIFIED",
  );
});
