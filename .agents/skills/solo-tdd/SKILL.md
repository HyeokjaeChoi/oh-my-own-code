---
name: solo-tdd
description: Use behavior-focused red-green-refactor for a requested change when a regression test provides durable value.
---

# Test-driven development

In assigned `strategy` mode (`test_engineer`), define the behavior, test boundary, independently derived expectations and evidence needed for acceptance. Return the test-coding handoff to the coordinator instead of executing the implementation steps below. Own only assigned strategy, reports and fixtures; scoped test coding uses `solo-implement`. In other modes, follow the requested RED/GREEN workflow within the supplied ownership.

Use this workflow when the user asks for TDD or when changing a bug-prone domain rule, state transition, parser, authorization boundary, stable API contract, or other behavior where a regression would matter. Do not force it onto prose, generated files, low-impact configuration, exploratory spikes, or trivial wiring; use proportionate verification there.

Define one observable behavior and name the realistic production break its test will catch. `test_engineer` owns this strategy and verification judgment. When the plan approves bounded test implementation, hand the coding slice to `engineer` under `solo-implement`, while retaining the independently chosen behavior and acceptance criteria here. Derive expected values independently from the code under test. Prefer real behavior and boundaries; mock only the slow or external layer after understanding the real side effects. A test that asserts source text, a framework's own behavior, or a mock's existence does not protect the product.

Use the project's actual test runner and conventions:

1. Add the smallest test or reproducer for the behavior.
2. Run that exact target. A valid red result executes the intended path and fails because behavior is missing or wrong, not because of syntax, setup, dependency, or unrelated failures.
3. Implement the smallest correction that satisfies the behavior.
4. Rerun the same target and confirm it passes, then run affected regression checks.
5. Refactor only while the behavior remains green.

Do not impose a global coverage percentage, require unit/integration/E2E tests for every change, create ceremony-only evidence files, or commit after each color. Existing code written before the task does not need deletion. When testability is poor, first look for a user-visible or contract boundary; change architecture only when the requested scope supports it.

For an active mutating run, give the coordinator the exact RED/GREEN commands to execute through `python3 .solopreneur/harness.py check <run-id> --name <test-name>`. Record the test identity, expected RED failure, exact revision/environment, and known gaps under `docs/runs/<run-id>/`. A nonzero RED check is expected evidence, not a completed gate. After implementation, the coordinator reruns GREEN under the same check name so the current record reflects the fixed inputs and successful result. Never claim a regression test is meaningful unless its red state was observed or otherwise demonstrated against the faulty behavior. Declare format/lint/typecheck/unit/integration/E2E per plan as selected, manual, or N-A with reason; do not let one passing unit check imply the rest.
