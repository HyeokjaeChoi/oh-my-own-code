# Desktop workbench integration report

Date: 2026-09-29. Plan revision: 2. Interface version: 2.

## Outcome

Integrated the desktop workbench source and built a local macOS Apple Silicon app. The final source passes 42 tests, type checking, lint, formatting, build, renderer bundle inspection and desktop dependency-boundary checks. The packaged application matches the latest build.

This increment is **not complete**. Actual Electron execution/E2E and independent final code/rendered-design reviews remain unverified. The full F-01–18 product release and its parent runs also remain unfinished. No passing final outcome or release claim has been registered.

## Implemented behavior

The Electron renderer now uses assistant-ui for its conversation and composer, with main-process message and interruption operations. It preserves per-session drafts, rejects stale projections, and retains failed or unknown submissions for inspection without automatic replay. Runtime failures are displayed rather than replaced with synthetic assistant responses.

Workspace operations support native-picker import, exclusive ordinary-folder creation with a date/UUIDv7 fallback, session creation and removal from the app list. Removal preserves project files. Imported or newly created folders require native trust confirmation before session activation; untrusted imports do not trigger SDK catalog discovery. App metadata and the app-owned default workspace remain temporary. Imported and user-created project folders survive app cleanup.

The host exposes a closed, validated IPC contract with workspace/session ownership checks. It applies and reads back the required permission policy before execution, including after agent/model selection. Permission replies expose once/reject decisions; rejection invalidates other pending requests in the same session. These checks do not establish an operating-system sandbox around model tools.

The renderer exposes runtime command, skill, MCP, agent and model inventories, command selection, and a bounded read-only text preview. File checks reject traversal, symlinks, sensitive names, unsupported binary files and oversized content. Tool results matching the approved schema use the owned Tool UI LinkPreview component; unknown results remain escaped text. An actual assistant-ui static-rendering test exercises both dispatch paths, including unsafe-link rejection.

The existing macOS/Windows sidecar layout, renderer isolation, navigation denial and lifecycle safeguards remain in source. Existing lifecycle E2E assertions were updated for the composer and expanded bridge; they have not been revalidated at runtime in this increment.

## Verification

| Check | Result and limit |
| --- | --- |
| Unit/component checks | 42/42 passed, including the actual assistant-ui static rendering and synthetic host/filesystem cases. |
| Typecheck, ESLint, Prettier | Passed on the final source. |
| Desktop build | Passed. Renderer JavaScript is approximately 619 kB before compression; Vite reports a chunk-size warning. Runtime performance was not measured. |
| Renderer bundle | Passed privilege/credential-pattern and CSP inspection. |
| Desktop boundaries | Passed: 20 source files, 9 boundary fixtures and 6 import-syntax fixtures. |
| macOS package | Passed using installed Electron 44.4.4 and its previously downloaded distribution. No new dependency version was selected. |
| Packaged contents | Passed pinned OpenCode binary comparison and package inspection; six application files match the latest build byte-for-byte. |
| Electron E2E | Launch failed before UI assertions. No successful current screenshots or interactive observations. |
| Independent final code/design reviews | Not obtained. Entry plan/design-spec reviews remain distinct from these missing final gates. |
| Windows execution/package | Not run on this macOS host. |

Exact current check bindings are in `verification-summary.json`; historical failed attempts remain in `run.json`. `integration-files.json` compares the original run baseline with current files: 28 changed paths and no deletions. This avoids attributing the repository's pre-existing untracked files to this increment.

## Failures and recovery

The renderer worker stopped after a JSX test failure and a CLI usage-limit error. The primary corrected the test loader to use the desktop TypeScript configuration, corrected the Tool UI assertion to use its semantic slot, integrated the worker outputs, and ran the final checks. The backend worker exited 0; the renderer worker exited 1. Its dispatch was registered during reconciliation rather than represented as a contemporaneous successful completion.

The first package attempt failed with `getaddrinfo ENOTFOUND github.com`. Packaging now verifies the installed Electron version against the package pin and supports `OMOC_ELECTRON_ZIP_DIR`. Reusing the existing matching local archive succeeded. This was an offline packaging change, not an alternate route to execute the denied GUI action.

The default Electron E2E attempt reported `Process failed to launch!`; a separate installed-binary probe terminated with `SIGABRT` and no diagnostic output. The root cause is not confirmed. An escalated E2E request then failed because automatic approval review had reached its usage limit. The platform explicitly stated that the action was **not executed** and that this was a review failure, not a determination that the action was unsafe. No alternate launch route was attempted after that failure.

The native agent inventory retained eight existing children without a supported close-agent action, and the fresh CLI route reported a usage limit. No independent final reviewer result was manufactured or replaced by the primary's own integration checks.

## Local package

Application:

`apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app`

Launch from a terminal:

```sh
open "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app"
```

This package was built and inspected, but not successfully launched during this increment. Release signing, notarization and publication were not performed. Existing provider credentials are not inherited; no successful provider conversation or real tool execution is claimed. Missing model credentials should produce `AUTH_REQUIRED`, as covered by synthetic host tests; the real UI submission scenario still requires E2E execution.

Archive SHA-256: `b12da910f05f3029d019bdcbcb4c831ce5b78103c256a7d1b71ddaa267d1b363`.

Full executable, sidecar and app-tree hashes are retained in `package-inspection.json`; the current build comparison is in `package-source-match.json`.

## Remaining work

After a functioning runtime-approval and fresh-review route is available, execute the contracted Electron workbench E2E and the affected existing development/packaged lifecycle tests. Capture the actual desktop UI and obtain independent code and rendered-design verdicts. Resolve findings before registering final acceptance and finishing this increment.

Preserved parent work includes durable storage/recovery and retention choices, complete worktree/import/delete workflows, permission modes and delegation, browser/PTY/Git panels, extension configuration and installation, automation, remaining monitoring/operational acceptance, and native macOS/Windows release validation. The temporary core implementation does not reduce that scope.
