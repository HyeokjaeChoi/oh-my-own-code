// Run on the Windows machine: `node apps/desktop-app/scripts/windows-preflight.mjs`
// Prints one JSON report of platform facts the app depends on. Read-only except
// for a scratch dir under os.tmpdir() that is removed afterwards. Never throws.
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdtemp,
  mkdir,
  open,
  rename,
  rm,
  statfs,
  symlink,
  writeFile,
} from "node:fs/promises";
import { arch, platform, release, tmpdir, version as osVersion } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsSpawnPlan } from "../src/platform-paths.mjs";
import { assertWindowsPrivateDirectoriesSync } from "../src/windows-acl.mjs";
import { windowsStartScript } from "../src/sidecar-supervisor.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const win = platform() === "win32";
const root = process.env.SystemRoot ?? "C:\\Windows";
const ps = join(
  root,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const run = (file, args, options = {}) => {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    return {
      error: String(error.code ?? error.status ?? error.message).slice(0, 120),
    };
  }
};
const psRun = (script) =>
  run(ps, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
const tool = (name) => {
  const plan = windowsSpawnPlan(name, ["--version"], {
    platform: platform(),
  });
  return run(plan.file, plan.args, plan.options);
};
const attempt = async (fn) => {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? String(error?.message).slice(0, 80),
    };
  }
};

const report = {
  schema: 1,
  platform: platform(),
  arch: arch(),
  osRelease: release(),
  osVersion: osVersion(),
  node: process.version,
  nodeArch: process.arch,
  comspec: process.env.ComSpec ?? null,
  systemRoot: process.env.SystemRoot ?? null,
  repoRoot: here,
  repoPathLength: here.length,
  checks: {},
  facts: {},
};
const check = (name, ok, detail) => {
  report.checks[name] = {
    ok: Boolean(ok),
    ...(detail !== undefined && { detail }),
  };
};

check(
  "platform_is_win32_x64",
  win && arch() === "x64",
  `${platform()}-${arch()}`,
);
check("node_24", process.versions.node.split(".")[0] === "24", process.version);
report.facts.fsConstants = Object.fromEntries(
  ["O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK", "O_SYMLINK"].map((k) => [
    k,
    constants[k] ?? null,
  ]),
);

const scratch = await mkdtemp(join(tmpdir(), "omoc-win-preflight-"));
try {
  report.facts.scratch = scratch;
  report.facts.scratchPathLength = scratch.length;

  if (win) {
    const reg = run(root + "\\System32\\reg.exe", [
      "query",
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem",
      "/v",
      "LongPathsEnabled",
    ]);
    check(
      "long_paths_enabled",
      typeof reg === "string" && /0x1\s*$/m.test(reg),
      reg,
    );
    const dot3 = run(root + "\\System32\\fsutil.exe", [
      "8dot3name",
      "query",
      scratch.slice(0, 2),
    ]);
    report.facts.dot3name = dot3;
    report.facts.powershellVersion = psRun(
      "$PSVersionTable.PSVersion.ToString()",
    );
    check(
      "powershell_5_or_newer",
      typeof report.facts.powershellVersion === "string" &&
        Number(report.facts.powershellVersion.split(".")[0]) >= 5,
      report.facts.powershellVersion,
    );
    check(
      "comspec_is_cmd",
      /\\cmd\.exe$/i.test(process.env.ComSpec ?? ""),
      process.env.ComSpec,
    );
    const defender = psRun("(Get-MpPreference).ExclusionPath -join ';'");
    report.facts.defenderExclusions = defender;
    check(
      "defender_exclusion_for_repo",
      typeof defender === "string" &&
        defender.toLowerCase().includes(here.toLowerCase().slice(0, 3)),
      "hint only: exclude the repo, node_modules and %LOCALAPPDATA%\\pnpm (build/test are 2-5x slower otherwise); needs admin to read",
    );
    // Process identity (CIM creation FILETIME) is the Windows lifetime witness.
    const startIdentity = [
      psRun(windowsStartScript(process.pid)),
      psRun(windowsStartScript(process.pid)),
    ];
    check(
      "process_start_identity",
      typeof startIdentity[0] === "string" &&
        /^OK:\d{15,19}$/.test(startIdentity[0]) &&
        startIdentity[0] === startIdentity[1],
      startIdentity,
    );
    check(
      "absent_pid_is_authoritative",
      psRun(windowsStartScript(2147483646)) === "ABSENT",
      "CIM must answer ABSENT for a PID that cannot exist",
    );
    // The app refuses to run unless these directories are private to this user (DACL).
    for (const [name, dir] of [
      ["appdata_private_acl", process.env.APPDATA],
      ["temp_private_acl", process.env.TEMP ?? process.env.TMP],
    ]) {
      try {
        assertWindowsPrivateDirectoriesSync([dir]);
        check(name, true, dir);
      } catch {
        check(
          name,
          false,
          `${dir}: owner is not you/Administrators, or another principal has access; the app refuses such a profile`,
        );
      }
    }
    check(
      "taskkill_present",
      typeof run(root + "\\System32\\taskkill.exe", ["/?"]) === "string",
    );
  }

  const link = await attempt(async () => {
    await writeFile(join(scratch, "t.txt"), "x");
    await symlink(join(scratch, "t.txt"), join(scratch, "l.txt"));
  });
  check(
    "file_symlink_privilege",
    link.ok,
    link.ok
      ? undefined
      : `${link.code} (enable Developer Mode or run elevated; e2e symlink legs are skipped without it)`,
  );
  const junction = await attempt(async () => {
    await mkdir(join(scratch, "d"));
    await symlink(join(scratch, "d"), join(scratch, "j"), "junction");
  });
  check(
    "junction_creatable",
    junction.ok,
    junction.ok ? undefined : junction.code,
  );

  const dirSync = await attempt(async () => {
    const handle = await open(scratch, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  report.facts.directoryFsync = dirSync; // expected on win32: ok:false (EPERM) => code skips it
  const holder = join(scratch, "held.txt");
  await writeFile(holder, "a");
  await writeFile(join(scratch, "next.txt"), "b");
  const handle = await open(holder, "r");
  const over = await attempt(() => rename(join(scratch, "next.txt"), holder));
  await handle.close();
  report.facts.renameOverOpenFile = over; // win32: usually EPERM/EBUSY => retryTransient
  const reserved = await attempt(() =>
    open(join(scratch, "NUL"), "r").then((h) => h.close()),
  );
  report.facts.reservedNameOpensDevice = reserved.ok;
  const ads = await attempt(async () => {
    await writeFile(join(scratch, "a.txt:ads"), "x");
  });
  report.facts.alternateDataStreamsWritable = ads.ok;
  const deep = join(
    scratch,
    ...Array(12).fill("long_directory_name_segment_x"),
  );
  const long = await attempt(async () => {
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, "f.txt"), "x");
  });
  check(
    "path_over_260_usable",
    long.ok,
    `${deep.length} chars: ${long.ok ? "ok" : long.code}`,
  );
  const fs = await attempt(() => statfs(scratch));
  if (fs.ok) {
    const freeGiB = Number(
      (fs.value.bavail * fs.value.bsize) / 1024 ** 3,
    ).toFixed(1);
    check(
      "free_disk_10GiB",
      Number(freeGiB) >= 10,
      `${freeGiB} GiB on the temp volume`,
    );
  } else check("free_disk_10GiB", false, fs.code);
  const repoFs = await attempt(() => statfs(here));
  if (repoFs.ok)
    check(
      "free_disk_repo_10GiB",
      (repoFs.value.bavail * repoFs.value.bsize) / 1024 ** 3 >= 10,
      `${((repoFs.value.bavail * repoFs.value.bsize) / 1024 ** 3).toFixed(1)} GiB`,
    );
  report.facts.git = tool("git");
  report.facts.pnpm = tool(win ? "pnpm.cmd" : "pnpm");
  report.facts.npm = tool(win ? "npm.cmd" : "npm");
  check("git_present", typeof report.facts.git === "string", report.facts.git);
  check(
    "pnpm_present",
    typeof report.facts.pnpm === "string",
    report.facts.pnpm,
  );
} finally {
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}
report.ok = Object.values(report.checks).every((c) => c.ok);
console.log(JSON.stringify(report, null, 2));
