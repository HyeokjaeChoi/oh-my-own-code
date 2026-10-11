# Desktop workbench core: verified integration

Date: 2026-09-29. Plan revision 2. Interface version 2.

## Delivered behavior

The actual Electron application now has workspace import/create/list removal,
session switching, an assistant-ui composer and transcript, validated message,
interrupt and once/reject permission operations, runtime catalogs/slash commands,
and contained read-only file preview. Schema-compatible results render through
the owned Tool UI component; unknown results remain inert escaped text.

The runtime client and credentials stay in main. Untrusted locations require
native trust confirmation before SDK activation. Exact baseline permission
write/read-back gates execution. Project files survive registration removal and
app cleanup. The app-owned default workspace and metadata remain temporary.

## Repairs from independent review

An omitted model selection now preserves runtime/session/agent defaults and
variant instead of switching to the first catalog model. Regression tests
failed on the original behavior and pass after the repair. Permission queues
scroll independently so the composer/cancel controls stay visible. Desktop
navigation controls now change actual visibility. Tool UI styles are mapped to
the existing desktop tokens, and stale cancellation notices clear at idle.
See review-resolutions.md for findings, evidence and the retained new-folder
trust behavior submitted for independent adjudication.

## Observed verification

- 47/47 unit/component tests passed. Typecheck, ESLint, Prettier, build, renderer
  bundle inspection and dependency boundaries passed on the current source.
- The real workbench Electron E2E passed: isolated sidecar startup, closed IPC,
  session identity and drafts, safe preview, catalog/error states, IME handling,
  authentic AUTH_REQUIRED without fabricated replies, and owned cleanup.
- Development and packaged Electron lifecycle tests passed: wrong sender,
  subframe isolation, malformed IPC, navigation denial, crash/disconnect,
  restart, startup failure/timeout/service collision, quit and temporary cleanup.
- Additional actual-renderer tests use an explicitly synthetic main process to
  verify onNew/cancel, once/reject, schema-safe Tool UI and escaped markup, slash
  dispatch, unknown receipts, navigation and full composer/cancel visibility.
  They do not prove provider or tool execution in OpenCode.
- The latest macOS package was launched by the packaged lifecycle suite, and
  all 6 files in its application archive match the build.
  OpenCode resource identity is verified against the installed pinned package.

All nine required checks have current source/environment bindings in
verification-summary.json. Supplementary evidence and actual command arguments
are in supplementary-verification.json. The code/design final gate reports and
run.json determine final gate status; check execution alone is not that review.

The final inventory includes 30 changed paths and 0 deletions
against the original run baseline, not against the repository's largely
untracked Git status. capture-manifest.json records actual pixel dimensions and
provenance for 8 captures. Renderer output is about 619 kB before
compression and emits a chunk-size warning; latency was not benchmarked.

## Local application

`apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app`

```sh
open "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app"
```

Application archive SHA-256: `dc75706349b3eaed92e50cf08099503b27bc045075a63303ba2bad03d7a12c49`.
Full package hashes are in package-inspection.json. No signing, notarization,
installer publication, payment or external telemetry was performed.

## Limits and remaining parent work

This is the bounded core increment, not a complete F-01–18 product release.
Existing provider credentials were not read or inherited; successful provider
execution is unverified. Native directory pickers were substituted within the
owned test process; physical OS picker interaction is not claimed. Native
Windows package/runtime evidence is still required from Windows.

The full parent scope retains durable storage/recovery and retention choice,
complete worktree/create/delete and session lifecycle, richer conversation
context, permission modes/delegation, browser/PTY/Git panels, harness/MCP
configuration, automation and remaining monitoring/release acceptance. The
earlier restricted-launch and quota failures are retained in previous-report.md
and historical logs; current native execution and the fresh reader route
succeeded after the user's continuation.
