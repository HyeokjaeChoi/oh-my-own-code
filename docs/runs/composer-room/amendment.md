# Selected A composer amendment

2026-10-03. Composer-room plan revision 1. DRAFT scope: this run's browser preview and the existing selected-A Figma draft.

Use a 120px base shell: 8px top padding + 72px input minimum + 32px toolbar + 8px bottom padding. One to three 24px text lines use the same 72px input area. Keep 12px horizontal padding, existing toolbar controls and 32px targets. Keep the 22px hint zone outside the shell.

Input grows from 72px to the existing 144px cap. Text scrolls after that cap; the shell is 192px at the cap. The conditional attachment row adds 32px plus its existing 8px gap: base shell 160px, maximum shell 232px by the formula. The saved browser cap observation covers the shell without an attachment; 232px is a calculation, not an observed capture.

Repository direction: this run's selected-A overrides → resolved semantic/component aliases → preview dimensions. A overrides `semantic.composer.emptyHeight` to `{primitive.px.120}` and `semantic.composer.inputMin` to `{primitive.px.72}` in Light and Dark. B/C stay at their existing 24px input minimum. Use token-driven min/max in `grow()` and A-only CSS. At viewport height at most 600px, center A's empty block at 40% to keep the input and hint visible.

Figma direction: approved values → existing Primitive → Semantic → Component variables → selected-A input wrappers and instances. Saved results show `VariableID:82:122` → `VariableID:81:70` (120), `VariableID:82:123` → `VariableID:81:65` (72), with existing component aliases `82:231` and `82:232`. Normal states have a 120px shell; attachment has 160px. States with an internal reason row have 148px, including archived and unknown. This reason row is separate from the 120px base contract.

Keep draft retention, archived read-only input, unknown send blocking, pending/disabled state reasons, keyboard handling, focus, and toolbar structure. Saved Chrome geometry and state observations support those checks; this amendment does not claim production bridge behavior or a new accessibility audit.

Historical previews and frozen synthesis are unchanged. Production Electron adoption and publication require their own scope. This additive amendment requires the coordinator's independent code/design review; it does not approve itself.
