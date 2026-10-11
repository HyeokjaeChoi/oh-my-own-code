// Node-only controller: disabled npm hooks; Bun bytes are never executed.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, chmod, lstat } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { rootCertificates } from "node:tls";
import {
  assertEventHostTarget,
  assertRealResourceParents,
  inventoryEventHostTree,
  readResourceJson,
  resourceFileSha256,
  safeResourcePath,
  verifyLockedEventHostPackages,
} from "../src/event-host-resources.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const runtimePackageDir = join(appDir, "runtime-event-host");
const registry = "https://registry.npmjs.org/";
const sha = (data) => createHash("sha256").update(data).digest("hex");
export function assertPublicArchive(url) {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://registry.npmjs.org" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    !parsed.pathname.endsWith(".tgz")
  )
    throw new Error("Public pinned npm archive origin required");
}
export function validateRuntimeLock(pkg, lock) {
  const expected = {
    "@opencode/server": "2.0.18",
    "@opencode/client": "2.0.18",
    effect: "4.0.0-rc.112",
  };
  if (
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    JSON.stringify(Object.entries(pkg.dependencies).sort()) !==
      JSON.stringify(Object.entries(expected).sort()) ||
    JSON.stringify(Object.entries(lock.packages[""].dependencies).sort()) !==
      JSON.stringify(Object.entries(expected).sort()) ||
    pkg.scripts ||
    lock.packages[""].scripts
  )
    throw new Error("Pinned resource package/lock required");
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue;
    safeResourcePath(path);
    if (
      !path.startsWith("node_modules/") ||
      item.link ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(item.version) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity)
    )
      throw new Error("Invalid locked package/version/integrity");
    assertPublicArchive(item.resolved);
  }
}
export async function loadRuntimeInputs(packageDir = runtimePackageDir) {
  await assertRealResourceParents(packageDir);
  const pins = await readResourceJson(
    join(packageDir, "installer-pins.json"),
    65536,
  );
  const pkg = await readResourceJson(join(packageDir, "package.json"));
  const lock = await readResourceJson(join(packageDir, "package-lock.json"));
  if (
    (await resourceFileSha256(join(packageDir, "package.json"))) !==
      pins.packageSha256 ||
    (await resourceFileSha256(join(packageDir, "package-lock.json"))) !==
      pins.lockSha256
  )
    throw new Error("Pinned input hash drift");
  validateRuntimeLock(pkg, lock);
  assertEventHostTarget(pins.target.platform, pins.target.arch);
  if (
    pins.schemaVersion !== 1 ||
    pins.nodeVersion !== "v24.14.1" ||
    pins.npmVersion !== "11.11.0" ||
    pins.bun.version !== "1.4.2" ||
    pins.bun.package !== "@oven/bun-darwin-aarch64" ||
    pins.bun.url !==
      `${registry}@oven/bun-darwin-aarch64/-/bun-darwin-aarch64-1.4.2.tgz` ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pins.bun.integrity) ||
    Object.keys(pins.links).length !== 31
  )
    throw new Error("Unsupported installer pins");
  return { pins, pkg, lock };
}
export function installerEnvironment(base, nodePath) {
  // Construct from zero: no inherited auth, proxy, custom CA, NODE_OPTIONS/PATH.
  return {
    PATH: dirname(nodePath),
    LANG: "C",
    LC_ALL: "C",
    HOME: join(base, "home"),
    TMPDIR: join(base, "tmp"),
    npm_config_cache: join(base, "cache"),
    npm_config_userconfig: join(base, "user.npmrc"),
    npm_config_globalconfig: join(base, "global.npmrc"),
    npm_config_registry: registry,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_workspaces: "false",
    npm_config_update_notifier: "false",
    npm_config_strict_ssl: "true",
    npm_config_prefix: join(base, "prefix"),
    npm_config_progress: "false",
  };
}
export const installerConfig =
  "registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\nworkspaces=false\nupdate-notifier=false\nstrict-ssl=true\nproxy=null\nhttps-proxy=null\ncafile=null\n";
export async function assertInstalledClosure(root, links) {
  await assertRealResourceParents(root);
  const entries = await inventoryEventHostTree(root, { links });
  await verifyLockedEventHostPackages(root, entries);
  return entries;
}
function nodeCommand(node, npm, args, cwd, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(node, [npm, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let exceeded = false;
    for (const [stream, append] of [
      [
        child.stdout,
        (x) => {
          out += x;
        },
      ],
      [
        child.stderr,
        (x) => {
          err += x;
        },
      ],
    ])
      stream.on("data", (data) => {
        append(data.toString());
        if (out.length + err.length > 1024 * 1024) {
          exceeded = true;
          child.kill("SIGKILL");
        }
      });
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || exceeded)
        reject(
          new Error(
            `Guarded npm failed (${code}); bounded output retained locally by npm`,
          ),
        );
      else resolveResult(out.trim());
    });
  });
}
export function downloadPublic(url, maxBytes) {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://registry.npmjs.org" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Public npm origin required");
  return new Promise((resolveResult, reject) => {
    // node:https ignores proxy/CA environment and rejects redirects.
    const request = get(
      parsed,
      { agent: false, timeout: 30000, ca: rootCertificates },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error("Public npm response rejected (including redirect)"),
          );
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes)
            response.destroy(new Error("Download byte limit"));
          else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => resolveResult(Buffer.concat(chunks)));
      },
    );
    request.once("timeout", () =>
      request.destroy(new Error("Public npm timeout")),
    );
    request.once("error", reject);
  });
}
export function extractPinnedBun(archive, pins) {
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (actual !== pins.integrity)
    throw new Error("Bun archive integrity mismatch");
  const tar = gunzipSync(archive, { maxOutputLength: 70 * 1024 * 1024 });
  const expected = new Set([
    "package/bin/bun",
    "package/package.json",
    "package/README.md",
  ]);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (a, b) =>
      header.subarray(a, b).toString("utf8").split("\0")[0];
    const name = string(0, 100);
    safeResourcePath(name);
    const size = Number.parseInt(string(124, 136).trim(), 8);
    const mode = Number.parseInt(string(100, 108).trim(), 8);
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (
      checksum !== Number.parseInt(string(148, 156).trim(), 8) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !expected.has(name) ||
      files.has(name) ||
      ![0, 48].includes(header[156]) ||
      string(157, 257) ||
      string(345, 500) ||
      mode !== (name === "package/bin/bun" ? 0o755 : 0o644) ||
      offset + 512 + size > tar.length
    )
      throw new Error("Unsafe Bun archive entry");
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (
    files.size !== expected.size ||
    tar.subarray(offset).some((byte) => byte !== 0) ||
    sha(files.get("package/bin/bun")) !== pins.binarySha256
  )
    throw new Error("Incomplete/changed Bun archive");
  const pkg = JSON.parse(files.get("package/package.json").toString());
  if (
    pkg.name !== pins.package ||
    pkg.version !== pins.version ||
    !pkg.os.includes("darwin") ||
    !pkg.cpu.includes("arm64")
  )
    throw new Error("Bun target/version mismatch");
  return files.get("package/bin/bun");
}
export function assertControllerEnvironment(
  environment = process.env,
  options = process.execArgv,
) {
  const forbidden = [
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  if (forbidden.some((key) => environment[key]) || options.length)
    throw new Error(
      "Controller injection/custom CA disabled; use clean Node environment",
    );
}

export async function prepareEventHost({
  packageDir = runtimePackageDir,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  assertEventHostTarget(platform, arch);
  assertControllerEnvironment();
  const { pins } = await loadRuntimeInputs(packageDir);
  if (
    process.version !== pins.nodeVersion ||
    resolve(process.execPath) !== pins.node ||
    (await resourceFileSha256(pins.node)) !== pins.nodeSha256
  )
    throw new Error("Exact Node24 controller required");
  const base = join(packageDir, ".generated");
  await mkdir(base, { mode: 0o700 }); // exclusive: never overwrite an old preparation
  await assertRealResourceParents(base);
  for (const name of ["home", "cache", "tmp", "prefix", "install", "runtime"])
    await mkdir(join(base, name), { mode: 0o700 });
  for (const name of ["user.npmrc", "global.npmrc", "install/.npmrc"])
    await writeFile(join(base, name), installerConfig, {
      mode: 0o600,
      flag: "wx",
    });
  for (const name of ["package.json", "package-lock.json"])
    await writeFile(
      join(base, "install", name),
      await readFile(join(packageDir, name)),
      { mode: 0o644, flag: "wx" },
    );
  const env = installerEnvironment(base, pins.node);
  const npm = resolve(
    dirname(pins.node),
    "../lib/node_modules/npm/bin/npm-cli.js",
  );
  await assertRealResourceParents(dirname(npm));
  if (!(await lstat(npm)).isFile()) throw new Error("npm controller missing");
  if (
    (await nodeCommand(
      pins.node,
      npm,
      ["--version"],
      join(base, "install"),
      env,
    )) !== pins.npmVersion
  )
    throw new Error("Pinned npm version required");
  const metadata = JSON.parse(
    (
      await downloadPublic(
        `${registry}@oven%2fbun-darwin-aarch64/1.4.2`,
        1024 * 1024,
      )
    ).toString(),
  );
  if (
    metadata.name !== pins.bun.package ||
    metadata.version !== pins.bun.version ||
    metadata.dist.tarball !== pins.bun.url ||
    metadata.dist.integrity !== pins.bun.integrity
  )
    throw new Error("Official Bun metadata pin mismatch");
  const binary = extractPinnedBun(
    await downloadPublic(pins.bun.url, 32 * 1024 * 1024),
    pins.bun,
  );
  await writeFile(join(base, "runtime/bun"), binary, {
    mode: 0o755,
    flag: "wx",
  });
  await chmod(join(base, "runtime/bun"), 0o755);
  await nodeCommand(
    pins.node,
    npm,
    [
      "ci",
      "--ignore-scripts",
      "--audit=false",
      "--fund=false",
      "--workspaces=false",
      "--include=optional",
      "--registry=https://registry.npmjs.org/",
    ],
    join(base, "install"),
    env,
  );
  const installEntries = await assertInstalledClosure(
    join(base, "install"),
    pins.links,
  );
  if (
    (await resourceFileSha256(join(base, "install/package-lock.json"))) !==
      pins.lockSha256 ||
    (await resourceFileSha256(join(base, "install/package.json"))) !==
      pins.packageSha256
  )
    throw new Error("Installer changed pinned input");
  await writeFile(
    join(base, "receipt.json"),
    `${JSON.stringify({ schemaVersion: 1, platform, arch, scriptsExecuted: false, runtimeExecuted: false, packageSha256: pins.packageSha256, lockSha256: pins.lockSha256, pinsSha256: await resourceFileSha256(join(packageDir, "installer-pins.json")), engineSha256: pins.bun.binarySha256, installEntries }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return base;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2)
    throw new Error("Usage: prepare-event-host.mjs (exact local target only)");
  console.log(await prepareEventHost());
}
