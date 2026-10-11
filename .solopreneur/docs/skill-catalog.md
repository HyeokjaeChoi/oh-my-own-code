# Workflow skills

Twenty-four domain/coordinator workflows plus one shared specialist entry make 25 skills. `solo-project-start` routes new product/development intake; `solo-orchestrate` coordinates the task. Fresh children enter through `solo-specialist` and load only their assigned workflow/mode. Skills live at `.agents/skills/<name>/SKILL.md`. Two thin native profiles live at `.codex/agents/solo_worker.toml` and `solo_reader.toml`; the 26 existing domain names are logical compatibility aliases. See the [profile and alias catalog](agent-catalog.md).

| Skill | Trigger and deliverable |
|---|---|
| `solo-specialist` | Enter a bounded fresh-child assignment with the supplied plan, selected workflow/mode, ownership and evidence contract; never restart the coordinator |
| `solo-project-start` | Choose an external project directory, route staged idea/development decisions, and require approved PRD plus design resources before development-only coding |
| `solo-orchestrate` | Start/resume a task; plan, assign specialists, integrate evidence, and complete its run |
| `solo-plan-review` | Independently review an entry plan before implementation |
| `solo-evidence-research` | Bounded file/code/web exploration with paths, sources, and uncertainty |
| `solo-product-spec` | Customer problem, product brief, PRD, KPIs, acceptance criteria, and scoped issue slices |
| `solo-product-review` | Independently review a final product brief or PRD and bind the verdict to exact artifact and plan hashes |
| `solo-design-research` | Research user flows and visual references; produce evidence and design implications |
| `solo-design-system` | Define flows, screen states, accessibility, shared tokens, and platform boundaries |
| `solo-design-spec-review` | Independently review design documents, flows, and token contracts before dependent implementation |
| `solo-engineering-plan` | Translate a reviewed spec into architecture, dependencies, risks, and implementation slices |
| `solo-implement` | Implement an owned slice and verify its observable behavior |
| `solo-code-review` | Independently review requirement compliance and code quality with concrete findings |
| `solo-debugging` | Reproduce a failure, test root-cause hypotheses, patch, and verify |
| `solo-tdd` | Use a meaningful RED/GREEN cycle when behavior or regression risk warrants new tests |
| `solo-design-review` | Independently inspect implemented UI with real visual/interaction evidence |
| `solo-qa-run` | Execute an observation-only QA checklist and collect browser/device evidence without issuing a final quality judgment |
| `solo-analytics-instrumentation` | Implement event contracts, identity, consent, deduplication, and delivery checks |
| `solo-analytics-experiment` | Interpret activation, funnels, retention, and experiments with denominators and uncertainty |
| `solo-subscription-check` | Implement/review RevenueCat purchase, entitlement, restore, and lifecycle behavior |
| `solo-aso` | Research positioning and keywords; prepare metadata, localization, and store experiments |
| `solo-store-launch` | Produce localized store screenshot assets from real product captures and an export manifest |
| `solo-marketing` | Create positioning, landing copy, launch content, and measurable growth experiments |
| `solo-release` | Prepare/execute an authorized release with validation, recovery, and observation |
| `solo-monitoring` | Examine release health and Sentry signals; prioritize measured fixes and follow-up work |

The coordinator chooses unspecified specialist settings under the [adaptive-routing reference](../../.agents/skills/solo-orchestrate/references/adaptive-routing.md) and obtains independent plan review; exact user choices and explicit inheritance/default instructions take precedence. `docs/runs/<run-id>/plan.md` remains the execution SSOT: handoffs name its current path and hash/version and reference canonical product or design artifacts without copying their requirements into a competing plan. Run kind `product`, final briefs and PRDs under `docs/product/` or `docs/specs/`, and custom artifacts registered with `--type product` route through `solo-product-review`. Run kind `design-spec`, `docs/design/system.md`, documents under `docs/design/specs/`, and custom artifacts registered with `--type design_spec` route through `solo-design-spec-review`. Each passing report and artifact-scoped handoff precedes dependent implementation. `solo-qa-run` collects specified observations and browser/device evidence only; it cannot issue or satisfy a final gate. Implemented UI still routes separately through `solo-design-review` with actual rendered evidence. Unchanged document subsets retain their reviews; final code/UI judgments bind current implementation and outcome evidence. Small tasks use compact plans; substantive engineering work can add `solo-engineering-plan`. TDD is conditional, with test strategy/judgment in `test_engineer` and approved bounded test coding in `engineer`. No skill fixes a model or effort by role. Route by work and evidence needs. A skill does not supply a browser, device, service login, or OS permission.

```text
$solo-project-start Explore a named idea, prepare a decision one-pager, and continue toward launch through the required approval checkpoints.
$solo-project-start Implement only the backend of this existing project through verified delivery.
$solo-orchestrate Take this feature from brief through implementation and verified preview.
$solo-product-spec Review the first activation flow's goal, KPI, and acceptance criteria.
$solo-product-review Independently review the final activation PRD before it is accepted.
$solo-design-research Compare onboarding patterns relevant to this product's audience.
$solo-design-spec-review Check the onboarding flow and token contract before implementation.
$solo-debugging Reproduce and fix the restore-purchase failure.
$solo-analytics-instrumentation Implement and verify the agreed activation events.
$solo-aso Prepare Korean and English metadata using current store limits.
$solo-monitoring Review the latest release's errors and prioritize the next fix.
```

Each skill has an English name, short trigger description, scoped instructions, and only needed references. Optional `agents/openai.yaml` would be skill UI metadata, not a model-configured runtime agent; it is not required here. Skill discovery across independent repositories is handled by `solo.py apply`, not by assuming parent Git-root inheritance. [Official skill documentation](https://learn.chatgpt.com/docs/build-skills)

## External skill ecosystem policy

The initial six-skill baseline did not inspect these repositories. The current expansion inspected actual instructions, agents, hooks, packaging, and supporting scripts at fixed commits, then wrote condensed Codex-native adaptations. No bundle was installed wholesale.

| Ecosystem | Handoff rule | Implemented adaptation and evidence |
|---|---|---|
| gstack | Adopt useful workflow philosophy | Demand/scope questions, ordered product/design/engineering review, and actual browser/design evidence; [source analysis](research/gstack-matt.md) |
| Matt Pocock skills | Cherry-pick only recurring needs | Product clarification, dependency-aware issue slices, and staged migration guidance; [source analysis](research/gstack-matt.md) |
| ECC / Everything Claude Code | No wholesale install | Scoped exploration, diagnosis/testing/review roles, and compact local context recovery; [source analysis](research/ecc-superpowers.md) |
| Superpowers | Borrow only useful workflows | Reproduce-first debugging, valid RED/GREEN evidence, independent reviews, and evidence before completion; [source analysis](research/ecc-superpowers.md) |
| Spec Kit | Large/complex features only | Requirement-to-task traceability and optional spec/plan/tasks artifacts in engineering planning; [source analysis](research/architecture-speckit.md) |
| Claude-specific assets | Reconstruct for Codex | Native TOML roles, supported command hooks, current skill paths, and the actual callable tool schema |

Vendor telemetry, transcript mining, global config overwrites, universal TDD/coverage, automatic publication, mandatory commits/worktrees, recursive model wrappers, and unsupported hook handlers were not adopted. License and concrete source-path decisions are recorded in the linked analyses.

The [Astra article](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) informs short triggers, selective reading, and evidence-based completion. The user-delegated adaptive-routing policy and exact user precedence preserve independent entry plan review. This is peer review, not repeated user permission for authorized work. Installed specialist platform skills can supplement these workflows without duplicating them or overriding the user's scope.
