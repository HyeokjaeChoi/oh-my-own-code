# Non-button component production-readiness refinement

Revision: 7 (ToolCall content-fit and target/input consistency repair). Date: 2026-09-27. Coordinator: /root.

## Confirmed outcome

Bring the five non-Button families in the ChatGPT-inspired design system to a defensible component-library quality bar: Input, StatusBadge, NavigationItem, ToolCall, and PermissionRequest. Button variants are accepted and must remain unchanged; PermissionRequest should compose the existing Button set rather than invent replacement button styling. The user authorized proceeding with an Astra-authored/refined plan and implementation.

## Evidence and constraints

- Prior read-only audit inspected all five Figma pages, base sets, Light examples, Dark examples, nested node geometry, and the public logged-out `https://chatgpt.com/` page. Figma source: `https://www.figma.com/design/e6QYqEsmA3FHB6A2ohNr2o`.
- Confirmed audit issues: Input focus frame is undersized and its helper overlaps the following field in Dark examples; Input error repeats a default hint; badge instances have inconsistent fixed widths/heights instead of content sizing; navigation labels are centered and dark selected/hover are not reliably distinguishable; all ToolCall states are outlined cards and “근거 보기” is plain text; PermissionRequest actions are frames/text, not Button instances, and have poor Light-mode affordance; documented error+focus and selected+focus composites lack visual examples.
- Canonical sources are `docs/design/components.json`, `docs/design/system.md`, and `docs/design/tokens/manifest.json`; `docs/design/tokens/tokens.css` is generated. Figma is downstream of the canonical repository sources. Do not edit generated CSS manually.
- Keep permission decision separate from execution outcome; retain exact scope/path, status text, keyboard focus, Light/Dark, Korean strings, and existing Button design. Use only functional borders: preserve a clear permission scope boundary, remove routine repeated ToolCall card outlines, and do not weaken input boundary/focus contrast without validation.
- `designlang lint` scored generated CSS B/82 with a radius-sprawl warning, but canonical radii use four primitive values with semantic aliases. Treat that output as a prompt to inspect, not as authority to flatten intentional aliases. Its JSON-manifest lint returned zero parsed colors/spacing/radii, so it is not evidence of token quality.
- `ui-ux-pro-max` and local `design-taste-frontend` guidance were read; `ui-skills get baseline-ui/better-ui` could not retrieve its remote guidance because of a network fetch failure. No Impeccable-specific skill was found. Public ChatGPT evidence is logged-out only; do not claim authenticated parity.

## Scope and non-goals

Update the component source contracts and affected Figma components/examples, reconcile documentation and any necessary tokens, verify Light/Dark visuals, nested auto-layout geometry, focus/error composites, contrast, and source-to-Figma parity. Add only targeted automated checks that make these regressions observable. Do not alter Button variants, publish/share the Figma library, change file access, implement the product application, or mimic unauthenticated-unobserved ChatGPT features.

## Acceptance criteria

- AC-1 Input: all states preserve a 40px control shell and stable field bounds including error+focus; label/control/one feedback slot fit without overlap in base and Dark examples. Error replaces ordinary help, and the focus ring preserves error semantics.
- AC-2 StatusBadge: text-hug width equals rendered text width + 16px within 1px, 24px height, vertically centered single-line text, and actual nested StatusBadge instances in ToolCall/PermissionRequest own the geometry and color bindings; every parent state maps exact semantic state, label, and allowed tone, readable in both modes.
- AC-3 NavigationItem: all states fill the same parent width and share a 12px start inset; selected+focus preserves selection and aria-current semantics. Selected uses 700 label weight versus 500 default; default, hover, and selected use the exact documented surfaces. Dark navigation parent and default are semantic surface (#262626), hover is semantic canvas (#171717), and selected is semantic surface.subtle (#3d3d3d). Capture resolved variable bindings and parent fill and verify all three states visually together in Light/Dark; hover and selected must each differ from the actual parent and from each other.
- AC-4 ToolCall: all six summaries have no outer stroke; an expanded evidence region may have a functional boundary. Each state hugs all visible vertical content with 16px bottom padding (±1px measured from the last visible child), including wrapped long input/output and the conditional result action or absent-target note. For every state, displayed target and input `path` match exactly in Light and Dark examples. Status, source, target, and result metadata remain clear. Evidence navigation appears only with a runtime-supplied valid target; local disclosure is a separate keyboard-operable action with expanded state; absent evidence is non-actionable explanatory text.
- AC-5 PermissionRequest: actions are existing Button instances with allow=primary and deny/refresh=quiet. Their actual renderer hit regions allocate at least 44px height and 8px between targets without nested focusable controls; Figma records geometry but does not claim runtime hit testing. Sending retains disabled allow/deny instances to preserve layout and prevent duplicate decisions; loading implies a known triggering action only. Stale offers enabled refresh only. Scope and status remain visible at 280px and 720px widths, actions stack when required, and decision delivery remains distinct from operation completion.
- AC-6 All five families have validated Figma geometry and Light/Dark captures, including error+focus and selected+focus examples without increasing 44 canonical variants. ToolCall evidence records and checks all six states in both modes, actual frame bounds, hug sizing, bottom padding, last-child bounds, exact target/input values, and long-path wrapping. Button definitions remain byte-equivalent after normalized JSON serialization; no global foundation changes are introduced without a demonstrated need and review.
- AC-7 Independent plan, design-spec, code, and rendered-design reviews pass; required validators and a run-local component-contract check pass against current source hashes. Library readiness is distinguished from browser/runtime, hit-testing, zoom, and assistive-technology proof.

## Proposed sequence and assignments

1. Astra (`gpt-6-astra`, high; explicitly requested) planned the DQ-1/DQ-2 repair read-only. The primary integrates the scoped repair into this SSOT.
2. Obtain an independent `plan_reviewer` pass on this exact revision 7, including the DQ-1/DQ-2 report and updated scope.
3. The coordinator has drafted the narrow canonical ToolCall contract addition in `docs/design/components.json` and `docs/design/system.md`. After the plan pass, register their exact current hashes, obtain independent `design_spec_reviewer` approval, and pass `handoff --gate design_spec` before projecting these constraints to Figma.
4. Perform only the ToolCall continuation: use `design-qa-final.json` as input, reconcile target/input path values across states, make long-path wrapping visible, convert all six masters to content-hug vertical sizing with 16px bottom padding, and reflow queued/success plus any affected Light/Dark examples. Preserve accepted Input, StatusBadge, NavigationItem, PermissionRequest, and Button designs. Update measured Figma structural evidence and captures.
5. Run both contracted checks, obtain fresh independent `reviewer` and `design_qa` judgments bound to the current source and evidence, fix any findings, and repeat affected checks/reviews. Do not claim runtime, keyboard, screen-reader, hit-testing, zoom, or browser E2E proof from Figma captures.

## Ownership and verification

- Coordinator: SSOT/contract/ledger, integration, Figma sequencing, final evidence and report.
- Astra planner and reviewers: read-only judgments; no source writes.
- Implementation owner: `docs/design/components.json`, `docs/design/system.md`, required canonical tokens, and Figma component pages. Keep generated files under their generator.
- Checks: `python3 docs/design/validate_system.py`; `python3 docs/runs/component-polish/check_components.py` for contract-level dimensions, availability, Button preservation, and 44-variant invariants; manual Figma node/instance/bounds audit and current Light/Dark screenshots per family. Figma allocation is documentation only, not hit-test evidence. No claim of browser runtime, actual click targets, screen-reader, or zoom testing.

## Open questions

None blocks execution. Keep Button styles unchanged; compose `primary` for allow and `quiet` for deny/refresh unless the current component semantics and reviewer identify a specific reason to swap. Use runtime-provided evidence identifiers; no fabricated destination URLs.

## Astra decisions integrated

- Add only small structured contract fields for sizing/alignment, feedback precedence, stroke visibility, nested references, action availability, and result-target availability; retain existing schema and token hierarchy.
- Keep the Button’s 40px visual appearance; document a 44px renderer hit allocation around it and do not treat a decorative Figma frame as proof.
- “근거 보기” is conditional on a runtime target. Local disclosure and result navigation have different semantics; never create placeholder links.
- Resolve `PermissionRequest/sending`: retain disabled allow/deny Button instances instead of an empty action list; use loading only when the triggering decision is known. Stale exposes refresh only.
- Inspect inherited dimensions/overrides in composed examples; compare accepted Button source before and after. Design-library evidence must not be presented as runtime interaction/accessibility proof.
- Navigation source inspection found the proposed medium-weight cue ineffective because all existing labels already use weight 500, and Dark hover/selected resolved to the parent surface. Set selected label to weight 700 and revise only the component-specific dark aliases (hover→canvas, selected→surface.subtle); do not change global semantic colors.

## Change history

- Rev 0: coordinator draft derived from the completed read-only review.
- Rev 1: integrated Astra's architecture, permission sending-state correction, conditional evidence action, measurable sizing/spacing acceptance, scope-vs-runtime evidence boundary, and source-first specification gate.
- Rev 2: canonical design contract and system documentation drafted; registered versions and hashes bind the exact source increment that must pass independent plan and design-spec gates before Figma projection.
- Rev 3: after a P2 `changes_requested` review, ToolCall and PermissionRequest now explicitly compose actual StatusBadge instances with per-state label/state/tone mappings; parent-level competing status color bindings were removed and the system guide was reconciled. Re-review both plan and design spec before Figma projection.
- Rev 4: evidence from the NavigationItem page showed that labels were already weight 500 and dark hover/selected fills blended into the example parent. Specify selected=700, default=500, and component-local dark hover/selected aliases; register the manifest and regenerated CSS source relation and pass current plan/spec reviews before Figma projection.
- Rev 5: resolve the plan-review finding by stating the same default/hover/focus weight behavior in every NavigationItem variant and adding explicit per-variant 500/700 font-weight values; refresh registered hashes and renew both independent reviews before Figma projection.
- Rev 6: Astra planning and independent design-spec review found the documented navigation parent and default both resolved to surface.subtle, as did selected. Bind the explicit dark parent/default to semantic surface (#262626), hover to canvas (#171717), and selected to surface.subtle (#3d3d3d); preserve Light/global semantics and 500/700 label weights. Renew plan and design-spec review before Figma projection.
- Rev 7: Astra/high planned the repair from fresh rendered QA findings. Make all ToolCall states content-hug with 16px bottom padding, reconcile displayed target with input path across all six states and both modes, wrap the realistic long path, and bind the result to measured live Figma evidence and strict contract checks before a fresh independent design review. The first plan review requested an unambiguous revision header and a ToolCall-only continuation sequence; these were clarified before implementation.
