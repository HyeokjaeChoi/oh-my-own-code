# Specialist agents

The primary conversation is the coordinator. The 26 roles are capabilities selected by task outcome, not a batch to launch together. The coordinator routes unspecified specialist model and effort under the [adaptive-routing reference](../../.agents/skills/solo-orchestrate/references/adaptive-routing.md); exact user choices and explicit inheritance/default instructions take precedence. Role TOMLs, the role manifest, and launcher contain no permanent model or effort pins. [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Up to three independent specialists may run beside the coordinator. Use a fresh child and a path-based handoff; `task_name` alone is a label, not proof of role selection or clean context. The coordinator integrates and writes the run ledger.

| Role | Workflow | Assigned outcome |
| --- | --- | --- |
| `planner` | `$solo-orchestrate` | Provide bounded planning analysis when requested by the primary coordinator; never orchestrate a second run. |
| `plan_reviewer` | `$solo-plan-review` | Independently review every entry plan for product fit, design, architecture, and verification gaps. |
| `file_scout` | `$solo-evidence-research` | Find the smallest relevant set of files and symbols for an assigned question. |
| `code_explorer` | `$solo-evidence-research` | Retrieve factual code-path evidence and escalate architectural judgment before changes. |
| `web_researcher` | `$solo-evidence-research` | Retrieve bounded external facts from current primary sources and escalate judgment. |
| `product_research` | `$solo-product-spec` | Assess user problems, demand assumptions, competitors, and a lean validation experiment. |
| `product_manager` | `$solo-product-spec` | Produce product briefs and PRDs with scope, user journeys, KPIs, and acceptance criteria. |
| `product_reviewer` | `$solo-product-review` | Independently review a final product brief or PRD for product coherence, scope, measurable outcomes, and implementation-ready acceptance criteria. |
| `design_researcher` | `$solo-design-research` | Research relevant user flows and visual references with evidence and design implications. |
| `design_architect` | `$solo-design-system` | Define user flows, state specifications, and reusable design tokens for web and mobile. |
| `design_spec_reviewer` | `$solo-design-spec-review` | Independently review UI or backend design contracts for implementation readiness. |
| `design_qa` | `$solo-design-review` | Independently make the final rendered-UI quality judgment from visual evidence. |
| `engineer` | `$solo-implement` | Implement and verify assigned web, backend, shared-contract, or general engineering work. |
| `mobile_engineer` | `$solo-implement` | Implement React Native and Expo behavior with native navigation, lifecycle, and device evidence. |
| `reviewer` | `$solo-code-review` | Independently review completed code for correctness, security, maintainability, and regressions. |
| `bug_analyst` | `$solo-debugging` | Reproduce failures, test competing causes, and identify the smallest defensible fix. |
| `test_engineer` | `$solo-tdd` | Own test strategy and verification judgment; route approved bounded test coding to engineer. |
| `qa_runner` | `$solo-qa-run` | Run specified observation-only QA checklists and collect browser or device evidence without approving final quality gates. |
| `analytics_engineer` | `$solo-analytics-instrumentation` | Implement event contracts and privacy-conscious product instrumentation with delivery checks. |
| `analytics_analyst` | `$solo-analytics-experiment` | Interpret activation, funnels, retention, and experiments with explicit uncertainty. |
| `monetization_engineer` | `$solo-subscription-check` | Implement and verify RevenueCat purchase, entitlement, restore, and subscription state behavior. |
| `aso_specialist` | `$solo-aso` | Prepare evidence-backed store positioning, metadata, localization, and ASO experiments. |
| `marketing_specialist` | `$solo-marketing` | Produce positioning, landing-page copy, launch content, and measurable growth experiments. |
| `store_assets` | `$solo-store-launch` | Prepare real product screenshots and localized store launch assets. |
| `release_engineer` | `$solo-release` | Prepare and execute authorized releases with reproducible validation, rollback, and monitoring. |
| `reliability_engineer` | `$solo-monitoring` | Validate release health, investigate Sentry signals, and prioritize reliability iterations. |

## Routing precedence

Follow the [adaptive-routing reference](../../.agents/skills/solo-orchestrate/references/adaptive-routing.md) for user precedence, economical supported choices, fallback boundaries, and truthful metadata. A named custom role may be selected only when the client creates a fresh child for it. Otherwise inject its role instructions into a fresh generic child with `fork_turns: none` or equivalent clean context. Record authority and requested route separately from any observed runtime; the ledger cannot attest to the model or effort that ran.

## Stage ownership

| Stage | Specialist trigger | Gate and evidence |
| --- | --- | --- |
| Intake and plan | Coordinator; `file_scout` or `code_explorer` for bounded unknowns | Confirm requirements and plan SSOT; independent `plan_reviewer` for artifact work. |
| Product and design contracts | `product_manager` / `design_architect` when the request needs binding contracts | Declare PRD/design versions and approvals in the contract; independent `product_reviewer` / `design_spec_reviewer`, `handoff`, and prepared packet before consuming implementation. |
| Implementation | `engineer`, `mobile_engineer`, or domain executor for a bounded slice | Owned paths, changed behavior, and direct evidence returned to coordinator. |
| Verification | `test_engineer` for risky strategy; `qa_runner` for observation | Selected actual checks with exit codes; manual browser observation is not automated E2E. `qa_runner` cannot satisfy a final gate. |
| Independent judgment | `reviewer`, `design_qa`, or `release_engineer` when required by run kind | Every feature/bugfix needs a risk-scaled code reviewer. UI final judgment needs the running app or accessible implementation captures; Figma is reference only. |
| Completion | Coordinator | Resolve failed/stale/missing required evidence, inspect full request coverage and status, then `finish`. |

Small copy-only changes use a compact plan, a short independent plan review, and the smallest meaningful check. Skip irrelevant lifecycle stages. New requirements, changed contracts, failed checks, stale reports, or unavailable access return to the affected stage and are reported accurately.

## Handoff contract

Each assignment carries the current `docs/runs/<run-id>/plan.md` path and revision/hash, relevant input artifact paths, owned paths, bounded output, acceptance criteria, requested evidence, and user authorization. Workers return concise findings, changed files, exact checks or observations, uncertainty, and next dependency. Corrections start a fresh child referencing the prior report by path. The primary alone persists ledger records and final outcomes.

Read-only roles use read-only sandbox defaults where configured, but live parent permission overrides can propagate. A role file is not a security container. Hooks and ledger records do not prove reviewer identity or external service execution.
