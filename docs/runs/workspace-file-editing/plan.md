# Workspace text-file editing
Revision: 5. Date: 2026-10-08. Initial PLAN rev2 and DESIGN_SPEC v3 accepted. Routine runtime correction within unchanged accepted scope.

## Outcome and authority
Continue authorized remaining local product work under PRD F11/AC11, the existing architecture/UX and exclusive durable owner. Predecessor configuration-extensions is complete. Deliver explicit editing and confirmed save of existing ordinary text files, with external conflict refusal and retained drafts. This increment does not complete Git/diff/restore/commit or whole AC11. No real project/private data, provider, production Main, foreground UI or external publication is used for verification.

## Decisions
Reuse the existing descriptor publication kernel and its staged token/backup/unknown lifecycle. Add an explicit existing-only generic `file` target; keep instructions/MCP/Skills/Agents targets unchanged. Do not create a second writer/storage layer or route direct user edits through model/tool execution. A small browser-safe workspace-file grammar owns portable relative paths and text limits; host descriptors independently establish actual authority. No dependency or runtime replacement.

Add separate closed `file.edit.read` and `file.save`. Existing `file.read` remains inert preview and supplies no write authority. Relative path max2048 UTF-8 bytes, canonical root max4096 UTF-8 bytes, at most32 components; each component max255 UTF-8 bytes, well-formed Unicode, no traversal, control/format separator, backslash, colon, portable-invalid characters, trailing dot/space or Windows device names. Preserve existing sensitive-name protection; new edit/save also excludes dedicated configuration roots `.opencode`, `.agents`, `.codex`, `.claude` and instruction files AGENTS.md/CLAUDE.md (case-insensitive). Refusal includes a usable explanation and existing dedicated editor when applicable. Do not broaden ordinary preview admission.

Only an existing regular single-link UTF-8 text file <=64KiB, with existing complete ancestor chain on the workspace device. No file/directory creation, symlink/hardlink, binary, FIFO/device/socket, deletion, scripts/configuration loading or Native mutation. Preserve exact text including BOM and LF/CRLF; reject invalid Unicode, NUL and unsupported binary control bytes. Text validation is not language/type validation.

Explicit baseline read holds root and all ancestor descriptors, named identity checks and exact source byte/version observations. Return current epoch/revision/scope, canonical actual target, source version and complete ancestor directoryVersion. Preview text and timestamps alone never authorize save. Save binds exact original epoch/operationId, workspace/root, relative path, source and ancestor versions, exact text/digest and expectation=version. Missing expectation is invalid in every layer.

Require trusted/ready owner and no global/matching resource hold. Same-workspace Native sessions must be freshly verified idle with no inbox/pending permission, using existing identity-only SDK reads and exact durable mapping; no policy update or Native mutation. Hold the workspace lock across confirmation/stage/publication and recheck identity/generation/root/authority. Independent workspace read remains usable. Same-UID external writers are not claimed OS-isolated: held descriptors, byte/identity rechecks, exchange/backup verification and conservative unknown preserve evidence of uncertainty.

Named `workspace_file_save_v1` feature gate precedes new durable admission. Original identity/completion binds exact path, baseline, digest and stage/publication proofs without journaling text. Older parser refuses the marker before accepting new effects and preserves bytes. Confirmed result requires exact final reread and backup correlation. Before-dispatch external change returns FILE_CHANGED and preserves draft; ambiguity after dispatched staging/publication remains original-key unknown, no automatic retry/replay. Existing configuration confirmation/rollback/unknown rules are not weakened.

## Acceptance
F1: closed existing-only baseline observation with exact path/source/ancestor identity and truthful inaccessible/unsupported/protected/conflict states.
F2: one descriptor publisher, original durable identity/feature compatibility, exact bytes/mode/backup/postcondition, conflict refusal and unknown no replay.
F3: sole window-owned drafts, explicit lifecycle, scope/clock/ABA/late read/hash/ACK isolation, editable held drafts and useful keyboard/desktop/760px/200% UI.
F4: affected current Node/kernel checks, actual contained staged-Bun publication, coherent build/bundle/type/boundaries, hidden UI and independent CODE/RENDER.

## Order and ownership
1. Main registers plan/contract/design. Fresh independent initial PLAN then DESIGN_SPEC once; read-only legacy-parser/source capture may proceed while review runs. No product implementation before accepted entry.
2. Main owns pure helper/declarations/public DTO/contract/producer tests and service/transport/confirmation/IPC integration. Freeze actual exports/shapes and initial meaningful Node tests before renderer/fixture consumers.
3. Fresh disjoint IO worker owns existing observation/publisher helper and own tests plus new generic host observer. Fresh storage worker owns registry/journal/receipt admission and own tests. Each uses actual shared producer checkpoint; no alternative writer or private identity bypass.
4. Fresh renderer owns store/controller/barrels/new file editor feature/explorer slot and renderer tests. Fresh fixture owns existing fixture host/test/UI runner only after actual renderer hooks exist. At most3 active disjoint writers; Main sole ledger writer; no recursive delegation.
5. Coherent freeze then affected checks, ONE final build/publication/hidden UI per coherent candidate; preserve actual failures and repair only affected concerns. Routine repairs do not renew initial entry. Final independent CODE and RENDER, close exact increment only, continue full product.

## Feedback, reversal and limits
Any path escape, overwrite of changed original, false confirmed result, loss of original operation identity, legacy configuration regression or inaccurate execution claim blocks dependent work. Initial tests exercise missing/changed/protected/symlink/hardlink/ancestor aliases/large/binary/BOM/CRLF and real IPC backup suffix. No weakening to pass a probe. Before stores consume the feature, changes can be reverted; afterwards older-reader refusal preserves data rather than silently replaying unsupported effects. Darwin actual publication only; Windows remains a separate actual platform acceptance, not a claimed pass. No unresolved user approval is introduced for contained authorized implementation.

## References
[PRD](../../product/prd.md), [architecture](../../engineering/workbench-architecture.md), [ADR](../../decisions/0001-workbench-platform.md), [UX](../../design/specs/workbench-ux.md), [design](design.md), source-facts.json. Whole PRD scope remains unchanged.

Revision2: pinned event-host save IPC cap is262144 encoded bytes. Keep this cap unchanged; generic edit raw text64KiB (preview remains256KiB) leaves room for JSON escaping/root/relative identity/metadata. Shared write-fit validation and actual full-message worst-case boundary tests must prove admitted maximum payload fits without late IPC refusal. No production source changed.

Revision3: initial DESIGN_SPEC DS-01 clarifies generic source write permission via actual held-parent O_RDWR no-write probe before stage creation, no O_CREAT/O_TRUNC. Existing configuration targets unchanged. Initial PLAN accepted; this is its bounded design correction, not a new feature entry. No new user approval or repeated PLAN gate.

Revision4: coherent r1 Node/static/build/publication10 PASS; hidden-r1 preserved FAIL after responsive preview remount retired independent file baseline. Main reproduced in Node and decoupled editor identity from preview lifecycle; actual file selection still advances own generation. No public API/design/scope change or repeated entry. Fresh publication-r2/hidden-r2 bind corrected coherent source; r1 failures retained.

Revision5: hidden-r2 reached11 new editor states then exposed an enabled protected-path read button. Main disables this button using the existing lexical protected-source result. No DTO/host/design change. Fresh publication-r3/hidden-r3 verify the coherent candidate; both actual failure reports remain preserved.
