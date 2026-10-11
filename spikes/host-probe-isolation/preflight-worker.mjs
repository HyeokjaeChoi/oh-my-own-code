import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync, closeSync, createReadStream, existsSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync,
  writeFileSync, writeSync,
} from "node:fs";
import { createServer, createConnection } from "node:net";
import { arch, release } from "node:os";
import { join } from "node:path";

// Reviewed SDK-free source only. Do not add project imports or inherited env.
const fixturePrefix = "/private/tmp/host-probe-isolation-";
const sandboxPath = "/usr/bin/sandbox-exec";
const expectedRuntime = "/opt/homebrew/Cellar/node/26.8.2/bin/node";
const expectedRuntimeSha256 = "902b6a6984d5d825829ea9064ab73b734548df37bc0683990dca31c8dc2a9253";
const expectedSources = {
  canaries: "81f5193b6da7c5a66598fcb0e84419150df4e5d4f9d66b7d6c9f1dc45bf87837",
  profile: "36564697253350f0948d279e81f2037c33f5aaec1d7a27eb5a5a5412eacacd27",
};
const operationNames = [
  "allowed_read", "allowed_write", "outside_read", "outside_write",
  "loopback_listen", "loopback_connect", "child_exec",
];
const denyCalls = {
  outside_read: ["open", "read"],
  outside_write: ["open", "write"],
  loopback_listen: ["listen"],
  loopback_connect: ["connect"],
  child_exec: ["spawn"],
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mode = (path) => lstatSync(path).mode & 0o777;

function verifiedSource(name, encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > 65536) {
    throw new Error("source_payload_invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || sha(bytes) !== expectedSources[name]) {
    throw new Error("source_integrity_mismatch");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fileSha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function closeSocketBounded(socket, timeoutMs = 500) {
  return new Promise((resolve) => {
    if (socket.closed === true) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once("close", () => { clearTimeout(timer); resolve(true); });
    socket.destroy();
  });
}

function sandboxString(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("invalid_profile_binding");
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function createFixture(onCreated) {
  if (realpathSync("/private/tmp") !== "/private/tmp") throw new Error("noncanonical_tmp_parent");
  const root = mkdtempSync(fixturePrefix);
  const identity = { dev: lstatSync(root).dev, ino: lstatSync(root).ino };
  onCreated({ root, identity });
  chmodSync(root, 0o700);
  if (realpathSync(root) !== root || mode(root) !== 0o700 || lstatSync(root).uid !== process.getuid()) {
    throw new Error("invalid_fixture_root");
  }
  const inputDir = join(root, "input");
  const outsideDir = join(root, "outside");
  const scratchDir = join(root, "scratch");
  for (const path of [inputDir, outsideDir, scratchDir]) mkdirSync(path, { mode: 0o700 });
  const input = join(inputDir, "sentinel.txt");
  const outsideRead = join(outsideDir, "read-sentinel.txt");
  const outsideWrite = join(outsideDir, "write-sentinel.txt");
  const scratch = join(scratchDir, "write-sentinel.txt");
  writeFileSync(input, "synthetic-input\n", { flag: "wx", mode: 0o400 });
  writeFileSync(outsideRead, "synthetic-outside-read\n", { flag: "wx", mode: 0o400 });
  writeFileSync(outsideWrite, "synthetic-outside-write\n", { flag: "wx", mode: 0o600 });
  for (const path of [input, outsideRead]) chmodSync(path, 0o400);
  chmodSync(outsideWrite, 0o600);
  if (readFileSync(input, "utf8") !== "synthetic-input\n" || readFileSync(outsideRead, "utf8") !== "synthetic-outside-read\n") {
    throw new Error("fixture_read_precheck_failed");
  }
  // Opening and writing the owned synthetic file proves the parent could do so.
  const fd = openSync(outsideWrite, "r+");
  try { writeSync(fd, Buffer.from("s"), 0, 1, 0); } finally { closeSync(fd); }
  if (mode(input) !== 0o400 || mode(outsideRead) !== 0o400 || mode(outsideWrite) !== 0o600) {
    throw new Error("fixture_mode_precheck_failed");
  }
  return { root, identity, input, outsideRead, outsideWrite, scratch, scratchDir };
}

function renderProfile(template, bindings) {
  let profile = template;
  for (const [name, value] of Object.entries(bindings)) {
    const marker = `@${name}@`;
    if (!profile.includes(marker)) throw new Error("missing_profile_marker");
    profile = profile.replaceAll(marker, sandboxString(value));
  }
  if (/@[A-Z_]+@/.test(profile)) throw new Error("unbound_profile_marker");
  return profile;
}

async function openOwnedListener() {
  const server = createServer((socket) => socket.destroy());
  let accepted = 0;
  server.on("connection", () => { accepted += 1; });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1" || !Number.isInteger(address.port)) {
      throw new Error("unexpected_listener_address");
    }
    // A zero-payload parent connection checks the exact listener before the child.
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: address.port });
      const timer = setTimeout(async () => {
        await closeSocketBounded(socket);
        reject(new Error("parent_connect_timeout"));
      }, 1200);
      socket.once("connect", async () => {
        clearTimeout(timer);
        if (await closeSocketBounded(socket)) resolve();
        else reject(new Error("parent_socket_close_timeout"));
      });
      socket.once("error", async () => {
        clearTimeout(timer);
        await closeSocketBounded(socket);
        reject(new Error("parent_connect_failed"));
      });
    });
    if (accepted !== 1) throw new Error("parent_accept_unverified");
    return { server, port: address.port, accepted: () => accepted };
  } catch (error) {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    throw error;
  }
}

async function closeOwnedListener(listener) {
  if (!listener) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1200);
    try {
      listener.server.close((error) => { clearTimeout(timer); resolve(!error); });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

function runSandbox(runtime, profilePath, source, fixture, port) {
  return new Promise((resolve) => {
    const env = Object.freeze({
      HOME: fixture.scratchDir,
      TMPDIR: fixture.scratchDir,
      PATH: "",
      LANG: "C",
      LC_ALL: "C",
      NO_COLOR: "1",
    });
    const argv = [
      "-f", profilePath, runtime, "--input-type=module", "--eval", source, "--",
      fixture.input, fixture.scratch, fixture.outsideRead, fixture.outsideWrite,
      runtime, String(port), fixture.scratchDir,
    ];
    let child;
    try {
      child = spawn(sandboxPath, argv, {
        cwd: fixture.scratchDir, env, detached: false, stdio: ["ignore", "pipe", "pipe"], shell: false,
      });
    } catch {
      return resolve({ state: "spawn_error", reaped: true, stdout: "", envNames: Object.keys(env) });
    }
    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let state = "completed";
    let settled = false;
    const killChild = () => {
      if (!child.pid || settled) return;
      try { child.kill("SIGKILL"); } catch { /* close/reap deadline below makes failure BLOCKED */ }
    };
    const deadline = setTimeout(() => { state = "timeout"; killChild(); }, 12000);
    const reapDeadline = setTimeout(() => {
      if (settled) return;
      state = "unreaped";
      killChild();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(null, null, false);
    }, 14000);
    const finish = (code, signal, reaped) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(reapDeadline);
      resolve({ state, reaped, code, signal, stdout, stdoutBytes, stderrBytes, envNames: Object.keys(env) });
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 8192) { state = "output_limit"; killChild(); return; }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 2048) { state = "output_limit"; killChild(); }
    });
    child.once("error", () => { state = "spawn_error"; });
    child.once("close", (code, signal) => finish(code, signal, true));
  });
}

function classify(parentChecks, launch) {
  const controls = {};
  let childResults;
  if (launch?.state === "completed" && launch.code === 0 && launch.stdoutBytes <= 8192) {
    try {
      const line = launch.stdout.trim();
      const packet = JSON.parse(line);
      if (packet.schema === 1 && packet.results && Object.keys(packet.results).sort().join() === [...operationNames].sort().join() &&
          operationNames.every((name) => ["allowed", "error", "unavailable", "mismatch"].includes(packet.results[name]?.kind))) {
        childResults = packet.results;
      }
    } catch { /* malformed output is unverified */ }
  }
  for (const name of operationNames) {
    const result = childResults?.[name];
    const expectedPositive = name.startsWith("allowed_");
    let status = "unverified";
    if (result && typeof result === "object" && result.kind === "allowed") {
      status = expectedPositive ? "verified" : "unexpected_allowed";
    } else if (result?.kind === "error") {
      const denial = ["EPERM", "EACCES"].includes(result.code);
      const matchedCall = denyCalls[name]?.includes(result.syscall);
      if (expectedPositive) status = "failed";
      else if (denial && matchedCall && parentChecks[name] &&
          (name !== "child_exec" || result.target_match === true)) status = "verified";
    } else if (result?.kind === "unavailable") {
      status = "unavailable";
    } else if (result?.kind === "mismatch" && expectedPositive) {
      status = "failed";
    }
    controls[name] = {
      status,
      target_class: name,
      ...(result?.kind === "error" ? { errno: /^[A-Z0-9_]{1,20}$/.test(result.code) ? result.code : "UNKNOWN", syscall: denyCalls[name]?.includes(result.syscall) || ["open", "read", "write"].includes(result.syscall) ? result.syscall : "unknown" } : {}),
    };
  }
  return { controls, evidenceValid: Boolean(childResults) };
}

function cleanupFixture(fixture) {
  if (!fixture) return true;
  const { root, identity } = fixture;
  try {
    const current = lstatSync(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino ||
        current.uid !== process.getuid() || (current.mode & 0o777) !== 0o700 || realpathSync(root) !== root ||
        !root.startsWith(fixturePrefix)) return false;
    rmSync(root, { recursive: true, force: false, maxRetries: 0 });
    return !existsSync(root);
  } catch { return false; }
}

async function main() {
  const report = {
    schema: 1,
    decision: "BLOCKED",
    runtime: { platform: process.platform, release: release(), arch: arch(), version: process.version },
    profile: {},
    fixture: { class: "/private/tmp/host-probe-isolation-*", canonical: false, owner_only: false },
    controls: Object.fromEntries(operationNames.map((name) => [name, { status: "unverified", target_class: name }])),
    scope: { runtime_dependency_closure: "unverified", local_tcp: "unverified", general_egress: "unverified", udp_dns_ipc: "unverified", memory_scratch_limits: "unverified" },
    limits: { child_deadline_ms: 12000, reap_deadline_ms: 14000, stdout_bytes: 8192, stderr_bytes: 2048 },
    child: { state: "not_started", reaped: true, evidence_valid: false },
    resources: { fixture_created: false, listener_created: false, sandbox_child_started: false },
    absence: { fixture: true, listener: true, sandbox_child: true },
    cleanup: { listener: true, fixture: true },
  };
  let fixture;
  let listener;
  let launch;
  let failure;
  try {
    const runtime = realpathSync(process.execPath);
    const runtimeStat = statSync(runtime);
    if (runtime !== expectedRuntime || !runtimeStat.isFile() || !(runtimeStat.mode & 0o111)) throw new Error("runtime_identity_mismatch");
    report.runtime.path = runtime;
    report.runtime.sha256 = await fileSha256(runtime);
    if (report.runtime.sha256 !== expectedRuntimeSha256) throw new Error("runtime_identity_mismatch");
    const payloadText = process.env.HPI_SOURCE_PAYLOAD;
    if (typeof payloadText !== "string" || Buffer.byteLength(payloadText) > 131072) throw new Error("source_payload_invalid");
    const payload = JSON.parse(payloadText);
    if (!payload || Object.keys(payload).sort().join() !== "canaries,profile") throw new Error("source_payload_invalid");
    const source = verifiedSource("canaries", payload.canaries);
    const template = verifiedSource("profile", payload.profile);
    report.profile.template_sha256 = sha(template);
    report.profile.canaries_sha256 = sha(source);
    // No runtime dependency closure has been independently audited. Do not
    // execute a runtime while the profile cannot bound every required read.
    report.failure = "runtime_dependency_closure_unverified";
    report.decision = "NO-RUN";
    throw new Error("completed_no_run");
    /* The canary branch remains disabled until a separately reviewed exact
       runtime dependency closure exists. Do not remove this gate to test it. */
    if (!lstatSync(sandboxPath).isFile() || !(statSync(sandboxPath).mode & 0o111)) throw new Error("sandbox_exec_unavailable");
    fixture = createFixture((created) => { fixture = created; });
    report.resources.fixture_created = true;
    report.absence.fixture = false;
    report.fixture.canonical = true;
    report.fixture.owner_only = true;
    const profile = renderProfile(template, { NODE: runtime, INPUT: fixture.input, SCRATCH: fixture.scratchDir });
    const profilePath = join(fixture.root, "profile.sb");
    writeFileSync(profilePath, profile, { flag: "wx", mode: 0o400 });
    chmodSync(profilePath, 0o400);
    report.profile.rendered_sha256 = sha(profile);
    // The reviewed template plus these binding classes describe the expanded profile.
    report.profile.bindings = ["exact_system_runtime", "owned_immutable_input", "owned_scratch"];
    listener = await openOwnedListener();
    report.resources.listener_created = true;
    report.absence.listener = false;
    const parentChecks = Object.fromEntries(operationNames.map((name) => [name, true]));
    parentChecks.loopback_connect = listener.accepted() >= 1;
    parentChecks.child_exec = runtimeStat.isFile() && Boolean(runtimeStat.mode & 0o111);
    launch = await runSandbox(runtime, profilePath, source, fixture, listener.port);
    report.resources.sandbox_child_started = true;
    report.absence.sandbox_child = false;
    report.child = { state: launch.state, reaped: launch.reaped, exit_code: launch.code, signal: launch.signal, stdout_bytes: launch.stdoutBytes, stderr_bytes: launch.stderrBytes, env_names: launch.envNames };
    const classified = classify(parentChecks, launch);
    report.controls = classified.controls;
    report.child.evidence_valid = classified.evidenceValid;
    if (launch.state === "completed" && launch.reaped && launch.code === 0) {
      const written = existsSync(fixture.scratch) && lstatSync(fixture.scratch).isFile() &&
        !lstatSync(fixture.scratch).isSymbolicLink() && readFileSync(fixture.scratch, "utf8") === "synthetic-scratch\n";
      if (!written) report.controls.allowed_write.status = "failed";
    }
    if (listener.accepted() > 1) report.controls.loopback_connect.status = "unexpected_allowed";
    report.scope.local_tcp = ["loopback_listen", "loopback_connect"].every((name) => report.controls[name].status === "verified") ? "verified" : "unverified";
  } catch (error) {
    if (!(error instanceof Error && error.message === "completed_no_run" && report.decision === "NO-RUN")) {
      failure = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "setup_or_evaluation_error";
    }
  } finally {
    report.cleanup.listener = await closeOwnedListener(listener);
    report.cleanup.fixture = launch?.reaped === false ? false : cleanupFixture(fixture);
  }
  if (failure || !report.cleanup.listener || !report.cleanup.fixture ||
      (launch && (!launch.reaped || launch.state !== "completed" || launch.code !== 0 || !report.child.evidence_valid))) {
    report.failure = failure || (!report.cleanup.listener || !report.cleanup.fixture ? "cleanup_error" : "child_evidence_error");
    report.decision = "BLOCKED";
  }
  if (!failure && report.cleanup.listener && report.cleanup.fixture && report.decision !== "BLOCKED" &&
      (!launch || (launch.reaped && launch.state === "completed" && launch.code === 0 && report.child.evidence_valid))) {
    // Broader egress, IPC, and hard memory/scratch ceilings are unverified here.
    // A completed SDK-free investigation may truthfully exit 0 as NO-RUN.
    report.decision = "NO-RUN";
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.decision === "BLOCKED") process.exitCode = 2;
}

await main();
