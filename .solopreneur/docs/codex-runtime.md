# Codex runtime and scope

Verified against local Codex CLI 0.154.0 on 2026-09-13. This directory supplies native project configuration. `solo.py` copies it into each independent product repository; do not assume a parent Git root's settings reach another repository.

## Discovery and activation

| Component | Product path | Behavior |
|---|---|---|
| Persistent instructions | `AGENTS.md` | Root-to-current-directory guidance; same-directory override takes precedence |
| Task skills | `.agents/skills/<name>/SKILL.md` | Short metadata first; detailed workflow when selected |
| Project runtime | `.codex/config.toml` | Requires project trust |
| Execution profiles | `.codex/agents/solo_worker.toml`, `solo_reader.toml` | Thin reader/worker defaults and the specialist skill entry |
| Event hooks | `.codex/hooks.json` and `.codex/hooks/` | Exact definitions require separate review/trust in `/hooks` |
| Run helper | `.solopreneur/harness.py` | Local evidence ledger; runs selected check commands |
| Workflow registry | `.solopreneur/roles.json` | Schema-2 source for compatible aliases, selected skills/modes and profiles |
| MCP | Project config's `mcp_servers` entries | Configuration, authentication, and successful execution are separate |

The handoff's example `.codex/skills` path was corrected to `.agents/skills`. Copies make a product checkout independent of the source location. [AGENTS docs](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills)

## Models and invocation

The project has no permanent model or effort pins. The coordinator chooses unspecified specialist settings under the [adaptive-routing reference](../../.agents/skills/solo-orchestrate/references/adaptive-routing.md); exact user choices and explicit inheritance/default instructions take precedence. Omitted settings resolve through client defaults and then parent; a selected model without effort uses its model default. Record authority and requested settings separately from observed runtime. The role TOML or ledger cannot attest runtime identity. [Official subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents), verified 2026-09-26.

Each specialist needs a fresh clean child. Resolve the logical alias with `route --role ROLE --phase PHASE`; a native selector receives the resolved execution profile, not the domain alias. Otherwise inject the profile and `solo-specialist` instructions into a fresh generic child with its plan, selected skill/mode, ownership and evidence requirements. A `task_name` does not prove profile selection or isolation, and injected instructions do not enforce a sandbox. The primary stays coordinator; `planner` selects bounded engineering-plan analysis. `prepare-handoff` checks document/approval readiness and binds routing input hashes. `dispatch` verifies those inputs and the selected profile file before recording the actual child reference. Raw spawn tools remain outside the ledger boundary.

The 26 compatibility aliases are not independent runtime configurations. All review-phase routes use `solo_reader`; release and growth execution can still use `solo_worker`. Historical records remain readable. Packets made before the schema-2 registry upgrade must be prepared again. Domain procedures belong in skills and are not copied into the profile files.

## Hooks and durable work

SessionStart with compact source restores run context after compaction. UserPromptSubmit reminds the primary to plan/review new work and continue active follow-ups. SubagentStart reinforces assigned scope. Stop combines the existing whitespace warning with an active-run reminder. Hook payload/response support is event-specific; the compact recovery path uses SessionStart rather than relying on an unsupported PostCompact additionalContext response. [Hook reference](https://learn.chatgpt.com/docs/hooks)

Lifecycle helpers are read-only, do not read transcripts or prompt bodies, and do not run tests/models or grant approval. Stop never requests blocking continuation. The whitespace helper checks tracked working-tree and staged changes, reports no source text, and skips a non-Git directory. A separate Git pre-commit hook checks staged whitespace and potentially sensitive filenames. Neither replaces product checks.

Commands resolve candidate helpers from project ancestors, verify exact SHA256 bytes pinned in the trusted definition, and use isolated Python before execution. A nested replacement or local module cannot substitute for the reviewed helper. Copy config and scripts together. After changing source helpers, regenerate definitions with `python3 scripts/build_hooks.py`. Native project trust does not imply hook trust; changed definitions require renewed review. Hooks from all sources can run together, so avoid duplicate installations.

The ledger runs on macOS/Linux using Python standard-library file locks. Only one writer per run may execute at a time; overlapping writes report that the run is busy and should be retried. This prevents a long check from losing another record or allowing early completion. Read-only status is a snapshot and can lag an active check. Different run IDs can proceed independently.

`finish` checks required gates, current plan/report/deliverable hashes, recorded exit codes, and relevant input fingerprints. Checks bind to the plan; final reviews bind to registered checks and deliverables. The plan pass rejects input changes since plan registration, and execution records require that pass. This does not prove report truth, reviewer identity, every planned check's selection, or earlier out-of-band edit chronology. Public `.env.example`, `.env.sample`, and `.env.template` inputs are fingerprinted; private env files, run records, editor files, and ignored files are excluded. Git-tracked build outputs are included; non-Git sources skip known build/cache directories. Runtime/service state requires explicit evidence. [Full run protocol](harness.md)

Product and design-document kinds, typed/canonical artifacts, and additive review requirements select independent `product_reviewer` and `design_spec_reviewer` gates. Read-only `handoff` validates the current reviewed plan, passing report, and exact document subset before the coordinator assigns dependent implementation. Code-only edits preserve that checkpoint; final completion still needs fresh global reviews and separate actual-UI QA. Hooks do not intercept all implementation tools. The confirmed task-plan SSOT and clarification policy live in the planner/orchestrator instructions.

## Connections and current-session limits

The project config allows up to eight open specialist threads per session, excluding the primary, but it cannot raise a lower limit enforced by the active client. Use the lower actual capacity; in this session on 2026-09-26, the active host advertised four total slots. That observed value can vary by host and session. Editing this file does not hot-reload an existing session: start a fresh session or reload settings as the client supports, then confirm its effective capacity. A completed child may still occupy an open-thread slot. Preserve its results before closing it if that action is supported; do not assume completion or interruption frees capacity.

The public `openaiDeveloperDocs` MCP is enabled by default at `https://developers.openai.com/mcp`. Seven account-based services remain per-product opt-in. Authenticate only the needed server and verify access with `/mcp`; identifiers may be committed, token values may not. `codex mcp add` ordinarily edits personal settings; this toolkit manages project TOML instead. [MCP setup](mcp.md)

Project config queries before trust may not expose project servers. The initial source probe discovered this project's configuration layer but found it untrusted in persisted user settings. No global trust was changed. Check `/skills`, `/mcp`, and `/hooks` in a fresh trusted product session.

A running conversation may retain its loaded tools/configuration. Creating a role, skill, or plugin file does not inject tools into that conversation. The earlier CLI probe exposed no desktop computer-control tools despite enabled feature flags; tool availability must be checked in the actual current session. See the [computer-use assessment](computer-use.md).

## What was verified

Earlier native parsing and role/config checks were performed against a now-superseded fixed-model configuration. Current structural and ledger validation is reported in the latest run evidence. Neither static configuration nor coordinator metadata proves which model and effort a live child used.

Service OAuth, live device/browser actions, paid model probes, real product builds, release submission, and production monitoring were not performed. These remain work for an actual product with the needed runtime and access.
