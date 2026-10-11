# Native r1 preserved findings

Actual first normal-native owner registration failed. app.registration and context.json were retained, but owner.json was never published. macOS directory link count changed after the helper created its own proof file, and the C helper incorrectly compared this mutable field. The independent reviewer identified the defect. The helper now uses its directory identity comparator; regular proof single-link checks remain.

The old report cleanupUnconfirmed=false covers only retained app/observer ChildProcess handles. It did not observe the production helper exit and must NOT be read as descendant cleanup acceptance. No historical missing PID is treated as exit. The r1 report and namespace remain unchanged. Fresh r2 tracks observed helper/native descendants, exact exit evidence and unconfirmed failures, and adds missing/incomplete/live-child denial scenarios.

Routine correction stays within accepted design2; no DTO, journal, owner-record or nonfresh Native authorization change. Final independent code review remains pending.

Native r2 confirmed durable app ACK and owner publication, then timed out before Native spawn. Independent source review found Electron ESM module evaluation awaiting app.whenReady while Electron emits ready only after module evaluation finishes. Pre-ready path/kernel/owner ordering is preserved, with only the post-acquisition whenReady/Native continuation detached from top-level await and an explicit failure handler. The fresh r2 report correctly marks helper cleanup unconfirmed; no missing PID is accepted as helper exit. Fresh r3 tests the corrected entry.
