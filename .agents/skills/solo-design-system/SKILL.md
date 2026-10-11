---
name: solo-design-system
description: Create or revise a product design-system contract and repository design tokens from approved product direction and design research.
---

# Design system

Use the supplied run ID. Read its plan, approved product direction, design research, current Figma source if accessible, existing UI, and token files. Check run status; do not begin or finish a run.

Read [references/system-contract.md](references/system-contract.md) when creating a system or changing semantic foundations. Preserve an established system unless the requested outcome requires a documented change. Prefer semantic tokens shared across platforms while keeping web and mobile component implementation and navigation native.

Produce decisions an implementer can apply: creative direction, semantic color roles, typography, spacing and layout rhythm, shape and elevation, component states, motion, responsive behavior, accessibility constraints, platform differences, and a decision log. Exact values belong in the repository token source or approved Figma variables; rationale and usage rules belong in the design document.

When changes are requested and write access is available, update the relevant design document and token source, validate their actual schema or build, and return artifact paths and checks to the coordinator for harness registration. Do not invent a Figma update, export, font license, or rendered validation that did not occur.

Return design documents for coordinator registration with `artifact <run-id> --file <path> --type design_spec`. Canonical `docs/design/system.md` and `docs/design/specs/` paths infer this review as well. Declare the design document in the schema v2 contract and obtain its `design_spec` gate. An independent `design_spec_reviewer` using `$solo-design-spec-review` reviews the registered contracts before dependent UI implementation. The coordinator records the actual pass and checks `handoff <run-id> --gate design_spec` before assigning consumers; document changes require renewed review. Keep this document checkpoint separate from rendered-UI QA by `design_qa`; mixed runs refresh final reviews after implementation and checks.

Return changed paths or a proposed contract, current plan path/revision, unresolved decisions, source-of-truth direction, actual validation evidence, and the review handoff. Creating token contracts may precede document review; implementing consuming screens follows it.
