# Permission controls — closed schema correction r2

Status: proposed correction for DS-04, not independent approval and not implemented exports. This document supersedes draft r1 section 8 where fields were deferred. It is read with design-corrections-r2.md. DS-01 is still open; writing this contract does not enable any control.

## 1. Closed data conventions

The notation below defines exact JSON objects. Every stated field is required unless marked `?`. A union selects one exact object. No extra keys, getters, setters, symbols, inherited fields, custom prototypes, sparse arrays, undefined values, duplicate IDs, non-finite numbers or negative zero. Validate property descriptors and copy before awaits. Optional fields are omitted, never null. Numbers are nonnegative safe integers, except sequence/generation values which are positive. Identifiers reuse existing bridge ID validation. A Digest is 64 lowercase hexadecimal characters. A Handle is an unpredictable 128-bit-or-stronger runtime-owned opaque identifier. Strings are valid Unicode with no lone surrogate or NUL. Native-origin text uses the current safe permission projection; no arbitrary metadata/error/config serialization.

`Mode = ask | read_plan | scoped_edit | custom`.
`Effect = deny | ask | allow`.
`Setting = {capabilityId:ID,effect:Effect}`.
`Rule = {action:Text,resource:Text,effect:Effect}`; action/resource each at most 4096 UTF-8 bytes. Rule arrays are ordered and never sorted by a consumer.
`Key = {runtimeEpoch:ID,operationId:ID}` uses the ORIGINAL epoch even when looked up in a new envelope.
`Clock = {runtimeEpoch:ID,revision:UInt,observationSequence:PositiveUInt}` comes from one atomic host observation. No Native helper invents clocks.
`Scope = {workspaceId:ID,sessionId:ID}`.
`Reason = inventory_unverified | identity_unverified | policy_unverified | settlement_unverified | unsupported_capability | scope_unverified | stale_preview | expired_preview | limit_exceeded | runtime_unavailable`.

Bounds: 32 location incarnations/project, 1024 sessions including descendants, 1024 pending requests/project, 1024 saved rows/project, 256 capabilities, 32 queued control transactions/project, 1MiB detached response/preview UTF-8 JSON, 4096 UTF-8 bytes/action or resource, 30-second preview lifetime, 10-second request deadline. A set exceeding a bound is unavailable; truncation cannot create authority. Times use integer Unix milliseconds for display plus an internal monotonic deadline for expiry. Reduced test limits cannot increase production limits.

## 2. Exact requests

All use the current v2 envelope, sender validation and read cancellation. Mutation expectedRevision is the admitted observation floor. No renderer-selected Native project/session ID, callback, compiled policy or raw path token is accepted.

| type | Exact fields in addition to type |
| --- | --- |
| permission.control.read | workspaceId, sessionId |
| permission.mode.preview | workspaceId, sessionId, mode, settings:Setting[], childSessionIds:ID[] |
| permission.mode.apply | workspaceId, sessionId, requestId, previewId:Handle, previewDigest:Digest, confirmation:expanded\|reduced\|unchanged |
| permission.reply.preview | workspaceId, sessionId, permissionId:ID, decision:once\|reject |
| permission.reply.apply | workspaceId, sessionId, requestId, previewId:Handle, previewDigest:Digest |
| permission.remember.preview | workspaceId, sessionId, permissionId:ID |
| permission.remember.apply | workspaceId, sessionId, requestId, previewId:Handle, previewDigest:Digest |
| permission.saved.read | workspaceId, sessionId |
| permission.saved.revoke.preview | workspaceId, sessionId, savedId:ID, ruleDigest:Digest, observationId:Handle |
| permission.saved.revoke | workspaceId, sessionId, requestId, previewId:Handle, previewDigest:Digest |

For mutations requestId equals outer operationId. This replaces the conflicting old permission.respond requestId meaning (Native permission ID) in the new durable path. Existing permission.respond must not remain an unbound bypass: coordinated bridge/controller update retires it for registry-backed production controls. Only explicit no-registry legacy test compatibility may retain the old form. A stale old production request fails INVALID_REQUEST without Native calls. Once/reject stay the same user controls, now backed by an explicit impact observation before apply; no implicit approval during polling.

Preset settings must be empty. Custom settings contain distinct capability IDs in canonical ID order, drawn from the observed complete inventory. childSessionIds are distinct sorted app IDs. A reduction must include every active descendant affected by its upper restriction; an incomplete selection is unavailable, never implicitly expanded. Expansion to existing descendants requires explicit selected identities. A mixed change (some wider, some narrower) is classified expanded and discloses both lists.

## 3. Closed read values

`Location = {locationId:Handle,workspaceId:ID,incarnation:PositiveUInt,state:ready|building|finalizing}`. locationId is an opaque mapping handle, not a filesystem path. Any building/finalizing location prevents a mutation preview.

`Session = {workspaceId:ID,sessionId:ID,locationId:Handle,parentSessionId?:ID,mode:Mode,modeGeneration:PositiveUInt,policyDigest:Digest,state:idle|running|held|unknown}`. parentSessionId is Native child ancestry; fork lineage is not substituted. All rows require verified app mapping. Unknown unmapped rows yield unavailable identity_unverified, not a partial available list.

`Capability = {capabilityId:ID,label:Text,category:file_read|file_write|shell|network|mcp|delegation|other,support:verified|unsupported,effect:Effect,source:builtin|trusted_adapter}`. label max256 UTF-8 bytes. Only runtime inventory IDs are valid; unsupported capabilities always effect deny. Capability names do not themselves prove confinement. Arbitrary plugin option/code values are absent.

`Pending = {permissionId:ID,workspaceId:ID,sessionId:ID,locationId:Handle,action:Text,resources:Text[],savePatterns:Text[],requestDigest:Digest}`. Arrays are the exact bounded safe Native approval projection and keep original order. The digest binds full private evaluation identity, while unsafe metadata is never exported. A projection that cannot fully disclose the requested effect makes approval unavailable scope_unverified; it is not silently omitted.

`Saved = {savedId:ID,action:Text,resource:Text,effect:allow,ruleDigest:Digest,createdAt:UInt,updatedAt:UInt}`. Project membership is carried by the enclosing verified scope digest; rows do not expose a caller-selectable Native project ID. Existing runtime saved rules have no TTL/session expiry; these are not invented. Duplicate action/resource grants may retain their existing savedId.

`Generations = {control:PositiveUInt,inventory:PositiveUInt,pending:PositiveUInt,saved:PositiveUInt,locations:PositiveUInt}`. These are graph-owned counters, incremented before a relevant mutation becomes externally usable. Missing reset/overflow proof holds the runtime.

`Policy = {mode:Mode,modeGeneration:PositiveUInt,settings:Setting[],floorDigest:Digest,compilerVersion:1,policyDigest:Digest,rules:Rule[]}`. Rules are exact host compilation/readback, not final-effect proof; the trusted gate and physical broker still govern execution. authenticatedFloor/system deny is never overridable by mode or saved rows.

Available permission.control.read is exactly `{...Clock,...Scope,status:available,complete:true,observationId:Handle,scopeDigest:Digest,generations:Generations,policy:Policy,capabilities:Capability[],locations:Location[],sessions:Session[],pending:Pending[],hold:none|transition|recovery|actual_call}`. Hold other than none may be observed but cannot produce an executable preview.

Available permission.saved.read is exactly `{...Clock,...Scope,status:available,complete:true,observationId:Handle,scopeDigest:Digest,generations:Generations,saved:Saved[]}`. Observation is sender/epoch/root/trust/floor/generation bound and inert. Revocation still requires a separate immutable preview.

Every read or preview failure is exactly `{...Clock,...Scope,status:unavailable,reason:Reason}`. No partial rows, complete flag, observation handle, preview handle or executable target. `unsupported_capability` means a requested capability cannot be enforced. `stale_preview` and `expired_preview` appear only on read/preview refresh of an existing target; mutations use the rejected result below. Transport READ_BUSY/READ_TIMEOUT/STALE_EPOCH/etc. preserve their current envelope semantics and never become available observations.

## 4. Immutable previews and exact collateral impact

`ScopeSet = {kind:project,scopeDigest:Digest,locations:Location[],sessions:Session[]}`. Include the COMPLETE project inventory even for a selected-session operation. Selected targets are carried separately. This enables exact global comparison without silently expanding effects.

`ModeChange = {workspaceId:ID,sessionId:ID,before:Policy,after:Policy}`.
`Releases = {selected:Pending[],collateral:Pending[],remaining:Pending[]}`. These three arrays partition the captured complete project pending set with no duplicate permission identity. A permission identity is [locationId,sessionId,permissionId], never permissionId alone.
`Grant = {action:Text,resource:Text,existingSavedId?:ID}`.

All available previews are exactly `{...Clock,...Scope,status:available,complete:true,previewId:Handle,previewDigest:Digest,expiresAt:UInt,generations:Generations,scope:ScopeSet,impact:Impact}`. Impact selects ONE exact union:

- mode: `{kind:mode,classification:expanded|reduced|unchanged,changes:ModeChange[],cancelPending:Pending[],remainingPending:Pending[],settlementRequired:ID[],irreversibleWritesRemain:true}`. changes contains root plus exact selected descendants, sorted by [workspaceId,sessionId]. cancelPending/remainingPending partition the full project set. settlementRequired is exact affected session IDs including idle ones whose leases still matter. No old pending is granted by this transition.
- once: `{kind:reply,decision:once,permissionId:ID,releases:Releases,savedChanges:[]}`. selected is exactly the named request, collateral is empty; all others remain.
- reject: `{kind:reply,decision:reject,permissionId:ID,releases:Releases,savedChanges:[]}`. selected is the named request, collateral is exactly every other pending rejected by the real Native same-session behavior, not only what the renderer saw. Release means resolved as reject, not authorization to execute.
- remember: `{kind:remember,permissionId:ID,releases:Releases,grants:Grant[],futureScope:project_until_revoked,reevaluationScope:selected_location}`. selected contains the named request; collateral contains exactly the additional requests the real guarded Native evaluator would immediately allow in that location after these grants. Other-location requests remain unless the pinned Native implementation actually reevaluates them; this contract does not trigger a new cross-location sweep. grants are the exact savePatterns expansion including wildcard '*' where Native requests it. No label can say one file when resource is '*'.
- revoke: `{kind:revoke,saved:Saved,futureScope:project,doesNotRecallRunning:true,releases:{selected:[],collateral:[],remaining:Pending[]}}`. The saved ID and bytes must exactly match the observation and current project.

Preview generation is read-only under the project gate with the actual private Native evaluator, policy context and hypothetical saved-state snapshot. It cannot call hooks with external effects merely to predict approval. If evaluateInput cannot be evaluated inertly with a complete captured context, preview is unavailable inventory_unverified. No handcrafted wildcard approximation.

Apply reacquires project gates and compares complete locations/incarnations, all sessions/ancestry, all pending identities and evaluation digests, saved IDs/bytes, policy/Agent/model/trust/root and inventory generations against the preview. Added, removed or changed targets => ZERO effect rejection before hold/grant/reply/remove/policy. Lock excludes insertion/reply/effect admission during the comparison and commit. Expiry checked at admission AND first actual effect. Target membership may only shrink through this operation's recorded steps; unrelated changes during a long transition keep it held and require verification rather than automatic expansion.

Handles bind sender, original epoch, app/Native scope mapping, root object and named path identity, trust revision, expected host floor, exact preview type, full canonical body and monotonic deadline. A mutation consumes a handle only after durable admission. Original-key duplicate returns the original receipt even if expiry elapsed. New operation key with used handle is rejected. A failed admission before durability does not claim consumption. Restart/sender close invalidates unused handles; an admitted task retains actual-call ownership.

## 5. Digests and canonical ordering

Two separate digests must not be confused:

1. operation identity digest remains the EXISTING production admission SHA256 of JSON.stringify(Object.keys(operation).sort().map(key => [key,operation[key]])). operation is the validated full mutation INCLUDING expectedRevision, exact requestId and previewId/digest. Do not change existing admission digest to the preview serializer. Snapshot floor equals the expectedRevision supplied to transport.
2. Preview digest uses `SHA256(UTF8('omoc.permission.preview.v1\n' + canonicalJSON(body)))`. body is exactly `{kind,clock,scope,trustRevision,rootIdentityDigest,nativeIdentityDigest,generations,inventoryDigest,previewId,expiresAt,impact}`. clock is Clock; scope is ScopeSet; kind selects mode/reply/remember/revoke. root/native digest values are private producer-validated hashes; they do not reveal raw IDs/paths. Other fields match the exact projected preview. previewDigest is excluded from its own body. Sender identity is checked in the handle registry; its private digest is included in nativeIdentityDigest's domain-bound binding.

canonicalJSON recursively serializes exact plain JSON with object keys sorted by ascending UTF-8 byte sequence. Integers use ordinary JSON decimal form. Strings use JSON.stringify escaping WITHOUT Unicode normalization; BOM/CRLF/pattern bytes are not rewritten. Ordered lists (rules, resources, savePatterns, argv) keep order. Set lists are sorted by stable composite ID using UTF-8 bytes of canonicalJSON(identity): locations by [locationId,incarnation], sessions/changes by [workspaceId,sessionId], pending by [locationId,sessionId,permissionId], saved by savedId, settings/capabilities by capabilityId. Distinctness is checked before sorting. Grants sort by [action,resource]. A private evaluation digest includes every policy input influencing release; an omitted/opaque changing hook makes inventory unavailable.

ruleDigest = SHA256(UTF8('omoc.permission.saved.v1\n' + canonicalJSON({projectIdentityDigest,savedId,action,resource,effect,createdAt,updatedAt}))). policyDigest similarly binds compilerVersion, floorDigest, mode, modeGeneration, settings, selectedAgentIdentityDigest, inventoryDigest and ordered rules under 'omoc.permission.policy.v1\n'. scopeDigest binds complete Location/Session identities and projectIdentityDigest under 'omoc.permission.scope.v1\n'. All domain prefixes are exact ASCII. Session rows used for scope hash exclude their scopeDigest to avoid recursion.

## 6. One journal: targets and bounded effect ordinals

A new existing-journal feature marker `permission_control_v1` is flushed before the first new admission. The same journal/parser owns the records, including checkpoint round-trip. An old parser must refuse unsupported_version before writes and preserve all store bytes. No second journal or permission DB.

Existing begin shape adds optional `permissionTarget`, REQUIRED for these new permission mutations and forbidden for other types. Exact target is `{version:1,kind:mode|reply|remember|revoke,previewId:Handle,previewDigest:Digest,scopeDigest:Digest,generations:Generations,targets:Target[],plan:EffectSlot[]}`. Target union:

- session: `{kind:session,workspaceId:ID,sessionId:ID,beforePolicyDigest:Digest,afterPolicyDigest:Digest}`;
- pending: `{kind:pending,workspaceId:ID,sessionId:ID,locationId:Handle,permissionId:ID,requestDigest:Digest,resolution:once|reject}`;
- grant: `{kind:grant,ruleDigest:Digest,existingSavedId?:ID}`;
- saved: `{kind:saved,savedId:ID,ruleDigest:Digest}`;
- project: `{kind:project,scopeDigest:Digest}`.

Target arrays contain bounded metadata only. Private pending/grant rule bodies may be retained only as exact safe action/resource metadata needed to verify readback, under the existing app-owned store access policy; no plugin source, prompt, environment or executable callback. To avoid an undeclared extra target shape, rule bytes are resolved through a separately admitted existing safe snapshot owned by the same journal record: `ruleBindings:{ruleDigest:Digest,action:Text,resource:Text}[]` is REQUIRED in permissionTarget (empty when no grants/saved target). Persist this as part of the ORIGINAL target, never reconstruct bytes from a renderer on reopen. Native identity mappings remain existing private registry ownership.

`EffectSlot = {ordinal:UInt,step:Step,targetIndex:UInt}`. Ordinals are consecutive 0..N-1, max 8192, targetIndex must reference an exact target. The immutable plan is host-generated before begin, not supplied by the renderer. Step is a closed list: `native.permission.hold | native.permission.interrupt | native.permission.cancel_pending | native.permission.policy | native.permission.grant | native.permission.reply | native.permission.revoke | native.permission.activate`. A policy slot is one target session's compiled installation/readback; no new ad-hoc step names per session. Slot constraints: hold first, activate last; interrupt/cancel/policy only for mode targets; grant before once replies for remember; revoke only for saved; reply only for pending. Same operation cannot combine unrelated mode/grant/revoke branches. Empty unchanged-mode plan uses hold and activate only, still exact verified generation. Each slot is unique by ordinal and permitted at most once.

The coordinated dispatch extension is exact `{runtimeEpoch,operationId,step,permissionEffect:{ordinal,targetIndex,previewDigest}}`. It is accepted ONLY for permission_control_v1 records and must match the next unconsumed slot EXACTLY. Existing unrelated dispatch schemas, existing policy BEFORE/AFTER selection steps and their uniqueness rules remain unchanged. No arbitrary repeated step is authorized. An original admitted operation can advance slots in its current live task only; replay/reopen/tail adoption/completed unknown has no dispatch authority.

Every effect slot is durably flushed BEFORE its actual effect, including in-memory hold/activate generation changes. State inspection and actual-call wait are reads, so they do not fabricate dispatch. The hold blocks effects in the graph once installed; admission gates prevent a gap while awaiting flush. Long settle waits release locks while keeping the hold generation. activate means staging a verified new generation while still held; only successful completion flush permits releasing execution. Flush failure retains hold, never retries Native effect.

After each actual slot, the SAME journal supports an append-only `permission_progress` record exactly `{kind:permission_progress,runtimeEpoch,operationId,ordinal,outcome:verified|unverified,stateDigest:Digest}`. Verified requires actual observed result; unverified never upgrades. Progress must refer to a flushed slot and is immutable per ordinal. Dispatch without progress is unknown. This record is NOT a completion receipt or new execution authority. Native can acknowledge a step only after actual effect/readback and journal progress succeeds. Reopen preserves missing progress as unknown, not no-effect. A complete result correlates the admitted target and every slot.

## 7. Receipts, partial results and recovery

Keep the existing RedactedReceipt outer fields EXACT: runtimeEpoch, operationId, type, workspaceId, sessionId, admission, delivery, effect, revision, evidence, optional result. Original epoch/key never changes. evidence keeps current safe limit8; full per-target state belongs to validated result, not unbounded evidence. Result union for these operation types:

- `{kind:permission_mode_applied,workspaceId,sessionId,previewDigest,scopeDigest,digest,changes:{workspaceId,sessionId,mode,modeGeneration,policyDigest}[]}`;
- `{kind:permission_replied,workspaceId,sessionId,previewDigest,scopeDigest,digest,decision:once|reject,resolved:{locationId,sessionId,permissionId}[]}`;
- `{kind:permission_remembered,workspaceId,sessionId,previewDigest,scopeDigest,digest,saved:{savedId,ruleDigest}[],resolved:{locationId,sessionId,permissionId}[]}`;
- `{kind:permission_revoked,workspaceId,sessionId,previewDigest,scopeDigest,digest,absentSavedId:ID,ruleDigest:Digest}`;
- `{kind:permission_partial,workspaceId,sessionId,previewDigest,scopeDigest,digest,outcomes:{ordinal:UInt,targetIndex:UInt,state:verified|unknown,stateDigest:Digest}[],hold:project}`;
- `{kind:rejected,code:INVALID_REQUEST|STALE_PERMISSION|STALE_REVISION|POLICY_UNVERIFIED|BUSY|LIMIT_REACHED|UNAVAILABLE|CANCELLED}` reuses existing rejection projection. stale/expired preview uses STALE_PERMISSION, unsupported scope POLICY_UNVERIFIED, overflow LIMIT_REACHED.

All bare names in these result objects have the common ID/Digest/Mode/UInt types defined above. No optional fields inside result variants. Result digest equals the ORIGINAL record.identity.digest, not previewDigest. Scope/preview digests equal permissionTarget. Each resolved ID is exactly an admitted pending target with the correct decision. Saved IDs match exact rule readback including Native dedup identity. Revoke absentSavedId equals the one admitted saved ID and absence is rechecked under the project gate. Mode changes equal exact admitted session set; each policy digest matches actual compiled readback and generation. A completion cannot substitute another operation target.

Confirmed = admission dispatched, delivery accepted, effect confirmed, typed successful result, all mandatory slots verified, all actual-effect leases settled where required, durable completion flush. Delta uses existing shapes: mode operation changes ONLY admitted session mode records; workspaces/tombstones empty. Reply/remember/revoke delta is `{workspaces:[],sessions:[],tombstones:[]}`. Grant persistence is Native's existing PermissionSaved DB, correlated by result; no shadow grant table. Session mode delta exact added field is `{permissionControl:{version:1,mode,modeGeneration,settings:Setting[],floorDigest,compilerVersion:1,policyDigest}}`; all ordinary existing identity fields remain registry-owned and are not taken from result.

Partial/unknown = delivery unknown, effect unknown, permission_partial if any safe outcome is known (otherwise result absent), original target retained. Outcomes cover all flushed slots and only those slots, sorted ordinal; missing readback is state unknown with a domain-separated digest of the admitted slot, NEVER a fabricated state digest. Verified means that individual observation, not completion of the whole mutation. No partial result enables execution or replays a slot. Even all observed successes with failed completion flush remains unknown.

Rejected/none is legal only if no effect slot dispatched. A failed validation after a hold was actually installed is an unknown partial mutation, not rejected/none. Host admission rejects a stale target before dispatch with zero Native calls. A proven typed failure after dispatch remains unknown unless a separately reviewed exact no-effect proof exists; no generic catch converts it to no effect.

Original unknown receipts cannot later become confirmed. Read-only reconciliation returns exactly `{...Clock,...Scope,status:available,complete:true,original:Key,scopeDigest:Digest,generations:Generations,settlement:verified|unverified,currentStateDigest:Digest,hold:project|none}`. It is a new observation, not an effect receipt. hold none requires proven prior-task/process settlement, current full state/identity readback, existing owner/preflight authorization, and a durably recorded reconciliation generation. Durable record `permission_reconciled` is exactly `{kind:permission_reconciled,original:Key,runtimeEpoch:ID,scopeDigest:Digest,generations:Generations,currentStateDigest:Digest,priorSettlementDigest:Digest}`; it only permits newly admitted work, never changes original operation outcome. No arbitrary reconciliation mutation is exposed to renderer; existing host recovery owns this readback and record. Unknown prior settlement keeps hold project. A new corrective mutation uses a fresh key and explicit preview after actual settlement; it never reuses a partially consumed plan.

## 8. Required contract checks, not executed here

Meaningful RED/GREEN must cover extra/accessor/sparse field rejection; canonical permutations/ordered rule changes/Unicode bytes; expectedRevision in original digest; every result/target/digest mismatch; exact grant dedup/revoke ownership; once/reject collateral insertion zero-effect; whole-project additions/removals; expired used handles and duplicate original keys; policy-slot ordinal repetition/order/overflow; progress and completion flush pause/failure; partial target readback; unsupported old parser byte preservation; old unknown lookup no replay; boot hold reconstruction; global versus independent-project locks; direct Shell/background settlement; both existing before/after policy stages.

This supplement is a design contract. No new DTO, dispatch step, journal record, Native patch or control is active until the coherent reviewed implementation checkpoint exists.
