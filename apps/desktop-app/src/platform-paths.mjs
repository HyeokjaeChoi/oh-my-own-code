/* eslint-disable no-control-regex -- Windows name rules are defined over control characters */
// Platform-neutral path/process helpers shared by main, host and scripts.
// Every function takes `platform` (default: this process) so Windows rules are
// unit-testable on any OS. Pure: no fs access, no module state.
import { posix, win32 } from "node:path";

export const isWin32 = (platform = process.platform) => platform === "win32";
export const pathApiFor = (platform = process.platform) =>
  isWin32(platform) ? win32 : posix;

// `\\?\C:\x` -> `C:\x`, `\\?\UNC\h\s\x` -> `\\h\s\x`. `\\.\` device paths are
// never valid file targets and are returned unchanged for callers to refuse.
export function stripExtendedPrefix(path) {
  if (/^\\\\\?\\UNC\\/iu.test(path)) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\/u.test(path)) return path.slice(4);
  return path;
}

export const isWindowsDevicePath = (path) => /^\\\\\.\\/u.test(path);

// Comparison key: identical keys mean the same NTFS name (case-insensitive,
// separator-insensitive, extended-prefix-insensitive, trailing separator trimmed).
export function comparablePath(path, platform = process.platform) {
  if (!isWin32(platform)) return posix.normalize(path);
  const normalized = win32.normalize(stripExtendedPrefix(path));
  const root = win32.parse(normalized).root;
  const trimmed =
    normalized.length > root.length
      ? normalized.replace(/[\\]+$/u, "")
      : normalized;
  return trimmed.toUpperCase();
}

// True when `target` is `root` or lies strictly below it (lexical only).
export function isPathInside(root, target, platform = process.platform) {
  if (!isWin32(platform)) {
    const rel = posix.relative(root, target);
    return (
      rel === "" ||
      (rel !== ".." && !rel.startsWith("../") && !posix.isAbsolute(rel))
    );
  }
  if (isWindowsDevicePath(root) || isWindowsDevicePath(target)) return false;
  const rel = win32.relative(
    comparablePath(root, platform),
    comparablePath(target, platform),
  );
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("..\\") && !win32.isAbsolute(rel))
  );
}

const RESERVED =
  /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/iu;
// CON, con.txt, "NUL .x", COM1:stream are all the legacy DOS devices.
export function isWindowsReservedName(name) {
  const base = String(name).split(":")[0].split(".")[0].replace(/ +$/u, "");
  return RESERVED.test(base);
}

// Drive prefix / UNC share are the only legitimate colons in a Windows path.
export function hasWindowsAlternateStream(path) {
  return /:/u.test(
    stripExtendedPrefix(path).replace(/^(?:[A-Za-z]:|\\\\[^\\]+\\[^\\]+)/u, ""),
  );
}

// A single path component NTFS/Win32 would not treat as a plain literal name.
export function isUnsafeWindowsComponent(name) {
  return (
    name === "" ||
    isWindowsReservedName(name) ||
    name.includes(":") ||
    /[<>"|?*\u0000-\u001f]/u.test(name) ||
    /[. ]$/u.test(name)
  );
}

// Whole-path variant (absolute or relative). `\\?\`-prefixed input is checked
// after the prefix is stripped; device paths are always unsafe.
export function hasUnsafeWindowsComponent(path) {
  if (isWindowsDevicePath(path)) return true;
  if (hasWindowsAlternateStream(path)) return true;
  const parsed = win32.parse(stripExtendedPrefix(path));
  const rest = stripExtendedPrefix(path).slice(parsed.root.length);
  return rest
    .split(/[\\/]+/u)
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .some(
      (part) =>
        isWindowsReservedName(part) ||
        /[<>"|?*\u0000-\u001f]/u.test(part) ||
        /[. ]$/u.test(part),
    );
}

const VCS = new Set([".git", ".hg"]);
// Does this path COMPONENT name VCS metadata? On NTFS the same directory is
// reachable as `.GIT`, `.git.`, `.git `, `.git::$INDEX_ALLOCATION`, `.git:x`
// and the 8.3 alias `GIT~1`; all are refused. Elsewhere the match is exact, or
// case-folded when the caller probed a case-insensitive volume.
export function isVcsMetadataComponent(
  name,
  { platform = process.platform, caseInsensitive = false } = {},
) {
  if (isWin32(platform)) {
    const folded = name
      .split(":")[0]
      .replace(/[. ]+$/u, "")
      .toLowerCase();
    return VCS.has(folded) || /^(?:git|hg)~[0-9]+$/u.test(folded);
  }
  return VCS.has(caseInsensitive ? name.toLowerCase() : name);
}

// Windows transient sharing errors (antivirus, indexer, open handle).
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
export async function retryTransient(
  action,
  {
    platform = process.platform,
    attempts = 8,
    delayMs = 25,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        !isWin32(platform) ||
        attempt >= attempts ||
        !TRANSIENT.has(error?.code)
      )
        throw error;
      await sleep(delayMs * attempt);
    }
  }
}
export const renameReplacing = (from, to, options) =>
  retryTransient(
    () => process.getBuiltinModule("node:fs/promises").rename(from, to),
    options,
  );
export const renameWithRetry = (io, from, to, options) =>
  retryTransient(() => io.rename(from, to), options);

// Directories cannot be fsynced on Windows (opening one for flush fails with
// EPERM); NTFS journals metadata, so durability there rests on the file flush.
export const directorySyncSupported = (platform = process.platform) =>
  !isWin32(platform);

// taskkill command for a whole process tree. Absolute System32 path so a
// poisoned PATH cannot substitute the binary.
export function taskkillCommand(
  pid,
  { systemRoot = process.env.SystemRoot, force = true } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid_pid");
  const root =
    systemRoot && win32.isAbsolute(systemRoot) ? systemRoot : "C:\\Windows";
  return {
    file: win32.join(root, "System32", "taskkill.exe"),
    args: ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
  };
}

// Terminate `child` and, on Windows, its descendants. POSIX keeps the plain
// per-handle signal (callers that spawn detached groups signal the group
// themselves). Never throws; resolves once the signal/taskkill was issued.
export function killProcessTree(
  child,
  signal = "SIGTERM",
  {
    platform = process.platform,
    spawnProcess = (...args) =>
      process.getBuiltinModule("node:child_process").spawn(...args),
    systemRoot,
  } = {},
) {
  if (!child || child.pid === undefined || child.exitCode != null) return false;
  if (isWin32(platform)) {
    try {
      const { file, args } = taskkillCommand(child.pid, { systemRoot });
      const killer = spawnProcess(file, args, {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once?.("error", () => {});
      killer.unref?.();
    } catch {
      /* fall through to the direct kill below */
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

const CMD_UNSAFE = /[\u0000-\u001f%^&|<>"`!]/u;
// Spawning a .cmd/.bat (pnpm.cmd, npm.cmd) needs cmd.exe. Node refuses to do it
// without a shell since CVE-2024-27980, and a shell would re-parse arguments.
// We build the command line ourselves and REFUSE any argument carrying cmd.exe
// metacharacters rather than trying to escape them.
export function windowsSpawnPlan(
  file,
  args = [],
  { platform = process.platform, comspec = process.env.ComSpec } = {},
) {
  if (!isWin32(platform) || !/\.(?:cmd|bat)$/iu.test(file))
    return { file, args, options: {} };
  const shell =
    comspec && win32.isAbsolute(comspec)
      ? comspec
      : "C:\\Windows\\System32\\cmd.exe";
  for (const value of [file, ...args]) {
    if (typeof value !== "string" || CMD_UNSAFE.test(value))
      throw new Error("unsafe_cmd_argument");
  }
  const quote = (value) =>
    /[\s]/u.test(value) || value === "" ? `"${value}"` : value;
  return {
    file: shell,
    args: ["/d", "/s", "/c", `"${[file, ...args].map(quote).join(" ")}"`],
    options: { windowsVerbatimArguments: true, windowsHide: true },
  };
}
