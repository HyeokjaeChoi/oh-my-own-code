# Preserved implementation check history

These are coordinator notes from actual tool results, not recreated raw logs.

- Initial root esbuild resolution failed before extraction. Later commands in that shell invocation checked missing new files and the old helper suite, so its final exit0 was not proof of the extraction. Fixed by resolving the actual existing desktop-app dependency through createRequire. No dependency added.
- New shared JS lint found unqualified TextEncoder and an unnecessary regex escape. Main used globalThis.TextEncoder and corrected the character class; subsequent targeted lint passed.
- New epoch cancellation test omitted the required bootstrap snapshot scope, so the store correctly ignored the epoch change. The test invocation was interrupted while awaiting that fixture. Added the real bootstrap scope and explicit epoch assertion; no production acceptance weakening.
- Supersession test initially expected a new read while the cancelled actual task was still unsettled. Actual transport correctly returned READ_BUSY. The regression now verifies READ_BUSY, no automatic retry, actual old-task settlement, then a new explicit load; no lane weakening.
- Targeted store/controller selection passed18 tests including6 nested cancellation scenarios. Targeted service/contract/shared/fixture selection passed11 tests. These targeted results do not replace the full contracted suite now recorded in run.json.
- ESLint reports validation.d.mts ignored by its current configuration; desktop tsc checks its declarations. ESLint exit0 is not separate lint coverage for that declaration.

- First contracted hidden-ui invocation failed before launch because the required parent evidence directory did not exist (ENOENT). Created the contained parent and reran unchanged source/argv; failed attempt remains in run.json.
