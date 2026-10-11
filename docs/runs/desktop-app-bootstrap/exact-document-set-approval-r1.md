# Electron desktop bootstrap — exact document-set approval

**Status: awaiting explicit user approval**  
**Run plan:** `docs/workplans/desktop-app-bootstrap/plan.md`, revision 18  
**Focused plan SHA-256:** `0d7ac26dac47443ae48f37abb87494ecf6def1355fc0980f316b81656e54cadf`  
**Parent plan:** `docs/runs/build-delivery/plan.md`, revision 15  

## Confirmed direction

The selected deliverable is an installed Electron desktop application for macOS and Windows. Electron main owns the application window and the exact app-launched OpenCode v2 `serve` sidecar. The renderer uses a narrow typed preload API, while preview content receives no privileged API or sidecar credential. The complete workbench product scope F-01–18 remains active.

## Current independent reviews

- Focused Electron plan review: **pass**, Astra/high; current plan/contract binding is registered in the run ledger.
- Full-product parent plan review: **pass**, Astra/high; storage-location and retention decisions remain open and block persistence-dependent work.
- Product review of PRD v0.6: **pass**, Astra/high; full F-01–18 scope and exclusions are preserved.
- Design/architecture contract review: **pass**, Astra/high; Electron trust boundary, UX states, accessibility, backend contracts, tokens and verification boundaries are coherent.
- Product and design-spec handoff checks: **ready**.

These are document reviews only. They do not establish package compatibility, sidecar startup, security enforcement, rendering, or macOS/Windows runtime behavior.

## Exact files covered by this approval

| File | Version | SHA-256 |
|---|---:|---|
| `docs/product/prd.md` | 0.6 | `1fc42c79ced241772b77fb06c38e6e855fbfbf2308d09ace51f0eaf7a0c2bbe3` |
| `docs/design/specs/workbench-ux.md` | 0.6 | `1f59e6f83aca0c077a4db10cc8c65f7e27e5f177ae0aa32dc6508f4134c97525` |
| `docs/engineering/workbench-architecture.md` | 0.6 | `d07aa9234632541056bbe3b96756f2fe7081214f4590397fe0260fd01c31ccae` |
| `docs/engineering/verification.md` | 0.5 | `4c1e60680cf7b20b02efb35230e8af1588b558b80adab8c15442639c49ead696` |
| `docs/operations/local-release-monitoring.md` | 0.4 | `fe97cb8a4c69e2331b74e3c8263387132ae466150a721e9838a107a95a60e163` |
| `docs/engineering/spec-index.md` | 0.12 | `5d63ccc5304887e83f5d16092fd67a5b9cb4cc7eca724e8536e44665f9e31dc9` |
| `docs/decisions/0002-desktop-runtime.md` | 0002 | `1ebaa6585f7e56e1361d174fec25a7cdd080fd4f283067c72ca1d5111f7dcb65` |
| `docs/design/system.md` | 2026-09-27 | `4697eb4961952ee85a4732ed77e5addbb17058a8b3d12485aa56158324f661a5` |
| `docs/design/components.json` | component-contract-v3 | `76460f0cc7099ef6b628ce654994d89fc75e5e863d33c103daae8049493f2ed2` |

The approval applies only while every path, version and hash above matches the registered contract. An edited file requires refreshed reviews and a new approval.

## Work this approval would release

Authorize the coordinator to continue the reviewed Electron bootstrap in order: perform bounded compatibility and lifecycle probes for the exact Electron/OpenCode v2 server/client set using only app-owned binaries and disposable synthetic workspace/config; then implement the Electron main/preload/renderer bootstrap and per-OS checks described in the plan. Record observed dependencies and stop for a fresh decision if evidence requires a material architecture or scope change. Do not attach to an ambient service or read user projects, global configuration, credentials, or persistent personal data.

The storage-location and retention decisions remain open in the parent plan. Any persistence-dependent feature stays held. Public release, signing/notarization, auto-update, store submission, provider credentials, and external telemetry remain outside this approval.

## Requested decision

**Do you approve this exact document set as the implementation basis and authorize the bounded Electron compatibility probes followed by the planned bootstrap implementation?** Reply “승인” to proceed. If not, identify the file or scope to revise.
