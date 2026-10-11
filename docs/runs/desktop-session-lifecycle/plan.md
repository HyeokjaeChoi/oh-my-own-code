# Desktop session lifecycle and local execution records

Revision 3. Date 2026-10-03. Parent: build-delivery, full PRD v0.6 F-01–18.

## Outcome and authority

Continue the user's explicit autonomous desktop work following the core
workbench integration. Preserve Electron, macOS/Windows targets, the owned
OpenCode v2 sidecar, assistant-ui, Tool UI, existing tokens and module boundaries.
This increment adds session search, rename, pin, archive/restore, history fork,
explicit conversation deletion and a bounded local activity/diagnostics panel.
It advances F-04/F-16 and does not reduce the full product/release scope.

The current user instruction authorizes local development, disposable tests,
native app execution and packaging. It does not select a permanent data path,
authorize use of personal provider credentials, or waive project-file safety.
Session organization remains within the existing temporary runtime. Persistent
storage/retention, full worktree deletion, browser/PTY/Git, extension management
and remaining parent acceptance continue separately. Do not call app archive
state a durable SDK archive or the local activity view a provider billing log.

## Decisions and scope

- Extend the existing closed IPC union; the renderer never chooses a raw SDK
  session ID or executes an arbitrary method. Main validates workspace/session
  ownership, exact keys and bounded values for every request.
- Native confirmation occurs immediately before conversation removal. The
  dialog explains that app/session conversation history is removed while
  project files remain. Never implement folder or worktree deletion here.
  A session with descendants cannot be removed through this bounded operation;
  check both the app registry and the authoritative paginated SDK child list
  before confirmation and immediately before removal. Unknown or incomplete
  child-list state also blocks removal. Do not assume SDK cascade safety.
- Rename and history fork use the installed SDK's exact APIs. Fork retains
  history and is labelled distinctly from an empty new session. Reapply and
  read back the existing ask/deny policy on the child before exposing execution.
  No model/provider call is needed to create, inspect or organize sessions.
- Pin and archive are application presentation metadata in the temporary
  registry, not a new persistent store. Archived conversations remain readable
  and can be restored; main refuses sends/commands to them until restored.
- All lifecycle changes require an idle, known target and lock their workspace
  during the operation. Read active/inbox status before destructive or history
  mutation; UI disabled states alone are insufficient. Unknown transport
  outcomes are recorded and never automatically retried.
- Lifecycle requests have bounded request IDs and receipt/fingerprint handling.
  Duplicate submission must not create a second fork or repeat deletion. A
  conflicting reuse fails. Unknown duplicates return UNKNOWN_OUTCOME, known
  failures return their saved fixed failure, and only known-success duplicates
  return a current safe snapshot. Keep removal receipts after deleting app
  session registration. Receipt exhaustion fails explicitly rather than
  silently evicting and replaying old effects.
- Record only bounded local operation metadata: main-created event ID, time,
  operation, known app IDs, duration, fixed result/error code. Exclude prompt,
  tool output, path, credentials, raw SDK errors and provider payloads. Polls
  do not flood the event list. Expose dropped-record counts honestly.

## Architecture

The existing ADR-0001/0002 still governs module and state ownership. No new
framework, package, runtime process or build system is needed. Main owns
authoritative sessions, lifecycle receipts and operation observations. Renderer
owns search/filter/menu/form state and renders snapshots; it cannot establish
completion from an action click. Add focused host helpers only when they reduce
service coupling. New renderer features use public FSD slice entrypoints.

Alternatives: using a second browser store for session truth was rejected
because stale permission/ownership state would diverge; writing organization
state to an arbitrary permanent file was rejected because data location and
retention are unresolved. The reversible app-session registry preserves current
behavior and leaves an explicit seam for later storage selection.

The typed contract in interface.md is the design-spec SSOT for these additions.
Source changes start only after core final review settles and this plan plus
the interface receive independent passes. Reviews do not replace native tests.

## Acceptance

- AC-1: Closed lifecycle requests enforce ownership, bounds, idle/known state,
  duplicate/conflicting IDs, cancellation, and no project-file deletion. Rename
  and fork use representative installed SDK shapes; fork policy is checked.
- AC-2: Actual desktop UI supports search, pinned ordering, rename, archive
  filter/restore, clearly labelled history fork and native-confirmed deletion.
  Selection/drafts/transcripts stay attached to the right session; archived
  sessions cannot execute. Menu/form keyboard/focus behavior is usable.
- AC-3: Local activity view shows actual main-process observations with bounded
  retention, a dropped count, session filter, duration/status and empty/error
  states. Tests prove prompt/path/auth payloads never appear in this DTO.
- AC-4: Existing core behavior, host/preload/security/lifecycle, safe preview,
  assistant-ui/Tool UI and module boundaries keep passing. Unit, type, lint,
  format, build, bundle, boundary and actual Electron scenarios pass.
- AC-5: Local macOS package matches the tested build and runs; current captures
  support independent code/design final reviews. Remaining Windows/provider/
  permanent-storage/full-release limits stay explicit in the outcome.

## Execution and ownership

1. Primary registers plan, checks and interface; a fresh reader reviews plan,
   followed by a separately bound design-spec pass. For the linked contract
   clarifications in revision 2, one fresh bounded reader may judge the plan
   first, then the interface only if its plan verdict passes, returning separate
   exact-bound reports. The coordinator registers plan before design-spec and
   before implementation, recording the actual invocation and ordering.
   The completed core increment remains the implementation baseline.
2. Backend worker: workbench-service.mjs, workbench-contract.mjs,
   desktop-bridge.d.ts, main.mjs native confirmation, a focused host lifecycle
   helper if justified, and new workbench-session.test.mjs. Preserve all prior
   safeguards and existing test semantics. No renderer edits or ledger writes.
3. Renderer worker: renderer/app, new renderer/features/sessions and activity
   slices, necessary conversation archive disable state, renderer.css, and
   focused projection tests. Consume frozen DTOs. No host/package/ledger edits.
4. Primary integrates, adds e2e-session-lifecycle.mjs using disposable real
   sidecar sessions/native-dialog substitution and extends test-only renderer
   fixtures only as required. Capture actual UI and correct failures before
   final checks, local packaging and frozen independent code/design reviews.

Use disjoint fresh worker contexts and one bounded independent reader per
changed concern. Supported CLI routes are acceptable when native agent slots
are unavailable; record observed routing rather than claiming profile labels
attest model identity. Corrections use a new independent review invocation.

The first useful feedback is a real desktop session renamed/forked/archived,
with a preserved sentinel project file after confirmed conversation removal.
If the SDK produces different fork/location/removal behavior, stop that path,
inspect its installed contract and revise the affected design; do not loosen
ownership checks or hide failed outcomes.

## Dependency holds and verification limits

No unresolved user choice blocks temporary session organization or local
diagnostics. Permanent data path/retention and native Windows evidence still
block their own parent outcomes. Existing provider authentication stays outside
this increment. All filesystem effects in tests use owned disposable fixtures.
The actual application presents native confirmation before any user-triggered
history deletion; development never deletes real user project files.

History: revision 1 defines the next independent desktop increment after core
runtime/layout corrections, retaining prior user selections and full scope.
Revision 2 resolves the independent contract review's descendant/pagination and
unknown-duplicate findings. No product scope, platform, storage decision or
acceptance check was removed. Linked changed-concern review is consolidated
without combining authorship and judgment or skipping either bound gate.

Revision 3: actual SDK probes establish that history fork lineage lives in
`fork.sessionID`, while `parentID` is not set and parent-filtered lists omit
those forks. Deletion must exhaust an unfiltered list and examine both
relationships. Empty-history fork is a definite `InvalidRequestError` with
`kind: empty_session`; report fixed EMPTY_SESSION without marking an unknown
effect. Other fork failures remain unknown. Verify populated synthetic history
through the production service and real SDK; real Electron covers empty-fork
refusal and the other UI lifecycle operations. This corrects observed SDK
compatibility without changing product scope or storage authority.
