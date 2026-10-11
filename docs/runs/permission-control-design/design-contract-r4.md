Status: proposed corrected contract, pending focused independent product/design judgments. R1 report and artifacts are preserved. This revision does not claim runtime evidence or permission implementation.

# Permission controls — corrected engineering contract r4

Status: source-grounded draft, not an accepted consumer API. This document does not enable modes or authorize new runtime execution. PRD F-09 and section 5 remain the requirements. Permission observation and Composer Plus stay complete and unchanged. Full F09 remains incomplete.

## 1. Selected architecture and ownership

Retain one EventHost, one service/admission/registry/journal owner, one renderer projection and the current OpenCode 2.0.18 engine. Do not add another executor, permission database or event-derived authority. Add a trusted execution-control boundary to the existing Native graph, not a renderer-only policy label.

The selected strategy has three dependent parts:

1. Existing SDK `session.interrupt({resume:false})` followed by `session.wait` for actual execution settlement. No new settlement RPC.
2. A project-wide Native control gate for admission, pending registration/resolution, saved grants and session/child creation. This is a required Native integration change; a Promise queue around plugin handlers alone is insufficient.
3. Trusted tool adapters that perform scoped mutations through the existing descriptor kernel. Unadapted mutation paths are denied in restricted modes. Existing native string-path mutation callbacks must not run afterward.

The current plugin PermissionDomain exposes list/get/reply/hooks only. It cannot implement the project gate by itself. The implementation must first establish a maintainable Native extension: tracked exact-version patch/overlay inputs applied by resource staging to pinned core bytes, with fail-closed original hash and unique-anchor checks, reproducible output manifest and actual import tests. Never hand-edit dist/node_modules or silently use unmodified core. If the graph integration cannot preserve the existing engine/services, stop dependent consumers and revise this design. No Native extension is implemented by this draft.

The exact patch and exported private binding are a prerequisite checkpoint, not an existing API. Scope includes Permission, PermissionSaved and live Instance registration paths, plus tool/session creation admission. A facade that protects only new private RPC handlers is rejected.

## 2. Confirmed source behavior

- Existing `Session.wait` calls execution.awaitIdle; it neither wakes nor resumes. Interrupt ACK does not establish settlement. Actual-call tests remain required.
- Permission pending Map is per location; saved rules are project-wide. Native `always` saves `save[]`, releases the selected request and reevaluates other pending in the same location. It can release requests in other sessions. Other locations are not immediately swept by that function.
- Write/Edit/Patch and MCP can request `save:["*"]`. A label such as “remember this file” would be false.
- Reject can reject the selected session's other pending requests. The UI must disclose this collateral scope.
- Saved removal is ID-only and returns void. Project ownership and absence readback are application obligations. Duplicate saved patterns can retain an existing ID.
- Current production config sets project:false and a private global directory; it does not set global:false. Config loads global entries before fixed content. Plugin scan concatenates document plugins and discovers directory plugins. A final fixed plugins array is NOT evidence that earlier plugins were excluded.
- Existing tool lists contain live execute closures after transforms. Metadata and IDs alone do not prove callbacks safe. Old tool snapshots can survive later transforms.
- Native FileAccess is lexical, allows project common-root paths, and is not descriptor confinement. Patch can bypass FileMutation. Formatter and Shell execute subprocesses. Generic MCP and CodeMode fetch are separate effect paths.

Source facts and analyst report accompany this draft. Static inspection is not effect verification.

## 3. Runtime trust and inventory

Before restricted modes or remembered grants can become available, production boot must exclude unapproved config/plugin discovery BEFORE loading it. A post-load inventory cannot undo plugin setup effects. Select a verified Config replacement with project:false/global:false and explicit fixed content, and suppress supplementary plugin discovery and wellknown configuration for this graph. The current ServerProcess options do not forward global:false; the exact integration belongs in the checked Native extension or an existing supported replacement route proven before use.

Maintain a closed registry of approved builtin identity, pinned module hash, options/schema digest, permission action, adapter identity and execution generation. Every execute closure checks the current generation and session authority immediately before effects. Transform, reload, unexpected plugin/hook, collision, missing required tool or partial registration invalidates the generation and holds execution. New snapshots alone do not revoke old closures.

Only fixed app-owned hooks whose behavior is included in the source/effect matrix are allowed. No arbitrary permission evaluation hook runs during preview. If hooks cannot be proved deterministic and free of effects, remember preview is unavailable. Never invoke unknown hooks to test their purity. Unknown tools default deny in restricted modes; a declared readOnly hint is not sufficient.

### Exact selected graph integration

The existing exported `@opencode/server/routes.createRoutes(options,urls,overrides)` already accepts replacements. Add an optional fourth argument to pinned ServerProcess.start and its declaration; forward it to that existing route builder. Existing lifecycle and HTTP transform positions remain unchanged. EventHost constructs the fixed replacement set only after full resource verification. No renderer/request payload can supply replacements.

Before graph acquisition, replace Config with `configured({project:false,global:false,content:fixedContent})`, without an explicit file. Replace WellKnown with an inert service (empty entries/snapshot/resolve, refresh unchanged, writes denied). Replace ConfigPluginSource with exact fixed workbench plugin operations and `Stream.never`; do not invoke its ordinary directory scan. Wrap SdkPlugins.register to refuse other sources. Validate the complete ordered generation before Plugin.activate calls any plugin effect.

Source validation MUST precede modules.load: PluginSupervisor.resolve loads modules before activate. An activate-only guard permits untrusted top-level module effects and is insufficient. Observe hook register/dispose and tool transform/dispose/reload from acquisition onward; the current hooks service has no complete inventory-list method. Unknown registration invalidates authority before callback execution.

Use `Provider.mapLayer` to preserve existing dependency wiring when decorating a provider. A plain `node.replace(Layer)` drops original dependencies. Any new control dependency must be explicit in the provider graph. The graph-global control node must not depend back on Permission/Session/Plugin, preventing cycles. Reuse existing LocationServiceMap and `buildLocationServiceMap`; do not clone its cache.

Keep original authenticated upper deny outside user last-match rules, saved allows and plugin overrides. Apply it at the final execution boundary and before Permission evaluation. Preserve both baseline policy stages before and after Agent/model selection; any new mode policy must remain an intersection with those authenticated constraints.

## 4. Modes and concrete capabilities

| Mode | File reads | File mutations | Shell | Network / MCP | Confirmation |
| --- | --- | --- | --- | --- | --- |
| 요청마다 확인 | approved builtin policy | ask, still upper-deny constrained | ask only for verified trusted execution route | ask only for verified registered route | once is default; remember separate preview |
| 읽기/계획 | approved read/grep/glob routes | deny | deny, including indirect subprocess | deny unless an independently verified nonmutating adapter is explicitly selected | no mutation approval can override mode deny |
| 범위 내 편집 허용 | approved reads | descriptor-adapted Write/Edit/Patch only within held root capability | deny | deny generic external servers and direct CodeMode fetch | scope expansion requires explicit confirmation |
| 사용자 정의 | closed allow/ask/deny choices over verified capabilities | same physical broker for any scoped allow | deny until a separate process confinement contract is verified | only verified per-adapter capabilities | display exact scope and limits before apply |

No unrestricted arbitrary code capability is silently represented as scoped. CodeMode is disabled for restricted modes until every callable path, including its own fetch, uses the same gate. Formatter is disabled for restricted writes. These constraints are visible in mode details, not hidden behind a familiar vendor label.

An unimplemented or unverified capability is displayed as unavailable. This is a prerequisite hold, not completion of the corresponding PRD requirement. Default current behavior stays in place until the full transition/inventory boundary passes.

## 5. Atomic project control gate

Use Native project identity as the serialization key, not workspace or renderer session ID. All live locations for that project participate. A global graph-owned coordinator registers locations before they accept work and unregisters only after settlement. Admission requires an exact app-to-Native identity mapping; foreign pending requests are still included in impact inventory, not hidden.

The gate covers evaluate→pending insertion, pending cleanup/removal, once/reject/always, saved add/remove, policy generation changes and child/location registration. Do not hold a gate while awaiting a pending Deferred: perform evaluation/insertion under gate, release, then await; reacquire for cleanup. Settlement waits also run outside the lock after a hold generation has been installed. Lock ordering is project gate then location state; no reverse acquisition or hook reentry. Queue saturation fails before effects.

Preview captures complete live locations, sessions/children, pending requests, saved rows, policies and trusted inventory generation. A digest binds detached closed data, original scope and generation. Apply reacquires the same project gate and compares the ENTIRE set, including newly added/removed entries. Any difference is stale before saved writes or request release. The Native evaluator is reused; no handwritten wildcard evaluator predicts the sweep.

For a remember operation, new grant effect is project-wide for future evaluations. Immediate releases mirror Native's selected-location sweep; other locations remain pending unless separately reevaluated under the same guarded transaction. Preview distinguishes both groups. Changes to any relevant location invalidate the preview. Do not expand the selected set during apply.

### Required internal patch coverage

| Pinned source boundary | Exact reason and selected change |
| --- | --- |
| core `config-vgpkvtp0.js`, Permission layer | Expose private guarded snapshot/evaluate/reply bindings; include ask/assert insertion, all cleanup, close and sweep. Do not substitute exported rule matcher for evaluateInput. |
| core `config-zs6xvgsc.js`, location cache factory | Register build start, project resolution, ready, invalidate, shutdown and actual finalization with incarnation identity. Cache keys alone are incomplete. |
| core effect/app-node-builder graph wiring | Attach control dependency to existing location-map provider, preserving original factory and bindings. |
| core `config-yp2x3t23.js`, run coordinator | Guard actual start, stopping/run reentry and settle→pendingWake restart; wrapping public wake/resume alone misses internal restart. |
| core Tool execution boundary (`config-yw6qsgb4.js`) | Guard exposed raw callbacks, direct snapshots and nested execution with current generation, including old captured closures. |

Decorate existing PermissionSaved instead of copying SQL. Its internal raw service is private to a transaction; calling the public gated saved.add/reply while already holding the gate is forbidden. Atomic here means exclusion of concurrent changes, not rollback of saved DB writes plus Deferred releases after a crash.

Guard Session create/fork/import commit, remove, setPermissions/switchAgent/switchModel; SessionInbox admit/steer/queue/cancel; prompt/synthetic/compact; command/shell/skill/generate/resume/background/revert; move and runner move commit; plugin/tool lifecycle. Long effects use tracked leases outside the gate. `Session.active` alone excludes direct Shell and cannot prove all work has settled.

Lock order is project gate → inbox/session lock → DB transaction. SessionMove currently calls admission inside its inbox lock: move must acquire project control outside that lock or receive a checked internal transaction capability. Cross-project moves acquire both project gates in deterministic project-ID order. Never pass a reusable bypass token to plugin callbacks or arbitrary forks.

Reuse Native Session.list filtered by project, without the parentID:null filter, for complete sessions/children; distinguish parent_id from fork_session_id (fork is not a child). Enforce output limits under the gate. Register live location lifecycle, including building and invalidated-but-unsettled incarnations, before enabling any mutation. A Native core patch that misses an entrypoint fails the prerequisite gate; do not ship only a guarded private RPC.

## 6. Settlement and mode transition

Transition states: requested → holding → settling → verifying → active, with denied/stale/unknown terminal results. Hold all new sends, commands, direct tools, permission replies and relevant child creation in the target scope before requesting interruption. A project-scoped transition also serializes remembered grants/revoke.

1. Persist immutable transition target and original operation identity, then flush each actual effect intent.
2. Install the Native hold generation before interrupt. Enumerate selected sessions and descendants from complete Native inventory. No renderer list or accumulated events substitutes for this inventory.
3. Call tracked interrupt(resume:false), then tracked existing session.wait for each execution. Wait must include cleanup and actual uninterruptible tool settlement. A deadline ends the UI wait, not the actual-call hold.
4. Under the project gate, recheck the full inventory, child set, pending set, original identity and hold generation. A newly admitted child or unknown call prevents activation.
5. Cancel old pending without granting them; confirm absence before installing the new rules. Do not resume old pending under changed authority. New requests receive new identities.
6. Install the policy/inventory generation, read back exact rules and tool adapters, then persist confirmed result before release. Resume only when every selected target confirms.

Failure before policy installation leaves the old verified policy and execution held until safe reconciliation. Failure after any policy effect is unknown with the observed partial results; never claim old policy was restored. Completed writes are not undone. No timeout, idle event, interrupt ACK, connection loss or snapshot is treated as actual settlement.

New children copy the parent's verified effective policy intersection and generation before they can execute. Expansion is not propagated automatically to existing children. Reduction explicitly includes selected active descendants; each result is shown. Upper deny is inherited and cannot be replaced by a child's allow. Unknown ancestry or incomplete inventory holds the transition.

Current authenticated baseline explicitly denies subagent. This work does not silently remove that deny to make a child test pass. Existing/imported children must still be inventoried; future authorized delegation requires its own authenticated capability from the relevant feature contract. Child propagation tests use explicitly contained authorized synthetic fixtures and cannot imply production delegation is enabled.

## 7. Physical write contract and explicit scope clarification

The exact proposed allowed-folder contract is path-scope-clarification-r2.md. That document records the original PRD ambiguity, the r1 reviewer interpretation, the rejected unsupported strategies and the explicit selected object-scoped local-tool boundary. It requires independent product judgment; no user approval is invented. Strict current-absolute-path confinement against a noncooperating same-user external rename is NOT established by descriptors or supported App Sandbox documentation.

Use checked held-directory openat/O_NOFOLLOW/device/regular/nlink checks, exclusive staging, fsync and descriptor-relative publish. Authority is bound to the admitted selected directory and checked descendant chain. Replacement at its former pathname receives no authority. All unadapted indirect writes are denied in restricted modes. External relocation invalidates new work on detection, retains actual-call holds and exposes partial unknown state; the precise syscall-race residual is disclosed, not called strict prevention. A product-review rejection of this explicit scope contract blocks scoped-write implementation; it cannot be overridden by a design pass.

General Write/Edit/Patch support extends the existing existing-UTF8/64KiB kernel deliberately: create/replace/delete/move/metadata and multi-file partial results are separate checked broker operations. Validation covers stage creation, write, metadata, publish, delete, move and cleanup, not publish alone. Reject absolute/traversal/protected-source/cross-device/symlink/hardlink/nonregular targets and root/ancestor relocation requests by tools. No implicit parent creation. Source and destination require exact admitted authority for moves. Preserve pinned Native parse/diff semantics, but never run its old string-path mutation callbacks after the broker.

Patch validates all targets before staging and retains deterministic backups/per-target results. It is not an atomic filesystem transaction; partial completion is unknown/held with no automatic rollback/replay. Byte limits remain existing until the coherent implementation contract defines and verifies an extension. Oversize/unsupported data fails before effects, without truncation. A partial/unavailable mode is not full F09 completion.

## 8. Closed API, results, digests and journal contract

schema-contract-r3.md is normative for exact closed requests/responses/previews, once/reject collateral scope, effect ordinals/progress, completion correlation, canonical digests, expiry/duplicate identity and recovery. It replaces r1 section8; none of those fields are deferred to implementation design. Actual validator declarations/exports must implement this contract in one frozen coherent checkpoint before disjoint consumers start. No new shape is consumed from prose alone.

Existing original-operation digest semantics INCLUDING expectedRevision are retained. Preview/policy/scope/rule digests are separately domain-separated. The existing journal receives a closed feature marker/target/ordinal/progress extension, not a second storage layer. Both existing before/after selection policy steps remain for ordinary send/cancel/create/fork paths.

## 9. Bounds and lifecycle

Initial design limits: 32 live locations/project; 1024 sessions including children; 1024 pending; 1024 saved rules; 256 tool records; 32 queued control operations/project; 1MiB total detached preview; 4096 UTF-8 bytes per action/pattern; 30s preview lifetime; 10s request deadline. Exceeding any limit returns incomplete/unavailable and zero mutation, never a truncated approval. Limits may be reduced by tests; increases require explicit contract review. Native-origin strings still pass byte and Unicode checks.

Sender close revokes preview/confirmation authority and new UI work. Actual already-admitted tasks retain their owner and settle before close completes. Runtime disconnect, epoch/root/trust/policy/inventory changes invalidate observations and confirmations. Unknown original tasks retain scope holds until actual settlement plus reconciliation. Revoke only affects future evaluation; it cannot recall an already allowed/running effect.

## 10. UI contract

Retain the established design foundation and Plus popover. Extend the existing permission disclosure with current verified mode, capability details and change action; do not add an always-visible toolbar row. Drafts remain editable/selectable while execution is held.

Show pending/holding/settling/verifying/active/stale/denied/unknown states. Expansion confirmation lists exact capabilities, root, children and affected pending. Default once remains primary. Remember opens a preview with project-wide/future wildcard scope and every immediately affected request; no prechecked batch or “remember this file” shortcut. Revoke lists exact IDs/rules and says existing execution is unaffected.

Use existing semantic tokens and focus patterns; popover/dialog close restores trigger focus. Keyboard and narrow760/200% tests include long patterns, many requests, unavailable inventory and partial transition results. No automatic mode apply, grant, revoke or observation on polling/refocus/selection. Unknown states expose original-key status lookup, not retry execution.

## 11. Implementation order and acceptance

A. Establish the checked Native extension and boot trust closure first. Verify imports, unknown-plugin no-setup effects, disabled discovery, gate coverage and old snapshot refusal. This is not a new executor.
B. Auth-free contained Native tests: real in-flight noninterruptible tool + interrupt/wait; pending registration races; complete multi-location/project inventory; real saved add/dedup/remove. No provider/private originals or production Main.
C. Extend descriptor kernel and trusted adapters, with actual contained sentinel/syscall tests for Write/Edit/Patch operations and all blocked indirect routes. The explicit scope clarification requires independent product and design judgment before activation.
D. Freeze actual API/storage checkpoint, implement one host transition owner, then renderer/fixture consumers. Initial checks declare their complete dependency input_scope. Run affected checks only after routine fixes, retain whole-source final CODE and fresh actual RENDER evidence.
E. Fresh independent CODE/RENDER and exact acceptance map. Each capability remains unavailable until its own real effect evidence passes. Full F09 is complete only when every PRD requirement passes; design-only finish is not that result.

Required effect matrix: two sessions/two locations; preview additions/removals/changes cause zero grant/release; same-pattern existing grant ID; exact revoke preserves other rules; higher deny; stale once/reject; child creation during transition; uninterruptible settlement/deadline; old tool snapshots; direct/nested Shell/MCP/CodeMode/formatter refusal; leaf/ancestor symlink/hardlink/traversal/common-root sibling/cross-device/root relocation; create/replace/delete/move and partial Patch; every intent/completion flush failure; disconnect/restart original-key lookup with no replay. Record actual syscall/bytes and settled owned processes, not just events or labels.

## 12. Readiness and implementation holds

Current r1 findings are not author-resolved by writing this revision. Independent review must judge the changed DS01 scope clarification and DS02..05 corrections below with the exact closed schema. Existing major entry plan PASS is retained; no duplicate initial plan ceremony is required. Implementation readiness is conditional on that genuine judgment and the recorded decisions being resolved to those exact contracts.

After design acceptance, actual checked patches, exports, tool closures, process leases, root broker operations and DTO validators require implementation and meaningful contained effect tests. Import/hash checks and documentation are not runtime enforcement. Final CODE and rendered implementation reviews remain independent. Full18/F09 remains incomplete until actual required capabilities and all acceptance cases pass.

## 13. Selected DS02/03/05 protocols (normative correction)

### DS-05: select one floor/mode/effective-policy model

One existing service owner persists `{mode,modeGeneration,settings,policyDigest}` per app session in the existing registry. One graph-global control owner resolves that record to Native identity and installs the execution generation. The renderer never supplies compiled Native rules.

Separate three concepts:

1. `authenticatedFloor`: the fixed deny clauses for external_directory and subagent, plus any authenticated system deny. These are non-overridable. The wildcard ask baseline clause is a fallback, not an upper ceiling that would make scoped allow impossible.
2. `selectedMode`: a closed verified capability table. It can add deny/ask/allow only inside the floor. Agent-imposed authenticated restrictions are intersected, never relaxed by later session or saved allow.
3. `nativeEffectiveRules`: a deterministic compilation of that mode for the selected Agent and inventory, for Native observation/enforcement in addition to the final trusted execution gate. This is not the floor itself.

Selection function: floor-deny or mode-deny or unsupported capability → deny; otherwise explicit mode allow → allow; otherwise mode ask/fallback → ask. Saved allow may satisfy an eligible ask only after the immutable project/grant checks; it can never override floor/mode deny or a physical broker refusal. User-editable or plugin last-match rules cannot replace this function. The Native execution gate independently checks floor and capability generation immediately before effects.

Compilation order: exact wildcard ask, deterministic sorted capability rules, exact authenticated deny clauses last. Rules use only verified action/resource mappings from the capability table; lexical patterns are not physical path authority. The compiler rejects duplicate/conflicting action/resource mappings and ambiguous third-party actions. The final broker enforces file targets. The compiled rule list and canonical digest are owned by the host, not by arbitrary Native plugin transforms.

The existing `policy(s,step)` must stop blindly writing BASELINE_POLICY when a verified non-default mode exists. Both existing `native.policy.before_selection` and `native.policy.after_selection` intents and actual calls remain. Each writes and reads back the compiler output for the same admitted modeGeneration/floorDigest. Admission binds exact expected current-Agent and selected-Agent policy digests. If Agent selection legitimately narrows rules, the two compiled digests may differ as planned; mode generation and floor remain identical. An unplanned Agent/model/inventory change refuses execution and holds rather than silently recalculating a broader policy.

Validation is split into `matchesAuthenticatedFloor` (all mandatory denies and final gate floor identity), `matchesCompiledPolicy(expectedDigest,exactRules)` (full dense ordered Native list) and `matchesModeRecord` (registry/Native generation and app mapping). Existing policyMatches stays the exact baseline validator for legacy default-ask fixtures and baseline references only; it must not validate a non-default effective policy. No append-allow-after-baseline shortcut.

All existing exact-baseline call sites in send, inbox cancellation, fork/create/reopen/native correlation migrate together to this shared verifier. Default ask compiles to the current baseline bytes/order, preserving meaningful legacy fixtures. Fork/import keeps its explicit history/lineage semantics but receives a newly admitted effective policy record; it never inherits an unverified raw allow. Reopen compares persisted mode/floor/compiler version, exact Native metadata and compiled readback before execution. Unknown or unsupported compiler versions hold; no silent reset to a permissive default. Renderer observation continues to distinguish stored rules from final effective execution authority.

Required regression: apply read_plan → select Agent/model → send and cancel paths → both policy stages → fork/import → clean checked reopen. Assert mode/floor generations and exact compiled readback persist, saved allow cannot override denies, and no stage resets the new mode to BASELINE_POLICY. Partial writes across multiple sessions remain unknown/held.

## DS-02: choose an explicit transaction and actual-effect lease protocol

Private graph transaction capability is an unforgeable object created only while holding the project gate. It contains runtime epoch, sorted project IDs, generation, transaction ID and active lifetime. It is not serialized, stored, returned by RPC, captured by plugin callbacks or passed to forked effects. Internal methods validate identity and active lifetime; public methods always acquire gates. Capabilities expire synchronously when the critical section ends.

Lock order is sorted project IDs → session/inbox lock → DB transaction. Resolve candidate project identities without effects before acquisition, then resolve/recheck them under acquired gates. If identity changes, release all locks and reject stale; never acquire another project lock while holding inbox/DB locks.

Lease record is exact private `{runtimeEpoch,leaseId,originalOperationKey,projectId,locationIncarnation,sessionId,kind,modeGeneration,inventoryGeneration,state,parentLeaseId}`. leaseId is unpredictable and never reused. kind is `coordinator|direct_tool|shell|background|move_commit|plugin_transition|filesystem`; state is `admitted|running|cancelling|settled|unverified`. Admission records the lease under gate before the first effect and registers the actual task handle. A request deadline or UI cancellation changes authority/status, not lease completion.

Every finally records actual underlying task settlement, then checks all child leases and owned process/IO handles. Only then transition to settled. A detached response/Promise.race/void ACK/terminal event cannot settle a lease. Unknown ownership of a child process promotes a runtime hold. The existing owned-handle observer remains the source of actual child exit evidence; missing exit proof retains unverified. Do not invent per-tool process proof from a completed Fiber alone.

| Actual source entry | Gate and lease boundary |
| --- | --- |
| core config-9qsysn39.js Session.shell | Acquire before starting the separate scope Fiber; shell lease survives cancellation and settles only after real shell process/result/output and owned child exits. |
| core config-yp2x3t23.js coordinator start/run/settle | Coordinator lease exists before each real start; stopping/run reentry and pendingWake restart reacquire a current-generation admission. Original done and every child lease must settle before release. |
| core config-yw6qsgb4.js direct/raw/nested tool callbacks | Admit direct_tool child lease at the final current-generation effect boundary. Nested calls inherit scope constraints but obtain their own tracked actual task, not inherited allow alone. |
| core SessionInbox service | Public admit/steer/queue/cancel takes project gate before session lock. Internal locked operation takes only a validated transaction capability, not another gate. |
| core config-6jrj4a7s.js SessionMove.move and config-7stqpyhf.js runner inbox path | Both immediate and queued commits use the two-project transaction below before the inbox lock; neither retains the old inverse-order call. |
| existing Session create/fork/import/remove/policy/Agent/model methods | Resolve scope under gate before DB commit; long remove/interrupt/wait work gets a lease and runs outside locks. |

Background handoff atomically attaches a child background lease under the same gate before the foreground owner returns. Foreground finally cannot settle while that child remains live. Background completion uses its actual task and process handles, not a resume event. Closing a session cancels/joins all leases; absent proof retains hold and does not claim deletion settled.

Move protocol is fixed: resolve source/destination → acquire sorted project gates → recheck both identities/mode generations → acquire session lock → append exact queued move target or perform the immediate Native Moved commit → update lease location/project identity under both gates → release locks. The queued runner repeats the SAME checks at actual commit with the original move lease; transition hold/stale generation cancels admission before Moved, not after. A moving coordinator lease is retained with original operation key and incremented private identity generation. Destination policy is the intersection of original effective constraints and destination authenticated floor; moving never expands authority. Existing tool effects must settle before move commit. If Native commit succeeds but lease/policy update fails, both projects are held unknown; never replay Moved or claim rollback. Fork ancestry and original receipt identity remain unchanged.

Transition activation requires ALL: selected session.wait calls actually settled, target project/location build/finalization inventory complete, every relevant actual-effect lease settled, no old pending requests, exact floor/mode/inventory generation readback, durable completion flush. session.wait alone is necessary but insufficient. Explicitly selected descendants participate in the same predicate.

## DS-03: boot and partial-effect reconciliation protocol

Every graph starts with control state `boot_held`. Before graph creation, retain current owner/journal readiness and production Native preflight checks; the permission change must not weaken existing preflight. Read existing registry unresolved operation targets into a bounded immutable boot-hold table. An unresolved scope that cannot be decoded holds the entire runtime; never ignore it. The currently unconditional retainedOperations startup refusal is explicitly coordinated with schema-contract-r3.md section9: only a read-only privately verified permission recovery ticket permits boot-held graph acquisition, never execution/replay. All other existing startup safeguards remain.

During graph acquisition, fixed plugin setup can construct inert registries only. All execution admissions, Native restart continuity, Synthetic writes, background recovery and child resume remain behind boot_held. Existing production child calls ServerProcess.start without lifecycle; installRestartContinuity is currently conditional on lifecycle. Keep that fact explicit: do not claim this production call already auto-resumes. Nevertheless every restart entrypoint is guarded so future lifecycle use cannot bypass recovery.

Boot order: exclusive owner/authoritative prior-exit proof → decode original app journal holds → checked copy-only Native inspection and exact private RecoveryTicket → current Main AND native-preflight retained checks validate that ticket (unrelated retained remains zero-start) → persist original boot-hold table → verify patched resource graph and fixed sources → acquire graph in boot_held → establish complete Native identity/location/session/child inventory without starting work → read exact persisted modes/floor/inventory/saved state → reconcile original receipts/intents and leases → allow explicitly confirmed clean scopes. Do not call resumeSuspendedSessions as a blanket boot step. It may run only as a separately admitted current-generation operation after reconciliation, with the same Synthetic/background/child leases and no original unknown-operation replay.

| Partial observation | Durable facts retained | Allowed recovery | Hold release |
| --- | --- | --- | --- |
| Intent flushed, no proof effect started | original key, target, step | read-only exact-key/state lookup | only a proven no-effect outcome plus task/child settlement; absence alone is insufficient |
| grant exists, some request releases uncertain | exact saved IDs/patterns, known release set, missing outcomes | list saved/pending and inspect original operation; explicit separate revoke may reduce authority | no more replay; full current inventory, original actual task settlement and explicit reconciliation result required |
| exact saved ID absent, completion flush failed | original revoke intent and observed absent ID | original-key lookup/readback | never recreate or retry delete automatically; reconciliation records current absence and settled original task |
| some sessions have new mode, others old/unknown | per-session before/after digests and generation | read-only per-session policy/identity comparison | hold all transition targets; a new explicit correction operation may converge policy only after original task settlement; never label old policy restored |
| broker partial Patch/publication | original targets, per-target step/result, backup IDs | read-only bytes/version/backup identity inspection | original unknown remains unknown; separately confirmed corrective operation after settlement, never auto rollback/replay |
| runtime crash/disconnect, no authoritative prior-process exit | original journal holds and known child identities | recovery facade and read-only metadata | no new Native startup or effects until existing owner/process policy supplies authoritative exit and preflight permits it |

A reconciliation result never upgrades an unknown original receipt to confirmed. It may establish a new generation for subsequent explicitly admitted work after proving the original task cannot still execute and matching exact current state. Any new corrective mutation has a new operation key/intent and explicit reviewed target; it does not reuse the original payload. Retained unknown keys remain lookup-only. If complete state or process settlement cannot be proved, keep the scope held across restart.

