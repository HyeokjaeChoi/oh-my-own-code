// Saved negative acceptance. Only the verified packaged copied-read entry runs.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import {
  claimNativeProbeOutput,
  parseNativeProbeOptions,
} from "./native-preflight-probe.mjs";
import {
  eventHostForResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";
import { verifyNativePreflightResources } from "../src/native-preflight-resources.mjs";
import { createOSProcessIdentityAdapter } from "../src/sidecar-supervisor.mjs";
import {
  PREFLIGHT_LIMITS,
  validatePreflightRequest,
} from "../src/native-preflight-protocol.mjs";

const ownFile = fileURLToPath(import.meta.url);
const desktop = resolve(dirname(ownFile), "..");
const repository = resolve(desktop, "../..");
const observerFile = join(
  desktop,
  "scripts/fixtures/owner-lifetime-exit-observer.py",
);
const children = [];
const descendants = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("lifecycle_deadline")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function tracked(child, outputLimit = 128 * 1024) {
  const record = { child, exited: false, outputBytes: 0, exit: undefined };
  record.done = new Promise((resolve) => {
    child.once("error", () => {
      record.failed = true;
    });
    child.once("close", (code, signal) => {
      record.exited = true;
      record.exit = { code, signal };
      resolve(record.exit);
    });
  });
  child.stdin?.on("error", () => {});
  child.stdout?.on("data", (bytes) => {
    record.outputBytes += bytes.length;
    if (record.outputBytes > outputLimit) {
      record.failed = true;
      child.kill("SIGKILL");
    }
  });
  children.push(record);
  return record;
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
  const eventHost = eventHostForResources(
    resolve(join(repository, native[0].path), "../../.."),
    process.platform,
    process.arch,
  );
  return {
    provenance,
    inspector: await verifyNativePreflightResources(eventHost),
    scriptSha256: await resourceFileSha256(ownFile),
    observerSha256: await resourceFileSha256(observerFile),
  };
}
async function scenarioRoot(output, name) {
  const root = join(output, name);
  await fs.mkdir(root, { mode: 0o700 });
  for (const part of ["home", "data", "config", "state", "cache", "tmp"])
    await fs.mkdir(join(root, part), { mode: 0o700 });
  assert.equal(await fs.realpath(root), root);
  return root;
}
function environment(root) {
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "cache"),
    MSGPACKR_NATIVE_ACCELERATION_DISABLED: "true",
  };
}
function frame(root) {
  return (
    JSON.stringify({
      version: 1,
      nonce: randomBytes(32).toString("hex"),
      database: join(root, "data/event-host.sqlite"),
      mappings: [],
    }) + "\n"
  );
}
async function directScenario(output, inspector, name, act) {
  const root = await scenarioRoot(output, name);
  const start = Date.now();
  const record = tracked(
    spawn(inspector.engine, [inspector.entry], {
      cwd: root,
      env: environment(root),
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
    }),
  );
  const identity = await createOSProcessIdentityAdapter().capture(
    record.child.pid,
  );
  assert.ok(identity);
  await act(record.child, root);
  const exit = await bounded(record.done, PREFLIGHT_LIMITS.deadlineMs + 6000);
  assert.deepEqual(exit, { code: 1, signal: null });
  assert.equal(record.outputBytes, 0);
  assert.ok(!record.failed);
  const elapsedMs = Date.now() - start;
  if (name === "independent-child-deadline")
    assert.ok(elapsedMs >= PREFLIGHT_LIMITS.deadlineMs - 1000);
  return {
    scenario: name,
    identity,
    exit,
    elapsedMs,
    outputBytes: 0,
    positiveDecision: false,
    physicalExit: true,
    databaseAcquired: false,
  };
}
// Trusted, fixed probe parent; never a production entry or stored command.
const parentProgram = `
const {spawn}=require('node:child_process');
let child;
process.on('message', m => {
  if (m.type==='start' && !child) {
    child=spawn(m.engine,[m.entry],{cwd:m.root,env:m.environment,stdio:['pipe',1,'ignore'],shell:false});
    child.stdin.on('error',()=>{});
    child.on('error',()=>process.exit(1));
    process.send({pid:child.pid});
  } else if (m.type==='exit-parent' && child) {
    child.stdin.write(m.frame,()=>process.exit(0));
  } else process.exit(1);
});
`;
async function parentLoss(output, inspector) {
  const root = await scenarioRoot(output, "actual-parent-loss");
  const parent = tracked(
    spawn(process.execPath, ["-e", parentProgram], {
      cwd: root,
      env: environment(root),
      stdio: ["ignore", "pipe", "ignore", "ipc"],
      shell: false,
    }),
  );
  const received = bounded(
    new Promise((resolve) => parent.child.once("message", resolve)),
    5000,
  );
  parent.child.send({
    type: "start",
    engine: inspector.engine,
    entry: inspector.entry,
    root,
    environment: environment(root),
  });
  const message = await received;
  assert.deepEqual(Object.keys(message), ["pid"]);
  const adapter = createOSProcessIdentityAdapter();
  assert.ok(Number.isSafeInteger(message.pid) && message.pid > 0);
  const descendant = { pid: message.pid, exited: false };
  descendants.push(descendant);
  const identity = (descendant.identity = await adapter.capture(message.pid));
  assert.ok(identity);
  const observer = tracked(
    spawn("/usr/bin/python3", [observerFile, JSON.stringify(identity)], {
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    }),
    16,
  );
  let text = "";
  observer.child.stdout.on("data", (bytes) => {
    text += bytes.toString("ascii");
  });
  const readyUntil = Date.now() + 5000;
  while (text !== "READY\n" && !observer.exited && Date.now() < readyUntil)
    await sleep(20);
  assert.equal(text, "READY\n");
  parent.child.send({ type: "exit-parent", frame: frame(root) });
  // Parent close drains the reader's inherited stdout; NOTE_EXIT binds its identity.
  assert.deepEqual(await bounded(observer.done, 26000), {
    code: 0,
    signal: null,
  });
  assert.equal(text, "READY\nEXIT\n");
  descendant.exited = true;
  assert.deepEqual(await bounded(parent.done, 5000), { code: 0, signal: null });
  assert.equal(parent.outputBytes, 0);
  return {
    scenario: "actual-parent-loss",
    identity,
    parentExit: parent.exit,
    readerExitEvidence: "EVFILT_PROC:NOTE_EXIT",
    physicalExit: true,
    outputBytes: 0,
    positiveDecision: false,
    stage:
      "frame-write-followed-by-parent-exit; SQL acquisition is not observed",
  };
}
async function cleanup() {
  let complete = true;
  for (const record of children) {
    if (!record.exited) {
      record.child.stdin?.destroy();
      record.child.kill("SIGTERM");
      try {
        await bounded(record.done, 1500);
      } catch {
        record.child.kill("SIGKILL");
        try {
          await bounded(record.done, 1500);
        } catch {
          complete = false;
        }
      }
    }
  }
  // A grandchild can only be signalled after a new exact identity comparison.
  for (const record of descendants)
    if (!record.exited) {
      try {
        assert.deepEqual(
          await createOSProcessIdentityAdapter().capture(record.identity.pid),
          record.identity,
        );
        process.kill(record.identity.pid, "SIGTERM");
      } catch {
        /* Historical absence is not authoritative exit evidence. */
      }
      complete = false;
    }
  return {
    complete,
    processes: children.map((record) => ({
      pid: record.child.pid,
      exited: record.exited,
      exit: record.exit,
    })),
    descendants,
  };
}
export async function runReaderLifecycleProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  process.umask(0o077);
  const output = await claimNativeProbeOutput(
    repository,
    parseNativeProbeOptions(args).out,
  );
  const report = {
    schemaVersion: 1,
    result: "fail",
    kind: "actual-packaged-negative-reader-lifecycle",
    output,
    observations: [],
    identities: {},
    limitations: [
      "No Native executor, original SQLite database, provider, credentials or production Main is launched.",
      "Negative inputs prove pre-import cancellation and physical exit, not cancellation of an observed active SQL query.",
      "Positive scoped connection completion is covered separately by the production nonfresh probe.",
    ],
  };
  let phase = "provenance-before";
  try {
    const before = (report.identities.before = await identities());
    validatePreflightRequest(JSON.parse(frame(output)));
    phase = "stdin-eof";
    report.observations.push(
      await directScenario(output, before.inspector, phase, (child) =>
        child.stdin.end(),
      ),
    );
    phase = "extra-frame-cancellation";
    report.observations.push(
      await directScenario(output, before.inspector, phase, (child, root) =>
        child.stdin.write(frame(root) + "extra\n"),
      ),
    );
    phase = "independent-child-deadline";
    report.observations.push(
      await directScenario(output, before.inspector, phase, () => {}),
    );
    phase = "actual-parent-loss";
    report.observations.push(await parentLoss(output, before.inspector));
  } catch {
    report.failure = { phase, code: "lifecycle_probe_failed" };
  } finally {
    report.cleanup = await cleanup();
    try {
      report.identities.after = await identities();
      assert.deepEqual(report.identities.after, report.identities.before);
      report.identities.unchanged = true;
    } catch {
      report.identities.unchanged = false;
    }
    if (
      !report.failure &&
      report.cleanup.complete &&
      report.identities.unchanged &&
      report.observations.length === 4
    )
      report.result = "pass";
    const bytes = JSON.stringify(report, null, 2) + "\n";
    assert.ok(Buffer.byteLength(bytes) <= 4 * 1024 * 1024);
    await fs.writeFile(join(output, "reader-lifecycle-evidence.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === ownFile) {
  runReaderLifecycleProbe()
    .then((report) => {
      process.exitCode = report.result === "pass" ? 0 : 1;
      process.stdout.write(
        JSON.stringify({
          result: report.result,
          cleanup: report.cleanup.complete,
          report: join(report.output, "reader-lifecycle-evidence.json"),
        }) + "\n",
      );
    })
    .catch(() => {
      process.exitCode = 1;
      process.stdout.write('{"result":"fail","phase":"output-or-report"}\n');
    });
}
