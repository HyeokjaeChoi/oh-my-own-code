# PRD expansion plan

Revision: 2 (2026-09-26). Coordinator: /root. This is the execution SSOT.

## Confirmed direction
The user requests a broader personal agent workbench: worktree import/delete; automatic child-directory creation under the working root, using verified OpenCode naming or yyyy-mm-dd plus UUIDv7 fallback; subagents; tools; permission checks and mode changes; right-side browser/other previews; built-in and slash commands; common Claude/Codex/OpenCode desktop experiences, excluding vendor-specific functionality and authentication. Use both assistant-ui and tool-ui. These are the full release target, not optional future scope. Preserve the learning/inspection purpose and personal audience. This replaces v0.1's synthetic-only, single-session boundary. The user authorizes research and PRD revision, not approval of the final revision.

## Decisions and assumptions
Keep the existing local-browser delivery assumption pending the optional packaging answer; no response is not approval. A desktop shell can be decided before platform-dependent design. No implementation, installs, live credential use, external publishing or destructive filesystem operations occur here. Existing runtime credentials may be consumed later without building vendor authentication UI. Unknown SDK support remains an explicit design validation hold, not a silently removed requirement.

## Work and ownership
1. Root prepares this plan and researches common app capabilities. Fresh Luna/high web_researcher retrieves current OpenCode and UI integration facts; read-only, no recursive delegation.
2. Fresh Sol/medium plan_reviewer independently checks the bounded plan before product artifact changes.
3. Root integrates research into docs/research/workbench-expansion.md and authors Korean PRD v0.2 at docs/product/prd.md, preserving v0.1 at docs/runs/prd-expansion/prd-v0.1.md. Requirements, journeys, acceptance, exclusions, release sequencing, evidence and design holds must be concrete. Shared harness presets stay unchanged.
4. Register final document/hash in the contract; a fresh Sol/medium assignment adopts plan_reviewer for the changed contract-binding check and product_reviewer for the independent PRD review, with separately identified verdicts and current bindings. Inputs are docs/product/prd.md with its registered SHA256, this plan/revision/hash, contract and research. If substantive product findings require fixes, use a fresh reviewer after fixes.
5. Root records actual reports, static checks, outcome and completion. User approval of exact PRD v0.2 precedes parallel domain specs under the existing workflow.

## Acceptance and verification
AC-1: Every explicitly requested capability and exclusions are traceable in the PRD; no release-scope narrowing.
AC-2: Workspace/import/create/delete, permission changes, subagents/tools/commands, preview and failure states have observable acceptance criteria.
AC-3: Current primary sources distinguish SDK generations, native APIs versus proposed adapters, and assistant-ui/tool-ui responsibilities and compatibility uncertainty.
AC-4: Real-project operation, security/data boundaries, learning outcome, full-scope delivery order and next-stage approval are explicit.
AC-5: Preserve prior PRD, obtain independent product review and record truthful evidence. Static document checks only; no app tests or runtime validation claims.

## Dependencies and change history
PRD approval is required before design/development specs. SDK capability spikes and packaging decision precede platform-dependent implementation. Research can run alongside plan review. 2026-09-26 revision 1: latest user scope replaces old narrow draft; no new opportunity approval requested.

Revision 2: independent review requested explicit deliverable/archive paths and product_reviewer assignment; both clarified.
