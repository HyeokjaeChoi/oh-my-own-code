# Oh My Own Code

**카드 없이, 어떤 모델로든 — 한국어로 쓰는 코딩 에이전트.** Oh My Own Code starts on OpenRouter's free models with a single API key and no credit card, and works with any other provider key you already have. The interface is Korean-first.

A personal Electron workbench for inspecting and using an agent harness through an app-owned OpenCode v2 sidecar. The desktop renderer uses assistant-ui for conversations and an owned Tool UI component for validated tool results. macOS and Windows are the target platforms; package and runtime checks must run on each native platform.

## Run the desktop app

From this repository, with the pinned pnpm version and dependencies installed:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workbench/desktop build
pnpm --filter @workbench/desktop dev
```

Build a local macOS Apple Silicon package:

```sh
pnpm --filter @workbench/desktop package:macos
open apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app
```

Build Windows x64 on Windows using `pnpm --filter @workbench/desktop build` followed by `pnpm --filter @workbench/desktop package:windows`. A macOS build does not verify Windows behavior. These are local packages, without release signing, notarization, an installer, or publication.

Offline packaging can reuse a trusted, previously downloaded distribution: set `OMOC_ELECTRON_ZIP_DIR` to the folder containing `electron-v44.4.4-darwin-arm64.zip` (or the matching Windows archive) before the packaging command. The installed Electron version must match the package pin. This avoids a download; it does not bypass operating-system execution approval.

## Current implementation

The `desktop-workbench-core` increment connects folder import/create and registration removal, sessions, the assistant-ui composer/transcript, checked message/interrupt/permission operations, runtime command/skill/MCP/agent/model catalogs, and read-only text preview. The renderer receives a closed IPC contract; the authenticated sidecar client stays in Electron main. Imports require native trust confirmation before session activation. List removal does not delete project files.

This increment uses temporary app metadata and an isolated runtime. Its owned temporary workspace is removed on exit; imported or user-created project folders remain. Existing provider credentials are not inherited. A send without configured model credentials reports `AUTH_REQUIRED`; successful provider execution is not demonstrated by that error or by synthetic tests.

The session-lifecycle increment adds search, rename, pin, archive/restore, history fork, native-confirmed conversation deletion, and a bounded local activity panel. Conversation deletion preserves project files and refuses parents with SDK children. Unknown mutation outcomes are never automatically retried. Activity records contain operation metadata, not prompt content, provider billing or durable audit history. Its current verification state is recorded in the [session run](docs/runs/desktop-session-lifecycle/run.json).

The full F-01–18 release remains unfinished: durable recovery/storage, complete worktree and deletion workflows, configurable permission modes and delegation, browser/PTY/Git panels, extension configuration/installation, automation, and native verification on both platforms. The user selected `~/Documents/OhMyOwnCode/{session-id}` for the next persistent-workspace increment; the current temporary runtime does not yet implement that choice. See the [PRD](docs/product/prd.md), [feature landscape](docs/research/workbench-feature-landscape.md), and [current execution plan](docs/runs/desktop-session-lifecycle/plan.md). Completed core verification is in [the core integration report](docs/runs/desktop-workbench-core/report.md).

## Verification commands

```sh
pnpm nx run desktop-app:test
pnpm nx run desktop-app:typecheck
pnpm nx run desktop-app:lint
pnpm nx run desktop-app:format-check
pnpm nx run desktop-app:boundaries
pnpm nx run desktop-app:e2e-workbench
pnpm nx run desktop-app:e2e-sessions
pnpm nx run desktop-app:e2e-ui-states
```

The workbench E2E uses disposable files and an isolated sidecar with no provider credentials. It substitutes the native directory-picker result in its own process; it does not establish physical OS-picker interaction. Existing `e2e-macos`/`e2e-windows` and packaged E2E targets retain separate lifecycle, sender, navigation, crash/restart and cleanup coverage. A passing build, static check, or screenshot alone is not evidence that these runtime tests passed.

## Project harness

The applied Solopreneur harness supplies two thin execution profiles, 26 compatibility workflow aliases and 25 skills. Expertise lives in skills; each specialist assignment uses a fresh context. The primary coordinates and records evidence.

- Product docs: [docs/README.md](docs/README.md)
- Shared instructions: [AGENTS.md](AGENTS.md)
- Workflow and run ledger: [.solopreneur/docs/harness.md](.solopreneur/docs/harness.md)
- Specialist roles: [.solopreneur/docs/agent-catalog.md](.solopreneur/docs/agent-catalog.md)
- Workflow skills: [.solopreneur/docs/skill-catalog.md](.solopreneur/docs/skill-catalog.md)
- Preferred stack and boundaries: [.solopreneur/docs/stack.md](.solopreneur/docs/stack.md)
- Pinned source adaptations: [.solopreneur/docs/research/gstack-matt.md](.solopreneur/docs/research/gstack-matt.md), [.solopreneur/docs/research/ecc-superpowers.md](.solopreneur/docs/research/ecc-superpowers.md), and [.solopreneur/docs/research/architecture-speckit.md](.solopreneur/docs/research/architecture-speckit.md)

Trust this repository in Codex, then start a fresh session so its project configuration, profiles, and skills load. Exact user model/effort choices take precedence; otherwise follow the authorized adaptive routing policy in `AGENTS.md`. Profile files do not pin either setting. Check connections with `/mcp` and review the exact event hooks with `/hooks`. Project trust, hook trust, model availability, service authentication, and successful tool execution are separate states.

Every task that changes an artifact uses a run under `docs/runs/<run-id>/`. The planner records a proportional plan, receives an independent plan review, assigns only relevant specialists, and registers actual checks and deliverables through `.solopreneur/harness.py`. Status questions and pure explanations can use a brief in-session route. See the [run protocol](.solopreneur/docs/harness.md#run-records-and-checks); do not treat an empty ledger or generated template as completed evidence.

The planner asks focused follow-ups until execution-relevant requirements are clear and keeps confirmed decisions in `docs/runs/<run-id>/plan.md`, the task-plan SSOT. PRDs require independent `product_reviewer` review; design documents require `design_spec_reviewer` review before consuming implementation, followed by separate actual-UI `design_qa` review. New user direction updates the plan and affected reviews; existing authorization does not require repeated approval.

Product intent remains in `docs/`; local run records are not remote GitHub Issues, Projects, or PR state.

After cloning on another computer, enable the included Git hooks with `git config --local core.hooksPath .solopreneur/hooks`. Integrate any existing hooks before replacing their configuration. Configure Codex trust and OAuth on that computer too.
