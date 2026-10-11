# Astra/max independent full-plan audit

Date: 2026-10-03. Verdict: **changes_requested** for plan revision 1 and architecture specification version 1.

A separate fresh child `/root/astra_max_full_plan_review` was requested with `gpt-6-astra`, effort `max`. Settings are requested configuration, not independent runtime identity attestation. The reviewer did not rely on earlier passes. This report faithfully summarizes its returned findings; structured gate reports are adjacent.

## Findings

### AMAX-1 — P1: Freeze mutation outcome reconciliation before Stage 3

Location: `architecture-and-ui.md:33`.

Impact: Receipt/status lookup and per-operation identity are missing. Snapshot idle/existence must not clear unknown.

Correction: Specify operation identity, authoritative outcome evidence, lookup and unknown release conditions, or explicitly preserve runtime-lifetime unknown and defer receipt reconciliation.

### AMAX-2 — P2: Prepare boundary and styling migration before Stage 2

Location: `plan.md:45`.

Impact: Current checker rejects Base UI and packages/ui stylesheets while the required checker change is scheduled later.

Correction: Add minimal approved import/CSS Module support with negative fixtures and temporary legacy CSS containment before first UI slice.

### AMAX-3 — P2: Tie file cache freshness to real file changes

Location: `architecture-and-ui.md:25`.

Impact: Tool edits or external deletion/recreation can leave stale previews after reopening.

Correction: Specify cache keys, forced refresh, mutation invalidation, external-change revalidation, stale display and regression cases before Query migration.

### AMAX-4 — P2: Bind E2E evidence output to this run

Location: `contract.json:173`.

Impact: Default scripts overwrite earlier run captures/evidence unless an ambient environment variable is set.

Correction: Use a cross-platform wrapper or explicit output-directory argument in exact commands. Register packages/ui checks before Stage 2.

## Retain

Electron/macOS/Windows, owned OpenCode v2 sidecar, assistant-ui and Tool UI, full parent PRD scope, white conversation-first UI, and user-selected managed storage path remain appropriate. Main authority, one projection, limited Query reads, local reducers and deferred Zustand/XState are proportionate choices. No stack reselection is needed.

## Optional improvements

Include a first-slice capture combining long Korean content, pending permission, expanded composer and 200% zoom. Specify accessible path disclosure for same-named workspaces so execution targets remain distinguishable.

## Execution decision and limits

Do not treat the full current replan as implementation-ready. The local CODE-1 repair remains sufficiently scoped; four findings block only the named dependent stages. Correct and independently review changed concerns before those stages. No repeated user product approval is required by these findings.

Read current source/manifests/checkers and official primary documentation. Inspected five captures: lifecycle, activity, activity-narrow, permission-synthetic and tool-results-synthetic; the last two use a synthetic host with the production renderer. No source edits, project tests, builds, live app execution, keyboard/screen-reader/IME/zoom/contrast/performance tests, dependency installation/compatibility checks, provider execution or Windows native verification. Persistence and CODE-1 remain unfinished. This audit gives no rendered UI approval.

## Reviewed raw file hashes

- plan.md: `8a7528f959d052c904cf29458b00788e70a4c9393b5083f4b697dac947097ae6`
- contract.json: `10c869d318a6018df6ce4b58f5ed6015523f1396832e00a9fea9c987c4e456df`
- architecture-and-ui.md: `55fe54a92f513e5b168b2a64733a244978023be5a8b85e7b58115dcd0fb963e8`

Hashes were unchanged at the start and end of the independent audit. Harness semantic contract digest is separately recorded in the JSON reports.

## Primary sources consulted by reviewer

- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://feature-sliced.design/docs/reference/layers
- https://feature-sliced.design/docs/reference/public-api
- https://base-ui.com/react/handbook/composition
