# Product workspace

Independent product repository with the Solopreneur Codex harness: 26 model-agnostic specialist roles, 23 focused workflow skills, lifecycle reminders, and a local evidence ledger. Record the customer, problem, and first platform in [docs/product/brief.md](docs/product/brief.md). A newly generated workspace contains no runnable app packages yet.

- Product docs: [docs/README.md](docs/README.md)
- Shared instructions: [AGENTS.md](AGENTS.md)
- Workflow and run ledger: [.solopreneur/docs/harness.md](.solopreneur/docs/harness.md)
- Specialist roles: [.solopreneur/docs/agent-catalog.md](.solopreneur/docs/agent-catalog.md)
- Workflow skills: [.solopreneur/docs/skill-catalog.md](.solopreneur/docs/skill-catalog.md)
- Preferred stack and boundaries: [.solopreneur/docs/stack.md](.solopreneur/docs/stack.md)
- Pinned source adaptations: [.solopreneur/docs/research/gstack-matt.md](.solopreneur/docs/research/gstack-matt.md), [.solopreneur/docs/research/ecc-superpowers.md](.solopreneur/docs/research/ecc-superpowers.md), and [.solopreneur/docs/research/architecture-speckit.md](.solopreneur/docs/research/architecture-speckit.md)

Trust this repository in Codex, then start a fresh session so its project configuration, roles, and skills load. The primary coordinator and fresh specialists use the current conversation model and effort unless the user explicitly requests a supported override; role files do not pin either setting. Check connections with `/mcp` and review the exact event hooks with `/hooks`. Project trust, hook trust, model availability, service authentication, and successful tool execution are separate states.

Every task that changes an artifact uses a run under `docs/runs/<run-id>/`. The planner records a proportional plan, receives an independent plan review, assigns only relevant specialists, and registers actual checks and deliverables through `.solopreneur/harness.py`. Status questions and pure explanations can use a brief in-session route. See the [run protocol](.solopreneur/docs/harness.md#run-records-and-checks); do not treat an empty ledger or generated template as completed evidence.

The planner asks focused follow-ups until execution-relevant requirements are clear and keeps confirmed decisions in `docs/runs/<run-id>/plan.md`, the task-plan SSOT. PRDs require independent `product_reviewer` review; design documents require `design_spec_reviewer` review before consuming implementation, followed by separate actual-UI `design_qa` review. New user direction updates the plan and affected reviews; existing authorization does not require repeated approval.

After creating the app, record actual install, development, build, test, and validation commands here and outside the managed section of `AGENTS.md`. Product intent remains in `docs/`; GitHub Issues, Projects, and PRs track execution.

After cloning on another computer, enable the included Git hooks with `git config --local core.hooksPath .solopreneur/hooks`. Integrate any existing hooks before replacing their configuration. Configure Codex trust and OAuth on that computer too.
