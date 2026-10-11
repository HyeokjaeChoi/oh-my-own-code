import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  analyzeSource,
  getImportSpecifiers,
  repositoryRoot,
  resolveSourceTarget,
} from "./boundary-policy.mjs";
import {
  allowedImportFixtures,
  forbiddenImportFixtures,
} from "./boundary-fixtures.mjs";

test("forbidden import fixtures resolve to their source targets and fail the intended rule", () => {
  for (const fixture of forbiddenImportFixtures) {
    const importer = resolve(repositoryRoot, fixture.importer);
    const violations = analyzeSource({
      importer,
      sourceText: fixture.sourceText,
      kind: fixture.kind,
    });
    assert.ok(
      violations.some((violation) => violation.code === fixture.expectedCode),
      fixture.name,
    );
    assert.ok(
      violations.every(
        (violation) =>
          violation.target ||
          violation.code === "browser-node-import" ||
          violation.code === "opencode-sdk-import" ||
          violation.code === "workspace-package-deep-import",
      ),
      fixture.name,
    );
  }
});

test("allowed public-entry imports remain valid", () => {
  for (const fixture of allowedImportFixtures) {
    const importer = resolve(repositoryRoot, fixture.importer);
    const specifier = getImportSpecifiers(fixture.sourceText)[0];
    assert.ok(specifier);
    assert.ok(
      resolveSourceTarget(importer, specifier),
      `${fixture.name} must resolve its TypeScript source target`,
    );
    const violations = analyzeSource({
      importer,
      sourceText: fixture.sourceText,
      kind: fixture.kind,
    });
    assert.deepEqual(violations, [], fixture.name);
  }
});

test("import extraction covers static, re-export, dynamic, and CommonJS forms", () => {
  const sourceText = [
    'import "node:fs";',
    'export { WorkbenchPage } from "../../../pages/workbench/index.js";',
    'void import("node:path");',
    'require("node:child_process");',
  ].join("\n");
  const violations = analyzeSource({
    importer: resolve(
      repositoryRoot,
      "apps/workbench-web/src/widgets/session-workspace/ui/fixture.tsx",
    ),
    kind: "browser",
    sourceText,
  });
  assert.deepEqual(
    violations
      .filter((violation) => violation.code === "browser-node-import")
      .map((violation) => violation.specifier),
    ["node:fs", "node:path", "node:child_process"],
  );
  assert.ok(
    violations.some((violation) => violation.code === "fsd-layer-direction"),
  );
  assert.deepEqual(getImportSpecifiers(sourceText), [
    "node:fs",
    "../../../pages/workbench/index.js",
    "node:path",
    "node:child_process",
  ]);
});
