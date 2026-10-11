# Coordinated host-local API repair

Contract v5 requires exact persisted operation digest and native metadata correlation on reopen. The wire DTO/readView/lookup remain redacted and frozen. Main authorized the fresh journal/registry correction worker to add lookupIdentity({runtimeEpoch,operationId}) returning a defensive copy of the validated original admitted identity or undefined. The host must wait for actual corrected source hashes before consumption. This method is host-local, read-only, and cannot allocate observation order, append, or restore an effect. Invalid key validation and copy isolation require tests.

Main also authorized host-local service drain() for actual task settlement before shutdown checkpoint and owner release. No renderer/factory shape change.
