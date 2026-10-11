# Composer plus popover — revision 1 (2026-10-09)
Routine correction under accepted design-foundation-v2, current architecture ADR and direct user direction: Composer lower-left must use + and a popover, not the named command button.

Main owns the three paths in before.json. Replace trigger content with lucide Plus; keep existing actions, authority guards, slash shortcut, draft ownership, arrows/Home/End/Escape and outside dismissal. Use browser native manual popover top layer with measured trigger anchoring, bounded width/height and resize/scroll updates; no new dependency or shared state. Existing native popover preserves DOM ancestry and escapes the Composer scrollport. No new feature/security/API boundary. No unresolved decision blocks execution.

Acceptance P1: compact + button opens an anchored overlay without resizing Composer; P2: first/last actions pointer-reachable and keyboard/focus/outside dismissal remain correct at narrow/zoom/light/dark; P3: actual build, existing foundation matrix and separate CODE/RENDER reviews pass.

Sequence: preserve -> edit -> scoped static/type/build/bundle and hidden production renderer with synthetic Main -> freeze whole-source review inputs and original captures -> fresh independent linked CODE/RENDER -> integrate. Reviewers read only; no recursive delegation. No provider, production Main, private stores, foreground app or deployment execution.
