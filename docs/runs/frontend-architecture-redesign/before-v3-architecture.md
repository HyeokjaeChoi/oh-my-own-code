# Desktop frontend architecture and interaction contract

Version: 2 | Date: 2026-10-03 | Proposed; implementation not yet migrated

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
| Catalog/files | Disposable Query cache | Explicit resource keys, trust/runtime invalidation, byte/entry cap, no persistence |
| Selection/panel layout | Workbench page | Local reducer |
| Drafts | Bounded per-session draft owner | Separate from runtime projection; preserve navigation and uncertain send |
| Search/rename/menu | Owning component | Local state |
| Services/config | Stable provider | Context; never high-frequency token transport |

Keep workspace/session list ownership with snapshot initially; extracting metadata requires separating live fields. Reject stale identity/generation/revision atomically, including connection health. Confirmed deletion must reconcile a currently selected deleted ID regardless of old navigation generation, while preserving a different valid current selection. Errors, pending, accepted, confirmed and unknown are distinct.

Read contract amendment must cover aggregate admission, per-scope coalescing, whole-request deadline, sender/ID/identity validation, cancellation/status and safe epoch recovery. An AbortSignal does not cancel Electron invoke automatically. Timed-out renderer reads ignore late replies and request cancellation, but host capacity is released only on actual completion/cancellation/proven teardown. Ignored cancellation quarantines capacity instead of permitting unbounded retries. Mutation timeout preserves identifiers and draft; read-only receipt reconciliation never replays the mutation. Unmount/window-close/runtime restart clean timers and invalidate obsolete generations.

Query defaults will be explicit: no mutation retries, no automatic focus/reconnect storms, bounded read retry only after transport recovery. Resource stale/GC times and memory caps must be pinned in Stage 3 amendment. Do not count Query cancellation as end-to-end enforcement before a host probe.

## Component and CSS ownership

CSS Modules per component/slice; global styles only reset and Primitive → Semantic → Component variables. No global button/input/heading/pre styling leaking into features/vendor cards. No Base UI, Radix or shadcn requirement is imposed. Compare native/owned controls and library primitives for each required interaction family before dependency adoption; prefer native controls where their behavior is adequate. Complex overlays require explicit keyboard, focus containment/return, Escape, dismissal and screen-reader contracts regardless of implementation. Composition still needs accessibility verification. If shadcn source is adapted to Modules, record upstream revision/license and local divergence; no undocumented Tailwind-dependent copy. assistant-ui and Tool UI remain the conversation/card foundation.

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
