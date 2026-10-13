// Cross-platform "direct children of PID whose command line matches" for e2e scripts.
// POSIX: pgrep. Windows: Win32_Process via PowerShell (pgrep does not exist).
import { execFileSync } from "node:child_process";

export function windowsChildQuery(parentPid, pattern) {
  const parent = Number(parentPid);
  if (!Number.isSafeInteger(parent) || parent <= 0)
    throw new Error("invalid pid");
  // Single-quoted PowerShell literal; embedded quotes doubled.
  // PowerShell also treats the typographic single quotes U+2018/U+2019/U+201A/U+201B as quotes.
  const literal = `'${String(pattern).replace(/['\u2018\u2019\u201a\u201b]/gu, (q) => q + q)}'`;
  return `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parent}" | Where-Object { ($_.CommandLine + ' ' + $_.Name) -match ${literal} } | ForEach-Object { $_.ProcessId }`;
}

export function childPids(
  parentPid,
  pattern,
  { platform = process.platform, run = execFileSync } = {},
) {
  if (platform === "win32") {
    const root = process.env.SystemRoot ?? "C:\\Windows";
    const output = run(
      `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsChildQuery(parentPid, pattern),
      ],
      { encoding: "utf8" },
    );
    return output.split(/\s+/).filter(Boolean).map(Number);
  }
  try {
    const output = run("pgrep", ["-P", String(parentPid), "-f", pattern], {
      encoding: "utf8",
    });
    return output.split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    if (error?.status === 1 && !error.signal) return [];
    throw error;
  }
}
