# Conversation Markdown and copy
Revision: 6 · 2026-10-09 · Initial bounded F05 feature

## Outcome and authority
Continue the full18 PRD, not a reduced replacement. PRD F-05/AC-05 requires assistant-ui streaming Markdown/code and copy; the accepted UX/ADR assigns message presentation to assistant-ui and one app-owned projection. Current duplicate-import predecessor is complete. This increment implements only Markdown/code/copy. Attachments, context, branching, retry and queue remain explicit full18 backlog work; no whole-F05 or release claim.

## Initial decisions and dependency holds
Use the official @assistant-ui/react-markdown 0.14.19 primitive with pinned remark-gfm 4.0.1, existing React19.2.4 and assistant-ui0.15.22 unchanged. Compare options and exact-source compatibility in design-v1.md. This first introduction of untrusted rich-text presentation and two dependencies is major entry: one independent PLAN and separately bound DESIGN_SPEC review. Once accepted, routine implementation/fixes use checks plus independent CODE; actual UI needs independent RENDER. No repeated entry approvals for ordinary repairs.
Dependency adoption waits for isolated clean install/type/bundle/real-runtime SSR compatibility evidence. A failed compatibility probe holds adoption only; retain literal text and diagnose, do not upgrade the existing stack incidentally. No unanswered user question blocks this authorized local increment.

## Ownership and ordered work
Main owns the plan/ledger, package manifest/lock, conversation widget index.tsx + conversation.module.css + new markdown.tsx, new workbench-markdown.test.mjs, saved e2e-conversation-markdown.mjs, run-evidence.mjs and its test plus the existing build-provenance selector map and exact external-package allowlist in check-renderer-boundaries.mjs. Existing synthetic host may be configured through its public snapshot/maps by the saved runner; do not add a second message store or change host/DTO/transport/domain APIs. Preserve before bytes for modified files.
1. Entry review and isolated compatibility; meaningful actual-render SSR RED before implementation.
2. Install the exact approved dependencies; render assistant Markdown via active part context, keep user input literal; add explicit copy/status and scoped CSS.
3. Unit regressions, type/boundary/bundle, actual coherent build and hidden Electron keyboard/layout/copy/lifecycle matrix.
4. Freeze source/evidence; fresh independent CODE and RENDER, repair only findings, finish this bounded increment; continue full18.

## Acceptance
MD1: Headings/emphasis/lists/quotes/inline+fenced code/tables/task lists/strikethrough render from the existing assistant part, including incomplete streaming fences. User text stays literal. Projection caps/status/unknown-tool and permission controls remain unchanged.
MD2: No executable HTML, active Markdown navigation, image/network requests, embedded code execution or new tool authority. Raw HTML remains readable escaped text. Links expose their destination as inert selectable text; image alt text is visible. Generic tool fallback remains escaped. GFM task inputs are disabled.
MD3: Explicit accessible code and displayed-message copy writes only the clicked displayed text/code. Browser clipboard promise governs pending/success/failure; text/scope changes or unmount cannot display stale success. Duplicate pending copy is blocked. No automatic copy. Do not claim original unprojected history or exact file bytes. Held/untrusted read-only transcript remains selectable/copyable.
MD4: Current Node regression/type/lint/format/boundary/build/bundle checks pass. Hidden nonfocusable Electron exercises both themes, 320/760/1440px and200% zoom, keyboard focus/Enter/Tab, long code/table containment, partial/final streaming, clipboard success/rejection/absent/pending/text change/session switch, no unexpected request/effect. Actual OS clipboard is not read or modified: synthetic clipboard adapter proves renderer handling only. Capture native complete PNGs; prove owned Electron exit and preserve failures.

## Scope and evidence limits
No Native/provider/private-data/productionMain invocation or Windows acceptance. Local package registry research and build only; no external publication. Existing fixed host permissions and message authority unchanged. New rich-text controls use current tokens/CSS Modules, no second styling engine/highlighter/renderer foundation. Actual hidden UI evidence does not establish real OS clipboard or screen-reader hardware acceptance. Full18 backlog remains authoritative.

## Change history
r6: Require durable synthetic snapshot for retained projection; temporary fixtures deliberately omit retained keys. Explicitly assert retained count1 and blocked new-session control before claiming the global-operation-hold case. This fixes evidence only; product/build unchanged. Also assert capture targets are actually in viewport after layout settles, so code/prose/table image labels match visible pixels. Fresh hidden-r4.
r5: Hidden-r2 passed37 states then refused a malformed store-recovery fixture; that DTO requires empty messages. Replace only last case with actual connected retained global operation hold, no invented body/authority. Fresh hidden-r3; production/build unchanged.
r4: First hidden attempt interrupted initial load by reloading too early; wait actual connected header before fixture reset. Preserve failed exit1 evidence; production unchanged. Fresh hidden-r2.
r3: Boundary preflight correctly refused the two unlisted packages; add their exact names only. Keep pnpm-generated lockfile formatting, compare parsed package/snapshot identities and exclude generated YAML from app Prettier. Same accepted design.
r2: Add required existing provenance selector-map ownership; same feature/design and behavior.
r1: First bounded F05 Markdown/code/copy increment after canonical duplicate-import fix and full-product audit.
