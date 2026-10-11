# Harness decision-integrity hardening — task plan

Revision: 12 · 2026-09-28 · Status: active · Coordinator: `/root`.

## Confirmed outcome

Harden the reusable Solopreneur harness so confirmed user outcomes and consequential unresolved decisions remain explicit at each stage, implementation handoffs stop when a blocking decision is still open, and reviewers evaluate goal fit and evidence scope before detailed solution correctness. Update `/Users/hyukjaechoi/Solopreneur` as the canonical source first, then synchronize only the active `oh-my-own-code` product copy and verify it has no managed drift. Also update the project's existing local `docs/engineering/plan-template.md`: `solo.py apply` preserves existing templates, and comparison showed this copy was the previous shared template. The product copy's focused integration test remains product-local and independently exercises the copied helper; canonical unit tests live in the reusable source. Apply this harness change before continuing the desktop work. Then follow the already stated remaining-work order: reconcile and independently review current desktop product/design/architecture/verification/operations documents at exact contract-bound hashes; finish the shell comparison/decision; only then start sidecar implementation.

## Confirmed requirements and decisions

- The current user explicitly requires macOS and Windows and an app-owned OpenCode v2 `serve` sidecar. These are confirmed requirements, not assumptions.
- Compare Electron, Tauri 2, and a credible TypeScript-oriented third option before choosing the desktop shell. Existing browser pairing/CORS tests apply only to the browser bridge.
- The prior deviation came from an unresolved platform assumption being treated as selected and detailed reviews failing to challenge solution relevance. The harness change must address those exact failure modes without adding approval steps to already authorized work.
- Keep the coordinator as the only planner/integrator/ledger writer. Specialists use fresh children, path-based handoffs, and the current reviewed plan.
- Do not add an automatic model call or a per-prompt heavy hook. Use local contract validation and focused independent reviews.

## Scope

In scope:

- Add a machine-readable, optional `decision_register` to schema-v2 run contracts with status, source/authority, impact, and blocking phases in canonical `/Users/hyukjaechoi/Solopreneur/scripts/harness.py`; add source-level regression tests and synchronize this canonical behavior into the current product copy at `.solopreneur/harness.py` and its focused tests. Blocking phases are limited to those currently supported by the CLI: `research`, `implementation`, and `review`.
- Define entries as `{id, statement, status, source, impact, blocks, resolution}`. `status` is `open`, `assumption`, `confirmed`, or `delegated`; `blocks` names zero or more of the CLI-supported phases `research`, `implementation`, and `review`. `open` requires at least one blocked phase. `assumption` may proceed only in phases it does not block and records why; if its uncertainty makes a phase unsafe, that phase must be listed. `confirmed` and `delegated` require recorded authority/source and resolution, and cannot retain blockers. A registered unresolved entry blocks every handoff phase it names. Existing contracts may omit the register for v2 compatibility; the checker cannot discover decisions omitted from the register.
- Validate register shape and make both `prepare-handoff` and `dispatch` refuse open or unresolved assumed decisions that block their phase. At dispatch, revalidate the current independently reviewed plan, contract, and phase; reject stale packets and decisions. Include the register in prepared handoffs and re-check the current contract and phase at dispatch. Block messages identify only decision ID, status, and phase, not free-text content.
- Add focused Python tests for valid/invalid entries, every supported phase, open and assumed blockers, confirmed/delegated resolutions, legacy contracts, sensitive-content-safe errors, changed decision state between preparation and dispatch, changed plan text after preparation, and revoked plan approval after re-registration.
- Update canonical `Solopreneur/AGENTS.md`, coordinator/planning/review skills, the plan-reviewer role, engineering plan template, and operator guide to preserve the latest user outcome, distinguish confirmed decisions from assumptions/open questions, compare credible architecture alternatives before consequential platform-specific implementation, and require evidence to match the claimed platform/runtime/security boundary; synchronize managed instruction files into the current product copy.
- Add a bounded reassessment rule: a `NO-RUN`/missing capability or two consecutive non-advancing correction cycles triggers classification of requirements, approach, implementation defect, and tool/access failure before retrying.

Out of scope: changing the OpenCode app implementation, selecting Electron/Tauri/Neutralinojs, changing provider/auth behavior, external network/CI configuration, model pins, hooks that launch model calls, or automatic approval.

## Acceptance criteria

- **H-1:** Contract register entries parse and validate without breaking existing schema-v2 contracts that omit the optional field.
- **H-2:** Preparation and dispatch mechanically block open/consequential unresolved decisions marked for that phase; dispatch also requires the current independent plan pass. Research remains available when not blocked; confirmed or explicitly delegated resolutions unblock dependent work.
- **H-3:** Shared instructions, plan template, reviewer instructions, and agent role require current user-outcome fidelity, decision-state provenance/holds, credible alternatives comparison before consequential runtime/platform implementation, and boundary-matched evidence.
- **H-4:** Tests and code review confirm backward compatibility, accurate blocked reasons, and no external side effects or model-calling hook behavior.

## Ordered work and verification

1. Register this plan and obtain an independent plan review.
2. Implement the gate and a dedicated test suite first in canonical `/Users/hyukjaechoi/Solopreneur/scripts/harness.py` and `/Users/hyukjaechoi/Solopreneur/tests/test_harness_decision_register.py`; update canonical instructions/role/docs there.
3. Run required canonical-source tests and syntax checks. Test-run commands must fail when discovery finds zero tests. Only after these pass, synchronize this one registered product with `python3 /Users/hyukjaechoi/Solopreneur/scripts/solo.py apply /Users/hyukjaechoi/Projects/oh-my-own-code`; inspect conflicts, retain its product-local integration tests, run a zero-tests-fail product-copy check/syntax, and verify `solo.py check` reports no managed-file drift. Do not run `sync-all` across other products.
4. Update the project's existing `docs/engineering/plan-template.md` to match the canonical template, preserving its other sections; record source/product template parity with a required check. Obtain a fresh independent code review of the canonical source, synchronized managed files, and product-local template; resolve findings and rerun affected tests.
5. Inspect and update the desktop run's decision register: mark macOS + Windows and app-owned `serve` sidecar as confirmed from the user; mark shell selection as open and blocking implementation. Re-register and independently re-review that plan.
6. Register all current desktop product/design inputs as exact current artifacts. Obtain product and design-spec reviews and handoffs against these bound hashes. Then compare Electron, Tauri 2, and Neutralinojs; update ADR-0002 with a recommendation, not a selected shell; obtain an independent ADR/architecture review. Present the reviewed comparison and recommendation to the user. Keep `DESKTOP-SHELL` open until the user explicitly chooses.
7. After explicit user selection, record the selected shell with its user authority and resolution. Reconcile every dependent desktop document to that decision, then refresh product/design reviews, contract hashes, and handoffs. Update and re-review `build-delivery` wherever it remains a source of requirements or implementation scope. Request explicit approval of the exact integrated document set before implementation.
8. Only after current documents, approvals, and plans agree, continue desktop implementation with per-OS evidence. The harness gate prevents handoff while the shell decision remains open, but the plan reviewer must still compare the register with current user direction.

## Ownership and assignments

| Role | Ownership |
|---|---|
| Coordinator | This plan/contract, source-to-product synchronization, harness integration, ledger, desktop plan reconciliation |
| Engineer | `/Users/hyukjaechoi/Solopreneur/scripts/harness.py`, `/Users/hyukjaechoi/Solopreneur/tests/test_harness_decision_register.py` |
| Documentation editor | Canonical `/Users/hyukjaechoi/Solopreneur/AGENTS.md`, `.agents/skills/solo-orchestrate/**`, `.agents/skills/solo-plan-review/**`, `.codex/agents/plan_reviewer.toml`, `templates/project/docs/engineering/plan-template.md`, `docs/harness.md`, their managed copies, and the existing `oh-my-own-code/docs/engineering/plan-template.md` |
| Independent reviewer | Read-only review of plan and changed code/docs; owns no edits |

## Open questions and holds

No unresolved user question blocks the harness hardening. The desktop shell choice remains open by explicit instruction and blocks shell-specific implementation. The registered comparison/report is input evidence, not an architecture decision or runtime proof.

## Change history

- **Revision 1:** Create a bounded harness-hardening run after the retrospective. The change is designed to prevent assumption promotion, solution-detail tunnel vision, and evidence reuse across different runtime/security boundaries while keeping research unblocked.
- **Revision 2:** Resolve HDI-01 by defining states and phase blocking, HDI-02 by putting the open shell choice in the desktop run before final document reviews, and HDI-03 by adding preparation-to-dispatch mutation tests. Keep the gate explicitly limited to decisions recorded in the contract.
- **Revision 3:** Resolve HDI-04 by restricting phase values to those supported by `prepare-handoff` (`research`, `implementation`, `review`); release activities use the existing supported implementation/review phases until a dedicated CLI phase is designed and tested.
- **Revision 4:** Promote `/Users/hyukjaechoi/Solopreneur` to the explicit canonical source and add a target-specific sync/clean-drift check. A generated product copy alone is insufficient to prevent recurrence in future projects.
- **Revision 5:** Make canonical source implementation and its dedicated test suite the first change, then target-specific product synchronization. Keep source tests and product-copy integration checks separate, and explicitly exclude bulk `sync-all`.
- **Revision 6:** Add explicit contract-bound canonical-source syntax and target-specific managed-drift checks after the plan reviewer found those validations were described but not contractually executable.
- **Revision 7:** Make both required unittest discovery commands fail closed when discovery returns an empty suite, after the plan reviewer demonstrated that Python's default `discover` exits successfully with zero tests.
- **Revision 8:** Add current plan-review validation at dispatch, regression coverage for stale/revoked plan review across phases, and engineering template guidance for decision states, alternatives analysis, and runtime/OS/security-aligned evidence after independent code review reproduced these gaps.
- **Revision 9:** Name the reusable engineering plan template in the documentation editor's ownership row, matching the already reviewed H-3 scope.
- **Revision 11:** Bind the desktop product/design inputs to exact hashes in this run contract so their independent reviews are required against the same current SSOT before the shell decision is presented.
- **Revision 12:** Correct the order so current product/design reviews and an independent ADR recommendation review precede presenting shell options; the decision register remains open until explicit user selection, followed by post-selection reconciliation and exact-set approval.
- **Revision 10:** Explicitly reconcile the existing product-local engineering template after confirming `solo.py apply` preserves it; add a required source/product template parity check.
