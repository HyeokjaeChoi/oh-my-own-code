import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY } from "../../src/workbench-contract.mjs";

test("agent probe observes unchanged real calls and synthetic ACK loss only after completed effect", async () => {
  const { observeSyntheticAgentsRuntime } = await import(
    "./p7-storage-owner-host.mjs"
  );
  const counts = { observe: 0, register: 0, remove: 0 },
    fault = { nextRegisterAck: true },
    calls = [],
    actual = { status: "actual" };
  const runtime = {
    workbenchContext: () => ({
      client: {},
      nativeAgents: Object.fromEntries(
        ["observe", "register", "remove"].map((method) => [
          method,
          async (input) => {
            calls.push({ method, input });
            return actual;
          },
        ]),
      ),
    }),
  };
  const api = observeSyntheticAgentsRuntime(
    runtime,
    counts,
    fault,
  ).workbenchContext().nativeAgents;
  const input = { identity: "original" };
  assert.equal(await api.observe(input), actual);
  await assert.rejects(api.register(input), /acknowledgement loss/u);
  assert.equal(calls[1].input, input);
  assert.equal(fault.nextRegisterAck, false);
  assert.equal(await api.register(input), actual);
  assert.equal(await api.remove(input), actual);
  assert.deepEqual(counts, { observe: 1, register: 2, remove: 1 });
});

test("agent probe confirmation denies by default, checks containment/baseline and retains no prompt", async () => {
  const { syntheticAgentConfirmation } = await import(
    "./p7-storage-owner-host.mjs"
  );
  const state = { enabled: false, requests: [] },
    confirm = syntheticAgentConfirmation("/synthetic", state);
  const request = Object.freeze({
    action: "register",
    workspacePath: "/synthetic/workspace",
    workspaceId: "w",
    nativeId: "agent",
    sourceName: "demo",
    digest: "a".repeat(64),
    systemDigest: "b".repeat(64),
    mode: "primary",
    hidden: false,
    permissions: BASELINE_POLICY,
    defaultAgentId: "build",
    system: "No prompt in log",
  });
  assert.equal(await confirm(request), false);
  state.enabled = true;
  assert.equal(await confirm(request), true);
  assert.equal(Object.hasOwn(state.requests[0], "system"), false);
  await assert.rejects(
    confirm(Object.freeze({ ...request, workspacePath: "/outside" })),
  );
  await assert.rejects(
    confirm(
      Object.freeze({
        ...request,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  );
});

test("agent probe save diagnostics preserve actual results and omit payload/token", async () => {
  const { observeSyntheticAgentsRuntime } = await import(
    "./p7-storage-owner-host.mjs"
  );
  const actual = {
    status: "saved",
    version: "a".repeat(64),
    backupId: "synthetic.backup",
    token: "private",
    text: "private",
  };
  const fault = {};
  const runtime = {
    workbenchContext: () => ({
      nativeAgents: {},
      configurationSave: {
        prepare: async () => actual,
        publish: async () => actual,
        abort: async () => actual,
      },
    }),
  };
  const api = observeSyntheticAgentsRuntime(
    runtime,
    {},
    fault,
  ).workbenchContext().configurationSave;
  assert.equal(await api.publish({ token: "secret" }), actual);
  assert.deepEqual(fault.saveTrace, [
    {
      method: "publish",
      status: "saved",
      version: actual.version,
      backupId: actual.backupId,
    },
  ]);
});

test("reference fixture cleanup refuses mapped or unexpected sessions before any delete", async () => {
  const { cleanupSyntheticAgentReferences } = await import(
    "./native-agents-public.mjs"
  );
  let removed = 0;
  const client = {
    session: {
      remove: async () => {
        removed++;
      },
    },
  };
  for (const references of [
    [
      { id: "mapped", directory: "/synthetic/foreign-reference" },
      { id: "other", directory: "/synthetic/public-agent-foreign" },
    ],
    [
      { id: "foreign", directory: "/outside" },
      { id: "other", directory: "/synthetic/public-agent-foreign" },
    ],
  ])
    await assert.rejects(
      cleanupSyntheticAgentReferences({
        client,
        registry: {
          readView: () => ({ sessions: [{ nativeSessionId: "mapped" }] }),
        },
        namespace: "/synthetic",
        references,
      }),
    );
  assert.equal(removed, 0);
});

test("reference fixture cleanup verifies both exact created sessions, removes only them and keeps mapped sessions", async () => {
  const { cleanupSyntheticAgentReferences } = await import(
    "./native-agents-public.mjs"
  );
  const references = [
      { id: "foreign", directory: "/synthetic/foreign-reference" },
      { id: "other", directory: "/synthetic/public-agent-foreign" },
    ],
    removed = [];
  const client = {
    session: {
      get: async ({ sessionID }) => {
        const r = references.find((x) => x.id === sessionID);
        return {
          id: r.id,
          location: { directory: r.directory },
          permissions: BASELINE_POLICY,
        };
      },
      inbox: { list: async () => [] },
      active: async () => ({}),
      remove: async ({ sessionID }) => removed.push(sessionID),
      list: async () => ({
        data: [{ id: "mapped", agent: "build" }],
        cursor: {},
      }),
    },
  };
  const result = await cleanupSyntheticAgentReferences({
    client,
    registry: {
      readView: () => ({ sessions: [{ nativeSessionId: "mapped" }] }),
    },
    namespace: "/synthetic",
    references,
  });
  assert.deepEqual(removed, ["foreign", "other"]);
  assert.equal(result.mappedSessionsPreserved, true);
});
