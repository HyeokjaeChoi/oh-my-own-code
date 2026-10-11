# UI implementation report

Revision 1 assignment. Layout-ready milestone: renderer and canonical token edits are complete and available for coordinator integration and native capture. No known blocking source dependency. Final bounded corrections apply user bubble radius10, message gap24, workspace-first sidebar hierarchy and neutral new-session/search rows.

Changed paths:
- apps/desktop-app/src/renderer/app/index.tsx
- apps/desktop-app/src/renderer/app/shell.module.css
- apps/desktop-app/src/renderer/features/conversation/index.tsx
- apps/desktop-app/src/renderer/features/conversation/conversation.module.css
- apps/desktop-app/src/renderer/features/sessions/sessions.module.css
- apps/desktop-app/src/renderer/features/explorer/explorer.module.css
- apps/desktop-app/src/renderer/features/activity/activity.module.css
- docs/design/tokens/manifest.json
- docs/design/tokens/tokens.css

Implemented sidebar216 / inset8 / desktop target32 / header44 / icons18, conversation15/24 and reading720/gutter32. Selected empty session groups its centered 18/26 title with composer, gap16; noSession onboarding retains its truthful workspace/session-specific text and actual new-session action. Composer is borderless internally, single radius16 shell, padding8/12, input72..144 (assistant-ui minRows3/maxRows6 so the actual autosizer enables overflow at the cap) and toolbar32 (120..192 shell); outer border is a non-layout pseudo-element. Hint uses18 line +4 gap outside. Native agent/model selects remain real controls, fit-content12/18 with128/176 maxima. Reflow responds to conversation pane width; at360 or less choices wrap to a second toolbar row. Low-height viewports retain readable input dimensions and use controlled conversation/permission scrolling. Coarse pointers override renderer control target to44; permission actions are36 on desktop and at least44 coarse.

Shared token coordination: --omoc-component-size-control-hit-target now resolves32 globally, --omoc-component-size-coarse-target resolves44. Sidebar/header tokens are --omoc-component-size-sidebar-width and --omoc-component-size-header-height. Radix wrappers owned by the other worker must apply44 coarse in their portal scope, which is outside .workbench.

Custom slash menu outside pointer dismissal preserves inside clicks. Clicking the textarea now dismisses the menu. Outside pointer dismissal does not steal focus from the clicked control; if menu focus falls to body, restore the origin safely after the event. Escape/explicit close preserve existing origin restoration. Open Radix menu/dialog layers own their outside event so this lower custom menu does not also dismiss on that event. Real runtime, Tool UI, unknown blocking/draft restoration, archived readOnly field (text remains selectable) and permission action meanings remain intact. No attachment control was added because production runtime has none.

Executed narrow checks: Prettier check for renderer passed; generated_css(manifest) exactly matches tokens.css; explicit canonical selected-A dimension assertions passed. No broad tests, build or native capture were launched by this worker. Coordinator owns contracted static/build/native checks and independent code/render gates. Browser/native geometry remains unverified until those captures run.
