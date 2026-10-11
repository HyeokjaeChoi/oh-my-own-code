# Coordinator preflight observations

2026-10-03. Preparation scripts have not mutated Figma. This is a source observation, not a final independent gate or a rejection of the approved specification.

The prepared `components.js` and `screens.js` replace the shared fixture with a token-mapping session, `Local Model`, `/workspace/docs/design-notes.md`, and different assistant paragraphs. The frozen preview brief requires `omoc-workbench`, `권한 흐름 점검`, `기본 에이전트`, `기본 모델`, `demo/permission-flow.tsx` and the exact shared permission/rejection text. Use the same fixture for every candidate and Figma screen. Do not create a second visual comparison variable.

`screens.js` sets a structural conversation container to `layoutMode = NONE`, then positions the user, assistant, tool and permission as absolute children. Content reflow cannot adjust those relations. Preserve auto-layout for related content and use absolute positioning only for outer fixed composition/container placement. Where a static viewport cannot show every message and pending card, explicitly compose a visible current-request state; never hide the scope, consequence or actions behind the composer.

The artifact screen currently stacks File and Terminal panels together. The agreed initial panel is File with Browser / Terminal / File tabs; other tab specimens are separate components/instances, not two active panes in one screen. Empty A positioning must follow the approved block-center geometry and use current actual preview as a comparison; no fixed unexplained substitutes.

Check actual target bounds: a glyph of 16px is inside a declared 28/32/36px target, not itself the hit target. Composer selectors are fit-content, not fixed synthetic long model values. Send remains the trailing stable target. Figma representation does not execute actions, but its state specimens must represent the meaningful content and visual states.

A fresh execution writer must correct these preparation gaps before any downstream Figma construction, preserve the 475-token and 32-family inventory, and validate actual output. No contract change or production edit is needed.
