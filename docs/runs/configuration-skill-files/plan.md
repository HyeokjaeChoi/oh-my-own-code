# Configuration Skill files — plan
Revision: 2. Date: 2026-10-08. Status: initial major entry, implementation held for PLAN and DESIGN_SPEC.

## Outcome and authority
Continue the user-authorized remaining local product under PRD F14/AC14, ADR-0001, architecture-entry and existing workbench UX/security contracts. Predecessor configuration-mcp is complete. Deliver one useful bounded increment: explicit selection, exact read, editing, validation, comparison and confirmed publication of existing workspace `.opencode/skills/<sourceName>/SKILL.md` files. A missing SKILL.md may be created only inside an already existing verified source directory. New directories, deletion, vendor formats, Native registration/activation, plugins, installers, project auto-discovery, providers and production Main are excluded. This does not complete Skills runtime or whole F14.

## Decisions and boundaries
Use a closed ASCII sourceName `[a-z0-9][a-z0-9_-]{0,63}`. Renderer never supplies a path. List only canonical existing directories, at most 16 supported entries within a bounded scan of 64 entries; report truncation explicitly. Never classify denied or changed traversal as missing. Hold root and all ancestor directory identities; reject symlinks, mount/device changes and aliases at every level. File observation and publication share exact target/version rules. Every available or missing read includes directoryVersion, a digest of workspace/sourceName/canonical ancestor dev+ino; every save requires it, including missing-leaf create, so replacement of an empty ancestor cannot silently become a new baseline. Extend existing descriptor-only publication machinery rather than add a writer.

Keep public instructions/MCP operations unchanged. Add distinct closed `configuration.skill.list`, `.read`, `.save`; feature marker `configuration_skill_files_v1` before durable admission; private admission binds sourceName to original identity and terminal result. Never journal file text. Save has flushed stage/publish, existing confirmation and backup/rollback/unknown rules, final exact reread. Unknown original keys are lookup-only and block matching resource mutation without replay.

Supported editable grammar: UTF-8, <=32768 bytes, no NUL or invalid surrogate, nonblank Markdown body; optional first frontmatter block with only JSON-quoted single-line name/description and optional `metadata:` containing exactly `  opencode/autoinvoke: true|false`. Reject duplicate/unknown keys, YAML tags/anchors/multiline and unsupported delimiters on save. Reading preserves exact safe UTF-8 even when grammar is unsupported, so user can explicitly edit into supported form. Native uses the Markdown body and folder ID; saving is inert under project:false and filewatcher:false. Show file status and Native registry/activation as separate facts; do not imply list or save establishes runtime availability.

Renderer state remains in the sole window workbench owner. Per-file draft keys include workspace, canonical root and sourceName. Async identities include epoch, root, trust, revision floor, generation and exact draft reference; reject selection ABA/late read/hash/ACK. No implicit list/read on poll/start/refocus/selection. Explicit save compares exact loaded/missing baseline and full target/text in confirmation. Retain selectable editable drafts in holds, immutable original operation lookup and floor-aware reconciliation. Navigation and drafts remain usable.

## Acceptance
S1: bounded closed list/read with exact target provenance and truthful inaccessible/unsupported/missing/truncated states.
S2: confirmed nested descriptor publication reuses existing writer, durable identity/feature compatibility, backup/postcondition and unknown no replay.
S3: per-file scope/clock/draft isolation, explicit lifecycle, truthful inert status and accessible selectable UI at desktop and 760px/200%.
S4: actual affected Node/Bun synthetic filesystem tests, build/bundle/type/boundary checks, hidden UI evidence and separate CODE/RENDER gates.

## Assignments and order
1. Main registers this plan/design; fresh independent PLAN then DESIGN_SPEC. No product edits until accepted. Main captures current legacy parser dependency closure while readers work.
2. Main owns DTO/contracts/shared pure Skill validation, storage/admission/service/transport integration and all ledger/docs. Freeze actual producer bytes before consumers.
3. Optional fresh private-file worker owns configuration file observation/save kernel/target helper plus own tests only. No registry/DTO/renderer writes. Main continues disjoint producer integration.
4. Fresh renderer worker owns workbench entity/controller/public exports/shared API, configuration-drafts UI/CSS and renderer tests. Fresh fixture worker owns fixture host/UI state scripts and relevant probes/tests. Each consumes actual frozen producer API. No recursive delegation. At most 3 concurrent writers; reviews are independent fresh readers.
5. Main integrates, runs affected checks once on coherent source, obtains actual synthetic Bun filesystem publication and hidden UI desktop/narrow/keyboard evidence. Initial meaningful failures preserved; routine repairs do not repeat entry gates. Final separate CODE and RENDER; finish only with all current acceptance gaps closed.

## Feedback and reversal
First reviewable increment is closed read/validation plus safe nested writer tests. Any ancestor replacement escape, legacy AGENTS/MCP behavior regression, inability to bind original save target, or inaccurate Native activation claim blocks dependent consumers and requires repair. Same-UID hostile concurrent filesystem mutation is not claimed fully atomic; held descriptors plus repeated named-chain checks limit scope, and uncertain publication remains unknown. No new external dependency or ownership/state framework. Revert new op/feature support only before stores consume it; afterwards old parser refusal preserves bytes. No unresolved user decision blocks this bounded scope.

## References
[PRD](../../product/prd.md), [Architecture](../../engineering/workbench-architecture.md), [ADR](../../decisions/0001-workbench-platform.md), [UX](../../design/specs/workbench-ux.md), [Design system](../../design/system.md), [Design](design.md). Actual pinned source facts copied to source-facts.json; source-only, not runtime evidence.

## History
r2: bind missing-leaf publication to explicit directoryVersion as well as file version.
r1: selected inert existing-directory Skill file editing/publication, with Native runtime and directory creation explicitly deferred.
