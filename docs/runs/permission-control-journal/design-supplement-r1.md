# Permission journal immutable digest bindings
Version: focused-r1
Status: proposed; no consumers before genuine entry PLAN and DESIGN_SPEC judgment.

This focused supplement retains the accepted permission-control-design/schema-contract-r3 sections5–7, design-contract-r4, path-scope-clarification-r2 and adopted origin scope amendment. No new executor/journal/permission DB or permission activation. Original terminal documents remain untouched.

## Actual gaps
The accepted grant and saved-rule hashes require projectIdentityDigest, but exact permissionTarget, ruleBindings and existing registry workspace/session records do not persist it. scopeDigest is noninvertible. Reopen/parser cannot call Native or guess the hash from path, nonce or renderer input.
Mode target contains only before/afterPolicyDigest; mode result and registry delta additionally carry mode/generation/settings/floor/compiler. The existing policy digest also binds selectedAgentIdentityDigest, inventoryDigest and ordered rules. After policy meaning cannot be independently correlated on replay from the old target fields alone. Main actual readback remains necessary and cannot be replaced by parser correlation.

## Selected minimal extension
Extend ONLY the existing private permissionTarget with REQUIRED projectIdentityDigest:Digest and policyBindings:PolicyBinding[]. Other existing exact fields version/kind/previewId/previewDigest/scopeDigest/generations/targets/plan/ruleBindings remain. No raw Native project ID/path, prompt, callback, source/config/environment or executable payload. No public renderer-selected target.

PolicyBinding is exactly {targetIndex:UInt,after:PolicyDigestBody}. PolicyDigestBody is the EXACT already implemented permissionPolicyDigest argument: {compilerVersion:1,floorDigest:Digest,mode:Mode,modeGeneration:PositiveUInt,settings:Setting[],selectedAgentIdentityDigest:Digest,inventoryDigest:Digest,rules:Rule[]}. Never add policyDigest to its own hash body.
For mode: exactly one binding per session target, canonical targetIndex order, no extras/duplicates. Recompute accepted policy domain digest and require target.afterPolicyDigest equality. Correlate result mode/modeGeneration/policyDigest and registry permissionControl delta EXACTLY to this admitted body and computed digest. BEFORE digest must match the existing persisted session permissionControl.policyDigest. Missing/unverified legacy current policy is not a migration proof: no mode operation can silently invent/reset it. Complete verified Main bootstrap/migration remains subsequent integration. Non-mode policyBindings MUST be empty.

For grant: projectIdentityDigest and ruleBindings recompute every admitted grantDigest. ExistingSaved if present must match actual verified progress; returned savedId/timestamps recompute accepted ruleDigest with admitted project/action/resource. No future Native identity guessed at admission. Revoke persists an admitted rule binding for exact saved ruleDigest correlation as required by original schema; it cannot infer action/resource from renderer on reopen.

Both bindings are supplied from Main's immutable private preview context before durable begin, included in detached target and checkpoint/replay. Parser rejects missing/extra/swapped bindings, incompatible type/kind, mismatched hashes and other-operation target metadata. Original operation identity SHA256(sorted full validated request tuples INCLUDING expectedRevision) stays unchanged. Public requests still contain only preview handles/digests; no policy body or private project digest.

## Stable unknown-slot digest detail
For a flushed slot lacking verified state, use SHA256(UTF8('omoc.permission.slot.v1\n' + canonicalJSON({runtimeEpoch,operationId,previewDigest,ordinal,targetIndex,step}))). runtimeEpoch/operationId ORIGINAL, previewDigest admitted, remaining fields exact immutable EffectSlot. This represents admitted slot uncertainty, never current state. For verified state progress partial outcome stateDigest equals that actual persisted stateDigest. For verified grant progress, partial outcome stateDigest is SHA256(UTF8('omoc.permission.progress.v1\n' + canonicalJSON(exact persisted ProgressObservation))); this is correlation metadata, not a new approval. No original admission or other domain formulas change.

## Existing journal implementation phase
Implement permission_control_v1 marker, closed targets, existing registry begin/dispatch/complete correlation, ordinal dispatch and append-only permission_progress with immutable next-slot semantics and full checkpoint replay. Existing unrelated steps and before/after policy uniqueness unchanged. Reject duplicate ordinal, foreign targets, progress before dispatch, changed progress and success upgrade after unknown/reopen/tail. No Native replay. Confirmed complete requires every planned slot dispatched and verified progress; unknown retains original target/hold. Existing-only session mode delta exact; other deltas empty. Feature marker flush precedes admission. Every intent/progress/completion flush failure leaves conservative unknown/hold.

No Main service/admission/DTO/renderer or positive runtime integration in this phase. Registry progress API is private and must get an actual source/API checkpoint before consumers. No reconciliation release/permission_reconciled implementation yet; unknown permission records remain held. No privilege from shape/ACK/progress alone.

Old parser closure must be archived BEFORE storage source edits, all closure files hash/length verified, actual old parser imports reject new marker/journal/checkpoint unsupported_version and preserve bytes. No fake old parser. Existing journal4MiB record and operation limits remain; new detached permission target capped at1MiB, target/slot bounds of accepted schema still apply. Overflow unavailable/refused without truncation.

## Alternatives and review
Omitting project identity or trusting a live callback on replay cannot verify persisted rule hashes. Replacing accepted projectIdentityDigest with scopeDigest breaks domain formulas. Storing raw Native IDs or a second permission database adds unnecessary privacy/state ownership. Storing only result mode metadata cannot bind policy meaning to pre-effect intent. Minimal required private digest+exact existing hash body retains one journal and current ownership.

New private persisted fields are a focused consequential contract correction, so obtain independent entry PLAN and DESIGN_SPEC once. After acceptance classify unchanged implementation routine; no repeated initial F09 review. Full modes/compiler/inventory/broker/preview handles/Native task integration/recovery/UI and full F01–18 remain unfinished. No Native/Bun/Electron/provider/build/GUI/production invocation by this phase.
