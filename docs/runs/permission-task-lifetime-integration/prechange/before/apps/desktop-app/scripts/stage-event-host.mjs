import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_HOST_IDENTITY,
  EVENT_HOST_CODE_ASSETS,
  assertEventHostTarget,
  assertRealResourceParents,
  eventHostForResources,
  inventoryEventHostTree,
  readResourceJson,
  resourceFileSha256,
  verifyEventHostResources,
} from "../src/event-host-resources.mjs";
import { loadRuntimeInputs, runtimePackageDir } from "./prepare-event-host.mjs";
import { planNativePermissionOverlay } from "./native-permission-overlay.mjs";
import {
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  NATIVE_PERMISSION_OVERLAY_RECEIPT,
} from "../src/native-permission-overlay-contract.mjs";
import { NATIVE_PREFLIGHT_ASSETS } from "../src/native-preflight-resources.mjs";

export async function copyPackagedResources({
  resources,
  destination,
  platform,
  arch,
}) {
  await assertRealResourceParents(resources);
  await assertRealResourceParents(destination);
  const before = await verifyEventHostResources(
    eventHostForResources(resources, platform, arch),
    { platform, arch },
  );
  const target = join(destination, "opencode");
  try {
    await lstat(target);
    throw new Error("Packaged resource destination already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Node's default cp rewrites relative links to absolute source paths.
  await cp(join(resources, "opencode"), target, {
    recursive: true,
    verbatimSymlinks: true,
    dereference: false,
    force: false,
    errorOnExist: true,
  });
  const after = await verifyEventHostResources(
    eventHostForResources(destination, platform, arch),
    { platform, arch },
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Packaged resource identity changed");
  const sourceAfter = await verifyEventHostResources(
    eventHostForResources(resources, platform, arch),
    { platform, arch },
  );
  if (JSON.stringify(before) !== JSON.stringify(sourceAfter))
    throw new Error("Resource source changed during packaging");
}

export async function stageEventHost({
  resources,
  platform = process.platform,
  arch = process.arch,
  packageDir = runtimePackageDir,
  hostSource = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/event-host-child.mjs",
  ),
} = {}) {
  assertEventHostTarget(platform, arch);
  const { pins } = await loadRuntimeInputs(packageDir);
  const generated = join(packageDir, ".generated");
  await assertRealResourceParents(generated);
  const receipt = await readResourceJson(join(generated, "receipt.json"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.platform !== platform ||
    receipt.arch !== arch ||
    receipt.scriptsExecuted !== false ||
    receipt.runtimeExecuted !== false ||
    receipt.packageSha256 !== pins.packageSha256 ||
    receipt.lockSha256 !== pins.lockSha256 ||
    receipt.pinsSha256 !==
      (await resourceFileSha256(join(packageDir, "installer-pins.json"))) ||
    receipt.engineSha256 !== pins.bun.binarySha256
  )
    throw new Error("Invalid preparation receipt");
  const install = join(generated, "install");
  const before = await inventoryEventHostTree(install, { links: pins.links });
  if (JSON.stringify(before) !== JSON.stringify(receipt.installEntries))
    throw new Error("Prepared dependency closure drift");
  // Validate every original pin before creating any stage/destination directories.
  const overlayFiles = [];
  for (const file of NATIVE_PERMISSION_OVERLAY_RECIPE.files) {
    const entry = before.find((e) => e.path === file.path);
    if (
      entry?.type !== "file" ||
      entry.sha256 !== file.beforeSha256 ||
      entry.size > 32 * 1024 * 1024
    )
      throw new Error("Permission overlay original input drift");
    overlayFiles.push({
      path: file.path,
      content: await readFile(join(install, file.path)),
    });
  }
  const overlay = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    overlayFiles,
  );
  if (overlay.recipeSha256 !== NATIVE_PERMISSION_OVERLAY_RECEIPT.recipeSha256)
    throw new Error("Permission overlay recipe drift");
  const overlayByPath = new Map(overlay.files.map((file) => [file.path, file]));
  await assertRealResourceParents(dirname(hostSource));
  const hostHash = await resourceFileSha256(hostSource);
  const hostText = await readFile(hostSource, "utf8");
  const localImports = [
    ...hostText.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(["'])(\.[^"']+)\1/g),
  ].map((match) => match[2]);
  if (
    !localImports.includes("./event-host-protocol.mjs") ||
    localImports.some(
      (path) =>
        ![
          "./event-host-protocol.mjs",
          "./event-host-resources.mjs",
          "./native-skills-config.mjs",
          "./native-permission-graph.mjs",
          "./native-permission-control-input.mjs",
          "./host/configuration-save-kernel.mjs",
          "./host/git-index-kernel.mjs",
          "./host/git-metadata-kernel.mjs",
        ].includes(path),
    )
  )
    throw new Error("Unrecognized child resource import graph");
  const protocolSource = join(dirname(hostSource), "event-host-protocol.mjs");
  const protocolHash = await resourceFileSha256(protocolSource);
  const resourcesModule = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/event-host-resources.mjs",
  );
  const moduleHash = await resourceFileSha256(resourcesModule);
  const preflightSources = await Promise.all(
    NATIVE_PREFLIGHT_ASSETS.map(async (path) => {
      const source = join(dirname(hostSource), path);
      const hash = await resourceFileSha256(source);
      const text = await readFile(source, "utf8");
      const localImports = [
        ...text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(["'])(\.[^"']+)\1/g),
      ].map((match) => match[2]);
      if (
        localImports.some(
          (value) =>
            !NATIVE_PREFLIGHT_ASSETS.map((asset) => `./${asset}`).includes(
              value,
            ),
        )
      )
        throw new Error("Unrecognized preflight resource import graph");
      return { path, source, hash };
    }),
  );
  const codeSources = await Promise.all(
    EVENT_HOST_CODE_ASSETS.map(async (path) => {
      const source = join(dirname(hostSource), path);
      const text = await readFile(source, "utf8");
      for (const match of text.matchAll(
        /(?:from\s*|import\s*(?:\(\s*)?)(["'])(\.[^"']+)\1/g,
      )) {
        const resolved = resolve(dirname(source), match[2]);
        if (
          resolved !== protocolSource &&
          // The verifier is copied from the fixed controller source into this exact local name.
          resolved !== join(dirname(hostSource), "event-host-resources.mjs") &&
          !EVENT_HOST_CODE_ASSETS.some(
            (asset) => join(dirname(hostSource), asset) === resolved,
          )
        )
          throw new Error("Unrecognized event host resource import graph");
      }
      return { path, source, hash: await resourceFileSha256(source) };
    }),
  );
  const protocolText = await readFile(protocolSource, "utf8");
  for (const match of protocolText.matchAll(
    /(?:from\s*|import\s*(?:\(\s*)?)(["'])(\.[^"']+)\1/g,
  ))
    if (
      !EVENT_HOST_CODE_ASSETS.some(
        (asset) =>
          join(dirname(hostSource), asset) ===
          resolve(dirname(protocolSource), match[2]),
      )
    )
      throw new Error("Unrecognized protocol resource import graph");
  const codeDirectories = [
    ...new Set(
      EVENT_HOST_CODE_ASSETS.flatMap((path) => {
        const parts = path.split("/");
        return parts
          .slice(0, -1)
          .map((_, i) => parts.slice(0, i + 1).join("/"));
      }),
    ),
  ];
  if (
    (await resourceFileSha256(join(generated, "runtime/bun"))) !==
    pins.bun.binarySha256
  )
    throw new Error("Prepared engine drift");
  await assertRealResourceParents(resources);
  // Exclusive staging and destination. Failed trees remain for inspection; no destructive cleanup.
  const descriptor = eventHostForResources(resources, platform, arch);
  await mkdir(join(resources, "opencode"), { recursive: true });
  await assertRealResourceParents(join(resources, "opencode"));
  await mkdir(dirname(descriptor.root), { recursive: true });
  await assertRealResourceParents(dirname(descriptor.root));
  const selected = before.filter(
    (e) =>
      e.path === "package.json" ||
      e.path === "package-lock.json" ||
      e.path === "node_modules" ||
      e.path.startsWith("node_modules/"),
  );
  const transformedSelected = selected.map((entry) => {
    const file = overlayByPath.get(entry.path);
    return file
      ? { ...entry, size: file.content.length, sha256: file.afterSha256 }
      : entry;
  });
  let existing;
  let replaceExisting = false;
  try {
    existing = await lstat(descriptor.root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    const manifest = await verifyEventHostResources(descriptor, {
      platform,
      arch,
    });
    const existingByPath = new Map(manifest.entries.map((e) => [e.path, e]));
    for (const entry of manifest.permissionOverlay
      ? transformedSelected
      : selected)
      if (
        JSON.stringify(existingByPath.get(entry.path)) !== JSON.stringify(entry)
      )
        throw new Error(
          "Existing stage differs from prepared closure; retain for inspection",
        );
    if (existingByPath.get("runtime/bun")?.sha256 !== pins.bun.binarySha256)
      throw new Error("Existing stage engine differs; retained");
    replaceExisting =
      !manifest.permissionOverlay ||
      [
        ["host.mjs", hostHash],
        ["event-host-protocol.mjs", protocolHash],
        ["event-host-resources.mjs", moduleHash],
        ...preflightSources.map(({ path, hash }) => [path, hash]),
        ...codeSources.map(({ path, hash }) => [path, hash]),
      ].some(([path, hash]) => existingByPath.get(path)?.sha256 !== hash);
    const expectedPaths = new Set([
      ...selected.map((e) => e.path),
      "runtime",
      "runtime/bun",
      "host.mjs",
      "event-host-protocol.mjs",
      "event-host-resources.mjs",
      ...NATIVE_PREFLIGHT_ASSETS,
      ...EVENT_HOST_CODE_ASSETS,
      ...codeDirectories,
    ]);
    if (manifest.entries.some((e) => !expectedPaths.has(e.path)))
      throw new Error("Unexpected existing stage asset");
    if (!replaceExisting) return descriptor;
  }
  const temporary = `${descriptor.root}.staging`;
  await mkdir(temporary, { mode: 0o755 });
  for (const entry of selected
    .filter((e) => e.type === "directory")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
    await mkdir(join(temporary, entry.path), { mode: entry.mode });
    await chmod(join(temporary, entry.path), entry.mode);
  }
  for (const entry of selected.filter((e) => e.type !== "directory")) {
    if (entry.type === "symlink")
      await symlink(entry.target, join(temporary, entry.path));
    else {
      await copyFile(join(install, entry.path), join(temporary, entry.path), 1);
      await chmod(join(temporary, entry.path), entry.mode);
    }
  }
  await mkdir(join(temporary, "runtime"), { mode: 0o755 });
  await copyFile(
    join(generated, "runtime/bun"),
    join(temporary, "runtime/bun"),
    1,
  );
  await chmod(join(temporary, "runtime/bun"), 0o755);
  await copyFile(hostSource, join(temporary, "host.mjs"), 1);
  await chmod(join(temporary, "host.mjs"), 0o644);
  await copyFile(protocolSource, join(temporary, "event-host-protocol.mjs"), 1);
  await chmod(join(temporary, "event-host-protocol.mjs"), 0o644);
  // Always include the pure resource module; relative child imports resolve locally.
  await copyFile(
    resourcesModule,
    join(temporary, "event-host-resources.mjs"),
    1,
  );
  await chmod(join(temporary, "event-host-resources.mjs"), 0o644);
  for (const { path, source } of preflightSources) {
    await copyFile(source, join(temporary, path), 1);
    await chmod(join(temporary, path), 0o644);
  }
  for (const directory of codeDirectories.sort(
    (a, b) => a.split("/").length - b.split("/").length,
  ))
    await mkdir(join(temporary, directory), { mode: 0o755 });
  for (const { path, source } of codeSources) {
    await copyFile(source, join(temporary, path), 1);
    await chmod(join(temporary, path), 0o644);
  }
  let entries = await inventoryEventHostTree(temporary, {
    links: pins.links,
  });
  let byPath = new Map(entries.map((e) => [e.path, e]));
  for (const entry of selected)
    if (JSON.stringify(byPath.get(entry.path)) !== JSON.stringify(entry))
      throw new Error("Copied dependency drift");
  // Only copied regular files in our exclusive fresh tree are changed.
  for (const file of overlay.files) {
    const path = join(temporary, file.path);
    const handle = await open(
      path,
      constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 32 * 1024 * 1024 ||
        createHash("sha256")
          .update(await handle.readFile())
          .digest("hex") !== file.beforeSha256
      )
        throw new Error("Permission overlay copied input drift");
      let offset = 0;
      while (offset < file.content.length) {
        const { bytesWritten } = await handle.write(
          file.content,
          offset,
          file.content.length - offset,
          offset,
        );
        if (bytesWritten === 0)
          throw new Error("Permission overlay incomplete output");
        offset += bytesWritten;
      }
      await handle.truncate(file.content.length);
    } finally {
      await handle.close();
    }
    if ((await resourceFileSha256(path)) !== file.afterSha256)
      throw new Error("Permission overlay copied output drift");
  }
  entries = await inventoryEventHostTree(temporary, { links: pins.links });
  byPath = new Map(entries.map((e) => [e.path, e]));
  for (const entry of transformedSelected)
    if (JSON.stringify(byPath.get(entry.path)) !== JSON.stringify(entry))
      throw new Error("Transformed dependency drift");

  if (
    entries.find((e) => e.path === "event-host-protocol.mjs").sha256 !==
      protocolHash ||
    (await resourceFileSha256(protocolSource)) !== protocolHash ||
    entries.find((e) => e.path === "host.mjs").sha256 !== hostHash ||
    entries.find((e) => e.path === "event-host-resources.mjs").sha256 !==
      moduleHash ||
    (await resourceFileSha256(hostSource)) !== hostHash ||
    (await resourceFileSha256(resourcesModule)) !== moduleHash ||
    entries.find((e) => e.path === "runtime/bun").sha256 !==
      pins.bun.binarySha256 ||
    JSON.stringify(
      await inventoryEventHostTree(install, { links: pins.links }),
    ) !== JSON.stringify(before)
  )
    throw new Error("Source changed during staging");
  for (const { path, source, hash } of [...preflightSources, ...codeSources])
    if (
      byPath.get(path)?.sha256 !== hash ||
      (await resourceFileSha256(source)) !== hash
    )
      throw new Error("Preflight source changed during staging");
  const expectedPaths = new Set([
    ...transformedSelected.map((entry) => entry.path),
    "runtime",
    "runtime/bun",
    "host.mjs",
    "event-host-protocol.mjs",
    "event-host-resources.mjs",
    ...NATIVE_PREFLIGHT_ASSETS,
    ...EVENT_HOST_CODE_ASSETS,
    ...codeDirectories,
  ]);
  if (
    entries.length !== expectedPaths.size ||
    entries.some((entry) => !expectedPaths.has(entry.path))
  )
    throw new Error("Unexpected copied stage asset");
  const manifest = {
    ...EVENT_HOST_IDENTITY,
    permissionOverlay: NATIVE_PERMISSION_OVERLAY_RECEIPT,
    entries,
  };
  await writeFile(
    join(temporary, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o644 },
  );
  // Preserve verified older source bytes outside packaged resources before replacement.
  if (replaceExisting) {
    await verifyEventHostResources(descriptor, { platform, arch });
    const retained = await mkdtemp(join(generated, "staged-retained-"));
    const retainedDescriptor = eventHostForResources(retained, platform, arch);
    await mkdir(dirname(retainedDescriptor.root), { recursive: true });
    await assertRealResourceParents(dirname(retainedDescriptor.root));
    await rename(descriptor.root, retainedDescriptor.root);
  }
  // Claim destination exclusively; never discard an old resource tree.
  await mkdir(descriptor.root, { mode: 0o755 });
  await rename(temporary, descriptor.root);
  await verifyEventHostResources(descriptor, {
    platform,
    arch,
    requirePermissionOverlay: true,
  });
  return descriptor;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2) throw new Error("Usage: stage-event-host.mjs");
  const resources = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../dist/resources",
  );
  await mkdir(resources, { recursive: true });
  console.log(await stageEventHost({ resources }));
}
