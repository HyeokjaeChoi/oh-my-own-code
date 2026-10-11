# Phase 1 evidence — Input and StatusBadge

Run: `component-polish` · Plan: revision 3 (`d0326774cf3b47dce1387e06e56ecdedca664e5b605444333a9ca6df13f1c6e7`)
Figma: `e6QYqEsmA3FHB6A2ohNr2o`

## Completed tasks

- **P1.a** Inspected Input page `5:6` and StatusBadge page `5:7`, including variants, Dark examples, paint aliases, and nested layout bounds.
- **P1.b** Input variants `7:2`, `7:3`, `7:4`, `7:5`, `7:6` now have content-sized field groups. Default, hover, disabled, and focus no longer repeat the placeholder as helper copy; error retains one specific message. The focus ring on `7:15` is a transparent absolute overlay at `(-2, 28)`, `284 × 44`, 2px stroke, while the control stays `280 × 40` and the component remains 280px wide/70px high.
- **P1.c** StatusBadge variants `7:76`–`7:81` and Dark instances `7:94`, `7:96`, `7:98`, `7:100`, `7:102`, `7:104` now use HUG sizing. Each is 24px high with 8px horizontal padding; observed widths are 64, 64, 79, 79, 46, 97px for text widths 48, 48, 63, 63, 30, 81px respectively.
- **P1.d** Added composed Input error+focus examples without adding variants: Light frame `38:26` / instance `38:27` / ring `38:32`; Dark frame `38:33` / instance `38:34` / ring `38:39`. Dark instances update with the master and show one error message.
- **P1.e** Structural evidence confirms no field overlap: focused Field y=30–70, error feedback y=78–98, ring overlay y=28–72 outside auto-layout flow. Screenshots reviewed: Input page `5:6` and StatusBadge page `5:7`, each including Light and Dark examples. The Badge screenshot shows content-hug widths and vertically centered labels in both modes.

## Exit decision

Passed for this increment: component IDs and measured bounds satisfy the source contract; Light/Dark captures show the intended states and no visible overlap. Button and global token definitions were untouched. This is design-library evidence only; it does not establish renderer hit testing, browser zoom, or assistive-technology behavior.
