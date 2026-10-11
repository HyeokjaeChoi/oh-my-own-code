---
name: solo-code-review
description: Review a specified diff or completed change against its requirements and report concrete correctness, security, and regression defects.
---

# Code review

Use a fresh report-only invocation distinct from the implementation author. Return repairs to the coordinator; do not edit code or approve work you authored, even when the same runtime profile is used for both assignments.

Review the requested working-tree diff or exact base-to-head range. Establish the intended behavior from the supplied spec, plan, Issue, or acceptance criteria. If the range is ambiguous, resolve it with read-only Git inspection and state what was reviewed.

Run two distinct passes:

1. **Spec compliance:** map each acceptance criterion to implementation and verification. Flag missing behavior and extra behavior that changes scope.
2. **Code quality:** inspect the changed code in its callers, consumers, tests, and configuration. Prioritize incorrect behavior, trust-boundary or data exposure problems, entitlement/revenue errors, migration hazards, concurrency/state bugs, silent failures, and meaningful missing regression coverage.

For every finding, provide severity, path and line, concrete trigger or state, user/system impact, evidence, and the smallest useful correction. A high-severity finding needs an explainable failure path and must account for nearby guards, types, or framework behavior. Separate confirmed defects from questions. Do not manufacture findings, enforce arbitrary size rules, or report style preferences that do not cause a real problem.

Apply [Finding authority](../solo-orchestrate/references/effort-and-feedback.md#finding-authority) when a finding adds or interprets a requirement, threat model or security boundary.

Treat implementation claims and subagent reports as leads. Inspect the diff and verification evidence independently. Passing tests establish only what those tests exercise; stale, partial, or different-revision results do not prove the reviewed change.

When a result is wrong, distinguish requirement/approach errors from missed edge cases using [the feedback and verification method](../solo-orchestrate/references/effort-and-feedback.md). Check expected outcomes against the contract or independent reference, not only tests written alongside the implementation. Request a reproducer, negative/boundary cases or another relevant check when risk justifies it; do not mandate fuzzing or full-suite repetition for every diff. A higher-effort review without direct evidence cannot establish correctness.

After fixes, re-review the fix diff and affected path rather than repeating every unrelated check. When no actionable defects remain, say so and name important behavior or environments that were not verified. Return the review to the primary agent; a read-only reviewer does not edit the run. The primary agent saves the report under `docs/runs/<run-id>/` and registers it with `python3 .solopreneur/harness.py review <run-id> --gate code --reviewer reviewer --verdict <pass|changes_requested|blocked> --evidence <report-path>`.
