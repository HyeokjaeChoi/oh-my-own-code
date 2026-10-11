# P3 parallel component handoff

Approved plan revision 6/specv4. P1/P2 integrated prerequisites are complete. Three disjoint workers own shell/session/explorer/activity, conversation, and UI package respectively; main owns renderer.css reset cutover and integration. No host effects/state mechanism changes in P3.

Shared public UI exports to implement under packages/ui/src/primitives (Radix internally):

- `ActionMenu`: props `{label: string, trigger: ReactNode, items: Array<{label: string, onSelect: () => void, disabled?: boolean, danger?: boolean}>, className?: string}`. Trigger is native button with accessible label, 44px target, forwarded automatic Radix focus return; items have no invented actions.
- `ModalSheet`: props `{open: boolean, onOpenChange: (open:boolean)=>void, title:string, children:ReactNode, side?:"left"|"right", returnFocusRef?: RefObject<HTMLElement|null>}`. Controlled Radix Dialog, Portal, Overlay, Content, Title and explicit labelled close; focus containment/inert dismissal; onCloseAutoFocus restores supplied ref. Modal sheet only in narrow layouts; docked pane remains ordinary nonmodal content.

Workers import public @workbench/ui only. Shell may use native controls for accessible workspace selection/form where adequate. Session row ellipsis and label remain stable; compact actions not persistent multiword indicators. Rename remains controlled form (can be sheet/dialog or inline), all existing operations reachable. Keep existing public component props to limit cross-worker changes. Preserve practical DOM class aliases temporarily only where existing E2E depends on them, but use Modules for actual styling. Main removes global component styles; no reliance on legacy renderer.css rules.

Visual guidance: 256px sidebar/12px inset, 44px session row/14px text/20px line/8px radius, 56–60px header, 720–770px reading/composer column, ~128px composer initial height with one concise toolbar, inspector336px/300–420 range. Canonical dimension tokens were added to original manifest/tokens.css; use --omoc-component-type-navigation-size/line, --omoc-component-size-navigation-radius, --omoc-component-size-control-hit-target and --omoc-component-type-conversation-line. Existing font/palette tokens remain. No repeated outlined cards, decorative strips/gradient/shadow/typographic novelty.

Composer retains functional assistant-ui primitives/runtime, native select agent/model labels programmatic and visible current values, send/stop, slash keyboard, IME, draft preservation. Tool UI stays owned copied source with Modules (convert utility class helpers too), safe fallback/navigation and compact technical details. Unknown/error/permission/archived states stay accurate. Permission operations and paths remain fully inspectable.

Actual Chrome ChatGPT observation is in live-reference-observations.md; older designlang captures show a challenge page and are invalid reference. Target remains white even though live reference preference was dark. Actual screenshot/image/keyboard/200% zoom review follows integration; these instructions are not visual approval.
