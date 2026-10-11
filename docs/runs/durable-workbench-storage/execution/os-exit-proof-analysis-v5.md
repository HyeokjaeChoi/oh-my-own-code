# Actual same-boot restart blocker

Main inspected frozen storage-lock acquire and current Host OS adapter. acquire verifies BOTH old app and recorded child have exited, even when cleanShutdown is true. Current Darwin birth/boot capture supports live identity and current owned child exit, but historical same-boot missing PID remains unverified. Normal standalone app restart is therefore not yet proved or enabled merely by a clean marker. Controlled parent-owned process exit evidence is a separate test boundary.

No checkpoint-module change or clean-marker bypass is authorized. The public app contract still requires exact lifetime proof; PID absence, elapsed time, heartbeat, or replacement at the same PID are insufficient.

Primary Apple source research: libproc proc_pidpath_audittoken uses PID version comparison; XNU proc_info checks PID version/unique ID and returns ESRCH for missing or mismatched identities. This is informative but is not an observed exit event and does not by itself satisfy the frozen stronger verifier requirement.

- https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h

Candidate next bounded concern: an OS lifetime witness registered while exact app/child identities are alive, preserving exact NOTE_EXIT/owned-handle evidence across app epochs, with flushed nonce-bound proof. It must not execute Native work, kill unknown processes, modify the journal after owner release, or accept an incomplete spawn-registration gap. A persistent helper introduces ownership, packaging, shutdown and proof-integrity concerns and requires an independently reviewed design before source implementation. Alternatively a reviewed exact kernel lifetime query could satisfy the contract only if its conclusive termination semantics are demonstrated, not inferred from PID absence.

Current source integration proceeds against conservative recovery. Full P7 acceptance must retain this unresolved capability until an authorized reviewed solution and actual OS evidence exist; synthetic pass cannot substitute for normal production restart.

## Supplemental observed kernel lifetime event

Main ran p7-kqueue-lifetime-research.py with system Python3.9.6. A separate witness attached EVFILT_PROC/NOTE_EXIT to an owned synthetic process after comparing its exact libproc birth identity before and after registration. It observed the kernel exit event. Both owned processes exited. No Native, windows, durable store, provider or private Documents were used. This establishes a local primitive only, not durable proof or production restart.

First scratch attempt failed because Python3.9 kqueue is not a context manager; explicit close repaired the scratch API use. This did not change production source.

Primary reference: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html

Still required before integration: exact nonce-bound immutable witness proof format, same canonical root/path/permissions/checksum validation, attach-ack gap refusal, helper launch/lifetime ownership, app+Native child proof, helper exit/cleanup, concurrent instance ordering, no journal mutation by witness, bounded retention, package runtime support and independent changed-concern design review.
