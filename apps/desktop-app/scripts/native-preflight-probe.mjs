// Saved acceptance command. Importing this module is Node-only and inert.
// Main executes after a coherent build/package freeze; never production Main.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import {
  assertNativeMetadataCorrelation,
  prepareNativeEventFixture,
  assertNativeForkCheckpoint,
  assertNativeEventsPreserved,
  readExactNativeInventory,
  cleanupOwnerHost,
} from "./p7-storage-probe.mjs";
import { createOSProcessIdentityAdapter } from "../src/sidecar-supervisor.mjs";
import {
  eventHostForResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";
import { verifyNativePreflightResources } from "../src/native-preflight-resources.mjs";
import { validateSnapshot } from "../src/workbench-contract.mjs";

const ownFile = fileURLToPath(import.meta.url);
const desktop = resolve(dirname(ownFile), "..");
const repository = resolve(desktop, "../..");
const evidenceRelative = "docs/runs/durable-native-preflight/evidence";
const hostFile = join(desktop, "scripts/fixtures/p7-storage-owner-host.mjs");
const observerFile = join(
  desktop,
  "scripts/fixtures/owner-lifetime-exit-observer.py",
);
const require = createRequire(import.meta.url);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const startupBudgetMs = 480000;
const witnessObservationSeconds = 1200;
const statKeys = [
  "dev",
  "ino",
  "uid",
  "gid",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];
const sameStat = (a, b) => statKeys.every((key) => a[key] === b[key]);
const inside = (root, path) => {
  const rel = relative(root, path);
  return Boolean(
    rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
  );
};

export function parseNativeProbeOptions(args) {
  assert.ok(
    args.length === 2 &&
      args[0] === "--out" &&
      typeof args[1] === "string" &&
      args[1],
  );
  assert.ok(
    ![...args[1]].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }),
  );
  return { out: args[1] };
}
// Exclusive leaf ownership. Existing evidence and symlink ancestors are rejected.
export async function claimNativeProbeOutput(root, out) {
  assert.equal(await fs.realpath(root), root);
  const base = join(root, evidenceRelative);
  const destination = resolve(root, out);
  assert.ok(
    inside(base, destination),
    "Output outside registered evidence root",
  );
  let path = root;
  for (const part of relative(root, destination).split(sep)) {
    path = join(path, part);
    try {
      await fs.mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (path === destination || error.code !== "EEXIST") throw error;
    }
    const stat = await fs.lstat(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(await fs.realpath(path), path);
  }
  assert.equal((await fs.lstat(destination)).mode & 0o777, 0o700);
  await fs.writeFile(
    join(destination, ".native-preflight-claim"),
    "exclusive synthetic evidence\n",
    { flag: "wx", mode: 0o600 },
  );
  return destination;
}

// Complete original DB set. No SQLite connection, raw SQL, mutation or checkpoint.
// Access time is excluded: ordinary reads can update it.
export async function snapshotNativeOriginals(data) {
  assert.equal(await fs.realpath(data), data);
  const directoryBefore = await fs.lstat(data, { bigint: true });
  assert.ok(directoryBefore.isDirectory() && !directoryBefore.isSymbolicLink());
  assert.equal(directoryBefore.uid, BigInt(process.getuid()));
  assert.equal(directoryBefore.mode & 0o7777n, 0o700n);
  const namesBefore = (await fs.readdir(data)).sort();
  const suffixes = ["", "-wal", "-shm", "-journal"];
  const limits = [256, 64, 4, 64].map((value) => BigInt(value * 1024 ** 2));
  const result = [];
  for (let i = 0; i < suffixes.length; i++) {
    const name = `event-host.sqlite${suffixes[i]}`;
    const path = join(data, name);
    let before;
    try {
      before = await fs.lstat(path, { bigint: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result.push({ name, present: false });
      continue;
    }
    assert.ok(
      before.isFile() && before.nlink === 1n && !before.isSymbolicLink(),
    );
    assert.ok(
      before.size <= limits[i] && before.uid === BigInt(process.getuid()),
    );
    assert.equal(before.mode & 0o7777n, 0o600n);
    const handle = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const hash = createHash("sha256");
    try {
      assert.ok(sameStat(before, await handle.stat({ bigint: true })));
      const buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      for (;;) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
        assert.ok(BigInt(offset) <= before.size);
        hash.update(buffer.subarray(0, bytesRead));
      }
      assert.equal(BigInt(offset), before.size);
      assert.ok(sameStat(before, await handle.stat({ bigint: true })));
      assert.ok(sameStat(before, await fs.lstat(path, { bigint: true })));
    } finally {
      await handle.close();
    }
    result.push({
      name,
      present: true,
      sha256: hash.digest("hex"),
      identity: Object.fromEntries(
        statKeys.map((key) => [key, String(before[key])]),
      ),
    });
  }
  assert.ok(result[0].present, "Original Native DB required");
  for (const file of result) {
    if (!file.present)
      await assert.rejects(fs.lstat(join(data, file.name)), { code: "ENOENT" });
    else {
      const current = await fs.lstat(join(data, file.name), { bigint: true });
      assert.deepEqual(
        Object.fromEntries(statKeys.map((key) => [key, String(current[key])])),
        file.identity,
      );
    }
  }
  assert.deepEqual((await fs.readdir(data)).sort(), namesBefore);
  assert.ok(sameStat(directoryBefore, await fs.lstat(data, { bigint: true })));
  return result;
}
export function assertProductionProbeStart(started, fresh) {
  assert.equal(started.startupAuthority, "production-native-preflight");
  assert.equal(started.blocked, false);
  assert.equal(started.fresh, fresh);
  assert.equal(started.spawned, 1);
  assert.equal(started.windows, 0);
  assert.equal(started.activationPolicy, "prohibited");
  assert.ok(started.nativeIdentity?.pid === started.processId);
}
// Closed reports never include exception messages, SDK payloads or child output.
export function closedProbeFailure(phase) {
  return {
    code: "NATIVE_PREFLIGHT_PROBE_FAILED",
    phase: /^[a-z0-9_-]{1,80}$/.test(phase) ? phase : "unknown",
  };
}
export function probeEnvelope(epoch, operation, id = randomUUID()) {
  const read = ["snapshot", "operation.lookup"].includes(operation.type);
  return {
    version: 2,
    runtimeEpoch: epoch,
    [read ? "readId" : "operationId"]: id,
    operation,
  };
}
async function bounded(promise, ms = 35000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error("Probe deadline"), {
                code: "PROBE_DEADLINE",
              }),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function identities() {
  const provenance = await captureProvenance(repository, {
    script: "smoke",
    mode: "packaged",
    platform: "darwin",
  });
  const native = provenance.launchArtifacts.files.filter((file) =>
    /\/Contents\/Resources\/opencode\/darwin-arm64\/opencode$/.test(file.path),
  );
  assert.equal(native.length, 1);
  const nativePath = join(repository, native[0].path);
  const resourcesPath = resolve(nativePath, "../../..");
  const eventHost = eventHostForResources(
    resourcesPath,
    process.platform,
    process.arch,
  );
  const inspector = await verifyNativePreflightResources(eventHost);
  const scripts = [];
  for (const path of [
    ownFile,
    hostFile,
    observerFile,
    join(desktop, "scripts/p7-storage-probe.mjs"),
    join(desktop, "scripts/fixtures/native-preflight-probe.test.mjs"),
    join(desktop, "scripts/build-provenance.mjs"),
    join(desktop, "scripts/run-evidence.mjs"),
  ])
    scripts.push({
      path: relative(repository, path),
      sha256: await resourceFileSha256(path),
    });
  const electron = await fs.realpath(require("electron"));
  assert.equal(
    require("electron/package.json").version,
    JSON.parse(await fs.readFile(join(desktop, "package.json"), "utf8"))
      .devDependencies.electron,
  );
  return {
    provenance,
    resourcesPath,
    nativePath,
    eventHost,
    inspector,
    scripts,
    electron: { path: electron, sha256: await resourceFileSha256(electron) },
  };
}

async function launchHost(anchor, context) {
  const child = spawn(context.identities.electron.path, [hostFile], {
    cwd: anchor,
    shell: false,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      HOME: anchor,
      TMPDIR: anchor,
      TMP: anchor,
      TEMP: anchor,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "C",
      CI: "1",
      OMOC_P7_NAMESPACE: anchor,
    },
  });
  const pending = new Map();
  let readyResolve, readyReject, exitResolve;
  const ready = new Promise((a, b) => {
    readyResolve = a;
    readyReject = b;
  });
  ready.catch(() => {});
  const exit = new Promise((done) => {
    exitResolve = done;
  });
  const record = {
    child,
    namespace: anchor,
    exited: false,
    nativeExitConfirmed: true,
  };
  context.hosts.push(record);
  const fail = () => {
    readyReject(new Error("Owner host failed"));
    for (const task of pending.values())
      task.reject(new Error("Owner host failed"));
    pending.clear();
  };
  child.once("error", () => {
    if (!child.pid) {
      record.exited = true;
      record.exit = { noProcessSpawned: true };
      exitResolve(record.exit);
    }
    fail();
  });
  child.once("exit", (code, signal) => {
    record.exited = true;
    record.exit = { code, signal };
    exitResolve(record.exit);
    fail();
  });
  child.on("message", (message) => {
    try {
      assert.ok(Buffer.byteLength(JSON.stringify(message)) <= 1024 * 1024);
      if (message.event === "descendant") {
        assert.ok(["native", "inspector", "witness"].includes(message.role));
        assert.ok(
          Number.isSafeInteger(message.pid) &&
            message.pid > 0 &&
            context.descendants.length < 256,
        );
        context.descendants.push({
          appPid: child.pid,
          role: message.role,
          pid: message.pid,
          exited: false,
        });
      } else if (message.event === "descendant-exit") {
        const entry = context.descendants.findLast(
          (item) =>
            item.appPid === child.pid &&
            item.pid === message.pid &&
            item.role === message.role,
        );
        assert.ok(entry && !entry.exited);
        entry.exited = true;
        entry.exit = { code: message.code, signal: message.signal };
        entry.evidence = "owned-child-exit-event";
      } else if (message.event === "ready") {
        assert.equal(message.windows, 0);
        assert.equal(message.activationPolicy, "prohibited");
        record.identity = message.identity;
        record.durable = message.namespace;
        readyResolve();
      } else if (pending.has(message.id)) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        if (message.ok) task.resolve(message.value);
        else task.reject(new Error("Closed owner probe command failed"));
      }
    } catch {
      record.protocolFailed = true;
      fail();
    }
  });
  record.waitForExit = () => exit;
  record.request = async (command, input = {}, options = {}) => {
    assert.ok(!record.exited && child.connected);
    assert.ok(!record.protocolFailed || options.cleanup === true);
    const id = randomUUID();
    if (command === "start") {
      record.nativeExitConfirmed = false;
      record.nativeIdentity = undefined;
    }
    try {
      const value = await bounded(
        new Promise((resolveTask, reject) => {
          pending.set(id, { resolve: resolveTask, reject });
          const message = { id, command, ...input };
          assert.ok(Buffer.byteLength(JSON.stringify(message)) <= 1024 * 1024);
          child.send(message, (error) => {
            if (error) reject(new Error("Owner IPC failed"));
          });
        }),
        options.timeoutMs ?? (command === "start" ? startupBudgetMs : 35000),
      );
      if (command === "stop") record.preflightClose = value.preflightClose;
      if (command === "start") {
        record.nativeIdentity = value.nativeIdentity;
        if (value.blocked && value.spawned === 0)
          record.nativeExitConfirmed = true;
      }
      return value;
    } finally {
      pending.delete(id);
    }
  };
  await bounded(ready);
  const host = { record, request: record.request };
  const acquisition = await host.request("acquire", {
    productionAuthority: true,
    resourcesPath: context.identities.resourcesPath,
    initialize: record.durable.fresh,
  });
  assert.equal(acquisition.state, "ready");
  assert.equal(acquisition.productionAuthority, true);
  record.witnessObserver = await observeWitness(
    acquisition.witnessPid,
    record,
    context,
  );
  return host;
}
// Reuse exact kernel birth capture and the saved kqueue observer. The observer's
// completion is evidence only; production recovery consumes real witness files.
async function observeWitness(pid, host, context) {
  const identity = await createOSProcessIdentityAdapter().capture(pid);
  assert.ok(identity && identity.pid === pid);
  const child = spawn(
    "/usr/bin/python3",
    [observerFile, JSON.stringify(identity), String(witnessObservationSeconds)],
    {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    },
  );
  const record = { child, exited: false };
  context.observers.push(record);
  let text = "",
    invalid = false,
    readyResolve,
    readyReject,
    exitResolve;
  const ready = new Promise((a, b) => {
    readyResolve = a;
    readyReject = b;
  });
  ready.catch(() => {});
  const exit = new Promise((done) => {
    exitResolve = done;
  });
  child.stdout.on("data", (bytes) => {
    text += bytes.toString("ascii");
    if (
      text.length > 16 ||
      !["READY\n", "READY\nEXIT\n"].some((frame) => frame.startsWith(text))
    ) {
      invalid = true;
      readyReject(new Error("Witness observer invalid"));
      child.kill("SIGKILL");
    }
    if (text.startsWith("READY\n")) readyResolve();
  });
  child.once("error", () => {
    readyReject(new Error("Witness observer failed"));
    if (!child.pid) {
      record.exited = true;
      record.exit = { noProcessSpawned: true };
      exitResolve(record.exit);
    }
  });
  child.once("exit", (code, signal) => {
    record.exited = true;
    record.exit = { code, signal };
    exitResolve(record.exit);
    if (!text.startsWith("READY\n"))
      readyReject(new Error("Witness observer registration failed"));
  });
  record.waitForExit = () => exit;
  await bounded(ready, 10000);
  return {
    async ended() {
      assert.deepEqual(await bounded(exit, 25000), { code: 0, signal: null });
      assert.ok(!invalid && text === "READY\nEXIT\n");
      const tracked = context.descendants.find(
        (entry) =>
          entry.appPid === host.child.pid &&
          entry.pid === pid &&
          entry.role === "witness",
      );
      assert.ok(tracked);
      tracked.exited = true;
      tracked.evidence = "exact-kernel-exit-observer";
      return {
        identity,
        event: "EVFILT_PROC:NOTE_EXIT",
        exited: true,
        observerExit: record.exit,
        productionRecoveryInput: false,
      };
    },
  };
}
async function terminal(root, nonce) {
  const path = join(root, "lifetime-witness-v1", nonce, "terminal");
  for (let i = 0; i < 400; i++) {
    try {
      return { path, sha256: await resourceFileSha256(path) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await wait(50);
  }
  throw new Error("Witness terminal unavailable");
}
async function closeHost(host, context, { crash = false } = {}) {
  const owner = await host.request("owner-proof");
  assert.deepEqual(owner.app, host.record.identity);
  let nativeStop;
  if (crash) {
    nativeStop = await host.request("stop-native", { signal: "SIGKILL" });
    assert.equal(nativeStop.ownerCleanRelease, false);
    assert.equal(nativeStop.nativeExit.signal, "SIGKILL");
    assert.equal(nativeStop.cleanup, "incomplete");
  }
  await cleanupOwnerHost(host.record);
  assert.equal(host.record.exited, true);
  assert.equal(host.record.cleanup.explicitStopConfirmed, true);
  assert.equal(host.record.cleanup.explicitCleanupFailed, undefined);
  assert.equal(host.record.nativeExitConfirmed, true);
  assert.deepEqual(host.record.exit, { code: 0, signal: null });
  assert.deepEqual(host.record.preflightClose, {
    exited: true,
    cleanup: "complete",
  });
  const witnessExit = await host.record.witnessObserver.ended();
  const proof = await terminal(host.record.durable.root, owner.nonce);
  const after = JSON.parse(
    await fs.readFile(join(host.record.durable.root, "owner.json"), "utf8"),
  );
  if (crash) {
    assert.equal(after.cleanShutdown, false);
    assert.equal(after.spawnIntent, true);
    assert.deepEqual(after.child, owner.child);
  } else {
    assert.equal(after.cleanShutdown, true);
  }
  const processes = context.descendants.filter(
    (item) => item.appPid === host.record.child.pid,
  );
  assert.ok(processes.every((entry) => entry.exited));
  return {
    appIdentity: host.record.identity,
    appExit: host.record.exit,
    nativeStop: nativeStop ?? host.record.nativeStopResult,
    witnessExit,
    preflightClose: host.record.preflightClose,
    terminal: proof,
    dirtyRetained: crash,
    processes,
  };
}
async function start(host, epoch, context) {
  const result = await host.request("start", {
    eventHost: context.identities.eventHost,
    binaryPath: context.identities.nativePath,
    runtimeEpoch: epoch,
    useProductionPreflight: true,
    // bootstrap omitted deliberately: the production-probe default is true.
  });
  return result;
}
const value = (result) => {
  assert.equal(result.ok, true);
  return result.value;
};
async function snapshot(host, epoch, count) {
  for (let i = 0; i < 100; i++) {
    const result = validateSnapshot(
      value(
        await host.request("handle", {
          envelope: probeEnvelope(epoch, { type: "snapshot" }),
        }),
      ),
    );
    if (result.recovery.store.state === "recovery_required")
      throw new Error("Native facade held");
    if (result.state === "connected" && result.sessions.length === count)
      return result;
    await wait(100);
  }
  throw new Error("Native snapshot deadline");
}
async function lookup(host, epoch, key) {
  return value(
    await host.request("handle", {
      envelope: probeEnvelope(epoch, { type: "operation.lookup", ...key }),
    }),
  );
}
async function seed(host, epoch, report) {
  const initial = await snapshot(host, epoch, 1);
  assert.equal(initial.workspaces.length, 1);
  assert.equal(initial.retainedOperations.length, 0);
  const view = await host.request("view");
  assert.equal(view.sessions.length, 1);
  const mapped = view.sessions[0];
  const native = await host.request("native", {
    operation: "get",
    sessionId: mapped.nativeSessionId,
  });
  const key = {
    runtimeEpoch: native.metadata?.originalRuntimeEpoch,
    operationId: native.metadata?.operationId,
  };
  const expected = {
    ...key,
    appSessionId: mapped.appSessionId,
    nativeSessionId: mapped.nativeSessionId,
    workspaceId: mapped.workspaceId,
    directory: initial.workspaces[0].path,
  };
  const admitted = await host.request("identity", { key });
  assertNativeMetadataCorrelation(native, admitted, expected);
  assert.equal(key.runtimeEpoch, epoch);
  const receipt = await lookup(host, epoch, key);
  assert.equal(receipt.status, "found");
  assert.equal(receipt.receipt.effect, "confirmed");
  assert.deepEqual(receipt.receipt.result, {
    kind: "created",
    workspaceId: expected.workspaceId,
    sessionId: expected.appSessionId,
    nativeSessionId: expected.nativeSessionId,
  });
  const progress = {};
  const log = await prepareNativeEventFixture(
    host,
    expected,
    receipt,
    progress,
  );
  report.observations.push({
    scenario: "public-sdk-history-seed",
    synthetic: true,
    publicExportRemoveImport: true,
    admissionMatched: true,
    originalReceiptMatched: true,
    eventCapability: progress.eventCapability.status,
    eventCount: log.length,
  });
  const envelope = probeEnvelope(
    epoch,
    {
      type: "session.fork",
      workspaceId: expected.workspaceId,
      sessionId: expected.appSessionId,
      requestId: "native-preflight-fork",
      title: "Synthetic Native preflight fork",
    },
    "native-preflight-fork",
  );
  const forked = await host.request("handle", { envelope });
  assert.equal(forked.ok, true);
  assert.equal(forked.receipt.effect, "confirmed");
  assert.equal(forked.receipt.result.kind, "forked");
  assert.deepEqual(
    (await host.request("handle", { envelope })).receipt,
    forked.receipt,
  );
  const forkKey = { runtimeEpoch: epoch, operationId: envelope.operationId };
  const fork = {
    key: forkKey,
    identity: await host.request("identity", { key: forkKey }),
    receipt: forked.receipt,
    appSessionId: forked.receipt.result.sessionId,
    nativeSessionId: forked.receipt.result.nativeSessionId,
    parentAppSessionId: expected.appSessionId,
    parentNativeSessionId: expected.nativeSessionId,
    workspaceId: expected.workspaceId,
    directory: expected.directory,
    inheritedMetadata: native.metadata,
  };
  await assertNativeForkCheckpoint(host, epoch, fork);
  const history = await host.request("native", {
    operation: "messages",
    sessionId: expected.nativeSessionId,
  });
  const forkHistory = await host.request("native", {
    operation: "messages",
    sessionId: fork.nativeSessionId,
  });
  return {
    expected,
    admitted,
    key,
    receipt,
    fork,
    log,
    historySha256: digest(JSON.stringify(history)),
    forkHistorySha256: digest(JSON.stringify(forkHistory)),
  };
}
async function preserved(host, epoch, original) {
  const { expected, fork } = original;
  const current = await snapshot(host, epoch, 2);
  assert.deepEqual(
    current.sessions.map((entry) => entry.id).sort(),
    [expected.appSessionId, fork.appSessionId].sort(),
  );
  assert.equal(current.workspaces.length, 1);
  assert.equal(current.retainedOperations.length, 0);
  const ids = [expected.nativeSessionId, fork.nativeSessionId];
  await readExactNativeInventory(
    (input) => host.request("native", { operation: "list", ...input }),
    ids,
  );
  assert.deepEqual(await lookup(host, epoch, original.key), original.receipt);
  assert.deepEqual(
    await host.request("identity", { key: original.key }),
    original.admitted,
  );
  const native = await host.request("native", {
    operation: "get",
    sessionId: expected.nativeSessionId,
  });
  assertNativeMetadataCorrelation(native, original.admitted, expected);
  assert.equal(native.location.directory, expected.directory);
  await assertNativeForkCheckpoint(host, epoch, fork);
  for (const [sessionId, sha256] of [
    [expected.nativeSessionId, original.historySha256],
    [fork.nativeSessionId, original.forkHistorySha256],
  ])
    assert.equal(
      digest(
        JSON.stringify(
          await host.request("native", { operation: "messages", sessionId }),
        ),
      ),
      sha256,
    );
  const currentLog = await host.request("native", {
    operation: "log",
    sessionId: expected.nativeSessionId,
  });
  if (original.log.length)
    assertNativeEventsPreserved(
      original.log,
      currentLog.events,
      expected.nativeSessionId,
    );
  return {
    exactSessions: 2,
    exactHistory: true,
    exactRootAdmission: true,
    exactOriginalReceipts: true,
    exactForkLineage: true,
    eventHistoryProved: original.log.length > 0,
  };
}
async function anchor(output, name, report) {
  const path = join(output, name);
  await fs.mkdir(path, { mode: 0o700 });
  report.retainedSyntheticNamespaces.push(path);
  return path;
}
async function normalAndCrash(context, report, output) {
  const path = await anchor(output, "normal-and-sigkill", report);
  let host = await launchHost(path, context);
  const epoch = "native-preflight-fresh";
  const started = await start(host, epoch, context);
  assertProductionProbeStart(started, true);
  report.observations.push({ scenario: "fresh-production-bootstrap", started });
  const original = await seed(host, epoch, report);
  const clean = await closeHost(host, context);
  report.observations.push({ scenario: "normal-stop-lifetime", ...clean });
  const firstPid = host.record.child.pid;
  host = await launchHost(path, context);
  assert.notEqual(host.record.child.pid, firstPid);
  report.observations.push({
    scenario: "normal-start-request",
    timeoutMs: startupBudgetMs,
  });
  const reopened = await start(host, "native-preflight-normal", context);
  report.observations.push({
    scenario: "normal-start-attempt",
    decision: reopened,
  });
  assertProductionProbeStart(reopened, false);
  const normal = await preserved(host, "native-preflight-normal", original);
  const inspectors = context.descendants.filter(
    (entry) =>
      entry.appPid === host.record.child.pid && entry.role === "inspector",
  );
  assert.ok(
    inspectors.length >= 2 && inspectors.every((entry) => entry.exited),
  );
  report.observations.push({
    scenario: "normal-production-preflight-reopen",
    ...normal,
    inspectorChecks: inspectors.length,
    productionAuthority: true,
  });
  const crash = await closeHost(host, context, { crash: true });
  const stoppedSet = await snapshotNativeOriginals(host.record.durable.data);
  const wal = stoppedSet.find((entry) => entry.name.endsWith("-wal"));
  assert.ok(
    wal.present && BigInt(wal.identity.size) > 32n,
    "Actual retained WAL required",
  );
  report.observations.push({
    scenario: "idle-sigkill-lifetime",
    ...crash,
    originalCompleteSet: stoppedSet,
  });
  const priorPid = host.record.child.pid;
  host = await launchHost(path, context);
  assert.notEqual(host.record.child.pid, priorPid);
  report.observations.push({
    scenario: "sigkill-start-request",
    timeoutMs: startupBudgetMs,
  });
  const crashReopened = await start(host, "native-preflight-sigkill", context);
  report.observations.push({
    scenario: "sigkill-start-attempt",
    decision: crashReopened,
  });
  assertProductionProbeStart(crashReopened, false);
  const recovered = await preserved(host, "native-preflight-sigkill", original);
  report.observations.push({
    scenario: "sigkill-production-preflight-reopen",
    ...recovered,
    fullWalSetObserved: true,
    productionAuthority: true,
  });
  report.observations.push({
    scenario: "final-normal-stop",
    ...(await closeHost(host, context)),
  });
}
async function nativePending(context, report, output) {
  const path = await anchor(output, "native-only-pending", report);
  let host = await launchHost(path, context);
  const epoch = "native-preflight-pending-producer";
  assertProductionProbeStart(await start(host, epoch, context), true);
  await snapshot(host, epoch, 1);
  const view = await host.request("view");
  const produced = await host.request("retain-native-only-inbox", {
    nativeSessionId: view.sessions[0].nativeSessionId,
  });
  report.observations.push({
    scenario: "actual-public-native-only-producer",
    ...produced,
  });
  if (produced.status !== "produced") {
    report.unmetProof.push("actual-public-native-only-inbox-producer");
    await closeHost(host, context);
    return;
  }
  assert.equal(produced.appRegistryIntent, false);
  await closeHost(host, context);
  host = await launchHost(path, context);
  const before = await snapshotNativeOriginals(host.record.durable.data);
  const held = await start(host, "native-preflight-pending-held", context);
  assert.equal(held.startupAuthority, "production-native-preflight");
  assert.equal(held.blocked, true);
  assert.equal(held.metadataOnly, true);
  assert.equal(held.reason, "pending_inbox");
  assert.equal(held.spawned, 0);
  assert.equal(held.fresh, false);
  assert.equal(held.windows, 0);
  const after = await snapshotNativeOriginals(host.record.durable.data);
  assert.deepEqual(after, before);
  let blocked;
  for (let i = 0; i < 10; i++) {
    blocked = validateSnapshot(
      value(
        await host.request("handle", {
          envelope: probeEnvelope("native-preflight-pending-held", {
            type: "snapshot",
          }),
        }),
      ),
    );
    if (blocked.recovery.store.state === "recovery_required") break;
    await wait(25);
  }
  assert.equal(blocked.recovery.store.reason, "pending_inbox");
  assert.equal(blocked.state, "unavailable");
  assert.equal(blocked.retainedOperations.length, 0);
  assert.deepEqual(blocked.messages, []);
  assert.deepEqual(blocked.permissions, []);
  assert.equal(
    (
      await host.request("handle", {
        envelope: probeEnvelope("native-preflight-pending-held", {
          type: "workspace.create",
        }),
      })
    ).code,
    "UNAVAILABLE",
  );
  const processes = await host.request("probe-processes");
  assert.equal(processes.nativeSpawnCount, 0);
  assert.ok(
    processes.descendants.some(
      (entry) => entry.role === "inspector" && entry.exited,
    ),
  );
  report.observations.push({
    scenario: "native-only-pending-production-denial",
    reason: held.reason,
    executorSpawns: 0,
    appRetainedCount: 0,
    metadataOnly: true,
    originalCompleteSet: { before, after, unchanged: true },
  });
  report.observations.push({
    scenario: "pending-close",
    ...(await closeHost(host, context)),
  });
}
async function cleanup(context) {
  for (const record of context.hosts) {
    if (!record.exited) await cleanupOwnerHost(record);
    if (record.exited && record.witnessObserver) {
      try {
        await record.witnessObserver.ended();
      } catch {
        /* Keep unconfirmed proof false. */
      }
    }
  }
  for (const record of context.observers) {
    if (!record.exited) {
      record.child.kill("SIGTERM");
      try {
        await bounded(record.waitForExit(), 5000);
      } catch {
        /* Retain uncertainty. */
      }
    }
  }
  return {
    complete:
      context.hosts.every(
        (record) =>
          record.exited &&
          record.nativeExitConfirmed &&
          !record.protocolFailed &&
          !record.cleanup?.explicitCleanupFailed,
      ) &&
      context.observers.every((record) => record.exited) &&
      context.descendants.every((record) => record.exited),
    apps: context.hosts.map((record) => ({
      identity: record.identity,
      exited: record.exited,
      exit: record.exit,
      nativeExitConfirmed: record.nativeExitConfirmed,
      preflightClose: record.preflightClose,
      protocolFailed: record.protocolFailed === true,
      cleanup: record.cleanup,
    })),
    observers: context.observers.map((record) => ({
      pid: record.child.pid,
      exited: record.exited,
      exit: record.exit,
    })),
    descendants: context.descendants,
  };
}
export async function runNativePreflightProbe(args = process.argv.slice(2)) {
  process.umask(0o077);
  const options = parseNativeProbeOptions(args);
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const output = await claimNativeProbeOutput(repository, options.out);
  const report = {
    schemaVersion: 1,
    result: "fail",
    kind: "actual-production-native-preflight",
    output,
    startedAt: new Date().toISOString(),
    observations: [],
    unmetProof: [],
    retainedSyntheticNamespaces: [],
    identities: {},
    limitations: [
      "Synthetic public SDK history; no provider or credential execution.",
      "No production Main, windows, private stores, Windows or power-loss acceptance.",
      "Copied fault unit tests are not an actual public Native pending producer.",
      "Scoped before/after identities cannot detect change-and-restore between observations.",
      "No worker self-approval or final independent gate.",
    ],
  };
  const context = { hosts: [], observers: [], descendants: [] };
  let phase = "provenance-before";
  try {
    context.identities = report.identities.before = await identities();
    phase = "normal-and-sigkill";
    await normalAndCrash(context, report, output);
    phase = "native-only-pending";
    await nativePending(context, report, output);
  } catch (error) {
    report.failure = {
      ...closedProbeFailure(phase),
      deadlineExceeded: error?.code === "PROBE_DEADLINE",
    };
  } finally {
    report.cleanup = await cleanup(context);
    phase = "provenance-after";
    try {
      report.identities.after = await identities();
      assert.deepEqual(report.identities.after, report.identities.before);
      report.identities.unchanged = true;
    } catch {
      report.failure ??= closedProbeFailure(phase);
      report.identities.unchanged = false;
    }
    const expected = [
      "fresh-production-bootstrap",
      "normal-production-preflight-reopen",
      "sigkill-production-preflight-reopen",
      "native-only-pending-production-denial",
    ];
    if (
      !report.failure &&
      !report.unmetProof.length &&
      report.cleanup.complete &&
      report.identities.unchanged &&
      expected.every((name) =>
        report.observations.some((entry) => entry.scenario === name),
      )
    )
      report.result = "pass";
    report.finishedAt = new Date().toISOString();
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    assert.ok(Buffer.byteLength(bytes) <= 4 * 1024 * 1024);
    await fs.writeFile(join(output, "native-preflight-evidence.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === ownFile) {
  runNativePreflightProbe()
    .then((report) => {
      process.exitCode = report.result === "pass" ? 0 : 1;
      process.stdout.write(
        `${JSON.stringify({
          result: report.result,
          report: join(report.output, "native-preflight-evidence.json"),
          cleanup: report.cleanup.complete,
        })}\n`,
      );
    })
    .catch(() => {
      process.exitCode = 1;
      process.stderr.write(
        "Native preflight probe failed before report creation\n",
      );
    });
}
