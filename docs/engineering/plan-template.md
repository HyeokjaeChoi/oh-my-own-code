# Engineering plan: change name

Status: Draft

Revision / date:

Canonical task-plan SSOT: `docs/runs/<run-id>/plan.md`. Use this shape there; a durable architecture document links that plan and does not maintain a competing execution plan. Current user direction takes precedence.

Related feature spec / decision / Issue:

## Outcome and scope

- Observable outcome:
- Acceptance criteria source:
- Included / excluded:
- Consequential assumptions or unresolved choices:

## Confirmed decisions and questions

For consequential choices, mirror entries in the run contract's optional `decision_register`; the task plan remains the SSOT for requirements and rationale.

| ID | Requirement or decision | State (`open` / `assumption` / `confirmed` / `delegated`) | Source / authority | Impact | Blocks (`research` / `implementation` / `review`) | Resolution / safe-assumption rationale |
|---|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD |

For consequential platform, desktop-shell, runtime/process, module/build, or security-boundary decisions, compare credible alternatives against explicit requirements. Record criteria, tradeoffs, evidence, reversibility/migration cost, recommendation, and unresolved risks. Do not treat a list of technologies, prototype, or reviewer consensus as a selected decision. Keep dependent implementation blocked until the choice is confirmed or explicitly delegated. Routine changes within an approved architecture do not need a duplicate comparison.

Open questions and work they block, or state that none blocks execution:

Ask focused follow-ups until requirements for the next step are clear. Reuse settled answers; silence is not confirmation. Continue independent discovery while dependent implementation waits.

## Current path and constraints

| Entry point / symbol | Current behavior | Evidence | Constraint or reusable pattern |
|---|---|---|---|
| TBD | TBD | file and symbol | TBD |

## Implementation tasks

| Order | Outcome and owned paths | Inputs / outputs and dependencies | Completion check | Risk / recovery |
|---|---|---|---|---|
| 1 | TBD | TBD | TBD | TBD |

Include data contracts, permissions, migrations, analytics, rollout, or platform differences only when they affect this change.

## Verification

Declare each line as selected, manual, or N-A with reason (one passing check never implies the rest; a human walkthrough is manual coverage, not automated browser E2E):

- Behavior or regression checks:
- Required project checks (format / lint / typecheck / unit / integration / browser E2E):
- Runtime/device/environment observations:
- Evidence-to-claim map: each result, platform/OS, runtime, security boundary, method, and remaining unverified behavior. Do not use browser evidence to claim desktop process ownership, packaging, or OS enforcement.
- Product/design document registration and independent review before dependent implementation, when applicable:
- Actual UI QA after implementation, when applicable:
- Evidence path: `docs/runs/<run-id>/` when this work uses a run record

## Plan review

- Acceptance-criterion mapping checked by:
- Missing, extra, conflicting, or out-of-order work:
- Review status and open findings:

Every handoff names the current plan path and revision/hash. Update and re-register changed requirements, scope, or decisions, then independently review changed concerns before dependent work. Track routine progress in the ledger/outcome record.

## Change history

| Revision / date | Changed requirements or decisions | Reason / source | Affected work and review |
|---|---|---|---|
| TBD | TBD | TBD | TBD |
