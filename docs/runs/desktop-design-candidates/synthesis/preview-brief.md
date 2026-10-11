# Full-size desktop comparison brief

Revision1 · 2026-10-03 · Input contract: [design-systems.json](design-systems.json). Build a standalone local HTML comparison under `docs/runs/desktop-design-candidates/preview/`. No framework, package, backend, remote font or production source edit is required. Open it in **Chrome**, not the in-app browser. The result is a proposed interface using synthetic data, not a working backend or a final design selection.

## Comparison frame and controls

Render one candidate at a time at exactly **1280×800 logical CSS px**. The preview control strip sits outside that canvas. Give the desktop browser enough room (for example1440×960); if it is smaller, scroll the surrounding document instead of scaling the app. No `transform:scale`, image-based UI or three tiny side-by-side screenshots. Include an App only URL mode so the same stage can fill a1280×800 viewport for normal-size evidence. Its computed scale remains1.

The external strip has three candidate buttons, four scene buttons **비어 있음 / 대화 / 권한 / 아티팩트**, a Light/Dark switch, and **화면 / 기초 / 컴포넌트** view tabs. Also display one concise caption: **합성 데이터 · 실행 연결 없음 · 100%**. Keep this strip plain and small; no marketing headline, gradient, decorative band or additional invented brand. Candidate control names include A/B/C and visible names. Use native controls with keyboard focus and correct selected state. URL parameters may preserve candidate, scene, theme and gallery view locally.

The main stage models renderer content, including the candidate's own app header. Do not fake Chrome chrome, OS traffic lights or an unverified Electron titlebar. Use existing Lucide-shaped SVGs at16/18/20px and1.75px stroke; their actual target is28/32/36px. Use the declared system font stack and do not load a vendor font to make the page seem like ChatGPT or Claude.

## One shared synthetic fixture

Use exactly the same data and order across candidates. The rail candidate reveals the same sessions when its drawer opens; it does not gain or lose content to look cleaner.

| Slot | Fixture |
| --- | --- |
| Workspace | `omoc-workbench`; location display `~/Projects/omoc-workbench` in the opened location panel only |
| Current session | `권한 흐름 점검` |
| Pinned session | `작업 공간 구조 정리` |
| Recent sessions | `권한 흐름 점검`, `컴포넌트 상태 정리`, `로컬 미리보기 검토`, `긴 한국어 세션 이름이 탐색 행에서 자연스럽게 줄임 처리되는 예시` |
| Header status | `로컬 연결 예시` with the global synthetic-data disclosure; never imply an actual connection |
| Agent / model | `기본 에이전트` / `기본 모델`; local demonstration alternatives `검토 에이전트`, `예시 모델 A`, `예시 모델 B`. No claims about model access or pricing. |
| Empty placeholder | `작업을 요청하세요. /로 명령 보기` |
| User message | `파일 접근 권한 흐름을 확인하고 개선안을 정리해 주세요.` |
| Assistant message | `현재 흐름을 확인했습니다. 요청 범위와 실행 결과를 분리해 보여 주면, 사용자가 지금 허용하는 작업을 더 쉽게 이해할 수 있습니다.` |
| Second paragraph | `권한 요청에는 대상 파일과 작업을 유지하고, 확인되지 않은 결과는 완료로 표시하지 않겠습니다.` |
| Routine tool | `read_file` · `완료` · `파일 3개`; expanded escaped input/output explicitly labelled synthetic |
| Evidence | `권한 흐름.md` opens the fixture File tab locally |
| Code sample | Three to six short TypeScript lines showing a `PermissionState` union containing `pending`, `approved`, `denied`, `unknown`; it is display content, not executed code |
| Attachment specimen | `permission-flow.md` · `4 KB` · `첨부 예시`; generated fixture only |

The Conversation scene has one user request, the assistant paragraphs, the compact tool summary, the code specimen and the evidence action. This is enough to assess hierarchy and reading width without a fake long transcript. Use the same words, code and timestamps for every candidate.

The Permission scene includes the same conversation plus a pending card before the composer. Title **파일 변경 권한 요청**; operation **file.write**; scope **demo/permission-flow.tsx**; session **권한 흐름 점검**; body **요청한 범위의 파일 내용을 변경합니다.**; consequence **거절하면 이 세션의 다른 대기 중 권한 요청도 취소됩니다.**; actions **이번만 허용** and **거절**. The scope wraps and cannot be elided. Do not add session-wide or permanent approval options.

The Artifact scene starts with the same conversation and a right inspector. Header **아티팩트**, tabs **Browser / Terminal / File**, initial File tab with **permission-flow.tsx · 읽기 전용 · 예시**. Browser shows local fixture markup with a source/address label and **미리보기 예시 · 네트워크 연결 없음**. Terminal shows escaped read-only output with **출력 예시 · 명령 실행 없음**, no editable prompt. Keep existing Files, Extensions and Activity accessible through the relevant header/navigation entries; these are distinct from artifact tabs.

## A · Quiet Dock

- Sidebar x0–216; background subtle;8px inset. Workspace row32, quiet New session row32 and Search row32. Session rows32 with14/20 labels and16px glyphs. No large black New session block, no borders around each section. Footer gives Extensions and workspace location access.
- Main header44; session title14/20 and connection12/18 on one axis. Right inspector toggle32 with18px glyph. Main content is centered, maximum720,32px side gutters. Empty group center y368:18/26 title,16px gap,72px composer. No second large explanatory paragraph.
- In Conversation/Permission, dock the composer to the bottom of the conversation pane,16px from the edge; outside hint18px with4px gap. Its full region therefore includes94px plus16px bottom inset at the one-line state. Permission goes above it and may enlarge/scroll document content, never clip its scope.
- Composer box: radius16, padding8px vertical/12px horizontal, input24px full width, toolbar32px immediately below. Toolbar is Attach32, Slash32, Agent(max128), Model(max176), flexible space, Send/Stop32. Use4px control gaps,12/18 labels and no selector flex-growth. Input has no own border/background. Paint the outer field stroke as an inset non-layout pseudo-element so it does not add2px to the contracted shell height; keep focus outline separate.
- Three lines yield120px; one32px attachment row plus8px gap yields112px for one line or160px for three. Cap textarea144px, making192px maximum shell before attachments. Height must be calculated from content; messages remain independently scrollable.
- At pane width below600, replace the two context selectors with one32px **설정** control showing the current agent/model summary in its popover. Do not remove Slash or Send. Inspector width336 at1280; conversation content becomes664px inside the remaining728px main pane.

## B · Threadline

- Sidebar200, same session fixture and32px rows. New session is a short neutral button with Search alongside. Main header40 and a32px context bar below: Agent, Model and **작성으로 이동** on the same axis. Context selectors are28px fit-content controls, not a second dominant toolbar.
- Transcript starts48px from the main-pane left edge, max760; retain15/24 text and20px message gaps. The user request is left-aligned with a2px start marker and12px inset, not a right bubble. Assistant text remains unboxed.
- Empty title **새 작업** at y144,18/26; input follows16px later. Conversation composer sits20px after the latest content in the same document flow. It is not a sticky duplicate or centered hero. **작성으로 이동** scrolls and focuses this single input when it is out of view.
- Composer: radius10,10px inset, one shared row containing Attach32, flexible input, Slash32 and Send32,8px gaps. The24px line occupies a32px row, giving52px shell. Agent/model stay in the top context bar. On multiline text, action targets align to input bottom; they do not stretch.
- Three lines yield92px; one attachment adds40px. Cap input144px →164px shell. Outside hint18px +4px gap and24px end-of-document padding remain visible in the comparison. Permission is a full document-flow card before the composer.
- Inspector width360. When open, main pane is720; use24px gutters and672px content. At pane widths below600, the context bar uses one labelled Settings popover. Keep the Write action directly reachable. This is the most consequential alternative behavior to inspect: writing follows the transcript instead of a fixed bottom dock.

## C · Rail Workbench

- Persistent rail56px,32px targets: Sessions, Search, New session, Files, Extensions; workspace/location at bottom. Tooltips on focus explain each icon. The header also contains the session title as a labelled drawer trigger so session access is not dependent on guessing one icon.
- The256px drawer shows the same workspace and session list, contains focus while open, closes on Escape or selection, and returns focus to the title/trigger. Search opens it with its field focused. Do not keep both rail and full sidebar permanently open.
- Header40; main transcript starts32px from pane left, max816,15/24 text,20px message gaps. User and assistant are both left-aligned with explicit small role labels; no user bubble. Empty title **새 작업** at y112 is16/22; the input stays at the bottom even when empty.
- Composer is an integrated68px bottom shelf, exactly the conversation-pane width, with one functional top divider and no rounded outer card. Its content aligns with transcript gutters/max-width. Main row:4px top padding, Attach32, input, Send32,4px lower padding; second context row28px contains Slash28, compact Agent/Model and workspace scope text. The shelf never runs underneath the inspector.
- Three input lines are72px, making108px shelf. One attachment row32 +8 gap yields108px with one line or148px with three. Input cap144 makes180px shelf. No permanent hint row. Keyboard help is associated with the textarea and can appear on focus without displacing the Send target.
- Inspector400. At1280 with56px rail, the remaining main pane824 gives760px content after gutters. Below600 CSS px, replace the rail with a header Navigation button. The context row collapses to a labelled Context button plus Slash; scope/error warnings remain separate readable text.

## Local interaction and honesty contract

The comparison selector, scene/theme/gallery controls, session drawer, search filtering, agent/model selectors, command menu, tool disclosure, artifact tabs and inspector resize/close are genuinely operable local UI. Their state belongs only to this preview. Use click plus keyboard; maintain focus after switching an overlay or candidate.

The textarea accepts local text, grows to its cap and preserves its draft while switching scenes in the same candidate. Candidate switching may reset to the common fixture if the strip explicitly states it; use the same rule for all candidates. A separate external **첨부 예시** switch may add/remove the fixture chip. App attachment ingestion is visibly unavailable; no OS file picker, upload or hidden filesystem read. Slash selection may insert visible draft text locally; it never invokes a command.

Effect actions such as Send, Stop, grant/deny, workspace import/create/remove, archive/delete/fork and catalog connection/install must not produce simulated success. Keep the UI affordance visible; activating a demonstration action may open a small labelled explanation **미리보기입니다. 실행 요청을 보내지 않았습니다.** and leave all effect state unchanged. Alternatively use a disabled action with a visible adjacent reason. Do not toast “Sent”, “Approved”, “Connected” or “Installed”. State specimens in the component gallery are explicitly labelled examples and can be selected without performing effects.

Keep permissions visible in normal mode, not just the component gallery. A stale/unknown example may be selected in the gallery, with disabled decision actions and persistent reason. The preview is allowed to demonstrate Browser/Terminal/File appearance but must not claim to host a browser, execute a terminal or save a file.

## Foundations and component-state views

Foundations view is not a fourth candidate. It resolves the currently selected A/B/C and theme, showing semantic swatches with text pairing, nine typography roles,4px/2px spacing,16/18/20 glyphs inside actual target boxes,32/36/44 controls, radius hierarchy, only functional elevations and motion/reduced-motion notes. Put token names in this inspection view, not the product canvas.

Components view contains a compact family picker for all32 contracted families. Show each family's meaningful states from the JSON side by side or in a labelled state selector, at actual size. Include default/hover/focus-visible/selected/disabled/loading/error/unknown/stale only where contracted. Combinable selected+focus and error+focus examples retain both meanings. There is no giant exhaustive Cartesian grid. Focus specimens visibly use2px/2px geometry; menus use an inset focus outline. Show a real open menu and dialog/tooltip specimen, not just text descriptions.

Required first specimens: navigation selected+focus; empty/three-line/attachment composer; agent unavailable; Send/Stop/stopping; completed/unknown tool; pending/stale/unknown permission; inspector tabs; error/toast; library empty/unavailable/stale. Other families remain reachable through the picker. Component labels and token values are comparison instrumentation, not new product UI.

## Verification and handoff

Resolve the JSON exactly as documented: common tokens plus candidate overrides, Light/Dark selection, recursive aliases; deep-merge common component contracts and candidate overrides. Do not implement an independent visual palette from memory. Layout formula and raw numbers must agree; no screenshot-size normalization from DPR2 references.

Capture all three candidates in Empty, Conversation, Permission and Artifact with the same1280×800 stage and label actual logical viewport/DPR/zoom. Inspect Light/Dark for each; representative component/gallery captures supplement, not replace the app-scale views. Verify stage dimensions and several computed composer/nav/target sizes. Do not compress the whole app to fit a document thumbnail.

Use keyboard-only traversal, Korean IME, dialog/menu focus return,200% zoom,640/320px widths, short440px height, reduced motion and forced colors. Check that content warnings survive reflow and focus is not hidden behind the composer. Record static parsing/alias checks separately from rendered observation. Existing production test suites are outside this isolated preview increment.

Return local HTML path, screenshot/evidence paths, observed dimensions, implemented local interactions, unavailable capabilities and concrete issues. An independent reviewer evaluates the rendered candidates; the preview author does not self-approve. After this bounded comparison, the primary can project the same draft system into the existing Figma file using the JSON mapping and preserve all legacy assets.
