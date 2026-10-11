// Read-only validation of a prior physical run. This module never launches it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESCRIPTOR_EVIDENCE_SOURCES = Object.freeze([
  "apps/desktop-app/scripts/native-descriptor-probe.mjs",
  "apps/desktop-app/src/host/native-descriptor-read.mjs",
  "apps/desktop-app/src/host/native-descriptor-read-resource.mjs",
  "apps/desktop-app/src/host/darwin-descriptor-ffi.mjs",
  "apps/desktop-app/src/host/darwin-directory-entry.mjs",
  "apps/desktop-app/src/host/workspace-root-authority.mjs",
  "apps/desktop-app/src/renderer/shared/workspace-file/index.mjs",
  "apps/desktop-app/runtime-event-host/installer-pins.json",
]);
const engineDigest =
  "35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5";
const enginePath =
  "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/runtime/bun";
const hashPattern = /^[a-f0-9]{64}$/u;

function readChecked(path, limit, collect = true) {
  assert.ok(Number.isInteger(fs.constants.O_NOFOLLOW));
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(
      before.isFile() && before.size > 0n && before.size <= BigInt(limit),
    );
    const hash = createHash("sha256"),
      parts = [],
      buffer = Buffer.alloc(65536);
    let total = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      assert.ok(total <= limit);
      hash.update(buffer.subarray(0, count));
      if (collect) parts.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      assert.equal(after[key], before[key]);
    assert.equal(BigInt(total), before.size);
    return {
      sha256: hash.digest("hex"),
      ...(collect && { bytes: Buffer.concat(parts) }),
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function validateDescriptorEvidence({
  input,
  execution,
  fixture,
  intent,
  marker,
  projectRoot,
  root,
  currentSources,
  currentEngine,
}) {
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      "schemaVersion",
      "kind",
      "root",
      "nonce",
      "engineSha256",
      "sourceHashes",
      "argv",
      "environment",
      "timeoutMs",
      "limits",
    ].sort(),
  );
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.kind, "owned-descriptor-kernel-probe");
  assert.equal(input.root, root);
  assert.deepEqual(marker, { root, nonce: input.nonce });
  assert.equal(typeof input.nonce, "string");
  assert.equal(input.engineSha256, engineDigest);
  assert.equal(currentEngine, engineDigest);
  assert.equal(input.timeoutMs, 30000);
  assert.deepEqual(input.argv, [
    join(root, "bun"),
    "--no-install",
    "--no-env-file",
    join(projectRoot, DESCRIPTOR_EVIDENCE_SOURCES[0]),
    "--fixture",
    root,
  ]);
  assert.deepEqual(
    Object.keys(input.sourceHashes).sort(),
    [...DESCRIPTOR_EVIDENCE_SOURCES].sort(),
  );
  for (const value of Object.values(input.sourceHashes))
    assert.match(value, hashPattern);
  assert.deepEqual(currentSources, input.sourceHashes);
  assert.deepEqual(input.environment, {
    PATH: "/usr/bin:/bin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    OMOC_DESCRIPTOR_PROBE_NONCE: input.nonce,
  });
  assert.deepEqual(
    Object.keys(intent).sort(),
    ["inputSha256", "sourceHashes", "engineSha256", "argv"].sort(),
  );
  assert.deepEqual(intent.sourceHashes, input.sourceHashes);
  assert.deepEqual(intent.argv, input.argv);
  assert.equal(intent.engineSha256, engineDigest);
  assert.match(intent.inputSha256, hashPattern);
  assert.equal(execution.passed, true);
  assert.ok(Number.isSafeInteger(execution.pid) && execution.pid > 0);
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.signal, null);
  assert.equal(execution.errorCode, undefined);
  assert.equal(execution.sourceStable, true);
  assert.equal(execution.engineStable, true);
  assert.equal(execution.namespaceRetained, root);
  assert.deepEqual(execution.result, fixture);
  assert.equal(fixture.passed, true);
  assert.equal(fixture.bunVersion, "1.4.2");
  assert.equal(fixture.cases.length, 11);
  const names = new Set();
  for (const row of fixture.cases) {
    assert.equal(typeof row.name, "string");
    assert.ok(row.name.length > 0 && !names.has(row.name));
    names.add(row.name);
    assert.equal(row.passed, true);
    assert.equal(row.descriptorsReturnedToBaseline, true);
    assert.equal(row.ownerDescriptors, 1);
    assert.ok(Number.isSafeInteger(row.baselineFDs) && row.baselineFDs >= 0);
    assert.equal(row.finalFDs, row.baselineFDs);
  }
  return Object.freeze({
    passed: true,
    executedProbe: false,
    reusedPhysicalEvidence: true,
    originalPid: execution.pid,
    originalExitCode: execution.exitCode,
    sourceFiles: DESCRIPTOR_EVIDENCE_SOURCES.length,
    cases: fixture.cases.length,
    engineSha256: engineDigest,
    limits:
      "Read-only reuse of the pinned prior physical unit run; no new Bun/Native execution, startup/task/provider proof or filesystem isolation claim.",
  });
}

export function verifyDescriptorEvidence({
  projectRoot,
  root,
  inputSha256,
  executionSha256,
  fixtureSha256,
}) {
  projectRoot = fs.realpathSync(projectRoot);
  assert.equal(fs.realpathSync(root), root);
  assert.ok(
    fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(),
  );
  const documents = {};
  for (const [name, expected] of [
    ["input", inputSha256],
    ["execution", executionSha256],
    ["fixture-result", fixtureSha256],
  ]) {
    assert.match(expected, hashPattern);
    const data = readChecked(join(root, `${name}.json`), 4 * 1024 * 1024);
    assert.equal(data.sha256, expected, name);
    documents[name] = JSON.parse(data.bytes.toString("utf8"));
  }
  const intent = JSON.parse(
    readChecked(
      join(root, "execution-intent.json"),
      4 * 1024 * 1024,
    ).bytes.toString("utf8"),
  );
  assert.equal(intent.inputSha256, inputSha256);
  const marker = JSON.parse(
    readChecked(join(root, "marker.json"), 4096).bytes.toString("utf8"),
  );
  const currentSources = Object.fromEntries(
    DESCRIPTOR_EVIDENCE_SOURCES.map((path) => [
      path,
      readChecked(join(projectRoot, path), 32 * 1024 * 1024, false).sha256,
    ]),
  );
  const currentEngine = readChecked(
    join(projectRoot, enginePath),
    512 * 1024 * 1024,
    false,
  ).sha256;
  assert.equal(
    readChecked(join(root, "bun"), 512 * 1024 * 1024, false).sha256,
    currentEngine,
  );
  const result = validateDescriptorEvidence({
    input: documents.input,
    execution: documents.execution,
    fixture: documents["fixture-result"],
    intent,
    marker,
    projectRoot,
    root,
    currentSources,
    currentEngine,
  });
  // Detect changes observed during this validation, without claiming isolation.
  for (const [path, expected] of Object.entries(currentSources))
    assert.equal(
      readChecked(join(projectRoot, path), 32 * 1024 * 1024, false).sha256,
      expected,
    );
  assert.equal(
    readChecked(join(projectRoot, enginePath), 512 * 1024 * 1024, false).sha256,
    currentEngine,
  );
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const flags = [
      "--root",
      "--input-sha256",
      "--execution-sha256",
      "--fixture-sha256",
    ];
    assert.equal(process.argv.length, 10);
    assert.deepEqual(
      process.argv.slice(2).filter((_, index) => index % 2 === 0),
      flags,
    );
    const [, root, , inputSha256, , executionSha256, , fixtureSha256] =
      process.argv.slice(2);
    process.stdout.write(
      JSON.stringify(
        verifyDescriptorEvidence({
          projectRoot: process.cwd(),
          root,
          inputSha256,
          executionSha256,
          fixtureSha256,
        }),
      ) + "\n",
    );
  } catch {
    process.stderr.write("descriptor_evidence_unverified\n");
    process.exitCode = 1;
  }
}
