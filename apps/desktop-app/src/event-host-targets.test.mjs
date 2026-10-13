import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  EVENT_HOST_TARGETS,
  assertEventHostTarget,
  eventHostEnginePath,
  eventHostForResources,
  eventHostIdentity,
  inventoryEventHostTree,
  verifyEventHostResources,
} from "./event-host-resources.mjs";
import { syntheticRuntimeLock } from "../scripts/build-provenance-test-fixture.mjs";

const put = async (root, path, bytes) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes, { mode: 0o600 });
};
async function windowsFixture(t) {
  const resources = await realpath(await mkdtemp(join(tmpdir(), "omoc-ehw-")));
  t.after(() => rm(resources, { recursive: true, force: true }));
  const descriptor = eventHostForResources(resources, "win32", "x64");
  for (const path of [
    "host.mjs",
    "event-host-protocol.mjs",
    "runtime/bun.exe",
    "node_modules/tool/bin/tool.js",
  ])
    await put(descriptor.root, path, `synthetic ${path}\n`);
  await syntheticRuntimeLock(descriptor.root);
  const write = async () => {
    const entries = await inventoryEventHostTree(descriptor.root, {
      platform: "win32",
    });
    await put(
      descriptor.root,
      "manifest.json",
      `${JSON.stringify({ ...eventHostIdentity("win32", "x64"), entries })}\n`,
    );
    return entries;
  };
  return { descriptor, write };
}

test("target table is closed and names the Windows engine", () => {
  assert.deepEqual(Object.keys(EVENT_HOST_TARGETS), [
    "darwin-arm64",
    "win32-x64",
  ]);
  assert.equal(assertEventHostTarget("win32", "x64").engine, "runtime/bun.exe");
  assert.equal(
    assertEventHostTarget("win32", "x64").bunPackage,
    "@oven/bun-windows-x64",
  );
  for (const [p, a] of [
    ["win32", "arm64"],
    ["linux", "x64"],
    ["darwin", "x64"],
    ["__proto__", "x"],
  ])
    assert.throws(() => assertEventHostTarget(p, a), /unsupported target/);
  const d = eventHostForResources("/r", "win32", "x64");
  assert.equal(d.root, "/r/opencode/event-host/win32-x64");
  assert.equal(d.enginePath, eventHostEnginePath(d.root, "win32", "x64"));
  assert.equal(
    eventHostForResources("/r", "darwin", "arm64").enginePath,
    "/r/opencode/event-host/darwin-arm64/runtime/bun",
  );
});

test("win32 manifests use canonical modes regardless of host mode bits", async (t) => {
  const { descriptor, write } = await windowsFixture(t);
  await chmod(join(descriptor.root, "host.mjs"), 0o600);
  await chmod(join(descriptor.root, "runtime/bun.exe"), 0o600);
  const entries = await write();
  const mode = (path) => entries.find((e) => e.path === path).mode;
  assert.equal(mode("runtime/bun.exe"), 0o755);
  assert.equal(mode("host.mjs"), 0o644);
  assert.equal(mode("runtime"), 0o755);
  const manifest = await verifyEventHostResources(descriptor, {
    platform: "win32",
    arch: "x64",
  });
  assert.equal(manifest.platform, "win32");
  assert.equal(manifest.arch, "x64");
});

test("win32 verification still rejects drift, links and foreign identity", async (t) => {
  const { descriptor, write } = await windowsFixture(t);
  await write();
  await verifyEventHostResources(descriptor, {
    platform: "win32",
    arch: "x64",
  });
  await assert.rejects(
    verifyEventHostResources(descriptor, { platform: "darwin", arch: "arm64" }),
    /invalid closed descriptor/,
  );
  await writeFile(join(descriptor.root, "host.mjs"), "tampered\n");
  await assert.rejects(
    verifyEventHostResources(descriptor, { platform: "win32", arch: "x64" }),
    /drift/,
  );
  await write();
  await symlink("host.mjs", join(descriptor.root, "extra-link"));
  await assert.rejects(
    inventoryEventHostTree(descriptor.root, { platform: "win32" }),
    /undeclared or changed symlink/,
  );
});

import {
  generatedDir,
  loadRuntimeInputs,
  pinsFileName,
} from "../scripts/prepare-event-host.mjs";
test("committed pins load per target; win32 has no links and official win32 package", async () => {
  const win = await loadRuntimeInputs(undefined, "win32", "x64");
  assert.equal(win.pins.bun.package, "@oven/bun-windows-x64");
  assert.deepEqual(win.pins.links, {});
  assert.equal(win.pins.node, undefined);
  const mac = await loadRuntimeInputs(undefined, "darwin", "arm64");
  assert.equal(Object.keys(mac.pins.links).length, 31);
  assert.equal(win.pins.packageSha256, mac.pins.packageSha256);
  assert.equal(win.pins.lockSha256, mac.pins.lockSha256);
  await assert.rejects(
    loadRuntimeInputs(undefined, "win32", "arm64"),
    /unsupported target/,
  );
  await assert.rejects(
    loadRuntimeInputs(undefined, "darwin", "arm64").then(() => {
      throw new Error("ok");
    }),
    /ok/,
  );
  assert.equal(pinsFileName("darwin", "arm64"), "installer-pins.json");
  assert.equal(pinsFileName("win32", "x64"), "installer-pins.win32-x64.json");
  assert.match(generatedDir("/p", "win32", "x64"), /\.generated-win32-x64$/);
  assert.match(generatedDir("/p", "darwin", "arm64"), /\.generated$/);
});
