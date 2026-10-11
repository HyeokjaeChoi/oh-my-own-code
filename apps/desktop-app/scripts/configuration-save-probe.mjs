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
import { configurationBackupId } from "../src/host/configuration-file-observation.mjs";

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
async function claim(out) {
  const base = join(repository, "docs/runs/configuration-save/evidence"),
    destination = resolve(repository, out);
  assert.ok(inside(base, destination));
  let current = repository;
  for (const part of relative(repository, destination).split(sep)) {
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
    join(destination, ".configuration-save-claim"),
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
  ];
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
export async function runConfigurationSaveProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claim(args[1]),
    tracked = [];
  const report = {
    schema_version: 1,
    result: "fail",
    authority:
      "Actual built app-staged Bun kernel, production owned Event Host private IPC, registry/service and OS/Electron owner in synthetic namespace; explicit synthetic confirmation",
    cases: [],
    limits: [
      "No production Main/foreground confirmation UI/provider/private store/Native activation.",
      "Observed file versions and before-after bytes are not CAS, filesystem isolation or power-loss durability.",
      "Kernel races and uncertainty are separately exercised by actual kernel/Node tests; this saved chain does not claim every fault across all layers.",
    ],
  };
  let failed = false;
  try {
    const before = await identities();
    report.before = before;
    const namespace = await fs.realpath(
      await fs.mkdtemp(join(output, "synthetic-")),
    );
    report.retainedNamespace = namespace;
    const host = await createOwnerHost(namespace, tracked),
      epoch = "configuration-save-probe";
    const acquisition = await host.request("acquire", {
      productionAuthority: true,
      resourcesPath: before.resources,
      initialize: host.record.durable.fresh,
    });
    assert.equal(acquisition.state, "ready");
    const started = await host.request("start", {
      eventHost: before.eventHost,
      binaryPath: join(before.resources, "opencode/darwin-arm64/opencode"),
      runtimeEpoch: epoch,
      useProductionPreflight: true,
    });
    assert.equal(started.blocked, false);
    assert.equal(started.spawned, 1);
    const wire = (operation, id = randomUUID()) => ({
      version: 2,
      runtimeEpoch: epoch,
      [operation.type === "snapshot" ||
      operation.type === "configuration.read" ||
      operation.type === "operation.lookup"
        ? "readId"
        : "operationId"]: id,
      operation,
    });
    const handle = (operation, id) =>
      host.request("handle", { envelope: wire(operation, id) });
    let snapshot;
    for (let n = 0; n < 100; n++) {
      snapshot = value(await handle({ type: "snapshot" }));
      if (snapshot.state === "connected" && snapshot.selectedWorkspaceId) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(snapshot.recovery.store.state, "ready");
    assert.ok(snapshot.selectedWorkspaceId);
    const workspaceId = snapshot.selectedWorkspaceId,
      workspace = snapshot.workspaces.find((w) => w.id === workspaceId);
    assert.ok(inside(namespace, workspace.path));
    const target = join(workspace.path, "AGENTS.md"),
      read = () =>
        handle({
          type: "configuration.read",
          workspaceId,
          kind: "instructions",
        });
    assert.equal(value(await read()).status, "missing");
    await host.request("configuration-save-confirmation", { enabled: true });
    const createId = randomUUID(),
      create = {
        type: "configuration.save",
        workspaceId,
        kind: "instructions",
        requestId: "create",
        text: "SYNTHETIC-CREATED",
        expectation: "missing",
      };
    const created = await handle(create, createId);
    assert.equal(created.receipt.effect, "confirmed");
    assert.equal(created.value.status, "saved");
    assert.equal(created.value.backupId, undefined);
    assert.equal(await fs.readFile(target, "utf8"), create.text);
    report.cases.push({
      name: "missing-exclusive-create-through-production-private-IPC-and-durable-service",
      result: "pass",
      originalKey: { runtimeEpoch: epoch, operationId: createId },
    });
    const observation = value(await read());
    const opId = randomUUID(),
      operation = {
        ...create,
        requestId: "replace",
        text: "SYNTHETIC-REPLACEMENT",
        expectation: "version",
        version: observation.version,
      };
    const saved = await handle(operation, opId);
    assert.equal(saved.receipt.effect, "confirmed");
    assert.equal(saved.receipt.result.kind, "configuration_saved");
    assert.equal(saved.value.status, "saved");
    assert.equal(
      saved.value.backupId,
      configurationBackupId(epoch, opId, "instructions"),
    );
    assert.equal(await fs.readFile(target, "utf8"), operation.text);
    const backup = join(workspace.path, saved.value.backupId);
    assert.equal(await fs.readFile(backup, "utf8"), create.text);
    assert.equal(value(await read()).version, saved.value.version);
    report.cases.push({
      name: "exact-original-retained-and-final-Node-reader-version-confirmed",
      result: "pass",
      targetSha256: digest(await fs.readFile(target)),
      backupSha256: digest(await fs.readFile(backup)),
    });
    const beforeDuplicate = await fs.readdir(workspace.path);
    const duplicate = await handle(operation, opId);
    assert.equal(duplicate.value.status, "duplicate");
    assert.equal(duplicate.receipt.effect, "confirmed");
    assert.deepEqual(await fs.readdir(workspace.path), beforeDuplicate);
    const duplicateConflict = await handle(
      { ...operation, text: "DIFFERENT-SYNTHETIC" },
      opId,
    );
    assert.equal(duplicateConflict.code, "DUPLICATE_CONFLICT");
    const lookup = value(
      await handle({
        type: "operation.lookup",
        runtimeEpoch: epoch,
        operationId: opId,
      }),
    );
    assert.equal(lookup.receipt.result.backupId, saved.value.backupId);
    report.cases.push({
      name: "original-key-lookup-and-duplicate-no-replay-conflict",
      result: "pass",
    });
    await host.request("configuration-save-confirmation", { enabled: false });
    const latest = value(await read());
    const denied = await handle(
      { ...operation, version: latest.version },
      randomUUID(),
    );
    assert.equal(denied.code, "CANCELLED");
    assert.equal(denied.receipt.effect, "none");
    assert.equal(await fs.readFile(target, "utf8"), operation.text);
    report.cases.push({
      name: "explicit-synthetic-denial-no-target-effect",
      result: "pass",
    });
    await host.request("configuration-save-confirmation", { enabled: true });
    await fs.writeFile(target, "SYNTHETIC-EXTERNAL");
    const conflict = await handle(
      { ...operation, version: latest.version },
      randomUUID(),
    );
    assert.equal(conflict.code, "FILE_CHANGED");
    assert.equal(conflict.receipt.effect, "none");
    assert.equal(await fs.readFile(target, "utf8"), "SYNTHETIC-EXTERNAL");
    assert.equal(await fs.readFile(backup, "utf8"), create.text);
    report.cases.push({
      name: "external-conflict-before-dispatch-preserves-target-and-backup",
      result: "pass",
    });
    await host.request("checkpoint");
    const final = value(await handle({ type: "snapshot" }));
    assert.deepEqual(final.retainedOperations, []);
    report.cases.push({
      name: "durable-checkpoint-no-retained-confirmed-operations",
      result: "pass",
    });
    const after = await identities();
    assert.deepEqual(after, before);
    report.identitiesUnchanged = true;
  } catch {
    failed = true;
    report.failure = { reason: "bounded-configuration-save-proof-failed" };
  } finally {
    for (const record of tracked) {
      try {
        await cleanupOwnerHost(record, { timeoutMs: 20000 });
      } catch {
        failed = true;
        report.cleanupFailure = "owned-exit-unconfirmed";
      }
    }
    try {
      const afterCleanup = await identities();
      assert.deepEqual(afterCleanup, report.before);
      report.afterCleanup = afterCleanup;
    } catch {
      failed = true;
      report.identityFailure = "after-cleanup-identity-mismatch";
    }
    // Read the actual new writer/checkpoint with the frozen real legacy parser only after owned shutdown.
    if (!failed && tracked.length === 1) {
      try {
        const legacyPath = join(
          repository,
          "docs/runs/configuration-save/evidence/prechange/legacy-storage-journal.mjs",
        );
        assert.equal(
          await resourceFileSha256(legacyPath),
          "2541697f473f2af1c7d84202498481a4387163745ab951716d47950579ca34cc",
        );
        const directory = tracked[0].durable.metadata;
        const manifest = JSON.parse(
          await fs.readFile(
            join(tracked[0].durable.root, "manifest.json"),
            "utf8",
          ),
        );
        const names = ["journal.jsonl", "checkpoint.json"];
        const beforeLegacy = await Promise.all(
          names.map(async (name) =>
            digest(await fs.readFile(join(directory, name))),
          ),
        );
        const { openStorageJournal } = await import(
          pathToFileURL(legacyPath).href
        );
        const journal = await openStorageJournal({
          directory,
          storeId: manifest.storeId,
        });
        try {
          assert.equal(journal.status().reason, "unsupported_version");
        } finally {
          await journal.close();
        }
        assert.deepEqual(
          await Promise.all(
            names.map(async (name) =>
              digest(await fs.readFile(join(directory, name))),
            ),
          ),
          beforeLegacy,
        );
        report.cases.push({
          name: "actual-new-writer-checkpoint-legacy-refusal-byte-preservation",
          result: "pass",
        });
      } catch {
        failed = true;
        report.legacyFailure = "legacy-checkpoint-proof-failed";
      }
    }
    report.cleanup = tracked.map((record) => ({
      exited: record.exited,
      nativeExitConfirmed: record.nativeExitConfirmed,
      cleanup: record.cleanup,
    }));
    if (tracked.some((record) => !record.exited || !record.nativeExitConfirmed))
      failed = true;
    report.result = failed ? "fail" : "pass";
    await fs.writeFile(
      join(output, "configuration-save-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  return {
    result: report.result,
    evidence: join(output, "configuration-save-evidence.json"),
    cases: report.cases.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runConfigurationSaveProbe().then(
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
