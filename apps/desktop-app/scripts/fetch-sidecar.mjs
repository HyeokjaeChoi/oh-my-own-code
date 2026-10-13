// Fetch the official OpenCode CLI package for a non-native target from the npm
// registry, verify it against the integrity pinned in pnpm-lock.yaml, and unpack
// ONLY the expected files. Nothing is executed. Used for cross-target layout checks
// (build.mjs reads the result through OMOC_SIDECAR_PACKAGE_DIR).
//   node scripts/fetch-sidecar.mjs win32-x64
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  sidecarBinaryName,
  sidecarPackageName,
} from "../src/sidecar-package.mjs";
import { downloadPublic } from "./prepare-event-host.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function lockedIntegrity(lockText, name, version) {
  const escaped = `${name}@${version}`.replace(/[/@.]/g, "\\$&");
  const match = new RegExp(
    `^  '${escaped}':\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/]{86}==)\\}`,
    "m",
  ).exec(lockText);
  if (!match)
    throw new Error("Sidecar package is not pinned in pnpm-lock.yaml");
  return match[1];
}

// Returns Map(name -> Buffer) of exactly package/package.json and package/bin/<binary>.
export function unpackSidecar(archive, integrity, binary) {
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (actual !== integrity)
    throw new Error("Sidecar archive integrity mismatch");
  const tar = gunzipSync(archive, { maxOutputLength: 400 * 1024 * 1024 });
  const expected = new Set(["package/package.json", `package/bin/${binary}`]);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (a, b) =>
      header.subarray(a, b).toString("utf8").split("\0")[0];
    const name = field(0, 100);
    const size = Number.parseInt(field(124, 136).trim(), 8);
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (
      checksum !== Number.parseInt(field(148, 156).trim(), 8) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !expected.has(name) ||
      files.has(name) ||
      ![0, 48].includes(header[156]) ||
      field(157, 257) ||
      offset + 512 + size > tar.length
    )
      throw new Error("Unsafe sidecar archive entry");
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (files.size !== expected.size)
    throw new Error("Incomplete sidecar archive");
  return files;
}

// The unpacked manifest must be exactly the package we asked for.
export function assertSidecarManifest(
  bytes,
  { name, version, platform, arch },
) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Sidecar package.json is not JSON");
  }
  const same = (value, expected) =>
    Array.isArray(value) && value.length === 1 && value[0] === expected;
  if (
    manifest?.name !== name ||
    manifest.version !== version ||
    !same(manifest.os, platform) ||
    !same(manifest.cpu, arch)
  )
    throw new Error("Sidecar package identity mismatch");
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const SIDECAR_RECEIPT = ".omoc-verified.json";
// build.mjs only honours OMOC_SIDECAR_PACKAGE_DIR for a directory that fetchSidecar
// produced: the receipt binds the locked archive integrity to the unpacked bytes.
export async function verifySidecarReceipt(
  packageDir,
  { lockText, name, version, binary },
) {
  const receipt = JSON.parse(
    await readFile(join(packageDir, SIDECAR_RECEIPT), "utf8"),
  );
  const bytes = await readFile(join(packageDir, "bin", binary));
  const manifest = await readFile(join(packageDir, "package.json"));
  if (
    receipt?.name !== name ||
    receipt.version !== version ||
    receipt.integrity !== lockedIntegrity(lockText, name, version) ||
    receipt.binarySha256 !== sha256(bytes) ||
    receipt.manifestSha256 !== sha256(manifest)
  )
    throw new Error(
      "Sidecar package directory is not the verified lockfile package",
    );
  return receipt;
}

export async function fetchSidecar(
  target,
  { outDir = join(root, "apps/desktop-app/.cross") } = {},
) {
  const [platform, arch] = target.split("-");
  const name = sidecarPackageName(platform, arch);
  const binary = sidecarBinaryName(platform);
  const version = JSON.parse(
    await readFile(join(root, "apps/desktop-app/package.json"), "utf8"),
  ).dependencies["@opencode/client"];
  const integrity = lockedIntegrity(
    await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
    name,
    version,
  );
  const url = `https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${version}.tgz`;
  const files = unpackSidecar(
    await downloadPublic(url, 400 * 1024 * 1024),
    integrity,
    binary,
  );
  assertSidecarManifest(files.get("package/package.json"), {
    name,
    version,
    platform,
    arch,
  });
  const packageDir = join(outDir, target, name);
  await mkdir(join(packageDir, "bin"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    files.get("package/package.json"),
  );
  await writeFile(
    join(packageDir, "bin", binary),
    files.get(`package/bin/${binary}`),
    { mode: 0o755 },
  );
  await writeFile(
    join(packageDir, SIDECAR_RECEIPT),
    `${JSON.stringify({ name, version, integrity, binarySha256: sha256(files.get(`package/bin/${binary}`)), manifestSha256: sha256(files.get("package/package.json")) }, null, 2)}\n`,
  );
  return packageDir;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error("Usage: fetch-sidecar.mjs <platform>-<arch>");
  console.log(await fetchSidecar(process.argv[2]));
}
