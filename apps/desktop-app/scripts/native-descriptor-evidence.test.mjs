import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DESCRIPTOR_EVIDENCE_SOURCES,
  validateDescriptorEvidence,
  verifyDescriptorEvidence,
} from "./native-descriptor-evidence.mjs";

const engine =
  "35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5";
function synthetic() {
  const root = "/synthetic/evidence",
    projectRoot = "/synthetic/project";
  const sourceHashes = Object.fromEntries(
    DESCRIPTOR_EVIDENCE_SOURCES.map((path) => [
      path,
      createHash("sha256").update(path).digest("hex"),
    ]),
  );
  const input = {
    schemaVersion: 1,
    kind: "owned-descriptor-kernel-probe",
    root,
    nonce: "synthetic-nonce",
    engineSha256: engine,
    sourceHashes,
    argv: [
      join(root, "bun"),
      "--no-install",
      "--no-env-file",
      join(projectRoot, DESCRIPTOR_EVIDENCE_SOURCES[0]),
      "--fixture",
      root,
    ],
    environment: {
      PATH: "/usr/bin:/bin",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
      OMOC_DESCRIPTOR_PROBE_NONCE: "synthetic-nonce",
    },
    timeoutMs: 30000,
    limits: "Synthetic parser fixture, not physical evidence.",
  };
  const fixture = {
    passed: true,
    bunVersion: "1.4.2",
    cases: Array.from({ length: 11 }, (_, i) => ({
      name: `synthetic-${i}`,
      passed: true,
      descriptorsReturnedToBaseline: true,
      ownerDescriptors: 1,
      baselineFDs: 4,
      finalFDs: 4,
    })),
    limits: input.limits,
  };
  return {
    input,
    fixture,
    execution: {
      passed: true,
      pid: 1,
      exitCode: 0,
      signal: null,
      sourceStable: true,
      engineStable: true,
      result: globalThis.structuredClone(fixture),
      namespaceRetained: root,
    },
    intent: {
      inputSha256: "a".repeat(64),
      sourceHashes: globalThis.structuredClone(sourceHashes),
      engineSha256: engine,
      argv: [...input.argv],
    },
    marker: { root, nonce: input.nonce },
    projectRoot,
    root,
    currentSources: globalThis.structuredClone(sourceHashes),
    currentEngine: engine,
  };
}

test("synthetic parser fixture validates reuse without claiming a new execution", () => {
  const result = validateDescriptorEvidence(synthetic());
  assert.equal(result.passed, true);
  assert.equal(result.executedProbe, false);
  assert.equal(result.reusedPhysicalEvidence, true);
  assert.equal(result.cases, 11);
  assert.equal(result.sourceFiles, 8);
  assert.equal(Object.isFrozen(result), true);
});

for (const [name, alter] of [
  [
    "missing source",
    (v) => delete v.currentSources[DESCRIPTOR_EVIDENCE_SOURCES[0]],
  ],
  [
    "changed source",
    (v) => (v.currentSources[DESCRIPTOR_EVIDENCE_SOURCES[2]] = "f".repeat(64)),
  ],
  [
    "extra source",
    (v) => (v.input.sourceHashes["private.env"] = "a".repeat(64)),
  ],
  ["different engine", (v) => (v.currentEngine = "f".repeat(64))],
  ["changed argv", (v) => (v.input.argv[1] = "--install")],
  ["outside environment", (v) => (v.input.environment.HOME = "/outside")],
  ["foreign marker", (v) => (v.marker.nonce = "foreign")],
  [
    "different intent",
    (v) =>
      (v.intent.sourceHashes[DESCRIPTOR_EVIDENCE_SOURCES[1]] = "f".repeat(64)),
  ],
  ["failed child", (v) => (v.execution.exitCode = 1)],
  ["child signal", (v) => (v.execution.signal = "SIGKILL")],
  ["child spawn error", (v) => (v.execution.errorCode = "EIO")],
  ["unproved source stability", (v) => (v.execution.sourceStable = false)],
  ["unproved engine stability", (v) => (v.execution.engineStable = false)],
  ["foreign namespace", (v) => (v.execution.namespaceRetained = "/outside")],
  ["changed result", (v) => (v.execution.result.cases[0].passed = false)],
  [
    "missing case",
    (v) => {
      v.fixture.cases.pop();
      v.execution.result = globalThis.structuredClone(v.fixture);
    },
  ],
  [
    "failed case",
    (v) => {
      v.fixture.cases[1].passed = false;
      v.execution.result = globalThis.structuredClone(v.fixture);
    },
  ],
  [
    "duplicate case",
    (v) => {
      v.fixture.cases[1].name = v.fixture.cases[0].name;
      v.execution.result = globalThis.structuredClone(v.fixture);
    },
  ],
  [
    "FD leak",
    (v) => {
      v.fixture.cases[2].finalFDs = 5;
      v.execution.result = globalThis.structuredClone(v.fixture);
    },
  ],
])
  test(`synthetic evidence refuses ${name}`, () => {
    const value = synthetic();
    alter(value);
    assert.throws(() => validateDescriptorEvidence(value));
  });

test("read-only verifier refuses artifact hash mismatch before reading source or engine", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "omoc-descriptor-evidence-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonical = fs.realpathSync(root);
  await writeFile(
    join(canonical, "input.json"),
    JSON.stringify(synthetic().input),
  );
  assert.throws(
    () =>
      verifyDescriptorEvidence({
        projectRoot: canonical,
        root: canonical,
        inputSha256: "f".repeat(64),
        executionSha256: "a".repeat(64),
        fixtureSha256: "a".repeat(64),
      }),
    /input/u,
  );
});

test("read-only verifier refuses a symlink artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "omoc-descriptor-evidence-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonical = fs.realpathSync(root),
    target = join(canonical, "target.json");
  await writeFile(target, "{}");
  fs.symlinkSync(target, join(canonical, "input.json"));
  assert.throws(
    () =>
      verifyDescriptorEvidence({
        projectRoot: canonical,
        root: canonical,
        inputSha256: "a".repeat(64),
        executionSha256: "a".repeat(64),
        fixtureSha256: "a".repeat(64),
      }),
    (error) => error.code === "ELOOP",
  );
});
