# Coordinated domain specifications

Revision: 2 · 2026-09-26 · Coordinator: /root. This is the execution SSOT.

## Confirmed requirements and authority
The user explicitly replied "승인" to PRD v0.2, SHA256 597e64d100ea67b878762fde160b3a6d5c2f1275662661094dadfe0dad270dfb. Its independent product pass and product handoff are in docs/runs/prd-expansion/. Preserve those bytes and completed run. Approval now authorizes coordinated domain-spec drafting; the prior explicit workflow requires approval of the integrated spec set before dependent design production or coding. Preserve all F-01–18 scope, personal learning/real-project workbench purpose, OpenCode new v2 generation and assistant-ui + tool-ui. Vendor-specific features and authentication UI remain excluded. No monetization/growth/ASO work for this personal local product.

## Decisions, assumptions, and holds
Use local-browser delivery as the PRD's provisional design baseline, not an independently confirmed native packaging choice. Isolate native-shell differences and hold platform-dependent production until the user chooses packaging. Figma connection is user-reported; no verified file or design system exists yet (docs/design/system.md is a scaffold). Design tooling and visual values are chosen after spec approval. Specs may define interaction/token contracts now without fabricating a Figma read or exact approved palette. Default stack preferences are proposals, not mandatory cloud integrations. Do not add Supabase, Sentry, PostHog, accounts, packages, application code, paid tools, or telemetry. Record local-only diagnostics and personal-use metrics.

SDK research in docs/research/workbench-expansion.md is dated documentation evidence, not runtime validation. Draft precise app contracts and explicitly mark app-owned IDs/endpoints versus native SDK capabilities. Pin package versions and resolve compatibility, worktree destination/setup, fresh children, permission transition enforcement and recovery through named pre-implementation spikes; no invented API. Documents can be approved as contracts with those explicit dependency holds, not as runtime proof.

## Shared integration vocabulary
Distinguish project, workspace/worktree, session, run, child delegation, tool call, permission request/policy revision, artifact and command. Stable app IDs are not SDK IDs; retain an explicit mapping. Use per-workspace mutation coordination, request correlation and idempotency where side effects exist. UI state reflects authoritative execution state, not optimistic success. Policy transitions and deletion must account for pending approvals, active descendants and processes. Main coordinator integrates cross-document invariants; authors must flag conflicts rather than silently edit sibling documents.

## Assignments and ownership
| Owner | Work and exact paths | Requested route |
| --- | --- | --- |
| Root | Approval receipt, plan/contract/ledger; docs/engineering/spec-index.md integration and traceability | Current session |
| plan_reviewer | Read-only independent plan check before authors start | Sol/medium |
| design_architect | docs/design/specs/workbench-ux.md: IA, journeys, states, accessible interactions, assistant-ui/tool-ui boundaries, semantic token contract and visual-tool dependency | Sol/medium |
| engineer using solo-engineering-plan | docs/engineering/workbench-architecture.md: execution/data/API/event/state/security contracts, ownership, app adapters, compatibility spikes and ordered vertical slices | Sol/high |
| One test_engineer child (also adopts reliability_engineer instructions; sole writer of both files) | docs/engineering/verification.md and docs/operations/local-release-monitoring.md: acceptance/risk matrix, synthetic fixtures, planned lint/unit/E2E/hook integration, release/rollback, local diagnostics and personal metrics | Sol/medium |
| design_spec_reviewer | Fresh independent review of all five integrated documents; separate plan_reviewer verdict for final exact-hash contract binding | Sol/high |

Routes use the user's standing cost-aware delegation, not permanent role pins. Fresh children receive this plan revision/hash and bounded input paths, no transcript and no recursive delegation. Run only as many independent authors as active capacity permits; capacity failure changes scheduling, not model tier. Root retains integration work alongside authors. Reviewer does not repair its own findings; fixes receive fresh independent review.

## Sequence and feedback
1. Record exact PRD approval receipt; obtain independent entry-plan pass and verify original product handoff.
2. Prepare role packets and assign three non-overlapping author tasks in parallel where capacity allows. Authors read approved PRD, this plan, current evidence and relevant role/skill. No package installs, runtime tests, Figma writes or product implementation.
3. Root reconciles shared state/error/event contracts, all 18 acceptance IDs, scope and unresolved decisions. Produce integrated index v0.1 linking four domain documents with hashes and a dependency/approval list. First feedback point is this integrated set; evidence of conflicting domain contracts or unsupported runtime assumptions requires correction before completion.
4. Declare exact five document hashes in contract, obtain fresh plan-binding review, register documents/outcome, then independent design_spec review. Source/contract fixes refresh affected bindings. No redundant product re-review for unchanged approved PRD.
5. Run static link/hash/coverage checks and report actual results. Finish documentation run only after required independent passes; present integrated set for explicit user approval. Spec approval does not bypass runtime spikes or future implementation verification.

## Acceptance and verification
AC-1: Exact PRD approval receipt and unchanged PRD plus prior review/handoff evidence.
AC-2: UX spec covers approved journeys, states, accessibility and both UI libraries with visual/tool uncertainty clearly bounded.
AC-3: Engineering spec defines consistent data/state/API/security/error contracts and named evidence-based compatibility holds; no unsupported native API claim.
AC-4: Every PRD AC-01–18 maps to meaningful planned tests and release evidence; operations and metrics are local, private and personal-purpose appropriate.
AC-5: Versioned index reconciles all documents, ownership, dependencies and open decisions; static local links/hashes/ID coverage pass; fresh independent spec review passes before next approval.

No app tests exist for this stage and none are to be run. Static document integrity checks do not prove permission enforcement, browser UI, SDK compatibility or Figma access. Required runtime validation belongs to subsequent approved implementation/spike runs.

## Change history
2026-09-26 revision 1: start approved PRD's domain specification phase. No requirements changed; preserve prior completed records.

Revision 2: entry review requested unambiguous verification/operations ownership. One combined specialist child is the sole writer of both documents; there remain exactly three parallel author assignments. No scope change.
