// Pure resource verification. Never loads the engine or any installed package.
import { matchesNativePermissionOverlay } from "./native-permission-overlay-contract.mjs";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CONFIGURATION_SAVE_ASSETS,
  NATIVE_SKILLS_ASSETS,
  NATIVE_AGENTS_ASSETS,
  NATIVE_EXTENSIONS_ASSETS,
  GIT_BRANCH_RESTORE_ASSETS,
  GIT_COMMIT_ASSETS,
  GIT_INDEX_ASSETS,
  EVENT_HOST_CODE_ASSETS,
} from "./event-host-code-assets.mjs";
export {
  CONFIGURATION_SAVE_ASSETS,
  NATIVE_SKILLS_ASSETS,
  NATIVE_AGENTS_ASSETS,
  NATIVE_EXTENSIONS_ASSETS,
  GIT_BRANCH_RESTORE_ASSETS,
  GIT_COMMIT_ASSETS,
  GIT_INDEX_ASSETS,
  EVENT_HOST_CODE_ASSETS,
};

export const EVENT_HOST_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
export const EVENT_HOST_LIMITS = Object.freeze({
  entries: 100000,
  bytes: 2 * 1024 ** 3,
  depth: 64,
});
export const EVENT_HOST_IDENTITY = Object.freeze({
  schemaVersion: 1,
  kind: "opencode-event-host",
  platform: "darwin",
  arch: "arm64",
  bunVersion: "1.4.2",
  serverVersion: "2.0.18",
  effectVersion: "4.0.0-rc.112",
});
// Closed target table. Anything not listed holds (fail closed).
export const EVENT_HOST_TARGETS = Object.freeze({
  "darwin-arm64": Object.freeze({
    platform: "darwin",
    arch: "arm64",
    engine: "runtime/bun",
    bunPackage: "@oven/bun-darwin-aarch64",
    bunBinary: "bin/bun",
  }),
  "win32-x64": Object.freeze({
    platform: "win32",
    arch: "x64",
    engine: "runtime/bun.exe",
    bunPackage: "@oven/bun-windows-x64",
    bunBinary: "bin/bun.exe",
  }),
});
export const eventHostIdentity = (platform, arch) =>
  Object.freeze({ ...EVENT_HOST_IDENTITY, platform, arch });
export const eventHostTargetName = (platform, arch) => `${platform}-${arch}`;
const keys = (object, expected) =>
  object &&
  typeof object === "object" &&
  !Array.isArray(object) &&
  Object.keys(object).sort().join() === [...expected].sort().join();
const fail = (message) => {
  throw new Error(`Event host resources: ${message}`);
};
export function assertEventHostTarget(platform, arch) {
  const target = Object.hasOwn(EVENT_HOST_TARGETS, `${platform}-${arch}`)
    ? EVENT_HOST_TARGETS[`${platform}-${arch}`]
    : undefined;
  if (!target) fail(`unsupported target ${platform}-${arch}; hold required`);
  return target;
}
export const eventHostEnginePath = (root, platform, arch) =>
  join(root, assertEventHostTarget(platform, arch).engine);
export function eventHostForResources(resources, platform, arch) {
  const target = assertEventHostTarget(platform, arch);
  if (typeof resources !== "string" || !isAbsolute(resources))
    fail("resources must be absolute");
  const root = join(
    resources,
    "opencode",
    "event-host",
    eventHostTargetName(platform, arch),
  );
  return Object.freeze({
    root,
    enginePath: join(root, target.engine),
    hostPath: join(root, "host.mjs"),
    manifestPath: join(root, "manifest.json"),
  });
}
export function eventHostInventorySha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function safeResourcePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..") ||
    value.split("/").length > EVENT_HOST_LIMITS.depth
  )
    fail("invalid relative path");
  return value;
}
const contained = (root, path) => {
  const rel = relative(root, path);
  return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export async function assertRealResourceParents(path) {
  path = resolve(path);
  const { root } = parse(path);
  const parts = path.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail("symlink or non-directory parent");
  }
}
function unchanged(a, b) {
  return (
    a.ino === b.ino &&
    a.dev === b.dev &&
    a.size === b.size &&
    a.mode === b.mode &&
    a.nlink === b.nlink &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
// Per-process digest memo keyed by path + full stat identity; any stat change re-hashes.
const SHA_MEMO_MAX = 100_000;
const shaMemo = new Map();
const statKey = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
export async function resourceFileSha256(path) {
  const big = { bigint: true };
  const before = await lstat(path, big);
  if (!before.isFile() || before.nlink !== 1n)
    fail("regular single-link file required");
  const key = statKey(before);
  if (shaMemo.get(path)?.key === key) return shaMemo.get(path).digest;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat(big)))
      fail("file changed before read");
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({
      autoClose: false,
      highWaterMark: 4 << 20,
    }))
      hash.update(bytes);
    if (
      !unchanged(before, await handle.stat(big)) ||
      !unchanged(before, await lstat(path, big))
    )
      fail("file changed while hashing");
    const digest = hash.digest("hex");
    if (shaMemo.size >= SHA_MEMO_MAX) shaMemo.clear();
    shaMemo.set(path, { key, digest });
    return digest;
  } finally {
    await handle.close();
  }
}
export async function readResourceJson(
  path,
  maxBytes = EVENT_HOST_MANIFEST_MAX_BYTES,
) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
    fail("bounded regular JSON file required");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat()))
      fail("JSON changed before read");
    const data = await handle.readFile();
    if (
      data.length > maxBytes ||
      !unchanged(before, await handle.stat()) ||
      !unchanged(before, await lstat(path))
    )
      fail("JSON changed during read");
    return JSON.parse(data.toString("utf8"));
  } finally {
    await handle.close();
  }
}
// Links are leaves: inspect every target component without ever traversing a link.
async function checkLink(root, path, target) {
  if (
    typeof target !== "string" ||
    !target ||
    target.includes("\\") ||
    target.includes("\0") ||
    isAbsolute(target)
  )
    fail("invalid symlink target");
  const absolute = resolve(dirname(join(root, path)), target);
  if (!contained(root, absolute)) fail("symlink escape");
  let current = root;
  const parts = relative(root, absolute).split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()))
      fail("symlink chain or invalid target");
    if (i === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1))
      fail("symlink must target contained single-link file");
  }
}
// NTFS has no POSIX mode: win32 manifests record canonical modes so a tree
// staged on any host verifies identically on Windows. Only the engine is "executable".
const canonicalWindowsMode = (path, directory) =>
  directory
    ? 0o755
    : path === EVENT_HOST_TARGETS["win32-x64"].engine
      ? 0o755
      : 0o644;
export async function inventoryEventHostTree(
  root,
  { links = {}, platform = process.platform } = {},
) {
  const windows = platform === "win32";
  await assertRealResourceParents(root);
  const entries = [];
  let bytes = 0;
  async function walk(directory, depth) {
    if (depth > EVENT_HOST_LIMITS.depth) fail("depth limit");
    const before = await lstat(directory);
    const visit = async (name) => {
      const path = relative(root, join(directory, name)).split(sep).join("/");
      if (path === "manifest.json") return;
      safeResourcePath(path);
      if (entries.length >= EVENT_HOST_LIMITS.entries) fail("entry limit");
      const absolute = join(root, path);
      const stat = await lstat(absolute);
      const mode = windows
        ? canonicalWindowsMode(path, stat.isDirectory())
        : stat.mode & 0o7777;
      if (mode & 0o7000) fail("special mode rejected");
      if (stat.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (
          !Object.hasOwn(links, path) ||
          links[path].target !== target ||
          stat.nlink !== 1
        )
          fail("undeclared or changed symlink");
        await checkLink(root, path, target);
        if (
          links[path].target_sha256 &&
          (await resourceFileSha256(resolve(dirname(absolute), target))) !==
            links[path].target_sha256
        )
          fail("symlink target hash drift");
        entries.push({ path, type: "symlink", mode, nlink: 1, target });
      } else if (stat.isDirectory()) {
        entries.push({ path, type: "directory", mode });
        await walk(absolute, depth + 1);
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) fail("hardlink rejected");
        bytes += stat.size;
        if (bytes > EVENT_HOST_LIMITS.bytes) fail("byte limit");
        entries.push({
          path,
          type: "file",
          mode,
          nlink: 1,
          size: stat.size,
          sha256: await resourceFileSha256(absolute),
        });
      } else fail("unknown file type");
      if (!unchanged(stat, await lstat(absolute)))
        fail("entry changed during inventory");
    };
    // Bounded fan-out: entries are sorted at the end, so visit order is free.
    const names = (await readdir(directory)).sort();
    for (let i = 0; i < names.length; i += 16)
      await Promise.all(names.slice(i, i + 16).map(visit));
    if (!unchanged(before, await lstat(directory)))
      fail("directory changed during inventory");
  }
  await walk(root, 0);
  for (const path of Object.keys(links))
    if (!entries.some((e) => e.path === path && e.type === "symlink"))
      fail("missing declared symlink");
  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
function validateManifest(manifest, target) {
  if (
    !keys(manifest, [
      ...Object.keys(EVENT_HOST_IDENTITY),
      "entries",
      ...(Object.hasOwn(manifest, "permissionOverlay")
        ? ["permissionOverlay"]
        : []),
    ])
  )
    fail("unknown manifest fields");
  for (const [key, value] of Object.entries(
    eventHostIdentity(target.platform, target.arch),
  ))
    if (manifest[key] !== value)
      fail(`identity/version/target mismatch: ${key}`);
  if (
    !Array.isArray(manifest.entries) ||
    !manifest.entries.length ||
    manifest.entries.length > EVENT_HOST_LIMITS.entries
  )
    fail("entry limit");
  if (Object.hasOwn(manifest, "permissionOverlay")) {
    if (!matchesNativePermissionOverlay(manifest.permissionOverlay))
      fail("invalid permission overlay receipt");
    if (
      !manifest.entries.some(
        (entry) =>
          entry.path === "native-permission-overlay-contract.mjs" &&
          entry.type === "file",
      )
    )
      fail("missing permission overlay contract");
    for (const file of manifest.permissionOverlay.files) {
      const entry = manifest.entries?.find((e) => e.path === file.path);
      if (entry?.type !== "file" || entry.sha256 !== file.afterSha256)
        fail("permission overlay output mismatch");
    }
  }
  const seen = new Set();
  let bytes = 0;
  let previous = "";
  for (const entry of manifest.entries) {
    safeResourcePath(entry.path);
    if (
      entry.path === "manifest.json" ||
      seen.has(entry.path) ||
      entry.path <= previous
    )
      fail("duplicate or unordered manifest path");
    seen.add(entry.path);
    previous = entry.path;
    const fields =
      entry.type === "file"
        ? ["path", "type", "mode", "nlink", "size", "sha256"]
        : entry.type === "directory"
          ? ["path", "type", "mode"]
          : entry.type === "symlink"
            ? ["path", "type", "mode", "nlink", "target"]
            : [];
    if (
      !fields.length ||
      !keys(entry, fields) ||
      !Number.isInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o777
    )
      fail("unknown or invalid entry");
    if (entry.type !== "directory" && entry.nlink !== 1) fail("nlink drift");
    if (entry.type === "file") {
      if (
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        fail("invalid file identity");
      bytes += entry.size;
      if (bytes > EVENT_HOST_LIMITS.bytes) fail("byte limit");
    }
  }
  for (const path of [
    target.engine,
    "host.mjs",
    "event-host-protocol.mjs",
    "package.json",
    "package-lock.json",
    "node_modules/@opencode/server/package.json",
    "node_modules/@opencode/client/package.json",
    "node_modules/effect/package.json",
  ])
    if (!manifest.entries.some((e) => e.path === path && e.type === "file"))
      fail(`missing required asset ${path}`);
  if (!(manifest.entries.find((e) => e.path === target.engine).mode & 0o111))
    fail("engine not executable");
}
export async function verifyLockedEventHostPackages(
  root,
  entries,
  target = EVENT_HOST_TARGETS["darwin-arm64"],
) {
  const pkg = await readResourceJson(join(root, "package.json"));
  const lock = await readResourceJson(join(root, "package-lock.json"));
  const expected = {
    "@opencode/server": "2.0.18",
    "@opencode/client": "2.0.18",
    effect: "4.0.0-rc.112",
  };
  const sorted = (value) => JSON.stringify(Object.entries(value ?? {}).sort());
  if (
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    pkg.scripts ||
    lock.packages[""].scripts ||
    sorted(pkg.dependencies) !== sorted(expected) ||
    sorted(lock.packages[""].dependencies) !== sorted(expected)
  )
    fail("runtime package/lock version mismatch");
  const present = new Set();
  for (const entry of entries.filter(
    (e) =>
      e.type === "file" &&
      /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(e.path),
  )) {
    const path = entry.path.slice(0, -"/package.json".length);
    const locked = lock.packages[path];
    const actual = await readResourceJson(join(root, entry.path));
    const name = path.slice(
      path.lastIndexOf("node_modules/") + "node_modules/".length,
    );
    if (
      !locked ||
      actual.name !== (locked.name ?? name) ||
      actual.version !== locked.version
    )
      fail(`unknown/package version drift ${path}`);
    present.add(path);
  }
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue;
    safeResourcePath(path);
    let url;
    try {
      url = new URL(item.resolved);
    } catch {
      fail("invalid locked origin");
    }
    if (
      !path.startsWith("node_modules/") ||
      item.link ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(item.version) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) ||
      url.origin !== "https://registry.npmjs.org" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(".tgz")
    )
      fail("invalid locked identity/origin/integrity");
    const allows = (list, target) =>
      !list ||
      ((!list.some((x) => !x.startsWith("!")) || list.includes(target)) &&
        !list.includes(`!${target}`));
    const selected =
      allows(item.os, target.platform) && allows(item.cpu, target.arch);
    if ((selected && !present.has(path)) || (!selected && present.has(path)))
      fail(`missing or wrong-target locked package ${path}`);
  }
}

export async function verifyEventHostResources(
  descriptor,
  {
    platform = process.platform,
    arch = process.arch,
    requirePermissionOverlay = false,
  } = {},
) {
  const target = assertEventHostTarget(platform, arch);
  if (
    !keys(descriptor, ["root", "enginePath", "hostPath", "manifestPath"]) ||
    !isAbsolute(descriptor.root) ||
    !descriptor.root.endsWith(
      `${sep}opencode${sep}event-host${sep}${eventHostTargetName(platform, arch)}`,
    ) ||
    descriptor.enginePath !== join(descriptor.root, target.engine) ||
    descriptor.hostPath !== join(descriptor.root, "host.mjs") ||
    descriptor.manifestPath !== join(descriptor.root, "manifest.json")
  )
    fail("invalid closed descriptor");
  await assertRealResourceParents(descriptor.root);
  const manifest = await readResourceJson(descriptor.manifestPath);
  validateManifest(manifest, target);
  if (typeof requirePermissionOverlay !== "boolean")
    fail("invalid permission overlay requirement");
  if (requirePermissionOverlay && !manifest.permissionOverlay)
    fail("required permission overlay missing");
  const links = Object.fromEntries(
    manifest.entries
      .filter((e) => e.type === "symlink")
      .map((e) => [e.path, { target: e.target }]),
  );
  const actual = await inventoryEventHostTree(descriptor.root, {
    links,
    platform,
  });
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries))
    fail("missing/extra/hash/mode/type drift");
  await verifyLockedEventHostPackages(descriptor.root, actual, target);
  for (const [name, version] of [
    ["@opencode/server", manifest.serverVersion],
    ["@opencode/client", manifest.serverVersion],
    ["effect", manifest.effectVersion],
  ]) {
    const pkg = await readResourceJson(
      join(descriptor.root, "node_modules", name, "package.json"),
    );
    if (pkg.name !== name || pkg.version !== version)
      fail("installed package version drift");
  }
  if (
    JSON.stringify(
      await inventoryEventHostTree(descriptor.root, { links, platform }),
    ) !== JSON.stringify(actual) ||
    JSON.stringify(await readResourceJson(descriptor.manifestPath)) !==
      JSON.stringify(manifest)
  )
    fail("resource changed during verification");
  return manifest;
}
