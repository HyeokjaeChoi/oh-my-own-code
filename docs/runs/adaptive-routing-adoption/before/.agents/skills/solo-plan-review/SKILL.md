---
name: solo-plan-review
description: Independently review an entry plan for outcome coverage, scope, feasibility, and sufficient verification before execution.
---

# Independent entry plan review

Use an independent `plan_reviewer` inheriting current conversation settings unless the user explicitly requests a supported override. Review the user request, material constraints, relevant product/repository evidence, proposed plan, and intended completion boundary. Do not author the plan being reviewed or restart the full workflow. The coordinator saves this read-only review.

First check whether the plan solves the requested user problem: explicit acceptance criteria, supported assumptions, appropriate release scope, and a feasible smaller alternative where relevant. Then inspect only the affected concerns: user states and accessibility for design; contracts, dependencies, migrations, and failures for engineering; entitlement lifecycle for monetization; evidence and denominators for analytics/growth; artifact, target, recovery, and observation for releases.

Verify the task-plan SSOT at `docs/runs/<run-id>/plan.md`: current revision, confirmed requirements and decisions, source/delegation for consequential assumptions, open questions and dependency holds, and change history. Questions that affect the next implementation step must be answered or explicitly delegated before that work starts; silence is not confirmation. Check current user direction against the document and every handoff's plan path/version. Avoid requiring further user approval for an already authorized, sufficiently clear task.

Each assignment needs an owner, inputs, bounded outputs/files, dependencies, and evidence that can establish completion. Confirm that code/design review is independent of implementation, tests exercise the intended behavior, and the plan distinguishes local preparation from authorized external actions. Identify missing access without turning it into approval for unrelated work.

PRD delivery needs independent `product_reviewer` review. Design documents need `design_spec_reviewer` review before dependent implementation. Require document registration and the corresponding `handoff` check before assigning consumers; preserve separate actual-UI QA and fresh final reviews after implementation/checks.

Return one of `pass`, `changes_requested`, or `blocked`, with concrete findings, impact, and required corrections. A small task needs only a short review. Mark preferences as optional; do not invent blockers to fill a checklist. Revised plans need review of their changed concerns. Record the exact plan path/version and do not reuse a verdict after its scope changes. For the compact micro-change path, confirm the 1–2 file, no-behavior-change criteria; otherwise return `changes_requested`.

The coordinator registers the actual report using the harness `review` command with gate `plan` and reviewer `plan_reviewer`. A model verdict is not user authorization to purchase, publish, communicate externally, or change production data.
