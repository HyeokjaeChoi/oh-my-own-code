# Run protocol (schema v2)

The primary coordinator is the sole ledger writer. Run commands from a product root with `python3 .solopreneur/harness.py`; in this toolkit use `python3 scripts/harness.py`. A per-run lock rejects overlapping commands. Every specialist receives the current `docs/runs/<run-id>/plan.md` path and revision/hash, relevant artifacts, owned files, acceptance IDs, authorized scope, and report path. Fresh children receive a bounded handoff, not the primary transcript. Corrections use a new clean child with the prior report by path. `task_name` is a label, not proof of a role, clean context, or runtime settings.

## Runtime route

Read `.codex/agents/<role>.toml`. The role defines responsibility and instructions; it has no model or effort pin. Use a native named role only when the client creates a separate fresh child; otherwise inject the role instructions into a fresh generic child. If no clean route is available, hold that handoff and report the limit. The primary does not spawn a duplicate planner; the planner profile is for bounded analysis requested by the coordinator.

Route each unspecified model/effort under [adaptive-routing.md](adaptive-routing.md), preserving exact user choices and explicit inheritance/default instructions. Omitted settings resolve through client defaults and then parent; a model without effort uses its documented default. An unsupported exact user choice needs a supported alternative from the user; under delegation, record the reason for a supported replacement of an unavailable coordinator choice. Record authority and requested route separately from any observation. Role files and coordinator metadata do not attest runtime identity. See the [official subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) (checked 2026-09-26).

## Plan and contract

Use a proportionate SSOT plan with confirmed requirements, decisions, dependency holds, acceptance criteria, ownership, verification, and change history. A small edit needs a compact plan; artifact work still gets independent plan review. Product intent remains in `docs/product/` or `docs/specs/`; technical engineering plan/tasks belong in `docs/engineering/`. The run plan links those contracts. Read [planning-contract.md](planning-contract.md) for the minimal plan fields.

`begin RUN --kind KIND --objective TEXT` creates schema v2 with an included-file baseline. `plan RUN --file docs/runs/RUN/plan.md --contract docs/runs/RUN/contract.json` registers both files. The contract has `schema_version: 2`, nonempty `acceptance:[{id,description}]`, and `checks` keyed by stable check IDs. Each check requires exact `argv` (literal string array), project-relative `cwd`, nonempty `scope`, nonempty `acceptance_ids`, and `required` boolean. Optional `documents` entries have `{path,gate,version,sha256}` with gate `product` or `design_spec`; `user_approvals` have `{id,version,target:{path,sha256},evidence:{path,sha256}}`; `environment_files` is a list of project-relative paths hashed for check freshness. Never copy private environment content into run records.

Example shape; select real project commands and paths from the repository:

```json
{
  "schema_version": 2,
  "acceptance": [{"id":"AC-1","description":"The agreed flow works"}],
  "checks": {
    "unit": {"argv":["pnpm","test"],"cwd":".","scope":"Affected flow","acceptance_ids":["AC-1"],"required":true}
  },
  "documents": [],
  "user_approvals": [],
  "environment_files": []
}
```

A fresh independent `plan_reviewer` inspects the current plan and contract. `review-input RUN --gate plan` supplies the exact `reviewed` binding. The saved JSON report includes `schema_version:2`, that `reviewed` object, `verdict` (`pass`, `changes_requested`, `blocked`), nonempty `summary`, `open_findings` array, and `provenance:{child_task_id,author_task_id}`. `author_task_id` is optional, but cannot equal the reviewer child ID. The coordinator registers a real returned report with `review RUN --gate plan --reviewer plan_reviewer --evidence REPORT.json`; optional `--verdict` must agree with report contents. Provenance is coordinator-reported metadata, not identity attestation. Resolve findings; a changed plan or contract needs fresh review before dependent work.

## Document readiness and dispatch

Register each binding PRD or design contract under `documents`, then as an artifact with `--type product` or `--type design_spec`. Obtain independent matching review reports using `review-input` and `review`; the review judges the documents, including backend-only API/schema/security/state/error contracts when applicable. `handoff RUN --gate product|design_spec` checks the unchanged document subset. A passing document review does not prove implemented UI or code. User approval is tied to the exact document version and local evidence when the workflow calls for it; prior clear user adoption of that version counts. Do not invent an extra approval step.

Before a dependent specialist starts, use `prepare-handoff RUN --role ROLE --phase research|implementation|review --out PACKET.json`. Implementation packets require current declared document reviews and user approvals. Then create a fresh child from the packet and role instructions. `dispatch RUN --role ROLE --packet PACKET.json --child-ref REF --context CONTEXT --role-file ROLE.toml` records the returned child reference and instruction hash. The helper verifies its packet; it does not intercept raw spawn tools or attest the actual child identity. Specialists never recursively delegate; staffing requests return to the primary.

## Checks, final reviews, and outcome

`check RUN --name ID [--timeout SECONDS]` executes the contract's exact argv in its cwd. Optional `-- argv...` must match exactly. The ledger records every attempt, exit status, bounded sanitized output, and source/environment fingerprints. A failed attempt stays visible after a later pass. To change command, scope, coverage, or requirement, change the contract, re-register the plan, and obtain a fresh plan review. Select meaningful format/lint/type/unit/integration/browser checks by affected behavior. Manual browser observation is not automated E2E. Do not describe an unrun check, Stop hook, or HTTP access probe as browser E2E.

Register deliverables with `artifact RUN --file PATH [--type general|product|design_spec]`. After fixes and checks, register artifacts and the final outcome; then obtain each required fresh independent final review with its `review-input` binding. Every feature or bugfix requires a code gate, even for a small diff; scale review depth to risk. An implemented UI requires `design_qa` judgment from the running application or accessible captures of that implementation; Figma is reference only. A reviewer returns findings to an implementer and a new independent review follows fixes. A passing final review cannot come from a child recorded as an implementation dispatch. `qa_runner` supplies observations only. Release execution and final release judgment are separate assignments.

`outcome RUN --file OUTCOME.json` registers schema v2 acceptance coverage:

```json
{"schema_version":2,"acceptance":{"AC-1":{"status":"verified","artifacts":["path/to/deliverable"],"checks":["unit"]}},"changed_paths":["path/to/deliverable"],"deleted_paths":[]}
```

Include every contract acceptance ID and exactly cover changes and deletions from the begin/imported baseline. `deferred` needs an `approval_id` from current contract user approvals and does not make unfinished core work a pass. `finish RUN` checks plan, contract, current reviews and checks, artifacts, acceptance coverage, path coverage, and lifecycle state. A ledger pass establishes consistency of recorded evidence, not product correctness, authorization, or reviewer identity. Final review is after all source and evidence changes that affect its binding. Reuse current successful checks when only report files change and their source/environment fingerprint stays current; repeat only affected reviews. A source/environment change requires current affected contracted checks.

## Recovery and historical runs

On compaction or resumption, read the run plan and `status RUN`, reconcile live children and completed artifact paths, then compare current user direction. Do not infer cancellation, completion, or review success from silence or stale records. A capacity failure calls for task-state reconciliation and transport/capability diagnosis before any supported retry; it does not justify a model hop. A blocked active run can use `resume RUN --reason TEXT`. `block`, `cancel`, and `supersede` require `--reason TEXT --evidence FILE`; supersede also requires `--by NEW_RUN`. Terminal records do not reopen. Never mark a stale task complete to clear the queue.

Completed v1 records remain readable and immutable; active or blocked v1 records may use `status` and explicit reason/evidence lifecycle commands, but require migration before execution or finish. `migrate RUN --inventory INVENTORY.json --contract CONTRACT.json` imports a verified original v1 baseline and preserves original reviews/checks/dispatches as `legacy_evidence`. It refuses missing or malformed original inventory, invalid path/type/mode/digest, unsupported symlink aggregates, excluded paths, or a mismatch with the original plan fingerprint. It never substitutes migration-time source files for the original baseline. Migration requires new v2 review/check evidence and does not prove historical chronology.
