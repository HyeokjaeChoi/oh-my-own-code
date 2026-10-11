# Desktop platform research — revision 1

Checked: 2026-09-28. Historical source packet created before the user's final shell choice. Its provisional Electron/macOS-first direction is superseded by confirmed macOS + Windows targets and the explicit Electron selection in ADR-0002 and build-delivery revision 11. Use the newer `runtime-options-research-r2.md` for the current comparison. Exact dependency versions remain unselected and must be probed before installation.

## Repository evidence

- The approved [PRD v0.2](../../product/prd.md) says the local browser delivery is tentative and desktop installation is undecided. The user's 2026-09-28 correction supersedes only that platform proposal; the accepted feature scope remains F-01–F-18.
- [ADR-0001](../../decisions/0001-workbench-platform.md) defines a React/Vite renderer, a separate Node ESM bridge, `contracts` and `ui` packages, Nx project boundaries and FSD inside the renderer. It contains no desktop-shell module.
- The current renderer is mounted from a DOM entry point. Current project targets run Vite at `127.0.0.1:4200`; the bridge is a TypeScript Node process. No desktop packager or native shell is present.
- The bridge currently implements fixed synthetic read-only fixture routes. It has no project/filesystem/Git/terminal/worktree routes. Renderer pairing uses direct browser `fetch` to a loopback bridge and a component-memory capability. The transcript's LinkPreview is an inert synthetic result, not a preview panel.

## Official framework facts

### Electron

- Electron bundles Chromium and Node.js with the app. Its [process model](https://www.electronjs.org/docs/latest/tutorial/process-model) separates main and renderer processes. [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) starts managed Node utility processes from the main process.
- Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) recommends disabling Node integration for remote content, enabling context isolation and sandboxing, validating IPC senders, and keeping Electron current. The application author is responsible for configuring the boundary.
- The main-process [dialog API](https://www.electronjs.org/docs/latest/api/dialog) supports OS file selection. [Electron Forge](https://www.electronjs.org/docs/latest/tutorial/application-distribution) is the documented packaging path. Built-in auto-update support covers macOS/Windows; Linux updates are handled through distribution package managers according to the [update guide](https://www.electronjs.org/docs/latest/tutorial/updates).

### Tauri 2

- Tauri accepts framework-built frontends, but its desktop core is Rust. It does not include Node by default; a Node bridge can be shipped as an [external binary sidecar](https://v2.tauri.app/plugin/shell/) with explicit [shell permissions](https://v2.tauri.app/reference/javascript/shell/).
- Tauri uses system WebViews by default: WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux ([WebView versions](https://v2.tauri.app/reference/webview-versions/)). Its [security model](https://v2.tauri.app/security/) grants system functions through IPC and scoped capabilities.
- Official [prerequisites](https://v2.tauri.app/start/prerequisites/) require Rust plus platform dependencies. Its [dialog](https://v2.tauri.app/plugin/dialog/) and [filesystem](https://v2.tauri.app/plugin/file-system/) plugins expose native selection and scoped filesystem functions.

## Coordinator inference (not a vendor guarantee)

Electron is the provisional direction because the product already owns a Node bridge and the approved execution engine is the Node-based OpenCode SDK v2. Bundled Node/Chromium and managed Node child-process support may reduce the number of runtimes and renderer differences the solo maintainer must coordinate. The trade-offs are a larger packaged footprint, a frequently updated Chromium/Node surface, and a main/preload/utility-process security boundary that requires explicit tests.

Tauri remains credible if a smaller native host and capability-scoped OS integration outweigh the need to ship and supervise a separate Node sidecar and the platform-specific WebView differences. Exact runtime/SDK packaging, preview isolation, transport/bootstrap, shutdown of child processes and per-OS installers are not established by these facts. The architecture ADR and synthetic host probes must resolve them before implementation depends on them.

## Official sources

- Electron: [Introduction](https://www.electronjs.org/docs/latest/), [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [utility process](https://www.electronjs.org/docs/latest/api/utility-process), [security](https://www.electronjs.org/docs/latest/tutorial/security), [dialog](https://www.electronjs.org/docs/latest/api/dialog), [distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [updates](https://www.electronjs.org/docs/latest/tutorial/updates).
- Tauri: [shell sidecars](https://v2.tauri.app/plugin/shell/), [shell permissions](https://v2.tauri.app/reference/javascript/shell/), [WebView versions](https://v2.tauri.app/reference/webview-versions/), [prerequisites](https://v2.tauri.app/start/prerequisites/), [security](https://v2.tauri.app/security/), [dialog](https://v2.tauri.app/plugin/dialog/), [filesystem](https://v2.tauri.app/plugin/file-system/).
