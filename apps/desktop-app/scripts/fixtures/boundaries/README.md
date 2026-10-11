# Renderer boundary fixtures

Run `node apps/desktop-app/scripts/check-renderer-boundaries.mjs --fixtures-only`
from the repository root. The normal checker command runs the same fixtures before
checking the production renderer graph.

Each case in `cases.json` names an actual entry file and the expected diagnostic
sequence. The checker uses the desktop TypeScript configuration and its module
resolver, then traverses local imports, re-exports, dynamic imports, CommonJS and
type imports. Fixture paths resolve real TypeScript and CSS files; the small
`deps/*.d.ts` declarations stand in for package export signatures, without claiming
runtime package or peer compatibility. CSS asset aliases use the same configured
TypeScript paths and resolve real stylesheets, not ambient CSS declarations.

The meaningful pre-change counterexample is `project/apps/desktop-app/src/renderer.tsx`
→ `features/nested/index.ts` → `entities/session/model/index.ts`. Running the original
checker against this entry returned exit 0 (`sourceFiles: 3`); its filename-only
`index` check accepted the private nested barrel. The `nested-public-bypass` case
resolves that same entity target through an alias and now requires the public API
violation. The positive `public-alias` case reaches the exact entity root and passes.

Coverage includes public/deep/sibling/upward imports, unknown source and target
layers, shared segment APIs, host aliases and transitive host re-exports, explicit
type-only bridge access, import-equals/require/computed imports, query loaders,
package APIs and package-to-application escapes. Styles cover own versus foreign
Modules, non-Module component styles, global placement, CSS imports/composition,
escaped paths, ICSS/value imports, external URLs, cycles and
comment/quoted text. Primitive and store cases verify approved placement and
forbidden feature or sibling entity store imports.

The named React selector integration is exactly
`apps/desktop-app/src/renderer/entities/workbench/model/store-selector.tsx`.
Only static named `useStore` imports from `zustand` or `zustand/react` are approved
there. `zustand/vanilla` is approved only inside `entities/workbench/model`;
`radix-ui` is approved only inside `packages/ui/src/primitives`. Variant fixture
projects prove the exact selector file cannot import `create`, use a namespace,
dynamically import the package or re-export it.

Two explicit migration exceptions remain. The flat shared baseline contains only
`shared/index.ts`, `shared/request.ts`, `shared/projection.mjs` and
`shared/projection.d.mts`; external consumers reach only its `index.ts`. Remove that
list when consumers move to shared segment APIs. The exact `src/renderer.css` file
and token source remain registered globals loaded at bootstrap. The coordinator
owns legacy selector containment/removal at the UI cutover; this dependency checker
does not claim to validate CSS selector reach or replace rendered UI checks.
