# Configuration files — F14 continuation

Revision: 6 | Date: 2026-10-08 | Major initial explicit configuration-content read contract

configuration-drafts is COMPLETE with independent CODE/RENDER PASS. This increment connects the editor to an explicit selected-workspace file read and a real loaded-file comparison/version. Full F14 still requires file apply, explicit Native activation/reload, Skills/agents/hooks/tools/plugins and MCP lifecycle; those remain in the active full-product Goal. No new permission from the user is needed for authorized contained implementation/checks.

## Actual source and selected boundary

Actual production event-host-child.mjs starts pinned2.0.18 with config.project:false, fs.filewatcher:false and closed EVENT_HOST_CONFIG. Thus default upstream watch behavior does not describe this production runtime. Existing configuration markers are inert metadata; config.update is shell-only. location.reload invalidates and initializes all currently loaded locations, returns void, and does not activate ignored project files. Preserve this inert boundary. Do not add project:true or enable watches as a shortcut.

The useful next increment is actual file-to-editor loading. Main derives only root AGENTS.md or opencode.json from the registered canonical workspace and closed kind instructions|mcp. No arbitrary absolute path, generic sensitive-file bypass, automatic read, SDK config.get or side effect. Existing generic file preview keeps denying opencode.json/jsonc. MCP file content is returned only when the entire strict JSON document passes the shared closed app-supported subset. Reject duplicate member names in every object, including equivalent Unicode-escaped names, before returning original text; JSON.parse last-key-wins is not safe projection. Other root config categories, environment/headers/OAuth credentials, malformed JSON/JSONC and unknown options return fixed unsupported diagnostics and no content. Such files remain untouched; later apply must preserve unsupported/opaque fields with a reviewed host-only adapter. Supported free text/argv can contain user-private information; this is explicit local viewing, not a complete secret-recognition claim. Known credential-valued fields are excluded structurally. No file body or diagnostic is logged/exported.

One browser-compatible shared validation module supplies both host and editor rules; retain existing TypeScript public API, diff helper and tests. This is a small extraction for parity, not a new package or state owner.

## Acceptance

- C1: explicit configuration.read validates a closed kind and current envelope/sender, derives fixed basename from registered workspace, uses bounded UTF8 FD reads and before/after canonical root/parent/file identity, rejects symlink, hardlink, non-file, changed/oversized/control/binary input. Missing files report missing without a fabricated disk version. Existing read deadlines/cancellation remain bounded; no Native call or execution trust grant.
- C2: response includes exact workspace id/path, kind, file path, status and opaque hex version only for supported available content. Version hashes raw file bytes plus file/root identity and timestamps; no raw credentials/unsupported file body. Missing/unsupported/unavailable statuses have fixed closed reasons. File version is an observation, not an atomic write/CAS token or loaded Native state.
- C3: explicit load replaces only the selected kind/workspace draft after user chooses load. It sets a loaded disk baseline, increments draft revision and clears validation. Request identity includes epoch, workspace id/path, kind and draft revision. Discard aborts and permanently invalidates the exact pending request identity even when revision resets to0 and the same key is recreated. A new read needs a new explicit load action. An edit, kind/path/workspace/epoch switch or newer request prevents a late response from replacing text. Abort has no automatic retry/read. READ_BUSY offers explicit retry. Failed reads preserve the current draft. A new draft comparison baseline can be selected explicitly; label its memory provenance distinctly.
- C4: UI shows file load action and actual file status/path/version observation, comparison against last loaded file with stale observation warning. No save/apply/reload/connection success is fabricated. Selectable textarea/diff, keyboard/focus, narrow200 scroll and existing temporary draft retention/isolation work. File read is available only for registered available paths; it grants no execution trust.
- C5: meaningful contained host/contract/store/controller tests, affected type/lint/format/boundaries/build/bundle and one actual hidden synthetic file-loading flow; preserve failure artifacts, owned exit and provenance. Independent code/render PASS closes this bounded read-to-editor increment. No unchanged Native/package/performance runs.

## Order and ownership

Main owns plan/design/ledger, shared validation extraction, narrow host reader, closed DTO/contract/admission/service and store/controller/tests/runner. Initial fresh reader reviews the new sensitive-content read plan and separately bound design once. After pass, Main freezes actual public response/actions before a disjoint UI worker edits only configuration-drafts feature/CSS. Main and UI worker writes do not overlap. No recursive delegation. Routine corrections reuse entry decisions.

## Decisions, alternatives and rollback

Selected fixed configuration reader and shared browser-safe validation. Generic file.read is rejected because it would weaken existing sensitive-path protection; SDK config.get is rejected because it initializes Native locations and exposes raw credentials. Returning raw config or dropping unknown fields into a rewritten subset is rejected. Native activation remains separate because project:false and reload scope require a coordinated later effect contract. No new dependencies/global store.

Canonical references: workbench architecture sections5/6/7; workbench UX section6; approved platform ADR/FSD/single-window state; completed configuration-provenance and configuration-drafts. All execution choices for this read increment are settled. Later write/runtime concerns remain required but do not block pure reading. Rollback removes new read/actions/UI as a coherent additive group; no original file, journal, operation or Native configuration changes.

## Initial review corrections — revision3

Preserve entry-plan-review-r2 changes_requested. R2-P1: shared validator rejects duplicate decoded JSON keys in every object before any original text projection; add root/server/option/Unicode canaries. R2-P2: store requires the exact immutable active request identity, discard deletes it and controller aborts; late success/error cannot repopulate a recreated revision0 entry. R2-P3: required changed-path lint/format argv now registered. These address initial boundary findings only; no Native/package/performance expansion. Fresh independent correction reader reviews the corrected concerns and separately bound design. No product source edits occurred.

## Coherent implementation verification — revision4

Both disjoint implementation workers are complete and closed. Actual host reader, additive read DTO, shared validation, store/controller cancellation and explicit file UI are integrated. Extend affected configuration checks to fixture, admission and evidence-wrapper regressions; include the changed transport path in lint/format. Retain the accepted design v2 and initial boundary verdicts. Run one current build and actual hidden file-loading flow, then independent CODE/RENDER reviews. No repeated initial approval or unchanged Native/package/performance gate.

## Independent code correction — revision5

Preserve final-code-review-r1 changes_requested (CF-CODE-R1-01). Share a separate disk-content predicate across host, store and fixture: instructions allow empty/whitespace/BOM text within byte/control bounds; MCP still requires its closed nonempty strict format. Draft empty-format validation stays separate. Add real temporary Host FD IO through controller/store regression and actual hidden blank-file read/empty-validation flow. No write, Native or scope changes. Targeted correction passed. Run current affected checks/build/hidden-r2 and fresh independent CODE/RENDER correction reviews, keeping the original reports/evidence.

## Canonical path regression — revision6

Main independently reproduced a legal POSIX workspace name containing literal/trailing backslash. Host returns available but prior renderer inferred Windows separators from any backslash and rejected the correct target. A shared browser-safe fixed-target helper now chooses canonical root form and removes only its actual separator. Real temporary Host→controller regression and synthetic Windows/UNC string tests pass. Add actual hidden synthetic POSIX-name flow and retain all prior outputs; no Windows runtime claim. This is a routine fixed-target correction, not new permission or scope.
