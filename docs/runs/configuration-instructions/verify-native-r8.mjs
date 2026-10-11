// Read-only reuse of the actual revision7 production-chain execution after synthetic UI-fixture-only correction.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { captureProvenance } from "../../../apps/desktop-app/scripts/build-provenance.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../../../apps/desktop-app/src/event-host-resources.mjs";
const root = process.cwd();
const report = JSON.parse(
  await readFile(
    join(
      root,
      "docs/runs/configuration-instructions/evidence/native-r4/configuration-instructions-evidence.json",
    ),
    "utf8",
  ),
);
assert.equal(report.result, "pass");
assert.equal(report.identitiesUnchanged, true);
assert.deepEqual(report.afterCleanup, report.before);
assert.equal(report.cases.length, 12);
assert.ok(report.cases.every((row) => row.result === "pass"));
assert.equal(new Set(report.cases.map((row) => row.name)).size, 12);
assert.equal(report.cleanup.length, 2);
assert.equal(report.cleanup[0].exited, true);
assert.equal(report.cleanup[0].nativeExitConfirmed, true);
assert.equal(report.cleanup[0].cleanup.explicitStopConfirmed, true);
assert.equal(report.cleanup[0].cleanup.fallbackDisconnect, false);
assert.equal(report.cleanup[0].cleanup.helperExitConfirmed, true);
for (const row of report.cleanup) {
  assert.equal(row.exited, true);
  assert.equal(row.nativeExitConfirmed, true);
  assert.equal(row.cleanup.explicitStopConfirmed, true);
  assert.equal(row.cleanup.fallbackDisconnect, false);
  assert.equal(row.cleanup.helperExitConfirmed, true);
}
const before = report.before;
assert.deepEqual(
  await captureProvenance(root, {
    script: "smoke",
    mode: "dev",
    platform: "darwin",
  }),
  before.provenance,
);
const resources = join(root, "apps/desktop-app/dist/resources");
assert.equal(before.resources, resources);
const eventHost = eventHostForResources(resources, "darwin", "arm64");
assert.deepEqual(before.eventHost, eventHost);
const manifest = await verifyEventHostResources(eventHost, {
  platform: "darwin",
  arch: "arm64",
});
assert.equal(
  createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  before.manifestSha256,
);
const require = createRequire(join(root, "apps/desktop-app/package.json"));
const paths = [
  join(root, "apps/desktop-app/scripts/configuration-instructions-probe.mjs"),
  join(root, "apps/desktop-app/scripts/p7-storage-probe.mjs"),
  join(root, "apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs"),
  await realpath(require("electron")),
  join(root, "docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs"),
];
assert.deepEqual(
  before.hashes.map((row) => row.path),
  paths,
);
for (const row of before.hashes)
  assert.equal(await resourceFileSha256(row.path), row.sha256);
console.log(
  JSON.stringify({
    result: "pass",
    authority:
      "Read-only current-byte validation of actual revision7 Native instruction-r4 execution",
    cases: 12,
    nativeReexecuted: false,
  }),
);

assert.equal(createHash("sha256").update(await readFile(join(root,"docs/runs/configuration-instructions/evidence/native-r4/configuration-instructions-evidence.json"))).digest("hex"),"18324013e64b9b4663c331e9f600ebcb7279dbe794393247179c1b6beaa0e5b7");
