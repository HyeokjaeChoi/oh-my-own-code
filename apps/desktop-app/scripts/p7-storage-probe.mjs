// Saved P7 native acceptance. Execute ONLY after Main's coherent freeze/approval.
// Node imports/tests never spawn Electron, native, GUI or a provider.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktop, "../..");
const evidenceRelatives = [
  "docs/runs/durable-workbench-storage/evidence",
  "docs/runs/event-host-app-integration/evidence",
];
const scriptPaths = [
  "p7-storage-probe.mjs",
  "fixtures/p7-storage-owner-host.mjs",
  "fixtures/p7-storage-migration.mjs",
  "fixtures/workbench-host.mjs",
  "fixtures/workbench-host.test.mjs",
  "e2e-workbench-states.mjs",
];
const sha = (v) => createHash("sha256").update(v).digest("hex");
const limit = {
  fileBytes: 1024 * 1024 * 1024,
  reportBytes: 4 * 1024 * 1024,
  ipcBytes: 1024 * 1024,
  childOutputBytes: 64 * 1024,
  timeoutMs: 35000,
  // Starting includes full verification of the pinned 35k-file resource tree.
  startupMs: 120000,
};

// Test/probe assertion only: authority is the host's defensive admitted identity,
// never a digest or receipt invented from native metadata. Keep failures redacted.
export function assertNativeMetadataCorrelation(native, admitted, expected) {
  const reject = "Native metadata correlation rejected";
  const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);
  assert.ok(
    admitted &&
      expected &&
      id(expected.runtimeEpoch) &&
      id(expected.operationId) &&
      id(expected.appSessionId) &&
      id(expected.workspaceId) &&
      id(expected.nativeSessionId) &&
      admitted.runtimeEpoch === expected.runtimeEpoch &&
      admitted.operationId === expected.operationId &&
      admitted.type === "workspace.create" &&
      typeof admitted.digest === "string" &&
      /^[a-f0-9]{64}$/.test(admitted.digest) &&
      native?.id === expected.nativeSessionId,
    reject,
  );
  assert.ok(
    isDeepStrictEqual(native.metadata, {
      operationId: admitted.operationId,
      originalRuntimeEpoch: admitted.runtimeEpoch,
      appSessionId: expected.appSessionId,
      workspaceId: expected.workspaceId,
      digest: admitted.digest,
    }),
    reject,
  );
  return {
    runtimeEpoch: admitted.runtimeEpoch,
    operationId: admitted.operationId,
  };
}
function assertOriginalCreateReceipt(lookup, key, expected) {
  const receipt = lookup?.receipt;
  assert.ok(
    lookup?.status === "found" &&
      lookup.runtimeEpoch === key.runtimeEpoch &&
      lookup.operationId === key.operationId &&
      receipt?.runtimeEpoch === key.runtimeEpoch &&
      receipt?.operationId === key.operationId &&
      receipt?.type === "workspace.create" &&
      receipt?.effect === "confirmed" &&
      isDeepStrictEqual(receipt?.result, {
        kind: "created",
        workspaceId: expected.workspaceId,
        sessionId: expected.appSessionId,
        nativeSessionId: expected.nativeSessionId,
      }),
    "Original Native create receipt correlation rejected",
  );
}

// These are hashes of actual SDK log bytes, never fabricated transfer events.
export function assertNativeDurableLog(log, nativeSessionId, renamedTitle) {
  const reject = "Native durable log rejected";
  assert.ok(Array.isArray(log) && log.length > 0 && log.length <= 128, reject);
  let previous = -1;
  for (const entry of log) {
    const keys = ["type", "aggregateID", "version", "sequence", "sha256"];
    if (entry?.type === "session.renamed")
      keys.push("dataSessionID", "titleSha256");
    assert.ok(
      entry &&
        isDeepStrictEqual(Object.keys(entry).sort(), keys.sort()) &&
        typeof entry.type === "string" &&
        entry.type.startsWith("session.") &&
        entry.aggregateID === nativeSessionId &&
        entry.version === 1 &&
        Number.isSafeInteger(entry.sequence) &&
        entry.sequence >= 0 &&
        entry.sequence > previous &&
        typeof entry.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(entry.sha256) &&
        (entry.type !== "session.renamed" ||
          (entry.dataSessionID === nativeSessionId &&
            typeof entry.titleSha256 === "string" &&
            /^[a-f0-9]{64}$/.test(entry.titleSha256))),
      reject,
    );
    previous = entry.sequence;
  }
  if (renamedTitle !== undefined)
    assert.ok(
      log.some(
        (entry) =>
          entry.type === "session.renamed" &&
          entry.titleSha256 === sha(renamedTitle),
      ),
      reject,
    );
}

export function assertNativeEventsPreserved(before, after, nativeSessionId) {
  assertNativeDurableLog(before, nativeSessionId);
  assertNativeDurableLog(after, nativeSessionId);
  for (const event of before)
    assert.deepEqual(
      after.find((entry) => entry.sequence === event.sequence),
      event,
      "Every original durable Native event must survive with identical bytes",
    );
}

// Only a completed, correlated, marker-only full-history read is an unsupported
// capability. Missing/malformed responses still fail closed. No marker is an event.
export function assessNativeEventHistory(
  log,
  diagnostic,
  nativeSessionId,
  title,
) {
  if (Array.isArray(log) && log.length === 0) {
    assert.ok(
      diagnostic?.completed === true &&
        diagnostic.after === null &&
        diagnostic.follow === false &&
        diagnostic.count === 1 &&
        diagnostic.head?.seen === true &&
        diagnostic.head.aggregateMatches === true &&
        (diagnostic.head.sequence === null ||
          (Number.isSafeInteger(diagnostic.head.sequence) &&
            diagnostic.head.sequence >= 0)) &&
        diagnostic.events?.length === 1 &&
        diagnostic.events[0].type === "log.synced" &&
        diagnostic.events[0].aggregateMatches === true &&
        diagnostic.events[0].sequence === diagnostic.head.sequence,
      "Native event capability diagnostic rejected",
    );
    return {
      status: "unsupported",
      nonemptyRequiredEventHistory: false,
      eventLogAcceptance: false,
      requirement: "native-event-history",
      reason:
        "Stock packaged CLI does not enable durable event payload persistence; sync watermark alone is not event history.",
    };
  }
  assertNativeDurableLog(log, nativeSessionId, title);
  return {
    status: "available",
    nonemptyRequiredEventHistory: true,
    eventLogAcceptance: true,
    requirement: "native-event-history",
  };
}

// Independent scopes continue after a failed scope; no failed observation or
// missing capability can become a passing final report. Cleanup remains outside.
export async function runIndependentProbeSteps(report, steps) {
  report.result = "fail";
  for (const { name, run } of steps) {
    try {
      await run();
    } catch (error) {
      report.error ??= {
        name: "Error",
        code:
          error?.code === "PROBE_ASSERTION"
            ? "PROBE_ASSERTION"
            : "PROBE_STEP_FAILED",
        message:
          error?.message === "Native historical log stream rejected"
            ? error.message
            : "Independent probe observation failed; see bounded progress diagnostics",
      };
      (report.stepFailures ??= []).push({
        step: name,
        locations: String(error?.stack ?? "")
          .split("\n")
          .flatMap((line) => {
            const match = line.match(
              /apps\/desktop-app\/[A-Za-z0-9_./-]+:\d+:\d+/,
            );
            return match ? [match[0]] : [];
          })
          .slice(0, 4),
        code:
          error?.code === "PROBE_ASSERTION"
            ? "PROBE_ASSERTION"
            : "PROBE_STEP_FAILED",
      });
    }
  }
  report.failedRequirements =
    report.nativeEventCapability?.eventLogAcceptance === true
      ? []
      : ["native-event-history"];
  if (report.nativeEventCapability?.status === "unsupported")
    report.error ??= {
      name: "Error",
      code: "NATIVE_EVENT_HISTORY_UNSUPPORTED",
      message:
        "Native event history requirement unmet; marker-only diagnostic is unsupported",
    };
  report.result =
    !report.stepFailures?.length && !report.failedRequirements.length
      ? "pass"
      : "fail";
}

export function assertSavedProbeResult(report, failure) {
  if (failure) throw failure;
  assert.ok(
    report.result === "pass",
    "Saved P7 requirements or observations failed; namespaces retained",
  );
}

async function readNativeLog(host, nativeSessionId, progress) {
  try {
    const result = await host.request("native", {
      operation: "log",
      sessionId: nativeSessionId,
    });
    progress.logDiagnostic = result?.diagnostic ?? {
      responseArray: Array.isArray(result),
      count: Array.isArray(result) ? result.length : null,
    };
    return result?.events;
  } catch (error) {
    if (error.nativeLogDiagnostic)
      progress.logDiagnostic = error.nativeLogDiagnostic;
    throw error;
  }
}

export async function prepareNativeEventFixture(
  host,
  expected,
  originalReceipt,
  progress,
) {
  const { runtimeEpoch, workspaceId, appSessionId, nativeSessionId } = expected;
  const key = { runtimeEpoch, operationId: expected.operationId };
  progress.phase = "history-export-import";
  const original = await host.request("native", {
    operation: "get",
    sessionId: nativeSessionId,
  });
  assertNativeMetadataCorrelation(
    original,
    await host.request("identity", { key }),
    expected,
  );
  assert.equal(
    original.location?.directory,
    expected.directory,
    "Native history location rejected",
  );
  await host.request("native", {
    operation: "history",
    sessionId: nativeSessionId,
    location: original.location,
    metadata: original.metadata,
  });
  const history = await host.request("native", {
    operation: "messages",
    sessionId: nativeSessionId,
  });
  assert.ok(JSON.stringify(history).includes("P7 synthetic durable history"));
  const before = await host.request("native", {
    operation: "get",
    sessionId: nativeSessionId,
  });
  assert.ok(
    before.id === original.id &&
      isDeepStrictEqual(before.location, original.location) &&
      isDeepStrictEqual(before.metadata, original.metadata),
    "Native history mapping rejected",
  );
  const title = "P7 durable event after history import";
  assert.notEqual(before.title, title, "Distinct post-import title required");
  progress.phase = "history-event-rename";
  const envelope = wire(
    runtimeEpoch,
    {
      type: "session.rename",
      workspaceId,
      sessionId: appSessionId,
      requestId: "rename-after-history-import",
      title,
    },
    "p7-rename-after-history-import",
  );
  // The owner host routes handle through the production service and its sender.
  const result = await host.request("handle", { envelope });
  const receipt = result?.receipt;
  assert.ok(
    result?.ok === true &&
      receipt?.runtimeEpoch === runtimeEpoch &&
      receipt?.operationId === envelope.operationId &&
      receipt?.type === "session.rename" &&
      receipt?.workspaceId === workspaceId &&
      receipt?.sessionId === appSessionId &&
      receipt?.effect === "confirmed" &&
      isDeepStrictEqual(receipt.result, {
        kind: "metadata",
        workspaceId,
        sessionId: appSessionId,
      }),
    "Post-import Native rename receipt correlation rejected",
  );
  const native = await host.request("native", {
    operation: "get",
    sessionId: nativeSessionId,
  });
  assert.equal(native.title, title);
  assertNativeMetadataCorrelation(
    native,
    await host.request("identity", { key }),
    expected,
  );
  const lookup = value(
    await host.request("handle", {
      envelope: wire(runtimeEpoch, { type: "operation.lookup", ...key }),
    }),
  );
  assertOriginalCreateReceipt(lookup, key, expected);
  assert.ok(
    isDeepStrictEqual(lookup.receipt, originalReceipt.receipt),
    "Original receipt changed",
  );
  progress.phase = "history-event-log";
  const log = await readNativeLog(host, nativeSessionId, progress);
  progress.eventCapability = assessNativeEventHistory(
    log,
    progress.logDiagnostic,
    nativeSessionId,
    title,
  );
  return log;
}

export async function assertNativeForkCheckpoint(host, epoch, expected) {
  const key = expected.key;
  const lookup = value(
    await host.request("handle", {
      envelope: wire(epoch, { type: "operation.lookup", ...key }),
    }),
  );
  assert.equal(lookup.status, "found", "Original fork receipt missing");
  assert.deepEqual(
    lookup.receipt,
    expected.receipt,
    "Original fork receipt changed",
  );
  assert.deepEqual(
    await host.request("identity", { key }),
    expected.identity,
    "Original fork admission changed",
  );
  const view = await host.request("view");
  const child = view.sessions.find(
    (entry) => entry.appSessionId === expected.appSessionId,
  );
  assert.equal(child?.nativeSessionId, expected.nativeSessionId);
  assert.equal(child?.parentSessionId, expected.parentAppSessionId);
  assert.equal(child?.workspaceId, expected.workspaceId);
  const current = await snapshot(host, epoch, 2);
  assert.equal(
    current.sessions.find((entry) => entry.id === expected.appSessionId)
      ?.status,
    "idle",
    "Saved fork mapping unavailable",
  );
  const native = await host.request("native", {
    operation: "get",
    sessionId: expected.nativeSessionId,
  });
  assert.equal(native.id, expected.nativeSessionId);
  assert.equal(native.location?.directory, expected.directory);
  assert.equal(native.fork?.sessionID, expected.parentNativeSessionId);
  assert.deepEqual(native.metadata, expected.inheritedMetadata);
  const history = await host.request("native", {
    operation: "messages",
    sessionId: expected.nativeSessionId,
  });
  assert.ok(JSON.stringify(history).includes("P7 synthetic durable history"));
  return { originalKey: key, exactLineage: true, historyPreserved: true };
}

export function parseProbeOptions(args) {
  assert.equal(
    args.length,
    6,
    "Usage: p7-storage-probe.mjs --out <fresh evidence path> --mode packaged --platform darwin",
  );
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    assert.ok(
      ["--out", "--mode", "--platform"].includes(key) &&
        !Object.hasOwn(result, key),
    );
    assert.ok(
      typeof args[i + 1] === "string" &&
        args[i + 1] &&
        !args[i + 1].startsWith("--"),
    );
    result[key] = args[i + 1];
  }
  assert.equal(result["--mode"], "packaged");
  assert.equal(result["--platform"], "darwin");
  return { out: result["--out"], mode: "packaged", platform: "darwin" };
}
async function checkedPath(root, path) {
  assert.equal(await fs.realpath(root), root, "Canonical root required");
  const rel = relative(root, path);
  assert.ok(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    "Path must remain under owned root",
  );
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stat = await fs.lstat(current);
    assert.equal(stat.isSymbolicLink(), false, "Symlink rejected");
    if (current !== path) assert.equal(stat.isDirectory(), true);
  }
  return fs.lstat(path);
}
export async function claimProbeOutput(root, out) {
  const destination = resolve(root, out);
  const allowed = evidenceRelatives
    .map((entry) => join(root, entry))
    .find((candidate) => {
      const within = relative(candidate, destination);
      return (
        within &&
        !isAbsolute(within) &&
        within !== ".." &&
        !within.startsWith(`..${sep}`)
      );
    });
  assert.ok(allowed, "Output must remain under registered evidence root");
  const rel = relative(allowed, destination);
  assert.ok(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    "Output must remain under registered evidence root",
  );
  await checkedPath(root, allowed);
  const parts = rel.split(sep);
  let parent = allowed;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    try {
      await fs.mkdir(parent, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await checkedPath(root, parent);
  }
  try {
    await fs.mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assert.ok((await checkedPath(root, destination)).isDirectory());
  assert.equal(
    (await fs.readdir(destination)).length,
    0,
    "Consumed/nonempty evidence path cannot be reused",
  );
  const claim = await fs.open(
    join(destination, ".p7-probe-claim"),
    "wx",
    0o600,
  );
  try {
    await claim.writeFile("P7 exclusive saved probe\n");
    await claim.sync();
  } finally {
    await claim.close();
  }
  return destination;
}
async function fileIdentity(root, path) {
  const before = await checkedPath(root, path);
  assert.ok(
    before.isFile() && before.nlink === 1 && before.size <= limit.fileBytes,
  );
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    assert.ok(bytes <= limit.fileBytes);
    hash.update(chunk);
  }
  const after = await checkedPath(root, path);
  assert.equal(after.size, before.size);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  return {
    path: relative(root, path).split(sep).join("/"),
    size: bytes,
    sha256: hash.digest("hex"),
  };
}
async function identities() {
  const { captureProvenance } = await import("./build-provenance.mjs");
  // Reuse the existing package inspector/manifest contract; app.asar bytes must
  // exactly match stamped build and package native bytes match build resources.
  const build = await captureProvenance(repository, {
    script: "smoke",
    mode: "packaged",
    platform: "darwin",
  });
  const scripts = [];
  for (const name of scriptPaths)
    scripts.push(
      await fileIdentity(repository, join(desktop, "scripts", name)),
    );
  const nativeFile = build.launchArtifacts.files.filter((f) =>
    /\/Contents\/Resources\/opencode\/darwin-(?:arm64|x64)\/opencode$/.test(
      f.path,
    ),
  );
  assert.equal(
    nativeFile.length,
    1,
    "Exact inspected packaged sidecar required",
  );
  const legacyNativePath = join(repository, nativeFile[0].path);
  const { executableForResources } = await import(
    "../src/sidecar-supervisor.mjs"
  );
  assert.equal(
    legacyNativePath,
    executableForResources(
      resolve(legacyNativePath, "../../.."),
      "darwin",
      process.arch,
    ),
  );
  const helperRequire = createRequire(import.meta.url);
  const helperExecutable = await fs.realpath(helperRequire("electron"));
  const installedElectronVersion = helperRequire(
    "electron/package.json",
  ).version;
  const declaredElectronVersion = JSON.parse(
    await fs.readFile(join(desktop, "package.json"), "utf8"),
  ).devDependencies.electron;
  assert.equal(
    installedElectronVersion,
    declaredElectronVersion,
    "Pinned Electron helper runtime required",
  );
  const helperExecutableIdentity = await fileIdentity(
    repository,
    helperExecutable,
  );
  const legacyNativeBytes = await fileIdentity(repository, legacyNativePath);
  assert.equal(legacyNativeBytes.sha256, nativeFile[0].sha256);
  const {
    eventHostForResources,
    verifyEventHostResources,
    eventHostInventorySha256,
  } = await import("../src/event-host-resources.mjs");
  const eventHost = eventHostForResources(
    resolve(legacyNativePath, "../../.."),
    "darwin",
    process.arch,
  );
  const eventHostManifest = await verifyEventHostResources(eventHost);
  const eventHostManifestBytes = await fileIdentity(
    repository,
    eventHost.manifestPath,
  );
  const nativePath = eventHost.enginePath;
  const nativeBytes = await fileIdentity(repository, nativePath);
  return {
    build,
    scripts,
    probeSha256: scripts[0].sha256,
    packageSha256: build.launchArtifacts.sha256,
    nativeBytes,
    legacyNativeBytes,
    eventHost,
    eventHostManifestBytes,
    eventHostInventorySha256: eventHostInventorySha256(
      eventHostManifest.entries,
    ),
    runtimeVersion: eventHostManifest.bunVersion,
    nativeVersion: "2.0.18",
    helperExecutable,
    helperExecutableIdentity,
    installedElectronVersion,
    nativePath,
  };
}

async function bounded(promise, ms = limit.timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned probe deadline expired")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// The SDK exposes an opaque continuation, not proof that another item exists.
// Read to a terminal cursor; compare the entire bounded inventory, never a prefix.
export async function readExactNativeInventory(
  list,
  expectedIds,
  { maxPages = 8, maxItems = 200, timeoutMs = 10000 } = {},
) {
  for (const bound of [maxPages, maxItems, timeoutMs])
    assert.ok(Number.isSafeInteger(bound) && bound > 0);
  const ids = new Set();
  const cursors = new Set();
  const deadline = Date.now() + timeoutMs;
  let cursor;
  for (let pages = 1; pages <= maxPages; pages++) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, "Native inventory deadline expired");
    const page = await bounded(
      list({ limit: 100, ...(cursor && { cursor }) }),
      remaining,
    );
    assert.ok(
      Array.isArray(page?.data) && page.data.length <= 100,
      "Native inventory page bound or shape invalid",
    );
    assert.ok(
      page.cursor &&
        typeof page.cursor === "object" &&
        !Array.isArray(page.cursor),
      "Native inventory cursor required",
    );
    for (const entry of page.data) {
      assert.ok(
        typeof entry?.id === "string" &&
          entry.id.length > 0 &&
          entry.id.length <= 512,
        "Native inventory ID invalid",
      );
      assert.ok(!ids.has(entry.id), "Native inventory duplicate ID");
      ids.add(entry.id);
      assert.ok(ids.size <= maxItems, "Native inventory item bound exceeded");
    }
    const next = page.cursor.next;
    if (next === undefined || next === null) {
      assert.deepEqual(
        [...ids].sort(),
        [...expectedIds].sort(),
        "Exact native inventory mismatch",
      );
      return { ids: [...ids].sort(), pages };
    }
    assert.ok(
      typeof next === "string" &&
        next.length > 0 &&
        Buffer.byteLength(next) <= 4096,
      "Native inventory cursor invalid",
    );
    assert.ok(!cursors.has(next), "Native inventory cursor repeated");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("Native inventory page bound exceeded");
}

function confirmNativeStop(record, result) {
  assert.equal(result?.exited, true, "Owned native stop required");
  assert.equal(
    typeof result.nativeStarted,
    "boolean",
    "Native start disposition required",
  );
  if (result.nativeStarted) {
    assert.ok(
      result.nativeIdentity && result.nativeExit,
      "Exact owned native exit required",
    );
    assert.ok(
      Number.isSafeInteger(result.nativeIdentity.pid) &&
        result.nativeIdentity.pid > 0 &&
        ["platform", "bootId", "startToken"].every(
          (key) =>
            typeof result.nativeIdentity[key] === "string" &&
            result.nativeIdentity[key].length > 0,
        ),
      "Native process identity invalid",
    );
    const { code, signal } = result.nativeExit;
    assert.ok(
      (Number.isInteger(code) && signal === null) ||
        (code === null && typeof signal === "string" && signal.length > 0),
      "Native exit event invalid",
    );
    if (record.nativeIdentity)
      assert.deepEqual(result.nativeIdentity, record.nativeIdentity);
  } else {
    assert.ok(
      !record.nativeIdentity && !result.nativeIdentity && !result.nativeExit,
      "Started native cannot become not-started proof",
    );
  }
  record.nativeExitConfirmed = true;
  record.nativeStopResult = result;
}

// Request proof while IPC is connected. Disconnect remains an unconfirmed fallback.
export async function cleanupOwnerHost(
  record,
  { timeoutMs = 25000, exitTimeoutMs = 15000 } = {},
) {
  record.cleanup = {
    explicitStopConfirmed: false,
    fallbackDisconnect: false,
    helperExitConfirmed: record.exited,
  };
  if (record.exited) return;
  const deadline = Date.now() + timeoutMs;
  const request = async (command) => {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, "Owned cleanup deadline expired");
    return bounded(
      record.request(command, {}, { cleanup: true, timeoutMs: remaining }),
      remaining,
    );
  };
  try {
    assert.equal(
      record.child.connected,
      true,
      "Owned cleanup IPC disconnected",
    );
    // Native first: metadata drain/checkpoint failure must not hide its exit proof.
    confirmNativeStop(record, await request("stop-native"));
    record.cleanup.explicitStopConfirmed = true;
    await request("stop");
    await request("quit");
  } catch {
    record.cleanup.explicitCleanupFailed = true;
    record.cleanup.fallbackDisconnect = true;
    try {
      if (record.child.connected) record.child.disconnect();
    } catch {
      // IPC may close during fallback. This cannot establish native exit.
    }
  }
  try {
    if (!record.exited) await bounded(record.waitForExit(), exitTimeoutMs);
  } catch {
    // Only the owned exit listener may set exited; retain all durable evidence.
  }
  record.cleanup.helperExitConfirmed = record.exited;
}

export async function createOwnerHost(namespace, tracked) {
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(
    electron,
    [
      join(desktop, "scripts/fixtures/p7-storage-owner-host.mjs"),
      `--user-data-dir=${join(namespace, "electron-bootstrap-profile")}`,
    ],
    {
      env: {
        HOME: namespace,
        TMPDIR: namespace,
        TMP: namespace,
        TEMP: namespace,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        OMOC_P7_NAMESPACE: namespace,
      },
      cwd: namespace,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  const record = {
    child,
    namespace,
    exited: false,
    nativeExitConfirmed: true,
    identity: undefined,
  };
  tracked.push(record);
  let bytes = 0;
  let rejected;
  const pending = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((r, j) => {
    resolveReady = r;
    rejectReady = j;
  });
  let resolveExit;
  const exit = new Promise((r) => {
    resolveExit = r;
  });
  child.once("exit", (code, signal) => {
    record.exited = true;
    record.exit = { code, signal };
    resolveExit(record.exit);
    if (!record.identity)
      rejectReady(new Error("Owner host exited before ready"));
    for (const { reject } of pending.values())
      reject(new Error("Owner host exited during command"));
    pending.clear();
  });
  child.once("error", (error) => {
    rejected = error;
    if (child.pid === undefined) {
      record.exited = true;
      record.exit = { noProcessSpawned: true, code: error.code };
      resolveExit(record.exit);
    }
    rejectReady(error);
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit.childOutputBytes) {
        rejected = new Error("Owner host output limit exceeded");
        rejectReady(rejected);
        for (const { reject } of pending.values()) reject(rejected);
      }
      // Never export raw native/Electron output (may contain generated password).
    });
  child.on("message", (message) => {
    try {
      if (Buffer.byteLength(JSON.stringify(message)) > limit.ipcBytes) {
        rejected = new Error("Probe IPC output limit exceeded");
        rejectReady(rejected);
        for (const { reject } of pending.values()) reject(rejected);
        return;
      }
      if (message.event === "ready") {
        assert.equal(message.windows, 0);
        assert.equal(message.activationPolicy, "prohibited");
        record.identity = message.identity;
        record.durable = message.namespace;
        resolveReady(message);
      } else if (pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        if (message.ok) item.resolve(message.value);
        else
          item.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
              ...(message.error.extensionPhase && {
                extensionPhase: message.error.extensionPhase,
              }),
              ...(message.error.extensionAssertion && {
                extensionAssertion: message.error.extensionAssertion,
              }),
              ...(message.error.skillDiagnostic && {
                skillDiagnostic: message.error.skillDiagnostic,
              }),
              ...(message.error.nativeLogDiagnostic && {
                nativeLogDiagnostic: message.error.nativeLogDiagnostic,
              }),
              ...(message.error.agentDiagnostic && {
                agentDiagnostic: message.error.agentDiagnostic,
              }),
            }),
          );
      }
    } catch (error) {
      rejected = error;
      rejectReady(error);
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    }
  });
  async function request(command, input = {}, options = {}) {
    const cleanupCommand =
      options.cleanup === true &&
      ["stop-native", "stop", "quit"].includes(command);
    if (rejected && !cleanupCommand) throw rejected;
    assert.equal(record.exited, false);
    const id = randomUUID();
    const message = { id, command, ...input };
    assert.ok(Buffer.byteLength(JSON.stringify(message)) <= limit.ipcBytes);
    if (command === "start") {
      record.nativeExitConfirmed = false;
      record.nativeIdentity = undefined;
      record.nativeStopResult = undefined;
    }
    try {
      const result = await bounded(
        new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          child.send(message, (error) => {
            if (error) reject(error);
          });
        }),
        options.timeoutMs ??
          (command === "start" ? limit.startupMs : limit.timeoutMs),
      );
      if (command === "start") record.nativeIdentity = result.nativeIdentity;
      if (["stop-native", "stop"].includes(command))
        confirmNativeStop(record, result);
      return result;
    } finally {
      pending.delete(id);
    }
  }
  record.request = request;
  record.waitForExit = () => exit;
  await bounded(ready);
  return {
    record,
    request,
    async quit() {
      await request("quit");
      const result = await bounded(exit, 15000);
      assert.equal(result.code, 0);
      return record.identity;
    },
    exit,
  };
}
async function namespace(name, report) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), `omoc-p7-${name}-`)),
  );
  report.namespaces.push({
    name,
    root,
    retention: "durable synthetic evidence retained; no recursive cleanup",
  });
  return root;
}
function wire(epoch, operation, id = randomUUID()) {
  const read = [
    "snapshot",
    "operation.lookup",
    "diagnostics.list",
    "file.list",
    "catalog.list",
  ].includes(operation.type);
  return {
    version: 2,
    ...(epoch && { runtimeEpoch: epoch }),
    [read ? "readId" : "operationId"]: id,
    operation,
  };
}
const value = (result) => {
  assert.equal(result.ok, true, result.code);
  return result.value;
};
async function snapshot(host, epoch, expectedSessions) {
  const { validateSnapshot } = await import("../src/workbench-contract.mjs");
  for (let i = 0; i < 100; i++) {
    const result = await host.request("handle", {
      envelope: wire(epoch, { type: "snapshot" }),
    });
    const view = validateSnapshot(value(result));
    if (view.state === "connected" && view.sessions.length >= expectedSessions)
      return view;
    if (view.recovery.store.state === "recovery_required")
      throw new Error(`Native facade held: ${view.recovery.store.reason}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Bootstrap/reopen snapshot deadline expired");
}
async function assertBlockedFacade(host, epoch, reason) {
  const { validateSnapshot } = await import("../src/workbench-contract.mjs");
  let view;
  for (let i = 0; i < 10; i++) {
    view = validateSnapshot(
      value(
        await host.request("handle", {
          envelope: wire(undefined, { type: "snapshot" }),
        }),
      ),
    );
    if (view.recovery.store.state === "recovery_required") break;
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(view.runtimeEpoch, epoch);
  assert.deepEqual(view.recovery.store, { state: "recovery_required", reason });
  assert.equal(view.state, "unavailable");
  assert.deepEqual(view.messages, []);
  assert.deepEqual(view.permissions, []);
  const denied = await host.request("handle", {
    envelope: wire(epoch, { type: "workspace.create" }),
  });
  assert.equal(denied.code, "UNAVAILABLE");
  return {
    reason,
    metadataSnapshot: true,
    blockedMutation: true,
    nativeLaunches: 0,
  };
}

// Node-only synthetic journal fault observations. No auto recovery/adoption.
export async function probeJournalFaults(root) {
  const { openStorageJournal } = await import(
    "../src/host/storage-journal.mjs"
  );
  const cases = [];
  for (const name of [
    "corrupt",
    "version",
    "partial",
    "unconfirmed-valid-tail",
  ]) {
    const directory = join(root, name);
    await fs.mkdir(directory, { mode: 0o700 });
    const storeId = `synthetic-${name}`;
    const journal = await openStorageJournal({ directory, storeId });
    await journal.append({
      kind: "owner_intent",
      revision: 1,
      ownerNonce: "probe",
      phase: "startup",
    });
    await journal.checkpoint();
    const path = join(directory, "journal.jsonl");
    let expected;
    if (name === "unconfirmed-valid-tail") {
      await journal.close();
      const faulty = await openStorageJournal({
        directory,
        storeId,
        io: {
          syncFile: async (file, context) => {
            await file.sync();
            if (context === "append:owner_intent")
              throw new Error("Synthetic unconfirmed flush");
          },
        },
      });
      await assert.rejects(
        faulty.append({
          kind: "owner_intent",
          revision: 2,
          ownerNonce: "probe",
          phase: "shutdown",
        }),
        { code: "writer_poisoned" },
      );
      await faulty.close();
      expected = "unconfirmed_tail";
    } else {
      await journal.close();
      if (name === "partial") {
        await fs.appendFile(path, '{"schemaVersion":1');
        expected = "corrupt_journal";
      } else {
        const record = JSON.parse((await fs.readFile(path, "utf8")).trim());
        if (name === "version") {
          record.schemaVersion = 99;
          expected = "unsupported_version";
        } else {
          record.checksum = "f".repeat(64);
          expected = "corrupt_journal";
        }
        await fs.writeFile(path, JSON.stringify(record) + "\n");
      }
    }
    const before = await fs.readFile(path);
    const reopened = await openStorageJournal({ directory, storeId });
    try {
      assert.equal(reopened.status().reason, expected);
      assert.deepEqual(await fs.readFile(path), before);
      await assert.rejects(
        reopened.append({
          kind: "owner_intent",
          revision: 2,
          ownerNonce: "probe",
          phase: "shutdown",
        }),
        { code: expected },
      );
      assert.deepEqual(await fs.readFile(path), before);
      const checkpoint = reopened.status().checkpointSequence;
      if (name === "unconfirmed-valid-tail") {
        assert.equal(checkpoint, 1);
        assert.equal(reopened.readRecords().uncertain.length, 1);
      }
      const { openWorkspaceRegistry } = await import(
        "../src/host/workspace-registry.mjs"
      );
      const { createWorkbenchService } = await import(
        "../src/workbench-service.mjs"
      );
      const { validateSnapshot } = await import(
        "../src/workbench-contract.mjs"
      );
      const registry = await openWorkspaceRegistry({
        directory,
        storeId,
        runtimeEpoch: `fault-${name}`,
        documentsPath: root,
      });
      const service = createWorkbenchService({
        registry,
        runtimeEpoch: `fault-${name}`,
      });
      try {
        await new Promise((r) => setImmediate(r));
        const facade = validateSnapshot(
          value(
            await service.handle(
              wire(undefined, { type: "snapshot" }),
              "p7-journal-node",
            ),
          ),
        );
        assert.equal(facade.recovery.store.reason, expected);
        assert.equal(
          (
            await service.handle(
              wire(facade.runtimeEpoch, { type: "workspace.create" }),
              "p7-journal-node",
            )
          ).code,
          "UNAVAILABLE",
        );
        assert.deepEqual(await fs.readFile(path), before);
      } finally {
        service.close();
        await registry.close();
      }
      cases.push({
        case: name,
        reason: expected,
        bytesPreserved: true,
        appendBlocked: true,
        checkpointSequence: checkpoint,
        sha256: sha(before),
        size: before.length,
        metadataFacadeVisible: true,
        globalMutationBlocked: true,
        nativeLaunches: 0,
      });
    } finally {
      await reopened.close();
    }
  }
  return cases;
}

export async function probePartialMapping(root) {
  const { openWorkspaceRegistry } = await import(
    "../src/host/workspace-registry.mjs"
  );
  const { createWorkbenchService } = await import(
    "../src/workbench-service.mjs"
  );
  const { validateSnapshot } = await import("../src/workbench-contract.mjs");
  const directory = join(root, "partial-metadata");
  const documentsPath = join(root, "partial-Documents");
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.mkdir(documentsPath, { mode: 0o700 });
  let registry = await openWorkspaceRegistry({
    directory,
    documentsPath,
    storeId: "partial-store",
    runtimeEpoch: "partial-old",
  });
  const identity = {
    runtimeEpoch: "partial-old",
    operationId: "partial-create",
    type: "workspace.create",
    digest: "a".repeat(64),
  };
  await registry.begin(identity);
  const reservation = await registry.reserve({
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
    ownership: "managed",
    plannedNativeSessionId: "synthetic-native-partial",
  });
  await registry.materializeManaged({
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  });
  await registry.dispatch({
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
    step: "native.create",
    nativeSessionId: "synthetic-native-partial",
  });
  await registry.complete({
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
    receipt: {
      runtimeEpoch: identity.runtimeEpoch,
      operationId: identity.operationId,
      type: identity.type,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: 0,
      evidence: [],
    },
    delta: {
      workspaces: [
        { ...reservation.workspace, registrationState: "unavailable" },
      ],
      sessions: [
        {
          appSessionId: reservation.appSessionId,
          workspaceId: reservation.workspace.workspaceId,
          nativeSessionId: "synthetic-native-partial",
          lifecycleState: "unavailable",
          recoveryReason: "partial_native_mapping",
          title: "Synthetic partial mapping",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: ["synthetic-native-partial"],
  });
  await registry.checkpoint();
  await registry.close();
  registry = await openWorkspaceRegistry({
    directory,
    documentsPath,
    storeId: "partial-store",
    runtimeEpoch: "partial-current",
  });
  const recovered = registry.readView();
  assert.ok(
    recovered.recovery.resources.some(
      (r) => r.reason === "partial_native_mapping",
    ),
  );
  assert.equal(
    registry.lookup({
      runtimeEpoch: identity.runtimeEpoch,
      operationId: identity.operationId,
    }).receipt.effect,
    "unknown",
  );
  const copied = registry.lookupIdentity({
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  });
  assert.deepEqual(copied, identity);
  copied.digest = "b".repeat(64);
  assert.deepEqual(
    registry.lookupIdentity({
      runtimeEpoch: identity.runtimeEpoch,
      operationId: identity.operationId,
    }),
    identity,
  );
  const service = createWorkbenchService({
    registry,
    runtimeEpoch: "partial-current",
    recoveryReason: "native_startup_unverified",
  });
  try {
    await new Promise((r) => setImmediate(r));
    const snapshot = validateSnapshot(
      value(
        await service.handle(
          wire(undefined, { type: "snapshot" }),
          "p7-node-fixture",
        ),
      ),
    );
    assert.equal(snapshot.sessions[0].status, "unavailable");
    assert.ok(
      snapshot.retainedOperations.some(
        (k) =>
          k.runtimeEpoch === identity.runtimeEpoch &&
          k.operationId === identity.operationId,
      ),
    );
    const lookup = value(
      await service.handle(
        wire(snapshot.runtimeEpoch, {
          type: "operation.lookup",
          runtimeEpoch: identity.runtimeEpoch,
          operationId: identity.operationId,
        }),
        "p7-node-fixture",
      ),
    );
    assert.equal(lookup.status, "found");
    assert.equal(lookup.receipt.effect, "unknown");
    const refused = await service.handle(
      wire(snapshot.runtimeEpoch, {
        type: "session.interrupt",
        workspaceId: reservation.workspace.workspaceId,
        sessionId: reservation.appSessionId,
      }),
      "p7-node-fixture",
    );
    assert.equal(refused.code, "UNAVAILABLE");
    return {
      provenance:
        "synthetic exact verified ID with failed policy using production registry/service; no native launch",
      status: "unavailable",
      recoveryReason: "partial_native_mapping",
      originalKeyFound: true,
      effect: "unknown",
      mutationBlocked: true,
      nativeCalls: 0,
    };
  } finally {
    service.close();
    await registry.close();
  }
}

async function ownerObservations(report, tracked) {
  const observations = [];
  const collisionRoot = await namespace("collision", report);
  const first = await createOwnerHost(collisionRoot, tracked);
  assert.equal(
    (await first.request("acquire", { initialize: true })).state,
    "ready",
  );
  const ownerBytes = await fs.readFile(
    join(first.record.durable.root, "owner.json"),
  );
  const second = await createOwnerHost(collisionRoot, tracked);
  assert.equal(
    (await second.request("acquire", { initialize: false })).reason,
    "owner_conflict",
  );
  await second.request("blocked-start", {
    binaryPath: report.identities.before.nativePath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "collision-current",
    reason: "owner_conflict",
  });
  observations.push({
    case: "kernel-collision",
    ...(await assertBlockedFacade(
      second,
      "collision-current",
      "owner_conflict",
    )),
  });
  assert.deepEqual(
    await fs.readFile(join(first.record.durable.root, "owner.json")),
    ownerBytes,
  );
  await second.request("stop");
  await second.quit();
  await first.request("stop");
  await first.quit();
  const { captureDarwinIdentity } = await import(
    "./fixtures/p7-storage-owner-host.mjs"
  );
  for (const kind of [
    "dirty-live-child",
    "dirty-unverifiable-child",
    "spawn-intent-gap",
  ]) {
    const root = await namespace(kind, report);
    const prior = await createOwnerHost(root, tracked);
    assert.equal(
      (await prior.request("acquire", { initialize: true })).state,
      "ready",
    );
    let sentinel;
    let childIdentity;
    let childExit;
    if (kind !== "spawn-intent-gap") {
      sentinel = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          cwd: root,
          env: { HOME: root, TMPDIR: root, PATH: "/usr/bin:/bin" },
          stdio: "ignore",
        },
      );
      const record = {
        child: sentinel,
        namespace: root,
        exited: false,
        nativeExitConfirmed: true,
        kind: "synthetic-sentinel",
      };
      tracked.push(record);
      childExit = new Promise((r) =>
        sentinel.once("exit", (code, signal) => {
          record.exited = true;
          record.exit = { code, signal };
          r(record.exit);
        }),
      );
      childIdentity = await captureDarwinIdentity(sentinel.pid);
    }
    try {
      await prior.request("dirty", { childIdentity });
      const priorIdentity = await prior.quit();
      const before = await fs.readFile(
        join(prior.record.durable.root, "owner.json"),
      );
      const current = await createOwnerHost(root, tracked);
      const status = await current.request("acquire", {
        initialize: false,
        ownedExited: [priorIdentity],
        ...(kind === "dirty-unverifiable-child" && {
          unverified: [childIdentity],
        }),
      });
      assert.equal(status.reason, "owner_unverified");
      assert.deepEqual(
        await fs.readFile(join(prior.record.durable.root, "owner.json")),
        before,
      );
      await current.request("blocked-start", {
        binaryPath: report.identities.before.nativePath,
        eventHost: report.identities.before.eventHost,
        runtimeEpoch: kind,
        reason: status.reason,
      });
      observations.push({
        case: kind,
        ...(await assertBlockedFacade(current, kind, status.reason)),
        bytesPreserved: true,
        provenance:
          "actual Electron kernel/owner; exact controlled app exit; live owned Node sentinel or explicit unverifiable adapter",
      });
      await current.request("stop");
      await current.quit();
    } finally {
      if (sentinel) {
        sentinel.kill("SIGTERM");
        await bounded(childExit, 10000);
      }
    }
  }
  return observations;
}

async function nativeObservations(report, tracked) {
  report.nativeProgress = { phase: "bootstrap" };
  const root = await namespace("native", report);
  const binaryPath = report.identities.before.nativePath;
  const originals = [];
  let host = await createOwnerHost(root, tracked);
  assert.equal(
    (await host.request("acquire", { initialize: true })).state,
    "ready",
  );
  const started = await host.request("start", {
    binaryPath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "native-one",
    bootstrap: true,
    allowSyntheticStart: false,
  });
  report.nativeProgress.phase = "bootstrap-version";
  report.nativeProgress.version = started.nativeVersion;
  assert.equal(started.nativeVersion, "2.0.18");
  report.nativeProgress.phase = "bootstrap-authority";
  assert.equal(started.startupAuthority, "production-fresh-preflight");
  assert.equal(started.preflightScope, "historical-fresh-only-helper");
  report.nativeProgress.preflightScope = started.preflightScope;
  report.nativeProgress.phase = "bootstrap-snapshot";
  let initial;
  try {
    initial = await snapshot(host, "native-one", 1);
  } catch (error) {
    report.nativeProgress.bootstrap = {
      phase: "initial-snapshot-rejected",
      ...(await host.request("bootstrap-diagnostics")),
    };
    throw error;
  }
  report.nativeProgress.bootstrap = {
    workspaceCount: initial.workspaces.length,
    sessionCount: initial.sessions.length,
    recovery: initial.recovery,
    retainedCount: initial.retainedOperations.length,
    ...(await host.request("bootstrap-diagnostics")),
  };
  assert.equal(initial.workspaces.length, 1);
  assert.equal(initial.sessions.length, 1);
  const appSessionId = initial.sessions[0].id;
  const workspaceId = initial.workspaces[0].id;
  const workspacePath = initial.workspaces[0].path;
  assert.ok(
    workspacePath.startsWith(
      `${started.namespace.documents}${sep}OhMyOwnCode${sep}`,
    ),
  );
  assert.equal(initial.temporary, false);
  const view = await host.request("view");
  const mapped = view.sessions.find((s) => s.appSessionId === appSessionId);
  assert.ok(mapped.nativeSessionId);
  const nativeSessionId = mapped.nativeSessionId;
  report.nativeProgress.phase = "bootstrap-inventory";
  await readExactNativeInventory(
    (input) => host.request("native", { operation: "list", ...input }),
    [nativeSessionId],
  );
  report.nativeProgress.phase = "bootstrap-metadata";
  const native = await host.request("native", {
    operation: "get",
    sessionId: nativeSessionId,
  });
  const originalKey = {
    runtimeEpoch: native.metadata?.originalRuntimeEpoch,
    operationId: native.metadata?.operationId,
  };
  const originalIdentity = await host.request("identity", { key: originalKey });
  const expectedNative = {
    ...originalKey,
    appSessionId,
    workspaceId,
    nativeSessionId,
    directory: workspacePath,
  };
  assertNativeMetadataCorrelation(native, originalIdentity, expectedNative);
  assert.equal(originalKey.runtimeEpoch, "native-one");
  report.nativeProgress.phase = "bootstrap-receipt";
  const originalReceipt = value(
    await host.request("handle", {
      envelope: wire("native-one", {
        type: "operation.lookup",
        ...originalKey,
      }),
    }),
  );
  assertOriginalCreateReceipt(originalReceipt, originalKey, expectedNative);
  report.nativeProgress.phase = "rename-and-duplicate";
  await fs.writeFile(join(workspacePath, "keep.txt"), "P7 managed sentinel", {
    flag: "wx",
    mode: 0o600,
  });
  const rename = wire(
    "native-one",
    {
      type: "session.rename",
      workspaceId,
      sessionId: appSessionId,
      requestId: "rename-synthetic",
      title: "P7 renamed synthetic",
    },
    "p7-rename",
  );
  const renamed = await host.request("handle", { envelope: rename });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.receipt.effect, "confirmed");
  const duplicate = await host.request("handle", { envelope: rename });
  assert.deepEqual(duplicate.receipt, renamed.receipt);
  assert.equal(
    (
      await host.request("handle", {
        envelope: {
          ...rename,
          operation: { ...rename.operation, title: "Different" },
        },
      })
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    await fs.readFile(join(workspacePath, "keep.txt"), "utf8"),
    "P7 managed sentinel",
  );
  assert.equal(
    (await host.request("view")).workspaces.find(
      (w) => w.workspaceId === workspaceId,
    ).canonicalPath,
    workspacePath,
  );
  // Transfer data has info/messages only. Observe a distinct rename AFTER import;
  // stock CLI may advance sequence without persisting any event payload.
  const logBefore = await prepareNativeEventFixture(
    host,
    expectedNative,
    originalReceipt,
    report.nativeProgress,
  );
  assert.equal(
    (await host.request("view")).sessions.find(
      (s) => s.appSessionId === appSessionId,
    ).nativeSessionId,
    nativeSessionId,
  );
  report.nativeEventCapability = report.nativeProgress.eventCapability;
  report.observations.push({
    case: "native-event-history-capability",
    ...report.nativeEventCapability,
  });
  assert.equal(
    await fs.readFile(join(workspacePath, "keep.txt"), "utf8"),
    "P7 managed sentinel",
  );
  report.nativeProgress.phase = "fork-history";
  const forkEnvelope = wire(
    "native-one",
    {
      type: "session.fork",
      workspaceId,
      sessionId: appSessionId,
      requestId: "p7-fork-history",
      title: "P7 durable fork",
    },
    "p7-fork-history",
  );
  const forked = await host.request("handle", { envelope: forkEnvelope });
  assert.equal(forked.ok, true, forked.code);
  assert.equal(forked.receipt.effect, "confirmed");
  assert.equal(forked.receipt.result?.kind, "forked");
  assert.equal(forked.receipt.workspaceId, workspaceId);
  assert.equal(forked.receipt.sessionId, appSessionId);
  assert.equal(forked.receipt.result.workspaceId, workspaceId);
  const forkKey = {
    runtimeEpoch: "native-one",
    operationId: forkEnvelope.operationId,
  };
  const forkIdentity = await host.request("identity", { key: forkKey });
  assert.equal(forkIdentity?.type, "session.fork");
  assert.equal(forkIdentity.workspaceId, workspaceId);
  assert.equal(forkIdentity.sessionId, appSessionId);
  const forkExpected = {
    key: forkKey,
    identity: forkIdentity,
    receipt: forked.receipt,
    appSessionId: forked.receipt.result.sessionId,
    nativeSessionId: forked.receipt.result.nativeSessionId,
    parentAppSessionId: appSessionId,
    parentNativeSessionId: nativeSessionId,
    workspaceId,
    directory: workspacePath,
    inheritedMetadata: (
      await host.request("native", {
        operation: "get",
        sessionId: nativeSessionId,
      })
    ).metadata,
  };
  assert.notEqual(forkExpected.appSessionId, appSessionId);
  assert.notEqual(forkExpected.nativeSessionId, nativeSessionId);
  await assertNativeForkCheckpoint(host, "native-one", forkExpected);
  assert.deepEqual(
    (await host.request("handle", { envelope: forkEnvelope })).receipt,
    forked.receipt,
    "Same-key fork duplicate changed receipt",
  );
  // Imported folder removal/session deletion are production service effects,
  // and must preserve project-owned synthetic sentinels.
  report.nativeProgress.phase = "import-remove-sentinels";
  const importedPath = join(root, "imported");
  await fs.writeFile(join(importedPath, "keep.txt"), "P7 imported sentinel", {
    flag: "wx",
    mode: 0o600,
  });
  const imported = value(
    await host.request("handle", {
      envelope: wire("native-one", { type: "workspace.import" }),
    }),
  );
  const importedWorkspace = imported.workspaces.find(
    (w) => w.path === importedPath,
  );
  assert.ok(importedWorkspace && importedWorkspace.temporary === false);
  const importedCreated = value(
    await host.request("handle", {
      envelope: wire("native-one", {
        type: "session.create",
        workspaceId: importedWorkspace.id,
        title: "P7 imported synthetic session",
      }),
    }),
  );
  const importedSession = importedCreated.sessions.find(
    (s) => s.workspaceId === importedWorkspace.id,
  );
  assert.ok(importedSession);
  value(
    await host.request("handle", {
      envelope: wire("native-one", {
        type: "session.remove",
        workspaceId: importedWorkspace.id,
        sessionId: importedSession.id,
        requestId: "remove-imported-session",
      }),
    }),
  );
  value(
    await host.request("handle", {
      envelope: wire("native-one", {
        type: "workspace.remove",
        workspaceId: importedWorkspace.id,
      }),
    }),
  );
  assert.equal(
    await fs.readFile(join(importedPath, "keep.txt"), "utf8"),
    "P7 imported sentinel",
  );
  await host.request("checkpoint");
  const stopped = await host.request("stop");
  assert.equal(stopped.exited, true);
  originals.push(stopped.nativeIdentity);
  originals.push(await host.quit());

  // Standalone historical adapter lacks the parent's observed exit handle;
  // same-boot PID absence remains unverified and cannot permit takeover.
  const unverified = await createOwnerHost(root, tracked);
  const unverifiedOwner = await unverified.request("acquire", {
    initialize: false,
  });
  assert.ok(
    ["owner_unverified", "identity_conflict"].includes(unverifiedOwner.reason),
  );
  await unverified.request("stop");
  await unverified.quit();
  const observations = report.observations;
  observations.push(
    {
      case: "bootstrap-once",
      workspaces: 1,
      sessions: 1,
      nativeSessionId,
      exactCreateDigestVerified: true,
    },
    {
      case: "mapping-receipt-duplicate-conflict",
      appSessionId,
      originalKey,
      confirmed: true,
      conflictBlocked: true,
    },
    {
      case: "folder-import-sentinels",
      renamePathUnchanged: true,
      managedSentinelAfterHistoryTransfer: true,
      importedSessionRemovalPreservesFiles: true,
      unregisterPreservesFiles: true,
    },
    {
      case: "standalone-same-boot-historical-owner",
      reason: unverifiedOwner.reason,
      limitation:
        "Production OS adapter cannot prove termination from same-boot PID absence; controlled exit injection below is distinct.",
    },
  );

  const { syntheticInventory } = await import(
    "./fixtures/p7-storage-migration.mjs"
  );
  report.nativeProgress.phase = "nonfresh-startup-held";
  const confirmedBefore = await syntheticInventory(started.namespace.data);
  const nonfresh = await createOwnerHost(root, tracked);
  assert.equal(
    (
      await nonfresh.request("acquire", {
        initialize: false,
        ownedExited: originals,
      })
    ).state,
    "ready",
  );
  await nonfresh.request("blocked-start", {
    binaryPath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "nonfresh-confirmed",
    reason: "native_startup_unverified",
  });
  const nonfreshHold = await assertBlockedFacade(
    nonfresh,
    "nonfresh-confirmed",
    "native_startup_unverified",
  );
  const nonfreshView = await nonfresh.request("view");
  assert.equal(nonfreshView.retainedOperations.length, 0);
  const confirmedLookup = value(
    await nonfresh.request("handle", {
      envelope: wire("nonfresh-confirmed", {
        type: "operation.lookup",
        ...originalKey,
      }),
    }),
  );
  assertOriginalCreateReceipt(confirmedLookup, originalKey, expectedNative);
  assert.ok(
    isDeepStrictEqual(confirmedLookup.receipt, originalReceipt.receipt),
    "Original receipt changed",
  );
  assert.deepEqual(
    await syntheticInventory(started.namespace.data),
    confirmedBefore,
  );
  observations.push({
    case: "confirmed-app-receipt-zero-retained-nonfresh-native-held",
    ...nonfreshHold,
    confirmedAppReceipt: true,
    retainedOperations: 0,
    nativeBytesPreserved: true,
    authority:
      "historical fresh-only helper; current Main uses copied Native preflight. App receipt completion alone does not establish safe Native startup",
  });
  await nonfresh.request("stop");
  originals.push(await nonfresh.quit());

  host = await createOwnerHost(root, tracked);
  assert.equal(
    (
      await host.request("acquire", {
        initialize: false,
        ownedExited: originals,
      })
    ).state,
    "ready",
  );
  report.nativeProgress.phase = "normal-reopen";
  await host.request("start", {
    binaryPath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "native-two",
    bootstrap: false,
    allowSyntheticStart: true,
  });
  const reopened = await snapshot(host, "native-two", 2);
  assert.equal(reopened.sessions.length, 2);
  assert.equal(reopened.sessions[0].id, appSessionId);
  assert.equal(reopened.workspaces[0].path, workspacePath);
  await readExactNativeInventory(
    (input) => host.request("native", { operation: "list", ...input }),
    [nativeSessionId, forkExpected.nativeSessionId],
  );
  const reopenedView = await host.request("view");
  assert.equal(reopenedView.sessions[0].nativeSessionId, nativeSessionId);
  const reopenedHistory = await host.request("native", {
    operation: "messages",
    sessionId: nativeSessionId,
  });
  assert.ok(
    JSON.stringify(reopenedHistory).includes("P7 synthetic durable history"),
  );
  const reopenedLog = await readNativeLog(
    host,
    nativeSessionId,
    report.nativeProgress,
  );
  const reopenedCapability = assessNativeEventHistory(
    reopenedLog,
    report.nativeProgress.logDiagnostic,
    nativeSessionId,
  );
  if (logBefore.length > 0)
    assertNativeEventsPreserved(logBefore, reopenedLog, nativeSessionId);
  assert.equal(
    await fs.readFile(join(workspacePath, "keep.txt"), "utf8"),
    "P7 managed sentinel",
  );
  const oldReceipt = value(
    await host.request("handle", {
      envelope: wire("native-two", {
        type: "operation.lookup",
        ...originalKey,
      }),
    }),
  );
  assertOriginalCreateReceipt(oldReceipt, originalKey, expectedNative);
  assert.ok(
    isDeepStrictEqual(oldReceipt.receipt, originalReceipt.receipt),
    "Original receipt changed",
  );
  assertNativeMetadataCorrelation(
    await host.request("native", {
      operation: "get",
      sessionId: nativeSessionId,
    }),
    await host.request("identity", { key: originalKey }),
    expectedNative,
  );
  const normalFork = await assertNativeForkCheckpoint(
    host,
    "native-two",
    forkExpected,
  );
  const dataRoot = started.namespace.data;
  const wal = report.identities.before.eventHost
    ? join(dataRoot, "event-host.sqlite-wal")
    : join(dataRoot, "opencode/opencode.db-wal");
  assert.ok((await fs.lstat(wal)).isFile(), "Actual native WAL required");
  await host.request("checkpoint");
  report.nativeProgress.phase = "SIGKILL-WAL";
  const killed = await host.request("stop-native", { signal: "SIGKILL" });
  assert.equal(killed.nativeExit.signal, "SIGKILL");
  assert.equal(killed.ownerCleanRelease, false);
  assert.equal(killed.cleanup, "incomplete");
  assert.ok(
    killed.idleObservation &&
      !killed.idleObservation.observerGap &&
      killed.idleObservation.live === 0 &&
      killed.idleObservation.allExited === true &&
      killed.idleObservation.pendingHostRequests === 0,
  );
  originals.push(killed.nativeIdentity);
  const walAfterKill = await fileIdentity(root, wal);
  assert.ok(walAfterKill.size > 0);
  await host.request("stop");
  originals.push(await host.quit());
  observations.push({
    case: "normal-controlled-reopen",
    appSessionId,
    nativeSessionId,
    bootstrapCount: 1,
    oldReceiptCurrentEnvelope: true,
    historyPreserved: true,
    logPreserved: logBefore.length > 0,
    eventHistoryStatus: reopenedCapability.status,
    managedSentinelPreserved: true,
    ownership:
      "production owner; actual parent observed exact app/child exit handles",
  });
  observations.push({
    case: "native-fork-normal-controlled-reopen",
    ...normalFork,
    appSessionId: forkExpected.appSessionId,
    nativeSessionId: forkExpected.nativeSessionId,
    authority: "actual service and Native SDK; trusted synthetic startup only",
  });
  observations.push({
    case: "SIGKILL-WAL",
    exited: true,
    signal: "SIGKILL",
    wal: walAfterKill,
    retainedNativeProfile: killed.recoveryPath,
    ownerCleanRelease: false,
    directIdleExitProof: killed.idleObservation,
  });

  host = await createOwnerHost(root, tracked);
  assert.equal(
    (
      await host.request("acquire", {
        initialize: false,
        ownedExited: originals,
      })
    ).state,
    "ready",
  );
  report.nativeProgress.phase = "SIGKILL-reopen";
  await host.request("start", {
    binaryPath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "native-three",
    bootstrap: false,
    allowSyntheticStart: true,
  });
  const killedReopen = await snapshot(host, "native-three", 2);
  assert.equal(killedReopen.sessions.length, 2);
  assert.equal(killedReopen.sessions[0].id, appSessionId);
  await readExactNativeInventory(
    (input) => host.request("native", { operation: "list", ...input }),
    [nativeSessionId, forkExpected.nativeSessionId],
  );
  assertNativeMetadataCorrelation(
    await host.request("native", {
      operation: "get",
      sessionId: nativeSessionId,
    }),
    await host.request("identity", { key: originalKey }),
    expectedNative,
  );
  const killedHistory = await host.request("native", {
    operation: "messages",
    sessionId: nativeSessionId,
  });
  assert.ok(
    JSON.stringify(killedHistory).includes("P7 synthetic durable history"),
  );
  const logAfter = await readNativeLog(
    host,
    nativeSessionId,
    report.nativeProgress,
  );
  const killedCapability = assessNativeEventHistory(
    logAfter,
    report.nativeProgress.logDiagnostic,
    nativeSessionId,
  );
  if (logBefore.length > 0)
    assertNativeEventsPreserved(logBefore, logAfter, nativeSessionId);
  assert.equal(
    await fs.readFile(join(workspacePath, "keep.txt"), "utf8"),
    "P7 managed sentinel",
  );
  observations.push({
    case: "SIGKILL-controlled-reopen",
    sameNativeSession: true,
    historyPreserved: true,
    logPreserved: logBefore.length > 0,
    eventHistoryStatus: killedCapability.status,
    managedSentinelPreserved: true,
  });
  observations.push({
    case: "native-fork-SIGKILL-controlled-reopen",
    ...(await assertNativeForkCheckpoint(host, "native-three", forkExpected)),
    appSessionId: forkExpected.appSessionId,
    nativeSessionId: forkExpected.nativeSessionId,
    authority: "actual service and Native SDK; trusted synthetic startup only",
  });
  report.nativeProgress.phase = "pending-inbox";
  const pending = await host.request("retain-inbox", {
    runtimeEpoch: "native-three",
    workspaceId,
    appSessionId,
    nativeSessionId,
  });
  const inbox = await host.request("native", {
    operation: "inbox",
    sessionId: nativeSessionId,
  });
  assert.ok(inbox.some((entry) => entry.id === pending.inboxId));
  const pendingStopped = await host.request("stop-native", {
    signal: "SIGKILL",
  });
  originals.push(pendingStopped.nativeIdentity);
  await host.request("stop");
  originals.push(await host.quit());
  const pendingBefore = await syntheticInventory(dataRoot);
  host = await createOwnerHost(root, tracked);
  assert.equal(
    (
      await host.request("acquire", {
        initialize: false,
        ownedExited: originals,
      })
    ).state,
    "ready",
  );
  report.nativeProgress.phase = "pending-inbox-startup-held";
  await host.request("blocked-start", {
    binaryPath,
    eventHost: report.identities.before.eventHost,
    runtimeEpoch: "native-four",
    reason: "pending_inbox",
  });
  const held = await assertBlockedFacade(
    host,
    "native-four",
    "native_startup_unverified",
  );
  const pendingSnapshot = value(
    await host.request("handle", {
      envelope: wire("native-four", { type: "snapshot" }),
    }),
  );
  assert.ok(
    pendingSnapshot.retainedOperations.some(
      (key) =>
        key.runtimeEpoch === pending.key.runtimeEpoch &&
        key.operationId === pending.key.operationId,
    ),
  );
  const unknown = value(
    await host.request("handle", {
      envelope: wire("native-four", {
        type: "operation.lookup",
        ...pending.key,
      }),
    }),
  );
  assert.equal(unknown.status, "found");
  assert.equal(unknown.receipt.effect, "unknown");
  assert.deepEqual(await syntheticInventory(dataRoot), pendingBefore);
  observations.push({
    case: "pending-inbox-safe-start-held",
    ...held,
    originalUnknownKey: pending.key,
    nativeBytesPreserved: true,
    retainedNativeInventory: pendingBefore,
    safety:
      "Provider-compatible safe startup unproved; zero original-store launches. No replay/drain/approval or pending-store SDK reopen.",
  });
  await host.request("stop");
  await host.quit();
  report.nativeProgress.phase = "complete";
  return observations;
}

export async function runSavedProbe(options) {
  assert.equal(
    process.platform,
    options.platform,
    "Darwin native runner required",
  );
  const destination = await claimProbeOutput(repository, options.out);
  const report = {
    schemaVersion: 5,
    result: "fail",
    mode: options.mode,
    platform: process.platform,
    architecture: process.arch,
    startedAt: new Date().toISOString(),
    identities: {},
    namespaces: [],
    observations: [],
    limitations: [
      "Auth-free synthetic fixture only; provider execution and generalized pending-inbox safe-start are unproved.",
      "Controlled parent-observed exact exit handles support probe reopen; standalone same-boot historical PID absence does not prove exit.",
      "No SQLite schema introspection/table mutation; no automatic migration/cutover/replay/approval; no production main or visible window.",
      "Process-kill/file/directory flush evidence is not power-loss durability; macOS only.",
      "Build/source/package/script before-after inventories detect observed changes, not filesystem isolation or change-and-restore.",
    ],
  };
  const tracked = [];
  let failure;
  try {
    report.identities.before = await identities();
    await runIndependentProbeSteps(report, [
      {
        name: "owner",
        run: async () => {
          report.observations.push(
            ...(await ownerObservations(report, tracked)),
          );
        },
      },
      {
        name: "native",
        run: async () => {
          try {
            await nativeObservations(report, tracked);
          } finally {
            for (const record of tracked)
              if (!record.exited && record.kind !== "synthetic-sentinel")
                await cleanupOwnerHost(record);
          }
        },
      },
      {
        name: "journal-migration",
        run: async () => {
          const synthetic = await namespace("journal-migration", report);
          const host = await createOwnerHost(synthetic, tracked);
          assert.equal(
            (await host.request("acquire", { initialize: true })).state,
            "ready",
          );
          assert.equal((await host.request("assert-owned")).state, "ready");
          const faultsRoot = join(
            host.record.durable.root,
            "owned-probe-fixtures",
          );
          await fs.mkdir(faultsRoot, { mode: 0o700 });
          report.journalFaults = await probeJournalFaults(faultsRoot);
          report.partialMapping = await probePartialMapping(faultsRoot);
          const { probeSyntheticMigration } = await import(
            "./fixtures/p7-storage-migration.mjs"
          );
          const migration = join(faultsRoot, "migration");
          await fs.mkdir(migration, { mode: 0o700 });
          report.migration = await probeSyntheticMigration({
            root: migration,
            explicitlyAuthorized: true,
          });
          await host.request("stop");
          await host.quit();
        },
      },
    ]);
  } catch (error) {
    failure = error;
    report.error = {
      name: error.name,
      code: error.code,
      message: error.message.slice(0, 1024),
    };
  } finally {
    // Owned handles only. Never remove durable namespaces on failure or success.
    for (const record of tracked) {
      if (!record.exited && record.kind === "synthetic-sentinel") {
        const exited = new Promise((r) => record.child.once("exit", r));
        record.child.kill("SIGTERM");
        try {
          await bounded(exited, 10000);
        } catch {
          /* Retain failed root. */
        }
      } else if (!record.exited) {
        await cleanupOwnerHost(record);
      }
    }
    report.processes = tracked.map((record) => ({
      namespace: record.namespace,
      kind: record.kind ?? "zero-window-owner-host",
      ...(record.identity && { identity: record.identity }),
      exited: record.exited,
      exit: record.exit,
      nativeExitConfirmed: record.nativeExitConfirmed,
      ...(record.nativeStopResult && {
        nativeStopResult: record.nativeStopResult,
      }),
      ...(record.cleanup && { cleanup: record.cleanup }),
      retention: "preserved",
    }));
    if (
      tracked.some(
        (record) =>
          !record.exited ||
          !record.nativeExitConfirmed ||
          record.cleanup?.explicitCleanupFailed,
      )
    ) {
      report.result = "fail";
      report.cleanupUnconfirmed = true;
    }
    try {
      report.identities.after = await identities();
      assert.deepEqual(
        report.identities.after,
        report.identities.before,
        "Source/build/package/probe/native bytes changed during probe",
      );
      report.identities.unchanged = true;
    } catch (error) {
      failure ??= error;
      report.result = "fail";
      report.provenanceError = String(error.message).slice(0, 1024);
    }
    report.finishedAt = new Date().toISOString();
    let text = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(text) > limit.reportBytes) {
      failure ??= new Error("Probe report output budget exceeded");
      report.result = "fail";
      text =
        JSON.stringify(
          {
            schemaVersion: report.schemaVersion,
            result: "fail",
            error:
              "Probe report output budget exceeded; full evidence was not exported",
            namespaces: report.namespaces,
            processes: report.processes,
            cleanupUnconfirmed: report.cleanupUnconfirmed,
            finishedAt: report.finishedAt,
          },
          null,
          2,
        ) + "\n";
    }
    await fs.writeFile(
      join(destination, "native-storage-evidence.json"),
      text,
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        result: report.result,
        evidence: relative(repository, destination),
        namespacesRetained: report.namespaces.length,
        cleanupUnconfirmed: Boolean(report.cleanupUnconfirmed),
        sourceBuildPackageNativeUnchanged: report.identities.unchanged === true,
      }),
    );
  }
  assertSavedProbeResult(report, failure);
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runSavedProbe(parseProbeOptions(process.argv.slice(2))).catch((error) => {
    console.error(
      `Saved P7 probe failed (${error.code ?? error.name}); retain namespaces and evidence`,
    );
    process.exitCode = 1;
  });
}
