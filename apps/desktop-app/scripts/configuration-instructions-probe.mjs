// Controlled production kernel/private IPC/service proof. Never production Main.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import { createOwnerHost, cleanupOwnerHost } from "./p7-storage-probe.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";
import {
  INSTRUCTION_KEY,
  instructionDigest,
} from "../src/host/workbench-instructions.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
  const r = relative(root, path);
  return !!r && r !== ".." && !r.startsWith(`..${sep}`) && !r.startsWith(sep);
};
const value = (response) => {
  assert.equal(response.ok, true, response.code);
  return response.value;
};
export async function claimInstructionProbeOutput(sourceRoot, out) {
  const base = join(
      sourceRoot,
      "docs/runs/configuration-instructions/evidence",
    ),
    destination = resolve(sourceRoot, out);
  assert.ok(inside(base, destination));
  assert.match(relative(base, destination), /^native-r[1-9][0-9]*$/);
  let current = sourceRoot;
  assert.equal(await fs.realpath(sourceRoot), sourceRoot);
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
    join(destination, ".configuration-instructions-claim"),
    "owned synthetic evidence\n",
    { flag: "wx", mode: 0o600 },
  );
  return destination;
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
    join(repository, "apps/desktop-app/scripts/p7-storage-probe.mjs"),
    join(
      repository,
      "apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs",
    ),
    electron,
    join(
      repository,
      "docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs",
    ),
  ];
  assert.equal(
    await resourceFileSha256(paths.at(-1)),
    "1b6cf5048680e3e246e4efa8da4299e7e25008972f3604d2e5bf0f9fead98f33",
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

export async function runConfigurationInstructionsProbe(
  args = process.argv.slice(2),
) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claimInstructionProbeOutput(repository, args[1]);
  const tracked = [];
  const report = {
    schema_version: 1,
    result: "fail",
    authority:
      "Actual staged Native SDK and production service/registry, OS/Electron owner and private Event Host IPC/preflight; explicit synthetic confirmation only",
    cases: [],
    limits: [
      "No production Main, foreground confirmation UI, provider prompt or model-consumption proof.",
      "Before/after observations are not CAS or protection against same-UID races.",
      "No Windows, power-loss, private-store or automatic retry evidence.",
      "Synthetic namespaces and failed evidence are retained after actual owned exits.",
      "Reopen restores untrusted workspaces. Existing explicit session.create re-establishes trust and creates a Native session before read-only instruction reconciliation; the entire reopen flow has Native effects.",
    ],
  };
  let failed = false;
  let phase = "identities";
  let namespace;
  let host;
  let epoch = "configuration-instructions-one";
  let workspaceId;
  let parentId;
  let directChildId;
  let inheritedChildId;
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
  const mapping = async (id) => {
    const view = await host.request("view");
    const entries = view.sessions.filter(
      (s) => s.appSessionId === id && s.workspaceId === workspaceId,
    );
    assert.equal(entries.length, 1);
    assert.ok(entries[0].nativeSessionId);
    return entries[0];
  };
  const native = async (id, operation, input = {}) =>
    host.request("native", {
      operation,
      sessionId: (await mapping(id)).nativeSessionId,
      ...input,
    });
  const observe = async (id) =>
    value(
      await handle({
        type: "configuration.instructions.read",
        workspaceId,
        sessionId: id,
      }),
    );
  const file = async () =>
    value(
      await handle({
        type: "configuration.read",
        workspaceId,
        kind: "instructions",
      }),
    );
  const metrics = () => host.request("instructions-metrics");
  const register = async (
    id,
    observation,
    loaded,
    operationId = randomUUID(),
  ) => {
    const response = await handle(
      {
        type: "configuration.instructions.apply",
        workspaceId,
        sessionId: id,
        requestId: operationId,
        text: loaded.content,
        fileVersion: loaded.version,
        expectedRegistrationVersion: observation.version,
      },
      operationId,
    );
    assert.equal(response.ok, true);
    assert.equal(response.receipt.effect, "confirmed");
    assert.deepEqual(response.receipt.result, {
      kind: "instruction_registered",
      workspaceId,
      sessionId: id,
      digest: instructionDigest(loaded.content),
      sourceVersion: loaded.version,
    });
    assert.equal(response.value.status, "registered");
    return response;
  };
  const fork = async (title) => {
    const response = await handle({
      type: "session.fork",
      workspaceId,
      sessionId: parentId,
      requestId: randomUUID(),
      title,
    });
    assert.equal(response.ok, true);
    assert.equal(response.receipt.effect, "confirmed");
    assert.equal(response.receipt.result.kind, "forked");
    const id = response.value.selectedSessionId;
    assert.ok(id && id !== parentId);
    assert.equal((await mapping(id)).parentSessionId, parentId);
    return id;
  };
  try {
    const before = await identities();
    report.before = before;
    namespace = await fs.realpath(await fs.mkdtemp(join(output, "synthetic-")));
    report.retainedNamespace = namespace;
    const launch = async (bootstrap) => {
      host = await createOwnerHost(namespace, tracked);
      const acquired = await host.request("acquire", {
        productionAuthority: true,
        resourcesPath: before.resources,
        initialize: host.record.durable.fresh,
      });
      assert.equal(acquired.state, "ready");
      // Nonfresh production preflight and supervisor each verify the complete
      // pinned resource tree. Keep this probe deadline above their combined
      // work; do not replace or shorten the production verification.
      const started = await host.request(
        "start",
        {
          eventHost: before.eventHost,
          binaryPath: join(before.resources, "opencode/darwin-arm64/opencode"),
          runtimeEpoch: epoch,
          useProductionPreflight: true,
          bootstrap,
        },
        { timeoutMs: 480000 },
      );
      assert.equal(started.blocked, false);
      assert.equal(started.spawned, 1);
      assert.equal(started.nativeVersion, "2.0.18");
      assert.equal(started.startupAuthority, "production-native-preflight");
      return started;
    };
    phase = "initial-production-owner-preflight";
    await launch(true);
    let snapshot;
    for (let n = 0; n < 100; n++) {
      snapshot = value(await handle({ type: "snapshot" }));
      if (snapshot.state === "connected" && snapshot.selectedWorkspaceId) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(snapshot.recovery.store.state, "ready");
    workspaceId = snapshot.selectedWorkspaceId;
    parentId = snapshot.selectedSessionId;
    assert.ok(workspaceId && parentId);
    const workspace = snapshot.workspaces.find((w) => w.id === workspaceId);
    assert.ok(inside(namespace, workspace.path));
    const target = join(workspace.path, "AGENTS.md");
    phase = "history-before-registration";
    const parentInfo = await native(parentId, "get");
    assert.deepEqual(await native(parentId, "instructions-list"), []);
    await native(parentId, "history", {
      location: parentInfo.location,
      metadata: parentInfo.metadata,
    });
    const originalHistory = await native(parentId, "messages");
    assert.ok(
      JSON.stringify(originalHistory).includes("P7 synthetic durable history"),
    );
    assert.deepEqual(
      (await native(parentId, "get")).metadata,
      parentInfo.metadata,
    );
    pass("actual-nonempty-native-history-seeded-before-entry-registration", {
      historySha256: digest(JSON.stringify(originalHistory)),
      metadataSha256: digest(JSON.stringify(parentInfo.metadata)),
    });

    phase = "save-and-root-file-load";
    await host.request("configuration-save-confirmation", { enabled: true });
    const text = "# SYNTHETIC ROOT AGENTS\nUse synthetic instructions only.\n";
    const saved = await handle({
      type: "configuration.save",
      workspaceId,
      kind: "instructions",
      requestId: "root-save",
      text,
      expectation: "missing",
    });
    assert.equal(saved.receipt.effect, "confirmed");
    const loaded = await file();
    assert.equal(loaded.status, "available");
    assert.equal(loaded.path, target);
    assert.equal(loaded.content, text);
    assert.equal(loaded.version, saved.value.version);
    const diskBytes = await fs.readFile(target);
    assert.equal((await metrics()).counts.put, 0);
    assert.equal((await metrics()).counts.remove, 0);
    pass(
      "root-AGENTS-saved-and-explicitly-loaded-without-automatic-entry-mutation",
    );

    phase = "explicit-confirmation-denied";
    const missing = await observe(parentId);
    assert.equal(missing.status, "missing");
    const denyCounts = (await metrics()).counts;
    const deny = await handle({
      type: "configuration.instructions.apply",
      workspaceId,
      sessionId: parentId,
      requestId: "denied",
      text,
      fileVersion: loaded.version,
      expectedRegistrationVersion: missing.version,
    });
    assert.equal(deny.code, "CANCELLED");
    assert.equal(deny.receipt.effect, "none");
    assert.equal((await metrics()).counts.put, denyCounts.put);
    assert.equal((await metrics()).counts.remove, denyCounts.remove);
    const confirmation = (await metrics()).confirmations.at(-1);
    assert.deepEqual(confirmation, {
      action: "apply",
      workspaceId,
      sessionId: parentId,
      sessionTitle: snapshot.sessions.find((s) => s.id === parentId).title,
      workspacePath: workspace.path,
      expectedRegistrationVersion: missing.version,
      targetPath: target,
      digest: instructionDigest(text),
      sourceVersion: loaded.version,
      empty: false,
    });
    pass("default-false-explicit-confirmation-denial-zero-put-remove");

    phase = "actual-registration";
    await host.request("instructions-confirmation", { enabled: true });
    const registrationId = randomUUID();
    const applied = await register(
      parentId,
      await observe(parentId),
      loaded,
      registrationId,
    );
    const parentRegistered = await observe(parentId);
    assert.equal(parentRegistered.status, "registered");
    assert.equal(parentRegistered.origin, "direct");
    assert.deepEqual(await native(parentId, "instructions-list"), [
      { key: INSTRUCTION_KEY, value: text },
    ]);
    assert.deepEqual(await fs.readFile(target), diskBytes);
    assert.deepEqual(
      (await native(parentId, "get")).metadata,
      parentInfo.metadata,
    );
    assert.deepEqual(await native(parentId, "messages"), originalHistory);
    const duplicateCounts = (await metrics()).counts;
    const duplicate = await handle(
      {
        type: "configuration.instructions.apply",
        workspaceId,
        sessionId: parentId,
        requestId: registrationId,
        text,
        fileVersion: loaded.version,
        expectedRegistrationVersion: missing.version,
      },
      registrationId,
    );
    assert.equal(duplicate.value.status, "duplicate");
    assert.deepEqual(duplicate.receipt, applied.receipt);
    assert.deepEqual((await metrics()).counts, duplicateCounts);
    const lookup = value(
      await handle({
        type: "operation.lookup",
        runtimeEpoch: epoch,
        operationId: registrationId,
      }),
    );
    assert.deepEqual(lookup.receipt, applied.receipt);
    pass(
      "actual-register-list-closed-metadata-file-history-and-original-key-no-replay",
      {
        originalKey: { runtimeEpoch: epoch, operationId: registrationId },
        digest: parentRegistered.digest,
      },
    );

    phase = "fork-inheritance-and-direct-child";
    directChildId = await fork("Synthetic direct child");
    inheritedChildId = await fork("Synthetic inherited child");
    const childInfo = await native(directChildId, "get");
    for (const id of [directChildId, inheritedChildId]) {
      const observation = await observe(id);
      assert.equal(observation.status, "registered");
      assert.equal(observation.origin, "fork");
      assert.equal(observation.inheritedFromSessionId, parentId);
      assert.deepEqual(await native(id, "instructions-list"), [
        { key: INSTRUCTION_KEY, value: text },
      ]);
      assert.equal((await native(id, "get")).fork.sessionID, parentInfo.id);
      assert.deepEqual((await native(id, "get")).metadata, parentInfo.metadata);
      assert.ok(
        JSON.stringify(await native(id, "messages")).includes(
          "P7 synthetic durable history",
        ),
      );
    }
    const inheritedBefore = await observe(inheritedChildId);
    const childBefore = await observe(directChildId);
    await register(directChildId, childBefore, loaded);
    const childDirect = await observe(directChildId);
    assert.equal(childDirect.origin, "direct");
    assert.equal(childDirect.inheritedFromSessionId, undefined);
    assert.equal(childDirect.digest, childBefore.digest);
    assert.equal(childDirect.sourceVersion, childBefore.sourceVersion);
    assert.notEqual(childDirect.version, childBefore.version);
    pass(
      "actual-Native-fork-one-constant-key-verified-host-origin-identical-child-apply-direct",
    );

    phase = "parent-later-change";
    await fs.writeFile(target, "# SYNTHETIC PARENT LATER CHANGE\n");
    const laterFile = await file();
    await register(parentId, await observe(parentId), laterFile);
    assert.deepEqual(await observe(inheritedChildId), inheritedBefore);
    assert.deepEqual(await observe(directChildId), childDirect);
    assert.deepEqual(
      (await native(parentId, "get")).metadata,
      parentInfo.metadata,
    );
    pass(
      "parent-later-changes-do-not-relabel-or-rewrite-inherited-child-origin",
    );

    phase = "new-empty-distinct-from-fork";
    const created = await handle({
      type: "session.create",
      workspaceId,
      title: "Synthetic empty session",
    });
    assert.equal(created.ok, true);
    assert.equal(created.receipt.effect, "confirmed");
    const emptyId = created.value.selectedSessionId;
    assert.equal((await observe(emptyId)).status, "missing");
    assert.equal((await mapping(emptyId)).instructionRegistration, undefined);
    assert.deepEqual(await native(emptyId, "instructions-list"), []);
    pass("new-empty-session-has-no-entry-unlike-actual-fork");

    phase = "owned-drift-and-unowned-conflict";
    await native(emptyId, "instructions-put", { value: "SYNTHETIC UNOWNED" });
    assert.equal((await observe(emptyId)).reason, "ownership_conflict");
    const conflictCounts = (await metrics()).counts;
    const conflict = await handle({
      type: "configuration.instructions.apply",
      workspaceId,
      sessionId: emptyId,
      requestId: "no-takeover",
      text: laterFile.content,
      fileVersion: laterFile.version,
      expectedRegistrationVersion: missing.version,
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.receipt.effect, "none");
    assert.equal((await metrics()).counts.put, conflictCounts.put);
    assert.equal((await metrics()).counts.remove, conflictCounts.remove);
    await native(emptyId, "instructions-remove");
    await native(parentId, "instructions-put", {
      value: "SYNTHETIC OWNED DRIFT",
    });
    const drift = await observe(parentId);
    assert.equal(drift.status, "changed");
    await register(parentId, drift, laterFile);
    pass(
      "controlled-actual-SDK-drift-explicit-owned-repair-and-unowned-takeover-refusal",
    );

    phase = "explicit-removal-preserves-file-and-history";
    const childHistory = await native(directChildId, "messages");
    const beforeRemoveFile = await fs.readFile(target);
    const remove = await handle({
      type: "configuration.instructions.remove",
      workspaceId,
      sessionId: directChildId,
      requestId: "remove-child",
      expectedRegistrationVersion: (await observe(directChildId)).version,
    });
    assert.equal(remove.ok, true);
    assert.equal(remove.receipt.effect, "confirmed");
    assert.deepEqual(remove.receipt.result, {
      kind: "instruction_removed",
      workspaceId,
      sessionId: directChildId,
    });
    assert.deepEqual(await native(directChildId, "instructions-list"), []);
    assert.equal((await observe(directChildId)).status, "missing");
    assert.deepEqual((await mapping(directChildId)).instructionRegistration, {
      state: "absent",
      key: INSTRUCTION_KEY,
    });
    assert.deepEqual(await native(directChildId, "messages"), childHistory);
    assert.deepEqual(await fs.readFile(target), beforeRemoveFile);
    assert.deepEqual(
      (await native(directChildId, "get")).metadata,
      childInfo.metadata,
    );
    assert.equal((await observe(parentId)).status, "registered");
    pass(
      "explicit-child-removal-clears-origin-preserves-AGENTS-history-and-parent",
    );
    // Re-register the same actual child so checkpoint/reopen covers direct as well as fork origin.
    await register(directChildId, await observe(directChildId), laterFile);
    const emptyRemoval = await handle({
      type: "configuration.instructions.remove",
      workspaceId,
      sessionId: emptyId,
      requestId: "empty-absent",
      expectedRegistrationVersion: (await observe(emptyId)).version,
    });
    assert.equal(emptyRemoval.receipt.effect, "confirmed");

    phase = "production-owner-reopen-instruction-no-auto-write";
    const beforeReopen = new Map();
    for (const id of [parentId, directChildId, inheritedChildId, emptyId])
      beforeReopen.set(id, await observe(id));
    await host.request("checkpoint");
    assert.deepEqual(
      value(await handle({ type: "snapshot" })).retainedOperations,
      [],
    );
    await cleanupOwnerHost(host.record, { timeoutMs: 20000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.nativeExitConfirmed, true);
    epoch = "configuration-instructions-reopen";
    const reopened = await launch(false);
    assert.equal(reopened.fresh, false);
    // Snapshot intentionally remains available while saved-session verification
    // is pending. Reopen must await readiness, as the fresh bootstrap above does.
    phase = "reopen-selected-snapshot-ready";
    let current;
    for (let n = 0; n < 100; n++) {
      current = value(
        await handle({ type: "snapshot", workspaceId, sessionId: parentId }),
      );
      if (current.state === "connected") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(current.state, "connected");
    assert.equal(current.recovery.store.state, "ready");
    phase = "reopen-untrusted-zero-instruction-mutation";
    assert.equal(
      current.workspaces.find((w) => w.id === workspaceId).trusted,
      false,
    );
    const beforeTrustMetrics = await metrics();
    assert.equal(beforeTrustMetrics.counts.put, 0);
    assert.equal(beforeTrustMetrics.counts.remove, 0);
    assert.deepEqual(beforeTrustMetrics.confirmations, []);
    const untrustedRead = await handle({
      type: "configuration.instructions.read",
      workspaceId,
      sessionId: parentId,
    });
    assert.equal(untrustedRead.code, "INVALID_SELECTION");
    assert.deepEqual(await metrics(), beforeTrustMetrics);
    pass(
      "actual-reopen-untrusted-instruction-read-denied-zero-automatic-put-remove-confirmation",
      { counts: beforeTrustMetrics.counts },
    );
    phase = "existing-explicit-workspace-trust-through-session-create";
    const trustCreation = await handle({
      type: "session.create",
      workspaceId,
      title: "Synthetic explicit reopen trust",
    });
    assert.equal(trustCreation.ok, true);
    assert.equal(trustCreation.receipt.effect, "confirmed");
    assert.equal(trustCreation.receipt.result.kind, "created");
    const trustSessionId = trustCreation.value.selectedSessionId;
    assert.ok(trustSessionId && !beforeReopen.has(trustSessionId));
    assert.equal(
      trustCreation.value.workspaces.find((w) => w.id === workspaceId).trusted,
      true,
    );
    assert.equal((await observe(trustSessionId)).status, "missing");
    phase =
      "instruction-read-only-reconciliation-after-explicit-workspace-trust";
    for (const [id, observation] of beforeReopen)
      assert.deepEqual(await observe(id), observation);
    assert.deepEqual(
      (await native(parentId, "get")).metadata,
      parentInfo.metadata,
    );
    assert.deepEqual(await native(parentId, "messages"), originalHistory);
    assert.deepEqual(await fs.readFile(target), beforeRemoveFile);
    const reopenedMetrics = await metrics();
    assert.equal(reopenedMetrics.counts.put, 0);
    assert.equal(reopenedMetrics.counts.remove, 0);
    assert.deepEqual(reopenedMetrics.confirmations, []);
    pass(
      "original-instruction-registration-read-only-reconciliation-after-existing-explicit-trust-via-new-empty-session",
      {
        counts: reopenedMetrics.counts,
        explicitTrustNativeEffect: "session.create",
        newTrustSessionId: trustSessionId,
      },
    );
    assert.deepEqual(await identities(), before);
    report.identitiesUnchanged = true;
  } catch (error) {
    failed = true;
    report.failure = {
      reason: "bounded-configuration-instructions-proof-failed",
      phase,
      ...(typeof error.code === "string" &&
        /^[A-Z0-9_-]{1,64}$/.test(error.code) && { code: error.code }),
    };
  } finally {
    for (const record of tracked) {
      try {
        if (!record.exited)
          await cleanupOwnerHost(record, { timeoutMs: 20000 });
      } catch {
        failed = true;
        report.cleanupFailure = "owned-exit-unconfirmed";
      }
    }
    if (!failed && tracked.length === 2) {
      try {
        phase = "real-legacy-bundle-refusal";
        const legacyPath = join(
          repository,
          "docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs",
        );
        assert.equal(
          await resourceFileSha256(legacyPath),
          "1b6cf5048680e3e246e4efa8da4299e7e25008972f3604d2e5bf0f9fead98f33",
        );
        const directory = tracked[0].durable.metadata;
        const manifest = JSON.parse(
          await fs.readFile(
            join(tracked[0].durable.root, "manifest.json"),
            "utf8",
          ),
        );
        const paths = ["journal.jsonl", "checkpoint.json"].map((name) =>
          join(directory, name),
        );
        const hashes = () => Promise.all(paths.map(resourceFileSha256));
        const beforeLegacy = await hashes();
        const { openStorageJournal } = await import(
          pathToFileURL(legacyPath).href
        );
        const old = await openStorageJournal({
          directory,
          storeId: manifest.storeId,
        });
        try {
          assert.equal(old.status().reason, "unsupported_version");
        } finally {
          await old.close();
        }
        assert.deepEqual(await hashes(), beforeLegacy);
        pass(
          "immutable-real-prechange-bundle-refuses-new-writer-checkpoint-without-byte-change",
        );
      } catch {
        failed = true;
        report.legacyFailure = {
          reason: "actual-legacy-checkpoint-proof-failed",
          phase,
        };
      }
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
    if (
      tracked.some(
        (record) =>
          !record.exited ||
          !record.nativeExitConfirmed ||
          record.cleanup?.explicitCleanupFailed,
      )
    )
      failed = true;
    report.result = failed ? "fail" : "pass";
    await fs.writeFile(
      join(output, "configuration-instructions-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  return {
    result: report.result,
    evidence: join(output, "configuration-instructions-evidence.json"),
    cases: report.cases.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runConfigurationInstructionsProbe().then(
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
}
