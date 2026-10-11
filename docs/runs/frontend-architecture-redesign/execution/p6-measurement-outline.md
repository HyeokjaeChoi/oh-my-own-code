# P6 measurement outline
Date: 2026-10-03 | Preparation only, no performance claim

Authority: frontend plan revision6 P6 and architecture-and-ui v4. Foundation owner/transport DTO must land first. Keep selected A and background-only OS verification.

Measure separate bounded native hidden-fixture samples for input-to-next-render-frame, ActionMenu/inspector trigger-to-frame, session shell selection-to-frame and accepted store-update-to-frame/capture. Exclude provider/poll latency from these metrics. Record exact build/host OS/CPU/runtime, viewport/DPR/zoom, fixture transcript length, warmup/sample counts, p50/p95/max and raw samples. At least100 accepted switches; record SDK/IPC admission counts, active timers/listeners and post-GC stabilized heap trend when collector available. Synthetic fixture and hidden window latency are not foreground user-perceived latency or provider completion. A normal target is not a universal runtime standard.

Existing captured selected A displays provide comparison references, not current migrated implementation evidence. Include empty, transcript/tools, pending permissions, unknown send, long Korean draft, IME and narrow200% reflow. Capture must assert actual window.isVisible false and isFocused false before and after. Never launch production main that automatically shows a window. Keep production window show/focus behavior distinct from test-only host.

Record raw/gzip renderer entry totals against preserved pre-migration bundle if available. If exact earlier build is unavailable, report that limit instead of fabricating delta. Growth over10% needs source-attributed explanation; use profiling evidence before virtualization/cache changes. Native Windows measurement requires a Windows runner; macOS/build output cannot replace it.

P6 final checks and independent code/render review bind current source and exact capture provenance after P4/P5. This outline does not register acceptance, pass checks or close parent product scope.
