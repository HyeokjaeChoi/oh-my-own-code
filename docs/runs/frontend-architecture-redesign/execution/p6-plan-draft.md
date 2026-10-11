# P6 performance and acceptance draft
Date: 2026-10-04 | Preparation only; no registered gate or measurement claim

Resume frontend plan rev6 P6 after bounded-workbench-foundation finishes. Current selected A bytes before migration are preserved in p6-pre-migration-bundle.json (777700 raw/224670 gzip); actual post-migration delta is measured after build. Existing token/layout/IME/permission/unknown and background-only OS constraints remain fixed.

Own a separate scripts/p6-performance.mjs and small fixture instrumentation; no overlapping renderer writer. If store/DOM timing needs instrumentation, a bounded renderer integration worker starts only after P5 is frozen. Metadata-only performance marks may include read ID, revision, kind and elapsed time; never prompts/paths/tool content/credentials, whole-state logging or at-rest technical UI. Clear marks/measures to bound retention. No Query/XState/cache/virtualization adoption without evidence.

Exact candidate checks to freeze in the eventual focused schema2 run:
- node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-native-r1
- node apps/desktop-app/scripts/build.mjs
- node apps/desktop-app/scripts/inspect-renderer-bundle.mjs
- node apps/desktop-app/scripts/check-renderer-boundaries.mjs
- pnpm exec tsc -p apps/desktop-app/tsconfig.json --noEmit
- node --import tsx --test apps/desktop-app/src/workbench-store.test.mjs (affected canonical store/control disposal behavior)
Use one stable source/build capture provenance and distinct current independent code/render gates.

Actual hidden/nonfocusable fixture samples must record OS/CPU/runtime/build/viewport/DPR/zoom, bounded representative transcript/tools/permissions size, warmup/sample counts and raw latency samples. Separate input/menu/panel/switch timings, accepted-store-to-DOM/capture timing and polling/provider latency. Name DOM/capture proxies accurately; hidden-window samples do not prove foreground user-perceived latency. Proposed p95 targets remain100ms input/menu/panel/store projection and150ms cached session shell until measured. Record >50ms long tasks where observable, not from inference.

After100 actual renderer switches, collect CDP renderer heap and DOM listener/node counts before/after stabilization/GC where supported, plus admitted/pending IPC counts from synthetic fixture. Label DOM listeners versus store-controller subscription disposal checks; synthetic IPC is not provider capacity evidence. Verify no wrong-session frame or growing pending request/listener count. Native Windows is a distinct capability hold.

Use current built production renderer/preload under test-only hidden host; keep mac activation prohibited. Capture checks assert hidden and unfocused before/after. Do not launch normal production main, activate Chrome or open visible tabs. Full product F01–18 and P7 remain ongoing regardless of a passing local P6 result.
