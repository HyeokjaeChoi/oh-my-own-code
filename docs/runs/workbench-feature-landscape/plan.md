# Workbench feature landscape research plan

**Revision:** 4  
**Date:** 2026-09-28  
**Status:** Korean research synthesis ready for independent analysis review  
**Run:** `workbench-feature-landscape`

## Confirmed outcome

Research and document the baseline desktop coding-agent capabilities that the user expects for `oh-my-own-code`, using first-party vendor documentation and comparing the documented product behavior with preserved approved product scope, current PRD/UX research context, and actual implementation.

## Scope

- Compare Codex, Claude Code/Claude Desktop, OpenCode Desktop, and Cursor across:
  1. workspace/project/worktree lifecycle;
  2. right-side browser, terminal, file, and diff/artifact surfaces;
  3. live tool-call state, approval, question, progress, result, cancel/recovery interactions;
  4. skill, MCP, plugin, agent, and tool inventory/configuration.
- Distinguish direct documented facts from inference and from undocumented behavior.
- Audit the current repository against the same categories, citing concrete implementation paths and symbols.
- Synthesize product baseline, notable differentiators, gaps, risks, and an ordered set of next implementation slices.
- Save a durable Korean report under `docs/research/` with source links and access date.

## Non-goals

- No application or PRD/UX implementation changes in this research run.
- No vendor authentication, proprietary cloud, billing, or branded feature cloning.
- No hands-on visual/browser benchmark; this is a first-party-documentation comparison and repository inspection.
- Do not claim undocumented capability is absent; label it “not established by reviewed first-party sources.”

## Decisions and assumptions

- **Confirmed:** Target app is an Electron macOS/Windows local desktop app with an app-owned OpenCode v2 sidecar, and uses assistant-ui + Tool UI. Source: the user explicitly selected Electron macOS/Windows and app-owned OpenCode v2 sidecar, recorded in `docs/decisions/0002-desktop-runtime.md`. The approved feature scope is preserved, while current PRD/UX v0.6 amendments are marked review required; spec-index v0.12 says previous approval applies only to earlier file hashes. Treat these documents as the research comparison context, not as currently approved implementation inputs.
- **Confirmed:** User wants common major-vendor baseline behavior, including workspace create/delete, artifact preview panel, tool integration, and skills/MCP inventory. Source: latest user message.
- **Assumption:** Use current public first-party documentation as evidence and record inspection date; source updates may change later.
- **Open question:** Exact prioritization/acceptance changes following research require a separate plan/spec update; this run will recommend but not silently edit product contracts. This does not block research.

## Acceptance criteria

- **AC-1:** Comparative matrix covers all four capability groups and the four named product families; within workspace lifecycle, treat **import**, **create**, **remove from the app list/archive**, and **physical disk/worktree delete** as four distinct actions. Each substantive vendor claim links to a first-party source.
- **AC-2:** Report separates documented facts, inferences, and documentation gaps; avoids claiming an unverified feature is absent.
- **AC-3:** Repository audit separately identifies actual Electron implementation for **import**, **create**, **remove from the app list/archive**, and **physical disk/worktree delete**, distinguishing PRD target, partial implementation, and implemented behavior using file/symbol evidence.
- **AC-4:** Recommendations identify a coherent baseline and next slices, with security/lifecycle risks and dependencies, without changing app code or approved contracts.

## Assignments and ownership

| Owner | Assignment | Inputs | Output | Owned paths |
| --- | --- | --- | --- | --- |
| Primary coordinator | Integrate source research and code audit; verify citations and write synthesis | Vendor report and repo audit returned in the active conversation; PRD/UX/architecture; current tree | Final research report and run evidence | `docs/research/workbench-feature-landscape.md`, `docs/runs/workbench-feature-landscape/**` |
| `plan_reviewer` | Independently review this plan against latest user direction and acceptance/evidence boundaries | This plan, contract, current PRD/UX | Review report | `docs/runs/workbench-feature-landscape/reviews/**` |
| `analysis_reviewer` | Independently review final report for evidence fidelity, gaps, scope fit, and actionable synthesis | Final report and linked requirements | Review report | `docs/runs/workbench-feature-landscape/reviews/**` |

The vendor and code exploration findings were returned before this run plan was registered; they are source inputs, not registered dispatches and not final approvals. The primary remains the only ledger writer.

## Verification

- Run the registered structural/citation-presence check on the final report.
- Run `git diff --check` for whitespace issues in changed tracked files; note that the checkout currently has an untracked project baseline, so this check is only a whitespace check for tracked diffs.
- Obtain an independent plan review before final report authorship proceeds, and an independent analysis review after the report is frozen.

## Change history

- **R1:** Re-scoped the premature composer implementation run after the latest user request clarified that vendor capability research is the immediate task. No product implementation was dispatched in the superseded run.
- **R2:** Completed the cited research report in Korean for the user and corrected repository-relative code links after independent plan-review notes.
- **R3:** Clarified that only preserved approved scope is an authority; current PRD/UX amendments are research context pending review and approval.
- **R4:** Split each vendor's import, ordinary/worktree creation, list removal/archive, and physical deletion evidence into explicit comparison rows after independent report review.
- **R5:** Restored the separate artifact-preview, tool-interaction, and extension-inventory comparisons after a plan re-review caught their accidental removal while splitting lifecycle rows.
