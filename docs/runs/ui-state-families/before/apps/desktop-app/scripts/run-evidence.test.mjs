import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseArgs,
  prepareDestination,
  runEvidence,
  evidenceRootForOutput,
} from "./run-evidence.mjs";
import { syntheticRepository, put } from "./build-provenance-test-fixture.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-evidence-unit-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await syntheticRepository(root);
  return root;
}

test("CLI rejects missing, duplicate, unknown and inappropriate selectors", () => {
  for (const argv of [
    [],
    ["--out", "x"],
    ["--out", "x", "--script", "other"],
    ["--out", "x", "--script", "sessions", "--mode", "dev"],
    ["--out", "x", "--script", "smoke", "--platform", "linux"],
    ["--out", "x", "--out", "y", "--script", "sessions"],
    ["--out", "x", "--script", "smoke", "--mode", "no"],
    ["--out", "x", "--script", "sessions", "--bogus", "x"],
  ]) {
    assert.throws(() => parseArgs(argv));
  }
  assert.deepEqual(parseArgs(["--out", "x", "--script", "smoke"], "darwin"), {
    out: "x",
    script: "smoke",
    mode: "dev",
    platform: "darwin",
  });
});

test("focused feedback is fixed allowlisted evidence, never an arbitrary script", () => {
  assert.deepEqual(parseArgs(["--out", "x", "--script", "feedback"]), {
    out: "x",
    script: "feedback",
  });
  assert.throws(() =>
    parseArgs(["--out", "x", "--script", "feedback", "--mode", "dev"]),
  );
  assert.throws(() => parseArgs(["--out", "x", "--script", "../feedback"]));
});

test("focused feedback requires owned exit and hidden capture proof", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-line-feedback.mjs",
    "synthetic feedback runner\n",
  );
  const capture = {
    state: "synthetic validation only",
    pixelDimensions: { width: 1, height: 1 },
    contentBounds: { width: 1, height: 1 },
    viewport: { width: 1, height: 1, pixelRatio: 1 },
    displayScaleFactor: 1,
    zoomFactor: 1,
    beforeCapture: { visible: false, focused: false, focusable: false },
    osWindowVisible: false,
    osWindowFocused: false,
    osWindowFocusable: false,
    captureMethod: "BrowserWindow.webContents.capturePage().toPNG()",
  };
  const cases = [
    ["good", { exited: true, code: 0 }, capture, 0],
    ["unproved-exit", { exited: false, code: 0 }, capture, 1],
    ["failed-exit", { exited: true, code: 1 }, capture, 1],
    [
      "visible",
      { exited: true, code: 0 },
      { ...capture, osWindowVisible: true },
      1,
    ],
    [
      "focused",
      { exited: true, code: 0 },
      {
        ...capture,
        beforeCapture: { ...capture.beforeCapture, focused: true },
      },
      1,
    ],
    [
      "wrong-dimensions",
      { exited: true, code: 0 },
      { ...capture, pixelDimensions: { width: 2, height: 1 } },
      1,
    ],
  ];
  for (const [name, teardown, frame, expected] of cases) {
    const report = { result: "pass", teardown, screenshots: [frame] };
    const code = `const fs=require('node:fs'),path=require('node:path');const dir=process.env.OMOC_EVIDENCE_DIR,png=path.join(dir,'capture.png');fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cYkAAAAASUVORK5CYII=','base64'));const report=${JSON.stringify(report)};report.screenshots[0].path=png;fs.writeFileSync(path.join(dir,'line-feedback-evidence.json'),JSON.stringify(report));`;
    const result = await runEvidence(
      { out: join(root, name), script: "feedback" },
      {
        runRoot: root,
        repoRoot: root,
        spawnChild: helper(code, (_exe, argv, options) => {
          assert.ok(argv[0].endsWith("/e2e-line-feedback.mjs"));
          assert.equal(options.shell, false);
        }),
      },
    );
    assert.equal(result.exitCode, expected, name);
    if (expected === 0)
      assert.equal(result.manifest.provenanceVerifiedAfter, true);
  }
});

test("destination confines output, rejects symlinks and preserves existing evidence", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    prepareDestination(root, join(root, "..", "escape"), "sessions"),
    /under/,
  );
  await assert.rejects(prepareDestination(root, root, "sessions"), /under/);
  await symlink(root, join(root, "alias"), "dir");
  await assert.rejects(
    prepareDestination(root, join(root, "alias", "attempt"), "sessions"),
    /symlink/,
  );
  const out = join(root, "attempt");
  await mkdir(join(out, "sessions"), { recursive: true });
  await writeFile(join(out, "sessions", "previous.txt"), "retain");
  await assert.rejects(prepareDestination(root, out, "sessions"), /nonempty/);
  assert.equal(
    await readFile(join(out, "sessions", "previous.txt"), "utf8"),
    "retain",
  );
  await mkdir(join(root, "empty", "sessions"), { recursive: true });
  await prepareDestination(root, join(root, "empty"), "sessions");
  await assert.rejects(
    prepareDestination(root, join(root, "empty"), "sessions"),
    /nonempty/,
  );
});

function helper(code, inspect = () => {}) {
  return (executable, argv, options) => {
    inspect(executable, argv, options);
    return spawn(executable, ["-e", code], options);
  };
}

test("smoke preserves logs and overrides ambient output with shell disabled", async (t) => {
  const root = await fixture(t);
  const result = await runEvidence(
    {
      out: join(root, "attempt"),
      script: "smoke",
      mode: "dev",
      platform: "darwin",
    },
    {
      runRoot: root,
      repoRoot: root,
      env: { OMOC_EVIDENCE_DIR: "/old" },
      spawnChild: helper(
        'console.log(process.env.OMOC_EVIDENCE_DIR); console.error("diagnostic")',
        (exe, argv, options) => {
          assert.equal(exe, process.execPath);
          assert.equal(options.shell, false);
          assert.equal(
            options.env.OMOC_EVIDENCE_DIR,
            join(root, "attempt", "smoke-dev-darwin"),
          );
          assert.deepEqual(argv.slice(1), ["dev", "darwin"]);
        },
      ),
    },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.manifest.status, "pass");
  assert.match(
    await readFile(join(result.destination, "stderr.log"), "utf8"),
    /diagnostic/,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(result.destination, "manifest.json"), "utf8"),
    ).status,
    "pass",
  );
});

test("nonzero, signal and spawn errors are recorded and propagated", async (t) => {
  const root = await fixture(t);
  for (const [name, code, expected] of [
    ["failure", 'console.error("failed"); process.exit(7)', 7],
    ["signal", 'process.kill(process.pid, "SIGTERM")', 143],
  ]) {
    const result = await runEvidence(
      { out: join(root, name), script: "sessions" },
      { runRoot: root, repoRoot: root, spawnChild: helper(code) },
    );
    assert.equal(result.exitCode, expected);
    assert.equal(result.manifest.status, "fail");
    if (name === "signal") assert.equal(result.manifest.signal, "SIGTERM");
  }
  const result = await runEvidence(
    { out: join(root, "spawn-error"), script: "sessions" },
    {
      runRoot: root,
      repoRoot: root,
      spawnChild: (_exe, argv, options) =>
        spawn(join(root, "missing-executable"), argv, options),
    },
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.manifest.error, /ENOENT/);
});

test("successful child requires fresh passing report and valid captures", async (t) => {
  const root = await fixture(t);
  const options = {
    runRoot: root,
    repoRoot: root,
    spawnChild: helper('console.log("done")'),
  };
  const missing = await runEvidence(
    { out: join(root, "missing"), script: "sessions" },
    options,
  );
  assert.equal(missing.exitCode, 1);
  assert.match(missing.manifest.error, /ENOENT/);
  const validCode = `const fs = require('node:fs'); const path = require('node:path'); const dir = process.env.OMOC_EVIDENCE_DIR; const png = path.join(dir,'capture.png'); fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a00000000','hex')); fs.writeFileSync(path.join(dir,'session-lifecycle-evidence.json'),JSON.stringify({result:'pass',screenshots:[png]}));`;
  const good = await runEvidence(
    { out: join(root, "valid"), script: "sessions" },
    { runRoot: root, repoRoot: root, spawnChild: helper(validCode) },
  );
  assert.equal(good.exitCode, 0);
  const escaped = await runEvidence(
    { out: join(root, "escaped"), script: "sessions" },
    {
      runRoot: root,
      repoRoot: root,
      spawnChild: helper(
        validCode.replace(
          "screenshots:[png]",
          "screenshots:['/outside/capture.png']",
        ),
      ),
    },
  );
  assert.equal(escaped.exitCode, 1);
  assert.match(escaped.manifest.error, /under/);
});

test("ui-states and workbench validate their own report and capture formats", async (t) => {
  const root = await fixture(t);
  for (const [script, reportName, screenshots] of [
    ["ui-states", "ui-states-evidence.json", "[{path:png,state:'fixture'}]"],
    ["workbench", "electron-evidence.json", "[png]"],
  ]) {
    const code = `const fs = require('node:fs'); const path = require('node:path'); const dir = process.env.OMOC_EVIDENCE_DIR; const png = path.join(dir,'capture.png'); fs.writeFileSync(png,Buffer.from('89504e470d0a1a0a00000000','hex')); fs.writeFileSync(path.join(dir,'${reportName}'),JSON.stringify({result:'pass',screenshots:${screenshots}}));`;
    const good = await runEvidence(
      { out: join(root, script), script },
      { runRoot: root, repoRoot: root, spawnChild: helper(code) },
    );
    assert.equal(good.exitCode, 0);
    assert.deepEqual(good.manifest.evidence, [reportName, "capture.png"]);
    const failedReport = await runEvidence(
      { out: join(root, `${script}-failed-report`), script },
      {
        runRoot: root,
        repoRoot: root,
        spawnChild: helper(code.replace("result:'pass'", "result:'fail'")),
      },
    );
    assert.equal(failedReport.exitCode, 1);
    assert.match(failedReport.manifest.error, /must pass/);
  }
});

test("captures cannot be redirected through symlinks or replaced by arbitrary bytes", async (t) => {
  const root = await fixture(t);
  const code = `const fs = require('node:fs'); const path = require('node:path'); const dir = process.env.OMOC_EVIDENCE_DIR; const png = path.join(dir,'capture.png'); fs.writeFileSync(png,'not an actual PNG'); fs.writeFileSync(path.join(dir,'session-lifecycle-evidence.json'),JSON.stringify({result:'pass',screenshots:[png]}));`;
  const invalid = await runEvidence(
    { out: join(root, "invalid-png"), script: "sessions" },
    { runRoot: root, repoRoot: root, spawnChild: helper(code) },
  );
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.manifest.error, /not a PNG/);
  const redirected = await runEvidence(
    { out: join(root, "redirected-capture"), script: "sessions" },
    {
      runRoot: root,
      repoRoot: root,
      spawnChild: helper(
        code.replace(
          "fs.writeFileSync(png,'not an actual PNG')",
          "fs.symlinkSync(path.join(dir,'stdout.log'),png)",
        ),
      ),
    },
  );
  assert.equal(redirected.exitCode, 1);
  assert.match(redirected.manifest.error, /symlink/);
  const silent = await runEvidence(
    {
      out: join(root, "silent-smoke"),
      script: "smoke",
      mode: "dev",
      platform: "darwin",
    },
    { runRoot: root, repoRoot: root, spawnChild: helper("") },
  );
  assert.equal(silent.exitCode, 1);
  assert.match(silent.manifest.error, /no stdout evidence/);
});

test("exported manifest contains self-contained immutable pre-launch build/source/script/fixture inventories", async (t) => {
  const root = await fixture(t);
  const result = await runEvidence(
    {
      out: join(root, "provenance"),
      script: "smoke",
      mode: "dev",
      platform: "darwin",
    },
    {
      runRoot: root,
      repoRoot: root,
      spawnChild: helper('console.log("synthetic evidence")'),
    },
  );
  const persisted = JSON.parse(
    await readFile(join(result.destination, "manifest.json"), "utf8"),
  );
  assert.deepEqual(persisted.provenance, result.manifest.provenance);
  assert.equal(persisted.provenanceVerifiedAfter, true);
  assert.equal(
    persisted.provenance.buildStamp.inputs.sha256,
    persisted.provenance.currentBuildInputs.sha256,
  );
  assert.match(persisted.provenance.buildStampSha256, /^[0-9a-f]{64}$/);
  assert.ok(
    persisted.provenance.buildStamp.artifacts.files.some((file) =>
      file.path.endsWith("/main.mjs"),
    ),
  );
  assert.ok(
    persisted.provenance.selectedScriptsAndFixtures.files.some((file) =>
      file.path.endsWith("/e2e-smoke.mjs"),
    ),
  );
});

test("missing stamp, changed source/output and missing selected fixture fail without spawning", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "missing-stamp",
      (root) => rm(join(root, "apps/desktop-app/dist/build-provenance.json")),
      /ENOENT/,
    ],
    [
      "changed-source",
      (root) =>
        put(root, "apps/desktop-app/src/renderer/app.tsx", "new source"),
      /Stale build provenance/,
    ],
    [
      "changed-artifact",
      (root) =>
        put(root, "apps/desktop-app/dist/app/preload.cjs", "new artifact"),
      /Build artifact mismatch/,
    ],
    [
      "missing-fixture",
      (root) =>
        rm(join(root, "apps/desktop-app/scripts/fixtures/workbench-host.mjs")),
      /ENOENT/,
    ],
  ]) {
    const root = await fixture(t);
    await mutate(root);
    let launched = false;
    const result = await runEvidence(
      { out: join(root, name), script: "ui-states" },
      {
        runRoot: root,
        repoRoot: root,
        spawnChild: () => {
          launched = true;
          throw new Error("must never launch");
        },
      },
    );
    assert.equal(launched, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.status, "fail");
    assert.equal(result.manifest.exitCode, null);
    assert.equal(result.manifest.provenanceVerifiedAfter, false);
    assert.match(result.manifest.error, expected);
    assert.equal(
      JSON.parse(
        await readFile(join(result.destination, "manifest.json"), "utf8"),
      ).status,
      "fail",
    );
  }
});

test("selected fixture/script and build artifacts changing during a child run cannot pass", async (t) => {
  for (const [name, path] of [
    ["fixture-drift", "apps/desktop-app/scripts/fixtures/workbench-host.mjs"],
    ["script-drift", "apps/desktop-app/scripts/e2e-workbench-states.mjs"],
    ["artifact-drift", "apps/desktop-app/dist/app/main.mjs"],
  ]) {
    const root = await fixture(t);
    const original = await readFile(join(root, path));
    const code = `require('node:fs').writeFileSync(${JSON.stringify(join(root, path))},'changed during child'); console.log('synthetic capture');`;
    const result = await runEvidence(
      { out: join(root, name), script: "ui-states" },
      { runRoot: root, repoRoot: root, spawnChild: helper(code) },
    );
    assert.equal(result.manifest.exitCode, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.status, "fail");
    assert.equal(result.manifest.provenanceVerifiedAfter, false);
    assert.match(result.manifest.error, /provenance changed|artifact mismatch/);
    const files =
      name === "artifact-drift"
        ? result.manifest.provenance.buildStamp.artifacts.files
        : result.manifest.provenance.selectedScriptsAndFixtures.files;
    const recorded = files.find((file) => file.path === path);
    assert.equal(
      recorded.size,
      original.length,
      "pre-launch identity retained despite drift",
    );
  }
});

for (const run of [
  "event-host-app-integration",
  "durable-workbench-storage",
  "configuration-provenance",
  "configuration-drafts",
  "configuration-files",
  "configuration-save",
  "configuration-instructions",
  "configuration-mcp",
  "configuration-agents",
  "configuration-extensions",
  "workspace-file-editing",
  "git-review-observation",
  "version-bound-line-feedback",
]) {
  test(`${run} evidence root stays closed and exclusively claimed`, async (t) => {
    const root = await fixture(t);
    const base = join(root, "docs/runs", run, "evidence");
    await mkdir(base, { recursive: true });
    const out = join(base, "hidden-ui-r1");
    assert.equal(evidenceRootForOutput(root, out), base);
    assert.throws(
      () => evidenceRootForOutput(root, join(root, "docs/runs", run, "design")),
      /registered/,
    );
    assert.throws(() => evidenceRootForOutput(root, base), /registered/);
    const destination = await prepareDestination(base, out, "ui-states");
    await assert.rejects(
      prepareDestination(base, out, "ui-states"),
      /nonempty/,
    );
    await writeFile(join(destination, "retained.txt"), "preserve");
    await assert.rejects(
      prepareDestination(base, out, "ui-states"),
      /nonempty/,
    );
    assert.equal(
      await readFile(join(destination, "retained.txt"), "utf8"),
      "preserve",
    );
    await symlink(base, join(base, "redirect"), "dir");
    await assert.rejects(
      prepareDestination(base, join(base, "redirect/attempt"), "ui-states"),
      /symlink/,
    );
  });
}

test("focused Git index evidence uses a fixed selector and its registered run root", () => {
  assert.deepEqual(parseArgs(["--out", "x", "--script", "git-index"]), {
    out: "x",
    script: "git-index",
  });
  assert.throws(() =>
    parseArgs(["--out", "x", "--script", "git-index", "--mode", "dev"]),
  );
  assert.throws(() => parseArgs(["--out", "x", "--script", "../git-index"]));
});

test("Explicit commit evidence is a fixed selector under its registered run root", () => {
  assert.deepEqual(parseArgs(["--out", "x", "--script", "git-commit"]), {
    out: "x",
    script: "git-commit",
  });
  assert.throws(() =>
    parseArgs(["--out", "x", "--script", "git-commit", "--mode", "dev"]),
  );
  assert.throws(() => parseArgs(["--out", "x", "--script", "../git-commit"]));
});

test("branch restore evidence selector stays closed and refuses smoke-only mode", () => {
  assert.deepEqual(
    parseArgs(["--out", "x", "--script", "git-branch-restore"]),
    { out: "x", script: "git-branch-restore" },
  );
  assert.throws(() =>
    parseArgs([
      "--out",
      "x",
      "--script",
      "git-branch-restore",
      "--mode",
      "dev",
    ]),
  );
  assert.throws(() =>
    parseArgs(["--out", "x", "--script", "../git-branch-restore"]),
  );
});

test("conversation Markdown requires owned exit and hidden full capture proof", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-conversation-markdown.mjs",
    "synthetic feedback runner\n",
  );
  const capture = {
    state: "synthetic validation only",
    pixelDimensions: { width: 1, height: 1 },
    contentBounds: { width: 1, height: 1 },
    viewport: { width: 1, height: 1, pixelRatio: 1 },
    displayScaleFactor: 1,
    zoomFactor: 1,
    beforeCapture: { visible: false, focused: false, focusable: false },
    osWindowVisible: false,
    osWindowFocused: false,
    osWindowFocusable: false,
    captureMethod: "BrowserWindow.webContents.capturePage().toPNG()",
  };
  const cases = [
    ["good", { exited: true, code: 0 }, capture, 0],
    ["unproved-exit", { exited: false, code: 0 }, capture, 1],
    ["failed-exit", { exited: true, code: 1 }, capture, 1],
    [
      "visible",
      { exited: true, code: 0 },
      { ...capture, osWindowVisible: true },
      1,
    ],
    [
      "focused",
      { exited: true, code: 0 },
      {
        ...capture,
        beforeCapture: { ...capture.beforeCapture, focused: true },
      },
      1,
    ],
    [
      "wrong-dimensions",
      { exited: true, code: 0 },
      { ...capture, pixelDimensions: { width: 2, height: 1 } },
      1,
    ],
  ];
  for (const [name, teardown, frame, expected] of cases) {
    const report = { result: "pass", teardown, screenshots: [frame] };
    const code = `const fs=require('node:fs'),path=require('node:path');const dir=process.env.OMOC_EVIDENCE_DIR,png=path.join(dir,'capture.png');fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cYkAAAAASUVORK5CYII=','base64'));const report=${JSON.stringify(report)};report.screenshots[0].path=png;fs.writeFileSync(path.join(dir,'conversation-markdown-evidence.json'),JSON.stringify(report));`;
    const result = await runEvidence(
      { out: join(root, name), script: "conversation-markdown" },
      {
        runRoot: root,
        repoRoot: root,
        spawnChild: helper(code, (_exe, argv, options) => {
          assert.ok(argv[0].endsWith("/e2e-conversation-markdown.mjs"));
          assert.equal(options.shell, false);
        }),
      },
    );
    assert.equal(result.exitCode, expected, name);
    if (expected === 0)
      assert.equal(result.manifest.provenanceVerifiedAfter, true);
  }
});
