import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageOwnerLifetime } from "./stage-owner-lifetime.mjs";
import {
  ownerLifetimeForResources,
  verifyOwnerLifetimeResources,
} from "../src/owner-lifetime-resources.mjs";

const target = { platform: "darwin", arch: "arm64" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const resources = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-lifetime-stage-")),
  );
  t.after(() => rm(resources, { recursive: true, force: true }));
  const calls = [];
  const compile = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "--version")
      return "Apple clang version 17.0.0 (unit fixture)\nTarget: arm64-apple-darwin\n";
    const bytes = Buffer.alloc(64);
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(0x0100000c, 4);
    bytes.writeUInt32LE(2, 12);
    await writeFile(args.at(-1), bytes, { mode: 0o700 });
    return "";
  };
  return { resources, calls, compile, ...target };
}
test("stage fixed files, source/compiler provenance, bounded clean compiler options; exact repeat reuses", async (t) => {
  const opts = await fixture(t);
  const d = await stageOwnerLifetime(opts);
  assert.deepEqual(
    d,
    ownerLifetimeForResources(opts.resources, "darwin", "arm64"),
  );
  assert.deepEqual((await readdir(d.root)).sort(), [
    "manifest.json",
    "witness",
  ]);
  assert.equal(opts.calls.length, 2);
  const [version, compile] = opts.calls;
  assert.equal(version.command, "/usr/bin/clang");
  assert.equal(compile.command, "/usr/bin/clang");
  assert.deepEqual(compile.args.slice(0, 2), [
    "-target",
    "arm64-apple-macos11",
  ]);
  assert.ok(compile.args.includes("-lproc"));
  assert.equal(compile.options.timeout, 30000);
  assert.equal(compile.options.maxBuffer, 16384);
  assert.deepEqual(compile.options.env, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LC_ALL: "C",
  });
  assert.equal(compile.options.shell, undefined);
  assert.ok(Buffer.isBuffer(compile.options.input));
  const { manifest } = await verifyOwnerLifetimeResources({
    resourcesPath: opts.resources,
    ...target,
  });
  assert.equal(manifest.sourceSha256, sha(compile.options.input));
  assert.equal(manifest.executableSha256, sha(await readFile(d.executable)));
  assert.equal(Object.keys(manifest).length, 7);
  assert.deepEqual(await stageOwnerLifetime(opts), d);
  assert.equal(opts.calls.length, 3); // Only compiler identity is read on reuse.
});
test("unsupported stage target rejects before compiler or directory work", async (t) => {
  const opts = await fixture(t);
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["darwin", "x64"],
  ])
    await assert.rejects(
      stageOwnerLifetime({ ...opts, platform, arch }),
      /unsupported/,
    );
  assert.equal(opts.calls.length, 0);
  assert.deepEqual(await readdir(opts.resources), []);
});
test("compiler identity rejects before staging", async (t) => {
  const opts = await fixture(t);
  for (const response of [
    "unknown",
    "Apple clang version " + "x".repeat(257),
    "Apple clang version \0",
    "x".repeat(16385),
  ])
    await assert.rejects(
      stageOwnerLifetime({ ...opts, compile: async () => response }),
      /compiler/,
    );
  assert.deepEqual(await readdir(opts.resources), []);
});
for (const mutation of [
  "compiler-failure",
  "output-hardlink",
  "output-symlink",
  "output-target",
  "output-mode",
]) {
  test(`failed stage preserves partial output and never publishes manifest: ${mutation}`, async (t) => {
    const opts = await fixture(t);
    const original = opts.compile;
    opts.compile = async (command, args, options) => {
      if (args[0] === "--version") return original(command, args, options);
      if (mutation === "compiler-failure") {
        await writeFile(args.at(-1), "partial");
        throw new Error("compiler failed");
      }
      await original(command, args, options);
      if (mutation === "output-hardlink")
        await link(args.at(-1), join(opts.resources, "outside"));
      if (mutation === "output-symlink") {
        await rm(args.at(-1));
        await symlink(join(opts.resources, "outside"), args.at(-1));
      }
      if (mutation === "output-target")
        await writeFile(args.at(-1), "not a Mach-O");
      if (mutation === "output-mode") await chmod(args.at(-1), 0o4700);
      return "";
    };
    await assert.rejects(stageOwnerLifetime(opts));
    const d = ownerLifetimeForResources(opts.resources, "darwin", "arm64");
    await assert.rejects(readFile(d.manifestPath), /ENOENT/);
    assert.ok((await readdir(d.root)).length > 0);
  });
}
test("existing source/compiler drift or corruption stays intact", async (t) => {
  const opts = await fixture(t);
  const d = await stageOwnerLifetime(opts);
  const manifest = JSON.parse(await readFile(d.manifestPath));
  manifest.sourceSha256 = sha("different source");
  await writeFile(d.manifestPath, JSON.stringify(manifest));
  const before = await readFile(d.manifestPath);
  await assert.rejects(stageOwnerLifetime(opts), /drift/);
  assert.deepEqual(await readFile(d.manifestPath), before);
  assert.equal(opts.calls.length, 3);
});
test("symlink stage parent rejects without compiler output", async (t) => {
  const opts = await fixture(t);
  const outside = join(opts.resources, "outside");
  await mkdir(outside);
  await symlink(outside, join(opts.resources, "owner-lifetime"));
  await assert.rejects(stageOwnerLifetime(opts), /symlink/);
  assert.deepEqual(await readdir(outside), []);
  assert.equal(opts.calls.length, 1);
});
test(
  "actual local clang compiles and verifies helper without executing it",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  async (t) => {
    const opts = await fixture(t);
    const d = await stageOwnerLifetime({ resources: opts.resources });
    const { manifest, executable } = await verifyOwnerLifetimeResources({
      resourcesPath: opts.resources,
    });
    assert.equal(executable, d.executable);
    assert.equal(manifest.target, "arm64-apple-macos11");
    assert.match(manifest.compiler, /^Apple clang version /);
    assert.ok((await readFile(executable)).length > 64);
  },
);
