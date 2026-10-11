// Explicit contained test only. All outcomes come from the actual public service/Native.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import {
  BASELINE_POLICY,
  policyMatches,
} from "../../src/workbench-contract.mjs";

export async function runAgentsPublic({
  runtime,
  registry,
  service,
  namespace,
  confirmation,
  counts,
  saveTrace = [],
}) {
  const view = registry.readView(),
    workspace = view.workspaces[0],
    session = view.sessions.find(
      (s) => s.workspaceId === workspace?.workspaceId,
    );
  assert.ok(workspace && session);
  const workspaceId = workspace.workspaceId,
    root = workspace.canonicalPath,
    epoch = view.runtimeEpoch;
  const rel = relative(namespace, root);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
  const { client } = runtime.workbenchContext(),
    options = () => ({ signal: AbortSignal.timeout(10000) });
  const cases = [],
    pass = (name) => cases.push({ name, result: "pass" });
  let number = 0,
    phase = "FILES";
  const handle = (operation, key) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: epoch,
        ...([
          "snapshot",
          "catalog.list",
          "operation.lookup",
          "configuration.agent.list",
          "configuration.agent.read",
          "configuration.agent.runtime.read",
        ].includes(operation.type)
          ? { readId: `agent-public-${++number}` }
          : { operationId: key }),
        operation,
      },
      "contained-agent-public-proof",
    );
  const observed = async () => {
    const r = await handle({
      type: "configuration.agent.runtime.read",
      workspaceId,
      sourceName: "service-proof",
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.status, "observed");
    return r.value;
  };
  const request = (o, key) => ({
    type: "configuration.agent.register",
    workspaceId,
    sourceName: "service-proof",
    requestId: key,
    observationId: o.observationId,
    version: o.file.version,
    directoryVersion: o.file.directoryVersion,
    digest: o.file.digest,
  });
  try {
    assert.equal(typeof epoch, "string");
    assert.deepEqual(counts, { observe: 0, register: 0, remove: 0 });
    const path = join(root, ".opencode/agents/service-proof.md");
    await fs.mkdir(join(root, ".opencode/agents"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(path, "# Original synthetic agent\n", {
      flag: "wx",
      mode: 0o600,
    });
    const file = await handle({
      type: "configuration.agent.read",
      workspaceId,
      sourceName: "service-proof",
    });
    assert.equal(file.ok, true);
    assert.equal(file.value.status, "available");
    const text =
      '\uFEFF---\r\n{"description":"Service Agent","mode":"primary","color":"#123abc"}\r\n---\r\n# Exact synthetic system\r\n';
    const saved = await handle(
      {
        type: "configuration.agent.save",
        workspaceId,
        sourceName: "service-proof",
        requestId: "agent-public-save",
        text,
        expectation: "version",
        version: file.value.version,
        directoryVersion: file.value.directoryVersion,
      },
      "agent-public-save",
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.receipt.effect, "confirmed");
    assert.equal(saved.receipt.result.kind, "agent_file_saved");
    assert.equal(await fs.readFile(path, "utf8"), text);
    assert.deepEqual(counts, { observe: 0, register: 0, remove: 0 });
    pass(
      "actual-public-descriptor-file-save-exact-BOM-CRLF-backup-no-Native-agent-calls",
    );
    phase = "REGISTER";
    const selectedBefore = await client.session.get(
      { sessionID: session.nativeSessionId },
      options(),
    );
    const cancelRequest = request(await observed(), "agent-public-cancel");
    const cancelled = await handle(cancelRequest, cancelRequest.requestId);
    assert.equal(cancelled.code, "CANCELLED");
    assert.equal(cancelled.receipt.effect, "none");
    assert.equal(counts.register, 0);
    confirmation.enabled = true; // Explicit synthetic confirmation, never production Main dialog.
    const before = await observed(),
      registration = request(before, "agent-public-register");
    const registered = await handle(registration, registration.requestId);
    assert.equal(registered.ok, true);
    assert.equal(registered.receipt.effect, "confirmed");
    assert.equal(registered.receipt.result.kind, "agent_registered");
    const after = await observed(),
      row = after.owned.find((r) => r.nativeId === registered.value.nativeId);
    assert.ok(row);
    assert.deepEqual(row.permissions, BASELINE_POLICY);
    assert.equal(row.system, "# Exact synthetic system");
    assert.equal(row.mode, "primary");
    assert.equal(row.hidden, false);
    assert.equal(row.referenceCount, 0);
    assert.equal(after.defaultAgentId, before.defaultAgentId);
    assert.deepEqual(
      await client.session.get(
        { sessionID: session.nativeSessionId },
        options(),
      ),
      selectedBefore,
    );
    assert.equal(await fs.readFile(path, "utf8"), text);
    const duplicated = await handle(registration, registration.requestId);
    assert.deepEqual(duplicated.receipt.result, registered.receipt.result);
    assert.equal(counts.register, 1);
    const catalog = await handle({ type: "catalog.list", workspaceId });
    assert.equal(catalog.ok, true);
    assert.ok(catalog.value.agents.entries.some((r) => r.id === row.nativeId));
    pass(
      "actual-public-cancel-confirm-register-exact-baseline-default-session-file-catalog-and-original-duplicate",
    );
    phase = "REFERENCES";
    const foreign = join(namespace, "public-agent-foreign");
    await fs.mkdir(foreign, { mode: 0o700 });
    const referenced = await client.session.create(
      {
        location: { directory: foreign },
        agent: row.nativeId,
        permissions: globalThis.structuredClone(BASELINE_POLICY),
        title: "Contained public agent reference",
      },
      options(),
    );
    assert.equal(referenced.agent, row.nativeId);
    const inUse = await observed();
    assert.ok(
      inUse.owned.find((r) => r.nativeId === row.nativeId).referenceCount >= 1,
    );
    const denied = await handle(
      {
        type: "configuration.agent.remove",
        workspaceId,
        requestId: "agent-public-in-use",
        nativeId: row.nativeId,
        observationId: inUse.observationId,
      },
      "agent-public-in-use",
    );
    assert.equal(denied.code, "AGENT_IN_USE");
    assert.equal(denied.receipt.effect, "none");
    assert.equal(counts.remove, 0);
    await client.session.switchAgent(
      { sessionID: referenced.id, agent: before.defaultAgentId },
      options(),
    );
    await client.session.update(
      {
        sessionID: referenced.id,
        permissions: globalThis.structuredClone(BASELINE_POLICY),
      },
      options(),
    );
    const released = await client.session.get(
      { sessionID: referenced.id },
      options(),
    );
    assert.equal(released.agent, before.defaultAgentId);
    assert.equal(policyMatches(released.permissions), true);
    assert.deepEqual(
      await client.session.inbox.list({ sessionID: referenced.id }, options()),
      [],
    );
    assert.equal(
      (await client.session.active(options()))[referenced.id],
      undefined,
    );
    pass(
      "actual-public-global-foreign-reference-count-in-use-zero-dispatch-and-explicit-controlled-release-no-model",
    );
    phase = "REMOVE";
    const removal = {
      type: "configuration.agent.remove",
      workspaceId,
      requestId: "agent-public-remove",
      nativeId: row.nativeId,
      observationId: (await observed()).observationId,
    };
    const removed = await handle(removal, removal.requestId);
    assert.equal(removed.ok, true);
    assert.equal(removed.receipt.effect, "confirmed");
    assert.equal(removed.receipt.result.kind, "agent_removed");
    assert.equal((await observed()).owned.length, 0);
    assert.equal(await fs.readFile(path, "utf8"), text);
    assert.deepEqual(
      await client.session.get(
        { sessionID: session.nativeSessionId },
        options(),
      ),
      selectedBefore,
    );
    assert.equal(
      (await handle(removal, removal.requestId)).receipt.effect,
      "confirmed",
    );
    assert.equal(counts.remove, 1);
    pass(
      "actual-public-owned-remove-keeps-default-original-session-history-and-file-duplicate-no-repeat",
    );
    phase = "HISTORICAL-REGISTRATION";
    const retainedRequest = request(
      await observed(),
      "agent-public-historical-register",
    );
    const historical = await handle(retainedRequest, retainedRequest.requestId);
    assert.equal(historical.ok, true);
    assert.equal(historical.receipt.effect, "confirmed");
    assert.notEqual(historical.value.nativeId, row.nativeId);
    pass(
      "actual-public-new-generation-distinct-Native-id-confirmed-receipt-before-clean-restart",
    );
    return {
      cases,
      workspaceId,
      sessionId: session.appSessionId,
      sourceName: "service-proof",
      syntheticReference: { id: referenced.id, directory: foreign },
      nativeId: historical.value.nativeId,
      registrationOperationId: retainedRequest.requestId,
      runtimeEpoch: epoch,
      path,
      digest: historical.value.digest,
      systemDigest: historical.value.systemDigest,
      counts: { ...counts },
      authority:
        "Actual public durable service and actual Native; confirmations explicitly synthetic; controlled foreign SDK selection no provider/model",
    };
  } catch (error) {
    throw Object.assign(
      new Error("Contained public Agent service proof failed."),
      {
        code: `AGENT_PUBLIC_${phase}`,
        agentDiagnostic: {
          phase,
          saveTrace,
          completedCases: cases,
          ...(error.code === "ERR_ASSERTION" && {
            operator: error.operator,
            location: String(error.stack).match(
              /native-agents-public\.mjs:\d+:\d+/u,
            )?.[0],
          }),
          ...(typeof error.appCode === "string" && { code: error.appCode }),
        },
      },
    );
  }
}

// Explicit fixture cleanup after proving Agent removal retained both sessions.
// This is separate from the product Agent operation and never handles mapped sessions.
export async function cleanupSyntheticAgentReferences({
  client,
  registry,
  namespace,
  references,
}) {
  assert.equal(references.length, 2);
  const mapped = new Set(
    registry.readView().sessions.map((s) => s.nativeSessionId),
  );
  const allowed = new Set([
    join(namespace, "foreign-reference"),
    join(namespace, "public-agent-foreign"),
  ]);
  assert.equal(new Set(references.map((r) => r.id)).size, 2);
  for (const row of references) {
    assert.equal(mapped.has(row.id), false);
    assert.equal(allowed.delete(row.directory), true);
    const options = { signal: AbortSignal.timeout(10000) };
    const actual = await client.session.get({ sessionID: row.id }, options);
    assert.equal(actual.id, row.id);
    assert.equal(actual.location.directory, row.directory);
    assert.equal(policyMatches(actual.permissions), true);
    assert.deepEqual(
      await client.session.inbox.list({ sessionID: row.id }, options),
      [],
    );
    assert.equal((await client.session.active(options))[row.id], undefined);
  }
  for (const row of references)
    await client.session.remove(
      { sessionID: row.id },
      { signal: AbortSignal.timeout(10000) },
    );
  const { readNativeAgentSessions } = await import(
    "../../src/host/workbench-native-agents.mjs"
  );
  const remaining = await readNativeAgentSessions(client);
  assert.deepEqual(new Set(remaining.map((r) => r.id)), mapped);
  return {
    removedSyntheticReferences: 2,
    mappedSessionsPreserved: true,
    authority:
      "Explicit probe-only cleanup of exact two created unmapped synthetic reference sessions; separate from Agent removal",
  };
}
