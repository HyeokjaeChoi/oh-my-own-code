---
name: solo-engineering-plan
description: Turn an approved feature spec or a substantial engineering request into an implementation plan grounded in the current repository.
---

# Engineering plan

In delegated `analysis` mode (the `planner` alias), return bounded planning analysis and proposed plan text to the primary coordinator. Do not write its plan or ledger, restart intake, dispatch reviewers or create another run. Instructions below to persist a plan or request reviews describe the coordinator's next action in this mode. Read the assigned evidence and return unresolved choices with their dependency impact.

Expand the entry plan when the change crosses components, changes a contract or migration, or needs sequencing. A routine edit keeps the coordinator's compact plan and proceeds without independent plan/design entry review; retain separate independent code review after implementation. Use the feature spec and product decisions as requirements; identify unresolved choices only when they would materially change behavior or scope.

Use the coordinator's [planning contract](../solo-orchestrate/references/planning-contract.md). Ask focused follow-ups until execution-relevant choices are clear, reuse settled answers, and hold dependent implementation while blocking questions remain. Document delegated choices; silence is not confirmation. The confirmed `docs/runs/<run-id>/plan.md` is the task-plan SSOT. Current user direction wins: update and re-review changed concerns before execution; every handoff names the current path and revision/hash. Durable architecture documents supplement this plan rather than compete with it.

Trace the relevant implementation before choosing a design. Start at the user, API, job, or event entry point; follow the data and error paths; inspect nearby working examples, tests, configuration, and platform boundaries. Search broadly enough to learn repository terminology, then narrow to the files and symbols that support the plan. Mark anything inferred rather than observed.

For an active run, write `docs/runs/<run-id>/plan.md` using the project convention or the shape in `docs/engineering/plan-template.md`. Use `docs/engineering/` for a durable architecture or implementation plan only when the project needs it beyond the run. Include:

- revision/date, confirmed outcome and decisions with their source, acceptance criteria, and explicit scope/non-goals;
- current execution path and constraints with file and symbol evidence;
- ordered tasks with owned paths, inputs/outputs, dependencies, and observable completion checks;
- data, permission, migration, analytics, release, and recovery work only when relevant;
- verification chosen for the actual risks, including a regression test when behavior could recur;
- consequential assumptions, unresolved questions with dependency holds, and change history.

Each task should leave the repository in a coherent state and be small enough to implement and review as one unit. Avoid speculative phases, universal coverage targets, made-up commands, or package additions without first checking the repository and maintained alternatives.

For large or complex features only, read [complex-features.md](references/complex-features.md) for the adapted Spec Kit spec/plan/task workflow. Keep the compact entry plan for ordinary work; do not install or assume the stock Spec Kit CLI.

For major entry or an explicitly required plan gate, obtain the independent plan_reviewer pass before implementation: every acceptance criterion maps to a task and check, exclusions stay excluded, dependencies are ordered, and exact file claims exist. Record unresolved findings in the plan; peer review does not replace user authorization for external actions.

At major entry consuming new or materially changed product/design documents, the coordinator also registers them, obtains the matching independent `product_reviewer` or `design_spec_reviewer` pass, and checks `handoff <run-id> --gate product|design_spec` for each relevant gate before dispatch. Use actual gate names in commands. Implemented UI still needs `design_qa` review afterward.

Use the active run for mutating artifact work. The primary agent registers the finished plan and acceptance/check contract with `python3 .solopreneur/harness.py plan <run-id> --file <plan-path> --contract <contract-path>`, for major entry or an explicit plan gate sends it to the `plan_reviewer`, saves that read-only review under the run directory, and registers it with `review <run-id> --gate plan --reviewer plan_reviewer --verdict ... --evidence <review-path>`. Resolve `changes_requested` before implementation. Report the plan path, evidence inspected, and any choice that still blocks work.
