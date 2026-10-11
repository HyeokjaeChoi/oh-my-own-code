# Permission controls — corrections in progress r2

This is an unapproved correction supplement to the immutable reviewed draft r1. The actual independent report design-spec-review-r1.json is changes_requested, DS-01..05. Do not report these corrections as independently resolved. All implementation holds remain. No product source or runtime has changed.

## DS-05: select one floor/mode/effective-policy model

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

Every graph starts with control state `boot_held`. Before graph creation, retain current owner/journal readiness and production Native preflight checks; the permission change must not weaken existing preflight. Read existing registry unresolved operation targets into a bounded immutable boot-hold table. An unresolved scope that cannot be decoded holds the entire runtime; never ignore it.

During graph acquisition, fixed plugin setup can construct inert registries only. All execution admissions, Native restart continuity, Synthetic writes, background recovery and child resume remain behind boot_held. Existing production child calls ServerProcess.start without lifecycle; installRestartContinuity is currently conditional on lifecycle. Keep that fact explicit: do not claim this production call already auto-resumes. Nevertheless every restart entrypoint is guarded so future lifecycle use cannot bypass recovery.

Boot order: exclusive owner and read-only preflight → restore app journal holds → verify patched resource graph and fixed sources → acquire graph in boot_held → establish complete Native identity/location/session/child inventory without starting work → read exact persisted modes/floor/inventory/saved state → reconcile original receipts/intents and leases → allow explicitly confirmed clean scopes. Do not call resumeSuspendedSessions as a blanket boot step. It may run only as a separately admitted current-generation operation after reconciliation, with the same Synthetic/background/child leases and no original unknown-operation replay.

| Partial observation | Durable facts retained | Allowed recovery | Hold release |
| --- | --- | --- | --- |
| Intent flushed, no proof effect started | original key, target, step | read-only exact-key/state lookup | only a proven no-effect outcome plus task/child settlement; absence alone is insufficient |
| grant exists, some request releases uncertain | exact saved IDs/patterns, known release set, missing outcomes | list saved/pending and inspect original operation; explicit separate revoke may reduce authority | no more replay; full current inventory, original actual task settlement and explicit reconciliation result required |
| exact saved ID absent, completion flush failed | original revoke intent and observed absent ID | original-key lookup/readback | never recreate or retry delete automatically; reconciliation records current absence and settled original task |
| some sessions have new mode, others old/unknown | per-session before/after digests and generation | read-only per-session policy/identity comparison | hold all transition targets; a new explicit correction operation may converge policy only after original task settlement; never label old policy restored |
| broker partial Patch/publication | original targets, per-target step/result, backup IDs | read-only bytes/version/backup identity inspection | original unknown remains unknown; separately confirmed corrective operation after settlement, never auto rollback/replay |
| runtime crash/disconnect, no authoritative prior-process exit | original journal holds and known child identities | recovery facade and read-only metadata | no new Native startup or effects until existing owner/process policy supplies authoritative exit and preflight permits it |

A reconciliation result never upgrades an unknown original receipt to confirmed. It may establish a new generation for subsequent explicitly admitted work after proving the original task cannot still execute and matching exact current state. Any new corrective mutation has a new operation key/intent and explicit reviewed target; it does not reuse the original payload. Retained unknown keys remain lookup-only. If complete state or process settlement cannot be proved, keep the scope held across restart.

## DS-01 and DS-04 remain open

DS-01: no claim that descriptor confinement prevents all external-directory rename races. The local Apple SDK sandbox.h marks sandbox_init unsupported/deprecated and directs applications to App Sandbox. Do not adopt a deprecated custom-profile path as an assumed production solution. Apple's current App Sandbox documentation is being checked; supported entitlement/bookmark access alone is not proof of strict current-path mutation confinement. No platform enforcement strategy is accepted yet; paths stays open and implementation held.

Primary references: [Apple App Sandbox](https://developer.apple.com/documentation/security/app-sandbox), [Apple file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox). These describe supported resource restrictions and file access, not the required rename-race guarantee. Local SDK header is an additional direct source. No sandbox/helper was executed or installed.

DS-04: exact output/receipt/journal schemas and canonical digest still need a coherent written schema supplement. Existing request examples alone are insufficient. In particular once/reject must bind a complete exact collateral set and reject newly inserted requests before all effects. Do not start renderer/storage consumers until this and the physical boundary are resolved and independently reviewed.
