// Static verification of a packaged layout (nothing is executed, works cross-host):
//   node scripts/verify-package-layout.mjs win32 x64
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  eventHostForResources,
  verifyEventHostResources,
} from "../src/event-host-resources.mjs";
import { sidecarBinaryName } from "../src/sidecar-package.mjs";
import {
  snapshotEventHostResources,
  snapshotOwnerLifetimeResources,
} from "./build-provenance.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function sha256(path) {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}
async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    yield path;
    if (entry.isDirectory()) yield* walk(path);
  }
}

export async function verifyPackageLayout(platform, arch) {
  const target = `${platform}-${arch}`;
  const packaged = join(appDir, "dist", "packages", `OhMyOwnCode-${target}`);
  const resources =
    platform === "darwin"
      ? join(packaged, "OhMyOwnCode.app", "Contents", "Resources")
      : join(packaged, "resources");
  const staged = join(appDir, "dist", "resources");
  const report = { target, checks: [] };
  const ok = (name) => report.checks.push(name);

  const executable = join(
    packaged,
    platform === "win32" ? "OhMyOwnCode.exe" : "OhMyOwnCode.app",
  );
  assert.ok((await stat(executable)).size > 0);
  if (platform === "win32") {
    const handle = await open(executable, "r");
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    await handle.close();
    assert.equal(
      head.toString("latin1"),
      "MZ",
      "Windows executable is a PE file",
    );
  }
  ok("electron executable present");
  assert.ok((await stat(join(resources, "app.asar"))).isFile());
  ok("app.asar present");

  const sidecarName = sidecarBinaryName(platform);
  const sidecar = join(resources, "opencode", target, sidecarName);
  assert.equal(
    await sha256(sidecar),
    await sha256(join(staged, "opencode", target, sidecarName)),
    "packaged sidecar equals staged sidecar",
  );
  ok("sidecar bytes equal staged bytes");

  const descriptor = eventHostForResources(resources, platform, arch);
  const manifest = await verifyEventHostResources(descriptor, {
    platform,
    arch,
    requirePermissionOverlay: true,
  });
  assert.equal(manifest.platform, platform);
  assert.equal(manifest.arch, arch);
  ok(
    "event host verifies (manifest, overlay receipt, inventory) for the target",
  );

  const stamp = JSON.parse(
    await readFile(join(appDir, "dist", "build-provenance.json"), "utf8"),
  );
  assert.deepEqual(
    await snapshotEventHostResources(resources, platform, arch),
    stamp.eventHostResources,
  );
  assert.deepEqual(
    await snapshotOwnerLifetimeResources(resources, platform, arch),
    stamp.ownerLifetimeResources,
  );
  ok("packaged event-host/lifetime snapshots equal the build provenance stamp");

  // No other-target names baked into the layout.
  const other =
    platform === "win32"
      ? /darwin|arm64|apple|\.app(?:$|\/)/i
      : /win32|windows|\.exe$/i;
  for await (const path of walk(join(resources, "opencode"))) {
    const relative = path.slice(resources.length + 1);
    // Third-party package names (node_modules) legitimately carry every platform.
    if (relative.includes("node_modules")) continue;
    // Closed code assets that are inert off darwin (their loaders refuse other runtimes).
    if (
      /host[\\/]darwin-(?:descriptor-ffi|directory-entry)\.mjs$/.test(relative)
    )
      continue;
    assert.ok(
      !other.test(relative),
      `foreign-target name in layout: ${relative}`,
    );
  }
  ok("no foreign-target names outside node_modules");
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [platform, arch] = process.argv.slice(2);
  console.log(
    JSON.stringify(await verifyPackageLayout(platform, arch), null, 2),
  );
}
