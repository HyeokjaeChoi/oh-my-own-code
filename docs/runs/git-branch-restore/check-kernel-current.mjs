// New branch/restore kernel execution; reuse only exact unchanged old native closures.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, relative, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const original = JSON.parse(
  await fs.readFile(
    new URL("./evidence/declaration-format-r1/proof.json", import.meta.url),
    "utf8",
  ),
);
const oldCheck = original.passedChecks.kernel;
assert.equal(oldCheck.exit_code, 0);
assert.equal(oldCheck.inputs_changed, false);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const closure = new Set();
async function visit(path) {
  if (closure.has(path)) return;
  closure.add(path);
  const bytes = await fs.readFile(path),
    rel = relative(root, path);
  assert.ok(!rel.startsWith(".."));
  assert.equal(
    hash(bytes),
    original.originalSources[rel]?.sha256,
    `Changed reused dependency: ${rel}`,
  );
  const source = bytes.toString("utf8");
  const imports = [
    ...source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/gu),
  ].map((x) => x[1]);
  for (const spec of imports) {
    if (spec.startsWith("node:") || spec.startsWith("bun:")) continue;
    assert.ok(spec.startsWith("."), `Unpinned package import: ${spec}`);
    await visit(resolve(dirname(path), spec));
  }
}
for (const name of ["git-index-kernel.test.mjs", "git-commit-kernel.test.mjs"])
  await visit(join(root, "apps/desktop-app/src/host", name));
const reused = [];
for (const path of [
  ...oldCheck.stdout.matchAll(/Synthetic evidence: ([^\n]+\/report\.json)/gu),
].map((x) => x[1])) {
  const report = JSON.parse(await fs.readFile(path, "utf8"));
  if (!report.ownedSources) continue;
  assert.equal(report.process.exitCode, 0);
  assert.ok(report.evidence.every((x) => x.status === "pass"));
  for (const pin of report.ownedSources)
    assert.equal(hash(await fs.readFile(pin.path)), pin.sha256);
  const binary = report.runtimeBinary,
    expected = binary.sha256 ?? binary.before;
  assert.equal(binary.after ?? expected, expected);
  assert.equal(hash(await fs.readFile(binary.path)), expected);
  reused.push({
    path,
    sha256: hash(await fs.readFile(path)),
    cases: report.evidence.length,
  });
}
assert.equal(reused.length, 2);
assert.equal(
  reused.reduce((n, x) => n + x.cases, 0),
  134,
);
console.log(
  JSON.stringify({
    priorActualNativeReports: reused,
    unchangedRuntimeClosure: [...closure].map((p) => relative(root, p)),
    newExecutionExcludesOnlyTwoVerifiedOldNativeFixtures: true,
  }),
);
const argv = [
  "--test",
  "--test-concurrency=1",
  "--test-reporter=spec",
  "--test-skip-pattern=^(?:manifest-pinned bundled Bun publishes only within owned synthetic namespaces|pinned Bun commit fixtures)$",
  ...[
    "git-metadata-kernel.test.mjs",
    "git-index-kernel.test.mjs",
    "git-commit-kernel.test.mjs",
    "git-branch-restore-kernel.test.mjs",
  ].map((x) => `apps/desktop-app/src/host/${x}`),
];
console.log(JSON.stringify({ newArgv: ["node", ...argv] }));
const result = spawnSync(process.execPath, argv, {
  cwd: root,
  stdio: "inherit",
  timeout: 600000,
});
assert.equal(result.error, undefined);
assert.equal(result.status, 0);
