# Run protocol (schema v2)

Classify the work before selecting gates. `major` covers initial new-feature introduction, substantial refactoring, or a change to product scope, architecture, runtime ownership, security boundaries, or data/API contracts. Obtain independent plan review and applicable design-spec review at that initial entry. `routine` covers implementation, fixes, small refactors, test repairs, and input preparation within the existing accepted scope and design. Use concise plan -> edit -> appropriate checks -> separate independent code review -> integrate; do not add plan/design approval rounds for each ordinary change. If routine work crosses a major boundary, record the reason and classify the changed concern as major before dependent work. Do not create a new major classification merely because code or hashes changed. Preserve explicit additional reviews, user approvals, decision blockers, final code-review independence, and required evidence. Records without a work classification retain their historical major policy until an explicit active-run classification; never rewrite terminal records.

The primary coordinator is the sole ledger writer. Run commands from a product root with `python3 .solopreneur/harness.py`; in this toolkit use `python3 scripts/harness.py`. A per-run lock rejects overlapping commands. Every specialist receives the current `docs/runs/<run-id>/plan.md` path and revision/hash, relevant artifacts, owned files, acceptance IDs, authorized scope, and report path. Fresh children receive a bounded handoff, not the primary transcript. Corrections use a new clean child with the prior report by path. `task_name` is a label, not proof of a role, clean context, or runtime settings.

The library config allows up to eight open specialist threads, excluding the primary, as a ceiling. Use the lower of that setting and the active client's actual capacity; configuration edits do not live-update an existing session. In this session on 2026-09-26, the active host reported four total slots; that observation is not a reusable host limit. Dispatch only the independent work needed, with disjoint writer ownership. A completed child can remain open and occupy capacity: preserve its outputs before closing it if the client supports closing, and never assume completion or interruption releases a slot.

## Runtime route

Resolve a logical workflow alias with `route --role ROLE --phase research|implementation|review`. Manifest schema 2 maps aliases to a selected skill/mode and one of two thin native profiles, `solo_worker` or `solo_reader`. Review-phase assignments use the reader even when their execution alias normally writes, as with release or marketing. Profiles load `solo-specialist`; domain procedures live in the selected skill. The `planner` alias selects engineering-plan analysis and returns proposed text to the primary without restarting orchestration.

Use a native profile selector only when the client supports it and creates a fresh child. Otherwise inject the resolved profile and bootstrap instructions into a fresh generic child. Do not request a domain alias as a native agent type or load every workflow. Preserve the client's actual permissions: a read-only instruction is not a sandbox. If no clean route is available, hold that specialist handoff and report the limit.

Schema-2 packets add `routing` with the selected profile/skill/mode, resolved paths and hashes of the registry, profile, bootstrap, skill and explicitly selected reference inputs. Dispatch recomputes this routing and requires `--role-file` to match the selected profile file. A changed input, wrong profile or missing routing binding is rejected before the dispatch record is written. Prepare again after a legitimate input change. Schema-1 registries retain their previous behavior; old records are not rewritten. A packet prepared before a schema-2 registry upgrade must be prepared again, not manually patched.

```sh
python3 scripts/harness.py route --role mobile_engineer --phase implementation
python3 scripts/harness.py route --role release_engineer --phase review
```

Use `.solopreneur/harness.py` for these commands in an applied product. `roles` lists compatible workflow aliases; `.codex/agents/` contains execution profiles only.

Route each unspecified model/effort under [adaptive-routing.md](adaptive-routing.md), preserving exact user choices and explicit inheritance/default instructions. Omitted settings resolve through client defaults and then parent; a model without effort uses its documented default. An unsupported exact user choice needs a supported alternative from the user; under delegation, record the reason for a supported replacement of an unavailable coordinator choice. Record authority and requested route separately from any observation. Role files and coordinator metadata do not attest runtime identity. See the [official subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) (checked 2026-09-26).

## Plan and contract

Use a proportionate SSOT plan with confirmed requirements, decisions, dependency holds, acceptance criteria, ownership, verification, and change history. A small edit needs a compact plan; routine artifact work does not require independent entry plan/design review. Major entry and explicit entry gates do. Product intent remains in `docs/product/` or `docs/specs/`; technical engineering plan/tasks belong in `docs/engineering/`. The run plan links those contracts. Read [planning-contract.md](planning-contract.md) for the minimal plan fields.

`begin RUN --kind KIND --objective TEXT` creates schema v2 with an included-file baseline. `plan RUN --file docs/runs/RUN/plan.md --contract docs/runs/RUN/contract.json` registers both files. The contract has `schema_version: 2`, nonempty `acceptance:[{id,description}]`, and `checks` keyed by stable check IDs. Each check requires exact `argv` (literal string array), project-relative `cwd`, nonempty `scope`, nonempty `acceptance_ids`, and `required` boolean. Optional `documents` entries have `{path,gate,version,sha256}` with gate `product` or `design_spec`; `user_approvals` have `{id,version,target:{path,sha256},evidence:{path,sha256}}`, and evidence files must live under `docs/runs/` so they are excluded from code/source fingerprints; `environment_files` is a list of project-relative paths hashed for check freshness. Never copy private environment content into run records.

Contracts may also contain an optional `decision_register` for consequential choices. Each entry is `{id,statement,status,source,impact,blocks,resolution}`. `status` is `open`, `assumption`, `confirmed`, or `delegated`. `blocks` is drawn from CLI-supported phases `research`, `implementation`, and `review`. An `open` decision must block at least one phase. An `assumption` records why it is safe/reversible for phases it does not block; block any phase where uncertainty makes the work unsafe. `confirmed` and `delegated` decisions require an authority/source and resolution and cannot retain blockers. Contracts that omit the field remain valid. The helper validates shape and enforces blockers, but it cannot discover unregistered decisions or authenticate the source claim; compare the register to current user direction in planning and review.

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
  "environment_files": [],
  "decision_register": []
}
```

Before review, freeze the latest user outcome, linked-plan revisions, document wording/version/hashes, contract decisions/checks, and approval state. One fresh plan reviewer may inspect the focused plan and linked parent together and return separately bound verdicts for each; obtain a separate parent review only when parent-owned scope/decisions/acceptance/checks changed or it is an independent execution plan. After the plan passes, run independent product and design-spec reviews in parallel when both gates apply; architecture is included in design-spec review unless the plan justifies a separate high-risk architecture gate. `review-input RUN --gate plan` supplies the exact binding. The saved JSON report includes `schema_version:2`, that `reviewed` object, `verdict` (`pass`, `changes_requested`, `blocked`), nonempty `summary`, `open_findings` array, and `provenance:{child_task_id,author_task_id}`. `author_task_id` is optional, but cannot equal the reviewer child ID. The coordinator registers the actual report with `review RUN --gate plan --reviewer plan_reviewer --evidence REPORT.json`; optional `--verdict` must agree with report contents. Provenance is coordinator-reported metadata, not identity attestation. Reconcile findings before dependent work and re-review only affected concerns.

## Document readiness and dispatch

Register each binding PRD or design contract under `documents`, then as an artifact with `--type product` or `--type design_spec`. Obtain independent matching review reports using `review-input` and `review`; run independent product/design reviews concurrently after plan pass when both apply. Design-spec review includes architecture and backend API/schema/security/state/error contracts unless a distinct high-risk gate is planned. `handoff RUN --gate product|design_spec` checks the unchanged document subset. A passing document review does not prove implemented UI or code. User approval is tied to the exact document version and local evidence when the workflow calls for it; prior clear user adoption of that version counts. Do not invent an extra approval step.

Before a dependent specialist starts, compare the register with latest user direction, then use `prepare-handoff RUN --role ROLE --phase research|implementation|review --out PACKET.json`. A blocker for that phase prevents preparation. Implementation packets require current declared document reviews and user approvals. Review bindings retain every approval ID, version, and exact target path/hash; only evidence location/hash is normalized. Deleting an approval or substituting its target stales reviews, and evidence plus target are independently validated at preparation and dispatch. Prepared packets and dispatch records retain the raw full contract hash, so any contract edit after packet creation requires a fresh packet. Missing/invalid/stale approval evidence or target drift blocks handoff/dispatch. Plan registration preserves prior reviews/checks only when their exact semantic and source bindings still match; material plan/contract/document/check changes keep the evidence stale. Legacy reports are never rewritten or silently upgraded. Create a fresh child from the packet, resolved profile/bootstrap and selected skill/mode. At dispatch, the helper requires a current recorded plan/contract, plus an independent entry pass only for major or explicitly required plan review, reloads current contract state, verifies the packet still matches it, and reapplies the phase gate. If a decision, plan, or material contract changed or review was revoked, update/review affected concerns, then prepare a fresh packet. `dispatch RUN --role ROLE --packet PACKET.json --child-ref REF --context CONTEXT --role-file PROFILE.toml` records the returned child reference and instruction hashes. For example, an engineer implementation resolves to `.codex/agents/solo_worker.toml`; a review resolves to `.codex/agents/solo_reader.toml`. The helper verifies its packet; it does not intercept raw spawn tools or attest the actual child identity. Specialists never recursively delegate; staffing requests return to the primary. Release is not currently a CLI handoff phase; route release work through supported implementation/review phases until a release phase is added and tested.

## Checks, final reviews, and outcome

`check RUN --name ID [--timeout SECONDS]` executes the contract's exact argv in its cwd. Optional `-- argv...` must match exactly. The ledger records every attempt, exit status, bounded sanitized output, and source/environment fingerprints. A failed attempt stays visible after a later pass. To change command, scope, coverage, or requirement, change the semantic contract and re-register the plan; its changed binding requires a fresh plan review only for major entry or an explicitly required plan gate; routine work updates the recorded plan and continues to independent code review. An approval-only change can retain matching reviews/checks, but always revalidates evidence and target hashes. Select meaningful format/lint/type/unit/integration/browser checks by affected behavior. Manual browser observation is not automated E2E. Do not describe an unrun check, Stop hook, or HTTP access probe as browser E2E.

Register deliverables with `artifact RUN --file PATH [--type general|product|design_spec]`. After fixes and checks, register artifacts and the final outcome; then obtain each required fresh independent final review with its `review-input` binding. Every feature or bugfix requires a code gate, even for a small diff; scale review depth to risk. An implemented UI requires `design_qa` judgment from the running application or accessible captures of that implementation; Figma is reference only. A reviewer returns findings to an implementer and a new independent review follows fixes. A passing final review cannot come from a child recorded as an implementation dispatch. `qa_runner` supplies observations only. Release execution and final release judgment are separate assignments.

`outcome RUN --file OUTCOME.json` registers schema v2 acceptance coverage:

```json
{"schema_version":2,"acceptance":{"AC-1":{"status":"verified","artifacts":["path/to/deliverable"],"checks":["unit"]}},"changed_paths":["path/to/deliverable"],"deleted_paths":[]}
```

Include every contract acceptance ID and exactly cover changes and deletions from the begin/imported baseline. `deferred` needs an `approval_id` from current contract user approvals and does not make unfinished core work a pass. `finish RUN` checks plan, contract, current reviews and checks, artifacts, acceptance coverage, path coverage, and lifecycle state. A ledger pass establishes consistency of recorded evidence, not product correctness, authorization, or reviewer identity. Final review is after all source and evidence changes that affect its binding. Reuse current successful checks when only report files change and their source/environment fingerprint stays current; repeat only affected reviews. A source/environment change requires current affected contracted checks.

## Recovery and historical runs

On compaction or resumption, read the run plan and `status RUN`, reconcile live children and completed artifact paths, then compare current user direction. Do not infer cancellation, completion, or review success from silence or stale records. A capacity failure calls for task-state reconciliation and transport/capability diagnosis before any supported retry; it does not justify a model hop. A blocked active run can use `resume RUN --reason TEXT`. `block`, `cancel`, and `supersede` require `--reason TEXT --evidence FILE`; supersede also requires `--by NEW_RUN`. Terminal records do not reopen. Never mark a stale task complete to clear the queue.

Completed v1 records remain readable and immutable; active or blocked v1 records may use `status` and explicit reason/evidence lifecycle commands, but require migration before execution or finish. `migrate RUN --inventory INVENTORY.json --contract CONTRACT.json` imports a verified original v1 baseline and preserves original reviews/checks/dispatches as `legacy_evidence`. It refuses missing or malformed original inventory, invalid path/type/mode/digest, unsupported symlink aggregates, excluded paths, or a mismatch with the original plan fingerprint. It never substitutes migration-time source files for the original baseline. Migration requires new v2 review/check evidence and does not prove historical chronology.

## Work-class commands

Always choose the work class for a new assignment. A normal fix or implementation step inside an accepted design uses `routine`:

```sh
python3 scripts/harness.py begin ordinary-fix --kind bugfix --work-class routine --objective "Fix the existing behavior within the accepted design"
python3 scripts/harness.py plan ordinary-fix --file docs/runs/ordinary-fix/plan.md --contract docs/runs/ordinary-fix/contract.json
# Prepare/dispatch implementation, run selected checks, then obtain a separate code review.
# No independent plan/design entry pass is needed unless explicitly required.
```

Initial introduction of a new feature or a substantial refactor uses `--work-class major`. Prepare the initial plan reviewer with `--role plan_reviewer --phase review`; that narrow route is available before an entry pass and cannot dispatch implementation. After the initial concern is approved, routine corrections and input preparation may continue with an explicit active-run classification:

```sh
python3 scripts/harness.py classify ordinary-fix --work-class routine --reason "Implementation remains within the accepted scope and unchanged design"
```

In an applied project replace `scripts/harness.py` with `.solopreneur/harness.py`. Omitted classification preserves the historical major behavior; the coordinator selects `routine` explicitly for ordinary work. Classification changes require fresh handoff packets and final-review bindings. A recorded plan/contract, actual checks, explicit approvals and independent code review remain required. An unchanged, previously accepted design can be reused in routine work; a changed design or an explicit additional gate still needs its matching approval. Terminal records remain immutable.

## Reuse checks by declared inputs

By default a check binds the whole source, registered plan and semantic contract. To opt in, add `input_scope` to a named check:

```json
"input_scope": {"paths": ["src/unit", "tools/test-unit.py"], "reason": "Complete source and runner dependencies for this unit check"}
```

Paths are normalized project-relative source files/directories, without wildcards, parent segments, symlinks, secret files or excluded outputs. At least one included regular source file must exist when the check runs. Directory roots include new/deleted files and modes. Declare the full dependency closure, including shared code, nested configuration and fixtures. This is a reviewed declaration, not automatic dependency discovery. If dependencies are uncertain, omit `input_scope` and use the default full check. Toolchain/runtime inputs outside source must be covered by `environment_files` or an explicit integrity check.

Automatic safeguards include all root source files, supported AGENTS.md/AGENTS.override.md names at any depth, .agents/.codex/.solopreneur trees, canonical scripts/harness.py and harness configuration. Scoped attempts also bind exact check specification, referenced acceptance descriptions, classification, environment and other contract dependencies (documents, approvals, decisions). Unrelated check specs and plan wording do not change applicability. A source or environment error after execution persists an invalidated attempt. The latest failure always blocks; older passes cannot replace it. Old unscoped attempts cannot become scoped passes without execution. Re-registration keeps current scoped attempts with their original timestamp/source hash and history.

```sh
python3 scripts/harness.py check-status RUN
```

This read-only command reports each check as reusable, missing, stale or failed, with reasons. Run missing, stale and failed affected checks; retain reusable results without rerunning or relabeling them. Final CODE/RENDER reviews still bind the complete current source, contract and verification evidence. Artifact hashes remain required. A reuse status proves metadata applicability, not dependency completeness or product correctness.

For UI matrices, define independently executable scenario families as separate named checks with complete rendered-product/runner inputs and separate output roots. A runner-only correction can rerun its affected family when the unaffected closure is proven. Source, layout, theme, build or capture machinery changes invalidate affected families. Preserve each reused PNG's original source/runtime/hash/time and give the render reviewer a navigation map with applicability evidence. Never present old pixels as a newly executed capture. A monolithic runner remains one full check until it supports independent families; this feature does not split runners automatically. Do not alter terminal runs to adopt reuse retroactively.
