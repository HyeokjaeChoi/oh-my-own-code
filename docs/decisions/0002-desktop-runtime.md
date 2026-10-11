# ADR-0002: Desktop shell and app-owned sidecar

**Status:** Accepted — Electron selected by user · **Date:** 2026-09-28 · **Scope:** local personal desktop app for macOS + Windows

## Confirmed requirements

- Deliver an installed desktop application for macOS and Windows.
- The application owns and supervises the OpenCode v2 foreground `serve` process. Do not attach to an ambient/shared service or expose server credentials to the renderer.
- Keep the renderer and preview outside native/process authority. The eventual shell must expose a narrow, typed, least-authority host API.
- Browser pairing/CORS checks and synthetic bridges are browser-boundary evidence only; they do not establish desktop sidecar lifecycle, packaging, or OS security.

## Candidates and decision

The comparison and primary-source references are recorded in [runtime-options-research-r2.md](../runs/desktop-app-bootstrap/runtime-options-research-r2.md). The user explicitly selected **Electron** on 2026-09-28 after receiving the comparison. This resolves the shell decision; it does not approve implementation inputs or prove package compatibility, process isolation, security, or runtime behavior.

| Candidate | Fit to this product | Material cost / unresolved evidence |
| --- | --- | --- |
| **Electron** | TypeScript-first host, existing React/Vite renderer, packaged Chromium behavior, direct process ownership, mature macOS/Windows packaging. No Rust layer is required to connect a trusted host to the OpenCode client. | Larger bundle and memory footprint; ongoing Chromium/Node/Electron security updates; IPC, navigation, CSP, sidecar packaging and per-OS lifecycle still need implementation and exact-package proof. |
| **Tauri 2** | Rust host offers a clear native command boundary and per-window capability allowlists; documented sidecar support. | Adds Rust and platform build prerequisites; sidecar packaging still needs target-specific assets; system WebView behavior differs; Windows runtime/package evidence must run on Windows. |
| **Neutralinojs** | TypeScript/web-oriented and lightweight host; supports extensions and process APIs. | Extension children are not automatically terminated; app must implement and prove child supervision and token-safe host communication; less integrated process/package path than Electron for this sidecar-heavy product. |

### Why Electron fits this product

Electron best matches the current TypeScript-heavy codebase and renderer while letting the Electron main process own the OpenCode `serve` child and the trusted `@opencode/client` connection without introducing a Rust host. This reduces stack changes but retains the ongoing Chromium/Node/Electron update surface, a larger package/resource footprint, and strict IPC/navigation/preview-isolation obligations. Tauri remains a viable alternative if measured resource costs justify Rust and WebView differences; Neutralinojs requires more application-owned child cleanup. The user selected Electron with those tradeoffs available.

The selected design keeps the Electron main process as the trusted owner of the app window, exact app-launched OpenCode child, readiness/authentication, and version-matched TypeScript client. Renderer access is through a closed, typed preload API with context isolation, sandboxing, and Node integration disabled. Preview content receives no privileged preload or sidecar credential. Per-OS packaging and process supervision are tested on macOS and Windows separately. These are architecture requirements based on the repository and cited platform documentation, not observed package compatibility, performance, runtime security, or a production guarantee.

## Required probes after shell selection

Before implementation: pin shell/packager versions; verify macOS and Windows build prerequisites; stage the exact OpenCode v2 server artifacts for both platforms; validate server/client compatibility; prove app-owned startup, readiness/authentication, failure, collision, shutdown and child reaping on each OS; inspect packaged renderer privileges and preview isolation. Do not infer Windows behavior from macOS cross-builds.

## Decision and reversal

Electron is the confirmed shell. The desktop run's `decision_register` records the explicit user choice. Implementation remains blocked until the PRD, UX, architecture, verification, operations, spec index, and `build-delivery` plan/contract are reconciled to Electron, exact current hashes are registered, fresh independent reviews and handoffs pass, and the user approves the exact integrated document set.

Revisit the decision if the selected shell cannot package and reap the exact sidecar on both OSes, leaks host authority to renderer/preview, or shows measured maintenance/resource costs inconsistent with local use. A failed probe returns to comparison; it does not silently authorize a different shell.
