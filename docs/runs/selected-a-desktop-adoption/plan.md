# Selected A desktop adoption
Revision: 3 | Date: 2026-10-03
Status: Ready for independent entry review.

## Authority and outcome
User explicitly approved final A Quiet Dock and requested production implementation plus outside pointer/touch dismissal. Source: docs/runs/composer-room/amendment.md, its preview/data.js, and docs/runs/desktop-design-candidates/synthesis/design-systems.json. Existing frontend-architecture-redesign revision6 architecture remains authoritative. No new platform/library decisions.

## Scope and acceptance
A1: Real Electron renderer adopts A: sidebar216, header44, body15/24, composer120 with input72 and toolbar32, reading width720. Preserve assistant-ui, Tool UI, truthful session and permission states; attachment and narrow layouts remain usable.
A2: Menus and dismissible modal backdrops close on outside pointer/touch; inside does not close; Escape and focus restoration work; nested layers close only topmost. Backdrop must not trigger underlying actions. Persistent permission requests are not silently dismissed.
A3: Affected static checks, build and native Electron synthetic fixture checks pass with current provenance and screenshots. No claim of Windows runtime or live-provider verification.

## Assignments and sequencing
1. Fresh independent plan reader checks this bounded amendment.
2. Parallel disjoint fresh workers: UI owns renderer app/features and canonical design tokens; overlay worker owns packages/ui primitives, native state E2E script, new-run prototype copy. Neither changes architecture, sidecar/security, state ownership or parent plan. Main integrates.
3. Main runs checks and captures native Electron after integration. Fresh independent reader judges code and rendered UI under separate final bindings.
No unresolved question blocks execution. First increment is running selected empty session + dropdown/modal outside dismissal. Failures in fixture mismatch or layout lead to source correction, not redesigning approved A.

## Verification and ownership
UI worker: apps/desktop-app/src/renderer/**, docs/design/tokens/**.
Overlay worker: packages/ui/src/primitives/**, apps/desktop-app/scripts/e2e-workbench-states.mjs, docs/runs/selected-a-desktop-adoption/preview/**.
Coordinator: plan/contract, integration, ledger, checks, outcome. Reviewers read only.
Final code and actual UI gates required; existing approved architecture and selected A design are reused.

## History
Revision1: Implement final user approval, add explicit outside-dismissal acceptance.

Revision2: Preserve failed native attempt. Contracted native retry writes a new immutable selected-a-adoption-r2 evidence directory; scope and acceptance unchanged. Existing32 desktop/44coarse and36permission criteria remain.

Revision3: Native check now invokes run-local run-native.mjs, bound through environment_files, to allocate immutable unique attempt directories under the existing wrapper root. Keeps exact production ui-states runner and byte provenance. Fixes backdrop observer counting the opening trigger as click-through by resetting the counter after the modal is visible. No acceptance/scope changes.
