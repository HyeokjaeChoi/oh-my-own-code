# Bounded P3 code repairs

2026-10-03. Functional repairs remain separate from the user-directed compact design comparison. Production visual adoption and P4/P5 consumers are held by the latest feedback; the historical design pass does not override it.

## Confirmed draft cleanup

Fresh worker /root/p3_confirmed_draft_cleanup, requested gpt-6.1-sol/medium. Changed app/useWorkbench.ts, app/index.tsx and workbench-projection.test.mjs only. Successful session.remove snapshot notifies the existing draft owner with exact workspace/session identity regardless of current navigation generation. The owner removes only that key. Worker reports24/24 navigation/projection tests passing, including A→B, A→B→A, same session ID in another workspace, and preserving drafts for unknown/error/cancellation/transport failure. Owned ESLint, Prettier and desktop TypeScript checks passed. No CSS, new store or dist rebuild.

## Capture provenance

Fresh worker /root/p3_capture_provenance, requested gpt-6.1-sol/high. Changed build.mjs, run-evidence.mjs/test.mjs and added bounded build-provenance helpers/tests/fixture. Actual build stamps source/config/lock/token/asset inputs and emitted outputs only after stable before/after inventories; capture validates stamp before native launch and after completion. Script/fixture identity is separately recorded. Packaged smoke verifies ASAR and sidecar bytes. Worker reports17/17 helper/wrapper tests and owned ESLint/Prettier passing. No rebuild or historical manifest relabelling.

Both workers froze their owned files. Results above are worker-reported evidence; no new native capture, package launch or independent repair code pass is claimed. The input inventories are local scoped SHA256 records, not signed attestations, harness fingerprints or filesystem isolation. Dependency/compiler/Electron runtime trees and change-and-restore between observations are not covered. A later integrated build and fresh capture must occur in new attempt directories; old r7 captures remain historical.
