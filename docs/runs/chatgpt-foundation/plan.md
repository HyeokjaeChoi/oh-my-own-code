# ChatGPT-inspired foundation adoption

Revision: 4. Date: 2026-09-27. Coordinator: /root.

## Confirmed request and decision

The user selected the ChatGPT direction from `docs/design/explorations/foundation-options/` and asked to match the actual product as closely as public observation supports. Remove decorative stripes and indiscriminate borders, use designlang CLI and computer-use comparison, and apply UI Skills CLI anti-slop guidance. The target is a production-ready design foundation and realistic workbench reference for oh-my-own-code. The repo currently has no application implementation; do not claim that the static preview is the shipped product.

## Evidence and constraints

- Actual public, logged-out `chatgpt.com` was inspected in a browser on 2026-09-27. Its observed structure was a quiet sidebar, spacious conversation canvas, strong content hierarchy, rounded composer, and very limited separators. Authenticated surfaces and proprietary token values were not observed.
- `designlang` extraction of `chatgpt.com` returned an anti-bot challenge (`site: 잠시만 기다리십시오…`), so its extracted palette, font and component files are rejected as design evidence. Retain a clear warning on that folder; use designlang on the local implementation where useful.
- Existing canonical three-layer token manifest, CSS generator, component states, and Figma source belong to `docs/design/`. Preserve product safety semantics: permission decision is distinct from execution success; failure and verification states remain explicit.
- The user authorized local design work and selected this direction. Do not request another selection. Do not publish a Figma library or change access scope.

## Scope and ownership

1. Research and document public ChatGPT observations, designlang extraction limits, and UI Skills CLI selection. Use the CLI if available; if its package cannot be fetched, document the precise failure and use its first-party published guidance without claiming a CLI pass.
2. Revise `docs/design/system.md` and `docs/design/tokens/manifest.json` into a neutral, content-first ChatGPT-inspired foundation, while retaining the three-layer alias contract, state meaning, Korean/code readability, light/dark support, focus and contrast. Regenerate `tokens.css` deterministically. Update `components.json` only if changed tokens or new component rules require it. Revise the Figma source file when callable, with repo tokens as source.
3. Convert the selected preview into a credible workbench reference: canvas-led layout, restrained/sidebar navigation, a stable central conversation and composer, clear tool/permission evidence, responsive panel behavior. Remove ornamental stripes, repeated boxed cards and unnecessary borders from the preview/lab page. Keep four historical candidates comparable only as research context; clearly identify the selected direction and actual product scope. The selected preview must consume canonical `tokens.css` directly or a deterministic manifest-derived map; a separate hand-tuned Clear theme is not acceptable. Browser verification must compare computed selected light/dark colors, fonts, spacing and composer geometry with canonical values.
4. Verify the canonical token generator/contrast, preview behavior in desktop and narrow browser, keyboard/focus, dark mode, UI Skills anti-slop review, and independent code/design judgments. Keep Chrome showing the final local preview.

The coordinator owns integration and ledger. Any child owns only its assigned paths or returns read-only review. Figma changes follow an independent design-spec review of the revised source document and registered handoff. Source changes after review require a refreshed gate.

## Acceptance

- AC-1: Selected foundation has documented public observations and honest designlang/UI Skills evidence. No challenge-page values enter the canonical source.
- AC-2: Canonical primitive/semantic/component tokens and CSS are valid, support light/dark and required states, and express the selected neutral direction with tested contrast.
- AC-3: The local workbench preview is visually restrained and usable at desktop/mobile; decorative stripes and indiscriminate borders are absent, while permission/tool outcomes remain legible. Compare the final preview with public ChatGPT observations by sidebar, reading width, messages, composer, surfaces and separator use. Check desktop/narrow, two modes, panel toggle and accessibility, keyboard order/focus return, 200% zoom, long Korean/path text, and distinct permission-decision versus execution-result labels. The composer/send control stays explicitly demonstrative and cannot imply that a message was sent or a tool ran.
- AC-4: Independent plan, design-spec, code and rendered-design reviews pass, recorded checks pass, and Figma source is synchronized if the connector is available. Publication is out of scope.

## Verification contract and dependency holds

Initial check contract covers `docs/design/validate_system.py` and a dedicated browser inspection script. Write the new design source and update its document hash in `contract.json`, then re-register/re-review the changed plan/contract, obtain `design_spec_reviewer`, and run `handoff --gate design_spec` before using it for preview or Figma changes. Browser captures must be from the current preview, not the prior exploration screenshots. Browser check covers all AC-3 interactions and verifies computed canonical-to-preview values in both modes. `design_qa` judges rendered captures independently; a browser checklist alone is insufficient. The repository has no executable product app, so this run verifies the design source and prototype, not production integration.

## Open questions and change history

No blocking product choice remains. Public ChatGPT access may differ by auth/region/theme, and designlang challenge data is not valid evidence. Revision 1: incorporate selected ChatGPT direction plus border/production-grade feedback. Revision 2: require a canonical-to-preview binding, concrete public comparison dimensions, and observable browser interaction/zoom checks after independent plan review. Revision 3: register the authored design-system source and canonical validation script as the reviewed dependency for preview and Figma sync. Revision 4: correct actual observation date, use Figma-available Noto Sans KR with a browser system-sans mapping, and require combined focused-error and focused-selected states after independent design review.
