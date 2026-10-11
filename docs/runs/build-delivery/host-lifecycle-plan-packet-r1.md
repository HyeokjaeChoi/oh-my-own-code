# Bounded planner handoff: isolated embedded-host probe

- Run: `build-delivery`
- Current SSOT remains `docs/runs/build-delivery/plan.md`, revision 7, SHA-256 `7bcacee7766d65c157a9b1e8b402f9a77e792f6907c89a045b084a62546999d3`.
- Contract SHA-256: `1a5b79ccd693e06ae42c169818e444f63bbaa5eaa3a80f5207f5fd217b838386`.
- Research input: `docs/runs/build-delivery/host-lifecycle-static-research-r1.md`.
- Role: planner via `.codex/agents/planner.toml` / `.agents/skills/solo-orchestrate/SKILL.md`.
- Requested route: `gpt-6-astra/high`, chosen under user's delegated model/effort routing because this is a security-sensitive next-stage plan. Actual runtime identity is not independently attested.

## Task

Prepare a bounded, implementation-ready proposal for a *separate run* to dynamically probe the pinned `@opencode/sdk@2.0.18` embedded host lifecycle. The proposal must preserve the full product run's current plan and continue treating PRD and product scope as SSOT; do not rewrite the current build-delivery plan. Focus only on whether a one-request, in-memory `server.info()` startup/close probe can safely be run in a disposable child. No real session/tool/provider/MCP/workspace/PTY operations.

Inspect the static report and relevant project contracts. State exact outcomes, effects, evidence, package pin, child invocation, environment allowlist, temp roots, database/config options, OS sandbox/egress/process controls, timeouts, cleanup, output redaction, failure stops, required checks/reviews, and what user approval is specifically needed before the real host starts. Distinguish facts, assumptions, and unresolved choices. If OS isolation cannot be proven, recommend staying static/synthetic. Do not execute any SDK code or host. Do not access secrets/user config. Do not edit files. Return a proposal to the coordinator only; primary owns any plan/contract/ledger edits.
