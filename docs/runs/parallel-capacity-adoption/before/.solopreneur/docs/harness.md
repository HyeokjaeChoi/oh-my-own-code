# Solopreneur operating harness

This is an executable, project-local Codex harness for product planning, design, engineering, monetization, launch, and post-release improvement. It combines named native agents, task-specific skills, independent review, a local evidence ledger, and lifecycle hooks. The coordinator selects a few specialists per task; the catalog is not a command to run everyone.

## Start a product task

From the Solopreneur toolkit:

```sh
python3 scripts/solo.py new my-product --parent /path/to/existing/projects-directory
python3 scripts/solo.py start /path/to/existing/projects-directory/my-product
```

`new` requires an existing parent directory outside the toolkit, creates an independent repository there, and copies the harness. The source stores only a path registry for bulk sync. `start` checks for drift and starts a new Codex session without model or effort CLI overrides; that session uses the user/client selection. Trust the project in Codex to load local agents/skills/config; review the exact hooks in `/hooks`. This launcher does not bypass either trust flow, sandboxing, or command approvals. The main session acts as planner. The custom planner profile is used only for bounded analysis requested by the coordinator; it does not create another orchestrator.

Existing products use `apply` and `sync-all` as described in the toolkit README. In an applied product, native files are `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`, and `.codex/hooks.json`; helper files are `.solopreneur/harness.py` and `.solopreneur/roles.json`. Product artifacts remain under `docs/`, not inside managed configuration.

Every new artifact task begins with a proportionate plan. Factual questions and status checks can receive a brief in-session routing decision. Work changing artifacts uses a run and an independent plan review, including small edits with a compact plan. Follow-up messages continue the same objective unless the user changes it.

The planner reads existing answers and asks focused follow-ups until execution-relevant requirements are clear. While blocking questions remain, dependent implementation waits and independent discovery continues. User-delegated choices are documented; silence is not confirmation. The confirmed plan at `docs/runs/<run-id>/plan.md` is the task-plan SSOT: revision, requirements, decisions and sources, scope, criteria, questions/dependencies, assignments, checks, and change history. Current user direction takes precedence; update and independently re-review changed concerns before dependent work. Every handoff cites the current plan path and revision/hash. Routine progress belongs in the ledger/outcome record. This does not add repeated user approval for already authorized work.

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

Parallelize only independent work. Up to three spawned specialists may run alongside the primary. Code writers own disjoint files. A read-only reviewer returns findings; the primary persists them. Review must be a separate invocation from the author, including growth/release review. The planner can request specialist analysis before the plan reviewer integrates the final plan.

Use named custom agents only when the callable client creates a separate clean specialist context. Some collaboration tools expose model/effort but no custom-role selector; read the chosen TOML and pass its instructions, authorization, plan SSOT, and bounded task to a fresh child instead. Route unspecified settings under the adaptive-routing reference, preserving exact user choices and explicit inheritance/default instructions. Every specialist is a clean-context worker and the primary remains the sole orchestrator and ledger writer. Never pretend that a `task_name` alone selects a role or that a named role automatically means a clean context. Read `.agents/skills/solo-orchestrate/references/run-protocol.md` from the toolkit or applied product root.

## Clean specialist contexts

Every specialist assignment starts a separate clean child context. The primary session remains the planner and orchestrator; handoffs use the reviewed plan, artifact paths, acceptance criteria, ownership, and evidence instead of copying the primary transcript. A named role is acceptable only when the client creates that clean child. Otherwise inject the role instructions into a fresh child and route unspecified settings under the adaptive-routing reference. `task_name` is only a thread label. Corrections start a new clean child as well.

## Lifecycle

The default product sequence is:

```text
Idea -> brief / PRD -> independent product review -> design research
     -> design system / feature design -> independent design-spec review
     -> engineering plan -> independent plan review -> implementation
     -> tests -> code / design / product review -> analytics verification
     -> authorized release -> reliability / PostHog analysis -> next experiment
```

Use only stages needed for the request. A PRD request ends with a reviewed PRD; a request to build and release continues through the authorized release. Post-release evidence produces a new bounded improvement plan, not an unbounded loop or an automatically purchased growth tool. Spec Kit's larger artifact graph is used only for large/complex features.

## Run records and checks

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

The command is an example workflow, not evidence that any named report, project path, or check exists. Each review JSON must carry the exact `review-input` binding, verdict, findings, summary, and coordinator-reported child provenance. The contract fixes each check's argv, cwd, scope, acceptance coverage, and required status; changing it requires plan re-registration and review. `check` retains every attempt with bounded sanitized output. `outcome` covers every acceptance ID and the exact changed/deleted path set against the run baseline. `finish` rejects stale or missing required evidence, wrong gate, incomplete coverage, and inactive lifecycle state. A successful ledger result proves local consistency, not correctness or reviewer identity.

Product and design documents belong in the contract `documents` list with path, gate, version, and SHA256. Register each as a typed artifact, obtain an independent matching document review, then run `handoff <run-id> --gate product|design_spec` before a consumer starts. The coordinator creates a packet with `prepare-handoff ... --phase implementation --out ...` before spawning, then records the actual child reference with `dispatch ... --packet ... --child-ref ... --context ... --role-file ...`. This checks the declared document review and versioned user approvals bound to target and evidence hashes at the recorded dispatch boundary. Raw spawn calls remain outside the helper. Backend-only design resources are reviewed for API/schema/security/state/error contracts; they do not need visual criteria. Implemented UI needs a separate final `design_qa` review of the running app or accessible implementation captures. Figma is a reference only. Every feature or bugfix has an independent code gate, with depth scaled to risk.

On resumption or compaction, read the current plan and `status`, reconcile live children and artifact paths, and compare the latest user direction. `block`, `cancel`, and `supersede` record reason and evidence; only blocked runs may `resume`. Terminal records stay terminal. Completed v1 records remain readable and immutable; active or blocked v1 runs may record explicit lifecycle transitions, but need a verified original inventory and `migrate` before v2 execution or finish. Migration preserves legacy evidence and requires fresh v2 reviews and checks. It does not authenticate old chronology or replace the original baseline with today's source files.

## Hooks

| Event | Behavior |
|---|---|
| SessionStart | Remind the session of the entry workflow and relevant active run paths |
| UserPromptSubmit | Route tasks through the coordinator and adaptive specialist settings with user precedence; keep follow-ups in their active run |
| SessionStart (compact source) | Recover from durable run paths after compaction without mining chat transcripts |
| SubagentStart | Reinforce bounded scope, evidence handoff, and no recursive delegation |
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
