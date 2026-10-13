import { constants } from "node:fs";
import { lstat, realpath, open, opendir, mkdir } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fail, portableName } from "../workbench-contract.mjs";
import {
  isUnsafeWindowsComponent,
  isWindowsShortAlias,
} from "../platform-paths.mjs";

export const MAX_FILE_BYTES = 256 * 1024;
export function sensitiveName(name) {
  // Win32 ignores trailing dots/spaces, so ".env." and ".env " are ".env".
  name = name.replace(/[. ]+$/u, "");
  return (
    /^\.omoc-configuration-/i.test(name) ||
    /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.config|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|opencode\.jsonc?|id_(rsa|ed25519|ecdsa)(?:\.pub)?)$/i.test(
      name,
    ) ||
    /\.(pem|key|p12|pfx|keystore)$/i.test(name)
  );
}
export async function canonicalDirectory(path) {
  const canonical = await realpath(path);
  if (!(await lstat(canonical)).isDirectory()) fail("FILE_DENIED");
  return canonical;
}
export function relativeParts(path = "") {
  if (
    typeof path !== "string" ||
    path.length > 2048 ||
    isAbsolute(path) ||
    /[\\:]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    fail("FILE_DENIED");
  if (!path) return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        sensitiveName(part) ||
        (process.platform === "win32" &&
          (isUnsafeWindowsComponent(part) || isWindowsShortAlias(part))),
    )
  )
    fail("FILE_DENIED");
  return parts;
}
async function checkedPath(root, path) {
  const parts = relativeParts(path);
  if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
    fail("FILE_DENIED");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail("FILE_DENIED");
  }
  const canonical = await realpath(current);
  const rel = relative(root, canonical);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    fail("FILE_DENIED");
  return canonical;
}
export async function listFiles(root, path = "") {
  const target = await checkedPath(root, path);
  const entries = [];
  const directory = await opendir(target);
  for await (const entry of directory) {
    if (
      sensitiveName(entry.name) ||
      entry.isSymbolicLink() ||
      (!entry.isFile() && !entry.isDirectory())
    )
      continue;
    entries.push({
      name: entry.name,
      path: [path, entry.name].filter(Boolean).join("/"),
      type: entry.isDirectory() ? "directory" : "file",
    });
    if (entries.length >= 500) break;
  }
  if ((await checkedPath(root, path)) !== target) fail("FILE_DENIED");
  return {
    path,
    entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export async function readFilePreview(root, path) {
  if (
    /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|woff2?|ttf|mp[34]|mov|exe|dll|dylib|so|db|sqlite3?)$/i.test(
      path,
    )
  )
    fail("FILE_UNSUPPORTED");
  const target = await checkedPath(root, path);
  const before = await lstat(target);
  if (!before.isFile()) fail("FILE_DENIED");
  if (before.size > MAX_FILE_BYTES) fail("FILE_TOO_LARGE");
  const file = await open(
    target,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      (await checkedPath(root, path)) !== target
    )
      fail("FILE_DENIED");
    if (stat.size > MAX_FILE_BYTES) fail("FILE_TOO_LARGE");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) fail("FILE_TOO_LARGE");
    const bytes = buffer.subarray(0, bytesRead);
    if (
      bytes.some(
        (byte) => byte === 0 || (byte < 32 && ![9, 10, 13].includes(byte)),
      )
    )
      fail("FILE_UNSUPPORTED");
    let content;
    try {
      content = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(
        bytes,
      );
    } catch {
      fail("FILE_UNSUPPORTED");
    }
    const after = await lstat(target);
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      (await checkedPath(root, path)) !== target
    )
      fail("FILE_DENIED");
    return { path, content, truncated: false };
  } finally {
    await file.close();
  }
}
export function uuidV7(now = Date.now()) {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function defaultFolderName(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${uuidV7(date.getTime())}`;
}
export async function createFolder(parent, name) {
  const root = await canonicalDirectory(parent);
  if (name?.trim() && !portableName(name)) fail("INVALID_REQUEST");
  for (let attempt = 0; attempt < 5; attempt++) {
    const child = name?.trim() ? name : defaultFolderName();
    if ((await canonicalDirectory(parent)) !== root) fail("FILE_DENIED");
    const target = join(root, child);
    try {
      await mkdir(target, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST" && !name?.trim()) continue;
      throw error;
    }
    if ((await checkedPath(root, child)) !== target) fail("FILE_DENIED");
    return target;
  }
  fail("LIMIT_REACHED");
}
