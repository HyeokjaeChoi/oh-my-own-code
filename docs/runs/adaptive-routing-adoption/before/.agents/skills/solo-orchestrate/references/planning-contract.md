# Clarification and task-plan SSOT

Read existing context and answers before asking. Clarify the user outcome, intended users, included/excluded behavior, constraints, acceptance criteria, and dependencies to the level needed for the next execution step. Ask focused follow-ups until consequential uncertainty is resolved by an answer or explicit delegation. Do not require perfect knowledge of future phases. Proceed on settled details and documented delegated choices; never interpret silence as confirmation.

While a blocking question is pending, hold only work that depends on its answer and continue independent research. Record each open question, its impact, and the work it blocks. Do not repeatedly ask about settled preferences or invent a user approval requirement for an already authorized task.

The coordinator creates a schema v2 run, then saves its canonical execution plan at `docs/runs/<run-id>/plan.md` and a `contract.json` with acceptance IDs, exact named checks, relevant document versions, approvals, and environment file paths. A delegated read-only planner returns content for the coordinator to persist. Scale length to the task; include:

- revision/date and status;
- confirmed outcome, requirements, scope/non-goals, and acceptance criteria;
- decisions with their user/context source, delegated choices and rationale, and consequential assumptions;
- unresolved questions and their dependency holds, or an explicit statement that none blocks execution;
- ordered assignments with owned files, inputs, outputs, dependencies, and meaningful verification;
- for iterative work, the first reviewable increment, the uncertainty its feedback resolves, and the failure evidence that would require a different approach; scale this to the task rather than adding a separate ceremony;
- ownership table mapping each role to its owned path globs (advisory, with packet ownership for handoffs);
- canonical product/design/architecture links and required independent reviews;
- change history identifying what changed and why.

This file is the task-plan single source of truth (SSOT). Product requirements and design contracts retain their domain ownership; link them rather than copying an independently maintained execution plan into chat, issues, or architecture documents. Every specialist handoff names the current plan path and revision/hash. On resumption or compaction, recover from that plan and the run ledger, then reconcile new user input.

Current user direction always takes precedence over the saved plan. When requirements, decisions, scope, or sequencing change materially, update the plan, re-register it, and obtain an independent review of changed concerns before dependent work. A changed plan hash invalidates old plan approval and downstream evidence. Keep execution progress in the ledger or a separate outcome record so routine progress updates do not silently rewrite the reviewed contract.

User confirmation means supported answers or delegation already present in the conversation; independent plan review is peer review. Neither requires an extra user sign-off unless a specific unresolved decision or external action actually needs it.
