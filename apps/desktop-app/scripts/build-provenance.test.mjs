import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  captureProvenance,
  snapshotBuildInputs,
  stampPath,
} from "./build-provenance.mjs";
import {
  syntheticRepository,
  syntheticBuild,
  put,
} from "./build-provenance-test-fixture.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-build-provenance-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await syntheticRepository(root);
  return root;
}
const selected = { script: "ui-states" };

test("focused feedback pins only its actual runner and fixture plus unchanged build authority", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-line-feedback.mjs",
    "synthetic feedback runner\n",
  );
  const before = await captureProvenance(root, { script: "feedback" });
  const paths = before.selectedScriptsAndFixtures.files.map((x) => x.path);
  assert.ok(paths.includes("apps/desktop-app/scripts/e2e-line-feedback.mjs"));
  assert.ok(
    paths.includes("apps/desktop-app/scripts/fixtures/workbench-host.mjs"),
  );
  assert.equal(
    paths.includes("apps/desktop-app/scripts/e2e-workbench-states.mjs"),
    false,
  );
  await put(
    root,
    "apps/desktop-app/scripts/e2e-line-feedback.mjs",
    "changed feedback runner\n",
  );
  const after = await captureProvenance(root, { script: "feedback" });
  assert.equal(after.buildStampSha256, before.buildStampSha256);
  assert.notEqual(
    after.selectedScriptsAndFixtures.sha256,
    before.selectedScriptsAndFixtures.sha256,
  );
});

test("stamp inventories source/config/tokens and actual built bytes separately from selected fixtures", async (t) => {
  const root = await fixture(t);
  const provenance = await captureProvenance(root, selected);
  assert.equal(
    provenance.buildStamp.inputs.sha256,
    provenance.currentBuildInputs.sha256,
  );
  for (const path of [
    "pnpm-lock.yaml",
    "apps/desktop-app/index.html",
    "apps/desktop-app/src/main.mjs",
    "apps/desktop-app/src/preload.cjs",
    "apps/desktop-app/src/renderer/app.module.css",
    "packages/ui/src/index.ts",
    "packages/contracts/src/index.ts",
    "docs/design/tokens/tokens.css",
  ]) {
    assert.ok(
      provenance.currentBuildInputs.files.some(
        (file) => file.path === path && /^[0-9a-f]{64}$/.test(file.sha256),
      ),
      path,
    );
  }
  assert.ok(
    provenance.buildStamp.artifacts.files.some((file) =>
      file.path.endsWith("/renderer/assets/app.js"),
    ),
  );
  assert.ok(
    provenance.selectedScriptsAndFixtures.files.some((file) =>
      file.path.endsWith("/fixtures/workbench-host.mjs"),
    ),
  );
  assert.ok(
    !provenance.currentBuildInputs.files.some((file) =>
      file.path.includes("/fixtures/"),
    ),
  );
  assert.equal(
    provenance.currentRelevantSource.buildInputsSha256,
    provenance.currentBuildInputs.sha256,
  );
  assert.notEqual(
    provenance.currentRelevantSource.sha256,
    provenance.currentBuildInputs.sha256,
  );
  assert.match(provenance.buildStamp.limitations.join(" "), /not the harness/);
});

test("lock/config/main/preload/renderer/package/token/asset drift invalidates stamp before capture", async (t) => {
  const root = await fixture(t);
  for (const path of [
    "pnpm-lock.yaml",
    "apps/desktop-app/vite.config.ts",
    "apps/desktop-app/src/main.mjs",
    "apps/desktop-app/src/preload.cjs",
    "apps/desktop-app/src/renderer/app.tsx",
    "packages/ui/package.json",
    "packages/contracts/src/index.ts",
    "docs/design/tokens/tokens.css",
    "apps/desktop-app/public/new.svg",
  ]) {
    await put(root, path, "changed\n");
    await assert.rejects(
      captureProvenance(root, selected),
      /Stale build provenance/,
    );
    await syntheticBuild(root);
  }
  await put(
    root,
    "apps/desktop-app/dist/app/renderer/assets/app.js",
    "altered output\n",
  );
  await assert.rejects(
    captureProvenance(root, selected),
    /Build artifact mismatch/,
  );
});

test("selected fixture edits change capture source identity without silently relabelling the build", async (t) => {
  const root = await fixture(t);
  const before = await captureProvenance(root, selected);
  await put(
    root,
    "apps/desktop-app/scripts/fixtures/workbench-host.mjs",
    "changed fixture\n",
  );
  const after = await captureProvenance(root, selected);
  assert.equal(after.buildStampSha256, before.buildStampSha256);
  assert.notEqual(
    after.selectedScriptsAndFixtures.sha256,
    before.selectedScriptsAndFixtures.sha256,
  );
  assert.notEqual(
    after.currentRelevantSource.sha256,
    before.currentRelevantSource.sha256,
  );
  assert.equal(
    (await captureProvenance(root, { script: "workbench" })).buildStampSha256,
    before.buildStampSha256,
  );
});

test("changed inputs during build leave no stamp; missing stamp refuses validation", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    syntheticBuild(root, () =>
      put(root, "packages/ui/src/index.ts", "changed during build\n"),
    ),
    /inputs changed during build/,
  );
  await assert.rejects(readFile(join(root, stampPath)), /ENOENT/);
  await assert.rejects(captureProvenance(root, selected), /ENOENT/);
});

test("bounded source scope excludes tests, credentials, exports and captures; rejects symlinked inputs", async (t) => {
  const root = await fixture(t);
  const before = await snapshotBuildInputs(root);
  for (const path of [
    ".env",
    "apps/desktop-app/src/.env",
    "apps/desktop-app/src/private.pem",
    "apps/desktop-app/src/credentials/private.json",
    "apps/desktop-app/src/runtime-data/profile.json",
    "apps/desktop-app/src/exports/out.json",
    "apps/desktop-app/src/captures/out.png",
    "apps/desktop-app/src/ignored.test.mjs",
    "docs/runs/capture.png",
  ])
    await put(root, path, "excluded bytes\n");
  assert.equal((await snapshotBuildInputs(root)).sha256, before.sha256);
  await symlink(
    join(root, "packages/ui/src/index.ts"),
    join(root, "apps/desktop-app/src/redirect.ts"),
  );
  await assert.rejects(snapshotBuildInputs(root), /symlink rejected/);
});

test("source traversal enforces a finite depth bound", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    `apps/desktop-app/src/${Array(26).fill("nested").join("/")}/file.ts`,
    "bounded",
  );
  await assert.rejects(snapshotBuildInputs(root), /depth limit/);
});

test(
  "packaged capture binds archive entries and sidecar to stamped outputs before launch",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  async (t) => {
    const root = await fixture(t);
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const require = createRequire(import.meta.url);
    const asarPath = createRequire(
      require.resolve("@electron/packager"),
    ).resolve("@electron/asar");
    const { createPackage } = await import(pathToFileURL(asarPath).href);
    const base = `apps/desktop-app/dist/packages/OhMyOwnCode-${process.platform}-${process.arch}`;
    const packagedApp =
      process.platform === "darwin" ? `${base}/OhMyOwnCode.app` : base;
    const resources = `${packagedApp}/${process.platform === "darwin" ? "Contents/Resources" : "resources"}`;
    const archive = `${resources}/app.asar`;
    const sidecar = `${resources}/opencode/${process.platform}-${process.arch}/${process.platform === "win32" ? "opencode.exe" : "opencode"}`;
    await put(root, archive, "placeholder");
    await put(root, sidecar, "synthetic sidecar\n");
    await put(
      root,
      `${packagedApp}/${process.platform === "darwin" ? "Contents/MacOS/OhMyOwnCode" : "OhMyOwnCode.exe"}`,
      "synthetic executable\n",
    );
    await cp(
      join(root, "apps/desktop-app/dist/resources/opencode/event-host"),
      join(root, resources, "opencode/event-host"),
      { recursive: true, verbatimSymlinks: true },
    );
    await cp(
      join(root, "apps/desktop-app/dist/resources/owner-lifetime"),
      join(root, resources, "owner-lifetime"),
      { recursive: true },
    );
    await cp(
      join(root, "apps/desktop-app/dist/resources/node-pty"),
      join(root, resources, "node-pty"),
      { recursive: true },
    );
    await createPackage(
      join(root, "apps/desktop-app/dist/app"),
      join(root, archive),
    );
    const selection = {
      script: "smoke",
      mode: "packaged",
      platform: process.platform,
    };
    const good = await captureProvenance(root, selection);
    assert.equal(good.launchArtifacts.files.length, 3);
    assert.ok(
      good.launchArtifacts.files.some(
        (file) => file.path === archive && /^[0-9a-f]{64}$/.test(file.sha256),
      ),
    );
    assert.ok(good.launchArtifacts.eventHostResources.entryCount > 0);
    await put(
      root,
      `${resources}/opencode/event-host/darwin-arm64/host.mjs`,
      "packaged host tamper\n",
    );
    await assert.rejects(captureProvenance(root, selection), /drift/);
    await cp(
      join(root, "apps/desktop-app/dist/resources/opencode/event-host"),
      join(root, resources, "opencode/event-host"),
      { recursive: true, verbatimSymlinks: true },
    );
    await put(root, `${resources}/node-pty/lib/index.js`, "tampered pty\n");
    await assert.rejects(
      captureProvenance(root, selection),
      /node-pty does not match/,
    );
    await put(
      root,
      `${resources}/node-pty/lib/index.js`,
      "synthetic node-pty\n",
    );
    await put(root, sidecar, "wrong sidecar\n");
    await assert.rejects(
      captureProvenance(root, selection),
      /sidecar does not match/,
    );
    await put(root, sidecar, "synthetic sidecar\n");
    // Build a stale archive from another bounded app tree, preserving the stamped dist tree.
    await put(root, "stale-app/main.mjs", "stale archive\n");
    await createPackage(join(root, "stale-app"), join(root, archive));
    await assert.rejects(
      captureProvenance(root, selection),
      /archive does not match/,
    );
  },
);

test("event-host bytes and declared link are part of launch identity; old4096 app bound stays fixed", async (t) => {
  const root = await fixture(t);
  const before = await captureProvenance(root, selected);
  assert.equal(before.buildStamp.artifacts.limits.files, 4096);
  assert.equal(
    Object.hasOwn(before.launchArtifacts.eventHostResources, "manifest"),
    false,
  );
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(before.launchArtifacts.eventHostResources),
    ) < 1024,
  );
  assert.equal(
    before.launchArtifacts.eventHostResources.sha256,
    before.buildStamp.eventHostResources.sha256,
  );
  assert.ok(before.launchArtifacts.eventHostResources.symlinkCount > 0);
  await put(
    root,
    "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/tool/bin/tool.js",
    "asset tamper\n",
  );
  await assert.rejects(captureProvenance(root, selected), /drift/);
});
test("a valid replacement lifetime helper still fails stamped launch identity", async (t) => {
  const root = await fixture(t);
  const before = await captureProvenance(root, selected);
  assert.equal(
    before.launchArtifacts.ownerLifetimeResources.sha256,
    before.buildStamp.ownerLifetimeResources.sha256,
  );
  const relativeRoot =
    "apps/desktop-app/dist/resources/owner-lifetime/darwin-arm64";
  const executable = await readFile(join(root, relativeRoot, "witness"));
  executable[63] = 1;
  const manifest = JSON.parse(
    await readFile(join(root, relativeRoot, "manifest.json"), "utf8"),
  );
  manifest.executableSha256 = createHash("sha256")
    .update(executable)
    .digest("hex");
  await put(root, `${relativeRoot}/witness`, executable);
  await put(
    root,
    `${relativeRoot}/manifest.json`,
    `${JSON.stringify(manifest)}\n`,
  );
  await assert.rejects(
    captureProvenance(root, selected),
    /Owner-lifetime resource artifact mismatch/,
  );
});

test("resource lock and preparation scripts invalidate build source binding", async (t) => {
  const root = await fixture(t);
  for (const path of [
    "runtime-event-host/package-lock.json",
    "runtime-event-host/installer-pins.json",
    "scripts/prepare-event-host.mjs",
    "scripts/stage-event-host.mjs",
    "scripts/stage-owner-lifetime.mjs",
    "native/owner-lifetime/witness.c",
  ]) {
    await put(root, `apps/desktop-app/${path}`, "changed input\n");
    await assert.rejects(
      captureProvenance(root, selected),
      /Stale build provenance/,
    );
    await syntheticBuild(root);
  }
});

test("explicit commit pins only its actual runner and fixture plus unchanged build authority", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-git-commit.mjs",
    "synthetic git-commit runner\n",
  );
  await put(
    root,
    "apps/desktop-app/scripts/git-commit-probe.mjs",
    "synthetic commit probe\n",
  );
  const before = await captureProvenance(root, { script: "git-commit" });
  const paths = before.selectedScriptsAndFixtures.files.map((x) => x.path);
  assert.ok(paths.includes("apps/desktop-app/scripts/e2e-git-commit.mjs"));
  assert.ok(
    paths.includes("apps/desktop-app/scripts/fixtures/workbench-host.mjs"),
  );
  assert.equal(
    paths.includes("apps/desktop-app/scripts/e2e-workbench-states.mjs"),
    false,
  );
  await put(
    root,
    "apps/desktop-app/scripts/e2e-git-commit.mjs",
    "changed git-commit runner\n",
  );
  const after = await captureProvenance(root, { script: "git-commit" });
  assert.equal(after.buildStampSha256, before.buildStampSha256);
  assert.notEqual(
    after.selectedScriptsAndFixtures.sha256,
    before.selectedScriptsAndFixtures.sha256,
  );
});

test("branch restore pins only its actual runner and fixture plus unchanged build authority", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-git-branch-restore.mjs",
    "synthetic git-branch-restore runner\n",
  );
  await put(
    root,
    "apps/desktop-app/scripts/git-branch-restore-probe.mjs",
    "synthetic branch restore probe\n",
  );
  const before = await captureProvenance(root, {
    script: "git-branch-restore",
  });
  const paths = before.selectedScriptsAndFixtures.files.map((x) => x.path);
  assert.ok(
    paths.includes("apps/desktop-app/scripts/e2e-git-branch-restore.mjs"),
  );
  assert.ok(
    paths.includes("apps/desktop-app/scripts/fixtures/workbench-host.mjs"),
  );
  assert.equal(
    paths.includes("apps/desktop-app/scripts/e2e-workbench-states.mjs"),
    false,
  );
  await put(
    root,
    "apps/desktop-app/scripts/e2e-git-branch-restore.mjs",
    "changed git-branch-restore runner\n",
  );
  const after = await captureProvenance(root, { script: "git-branch-restore" });
  assert.equal(after.buildStampSha256, before.buildStampSha256);
  assert.notEqual(
    after.selectedScriptsAndFixtures.sha256,
    before.selectedScriptsAndFixtures.sha256,
  );
});

test("conversation context pins its focused runner and fixture without unrelated UI families", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "apps/desktop-app/scripts/e2e-conversation-context.mjs",
    "synthetic context runner\n",
  );
  const before = await captureProvenance(root, {
    script: "conversation-context",
  });
  const paths = before.selectedScriptsAndFixtures.files.map((x) => x.path);
  assert.ok(
    paths.includes("apps/desktop-app/scripts/e2e-conversation-context.mjs"),
  );
  assert.ok(
    paths.includes("apps/desktop-app/scripts/fixtures/workbench-host.mjs"),
  );
  assert.equal(
    paths.includes("apps/desktop-app/scripts/e2e-workbench-states.mjs"),
    false,
  );
  await put(
    root,
    "apps/desktop-app/scripts/e2e-conversation-context.mjs",
    "changed context runner\n",
  );
  const after = await captureProvenance(root, {
    script: "conversation-context",
  });
  assert.equal(after.buildStampSha256, before.buildStampSha256);
  assert.notEqual(
    after.selectedScriptsAndFixtures.sha256,
    before.selectedScriptsAndFixtures.sha256,
  );
});
