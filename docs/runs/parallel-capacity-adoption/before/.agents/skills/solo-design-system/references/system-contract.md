# Design-system contract

Start with the approved product promise, audience, use scene, and research constraints. Define a short creative north star that helps future contributors choose between plausible designs.

The contract should cover only decisions the product currently needs:

- semantic colors and foreground/background pairs, including dark-mode behavior when supported;
- typography roles, available weights, loading, scale, and localization constraints;
- spacing, content width, grid, breakpoints, safe areas, and density;
- radius, border, and elevation hierarchy;
- interactive states: default, hover where applicable, focus-visible, pressed, selected, loading, disabled, error, and success;
- motion purpose, duration bands, reduced-motion behavior, and any one authored transition;
- web versus mobile differences that should remain platform-native;
- accessibility minimums and how they are checked.

Keep semantic names stable across platforms where meaning matches. Keep raw scales separate from semantic aliases when both exist. Avoid creating token categories or components without a current consumer.

Record the source of truth and direction for every synchronization path, for example Figma variables to repository tokens or repository tokens to generated platform artifacts. Never imply bidirectional sync when the workflow is one-way.

For a revision, list affected tokens/components and expected migration impact. Preserve a dated decision log with evidence or product rationale. Validate parse/build output and inspect at least one representative rendered surface when implementation changed.
