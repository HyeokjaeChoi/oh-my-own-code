import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const proof = JSON.parse(readFileSync(new URL("./hidden-prefix-proof-r1.json", import.meta.url)));
const oldBytes = readFileSync(proof.prior_report);
assert.equal(hash(oldBytes), proof.prior_report_sha256);
assert.equal(hash(readFileSync(proof.prior_runner)), proof.prior_runner_sha256);
const old = JSON.parse(oldBytes);
assert.equal(old.result, "fail"); // The original whole-run failure is never upgraded.
assert.equal(old.state, "late-ack-newer-draft");
assert.equal(old.states.length, proof.completed_states);
assert.equal(old.teardown.exited, true);
assert.equal(old.teardown.code, 0);
assert.deepEqual(old.sourceBuildProvenance.before, old.sourceBuildProvenance.after);
assert.equal(old.sourceBuildProvenance.before.selectedScriptsAndFixtures.files.find((x) => x.path === "apps/desktop-app/scripts/e2e-git-commit.mjs").sha256, proof.prior_runner_sha256);
function verifyStates(report) {
  const captures = new Map(report.screenshots.map((x) => [x.path, x]));
  const verified = new Set();
  for (const state of report.states) {
    assert.ok(state.coverage.length > 0);
    assert.deepEqual(state.before, state.after);
    assert.ok(state.selection.every((x) => x.complete));
    for (const row of state.coverage) {
      const shot = captures.get(row.capture);
      assert.ok(shot);
      assert.equal(shot.pngSha256, row.pngSha256);
      for (const event of [shot.beforeCapture, shot.afterCapture]) assert.deepEqual(event, {visible:false, focused:false, focusable:false});
      if (!verified.has(row.capture)) {
        const bytes = readFileSync(row.capture);
        assert.equal(hash(bytes), row.pngSha256);
        assert.equal(bytes.readUInt32BE(16), shot.pixelDimensions.width);
        assert.equal(bytes.readUInt32BE(20), shot.pixelDimensions.height);
        verified.add(row.capture);
      }
    }
  }
  return verified.size;
}
const priorCaptures = verifyStates(old);
// Verify all current app/build/runtime bytes and exact allowlisted runner changes.
const {verifiedProvenance} = await import("./verify-publication-ui-only.mjs");
let tailExecution = "new_actual_execution";
if (proof.tail_reuse) {
  const bytes = readFileSync(proof.new_output + "/git-commit/git-commit-evidence.json");
  assert.equal(hash(bytes),proof.tail_reuse.report_sha256);
  assert.equal(hash(readFileSync(proof.new_output + "/git-commit/manifest.json")),proof.tail_reuse.manifest_sha256);
  assert.deepEqual(JSON.parse(bytes).sourceBuildProvenance.before,verifiedProvenance);
  tailExecution = "verified_prior_actual_tail_execution";
} else {
  const execution = spawnSync(process.execPath, ["apps/desktop-app/scripts/run-evidence.mjs", "--script", "git-commit", "--out", proof.new_output], {
    stdio:"inherit", timeout:500000, env:{...process.env, OMOC_GIT_COMMIT_FOCUS:proof.fresh_focus},
  });
  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 0);
}
const fresh = JSON.parse(readFileSync(proof.new_output + "/git-commit/git-commit-evidence.json"));
const manifest = JSON.parse(readFileSync(proof.new_output + "/git-commit/manifest.json"));
assert.equal(fresh.result, "pass");
assert.equal(manifest.status, "pass");
assert.equal(manifest.provenanceVerifiedAfter, true);
assert.equal(fresh.teardown.exited, true);
assert.equal(fresh.teardown.code, 0);
assert.equal(fresh.states.length, 8);
assert.deepEqual(fresh.sourceBuildProvenance.before, fresh.sourceBuildProvenance.after);
for (const key of ["buildStampSha256", "currentBuildInputs", "launchArtifacts"]) assert.deepEqual(fresh.sourceBuildProvenance.before[key], old.sourceBuildProvenance.before[key]);
assert.ok(fresh.observations.some((x) => x.matrixScope === "settlement"));
const freshCaptures = verifyStates(fresh);
const keys = (r) => r.states.map((x) => JSON.stringify([x.state,x.theme,x.narrow]));
const summary = {result:"pass", authority:"Verified completed prior frames plus newly executed affected settlement frames; not a new full-matrix run", priorOverallResult:"fail", priorReport:proof.prior_report, reusedCompletedStates:43, verifiedPriorCaptures:priorCaptures, freshReport:proof.new_output + "/git-commit/git-commit-evidence.json", newlyExecutedStates:8, verifiedFreshCaptures:freshCaptures, uniqueStateThemeSizeKeys:new Set([...keys(old),...keys(fresh)]).size, unchangedApplicationBuild:true, ownedExit:fresh.teardown};
summary.tailExecution = tailExecution;
summary.newlyExecutedStatesThisCheck = tailExecution === "new_actual_execution" ? 8 : 0;
writeFileSync(new URL("./hidden-current-verification-r1.json", import.meta.url), JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
