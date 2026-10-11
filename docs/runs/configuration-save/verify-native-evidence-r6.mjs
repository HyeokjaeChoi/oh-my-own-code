// Read-only reuse of the actual revision6 production-chain execution after contract argv-only correction.
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
      "docs/runs/configuration-save/evidence/kernel-r3/configuration-save-evidence.json",
    ),
    "utf8",
  ),
);
assert.equal(report.result, "pass");
assert.equal(report.identitiesUnchanged, true);
assert.deepEqual(report.afterCleanup, report.before);
assert.equal(report.cases.length, 7);
assert.ok(report.cases.every((row) => row.result === "pass"));
assert.equal(new Set(report.cases.map((row) => row.name)).size, 7);
assert.equal(report.cleanup.length, 1);
assert.equal(report.cleanup[0].exited, true);
assert.equal(report.cleanup[0].nativeExitConfirmed, true);
assert.equal(report.cleanup[0].cleanup.explicitStopConfirmed, true);
assert.equal(report.cleanup[0].cleanup.fallbackDisconnect, false);
assert.equal(report.cleanup[0].cleanup.helperExitConfirmed, true);
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
  join(root, "apps/desktop-app/scripts/configuration-save-probe.mjs"),
  join(root, "apps/desktop-app/scripts/p7-storage-probe.mjs"),
  join(root, "apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs"),
  await realpath(require("electron")),
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
      "Read-only current-byte validation of actual revision6 Native kernel-r3 execution",
    cases: 7,
    nativeReexecuted: false,
  }),
);
