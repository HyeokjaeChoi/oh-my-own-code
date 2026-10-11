import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  snapshotEventHostResources,
  snapshotOwnerLifetimeResources,
} from "./build-provenance.mjs";
import { sidecarPackageName } from "../src/sidecar-package.mjs";
import { eventHostForResources } from "../src/event-host-resources.mjs";
import { verifyNativePreflightResources } from "../src/native-preflight-resources.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appDir = join(root, "apps", "desktop-app");
const platform = process.argv[2];
const arch = process.arch;
if (!["darwin", "win32"].includes(platform))
  throw new Error("Usage: inspect-packaged-bundle.mjs <darwin|win32>");
if (process.platform !== platform)
  throw new Error(
    `Expected native runner ${platform}, found ${process.platform}`,
  );

const packageName = `OhMyOwnCode-${platform}-${arch}`;
const packagedDir = join(appDir, "dist", "packages", packageName);
const packagedApp =
  platform === "darwin" ? join(packagedDir, "OhMyOwnCode.app") : packagedDir;
const appAsar =
  platform === "darwin"
    ? join(packagedApp, "Contents", "Resources", "app.asar")
    : join(packagedApp, "resources", "app.asar");
const appExecutable =
  platform === "darwin"
    ? join(packagedApp, "Contents", "MacOS", "OhMyOwnCode")
    : join(packagedApp, "OhMyOwnCode.exe");
const sidecar = join(
  packagedApp,
  platform === "darwin" ? "Contents/Resources" : "resources",
  "opencode",
  `${platform}-${arch}`,
  platform === "win32" ? "opencode.exe" : "opencode",
);
const sidecarPackage = join(
  appDir,
  "node_modules",
  sidecarPackageName(platform, arch),
  "bin",
  platform === "win32" ? "opencode.exe" : "opencode",
);
const packagerPath = createRequire(import.meta.url).resolve(
  "@electron/packager",
);
const asarPath = createRequire(packagerPath).resolve("@electron/asar");
const { extractAll } = await import(pathToFileURL(asarPath).href);
const inspectionRoot = await mkdtemp(
  join(tmpdir(), "oh-my-own-code-bundle-inspection-"),
);

async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function treeHash(path) {
  const hash = createHash("sha256");
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const rel = relative(path, entryPath).replaceAll("\\", "/");
      const stats = await lstat(entryPath);
      hash.update(`${rel}\0${stats.mode}\0`);
      if (stats.isSymbolicLink()) hash.update(await readlink(entryPath));
      else if (stats.isDirectory()) await walk(entryPath);
      else if (stats.isFile()) {
        for await (const chunk of createReadStream(entryPath))
          hash.update(chunk);
      }
      hash.update("\0");
    }
  }
  await walk(path);
  return hash.digest("hex");
}

async function rendererFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:html|js|css)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(directory);
  return files.sort();
}

try {
  const ownerLifetimeResources = await snapshotOwnerLifetimeResources(
    join(
      packagedApp,
      platform === "darwin" ? "Contents/Resources" : "resources",
    ),
    platform,
    arch,
  );
  assert.deepEqual(
    ownerLifetimeResources,
    await snapshotOwnerLifetimeResources(
      join(appDir, "dist/resources"),
      platform,
      arch,
    ),
    "packaged lifetime witness matches staged native helper bytes",
  );
  const eventHostResources = await snapshotEventHostResources(
    join(
      packagedApp,
      platform === "darwin" ? "Contents/Resources" : "resources",
    ),
    platform,
    arch,
  );
  assert.deepEqual(
    eventHostResources,
    await snapshotEventHostResources(
      join(appDir, "dist/resources"),
      platform,
      arch,
    ),
    "packaged complete event-host resource inventory matches staged tree",
  );
  const packagedPreflight = await verifyNativePreflightResources(
    eventHostForResources(
      join(
        packagedApp,
        platform === "darwin" ? "Contents/Resources" : "resources",
      ),
      platform,
      arch,
    ),
  );
  const stagedPreflight = await verifyNativePreflightResources(
    eventHostForResources(join(appDir, "dist/resources"), platform, arch),
  );
  assert.equal(
    packagedPreflight.inventorySha256,
    stagedPreflight.inventorySha256,
    "packaged readonly inspector matches complete staged resource inventory",
  );
  const sourceSidecarSha256 = await fileHash(sidecarPackage);
  const packagedSidecarSha256 = await fileHash(sidecar);
  assert.equal(
    packagedSidecarSha256,
    sourceSidecarSha256,
    "packaged OpenCode binary matches the pinned platform package",
  );
  await extractAll(appAsar, inspectionRoot);
  const rendererRoot = join(inspectionRoot, "renderer");
  const files = await rendererFiles(rendererRoot);
  assert(
    files.some((path) => path.endsWith("index.html")),
    "packaged renderer HTML exists",
  );
  assert(
    files.some((path) => path.endsWith(".js")),
    "packaged renderer script exists",
  );

  const forbidden = [
    /server password\s+\S+/i,
    /opencode:[^\s"'`]+/i,
    /https?:\/\/127\.0\.0\.1:\d+/i,
    /\bipcRenderer\b/,
    /\bcontextBridge\b/,
    /\bchild_process\b/,
    /require\s*\(\s*["'](?:node:)?(?:fs|path|child_process|electron)["']\s*\)/i,
    /from\s+["']node:(?:fs|path|child_process)["']/i,
    /process\.env/i,
  ];
  const rendererHashes = [];
  for (const path of files) {
    const source = await readFile(path);
    const text = source.toString("utf8");
    for (const pattern of forbidden)
      assert.equal(
        pattern.test(text),
        false,
        `${pattern} must not appear in packaged renderer`,
      );
    rendererHashes.push({
      file: relative(rendererRoot, path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  }
  const html = await readFile(join(rendererRoot, "index.html"), "utf8");
  assert.match(
    html,
    /connect-src 'none'/,
    "packaged renderer CSP denies network connections",
  );

  console.log(
    JSON.stringify(
      {
        result: "pass",
        platform,
        architecture: arch,
        appTreeSha256: await treeHash(packagedApp),
        appExecutableSha256: await fileHash(appExecutable),
        appAsarSha256: await fileHash(appAsar),
        sidecarSha256: packagedSidecarSha256,
        eventHostResources,
        ownerLifetimeResources,
        nativePreflightInventorySha256: packagedPreflight.inventorySha256,
        rendererHashes,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(inspectionRoot, { recursive: true, force: true });
}
