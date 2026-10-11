# Phase 2 — NavigationItem, ToolCall, PermissionRequest

## NavigationItem

Figma component set `7:110` retains four states. All base components are 220×40 px, start-aligned, and place the label at x=12. Default and hover use Noto Sans KR Medium (500); selected uses Bold (700). The focus variant retains the 220×40 base row and uses ring overlay `46:7` at (-3,-3), 226×46 px, positioned absolutely so it does not change layout. Selected+focus visual examples are `48:9` (Light) and `48:14` (Dark).

Dark example parent `7:119` resolves to `#262626`; default is `#262626`, hover `#171717`, and selected `#3d3d3d`. All three states were captured together against that actual parent. The Light composition frame is `7:116`; the Dark frame is `7:119`.

## ToolCall

Component set `7:136` retains six states and zero outer strokes. Each state contains an actual StatusBadge instance from component set `7:82`, matching state and label. All six masters use vertical hug sizing and preserve 16px after the last visible child. Queued/success are 400×338px; running/waiting/error/unknown are 400×310px. Their target text and input `path` both read `packages/desktop/src/features/permissions/PermissionRequest.ts`; the long path wraps without clipping. The Light grid is reflowed to rows y=48, 400, and 752 with 14px between rows. The Dark stack `7:176` is 460×2080px and retains 12px between instances, each of which inherits the corresponding 310px or 338px height. Disclosure text `세부 정보 접기` is a separate row. The success example separates `결과 읽기 완료` from the underlined `근거 보기 ↗` action, which is explicitly conditional on a valid runtime target and has no destination URL in this static design. The queued example has no target and shows non-actionable explanatory text. Light/Dark captures: `7:136` / `7:176`; focused Light captures: queued `7:130` and success `7:133`.

The independent design QA findings DQ-1 (fixed-height overflow) and DQ-2 (target/input mismatch) are addressed in current Figma structure and checked against all six Light masters and Dark instances. `check_components.py` binds this snapshot to the current component contract and token manifest; it validates recorded evidence and is not a live Figma API test.

## PermissionRequest

Component set `8:7` retains five states. All component outer strokes were removed; each state has exactly one scope-and-target frame with a functional stroke. All states embed a shared StatusBadge instance with the mapped label and tone. Pending uses primary/default `허용` and quiet/default `거절` Button instances; sending uses the same Button variants in disabled state; approved and denied have no actions; stale uses quiet/default `최신 상태 확인`. Each visual Button remains 40px high inside a 44px target allocation. Target frames have 8px gaps; Figma geometry is not runtime hit-test evidence.

Responsive examples are `56:62` (280 px, vertically stacked full-width actions) and `56:75` (720 px, inline actions); both reuse Badge and Button instances. Light capture: `8:7`; Dark capture: `8:42`; responsive capture: `56:60`.

## Visual review and evidence limits

Light and Dark screenshots were reviewed after each family mutation. Inputs and badges from Phase 1 are recorded in `phase-1-evidence.md`; current structural values are also included in `figma-structural-evidence.json`. Figma screenshots demonstrate composition and geometry only. They do not establish browser/runtime behavior, keyboard operation, screen-reader output, zoom behavior, responsive code behavior, or actual target hit testing.
