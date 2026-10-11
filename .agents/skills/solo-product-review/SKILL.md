---
name: solo-product-review
description: Independently review a final product brief or PRD for product coherence, bounded scope, measurable outcomes, and implementation-ready acceptance criteria.
---

# Product document review

Use an independent `product_reviewer` routed under the shared adaptive-routing reference, preserving exact user choices and explicit inheritance/default instructions. Review the registered final product brief or PRD independently of its author. Read the current `docs/runs/<run-id>/plan.md`, the registered product artifacts, their cited evidence, and only the existing product decisions needed to detect contradictions. Run kind `product`, artifacts under `docs/product/` and `docs/specs/`, and custom artifacts registered with `--type product` route to this review. Check run status; do not begin, mutate, or finish the run.

Review semantics rather than file shape. Confirm that the artifact states a supported customer problem and evidence boundary, an observable outcome, the narrowest coherent scope and explicit non-goals, user journeys and material states, measurable acceptance criteria and a primary metric, dependencies and risks, and decisions consistent with the current plan. Separate facts, inferences, assumptions, and unresolved choices. Do not invent demand, interviews, metrics, service behavior, or implementation evidence.

Return `pass`, `changes_requested`, or `blocked`. A passing artifact has no material ambiguity or contradiction that would change the product outcome or prevent downstream design and engineering. For each finding, give severity, artifact location, user or delivery impact, evidence, and the smallest precise correction. Mark optional improvements separately and do not create findings to fill a checklist.

Apply [Finding authority](../solo-orchestrate/references/effort-and-feedback.md#finding-authority) when a finding adds or interprets a requirement, threat model or security boundary.

The report must name every reviewed artifact by exact repository-relative path and SHA256 hash, plus the exact plan path and SHA256 hash. State the run ID, reviewer role, verdict, review boundary, and any evidence limits. A product-document pass does not verify implemented UI, code, an external service, or user demand.

Return the report to the coordinator. The coordinator saves and registers the actual independent schema v2 JSON report with `python3 .solopreneur/harness.py review <run-id> --gate product --reviewer product_reviewer --evidence <report-path>`, then checks `python3 .solopreneur/harness.py handoff <run-id> --gate product` before assigning work that consumes the artifacts. The reviewer does not write the report file or ledger. A changed product artifact, artifact set, plan, or review report requires a new handoff review; later code-only edits do not invalidate this artifact-scoped handoff. In a mixed run, an unchanged product document keeps its document review; final implementation judgment is separate.
