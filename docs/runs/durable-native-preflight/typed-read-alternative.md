# Typed copied-state alternative — factual draft

2026-10-08. Not an accepted design or permission to execute Native queries. This document narrows a potential correction to the original high-level API draft. Main is still completing current independent renderer review; original nonfresh Native startup remains held.

## Why another read boundary is needed

The high-level SessionStore DTO omits empty non-null parent fields and Inbox.list cannot discover orphan rows. Those omissions can be closed by the public `@opencode/core/session/sql` tables with the official Drizzle query builder on a copied readonly connection. Read only bounded selected columns, not message/inbox payloads or credentials. SessionTable raw `parent_id` and `time_suspended` must both be exactly null. SessionPendingTable and SessionInboxTable global id-only queries must be empty; global queries include orphan rows and do not depend on session enumeration. Public `@opencode/core/kv/sql` KVTable key-only limit1 must be empty without decoding any value. SessionTable id/location/fork/metadata predicates must also exactly match committed host mappings and validated receipt lineage.

## Schema compatibility is a separate condition

The public `@opencode/core/database/migration.gen` exports the pinned migration definitions/IDs. Ordinary startup uses public DatabaseMigration.apply, which selects existing migration IDs and invokes each missing migration's up effect. The readonly inspector MUST NOT run any migration up effect: readonly SQLite alone does not prevent filesystem/network effects before a rejected DB write. A reader is evaluating those actual paths separately. Merely calling apply on a readonly connection is not accepted as an inert capability proof.

One possible explicit typed-ledger adapter describes the pinned native migration ledger's `id` and `time_completed` columns, as defined by the official DatabaseMigration source. It uses Drizzle SELECT on the COPY only, requires exact equality with public pinned migration IDs and well-formed completion times, and rejects absent/extra/unsupported ledger state. It defines no CREATE/ALTER/UPDATE/DELETE/PRAGMA and imports no private chunk. This is an app compatibility reader for a pinned native format, not schema adoption or app ownership of Native data. It does add coupling to the non-exported ledger table descriptor, so that choice requires the single initial independent architecture review and exact source/resource/runtime probes; the high-level draft does not authorize it.

Alternatively require an official exported readonly schema-compatibility capability and keep the hold until it exists. Do not label legacy V1Migration.status as that capability. All options retain exact copied-set/owner/registry/resource binding, original content and inode/permission/mtime/ctime preservation; ordinary read access time is excluded from an immutability claim.

## Required negative and positive evidence

Reject every global inbox/pending row, malformed raw parent/claim/fork, unmapped native ID, any KV key, missing/extra/incomplete migration ledger and legacy-required state. No effect may run to manufacture those predicates on a stopped original. Official synthetic creation/claim/admission/KV producers are used only in explicitly contained test stores; corruption fixtures are copied states with a separate source and cannot be real user stores.

Positive restart still needs a reviewed pinned server init graph: no lifecycle auto-restart, no pending recovery/drain or background job action during acquisition, no unverified migration, controlled config/feature flags, no credential/provider invocation as part of the inspector. All original bindings are checked again after the inspector exits and before executor spawn. Actual normal/SIGKILL/fork reopen probes use the production preflight, never trusted synthetic overrides. If any of these conditions remains unsupported, original nonfresh startup remains held and acceptance stays open.
