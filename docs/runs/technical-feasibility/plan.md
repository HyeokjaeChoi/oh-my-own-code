# Technical feasibility — revision 1

Date: 2026-09-26. Status: proposed for independent entry review.

## Confirmed scope and decisions
The latest user “승인.” approves integrated spec set v0.1 and the local-browser direction. Exact immutable inputs and approval are in spec-approval.json. The existing PRD v0.2 and domain-specs independent reviews/handoffs remain authoritative; their historical pending labels are superseded by this receipt, not by editing the frozen files.

This first increment investigates S-01/S-07 package generation, host/client prerequisites and assistant-ui/tool-ui adapter feasibility. It prepares design inputs, not a production workbench. All 18 PRD acceptance requirements remain future release obligations. Do not silently replace new-v2 with @opencode-ai/sdk/v2. Negative package or runtime evidence is a valid research result, never proof that the product works.

Approved dependencies: docs/product/prd.md; the five documents in docs/engineering/spec-index.md; completed runs prd-expansion and domain-specs. Before author dispatch, coordinator verifies unchanged hashes and matching prior product/design_spec handoffs. The new run consumes those exact unchanged contracts; it does not create replacement design contracts.

## First useful increment and feedback
1. Pin actual registry versions, package lineage, runtime engines, exports and relevant primary documentation. Distinguish DNS/tool failure from package absence. Inspect tool-ui registry sources and ownership/license requirements. Use bounded public metadata queries; no account or secret discovery.
2. Build a small isolated compatibility probe only where packages are obtainable. Pin dependencies/lockfile and disable install lifecycle scripts. Exercise a real assistant-ui conversion/type or render integration and one tool-ui schema/component when feasible; synthetic messages only. Record source/provenance and known untested callbacks. A fabricated stand-in must not be labelled tool-ui integration.
3. Test OpenCode module/load/lifecycle only if an isolated host can be demonstrated from documented config. Do not start a host that could read real credentials/config, project plugins or user files. No paid model prompts. If packaging, missing runtime or isolation prevents a safe live probe, record the exact blocker and retain a failing/non-ready capability, not a mock live success.
4. Independently review probe code, reproducibility, safety, and conclusions. Stop this bounded increment at a meaningful verdict before a larger app scaffold. New backend/UI/security design contracts require their own review before implementation.

Wrong approach signal: SDK generation mismatch, unavailable package, undocumented isolation, or unsupported UI API. Report evidence and next bounded verification; do not raise effort or retrofit production abstractions blindly.

## Open questions and holds
- Async user question pending: use new Figma file/system versus existing resources. Figma identity query succeeded, but target-file access is unproven. Hold visual design production/file creation until selection/authorization and appropriate skill workflow. Continue technical work.
- New-v2 installed version and runtime support unknown. Must be established before native integration claims; browser presentation can be tested independently.
- S-02 through S-06 and S-08 through S-10 live behavior remain later spikes; no security/recovery/runtime guarantee from this increment.

## Acceptance and ownership
- AC-1: immutable PRD/spec approval and platform evidence verified; completed runs preserved.
- AC-2: dated exact package/primary-source findings distinguish new-v2 from legacy and document reproducible availability/runtime evidence.
- AC-3: bounded compatibility probes and repeatable checks, with real evidence or explicit capability blockers; no private credentials/projects or model invocation; no fake compatibility pass.
- AC-4: actionable feasibility report and design-preparation state with independent code/conclusion review and explicit remaining spike list.

| Assignment | Scope / owned files | Route and reason |
|---|---|---|
| Root coordinator | run ledger, approval, docs/design/preparation.md, integration | Sole orchestration; preserve approved source hashes |
| Fresh plan_reviewer | Read-only plan/contract/binding | Sol/medium: bounded safety/verification judgment |
| Fresh engineer | spikes/sdk-ui/** and docs/research/sdk-ui-feasibility.md only | Sol/medium: package integration uncertainty and research synthesis; one coherent bounded assignment |
| Fresh reviewer | Read-only final probe/evidence/conclusions | Sol/medium: independent code and evidence judgment |

No recursive children. Use actual available client capacity (last observed one new slot), sequential specialists where necessary. Model/effort are delegated choices, not runtime-attested identity. Primary can verify approval/design availability alongside authors. Every handoff supplies this revision/hash, role, skill, exact inputs, owned paths, acceptance and outputs. Corrections need a fresh child. Record capacity failure, do not repeatedly retry or reuse context.

## Verification
Contract commands:
- approved-inputs: static hashes of exact PRD/five specs and explicit receipt, plus completed product/design_spec handoff readiness. Coordinator-authored checker under this run, frozen in environment_files.
- compatibility: node spikes/sdk-ui/verify.mjs. Engineer implements a deterministic local check of probe source/evidence and any installed real package/type/render probes. This does not query network or silently install packages. Unavailable capability remains explicitly not-ready in the report; the checker may validate truthful negative evidence but must print which capability was not executed.

Classify checks: syntax/type and synthetic integration selected where supported; exact package/registry provenance selected; lint/format by available dependency commands only (no root app scripts exist); product unit/OS/security/browser E2E and visual QA are not applicable to this non-product probe and remain not executed. No rendered production UI is delivered. Required independent code review judges both scripts and evidence claims after checks/outcome freeze. No new services, commits, PRs, deployments or background jobs.

## Change history
Revision 1: approved spec/platform adoption; first bounded S-01/S-07 feasibility and design intake increment.
