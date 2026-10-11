// Actual contained preconsumer route proof. Never imported by production Main.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { join, relative, isAbsolute } from "node:path";
import {
  NATIVE_AGENTS_RPC,
  nativeAgentDigest,
} from "../../src/native-agents-protocol.mjs";
import {
  parseAgentRuntimeRecord,
  readNativeAgentSessions,
} from "../../src/host/workbench-native-agents.mjs";
import {
  BASELINE_POLICY,
  policyMatches,
} from "../../src/renderer/shared/configuration-draft/policy.mjs";

export async function runAgentsPrerequisite({ runtime, registry, namespace }) {
  const view = registry.readView(),
    workspace = view.workspaces[0],
    session = view.sessions.find(
      (s) => s.workspaceId === workspace?.workspaceId,
    );
  assert.ok(workspace && session?.nativeSessionId);
  const root = workspace.canonicalPath,
    rel = relative(namespace, root);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
  const { client, nativeAgents } = runtime.workbenchContext();
  assert.ok(nativeAgents);
  const originalRpc = client.rpc,
    counts = { observe: 0, register: 0, remove: 0 },
    cases = [];
  let nonce,
    phase = "OBSERVE",
    assertion = "initial",
    record;
  const options = () => ({ signal: AbortSignal.timeout(10000) });
  const list = async () => {
    const r = await client.agent.list(
      { location: { directory: root } },
      options(),
    );
    assert.equal(r.location?.directory, root);
    assert.ok(Array.isArray(r.data));
    return r.data;
  };
  const pass = (name) => cases.push({ name, result: "pass" });
  function preserved(actual, expected) {
    try {
      assert.deepEqual(actual, expected);
    } catch (error) {
      // Synthetic builtin rows only: report changed field NAMES, never values.
      error.agentDifferences = actual.map((row) => {
        const prior = expected.find((item) => item.id === row.id);
        return {
          nativeId: row.id,
          ...(JSON.stringify(row.permissions) !==
            JSON.stringify(prior?.permissions) && {
            permissionDifference: {
              beforeCount: prior?.permissions?.length ?? 0,
              afterCount: row.permissions?.length ?? 0,
              before: (prior?.permissions ?? []).map(
                ({ action, effect, resource }) => ({
                  action,
                  effect,
                  resourceDigest: createHash("sha256")
                    .update(resource)
                    .digest("hex"),
                }),
              ),
              after: (row.permissions ?? []).map(
                ({ action, effect, resource }) => ({
                  action,
                  effect,
                  resourceDigest: createHash("sha256")
                    .update(resource)
                    .digest("hex"),
                }),
              ),
            },
          }),
          fields: [
            ...new Set([...Object.keys(row), ...Object.keys(prior ?? {})]),
          ]
            .filter(
              (key) =>
                JSON.stringify(row[key]) !== JSON.stringify(prior?.[key]),
            )
            .map((key) =>
              /^[A-Za-z]{1,32}$/u.test(key) ? key : "unknown_field",
            ),
        };
      });
      throw error;
    }
  }
  client.rpc = (definition) => {
    const rpc = originalRpc(definition);
    if (definition.id !== NATIVE_AGENTS_RPC.id) return rpc;
    return Object.fromEntries(
      Object.keys(counts).map((method) => [
        method,
        (...args) => {
          nonce = args[0].nonce;
          counts[method]++;
          return rpc[method](...args);
        },
      ]),
    );
  };
  try {
    const initial = await list(),
      baseline = await client.session.get(
        { sessionID: session.nativeSessionId },
        options(),
      );
    assert.equal(policyMatches(baseline.permissions), true);
    const observed = await nativeAgents.observe({
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    });
    assert.equal(observed.status, "ready");
    assert.deepEqual(observed.rows, []);
    assert.deepEqual(
      observed.native,
      initial.map(({ id, name, mode, hidden }) => ({ id, name, mode, hidden })),
    );
    assert.equal(observed.defaultAgentId, initial[0]?.id ?? null);
    assert.match(nonce, /^[a-f0-9]{64}$/u);
    // Native config setup can append its app-wide deny rule after the first
    // public list. Establish the full baseline AFTER the fixed plugin is ready.
    // Accept only that single restrictive startup append; every later full row
    // comparison remains exact, including all foreign permission rules.
    let before,
      stable = 0;
    for (let n = 0; n < 12; n++) {
      const current = await list();
      stable = isDeepStrictEqual(current, before) ? stable + 1 : 0;
      before = current;
      if (stable >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(stable >= 3);
    assert.deepEqual(
      before.map((r) => r.id),
      initial.map((r) => r.id),
    );
    for (const [i, row] of before.entries()) {
      const { permissions, ...rest } = row;
      const { permissions: original, ...originalRest } = initial[i];
      assert.deepEqual(rest, originalRest);
      assert.deepEqual(permissions.slice(0, original.length), original);
      const appended = permissions.slice(original.length);
      assert.ok(appended.length <= 1);
      if (appended.length)
        assert.deepEqual(appended, [
          { action: "*", resource: "*", effect: "deny" },
        ]);
    }
    pass(
      "fixed-trusted-Agent-plugin-ready-default-baseline-no-automatic-registration",
    );
    phase = "SECURITY";
    assertion = "closed-refusals";
    const raw = (method, input, directory = root) =>
      originalRpc(
        method === "unknown"
          ? {
              ...NATIVE_AGENTS_RPC,
              methods: { unknown: NATIVE_AGENTS_RPC.methods.observe },
            }
          : NATIVE_AGENTS_RPC,
      )[method](input, { ...options(), location: { directory } });
    const request = {
      nonce,
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    };
    for (const [label, input] of [
      ["wrong-nonce", { ...request, nonce: "0".repeat(64) }],
      ["extra-field", { ...request, extra: true }],
      [
        "wrong-context",
        { ...request, workspacePath: join(namespace, "wrong-context") },
      ],
    ]) {
      assertion = label;
      await assert.rejects(raw("observe", input));
    }
    assertion = "unknown-method";
    await assert.rejects(raw("unknown", request));
    assertion = "foreign-rows-preserved";
    preserved(await list(), before);
    pass(
      "Agent-wrong-nonce-extra-field-unknown-method-cross-context-zero-effect",
    );
    phase = "REGISTER";
    assertion = "register-exact-row";
    const sourceName = "route-proof",
      file = join(root, ".opencode/agents", `${sourceName}.md`),
      text =
        '\uFEFF---\r\n{"description":"Synthetic agent route","mode":"primary","color":"#123abc"}\r\n---\r\n  Inspect the synthetic changes.\r\n';
    await fs.mkdir(join(root, ".opencode/agents"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(file, text, { flag: "wx", mode: 0o600 });
    const owner = {
      runtimeEpoch: view.runtimeEpoch,
      operationId: "agent-prerequisite-register",
      workspaceId: workspace.workspaceId,
      workspacePath: root,
      sourceName,
      digest: createHash("sha256").update(text).digest("hex"),
    };
    record = parseAgentRuntimeRecord(text, owner);
    const recordDigest = nativeAgentDigest(record),
      registration = { owner, record, recordDigest, expectedNativeId: null };
    const registered = await nativeAgents.register(registration);
    assert.equal(registered.status, "registered");
    assert.deepEqual(registered.record, record);
    assert.equal(registered.defaultAgentId, observed.defaultAgentId);
    assert.deepEqual(await nativeAgents.register(registration), registered);
    const after = await list(),
      native = after.find((r) => r.id === record.id);
    assert.deepEqual(native, record);
    assert.equal(after[0].id, before[0].id);
    assert.deepEqual(
      after.filter((r) => r.id !== record.id),
      before,
    );
    assert.equal(policyMatches(native.permissions), true);
    assert.deepEqual(native.request, { settings: {}, headers: {}, body: {} });
    assert.equal(Object.hasOwn(native, "model"), false);
    assert.equal(await fs.readFile(file, "utf8"), text);
    assert.deepEqual(
      (
        await client.session.get(
          { sessionID: session.nativeSessionId },
          options(),
        )
      ).agent,
      baseline.agent,
    );
    const owned = await nativeAgents.observe({
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    });
    assert.deepEqual(owned.rows, [{ owner, record, recordDigest }]);
    pass(
      "actual-Agent-transform-reload-get-list-exact-overwritten-baseline-default-file-selection-preserved",
    );
    phase = "REFERENCES";
    assertion = "foreign-session-reference";
    const foreign = join(namespace, "foreign-reference");
    await fs.mkdir(foreign, { mode: 0o700 });
    const referenced = await client.session.create(
      {
        location: { directory: foreign },
        agent: record.id,
        permissions: BASELINE_POLICY.map((r) => ({ ...r })),
        title: "Contained agent reference",
      },
      options(),
    );
    assert.equal(referenced.agent, record.id);
    const refs = await readNativeAgentSessions(client);
    assert.ok(
      refs.some((r) => r.id === referenced.id && r.agent === record.id),
    );
    const removal = {
      owner: { ...owner, operationId: "agent-prerequisite-remove" },
      registration: owner,
      nativeId: record.id,
      recordDigest,
    };
    const beforeRemove = counts.remove;
    await assert.rejects(
      nativeAgents.remove(removal),
      (error) => error.code === "AGENT_IN_USE",
    );
    assert.equal(counts.remove, beforeRemove);
    assert.ok((await list()).some((r) => r.id === record.id));
    pass(
      "actual-global-foreign-session-reference-blocks-before-private-remove-RPC",
    );
    assertion = "controlled-reference-release";
    await client.session.switchAgent(
      { sessionID: referenced.id, agent: before[0].id },
      options(),
    );
    await client.session.update(
      {
        sessionID: referenced.id,
        permissions: BASELINE_POLICY.map((r) => ({ ...r })),
      },
      options(),
    );
    const changed = await client.session.get(
      { sessionID: referenced.id },
      options(),
    );
    assert.equal(changed.agent, before[0].id);
    assert.equal(policyMatches(changed.permissions), true);
    assert.deepEqual(
      await client.session.inbox.list({ sessionID: referenced.id }, options()),
      [],
    );
    assert.equal(
      (await client.session.active(options()))[referenced.id],
      undefined,
    );
    pass("controlled-SDK-agent-selection-baseline-preserved-no-model-no-inbox");
    phase = "REMOVE";
    assertion = "owned-removal";
    const removed = await nativeAgents.remove(removal);
    assert.equal(removed.status, "removed");
    assert.equal(removed.defaultAgentId, observed.defaultAgentId);
    assert.deepEqual(await nativeAgents.remove(removal), removed);
    assert.deepEqual(await list(), before);
    assert.equal(await fs.readFile(file, "utf8"), text);
    assert.equal(
      (await client.session.get({ sessionID: referenced.id }, options())).id,
      referenced.id,
    );
    assert.deepEqual(
      (
        await nativeAgents.observe({
          workspaceId: workspace.workspaceId,
          workspacePath: root,
        })
      ).rows,
      [],
    );
    pass(
      "actual-owned-Agent-remove-reload-default-file-and-existing-session-preserved",
    );
    return {
      cases,
      counts,
      nativeId: record.id,
      syntheticReference: { id: referenced.id, directory: foreign },
      authority:
        "Actual production owner/preflight/supervisor/fixedplugin/Main-private-adapter; synthetic direct prerequisite only, no public durable agent service or UI acceptance",
      limits: [
        "Foreign Native session reference exercised; archived reference is Node fixture plus pinned unfiltered store source, not a newly exercised Native archive API",
        "Controlled SDK switch is not app send or model consumption",
      ],
    };
  } catch (error) {
    throw Object.assign(new Error("Contained Agent prerequisite failed."), {
      code: `AGENT_PREREQUISITE_${phase}`,
      agentDiagnostic: {
        phase,
        assertion,
        ...(error?.code === "ERR_ASSERTION" && {
          operator: error.operator,
          location: String(error.stack).match(
            /native-agents-prerequisite\.mjs:\d+:\d+/u,
          )?.[0],
        }),
        completedCases: cases,
        ...(error.agentDifferences && {
          changedFields: error.agentDifferences,
        }),
        kind:
          error?.code === "ERR_ASSERTION"
            ? "Assertion"
            : typeof error?.type === "string" &&
                /^[A-Za-z_.]{1,64}$/u.test(error.type)
              ? error.type
              : "RuntimeError",
        ...(typeof error?.data?.code === "string" &&
          [
            "invalid_context",
            "nonce_mismatch",
            "identity_conflict",
            "retained_limit",
            "collision",
            "changed",
            "in_use",
          ].includes(error.data.code) && { refusal: error.data.code }),
      },
    });
  } finally {
    client.rpc = originalRpc;
    nonce = undefined;
  }
}
