# Solopreneur operating harness

Classify the work before selecting gates. `major` covers initial new-feature introduction, substantial refactoring, or a change to product scope, architecture, runtime ownership, security boundaries, or data/API contracts. Obtain independent plan review and applicable design-spec review at that initial entry. `routine` covers implementation, fixes, small refactors, test repairs, and input preparation within the existing accepted scope and design. Use concise plan -> edit -> appropriate checks -> separate independent code review -> integrate; do not add plan/design approval rounds for each ordinary change. If routine work crosses a major boundary, record the reason and classify the changed concern as major before dependent work. Do not create a new major classification merely because code or hashes changed. Preserve explicit additional reviews, user approvals, decision blockers, final code-review independence, and required evidence. Records without a work classification retain their historical major policy until an explicit active-run classification; never rewrite terminal records.

This is an executable, project-local Codex harness for product planning, design, engineering, monetization, launch, and post-release improvement. It combines 25 task-specific skills, two thin execution profiles, independent review, a local evidence ledger, and lifecycle hooks. The coordinator selects only the expertise needed for the task. The 26 logical role names remain compatibility aliases, not native agent definitions.

## Start a product task

From the Solopreneur toolkit:

```sh
python3 scripts/solo.py new my-product --parent /path/to/existing/projects-directory
python3 scripts/solo.py start /path/to/existing/projects-directory/my-product
```

`new` requires an existing parent directory outside the toolkit, creates an independent repository there, and copies the harness. The source stores only a path registry for bulk sync. `start` checks for drift and starts a new Codex session without model or effort CLI overrides; that session uses the user/client selection. Trust the project in Codex to load local agents/skills/config; review the exact hooks in `/hooks`. This launcher does not bypass either trust flow, sandboxing, or command approvals. The main session owns the plan. The `planner` alias selects `solo-engineering-plan` in analysis mode through `solo_reader` for bounded advice; it does not create another orchestrator.

Existing products use `apply` and `sync-all` as described in the toolkit README. In an applied product, native files are `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`, and `.codex/hooks.json`; helper files are `.solopreneur/harness.py` and `.solopreneur/roles.json`. Product artifacts remain under `docs/`, not inside managed configuration.

Every new artifact task begins with a proportionate plan. Factual questions and status checks can receive a brief in-session routing decision. Before review, reconcile and freeze current user choices, parent/focused plan links, document wording/versions/hashes, checks, decisions, and approval state. One fresh plan-review assignment can cover a linked parent and focused plan, with separate bindings, unless parent-owned scope or downstream execution changed enough to warrant a standalone review. Product and design-spec reviews are distinct and can run in parallel after plan pass; architecture is included in design-spec review unless a separate high-risk gate is justified. Do not dispatch reviewers while known cross-document reconciliation remains unfinished.

The planner reads existing answers and asks focused follow-ups until execution-relevant requirements are clear. While blocking questions remain, dependent implementation waits and independent discovery continues. User-delegated choices are documented; silence is not confirmation. The confirmed plan at `docs/runs/<run-id>/plan.md` is the task-plan SSOT: revision, requirements, decisions and sources, scope, criteria, questions/dependencies, assignments, checks, and change history. Current user direction takes precedence; update the plan and independently re-review only major changed concerns or explicitly required entry gates before dependent work. Approval-only ledger changes preserve semantic reviews/checks when all other bindings remain unchanged; current approval evidence and target hashes are still verified at preparation and dispatch, and packets retain the raw contract hash. Material plan, decision, acceptance, check, or document changes invalidate affected evidence. Legacy evidence is never silently upgraded. Every handoff cites the current plan path and revision/hash. Routine progress belongs in the ledger/outcome record. This does not add repeated user approval for already authorized work.

## Decision integrity and scope checks

For consequential choices, keep a `decision_register` in the run contract alongside the plan. Use `open` for unresolved choices, `assumption` for an explicitly bounded reversible choice, `confirmed` for a direct user choice, and `delegated` for a choice the user authorized the coordinator to make. Record a source/authority, impact, resolution (where resolved), and blocked phases. Open decisions must block at least one phase. Assumptions must block any phase where proceeding could commit to the wrong platform, runtime ownership, permission boundary, deliverable or release form. Supported phases are `research`, `implementation`, and `review`; use those labels exactly.

Reconcile the register with the latest user direction before every dependent handoff. The harness checks entry structure, blocks `prepare-handoff`, includes the register in the packet, and requires a current recorded plan plus an unchanged contract/register at `dispatch`; a fresh independent entry pass is required only for major or an explicit plan gate. If the decision or plan changed, or its review was revoked, re-plan/review and prepare a fresh packet. Existing v2 contracts without a register remain valid. This gate can only enforce decisions that were recorded; it cannot infer omissions, authenticate a cited user instruction, or intercept a raw child spawn. Plan reviewers must independently compare current user intent and all consequential choices to the register. New explicit user direction overrides a prior assumption or stale plan. Semantic review bindings preserve approval IDs, versions, and exact target paths/hashes while normalizing only each evidence path/hash. Approval evidence must live under `docs/runs/` to keep it out of source fingerprints. Removing an approval requirement or changing its target therefore stales reviews. Evidence and target hashes are checked separately, and prepared packets bind the full raw contract digest. Refreshing evidence for the same approved target can retain reviews without allowing a stale packet or changed evidence through.

Before detailed architecture review, ask whether the plan solves the latest requested product and execution form. Keep evidence bounded to what it actually observes: browser bridge security does not establish a desktop app-owned sidecar; a source-level check does not establish OS packaging, process cleanup, or installed-runtime behavior. When a tool returns `NO-RUN`, access is missing, or two correction cycles fail to advance the same outcome, classify the problem as requirement uncertainty, wrong approach, implementation defect, or tool/access failure before retrying. Do not repeat an unchanged approach or respond to a capability issue only by raising model effort.

## Role and skill routing

See [agent-catalog.md](agent-catalog.md) for role scopes, stage handoffs, and adaptive routing policy.

| Work | Primary specialists | Outputs and next handoff |
|---|---|---|
| Intake and plan review | planner, plan_reviewer | Outcome, acceptance criteria, risks, owned files, dependencies, reviewed execution plan |
| Web/code/file evidence | web_researcher, code_explorer, file_scout | Factual primary sources or paths/symbols; recommendations and judgment returned to the coordinator |
| Product/PRD | product_research, product_manager, product_reviewer | Demand evidence, smallest release, registered PRD, independent product verdict, dependency-aware slices |
| Design exploration/system | design_researcher, design_architect, design_spec_reviewer | Research brief, registered design/token contracts, independent review before consuming implementation |
| Implementation | engineer, mobile_engineer | Working web/API/mobile changes within assigned paths, including approved bounded test coding |
| Observation QA | qa_runner | Specified checklist execution and browser/device evidence; no fixes or final gate |
| Defects and verification | bug_analyst, test_engineer, reviewer, design_qa | Reproduction, test strategy/judgment, independent code review, and final rendered-UI judgment |
| Analytics and subscriptions | analytics_engineer, analytics_analyst, monetization_engineer | Event contracts, verified delivery, metric interpretation, entitlement lifecycle |
| ASO/marketing | aso_specialist, store_assets, marketing_specialist | Metadata, actual capture/export manifest, landing page/campaign and measured CTA |
| Release and operations | release_engineer, reliability_engineer | Release evidence, rollout/recovery record, error triage, runbook, next improvement |

Parallelize only independent work. The project config permits up to eight open spawned specialists alongside the primary, subject to any lower capacity in the active client. Code writers own disjoint files. Completed children may still occupy slots; preserve results before closing a child if supported, and do not assume completion or interruption frees capacity. A read-only reviewer returns findings; the primary persists them. Review must be a separate invocation from the author, including growth/release review. The primary can request specialist analysis, integrates the plan, and assigns its independent review.

Resolve the logical alias with `route --role ROLE --phase PHASE`. The registry selects a skill/mode and `solo_worker` or `solo_reader`; every review-phase route uses the reader. Both profiles start with `solo-specialist`, then the selected workflow. Use a native profile selector only when the client supports it and creates a clean child. Otherwise inject the resolved profile/bootstrap instructions and bounded handoff into a fresh generic child. Instructions do not enforce a sandbox. Route unspecified model/effort settings under the adaptive-routing reference, preserving exact user choices and explicit inheritance/default instructions. Read `.agents/skills/solo-orchestrate/references/run-protocol.md` from the toolkit or applied product root.

```sh
python3 .solopreneur/harness.py route --role mobile_engineer --phase implementation
python3 .solopreneur/harness.py route --role release_engineer --phase review
```

The first selects `solo-implement` in mobile mode; the second selects `solo-release` through the read-only profile. Schema-2 handoff packets bind the registry, profile, bootstrap, selected skill and explicit references by hash. Dispatch rejects changed inputs, a wrong `--role-file`, or an old packet without routing. Prepare a new packet after an intentional update; do not rewrite historical records. Existing schema-1 installations remain supported.

## Clean specialist contexts

Every specialist assignment starts a separate clean child context. The primary session remains the planner and orchestrator; handoffs use the reviewed plan, selected skill/mode, artifact paths, acceptance criteria, ownership, and evidence instead of copying the primary transcript. Native profiles describe execution defaults; they do not establish observed runtime identity or isolation. `task_name` is only a thread label. Corrections start a new clean child as well.

## Lifecycle

The default product sequence is:

Major initial entry and product lifecycle:

```text
Idea -> brief / PRD -> independent product review -> design research
     -> design system / feature design -> independent design-spec review
     -> engineering plan -> independent plan review -> implementation
     -> tests -> code / design / product review -> analytics verification
     -> authorized release -> reliability / PostHog analysis -> next experiment
```

Routine work: concise plan -> edit -> appropriate checks -> separate independent code review -> integrate.

Use only stages needed for the request. A PRD request ends with a reviewed PRD; a request to build and release continues through the authorized release. Post-release evidence produces a new bounded improvement plan, not an unbounded loop or an automatically purchased growth tool. Spec Kit's larger artifact graph is used only for large/complex features.

## Run records and checks

Before editing or dispatching writers, preserve the assigned ordinary source originals once, or name an immutable Git base with matching baseline hashes. Follow [original-source capture](../../.agents/skills/solo-orchestrate/references/run-protocol.md#plan-and-contract) for the bounded manifest, new-file absence and private-data exclusions. `begin` stores inventory identities, not original file contents; do not reconstruct a review diff from today's source.

Run commands from the product root. For this toolkit use `scripts/harness.py` in place of `.solopreneur/harness.py`. The current ledger is schema v2; see the [complete run protocol](../../.agents/skills/solo-orchestrate/references/run-protocol.md) for contract and report shapes, document readiness, outcome coverage, recovery, and migration.

```sh
python3 .solopreneur/harness.py begin onboarding --kind feature --ui --objective "Implement the agreed onboarding"
# Save docs/runs/onboarding/plan.md and contract.json with acceptance IDs and exact required checks.
python3 .solopreneur/harness.py plan onboarding --file docs/runs/onboarding/plan.md --contract docs/runs/onboarding/contract.json
python3 .solopreneur/harness.py review-input onboarding --gate plan
# Give the binding to a fresh independent plan_reviewer; save its actual JSON report.
python3 .solopreneur/harness.py review onboarding --gate plan --reviewer plan_reviewer --evidence docs/runs/onboarding/plan-review.json
# After implementation, run the exact command registered as the unit check.
python3 .solopreneur/harness.py check onboarding --name unit
python3 .solopreneur/harness.py artifact onboarding --file apps/web/app/onboarding/page.tsx
python3 .solopreneur/harness.py outcome onboarding --file docs/runs/onboarding/outcome.json
python3 .solopreneur/harness.py review-input onboarding --gate code
# Register the actual independent reviewer report, then the design_qa report for implemented UI.
python3 .solopreneur/harness.py review onboarding --gate code --reviewer reviewer --evidence docs/runs/onboarding/code-review.json
python3 .solopreneur/harness.py review-input onboarding --gate design
python3 .solopreneur/harness.py review onboarding --gate design --reviewer design_qa --evidence docs/runs/onboarding/design-review.json
python3 .solopreneur/harness.py status onboarding
python3 .solopreneur/harness.py finish onboarding
```

The command is an example workflow, not evidence that any named report, project path, or check exists. Each review JSON must carry the exact `review-input` binding, verdict, findings, summary, and coordinator-reported child provenance. The contract fixes each check's argv, cwd, scope, acceptance coverage, and required status; changing it requires plan re-registration and review. `check` retains every attempt with bounded sanitized output. `outcome` covers every acceptance ID and the exact changed/deleted path set against the run baseline. At registration, verified check links must be a list of contracted check names that cover that acceptance ID; invalid links are refused before ledger mutation and final reviews. Registration alone does not prove checks executed or passed. Read `status` before requesting final review and resolve non-review gaps first. `finish` rejects stale or missing required evidence, wrong gate, incomplete coverage, and inactive lifecycle state. A successful ledger result proves local consistency, not correctness or reviewer identity.

Product and design documents belong in the contract `documents` list with path, gate, version, and SHA256. Register each as a typed artifact, obtain an independent matching document review, then run `handoff <run-id> --gate product|design_spec` before a consumer starts. The coordinator creates a packet with `prepare-handoff ... --phase implementation --out ...` before spawning, then records the actual child reference with `dispatch ... --packet ... --child-ref ... --context ... --role-file ...`. This checks the decision register, declared document review, and versioned user approvals bound to target and evidence hashes at the recorded dispatch boundary. Raw spawn calls remain outside the helper. Backend-only design resources are reviewed for API/schema/security/state/error contracts; they do not need visual criteria. Implemented UI needs a separate final `design_qa` review of the running app or accessible implementation captures. Figma is a reference only. Every feature or bugfix has an independent code gate, with depth scaled to risk.

On resumption or compaction, read the current plan and `status`, reconcile live children and artifact paths, and compare the latest user direction. `block`, `cancel`, and `supersede` record reason and evidence; only blocked runs may `resume`. Terminal records stay terminal. Completed v1 records remain readable and immutable; active or blocked v1 runs may record explicit lifecycle transitions, but need a verified original inventory and `migrate` before v2 execution or finish. Migration preserves legacy evidence and requires fresh v2 reviews and checks. It does not authenticate old chronology or replace the original baseline with today's source files.

## Hooks

| Event | Behavior |
|---|---|
| SessionStart | Remind the session of the entry workflow and relevant active run paths |
| UserPromptSubmit | Route tasks through the coordinator and adaptive specialist settings with user precedence; keep follow-ups in their active run |
| SessionStart (compact source) | Recover from durable run paths after compaction without mining chat transcripts |
| SubagentStart | Load specialist bootstrap and assigned skill; reinforce bounded scope, evidence handoff, and no recursive delegation |
| Stop | Existing fast whitespace check, active-run reminder, and bounded missing/failed declared-check names |
| Git pre-commit | Check staged whitespace and potentially private filenames |

Lifecycle hooks use only local state and bounded output. They do not run tests, call paid models, read transcripts, contact services, grant approval, or force another turn. Stop reports only missing or nonzero declared required-check names from the active ledger; it does not infer stale fingerprints or launch a heavy check. The run helper is the mechanical completion gate. Hooks remain advisory and require native trust; they are not a complete tool/security boundary.

Hook commands pin the SHA256 of the reviewed helper code and use isolated Python. A nested replacement script or Python module cannot substitute for that trusted helper. After editing helpers in the source, run `python3 scripts/build_hooks.py`, then apply/sync the generated definitions and review changed hook trust. Moved product copies remain portable.

## External source adaptations

The external repositories were inspected at fixed commits, including actual skill instructions, agents, hooks, generation/packaging code, and licenses:

- [gstack and Matt Pocock](research/gstack-matt.md): demand and scope review, ordered plan reviews, context-sized slices, real browser/design evidence.
- [ECC and Superpowers](research/ecc-superpowers.md): read-only exploration, root-cause diagnosis, meaningful RED/GREEN checks, separate requirement/code review, durable evidence.
- [Spec Kit and runtime architecture](research/architecture-speckit.md): conditional spec/plan/task artifacts and verified Codex capabilities.

The implementation uses original, condensed Codex instructions and local Python tooling. Vendor installers, telemetry, model wrappers, global configuration, transcript-learning systems, auto-publication, and unconditional commit/worktree loops were not imported. Packaging was evaluated: native project agents/config plus existing per-project application are the active distribution mechanism. Installing a separate plugin containing duplicate skills/hooks would not improve custom-agent discovery here.

## Activation and scope

The source files and helpers are installed locally; startup trust, hook trust, model availability, and service OAuth remain client/account state. Roles do not set model or effort. The current client validates explicit user choices; no static file or ledger entry proves the runtime model used.

No real product, Figma library, analytics pipeline, store listing, paid subscription, production deployment, or recurring external monitoring job is created merely by installing this harness. Its skills and roles now cover those tasks when supplied with the product context and required access. The fixed MCP presets preserve the handoff's service choices and conditional additions.

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
