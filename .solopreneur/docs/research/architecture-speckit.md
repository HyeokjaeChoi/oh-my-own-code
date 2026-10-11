# Codex harness architecture and Spec Kit source review

Checked: 2026-09-13. This report records inspected sources, architecture decisions, and limits. It does not establish account authentication, paid model execution, hook trust, or remote deployment.

> Historical source review (2026-09-13): fixed model and effort recommendations below are superseded by the current [runtime policy](../codex-runtime.md), which follows the current user-delegated [adaptive-routing policy](../../../.agents/skills/solo-orchestrate/references/adaptive-routing.md). Treat old tier references as provenance, not executable guidance.

## Inputs and product scope

The complete `Downloads/handoff (1).md` was read, together with the existing Solopreneur `AGENTS.md`, `.codex/config.toml`, three prior role files, hook definitions, `scripts/solo.py`, and `docs/codex-runtime.md`. The previous toolkit provided useful shared guidance, portable project copies, three roles, and an advisory whitespace hook. It inherited the primary model and did not establish a required entry plan, independent plan review, domain-wide role routing, or durable execution evidence.

The handoff's actual operating scope is broader than engineering: product/PRD, research, user flows, design systems, web/mobile/backend, validation, analytics, subscriptions, launch assets, ASO, marketing, release, monitoring, and iteration. Preserve its lean stack: repository product documents; GitHub Projects/Issues/PRs for execution; Figma and repository tokens; Next.js, React Native/Expo, Hono, Supabase, pnpm/Turborepo; PostHog, Sentry, RevenueCat; optional AppLaunchFlow and licensed AppView assets when available. No external accounts, subscriptions, or overlapping services are required to configure the harness.

## Model and agent evidence

The official Astra API page lists reasoning through `max`. The current Codex subagent documentation explicitly includes `model_reasoning_effort = "ultra"` where supported. The local `~/.codex/models_cache.json`, fetched `2026-09-13T05:57:57.827800Z` for Codex `0.154.0`, lists `ultra` for `gpt-6-astra`, `gpt-5.6-sol`, and `gpt-5.6-terra`; Luna ends at `max`. Its Ultra description combines maximum reasoning with automatic delegation. The current session's collaboration tool also lists Astra Ultra. Therefore persist Astra/Ultra in the primary, planner, and independent plan reviewer; do not use the API page alone to incorrectly downgrade a supported Codex setting. API requests must use their own documented schema. [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Native parse verification also passed: Codex 0.154.0 app-server was started with `--strict-config`, CLI overrides for Astra and `ultra`, and received only `initialize`, `initialized`, and `config/read` requests. The response retained `model = "gpt-6-astra"` and `model_reasoning_effort = "ultra"`. No model turn or config/trust write endpoint was invoked. The runtime required its normal SQLite initialization outside the filesystem sandbox.

The native role schema uses standalone `.codex/agents/*.toml` files with required `name`, `description`, and `developer_instructions`. Explicit `model` and `model_reasoning_effort` in a role file override resolved spawn defaults. A thread's `task_name` is not necessarily a role selector. Where the exposed spawn tool lacks a selector, read the role and explicitly inject its instructions and chosen model/effort into a fresh or bounded-context child; record this fallback. Full-history forks may disallow model overrides. The configured concurrency cap excludes the primary, so `3` means three specialists plus their coordinator. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

The implemented role surface and derived manifest are `docs/agent-catalog.md`, `.codex/agents/*.toml`, and `harness/roles.json`. There are 23 narrow roles covering the requested lifecycle. Expensive independent code/design reviews are selectively Astra; most specialist execution is Sol, and simple file discovery is Luna. All role model/effort choices are explicit. Defining a role does not prove that the current conversation loaded or executed it.

## Recommended execution architecture

1. At every new task, the primary Astra/Ultra establishes the objective and a proportional entry plan. Short tasks get short artifacts; planning and independent plan review still occur.
2. Read only the evidence needed for that plan. Bounded file, code, or web research can run in parallel with useful primary work. Avoid loading every role, workflow, or research archive.
3. The independent Astra/Ultra plan reviewer assesses the same request, acceptance criteria, constraints, and evidence. Resolve consequential findings before implementation. This is a specialist review, not a new user permission checkpoint.
4. Dispatch selected domain roles with an outcome, input artifacts, assigned files, dependencies, evidence expectations, and next handoff. The primary owns integration; concurrent writers must have disjoint file ownership.
5. Run appropriate verification and independent delivery reviews. Code changes route to `reviewer`; UI changes route to `design_qa` with actual visual evidence; analytics, growth, subscription, and release work include their corresponding evidence. Distinguish a design or code inspection from running a browser, device, purchase, or service query.
6. Prepare and execute authorized release work, then hand measured release health and product behavior into a concrete next iteration. Respect existing user authorization and prepare reviewable artifacts before a genuinely missing external-action approval.
7. Store compact run state, current plan, role assignments, review evidence, check commands/results, deliverables, and unresolved limits. Commands must reject stale or missing required evidence before marking a run complete. Model-selected actions and local ledgers remain auditable workflow records, not cryptographic identity or truth attestations.

A task handoff should name: run ID, user outcome, accepted plan version, source artifacts, owned paths, required inputs/dependencies, acceptance criteria, verification commands or observations, and recipient. A result should name delivered behavior, exact paths, performed checks, findings, assumptions, and remaining work. Persist the distilled result, not an unbounded transcript.

## Hooks: supported behavior and exact boundaries

Official release documentation supports `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`, and `SessionEnd`. Command and MCP-tool handlers execute; prompt/agent handler types are parsed but skipped. A hook cannot summon a planner merely by declaring an agent handler. [Hooks](https://learn.chatgpt.com/docs/hooks).

Proposed event responsibilities are small and deterministic: SessionStart restores the current run pointer; UserPromptSubmit reminds the primary of entry planning and distinguishes steering from a new objective; SubagentStart supplies bounded handoff context; PostToolUse records concise evidence metadata where useful; Stop inspects completeness and returns advisory gaps; interruption/end can checkpoint quickly. A single script should perform ordered checks because separate matching handlers may start concurrently.

Project hooks load next to an active trusted `.codex` layer. Plugin hooks use a manifest declaration or default `hooks/hooks.json`; they are added alongside project/user hooks rather than replacing them. Non-managed hooks require separate review/trust of their exact definition in `/hooks`, including plugin hooks. Installing or enabling a plugin does not grant hook trust. No bypass flags or global trust writes are needed for this toolkit.

PreToolUse covers Bash/unified exec, apply_patch, MCP, and most local function tools; hosted tools and some specialized paths can opt out. Sending input through an already approved `write_stdin` session does not get a fresh PreToolUse check. SubagentStart cannot stop spawning via `continue:false`; PostToolUse cannot undo a completed mutation. Stop `decision:block` causes a continuation prompt, so any future continuation mechanism must avoid reinitializing intake and must honor `stop_hook_active`. Advisory Stop checks avoid that recursion. Roles, hooks, and the run ledger are workflow controls within the user's permissions, not complete isolation or prevention of all actions.

## Spec Kit provenance

Canonical upstream: `https://github.com/github/spec-kit`.

Read-only source checkout: `/private/tmp/solo-harness-research/spec-kit`.

Inspected commit: `d848fb4e18f44640ad6b42e60a280551ee90cdce`, committed `2026-09-11T21:40:58-05:00`, subject `feat: add artifact-owned contribution lookup (#4550)`.

License: MIT, copyright GitHub, Inc. The inspected license requires retaining its notice in copies or substantial portions. This implementation uses independently written adaptations and source citations, not a vendored source bundle. Retain the MIT license if substantial templates or scripts are copied later. [Pinned license](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/LICENSE).

## Actual source findings

| Inspected source | Behavior verified | Solopreneur adaptation |
| --- | --- | --- |
| `src/specify_cli/integrations/codex/__init__.py` | Codex defaults to `.agents/skills/speckit-<name>/SKILL.md`; skills mode defaults true; noninteractive execution builds a `codex exec` argument list. It maps six lifecycle events into inline TOML. | Existing native skills layout is correct. Do not wholesale install it or duplicate its event declarations alongside local hooks. |
| `templates/spec-template.md` | Prioritized user journeys, independent acceptance scenarios, functional IDs, entities, measurable outcomes, and assumptions. | Borrow requirement IDs and acceptance traceability for complex features; keep product evidence and business hypotheses distinct. |
| `templates/plan-template.md` and `templates/commands/plan.md` | Explicit technical context, research decisions, constitution checks, data model, contracts, quickstart, and justified complexity. | Expand only artifacts needed for a cross-platform, data-heavy, risky, or ambiguous feature. Use the existing project's actual structure and constraints. |
| `templates/tasks-template.md` and `templates/commands/tasks.md` | Tasks have IDs, story labels, file paths, dependency ordering, and parallel markers for independent files. The source makes new tests conditional on the feature spec. | Preserve IDs, dependencies, ownership, and vertical slices. Apply this harness's risk-based testing requirements rather than blindly omitting necessary regression tests. |
| `templates/commands/clarify.md` | Focused ambiguity classification and integration of answers into the spec. | Resolve consequential missing information and document routine supported assumptions; do not import unnecessary one-question-at-a-time approval rituals. |
| `templates/commands/analyze.md` | Read-only consistency, ambiguity, constraint, and coverage analysis across spec/plan/tasks before implementation; requirements map to tasks; post-launch KPIs are excluded from buildable requirements. | Independent plan review checks coverage and conflicts without becoming the plan author. Runtime results still require separate verification. |
| `templates/commands/converge.md` | After implementation, inspect present code against intent and append traceable remaining tasks; preserve prior task IDs; leave the task file unchanged when no gaps exist. | Use scoped convergence for complex features, then resolve findings and verify. A convergence claim is an assessment, not proof of execution or measured business results. |
| `templates/commands/implement.md` | Treat requirements-quality checklist markers as review state, not completion of implementation; prerequisite scanning and sequential/parallel task execution are distinct. | Keep review verdicts, task completion, test results, and release state separate in the ledger. Honor existing authorization when adapting upstream prompts. |
| `scripts/python/check_prerequisites.py` | Produces deterministic path and available-document JSON; checks required spec/plan/tasks presence with options. | Use deterministic presence/schema/hash checks in the local harness; they validate structure and freshness, not semantic truth. |

Pinned source links: [Codex integration](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/src/specify_cli/integrations/codex/__init__.py), [spec template](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/templates/spec-template.md), [planning](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/templates/commands/plan.md), [task format](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/templates/tasks-template.md), [analysis](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/templates/commands/analyze.md), [convergence](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/templates/commands/converge.md), [prerequisites](https://github.com/github/spec-kit/blob/d848fb4e18f44640ad6b42e60a280551ee90cdce/scripts/python/check_prerequisites.py).

## Adoption decision

Use a locally adapted Spec Kit workflow only for large or complex features: intertwined web/mobile/API changes, significant state/data modeling, migration or entitlement risk, unclear external contracts, or work that needs several dependent slices. The primary planner selects that expansion and the independent plan reviewer checks it. A short task still receives the universal entry plan/review without a full Spec Kit document set.

For complex work, keep one source of truth under the project's feature documentation: `spec.md`, `plan.md`, `tasks.md`, plus research/data-model/contracts only when necessary. Map each important acceptance criterion to a task, owner, and evidence. Stock Spec Kit expects its own feature-path conventions, so the local adaptation must not claim its CLI scripts can run unchanged against an arbitrary `docs/specs` layout. Do not add its extension/bundle ecosystem, automatically create GitHub issues, or install its CLI as part of this harness configuration. These add operations and dependencies without being needed to satisfy the user's request.
