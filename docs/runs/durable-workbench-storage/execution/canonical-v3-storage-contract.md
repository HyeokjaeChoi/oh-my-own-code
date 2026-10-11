# Durable native/workspace/session storage contract
Version: 3 | Date: 2026-10-03 | Design review pending

P7 durable storage contract — proposed

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
