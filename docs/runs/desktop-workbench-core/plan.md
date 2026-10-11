# Desktop workbench core

Revision: 2. Date: 2026-09-29. Parent outcome: `build-delivery` (still active).

## Outcome and authority

The user requested continuing the remaining oh-my-own-code implementation after the completed harness migration and supplementary skill validation. Implement the next usable desktop increment from the independently reviewed feature-landscape report. The current Electron renderer only shows temporary runtime information; its preload exposes only runtimeSnapshot. The existing app-owned OpenCode 2.0.18 sidecar, Electron choice, macOS/Windows targets, Nx boundaries, approved tokens, assistant-ui and Tool UI remain authoritative.

This increment connects workspace selection, sessions, a real assistant-ui composer/transcript, sidecar-backed message/interrupt/permission operations, tool-result rendering, and bounded read-only file/extension panels. It is part of the full F-01–18 outcome, not a redefinition of release scope. Physical deletion, complete Git/worktree strategy handling, PTY/browser process control, persistent-data retention, extension installation, background automation and credential-dependent provider execution remain visible unfinished parent work. Do not represent a disabled button, fixture or local build as completing those requirements.

## Decisions and limits

- The current request authorizes local implementation, dependency reuse, synthetic tests, disposable sidecar/Electron checks and a local macOS build. No real personal project execution, credentials, external publication, payments or user-project deletion is required.
- Preserve the app-owned isolated profile and sidecar supervision. Main owns the authenticated client; renderer receives only validated DTOs and closed IPC operations. Preview content gets no privileged preload or raw SDK access.
- Import uses a native directory picker, canonical path validation and registration only. It must not start SDK project discovery or run setup. Opening a session in an imported location requires a separate explicit native trust confirmation before any project configuration/plugins can be activated. The app-created temporary workspace is already owned and trusted. Tests use owned disposable locations only.
- New ordinary directories require an explicitly selected parent; no silent fallback to the app installation or home directory. Blank names use local yyyy-mm-dd plus a standard UUIDv7, exclusive creation and bounded collision retry. Remove-from-list does not remove files and is blocked for busy workspaces. Do not implement recursive user directory deletion in this increment.
- Registry/UI state is session-scoped until a separate persistent-data choice is made. Display this limitation in the app. Do not pick a new persistent user-data location implicitly.
- Use the exact installed @opencode/client contracts, not older @opencode-ai/sdk APIs. The authenticated client is internal to main. Unknown shapes fail safely. Preserve real AUTH_REQUIRED/unavailable states; no generated fake assistant responses in production.
- Main owns session identity, operation receipts and busy state. The renderer owns selected IDs, drafts and panel layout. Session switching must discard stale results and preserve per-session drafts. Unknown transport outcomes are not automatically resent.
- Before any prompt/command, apply the session rules `[{action:"*",resource:"*",effect:"ask"},{action:"external_directory",resource:"*",effect:"deny"},{action:"subagent",resource:"*",effect:"deny"}]` and read them back through the installed `session.get` contract. Apply this to the existing temporary session as well as new sessions. A missing, changed or unconfirmed policy blocks execution. Project trust is not per-tool approval. This increment exposes only the ask baseline; advanced modes and child execution remain parent work. Check policy before send and after agent/model changes; no renderer-supplied policy or remembered approval is accepted. Configuration metadata is not proof of OS sandboxing; disposable negative tests and the real sidecar read-back define the evidence boundary.
- Keep selected model/agent values explicit and dynamically supplied by the runtime. No permanent model/effort assignments in product or harness.
- Native collaboration spawn returned `agent thread limit reached`; no close_agent capability exists. A new `codex exec --ephemeral` invocation with explicit bounded instructions is an available fresh-context route. Do not reuse an implementation context for review, bypass sandbox/trust, or claim runtime identity from a label. Use one economical reader and disjoint implementation workers only if that route succeeds; the primary handles integration.

## Architecture and interface

The narrow contract in `interface.md` refines existing ADR-0001/0002 and product requirements without replacing them. Main owns the new service and the sidecar client. A closed typed request union travels through an admitted, top-frame-only IPC handler; each operation validates its exact arguments and resolves workspace/session IDs inside main. Unknown methods, raw paths for privileged operations, cross-session IDs, stale permission replies and arbitrary SDK passthrough are rejected.

A main-owned event pump may emit coalesced invalidations. The renderer refreshes authoritative snapshots; it never treats an event label as proof of completion. Polling fallback must be bounded, stop on unmount/disconnect, and discard late results on session change. Use immutable message IDs, not arrival order alone. Render tool results as text or schema-validated existing Tool UI components; never render arbitrary HTML or model-selected callback code.

Use existing assistant-ui 0.15.22 and @workbench/ui packages, declaring desktop workspace dependencies explicitly. Preserve lockfile versions and use the package-manager cache first. Do not introduce another execution engine, model loop, state framework, or backend project. Renderer modules use a small app/features/entities/shared structure with explicit public exports where new slices exist.

The primary owns `apps/desktop-app/scripts/check-renderer-boundaries.mjs`: inspect all renderer entry/module imports with TypeScript resolution, including type imports, re-exports, dynamic imports, aliases and relative paths. Allow only the public bridge DTO declaration, renderer modules, approved CSS and browser-safe public package entrypoints. Reject Node/host/sidecar dependencies, upward or sibling feature/entity slice imports, and deep imports across a public package/slice API. The required boundary check includes negative disposable fixtures and a positive graph. The web-only checker and bundle substring scan do not substitute for this desktop check.

## Acceptance for this increment

- AC-1: Main service validates workspace/session identity, native import/create/list removal, busy transitions and operation inputs; ordinary-folder behavior has disposable filesystem tests.
- AC-2: Actual Electron UI contains assistant-ui composer/transcript connected to main. Sending/interrupting addresses the selected session, preserves drafts, rejects stale responses and exposes authentic runtime/provider failures. Production has no success fixtures.
- AC-3: Runtime-backed tool/permission DTOs have safe fallback rendering and checked response identity. Read-only file preview cannot escape the selected workspace or execute HTML. Dynamic command/skill/MCP/agent/model inventory distinguishes empty/unavailable states.
- AC-4: Existing sandbox/preload/navigation and owned sidecar cleanup remain intact. Pure/unit/negative tests, typecheck, lint, format, build and renderer bundle inspection pass. Live Electron smoke uses only its disposable empty-config sidecar; provider-dependent behaviors remain unverified without credentials.
- AC-5: A local macOS app is built with exact launch instructions, real observed UI evidence and an updated implementation backlog. Windows configuration remains intact; actual Windows runtime/package verification is not claimed on macOS. Fresh independent code and rendered-UI reviews have no unresolved blocking findings for this increment.

## Ordered execution and ownership

1. Primary persists this plan, its interface and exact check contract. A fresh reader reviews the plan. After the primary records that pass and registers the interface artifact, a fresh reader reviews its exact design-spec binding. The initial combined request could not obtain a design binding before plan registration; keep that failed report without fabricating a binding. No repeated user sign-off is needed for this authorized scope.
2. Backend worker owns `apps/desktop-app/src/workbench-service.mjs`, its tests, IPC validation/types, `main.mjs`, `preload.cjs`, and the minimal internal client accessor in `sidecar-supervisor.mjs`. Inspect installed client declarations before implementation. The worker cannot change renderer/build/package files or the ledger.
3. Renderer worker owns `renderer.tsx`, `renderer.css`, the new renderer modules/projection tests and meaningful integration fixtures. It consumes the shared interface, existing design tokens and existing Tool UI public exports. It cannot change host/service/package files or the ledger.
4. Primary integrates declared dependency/build wiring and test scripts, resolves interface discrepancies, runs current affected checks, captures actual UI, builds the app and records remaining parent work. Only actual evidence is registered.
5. Fresh independent final reader reviews code and rendered UI separately from authorship. Fix real findings and rerun only affected checks/reviews. Complete this increment only if its contract passes; keep parent full-product outcome active.

## Verification and evidence

Contract commands use the existing installed Node/pnpm/Python. Unit checks use injected fake clients and disposable directories and assert actual effects, including cross-session/stale-ID/duplicate-send rejection. UI fixtures are labelled synthetic and cannot prove live provider execution. Real Electron smoke checks owned startup, composer availability, missing-auth/error behavior and shutdown without sending real user content. macOS packaging is local only. If a required local runtime is unavailable, retain the exact failure and complete independent work rather than inventing a pass or changing platforms.

Existing completed runs, the Solopreneur library, unrelated web fixture implementation and personal files remain unchanged. The repo is largely untracked; changed-path evidence comes from this run's baseline inventory rather than assuming the entire git status is this diff.

No unresolved choice blocks this bounded increment. Persistent data policy and Windows-only evidence still block full product release and are retained in the parent backlog.

Revision 2 addresses entry findings P-01/P-02/D-02/D-03: add a checked ask policy, desktop dependency-boundary fixtures, unambiguous legacy runtimeSnapshot compatibility and correctly ordered document review. The rejected gpt-6-sol CLI override was replaced by the effective CLI default; the completed reader reported gpt-6-astra with effort none. That is CLI-reported routing metadata, not parent inheritance or independent model identity attestation.
