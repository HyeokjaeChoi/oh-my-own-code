# Durable owner lifetime — revision1

2026-10-07. Initial bounded runtime ownership extension. Parent: durable-workbench-storage plan revision7 and unchanged storage-contract v5. User authorized continued local implementation and requested no unnecessary stops. Existing Documents/import preservation, Electron singleton, exact lifetime requirement, no replay and no provider/private-store/foreground execution remain.

## Outcome

Persist exact kernel-observed app and owned Native child exits across app epochs, using a bounded observer with no executor or journal authority. Production owner reacquisition may consume complete, generation-bound evidence; missing, uncertain or mismatched evidence keeps `owner_unverified`. This increment does not authorize nonfresh Native startup: `freshNativePreflight` remains unchanged. Safe nonfresh Native startup is a separate pending concern.

## Decision

Select a small macOS C helper using libproc birth identity plus boot UUID and `kqueue(EVFILT_PROC, NOTE_EXIT)`. Ship its exact built bytes as a verified runtime resource. It attaches while each identity is alive, verifies identity before and after attachment, flushes a registration acknowledgement, then records the actual exit event. Its evidence is bound to canonical root, root device/inode, owner nonce, role and the exact process identity. Main supplies a new contextual `lifetimeWitness` dependency to the owner; no hidden lookup of owner.json inside a PID adapter, clean-marker bypass or age-based recovery.

An observer-only helper was chosen over a launch broker because the existing owner already owns spawn/dispatch fencing. This preserves the conservative spawn-registration gap: `spawnIntent` without a recorded child is never repaired from helper data. A broker, Linux/Windows implementation, automatic recovery/adoption and Native queue execution remain outside this increment. Same-user tamper resistance is not an OS sandbox guarantee.

## Acceptance

- W1: Register the exact app lifetime before publishing a new ready owner. Register the exact child before any server init/API call. Every failed or absent registration produces zero dependent effects.
- W2: Reacquire an unchanged owner record under the same canonical Electron singleton using complete exact app/child kernel exit proofs, without injecting parent `ownedExited` or treating PID absence as proof.
- W3: Live identities, wrong nonce/root/inode/role/birth/boot, unsupported/corrupt/partial proofs, symlink/hardlink, uncertain flush, incomplete registration and spawn gap stay blocked; retain original bytes.
- W4: Helper writes only its own immutable generation evidence, never journal/owner/project/Native data. Clean/abrupt app exits settle its registrations; helper failure never authorizes takeover. Bounds and owned cleanup are explicit.
- W5: Exact helper packaging, actual zero-window standalone owner restart evidence and appropriate independent code review cover coherent source. No production-window/provider/Windows/power-loss claim.

## Order and ownership

Main owns plan/design/contract, handoffs, evidence and ledger. Obtain one initial independent plan pass and matching design-spec pass for this new runtime boundary. Freeze helper IPC/evidence and contextual witness API before consumers. One worker owns the helper and its build/verification modules/tests; a disjoint worker owns witness adapter and owner tests after API freeze. A single host writer then integrates Main/event-host child registration, shutdown and packaging consumers. No overlapping writers or recursive delegation. Reviewers are read-only and distinct from authors. Routine corrections need concise plan, affected checks and independent code review; no repeated architecture entry rounds.

Implementation is dependent on the accepted design. Fresh probes use temporary synthetic namespaces, real Electron singleton with no BrowserWindow, exact packaged helper/native bytes, and app/child handles only to assert cleanup; those handles are not injected into recovery verification. Original evidence and namespaces remain preserved.

## Verification and limits

`owner-lifetime-unit` covers adversarial proof and registration boundaries using injected failures. `owner-lifetime-native` exercises owned zero-window app normal/abrupt exit followed by a separate standalone instance using the production witness verifier. Static/type/boundary checks and actual packaged inspection cover consumers. Any existing source change also refreshes affected parent P7 checks before final P7 review. Unverified historical pre-witness stores remain recovery-required. A witness crash or simultaneous process/witness crash may prevent recovery and must retain the store. Nonfresh Native, pending inbox, migration cutover, provider, Windows and power-loss stay explicit holds.
