---
name: solo-design-review
description: Independently inspect an implemented web or mobile screen or flow with screenshot evidence for visual quality, usability, states, responsiveness, and accessibility.
---

# Design review

Use the supplied run ID as the independent final rendered-UI judgment workflow for `design_qa`. Read `docs/runs/<run-id>/plan.md`, the intended user task, approved design direction, and relevant token contract. A preceding `qa_runner` observation report can provide direct browser/device evidence, but it is input only and cannot replace this judgment. Check `python3 .solopreneur/harness.py status <run-id>`; do not begin or finish the run.

Inspect the running application in a browser, simulator, or device, or inspect accessible captures of that implementation. Figma is a reference contract, not evidence that the delivered UI works. Verify each direct capture path and its viewport/device dimensions before judging it; do not inherit a screenshot or dimensions from long conversation history. For exported capture handoffs, require an accessible path, provenance/origin (a hash is optional), application state, viewport or device, and checked pixel dimensions; direct inspection remains acceptable. Read [references/evidence-review.md](references/evidence-review.md) before a multi-screen audit or a post-fix review. Do not treat source code, a mockup, or a successful build as proof of rendered behavior.

Review only dimensions relevant to the flow: task hierarchy, information architecture, interaction and loading/empty/error/success states, design-token alignment, responsive layout, keyboard/focus/semantics/contrast on web, and safe areas/touch targets/text scaling/platform navigation on mobile. Separate directly observed defects from code inferences and subjective preferences.

A final review is report-only. Route fixes to an implementer; after a fix, obtain a fresh independent final `design_qa` review of the delivered UI. Never claim a state, viewport, device, console result, or screenshot was inspected when it was not.

Return findings with severity, location, user impact, evidence path, proposed correction, and verification status to the planner. If another independent judgment is bundled in the same handoff, keep this rendered-UI verdict separate. The planner persists the independent design-QA report and records the `design` gate.
