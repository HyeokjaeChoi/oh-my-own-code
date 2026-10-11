# P4 implementation notes for the next handoff

Status: coordinator discovery notes, not a new design contract or permission to start P4. Plan revision6/specv4 remain authoritative. Dependent execution waits for P3 rendered judgment.

Existing source facts:

- main.mjs admits the one window/frame and currently calls service.handle(operation) without sender context.
- preload.cjs currently exposes one closed workbench invoke; desktop-bridge.d.ts describes operation DTOs.
- service.call races every underlying SDK promise against a five-second signal. The race settling does not prove the SDK promise completed or honored cancellation.
- service ready initialization precedes request execution; the whole-read deadline must include waiting for it.
- mutations have uneven legacy requestId fields; permission.respond.requestId denotes a native permission request, unlike send/lifecycle dedup IDs.
- renderer/shared/request.ts currently awaits invoke directly. useWorkbench watchdogs change display state but cannot settle never-ending promises or release real host work.

Implementation constraints already required by the reviewed amendment:

- Preserve real underlying-work tracking. Read admission must not release a slot merely because service.call raced out. Track nested SDK fan-out and the top-level task until they actually settle; ignored cancellation quarantines capacity. A scoped host context/record may carry the read signal and pending work, but no second payload cache.
- Receipt lookup stays local and available before/through stalled initialization or exhausted snapshot capacity. Four logical classes are snapshot, catalog, files and reserved lookup; diagnostics must be assigned explicitly to an existing class, never an unbounded fifth queue.
- Pass the admitted sender identity to scoped read/cancel operations. Cancellation must not cross sender, read ID or runtime namespace. Preload remains narrow; no arbitrary SDK method or host channel capability.
- Freeze exact discriminated wire DTOs before renderer consumers. Mutation operation IDs, transport read IDs and native permission IDs are different. Normalize legacy dedup IDs deliberately; never let two envelope IDs accidentally reuse one legacy effect and claim independent confirmation.
- All mutation admission precedes dispatch; include workspace import/create/remove, session create/lifecycle/send/command/interrupt and permissions. Duplicates return the original record, different digests reject, unresolved/tombstone records are not silently evicted.
- Every result distinguishes admission, delivery and effect. Positive evidence is tied to the operation; idle, title/existence, missing permission, unrelated reads or a new epoch cannot resolve ambiguity.
- Renderer timeout settles its local wait and issues only bounded lookup/cancel. Preserve draft and original identity, never retry mutations. Existing internal lifecycle/send dedup remains until the atomic caller+host contract cutover is verified.
- Tests need real work counts, ignored abort, late completion, coalescing, cross-sender cancellation, stalled initialization with available lookup, duplicate/conflicting mutations and operation-specific evidence. An AbortSignal/timeout label alone is not a cancellation proof.

P4 is a coherent host/preload/DTO/request-adapter change. Do not concurrently assign overlapping writer paths or pretend the new contract is deployed while callers/fixtures still use the old one. P5 then migrates one window-scoped Zustand owner and removes duplicate hook refs; P4 does not introduce that store prematurely.
