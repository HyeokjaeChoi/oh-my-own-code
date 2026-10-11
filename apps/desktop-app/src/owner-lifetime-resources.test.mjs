import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
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
  ownerLifetimeForResources,
  verifyOwnerLifetimeResources,
} from "./owner-lifetime-resources.mjs";

const target = { platform: "darwin", arch: "arm64" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const resourcesPath = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-lifetime-resource-")),
  );
  t.after(() => rm(resourcesPath, { recursive: true, force: true }));
  const descriptor = ownerLifetimeForResources(
    resourcesPath,
    "darwin",
    "arm64",
  );
  await mkdir(descriptor.root, { recursive: true, mode: 0o700 });
  // Synthetic header bytes exercise resource checks only; they are never executed.
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  await writeFile(descriptor.executable, bytes, { mode: 0o700 });
  const manifest = {
    version: 1,
    ...target,
    sourceSha256: sha("source"),
    compiler: "Apple clang version 17.0.0 (unit fixture)",
    target: "arm64-apple-macos11",
    executableSha256: sha(bytes),
  };
  await writeFile(descriptor.manifestPath, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  return {
    resourcesPath,
    descriptor,
    bytes,
    manifest,
    options: { resourcesPath, ...target },
  };
}
test("coordinated descriptor and verifier return only their fixed shapes", async (t) => {
  const { descriptor, options, manifest } = await fixture(t);
  assert.deepEqual(Object.keys(descriptor), [
    "root",
    "executable",
    "manifestPath",
  ]);
  const before = await readFile(descriptor.manifestPath);
  assert.deepEqual(await verifyOwnerLifetimeResources(options), {
    executable: descriptor.executable,
    manifest,
  });
  assert.deepEqual(await readFile(descriptor.manifestPath), before);
});
test("unsupported/missing target and relative resource reject without fallback", async () => {
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["win32", "x64"],
  ]) {
    assert.throws(
      () => ownerLifetimeForResources("/does-not-exist", platform, arch),
      /unsupported/,
    );
    await assert.rejects(
      verifyOwnerLifetimeResources({
        resourcesPath: "/does-not-exist",
        platform,
        arch,
      }),
      /unsupported/,
    );
  }
  assert.throws(
    () => ownerLifetimeForResources("relative", "darwin", "arm64"),
    /absolute/,
  );
  await assert.rejects(
    verifyOwnerLifetimeResources({
      resourcesPath: "/does-not-exist",
      ...target,
    }),
    /ENOENT/,
  );
});
for (const mutation of [
  "missing",
  "extra",
  "hash",
  "not-executable",
  "group-write",
  "special-mode",
  "hardlink",
  "symlink",
  "manifest-hardlink",
  "manifest-symlink",
  "manifest-write",
  "oversized-executable",
  "wrong-cpu",
  "script",
  "non-executable-macho",
]) {
  test(`reject resource ${mutation} and retain failed bytes`, async (t) => {
    const {
      descriptor: d,
      resourcesPath,
      options,
      manifest,
      bytes,
    } = await fixture(t);
    const outside = join(resourcesPath, "outside");
    if (mutation === "missing") await rm(d.executable);
    if (mutation === "extra")
      await writeFile(join(d.root, "extra"), "unexpected");
    if (mutation === "hash") await writeFile(d.executable, "changed");
    if (mutation === "not-executable") await chmod(d.executable, 0o600);
    if (mutation === "group-write") await chmod(d.executable, 0o720);
    if (mutation === "special-mode") await chmod(d.executable, 0o4700);
    if (mutation === "hardlink") await link(d.executable, outside);
    if (mutation === "symlink") {
      await writeFile(outside, bytes);
      await rm(d.executable);
      await symlink(outside, d.executable);
    }
    if (mutation === "manifest-hardlink") await link(d.manifestPath, outside);
    if (mutation === "manifest-symlink") {
      await writeFile(outside, JSON.stringify(manifest));
      await rm(d.manifestPath);
      await symlink(outside, d.manifestPath);
    }
    if (mutation === "manifest-write") await chmod(d.manifestPath, 0o620);
    if (mutation === "oversized-executable")
      await writeFile(d.executable, Buffer.alloc(4 * 1024 * 1024 + 1));
    if (
      mutation === "wrong-cpu" ||
      mutation === "script" ||
      mutation === "non-executable-macho"
    ) {
      let bad = bytes;
      if (mutation === "wrong-cpu") bad.writeUInt32LE(0x01000007, 4);
      if (mutation === "non-executable-macho") bad.writeUInt32LE(6, 12);
      if (mutation === "script") bad = Buffer.from("#!/bin/sh\nexit 0\n");
      await writeFile(d.executable, bad);
      manifest.executableSha256 = sha(bad);
      await writeFile(d.manifestPath, JSON.stringify(manifest));
    }
    const before = await readFile(d.manifestPath);
    await assert.rejects(verifyOwnerLifetimeResources(options));
    assert.deepEqual(await readFile(d.manifestPath), before);
  });
}
for (const mutation of [
  "unknown",
  "version",
  "platform",
  "arch",
  "source",
  "source-type",
  "executable-type",
  "compiler",
  "target",
  "duplicate",
  "escaped-duplicate",
  "invalid-json",
  "large",
  "utf8",
]) {
  test(`reject manifest ${mutation}`, async (t) => {
    const { descriptor, options, manifest } = await fixture(t);
    if (mutation === "unknown") manifest.extra = true;
    if (mutation === "version") manifest.version = 2;
    if (mutation === "platform") manifest.platform = "linux";
    if (mutation === "arch") manifest.arch = "x64";
    if (mutation === "source") manifest.sourceSha256 = "unknown";
    if (mutation === "source-type")
      manifest.sourceSha256 = [manifest.sourceSha256];
    if (mutation === "executable-type")
      manifest.executableSha256 = [manifest.executableSha256];
    if (mutation === "compiler") manifest.compiler = "arbitrary compiler";
    if (mutation === "target") manifest.target = "x86_64-apple-macos11";
    let raw = JSON.stringify(manifest);
    if (mutation === "duplicate")
      raw = raw.replace('{"version":1', '{"version":1,"version":1');
    if (mutation === "escaped-duplicate")
      raw = raw.replace('{"version":1', '{"version":1,"\\u0076ersion":1');
    if (mutation === "invalid-json") raw = "{";
    if (mutation === "large") raw += " ".repeat(4097);
    if (mutation === "utf8")
      raw = Buffer.concat([Buffer.from(raw), Buffer.from([0xff])]);
    await writeFile(descriptor.manifestPath, raw);
    await assert.rejects(verifyOwnerLifetimeResources(options));
  });
}
test("symlink resource parent is rejected", async (t) => {
  const { resourcesPath, options } = await fixture(t);
  const alias = join(resourcesPath, "alias");
  await symlink(resourcesPath, alias);
  await assert.rejects(
    verifyOwnerLifetimeResources({ ...options, resourcesPath: alias }),
    /parent/,
  );
});
