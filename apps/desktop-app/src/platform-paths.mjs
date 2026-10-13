/* eslint-disable no-control-regex -- Windows name rules are defined over control characters */
// Platform-neutral path/process helpers shared by main, host and scripts.
// Every function takes `platform` (default: this process) so Windows rules are
// unit-testable on any OS. Pure: no fs access, no module state.
import { constants } from "node:fs";
import { posix, win32 } from "node:path";

// SystemRoot comes from the environment; only a local absolute drive path is trusted
// (never UNC, never relative), otherwise the stock location is used.
export function trustedSystemRoot(env = process.env) {
  const value = env.SystemRoot;
  return typeof value === "string" &&
    /^[A-Za-z]:\\[^<>"|?*\u0000-\u001f]*$/u.test(value)
    ? value.replace(/\\+$/u, "")
    : "C:\\Windows";
}
export const isWin32 = (platform = process.platform) => platform === "win32";
export const pathApiFor = (platform = process.platform) =>
  isWin32(platform) ? win32 : posix;

// `\\?\C:\x` -> `C:\x`, `\\?\UNC\h\s\x` -> `\\h\s\x`. Every other extended
// or device form (`\\?\GLOBALROOT\...`, `\\?\Volume{GUID}\...`, `\\.\...`) has no
// plain equivalent: stripping it would leave a relative path that later code
// resolves against the cwd, so those are returned UNCHANGED (still prefixed) and
// reported by isWindowsDevicePath / hasUnsafeWindowsComponent.
export function stripExtendedPrefix(path) {
  if (/^\\\\\?\\UNC\\[^\\]+\\[^\\]+/iu.test(path))
    return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:(?:\\|$)/u.test(path)) return path.slice(4);
  return path;
}

// Device namespace or an extended form that could not be reduced to a plain path.
export const isWindowsDevicePath = (path) =>
  /^[\\/]{2}[.?][\\/]/u.test(path) && stripExtendedPrefix(path) === path;
// UNC share path (reaching it makes Windows authenticate to that host).
export const isWindowsNetworkPath = (path) =>
  /^[\\/]{2}[^.?\\/]/u.test(stripExtendedPrefix(path)) ||
  /^\\\\\?\\UNC\\/iu.test(path);

// NTFS compares names through its $UpCase table: one UTF-16 code point maps to
// one code point. JavaScript's toUpperCase also expands (ß -> SS, ﬁ -> FI), which
// would make different NTFS names compare equal, so only 1:1 mappings are used;
// dotless i folds to I like in the table.
export function foldName(value) {
  let out = "";
  for (const ch of value) {
    const upper = ch.toUpperCase();
    out += [...upper].length === 1 ? upper : ch;
  }
  return out;
}

// Comparison key: identical keys mean the same NTFS name (case-insensitive,
// separator-insensitive, extended-prefix-insensitive, trailing separator trimmed).
// Forms with no plain equivalent get a key no plain path can have.
export function comparablePath(path, platform = process.platform) {
  if (!isWin32(platform)) return posix.normalize(path);
  const plain = stripExtendedPrefix(path);
  if (isWindowsDevicePath(plain) || !win32.isAbsolute(plain))
    return `\u0000unsafe:${path}`;
  const normalized = win32.normalize(plain);
  const root = win32.parse(normalized).root;
  const trimmed =
    normalized.length > root.length
      ? normalized.replace(/[\\]+$/u, "")
      : normalized;
  return foldName(trimmed);
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
  const keys = [
    comparablePath(root, platform),
    comparablePath(target, platform),
  ];
  if (keys.some((key) => key.startsWith("\u0000"))) return false;
  const rel = win32.relative(keys[0], keys[1]);
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
  if (
    isWindowsDevicePath(path) ||
    /^[\\/]{2}[.?][\\/]/u.test(stripExtendedPrefix(path))
  )
    return true;
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
    const folded = foldName(name.split(":")[0].replace(/[. ]+$/u, ""));
    return (
      folded === ".GIT" ||
      folded === ".HG" ||
      /^(?:GIT|HG)~[0-9]+$/u.test(folded)
    );
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

// POSIX pins directories/files with O_NOFOLLOW|O_DIRECTORY|O_NONBLOCK. Windows
// has none of them: libuv opens reparse points transparently, so the callers'
// lstat -> open -> fstat(dev/ino) -> lstat identity check (which rejects symlinks
// and junctions, and any swap between the checks) is the whole defence there.
// `supported` is false only where the platform SHOULD have the flags but does not.
export function pinnedOpenFlags(
  fsConstants = constants,
  platform = process.platform,
) {
  const names = ["O_NOFOLLOW", "O_NONBLOCK", "O_DIRECTORY"];
  if (isWin32(platform))
    return { O_NOFOLLOW: 0, O_NONBLOCK: 0, O_DIRECTORY: 0, supported: true };
  return {
    ...Object.fromEntries(names.map((k) => [k, fsConstants[k]])),
    supported: names.every(
      (k) => Number.isInteger(fsConstants[k]) && fsConstants[k] !== 0,
    ),
  };
}

// NTFS 8.3 short alias such as GIT~1 / ENV~1.TXT: opens the aliased entry, so
// it can bypass any name-based deny. Refused wherever a name is user-supplied.
export const isWindowsShortAlias = (name) =>
  /^[^.]{1,6}~[0-9]{1,6}(?:\.[^.]{0,3})?$/u.test(name);

// Path identity for comparing a path we canonicalized with one a runtime reported:
// NTFS names are case/separator-insensitive, POSIX names are exact.
export const samePath = (a, b, platform = process.platform) =>
  typeof a === "string" &&
  typeof b === "string" &&
  (isWin32(platform)
    ? comparablePath(a, platform) === comparablePath(b, platform)
    : a === b);
