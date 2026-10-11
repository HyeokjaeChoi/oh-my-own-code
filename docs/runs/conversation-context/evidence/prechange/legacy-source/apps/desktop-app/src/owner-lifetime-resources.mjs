// Verifies packaged bytes only. This module never compiles or executes a helper.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

const TARGET = "arm64-apple-macos11";
const MAX_MANIFEST = 4096;
const MAX_EXECUTABLE = 4 * 1024 * 1024;
const fail = (reason) => {
  throw new Error(`Owner lifetime resources: ${reason}`);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function target(platform, arch) {
  if (platform !== "darwin" || arch !== "arm64") fail("unsupported target");
}
export function ownerLifetimeForResources(resourcesPath, platform, arch) {
  target(platform, arch);
  if (
    typeof resourcesPath !== "string" ||
    !isAbsolute(resourcesPath) ||
    resourcesPath.includes("\0")
  )
    fail("absolute resourcesPath required");
  const root = join(resourcesPath, "owner-lifetime", "darwin-arm64");
  return Object.freeze({
    root,
    executable: join(root, "witness"),
    manifestPath: join(root, "manifest.json"),
  });
}
function same(a, b) {
  return [
    "dev",
    "ino",
    "uid",
    "gid",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ].every((key) => a[key] === b[key]);
}
async function parents(path) {
  let current = sep;
  const snapshots = [];
  for (const part of resolve(path).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail("symlink or non-directory parent");
    snapshots.push([current, stat]);
  }
  return snapshots;
}
async function checkedFile(path, maximum, executable) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid()) ||
    before.size < 1n ||
    before.size > BigInt(maximum) ||
    before.mode & 0o7022n ||
    (executable && !(before.mode & 0o100n))
  )
    fail("bounded owned single-link file/mode required");
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!same(before, await handle.stat({ bigint: true })))
      fail("file replaced before read");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (
      length !== Number(before.size) ||
      !same(before, await handle.stat({ bigint: true })) ||
      !same(before, await lstat(path, { bigint: true }))
    )
      fail("file changed during read");
    return { bytes: bytes.subarray(0, length), stat: before };
  } finally {
    await handle.close();
  }
}
function parseManifest(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) fail("invalid manifest encoding");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("invalid manifest JSON");
  }
  const expected = [
    "version",
    "platform",
    "arch",
    "sourceSha256",
    "compiler",
    "target",
    "executableSha256",
  ].sort();
  // All values are primitives. Count decoded member names to reject duplicate keys,
  // including escaped aliases; JSON.parse alone silently accepts those duplicates.
  const members = [...text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map((m) =>
    JSON.parse(m[1]),
  );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== expected.join() ||
    members.length !== 7 ||
    new Set(members).size !== 7
  )
    fail("closed seven-key manifest required");
  if (
    value.version !== 1 ||
    value.platform !== "darwin" ||
    value.arch !== "arm64" ||
    value.target !== TARGET ||
    typeof value.sourceSha256 !== "string" ||
    typeof value.executableSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
    !/^[a-f0-9]{64}$/.test(value.executableSha256) ||
    typeof value.compiler !== "string" ||
    !value.compiler.startsWith("Apple clang version ") ||
    value.compiler.length > 256 ||
    [...value.compiler].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    fail("manifest identity/target mismatch");
  return Object.freeze(value);
}
export async function verifyOwnerLifetimeResources({
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const descriptor = ownerLifetimeForResources(resourcesPath, platform, arch);
  const directories = await parents(descriptor.root);
  if (
    (await readdir(descriptor.root)).sort().join() !== "manifest.json,witness"
  )
    fail("fixed resource files required");
  const manifestFile = await checkedFile(
    descriptor.manifestPath,
    MAX_MANIFEST,
    false,
  );
  const manifest = parseManifest(manifestFile.bytes);
  const executableFile = await checkedFile(
    descriptor.executable,
    MAX_EXECUTABLE,
    true,
  );
  const bytes = executableFile.bytes;
  // Thin little-endian 64-bit Mach-O, ARM64, executable. No scripts/fat/x64 fallback.
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x0100000c ||
    bytes.readUInt32LE(12) !== 2 ||
    digest(bytes) !== manifest.executableSha256
  )
    fail("executable hash/target mismatch");
  for (const [path, stat] of directories) {
    const current = await lstat(path, { bigint: true });
    if (
      !(path === descriptor.root
        ? same(stat, current)
        : ["dev", "ino", "uid", "gid", "mode"].every(
            (key) => stat[key] === current[key],
          ))
    )
      fail("resource parent changed");
  }
  const manifestAgain = await checkedFile(
    descriptor.manifestPath,
    MAX_MANIFEST,
    false,
  );
  const executableAgain = await checkedFile(
    descriptor.executable,
    MAX_EXECUTABLE,
    true,
  );
  if (
    !same(manifestFile.stat, manifestAgain.stat) ||
    !manifestFile.bytes.equals(manifestAgain.bytes) ||
    !same(executableFile.stat, executableAgain.stat) ||
    !bytes.equals(executableAgain.bytes) ||
    (await readdir(descriptor.root)).sort().join() !== "manifest.json,witness"
  )
    fail("resource snapshot changed");
  return Object.freeze({ executable: descriptor.executable, manifest });
}
