# Workbench desktop foundation v2
Version: 2 · 2026-10-09 KST · Proposed until independent entry pass

## 1. Product direction and authority
A local development Workbench: conversation is the primary work surface; files, changes, agents and execution evidence are contextual tools. Quiet defaults must coexist with explicit safety information. This supersedes layout/density/composition guidance of the older system where contradictory, not permission/receipt/storage/runtime behavior. No new library, state ownership, module layer or runtime boundary. CSS Modules and existing token generation remain authoritative. Public vendor patterns inspire hierarchy, not a pixel clone or claim of proprietary tokens.

## 2. Surface ownership
Wide view: Workspace/session navigation at left, one central conversation lane, optional task panel at right. Header identifies current task/session and runtime health. The main conversation scrolls; message Composer remains a separate bottom task. Avoid independent scroll containers except bounded raw code/previews, a task panel, or native textarea. Do not place investigation forms inside the Composer.

```text
Workspace + navigation | session title + runtime state       | task title / close
create / search        |                                    | file / changes /
recent sessions        | conversation and execution evidence | configuration
                       | contextual task disclosure          | current task
secondary management   | message Composer + send/interrupt   |
```

Default bottom surface contains message input, compact selected request summary, attachment count/names when present, contextual task triggers and one primary send/interrupt action. It does not show all settings fields or explanations. Selected Agent/model/Variant values must be discoverable in visible summary, with unset described as Native decision, not guessed defaults. The exact requested fields remain in a labelled disclosure outside Composer. Actual Native session settings stay a separate disclosure and never become requested-setting success.

Attachments/current-run management use separate labelled task sections outside the message form. Existing feature-local details are preferred over a new overlay engine. A click/key opens the task and reveals the relevant controls; closing does not lose draft/captured bytes or submit anything. Scope/epoch/reset behavior remains existing source authority. Branch preview can explicitly reveal its confirmation task, never auto-create a branch or send.

## 3. Progressive disclosure and nonhidden risk
Level1: current identity, message, selected requests, attachment name/count/type/state, primary action and current blocker.
Level2: explicit attachment selection/preview, requested runtime settings, branch confirmation or current-run steer/queue tasks.
Level3: exact hash/version/full source metadata and diagnostic explanation, selectable and keyboard accessible.
Never hide active errors, expired context, unknown effects, trust/recovery holds or permission decisions solely in collapsed details. Provide a concise persistent status near the affected task with a details link when needed. Keep reason labels exact where API/tests depend on them. Unknown never looks completed and has lookup-only original identity. Long safety explanations move to help/details, but critical consequence text remains beside its effect action. Cancellation ACK stays a request acknowledgment, not proof of nonexecution. Retry/edit preserve no replay and current-files unchanged warning.

## 4. Foundation tokens
Keep manifest.json -> generated tokens.css deterministic. Preserve existing primitive/semantic/component alias layers and six legacy component families/44 variants. Extend app composition contracts separately, do not replace permission maps. Use named semantic/component tokens in shared patterns; local CSS handles real feature layout, not another shadow token source.

Base palette uses existing white #ffffff, near-black #171717, navigation #fafafa(light)/#262626(dark), subtle #f5f5f5(light) and #3d3d3d(dark); primary text #171717/#ffffff. Secondary text #555555 light; dark uses existing neutral with >=4.5:1 on its intended surface. Primary action is dark/light inverse. Blue is keyboard focus; red/amber/green retain semantic status only. Decorative separators may use subtle surface contrast; actionable input boundaries and focus retain >=3:1. Do not use strong input-border tokens to box every section. No decorative gradients/glow/glass/noise.

System sans first for macOS/Windows/Korean; no downloaded font. Body conversation16/24, normal UI14/20, supporting text13/20, compact labels12/18, section heading16/24 medium, empty task heading22/28 medium. Code/path use existing system monospace fallback at13/20, selectable. Existing Figma font substitutions remain historical; no Figma sync claim. Display weight/size expresses hierarchy, not repeated uppercase eyebrows.

Spacing scale4/8/12/16/24/32; related controls8, panel padding16, task groups24. Radius: dense controls8, grouped panels12, Composer24, rounded icon affordances only where appropriate. Adopt content reading width768px and navigation width256px through existing tokens (current720px/216px are migration inputs, not already implemented values); side task width follows existing resize contract. No arbitrary fixed outer page width.

Interactive dense pointer targets use existing desktop hit-target token minimum32px; primary standard controls40px; coarse pointer44px. This explicitly replaces the old system's universal44px assertion for dense desktop-only rows, while required permission-action hit areas remain44px and8px separation. All icon-only controls require accessible name, hover hint where existing implementation supports it, visible focus, disabled semantics and pressed/expanded/current indication. Prefer existing Button/native controls, ActionMenu and ModalSheet; do not restyle nested Tool UI internals globally.

## 5. Components and composition
Define canonical control roles: primary (one task commitment), secondary (local adjustment), quiet (navigation/disclosure/metadata), danger (only destructive consequence). Loading disables repeat but preserves label; selected differs from hover; focus uses2px ring+2px offset without reflow. Disabled opacity never replaces explanation of critical blocking reason. Inputs have label, content-sized feedback and aria-invalid for errors. Dense control styles share token bindings; CSS selector scope is explicit, no generic form/button reset that changes library-owned behavior.

Navigation groups: Workspace identity; new session; search; recent session list; secondary Workspace/location/settings actions. Exactly one current session emphasis; management controls do not compete with creation. Keep real actions reachable, no fake menu items or future placeholders. Detail panel heading remains sticky within panel; tabs and close are named, narrow panels have return-to-conversation action and focus return. Context attachment rows are flat compact rows; preview is one separate surface, not a card nested inside every row. Hash/version metadata uses labelled details. Tool results use existing Tool UI with independent selected source/status, not universal success cards.

## 6. States, accessibility and responsiveness
Empty: one next action and short guidance. Loading: scoped status, no page replacement. Error: local reason and safe next action; preserve editable draft. Recovery/untrusted/unknown: visible text, matching mutation controls disabled, read/edit authority stays truthful. Permission is decision pending, not execution completion. Do not silently collapse active branch confirmation or turn current-run delivery into idle send.

>=900px may show optional side panel only while central reading lane remains usable; existing width controller decides. 600–899px collapses task panel into existing narrow surface. 320–599px uses one main surface with callable navigation/task view; never CSS-hide the only path back. 200% is a reflow case; ensure input, selected values and send/interrupt are reachable without losing draft. Task body may scroll when content exceeds viewport, but scrolling it must not move the only submit action offscreen. At short heights permit whole main-lane scrolling rather than fixed overlays obscuring controls.

Keyboard: Tab/ShiftTab through visible controls, Enter/Space disclose, Escape closes transient UI and restores its trigger; textarea IME/Enter/ShiftEnter unchanged. Focus must not enter closed or inert panels. Actual permission scope/path selectable at narrow width. Reduced motion removes nonessential transitions; no unsolicited animation. Status announcements are scoped/polite except actionable errors; do not flood live regions on every poll.

## 7. Migration, evidence and failure modes
Implement tokens/common rules before consumers. Correct system.md stale statements/counts from actual source instead of copying old assumptions. Preserve original source bytes and current Context final reports before edits. First core surface, then routine feature consumers; no host DTO/store mutation or new dependencies in this run. Layout regression risk: selectors/geometry old runners assume inline settings; adapt them to explicit disclosure without dropping their original business assertions. Keep legacy geometry check truthful for the new Composer structure and add regression against actual helper. Closed details cannot hide blocking summaries.

Evidence must show production-rendered collapsed idle, requested options, attached compact row, expanded metadata/preview, unsupported/expired, running/current-run panel, unknown/held/untrusted, branch warning, long Korean/path, navigation and task panel. Light/dark at1440/760/320 and200%; actual selected values and final actions at zoom, keyboard disclosure/Escape/focus, editability and zero unwanted synthetic effects. Original native PNG/source/build/script hashes before/after and owned hidden-window exit. Public site screenshots are old and cannot prove current implementation. Synthetic Main verifies UI only; no Native/provider/power-loss/Windows/release claim. Fresh CODE/RENDER verdict required; geometry PASS alone never implies visual coherence.
