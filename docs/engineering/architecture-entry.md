# Architecture entry

Status: mandatory project decision and implementation-entry contract, 2026-09-26. This is a product-specific supplement to the shared harness. It does not change the Solopreneur library globally.

Read [ADR-0001: Workbench platform](../decisions/0001-workbench-platform.md) before workspace bootstrap or changes to module boundaries, state ownership, build targets or component foundations. The ADR contains the selected baseline, alternatives and reversal conditions. The active task plan remains the execution SSOT; an ADR defines durable decisions rather than duplicating the task queue.

## Authority and compatibility

The approved [execution architecture](workbench-architecture.md), [UX](../design/specs/workbench-ux.md), [verification contract](verification.md), [design system](../design/system.md) and [PRD](../product/prd.md) retain their respective authority. ADR-0001 supersedes only generic stack preferences and the tentative frontend/workspace preference in architecture v0.1 section 1. It does not weaken bridge authorization, path controls, preview isolation, idempotency, recovery or evidence requirements.

The [existing spike](../research/sdk-ui-feasibility.md) establishes limited package/type/synthetic-render evidence. It is not a production workspace or a compatibility certificate for a new dependency set. The [staff-architecture plan](../runs/staff-architecture/plan.md) records this increment; final status and independent reviews are in its run ledger.

## Required staff-level decision record

| Concern | Required decision | Evidence required before claiming implementation complete |
| --- | --- | --- |
| Monorepo and modules | Runtime owners, coarse workspace packages, FSD slices, export surfaces, allowed dependency graph, extraction triggers | Nx graph plus lint failures for forbidden project imports, sibling-slice imports, deep imports, alias/relative bypasses and browser-to-server dependencies |
| State management | Single owner, scope, lifetime, persistence and cleanup for every state class; Query/Zustand/local hooks/Context/URL responsibility | Session-switch isolation, late response discard, duplicate/out-of-order event handling, reconnect reconciliation, mutation retry and sensitive-data persistence checks |
| Build and task system | Nx vs alternatives, frontend/bridge bundler choices, package manager, task graph, cacheable targets and inputs/outputs | Locked clean install, peer compatibility, real dev/build/typecheck, deterministic task-cache invalidation, noncached side effects and production bundle inspection |
| Component foundation | requirements-based native/library primitive comparison, owned UI exports, assistant-ui and Tool UI adapter boundary, token mapping and upstream update strategy | Real browser card dispatch, fallback, keyboard/focus/dialog composition, Korean content, light/dark and safe navigation checks |
| Operability and evolution | Local release shape, diagnostics, performance budgets, dependency costs, upgrade/rollback and ADR revisit triggers | Measured budgets and recovery/rollback evidence on the supported runtime; no claimed runtime success from document checks |

Every decision explains why the choice fits this local solo product, what was rejected, operational and maintenance costs, failure modes, and how to reverse it. Do not introduce a new package for every folder or a new global store for every feature. An unneeded library may be explicitly rejected; naming a tool in the requirement does not make universal use appropriate.

## Ordered implementation checkpoints

1. **Decision checkpoint:** register ADR-0001 as `design_spec`, obtain independent review and pass the matching handoff. Material deviations update the ADR and affected review before dependent work.
2. **Workspace checkpoint:** under a new reviewed bootstrap plan, resolve the exact supported package/runtime matrix, configure workspace and Nx projects, public exports, import enforcement and a coherent first build. Run negative boundary fixtures; a directory tree alone is insufficient.
3. **State and adapter checkpoint:** implement one vertical flow from bridge snapshot/events through one state projection into assistant-ui and a Tool UI result. Use synthetic fixtures first; verify isolation, reconnect and unknown/approval semantics before extending features.
4. **UI checkpoint:** consume existing tokens and selected primitives, then inspect the actual browser implementation. Figma review does not substitute for keyboard, accessibility, responsive layout or component interoperability evidence.
5. **Release checkpoint:** satisfy the original [verification](verification.md) and [local operation](../operations/local-release-monitoring.md) contracts with versioned evidence. Workspace success alone is not product release readiness.

## Present execution status

This increment creates and reviews architecture decisions and project instructions only. Root workspace manifests, Nx enforcement, a production bundler, state libraries and shadcn components are not installed/configured by this document change. Their concrete setup belongs to the next reviewed bootstrap increment. Existing design tokens, Figma artifacts and the isolated SDK/UI spike remain available and unchanged.
