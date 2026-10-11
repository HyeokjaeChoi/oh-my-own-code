---
name: solo-qa-run
description: Execute a specified observation-only QA checklist and collect direct browser or device evidence without making a final quality judgment.
---

# Observation-only QA run

Use the coordinator's supplied run ID, checklist, implementation path, and evidence requirements. This workflow gathers observations for a later reviewer; it does not create or finish a run and it does not satisfy a final code, design, product, or release gate.

Inspect the requested flow in the available browser, simulator, device, supplied capture, or accessible artifact. Verify direct capture paths and viewport/device dimensions before reporting them; inherited history, including long turn context, is not capture evidence. When handing off an exported capture, include an accessible path, provenance/origin (a hash is optional), application state, viewport or device, and checked pixel dimensions. Direct reviewer inspection remains acceptable when an exported handoff is unavailable. Record the exact environment, viewport or device, state, steps, direct observations, evidence paths, and verification gaps. Check only the dimensions named by the checklist. Separate what was observed from what is inferred, and report failures or ambiguity without guessing. A transport stall is a transport finding; it does not by itself justify a model hop.

Do not edit the implementation, issue an approval or final quality verdict, or claim a screen, state, console result, network result, accessibility behavior, or screenshot that was not actually inspected. The coordinator sends the observation report to the appropriate judgment role, such as `design_qa` or `reviewer`, and records any required final gate separately.

Return the checklist, actual observations, evidence paths, unresolved gaps, and next handoff. A passing observation step means only that the requested observation was completed; it is not an independent final review. A human walkthrough is manual coverage, never automated browser E2E; name the E2E runner or record E2E as unavailable with reason.
