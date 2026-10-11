# Research method and interpretation

All candidate dimensions are logical CSS px at 100% zoom. High-DPI screenshots are not literal design px. Current actual Electron screenshot: ../frontend-architecture-redesign/evidence/p3-r7/ui-states/desktop-empty-conversation-normal-1280-synthetic.png (2560×1536 pixels,1280×768 logical content). Its native titlebar and synthetic data are scoped evidence, not provider/production execution.

Observed baseline problem: primary new-session black block, full-size search, equal-weight controls, large blank composer area and stretched agent/model selectors create visual burden. Candidate proposals should compare compact search affordance, quiet new-chat action, locally sized selectors, grouped composer actions, coherent message width and low-contrast surface segmentation. These are inspection conclusions, not measured competitor values.

UI/UX Pro Max was invoked with desktop chat compact composer, density8, variance2,motion1. Returned Hero+Features+CTA and messenger palette/fonts/scroll reveal are off-target for the app; rejected rather than persisted as authority. One narrower UX lookup desktop information density returned unrelated color-only/redundant-entry entries; no verified density-specific database result. Use actual product observations and explicit desktop rules instead.

W3C primary source https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html specifies AA 24×24 CSS px minimum or applicable exceptions, independently of zoom. This is a minimum, not a target recommendation for every control. Proposed 28–36 desktop controls need usable focus/spacing/keyboard affordances, larger important actions and optional44px coarse-pointer layout. Do not shrink permission semantics or hide warnings to create visual simplicity.

Existing font/palette ownership: docs/design/tokens/manifest.json Noto Sans KR + IBM Plex Mono, white/neutrals and blue focus,green/amber/red semantic statuses. Preserve identity by default; system fallbacks should be honestly labelled and any alternate fonts explicitly proposal-only. No remote font network needed for a local comparison.
