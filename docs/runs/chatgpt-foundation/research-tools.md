# Public UI and tool evidence

2026-09-27. Scope: public signed-out `https://chatgpt.com/` at 1280×720, Korean locale. No private chats, login, or proprietary design files were inspected.

## Computer-use observations

At system/dark appearance, the sidebar occupied 260px, with black canvas, sparse navigation, one vertical separation, and a centered heading/composer. At light appearance, the sidebar was near-white and the main canvas white; the same hierarchy remained. The browser's computed style reported a system sans stack, 16px base text and a 24px/28px heading. The broad composer was centered around a ~770px reading measure. A rounded composer boundary and a few sidebar dividers carried structure; messages and main canvas were not organized as repeated cards. Theme was returned to its original System setting after inspection. These are measurements of this one public state, not reusable OpenAI design tokens or evidence of authenticated tool, permission, and artifact workflows.

Comparison axes for final preview: sidebar width and quiet navigation; conversation reading width; message separation by typography/spacing; composer location and shape; use of surfaces, borders and dividers. Product-specific tool and permission evidence must remain explicit even where the public reference has no equivalent.

## designlang CLI

Installed CLI: `designlang` 13.3.2. A browser extraction of ChatGPT produced a challenge page headed `잠시만 기다리십시오…`; its generated values and screenshots are invalid for matching the product. The folder `docs/design/research/chatgpt-designlang/` is rejected evidence. `designlang lint docs/design/tokens/tokens.css --json` on the pre-change canonical CSS reported 265 CSS declarations, score 82/B and radius-sprawl warning. It counts mode declarations and does not resolve semantic/component aliases or judge the rendered product; the project validator and browser review remain the gates.

## UI Skills CLI

`npx --yes ui-skills categories` and `list --category visual` succeeded after ordinary sandbox DNS resolution failed and the network call was retried through the permitted escalation. The smallest applicable set was `ibelick/baseline-ui` and `jakubkrehel/better-ui` via `npx --yes ui-skills get ...`. The `container-lines` item was inspected but rejected because it prescribes decorative guide lines contrary to this product direction.

Applied rules: hierarchy through spacing and type, restrained single-view accent, no gradients or glow, preserve focus/ARIA and reduced motion, keep borders for structural separation or state, and prefer quiet surface depth over outlining every container. Framework-specific Tailwind/React instructions do not apply to this standalone HTML/CSS preview. The CLI supplies guidance; it is not an automatic visual QA or accessibility certification.
