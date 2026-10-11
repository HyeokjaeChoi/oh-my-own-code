# Desktop frontend architecture audit — 2026-10-03

Independent reader: `/root/frontend_architecture_audit`. Read-only static
inspection of the ADRs, desktop renderer, dependencies and boundary checker.
No tests or native UI observations were performed by this reviewer.

| Concern | Documented direction | Actual desktop implementation |
| --- | --- | --- |
| FSD | Layers and slice public APIs | app/features/shared; resolver-backed AST checker with bypass gaps |
| Remote metadata | TanStack Query | Custom IPC hooks; Query absent |
| Live projection | One external owner | Snapshot polling in useWorkbench, assistant-ui external runtime |
| Shared transient UI | Scoped Zustand if needed | Parent local state and props; Zustand absent |
| State transitions | Explicit ownership | Multiple hooks/refs; no reducer or state-machine library |
| Components | shadcn Base UI default | Native HTML plus assistant-ui and owned Tool UI; Base UI absent |
| Styles | Token mapping | CSS variables plus global renderer.css; no component CSS library |

## Prioritized findings

- P1: Renderer read watchdogs only change displayed state. A never-settling IPC
  Promise keeps its request gate occupied, including after selection changes.
  File reads have no shared deadline contract. Define bounded request lifecycle,
  cancellation/recovery and main admission together; do not merely release a
  gate on timeout and permit unbounded duplicate work. Mutations keep no retry
  and unknown-outcome semantics.
- P1: The FSD checker accepts any target whose filename is index.*, including
  model/index.ts under a foreign slice. Unknown layers bypass layer checks;
  CSS returns before slice ownership checks. Require exact slice entry paths,
  explicit unknown-directory policy and resolver-level negative fixtures.
- P2: Model connection/read/mutation transitions with discriminated unions and
  pure reducers; a rejected old snapshot must not regress connection state.
  Keep the main process authoritative for execution and permissions.
- P2: Global button/input/select/heading/list/pre rules can affect copied Tool
  UI internals. Prefer CSS Modules with existing variables for feature styles,
  retaining global reset/tokens only. Keep copied UI styles package-owned.
- P2: Document which ADR choices are deferred versus the final baseline.
  TanStack Query has potential value for catalog/files metadata; Zustand is
  unnecessary for current parent-owned UI. Context suits stable client/config
  injection. XState and Emotion lack a present demonstrated need. Evaluate
  Base UI for complex overlays without replacing every native control.
- P2: Establish measurable renderer/bundle and accessibility budgets before
  claiming production readiness. Current bundle inspection is privilege
  inspection, not performance evidence. Plan 200% zoom, keyboard/overlay focus,
  delayed A→B→A responses, unknown scope isolation and real import-path bypass
  checks. Split components by responsibility when it reduces coupled state.

The existing bounded core deliberately deferred new state frameworks, so their
absence is not itself a regression. The next focused architecture plan must
resolve these gaps before broader workspace, terminal and preview expansion.
This report is not a claim that the recommendations are already implemented.
