# ECC and Superpowers: source-level adaptation for the Solopreneur Codex harness

Verified 2026-09-13. This review used local, non-executed clones of the canonical repositories and the immutable commits below. No downloaded installer, hook, script, package, or plugin was executed.

> Historical source review: its role and skill counts and fixed-model references describe the 2026-09-13 expansion, not the current harness. The current harness has 26 roles and 24 skills with no permanent model/effort pins. Unspecified specialist settings follow the user-delegated [adaptive-routing policy](../../../.agents/skills/solo-orchestrate/references/adaptive-routing.md); this report is historical provenance only.

| Project | Canonical source and reviewed revision | License | Codex surface at that revision |
|---|---|---|---|
| Everything Claude Code (ECC) | [`affaan-m/everything-claude-code` at `8321021c54d670126ce3b2969d5deb880b4b0c2a`](https://github.com/affaan-m/everything-claude-code/tree/8321021c54d670126ce3b2969d5deb880b4b0c2a) | [MIT, Affaan Mustafa](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/LICENSE) | Native plugin manifest exposes the root skills, MCP configuration, and a Codex hook projection. |
| Superpowers | [`obra/superpowers` at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`](https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797) | [MIT, Jesse Vincent](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/LICENSE) | Native Codex plugin exposes its skills. Its manifest has an empty hooks object. |

The repositories are useful as pattern libraries, not installation candidates for this workspace. The handoff explicitly prohibits installing ECC wholesale and says to borrow only selected Superpowers workflow elements. The initial baseline had six product skills, three Codex roles, an advisory Stop hook, a Git pre-commit check, and a copy/update manager. The 2026-09-13 expansion had 20 skills, 23 fixed-model roles, five lifecycle events, and an evidence ledger; those counts and routing are historical. Importing either bundle would add overlapping policy and a much larger activation surface.

## What the source actually provides

### ECC

ECC is a large cross-harness distribution. Its [Codex plugin README](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/.codex-plugin/README.md) says the plugin includes 281 skills, an MCP default, and reviewed native hooks. The [plugin manifest](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/.codex-plugin/plugin.json) points Codex at the full root `skills/` directory, `.mcp.json`, and `hooks/codex-hooks.json`.

The native hook projection is much smaller than ECC's Claude lifecycle. [`hooks/codex-hooks.json`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/hooks/codex-hooks.json) contains one synchronous `SessionStart` command. ECC's human-readable [memory lifecycle contract](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/hooks/memory-persistence/README.md) also describes Claude-oriented `PreCompact`, `PreToolUse`, `PostToolUse`, `SessionEnd`, and blocking Stop behavior. Those are not in the native Codex projection. The corresponding session scripts parse Claude transcript fields and `CLAUDE_*` environment variables; for example, [`pre-compact.js`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/scripts/hooks/pre-compact.js) and [`session-end.js`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/scripts/hooks/session-end.js). They are design references, not portable Codex hooks.

ECC does contain several strong, separable mechanisms:

- Its minimal Codex [`explorer.toml`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/.codex/agents/explorer.toml) makes evidence gathering read-only, asks for execution-path and symbol citations, and forbids unsolicited fixes. The fuller [code explorer prompt](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/agents/code-explorer.md) traces entry points, calls, async boundaries, transformations, errors, architecture layers, and dependencies.
- [`iterative-retrieval`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/iterative-retrieval/SKILL.md) starts with broad terms, evaluates relevance and gaps, then refines queries for up to three passes. The numeric scoring and minimum file count are illustrative; the useful invariant is progressive search based on repository terminology.
- [`search-first`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/search-first/SKILL.md) checks the repository before inventing a helper and compares maintained external options by fit, maintenance, license, and dependency cost. This matches the handoff's preference for a small stack when applied only to dependency or integration choices.
- The Codex [`reviewer.toml`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/.codex/agents/reviewer.toml) separates review from implementation. The expanded [reviewer prompt](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/agents/code-reviewer.md) requires a line, concrete failure mode, surrounding context, and defensible severity, and accepts zero findings.
- [`tdd-workflow`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/tdd-workflow/SKILL.md) contains a valuable valid-RED rule: the test must execute the intended path and fail because behavior is absent or wrong, rather than because setup, syntax, or dependencies are broken. It also insists that reported command results be factual.
- [`strategic-compact`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/strategic-compact/SKILL.md) correctly treats files as the durable recovery layer and recommends recording a plan before a phase transition. Its Claude-specific token thresholds and `/compact` hook are not needed here.
- [`agent-harness-construction`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/agent-harness-construction/SKILL.md) argues for narrow actions, deterministic observations, safe retry hints, explicit stop conditions, and large guidance loaded on demand. These principles support this project's skill and run-record architecture.

ECC also demonstrates why selective adaptation matters. Its [sample Codex configuration](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/.codex/config.toml) adds notifications, multiple network-started MCP servers, a `yolo` profile, and six subagent threads. That is a product-specific example, not a safe project default. It also conflicts with the same revision's plugin README, which says the previous default connector set was retired in favor of Chrome DevTools. The [`delivery-gate`](https://github.com/affaan-m/everything-claude-code/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/skills/delivery-gate/SKILL.md) can block completion because several learning files were not touched that day, which rewards file churn rather than product evidence. The verification skill uses hard-coded Node/Python commands and fixed coverage expectations. None should be imported as-is.

### Superpowers

Superpowers is smaller and more coherent: its [README workflow](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/README.md) routes work through brainstorming, worktrees, plans, per-task agents, strict TDD, review, and branch finishing. Its strongest ideas are in individual skills rather than in adopting that entire sequence.

The Codex distinction is important. The [Codex plugin manifest](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/.codex-plugin/plugin.json) exposes `./skills/` and declares `"hooks": {}`. The [Codex packaging script](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/scripts/package-codex-plugin.sh) explicitly excludes top-level hooks, tests, docs, scripts, and instruction files from the official package. Superpowers has a Claude [`SessionStart` hook](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/hooks/session-start), while the Codex artifact is skill-only. Its [porting guide](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/docs/porting-to-a-new-harness.md) describes mandatory bootstrap injection as a cross-harness invariant, but the current native Codex package does not ship that hook. The repository should therefore be read as evidence of Codex skill support, not evidence that Claude session lifecycle behavior transfers to Codex.

The most useful source mechanisms are:

- [`test-driven-development`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/test-driven-development/SKILL.md) requires observing a failure for the intended reason before implementation and keeping the production change minimal. Its [good-test reference](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/test-driven-development/writing-good-tests.md) adds a better filter: name the realistic production break the test catches, derive expectations independently, and test real behavior rather than source text or mocks.
- [`systematic-debugging`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/SKILL.md) moves from reproducible evidence to comparison with a working pattern, one falsifiable hypothesis, one minimal experiment, and a root-cause fix. Its [`root-cause-tracing`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/root-cause-tracing.md) reference traces bad state backward through callers. [`condition-based-waiting`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/systematic-debugging/condition-based-waiting.md) replaces guessed sleeps with a bounded observable condition.
- [`verification-before-completion`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/verification-before-completion/SKILL.md) maps each claim to its proving command, requires reading the exit status and output, distinguishes tests/build/requirements, and independently checks an agent report.
- [`requesting-code-review`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/requesting-code-review/SKILL.md) gives a reviewer an exact base/head range and requirements rather than the controller's entire conversation.
- [`subagent-driven-development`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/subagent-driven-development/SKILL.md) separates specification compliance from code-quality review, passes tasks and diffs as files, forbids nested reviewer duplication, and persists a per-plan ledger so compaction cannot cause completed tasks to be dispatched again.
- The [Codex tool mapping](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/using-superpowers/references/codex-tools.md) favors isolated subagent context, resuming the same implementer for correction, long event-driven waits when idle, and read-only Git checks before worktree actions. Tool details change; the useful principles are bounded context and preserving agent continuity during a fix loop.

The main exclusions are equally clear. [`using-superpowers`](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/using-superpowers/SKILL.md) forces a skill check before every response, even simple questions. The TDD skill requires TDD for every behavior change, asks for permission for exceptions, and says to delete code written before a test. The full subagent workflow requires worktrees, commits, per-task reviews, ledgers, and multiple fix-review rounds. These constraints conflict with the Solopreneur guidance to match process to risk, avoid asking again for already authorized work, and keep simple changes simple.

## Adopted Codex design

The adapted harness uses source-derived mechanisms but freshly authored project instructions. It does not copy either bundle or depend on their scripts.

| Need | Codex mechanism | Adaptation |
|---|---|---|
| File and code search | Read-only `code_explorer` role plus planner/engineer instructions | Trace an entry point through calls, data, and errors; cite files and symbols; broaden and refine `rg` searches based on discovered terminology. No fix proposals unless requested. |
| Engineering planning | `solo-engineering-plan` plus `planner` and read-only `plan_reviewer` | Ground tasks in the current code, map acceptance criteria to tasks and checks, then run a distinct plan-compliance gate for substantial work. |
| Implementation | `solo-implement` plus scoped engineering roles | Implement one coherent unit, inspect current patterns, choose tests by risk, and keep review independent for consequential changes. |
| TDD | `solo-tdd` plus `test_engineer` when useful | Apply valid RED/GREEN evidence to durable behavior and regressions. No universal coverage quota, forced test taxonomy, per-color commits, or deletion of pre-existing work. |
| Debugging | `solo-debugging` plus read-only `bug_analyst` | Reproduce, trace root cause, compare a working path, test one hypothesis at a time, then verify the original symptom. Reassess after repeated failed fixes. |
| Code review | `solo-code-review` plus read-only `reviewer` | Run spec-compliance and code-quality passes with exact diff scope; report only concrete, actionable defects and accept a clean review. |
| Analytics implementation | `solo-analytics-instrumentation` plus `analytics_engineer` | Define trigger, emitter, identity, payload, deduplication, privacy, and provider-delivery evidence separately from analytics interpretation. |
| Reliability | `solo-monitoring` plus `reliability_engineer` | Tie a small set of Sentry/health signals to user impact and a focused runbook; distinguish SDK call, ingestion, alert, and recovery evidence. |
| Completion evidence | `.solopreneur/harness.py` and `docs/runs/<run-id>/` | Record the objective, plan, artifacts, exact commands and exit status, independent gate evidence, revision, environment, and unverified claims. |
| Compaction continuity | Run record on disk | Treat the active run, plan, artifacts, checks, and review gates as the recovery map. Re-read status after compaction or session restart instead of reconstructing progress from memory. |

The run protocol gives “evidence before completion” a deterministic implementation:

```text
begin RUN with kind and objective
  -> register plan
  -> independent plan gate when required
  -> implement artifacts
  -> execute checks through the run recorder
  -> independent domain/code/release gate when required
  -> inspect status
  -> finish only when required evidence is present
```

The concrete CLI is:

```bash
python3 .solopreneur/harness.py begin SLUG --kind feature|bugfix|design|analysis|growth|release|research|docs --objective '...'
python3 .solopreneur/harness.py plan RUN --file docs/runs/RUN/plan.md
python3 .solopreneur/harness.py check RUN --name NAME -- COMMAND ARG...
python3 .solopreneur/harness.py artifact RUN --file PATH
python3 .solopreneur/harness.py review RUN --gate plan|code|design|analysis|growth|release --reviewer ROLE --verdict pass|changes_requested|blocked --evidence docs/runs/RUN/REVIEW.md
python3 .solopreneur/harness.py status RUN
python3 .solopreneur/harness.py finish RUN
```

The primary agent owns run mutations. Read-only reviewers return reports; the primary saves and registers them. A failed RED test is valid diagnostic evidence but never a passing completion check. Any implementation after a passing check makes that check stale when the changed files can affect its claim.

## Hooks and safe automation

Keep the existing advisory Codex Stop hook that runs `git diff --check`. It is deterministic, local, fast, does not print code, and does not pretend to prove the feature. Keep the Git pre-commit check for staged whitespace and suspicious secret filenames. Those two hooks cover cheap mechanical mistakes at appropriate lifecycle points.

Do not port ECC's transcript observation, LLM session summaries, daily learning-file gate, console-log scan, auto-format, package-install, or full-suite Stop hooks. They increase latency, process private transcript/tool data, can mutate files unexpectedly, or make every turn pay for checks unrelated to the diff. Do not port Superpowers' Claude bootstrap hook; its own Codex package excludes it.

For continuity, prefer the run ledger over transcript parsing. A small, reviewed `SessionStart` helper may later print the active run ID and bounded `harness.py status` output if Codex's stable hook input and project trust support it. It should read local state only, have a short timeout, reveal no source or secrets, and remain advisory. Compaction itself needs no custom hook because the essential state is already in `docs/runs/<run-id>/`.

Hooks should never create a run, mark a check passing, approve a review, install a dependency, commit, push, deploy, or alter provider state. Those actions need task context; the harness CLI and agent workflow provide it.

## Adoption and exclusion decisions

| Source element | Decision | Reason |
|---|---|---|
| ECC native plugin / all 281 skills | Exclude | Large overlapping trigger surface; handoff prohibits wholesale installation. |
| Superpowers native plugin / mandatory workflow | Exclude | Forces planning/TDD/review ceremony onto trivial work and duplicates local skills. |
| Read-only explorer | Adapt | Saves main-agent context and yields source-backed execution paths without implementation bias. |
| Progressive retrieval | Adapt into role instructions | Useful search behavior; a separate skill and numeric relevance scores add ceremony. |
| Search before adding dependencies | Adapt into planning/implementation | Prevents reinvention and subscription/dependency bloat without searching the web for every edit. |
| Valid RED/GREEN proof and good-test filter | Adapt into `solo-tdd` | Protects risky behavior while preserving proportionate test selection. |
| Fixed 80% coverage and unit+integration+E2E for every change | Exclude | Coverage is not uniform proof and creates low-value tests for a solo founder. |
| TDD checkpoint commits / delete code written first | Exclude | Commits are external workflow state; deletion can destroy valid user work and does not improve a recovered task. |
| Root-cause, one-hypothesis debugging | Adapt into `solo-debugging` | Replaces guess-and-patch loops with falsifiable evidence. |
| Independent spec and quality review | Adapt through distinct roles/gates | Keeps “built the wrong thing” separate from implementation defects. Use on meaningful changes, not every line edit. |
| Exact diff range and evidence packet | Adapt into run artifacts | Reviewers receive requirements and work product, not full conversation history. |
| Per-plan durable ledger | Adapt as `docs/runs/<run-id>/` | Survives compaction/session restart and unifies plan, checks, artifacts, and gates. |
| Claude transcript memory hooks | Exclude | Unsupported Codex lifecycle parity, Claude-specific schema, privacy and maintenance cost. |
| ECC learning-library delivery gate | Exclude | File mtimes and edit counts are weak proxies for correctness and encourage churn. |
| Mandatory worktree and per-task subagent pipeline | Exclude as default | Useful only for independent, substantial work; current AGENTS guidance already delegates selectively with ownership. |
| Provider-heavy sample MCP/config profiles | Exclude | Project services should be enabled only when needed; existing config intentionally inherits user model and permissions. |

## Maintenance criteria

Treat the immutable source links above as provenance, not an update channel. Revisit an adaptation only when a real harness failure shows a gap. Before importing later upstream code, inspect the exact revision and license again, because both projects change quickly and cross-harness claims can drift within a repository.

The new skills should stay narrow enough that their descriptions route only matching work. General coding ability remains with Codex. Agent roles should be fewer than task names: use a distinct role only when isolation, read-only access, or different review judgment materially improves the result. Run evidence should contain facts needed to resume and assess the task, not a transcript or exhaustive activity log.
