# Frontend architecture and UI replan

Revision: 2 | Date: 2026-10-03 | Status: proposed execution baseline, independent review pending

## Outcome and authority

The user requests a structural replan demonstrating Staff frontend engineering judgment and explicitly rejects the current UI. This plan supersedes feature-first sequencing, not approved product requirements. Preserve Electron on macOS and Windows, owned OpenCode v2 sidecar, assistant-ui, Tool UI, the white ChatGPT-inspired direction, and imported project files. New managed workspaces must ultimately persist under `~/Documents/OhMyOwnCode/{session-id}`. The existing implementation remains temporary until the dedicated storage increment passes restart/recovery checks.

This iteration delivers the reviewed replan. Implementation proceeds in bounded stages below; this document is not evidence that those stages are implemented. Do not mark the existing session run visually accepted. Preserve its successful checks and unresolved code finding.

Inputs: `../desktop-session-lifecycle/frontend-architecture-audit.md`, its actual lifecycle/activity/narrow captures, `../../decisions/0001-workbench-platform.md`, `../../decisions/0002-desktop-runtime.md`, `../../design/system.md`, approved PRD/specs, and the user's latest direction. Astra/high planning analysis directly inspected three captures. The coordinator integrates that analysis; independent entry review remains separate.

## Staff-level outcomes

| Competency | Concrete deliverable | Evidence required |
|---|---|---|
| Architecture and ownership | FSD public APIs, state/lifetime matrix, coarse workspace modules | Real import-graph rejection fixtures; no duplicate domain authority |
| Product and interaction judgment | Conversation-first shell, concise actions and composer, responsive inspector | Actual Electron captures and keyboard flows, not mockup approval |
| Reliability | Bounded read admission, stale-response rejection, explicit command outcomes | Deferred-promise races, cancellation and exhaustion tests |
| Accessibility and localization | Focus model, IME, translated labels, zoom/reflow and contrast | Keyboard/200% zoom, Korean long-content fixtures, measured contrast |
| Performance | Reproducible baseline, render/interaction budgets and bundle growth policy | Traces with hardware/build/fixture identity; no invented measured numbers |
| Security and privacy | Narrow IPC, host authority, safe previews, redacted observations | Sender/path/receipt regression tests and bundle isolation |
| Engineering effectiveness | Small vertical migrations, exact checks, noncached native tests | Nx/CI targets, dependency provenance and rollback checkpoints |
| Operability | Visible recovery, durable identity seam and platform-specific evidence | Restart/crash/missing-folder tests in storage stage; native platform results |

These are project-specific demonstrations of commonly expected senior technical leadership, not a universal industry certification or a requirement to install every library.

## Decisions

- Retain pnpm/Nx, Vite renderer and esbuild host. No build-tool migration without a measured problem.
- Enforce FSD inside the renderer, with coarse packages for contracts, tokens and UI. Do not create one workspace package per feature or empty layers.
- Use one window-scoped external projection store with pure typed transitions and selectors. Main owns execution, permissions and receipts. assistant-ui adapts this single projection.
- Adopt TanStack Query only for catalog/file reads after bounded transport. No duplicate transcript/status/permission cache; mutation retries remain disabled.
- Use local hooks/reducers for forms/layout and stable Context for services. Defer Zustand until distant UI consumers need shared ownership; defer XState until hierarchical/parallel workflows exceed readable reducer transitions. Neither is required to claim Staff-level design.
- Component primitive selection is open: Base UI, Radix, shadcn source and native/owned controls are candidates, not mandatory dependencies or user-approved defaults. Compare required keyboard/focus/overlay behavior, native accessibility, composition with assistant-ui/Tool UI, token styling, dependency cost and maintenance before selecting the smallest suitable set. CSS Modules plus existing tokens own styling; do not silently retain Tailwind utility strings without a pipeline. Tool UI styles stay package-owned. Emotion and a wholesale Tailwind conversion add no demonstrated value now.
- Preserve current font/token direction and Lucide. Fix information hierarchy, density and behavior before adding visual novelty.
- Preserve all PRD features in the parent backlog, including terminal/browser/artifact panels, skill/MCP management and workspaces. Their expansion follows the first accepted UI slice and state foundation.

## Ordered delivery and ownership

| Stage | Assignment / owned paths | Dependency / exit |
|---|---|---|
| 0 | Coordinator: this plan, contract and architecture/interaction spec | Independent plan and design-spec review; no new user permission needed for authorized local work |
| 1 | Focused worker: deletion-selection repair and regression in desktop renderer/session tests | Confirmed remove reconciles current IDs even after A→B→A; preserve different valid selection; never replay mutation |
| 2 | UI worker: shell, session rows, composer, minimum `packages/ui` wrappers and scoped CSS | Real normal/narrow Electron screen review before rolling design across other components |
| 3 | Transport worker: desktop contracts/main/preload bounded reads; state worker after contract freeze: projection and read adapters | Whole-read deadlines, no growth on repeated refresh, rejected stale response cannot update health |
| 4 | Feature worker: navigation → conversation → inspector vertical slices; boundary worker owns checker/Nx fixtures | Each slice keeps current behavior and removes its obsolete global CSS; disjoint writes only |
| 5 | Verification and independent code/rendered review | Existing regressions plus A1–A7 below; no repeated unchanged broad checks |
| 6 | Separate host storage increment | Managed path, registry/history restart, crash recovery and imported-file preservation; frontend cache never durable truth |
| 7 | Resume parent product backlog | Working workspace/skills/MCP/tools/artifacts/terminal/browser features against the accepted foundation |

The first visible deliverable is the real shell + one-line session navigation + compact working assistant-ui composer. It tests whether hierarchy and spacing solve the actual usability complaints. If it still resembles a diagnostics page, revise that slice before expanding or adding polish elsewhere.

Readers never edit implementation. Use fresh bounded children with path-based handoffs; coordinator integrates and records evidence. Sequential work needs no parallel agent. Model/effort choices remain task-specific; the current planner used Astra/high, not a permanent profile pin.

## Acceptance

- A1: Exact slice-root APIs; reject nested indexes, unknown layers, alias/relative escapes, CSS ownership bypass and host imports through real resolver fixtures.
- A2: Correct A→B→A, stale revision/epoch, draft separation, deleted selection and permission action behavior.
- A3: Never-settling reads, late replies, ignored cancellation, admission exhaustion and repeated refresh remain bounded. Mutation uncertainty never causes automatic replay.
- A4: Import/create/session actions/send/stop/commands/files/tool cards/permissions remain usable; imported sentinels survive.
- A5: Keyboard navigation, IME, overlay focus/return, 100/200% zoom, long Korean text, contrast and reduced-motion checks.
- A6: Actual empty/populated/streaming/permission/disconnected/unknown/archived/long-title/inspector states at logical 1280×800, 1180×820 and 760×600; narrow layout at 200% zoom.
- A7: Reproducible performance measurements, bounded redacted diagnostics, current package checks, explicit macOS versus Windows evidence limits.

## Verification and phase blockers

Retain existing node:test, TypeScript, ESLint, Prettier, boundary, build/bundle and Electron Playwright checks. The registered contract carries existing exact commands; add focused new commands before their stage's implementation handoff. Existing tests passing does not establish A1–A7: each needs its named new cases and observed evidence. Actual-rendered design approval remains required independently of automation.

Before Stage 3, bind exact read limits/deadlines/cancel semantics in a reviewed IPC amendment after inspecting SDK behavior. Before Stage 2 dependency changes, record the component-selection comparison and pin compatible versions/provenance only for dependencies actually selected; before Query migration pin compatible Query version. Before persistent storage execution, independently review crash/migration/rollback and identity contract. These are technical dependency holds, not requests for repeated user approval.

No unanswered product preference blocks this replan or the first UI slice. Packaging, publication/signing and Windows runtime readiness must not be inferred from a macOS local check. Real provider execution and credentials remain separately bounded.

## Change history

Revision 1 replaces feature expansion with correctness repair, an early visible UI slice, explicit state/module/style ownership, measurable hardening and then durable storage. It includes the new deletion-navigation finding and carries the user's storage direction forward.

Revision 2: The user clarified that Base UI/Radix were suggestions, not requirements. Remove the forced primitive baseline. The four Astra/max findings remain open; revision 2 is not implementation clearance.
