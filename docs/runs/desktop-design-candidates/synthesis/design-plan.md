# Compact desktop design proposal

Revision 1 · 2026-10-03 · DRAFT, awaiting independent design-spec review and user selection. This document supplies design decisions and migration analysis for [the execution plan, revision 1](../plan.md); it is not a second execution plan. The complete source contract is [design-systems.json](design-systems.json), and the concrete comparison is specified in [preview-brief.md](preview-brief.md).

The recommendation is **A, Quiet Dock**: a 216px sidebar, 32px session rows, readable 15/24 conversation text and a 72px shared composer. It changes the controls that feel oversized while retaining a familiar place to find sessions, write and inspect results. This is a recommendation to inspect, not an approved design or a claim that a rendered candidate passed review.

## Authority and evidence

The latest user correction supersedes the historical P3 visual pass. The approved product, permission, unknown-outcome, recovery and architecture contracts remain authoritative. The existing neutral white identity and system-first code font stack remain the default. Compactness must not erase operation scope or make successful effects appear from an uncertain response.

| Source | What is established | What it cannot establish |
| --- | --- | --- |
| Current renderer source and actual 1280×768 synthetic Electron capture | 256px navigation, large equal-weight controls, 128px initial composer and stretched selectors are the baseline under correction | Production provider execution, visual acceptance or target geometry |
| Live logged-out ChatGPT web, 1200×897 DPR2 | 260px side, 36px new-chat row, 14px label, 20px glyph; 52px composer with 44px action targets | Authenticated/native layout or a universal 52px standard |
| Public assistant-ui and shadcn demos at 1280×800 | 15/22.5 input, 32px controls, 16px icons; shadcn sidebar 32px rows and 14/20 labels; compact tool disclosure distinct from explicit permission card | Product behavior or permission authority; Nova rendered geometry cannot be attributed to New York v4 MCP source |
| DesignSystems.one | 4px rhythm and differentiated compact/comfortable density; body/UI/meta hierarchy | Measurements of this product or a vendor's native app |
| Existing Figma file, actual MCP reads | Existing on-canvas Input/NavigationItem and three token collections; 40px shell/row and Noto Sans KR representation | Approval to retain old density, code font parity or a third-party chat kit |
| Claude and Mobbin access | Historical official quick-entry/companion imagery; native Claude onboarding; Mobbin public thumbnails and anonymous MCP401 | Authenticated Claude chat geometry or detailed Mobbin screen research |

All reference observations are attributed to the frozen research, not re-measured by this synthesis. The code stack was directly read from generated CSS: `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Noto Sans KR", sans-serif`; code uses `"IBM Plex Mono", monospace` with fallback behavior. No bundled webfont was found in the coordinator's inspection. The manifest read during synthesis contains 178 tokens; the older Figma inventory has 61/65/37 variables. Those are different snapshots, not a synchronization claim. [Research summary](research-summary.md) supplies links and exact limits.

## Three compositions

All dimensions below are logical CSS px at 100% zoom. All three retain 15/24 message and input typography, 14/20 navigation, 12/18 metadata, 16px routine glyphs, a 32px normal action target and 36px permission actions. Control width is content-driven. They share the same palette and fixture so composition is the comparison variable.

| Property | A · Quiet Dock | B · Threadline | C · Rail Workbench |
| --- | --- | --- | --- |
| Navigation | Persistent 216px session sidebar | Persistent 200px sidebar, New/Search share a row | 56px rail; full 256px session drawer on demand |
| Header/context | 44px session header; context in composer | 40px header +32px agent/model context bar | 40px header with workspace/session; context in lower shelf row |
| Transcript | Centered, max720, 32px gutters | Left-aligned, max760, 48px gutters | Left-aligned, max816, 32px gutters |
| Empty entry | Small title and composer around y368 | Small title at y144, input directly beneath | Small title at y112; input remains at bottom |
| Composer | Two rows, one shared shell: full-width input then compact actions | One row in document flow after latest response; configuration stays in header | Borderless bottom shelf with one top divider; main input row and 28px context row |
| Empty surface / 3 lines | 72 /120 | 52 /92 | 68 /108 |
| One attachment, 1 line /3 lines | 112 /160 | 92 /132 | 108 /148 |
| Toolbar / maximum surface | 32 /192 | No internal toolbar /164 | 28 /180 |
| External hint footprint | 22 | 22 | None reserved; associated help on focus |
| Inspector initial width | 336 | 360 | 400 |
| Main tradeoff | 72px is taller than one-line references, but both context choices stay visible without crowding input | Writing can move offscreen; explicit Write action must bring it into view | More room for artifacts, but session discovery costs a drawer action and rail icons need clear labels |

A reduces the old composer surface by 56px, about44%, without shrinking conversation text. B reduces its surface by76px, about59%, but its separate context bar is part of the layout cost. C reduces the input shelf by60px, about47%, and reclaims200px of permanent navigation compared with the old256px sidebar. These are design arithmetic, not measured usability gains; the full footprint, including context and hints, is visible in the preview.

A is the recommended default because the user's complaint concerns awkward composition and oversized controls, not a request to relearn navigation. B is a credible alternative if proximity between response and next input matters most. C is appropriate if artifact inspection is the dominant task. User selection remains open after viewing all three in the same scenes.

## Shared foundation and component decisions

The JSON has one Primitive → Semantic → Component token graph, candidate semantic overrides, shared state profiles and 32 component-family contracts. Each candidate resolves independently in Light and Dark. It includes complete semantic text/surface/focus/status pairs, typography roles, 4px spacing plus intentional2px micro spacing, real target geometry, radii, functional-only elevation, strokes, motion and reduced-motion rules. Dimensions are numeric px in this draft schema; the existing canonical generator uses its own schema and is not replaced here.

Chrome and content have different jobs. Conversation and input remain15/24. Navigation stays14/20, metadata and local model/agent selectors12/18. The composer textarea has no inner border. Its attachment row appears only when occupied, and its input grows by line-height to a defined cap. A and C do not put stretch-to-fill agent/model controls beside each other; B locates them in session context. Essential scope and warnings remain full text.

Routine tool activity is a32px disclosure summary. Consequential permission is a content-sized card with scope, request context and consequences; it is never forced into the same density as routine tools. Preserve the current actions **이번만 허용** and **거절**, including the existing warning that rejection also cancels other pending permissions in the session. Do not copy the reference demo's Always/This session actions. An approved response is not proof that the requested operation completed.

Unknown, stale, unavailable, empty and failed are distinct states. Unknown mutation results do not enable automatic resend. A disconnected view can show prior content only with a stale label and timestamp. Permission decisions remain blocked until fresh authority is available. Compactness does not move these distinctions into tooltips or auto-dismissed toasts.

Use neutral native basic controls and the existing Radix family for complex overlays. Menus have32px rows,4px outer padding,8px row inset,16px icon slots,8px icon gap,4px trigger offset and8px viewport collision padding. Their focus outline is inset2px. Tooltips use12/18 text,8×6px padding,280px maximum width,6px offset,400ms hover delay and immediate keyboard-focus opening; they contain no unique consequential information.

## Renderer ownership and migration after selection

No source or canonical design file is changed by this proposal. The current paths were inspected; later implementers must re-read them because functional repairs are active in the parent run.

| Increment | Ownership and change | Completion evidence and dependency |
| --- | --- | --- |
| Proposal and comparison | This child owns `synthesis/**`; preview worker owns `preview/**` | JSON/static checks, independent design-spec review, then full-size rendered comparison. No production adoption implied. |
| Actual draft Figma projection | Primary coordinates a separately linked run; reuse existing file and preserve legacy assets | After comparison completion, build all three DRAFT candidates with real variable aliases, text styles and component states; read back bindings and capture representative frames. User authorized this follow-on work; candidate choice need not block draft construction. |
| Candidate adoption | Canonical design owner updates `docs/design/tokens/manifest.json`, `docs/design/components.json`, `docs/design/system.md`; regenerate `tokens.css` through the existing validator/generator | User selection plus independent updated design contract; review a token/component migration diff. Preserve semantic meaning and remove obsolete density values only after all consumers are mapped. |
| Shell/navigation | `apps/desktop-app/src/renderer/app/index.tsx`, `shell.module.css`; `features/sessions/index.tsx`, `sessions.module.css` | Chosen columns, 32px navigation, search behavior, long Korean names, all session/workspace actions and focus return. Keep effect handlers unchanged. |
| Conversation/composer | `features/conversation/index.tsx`, `conversation.module.css` | Shared input shell, candidate context placement, conditional attachment specimen, growth and keyboard/IME behavior. Preserve assistant-ui external runtime, draft isolation, send/stop and safe unknown handling. Attachment ingestion remains a separate capability if absent. |
| Shared controls and tool presentation | `packages/ui/src/primitives/action-menu*`, `modal-sheet*`, `status-badge/*`; existing owned `tool-ui/*`; conversation tool summary | Token-driven geometry and accessible state behavior; no second primitive/styling stack. Keep validated Tool UI dispatch and safe generic fallback. |
| Detail and library surfaces | `features/explorer/index.tsx`, `explorer.module.css`; `features/activity/*`; shell composition | Preserve current File/Catalog/Activity. Browser/Terminal/File artifact tabs are an explicit UI contract for the parent feature increment, gated by real capability and read-only states. Do not declare live browser/shell/installation functionality from preview markup. |
| State integration | Parent architecture/state owner only | One app-owned window-scoped Zustand owner replaces the old canonical owner atomically. This design does not introduce another store, Query, XState or custom authoritative state. Styling work must not conceal duplicate projections. |

CSS Modules remains the sole styling mechanism. assistant-ui remains the conversation/runtime foundation; Tool UI remains schema-validated result rendering. Copied shadcn source is reference material, not an adoption request. No package installation, runtime upgrade or new backend scope is required to build this preview or realize the visual contract.

The post-selection sequence is token mapping → shell/navigation and generic controls → composer/message/tool/permission presentation → supported inspector/library integration → rendered validation and independent code/design review. A coherent first production increment is the chosen sidebar/header/composer with existing behavior, not an empty wholesale rewrite. Keep state cutover sequencing in the parent plan. Rollback restores the selected token/CSS/markup change as one visual increment and never rewinds permission or message records.

## Actual renderer validation cases

The proposal's static validation does not certify implementation. The future renderer must demonstrate the following with synthetic fixtures before claiming visual completion; real provider/host effects retain their existing separate gates.

- Compare Empty, Conversation, Permission and Artifact at1280×800,100% zoom, Light/Dark, without a scaled screenshot. At 900×700,640×800 and320×640, verify appropriate overlays, wrapping and contained code scroll. Repeat at200% browser zoom and a short440px height.
- Inspect one-, two- and three-line drafts, maximum-height input, one/multiple attachments, long agent/model names and unavailable selections. Send/Stop must remain in the same stable slot. Opening a menu must not clip focus or hide the field.
- Type Korean with IME; Enter while composing cannot submit. Verify Shift+Enter, slash insertion, command navigation, Escape dismissal, session switch draft isolation and no cross-session stop/permission action.
- Exercise keyboard-only navigation, menus, selectors, dialog/drawer focus containment/return, inspector tab roving focus and keyboard resize. Check screen-reader names, status announcements and no per-token speech flood.
- Render tool pending/running/completed/error/unknown/stale, malformed result fallback, a long permission scope and multiple queued permissions. Show rejected/expired/unknown decisions without enabling a duplicate effect. Preserve the rejection consequence text.
- Render stale connection, failed catalog read, successful empty catalog, missing file, blocked browser preview and terminal output with unknown exit. Never turn these into a generic successful-empty state.
- Check computed text contrast, essential control boundaries, focus visibility, forced colors and reduced motion on actual DOM. Light/dark token arithmetic is necessary but insufficient for rendered accessibility.

No local application test suite was run by synthesis. The isolated proposal permits JSON parsing, alias/state-reference checks, contrast arithmetic and geometry checks. Runtime and rendered acceptance remain assigned to independent consumers/reviewers.

## Figma projection readiness

`design-systems.json.figmaProjection` is the binding contract. Use one new **DRAFT Compact / Primitive** collection and candidate-specific **Semantic** and **Component** collections, each with explicit Light/Dark modes. This produces seven new collections without changing legacy ones. Each semantic value resolves to a shared primitive; each component value aliases the matching candidate semantic variable. Explicitly apply both collection modes on each frame; identical mode names alone do not synchronize collections.

Project the32 shared component families with candidate overrides. Use the declared state axes and meaningful variants, not every impossible state combination. Bind fills/strokes/radii/spacing/size properties where supported. Create nine typography roles per candidate and functional effect styles; record any properties represented by styles rather than direct variable binding. The family inventory includes the shell, navigation/workspace/session/search, basic and icon controls, menu/dialog/tooltip/select/input, composer/send-stop/attachments/commands, user/assistant messages and code, tool/evidence/permission/status/toast/error, inspector/tabs/file/terminal/browser and extension library.

The coordinator verified available Figma Noto Sans KR Regular/Medium/Bold and IBM Plex Mono Regular/Medium/SemiBold. Use Noto Sans KR in Figma to represent the Korean scale, and IBM Plex Mono for code; load the exact style before text creation. This is explicitly a Figma representation mapping. Keep the production system-first font stack and do not claim pixel parity between Figma and the macOS renderer.

Create DRAFT Foundations, Components, A Quiet Dock, B Threadline and C Rail Workbench pages. Include the same fixture, Light/Dark and component state specimens. Read back actual variable IDs, mode IDs, alias objects, bindings and component properties; inspect rendered frames. Legacy pages and assets remain untouched. Final selection later determines canonical adoption and any production library publication; this draft projection is not self-approval.

## Decision register and review handoff

Confirmed: three compact desktop candidates; existing neutral identity; actual full-size comparison; preserved product semantics; assistant-ui/Tool UI and CSS Modules; follow-on actual Figma draft construction. Proposed: exact dimensions and composition of A/B/C, the new draft token graph and component states. Open: the user's candidate selection, blocking production restyling only. No missing reference access blocks these proposals.

The primary registers the proposal contract for independent `design_spec` review before a consumer implements the preview or Figma projection. Rendered candidate review follows preview implementation. The author has not approved either. Relevant parent functional work continues under its own reviewed plan; this document does not mark the product complete.

## Synthesis checks actually executed

The four-file proposal was parsed and checked locally on2026-10-03:475 unique typed tokens; six candidate/mode resolutions; no missing, cyclic, cross-layer or type-mismatched aliases; component state-profile references resolve; all32 families have geometry, states, behavior and Figma variant metadata. The78 declared contrast-pair checks pass their respective4.5:1 text or3:1 essential-UI thresholds (lowest measured pair3.222:1 is an essential-UI boundary). Empty, three-line, maximum-input and attachment height arithmetic agrees with the resolved composer tokens for all three candidates in both modes. The folder contains exactly the four assigned files. These are static contract checks, not rendered validation, independent approval or production accessibility certification.
