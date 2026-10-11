import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This entry point is the independent resource supervisor. Keep its child
// source allowlist synchronized after the static review freezes these files.
const here = dirname(fileURLToPath(import.meta.url));
const expectedRuntime = "/opt/homebrew/Cellar/node/26.8.2/bin/node";
const expectedRuntimeSha256 = "902b6a6984d5d825829ea9064ab73b734548df37bc0683990dca31c8dc2a9253";
const expected = {
  "preflight-worker.mjs": "ffcfafdbdfcd993ff519fc9ca33e51026ce82c549c3ead34f21e396b6a8c2a8b",
  "canaries.mjs": "81f5193b6da7c5a66598fcb0e84419150df4e5d4f9d66b7d6c9f1dc45bf87837",
  "profile.sb.in": "36564697253350f0948d279e81f2037c33f5aaec1d7a27eb5a5a5412eacacd27",
};
const wallClockMs = 45000;
const reapMs = 5000;
const aggregateOutputBytes = 16384;

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const statusNames = new Set(["verified", "unavailable", "failed", "unverified", "unexpected_allowed"]);
const operationNames = ["allowed_read", "allowed_write", "outside_read", "outside_write", "loopback_listen", "loopback_connect", "child_exec"];

async function fileSha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function validEarlyNoRun(packet) {
  if (packet.decision !== "NO-RUN" || packet.failure !== "runtime_dependency_closure_unverified" ||
      packet.runtime?.path !== expectedRuntime || packet.runtime?.sha256 !== expectedRuntimeSha256 ||
      packet.profile?.template_sha256 !== expected["profile.sb.in"] ||
      packet.profile?.canaries_sha256 !== expected["canaries.mjs"] ||
      packet.fixture?.canonical !== false || packet.fixture?.owner_only !== false ||
      packet.resources?.fixture_created !== false || packet.resources?.listener_created !== false ||
      packet.resources?.sandbox_child_started !== false || packet.absence?.fixture !== true ||
      packet.absence?.listener !== true || packet.absence?.sandbox_child !== true ||
      packet.cleanup?.fixture !== true || packet.cleanup?.listener !== true ||
      packet.child?.state !== "not_started" || packet.child?.reaped !== true ||
      packet.child?.evidence_valid !== false || packet.child?.exit_code !== undefined ||
      packet.child?.signal !== undefined || packet.child?.stdout_bytes !== undefined ||
      packet.child?.stderr_bytes !== undefined ||
      !packet.controls || Object.keys(packet.controls).sort().join() !== [...operationNames].sort().join()) return false;
  if (["runtime_dependency_closure", "local_tcp", "general_egress", "udp_dns_ipc", "memory_scratch_limits"]
      .some((name) => packet.scope?.[name] !== "unverified")) return false;
  return operationNames.every((name) => {
    const control = packet.controls[name];
    return control && Object.keys(control).sort().join() === "status,target_class" &&
      control.status === "unverified" && control.target_class === name;
  });
}

function blocked(reason, extra = {}) {
  return {
    schema: 1,
    decision: "BLOCKED",
    reason,
    supervisor: { wall_clock_ms: wallClockMs, reap_ms: reapMs, aggregate_output_bytes: aggregateOutputBytes, source_hashes: expected },
    ...extra,
  };
}

function boundedReport(packet) {
  if (!packet || packet.schema !== 1 || !["NO-RUN", "BLOCKED"].includes(packet.decision)) return null;
  if (packet.decision === "NO-RUN" && !validEarlyNoRun(packet)) return null;
  const controls = {};
  for (const name of operationNames) {
    const item = packet.controls?.[name];
    if (!item || !statusNames.has(item.status)) return null;
    controls[name] = {
      status: item.status,
      target_class: name,
      ...(typeof item.errno === "string" && /^[A-Z0-9_]{1,20}$/.test(item.errno) ? { errno: item.errno } : {}),
      ...(typeof item.syscall === "string" && /^[a-z_]{1,20}$/.test(item.syscall) ? { syscall: item.syscall } : {}),
    };
  }
  const boundedFailure = typeof packet.failure === "string" && /^[a-z_]{1,80}$/.test(packet.failure) ? packet.failure : undefined;
  return {
    schema: 1,
    decision: packet.decision,
    ...(boundedFailure ? { reason: boundedFailure } : {}),
    runtime: {
      platform: typeof packet.runtime?.platform === "string" ? packet.runtime.platform.slice(0, 16) : "unknown",
      release: typeof packet.runtime?.release === "string" ? packet.runtime.release.slice(0, 64) : "unknown",
      arch: typeof packet.runtime?.arch === "string" ? packet.runtime.arch.slice(0, 24) : "unknown",
      version: typeof packet.runtime?.version === "string" ? packet.runtime.version.slice(0, 32) : "unknown",
      ...(typeof packet.runtime?.sha256 === "string" && /^[a-f0-9]{64}$/.test(packet.runtime.sha256) ? { sha256: packet.runtime.sha256 } : {}),
    },
    profile: Object.fromEntries(["template_sha256", "canaries_sha256", "rendered_sha256"].flatMap((key) =>
      typeof packet.profile?.[key] === "string" && /^[a-f0-9]{64}$/.test(packet.profile[key]) ? [[key, packet.profile[key]]] : [])),
    fixture: {
      class: "/private/tmp/host-probe-isolation-*",
      canonical: packet.fixture?.canonical === true,
      owner_only: packet.fixture?.owner_only === true,
    },
    controls,
    scope: {
      runtime_dependency_closure: packet.scope?.runtime_dependency_closure === "verified" ? "verified" : "unverified",
      local_tcp: packet.scope?.local_tcp === "verified" ? "verified" : "unverified",
      general_egress: "unverified",
      udp_dns_ipc: "unverified",
      memory_scratch_limits: "unverified",
    },
    child: {
      state: typeof packet.child?.state === "string" && /^[a-z_]{1,24}$/.test(packet.child.state) ? packet.child.state : "unknown",
      reaped: packet.child?.reaped === true,
      evidence_valid: packet.child?.evidence_valid === true,
      ...(Number.isInteger(packet.child?.exit_code) ? { exit_code: packet.child.exit_code } : {}),
      ...(typeof packet.child?.signal === "string" && /^[A-Z0-9]{1,16}$/.test(packet.child.signal) ? { signal: packet.child.signal } : {}),
      stdout_bytes: Number.isInteger(packet.child?.stdout_bytes) ? Math.min(packet.child.stdout_bytes, 8192) : 0,
      stderr_bytes: Number.isInteger(packet.child?.stderr_bytes) ? Math.min(packet.child.stderr_bytes, 2048) : 0,
    },
    cleanup: {
      listener: packet.cleanup?.listener === true,
      fixture: packet.cleanup?.fixture === true,
    },
    resources: {
      fixture_created: packet.resources?.fixture_created === true,
      listener_created: packet.resources?.listener_created === true,
      sandbox_child_started: packet.resources?.sandbox_child_started === true,
    },
    absence: {
      fixture: packet.absence?.fixture === true,
      listener: packet.absence?.listener === true,
      sandbox_child: packet.absence?.sandbox_child === true,
    },
    supervisor: { wall_clock_ms: wallClockMs, reap_ms: reapMs, aggregate_output_bytes: aggregateOutputBytes, source_hashes: expected },
  };
}

function stopGroup(child) {
  if (!child.pid) return false;
  try { process.kill(-child.pid, "SIGKILL"); return true; }
  catch {
    try { child.kill("SIGKILL"); return true; } catch { return false; }
  }
}

async function main() {
  try {
    if (realpathSync(process.execPath) !== expectedRuntime ||
        await fileSha256(expectedRuntime) !== expectedRuntimeSha256) throw new Error("runtime_identity_mismatch");
  } catch {
    process.stdout.write(`${JSON.stringify(blocked("runtime_identity_mismatch"))}\n`);
    process.exitCode = 2;
    return;
  }
  let sources;
  try {
    sources = Object.fromEntries(Object.keys(expected).map((name) => [name, readFileSync(join(here, name))]));
  } catch {
    process.stdout.write(`${JSON.stringify(blocked("source_unavailable"))}\n`);
    process.exitCode = 2;
    return;
  }
  if (Object.entries(expected).some(([name, digest]) => sha(sources[name]) !== digest)) {
    process.stdout.write(`${JSON.stringify(blocked("source_integrity_mismatch"))}\n`);
    process.exitCode = 2;
    return;
  }
  let workerSource;
  try {
    workerSource = new TextDecoder("utf-8", { fatal: true }).decode(sources["preflight-worker.mjs"]);
  } catch {
    process.stdout.write(`${JSON.stringify(blocked("source_integrity_mismatch"))}\n`);
    process.exitCode = 2;
    return;
  }
  const payload = JSON.stringify({
    canaries: sources["canaries.mjs"].toString("base64"),
    profile: sources["profile.sb.in"].toString("base64"),
  });
  if (Buffer.byteLength(payload) > 131072) {
    process.stdout.write(`${JSON.stringify(blocked("source_payload_limit"))}\n`);
    process.exitCode = 2;
    return;
  }

  let child;
  try {
    child = spawn(expectedRuntime, ["--input-type=module", "--eval", workerSource], {
      cwd: here,
      env: { PATH: "", LANG: "C", LC_ALL: "C", NO_COLOR: "1", HPI_SOURCE_PAYLOAD: payload },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
  } catch {
    process.stdout.write(`${JSON.stringify(blocked("worker_spawn_error"))}\n`);
    process.exitCode = 2;
    return;
  }

  let output = Buffer.alloc(0);
  let overflow = false;
  let settled = false;
  let timedOut = false;
  let stderrBytes = 0;
  const collect = (chunk, stderr = false) => {
    if (stderr) stderrBytes += chunk.length;
    if (settled || overflow) return;
    if (output.length + chunk.length > aggregateOutputBytes) {
      overflow = true;
      stopGroup(child);
      return;
    }
    output = Buffer.concat([output, chunk]);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", (chunk) => collect(chunk, true));
  const wallTimer = setTimeout(() => { timedOut = true; stopGroup(child); }, wallClockMs);
  let closeResult;
  const closed = new Promise((resolve) => {
    child.once("error", () => resolve({ error: true }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let reapTimer;
  const reapDeadline = new Promise((resolve) => { reapTimer = setTimeout(() => resolve({ reapTimeout: true }), wallClockMs + reapMs); });
  closeResult = await Promise.race([closed, reapDeadline]);
  clearTimeout(reapTimer);
  clearTimeout(wallTimer);
  if (closeResult.reapTimeout) {
    stopGroup(child);
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    process.stdout.write(`${JSON.stringify(blocked("worker_unreaped"))}\n`);
    process.exitCode = 2;
    return;
  }
  // The dedicated group may still contain a misbehaving worker descendant
  // after the worker itself closes. Kill only this verifier-owned group.
  stopGroup(child);
  settled = true;
  if (timedOut || overflow || stderrBytes > 0 || closeResult.error || closeResult.signal || closeResult.code === null) {
    const report = blocked(timedOut ? "worker_timeout" : overflow ? "worker_output_limit" : stderrBytes > 0 ? "worker_stderr" : "worker_abnormal_exit");
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 2;
    return;
  }

  let packet;
  try {
    const text = output.toString("utf8");
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) throw new Error("invalid_report_lines");
    packet = JSON.parse(text);
  } catch {
    process.stdout.write(`${JSON.stringify(blocked("malformed_worker_report"))}\n`);
    process.exitCode = 2;
    return;
  }
  const report = boundedReport(packet);
  if (!report || (packet.decision === "BLOCKED") !== (closeResult.code !== 0) ||
      (packet.decision !== "BLOCKED" && closeResult.code !== 0)) {
    process.stdout.write(`${JSON.stringify(blocked("worker_evidence_integrity_error"))}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.decision === "BLOCKED") process.exitCode = 2;
}

await main();
