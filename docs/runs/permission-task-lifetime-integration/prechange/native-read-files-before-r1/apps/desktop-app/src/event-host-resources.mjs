// Pure resource verification. Never loads the engine or any installed package.
import { matchesNativePermissionOverlay } from "./native-permission-overlay-contract.mjs";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const CONFIGURATION_SAVE_ASSETS = Object.freeze([
  "host/configuration-save-kernel.mjs",
  "host/darwin-descriptor-ffi.mjs",
  "host/workspace-root-authority.mjs",
  "renderer/shared/workspace-file/index.mjs",
  "host/configuration-file-observation.mjs",
  "renderer/shared/configuration-draft/validation.mjs",
  "renderer/shared/configuration-draft/skill.mjs",
]);
export const NATIVE_SKILLS_ASSETS = Object.freeze([
  "native-skills-config.mjs",
  "native-skills-protocol.mjs",
  "builtins/workbench-skills/package.json",
  "builtins/workbench-skills/server.mjs",
]);
export const NATIVE_AGENTS_ASSETS = Object.freeze([
  "native-agents-protocol.mjs",
  "renderer/shared/configuration-draft/agent-runtime.mjs",
  "builtins/workbench-skills/agents.mjs",
  "renderer/shared/configuration-draft/agent.mjs",
  "renderer/shared/configuration-draft/policy.mjs",
]);
export const NATIVE_EXTENSIONS_ASSETS = Object.freeze([
  "native-extensions-protocol.mjs",
  "renderer/shared/configuration-draft/extensions.mjs",
  "builtins/workbench-skills/extensions.mjs",
]);
export const GIT_BRANCH_RESTORE_ASSETS = Object.freeze([
  "host/git-branch-restore-kernel.mjs",
  "host/git-branch-restore-contract.mjs",
  "renderer/shared/git-branch-restore/index.mjs",
]);
export const GIT_COMMIT_ASSETS = Object.freeze([
  "host/git-metadata-kernel.mjs",
  "host/git-commit-kernel.mjs",
  "host/git-commit-contract.mjs",
  "renderer/shared/git-commit/index.mjs",
]);
export const GIT_INDEX_ASSETS = Object.freeze([
  "host/git-index-kernel.mjs",
  "host/git-index-contract.mjs",
  "renderer/shared/git-index/index.mjs",
  "renderer/shared/git-review/index.mjs",
]);
export const EVENT_HOST_CODE_ASSETS = Object.freeze([
  "native-permission-overlay-contract.mjs",
  "native-permission-graph.mjs",
  "native-permission-control.mjs",
  "host/native-bootstrap-workspace.mjs",
  "native-permission-control-input.mjs",
  "native-permission-inventory.mjs",
  "native-permission-leases.mjs",
  "native-permission-origin-scopes.mjs",
  "permission-control-canonical.mjs",
  "native-permission-task-observer.mjs",
  "host/native-workspace-file-io.mjs",
  "host/native-descriptor-read.mjs",
  "host/darwin-directory-entry.mjs",
  "host/native-descriptor-read-resource.mjs",
  "host/workbench-file-edit.mjs",
  "workbench-errors.mjs",
  "native-permission-task-handoff.mjs",
  "permission-input-digest.mjs",
  "wire-id.mjs",
  "host/workbench-task-storage.mjs",
  "native-permission-coordinator-admission.mjs",
  ...GIT_BRANCH_RESTORE_ASSETS,
  ...GIT_COMMIT_ASSETS,
  ...GIT_INDEX_ASSETS,
  ...CONFIGURATION_SAVE_ASSETS,
  ...NATIVE_SKILLS_ASSETS,
  ...NATIVE_AGENTS_ASSETS,
  ...NATIVE_EXTENSIONS_ASSETS,
]);
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
const keys = (object, expected) =>
  object &&
  typeof object === "object" &&
  !Array.isArray(object) &&
  Object.keys(object).sort().join() === [...expected].sort().join();
const fail = (message) => {
  throw new Error(`Event host resources: ${message}`);
};
export function assertEventHostTarget(platform, arch) {
  if (platform !== "darwin" || arch !== "arm64")
    fail(`unsupported target ${platform}-${arch}; hold required`);
}
export function eventHostForResources(resources, platform, arch) {
  assertEventHostTarget(platform, arch);
  if (typeof resources !== "string" || !isAbsolute(resources))
    fail("resources must be absolute");
  const root = join(resources, "opencode", "event-host", "darwin-arm64");
  return Object.freeze({
    root,
    enginePath: join(root, "runtime", "bun"),
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
  const parts = path.split(sep).filter(Boolean);
  let current = sep;
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
export async function resourceFileSha256(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1)
    fail("regular single-link file required");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat()))
      fail("file changed before read");
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false }))
      hash.update(bytes);
    if (
      !unchanged(before, await handle.stat()) ||
      !unchanged(before, await lstat(path))
    )
      fail("file changed while hashing");
    return hash.digest("hex");
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
export async function inventoryEventHostTree(root, { links = {} } = {}) {
  await assertRealResourceParents(root);
  const entries = [];
  let bytes = 0;
  async function walk(directory, depth) {
    if (depth > EVENT_HOST_LIMITS.depth) fail("depth limit");
    const before = await lstat(directory);
    for (const name of (await readdir(directory)).sort()) {
      const path = relative(root, join(directory, name)).split(sep).join("/");
      if (path === "manifest.json") continue;
      safeResourcePath(path);
      if (entries.length >= EVENT_HOST_LIMITS.entries) fail("entry limit");
      const absolute = join(root, path);
      const stat = await lstat(absolute);
      const mode = stat.mode & 0o7777;
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
    }
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
function validateManifest(manifest) {
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
  for (const [key, value] of Object.entries(EVENT_HOST_IDENTITY))
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
    "runtime/bun",
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
  if (!(manifest.entries.find((e) => e.path === "runtime/bun").mode & 0o111))
    fail("engine not executable");
}
export async function verifyLockedEventHostPackages(root, entries) {
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
    const selected = allows(item.os, "darwin") && allows(item.cpu, "arm64");
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
  assertEventHostTarget(platform, arch);
  if (
    !keys(descriptor, ["root", "enginePath", "hostPath", "manifestPath"]) ||
    !isAbsolute(descriptor.root) ||
    !descriptor.root.endsWith(
      `${sep}opencode${sep}event-host${sep}darwin-arm64`,
    ) ||
    descriptor.enginePath !== join(descriptor.root, "runtime/bun") ||
    descriptor.hostPath !== join(descriptor.root, "host.mjs") ||
    descriptor.manifestPath !== join(descriptor.root, "manifest.json")
  )
    fail("invalid closed descriptor");
  await assertRealResourceParents(descriptor.root);
  const manifest = await readResourceJson(descriptor.manifestPath);
  validateManifest(manifest);
  if (typeof requirePermissionOverlay !== "boolean")
    fail("invalid permission overlay requirement");
  if (requirePermissionOverlay && !manifest.permissionOverlay)
    fail("required permission overlay missing");
  const links = Object.fromEntries(
    manifest.entries
      .filter((e) => e.type === "symlink")
      .map((e) => [e.path, { target: e.target }]),
  );
  const actual = await inventoryEventHostTree(descriptor.root, { links });
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries))
    fail("missing/extra/hash/mode/type drift");
  await verifyLockedEventHostPackages(descriptor.root, actual);
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
    JSON.stringify(await inventoryEventHostTree(descriptor.root, { links })) !==
      JSON.stringify(actual) ||
    JSON.stringify(await readResourceJson(descriptor.manifestPath)) !==
      JSON.stringify(manifest)
  )
    fail("resource changed during verification");
  return manifest;
}
