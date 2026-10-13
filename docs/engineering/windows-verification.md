# Windows 10/11 x64 verification kit

Status: **code prepared on macOS, never run on Windows.** Everything below marked
"expected" is what the code is designed to do; the first run on a real machine is
the actual verification. Record real results in `docs/runs/` only if you want
historical evidence (that folder is not a source of truth).

## 0. Known hard blockers (read first)

The native permission stack is pinned to **darwin-arm64** and fails closed elsewhere.
On Windows the app will therefore stop at startup with a "native startup unverified"
recovery screen until these are ported. The following were NOT changed because they
are security-pinned recipes/digests or need a Windows-only native component:

| Area                                         | Where                                                                                                                                                                                                     | Why it blocks                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Event-host target                            | `src/event-host-resources.mjs` (`assertEventHostTarget`, `darwin-arm64` dir, `runtime/bun`), `scripts/prepare-event-host.mjs` (`@oven/bun-darwin-aarch64` pins), `runtime-event-host/installer-pins.json` | Needs a `win32-x64` Bun engine pin, Windows install receipt, and `.bin` shim (not symlink) handling in the closed inventory                  |
| Owner lifetime witness                       | `native/owner-lifetime/witness.c`, `src/owner-lifetime-resources.mjs`, `src/host/owner-lifetime.mjs` (`darwin`, `arm64`, `getuid`, POSIX modes)                                                           | A Windows equivalent (Job Object with KILL_ON_JOB_CLOSE or handle-inheritance witness) must be designed and compiled                         |
| Descriptor reads / git / config-save kernels | `src/host/native-descriptor-read.mjs`, `configuration-save-kernel.mjs`, `git-metadata-kernel.mjs`, `workbench-git.mjs` (`platform !== "darwin"` -> `platform_unavailable`)                                | `openat`/`renameatx_np` via `bun:ffi` on libSystem. On Windows these features report unavailable (fail closed), they do not degrade silently |

Features that stay unavailable on Windows until the above are ported: git
review/commit/index/branch-restore, configuration save (instructions, skills,
agents), native descriptor reads. Nothing was weakened to make them "work".

Do not edit `NATIVE_PERMISSION_OVERLAY_RECIPE` or its digests for Windows: the
overlay patches platform-independent JavaScript inside the event-host install, so
it should apply unchanged once a win32 install exists.

## 1. Prerequisites

- Windows 10 22H2 or Windows 11, x64, NTFS volume with >= 10 GiB free.
- Node.js 24.14.1 x64 (matches `runtime-event-host/package.json` engines).
- pnpm (version from root `package.json` `packageManager`), Git for Windows.
- Visual Studio Build Tools only if a native witness is later added.
- Enable long paths (admin PowerShell, then reboot or sign out):
  `Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled 1`
- Enable Developer Mode (Settings > For developers) so symlinks can be created
  without elevation; otherwise the symlink legs of the e2e scripts are skipped.
- Optional speedup: exclude the repo, `node_modules`, `%LOCALAPPDATA%\pnpm` from
  Windows Defender real-time scanning.
- Clone to a short path such as `C:\src\omoc` (avoid OneDrive-synced folders).

## 2. Preflight

```powershell
node apps\desktop-app\scripts\windows-preflight.mjs > preflight.json
```

Expected: `"ok": true` on a prepared machine. Notable facts in the output:

- `checks.long_paths_enabled`, `checks.file_symlink_privilege`, `checks.junction_creatable`
- `facts.directoryFsync` -> `ok:false` with `EPERM`/`EISDIR` is expected; the code skips
  directory fsync on win32 (`directorySyncSupported`). If it is `ok:true`, nothing breaks.
- `facts.renameOverOpenFile` -> `EPERM`/`EBUSY` is expected; writes go through
  `renameReplacing` (bounded retry, `retryTransient`).
- `facts.reservedNameOpensDevice` must not matter for safety: names such as `NUL`/`CON`
  are refused by `validWorkspaceFilePath`, `relativeParts`, `assertNotVcsMetadataPath`.
- `checks.boot_identity_stable`, `checks.process_start_identity`: PowerShell/CIM probes
  used by the Windows process identity adapter must be stable across two calls. If
  `boot_identity_stable` is false the owner recovery logic will always report unverified.

Attach `preflight.json` to any bug report.

## 3. Install, build, unit tests

```powershell
corepack enable
pnpm install --frozen-lockfile
# optional deps include @opencode/cli-windows-x64@2.0.18; confirm:
dir node_modules\.pnpm | findstr cli-windows
node apps\desktop-app\scripts\build.mjs
```

Expected today: the renderer builds and the sidecar is copied to
`apps\desktop-app\dist\resources\opencode\win32-x64\opencode.exe`; the build then fails at
`stageEventHost` with `Event host resources: unsupported target win32-x64; hold
required` (blocker #1). That message is the correct fail-closed result.

Unit tests (platform-injected tests also run here natively):

```powershell
$env:TMPDIR = (New-Item -ItemType Directory -Path "$env:TEMP\omoc-test-$(Get-Random)").FullName
node_modules\.bin\nx run desktop-app:test --skip-nx-cache
node_modules\.bin\nx run desktop-app:typecheck
node_modules\.bin\nx run desktop-app:lint
node_modules\.bin\nx run desktop-app:format-check
node_modules\.bin\nx run desktop-app:boundaries
```

Expected on Windows: a number of pre-existing darwin-only tests (FFI, owner-lifetime,
POSIX modes) will fail or must be skipped; record the failing test names. Only
`platform-paths`, `sidecar-supervisor`, `native-bootstrap-workspace`, `process-tree`
and the other platform-injected suites are expected to be green.

## 4. Package

```powershell
pnpm --filter @workbench/desktop run package:windows
```

Expected today: stops at `copyPackagedResources` (blocker #1). After the event host is
ported: `apps\desktop-app\dist\packages\OhMyOwnCode-win32-x64\OhMyOwnCode.exe` plus
`resources\app.asar`, `resources\opencode\win32-x64\opencode.exe`.

## 5. E2E scripts (PowerShell syntax)

The scripts set their own isolated `OMOC_APP_DATA_DIR`, `TMP/TEMP`, `USERPROFILE`,
`APPDATA`, `LOCALAPPDATA`. Optional: `$env:OMOC_E2E_FOREGROUND = "1"` to watch the window.
`OMOC_DESKTOP_E2E_BACKGROUND=1` is set by the scripts: the window is shown inactive with
opacity 0, click-through, and hidden from the taskbar (`setSkipTaskbar` on win32).

```powershell
$env:OMOC_DESKTOP_E2E_BACKGROUND = "1"
$env:OMOC_APP_DATA_DIR = "$env:TEMP\omoc-e2e-appdata"
node apps\desktop-app\scripts\e2e-chat.mjs
node apps\desktop-app\scripts\e2e-workbench.mjs
node apps\desktop-app\scripts\e2e-session-lifecycle.mjs
node apps\desktop-app\scripts\e2e-workbench-states.mjs
node apps\desktop-app\scripts\e2e-smoke.mjs dev win32
node apps\desktop-app\scripts\e2e-smoke.mjs packaged win32
git checkout -- docs\runs   # discard evidence the scripts write
```

cmd.exe equivalents: `set OMOC_DESKTOP_E2E_BACKGROUND=1` then the same `node ...` lines.

Expected today: all fail at app startup with the native startup recovery screen
(blocker #1). After the event host is ported, expected results are the same assertions as
on macOS, except:

- e2e-workbench: if the preflight reports no symlink privilege, the `escape.txt` leg
  prints `SKIPPED symlink leg`.
- child process checks use `scripts\process-tree.mjs` (PowerShell `Win32_Process`
  instead of `pgrep`); the event-host child must be found and must be gone (`ESRCH`)
  after quit. Tree termination uses `taskkill /PID <pid> /T /F`.

## 6. Manual spot checks once the app starts

1. Add a project at `C:\Users\<you>\proj` and again via `c:\users\<YOU>\PROJ\` (different
   case, trailing slash): it must resolve to one workspace, not two.
2. In the file tree request `.GIT`, `.git.`, `GIT~1`, `.env.`, `NUL`, `a.txt:stream`:
   all must be refused.
3. Kill the app from Task Manager (End task) and relaunch: expect owner recovery to
   either recover or show an explicit recovery state, never a silent new store.
4. Quit the app: no `opencode.exe` or `bun.exe` children remain (`tasklist | findstr opencode`).

## 7. What was verified where

- Unit-tested on macOS with injected `win32`: path containment/case-folding, UNC and
  `\\?\` prefixes, drive letters, reserved names, ADS, trailing dots/spaces, `.GIT`/`GIT~1`
  VCS aliases, taskkill command construction, `.cmd`/`.bat` spawn plan and injection
  refusal, transient rename retry, process-identity probes (fake PowerShell), cross-platform
  child-pid lookup, sidecar naming/layout.
- Never executed on Windows: all of section 5, `taskkill`, PowerShell identity probes,
  directory open/fsync behaviour, junction detection, rename-over-open-file, long paths,
  Electron single-instance lock, background-window flags.
