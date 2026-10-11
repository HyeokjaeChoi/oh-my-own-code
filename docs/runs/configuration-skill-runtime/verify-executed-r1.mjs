// Read-only verification of actual completed build/Native evidence. No launch.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { captureProvenance } from "../../../apps/desktop-app/scripts/build-provenance.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pins = JSON.parse(
  await readFile(
    new URL("./executed-proof-pins-r1.json", import.meta.url),
    "utf8",
  ),
);
const mode = process.argv[2];
assert.ok(["build", "native", "hidden-ui"].includes(mode));
const selected = pins[mode];
const bytes = await readFile(selected.path);
if (mode !== "hidden-ui") assert.equal(hash(bytes), selected.sha256);
const proof = JSON.parse(bytes);
const current = await captureProvenance(process.cwd(), {
  script: mode === "hidden-ui" ? "ui-states" : "smoke",
  mode: "dev",
  platform: "darwin",
});
if (mode === "build") {
  assert.equal(proof.exitCode, 0);
  assert.deepEqual(proof.command, [
    "pnpm",
    "exec",
    "nx",
    "run",
    "desktop-app:build",
    "--skip-nx-cache",
  ]);
  assert.equal(hash(await readFile(proof.log)), proof.logSha256);
  assert.deepEqual(current, proof.provenance);
} else if (mode === "native") {
  assert.equal(proof.result, "pass");
  assert.deepEqual(proof.after, proof.before);
  assert.deepEqual(current, proof.before.provenance);
  assert.deepEqual(
    proof.cases.map((x) => x.name),
    selected.caseNames,
  );
  assert.equal(proof.cases.length, 15);
  assert.ok(proof.cases.every((x) => x.result === "pass"));
  assert.equal(proof.cleanup.length, 7);
  for (const row of proof.cleanup) {
    assert.equal(row.exited, true);
    assert.equal(row.nativeExitConfirmed, true);
    assert.deepEqual(row.exit, { code: 0, signal: null });
    assert.equal(row.cleanup.explicitStopConfirmed, true);
    assert.equal(row.cleanup.helperExitConfirmed, true);
    assert.equal(row.cleanup.fallbackDisconnect, false);
    assert.equal(row.nativeStopResult.windows, 0);
    assert.equal(row.nativeStopResult.activationPolicy, "prohibited");
    if (row.nativeStopResult.nativeStarted)
      assert.deepEqual(row.nativeStopResult.nativeExit, {
        code: 0,
        signal: null,
      });
  }
  for (const file of proof.before.hashes)
    assert.equal(hash(await readFile(file.path)), file.sha256);
}
if (mode === "hidden-ui") {
  const manifest = JSON.parse(await readFile(selected.manifestPath, "utf8"));
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.exitCode, 0);
  assert.equal(manifest.wrapperExitCode, 0);
  assert.equal(manifest.signal, null);
  assert.equal(manifest.provenanceVerifiedAfter, true);
  assert.deepEqual(current, manifest.provenance);
  assert.equal(proof.result, "pass");
  assert.deepEqual(proof.teardown, { exited: true, code: 0 });
  assert.equal(proof.providerExecution, "not performed");
  assert.ok(proof.configurationSkillRuntimeStates.length >= 14);
  for (const name of [
    "owned",
    "already-present",
    "history-unavailable",
    "inherited",
    "foreign",
    "restart",
    "untrusted",
    "unknown",
    "denied",
    "changed",
    "unavailable",
    "pending",
    "restoredoldkey",
    "cancelled",
  ])
    assert.ok(
      proof.configurationSkillRuntimeStates.some((row) => row.state === name),
      name,
    );
  assert.ok(proof.screenshots.length >= 291);
  const parent = resolve(selected.manifestPath, "..");
  for (const shot of proof.screenshots) {
    const path = await realpath(shot.path);
    assert.ok(path.startsWith(parent + sep));
    const png = await readFile(path);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), shot.pixelDimensions.width);
    assert.equal(png.readUInt32BE(20), shot.pixelDimensions.height);
    assert.equal(shot.beforeCapture.visible, false);
    assert.equal(shot.beforeCapture.focused, false);
    assert.equal(shot.beforeCapture.focusable, false);
  }
}
console.log(
  JSON.stringify({
    result: "pass",
    mode,
    reexecuted: false,
    authority:
      "Actual completed Main execution; exact current source/build/resources and original evidence hashes checked. UI fixture-only changes do not alter this selected Native/build closure.",
  }),
);
