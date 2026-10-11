// Main-only actual contained prerequisite. Never launches production Main.
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
  });
  const resources = join(repository, "apps/desktop-app/dist/resources");
  const eventHost = eventHostForResources(resources, "darwin", "arm64");
  const manifest = await verifyEventHostResources(eventHost, {
    platform: "darwin",
    arch: "arm64",
  });
  const paths = [
    fileURLToPath(import.meta.url),
    join(
      repository,
      "apps/desktop-app/scripts/fixtures/native-skills-prerequisite.mjs",
    ),
    join(
      repository,
      "apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs",
    ),
    join(repository, "apps/desktop-app/scripts/p7-storage-probe.mjs"),
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
async function inventory(root) {
  const rows = [];
  const visit = async (directory) => {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name),
        stat = await fs.lstat(path);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) {
        rows.push({ path: relative(root, path), directory: true });
        await visit(path);
      } else {
        assert.ok(stat.isFile() && stat.nlink === 1);
        rows.push({
          path: relative(root, path),
          sha256: await resourceFileSha256(path),
        });
      }
    }
  };
  await visit(root);
  return rows;
}
async function claim(out) {
  const base = join(
    repository,
    "docs/runs/configuration-skill-runtime/evidence",
  );
  const path = resolve(repository, out),
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
export async function runSkillRuntimeProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claim(args[1]);
  const tracked = [],
    report = {
      result: "fail",
      scope:
        "Actual production owner/preflight/supervisor/service/plugin Skills proof; synthetic direct prerequisite and public durable service, not rendered UI acceptance",
      cases: [],
      limits: [
        "No provider, credentials, private stores or production Main",
        "resume:false plus exact Native history and empty inbox proves no requested model start; not model consumption",
        "Contained namespaces and failed evidence retained",
      ],
    };
  let phase = "identity",
    host,
    failed = false;
  const pass = (name, facts = {}) =>
    report.cases.push({ name, result: "pass", ...facts });
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
    const initial = await launch("skill-prerequisite-one", true);
    assert.equal(initial.blocked, false);
    assert.equal(initial.spawned, 1);
    assert.equal(initial.fresh, true);
    let ready = false,
      selectedSnapshot;
    for (let n = 0; n < 300; n++) {
      const snapshot = await host.request("handle", {
        envelope: {
          version: 2,
          runtimeEpoch: "skill-prerequisite-one",
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
        selectedSnapshot = snapshot.value;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    const configPath = join(host.record.durable.config, "opencode");
    assert.equal(
      await fs.readFile(join(configPath, "opencode.json"), "utf8"),
      "{}\n",
    );
    phase = "fixed-plugin-rpc-native-skills";
    report.prerequisite = await host.request(
      "skills-prerequisite",
      {},
      { timeoutMs: 120000 },
    );
    report.cases.push(...report.prerequisite.cases);
    phase = "public-service-explicit-skills";
    const workspaceId = selectedSnapshot.selectedWorkspaceId,
      sessionId = selectedSnapshot.selectedSessionId;
    const workspacePath = selectedSnapshot.workspaces.find(
      (w) => w.id === workspaceId,
    ).path;
    assert.ok(
      relative(namespace, workspacePath) &&
        !relative(namespace, workspacePath).startsWith("..") &&
        !isAbsolute(relative(namespace, workspacePath)),
    );
    const sourceName = "service-proof",
      target = join(workspacePath, ".opencode/skills", sourceName, "SKILL.md");
    const fileText =
      '\uFEFF---\r\nname: "Service Skill"\r\nmetadata:\r\n  opencode/autoinvoke: true\r\n---\r\n# Exact synthetic body\r\n';
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, fileText, { flag: "wx", mode: 0o600 });
    let requestNumber = 0,
      currentEpoch = "skill-prerequisite-one";
    const wire = (operation, id) => ({
      version: 2,
      runtimeEpoch: currentEpoch,
      [operation.type.endsWith(".read") ||
      operation.type === "operation.lookup" ||
      operation.type === "snapshot"
        ? "readId"
        : "operationId"]: id ?? `skill-read-${++requestNumber}`,
      operation,
    });
    const handle = (operation, id) =>
      host.request("handle", { envelope: wire(operation, id) });
    const observed = async (withSession = false) => {
      const result = await handle({
        type: "configuration.skill.runtime.read",
        workspaceId,
        sourceName,
        ...(withSession && { sessionId }),
      });
      assert.equal(result.ok, true);
      assert.equal(result.value.status, "observed");
      return result.value;
    };
    const initialMetrics = await host.request("skills-metrics");
    assert.equal(initialMetrics.counts.registerDisabled, 0);
    assert.equal(initialMetrics.counts.apply, 1); // explicit private prerequisite apply only
    assert.equal(initialMetrics.counts.removeOwned, 0);
    const registerRequest = (observation, id) => ({
      type: "configuration.skill.register",
      workspaceId,
      requestId: id,
      sourceName,
      observationId: observation.observationId,
      version: observation.file.version,
      directoryVersion: observation.file.directoryVersion,
      digest: observation.file.digest,
    });
    const cancellation = await handle(
      registerRequest(await observed(), "service-cancel"),
      "service-cancel",
    );
    assert.equal(cancellation.code, "CANCELLED");
    assert.equal(
      (await host.request("skills-metrics")).counts.registerDisabled,
      0,
    );
    await host.request("skills-confirmation", { enabled: true });
    const beforeRegister = await observed();
    const registration = registerRequest(beforeRegister, "service-register");
    const registered = await handle(registration, "service-register");
    assert.equal(registered.ok, true);
    assert.equal(registered.receipt.effect, "confirmed");
    assert.equal(registered.receipt.result.kind, "skill_registered");
    const nativeId = registered.value.nativeId;
    const duplicated = await handle(registration, "service-register");
    assert.equal(duplicated.receipt.effect, "confirmed");
    assert.equal(
      (await host.request("skills-metrics")).counts.registerDisabled,
      1,
    );
    const inactive = await observed(true);
    assert.equal(inactive.owned.length, 1);
    assert.equal(inactive.owned[0].nativeId, nativeId);
    assert.equal(inactive.owned[0].autoinvoke, false);
    assert.ok(!inactive.session.messages.some((m) => m.nativeId === nativeId));
    assert.equal(await fs.readFile(target, "utf8"), fileText);
    pass(
      "public-durable-service-confirmation-cancel-disabled-register-original-duplicate-file-unchanged",
    );
    const apply = {
      type: "configuration.skill.apply",
      workspaceId,
      sessionId,
      requestId: "service-apply",
      nativeId,
      observationId: inactive.observationId,
    };
    const applied = await handle(apply, "service-apply");
    assert.equal(applied.ok, true);
    assert.equal(applied.receipt.effect, "confirmed");
    assert.equal(applied.receipt.result.kind, "skill_applied");
    const afterApply = await observed(true),
      matching = afterApply.session.messages.filter(
        (m) => m.nativeId === nativeId,
      );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].messageId, applied.receipt.result.nativeMessageId);
    assert.equal(matching[0].bodyDigest, inactive.owned[0].bodyDigest);
    const repeated = await handle(
      {
        ...apply,
        requestId: "service-again",
        observationId: afterApply.observationId,
      },
      "service-again",
    );
    assert.equal(repeated.code, "SKILL_ALREADY_APPLIED");
    assert.equal(
      (await host.request("skills-metrics")).counts.apply,
      initialMetrics.counts.apply + 1,
    );
    const lookup = await handle({
      type: "operation.lookup",
      runtimeEpoch: "skill-prerequisite-one",
      operationId: "service-apply",
    });
    assert.equal(lookup.status ?? lookup.value?.status, "found");
    pass(
      "public-durable-service-resume-false-exact-message-and-existing-record-zero-reapply",
    );
    const forked = await handle(
      {
        type: "session.fork",
        workspaceId,
        sessionId,
        requestId: "service-fork",
      },
      "service-fork",
    );
    assert.equal(forked.ok, true);
    assert.equal(forked.receipt.effect, "confirmed");
    const forkSessionId = forked.value.selectedSessionId;
    assert.ok(forkSessionId && forkSessionId !== sessionId);
    const forkRead = await handle({
      type: "configuration.skill.runtime.read",
      workspaceId,
      sessionId: forkSessionId,
      sourceName,
    });
    assert.equal(forkRead.ok, true);
    const inherited = forkRead.value.session.messages.filter(
      (m) => m.nativeId === nativeId,
    );
    assert.equal(inherited.length, 1);
    assert.equal(inherited[0].bodyDigest, matching[0].bodyDigest);
    assert.equal(Object.hasOwn(inherited[0], "origin"), false);
    const forkApply = await handle(
      {
        type: "configuration.skill.apply",
        workspaceId,
        sessionId: forkSessionId,
        requestId: "service-fork-again",
        nativeId,
        observationId: forkRead.value.observationId,
      },
      "service-fork-again",
    );
    assert.equal(forkApply.code, "SKILL_ALREADY_APPLIED");
    assert.equal(
      (await host.request("skills-metrics")).counts.apply,
      initialMetrics.counts.apply + 1,
    );
    report.fork = {
      sessionId: forkSessionId,
      inheritedNativeId: nativeId,
      bodyDigest: inherited[0].bodyDigest,
      scope:
        "actual inherited recorded fact, no direct origin relabel or activation",
    };
    pass(
      "public-durable-fork-inherits-skill-record-and-refuses-reapply-without-direct-origin-claim",
    );
    const removal = await handle(
      {
        type: "configuration.skill.remove",
        workspaceId,
        requestId: "service-remove",
        nativeId,
        observationId: (await observed()).observationId,
      },
      "service-remove",
    );
    assert.equal(removal.ok, true);
    assert.equal(removal.receipt.effect, "confirmed");
    assert.equal(removal.receipt.result.kind, "skill_removed");
    const removedState = await observed(true);
    assert.equal(removedState.owned.length, 0);
    assert.deepEqual(
      removedState.session.messages,
      afterApply.session.messages,
    );
    assert.equal(await fs.readFile(target, "utf8"), fileText);
    report.service = {
      baselineCounts: initialMetrics.counts,
      nativeId,
      nativeMessageId: matching[0].messageId,
      fileDigest: registered.value.digest,
      counts: (await host.request("skills-metrics")).counts,
    };
    pass(
      "public-durable-service-owned-remove-retains-exact-session-history-and-file",
    );
    phase = "fresh-stop";
    await cleanupOwnerHost(host.record, { timeoutMs: 60000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.exit.code, 0);
    assert.equal(host.record.nativeExitConfirmed, true);
    const dataBefore = await inventory(host.record.durable.data);
    const sentinel = join(namespace, "inert-sentinel-plugin"),
      marker = join(namespace, "unexpected-plugin-execution");
    await fs.mkdir(sentinel, { mode: 0o700 });
    await fs.writeFile(join(sentinel, "package.json"), '{"type":"module"}\n', {
      mode: 0o600,
    });
    await fs.writeFile(
      join(sentinel, "server.mjs"),
      `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"unexpected");export default {id:"untrusted-sentinel",setup(){}};\n`,
      { mode: 0o600 },
    );
    for (const poison of [
      "changed-global-json",
      "added-jsonc",
      "plugin-directory",
      "plugins-directory",
    ]) {
      phase = `nonfresh-${poison}`;
      let extra;
      if (poison === "changed-global-json")
        await fs.writeFile(
          join(configPath, "opencode.json"),
          JSON.stringify({ plugins: [{ package: sentinel }] }) + "\n",
        );
      else if (poison === "added-jsonc") {
        extra = join(configPath, "opencode.jsonc");
        await fs.writeFile(
          extra,
          JSON.stringify({ plugins: [{ package: sentinel }] }) + "\n",
          { mode: 0o600 },
        );
      } else {
        extra = join(
          configPath,
          poison === "plugin-directory" ? "plugin" : "plugins",
        );
        await fs.mkdir(extra, { mode: 0o700 });
        await fs.writeFile(
          join(extra, "sentinel.mjs"),
          await fs.readFile(join(sentinel, "server.mjs")),
          { mode: 0o600 },
        );
      }
      const configBefore = await inventory(configPath);
      const retainedPoison = join(output, `retained-${poison}`);
      await fs.cp(configPath, retainedPoison, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      assert.deepEqual(await inventory(retainedPoison), configBefore);
      const blocked = await launch(`skill-prerequisite-${poison}`, false);
      assert.equal(blocked.blocked, true);
      assert.equal(blocked.reason, "native_startup_unverified");
      assert.equal(blocked.spawned, 0);
      const processes = await host.request("probe-processes");
      assert.equal(processes.nativeSpawnCount, 0);
      assert.ok(
        !processes.descendants.some((child) =>
          ["native", "inspector"].includes(child.role),
        ),
      );
      const facade = await host.request("handle", {
        envelope: {
          version: 2,
          runtimeEpoch: `skill-prerequisite-${poison}`,
          readId: "held-snapshot",
          operation: { type: "snapshot" },
        },
      });
      assert.equal(facade.ok, true);
      assert.equal(
        facade.value.recovery.store.reason,
        "native_startup_unverified",
      );
      assert.deepEqual(await inventory(host.record.durable.data), dataBefore);
      const configAfter = await inventory(configPath);
      assert.deepEqual(configAfter, configBefore);
      report.poisonEvidence ??= [];
      report.poisonEvidence.push({
        poison,
        retainedPoison,
        configBefore,
        configAfter,
        dataPreserved: true,
        fixtureReset:
          "Only this synthetic poison is reset after owned helper exit to test the next independent refusal; exact poison copy and inventory are retained.",
      });
      await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
      await cleanupOwnerHost(host.record, { timeoutMs: 60000 });
      assert.equal(host.record.exited, true);
      assert.equal(host.record.exit.code, 0);
      assert.equal(host.record.nativeExitConfirmed, true);
      pass(
        `actual-production-nonfresh-${poison}-zero-inspector-native-plugin-byte-preserved-recovery-facade`,
      );
      if (extra) await fs.rm(extra, { recursive: true });
      else await fs.writeFile(join(configPath, "opencode.json"), "{}\n");
    }
    phase = "production-clean-reopen-skill-history";
    currentEpoch = "skill-reopen-two";
    const reopened = await launch(currentEpoch, false);
    assert.equal(reopened.blocked, false);
    assert.equal(reopened.fresh, false);
    assert.equal(reopened.spawned, 1);
    let reopenSnapshot;
    for (let n = 0; n < 300; n++) {
      const result = await handle({ type: "snapshot" });
      assert.equal(result.ok, true);
      if (result.value.state === "connected") {
        reopenSnapshot = result.value;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(reopenSnapshot);
    const startMetrics = await host.request("skills-metrics");
    assert.deepEqual(startMetrics.counts, {
      observe: 0,
      registerDisabled: 0,
      removeOwned: 0,
      apply: 0,
    });
    const untrusted = await handle({
      type: "configuration.skill.runtime.read",
      workspaceId,
      sessionId,
      sourceName,
    });
    assert.equal(untrusted.code, "INVALID_SELECTION");
    const trusted = await handle(
      {
        type: "session.create",
        workspaceId,
        title: "Explicit synthetic trust session",
      },
      "reopen-trust-session",
    );
    assert.equal(trusted.ok, true);
    assert.equal(trusted.receipt.effect, "confirmed");
    const historical = await observed(true);
    assert.equal(historical.owned.length, 0);
    assert.ok(
      historical.session.messages.some(
        (m) =>
          m.nativeId === nativeId &&
          m.messageId === matching[0].messageId &&
          m.bodyDigest === matching[0].bodyDigest,
      ),
    );
    const original = await handle({
      type: "operation.lookup",
      runtimeEpoch: "skill-prerequisite-one",
      operationId: "service-apply",
    });
    assert.equal(original.value.status, "found");
    assert.equal(
      original.value.receipt.result.nativeMessageId,
      matching[0].messageId,
    );
    pass(
      "actual-production-clean-reopen-no-auto-skills-untrusted-explicit-trust-side-effect-historical-receipt-record-only",
    );
    phase = "controlled-lost-skill-ack-original-hold";
    await host.request("skills-confirmation", { enabled: true });
    await host.request("skills-fault", { mode: "next-register-ack" });
    const uncertainRequest = registerRequest(
      await observed(),
      "service-unknown",
    );
    const uncertain = await handle(uncertainRequest, "service-unknown");
    assert.equal(uncertain.receipt.effect, "unknown");
    assert.equal(uncertain.receipt.result, undefined);
    const duplicateUnknown = await handle(uncertainRequest, "service-unknown");
    assert.equal(duplicateUnknown.receipt.effect, "unknown");
    assert.equal(
      (await host.request("skills-metrics")).counts.registerDisabled,
      1,
    );
    const unknownLookup = await handle({
      type: "operation.lookup",
      runtimeEpoch: currentEpoch,
      operationId: "service-unknown",
    });
    assert.equal(unknownLookup.value.receipt.effect, "unknown");
    const heldSnapshot = await handle({ type: "snapshot" });
    assert.ok(
      heldSnapshot.value.retainedOperations.some(
        (r) =>
          r.runtimeEpoch === currentEpoch &&
          r.operationId === "service-unknown",
      ),
    );
    report.controlledUnknown = {
      runtimeEpoch: currentEpoch,
      operationId: "service-unknown",
      actualRegisterCalls: 1,
      authority:
        "explicit synthetic service ACK loss AFTER actual Native registration; no fabricated Native outcome",
    };
    await cleanupOwnerHost(host.record, { timeoutMs: 60000 });
    assert.equal(host.record.exited, true);
    assert.equal(host.record.exit.code, 0);
    assert.equal(host.record.nativeExitConfirmed, true);
    const heldData = await inventory(host.record.durable.data),
      heldConfig = await inventory(configPath);
    currentEpoch = "skill-pending-three";
    const pending = await launch(currentEpoch, false);
    assert.equal(pending.blocked, true);
    assert.equal(pending.reason, "native_startup_unverified");
    assert.equal(pending.spawned, 0);
    const pendingProcesses = await host.request("probe-processes");
    assert.equal(pendingProcesses.nativeSpawnCount, 0);
    assert.ok(
      !pendingProcesses.descendants.some((r) =>
        ["native", "inspector"].includes(r.role),
      ),
    );
    assert.deepEqual(await inventory(host.record.durable.data), heldData);
    assert.deepEqual(await inventory(configPath), heldConfig);
    const retained = await handle({
      type: "operation.lookup",
      runtimeEpoch: "skill-reopen-two",
      operationId: "service-unknown",
    });
    assert.equal(retained.value.receipt.effect, "unknown");
    pass(
      "controlled-lost-ack-original-unknown-no-replay-and-production-pending-reopen-zero-inspector-native-byte-preserved",
    );
  } catch (error) {
    failed = true;
    report.failure = {
      phase,
      reason: "bounded-Skill-prerequisite-failed",
      ...(error.code === "ERR_ASSERTION" && {
        assertion: {
          operator: error.operator,
          location: String(error.stack).match(
            /configuration-skill-runtime-probe\.mjs:\d+:\d+/u,
          )?.[0],
          ...(["boolean", "number"].includes(typeof error.actual) && {
            actual: error.actual,
          }),
          ...(["boolean", "number"].includes(typeof error.expected) && {
            expected: error.expected,
          }),
          ...(typeof error.actual === "string" &&
            /^[A-Za-z0-9_:-]{1,64}$/u.test(error.actual) && {
              actual: error.actual,
            }),
          ...(typeof error.expected === "string" &&
            /^[A-Za-z0-9_:-]{1,64}$/u.test(error.expected) && {
              expected: error.expected,
            }),
        },
      }),
      ...(error.skillDiagnostic && { skillDiagnostic: error.skillDiagnostic }),
      ...(typeof error.code === "string" &&
        /^[A-Z0-9_-]{1,64}$/u.test(error.code) && { code: error.code }),
    };
  } finally {
    for (const record of tracked) {
      if (!record.exited) await cleanupOwnerHost(record, { timeoutMs: 60000 });
      if (
        !record.exited ||
        !record.nativeExitConfirmed ||
        record.exit?.code !== 0
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
      join(output, "skill-runtime-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  assert.equal(
    report.result,
    "pass",
    `Skill prerequisite failed at ${report.failure?.phase ?? "cleanup-or-identity"}`,
  );
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runSkillRuntimeProbe()
    .then((report) => {
      process.stdout.write(
        JSON.stringify({ result: report.result, cases: report.cases.length }) +
          "\n",
      );
    })
    .catch((error) => {
      process.stderr.write(error.message + "\n");
      process.exitCode = 1;
    });
