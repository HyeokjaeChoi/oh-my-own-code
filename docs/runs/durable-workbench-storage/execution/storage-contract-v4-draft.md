# Durable native/workspace/session storage contract
Version: 4 | Date: 2026-10-04 | DRAFT unregistered, no consumers

P7 durable storage contract — candidate amendment, not current authority

1. Ownership and paths

Main owns durable app metadata and operation receipts. OpenCode owns its native database, transcript, inbox and event history. Renderer state is a disposable projection.

Resolve Documents with app.getPath("documents"). Create managed workspaces at Documents/OhMyOwnCode/{stableAppSessionId}. Allocate and journal that ID before folder creation or native dispatch. Rename does not move the folder. Additional sessions and forks can share the workspace; they do not copy it. If workspace creation precedes session creation, reserve the first session ID in the workspace record.

Keep imported paths in place. Unregister removes registration only. Confirmed conversation deletion removes native conversation data only. Neither action deletes project files.

Use a private, stable app storage root outside the ephemeral Electron profile and project folders. Resolve it before ephemeral path overrides. Use local app-data storage; verify the Windows resolver before release. Record canonical paths in the manifest. A changed Documents location does not move existing workspaces automatically.

2. Schema

Use versioned, validated records:

Manifest: schemaVersion, storeId, nativeVersion, storageGeneration, canonical storage paths.

Workspace: workspaceId, ownership(managed/imported/legacy), canonicalPath, folderSessionId?, registrationState, trust binding and revision.

Session: appSessionId, workspaceId, nativeSessionId?, parentSessionId?, lifecycleState, pinned, archived, lastViewedAt and last-observed native metadata.

Receipt: originalRuntimeEpoch, operationId, P4 canonical digest, immutable operation kind and scope, admission/delivery/effect states, dispatch steps, correlated native IDs, result references and revision.

Tombstone: removed identity, confirming receipt and revision.

Migration: migrationId, source/destination identities, inventory and hashes, phase, native mapping verification and cutover generation.

Do not store a second transcript in app metadata. Do not put credentials, message bodies or stale renderer snapshots in the receipt journal.

3. Journal and commit order

Use one serialized, append-only journal for app registry changes, receipt transitions and tombstones. Each record has a schema version, sequence, bounded payload, previous hash and checksum. Checkpoints are derived from the journal.

Flush admission before any effect. Flush a dispatch-intent record before each native or filesystem effect, including policy, agent and model changes. Flush correlated results before reporting durable success. A crash after dispatch intent means “may have executed”, even if dispatch did not occur.

Publish checkpoints through a flushed temporary file and atomic replacement in the same filesystem. Keep the previous valid generation. Verify file and directory flush behavior on each OS. Do not claim power-loss durability from rename or process-crash tests alone.

Any append/partial-write/file or directory flush failure poisons the writer into recovery-required. Preserve the failed bytes and original journal unchanged, reject every later append/mutation/effect service-wide, and retain reservations/dispatch intents/unknown scope holds. Never merely release a per-session lock and continue writes after a damaged tail. Failure before first effect proves zero native/filesystem effect calls for that request; failure after an effect preserves its flushed dispatch intent and unknown hold, and memory-only outcomes are never promoted to durable success. Operator recovery is a separate explicit reviewed record, never an automatic truncation or retry.

Complete each operation with ONE closed completion record containing its correlated redacted final receipt, required registry delta/native mapping/tombstone, and revision together. Flush that whole record before committing authoritative memory/snapshot/lookup-visible completion. App checkpoint/replay applies the completion atomically; create/fork mapping and receipt, removal tombstone/registry delta and receipt, metadata delta and receipt cannot become separate recovered facts. If no full validated/flushed completion record exists, retain prior reservation and dispatch intent with unknown hold; do not replay native effects. A crash after native effect but before completion preserves ambiguity. Standalone registry effects such as initial reservations are explicitly separate journal variants tied to the operation, never mistaken for completion.

Native SQLite and the app journal are separate commit domains. This contract does not claim one atomic transaction or exactly-once native execution.

4. Native storage and cleanup

Keep XDG_DATA_HOME and XDG_STATE_HOME in the durable native namespace. Preserve the complete native database set, including WAL files. Main must not edit native SQLite tables or infer its schema version from PRAGMA user_version.

Keep process roots, HOME/profile, cache, tmp and Electron session data disposable. Preserve the minimal child environment and do not inherit personal credentials or configuration. Cleanup can remove only verified disposable roots after owned-process exit. It must never traverse a durable root, imported path or migration source under retention.

Separate sidecar startup from session creation. Reopen registered native sessions; do not create a bootstrap session on every launch.

5. Locking

Acquire one exclusive lock for the canonical store before journal recovery or sidecar launch. Record an owner nonce, host identity and owned child identity. Serialize app writes under that owner.

A second instance must not write or start another sidecar. Lock age, heartbeat expiry and PID absence alone do not permit lock takeover. Reclaim only after proving that the old owner and its recorded child are gone. Otherwise expose recovery status and block mutations. Release the lock only after confirmed owned-child exit.

6. Recovery

Validate schema, checksums, references, paths, permissions and native-version compatibility before effects. Missing or denied paths stay registered as unavailable. Do not recreate, relocate or delete them automatically.

Restore unresolved receipts and resource holds across epochs. A new epoch does not clear uncertainty. Lookup must distinguish the current transport epoch from the original receipt key. Missing records, idle state, title matches and queue absence do not prove no effect.

For native create, persist the planned native ID and operation metadata before dispatch. Recover through exact identity and metadata checks. Never replay create to discover its result. Fork and command remain unknown when exact correlation is unavailable.

Retain unresolved receipts and dedup tombstones. Enforce admission limits before effects. Namespace retirement requires an explicit host recovery action and must retain unresolved holds.

Preserve corrupt journal bytes. Do not silently discard an invalid tail or rewrite an unsupported version. Recovery can expose a validated prefix, but mutations remain blocked until the recovery decision is recorded.

Verify native startup behavior for pending inbox items before claiming safe execution recovery. This contract does not permit automatic replay, resume or permission approval.

7. Migration and rollback

Migration is explicit. Pin the source against cleanup before quiescing it. The current stop-and-delete API is insufficient for this step.

Copy managed files and complete stopped native storage into staging. Verify inventories, hashes, native history, lineage and path mappings before cutover. Do not overwrite a collision. Do not rewrite native SQLite location fields.

Use SDK location or transfer operations only after proving that they preserve required history, lineage and pending state. Session export/import alone is not proof of complete native-state migration.

Journal each phase. Interrupted migration preserves source and destination and returns to recovery. If source data is already absent, report that limitation. Rollback must preserve both copies, new durable data and unresolved receipts. Older code that cannot read the schema must refuse writes.

8. Concrete initial implementation and limits

Use native app.getPath("documents") for managed folders and app.getPath("appData")/OhMyOwnCode/storage-v1 for private durable app/native state. Resolve before ephemeral overrides. Capture canonical roots and reject symlink/ownership escape; denied Documents never silently falls back to tmp. Managed paths remain their recorded location if Documents moves. App metadata contains registration and display names/paths locally; exposed diagnostic/receipt records stay redacted. Stable first session UUID names a managed folder; additional sessions never move/copy it.

The exclusive store owner uses Electron kernel-backed single-instance ownership tied to the canonical durable store plus a flushed owner record (nonce, app PID, native child PID, startup intent and clean shutdown state). Acquire before journal/native launch. Fixture injection must emulate the same owner API. A prior dirty owner may be recovered only when the kernel ownership is acquired and the recorded app/native process identities demonstrably exited. Missing native PID after spawn intent, live/unverifiable owner/child, corrupt record, another store root or pending native activity blocks sidecar launch and writes. Never silently kill an unverified PID or use lock age as proof. Actual lock path and ownership mapping are compatibility acceptance items; if Electron ownership cannot bind the store, stop before implementation proceeds and return a concrete alternative contract for independent review.

One allowlisted append-only JSONL journal is canonical app metadata/receipt authority with bounded record4MiB, sequence/hash chain and explicit variant validation. Maintain last valid checkpoint/previous generation, but never silently skip damaged bytes. Each append flushes before external effect or reported durable success. File+directory flush limitations on Windows are reported separately; process-crash evidence is not power-loss evidence. No blanket renderer persistence. Native config remains app-owned/private, data/state durable, process HOME/cache/tmp/Electron sessionData disposable. Durable native XDG namespace may contain credentials; no content goes into source, diagnostics, receipts, exports or external tools.

P4 receipt extension separates current envelope runtimeEpoch from lookup operation nested runtimeEpoch (original receipt key); old epoch key is looked up through validated durable ledger only. Restore unknown scope holds and allowlisted receipt identities in snapshots; no trusted execution/permission hydration. Before native startup, journal/native startup preflight must prevent pending inbox replay/resume. Current research with authentication-free synthetic inbox is insufficient to claim provider-configured behavior. Persisted unresolved/nonterminal operations block automatic execution recovery. Verify the pinned native queue/startup semantics through a saved script; if safe read-only startup is unsupported, preserve original store and expose recovery-required without launching native against it. Do not automatically drain/replay/approve old work. This may be an honest dependency hold on external authenticated verification, not silent PRD scope reduction.

Fresh installation creates durable bootstrap workspace/session once through journaled reservation; subsequent startup reopens the mapped native ID and verifies exact location/metadata. Native create's chosen ID is correlated evidence only with app digest/metadata, never a dedup replacement. Fork/command ambiguity remains unknown. Native transcript is reopened through SDK reads, not restored from renderer projection.

Migration is explicit and reversible: record source retention before stopping old cleanup-owned runtime; copy complete quiescent files/database set into a noncolliding staging namespace and compare inventories/hashes. Existing imported paths never migrate. Do not rewrite native tables/paths. Until a native transfer/location adapter proves history/lineage/inbox preservation, keep legacy location recovery and hold cutover. No existing active/private source is migrated during automated tests; use synthetic sentinels. Missing old ephemeral content is reported as already unavailable, not reconstructed.

9. Candidate publication and clocks (version4 draft; independent review required)

Use one operation-local candidate over bounded metadata tables and one committed-root publication. Journal/registry owns allowlisted admission, reservation, dispatch and completion serialization. Completion validates/rebases its delta against the latest committed receipt/registry root, appends/flushed one closed record, then replaces the committed root without await or failure-prone callbacks. Concurrent BUSY rejection/admission receipts cannot be overwritten by an older whole-root candidate. Candidate metadata, native mappings, deletion and confirmed receipt are never visible through snapshot/lookup before that publication. Native transcript/permission detail remain a disposable derived projection, not journal payload. Copy mutable metadata Map/Set objects so candidate and committed root do not alias. Native reads captured before a mutation revalidate exact resource identity/generation/trust and discard stale projections before publication; they cannot mutate committed Session metadata or publish candidate state.

Separate durable registry revision from ephemeral observation order. Snapshot `revision` and receipt `revision` identify the durable metadata/operation commit revision; expectedRevision guards that committed revision. Add a bounded monotonic current-runtime `observationSequence` to snapshot DTOs for fresh native transcript/status/health observations without app transcript persistence or a durable append per read. Allocate observation sequence at accepted DTO publication from a committed root; never expose candidate revision. Renderer sole store retains registry revision floor and accepted observation sequence together, rejects older metadata revision before any health/list/payload change, and permits fresh same-revision observations only when their sequence is newer in the current epoch. Bootstrap establishes new epoch/sequence; old-epoch receipts cannot raise current floors. Read scope health/error and interrupt-notice freshness must include observation order as well as existing epoch/target/selection generation so unchanged registry revision cannot admit stale health. Files retain their independent identity/trust/path/generation contract. No new transport envelope operation fields or transcript cache; define/freeze exact host DTO and reducer acceptance tests before renderer consumer. This is a wire/state semantics amendment, not an implementation-only shortcut.

Operation completion may atomically publish an EXACT verified partial native mapping with an unknown receipt and unavailable lifecycle when later policy verification failed; this is not usable success or permission hydration. Unverified IDs/metadata remain reserved/unknown and unpublished. Completion flush failure leaves the prior committed root plus safe recovery/unknown holds and no newly confirmed mapping/tombstone. Every policy/agent/model effect has its own flushed dispatch intent and actual call evidence; prompt flag cannot erase earlier side effects.

A complete checksum-valid tail after an unconfirmed flush cannot establish the prior writer reported success. Dirty owner/writer recovery does not automatically promote such a tail or resume effects. Preserve all bytes and expose recovery_required with the last explicitly validated checkpoint and conservatively reconstructed uncertainty. Any adoption of additional validated surviving records, new generation/checkpoint or resumption is an explicit host recovery decision record after native/app preflight and owner checks, retaining original data; never automatic truncation/reappend, success-marker invention, native replay or native SQLite mutation. Confirm this crash/flush policy through fault and saved restart probes; do not claim power-loss proof.

Version4 draft acceptance adds same-registry-revision newer observation updates, lower-registry-revision with higher-observation rejection, stale health after newer observation, old-epoch receipt floors, in-flight read during completion flush, concurrent BUSY rejection retained by publication, every intermediate policy/model dispatch flush failure, partial native mapping unavailable, and complete-valid-tail unconfirmed-flush recovery hold. Source consumers remain held until P6 finishes, exact plan/contract/doc binding is registered and independent entry/design_spec changed-concern passes exist. Existing parent PRD/architecture decisions and P4 admission/capacity/unknown semantics remain unchanged.

10. Exact DTO and renderer observation amendment

WorkbenchSnapshot adds required `observationSequence: number`. It is a positive safe integer, scoped to `runtimeEpoch`, allocated once for each accepted snapshot publication. `revision` remains a nonnegative safe integer for the committed durable root. RedactedReceipt revision remains durable; it does not acquire a fabricated observation sequence. Transport read/mutation/lookup envelope shapes stay unchanged. Snapshot DTO construction, fixture construction and renderer acceptance reject missing, negative, fractional, unsafe or nonfinite clocks before any state change. If the host exhausts the sequence range, fail closed before publication rather than wrap or reuse an epoch. All producers and fixture DTOs change under one frozen integration checkpoint before renderer consumers begin.

Renderer State adds an accepted `observationSequence`, initially 0. Local Scope captures that number with epoch, metadata revision, selection generation/identity and trust revision. This is a renderer freshness token, not a new bridge request field. Reject lower metadata revision first, even when the incoming sequence is greater. Within the current epoch accept a snapshot only when its sequence exceeds the last accepted sequence; equal sequence is a duplicate, including at a higher metadata revision. A receipt can raise the metadata floor without raising the observation sequence. A subsequent snapshot at that floor can update the projection if its sequence is newer. A bootstrap-only new epoch resets the accepted observation order after existing retired-epoch and target guards. Never permit old-epoch receipts or ordinary reads to reset those clocks.

Late read failure may set connection/error state only if captured epoch, target/generation, metadata floor and observation sequence still match. An accepted snapshot itself supplies authoritative current connection state at its newer observation sequence. Snapshot failure cannot allocate a successful snapshot sequence. Catalog, files and diagnostics DATA remain independently guarded by their existing target, trust, path/filter and request-generation identities: snapshot polling alone must not cancel otherwise valid slow payloads. Their stale response cannot change connection health, current selection or interrupt notice. Payload-specific error text follows that payload's current request identity; it is not permission to replace newer connection health. Include several intervening accepted snapshot polls in each slow-read test.

An interrupt notice records the current epoch/target/generation, the durable receipt floor and the accepted observation sequence when the notice is created. Only an accepted current-target connected idle snapshot with revision at least that floor and sequence strictly newer than the notice can retire the notice. ACK is not a stopped observation. A snapshot that fails acceptance cannot retire it. Notice retirement never removes the unresolved original receipt or releases unknown send/command holds. Keep existing target change, disposal, cancellation and draft-preservation rules.

App Session registry owns identity, native mapping, user lifecycle metadata and tombstones. Native title/status/agent/model observed through SDK reads are projected into a bounded ephemeral read result and never written into the committed registry as an incidental read. App-origin title/archive/pin changes become committed metadata only through the closed completion record. A snapshot uses the committed root captured and revalidated at publication; native-derived fields cannot resurrect a removed session, replace an unverified mapping or cross trust/target generations. Native messages and pending permission detail remain outside the journal.

The exact renderer-unit command is `node --import tsx --test apps/desktop-app/src/workbench-store.test.mjs`; coverage includes clock validation, duplicate sequence rejection, higher-sequence/lower-revision rejection before health/lists, new-epoch bootstrap, old receipt floors, same-revision streaming/idle update, ACK-plus-later-idle notice retirement, stale error suppression and valid slow catalog/file/diagnostic data across repeated snapshot polls. This addition requires the revision4 contract entry before it can count as a required check.

11. Tradeoffs and compatibility checkpoint

A journal append per native read would persist transcript-derived observation order, increase disk writes and couple polling availability to the writer; it is rejected. Keeping only the old revision would discard same-root native streaming/status observations or require reads to mutate durable revision; it is rejected. The separate current-runtime sequence keeps one renderer projection owner and one durable metadata authority at the cost of a coordinated snapshot DTO/reducer change. No Query/XState/cache or alternate runtime is added. Refuse old/missing-clock snapshots; do not silently synthesize a clock from wall time, renderer arrival order or a receipt. Source consumers ship coherently, not mixed-version over a live runtime.

Bounded metadata candidate copying is chosen over a complete immutable persistent-data library or unchecked shared Maps. At current workspace100/session200 bounds the simpler copy is acceptable; clone only required metadata, keep native transcript external and rebase deltas under serialized registry ownership. Whole-root replacement without rebasing loses concurrently recorded rejection/admission facts; mutation-only mutex without immutable committed reads exposes earlier in-flight reads. The API checkpoint must demonstrate these adversarial cases before host integration. Storage/source API rollback retains original bytes and refuses writes to unsupported version rather than downgrading the schema. Migration/native queue compatibility remains separately held when unproved; these limits do not authorize an alternate engine or silent scope reduction.
