// Bounded synthetic repository and build output; never launches Electron.
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { ownerLifetimeForResources } from "../src/owner-lifetime-resources.mjs";
import {
  EVENT_HOST_IDENTITY,
  eventHostForResources,
  inventoryEventHostTree,
} from "../src/event-host-resources.mjs";
import {
  beginBuildProvenance,
  finishBuildProvenance,
} from "./build-provenance.mjs";

export async function put(root, path, content = "synthetic fixture\n") {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

export async function syntheticRepository(root) {
  const paths = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "nx.json",
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
      "native/owner-lifetime/witness.c",
      "scripts/package.mjs",
      "runtime-event-host/package.json",
      "runtime-event-host/package-lock.json",
      "runtime-event-host/installer-pins.json",
      "scripts/run-evidence.mjs",
      "scripts/e2e-session-lifecycle.mjs",
      "scripts/e2e-workbench-states.mjs",
      "scripts/e2e-workbench.mjs",
      "scripts/e2e-smoke.mjs",
      "scripts/inspect-packaged-bundle.mjs",
      "scripts/fixtures/workbench-host.mjs",
      "scripts/fixtures/session-history-probe.mjs",
      "src/main.mjs",
      "src/preload.cjs",
      "src/renderer/app.tsx",
      "src/renderer/app.module.css",
    ].map((path) => `apps/desktop-app/${path}`),
    ...["ui", "contracts"].flatMap((name) =>
      ["package.json", "project.json", "tsconfig.json", "src/index.ts"].map(
        (path) => `packages/${name}/${path}`,
      ),
    ),
    "packages/contracts/tsconfig.build.json",
    "docs/design/tokens/tokens.css",
    "docs/design/tokens/manifest.json",
  ];
  for (const path of paths) await put(root, path);
  await syntheticBuild(root);
}

export async function syntheticBuild(root, mutate = async () => {}) {
  const before = await beginBuildProvenance(root);
  for (const path of [
    "main.mjs",
    "preload.cjs",
    "package.json",
    "renderer/index.html",
    "renderer/assets/app.js",
    "renderer/assets/app.css",
  ])
    await put(
      root,
      `apps/desktop-app/dist/app/${path}`,
      `synthetic output: ${path}\n`,
    );
  await put(
    root,
    `apps/desktop-app/dist/resources/opencode/${process.platform}-${process.arch}/${process.platform === "win32" ? "opencode.exe" : "opencode"}`,
    "synthetic sidecar\n",
  );
  await syntheticEventHost(join(root, "apps/desktop-app/dist/resources"));
  await syntheticOwnerLifetime(join(root, "apps/desktop-app/dist/resources"));
  await mutate();
  return finishBuildProvenance(root, before);
}

// Resource-integrity bytes only. This header fixture is never executed.
export async function syntheticOwnerLifetime(resources) {
  const descriptor = ownerLifetimeForResources(resources, "darwin", "arm64");
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  await put(descriptor.root, "witness", bytes);
  await chmod(descriptor.executable, 0o755);
  await put(
    descriptor.root,
    "manifest.json",
    `${JSON.stringify({ version: 1, platform: "darwin", arch: "arm64", sourceSha256: sha("synthetic fixture\n"), compiler: "Apple clang version 17.0.0 (unit fixture)", target: "arm64-apple-macos11", executableSha256: sha(bytes) })}\n`,
  );
  return descriptor;
}

// Synthetic byte fixtures only. No dependency imports, Bun or native execution.
export async function syntheticEventHost(resources) {
  const descriptor = eventHostForResources(resources, "darwin", "arm64");
  for (const path of [
    "host.mjs",
    "event-host-protocol.mjs",
    "runtime/bun",
    "package.json",
    "package-lock.json",
    "node_modules/tool/bin/tool.js",
  ])
    await put(descriptor.root, path, `synthetic event-host: ${path}\n`);
  await chmod(descriptor.enginePath, 0o755);
  for (const [name, version] of [
    ["@opencode/server", "2.0.18"],
    ["@opencode/client", "2.0.18"],
    ["effect", "4.0.0-rc.112"],
  ])
    await put(
      descriptor.root,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version }),
    );
  const links = { "node_modules/.bin/tool": { target: "../tool/bin/tool.js" } };
  await mkdir(join(descriptor.root, "node_modules/.bin"), { recursive: true });
  try {
    await symlink(
      links["node_modules/.bin/tool"].target,
      join(descriptor.root, "node_modules/.bin/tool"),
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await syntheticRuntimeLock(descriptor.root);
  const manifest = {
    ...EVENT_HOST_IDENTITY,
    entries: await inventoryEventHostTree(descriptor.root, { links }),
  };
  await put(descriptor.root, "manifest.json", `${JSON.stringify(manifest)}\n`);
  return descriptor;
}

export async function syntheticRuntimeLock(root) {
  const dependencies = {
    "@opencode/server": "2.0.18",
    "@opencode/client": "2.0.18",
    effect: "4.0.0-rc.112",
  };
  const packages = { "": { dependencies } };
  for (const [name, version] of [
    ...Object.entries(dependencies),
    ["tool", "1.0.0"],
  ]) {
    packages[`node_modules/${name}`] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/synthetic-${version}.tgz`,
      integrity: `sha512-${"A".repeat(86)}==`,
    };
    await put(
      root,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version }),
    );
  }
  await put(root, "package.json", JSON.stringify({ dependencies }));
  await put(
    root,
    "package-lock.json",
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
}
