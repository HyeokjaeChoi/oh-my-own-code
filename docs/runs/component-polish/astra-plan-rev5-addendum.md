# Astra revision-5 planning addendum

Date: 2026-09-27. Read-only judgment of revision 4 and its independent P2 finding; only this addendum is authored. Canonical sources and Figma remain untouched. This supplements the existing SSOT rather than replacing it or granting an independent review pass.

Reviewed inputs:

- `docs/runs/component-polish/plan.md`, revision 4; SHA-256 `64c4aee4918fa071ccd08a7cae1b3ff7e769628c14a4c7fd4230c05aab0d2f93`.
- `docs/design/components.json`; SHA-256 `2c16f5965f2a678f3d0ba21432661da9388d4ef7a140b2de4f0a4a5674db474f`.
- `docs/design/system.md`; SHA-256 `f5209e56615c2872d4960cb5f038ceabf5bb141825b6066afa329c0612808a4a`.
- `docs/runs/component-polish/plan-review-rev4.json` and current `contract.json`.

## Finding and exact canonical resolution

The reviewer is correct. The default, hover, and focus variants still describe a medium-weight selection cue and set `visual.selectedCue` to `medium-weight-label`. The selected variant and family contract require 700; the system guide already correctly specifies default/hover 500, selected/current 700, and focus preserving its base state's weight. This is a source contradiction, not a need to choose another design.

Coordinator should replace the `behavior` value of **all four NavigationItem variants** with this shared exact wording so each standalone record carries the complete rule:

> Use a 40px full-width row, 12px start inset, and start-aligned content. Default and hover labels use font weight 500. Selected/current labels use font weight 700 as a persistent non-color cue alongside the selected fill. Focus-visible overlays the current base state without changing layout or label weight: 500 on default and 700 on selected. Current destination uses aria-current=page; selection never implies execution success.

Set `visual.selectedCue` to the exact value `font-weight-700` in all four variants. This field describes the conditional selected-state cue; it does **not** make default, hover, or unselected focus labels bold. Normalize `componentContracts.NavigationItem.selectedCue` from `bold-label` to the same `font-weight-700` value, retaining `selectedLabelFontWeight: 700` and `defaultLabelFontWeight: 500`.

Make the NavigationItem composed-state contract explicitly preserve label weight alongside background, foreground, and `aria-current=page`. Recommended exact `expected` wording:

> Current navigation keeps its selected fill, foreground, font weight 700, and aria-current=page while the outer keyboard focus ring is visible; the overlay does not change layout.

The existing navigation paragraph in `system.md` is already aligned and needs no semantic rewrite. Keep its 500/700 and focus-preservation wording. Preserve the existing component-local Dark aliases, all 44 variants, all Button definitions, and global typography tokens; do not change the global label weight to 700.

## Revision-5 acceptance and sequencing

Add to AC-3: all per-variant behavior and selected-cue fields agree with the family contract; default, hover, and unselected focus render 500, selected and selected+focus render 700 in both modes. No current NavigationItem record retains the ineffective `medium-weight-label` instruction. The targeted component check should assert these relationships, not merely the family-level 700 value. Its registered file `docs/runs/component-polish/check_components.py` is presently absent, so its eventual passing result remains outstanding.

**Dependent Figma mutations must wait.** Integrate revision 5, make the bounded source correction, register exact current document/plan hashes, then obtain fresh independent plan and design-spec passes and a successful design-spec handoff before projecting this source bundle into Figma. The rev4 reviewer explicitly required this sequence. Its recorded plan hash also differs from the currently read plan hash; neither an earlier pass nor this author addendum can stand in for a current review. Read-only inspection and evidence preparation may continue; no additional user approval is needed for this already-authorized repair.

After the gates, set actual Figma text font styles to Medium/500 for default/hover/unselected focus and Bold/700 for selected/selected+focus, including inherited instance overrides. Capture the **actual** Dark parent fill with default/hover/selected side by side; the previously reported parent value is not fresh verification. Confirm stable row bounds/start inset, no label clipping after the width change caused by bold text, and preservation of selection under focus. Maintain the planned Light/Dark independent visual review and the distinction between design-library evidence and runtime behavior.
