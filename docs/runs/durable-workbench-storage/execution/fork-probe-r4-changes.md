# Saved actual fork correlation correction

Main extended only p7-storage-probe.mjs and fixtures/workbench-host.test.mjs after durable-owner-lifetime reached its immutable completed record. No renderer, DTO, registry, journal or production service change is part of this correction.

The saved sequence now creates a real Native SDK fork through the production durable service after the existing synthetic SDK history transfer. It verifies the original child admission/receipt, same-key duplicate without a second fork, exact parent native/app mapping and inherited root metadata/location/history. Separate controlled normal and SIGKILL reopens verify the same child identity is available and the original nested epoch key is still lookup-only through the current envelope.

Contracted native-storage r4 passed. native-storage-evidence.json contains native-fork-normal-controlled-reopen and native-fork-SIGKILL-controlled-reopen with exactLineage/historyPreserved true. Source/build/package/native/script before-after identities are unchanged and failedRequirements is empty. All tracked app/native process exits are confirmed; deliberately retained SIGKILL runtime roots are not described as deleted or clean.

Authority stays explicit: these reopens use the trusted synthetic startup callback and parent-observed owner exit identities. They verify the actual service/Native fork correction, not production nonfresh safe startup. The separate completed lifetime run uses the actual historical OS witness without injected exits.

The meaningful Node regression checks original key/current envelope and corrupt original receipt/digest/parent/location/metadata; every helper handle request is a snapshot or lookup, never a resend. Its initial invalid selected-session fixture and unqualified structuredClone lint error were corrected. Initial failure log is preserved in native-fork-probe-unit-r4.log; final targeted result is 1/1 pass in native-fork-probe-unit-r4-fixed.log. Full fixture suite and final changed-script static checks follow. Parent final independent code/UI binding will be refreshed after the new preflight source is coherent.
