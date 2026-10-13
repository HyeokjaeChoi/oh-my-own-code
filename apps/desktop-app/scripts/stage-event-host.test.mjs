import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  EVENT_HOST_IDENTITY,
  EVENT_HOST_CODE_ASSETS,
  eventHostForResources,
  inventoryEventHostTree,
  verifyEventHostResources,
} from "../src/event-host-resources.mjs";
import {
  assertControllerEnvironment,
  assertPublicArchive,
  extractPinnedBun,
  installerEnvironment,
  installerConfig,
  loadRuntimeInputs,
  prepareEventHost,
  runtimePackageDir,
  validateRuntimeLock,
} from "./prepare-event-host.mjs";
import {
  copyPackagedResources,
  stageEventHost,
  localResourceImports,
} from "./stage-event-host.mjs";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-recipe.mjs";
import { planNativePermissionOverlay } from "./native-permission-overlay.mjs";
import { syntheticRuntimeLock } from "./build-provenance-test-fixture.mjs";
const target = { platform: "darwin", arch: "arm64" };
async function put(path, value, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { mode });
  await chmod(path, mode);
}
async function fixture(t) {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-event-resource-")),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  const d = eventHostForResources(base, "darwin", "arm64");
  await mkdir(d.root, { recursive: true });
  for (const path of [
    "host.mjs",
    "event-host-protocol.mjs",
    "package.json",
    "package-lock.json",
    "runtime/bun",
    "node_modules/tool/bin/tool.js",
  ])
    await put(
      join(d.root, path),
      "synthetic: never executed",
      path === "runtime/bun" ? 0o755 : 0o644,
    );
  for (const [name, version] of [
    ["@opencode/server", "2.0.18"],
    ["@opencode/client", "2.0.18"],
    ["effect", "4.0.0-rc.112"],
  ])
    await put(
      join(d.root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  await mkdir(join(d.root, "node_modules/.bin"));
  await symlink("../tool/bin/tool.js", join(d.root, "node_modules/.bin/tool"));
  const links = { "node_modules/.bin/tool": { target: "../tool/bin/tool.js" } };
  await syntheticRuntimeLock(d.root);
  const manifest = {
    ...EVENT_HOST_IDENTITY,
    entries: await inventoryEventHostTree(d.root, { links }),
  };
  await put(d.manifestPath, JSON.stringify(manifest));
  return { base, d, manifest, links };
}
test("closed descriptor and verifier return actual full manifest including contained relative link", async (t) => {
  const { d, manifest } = await fixture(t);
  assert.deepEqual(Object.keys(d), [
    "root",
    "enginePath",
    "hostPath",
    "manifestPath",
  ]);
  assert.deepEqual(await verifyEventHostResources(d, target), manifest);
  await assert.rejects(
    verifyEventHostResources({ ...d, extra: true }, target),
    /descriptor/,
  );
  assert.throws(
    () => eventHostForResources("/tmp", "win32", "arm64"),
    /unsupported/,
  );
  await assert.rejects(
    verifyEventHostResources(d, { platform: "darwin", arch: "x64" }),
    /unsupported/,
  );
});

test("packaging preserves exact relative links and refuses occupied resource roots", async (t) => {
  const { base, d, manifest } = await fixture(t);
  const destination = join(base, "packaged-resources");
  await mkdir(destination);
  const options = { resources: base, destination, ...target };
  await copyPackagedResources(options);
  const packaged = eventHostForResources(
    destination,
    target.platform,
    target.arch,
  );
  assert.equal(
    await readlink(join(packaged.root, "node_modules/.bin/tool")),
    "../tool/bin/tool.js",
  );
  assert.deepEqual(await verifyEventHostResources(packaged, target), manifest);
  assert.deepEqual(await verifyEventHostResources(d, target), manifest);
  await assert.rejects(copyPackagedResources(options), /already exists/);
  await writeFile(join(d.root, "host.mjs"), "source drift");
  const rejected = join(base, "rejected-resources");
  await mkdir(rejected);
  await assert.rejects(
    copyPackagedResources({ ...options, destination: rejected }),
    /inventory|hash|drift/,
  );
  assert.deepEqual(await readdir(rejected), []);
});
for (const mutation of [
  "missing",
  "extra",
  "hash",
  "mode",
  "hardlink",
  "symlink-escape",
  "symlink-chain",
  "symlink-undeclared",
  "directory-mode",
  "manifest-hardlink",
])
  test(`reject actual tree ${mutation}`, async (t) => {
    const { base, d } = await fixture(t);
    const file = join(d.root, "host.mjs");
    const bin = join(d.root, "node_modules/.bin/tool");
    if (mutation === "missing") await rm(file);
    if (mutation === "extra") await put(join(d.root, "extra"), "extra");
    if (mutation === "hash") await writeFile(file, "changed");
    if (mutation === "mode") await chmod(file, 0o755);
    if (mutation === "hardlink")
      await link(file, join(base, "outside-hardlink"));
    if (mutation === "symlink-escape") {
      await rm(bin);
      await symlink("../../../../outside", bin);
    }
    if (mutation === "symlink-chain") {
      const real = join(d.root, "node_modules/tool/bin/tool.js");
      await rm(real);
      await symlink("../../../host.mjs", real);
    }
    if (mutation === "symlink-undeclared")
      await symlink(
        "../tool/bin/tool.js",
        join(d.root, "node_modules/.bin/other"),
      );
    if (mutation === "directory-mode")
      await chmod(join(d.root, "runtime"), 0o700);
    if (mutation === "manifest-hardlink")
      await link(d.manifestPath, join(base, "linked-manifest"));
    await assert.rejects(verifyEventHostResources(d, target));
  });
for (const mutation of [
  "unknown",
  "duplicate",
  "escape",
  "version",
  "target",
  "entry-unknown",
  "nlink",
  "type",
  "size",
  "depth",
])
  test(`reject manifest ${mutation}`, async (t) => {
    const { d, manifest } = await fixture(t);
    if (mutation === "unknown") manifest.unexpected = true;
    if (mutation === "duplicate") manifest.entries.push(manifest.entries[0]);
    if (mutation === "escape") manifest.entries[0].path = "../outside";
    if (mutation === "version") manifest.bunVersion = "1.4.3";
    if (mutation === "target") manifest.arch = "x64";
    if (mutation === "entry-unknown") manifest.entries[0].unexpected = 1;
    if (mutation === "nlink")
      manifest.entries.find((e) => e.type === "file").nlink = 2;
    if (mutation === "type") manifest.entries[0].type = "socket";
    if (mutation === "size")
      manifest.entries.find((e) => e.type === "file").size = 2 ** 32;
    if (mutation === "depth")
      manifest.entries[0].path = Array(66).fill("x").join("/");
    await writeFile(d.manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyEventHostResources(d, target));
  });
test("symlink ancestor rejected before inventory", async (t) => {
  const { base, d } = await fixture(t);
  await symlink(d.root, join(base, "alias"));
  await assert.rejects(inventoryEventHostTree(join(base, "alias")), /parent/);
});
test("full resource inventory has separate 100k limit and accepts over4096 files", async (t) => {
  const { d, links } = await fixture(t);
  await mkdir(join(d.root, "large"));
  for (let i = 0; i < 4100; i++)
    await put(join(d.root, "large", String(i)), "x");
  assert.ok((await inventoryEventHostTree(d.root, { links })).length > 4096);
});
test("guard constructs env from zero and pins all downloaded lock origins", async () => {
  const saved = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--import=/private/evil.mjs";
  try {
    const env = installerEnvironment("/owned", "/pinned/bin/node");
    for (const key of [
      "NODE_OPTIONS",
      "NODE_PATH",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "NPM_TOKEN",
      "npm_config_cafile",
    ])
      assert.equal(Object.hasOwn(env, key), false);
    assert.equal(env.PATH, "/pinned/bin");
    assert.equal(env.npm_config_ignore_scripts, "true");
    assert.match(installerConfig, /ignore-scripts=true/);
    const { pkg, lock } = await loadRuntimeInputs();
    validateRuntimeLock(pkg, lock);
    for (const url of [
      "http://registry.npmjs.org/p.tgz",
      "https://user:pass@registry.npmjs.org/p.tgz",
      "https://private.invalid/p.tgz",
      "https://registry.npmjs.org/p.tgz?x=1",
    ])
      assert.throws(() => assertPublicArchive(url));
    const bad = globalThis.structuredClone(lock);
    Object.values(bad.packages).find((p) => p.resolved).resolved =
      "https://private.invalid/p.tgz";
    assert.throws(() => validateRuntimeLock(pkg, bad));
    const linked = globalThis.structuredClone(lock);
    Object.values(linked.packages).find((p) => p.resolved).link = true;
    assert.throws(() => validateRuntimeLock(pkg, linked));
    assert.throws(() =>
      validateRuntimeLock({ ...pkg, scripts: { install: "native" } }, lock),
    );
  } finally {
    if (saved === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = saved;
  }
});
test("unsupported preparation target rejects before any directory/network action", async () => {
  await assert.rejects(
    prepareEventHost({
      packageDir: "/does-not-exist",
      platform: "linux",
      arch: "x64",
    }),
    /unsupported/,
  );
  await assert.rejects(
    stageEventHost({
      resources: "/does-not-exist",
      platform: "linux",
      arch: "arm64",
    }),
    /unsupported/,
  );
});
test("corrupt official archive rejects before decompression or engine write", async () => {
  const { pins } = await loadRuntimeInputs();
  assert.throws(
    () => extractPinnedBun(Buffer.from("bad bytes"), pins.bun),
    /integrity/,
  );
});
test("pin hash mutation blocks preparation before network", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "omoc-pin-test-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  for (const path of [
    "package.json",
    "package-lock.json",
    "installer-pins.json",
  ])
    await copyFile(join(runtimePackageDir, path), join(base, path));
  await writeFile(join(base, "package-lock.json"), "{}");
  await assert.rejects(loadRuntimeInputs(base), /hash drift/);
});
async function stageFixture(t) {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-stage-copy-")),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  const packageDir = join(base, "package");
  await mkdir(packageDir);
  for (const name of [
    "package.json",
    "package-lock.json",
    "installer-pins.json",
  ])
    await copyFile(join(runtimePackageDir, name), join(packageDir, name));
  const pins = JSON.parse(
    await readFile(join(packageDir, "installer-pins.json")),
  );
  const generated = join(packageDir, ".generated");
  const install = join(generated, "install");
  await mkdir(install, { recursive: true });
  for (const name of ["package.json", "package-lock.json"])
    await copyFile(join(packageDir, name), join(install, name));
  for (const [name, version] of [
    ["@opencode/server", "2.0.18"],
    ["@opencode/client", "2.0.18"],
    ["effect", "4.0.0-rc.112"],
  ])
    await put(
      join(install, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  for (const [path, declaration] of Object.entries(pins.links)) {
    const targetPath = join(dirname(join(install, path)), declaration.target);
    await put(targetPath, "synthetic bin asset: never executed\n");
    declaration.target_sha256 = createHash("sha256")
      .update("synthetic bin asset: never executed\n")
      .digest("hex");
    await mkdir(dirname(join(install, path)), { recursive: true });
    await symlink(declaration.target, join(install, path));
  }
  // Every target-selected lock entry has synthetic metadata; no native bytes run.
  const lock = JSON.parse(await readFile(join(install, "package-lock.json")));
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue;
    const allows = (list, target) =>
      !list ||
      ((!list.some((x) => !x.startsWith("!")) || list.includes(target)) &&
        !list.includes(`!${target}`));
    if (allows(item.os, "darwin") && allows(item.cpu, "arm64"))
      await put(
        join(install, path, "package.json"),
        JSON.stringify({
          name:
            item.name ??
            path.slice(
              path.lastIndexOf("node_modules/") + "node_modules/".length,
            ),
          version: item.version,
        }),
      );
  }
  // Exact public source inputs, copied read-only; synthetic engine is never executed.
  for (const { path } of NATIVE_PERMISSION_OVERLAY_RECIPE.files)
    await put(
      join(install, path),
      await readFile(join(runtimePackageDir, ".generated/install", path)),
    );
  const engine = "synthetic engine: never executed\n";
  pins.bun.binarySha256 = createHash("sha256").update(engine).digest("hex");
  await put(join(generated, "runtime/bun"), engine, 0o755);
  await put(join(packageDir, "installer-pins.json"), JSON.stringify(pins));
  const pinsSha256 = createHash("sha256")
    .update(await readFile(join(packageDir, "installer-pins.json")))
    .digest("hex");
  const receipt = {
    schemaVersion: 1,
    ...target,
    scriptsExecuted: false,
    runtimeExecuted: false,
    packageSha256: pins.packageSha256,
    lockSha256: pins.lockSha256,
    pinsSha256,
    engineSha256: pins.bun.binarySha256,
    installEntries: await inventoryEventHostTree(install, {
      links: pins.links,
    }),
  };
  await put(join(generated, "receipt.json"), JSON.stringify(receipt));
  const hostSource = join(base, "source/event-host-child.mjs");
  await put(
    hostSource,
    'import { synthetic } from "./event-host-protocol.mjs";\n',
  );
  await put(
    join(dirname(hostSource), "event-host-protocol.mjs"),
    "export const synthetic = true;\n",
  );
  for (const asset of [
    "native-preflight-reader.mjs",
    "native-preflight-protocol.mjs",
    "native-preflight-predicates.mjs",
    ...EVENT_HOST_CODE_ASSETS,
  ])
    await put(
      join(dirname(hostSource), asset),
      asset.endsWith(".json") ? "{}\n" : "export const synthetic = true;\n",
    );
  const resources = join(base, "resources");
  await mkdir(resources);
  return { packageDir, generated, install, hostSource, resources };
}
test("stage copies actual supplied child/protocol/full declared links; repeat exact stage is read-only reuse", async (t) => {
  const opts = await stageFixture(t);
  const d = await stageEventHost({ ...opts, ...target });
  const manifest = await verifyEventHostResources(d, target);
  assert.equal(manifest.entries.filter((e) => e.type === "symlink").length, 31);
  assert.equal(
    await readFile(d.hostPath, "utf8"),
    await readFile(opts.hostSource, "utf8"),
  );
  assert.equal(
    await readFile(join(d.root, "event-host-protocol.mjs"), "utf8"),
    await readFile(
      join(dirname(opts.hostSource), "event-host-protocol.mjs"),
      "utf8",
    ),
  );
  assert.equal(
    manifest.entries.some((e) => e.path.includes(".npmrc")),
    false,
  );
  assert.deepEqual(await stageEventHost({ ...opts, ...target }), d);
  await writeFile(
    opts.hostSource,
    'import { synthetic } from "./event-host-protocol.mjs";\n// changed\n',
  );
  await stageEventHost({ ...opts, ...target });
  const retained = (await readdir(opts.generated)).filter((name) =>
    name.startsWith("staged-retained-"),
  );
  assert.equal(retained.length, 1);
  const old = eventHostForResources(
    join(opts.generated, retained[0]),
    "darwin",
    "arm64",
  );
  assert.deepEqual(await verifyEventHostResources(old, target), manifest);
  assert.notDeepEqual(await verifyEventHostResources(d, target), manifest);
  assert.equal(
    await readFile(d.hostPath, "utf8"),
    await readFile(opts.hostSource, "utf8"),
  );
});
test("actual child and fixed Skill plugin transitive source closure stage together without engine execution", async (t) => {
  const opts = await stageFixture(t);
  const source = new URL("../src/", import.meta.url);
  // These are child-side pure validators. The Main contract and request ALS
  // owner are deliberately absent from the child dependency closure.
  for (const asset of [
    "native-permission-task-handoff.mjs",
    "native-permission-inventory.mjs",
    "permission-input-digest.mjs",
    "wire-id.mjs",
    "host/workbench-task-storage.mjs",
  ])
    assert.ok(
      EVENT_HOST_CODE_ASSETS.includes(asset),
      `Missing task asset: ${asset}`,
    );
  assert.equal(
    EVENT_HOST_CODE_ASSETS.includes("workbench-contract.mjs"),
    false,
  );
  assert.equal(
    EVENT_HOST_CODE_ASSETS.includes("native-permission-task-request.mjs"),
    false,
  );
  for (const asset of [
    "event-host-child.mjs",
    "event-host-protocol.mjs",
    ...EVENT_HOST_CODE_ASSETS,
  ])
    await put(
      join(dirname(opts.hostSource), asset),
      await readFile(new URL(asset, source)),
    );
  const descriptor = await stageEventHost({ ...opts, ...target });
  const manifest = await verifyEventHostResources(descriptor, target);
  assert.deepEqual(
    await readFile(descriptor.hostPath),
    await readFile(new URL("event-host-child.mjs", source)),
  );
  assert.ok(
    EVENT_HOST_CODE_ASSETS.includes("host/workspace-root-authority.mjs"),
  );
  for (const asset of EVENT_HOST_CODE_ASSETS) {
    assert.deepEqual(
      await readFile(join(descriptor.root, asset)),
      await readFile(new URL(asset, source)),
    );
    assert.equal(
      manifest.entries.find((entry) => entry.path === asset)?.type,
      "file",
    );
  }
  // The exact production child remains subject to the closed import list.
  await writeFile(
    opts.hostSource,
    (await readFile(opts.hostSource, "utf8")) + '\nimport "./unknown.mjs";\n',
  );
  await assert.rejects(
    stageEventHost({ ...opts, ...target }),
    /Unrecognized child resource import graph/,
  );
  assert.deepEqual(
    await verifyEventHostResources(descriptor, target),
    manifest,
  );
});
for (const mutation of [
  "receipt",
  "dependency",
  "engine",
  "child-import",
  "protocol-hardlink",
])
  test(`stage rejects ${mutation} before creating destination`, async (t) => {
    const opts = await stageFixture(t);
    if (mutation === "receipt") {
      const path = join(opts.generated, "receipt.json");
      const r = JSON.parse(await readFile(path));
      r.scriptsExecuted = true;
      await writeFile(path, JSON.stringify(r));
    }
    if (mutation === "dependency")
      await writeFile(
        join(opts.install, "node_modules/effect/package.json"),
        "{}",
      );
    if (mutation === "engine")
      await writeFile(join(opts.generated, "runtime/bun"), "drift");
    if (mutation === "child-import")
      await writeFile(opts.hostSource, 'import "./unknown.mjs";');
    if (mutation === "protocol-hardlink")
      await link(
        join(dirname(opts.hostSource), "event-host-protocol.mjs"),
        join(dirname(opts.hostSource), "linked"),
      );
    await assert.rejects(stageEventHost({ ...opts, ...target }));
    await assert.rejects(
      readFile(
        join(opts.resources, "opencode/event-host/darwin-arm64/manifest.json"),
      ),
      /ENOENT/,
    );
  });

test("controller rejects preload/path/custom CA before any network", () => {
  for (const key of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    assert.throws(
      () => assertControllerEnvironment({ [key]: "/private/input" }, []),
      /disabled/,
    );
  assert.throws(
    () => assertControllerEnvironment({}, ["--import=evil"]),
    /disabled/,
  );
  assert.doesNotThrow(() => assertControllerEnvironment({}, []));
});
test("contained npm alias name is validated against exact lock name; changed version still rejects", async (t) => {
  const { d, links } = await fixture(t);
  const lock = JSON.parse(await readFile(join(d.root, "package-lock.json")));
  lock.packages["node_modules/tool"].name = "original-tool";
  await writeFile(join(d.root, "package-lock.json"), JSON.stringify(lock));
  await writeFile(
    join(d.root, "node_modules/tool/package.json"),
    JSON.stringify({ name: "original-tool", version: "1.0.0" }),
  );
  const seal = async () =>
    writeFile(
      d.manifestPath,
      JSON.stringify({
        ...EVENT_HOST_IDENTITY,
        entries: await inventoryEventHostTree(d.root, { links }),
      }),
    );
  await seal();
  await verifyEventHostResources(d, target);
  await writeFile(
    join(d.root, "node_modules/tool/package.json"),
    JSON.stringify({ name: "original-tool", version: "2.0.0" }),
  );
  await seal();
  await assert.rejects(verifyEventHostResources(d, target), /version drift/);
});
function syntheticArchive(items) {
  const chunks = [];
  for (const { name, data, type = 48, mode = 0o644 } of items) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12);
    header.fill(32, 148, 156);
    header[156] = type;
    const sum = [...header].reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
test("archive extractor rejects traversal/links/duplicates even when archive SHA512 matches supplied synthetic pins", () => {
  const bun = Buffer.from("synthetic engine: never run");
  const items = [
    { name: "package/bin/bun", data: bun, mode: 0o755 },
    {
      name: "package/package.json",
      data: Buffer.from(
        JSON.stringify({
          name: "@oven/bun-darwin-aarch64",
          version: "1.4.2",
          os: ["darwin"],
          cpu: ["arm64"],
        }),
      ),
    },
    { name: "package/README.md", data: Buffer.from("synthetic") },
  ];
  const pinned = (archive) => ({
    package: "@oven/bun-darwin-aarch64",
    version: "1.4.2",
    binarySha256: createHash("sha256").update(bun).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
  });
  const good = syntheticArchive(items);
  assert.deepEqual(extractPinnedBun(good, pinned(good)), bun);
  for (const badItems of [
    [...items, items[0]],
    [{ ...items[0], name: "../escape" }, ...items.slice(1)],
    [{ ...items[0], type: 49 }, ...items.slice(1)],
    [{ ...items[0], type: 50 }, ...items.slice(1)],
  ]) {
    const archive = syntheticArchive(badItems);
    assert.throws(() => extractPinnedBun(archive, pinned(archive)));
  }
});

test("configuration staged closure refuses an undeclared local dependency before destination publication", async (t) => {
  const opts = await stageFixture(t);
  for (const text of [
    'import "../undeclared.mjs";\nexport const synthetic=true;\n',
    'import { bad } from "../undeclared.mjs";\nexport const synthetic=bad;\n',
  ]) {
    await put(
      join(dirname(opts.hostSource), "host/configuration-save-kernel.mjs"),
      text,
    );
    await assert.rejects(
      stageEventHost({ ...opts, ...target }),
      /Unrecognized event host resource import graph/,
    );
  }
  await assert.rejects(
    lstat(eventHostForResources(opts.resources, "darwin", "arm64").root),
    { code: "ENOENT" },
  );
});

test("permission overlay is mandatory in newly staged resources with exact output and original preservation", async (t) => {
  const opts = await stageFixture(t);
  const before = await inventoryEventHostTree(opts.install, {
    links: (await loadRuntimeInputs(opts.packageDir)).pins.links,
  });
  const files = await Promise.all(
    NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
      path,
      content: await readFile(join(opts.install, path)),
    })),
  );
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    files,
  );
  const d = await stageEventHost({ ...opts, ...target });
  const manifest = await verifyEventHostResources(d, {
    ...target,
    requirePermissionOverlay: true,
  });
  assert.equal(manifest.permissionOverlay?.recipeSha256, plan.recipeSha256);
  assert.deepEqual(
    manifest.permissionOverlay.files,
    plan.files.map(({ path, beforeSha256, afterSha256 }) => ({
      path,
      beforeSha256,
      afterSha256,
    })),
  );
  for (const file of plan.files)
    assert.deepEqual(await readFile(join(d.root, file.path)), file.content);
  assert.deepEqual(
    await inventoryEventHostTree(opts.install, {
      links: (await loadRuntimeInputs(opts.packageDir)).pins.links,
    }),
    before,
  );
});
test("legacy resources remain verifiable but cannot satisfy required permission overlay", async (t) => {
  const { d } = await fixture(t);
  await verifyEventHostResources(d, target);
  await assert.rejects(
    verifyEventHostResources(d, { ...target, requirePermissionOverlay: true }),
    /overlay/i,
  );
});

for (const mutation of ["missing", "changed"]) {
  test(`overlay original ${mutation} refuses before destination writes without fallback`, async (t) => {
    const opts = await stageFixture(t);
    const file = join(
      opts.install,
      NATIVE_PERMISSION_OVERLAY_RECIPE.files[0].path,
    );
    if (mutation === "missing") await rm(file);
    else await writeFile(file, "changed vendor source\n");
    const pins = (await loadRuntimeInputs(opts.packageDir)).pins;
    const before = await inventoryEventHostTree(opts.install, {
      links: pins.links,
    });
    const receiptPath = join(opts.generated, "receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath));
    receipt.installEntries = before;
    await writeFile(receiptPath, JSON.stringify(receipt));
    await assert.rejects(
      stageEventHost({ ...opts, ...target }),
      /overlay original input drift/,
    );
    assert.deepEqual(await readdir(opts.resources), []);
    assert.deepEqual(
      await inventoryEventHostTree(opts.install, { links: pins.links }),
      before,
    );
  });
}
test("closed overlay receipt rejects forged metadata and manifest-consistent wrong output", async (t) => {
  const opts = await stageFixture(t);
  const d = await stageEventHost({ ...opts, ...target });
  const manifest = await verifyEventHostResources(d, target);
  for (const mutate of [
    (m) => {
      m.permissionOverlay.extra = true;
    },
    (m) => {
      m.permissionOverlay.recipeSha256 = "0".repeat(64);
    },
    (m) => {
      m.permissionOverlay.files.reverse();
    },
    (m) => {
      m.permissionOverlay.files[0].beforeSha256 = "0".repeat(64);
    },
    (m) => {
      m.permissionOverlay.files[0].extra = true;
    },
    (m) => {
      m.permissionOverlay.files.pop();
    },
    (m) => {
      m.permissionOverlay = null;
    },
  ]) {
    const forged = globalThis.structuredClone(manifest);
    mutate(forged);
    await writeFile(d.manifestPath, JSON.stringify(forged));
    await assert.rejects(verifyEventHostResources(d, target), /overlay/);
  }
  await writeFile(
    join(d.root, manifest.permissionOverlay.files[0].path),
    "forged output\n",
  );
  const forged = globalThis.structuredClone(manifest);
  forged.entries = await inventoryEventHostTree(d.root, {
    links: (await loadRuntimeInputs(opts.packageDir)).pins.links,
  });
  await writeFile(d.manifestPath, JSON.stringify(forged));
  await assert.rejects(verifyEventHostResources(d, target), /overlay output/);
});
test("checked legacy stage upgrades with retained original tree and packaged exact overlay", async (t) => {
  const opts = await stageFixture(t);
  const d = await stageEventHost({ ...opts, ...target });
  const pins = (await loadRuntimeInputs(opts.packageDir)).pins;
  const legacy = await verifyEventHostResources(d, target);
  delete legacy.permissionOverlay;
  for (const { path } of NATIVE_PERMISSION_OVERLAY_RECIPE.files)
    await writeFile(
      join(d.root, path),
      await readFile(join(opts.install, path)),
    );
  legacy.entries = await inventoryEventHostTree(d.root, { links: pins.links });
  await writeFile(d.manifestPath, JSON.stringify(legacy));
  await verifyEventHostResources(d, target);
  await stageEventHost({ ...opts, ...target });
  const current = await verifyEventHostResources(d, {
    ...target,
    requirePermissionOverlay: true,
  });
  const retained = (await readdir(opts.generated)).filter((n) =>
    n.startsWith("staged-retained-"),
  );
  assert.equal(retained.length, 1);
  const old = eventHostForResources(
    join(opts.generated, retained[0]),
    "darwin",
    "arm64",
  );
  assert.deepEqual(await verifyEventHostResources(old, target), legacy);
  await assert.rejects(
    verifyEventHostResources(old, {
      ...target,
      requirePermissionOverlay: true,
    }),
    /overlay/,
  );
  const destination = join(opts.generated, "packaged");
  await mkdir(destination);
  await copyPackagedResources({
    resources: opts.resources,
    destination,
    ...target,
  });
  assert.deepEqual(
    await verifyEventHostResources(
      eventHostForResources(destination, "darwin", "arm64"),
      { ...target, requirePermissionOverlay: true },
    ),
    current,
  );
});

test("resource import syntax ignores recipe strings/comments but checks real imports and reexports", () => {
  assert.deepEqual(
    localResourceImports(
      JSON.stringify({ data: 'import "./data.mjs"' }),
      "package.json",
    ),
    [],
  );
  const text = [
    `const recipe = { replace: 'import x from "./not-an-import.mjs"' };`,
    `// import "./comment.mjs";`,
    `import "./side-effect.mjs";`,
    `export { x } from "./reexport.mjs";`,
    `const value = import("./dynamic.mjs");`,
  ].join("\n");
  assert.deepEqual(localResourceImports(text), [
    "./side-effect.mjs",
    "./reexport.mjs",
    "./dynamic.mjs",
  ]);
  assert.deepEqual(localResourceImports('import("./unknown.mjs" + suffix)'), [
    "./unknown.mjs",
  ]);
  assert.throws(
    () => localResourceImports("import(`./${name}.mjs`)"),
    /dynamic resource import/,
  );
  assert.throws(
    () => localResourceImports("import {"),
    /Invalid resource module syntax/,
  );
});

test("resource public constants share one frozen source and include their staged pure module", async () => {
  const pure = await import("../src/event-host-code-assets.mjs"),
    publicModule = await import("../src/event-host-resources.mjs");
  for (const [key, value] of Object.entries(pure)) {
    assert.equal(publicModule[key], value);
    assert.ok(Object.isFrozen(value));
  }
  assert.ok(pure.EVENT_HOST_CODE_ASSETS.includes("event-host-code-assets.mjs"));
  assert.equal(
    new Set(pure.EVENT_HOST_CODE_ASSETS).size,
    pure.EVENT_HOST_CODE_ASSETS.length,
  );
});
