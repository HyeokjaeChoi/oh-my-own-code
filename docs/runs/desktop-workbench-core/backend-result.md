Implemented the frozen backend contract within owned paths.

Changed under `apps/desktop-app/src/`:
- `workbench-service.mjs` and tests
- `workbench-contract.mjs` and tests
- `desktop-bridge.d.ts`, `main.mjs`, `preload.cjs`
- Minimal accessor in `sidecar-supervisor.mjs`
- `host/workbench-files.mjs`

Validation: **34/34 focused Node tests passed** across contract, service, supervisor, and renderer admission. Owned-file ESLint, Prettier, and DTO TypeScript checks passed.

Limitations: synthetic fixtures only; no live Electron/provider/network execution. Registration remains temporary, receipt storage is bounded, and unknown execution outcomes block resending. Integration and independent review remain with the primary.