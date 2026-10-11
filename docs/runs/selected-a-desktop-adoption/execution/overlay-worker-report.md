# Overlay worker result

Plan: selected-a-desktop-adoption revision 1. Scope: A1/A2/A3 assigned primitive, prototype, and native test slice.

## Delivered

- ActionMenu: desktop trigger/rows 32px, coarse-pointer trigger/rows 44px, 2px menu inset, trigger icons 16px. Retains Radix DropdownMenu dismissal, keyboard navigation, focus return, portal/layer ordering. No document event workaround added to production primitives.
- ModalSheet: left navigation sheet 216px, header 44px, close trigger 32px (44px coarse), close icon 18px. Retains Radix modal background isolation, pointer dismissal and focus handling. No production dismissal defect was proven in static inspection; no behavioral wrapper override added.
- New preview copies the frozen composer-room four runtime files. Changes only the copied app/styles: topmost menu close, preserved parent dialog when opening a nested menu, outside Pointer Events for mouse/touch, consumed matching click to prevent backdrop click-through, focus restoration and selected A drawer/menu sizing. Synthetic-only/fake-state disclosures remain. Frozen composer-room was not changed.
- Native Electron state script now checks approved initial 120/72/32 composer geometry, exact desktop 32px composer controls and 36px permission actions, coarse-pointer 44px composer controls, long-input bounded cap, inside menu/sheet interaction, outside mouse/CDP synthetic touch dismissal, background click observer and host request count, nested ActionMenu in navigation sheet, topmost Escape and focus restoration. Existing lifecycle/tool/permission state tests, capturePage fullnative capture and provenance remain.

## Executed checks

- node --check apps/desktop-app/scripts/e2e-workbench-states.mjs: pass.
- node --check docs/runs/selected-a-desktop-adoption/preview/app.js: pass.
- node --check docs/runs/selected-a-desktop-adoption/preview/data.js: pass.
- pnpm exec prettier --write packages/ui/src/primitives/action-menu.module.css packages/ui/src/primitives/modal-sheet.module.css packages/ui/src/primitives/modal-sheet.tsx apps/desktop-app/scripts/e2e-workbench-states.mjs: pass.

## Pending coordinator checks

Native execution intentionally held until final integrated production build. Main must run the reviewed static/boundary/build/native contract and independent gates. Native output remains supplied by run-evidence wrapper at docs/runs/frontend-architecture-redesign/execution/selected-a-adoption.

CDP touch is synthetic input through Electron Chromium; it is not evidence for a physical touch device. No Windows, physical IME, live provider or runtime pass is claimed by this report.

## Changed paths

- packages/ui/src/primitives/action-menu.module.css
- packages/ui/src/primitives/modal-sheet.module.css
- packages/ui/src/primitives/modal-sheet.tsx
- apps/desktop-app/scripts/e2e-workbench-states.mjs
- docs/runs/selected-a-desktop-adoption/preview/index.html
- docs/runs/selected-a-desktop-adoption/preview/data.js
- docs/runs/selected-a-desktop-adoption/preview/styles.css
- docs/runs/selected-a-desktop-adoption/preview/app.js
- docs/runs/selected-a-desktop-adoption/execution/overlay-worker-report.md
