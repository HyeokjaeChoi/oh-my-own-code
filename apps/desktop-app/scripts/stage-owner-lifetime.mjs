import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ownerLifetimeForResources,
  verifyOwnerLifetimeResources,
} from "../src/owner-lifetime-resources.mjs";

const sourcePath = fileURLToPath(
  new URL("../native/owner-lifetime/witness.c", import.meta.url),
);
const target = "arm64-apple-macos11";
const compilerPath = "/usr/bin/clang";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runCompiler = (command, args, { input, ...options }) =>
  new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout) => {
      if (error) reject(new Error("Owner lifetime staging: compiler failed"));
      else resolve(stdout);
    });
    child.stdin.on("error", () =>
      reject(new Error("Owner lifetime staging: compiler input failed")),
    );
    child.stdin.end(input);
  });
async function sourceBytes() {
  if ((await realpath(sourcePath)) !== sourcePath)
    throw new Error("Owner lifetime staging: source symlink");
  const before = await lstat(sourcePath, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 1024n * 1024n)
    throw new Error("Owner lifetime staging: source identity");
  const file = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const bytes = await file.readFile();
    const same = (stat) =>
      ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => stat[key] === before[key],
      );
    if (
      !same(await file.stat({ bigint: true })) ||
      !same(await lstat(sourcePath, { bigint: true }))
    )
      throw new Error("Owner lifetime staging: source changed");
    return bytes;
  } finally {
    await file.close();
  }
}
async function flush(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
export async function stageOwnerLifetime({
  resources,
  platform = process.platform,
  arch = process.arch,
  compile = runCompiler,
} = {}) {
  const descriptor = ownerLifetimeForResources(resources, platform, arch);
  if ((await realpath(resources)) !== resources)
    throw new Error("Owner lifetime staging: canonical resources required");
  const source = await sourceBytes();
  const options = {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
    timeout: 30000,
    maxBuffer: 16384,
    encoding: "utf8",
  };
  const version = await compile(compilerPath, ["--version"], options);
  if (typeof version !== "string" || Buffer.byteLength(version) > 16384)
    throw new Error("Owner lifetime staging: compiler version bounds");
  const compiler = version.split(/\r?\n/, 1)[0];
  if (
    !compiler.startsWith("Apple clang version ") ||
    compiler.length > 256 ||
    [...compiler].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error("Owner lifetime staging: compiler identity");
  const sourceSha256 = sha(source);
  try {
    await lstat(descriptor.root);
    const { manifest } = await verifyOwnerLifetimeResources({
      resourcesPath: resources,
      platform,
      arch,
    });
    if (
      manifest.sourceSha256 !== sourceSha256 ||
      manifest.compiler !== compiler ||
      manifest.target !== target
    )
      throw new Error(
        "Owner lifetime staging: existing resource source/compiler drift",
      );
    return descriptor;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(dirname(descriptor.root), { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  // A parent may exist from an earlier failed stage. Never traverse an alias.
  if ((await realpath(dirname(descriptor.root))) !== dirname(descriptor.root))
    throw new Error("Owner lifetime staging: parent symlink");
  await mkdir(descriptor.root, { mode: 0o700 });
  const temporary = join(descriptor.root, "witness.compiling");
  await compile(
    compilerPath,
    [
      "-target",
      target,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-Wno-deprecated-declarations",
      "-x",
      "c",
      "-",
      "-lproc",
      "-o",
      temporary,
    ],
    {
      ...options,
      /* source is supplied below through a private bounded stdin */ input:
        source,
    },
  );
  if (sha(await sourceBytes()) !== sourceSha256)
    throw new Error("Owner lifetime staging: source drift during compile");
  const output = await lstat(temporary);
  if (
    !output.isFile() ||
    output.nlink !== 1 ||
    output.uid !== process.getuid() ||
    output.mode & 0o7022 ||
    output.size < 32 ||
    output.size > 4 * 1024 * 1024
  )
    throw new Error("Owner lifetime staging: compiled output identity");
  const fd = await open(
    temporary,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let executableSha256;
  try {
    const same = (s) =>
      [
        "dev",
        "ino",
        "uid",
        "mode",
        "size",
        "nlink",
        "mtimeMs",
        "ctimeMs",
      ].every((key) => s[key] === output[key]);
    if (!same(await fd.stat()))
      throw new Error("Owner lifetime staging: output replaced");
    const bytes = Buffer.alloc(output.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await fd.read(
        bytes,
        used,
        bytes.length - used,
        used,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (
      used !== output.size ||
      !same(await fd.stat()) ||
      !same(await lstat(temporary)) ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== 0x0100000c ||
      bytes.readUInt32LE(12) !== 2
    )
      throw new Error("Owner lifetime staging: output changed/target mismatch");
    executableSha256 = sha(bytes.subarray(0, used));
    await fd.chmod(0o700);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, descriptor.executable);
  const manifest = {
    version: 1,
    platform,
    arch,
    sourceSha256,
    compiler,
    target,
    executableSha256,
  };
  const mf = await open(
    descriptor.manifestPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await mf.writeFile(`${JSON.stringify(manifest)}\n`);
    await mf.sync();
  } finally {
    await mf.close();
  }
  await flush(descriptor.root);
  await flush(dirname(descriptor.root));
  await verifyOwnerLifetimeResources({
    resourcesPath: resources,
    platform,
    arch,
  });
  return descriptor;
}
