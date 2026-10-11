import assert from "node:assert/strict";
import { readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { captureProvenance } from "../../../apps/desktop-app/scripts/build-provenance.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const proof = JSON.parse(readFileSync(new URL("./publication-ui-only-proof-r1.json", import.meta.url)));
const priorBytes = readFileSync(proof.prior_check);
assert.equal(hash(priorBytes), proof.prior_check_sha256);
const prior = JSON.parse(priorBytes);
assert.equal(prior.exit_code, 0);
assert.equal(prior.inputs_changed, false);
assert.equal(prior.source_sha256, proof.source_sha256);
const beforeRunner = readFileSync(proof.before_path, "utf8");
assert.equal(hash(beforeRunner), proof.inventory[proof.allowed_path].sha256);
let expectedRunner = beforeRunner;
for (const change of proof.changes) {
  assert.equal(expectedRunner.split(change.from).length, 2);
  expectedRunner = expectedRunner.replace(change.from, change.to);
}
assert.equal(readFileSync(proof.allowed_path, "utf8"), expectedRunner);
const current = spawnSync("python3", ["-c", "import importlib.util,json;from pathlib import Path;s=importlib.util.spec_from_file_location('h',Path('.solopreneur/harness.py'));h=importlib.util.module_from_spec(s);s.loader.exec_module(h);print(json.dumps(h.inventory(Path.cwd()),sort_keys=True))"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
assert.equal(current.error, undefined);
assert.equal(current.status, 0);
const inventory = JSON.parse(current.stdout);
for (const change of proof.additional_changes ?? []) {
  assert.equal(hash(change.before), proof.inventory[change.path].sha256);
  assert.equal(readFileSync(change.path,"utf8"),change.after);
  inventory[change.path] = proof.inventory[change.path];
}
inventory[proof.allowed_path] = proof.inventory[proof.allowed_path];
assert.deepEqual(inventory, proof.inventory);
const reportBytes = readFileSync(proof.report);
assert.equal(hash(reportBytes), proof.report_sha256);
const report = JSON.parse(reportBytes);
assert.equal(report.status, "pass");
assert.deepEqual(report.before, report.after);
assert.equal(report.exit.exited, true);
assert.equal(report.exit.status, 0);
assert.equal(report.exit.signal, null);
assert.equal(report.matrix.observations.length, 33);
assert.ok(report.matrix.observations.every((x) => x.status === "pass"));
const now = await captureProvenance(process.cwd(), {script: "git-commit", mode: "dev", platform: "darwin"});
export const verifiedProvenance = now;
const priorProvenance = structuredClone(report.before.provenance);
const actualRunner = now.selectedScriptsAndFixtures.files.find((x) => x.path === proof.allowed_path);
assert.equal(actualRunner.sha256, hash(readFileSync(proof.allowed_path)));
// Only these two aggregate digests depend on the one verified runner literal.
priorProvenance.selectedScriptsAndFixtures.files = priorProvenance.selectedScriptsAndFixtures.files.map((x) => x.path === proof.allowed_path ? actualRunner : x);
priorProvenance.selectedScriptsAndFixtures.sha256 = now.selectedScriptsAndFixtures.sha256;
priorProvenance.currentRelevantSource = now.currentRelevantSource;
assert.equal(now.currentRelevantSource.buildInputsSha256, report.before.provenance.currentRelevantSource.buildInputsSha256);
assert.deepEqual(now, priorProvenance);
for (const name of ["git", "engine"]) {
  const identity = report.before[name];
  for (const part of identity.components) {
    const stat = lstatSync(part.path, {bigint:true});
    assert.ok(!stat.isSymbolicLink());
    for (const key of ["dev", "ino", "mode", "uid"]) assert.equal(String(stat[key]), part[key]);
  }
  assert.equal(hash(readFileSync(identity.components.at(-1).path)), identity.sha256);
}
console.log(JSON.stringify({result:"pass", evidence:"verified_prior_actual_publication", newlyExecutedPublication:false, cases:33, report:proof.report, allowedChange:proof.allowed_path, buildAndRuntimeStable:true}));
