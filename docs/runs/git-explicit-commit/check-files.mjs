import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { format } from "prettier";
import { isDeepStrictEqual } from "node:util";
const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const proof = read("./kernel-proof-r1.json");
for (const pin of proof.dependencies) {
  const bytes = fs.readFileSync(pin.path);
  assert.equal(bytes.length, pin.bytes);
  assert.equal(hash(bytes), pin.sha256, pin.path);
}
for (const pin of proof.reports) {
  const bytes = fs.readFileSync(pin.path);
  assert.equal(bytes.length, pin.bytes);
  assert.equal(hash(bytes), pin.sha256, pin.path);
  const report = JSON.parse(bytes);
  assert.deepEqual(report.process, { exitCode: 0, signal: null });
  assert.equal(report.runtime, "1.4.2");
  assert.equal(report.evidence.length, pin.cases);
  assert.ok(report.evidence.every((x) => x.status === "pass"));
  for (const source of report.ownedSources) {
    const actual = fs.readFileSync(source.path);
    assert.equal(actual.length, source.bytes);
    assert.equal(hash(actual), source.sha256);
  }
  const binary = report.runtimeBinary;
  assert.equal(
    binary.path,
    resolve(
      "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/runtime/bun",
    ),
  );
  const stat = fs.lstatSync(binary.path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(fs.realpathSync(binary.path), binary.path);
  const digest = hash(fs.readFileSync(binary.path));
  if (binary.sha256) assert.equal(digest, binary.sha256);
  else {
    assert.equal(digest, binary.before);
    assert.equal(digest, binary.after);
  }
  const manifest = JSON.parse(
    fs.readFileSync(
      resolve(
        "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/manifest.json",
      ),
    ),
  );
  assert.equal(manifest.bunVersion, "1.4.2");
  const entry = manifest.entries.find((x) => x.path === "runtime/bun");
  assert.equal(entry.sha256, digest);
  assert.equal(entry.size, stat.size);
}
console.log(
  JSON.stringify({
    kernelEvidence: "verified_prior_actual_execution",
    commitSharedCases: 82,
    indexCases: 52,
    newlyExecutedNativeKernelFixtures: false,
    dependencyPins: proof.dependencies.length,
  }),
);
const reuse = read("./node-files-format-proof-r1.json");
const priorBytes = fs.readFileSync(reuse.priorCheck);
assert.equal(hash(priorBytes), reuse.priorCheckSha256);
const prior = JSON.parse(priorBytes);
assert.equal(prior.exit_code, 0);
assert.equal(prior.inputs_changed, false);
assert.equal(prior.source_sha256, reuse.priorSourceSha256);
assert.deepEqual(prior.argv, [
  "node",
  "docs/runs/git-explicit-commit/check-files.mjs",
]);
const beforeBytes = fs.readFileSync(reuse.beforeSource);
assert.equal(hash(beforeBytes), reuse.beforeSha256);
const actualFormatted = fs.readFileSync(reuse.formattedPath);
assert.equal(hash(actualFormatted), reuse.formattedSha256);
assert.equal(
  await format(beforeBytes.toString("utf8"), { filepath: reuse.formattedPath }),
  actualFormatted.toString("utf8"),
);
const current = spawnSync(
  "python3",
  [
    "-c",
    "import importlib.util,json;from pathlib import Path;s=importlib.util.spec_from_file_location('h',Path('.solopreneur/harness.py'));h=importlib.util.module_from_spec(s);s.loader.exec_module(h);cur=h.inventory(Path.cwd());proof=json.loads(Path('docs/runs/git-explicit-commit/node-files-format-proof-r1.json').read_text());before={**cur,proof['formattedPath']:{**cur[proof['formattedPath']],'sha256':proof['beforeSha256']}};print(json.dumps({'inventory':cur,'priorDigest':h.digest(before)},sort_keys=True))",
  ],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(current.error, undefined);
assert.equal(current.status, 0);
const observed = JSON.parse(current.stdout);
if (isDeepStrictEqual(observed.inventory, reuse.currentInventory)) {
  assert.equal(observed.priorDigest, reuse.priorSourceSha256);
  console.log(
    JSON.stringify({
      nodeEvidence: "verified_prior_actual_execution_after_format_only_change",
      newlyExecutedNodeTests: false,
      priorSource: prior.source_sha256,
      changedPath: reuse.formattedPath,
    }),
  );
} else {
  console.log(
    JSON.stringify({
      nodeEvidence: "new_execution_for_changed_behavior",
      newlyExecutedNodeTests: true,
    }),
  );
  const argv = read("./files-argv-r1.json");
  const child = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    timeout: 500000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
}
