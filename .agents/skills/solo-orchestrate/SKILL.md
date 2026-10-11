---
name: solo-orchestrate
description: Coordinate a product task through selected skills, fresh workers and verified handoffs.
---

# Product workflow coordinator

Use this skill in the primary conversation. Delegated specialists read `solo-specialist` and their selected workflow instead. The primary owns planning, orchestration, integration and ledger writes; it does not create a duplicate orchestrator.

## Choose the next outcome

Classify the work before selecting gates. `major` covers initial new-feature introduction, substantial refactoring, or a change to product scope, architecture, runtime ownership, security boundaries, or data/API contracts. Obtain independent plan review and applicable design-spec review at that initial entry. `routine` covers implementation, fixes, small refactors, test repairs, and input preparation within the existing accepted scope and design. Use concise plan -> edit -> appropriate checks -> separate independent code review -> integrate; do not add plan/design approval rounds for each ordinary change. If routine work crosses a major boundary, record the reason and classify the changed concern as major before dependent work. Do not create a new major classification merely because code or hashes changed. Preserve explicit additional reviews, user approvals, decision blockers, final code-review independence, and required evidence. Records without a work classification retain their historical major policy until an explicit active-run classification; never rewrite terminal records.

Read the request, relevant product facts and existing answers. A factual question or status request needs a brief routing decision. Follow-ups to the same outcome resume its run. New product/development intake begins with `solo-project-start`; do not repeat completed intake for a bounded assignment.

Clarify consequential unknowns needed for the next step. Preserve user decisions and documented delegation; silence is not confirmation. Hold dependent work while continuing independent discovery. For artifact work, read [planning-contract.md](references/planning-contract.md), save the plan SSOT and contract, and obtain independent `solo-plan-review` through a fresh reader only for major entry or an explicitly required plan gate. Reconcile current intent, linked plans, document versions, decision blockers, approvals and selected checks before review.

## Compose skills and profiles

Select expertise from the workflow catalog and resolve its logical alias with `harness.py route --role ROLE --phase PHASE`. The registry supplies a skill/mode and either `solo_worker` or `solo_reader`; every review-phase assignment uses the reader. Names such as `mobile_engineer` or `design_qa` are workflow aliases, not native agent types. Bounded planning analysis uses `solo-engineering-plan` in analysis mode.

Read [run-protocol.md](references/run-protocol.md) for commands and record shapes. In the library use `python3 scripts/harness.py`; in an applied project use `python3 .solopreneur/harness.py`. Prepare the handoff before dispatch. Its routing hashes bind the registry, profile, specialist bootstrap, selected skill and explicit references. Supply the packet, current plan path/revision, bounded outcome, owned files, acceptance criteria and evidence requirements. Children read only their selected workflow and needed references.

Create a fresh child using `fork_turns: none` or the client's actual clean-context equivalent. Use a native profile selector only when supported; otherwise inject the resolved profile and bootstrap instructions into a fresh generic child. A task label does not select a profile, and injected instructions do not enforce a sandbox. Record the returned child reference through `dispatch`, with the resolved profile path in `--role-file`. If a clean route is unavailable, report that capability limit rather than claiming isolation. Never substitute the primary transcript for a bounded handoff.

Follow [adaptive-routing.md](references/adaptive-routing.md) for authorized economical choices and exact user precedence. Metadata is not runtime identity attestation. Order dependent steps and keep writer ownership disjoint. Use only needed workers, within eight open specialist threads or the client's lower capacity. Completion/interruption may not release a slot; preserve results before supported closure. Diagnose transport/capacity failures before retrying. Children request staffing from the primary.

## Verify and integrate

Use the lifecycle only as needed: idea → brief/PRD → design research/system → engineering plan → implementation → checks and independent review → instrumentation → authorized release → monitoring/analytics → iteration. A bounded request stops at its outcome; a full-cycle request continues through its authorized endpoint.

Final PRDs need `solo-product-review`; new or materially changed UI/backend design contracts need `solo-design-spec-review` at major entry. Routine consumers of accepted contracts do not repeat these approvals. Register documents and check matching handoffs. After plan pass, applicable product/design-spec reviews can run concurrently. Architecture normally belongs to design-spec review. One reviewer can examine linked parent/focused plans with distinct bindings; avoid duplicate reviews without a changed concern.

`solo-evidence-research` gathers file/code/web facts and returns unassigned judgments to the coordinator. `solo-qa-run` collects specified observations and cannot approve final gates. `solo-design-review` judges the running implementation or accessible captures; Figma is reference only. Every feature/bugfix needs independent `solo-code-review`. Release execution and final release judgment use distinct fresh invocations even with the same skill. Reviewers return fixes to implementers and never approve their own repairs.

For substantive work or repeated failures, read [effort-and-feedback.md](references/effort-and-feedback.md): deliver a bounded increment, inspect intended behavior and classify requirement, approach, implementation or tool failures before retrying. Complete affected contracted checks. Register artifacts and acceptance coverage, freeze relevant evidence, obtain independent final verdicts, then `finish`. Use `check-status` to retain applicable checks with reviewed `input_scope`; rerun missing, stale or failed checks. Unscoped checks retain full-source freshness. Do not repeat unaffected checks for a runner-only fix. For UI reuse, require independently executable scenario families and original capture provenance as specified in the run protocol; monolithic runners remain full checks. Final CODE/RENDER bindings remain whole-source. Do not manufacture passes or create a perpetual test loop.

On resumption, read the plan and `status`, reconcile children and artifact paths, and compare current user direction. Preserve historical records. Report concrete results and external dependencies without confusing preparation, configuration or review with successful execution.
