# Synthetic OpenCode sidecar probe r1

2026-09-28 · macOS 25.6.0 arm64 · Node 26.8.2 · isolated root `/private/tmp/oh-my-own-code-desktop-probe`.

## Package identity and lifecycle inspection

Public npm registry metadata for both `@opencode/cli` and `@opencode/client` identifies version `2.0.18`; the npm search page's `2.0.3` CLI result was stale. `@opencode/cli@2.0.18` has a `postinstall.mjs` that copies a platform binary, verifies it by running `--version`, and may spawn a secondary `npm install --ignore-scripts` in an OS temporary directory if the optional platform package is absent. No CLI install script was executed. The exact platform tarball was downloaded and its npm SHA-512 integrity verified before extracting only the binary. The client was installed in the disposable root with `--ignore-scripts`; its package declares no install lifecycle script.

| Artifact | npm integrity (SHA-512) | Tarball SHA-256 | Binary SHA-256 |
| --- | --- | --- | --- |
| `@opencode/cli@2.0.18` wrapper | `EkIxIa2goJ2v8U3Os2gpRckOIjN9gpUBXy6fyVOFbPZl71rkGpoF3NFsm4nlDiF2BgnIqcgJU5NgdV1k6/OZuw==` | `6547f31bd7044941d743f71c6e5485b9e1389be05e9d76444571448f26b3d36b` | n/a |
| `@opencode/cli-darwin-arm64@2.0.18` | `GRJMkkyQKDPIJbYr2WtFTgK1Vb1p/4xrqxgXA/TLyJ1Tn5tK5hNOtbslUZgsktrEQD6TeT5bVZcjRLC41n+d/A==` | `411a1816e41820922e75ef820103f7a5507abc6d4c828db648ece2127b10a3af` | `6759c7f86f807d63d3984ca1970f9fa663ee303a35bb344eb223c71e200a96bf` |
| `@opencode/cli-windows-x64@2.0.18` | `QsyGVmjJcHeuaS9bTVu4iiNyZzYfnRmia0BZop9AJ6QWRPDSq17ak1XRBTGGwh6msM+Ed0y+hke3s+lT3/kD+A==` | `f8d085e500e6b0375f577bc46e31b4e28e0702e1442ff29308fec7ac47bcc4dd` | `13ab389dcc490d1f3c1bc05b3c20811a1e8761b6db494c036d5f651e1518874f` |
| `@opencode/client@2.0.18` | `N74FNdXkTTC1Re5T+PNxH6fsVf1tZiV3kESu3UWL/545oAkBRXoiikMmDszuuHZ4AxGwtr9NiQjKrHiMdnLVYQ==` | not separately downloaded | n/a |

The Windows x64 tarball integrity and binary hash were checked on macOS but the binary was **not executed**. Electron `44.4.4` and `@electron/packager@20.3.0` public package metadata were inspected; Electron declares Node `>=22.12.0` and no package lifecycle script in the exact registry metadata, while Packager declares the same Node floor and development scripts including `prepare`, not an app install step. No Electron package/build command has run yet.

## Synthetic macOS runtime result

The binary reported `opencode v2.0.18`. The probe spawned that exact binary with `serve --hostname 127.0.0.1 --port 0`, `cwd` under the disposable synthetic workspace, and a minimal environment with HOME/XDG/config/data/cache/state/tmp paths entirely under the disposable root. It did not inspect user configuration, credentials, projects, or an ambient service. Local loopback binding required sandbox escalation and was granted for this bounded probe.

- The child printed its own loopback URL and random password; the probe kept the password in process memory and did not log it. An unauthenticated `GET /api/info` returned HTTP 401.
- `@opencode/client@2.0.18` authenticated to that printed URL. `server.info()` returned version `2.0.18` and PID `6700`, exactly the PID of the spawned child.
- The client created one session titled `Synthetic desktop bootstrap` in the synthetic workspace and `session.list({limit:10})` returned one item.
- The probe sent SIGTERM only to its spawned PID. The child exited with code `130`; a subsequent exact-PID `ps -p 6700` returned no process. The probe process exited `0`.
- Four data files were observed under the disposable root's `data` tree. No data files appeared in its synthetic workspace, config, cache, or state trees; no user location was accessed.

This proves one macOS ARM64 sidecar/client flow in the disposable probe, not Electron packaging, app IPC/isolation, child cleanup after a host crash, or any Windows runtime behavior. The probe script and registry snapshots remain under the single disposable root for inspection.
