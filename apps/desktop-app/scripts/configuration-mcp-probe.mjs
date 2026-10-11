// Saved production-module proof. Execution belongs to Main after coherent build.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { captureProvenance } from "./build-provenance.mjs";
import { createOwnerHost, cleanupOwnerHost } from "./p7-storage-probe.mjs";
import { createOSProcessIdentityAdapter } from "../src/sidecar-supervisor.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";
import { mcpNativeName } from "../src/host/workbench-mcp.mjs";
import { configurationFileWriteFits } from "../src/renderer/shared/configuration-draft/validation.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scripts = join(repository, "apps/desktop-app/scripts");
const legacyRelative =
  "docs/runs/configuration-mcp/evidence/prechange/legacy-storage-journal.bundle.mjs";
const legacySha =
  "7337542c0bb7b49e447188c75b762227ea250d9302df97dfe2534ee2f0efcc92";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
  const r = relative(root, path);
  return !!r && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};
const value = (response) => {
  assert.equal(response.ok, true, response.code);
  return response.value;
};
export function syntheticMcpProbeText(nodePath, serverPath, startup, marker) {
  const definition = {
    type: "local",
    command: [nodePath, serverPath, "--startup", startup, "--marker", marker],
    cwd: ".",
    disabled: false,
  };
  const text =
    JSON.stringify(
      { mcp: { servers: { demo: definition, uncertain: definition } } },
      null,
      2,
    ) + "\n";
  assert.equal(
    configurationFileWriteFits("mcp", text),
    true,
    "Synthetic source must satisfy the actual supported file validator before Native execution",
  );
  return text;
}
export async function claimMcpProbeOutput(sourceRoot, out) {
  const base = join(sourceRoot, "docs/runs/configuration-mcp/evidence"),
    destination = resolve(sourceRoot, out);
  assert.ok(inside(base, destination));
  assert.match(relative(base, destination), /^native-r[1-9][0-9]*$/);
  assert.equal(await fs.realpath(sourceRoot), sourceRoot);
  let current = sourceRoot;
  for (const part of relative(sourceRoot, destination).split(sep)) {
    current = join(current, part);
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (current === destination || error.code !== "EEXIST") throw error;
    }
    const stat = await fs.lstat(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(await fs.realpath(current), current);
  }
  await fs.writeFile(
    join(destination, ".configuration-mcp-claim"),
    "owned synthetic evidence\n",
    { flag: "wx", mode: 0o600 },
  );
  return destination;
}
export function validateSyntheticStartup(record, marker) {
  assert.deepEqual(Object.keys(record).sort(), ["marker", "pid"]);
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
  assert.equal(record.marker, marker);
  return record;
}
export function validateMcpExitEvent(event, before, attached) {
  assert.ok(before && attached);
  assert.equal(before.platform, "darwin");
  assert.ok(Number.isSafeInteger(before.pid) && before.pid > 0);
  for (const key of ["bootId", "startToken"])
    assert.match(before[key], /^[a-f0-9]{64}$/);
  assert.deepEqual(attached, before);
  assert.deepEqual(event, {
    event: "NOTE_EXIT",
    pid: before.pid,
    filter: "EVFILT_PROC",
  });
  return true;
}
async function identities() {
  const provenance = await captureProvenance(repository, {
    script: "smoke",
    mode: "dev",
    platform: "darwin",
  });
  const resources = join(repository, "apps/desktop-app/dist/resources"),
    eventHost = eventHostForResources(resources, "darwin", "arm64");
  const manifest = await verifyEventHostResources(eventHost, {
    platform: "darwin",
    arch: "arm64",
  });
  const require = createRequire(import.meta.url),
    electron = await fs.realpath(require("electron"));
  const paths = [
    fileURLToPath(import.meta.url),
    join(scripts, "p7-storage-probe.mjs"),
    join(scripts, "fixtures/p7-storage-owner-host.mjs"),
    join(scripts, "fixtures/mcp-exit-observer.py"),
    join(scripts, "fixtures/synthetic-mcp-server.mjs"),
    electron,
    process.execPath,
    join(repository, legacyRelative),
    ...[
      "workbench-service.mjs",
      "workbench-contract.mjs",
      "sidecar-supervisor.mjs",
      "host/workbench-mcp.mjs",
      "host/storage-journal.mjs",
      "host/workspace-registry.mjs",
    ].map((path) => join(repository, "apps/desktop-app/src", path)),
  ];
  assert.equal(
    await resourceFileSha256(join(repository, legacyRelative)),
    legacySha,
  );
  return {
    provenance,
    resources,
    eventHost,
    manifestSha256: digest(JSON.stringify(manifest)),
    hashes: await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: await resourceFileSha256(path),
      })),
    ),
  };
}
function deadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
// No polling/absence inference can satisfy this observer. READY follows kqueue attachment.
async function attachObserver(startup, adapter, tracked) {
  const before = await adapter.capture(startup.pid);
  assert.ok(before && before.pid === startup.pid);
  const child = spawn(
    "/usr/bin/python3",
    [join(scripts, "fixtures/mcp-exit-observer.py"), String(startup.pid), "45"],
    {
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  const record = {
    role: "synthetic-MCP-kernel-observer",
    pid: child.pid,
    target: before,
    child,
    exited: false,
  };
  tracked.push(record);
  record.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      record.exited = true;
      record.exit = { code, signal };
      resolve(record.exit);
    });
  });
  record.done.catch(() => {});
  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const next = async () => {
    const line = await deadline(lines.next(), 15000, "observer-line-deadline");
    assert.equal(line.done, false);
    return JSON.parse(line.value);
  };
  record.next = next;
  assert.deepEqual(await next(), { event: "READY", pid: startup.pid });
  record.attached = await adapter.capture(startup.pid);
  assert.deepEqual(record.attached, before);
  record.observerIdentity = await adapter.capture(child.pid);
  assert.ok(record.observerIdentity);
  return record;
}
async function finishObserver(record) {
  const event = await record.next();
  validateMcpExitEvent(event, record.target, record.attached);
  record.event = event;
  assert.deepEqual(
    await deadline(record.done, 15000, "observer-exit-deadline"),
    { code: 0, signal: null },
  );
}
export async function verifyLegacyMcpRefusal(directory, storeId) {
  const legacy = join(repository, legacyRelative);
  assert.equal(await resourceFileSha256(legacy), legacySha);
  const paths = ["journal.jsonl", "checkpoint.json"].map((name) =>
    join(directory, name),
  );
  const hashes = () => Promise.all(paths.map(resourceFileSha256));
  const before = await hashes();
  const { openStorageJournal } = await import(pathToFileURL(legacy).href);
  const old = await openStorageJournal({ directory, storeId });
  try {
    assert.equal(old.status().reason, "unsupported_version");
  } finally {
    await old.close();
  }
  assert.deepEqual(await hashes(), before);
  return {
    legacySha,
    before,
    after: await hashes(),
    reason: "unsupported_version",
  };
}
export async function runConfigurationMcpProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claimMcpProbeOutput(repository, args[1]);
  const tracked = [],
    observers = [];
  const report = {
    result: "fail",
    authority:
      "Actual production service/registry/owner/Event Host with explicit synthetic confirmation; no production Main",
    cases: [],
    limits: [
      "No provider, real network, auth UI, model consumption or foreground UI evidence.",
      "Exact synthetic MCP child only: macOS EVFILT_PROC/NOTE_EXIT; no arbitrary descendant/Windows exit proof.",
      "Native status alone is not process exit or configuration/CAS proof.",
      "All namespaces and failed evidence retained; no durable config or command copies in app metadata.",
      "Reopen trust uses existing explicit session.create and has that Native effect.",
    ],
  };
  let failed = false,
    phase = "identities",
    host,
    workspaceId,
    epoch = "configuration-mcp-one",
    namespace;
  const pass = (name, facts = {}) =>
    report.cases.push({ name, result: "pass", ...facts });
  const wire = (operation, id = randomUUID()) => ({
    version: 2,
    runtimeEpoch: epoch,
    [operation.type === "snapshot" ||
    operation.type.endsWith(".read") ||
    operation.type === "operation.lookup"
      ? "readId"
      : "operationId"]: id,
    operation,
  });
  const handle = (operation, id) =>
    host.request("handle", { envelope: wire(operation, id) });
  const observe = async () =>
    value(await handle({ type: "configuration.mcp.read", workspaceId }));
  const metrics = () => host.request("mcp-metrics");
  const mutate = async (action, extra = {}, id = randomUUID()) =>
    handle(
      {
        type: `configuration.mcp.${action}`,
        workspaceId,
        sourceName: "demo",
        requestId: id,
        expectedObservationVersion: (await observe()).version,
        ...extra,
      },
      id,
    );
  try {
    report.before = await identities();
    namespace = await fs.realpath(await fs.mkdtemp(join(output, "synthetic-")));
    report.retainedNamespace = namespace;
    const launch = async (bootstrap) => {
      phase = bootstrap ? "initial-owner-acquire" : "reopen-owner-acquire";
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
      phase = bootstrap ? "initial-native-start" : "reopen-native-start";
      const started = await host.request(
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
      phase = bootstrap ? "initial-start-shape" : "reopen-start-shape";
      assert.equal(started.blocked, false);
      assert.equal(started.spawned, 1);
      assert.equal(started.nativeVersion, "2.0.18");
      assert.equal(started.startupAuthority, "production-native-preflight");
      phase = bootstrap ? "initial-bootstrap-ready" : "reopen-bootstrap-ready";
      let snapshot;
      // Snapshot is available before the actual startup task settles. Wait for
      // its published ready state, without shortening any production checks.
      for (let n = 0; n < 300; n++) {
        snapshot = value(
          await handle({
            type: "snapshot",
            ...(workspaceId && { workspaceId }),
          }),
        );
        if (snapshot.state === "connected" && snapshot.selectedWorkspaceId)
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      report.lastBootstrapObservation = {
        state: snapshot.state,
        storeState: snapshot.recovery.store.state,
        workspaceCount: snapshot.workspaces.length,
        sessionCount: snapshot.sessions.length,
        resourceCount: snapshot.recovery.resources.length,
        selectedWorkspace: Boolean(snapshot.selectedWorkspaceId),
      };
      assert.equal(snapshot.state, "connected");
      assert.equal(snapshot.recovery.store.state, "ready");
      return snapshot;
    };
    phase = "production-owner-preflight";
    const snapshot = await launch(true);
    workspaceId = snapshot.selectedWorkspaceId;
    const workspace = snapshot.workspaces.find((w) => w.id === workspaceId);
    assert.ok(inside(namespace, workspace.path));
    const target = join(workspace.path, "opencode.json"),
      startup = join(namespace, "mcp-startup.jsonl"),
      marker = randomUUID();
    phase = "supported-MCP-file-baseline";
    const text = syntheticMcpProbeText(
      process.execPath,
      join(scripts, "fixtures/synthetic-mcp-server.mjs"),
      startup,
      marker,
    );
    // Synthetic fixture source only. Real app observation below establishes the baseline.
    await fs.writeFile(target, text, { flag: "wx", mode: 0o600 });
    const disk = await fs.readFile(target);
    const loaded = value(
      await handle({ type: "configuration.read", workspaceId, kind: "mcp" }),
    );
    assert.equal(loaded.status, "available");
    assert.equal(loaded.content, text);
    const registration = { text: loaded.content, fileVersion: loaded.version };
    phase = "denied-and-inactive-register";
    const denied = await mutate("register", registration);
    assert.equal(denied.code, "CANCELLED");
    assert.equal(denied.receipt.effect, "none");
    assert.equal((await metrics()).counts.add, 0);
    await host.request("mcp-confirmation", { enabled: true });
    const registrationId = randomUUID();
    const registered = await mutate("register", registration, registrationId);
    assert.equal(registered.receipt.effect, "confirmed");
    assert.equal(registered.value.status, "registered_disabled");
    assert.equal(
      registered.value.nativeName,
      mcpNativeName(workspaceId, "demo"),
    );
    assert.equal(
      (await observe()).servers.find((row) => row.sourceName === "demo").status,
      "disabled",
    );
    await assert.rejects(fs.lstat(startup), { code: "ENOENT" });
    pass("default-denied-then-register-disabled-zero-synthetic-starts");
    const collisionCounts = (await metrics()).counts;
    assert.equal(
      (await mutate("register", registration)).code,
      "MCP_OWNERSHIP_CONFLICT",
    );
    assert.equal((await metrics()).counts.add, collisionCounts.add);
    const staleObservation = await observe();
    const changed = await handle({
      type: "configuration.mcp.connect",
      workspaceId,
      sourceName: "demo",
      requestId: randomUUID(),
      expectedObservationVersion:
        staleObservation.version === "a".repeat(64)
          ? "b".repeat(64)
          : "a".repeat(64),
    });
    assert.equal(changed.code, "MCP_CHANGED");
    assert.equal(changed.receipt.effect, "none");
    pass("current-owned-collision-and-changed-token-zero-effects");
    const counts = (await metrics()).counts;
    const lookup = value(
      await handle({
        type: "operation.lookup",
        runtimeEpoch: epoch,
        operationId: registrationId,
      }),
    );
    assert.deepEqual(lookup.receipt, registered.receipt);
    assert.deepEqual((await metrics()).counts, counts);
    pass("original-composite-receipt-lookup-no-replay", {
      key: { runtimeEpoch: epoch, operationId: registrationId },
    });
    const adapter = createOSProcessIdentityAdapter();
    const startupRecord = async (index) => {
      const rows = (await fs.readFile(startup, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(rows.length, index + 1);
      return validateSyntheticStartup(rows[index], marker);
    };
    for (const [index, stop] of [
      [0, "disconnect"],
      [1, "remove"],
    ]) {
      phase = `connect-${index + 1}`;
      const connected = await mutate("connect");
      assert.equal(connected.receipt.effect, "confirmed");
      assert.equal(connected.value.connectionStatus, "connected");
      const child = await startupRecord(index);
      const observer = await attachObserver(child, adapter, observers);
      phase = `${stop}-kernel-exit`;
      const stopped = await mutate(stop);
      assert.equal(stopped.receipt.effect, "confirmed");
      assert.equal(
        stopped.value.status,
        stop === "remove" ? "removed" : "connection_status",
      );
      if (stop === "disconnect")
        assert.equal(stopped.value.connectionStatus, "disabled");
      await finishObserver(observer);
      pass(`actual-connect-${stop}-exact-live-synthetic-kernel-exit`, {
        identity: observer.target,
        event: observer.event,
        observerExit: observer.exit,
      });
    }
    assert.deepEqual((await observe()).servers, []);
    assert.deepEqual(await fs.readFile(target), disk);
    // Leave an inactive registration for restart: no process can exist here.
    const historical = await mutate("register", registration);
    assert.equal(historical.value.status, "registered_disabled");
    await host.request("checkpoint");
    const persisted = await host.request("view");
    assert.deepEqual(persisted.retainedOperations, []);
    const metadata = host.record.durable.metadata;
    for (const name of ["journal.jsonl", "checkpoint.json"]) {
      const bytes = await fs.readFile(join(metadata, name), "utf8");
      assert.equal(bytes.includes("synthetic-mcp-server.mjs"), false);
      assert.equal(bytes.includes("mcp-startup.jsonl"), false);
      assert.equal(bytes.includes(text), false);
    }
    pass("supported-full-file-byte-preserved-no-durable-command-config-copies");
    phase = "reopen-no-automatic-activation";
    await cleanupOwnerHost(host.record, { timeoutMs: 20000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.nativeExitConfirmed, true);
    const oldEpoch = epoch;
    epoch = "configuration-mcp-reopen";
    const reopened = await launch(false);
    assert.equal(
      reopened.workspaces.find((w) => w.id === workspaceId).trusted,
      false,
    );
    const reopenedCounts = await metrics();
    assert.equal(reopenedCounts.counts.add, 0);
    assert.equal(reopenedCounts.counts.connect, 0);
    assert.deepEqual(reopenedCounts.confirmations, []);
    assert.equal(
      (await handle({ type: "configuration.mcp.read", workspaceId })).code,
      "INVALID_SELECTION",
    );
    const historicalLookup = value(
      await handle({
        type: "operation.lookup",
        runtimeEpoch: oldEpoch,
        operationId: historical.receipt.operationId,
      }),
    );
    assert.deepEqual(historicalLookup.receipt, historical.receipt);
    const trust = await handle({
      type: "session.create",
      workspaceId,
      title: "Synthetic explicit MCP reopen trust",
    });
    assert.equal(trust.ok, true);
    assert.equal(trust.receipt.effect, "confirmed");
    const afterTrust = await observe();
    assert.equal(afterTrust.status, "observed");
    assert.ok(afterTrust.servers.every((row) => row.ownership === "unowned"));
    const afterExplicitRead = await metrics();
    assert.equal(afterExplicitRead.counts.list, reopenedCounts.counts.list + 1);
    for (const method of ["add", "connect", "disconnect", "remove"])
      assert.equal(
        afterExplicitRead.counts[method],
        reopenedCounts.counts[method],
      );
    assert.deepEqual(
      afterExplicitRead.confirmations,
      reopenedCounts.confirmations,
    );
    assert.equal((await startupRecord(1)).marker, marker);
    assert.deepEqual(await fs.readFile(target), disk);
    pass(
      "restart-live-authority-expires-historical-only-no-automatic-MCP-effects",
      {
        oldEpoch,
        newEpoch: epoch,
        explicitTrustEffect: "session.create",
        catalog: afterTrust,
      },
    );
    phase = "controlled-service-unknown-original-key-hold";
    await host.request("mcp-confirmation", { enabled: true });
    await host.request("mcp-fault", { mode: "next-add-postread" });
    const unknownId = randomUUID();
    const unknown = await mutate(
      "register",
      { ...registration, sourceName: "uncertain" },
      unknownId,
    );
    assert.equal(unknown.receipt.effect, "unknown");
    assert.equal(unknown.receipt.result, undefined);
    assert.equal(
      (await handle({ type: "configuration.mcp.read", workspaceId })).code,
      "UNAVAILABLE",
    );
    const unknownCounts = (await metrics()).counts;
    const original = value(
      await handle({
        type: "operation.lookup",
        runtimeEpoch: epoch,
        operationId: unknownId,
      }),
    );
    assert.deepEqual(original.receipt, unknown.receipt);
    const held = value(await handle({ type: "snapshot", workspaceId }));
    assert.ok(
      held.recovery.resources.some(
        (row) =>
          row.workspaceId === workspaceId &&
          row.reason === "unresolved_operation",
      ),
    );
    assert.deepEqual((await metrics()).counts, unknownCounts);
    assert.deepEqual(await fs.readFile(target), disk);
    await host.request("checkpoint");
    pass(
      "controlled-actual-service-unknown-original-key-lookup-workspace-hold-no-replay",
      {
        authority:
          "explicit post-add read failure injection; not Native behavior",
        key: { runtimeEpoch: epoch, operationId: unknownId },
      },
    );
  } catch (error) {
    failed = true;
    report.failure = {
      phase,
      reason: "bounded-MCP-proof-failed",
      ...(typeof error.code === "string" &&
        /^[A-Z0-9_-]{1,64}$/.test(error.code) && { code: error.code }),
    };
  } finally {
    for (const record of tracked)
      try {
        if (!record.exited)
          await cleanupOwnerHost(record, { timeoutMs: 20000 });
      } catch {
        failed = true;
        report.cleanupFailure = "owned-exit-unconfirmed";
      }
    for (const record of observers) {
      try {
        if (!record.event && record.attached) await finishObserver(record);
        assert.equal(record.exited, true, "observer not exited");
      } catch {
        failed = true;
        // Only our direct observer child is signalled; no inferred descendants.
        if (!record.exited) record.child.kill("SIGTERM");
        try {
          await deadline(record.done, 15000, "observer-cleanup-deadline");
        } catch {
          report.observerCleanupFailure = true;
        }
      }
    }
    if (!failed && tracked.length === 2)
      try {
        const manifest = JSON.parse(
          await fs.readFile(
            join(tracked[0].durable.root, "manifest.json"),
            "utf8",
          ),
        );
        report.legacy = await verifyLegacyMcpRefusal(
          tracked[0].durable.metadata,
          manifest.storeId,
        );
        pass(
          "actual-immutable-old-parser-refuses-MCP-feature-checkpoint-byte-preserved",
        );
      } catch {
        failed = true;
        report.legacyFailure = "actual-legacy-refusal-unproved";
      }
    try {
      report.afterCleanup = await identities();
      assert.deepEqual(report.afterCleanup, report.before);
    } catch {
      failed = true;
      report.identityFailure = "after-cleanup-identity-mismatch";
    }
    report.cleanup = tracked.map((record) => ({
      namespace: record.namespace,
      identity: record.identity,
      exited: record.exited,
      exit: record.exit,
      nativeExitConfirmed: record.nativeExitConfirmed,
      nativeStopResult: record.nativeStopResult,
      cleanup: record.cleanup,
    }));
    report.observers = observers.map(
      ({ child: _child, done: _done, next: _next, ...record }) => record,
    );
    if (
      tracked.some(
        (record) =>
          !record.exited ||
          !record.nativeExitConfirmed ||
          record.cleanup?.explicitCleanupFailed,
      ) ||
      observers.some(
        (record) => !record.exited || record.exit?.code !== 0 || !record.event,
      )
    )
      failed = true;
    report.result = failed ? "fail" : "pass";
    await fs.writeFile(
      join(output, "configuration-mcp-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  return {
    result: report.result,
    evidence: join(output, "configuration-mcp-evidence.json"),
    cases: report.cases.length,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runConfigurationMcpProbe().then(
    (result) => {
      console.log(JSON.stringify(result));
      if (result.result !== "pass") process.exitCode = 1;
    },
    () => {
      console.log(
        JSON.stringify({ result: "fail", reason: "probe-setup-failed" }),
      );
      process.exitCode = 1;
    },
  );
