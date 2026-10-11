// Current immutable build/resource bytes; no product process launch.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "../../../../apps/desktop-app/scripts/build-provenance.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const report = JSON.parse(
  await readFile(new URL("./final-performance-current-r2/ui-states/performance-evidence.json", import.meta.url), "utf8"),
);
assert.equal(report.result, "pass");
const actual = await captureProvenance(root, { script: "ui-states" });
assert.deepEqual(actual, report.provenance.before);
assert.deepEqual(actual, report.provenance.after);
process.stdout.write(JSON.stringify({ result: "pass", kind: "current-build-resource-bytes", productProcessesStarted: 0 }) + "\n");
