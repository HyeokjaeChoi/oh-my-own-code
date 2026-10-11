// Main-only contained actual public service proof. Never launches production Main or a model.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import { createOwnerHost, cleanupOwnerHost } from "./p7-storage-probe.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function identities() {
  const provenance = await captureProvenance(repository, {
      script: "smoke",
      mode: "dev",
      platform: "darwin",
    }),
    resources = join(repository, "apps/desktop-app/dist/resources"),
    eventHost = eventHostForResources(resources, "darwin", "arm64");
  const manifest = await verifyEventHostResources(eventHost, {
    platform: "darwin",
    arch: "arm64",
  });
  const paths = [
    fileURLToPath(import.meta.url),
    ...[
      "scripts/fixtures/native-agents-prerequisite.mjs",
      "scripts/fixtures/native-agents-public.mjs",
      "scripts/fixtures/p7-storage-owner-host.mjs",
      "scripts/p7-storage-probe.mjs",
      "src/native-agents-client.mjs",
      "src/host/workbench-native-agents.mjs",
    ].map((p) => join(repository, "apps/desktop-app", p)),
    process.execPath,
    await fs.realpath(createRequire(import.meta.url)("electron")),
  ];
  return {
    provenance,
    resources,
    eventHost,
    manifestSha256: sha(JSON.stringify(manifest)),
    hashes: await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: await resourceFileSha256(path),
      })),
    ),
  };
}
async function inventory(root, prefix = "") {
  const result = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name),
      name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal((await fs.lstat(path)).isSymbolicLink(), false);
    if (entry.isDirectory()) result.push(...(await inventory(path, name)));
    else {
      assert.ok(entry.isFile());
      const bytes = await fs.readFile(path);
      result.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return result;
}
async function claim(out) {
  const base = join(repository, "docs/runs/configuration-agents/evidence"),
    path = resolve(repository, out),
    rel = relative(base, path);
  assert.ok(!isAbsolute(rel) && /^native-r[1-9][0-9]*$/u.test(rel));
  let current = repository;
  for (const part of relative(repository, path).split(sep)) {
    current = join(current, part);
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST" || current === path) throw error;
    }
    assert.equal(await fs.realpath(current), current);
    assert.ok((await fs.lstat(current)).isDirectory());
  }
  return path;
}
export async function runAgentProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claim(args[1]),
    tracked = [],
    report = {
      result: "fail",
      scope:
        "Actual production owner/preflight/supervisor/fixedplugin/private prerequisite AND public durable Agent service; UI/model consumption separate",
      cases: [],
      limits: [
        "Contained synthetic auth-free stores only; no model/provider/private stores/production Main/foreground",
        "Foreign references actual Native; archived reference Node+source proof only",
        "Namespaces retained on success/failure; no recursive cleanup",
      ],
    };
  let phase = "identity",
    host,
    failed = false;
  try {
    report.before = await identities();
    const namespace = await fs.realpath(
      await fs.mkdtemp(join(output, "synthetic-")),
    );
    report.retainedNamespace = namespace;
    const launch = async (epoch, bootstrap) => {
      host = await createOwnerHost(namespace, tracked);
      assert.equal(
        (
          await host.request("acquire", {
            productionAuthority: true,
            resourcesPath: report.before.resources,
            initialize: host.record.durable.fresh,
          })
        ).state,
        "ready",
      );
      return host.request(
        "start",
        {
          eventHost: report.before.eventHost,
          binaryPath: join(
            report.before.resources,
            "opencode/darwin-arm64/opencode",
          ),
          runtimeEpoch: epoch,
          useProductionPreflight: true,
          bootstrap,
        },
        { timeoutMs: 480000 },
      );
    };
    phase = "fresh-start";
    const started = await launch("agent-prerequisite-one", true);
    assert.equal(started.blocked, false);
    assert.equal(started.spawned, 1);
    assert.equal(started.fresh, true);
    let ready = false;
    for (let n = 0; n < 300; n++) {
      const snapshot = await host.request("handle", {
        envelope: {
          version: 2,
          runtimeEpoch: "agent-prerequisite-one",
          readId: `snapshot-${n}`,
          operation: { type: "snapshot" },
        },
      });
      assert.equal(snapshot.ok, true);
      if (
        snapshot.value.state === "connected" &&
        snapshot.value.selectedWorkspaceId
      ) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready, true);
    assert.equal(
      await fs.readFile(
        join(host.record.durable.config, "opencode/opencode.json"),
        "utf8",
      ),
      "{}\n",
    );
    phase = "actual-private-agent-route";
    report.prerequisite = await host.request(
      "agents-prerequisite",
      {},
      { timeoutMs: 120000 },
    );
    report.cases.push(...report.prerequisite.cases);
    phase = "actual-public-agent-service";
    await host.request("configuration-save-confirmation", { enabled: true });
    report.service = await host.request(
      "agents-public",
      {},
      { timeoutMs: 120000 },
    );
    report.cases.push(...report.service.cases);
    phase = "explicit-synthetic-reference-cleanup";
    report.referenceCleanup = await host.request("agents-reference-cleanup");
    assert.equal(report.referenceCleanup.removedSyntheticReferences, 2);
    assert.equal(report.referenceCleanup.mappedSessionsPreserved, true);
    report.cases.push({
      name: "explicit-probe-only-cleanup-two-unmapped-reference-sessions-after-Agent-removal-preservation-proof",
      result: "pass",
    });
    phase = "clean-production-reopen";
    await cleanupOwnerHost(host.record, { timeoutMs: 60000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.exit.code, 0);
    assert.equal(host.record.nativeExitConfirmed, true);
    let epoch = "agent-reopen-two",
      number = 0;
    const wire = (operation, operationId) => ({
      version: 2,
      runtimeEpoch: epoch,
      ...(operationId
        ? { operationId }
        : { readId: `agent-probe-${++number}` }),
      operation,
    });
    const handle = (operation, id) =>
      host.request("handle", { envelope: wire(operation, id) });
    const reopened = await launch(epoch, false);
    assert.equal(reopened.blocked, false);
    assert.equal(reopened.fresh, false);
    assert.equal(reopened.spawned, 1);
    let connected;
    for (let n = 0; n < 300; n++) {
      const snap = await handle({ type: "snapshot" });
      assert.equal(snap.ok, true);
      if (snap.value.state === "connected") {
        connected = snap.value;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(connected);
    assert.deepEqual((await host.request("agents-metrics")).counts, {
      observe: 0,
      register: 0,
      remove: 0,
    });
    const { workspaceId, sourceName } = report.service;
    const untrusted = await handle({
      type: "configuration.agent.runtime.read",
      workspaceId,
      sourceName,
    });
    assert.equal(untrusted.code, "INVALID_SELECTION");
    const trust = await handle(
      {
        type: "session.create",
        workspaceId,
        title: "Explicit synthetic Agent trust session",
      },
      "agent-explicit-trust",
    );
    assert.equal(trust.ok, true);
    assert.equal(trust.receipt.effect, "confirmed");
    const observed = await handle({
      type: "configuration.agent.runtime.read",
      workspaceId,
      sourceName,
    });
    assert.equal(observed.ok, true);
    assert.equal(observed.value.status, "observed");
    assert.equal(observed.value.owned.length, 0);
    assert.equal(
      observed.value.unowned.some(
        (r) => r.nativeId === report.service.nativeId,
      ),
      false,
    );
    const historical = await handle({
      type: "operation.lookup",
      runtimeEpoch: report.service.runtimeEpoch,
      operationId: report.service.registrationOperationId,
    });
    assert.equal(historical.value.status, "found");
    assert.equal(
      historical.value.receipt.result.nativeId,
      report.service.nativeId,
    );
    report.cases.push({
      name: "actual-clean-production-restart-zero-auto-agent-calls-untrusted-explicit-trust-new-session-historical-receipt-only",
      result: "pass",
    });
    phase = "controlled-post-effect-ack-loss";
    await host.request("agents-confirmation", { enabled: true });
    await host.request("agents-fault", { mode: "next-register-ack" });
    const fresh = await handle({
      type: "configuration.agent.runtime.read",
      workspaceId,
      sourceName,
    });
    assert.equal(fresh.ok, true);
    const request = {
      type: "configuration.agent.register",
      workspaceId,
      sourceName,
      requestId: "agent-public-unknown",
      observationId: fresh.value.observationId,
      version: fresh.value.file.version,
      directoryVersion: fresh.value.file.directoryVersion,
      digest: fresh.value.file.digest,
    };
    const uncertain = await handle(request, request.requestId);
    assert.equal(uncertain.receipt.effect, "unknown");
    assert.equal(uncertain.receipt.result, undefined);
    assert.equal(
      (await handle(request, request.requestId)).receipt.effect,
      "unknown",
    );
    assert.equal((await host.request("agents-metrics")).counts.register, 1);
    assert.equal(
      (
        await handle({
          type: "operation.lookup",
          runtimeEpoch: epoch,
          operationId: request.requestId,
        })
      ).value.receipt.effect,
      "unknown",
    );
    const retained = await handle({ type: "snapshot" });
    assert.ok(
      retained.value.retainedOperations.some(
        (r) => r.runtimeEpoch === epoch && r.operationId === request.requestId,
      ),
    );
    const unknownEpoch = epoch;
    await cleanupOwnerHost(host.record, { timeoutMs: 60000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.exit.code, 0);
    assert.equal(host.record.nativeExitConfirmed, true);
    const beforeData = await inventory(host.record.durable.data),
      beforeConfig = await inventory(host.record.durable.config);
    epoch = "agent-pending-three";
    const blocked = await launch(epoch, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.spawned, 0);
    assert.equal(blocked.reason, "native_startup_unverified");
    const processes = await host.request("probe-processes");
    assert.equal(processes.nativeSpawnCount, 0);
    assert.ok(
      !processes.descendants.some((r) =>
        ["native", "inspector"].includes(r.role),
      ),
    );
    assert.deepEqual(await inventory(host.record.durable.data), beforeData);
    assert.deepEqual(await inventory(host.record.durable.config), beforeConfig);
    assert.equal(
      (
        await handle({
          type: "operation.lookup",
          runtimeEpoch: unknownEpoch,
          operationId: request.requestId,
        })
      ).value.receipt.effect,
      "unknown",
    );
    report.controlledUnknown = {
      runtimeEpoch: unknownEpoch,
      operationId: request.requestId,
      actualRegisterCalls: 1,
      authority:
        "Explicit synthetic service ACK loss AFTER actual Native result; Native outcome never fabricated",
      beforeData,
      beforeConfig,
    };
    report.cases.push({
      name: "actual-registration-controlled-ACK-loss-original-unknown-no-replay-pending-reopen-zero-inspector-Native-byte-preserved",
      result: "pass",
    });
  } catch (error) {
    failed = true;
    report.failure = {
      phase,
      reason: "bounded-Agent-prerequisite-failed",
      ...(error.agentDiagnostic && { agentDiagnostic: error.agentDiagnostic }),
      ...(typeof error.code === "string" &&
        /^[A-Z0-9_-]{1,64}$/u.test(error.code) && { code: error.code }),
      ...(error.code === "ERR_ASSERTION" && {
        assertion: {
          operator: error.operator,
          location: String(error.stack).match(
            /configuration-agent-probe\.mjs:\d+:\d+/u,
          )?.[0],
        },
      }),
    };
    process.stdout.write(
      JSON.stringify({ boundedFailure: report.failure }) + "\n",
    );
  } finally {
    for (const record of tracked) {
      if (!record.exited) await cleanupOwnerHost(record, { timeoutMs: 60000 });
      if (
        !record.exited ||
        !record.nativeExitConfirmed ||
        record.exit?.code !== 0 ||
        record.cleanup?.fallbackDisconnect
      )
        failed = true;
    }
    try {
      report.after = await identities();
      assert.deepEqual(report.after, report.before);
    } catch {
      failed = true;
      report.identityFailure = true;
    }
    report.cleanup = tracked.map(
      ({
        namespace,
        identity,
        exited,
        exit,
        nativeExitConfirmed,
        nativeStopResult,
        cleanup,
      }) => ({
        namespace,
        identity,
        exited,
        exit,
        nativeExitConfirmed,
        nativeStopResult,
        cleanup,
      }),
    );
    report.result = failed ? "fail" : "pass";
    await fs.writeFile(
      join(output, "agent-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  assert.equal(
    report.result,
    "pass",
    `Agent prerequisite failed at ${report.failure?.phase ?? "cleanup-or-identity"}`,
  );
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runAgentProbe()
    .then((r) =>
      process.stdout.write(
        JSON.stringify({ result: r.result, cases: r.cases.length }) + "\n",
      ),
    )
    .catch((e) => {
      process.stderr.write(e.message + "\n");
      process.exitCode = 1;
    });
