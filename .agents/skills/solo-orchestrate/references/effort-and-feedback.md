# Specification, feedback and verification

Use for feature work, design exploration or repeated failures. This is a local adaptation of [Spending your effort](https://x.com/trq212/article/2103576349499855160), not a Codex benchmark result. Keep the existing plan, authorization, independent review and fresh-child rules.

## Clarify before expanding

Read settled answers and the relevant spec first. Ask about consequential missing behavior, constraints, examples and failure cases until the next increment is actionable. Accept explicit delegated decisions and record assumptions; do not require perfect knowledge of later phases. Put confirmed decisions and observable acceptance in the existing spec and plan SSOT. More compute does not authorize the agent to choose an unresolved business rule.

## Build an increment and inspect intent

Choose the smallest coherent outcome that tests the current idea without discarding necessary security, data or error handling. A sketch can answer a design question; label it a sketch. A production change must meet its contracted checks. Show a useful interaction, diff or artifact at a meaningful feedback point, and check that it addresses the intended problem before expanding it. Continue already authorized work; user feedback is not a mandatory new sign-off on every change. Preserve explicit product/spec/release approval checkpoints.

Iterate within approved scope. If feedback changes a binding requirement, update the spec/plan and refresh the affected review before dependent work. Keep each specialist assignment bounded and fresh; a fast iteration does not require another swarm.

## Diagnose before escalating

### Finding authority

For a blocking review finding, name the violated requirement or show the concrete security/data/correctness failure and its assumptions. A real failure can block even when the specification did not enumerate that attack. Trace user requirements to the user's words or a binding adopted document; keep reviewer interpretations and newly proposed threat models distinct.

When ambiguity changes the security or product boundary, state the competing interpretations and request a bounded independent judgment of that changed concern. Continue independent work. Preserve accepted requirements and unresolved findings until that judgment; neither an author nor a reviewer can silently waive them. A stricter unadopted proposal is not user authorization. Exhausting evidence for an unsupported approach calls for a different approach or a precise blocker, not repeated research or review of unchanged inputs.

Report optional hardening separately when no concrete failure against the adopted boundary is established. Keep confirmed defects, assumptions, proposals and evidence limits visible; this distinction does not require downgrading a demonstrated security failure.

| Evidence | Next response |
| --- | --- |
| Missing or conflicting requirement | Clarify or obtain delegated judgment; hold only dependent work. |
| Wrong interpretation, domain rule or implementation approach | Inspect authoritative evidence and a competing explanation. Correct the approach and affected plan; do not simply rerun the same prompt with more effort. |
| Correct approach with missed edge cases | Strengthen targeted negative/boundary checks and independent verification. |
| Tool, transport or capacity failure | Diagnose the actual environment/capability and retry only with a changed relevant condition. A model upgrade is not a transport repair. |

Verification should seek counterexamples to the claimed behavior. For a bug, exercise the reproducer and demonstrate that its regression check detects the faulty behavior when practical. For risky parsers, security boundaries, numerical/domain rules or state machines, use independent expected results, reference comparisons, adversarial cases or randomized checks where they add evidence. Do not require every technique on ordinary changes. A self-written happy-path test or an unsupported caveat is not evidence that a risk was examined. Preserve actual failures, tested revision, environment and known gaps; refresh only affected evidence. Use the existing independent code/design/product gates.

## Effort is a separate runtime decision

The article's fast-implementation/deeper-verification pattern is useful calibration advice. A clear, bounded task with frequent feedback may need less deliberation than a task with many hidden edge cases. General engineering and autonomous high-risk work differ; neither a role name nor task size alone fixes the right setting.

The coordinator selects unspecified model and effort under the user-delegated adaptive-routing policy; exact user choices and explicit inheritance/default instructions take precedence. Do not auto-apply the article's low/high/max levels or add role/config pins. Record authority, chosen route and any observation separately. An unsupported exact user setting needs a user decision; an unavailable delegated choice may use a supported alternative with its reason recorded. An effort change does not reduce selected verification or grant wider autonomy/permission.

Judge calibration by acceptance failures, useful iterations and actual latency/token/cost evidence when available. Do not claim savings, a universally optimal effort, or cache preservation from these instructions. Claude's effort labels, benchmark results and prompt-cache behavior do not establish Codex behavior. Keep the user's current delegation policy, while honoring task-scoped exact choices and explicit inheritance/default instructions.
