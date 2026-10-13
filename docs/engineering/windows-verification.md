# Windows 10/11 x64 verification kit

Status: **the code path is complete for startup, chat, permissions, file read/list/save and
configuration save, but it has never run on a real Windows machine.** Everything marked
"expected" is what the code is designed to do. The first run on Windows is the actual
verification. Record real results in `docs/runs/` only if you want historical evidence.

## 0. What is supported, what is held

| Area                                                 | Windows status                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Event host (pinned Bun + `@opencode/server` closure) | Supported target `win32-x64`: `@oven/bun-windows-x64@1.4.2`                                                 |
| Native permission overlay                            | Applies unchanged: all 68 original-file digests of the recipe match the Windows install (checked)           |
| Sidecar                                              | `@opencode/cli-windows-x64@2.0.18` (integrity from `pnpm-lock.yaml`)                                        |
| Startup ownership / crash recovery                   | Supported with the **identity-mode lifetime witness** (section 4.2)                                         |
| Native `read` / `list` tools                         | Supported through the **name-identity kernel** (section 4.4)                                                |
| File save, instructions/MCP/skill/agent save         | Supported through the **name-identity save kernel** (section 4.5)                                           |
| Git review (read-only snapshot)                      | **Held** (`platform_unavailable`): see 4.6                                                                  |
| Git commit / index / branch restore                  | **Held**: `git-metadata-kernel.mjs` is a 3k-line `bun:ffi` libSystem `openat`/`renameatx_np` implementation |
| Terminal                                             | Owned by the PTY work (`src/host/terminal-host.mjs`); see section 8                                         |

## 1. Prerequisites

- Windows 10 22H2 or Windows 11, x64, NTFS, >= 12 GiB free (the event-host tree is ~0.6 GB, Electron ~0.3 GB).
- Node.js **24.14.1** x64 from nodejs.org (the pins require exactly this version for `prepare`),
  with its bundled npm 11.11.0 (check: `npm --version`). Do not set `NODE_OPTIONS`, `NODE_PATH`,
  `NODE_EXTRA_CA_CERTS`, `SSL_CERT_*` while preparing (the controller refuses them).
- pnpm (`packageManager` in the root `package.json`), Git for Windows (for the repo only; the app does not need it yet).
- Windows PowerShell 5.1 (preinstalled): the app calls
  `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` for ACL and process identity.
- Long paths (admin PowerShell, then sign out/in):
  `Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled 1`
- Developer Mode (so symlinks can be created); otherwise the e2e symlink legs are skipped.
- The profile must be private: `%APPDATA%` and `%TEMP%` may only be accessible to your account,
  SYSTEM and Administrators (default). A domain/roaming/shared profile with broader ACEs makes the app
  stop with `storage_denied` by design (section 4.3).
- Clone to a short path such as `C:\src\omoc`, outside OneDrive. Optional: exclude the repo and
  `%LOCALAPPDATA%\pnpm` from Defender real-time scanning (otherwise builds are 2-5x slower and
  directory renames can hit sharing violations; they are retried but not infinitely).

## 2. Preflight

```powershell
node apps\desktop-app\scripts\windows-preflight.mjs > preflight.json
```

Expected `"ok": true`. Facts and checks that matter for the new code:

- `process_start_identity`, `absent_pid_is_authoritative`: the CIM probe behind the lifetime witness (one
  PowerShell call, output exactly `OK:<filetime>` or `ABSENT`). If `absent_pid_is_authoritative` is false the app can never
  prove a crashed owner is gone.
- `repo_volume_ntfs`, `appdata_volume_ntfs`, `temp_volume_ntfs`: file identity (dev:ino) and the identity proofs assume NTFS
  64-bit file IDs; ReFS (128-bit IDs), FAT and exFAT are not supported.
- `appdata_private_acl`, `temp_private_acl`: the DACL policy the app enforces on its storage roots.
- `facts.directoryFsync`: `ok:false` with `EPERM`/`EISDIR` is expected (the code skips directory fsync on win32).
- `facts.renameOverOpenFile`: `EPERM`/`EBUSY` is expected (writes use `renameReplacing` with bounded retry).
- `checks.file_symlink_privilege`, `junction_creatable`, `path_over_260_usable`, `free_disk_*`.

## 3. Install, prepare, build, package

```powershell
pnpm install --frozen-lockfile
dir node_modules\.pnpm | findstr cli-windows          # expect @opencode+cli-windows-x64@2.0.18
node apps\desktop-app\scripts\prepare-event-host.mjs   # downloads + verifies bun.exe, npm ci into .generated-win32-x64
node apps\desktop-app\scripts\build.mjs
pnpm --filter @workbench/desktop run package:windows
node apps\desktop-app\scripts\verify-package-layout.mjs win32 x64
```

Expected results:

- `prepare-event-host.mjs` prints `...\runtime-event-host\.generated-win32-x64`. It refuses a wrong
  archive: the registry tarball integrity must equal
  `sha512-+bN6OuVld/9diT/RLSXSW7JE6CvNE3gL9XsAEjULi1nUsXd6DNO6GuA9jNdNb3r8PdJFnYHr5aypNV1Oj3Rd9g==`
  and `bun.exe` must hash to
  `15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4`. The install runs with
  `--ignore-scripts --no-bin-links --os=win32 --cpu=x64`; no script and no Bun byte is executed.
  A second run fails (`.generated-win32-x64` is exclusive); delete the folder to prepare again.
- `build.mjs`: renderer, `dist\resources\opencode\win32-x64\opencode.exe`,
  `dist\resources\opencode\event-host\win32-x64\...`, provenance stamp `dist\build-provenance.json`
  with `target: {platform: "win32", arch: "x64"}` and `ownerLifetimeResources.algorithm =
"owner-lifetime-identity-mode-v1"`. There is no `owner-lifetime` folder on Windows.
- `package:windows` prints `Packaged local personal-use app: ...\dist\packages\OhMyOwnCode-win32-x64`.
- `verify-package-layout.mjs` prints six passed checks (exe is a PE file, asar, sidecar bytes equal staged bytes,
  event host verifies including overlay receipt, snapshots equal the provenance stamp, no foreign-target names).

### Cross-checking the layout on macOS (what was done for this kit)

```sh
node apps/desktop-app/scripts/prepare-event-host.mjs --target=win32-x64
node apps/desktop-app/scripts/fetch-sidecar.mjs win32-x64          # integrity checked against pnpm-lock.yaml; writes a receipt
OMOC_BUILD_TARGET=win32-x64 OMOC_SIDECAR_PACKAGE_DIR=$PWD/apps/desktop-app/.cross/win32-x64/@opencode/cli-windows-x64 \
  node apps/desktop-app/scripts/build.mjs
OMOC_ALLOW_CROSS_PACKAGE=1 node apps/desktop-app/scripts/package.mjs win32 x64
node apps/desktop-app/scripts/verify-package-layout.mjs win32 x64
```

`OMOC_SIDECAR_PACKAGE_DIR` is honoured only together with an `OMOC_BUILD_TARGET` for another target, only for a directory
with fetch-sidecar's receipt (locked integrity + file hashes re-checked), and the receipt is recorded in the provenance stamp
(`crossSidecar`). Move the native `dist` aside first: the cross build writes into `dist`. Cross output is for layout and hash
verification only; ship builds made on Windows.

## 4. Design notes and trade-offs (security-relevant)

### 4.1 Event-host manifests on Windows

NTFS has no POSIX mode, so Windows manifests record canonical modes (directories `0755`, files `0644`,
`runtime/bun.exe` `0755`) computed from the file type, not from the file system. The same tree therefore
verifies identically on Windows and when staged on another host. `npm ci --no-bin-links` leaves no `.bin`
shims, so the closed inventory contains no symlinks (a junction or symlink is rejected as "undeclared symlink").
All other checks (single hard link, size, sha256, locked package versions, overlay receipt) are unchanged.
Windows hosts also use a case-insensitive containment test, so `..\x` style escapes cannot hide behind the
separator.

### 4.2 Lifetime witness: identity mode (replaces the macOS kqueue helper)

macOS records durable exit facts through an independent helper process. Windows has no equivalent without
a native compiler and does not need one: the process identity is the kernel creation FILETIME read from
CIM (`Win32_Process`), which lists every process. A crashed owner or child is proven gone when CIM has no row
for its PID, or a row with a different creation time. There is deliberately **no boot identity** on Windows
(`LastBootUpTime` is now-minus-uptime and moves when the clock is stepped, which would fake an exit proof); a reboot
changes the process set and every creation time anyway. The probe is one PowerShell call that sets
`$ErrorActionPreference='Stop'`, first reads its OWN process row (positive control: if CIM cannot see itself, the call
fails) and prints exactly `OK:<filetime>` or `ABSENT`. Nonzero exit, stderr noise, timeout (20 s) or any other output is
`unverified` and keeps the store blocked. `SystemRoot` is used only if it is a local absolute drive path (never UNC). The witness additionally enforces one app and at most one
child per owner nonce, only live exact identities, no registration after sealing, and "exited" only if
every registered role is individually proven exited. **Trade-off:** it writes no durable per-run exit file, so
there is nothing to inspect after the fact. The event-host child exits when its IPC channel closes, so a
force-killed app does not leave a running host that the next launch would have to hunt down.

### 4.3 Directory privacy replaces uid/mode checks

POSIX requires "owned by my uid, no group/other bits". Windows requires the directory's DACL (`Get-Acl`, SIDs only,
no localized names) to be private: owner is you or Administrators, and every allow rule belongs to you, SYSTEM,
Administrators or CREATOR OWNER. The storage root is checked synchronously before the app is ready; the
supervisor checks the root, config/data/state, and the disposable profile directories in one batched call
before spawning the host. **Trade-off:** children created inside a verified directory inherit its DACL and are
only shape-checked (not individually ACL-checked); a same-user attacker can change ACLs anyway.

### 4.4 Native read/list: name-identity kernel (`native-descriptor-read-win32.mjs`)

No `openat`/`O_NOFOLLOW`. Every directory component is proven by `lstat` (symlinks and junctions are reported
as symbolic links and refused) plus `realpath` equality; the leaf is `lstat`ed before open, opened read-only,
`fstat`ed, and compared (dev, ino, size, mtime, ctime, mode, nlink) before, during and after each read. Directories are
never opened. 8.3 aliases and DOS device names are refused. **Residual:** the instant between a leaf's `lstat`
and its `open`, and an A-B-A swap of a directory exactly around `opendir` (name re-proved before and after, no directory handle exists), cannot be closed (darwin's `O_NOFOLLOW` closes it); a swap inside it is detected by the identity
comparison and no bytes are returned.

### 4.5 File and configuration save: name-identity save kernel (`configuration-save-kernel-win32.mjs`)

Same prepare/publish/abort contract. Before the replace the kernel closes its own handle to the target (NTFS refuses to rename over a file with an open handle) and re-proves by name that the target is still the observed original. Publishing an existing target is link/rename based:
stage -> `.swap` name, `link(target, backup)`, `rename(.swap, target)` (MoveFileEx replace), so the target is
never absent and the ORIGINAL content stays at the backup name exactly like the darwin swap. A missing target
is published with `link(stage, target)` which fails if it appeared. **Trade-offs:** (1) alternate data streams,
explicit ACEs and file attributes of the original are not readable from Node and are not carried over to the
new file; a read-only original is refused. (2) there is no compare-and-swap rename on NTFS: a write by another
process in the instant between the last identity check and the replacing rename is overwritten, but its content is
what remains at the backup name and the immediate post-publish verification fails closed.
Stray `.omoc-configuration-*.swap` files after a crash are kept for inspection, never deleted.

### 4.6 Git: holds

- **Review snapshot** (`workbench-git*.mjs`): runs a pinned Apple CLT git (`/Library/Developer/CommandLineTools/usr/bin/git`),
  verifies a root-owned non-writable ancestor chain and accepts only `2.50.1 (Apple Git-155)` / `2.54.x`. Windows
  needs a trust anchor (Git for Windows under `%ProgramFiles%` with an ACL-verified chain, version allowlist that
  accepts `2.54.x.windows.N`), `core.symlinks=false`/`core.filemode=false`/`core.ignorecase=true` repository
  semantics in `minimalConfig`, and directory handles. Not attempted blind; it reports `platform_unavailable`.
- **Commit / index / branch restore** (`git-metadata-kernel.mjs`): writes objects, refs and the index through
  `bun:ffi` + libSystem `openat`/`renameatx_np`. A Windows implementation is a new kernel (path-based with the
  same identity proofs and exclusive `link` publication), then enabling the three request paths.

## 5. E2E scripts (PowerShell)

```powershell
$env:OMOC_DESKTOP_E2E_BACKGROUND = "1"
$env:OMOC_APP_DATA_DIR = "$env:TEMP\omoc-e2e-appdata"
node apps\desktop-app\scripts\e2e-chat.mjs
node apps\desktop-app\scripts\e2e-workbench.mjs
node apps\desktop-app\scripts\e2e-session-lifecycle.mjs
node apps\desktop-app\scripts\e2e-workbench-states.mjs
node apps\desktop-app\scripts\e2e-smoke.mjs dev win32
node apps\desktop-app\scripts\e2e-smoke.mjs packaged win32
git checkout -- docs\runs
```

cmd.exe: `set OMOC_DESKTOP_E2E_BACKGROUND=1` then the same `node ...` lines. Background mode shows the window
inactive with opacity 0, click-through, and hidden from the taskbar. Child-process checks use `scripts\process-tree.mjs`
(`Win32_Process` instead of `pgrep`); termination uses `taskkill /PID <pid> /T /F`.

Expected: the same assertions as on macOS. The first thing to look at if startup fails is the recovery
reason shown by the app (`storage_denied` = ACL policy, `owner_unverified` = lifetime witness/CIM,
`native_startup_unverified` = preflight or event-host verification).

## 6. Manual spot checks

1. Add `C:\Users\<you>\proj` and again as `c:\users\<YOU>\PROJ\`: one workspace, not two.
2. In the file tree request `.GIT`, `.git.`, `GIT~1`, `.env.`, `NUL`, `a.txt:stream`: all refused.
3. End the app in Task Manager and relaunch: it recovers (identity proof) or shows an explicit recovery state.
   Check `tasklist | findstr /i "bun opencode"` is empty after quitting normally.
4. Save a file in the editor: the old content is next to it as `.omoc-configuration-<hash>.file.backup`.
5. Ask the agent to read a file: the leased read goes through the Windows kernel (check the transcript shows the content).

## 7. Unverifiable-here items (first thing to check on Windows)

- Bun IPC (`stdio: ["ignore","ignore","ignore","ipc"]`) with `bun.exe` on Windows.
- `fs.openSync` semantics for directories under Bun (the Windows kernels never open directories).
- `process.umask` is skipped on Windows; `chmod` calls are no-ops.
- CIM / PowerShell cold start adds roughly 0.5-1 s per call (startup, child registration, ACL batches).
- Chromium's `lockfile` in the user-data root is whitelisted for a first start.
- Extended/device paths: only `\\?\X:\` and `\\?\UNC\` are reduced to plain paths; `\\?\GLOBALROOT`, `\\?\Volume{}` and `\\.\` are refused, and UNC targets are refused before any filesystem call unless inside a registered location.
- `@oven/bun-windows-x64` needs AVX2; on older CPUs a baseline build would need its own pin.
- Antivirus holding `node_modules` files can still cause `EPERM` beyond the retry budget.

## 8. Items left for `terminal-host.mjs` (not touched here)

`killTree` uses `taskkill` without an absolute path or `windowsHide`; `process.env.SHELL || "/bin/sh"` and the
colon-joined login `PATH` (`resolveLoginPath`) are POSIX; the env whitelist (`TMPDIR`, `HOME`, `SHELL`) lacks
`SystemRoot`/`USERPROFILE`/`ComSpec`/`PATH` casing handling. Shell selection should be `ComSpec`/PowerShell with
`windowsSpawnPlan` (`src/platform-paths.mjs`) for `.cmd` launchers, and tree termination should reuse
`killProcessTree`.

## 9. What was verified where

- Verified on macOS by running it: `prepare-event-host --target=win32-x64` (downloads and checks the official
  Windows Bun archive, `npm ci --os=win32`); the overlay recipe applying to the Windows install; `stage` + full
  manifest verification for `win32-x64`; `fetch-sidecar` (integrity vs lockfile); cross `build` with provenance
  stamp; cross `package` (Electron 44.4.4 win32 zip); `verify-package-layout.mjs win32 x64`.
- Unit-tested with injected `win32` on macOS: path/NTFS rules, ACL policy, process-identity probes, lifetime witness,
  host environment, event-host target table and canonical modes, the three name-identity kernels, supervisor flow.
- Not exercised on Windows: everything in sections 3-7 on a real machine.
