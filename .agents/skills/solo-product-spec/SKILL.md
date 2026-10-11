---
name: solo-product-spec
description: Draft or review a product brief or feature PRD, challenge founder scope, or turn an approved PRD into vertical GitHub issue slices for a solo product.
---

# Product spec

Use the supplied run ID and inspect `docs/runs/<run-id>/plan.md` plus the relevant product brief, specs, decisions, and research pointers. Check the ledger with `python3 .solopreneur/harness.py status <run-id>`; do not begin or finish a run from this skill.

Choose the requested mode:

- **Research (`research`, alias `product_research`):** assess the supplied hypothesis using customer evidence and dated primary market sources. Identify the painful job, existing alternatives, disconfirming evidence, differentiation, founder time, distribution and implementation cost. Propose the smallest validation experiment and decision threshold. Return evidence and a recommendation without authoring or approving a PRD.
- **Brief or PRD:** define the customer situation, current workaround, observed evidence, intended outcome, narrowest useful release, observable acceptance criteria, primary metric, and explicit non-goals.
- **Founder review:** pressure-test demand, wedge, scope, and alternatives before implementation. Read [references/product-review.md](references/product-review.md).
- **Issue plan:** split an approved PRD into independently verifiable vertical slices with blocking edges. Read [references/issue-slicing.md](references/issue-slicing.md).

The `author` mode (`product_manager`) selects Brief or PRD. Include primary and failure journeys, dependencies, rollout and unresolved decisions; retain product behavior without unnecessary implementation choices.

Keep observed facts, inferences, assumptions, and unresolved choices distinct. Do not invent demand, interviews, market size, or metrics. Ask only when a missing choice materially changes the product outcome; otherwise state the assumption and continue. A spec request does not authorize implementation or remote issue creation unless the active request includes it.

Product intent stays in `docs/product/` and `docs/specs/`; GitHub Issues and Projects track execution. Use the project's existing templates and domain language. Mention platform, data, monetization, analytics, and external services only where they affect scope or acceptance.

For PRD/brief delivery, the coordinator selects the `product` kind or declares product documents in the schema v2 contract for mixed work. Return documents for registration with `artifact <run-id> --file <path> --type product`; canonical `docs/product/` and `docs/specs/` paths also infer this gate. Send the registered documents and current plan path/revision to an independent `product_reviewer` using `$solo-product-review`. Founder critique by the producer does not satisfy this final review. Before dependent implementation, the coordinator records the actual pass and checks `handoff <run-id> --gate product`. Mixed tasks retain a current unchanged product-document review and obtain a separate final implementation review. Return artifacts or issue URLs, consequential decisions, evidence gaps, and this review handoff to the planner.
