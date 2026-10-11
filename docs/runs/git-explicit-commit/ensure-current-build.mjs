// Reuse only a byte-verified current build. UI evidence scripts are not build
// inputs; changing them alone does not require rebuilding unchanged app code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "../../../apps/desktop-app/scripts/build-provenance.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let action = "verified_existing_current_build",
  provenance;
try {
  provenance = await captureProvenance(root, {
    script: "git-commit",
    mode: "dev",
    platform: process.platform,
  });
} catch {
  action = "rebuilt_and_verified";
  const result = spawnSync(
    "pnpm",
    ["exec", "nx", "run", "desktop-app:build", "--skip-nx-cache"],
    { cwd: root, stdio: "inherit", timeout: 300000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  provenance = await captureProvenance(root, {
    script: "git-commit",
    mode: "dev",
    platform: process.platform,
  });
}
console.log(
  JSON.stringify({
    result: "pass",
    action,
    buildStampSha256: provenance.buildStampSha256,
    inputsSha256: provenance.buildStamp.inputs.sha256,
    artifactsSha256: provenance.buildStamp.artifacts.sha256,
    selectedScriptsSha256: provenance.selectedScriptsAndFixtures.sha256,
  }),
);
