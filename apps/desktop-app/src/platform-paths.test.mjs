import assert from "node:assert/strict";
import test from "node:test";
import {
  comparablePath,
  directorySyncSupported,
  hasUnsafeWindowsComponent,
  hasWindowsAlternateStream,
  isPathInside,
  isVcsMetadataComponent,
  isWindowsReservedName,
  killProcessTree,
  renameWithRetry,
  retryTransient,
  stripExtendedPrefix,
  taskkillCommand,
  windowsSpawnPlan,
} from "./platform-paths.mjs";

const W = "win32";

test("extended prefixes normalize to the plain path", () => {
  assert.equal(stripExtendedPrefix("\\\\?\\C:\\a"), "C:\\a");
  assert.equal(stripExtendedPrefix("\\\\?\\UNC\\h\\s\\a"), "\\\\h\\s\\a");
  assert.equal(
    comparablePath("\\\\?\\c:\\Work\\", W),
    comparablePath("C:/work", W),
  );
});

test("containment is case-, separator- and drive-letter-insensitive on win32", () => {
  assert.equal(
    isPathInside("C:\\Work\\Proj", "c:\\work\\proj\\src\\a.js", W),
    true,
  );
  assert.equal(isPathInside("C:\\Work\\Proj", "C:/WORK/PROJ", W), true);
  assert.equal(isPathInside("C:\\Work\\Proj", "C:\\Work\\Proj2\\a", W), false);
  assert.equal(
    isPathInside("C:\\Work\\Proj", "C:\\Work\\Proj\\..\\x", W),
    false,
  );
  assert.equal(isPathInside("C:\\Work\\Proj", "D:\\Work\\Proj\\a", W), false);
  assert.equal(isPathInside("C:\\Work", "\\\\srv\\share\\Work\\a", W), false);
  assert.equal(isPathInside("C:\\Work", "\\\\.\\C:\\Work\\a", W), false);
  assert.equal(
    isPathInside("\\\\srv\\share\\Proj", "\\\\SRV\\Share\\proj\\a", W),
    true,
  );
  assert.equal(
    isPathInside("C:\\Work\\Proj", "C:\\Work\\Proj\\..foo", W),
    true,
  );
});

test("containment on posix stays case-sensitive", () => {
  assert.equal(isPathInside("/w/p", "/w/p/a", "linux"), true);
  assert.equal(isPathInside("/w/p", "/w/P/a", "linux"), false);
  assert.equal(isPathInside("/w/p", "/w/p/../x", "linux"), false);
  assert.equal(isPathInside("/w/p", "/w/p/..x", "linux"), true);
});

test("reserved device names, with extensions, spaces and streams", () => {
  for (const n of [
    "CON",
    "con",
    "NUL.txt",
    "aux.tar.gz",
    "COM1",
    "lpt9",
    "com\u00b9",
    "NUL :x",
    "CONIN$",
  ])
    assert.equal(isWindowsReservedName(n), true, n);
  for (const n of ["CONSOLE", "nully", "com10", "a.con", "lpt"])
    assert.equal(isWindowsReservedName(n), false, n);
});

test("alternate data streams and unsafe components", () => {
  assert.equal(hasWindowsAlternateStream("C:\\a\\f.txt:s"), true);
  assert.equal(hasWindowsAlternateStream("C:\\a\\f.txt::$DATA"), true);
  assert.equal(hasWindowsAlternateStream("C:\\a\\f.txt"), false);
  assert.equal(hasWindowsAlternateStream("\\\\srv\\share\\f.txt"), false);
  assert.equal(hasWindowsAlternateStream("\\\\?\\C:\\a\\f.txt"), false);
  assert.equal(hasUnsafeWindowsComponent("C:\\a\\NUL"), true);
  assert.equal(hasUnsafeWindowsComponent("C:\\a\\b.\\c"), true);
  assert.equal(hasUnsafeWindowsComponent("C:\\a\\b \\c"), true);
  assert.equal(hasUnsafeWindowsComponent("C:\\a\\b?c"), true);
  assert.equal(hasUnsafeWindowsComponent("\\\\.\\PhysicalDrive0"), true);
  assert.equal(hasUnsafeWindowsComponent("C:\\a\\..\\b\\c.txt"), false);
});

test("VCS metadata component aliases on NTFS", () => {
  for (const n of [
    ".git",
    ".GIT",
    ".Git.",
    ".git ",
    ".git::$INDEX_ALLOCATION",
    ".git:stream",
    "GIT~1",
    "git~12",
    ".hg",
    ".HG.",
    "HG~1",
  ])
    assert.equal(isVcsMetadataComponent(n, { platform: W }), true, n);
  for (const n of ["git", ".github", ".gitignore", "gitx~1", "a.git", ".gi"])
    assert.equal(isVcsMetadataComponent(n, { platform: W }), false, n);
  assert.equal(isVcsMetadataComponent(".GIT", { platform: "linux" }), false);
  assert.equal(
    isVcsMetadataComponent(".GIT", {
      platform: "darwin",
      caseInsensitive: true,
    }),
    true,
  );
  assert.equal(isVcsMetadataComponent(".git", { platform: "linux" }), true);
});

test("taskkill command is absolute, tree + force, pid validated", () => {
  assert.deepEqual(taskkillCommand(42, { systemRoot: "D:\\WinNT" }), {
    file: "D:\\WinNT\\System32\\taskkill.exe",
    args: ["/PID", "42", "/T", "/F"],
  });
  assert.equal(
    taskkillCommand(7, { systemRoot: "relative" }).file,
    "C:\\Windows\\System32\\taskkill.exe",
  );
  assert.deepEqual(taskkillCommand(7, { force: false }).args, [
    "/PID",
    "7",
    "/T",
  ]);
  for (const bad of [0, -1, 1.5, "1", NaN])
    assert.throws(() => taskkillCommand(bad));
});

test("killProcessTree uses taskkill on win32 and plain signal elsewhere", () => {
  const calls = [];
  const spawnProcess = (file, args, options) => {
    calls.push({ file, args, options });
    return { once() {}, unref() {} };
  };
  const signals = [];
  const child = { pid: 9, kill: (s) => (signals.push(s), true) };
  assert.equal(
    killProcessTree(child, "SIGKILL", {
      platform: W,
      spawnProcess,
      systemRoot: "C:\\Windows",
    }),
    true,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["/PID", "9", "/T", "/F"]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(signals, ["SIGKILL"]);
  calls.length = 0;
  killProcessTree(child, "SIGTERM", { platform: "darwin", spawnProcess });
  assert.equal(calls.length, 0);
  assert.equal(
    killProcessTree({ pid: undefined, kill() {} }, "SIGTERM"),
    false,
  );
});

test(".cmd/.bat spawn plan: cmd.exe /d /s /c with verbatim, unsafe args refused", () => {
  const plan = windowsSpawnPlan(
    "C:\\Program Files\\nodejs\\pnpm.cmd",
    ["run", "a b"],
    {
      platform: W,
      comspec: "C:\\Windows\\System32\\cmd.exe",
    },
  );
  assert.equal(plan.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(plan.args, [
    "/d",
    "/s",
    "/c",
    '""C:\\Program Files\\nodejs\\pnpm.cmd" run "a b""',
  ]);
  assert.equal(plan.options.windowsVerbatimArguments, true);
  for (const bad of [
    "a&calc",
    "a|b",
    "%PATH%",
    'a"b',
    "a^b",
    "a>b",
    "a\nb",
    "a`b",
    "a!b",
  ])
    assert.throws(
      () => windowsSpawnPlan("pnpm.cmd", [bad], { platform: W }),
      /unsafe_cmd_argument/,
      bad,
    );
  assert.throws(() => windowsSpawnPlan("x&y.cmd", [], { platform: W }));
  // relative/missing ComSpec falls back to the system cmd.exe
  assert.equal(
    windowsSpawnPlan("a.bat", [], { platform: W, comspec: "cmd" }).file,
    "C:\\Windows\\System32\\cmd.exe",
  );
  // exe and non-win32 are untouched
  assert.deepEqual(windowsSpawnPlan("git.exe", ["--v"], { platform: W }), {
    file: "git.exe",
    args: ["--v"],
    options: {},
  });
  assert.deepEqual(
    windowsSpawnPlan("pnpm.cmd", ["a&b"], { platform: "linux" }),
    { file: "pnpm.cmd", args: ["a&b"], options: {} },
  );
});

test("retryTransient retries EPERM/EBUSY/EACCES on win32 only, bounded", async () => {
  const sleeps = [];
  const sleep = async (ms) => sleeps.push(ms);
  let n = 0;
  const flaky = async () => {
    if (++n < 3)
      throw Object.assign(new Error("x"), {
        code: n === 1 ? "EPERM" : "EBUSY",
      });
    return "ok";
  };
  assert.equal(await retryTransient(flaky, { platform: W, sleep }), "ok");
  assert.equal(n, 3);
  assert.deepEqual(sleeps, [25, 50]);
  let m = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        m++;
        throw Object.assign(new Error("x"), { code: "EPERM" });
      },
      { platform: W, sleep, attempts: 4 },
    ),
    { code: "EPERM" },
  );
  assert.equal(m, 4);
  let p = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        p++;
        throw Object.assign(new Error("x"), { code: "EPERM" });
      },
      { platform: "darwin", sleep },
    ),
  );
  assert.equal(p, 1);
  let q = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        q++;
        throw Object.assign(new Error("x"), { code: "ENOENT" });
      },
      { platform: W, sleep },
    ),
  );
  assert.equal(q, 1);
});

test("renameWithRetry and directory sync policy", async () => {
  let n = 0;
  const io = {
    rename: async () => {
      if (++n === 1) throw Object.assign(new Error("x"), { code: "EBUSY" });
    },
  };
  await renameWithRetry(io, "a", "b", { platform: W, sleep: async () => {} });
  assert.equal(n, 2);
  assert.equal(directorySyncSupported(W), false);
  assert.equal(directorySyncSupported("darwin"), true);
});

import { pinnedOpenFlags } from "./platform-paths.mjs";
test("pinnedOpenFlags: win32 needs none, posix needs all three", () => {
  assert.deepEqual(pinnedOpenFlags({}, "win32"), {
    O_NOFOLLOW: 0,
    O_NONBLOCK: 0,
    O_DIRECTORY: 0,
    supported: true,
  });
  assert.equal(pinnedOpenFlags({}, "darwin").supported, false);
  assert.equal(
    pinnedOpenFlags({ O_NOFOLLOW: 1, O_NONBLOCK: 2, O_DIRECTORY: 4 }, "linux")
      .supported,
    true,
  );
  assert.equal(
    pinnedOpenFlags({ O_NOFOLLOW: 1, O_NONBLOCK: 0, O_DIRECTORY: 4 }, "linux")
      .supported,
    false,
  );
  assert.equal(pinnedOpenFlags().supported, true);
});

import { workspaceFilePathReason } from "./renderer/shared/workspace-file/index.mjs";
test("workspace file paths refuse NTFS 8.3 aliases of protected names", () => {
  for (const p of [
    "GIT~1/config",
    "src/ENV~1",
    "a/PROGRA~1.TXT",
    ".GIT/x",
    "CON",
    "a.",
    "x:y",
  ])
    assert.notEqual(workspaceFilePathReason(p), undefined, p);
  for (const p of ["src/index.mjs", "notes.md", "a/b.c"])
    assert.equal(workspaceFilePathReason(p), undefined, p);
});

import { sensitiveName, relativeParts } from "./host/workbench-files.mjs";
import { isWindowsShortAlias } from "./platform-paths.mjs";
test("sensitiveName ignores trailing dots/spaces; short alias detection", () => {
  for (const n of [".env.", ".env ", ".git.", "secrets. ."])
    assert.equal(sensitiveName(n), true, n);
  for (const n of ["src", "env", "a.txt"])
    assert.equal(sensitiveName(n), false, n);
  assert.equal(isWindowsShortAlias("GIT~1"), true);
  assert.equal(isWindowsShortAlias("ENV~1.TXT"), true);
  assert.equal(isWindowsShortAlias("PROGRA~12"), true);
  assert.equal(isWindowsShortAlias("notes.md"), false);
  assert.deepEqual(relativeParts("a/b"), ["a", "b"]);
  assert.throws(() => relativeParts("a/.env."));
});

import { samePath } from "./platform-paths.mjs";
test("samePath: NTFS names are case/separator-insensitive, POSIX names exact", () => {
  assert.equal(samePath("C:\\Work\\Proj", "c:/work/proj/", "win32"), true);
  assert.equal(samePath("C:\\Work\\Proj", "C:\\Work\\Proj2", "win32"), false);
  assert.equal(samePath("C:\\Work", "D:\\Work", "win32"), false);
  assert.equal(samePath("\\\\?\\C:\\Work", "C:\\work", "win32"), true);
  assert.equal(samePath("/w/p", "/w/P", "darwin"), false);
  assert.equal(samePath("/w/p", "/w/p", "linux"), true);
  assert.equal(samePath(undefined, "/w", "linux"), false);
});

import { trustedSystemRoot } from "./platform-paths.mjs";
test("SystemRoot is trusted only as a local absolute drive path", () => {
  assert.equal(trustedSystemRoot({ SystemRoot: "D:\\WinNT\\" }), "D:\\WinNT");
  for (const bad of [
    undefined,
    "",
    "relative",
    "\\\\evil\\share\\Windows",
    "\\\\?\\C:\\Windows",
    "C:Windows",
    "C:\\a|b",
  ])
    assert.equal(
      trustedSystemRoot({ SystemRoot: bad }),
      "C:\\Windows",
      String(bad),
    );
});
