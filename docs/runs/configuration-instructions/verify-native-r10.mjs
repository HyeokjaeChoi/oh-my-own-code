// Read-only reuse after exactly one renderer explanatory paragraph change. No Native execution.
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
const current = await captureProvenance(root, {
  script: "smoke",
  mode: "dev",
  platform: "darwin",
});
const paragraphPath =
  "apps/desktop-app/src/renderer/widgets/explorer/index.tsx";
const oldText = await readFile(
  join(
    root,
    "docs/runs/configuration-instructions/evidence/explorer-before-r10.tsx",
  ),
  "utf8",
);
const actualText = await readFile(join(root, paragraphPath), "utf8");
const oldParagraph =
  "        있습니다. 파일을 불러와 비교한 뒤 저장할 수 있습니다. 런타임 적용과 연결\n        변경은 아직 제공하지 않습니다.";
const newParagraph =
  "        있습니다. 파일을 불러와 비교한 뒤 저장할 수 있습니다. AGENTS.md는 선택한\n        세션에 별도로 등록·제거할 수 있습니다. 다른 설정의 런타임 적용과 MCP\n        연결 변경은 아직 제공하지 않습니다.";
assert.equal(oldText.split(oldParagraph).length, 2);
assert.equal(actualText, oldText.replace(oldParagraph, newParagraph));
const oldInputs = before.provenance.currentBuildInputs;
const newInputs = current.currentBuildInputs;
const oldRow = oldInputs.files.find((row) => row.path === paragraphPath);
assert.ok(oldRow);
assert.equal(createHash("sha256").update(oldText).digest("hex"), oldRow.sha256);
assert.deepEqual(
  newInputs.files.filter((row) => row.path !== paragraphPath),
  oldInputs.files.filter((row) => row.path !== paragraphPath),
);
for (const key of ["algorithm", "scopes", "selection", "limits"])
  assert.deepEqual(newInputs[key], oldInputs[key]);
const nonRenderer = (files) =>
  files.filter(
    (row) => !row.path.startsWith("apps/desktop-app/dist/app/renderer/"),
  );
assert.deepEqual(
  nonRenderer(current.launchArtifacts.files),
  nonRenderer(before.provenance.launchArtifacts.files),
);
assert.deepEqual(
  current.launchArtifacts.eventHostResources,
  before.provenance.launchArtifacts.eventHostResources,
);
assert.deepEqual(
  current.launchArtifacts.ownerLifetimeResources,
  before.provenance.launchArtifacts.ownerLifetimeResources,
);
assert.deepEqual(
  current.selectedScriptsAndFixtures,
  before.provenance.selectedScriptsAndFixtures,
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
  join(
    root,
    "docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs",
  ),
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
      "Read-only Native-r4 reuse: exactly one explanatory renderer paragraph changed; other production inputs and non-renderer build artifacts identical",
    cases: 12,
    nativeReexecuted: false,
  }),
);

assert.equal(
  createHash("sha256")
    .update(
      await readFile(
        join(
          root,
          "docs/runs/configuration-instructions/evidence/native-r4/configuration-instructions-evidence.json",
        ),
      ),
    )
    .digest("hex"),
  "18324013e64b9b4663c331e9f600ebcb7279dbe794393247179c1b6beaa0e5b7",
);
