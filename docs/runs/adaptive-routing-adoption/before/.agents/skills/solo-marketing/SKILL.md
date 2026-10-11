---
name: solo-marketing
description: Turn approved product positioning into a focused landing page or campaign asset, implement it in the existing stack when requested, and verify message and conversion behavior.
---

# Product marketing

Use the supplied run ID and read its plan, product brief, approved positioning, design system, product proof, and relevant research. Check run status; do not begin or finish a run.

Read [references/landing-workflow.md](references/landing-workflow.md) for a landing page or conversion-focused campaign. Define one audience, one recurring problem, one credible promise, supporting proof, the primary action, objections, and the event path used to evaluate the result. Do not invent customers, testimonials, adoption, outcomes, or urgency.

When implementation is requested, use the existing Next.js stack, design tokens, components, analytics contract, routing, and deployment workflow. Keep the page accessible, responsive, fast, and consistent with the product. Avoid adding a site builder, duplicated design system, or marketing service without a demonstrated requirement.

Return written briefs, source changes, and generated asset paths to the coordinator for harness registration. The coordinator records meaningful checks through `python3 .solopreneur/harness.py check <run-id> --name <name>`. Inspect the rendered page at relevant sizes and capture evidence for the primary action; a passing build alone does not verify the page.

Return artifact paths or preview URL, claims and evidence sources, CTA behavior, analytics events, validation results, and unresolved dependencies to the planner. The planner records the growth review with `marketing_specialist`.
