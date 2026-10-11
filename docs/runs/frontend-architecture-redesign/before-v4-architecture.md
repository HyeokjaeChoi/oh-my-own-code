# Desktop frontend architecture and interaction contract

Version: 3 | Date: 2026-10-03 | Proposed; implementation not yet migrated

## Module topology

```text
renderer/app/{providers,styles}          bootstrap and stable injection
renderer/pages/workbench/{ui,model}    window composition/layout
renderer/widgets/{session-navigation,conversation,inspector}
renderer/features/{session-actions,compose-message,decide-permission,browse-files}
renderer/entities/workbench/{model,api} single runtime projection
renderer/shared/{api,lib}               typed transport and generic utilities
packages/ui/src/{primitives,tool-ui}    owned components and scoped styles
```

Create slices only when used. Dependencies go downward; same-layer cross-slice imports are forbidden. Cross-slice imports must resolve to the exact slice-root public index, including re-exports/dynamic/type imports. Shared uses segment APIs rather than fictional shared slices. Only explicitly registered global reset/token styles cross ownership boundaries. No privileged host modules in browser contracts. Apply resolver fixtures to real files, aliases and CSS; a filename ending in index is not enough.

## State and lifecycle

| State | Owner | Mechanism / lifetime |
|---|---|---|
| Effects, permissions, identity, receipts | Main | Authoritative host service; eventual durable registry |
| Transcript/tools/execution/permission projection | Window-scoped workbench store | Pure discriminated-union reducer + selector subscriptions, keyed epoch/workspace/session |
| Catalog/files | One bounded fresh-read controller per capability | No Query or persistent reopen cache; identity/trust invalidation, bounded resources |
| Selection/panel layout | Workbench page | Local reducer |
| Drafts | Bounded per-session draft owner | Separate from runtime projection; preserve navigation and uncertain send |
| Search/rename/menu | Owning component | Local state |
| Services/config | Stable provider | Context; never high-frequency token transport |

Keep workspace/session list ownership with snapshot initially; extracting metadata requires separating live fields. Reject stale identity/generation/revision atomically, including connection health. Confirmed deletion must reconcile a currently selected deleted ID regardless of old navigation generation, while preserving a different valid current selection. Errors, pending, accepted, confirmed and unknown are distinct.

Read contract amendment must cover aggregate admission, per-scope coalescing, whole-request deadline, sender/ID/identity validation, cancellation/status and safe epoch recovery. An AbortSignal does not cancel Electron invoke automatically. Timed-out renderer reads ignore late replies and request cancellation, but host capacity is released only on actual completion/cancellation/proven teardown. Ignored cancellation quarantines capacity instead of permitting unbounded retries. Mutation timeout preserves identifiers and draft; read-only receipt reconciliation never replays the mutation. Unmount/window-close/runtime restart clean timers and invalidate obsolete generations.

TanStack Query is deferred for this increment. A single bounded fresh-read path owns each catalog/file resource. No automatic mutation retry. Resource freshness and host read admission follow the explicit amendment below; no custom general-purpose cache framework is added.

## Component and CSS ownership

CSS Modules is the only application styling mechanism for renderer and UI package, using existing Primitive → Semantic → Component variables. Tool UI copied utility strings are converted rather than installing Tailwind beside Modules. Global reset/tokens only; contain and then remove legacy component rules. No Emotion, styled-components or Radix Themes.

Native button/input/textarea/select remain the default for basic controls. For complex focus-managed overlays choose Radix, because mandatory assistant-ui already resolves radix-ui 1.6.7 and no demonstrated requirement needs a second family. This is a delegated engineering recommendation, not a user mandate to use Radix. Declare one exact direct UI dependency when wrappers land; do not introduce Base UI alongside it. Verify peer/composition/portal/focus/CSP behavior before consumers. Failure blocks that family pending a replacement decision rather than adding another one. assistant-ui and owned Tool UI remain required and consume a single app projection.

No direct Zustand/XState/Query adoption in this increment. assistant-ui's internal Zustand is an upstream implementation dependency, not a second app-owned canonical store. Every new dependency must name its responsibility and replacement plan; two stores/caches for one resource, two app style engines or two task orchestrators are forbidden. pnpm package resolution and Nx task orchestration, and Vite renderer/esbuild host outputs, have distinct owners and are complementary.

## Actual UI specification

All sizes are logical CSS pixels. White conversation canvas, subdued neutral sidebar, restrained dark primary action, visible blue keyboard focus. Borders only where they convey interaction or necessary separation; no repeated outlined cards, decorative strips, gradients or implementation prose at rest.

- Sidebar 248–260 wide, padding 12. Compact workspace selector; new conversation primary; workspace create/import in labelled menu.
- Session row: 44 target height, 14/20 single-line text, ellipsis, min-width:0, radius 8 and reserved trailing action space. Full name accessible. Actions available on focus and hover. Pin/status as labelled compact icons.
- Header 56–60 high, single-line 14px title, restrained status. 18–20 icons in 44px targets.
- Conversation max width 720–770, horizontal padding 24, body 16/25–26. Flat assistant text, subtle user surface. Preserve reader scroll position unless following bottom.
- Empty state: one 24/30 heading, at most one short contextual line in upper-middle. No permanent implementation warnings outside relevant states.
- Working assistant-ui composer: initial 112–132 height, 16px input, one toolbar, bounded textarea growth. Agent/model controls concise and accessible; no permanent double label rows. Keep IME, Shift+Enter, command selection, send/stop and drafts.
- Inspector: default 336, range 300–420, 48 header. Keyboard-operable resize separator and reset replace permanent slider. Human-readable activity labels, compact timestamps, technical IDs only on expansion.
- Collapse navigation where columns no longer fit. Narrow inspector is a modal sheet with inert background, Escape and explicit return-to-conversation; docked panel nonmodal. Restore focus. At 200% zoom use reflow, never forced desktop columns.
- Retain native titlebars. Any later custom chrome must separately prove macOS/Windows caption safe areas and drag behavior.

Verify normal text 4.5:1, functional boundaries/focus 3:1, visible focus, no color-only meaning, keyboard/IME, reduced motion and no token-by-token live-region flood. Current 44px hit target policy remains even with compact visual icons. Use locale-aware dates/messages and platform-aware shortcuts; do not intercept OS/editor shortcuts.

## Performance, operations and maintenance

Measure exact build, OS/CPU, viewport/DPR/zoom and representative bounded transcript fixtures first. Proposed local targets: p95 input/menu/panel ≤100ms, cached session shell ≤150ms without wrong-session frame, received-store update ≤100ms, no repeated >50ms typing/scroll tasks. Report sample count and measurement method. Targets are not measurements or universal Electron standards. Separate polling/network latency.

After 100 switches check request/listener stability and stabilized heap. Record raw/gzip entry size and cold startup; >10% growth requires a reason. Profile before virtualization/memoization/lazy-loading. Separate native macOS and Windows baselines.

Preserve sandbox/isolation, IPC sender validation, host permission/path authority and safe preview navigation. Error boundaries allow local recovery without replay. Bounded local metadata only: operation, opaque request ID, timing, outcome, stale/timeout/cancel counts; no prompts, paths, tool content or credentials.

Nx must include desktop boundary checks explicitly; host/native E2E/package tasks are noncached. Retain lockfile and peer compatibility evidence, shared React identity and copied-source provenance. Migrate one vertical slice per reversible checkpoint; remove obsolete selectors/adapters rather than permanently maintaining two UIs. With no baseline Git commit, record file hashes and a recoverable local snapshot before broad moves; do not claim commit rollback exists yet.

Storage follow-up exposes managed/imported origin, stable identity, display location and recovery status. Main creates `~/Documents/OhMyOwnCode/{session-id}` for managed workspaces; rename does not rename that directory. Imports stay where they are and removal does not delete their files. Keep temporary-storage messaging until restart/crash/migration/rollback evidence establishes persistence.

## Sources and interpretation

The choices above are repository-specific judgments informed by the independent audit and Astra planner, not official recommendations for this exact product.

- https://feature-sliced.design/docs/reference/public-api
- https://feature-sliced.design/docs/reference/layers
- https://react.dev/learn/extracting-state-logic-into-a-reducer
- https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- https://base-ui.com/react/overview/about
- https://ui.shadcn.com/docs/changelog/2026-01-base-ui
- https://zustand.docs.pmnd.rs/learn/guides/initialize-state-with-props
- https://stately.ai/docs/invoke
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/performance


## AMAX-1: exact mutation identity and outcome contract

P4 adds a versioned closed IPC envelope around mutations: `{operationId, runtimeEpoch, expectedRevision?, operation}`. The client generates the opaque bounded `operationId` before sending and retains it with the draft/action; main validates sender and scope, computes a canonical input digest and records admission **before dispatch**. Distinguish this ID from transport `readId`, native permission request ID and native inbox ID. Keep old operation-specific `requestId` fields only as explicit native/legacy fields during an atomic caller/contract migration.

Main ledger key is `(runtimeEpoch, operationId)` with immutable kind/workspace/session/digest. Reused ID with different scope/digest rejects; same ID returns its recorded state without dispatch. Apply to create/import/remove, lifecycle, send, command, interrupt and permission response, not only current send/lifecycle maps. Validate limits before effects: at most 2,048 runtime operation records and the existing 256 send receipts per session; do not evict unresolved records or dedup tombstones to admit new mutations. Capacity failure means no dispatch.

Expose read-only `operation.lookup {runtimeEpoch, operationId}` returning identity, `admission: rejected|admitted|dispatched`, `delivery: pending|accepted|unknown`, `effect: none|pending|confirmed|failed|unknown`, revision and redacted evidence references. Preserve operation-specific result IDs/confirmed removed target IDs. `accepted`, interrupt requested and permission decision delivered never mean tool completion. Definitive pre-dispatch validation rejection can establish `effect:none`; a missing/expired/wrong-epoch record cannot.

Positive evidence is operation-specific: host-applied metadata plus revision; native creation/fork result tied to this operation; confirmed removal of this exact target with retained receipt; send/command inbox ID tied to this operation; interrupt receipt plus terminal observation; permission reply receipt tied to native request/revision. Existing idle/existence/title observations, absence from pending permissions, elapsed time or successful unrelated reads do not resolve an unknown dispatch. Ambiguous native timeout with no sufficient correlation remains unknown.

Renderer timeout ends waiting, marks delivery unknown and performs bounded **lookup only**. A late matching definitive receipt may reconcile the original operation; it never triggers a replay. Clear a blocked unknown only from that operation's authoritative evidence or explicit host-controlled namespace retirement/recovery. A new epoch does not clear old uncertainty. Until P7 supplies durable receipt recovery, describe receipts as runtime-lifetime only and preserve unresolved state/read-only recovery rather than claiming restart reconciliation.

Separate delivery uncertainty from execution uncertainty: lookup may prove acceptance and allow draft handling, while busy/unknown execution still disables conflicting actions. Explicit user creation of a new operation after reviewing effects belongs to a host recovery action, not an automatic retry button. Main alone decides admission.

## AMAX-3: fresh files without Query

Each read identity includes runtime epoch, workspace ID, trust revision, canonical relative path, resource kind and local generation. Reopening a file always reads it again; refresh revalidates the current listing AND open preview. Clear prior preview before a different file is selected. A failed/deleted-file read cannot leave old text looking current.

Known tool/file mutation completion marks affected visible resources stale and triggers one coalesced fresh read; if exact paths are unavailable invalidate the visible workspace resource. Foreground/refocus revalidates visible resources through the same bounded transport. While visible, a five-second single-flight revalidation covers external edits without native file-watch infrastructure; suspend when hidden/disconnected. Retained same-file content is labelled “checking/last observed” and never claimed live. Successful reads show last-observed time; failures mark stale or clear missing content.

Selection/unmount/epoch/trust changes invalidate generations; late responses cannot restore old content. Test tool edit, external edit, external deletion/recreation at the same path, refresh, reopen, stale failure and delayed A→B→A. This bounds freshness without claiming instant external-change detection. Future editable files require host version checks before save; fresh display alone is not write conflict protection.


## Read admission policy

Default reviewed target: 10s whole-read deadline from issue; four host logical classes/slots (snapshot, catalog, files and reserved local operation lookup); no unbounded queue. Coalesce identical scope/resource requests, audit nested SDK fan-out, reject cross-sender cancellation. Ignored cancellation quarantines its slot until work demonstrably ends or safe teardown proves disposal. Mutation lookup remains available when snapshot capacity is exhausted. P4 compatibility probes establish enforcement; none has run yet.

## Verification output ownership

P2 implements run-evidence.mjs with required output root under this run, enumerated scripts, shell:false child execution and a distinct nonempty-protected per-script destination. It sets OMOC_EVIDENCE_DIR explicitly and preserves stdout/stderr/exit status. Required contract commands reference this planned wrapper before E2E execution; missing wrapper blocks those checks. Earlier evidence is never an implicit output target.
