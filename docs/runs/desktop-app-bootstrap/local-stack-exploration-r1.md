# Local stack exploration — desktop bootstrap

Read-only repository map for focused desktop-app-bootstrap plan revision 20. Inspected plan, contract, r20 review, current registered product/design documents, ADR-0002, OpenCode research packets, workspace manifests, app project targets, bridge/renderer source and tests, and the SDK UI feasibility spike. No application commands, tests, installs, `opencode` executable, global configuration, credentials, or network were accessed.

## Current stack and ownership

- Root workspace: pnpm 11.17.0 (`package.json`), Node `>=22.12.0`; workspace patterns are `apps/*` and `packages/*`. Nx 23.2.1 drives targets; Vite 8.3.0 builds the React 19.2.4 web renderer. Root dependencies do not include Electron, `@opencode/client`, `@opencode/sdk`, or a server binary.
- `apps/workbench-web` is tagged `platform:browser`. Its `dev`, `build`, `lint`, `format-check`, `typecheck`, `test`, `e2e`, and `boundaries` targets are declared in `apps/workbench-web/project.json`. Boundary check depends on `build`; browser E2E starts Vite and the local bridge.
- `apps/local-bridge` is tagged `platform:server`, depends only on shared contracts, and provides the HTTP pairing, bearer-capability, synthetic snapshot/events, heartbeat/revoke implementation. Its unit tests are `apps/local-bridge/src/http.test.ts` and `runtime-info.test.ts`. Its existing browser pairing/CORS behavior is a separate supported mode and useful regression coverage, not Electron admission or sidecar proof.
- The renderer is tightly coupled to pairing in `apps/workbench-web/src/pages/workbench/ui/WorkbenchPage.tsx`; its import and calls include `pairWithBridge`, `readSyntheticFixture`, `heartbeatBridge`, and `revokeBridge`. Those HTTP functions live together in `apps/workbench-web/src/shared/api/read-synthetic-fixture.ts`. Existing tests in `apps/workbench-web/src/shared/api/read-synthetic-fixture.test.ts` assert direct loopback HTTP, pairing, omitted browser credentials, and response validation. `apps/workbench-web/src/app/App.tsx` always renders the same page. Session projection/UI and synthetic fixture are separately located under `entities/session`, `widgets/session-workspace`, and `test-fixtures`.
- Boundary policy is currently browser/bridge/UI/contracts-specific: `apps/workbench-web/scripts/boundary-policy.mjs`, `check-boundaries.mjs`, fixtures, and `check-boundaries.test.mjs`. Browser imports are restricted from Node built-ins, bridge source, and `@opencode/*`; production browser bundles are inspected for OpenCode imports. Desktop ownership needs explicit project tags/rules and checks without weakening those browser constraints.

## OpenCode generated/client/server evidence

- The root `pnpm-lock.yaml` has no `@opencode/client`, `@opencode/sdk`, or `@opencode/server` importer/resolution. `pnpm-workspace.yaml` contains 2.0.18 release-age exceptions for OpenCode packages; this is policy text, not proof they are installed at the root or selected for production.
- `spikes/sdk-ui/package.json` pins `@opencode/client` and `@opencode/sdk` to 2.0.18. The spike lock also resolves `@opencode/server` and related packages at 2.0.18. Its installed package manifests confirm client 2.0.18 and SDK 2.0.18. The client package exports `dist/promise` and declares a `check:generated` script against generated client sources; these are upstream package outputs in the feasibility spike, not app-owned generated files or a production pin.
- No packaged OpenCode executable/server binary or vendored OpenCode server source was found in the root app/workspace paths inspected. Thus server artifact acquisition, per-OS identity/hash, command line, readiness/auth and packaging are outstanding compatibility/bootstrap work. Do not treat the SDK package's server dependency as evidence that a standalone CLI is present.
- `packages/ui/src/tool-ui` adapts upstream assistant-ui Tool UI source, with its license/source in `spikes/sdk-ui/vendor/tool-ui`; this is UI source vendoring and unrelated to vendoring the OpenCode server.
- The plan-aligned research sources are `docs/runs/desktop-app-bootstrap/opencode-sidecar-research-r1.md` and `runtime-options-research-r2.md`; they distinguish the v2 client from the separately packaged `serve` executable and require app ownership of the exact launched child.

## Narrow bootstrap touchpoints and scope collisions

The focused plan assigns `apps/desktop-app/**` for the new Electron host and owns root/workspace manifests, lockfile, and targeted tests/config. Expected shared-renderer integration points are the bridge-coupled `WorkbenchPage.tsx` and `shared/api` module/tests, plus `App.tsx` if an explicit mode/adapter selection is needed. Keep `apps/local-bridge/**` and its browser pairing tests as the browser implementation. Extend boundary rules/fixtures to model the desktop host and ensure its Node/OpenCode dependencies cannot flow into the browser bundle. Add Nx targets for desktop development, tests, E2E/package/inspection according to the contract, preserving distinct platform receipts. `packages/contracts` is the existing shared typed-schema boundary; add desktop operation schemas there only if needed by the reviewed API, and preserve its public-entry restrictions.

The strongest conflict with desktop architecture is the renderer's assumption that pairing and all app operations use browser HTTP fetch. A second scope conflict is the boundary checker treating all web source as browser-only and rejecting all OpenCode imports without a desktop-specific trusted host owner. No Electron project/config, preload API, sidecar supervisor, Electron-specific tests, or package targets currently exist. Avoid editing bridge authorization/CORS to simulate Electron security.

## Registered document binding

Plan `docs/workplans/desktop-app-bootstrap/plan.md` revision 20 SHA-256: `b881fc85abb27e5f8c892acb1ffbdd81904bcaef168f9bf7e37ec5a71da89a4f`. Contract SHA-256: `97cafead7925fa98cd014fd9c9d9a044a85143875194bef556b7cc9a66358a61`. R20 review SHA-256: `ddac11a1b971c672e6af0bb0472e4ebbbcc003e5c25bb2cf9d7406834ebcdc21`. Recomputed all nine contract-registered document digests against current file bytes; all matched their registered versions: PRD 0.6, UX 0.6, architecture 0.6, verification 0.5, operations 0.4, spec index 0.12, ADR-0002, design system 2026-09-27, and component contract v3. Their paths and authoritative digests remain listed in `docs/workplans/desktop-app-bootstrap/contract.json`.

## Key local hashes

| File | SHA-256 |
| --- | --- |
| `package.json` | `96eed945858b2540ccdf46e61ce5b76858ae1f341bb07df05406d2e1e8f81d31` |
| `pnpm-lock.yaml` | `a5dacf6413782c808d4bcbb185787e19f26ae91c63a83259259b348fd1a5004b` |
| `pnpm-workspace.yaml` | `1073d8b97a03295daf2ce350850bb11ffc12619a6b59bdba8feb863b9608dc1a` |
| `nx.json` | `dcf7e313808622ddb1febdfe22afedb665e608cba3ae6f627ccb99aa13e17e10` |
| `apps/workbench-web/package.json` | `655310b33b9b84ea975c6538673b7ce0a5050ae43edfad88e963fe5730741454` |
| `apps/workbench-web/project.json` | `0a03eed8e5184ad8668a8077de03bb4cea2e273b1ab41fe92d05988f22d0218a` |
| `apps/local-bridge/package.json` | `cd66fa273abf992fe06ec8288b4ece5ccd600aef660f31598945748425c608f3` |
| `apps/local-bridge/project.json` | `0017e55291728bbb6d528e01ae970a151effce76b68bf6e15a23fbaea2921686` |
| `spikes/sdk-ui/package.json` (OpenCode pins 2.0.18) | `d85ee02cf7f6001aaa9c1770a574ffb1ea701ee73d74b21d82f36553f752fd3b` |

The checkout currently reports repository files as untracked in `git status`; therefore this inspection cannot attribute those files to a committed baseline. No tracked app source or configuration was edited for this report.
