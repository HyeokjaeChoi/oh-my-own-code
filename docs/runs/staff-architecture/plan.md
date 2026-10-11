# Staff architecture decisions - revision 2
Date: 2026-09-26. Task-plan SSOT.

## Requirements and authorization
The user requires monorepo-based feature-sliced multi-module architecture, contextual state management (Zustand, TanStack Query, local hooks and Context), multi-module management such as Nx, bundler selection, modern component selection such as shadcn, and staff-level decisions as mandatory project work. Existing autonomous delegation permits reasoned choices and independent review. This is an architecture/implementation-entry increment, not a claim that an Nx workspace or production app has been installed. No unresolved product question blocks this increment.

## Scope and precedence
Create docs/decisions/0001-workbench-platform.md and docs/engineering/architecture-entry.md. Append a project-owned English section to AGENTS.md outside the managed block making ADR review mandatory before framework, module, state, build or component work. Preserve all approved PRD/spec/design source hashes and completed run records. New ADR explicitly supersedes only generic stack preferences and the tentative frontend/workspace sentences in approved architecture v0.1; all security, permissions, recovery and product contracts remain authoritative. Scope is this product; do not silently change the reusable Solopreneur library.

## Decisions to cover
Compare pnpm+Nx against pnpm+Turbo; FSD UI layers within workspace packages, exported APIs and enforceable platform/slice dependencies; minimal initial modules vs extraction triggers; browser/bridge isolation. Map server-authoritative state, live transport/projections, local UI, URL, Context and assistant-ui ownership without duplicate sources or unsafe persistence. Choose UI and bridge build tools against Next/Vite/other maintained options; exact package compatibility and Node runtime remain installation probes, not guesses. Evaluate shadcn Base UI vs Radix with assistant-ui/tool-ui integration, token source, accessibility and copied-source maintenance. Specify alternatives, rationale, costs, failure modes, reversibility, upgrade policy, dependency budget, checks and measurable acceptance evidence for each choice. No mandatory adoption of every named library.

## Assignments
Root: plan/ledger, official documentation research under run, project AGENTS integration and entry document, static source/link/preservation checks.
Fresh plan_reviewer Sol/high: independent plan review while root researches.
Fresh engineer Sol/high as bounded architecture-document author: owns only docs/decisions/0001-workbench-platform.md; use source packet and current code/spike evidence, no installs or app code. Root integrates entry checklist and precedence.
Fresh design_spec_reviewer Sol/high: independently review architecture and rule consistency against requirements and risk; compatible code/checker review separately identified if harness requires it. No recursive delegation. Fresh contexts and path handoffs.

## Acceptance and validation
AC-1: Mandatory architecture entry rule is discoverable in project AGENTS and entry checklist.
AC-2: ADR addresses module graph, FSD, state ownership, Nx/tasks/cache, bundlers, components, alternatives, risks and reversal, with current official sources and compatibility probes.
AC-3: Implementation sequence includes import-boundary negative fixtures, browser/server bundle separation, duplicate-event/reconnect/mutation/state isolation tests, and UI accessibility/integration checks; configured vs executed explicit.
AC-4: Approved source hashes unchanged; independent design_spec review and ledger finish before consuming new ADR.
Named check docs: python3 docs/runs/staff-architecture/check_docs.py, static document/link/preservation check only; no application tests/install/network effects. Final document hashes registered before final binding review; checks after source freeze. No runtime implementation readiness claimed from static checks alone.

## Change history
Revision 1: mandatory staff-level architecture added by user; preserve frozen approvals and use a bounded superseding ADR.

## Exact immutable inputs
Baseline manifest: docs/runs/staff-architecture/preserved-baseline.json SHA256 805aea0554aa23b206ba0141effefea4b80fd1322bb44e4cfe3128943dc1da56.
- docs/product/prd.md SHA256 597e64d100ea67b878762fde160b3a6d5c2f1275662661094dadfe0dad270dfb
- docs/design/specs/workbench-ux.md SHA256 bfe3425f8334b91f882368e3e6670ec965dfd6361cf4cd71ee7af76890f61d43
- docs/engineering/workbench-architecture.md SHA256 4a031f5c8cd194c315b92df8ac468600d5b769387c2271d8c04810fbc4959cba
- docs/engineering/spec-index.md SHA256 771c023836af77cdc8633d05729caef176ef62b4804f9aafbd762679d1d1db93
- docs/engineering/verification.md SHA256 dba31b7266df9dcd93f6477342e07f77bef9897c42578048c4c38c024f62feee
- docs/operations/local-release-monitoring.md SHA256 f0d88e1836f230da09f7afe093d4320298d8d191845abae69ad4a0d4ef17263b
- docs/design/system.md SHA256 62970864615aa26c90328d4075ac1b179631ad7c2ebc6815c34f7cef8258da11
- docs/design/components.json SHA256 141487ebdd39422a7e4acb5d586b5d1872495e5064a2516482940742c938d645
- docs/design/tokens/manifest.json SHA256 5d23e89703bd23e0d130abed74519683d8ad9933d84f6b803c9a199ac941db9e
- docs/design/tokens/tokens.css SHA256 03fd82541214c1ddceb72a3979b1f6a7923af254ca52f4e606644cd68227636e
- docs/research/sdk-ui-feasibility.md SHA256 cd223205da17ce8591e4bed5b3f747e911be33e37186ddb7f5ca9fadefd0b5e2
- spikes/sdk-ui/package.json SHA256 d85ee02cf7f6001aaa9c1770a574ffb1ea701ee73d74b21d82f36553f752fd3b

Research packet: docs/runs/staff-architecture/official-sources.md (coordinator-authored factual notes from live official docs, completed before author dispatch). The author reads this packet, listed immutable source files, AGENTS, current plan/contract and matching role/skills only; additional official browsing may resolve evidence gaps. The only superseded v0.1 passage is section 1 sentence treating Next.js/React and pnpm as tentative repository preferences; all other execution contracts persist. Source-spike package pins are evidence, not a production compatibility lock.
Revision 2: names exact baseline hashes and evidence paths in response to independent entry review; no scope change.
