# Permission controls — engineering design draft r1

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

## 7. Physical write contract

Reuse configuration-save-kernel's held-directory openat/O_NOFOLLOW/device/regular/nlink checks, exclusive staging, fsync and descriptor-relative publish. Extend it deliberately for Native create/replace/delete/move; existing file.save support is existing UTF-8/64KiB only and must not be relabeled as general Write/Edit/Patch.

Authority is a held root filesystem-object capability established from a checked canonical workspace, not arbitrary current pathname membership. Display the original canonical root and explicitly distinguish this from an OS sandbox. Recheck ancestor/root identity before each publication and after; detected relocation or replacement yields unknown and holds further work. External rename of a held directory cannot be prevented by descriptor checks alone. If PRD interpretation requires strict current-path confinement against hostile external rename, this strategy cannot satisfy it and a real OS confinement boundary is required before activation.

All relative paths are closed, normalized and checked. Deny absolute paths, traversal, selected root replacement, protected application sources, cross-device targets, symlink ancestors/leaves, hardlinks and nonregular files. Source and destination authority is required for move. No parent creation or unsupported metadata occurs implicitly. New-directory support requires an explicit checked descriptor operation before Native can claim it.

Write/Edit use pinned native parsing/diff semantics but submit actual mutations to the broker instead of original execute callbacks. Patch reuses pinned parsing/derivation; validate ALL targets before staging. Per-file results track stage/publish/delete/move completion. Multiple files are not claimed atomically committed; partial completion returns unknown with a bounded per-target receipt and deterministic retained backups, with no automatic rollback/replay.

Existing broker byte limits remain until a reviewed extension establishes new limits. Oversize or unsupported files fail before effects; do not silently truncate. Native adapters expose the supported capabilities truthfully and never fall back to Native string-path writes.

## 8. Proposed API and storage checkpoint obligations

Names below describe the selected roles; they are NOT frozen implemented exports. Before renderer/storage consumers start, publish actual closed DTO declarations, validator exports and digest rules in one coherent checkpoint.

Reads use the existing v2 read envelope/cancel lane and atomic host clocks:
- permission.control.read: workspaceId, sessionId; current mode/generation, capabilities, effective-rule provenance, selected child status and availability.
- permission.remember.preview: workspaceId, sessionId, requestId; complete project scope, exact save patterns, selected/collateral pending, future scope, saved IDs, digest and short expiry.
- permission.saved.read: workspaceId, sessionId; exact project-owned saved records and completeness.

Mutations use original operation key and existing admission owner:
- permission.mode.apply: selected mode/capability settings, exact child identities, preview digest, explicit expansion confirmation token bound to that preview.
- permission.remember.apply: requestId and immutable preview digest; not a freeform rule or renderer-chosen Native project ID.
- permission.saved.revoke: exact saved ID and immutable rule/project digest.
- once/reject keep existing controls but gain stale/current-generation and collateral-impact checks at the Native gate. Request IDs cannot be reused after completion.

Private packets add nonce, original epoch/key, Native identity, generation and digest resolved by the host. Never accept caller callbacks or executable payloads. Detach data descriptors before awaits; refuse getters, symbols, extra fields, sparse arrays and nonplain objects. Do not export plugin code/options secrets, raw environment or live closures.

### Proposed closed targets and authority lifetime

All operations contain only the stated fields plus their existing envelope. Names remain design proposals until actual validator/API checkpoint:

- `permission.control.read`: `{type,workspaceId,sessionId}`.
- `permission.mode.preview`: `{type,workspaceId,sessionId,mode,settings,childSessionIds}`. `mode` is `ask|read_plan|scoped_edit|custom`; settings is a dense array of exact `{capabilityId,effect}`, effect `deny|ask|allow`, drawn from the verified runtime capability list. Non-custom modes require an empty array. Child IDs are distinct app IDs; the host resolves all Native identities. Preview returns the complete descendant list and refuses an incomplete selection for a reduction.
- `permission.mode.apply`: `{type,workspaceId,sessionId,requestId,previewId,previewDigest,confirmation}`. requestId equals outer operationId. confirmation is exactly `confirmed_expansion|confirmed_reduction`; the host verifies its classification against the immutable preview. It is not an override of upper deny or proof from model text.
- `permission.remember.preview`: `{type,workspaceId,sessionId,permissionId}`.
- `permission.remember.apply`: `{type,workspaceId,sessionId,requestId,previewId,previewDigest}`.
- `permission.saved.read`: `{type,workspaceId,sessionId}`.
- `permission.saved.revoke`: `{type,workspaceId,sessionId,requestId,savedId,ruleDigest,observationId}`. The observation fixes project membership and rule bytes; no caller-provided project ID or wildcard delete.

Preview IDs are unpredictable runtime-owned handles. Bind sender, runtime epoch, original app/Native mapping, canonical root identity, trust revision, host floor, policy/inventory/pending/saved generations, proposed target and expiry. Return a digest of the exact detached snapshot; recompute from canonical validated data. A handle cannot move between senders, scopes or operation kinds. Reads are inert; the first admitted apply consumes execution authority exactly once. An original-key duplicate is a receipt lookup even after handle expiry; a new key cannot reuse the handle. Closing the sender expires the handle, not an already-admitted task.

Available preview results have exact common clock/scope fields plus `{status:'available',previewId,previewDigest,expiresAt,scope,complete:true,impact}`. `scope` explicitly describes project-wide future remembered rules or selected session/descendants for modes. `impact` contains the exact action/save patterns, complete immediately released and remaining pending identities, exact existing saved IDs, policy/capability before/after and irreversible-effect disclosure. Unsupported/unavailable results contain only common scope/clock, status and a closed reason; partial lists never carry an apply handle.

Native sessions/locations without a verified app mapping make mutation unavailable (`identity_unverified`). Do not omit them and approve the remaining rows. Existing opaque foreign records may be counted as a completeness blocker; no unowned code/secrets are projected. Pending request metadata uses the existing safe approval projection, not arbitrary Native metadata serialization.

Closed design reasons: `inventory_unverified|identity_unverified|policy_unverified|settlement_unverified|unsupported_capability|scope_unverified|stale_preview|expired_preview|limit_exceeded|runtime_unavailable`. Preserve existing application transport/admission codes for invalid requests, conflicts and busy reads. The final actual schema checkpoint must enumerate which status accepts each reason and correlate every receipt field; consumers may not invent missing shapes.

Original registry admission persists exact immutable target metadata and canonical operation digest. Each actual policy, hold, interruption, grant, reply, revoke and broker stage/publication requires a flushed intent before the effect. Existing policy pair is retained; new step names and closed target schemas require coordinated registry/API checkpoint. Journal schema migration refuses unsupported old parsers without modifying store bytes; no hand-edited journal.

Confirmed completion requires exact readback and empty or explicitly justified delta. Remember result contains confirmed saved IDs (including an existing deduplicated ID), released request identities and scope digest; revoke contains the exact absent ID. Any uncertain partial grant/release remains unknown. Completion flush failure does not trigger another Native call. Retained operations remain lookup-only using original epoch/key; restart expires execution/preview authority, not lookup identity.

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
C. Extend descriptor kernel and trusted adapters, with actual contained sentinel/syscall tests for Write/Edit/Patch operations and all blocked indirect routes. Scope/root relocation limitation must be accepted in the independent design judgment before activation.
D. Freeze actual API/storage checkpoint, implement one host transition owner, then renderer/fixture consumers. Initial checks declare their complete dependency input_scope. Run affected checks only after routine fixes, retain whole-source final CODE and fresh actual RENDER evidence.
E. Fresh independent CODE/RENDER and exact acceptance map. Each capability remains unavailable until its own real effect evidence passes. Full F09 is complete only when every PRD requirement passes; design-only finish is not that result.

Required effect matrix: two sessions/two locations; preview additions/removals/changes cause zero grant/release; same-pattern existing grant ID; exact revoke preserves other rules; higher deny; stale once/reject; child creation during transition; uninterruptible settlement/deadline; old tool snapshots; direct/nested Shell/MCP/CodeMode/formatter refusal; leaf/ancestor symlink/hardlink/traversal/common-root sibling/cross-device/root relocation; create/replace/delete/move and partial Patch; every intent/completion flush failure; disconnect/restart original-key lookup with no replay. Record actual syscall/bytes and settled owned processes, not just events or labels.

## 12. Open readiness items

The strategy is selected, but these engineering facts must be resolved before a passing consumer contract: exact maintainable Native graph extension and project gate integration; boot discovery suppression including wellknown sources; complete live child/location inventory; actual broker operation semantics; root-object versus strict current-path interpretation. These are technical implementation holds, not requests for another user decision. This draft is suitable for focused feasibility review, not self-approval or enabling controls.
