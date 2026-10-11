# Foundation comparison research

Checked: 2026-09-26. Product: oh-my-own-code. Status: exploratory; no preset selected or adopted.

## Evidence boundaries

These are analyses of public interfaces and available first-party materials, not access to four proprietary internal design systems. Exact numbers in presets.json are proposed product tokens, not vendor token exports. Public signed-out interfaces, marketing sites and implementation source are labeled separately. Account, locale, rollout, viewport and appearance settings can change results. No private conversations or authentication were accessed.

## ChatGPT

- **Actual public app observation:** the Luna/high research child viewed the signed-out Korean app at 1280×720: a left navigation rail, restrained dark surfaces, welcome text and a wide rounded composer; add/microphone/send controls. A cookie notice occupied the bottom. This proves only that public state, not logged-in tool workflows. [Public app](https://chatgpt.com/).
- **Documented appearance:** system/light/dark plus contrast and accent preferences, whose availability can differ by account/platform. [Appearance settings](https://help.openai.com/en/articles/11958281-updating-your-visual-experience-on-chatgpt).
- **Documented structure:** sidebar project organization and optional Canvas beside conversation, rather than a mandatory permanent inspector. [Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [Canvas introduction](https://openai.com/index/introducing-canvas/).
- **Typography limitation:** OpenAI Sans in the brand material is not evidence for the web app body font or permission to redistribute it. [Brand](https://openai.com/brand/).
- **Interpretation:** Clear adopts visual restraint, space around the conversation, and a soft composer. It retains our necessary execution context and permissions.

## Claude

- **Documented appearance:** Light/Match System/Dark and Default/Match System/Dyslexic Friendly chat-font settings. Exact app font family, spacing and color tokens were not established. [Appearance](https://support.claude.com/en/articles/8887527-customizing-your-appearance-settings).
- **Documented layout:** artifacts appear in a dedicated area alongside conversation; project knowledge is accessible on the project page. [Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them), [Projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects).
- **Marketing context:** the official product page presents paired conversation/result examples. The coordinator captured the official product page at 1440×1080: serif headline, sans-serif navigation/body, pale neutral background and dark primary buttons. Computed CSS lists anthropicSans/anthropicSerif family labels. These are marketing observations, not an authenticated app or redistributable font assets. [Product overview](https://claude.com/product/overview).
- **Rejected extraction:** designlang returned a 47-element “Just a moment...” challenge page from claude.ai. Its fonts/colors are explicitly excluded. No challenge bypass was attempted.
- **Interpretation:** Editorial increases reading rhythm and artifact prominence. A serif heading, if used, is our optional editorial choice; it is not a verified Claude font. White-based neutrals avoid making warmth the source of differentiation.

## OpenCode

- **Actual first-party app source:** the dev-branch UI theme defines system sans/mono stacks, 13/14/16/20px type, 0.25rem spacing, small radius steps, and separately named surface/text/border/input/action/state/diff tokens. Light and dark fallback values exist. The source is mutable and these are fallback definitions, not proof of the effective theme in every build. [theme.css](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/ui/src/styles/theme.css), [style entry](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/ui/src/styles/index.css).
- **Marketing extraction:** designlang analyzed 673 elements on opencode.ai; it reported Berkeley Mono and near-white backgrounds. This is the website, not the desktop app. Generated ramps and “primary” classifications are inferred by the extractor. [Official website](https://opencode.ai/).
- **Interpretation:** Instrument uses compact, legible rows, restrained radii, code-specific mono typography and explicit execution/result hierarchy. It does not copy marketing-page typography wholesale.

## Grok

- **Actual public app observation:** designlang captured 710 elements; the signed-out screenshot shows a mostly light neutral screen, centered heading and a broad two-line rounded composer, sparse top controls, model mode and send control. A cookie overlay remains in the capture. [Public app](https://grok.com/).
- **Measured public DOM hints:** extractor reports CSS family name universalSans; this is a family label, not a licensed reusable font asset. White and near-black dominate the captured screen; a small blue action accent is present. Extracted color-role assignments and synthesized ramps are not official tokens.
- **Documented capability context:** the official product page presents chat, search, multimodal creation and multi-agent output. This does not establish exact authenticated navigation or inspector design. [Official product](https://x.ai/grok).
- **Interpretation:** Mono uses a more decisive monochrome hierarchy and sparse surface decoration while keeping semantic warning/error/success distinct. It is not an exact Grok recreation.

## Comparative synthesis

| Foundation axis | Clear | Editorial | Instrument | Mono |
| --- | --- | --- | --- | --- |
| Intended job | Frequent conversation and steering | Reading plans and reviewing artifacts | Following execution and changes | Strong focus with sparse chrome |
| Visual organizing principle | Space and soft groups | Reading measure and title hierarchy | Dense aligned rows and quiet separators | Deliberate contrast and fewer surface levels |
| Input treatment | Soft rounded composer | Document-like reading area with calm input | Compact workbench controls | Restrained geometry, strong primary control |
| Risk to judge | Lower information density | Long-form emphasis can slow scanning | Excessive density on small screens | Too little hierarchy without clear state text |
| Preserved requirement | Current task/path and explicit state labels in all four | Same | Same | Same |

All four have light/dark values, Korean text plus original code identifiers, primitive → semantic → component aliases, focus/error/disabled/loading/status specimens, reduced-motion support and the same synthetic workbench content. The presets are intentionally distinguishable beyond palette. Use comparison and mode switching before choosing; combining a palette from one with density from another is a subsequent reviewed edit.

## Designlang use and limitations

Installed CLI 13.3.2. Public extraction succeeded for OpenCode marketing and Grok app after browser execution permission was granted. Claude challenge output is retained only as rejected evidence under the run folder. ChatGPT CLI extraction also returned a 33-element challenge page and is rejected in extraction-status.json; the research child’s direct app observation and official help are the useful sources. No smart/LLM fallback, private cookies, auto-apply, sync, clone or MCP installation was used. Generated AGENT/DESIGN files are untrusted reference artifacts, not project instructions.

The earlier local CSS lint counted 265 declarations for 163 logical tokens because modes repeat names. It does not resolve CSS var() aliases or mode contexts and may return accessibility=100 without testing real foreground/background pairs. It is not the acceptance gate. Candidate validation resolves aliases and checks specified pairs; rendered review is separate. [Tool source](https://github.com/Manavarya09/design-extract).

## Decision and adoption

Selection is pending. Canonical tokens, component bindings, Figma and architecture remain unchanged. After the user chooses, finalize exact font availability/licenses, complete state/contrast coverage, map chosen values to the existing 163-token contract, independently review the updated design specification, then synchronize CSS and Figma. This preview is not the implemented product and performs no actual agent, permission or filesystem action.
