// Local byte identities, deliberately distinct from the run harness fingerprint.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertRealResourceParents,
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
  eventHostInventorySha256,
} from "../src/event-host-resources.mjs";
import {
  ownerLifetimeForResources,
  verifyOwnerLifetimeResources,
} from "../src/owner-lifetime-resources.mjs";
import { nodePtySupported } from "./stage-node-pty.mjs";

const app = "apps/desktop-app";
export const stampPath = `${app}/dist/build-provenance.json`;
const algorithm = "scoped-file-inventory-sha256-v1";
const limits = { files: 4096, depth: 24, bytes: 1024 * 1024 * 1024 };
// Full resource manifest remains a separate file; retain the original4MiB stamp bound.
const stampByteLimit = 4 * 1024 * 1024;
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "exports",
  "captures",
  "credentials",
  "runtime-data",
]);
const sourceExtension =
  /\.(?:c|[cm]?js|[cm]?ts|jsx|tsx|css|html|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)$/;
const sourceScopes = [
  ...[
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "nx.json",
  ].map((path) => ({ path })),
  ...[
    "package.json",
    "project.json",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "scripts/build.mjs",
    "scripts/build-provenance.mjs",
    "scripts/prepare-event-host.mjs",
    "scripts/stage-event-host.mjs",
    "scripts/stage-owner-lifetime.mjs",
    "scripts/stage-node-pty.mjs",
    "native/owner-lifetime/witness.c",
    "scripts/package.mjs",
    "runtime-event-host/package.json",
    "runtime-event-host/package-lock.json",
    "runtime-event-host/installer-pins.json",
    "runtime-event-host/installer-pins.win32-x64.json",
    "scripts/fetch-sidecar.mjs",
    "scripts/verify-package-layout.mjs",
  ].map((path) => ({ path: `${app}/${path}` })),
  { path: `${app}/src`, tree: true, source: true },
  { path: `${app}/public`, tree: true, source: true, optional: true },
  ...["ui", "contracts"].flatMap((name) => [
    ...["package.json", "project.json", "tsconfig.json"].map((path) => ({
      path: `packages/${name}/${path}`,
    })),
    { path: `packages/${name}/src`, tree: true, source: true },
  ]),
  { path: "packages/contracts/tsconfig.build.json" },
  { path: "docs/design/tokens", tree: true, source: true },
];
const selectedPaths = {
  "design-foundation": [
    "e2e-design-foundation.mjs",
    "e2e-workbench-states.mjs",
    "fixtures/workbench-host.mjs",
  ],
  "conversation-context": [
    "e2e-conversation-context.mjs",
    "fixtures/workbench-host.mjs",
  ],
  "runtime-options": ["e2e-runtime-options.mjs", "fixtures/workbench-host.mjs"],
  "conversation-markdown": [
    "e2e-conversation-markdown.mjs",
    "fixtures/workbench-host.mjs",
  ],
  sessions: ["e2e-session-lifecycle.mjs", "fixtures/session-history-probe.mjs"],
  "ui-states": ["e2e-workbench-states.mjs", "fixtures/workbench-host.mjs"],
  feedback: ["e2e-line-feedback.mjs", "fixtures/workbench-host.mjs"],
  "git-branch-restore": [
    "e2e-git-branch-restore.mjs",
    "fixtures/workbench-host.mjs",
    "git-branch-restore-probe.mjs",
  ],
  "git-commit": [
    "e2e-git-commit.mjs",
    "fixtures/workbench-host.mjs",
    "git-commit-probe.mjs",
  ],
  "git-index": [
    "e2e-git-index.mjs",
    "fixtures/workbench-host.mjs",
    "git-index-probe.mjs",
  ],
  workbench: ["e2e-workbench.mjs"],
  smoke: ["e2e-smoke.mjs", "inspect-packaged-bundle.mjs"],
};

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function checkedStat(root, path) {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Provenance path escaped repository scope");
  let current = root;
  const rootStat = await lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Provenance root must be a real directory");
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink())
      throw new Error(`Provenance symlink rejected: ${current}`);
    if (current === path) return stat;
    if (!stat.isDirectory())
      throw new Error("Provenance parent is not a directory");
  }
}

async function fileIdentity(root, path, budget) {
  const stat = await checkedStat(root, path);
  if (!stat.isFile())
    throw new Error(`Provenance input is not a file: ${path}`);
  budget.files++;
  budget.bytes += stat.size;
  if (budget.files > limits.files || budget.bytes > limits.bytes)
    throw new Error("Provenance inventory exceeds bounded file/byte limit");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await checkedStat(root, path);
  if (
    stat.size !== after.size ||
    stat.mtimeMs !== after.mtimeMs ||
    stat.ino !== after.ino
  )
    throw new Error(`Provenance file changed during hashing: ${path}`);
  return {
    path: relative(root, path).split(sep).join("/"),
    size: stat.size,
    mode: stat.mode & 0o777,
    sha256: hash.digest("hex"),
  };
}

async function inventory(root, scopes) {
  root = resolve(root);
  const files = [];
  const actualScopes = [];
  const budget = { files: 0, bytes: 0, entries: 0 };
  async function walk(path, scope, depth = 0) {
    if (depth > limits.depth)
      throw new Error("Provenance tree exceeds depth limit");
    const entries = await readdir(path, { withFileTypes: true });
    budget.entries += entries.length;
    if (budget.entries > limits.files * 2)
      throw new Error("Provenance tree exceeds entry limit");
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      if (
        scope.source &&
        (entry.name.startsWith(".") ||
          excludedDirectories.has(entry.name) ||
          /\.(?:test|spec)\.[^.]+$/.test(entry.name))
      )
        continue;
      const child = join(path, entry.name);
      const stat = await checkedStat(root, child);
      if (stat.isDirectory()) await walk(child, scope, depth + 1);
      else if (!scope.source || sourceExtension.test(entry.name))
        files.push(await fileIdentity(root, child, budget));
    }
  }
  for (const scope of scopes) {
    const path = join(root, scope.path);
    let stat;
    try {
      stat = await checkedStat(root, path);
    } catch (error) {
      if (!scope.optional || error.code !== "ENOENT") throw error;
    }
    actualScopes.push({ ...scope, present: Boolean(stat) });
    if (!stat) continue;
    if (scope.tree) {
      if (!stat.isDirectory())
        throw new Error(`Provenance scope is not a directory: ${path}`);
      await walk(path, scope);
    } else files.push(await fileIdentity(root, path, budget));
  }
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const identity = {
    algorithm,
    scopes: actualScopes,
    selection: scopes.some((scope) => scope.source)
      ? {
          excludedDirectories: [...excludedDirectories],
          excludedNames: "hidden names and *.test.* / *.spec.*",
          allowedFileExtensions: sourceExtension.source,
        }
      : "all files in the listed scopes",
    limits,
    files,
  };
  return { ...identity, sha256: digest(identity) };
}

export function snapshotBuildInputs(root) {
  return inventory(root, sourceScopes);
}

function outputScopes(platform, arch) {
  return [
    { path: `${app}/dist/app`, tree: true },
    { path: `${app}/dist/resources/node-pty`, tree: true },
    {
      path: `${app}/dist/resources/opencode/${platform}-${arch}/${platform === "win32" ? "opencode.exe" : "opencode"}`,
    },
  ];
}

export async function snapshotEventHostResources(
  resources,
  platform = process.platform,
  arch = process.arch,
) {
  const descriptor = eventHostForResources(resources, platform, arch);
  await assertRealResourceParents(descriptor.root);
  const beforeManifestSha256 = await resourceFileSha256(
    descriptor.manifestPath,
  );
  const manifest = await verifyEventHostResources(descriptor, {
    platform,
    arch,
  });
  const manifestSha256 = await resourceFileSha256(descriptor.manifestPath);
  const identity = {
    algorithm: "event-host-full-resource-inventory-sha256-v1",
    manifestSha256,
    inventorySha256: eventHostInventorySha256(manifest.entries),
    entryCount: manifest.entries.length,
    fileCount: manifest.entries.filter((e) => e.type === "file").length,
    symlinkCount: manifest.entries.filter((e) => e.type === "symlink").length,
    totalBytes: manifest.entries.reduce(
      (sum, e) => sum + (e.type === "file" ? e.size : 0),
      0,
    ),
    versions: {
      bun: manifest.bunVersion,
      server: manifest.serverVersion,
      effect: manifest.effectVersion,
    },
    target: { platform: manifest.platform, arch: manifest.arch },
    manifestPath: `opencode/event-host/${platform}-${arch}/manifest.json`,
  };
  if (beforeManifestSha256 !== manifestSha256)
    throw new Error("Event-host manifest changed during resource snapshot");
  return { ...identity, sha256: eventHostInventorySha256(identity) };
}
// OMOC_BUILD_TARGET=<platform>-<arch> seals a cross-target layout (nothing runs).
export function buildTarget(env = process.env) {
  const [platform, arch] = (
    env.OMOC_BUILD_TARGET ?? `${process.platform}-${process.arch}`
  ).split("-");
  return { platform, arch };
}
async function builtEventHost(root, target = buildTarget()) {
  return snapshotEventHostResources(
    join(root, app, "dist/resources"),
    target.platform,
    target.arch,
  );
}
export async function snapshotOwnerLifetimeResources(
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
) {
  if (platform === "win32") {
    // Identity-mode witness (no helper binary): the stamp pins that choice itself.
    const identity = {
      algorithm: "owner-lifetime-identity-mode-v1",
      mode: "process-creation-time-cim",
      platform,
      arch,
    };
    return { ...identity, sha256: digest(identity) };
  }
  const descriptor = ownerLifetimeForResources(resourcesPath, platform, arch);
  await assertRealResourceParents(descriptor.root);
  const before = await resourceFileSha256(descriptor.manifestPath);
  const { manifest } = await verifyOwnerLifetimeResources({
    resourcesPath,
    platform,
    arch,
  });
  const manifestSha256 = await resourceFileSha256(descriptor.manifestPath);
  const executableSha256 = await resourceFileSha256(descriptor.executable);
  if (
    before !== manifestSha256 ||
    executableSha256 !== manifest.executableSha256
  )
    throw new Error("Owner-lifetime resources changed during snapshot");
  const identity = {
    algorithm: "owner-lifetime-resource-sha256-v1",
    manifestSha256,
    executableSha256,
    sourceSha256: manifest.sourceSha256,
    compiler: manifest.compiler,
    target: manifest.target,
    platform: manifest.platform,
    arch: manifest.arch,
  };
  return { ...identity, sha256: digest(identity) };
}
async function builtOwnerLifetime(root, target = buildTarget()) {
  return snapshotOwnerLifetimeResources(
    join(root, app, "dist/resources"),
    target.platform,
    target.arch,
  );
}

export async function beginBuildProvenance(root) {
  // A failed/interrupted build must never leave an apparently usable old stamp.
  await rm(join(root, stampPath), { force: true });
  return snapshotBuildInputs(root);
}

export async function finishBuildProvenance(root, before, extra = {}) {
  const inputs = await snapshotBuildInputs(root);
  if (inputs.sha256 !== before.sha256)
    throw new Error(
      "Build inputs changed during build; no provenance stamp written",
    );
  const target = buildTarget();
  const artifacts = await inventory(
    root,
    outputScopes(target.platform, target.arch),
  );
  const eventHostResources = await builtEventHost(root, target);
  const ownerLifetimeResources = await builtOwnerLifetime(root, target);
  if (nodePtySupported(target.platform, target.arch)) {
    const pty = artifacts.files.filter((file) =>
      file.path.startsWith(`${app}/dist/resources/node-pty/`),
    );
    if (!pty.some((file) => file.path.endsWith("/node-pty/lib/index.js")))
      throw new Error("Missing required build artifact: node-pty");
    // Without the exec bit the native spawn helper fails at runtime (pnpm skips node-pty's postinstall).
    if (
      target.platform !== "win32" &&
      pty
        .filter((file) => file.path.endsWith("/spawn-helper"))
        .some((file) => !(file.mode & 0o100))
    )
      throw new Error("node-pty spawn-helper is not executable");
  }
  for (const required of [
    "main.mjs",
    "preload.cjs",
    "package.json",
    "renderer/index.html",
  ]) {
    if (
      !artifacts.files.some(
        (file) => file.path === `${app}/dist/app/${required}`,
      )
    )
      throw new Error(`Missing required build artifact: ${required}`);
  }
  if (
    (await inventory(root, outputScopes(target.platform, target.arch)))
      .sha256 !== artifacts.sha256 ||
    (await snapshotBuildInputs(root)).sha256 !== inputs.sha256 ||
    JSON.stringify(await builtEventHost(root, target)) !==
      JSON.stringify(eventHostResources) ||
    JSON.stringify(await builtOwnerLifetime(root, target)) !==
      JSON.stringify(ownerLifetimeResources)
  )
    throw new Error(
      "Build inputs or artifacts changed while sealing build provenance",
    );
  const stamp = {
    schemaVersion: 1,
    kind: "desktop-build-byte-provenance",
    createdAt: new Date().toISOString(),
    builder: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    target,
    ...(extra.sidecarReceipt && { crossSidecar: extra.sidecarReceipt }),
    inputs,
    artifacts,
    eventHostResources,
    ownerLifetimeResources,
    limitations: [
      "Scoped local byte inventory, not the harness source fingerprint or a signed attestation.",
      "Build source scope follows the exported extension/name/directory selection policy. Known credential and runtime/export/capture directories and repository paths outside the scopes are excluded; selected capture scripts/fixtures are recorded separately.",
      "Lockfiles identify declared dependency resolution; The selected event-host installed closure is separately inventoried. Other installed dependency trees, compiler binaries and Electron runtime are not independently inventoried.",
      "Before/after comparisons detect observed changes; they are not filesystem isolation and cannot detect change-and-restore between observations.",
    ],
  };
  await writeFile(
    join(root, stampPath),
    `${JSON.stringify(stamp, null, 2)}\n`,
    { flag: "wx" },
  );
  return stamp;
}

async function packagedArtifacts(root, buildStamp, platform) {
  if (platform !== process.platform)
    throw new Error("Packaged evidence requires the native platform");
  const base = `${app}/dist/packages/OhMyOwnCode-${platform}-${process.arch}`;
  const packagedApp = platform === "darwin" ? `${base}/OhMyOwnCode.app` : base;
  const resource = platform === "darwin" ? "Contents/Resources" : "resources";
  const asar = `${packagedApp}/${resource}/app.asar`;
  const sidecar = `${packagedApp}/${resource}/opencode/${platform}-${process.arch}/${platform === "win32" ? "opencode.exe" : "opencode"}`;
  const executable = `${packagedApp}/${platform === "darwin" ? "Contents/MacOS/OhMyOwnCode" : "OhMyOwnCode.exe"}`;
  const artifacts = await inventory(
    root,
    [asar, sidecar, executable].map((path) => ({ path })),
  );
  const require = createRequire(import.meta.url);
  const asarPath = createRequire(require.resolve("@electron/packager")).resolve(
    "@electron/asar",
  );
  const { listPackage, statFile, extractFile, uncache } = await import(
    pathToFileURL(asarPath).href
  );
  // asar caches headers by pathname; each verification must inspect current bytes.
  uncache(join(root, asar));
  const entries = listPackage(join(root, asar));
  if (entries.length > limits.files * 2)
    throw new Error("Packaged archive exceeds entry limit");
  const expected = buildStamp.artifacts.files.filter((file) =>
    file.path.startsWith(`${app}/dist/app/`),
  );
  const actual = [];
  let bytes = 0;
  for (const entry of entries) {
    const path = entry.replaceAll("\\", "/").replace(/^\//, "");
    const stat = statFile(join(root, asar), path);
    if (stat.files) continue;
    if (
      stat.link ||
      stat.unpacked ||
      path.split("/").some((part) => part === "..")
    )
      throw new Error("Packaged archive contains a redirect or unpacked entry");
    bytes += stat.size;
    if (bytes > limits.bytes)
      throw new Error("Packaged archive exceeds byte limit");
    const file = expected.find(
      (candidate) => candidate.path === `${app}/dist/app/${path}`,
    );
    const data = extractFile(join(root, asar), path);
    if (
      !file ||
      data.length !== file.size ||
      createHash("sha256").update(data).digest("hex") !== file.sha256
    )
      throw new Error(`Packaged archive does not match stamped build: ${path}`);
    actual.push(path);
  }
  if (actual.length !== expected.length)
    throw new Error("Packaged archive is missing stamped build files");
  const resourceIdentity = buildStamp.artifacts.files.find((file) =>
    file.path.includes("/dist/resources/opencode/"),
  );
  if (
    artifacts.files.find((file) => file.path === sidecar).sha256 !==
    resourceIdentity.sha256
  )
    throw new Error("Packaged sidecar does not match stamped build");
  // node-pty ships outside the asar. Compare the FULL packaged tree with the stamp: exact file list,
  // sha256, size and mode (the executable spawn-helper). An extra file such as build/Release/pty.node
  // would be loaded in preference to the stamped prebuild, so extras are rejected.
  const ptyPrefix = `${app}/dist/resources/node-pty/`;
  const ptyRoot = `${packagedApp}/${resource}/node-pty`;
  const ptyExpected = buildStamp.artifacts.files.filter((file) =>
    file.path.startsWith(ptyPrefix),
  );
  const ptyActual = (
    await inventory(root, [{ path: ptyRoot, tree: true, optional: true }])
  ).files;
  const ptySame =
    ptyActual.length === ptyExpected.length &&
    ptyActual.every((file, i) => {
      const want = ptyExpected[i];
      return (
        file.path.slice(ptyRoot.length + 1) ===
          want.path.slice(ptyPrefix.length) &&
        file.sha256 === want.sha256 &&
        file.size === want.size &&
        (platform === "win32" || file.mode === want.mode)
      );
    });
  if (
    !ptySame ||
    (ptyExpected.length === 0) !== !nodePtySupported(platform, process.arch)
  )
    throw new Error("Packaged node-pty does not match stamped build");
  const eventHostResources = await snapshotEventHostResources(
    join(root, packagedApp, resource),
    platform,
    process.arch,
  );
  if (
    JSON.stringify(eventHostResources) !==
    JSON.stringify(buildStamp.eventHostResources)
  )
    throw new Error("Packaged event-host resources do not match stamped build");
  const ownerLifetimeResources = await snapshotOwnerLifetimeResources(
    join(root, packagedApp, resource),
    platform,
    process.arch,
  );
  if (
    JSON.stringify(ownerLifetimeResources) !==
    JSON.stringify(buildStamp.ownerLifetimeResources)
  )
    throw new Error(
      "Packaged owner-lifetime resources do not match stamped build",
    );
  return {
    ...artifacts,
    eventHostResources,
    ownerLifetimeResources,
    sha256: digest([
      artifacts.sha256,
      eventHostResources.sha256,
      ownerLifetimeResources.sha256,
    ]),
  };
}

export async function captureProvenance(root, selected) {
  const stampFile = join(root, stampPath);
  const stampStat = await checkedStat(root, stampFile);
  if (!stampStat.isFile() || stampStat.size > stampByteLimit)
    throw new Error("Build provenance stamp is not a bounded file");
  const stampBytes = await readFile(stampFile);
  if (stampBytes.length > stampByteLimit)
    throw new Error("Build provenance stamp exceeds byte limit");
  const buildStamp = JSON.parse(stampBytes);
  if (
    buildStamp.schemaVersion !== 1 ||
    buildStamp.kind !== "desktop-build-byte-provenance" ||
    buildStamp.builder.platform !== process.platform ||
    buildStamp.builder.arch !== process.arch
  )
    throw new Error(
      "Missing, unsupported or foreign build provenance stamp; rebuild required",
    );
  const currentBuildInputs = await snapshotBuildInputs(root);
  if (JSON.stringify(currentBuildInputs) !== JSON.stringify(buildStamp.inputs))
    throw new Error(
      "Stale build provenance: source/config/lock/assets changed; rebuild required",
    );
  const currentArtifacts = await inventory(
    root,
    outputScopes(process.platform, process.arch),
  );
  if (JSON.stringify(currentArtifacts) !== JSON.stringify(buildStamp.artifacts))
    throw new Error("Build artifact mismatch; rebuild required");
  const eventHostResources = await builtEventHost(root);
  if (
    JSON.stringify(eventHostResources) !==
    JSON.stringify(buildStamp.eventHostResources)
  )
    throw new Error("Event-host resource artifact mismatch; rebuild required");
  const ownerLifetimeResources = await builtOwnerLifetime(root);
  if (
    JSON.stringify(ownerLifetimeResources) !==
    JSON.stringify(buildStamp.ownerLifetimeResources)
  )
    throw new Error(
      "Owner-lifetime resource artifact mismatch; rebuild required",
    );
  const selectedScriptsAndFixtures = await inventory(
    root,
    [
      "run-evidence.mjs",
      "build-provenance.mjs",
      ...selectedPaths[selected.script],
    ].map((path) => ({ path: `${app}/scripts/${path}` })),
  );
  const launchArtifacts =
    selected.script === "smoke" && selected.mode === "packaged"
      ? await packagedArtifacts(root, buildStamp, selected.platform)
      : {
          ...currentArtifacts,
          eventHostResources,
          ownerLifetimeResources,
          sha256: digest([
            currentArtifacts.sha256,
            eventHostResources.sha256,
            ownerLifetimeResources.sha256,
          ]),
        };
  return {
    schemaVersion: 1,
    buildStampPath: stampPath,
    buildStampSha256: createHash("sha256").update(stampBytes).digest("hex"),
    buildStamp,
    currentBuildInputs,
    selectedScriptsAndFixtures,
    currentRelevantSource: {
      algorithm:
        "sha256-of-build-input-and-selected-script-inventory-digests-v1",
      buildInputsSha256: currentBuildInputs.sha256,
      selectedScriptsAndFixturesSha256: selectedScriptsAndFixtures.sha256,
      sha256: digest([
        currentBuildInputs.sha256,
        selectedScriptsAndFixtures.sha256,
      ]),
    },
    launchArtifacts,
  };
}
