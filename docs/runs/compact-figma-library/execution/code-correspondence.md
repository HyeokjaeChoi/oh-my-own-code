# Draft representation and code correspondence

Source: frozen `design-systems.json`; execution plan revision 2. Target: Figma file `e6QYqEsmA3FHB6A2ohNr2o`. Selected A Draft construction is complete. B/C remain exploratory tokens/styles. Production adoption is separate. See `FINAL-REPORT.md` and `final-readback.json` for actual IDs and evidence.

All proposed variable WEB syntaxes use `var(--draft-compact-<source-path-with-hyphens>)`. These names are an explicit proposed mapping. They are not existing production variables. `prepared-contract.json` lists every path, type, value, scope and proposed syntax. A is selected. A reviewed translation to the canonical token generator remains a prerequisite for production implementation. Existing `docs/design/tokens/manifest.json` remains authoritative for production.

| Figma family | Future renderer correspondence | Boundary |
| --- | --- | --- |
| shell, navigation, workspaceSelect, sessionRow, search | app shell and features/sessions | CSS Modules; preserve session scope and action semantics |
| button, iconButton, menu, dialog, tooltip, select, input | packages/ui primitives, Radix overlays | Figma variants represent CSS interaction states; not browser keyboard behavior |
| composer, sendStop, attachment, commands | features/conversation | No attachment ingestion or execution capability implied |
| message, userMessage, assistantMessage, code | assistant-ui-backed conversation projection | No stream runtime or provider effect implied |
| toolSummary, evidence, permission, status, toast, error | validated Tool UI and permission projection | Once-only response and rejection consequences remain explicit; Unknown never means safe replay |
| inspector, artifactTabs, filePreview, terminalPreview, browserPreview | explorer/activity and proposed read-only artifact surface | File/Terminal/Browser fixtures are local synthetic content; no navigation, shell or editing capability implied |
| extensions | catalog/library read-only view | No install, enable, connect or publication actions |

Text styles use Noto Sans KR Regular/Medium/Bold and IBM Plex Mono Regular/Medium. Their semantic size, line height and weight are variable-bound. CSS font-stack STRING variables remain metadata because a web font stack is not a Figma family. This preserves the original values without inventing glyph parity. Production retains its system-first stack.

Shadow STRING variables remain metadata. Functional `menu` and `modal` Effect Styles render their resolved shadow values in each Light/Dark mode. Effect Styles do not automatically select a mode. Specimens apply the appropriate style where used; candidate aliases and frame modes control visible colors.

Variable-bound supported geometry includes colors, strokes, corner radii, gaps, paddings, control bounds and typography size/line/weight. Fixed icon geometry and static documentation geometry remain intentional representation values. Figma cannot validate DOM landmarks, IME handling, live focus return, keyboard resize, screen-reader announcements or permission freshness. These require a later reviewed production implementation.

Code Connect is deferred. No deployed Code Connect, published library, production import or externally shared link is claimed.
