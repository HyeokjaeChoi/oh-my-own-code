// Windows replacement for POSIX "owner uid + no group/other bits": a directory is
// PRIVATE when its owner is the current user (or Administrators) and its DACL
// grants access to nobody beyond the current user, SYSTEM, Administrators and
// CREATOR OWNER. Inspection goes through Windows PowerShell (Get-Acl, SIDs only,
// so no localized account names). Children created inside a verified private
// directory inherit its DACL; callers verify roots, not every file.
import { execFile, execFileSync } from "node:child_process";
import { win32 } from "node:path";
import { trustedSystemRoot } from "./platform-paths.mjs";

export const SID_SYSTEM = "S-1-5-18";
export const SID_ADMINISTRATORS = "S-1-5-32-544";
export const SID_CREATOR_OWNER = "S-1-3-0";
const SID = /^S-1-\d+(?:-\d+){1,15}$/u;

export const WINDOWS_ACL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$items=@()",
  "foreach($p in ($env:OMOC_ACL_PATHS -split '\\|')){",
  "$a=Get-Acl -LiteralPath $p",
  "$o=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
  "$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Value;allow=($_.AccessControlType -eq 'Allow')}})",
  "$items+=[pscustomobject]@{path=$p;owner=$o;rules=$r}",
  "}",
  "[pscustomobject]@{me=$me;items=$items}|ConvertTo-Json -Depth 5 -Compress",
].join(";");

const asArray = (value) =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];

// Pure policy. Throws "storage_denied" unless the item is private to `me`.
export function judgeWindowsAcl(item, me) {
  if (!SID.test(me ?? "")) throw new Error("storage_denied");
  if (
    !item ||
    typeof item.owner !== "string" ||
    ![me, SID_ADMINISTRATORS].includes(item.owner)
  )
    throw new Error("storage_denied");
  const allowed = new Set([
    me,
    SID_SYSTEM,
    SID_ADMINISTRATORS,
    SID_CREATOR_OWNER,
  ]);
  const rules = asArray(item.rules);
  // An empty DACL grants everyone nothing, but an absent/unreadable one is unknown.
  if (!rules.length) throw new Error("storage_denied");
  for (const rule of rules) {
    if (typeof rule?.sid !== "string" || !SID.test(rule.sid))
      throw new Error("storage_denied");
    if (rule.allow === true && !allowed.has(rule.sid))
      throw new Error("storage_denied");
  }
  return true;
}

export function parseWindowsAcl(output, paths) {
  let parsed;
  try {
    parsed = JSON.parse(String(output).trim());
  } catch {
    throw new Error("storage_denied");
  }
  const items = asArray(parsed?.items);
  if (items.length !== paths.length) throw new Error("storage_denied");
  items.forEach((item, index) => {
    if (item?.path !== paths[index]) throw new Error("storage_denied");
    judgeWindowsAcl(item, parsed.me);
  });
  return true;
}

function command(paths, env = process.env) {
  if (
    !paths.length ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        !win32.isAbsolute(path) ||
        path.includes("|") ||
        path.includes("\0"),
    )
  )
    throw new Error("storage_denied");
  const root = trustedSystemRoot(env);
  return {
    file: win32.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_ACL_SCRIPT,
    ],
    options: {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1 << 20,
      windowsHide: true,
      env: { SystemRoot: root, OMOC_ACL_PATHS: paths.join("|") },
    },
  };
}

const verified = new Set();
const pending = (paths) => paths.filter((path) => !verified.has(path));

export function assertWindowsPrivateDirectoriesSync(
  paths,
  { platform = process.platform, run = execFileSync, env } = {},
) {
  if (platform !== "win32") return true;
  const todo = pending(paths);
  if (!todo.length) return true;
  const { file, args, options } = command(todo, env);
  let output;
  try {
    output = run(file, args, options);
  } catch {
    throw new Error("storage_denied");
  }
  parseWindowsAcl(output, todo);
  for (const path of todo) verified.add(path);
  return true;
}

export async function assertWindowsPrivateDirectories(
  paths,
  { platform = process.platform, run = execFile, env } = {},
) {
  if (platform !== "win32") return true;
  const todo = pending(paths);
  if (!todo.length) return true;
  const { file, args, options } = command(todo, env);
  const output = await new Promise((resolve, reject) =>
    run(file, args, options, (error, stdout) =>
      error ? reject(new Error("storage_denied")) : resolve(stdout),
    ),
  );
  parseWindowsAcl(output, todo);
  for (const path of todo) verified.add(path);
  return true;
}
// Test seam: forget cached verdicts.
export const resetWindowsAclCache = () => verified.clear();
