// Saved auth-free synthetic probe. Runtime execution requires independent pre-execution CODE.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EVENT_HOST_CODE_ASSETS,
  assertRealResourceParents,
  inventoryEventHostTree,
  readResourceJson,
  resourceFileSha256,
  verifyEventHostResources,
} from "../src/event-host-resources.mjs";
import { NATIVE_PREFLIGHT_ASSETS } from "../src/native-preflight-resources.mjs";
import { stageEventHost } from "./stage-event-host.mjs";
import { loadRuntimeInputs, runtimePackageDir } from "./prepare-event-host.mjs";
import {
  permissionEnvironment,
  runPermissionChild,
} from "./permission-tool-probe.mjs";

const ownFile = fileURLToPath(import.meta.url);
const repository = resolve(dirname(ownFile), "../../..");
const sourceDir = join(repository, "apps/desktop-app/src");
const childSource = join(
  repository,
  "apps/desktop-app/scripts/fixtures/native-permission-graph-native.mjs",
);
const names = Object.freeze([
  "overlay_forwarding",
  "fixed_config",
  "fixed_plugin_source",
  "sdk_registration_denied",
  "inert_wellknown",
  "control_boot",
  "permission_held",
  "saved_held",
  "coordinator_held",
  "session_execution_held",
  "lease_component_runtime",
  "session_content_held",
  "session_policy_held",
  "session_inbox_held",
  "session_shell_held",
  "session_misc_held",
  "session_factory_held",
  "tool_snapshot_held",
  "tool_raw_held",
]);
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contains = (root, path) => {
  const rel = relative(root, path);
  return (
    !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  );
};

export async function claimGraphOutput(root, out) {
  assert.equal(typeof out, "string");
  await assertRealResourceParents(root);
  assert.equal(await fs.realpath(root), root);
  assert.ok(!out.includes("\\") && !out.includes("\0"));
  assert.ok(!out.split(sep).some((part) => part === "." || part === ".."));
  const base = join(
    root,
    "docs/runs/native-permission-session-entry-gate/evidence",
  );
  const target = resolve(root, out);
  assert.ok(contains(base, target));
  assert.match(relative(base, target), /^native-r[1-9][0-9]*$/u);
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    cursor = join(cursor, part);
    try {
      await fs.mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if (cursor === target || error.code !== "EEXIST") throw error;
    }
    await assertRealResourceParents(cursor);
  }
  return target;
}

// Hash the complete literal local import closure of the controller, child, graph,
// stage, verifier and all staged source assets. No installed module is imported.
export async function sourceIdentity() {
  const pending = [
    ownFile,
    childSource,
    join(sourceDir, "native-permission-graph.mjs"),
    join(sourceDir, "event-host-child.mjs"),
    join(sourceDir, "event-host-protocol.mjs"),
    ...EVENT_HOST_CODE_ASSETS.map((path) => join(sourceDir, path)),
    ...NATIVE_PREFLIGHT_ASSETS.map((path) => join(sourceDir, path)),
  ];
  const files = new Map();
  while (pending.length) {
    const path = pending.pop();
    if (files.has(path)) continue;
    assert.ok(contains(repository, path));
    await assertRealResourceParents(dirname(path));
    const before = await resourceFileSha256(path);
    const text = await fs.readFile(path, "utf8");
    assert.equal(await resourceFileSha256(path), before);
    files.set(path, before);
    if (!path.endsWith(".mjs")) continue;
    // Real import statements only: the overlay recipe quotes foreign import
    // text inside string literals, which never starts a source line.
    for (const match of text.matchAll(
      /(?:^[ \t]*(?:\}|(?:import|export)\b[^'";]*?)\s*from\s*|^[ \t]*import\s*|\bimport\s*\(\s*)(["'])(\.[^"']+)\1/gm,
    ))
      pending.push(resolve(dirname(path), match[2]));
  }
  return {
    files: Object.fromEntries(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, sha256]) => [relative(repository, path), sha256]),
    ),
  };
}
async function originalIdentity() {
  const { pins } = await loadRuntimeInputs(runtimePackageDir);
  assert.equal(pins.bun.version, "1.4.2");
  const generated = join(runtimePackageDir, ".generated");
  const receipt = await readResourceJson(join(generated, "receipt.json"));
  const entries = await inventoryEventHostTree(join(generated, "install"), {
    links: pins.links,
  });
  assert.deepEqual(entries, receipt.installEntries);
  const engine = await resourceFileSha256(join(generated, "runtime/bun"));
  assert.equal(engine, pins.bun.binarySha256);
  return {
    install: digest(entries),
    engine,
    inputs: Object.fromEntries(
      await Promise.all(
        [
          "package.json",
          "package-lock.json",
          "installer-pins.json",
          ".generated/receipt.json",
        ].map(async (path) => [
          path,
          await resourceFileSha256(join(runtimePackageDir, path)),
        ]),
      ),
    ),
  };
}
async function stagedIdentity(descriptor, sources) {
  const manifest = await verifyEventHostResources(descriptor, {
    platform: "darwin",
    arch: "arm64",
    requirePermissionOverlay: true,
  });
  const assets = [
    ["host.mjs", "event-host-child.mjs"],
    ["event-host-protocol.mjs", "event-host-protocol.mjs"],
    ["event-host-resources.mjs", "event-host-resources.mjs"],
    ...[
      ...new Set([
        ...EVENT_HOST_CODE_ASSETS,
        ...NATIVE_PREFLIGHT_ASSETS,
        "native-permission-graph.mjs",
      ]),
    ].map((path) => [path, path]),
  ];
  const staged = {};
  for (const [target, source] of assets) {
    const sha256 = await resourceFileSha256(join(descriptor.root, target));
    assert.equal(
      sha256,
      sources.files[relative(repository, join(sourceDir, source))],
    );
    staged[target] = sha256;
  }
  return {
    manifest: await resourceFileSha256(descriptor.manifestPath),
    inventory: digest(manifest),
    engine: await resourceFileSha256(descriptor.enginePath),
    assets: staged,
  };
}
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
function checkedProtocol(value) {
  assert.ok(exactKeys(value, ["schema_version", "result", "phase", "cases"]));
  assert.equal(value.schema_version, 1);
  assert.ok(["pass", "fail"].includes(value.result));
  // The child uses these fixed phases only; never export arbitrary strings.
  assert.ok(
    [
      "guard",
      "verified_factory",
      "server_start",
      "config_read",
      "minimal_sources",
      "complete",
      ...names.slice(11),
    ].includes(value.phase),
  );
  assert.ok(Array.isArray(value.cases) && value.cases.length === names.length);
  const cases = value.cases.map((entry, index) => {
    assert.ok(exactKeys(entry, ["name", "result"]));
    assert.equal(entry.name, names[index]);
    assert.ok(["pass", "fail"].includes(entry.result));
    return { name: names[index], result: entry.result };
  });
  return { schema_version: 1, result: value.result, phase: value.phase, cases };
}
function checkedChild(value) {
  assert.ok(Number.isSafeInteger(value.pid) || value.pid === null);
  assert.ok(Number.isInteger(value.code) || value.code === null);
  assert.ok(
    [
      null,
      "SIGTERM",
      "SIGKILL",
      "SIGABRT",
      "SIGSEGV",
      "SIGBUS",
      "SIGILL",
      "SIGINT",
      "SIGQUIT",
      "SIGPIPE",
      "SIGHUP",
      "SIGTRAP",
      "SIGSYS",
      "SIGFPE",
      "SIGUSR1",
      "SIGUSR2",
      "SIGALRM",
    ].includes(value.signal),
  );
  const result = { pid: value.pid, code: value.code, signal: value.signal };
  for (const key of ["exited", "timedOut", "spawnFailed", "protocolOverflow"]) {
    assert.equal(typeof value[key], "boolean");
    result[key] = value[key];
  }
  assert.ok(
    Array.isArray(value.signals) &&
      value.signals.length <= 2 &&
      value.signals.every((signal) => ["SIGTERM", "SIGKILL"].includes(signal)),
  );
  result.signals = [...value.signals];
  return result;
}

// Driver seam for Node-only tests. Scripted test children are not Native evidence.
export async function executeGraphProbe({
  repository: rootRepository,
  output,
  temporaryParent,
  childSource: childFile,
  sourceIdentity: sources,
  originalIdentity: original,
  stagedIdentity: staged,
  stage,
  runChild,
}) {
  const report = {
    schema_version: 1,
    result: "fail",
    phase: "namespace",
    cases: [],
    limits: [
      "Synthetic fixed Native graph only; not full F09, provider, UI or production Main acceptance.",
      "lease_component_runtime checks only pinned Bun/Effect and real PassThrough with synthetic private bookkeeping; it is not Native execution authorization or descendant proof.",
      "No OS filesystem/network sandbox or descendant enumeration is claimed.",
      "Retained namespaces and before-after hashes do not prove change-and-restore absence or power-loss recovery.",
    ],
  };
  let descriptor;
  report.before = {};
  report.after = {};
  try {
    assert.equal(await fs.realpath(rootRepository), rootRepository);
    await assertRealResourceParents(temporaryParent);
    const root = await fs.mkdtemp(
      join(temporaryParent, "omoc-permission-graph-"),
    );
    report.retainedRoot = root;
    await fs.chmod(root, 0o700);
    await fs.writeFile(
      join(root, ".permission-graph-probe-owned"),
      "synthetic permission graph probe v1\n",
      { mode: 0o600, flag: "wx" },
    );
    for (const dir of [
      "home",
      "config/opencode",
      "data",
      "state",
      "cache",
      "tmp",
      "workspace",
      "resources",
    ])
      await fs.mkdir(join(root, dir), { mode: 0o700, recursive: true });
    report.phase = "identity";
    report.before.source = await sources();
    report.before.original = await original();
    const childHash = await resourceFileSha256(childFile);
    report.before.child = childHash;
    report.phase = "stage";
    descriptor = await stage({
      resources: join(root, "resources"),
      platform: "darwin",
      arch: "arm64",
    });
    report.before.staged = await staged(descriptor, report.before.source);
    assert.equal(report.before.staged.engine, report.before.original.engine);
    const script = join(root, "native-child.mjs");
    await fs.copyFile(childFile, script, fs.constants.COPYFILE_EXCL);
    await fs.chmod(script, 0o600);
    assert.equal(await resourceFileSha256(script), childHash);
    report.copiedChild = { before: childHash };
    // Stage and source must still match the frozen pre-stage inputs before execution.
    assert.deepEqual(await sources(), report.before.source);
    assert.deepEqual(await original(), report.before.original);
    assert.deepEqual(
      await staged(descriptor, report.before.source),
      report.before.staged,
    );
    report.phase = "native";
    const child = await runChild(
      descriptor.enginePath,
      script,
      [root, descriptor.root],
      { cwd: join(root, "workspace"), env: permissionEnvironment(root) },
    );
    report.child = checkedChild(child);
    report.child.report = checkedProtocol(child.report);
    report.cases = report.child.report.cases;
    assert.equal(report.child.exited, true);
    assert.equal(report.child.timedOut, false);
    assert.equal(report.child.spawnFailed, false);
    assert.equal(report.child.protocolOverflow, false);
    assert.equal(report.child.code, 0);
    assert.equal(report.child.signal, null);
    assert.deepEqual(report.child.signals, []);
    assert.equal(report.child.report.result, "pass");
    assert.equal(report.child.report.phase, "complete");
    assert.ok(report.cases.every((entry) => entry.result === "pass"));
    report.phase = "recheck";
    report.result = "pass";
  } catch {
    report.error = "native_permission_graph_probe_failed";
  } finally {
    let stable = !!report.before.source && !!report.before.original;
    for (const [key, read] of [
      ["source", sources],
      ["original", original],
      ["child", () => resourceFileSha256(childFile)],
      ["staged", () => staged(descriptor, report.before.source)],
    ]) {
      if (!(key in report.before)) continue;
      try {
        report.after[key] = await read();
        assert.deepEqual(report.after[key], report.before[key]);
      } catch {
        stable = false;
      }
    }
    if (report.retainedRoot) {
      try {
        const script = join(report.retainedRoot, "native-child.mjs");
        if (report.copiedChild) {
          report.copiedChild.after = await resourceFileSha256(script);
          assert.equal(report.copiedChild.after, report.copiedChild.before);
        }
      } catch {
        stable = false;
      }
    }
    report.identityStable = stable;
    if (!stable) report.result = "fail";
    if (report.result === "pass") report.phase = "complete";
    else report.error = "native_permission_graph_probe_failed";
    await fs.writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  return report;
}

export async function runNativePermissionGraphProbe(
  args = process.argv.slice(2),
) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.deepEqual(args.slice(0, 1), ["--out"]);
  assert.equal(args.length, 2);
  const output = await claimGraphOutput(repository, args[1]);
  const report = await executeGraphProbe({
    repository,
    output,
    temporaryParent: await fs.realpath(tmpdir()),
    childSource,
    sourceIdentity,
    originalIdentity,
    stagedIdentity,
    stage: stageEventHost,
    runChild: runPermissionChild,
  });
  if (report.result !== "pass") process.exitCode = 1;
  return report;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await runNativePermissionGraphProbe();
  } catch {
    process.stderr.write("native_permission_graph_probe_failed\n");
    process.exitCode = 1;
  }
}
