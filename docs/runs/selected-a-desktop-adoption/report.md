# Selected A desktop adoption result

User approved A Quiet Dock and enlarged composer. Actual Electron source now adopts sidebar216/header44/reading720/body15-24 and the120px composer with72px input/32px toolbar (normal cap144/192). CSS Modules, assistant-ui and owned Tool UI remain. Normal pointer controls32 and coarse controls44; permission actions36. Production has no attachment submission capability, so no fake attachment control was added. Original frozen composer-room/Figma outputs were preserved.

## Interaction
Radix keeps its default dropdown/modal outside handling, focus containment and Escape behavior. New browser draft copy adds missing outside Pointer Events, topmost close, focus return and consumed backdrop click. Custom production slash popup closes on external mouse/touch, keeps clicked textarea focus, and Escape works from its trigger. Its placement is collision-bounded to actual viewport space. Permission decisions remain explicit; closing a navigation/inspector sheet does not dismiss requests.

## Responsive correction
At <=440px logical height the input retains72px, uses3 rows with internal scrolling, and transcript may shrink. Permission queue is44..120px so a36px action fits, rather than clipping in32px. At <=400px pane width the toolbar uses one four-column grid; both selectors remain in the same row. Normal dimensions/cap are unchanged. Small-screen hint remains available to assistive technology.

## Evidence
All four contracted checks passed: type/lint/format, FSD boundaries, production build, native Electron synthetic states. Token validator passed220 tokens/44 variants/two modes/CSS parity/contrast/aliases; bundle privilege inspection passed. Native evidence: `docs/runs/frontend-architecture-redesign/execution/selected-a-1791032376117-fe3eb009-3e76-4424-b50c-754e6a434c44/ui-states`.26 captures, including25 full-content captures recording OS window hidden and unfocused; one isolated Tool UI locator capture. Full mouse/CDP synthetic touch outside dismissal, inside retention, nested topmost/Escape/focus, no mutation/click-through, custom slash, IME guard, send IDs, permissions, unknown receipt and zoom matrix. Failed attempts were retained. Focus test errors (forcing menu opener after outside, counting modal opener or file.list read as mutation, hidden parent role and rounded corner hit) were corrected without masking closure/mutation assertions. Actual short-layout clipping and slash trigger Escape were repaired. Independent finding A-FINAL-01 was corrected with the single-row toolbar; native assertions now include the entire Composer and both selectors, also after permission scrolling.

Coordinator Chrome observation confirmed new draft Model popup outside and dimmed backdrop dismissal. Browser draft is synthetic and separate from real renderer evidence.

## Boundaries
No live provider/physical OS IME/physical touch/Windows runtime or release certification. Parent P4-P7 (bounded transport/store/performance/persistence) and remaining product features continue under their existing plan; this run closes only approved visual/interaction adoption. User's latest instruction is background verification: the test-only host uses prohibited mac activation, hidden nonfocusable window and unthrottled rendering; capture asserts it stays hidden/unfocused. Production main-window behavior is unchanged.
