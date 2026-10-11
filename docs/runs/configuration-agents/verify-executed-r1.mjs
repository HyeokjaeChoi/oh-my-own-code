// Read-only current-byte verification of completed actual executions; never launches.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { captureProvenance } from "../../../apps/desktop-app/scripts/build-provenance.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const pins = JSON.parse(
  await readFile(
    new URL("./executed-proof-pins-r1.json", import.meta.url),
    "utf8",
  ),
);
const mode = process.argv[2];
assert.ok(["build", "native", "hidden-ui"].includes(mode));
const pin = pins[mode],
  bytes = await readFile(pin.path);
assert.equal(hash(bytes), pin.sha256);
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
  assert.deepEqual(proof.before, proof.after);
  assert.deepEqual(current, proof.before.provenance);
  assert.equal(proof.cases.length, 14);
  assert.deepEqual(
    proof.cases.map((r) => r.name),
    pin.caseNames,
  );
  assert.ok(proof.cases.every((r) => r.result === "pass"));
  assert.equal(proof.cleanup.length, 3);
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
  for (const item of proof.before.hashes)
    assert.equal(hash(await readFile(item.path)), item.sha256);
} else {
  const manifest = JSON.parse(await readFile(pin.manifestPath, "utf8"));
  assert.equal(hash(await readFile(pin.manifestPath)), pin.manifestSha256);
  assert.equal(manifest.status, "pass");
  assert.equal(manifest.exitCode, 0);
  assert.equal(manifest.wrapperExitCode, 0);
  assert.equal(manifest.signal, null);
  assert.equal(manifest.provenanceVerifiedAfter, true);
  assert.deepEqual(current, manifest.provenance);
  assert.equal(proof.result, "pass");
  assert.deepEqual(proof.teardown, { exited: true, code: 0 });
  assert.equal(proof.providerExecution, "not performed");
  assert.ok(
    Array.isArray(proof.configurationAgentStates) &&
      proof.configurationAgentStates.length >= 10,
  );
  assert.ok(
    Array.isArray(proof.configurationAgentRuntimeStates) &&
      proof.configurationAgentRuntimeStates.length >= 10,
  );
  assert.deepEqual(
    proof.configurationAgentStates.map((r) => r.state),
    pin.agentStates,
  );
  assert.deepEqual(
    proof.configurationAgentRuntimeStates.map((r) => r.state),
    pin.agentRuntimeStates,
  );
  assert.equal(proof.screenshots.length, pin.screenshotCount);
  const parent = resolve(pin.manifestPath, "..");
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
      "Strict current full selected production/build/resources/script/probe inventories and actual execution hashes verified. No launch or normalization.",
  }),
);
