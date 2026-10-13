# Backlog status (F-01..F-18)

Refreshed 2026-10-11 from current `apps/desktop-app` source (branch `audit-refresh`). Supersedes `docs/runs/full-product-coverage-audit/*` (2026-10-09). Evidence is static source reading; nothing was run. `workbench-web` ignored. Paths are relative to `apps/desktop-app/src/`.

Status: `done` = implemented end to end; `partial` = some of the clause exists; `missing` = no code found. "Contract" = `workbench-contract.mjs` operation schemas (lines ~42-208); the contract has no ops for preview, plan, usage, tool call, subagent, export/import, automation.

## F-01 Import

| Clause                                          | Status  | Evidence                                                                          |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Register folder via picker                      | done    | `workbench-service.mjs:4468` (`workspace.import`, `pickDirectory`)                |
| Register by typed path                          | missing | `workspace.import` takes no args (contract `:167`)                                |
| Git repo / existing worktree recognized         | partial | no worktree-specific code; git metadata only in `host/git-metadata-kernel.mjs`    |
| Show origin, branch, absolute path, writable    | partial | trusted + path only, `renderer/pages/workbench/index.tsx:682`; no branch/writable |
| Duplicate path = one target                     | done    | `workbench-service.mjs:4490` existing.path match (B01 fixed)                      |
| Missing/broken/denied path: reason + recovery   | partial | `explorer/index.tsx:240` error text; no recovery action                           |
| Import never moves files/inits git/runs scripts | done    | `canonicalDirectory` only, `workbench-service.mjs:4485`                           |

## F-02 Create

| Clause                                           | Status  | Evidence                                                                                  |
| ------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| Explicit location                                | done    | picker + `createFolder`, `workbench-service.mjs:4482`                                     |
| Auto child dir under work root                   | done    | `registry.materializeManaged`, `:4477`                                                    |
| SDK naming else `yyyy-mm-dd-<uuid-v7>`           | partial | managed path exists; naming rule not verified in UI/tests (`host/workspace-registry.mjs`) |
| Plain folder vs git worktree creation            | missing | no `worktree add` anywhere                                                                |
| Show resulting path/branch; handle conflict/perm | partial | errors mapped; branch absent                                                              |

## F-03 Unregister / delete

| Clause                                            | Status  | Evidence                                                                         |
| ------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Remove from list                                  | done    | `workbench-service.mjs:4518`, `pages/workbench/index.tsx:239`                    |
| Delete conversation history                       | done    | `session.remove`, `features/sessions/index.tsx:248`                              |
| Physically delete worktree/folder                 | missing | no fs delete op in contract                                                      |
| Confirm target path/changes/affected sessions     | partial | native confirm dialogs `main.mjs:508+`; no path/changes list for physical delete |
| Block on active session/terminal/dev server/dirty | partial | session busy check `:4523-4540`; terminals and dirty not checked                 |
| Cancel keeps data                                 | done    | same                                                                             |

## F-04 Sessions

| Clause                                                  | Status  | Evidence                                                                          |
| ------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Create, rename, pin, archive/restore, delete            | done    | contract `:151-171`; `features/sessions/index.tsx`                                |
| Search                                                  | done    | `sessions/index.tsx:50`                                                           |
| Recent reopen                                           | missing | none                                                                              |
| Unread state                                            | missing | none                                                                              |
| Two parallel sessions on different paths, no cross-talk | partial | per-session locks in service; no dedicated test found                             |
| Fork vs empty new session                               | done    | `sessions/index.tsx:244`, `session.create`                                        |
| Restore after restart, missing path shown               | partial | registry/journal restore (`host/storage-journal.mjs`); missing-path UI unverified |

## F-05 Conversation

| Clause                                     | Status  | Evidence                                                                                          |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Streaming (assistant-ui)                   | done    | `shared/projection/projection.mjs`, `widgets/conversation`                                        |
| Markdown/code                              | done    | `widgets/conversation/markdown.tsx`                                                               |
| Copy                                       | done    | `markdown.tsx:49`                                                                                 |
| File/selection reference, context preview  | done    | `features/conversation-context/index.tsx`, `context.observe`                                      |
| Attachments with size/type/path validation | partial | `attachments` in `message.send` (contract `:172`) are file/selection refs; no binary/image upload |
| Model-unsupported input explained pre-send | partial | requested-value UI `conversation/index.tsx:544`; no modality check                                |
| Retry message                              | partial | only context-read retry (`conversation-context/index.tsx:53`); no resend                          |
| Edit then fork                             | done    | `controller.ts:878` (`session.fork` + `before`)                                                   |
| Queue/steer while running                  | done    | `delivery: steer                                                                                  | queue`, `conversation-context/index.tsx:561`; `session.inbox.cancel` |
| Interrupt                                  | done    | `session.interrupt`, `conversation/index.tsx:911`                                                 |
| Retry never re-runs tool side effects      | partial | moot while retry is absent                                                                        |

## F-06 Agent/model/effort

| Clause                                    | Status  | Evidence                                              |
| ----------------------------------------- | ------- | ----------------------------------------------------- |
| Show runtime choices                      | done    | `catalog.list`; `conversation/index.tsx:552-593`      |
| Requested vs default vs observed distinct | done    | `data-runtime-source` markers `:544,645`              |
| No silent substitution                    | done    | unavailable selection blocks, `:928`                  |
| Next-boundary label on mid-run change     | partial | "applies next send" text `:614`; not tied to boundary |
| No hardcoded tiers                        | done    | no model literals in source                           |

## F-07 Subagents

| Clause                                    | Status  | Evidence                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delegation (parent or user)               | partial | `subagent` removed from the deny floor (follows mode: ask asks, scoped_edit/read_plan allow; `external_directory` still denied). User "위임" = `session.create` + `message.send` with a rendered brief (`features/subagents`, `shared/subagents`); lineage is app-side (localStorage) because public `session.create` has no `parentID` |
| Parent-child tree / status                | partial | `deriveChildTree` (Native `parentID` + app lineage); running/waiting-permission/stopping/failed(unknown)/done/queued. Native per-run `outcome:failed` is not projected                                                                                                                                                                  |
| Child history, result, abort, concurrency | partial | open child; result parsed from `subagent` tool output in the tool card; cancel/cancel-all select each child then `session.interrupt` (host acts only on the selected session); cap 3 + FIFO queue for user-delegated children only                                                                                                      |
| Parallel + failure verified               | partial | pure tests only (2 parallel running + failed child); no live Native run                                                                                                                                                                                                                                                                 |
| Fresh context vs fork; isolation shown    | partial | delegation form labelled "새 컨텍스트"; fork unchanged. Child permission inheritance for model-initiated children is Native-internal (unverified); user-delegated children get `policy()` on create plus the parent permission mode via `permission.mode.set`                                                                           |

KNOWN GAP (e2e-chat turn 4): the model-initiated `subagent` tool fails ("A tool operation failed.") in the real app because the permission overlay inventory is not fully verified (execution-task-authority.md, phase D); the parent run survives and stays sendable. `OMOC_E2E_STRICT_SUBAGENT=1` makes e2e-chat assert the round-trip.

## F-08 Tools

| Clause                                              | Status  | Evidence                                                                         |
| --------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Tool calls in flow (name/input/output/error/status) | partial | projected as tool-call parts `projection.mjs:36-49`; renderer shows generic only |
| tool-ui rich cards, diff, unknown-safe              | missing | no tool-ui dependency (`package.json`)                                           |
| MCP/extension tools listed                          | partial | `configuration.mcp.*` manages servers; no tool list                              |
| Direct run with schema form, same policy            | missing | no op                                                                            |

## F-09 Permissions

| Clause                                          | Status  | Evidence                                                              |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------- |
| Per-request allow/deny                          | done    | `permission.respond`, `conversation/index.tsx:482` (once)             |
| Remember / "always"                             | partial | decision `once`/reject only; verify schema                            |
| Presets (ask, scoped-edit, read/plan, custom)   | missing | read-only effective-rules view `features/permission-policy/index.tsx` |
| Effective rules viewable                        | done    | `permission.policy.read`                                              |
| Revoke saved rules                              | done    | `features/preferences/saved-rules.tsx`, `host/saved-rules-host.mjs`   |
| Enforced at execution boundary                  | partial | `native-permission-*.mjs` overlay; no mode switching                  |
| Mid-run switch, child, batch, expiry, duplicate | partial | duplicates guarded by requestId; rest unproven                        |

## F-10 Preview

| Clause                                       | Status  | Evidence                                                                          |
| -------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Browser/artifact tabs, URL/HTML/MD/image/PDF | missing | `webviewTag: false` (`main.mjs:278`), no preview widget                           |
| Nav/reload/resize/open external              | missing | none                                                                              |
| Dev server start/stop/port/logs              | partial | start/stop/logs via a project script on the PTY (terminal tab); no port detection |
| No local exec for preview content            | n/a     | nothing to isolate yet                                                            |

## F-11 Files/Git

| Clause                                              | Status  | Evidence                                                       |
| --------------------------------------------------- | ------- | -------------------------------------------------------------- |
| File tree                                           | done    | `widgets/explorer/index.tsx`, `file.list`                      |
| File search                                         | done    | `host/workbench-file-search.mjs`, `explorer/index.tsx:30`      |
| Open/edit/save text, external-change conflict       | done    | `file.edit.read`/`file.save`; `features/workspace-file-editor` |
| Changed files; staged/unstaged/base diff            | done    | `git.review.read`, `git.diff.read`; `features/git-review`      |
| Line feedback                                       | done    | `features/line-feedback`                                       |
| Stage/unstage, commit, branch, restore with confirm | done    | `git.index/commit/branch/restore.*`; `branch-restore.tsx`      |
| Protects origin repo / other worktrees              | partial | owner-fence kernels; no worktree-aware tests                   |

## F-12 Terminal

| Clause                                                    | Status  | Evidence                                                                                                                           |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Terminal in workspace dir, tabs, input, exit code, output | done    | `host/terminal-host.mjs`, `widgets/terminal/index.tsx:148`                                                                         |
| Real PTY                                                  | done    | `node-pty` in `host/terminal-host.mjs`, xterm.js in `widgets/terminal/xterm-view.tsx`; `scripts/e2e-terminal.mjs`                  |
| Resize                                                    | done    | `terminal.resize` -> `pty.resize`, fit addon + ResizeObserver                                                                      |
| Close tab vs stop process; orphan sweep                   | done    | `reap` `main.mjs:256`, `closeAll`                                                                                                  |
| Build/lint/test/dev actions                               | done    | package.json scripts, lockfile pm, argv spawn: `host/project-actions.mjs`, `terminalHost.startScript`; recent-run history not kept |
| Command attribution                                       | partial | tab label `<pm> run <script>` shows its action; agent-started commands not applicable (no agent terminal)                          |

## F-13 Commands

| Clause                                                               | Status  | Evidence                                                                                                         |
| -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `/` search runtime commands                                          | done    | `catalog.list`, `conversation/index.tsx:693,822`                                                                 |
| Run runtime command, literal not shell                               | done    | `command.run`                                                                                                    |
| Args help, source, unavailable reason                                | partial | entries shown; verify fields                                                                                     |
| Command palette (Cmd/Ctrl+K)                                         | done    | `features/palette`: runtime commands/skills + app ops + project scripts, source labels, disabled reasons         |
| App commands (model/permissions/plan/review/compact/status/mcp/help) | partial | only ops with existing actions are listed (settings, panels, new/switch session, import folder); the rest absent |
| Conflict/arg error/busy/cancel                                       | partial | busy via lock; others unverified                                                                                 |

## F-14 Harness config

| Clause                                                   | Status  | Evidence                                                                  |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| View instructions/skills/agents/hooks/MCP, source, state | done    | `configuration.extensions.read`; `configuration-extensions/index.tsx:202` |
| Edit/validate/apply instructions, skills, agents         | done    | `configuration.*.save/apply/register`                                     |
| MCP register/connect/disconnect/remove                   | done    | contract `:124-147`                                                       |
| Hooks/tools/plugins edit                                 | partial | hooks listed read-only                                                    |
| Incompatible vendor formats flagged                      | partial | validation only for known formats                                         |
| Auth guidance, no auth UI                                | done    | none built (by design)                                                    |

## F-15 Plan/review

| Clause                                    | Status  | Evidence |
| ----------------------------------------- | ------- | -------- |
| Plan/checklist beside chat, edit, approve | missing | none     |
| Approved version linked to run            | missing | none     |
| Independent reviewer findings             | missing | none     |
| Verified (not claimed) lint/test status   | missing | none     |

## F-16 History/usage

| Clause                                        | Status  | Evidence                                                      |
| --------------------------------------------- | ------- | ------------------------------------------------------------- |
| Timeline w/ filters + navigate                | partial | `widgets/activity/index.tsx` lists ops, no filters/navigation |
| Context/token/usage, unknown shown as unknown | missing | no usage field                                                |
| Setting comparison, learning mode             | missing | none                                                          |

## F-17 Recovery/data

| Clause                                   | Status  | Evidence                                                                                                    |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Reconnect, runtime exit, partial failure | done    | `operation.lookup`, sidecar-supervisor, recovery journal                                                    |
| Abort vs confirmed stop                  | done    | `session.interrupt` + status                                                                                |
| Resubscribe + re-snapshot, gap marked    | partial | `snapshot`; projection has no gap marker, so no divider                                                     |
| Session/history export/import            | partial | `host/data-host.mjs`, `features/data-transfer` (current session; archive view only)                         |
| Retention settings, app-data deletion    | partial | imported archives only; wipe in `data-host.mjs`; native archived-session retention not done (no timestamps) |

## F-18 Convenience/automation

| Clause                                         | Status  | Evidence                                                                                                                                |
| ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Shortcut help                                  | done    | `features/preferences/index.tsx:97`                                                                                                     |
| Command palette (keyboard global)              | done    | `features/palette`, `shared/palette` (Cmd+K on macOS, Ctrl+K elsewhere)                                                                 |
| Theme, font size, density                      | done    | `shared/preferences/index.mjs` (localStorage)                                                                                           |
| Layout setting                                 | partial | detail panel width already user-resizable; no persisted layout preference                                                               |
| Accessibility                                  | partial | aria labels present; no audit evidence                                                                                                  |
| Notifications (done/error/approval), redaction | done    | `features/notifications`, `shared/notifications` (generic text; OS opt-in, `host/notify-host.mjs`); approval only for selected session  |
| Local recurring jobs                           | done    | `host/automation-host.mjs`, `automation-runners.mjs`, `features/automation` (missed shown, not backfilled; runs only while app is open) |

## Remaining work, ordered

Updated 2026-10-11 after merging the review-fix rounds (permissions, hosts, UI, F-18) to `main` at `274f72c5`; full suite 4776/4776 and the 4 static checks pass. Items 1-11 and 14-15 of the earlier list landed (each passed fresh-context Opus review with no critical/major).

D = needs user decision.

1. ~~Real PTY via `node-pty` + `xterm.js`~~ landed (F-12; dev server runs as a terminal script for F-10). Windows ConPTY path and `package-windows` staging are untested (need a Windows machine).
   - **S** CSP tradeoff: `index.html` has `style-src-elem 'self' 'unsafe-inline'` because xterm.js injects `<style>` elements (inline style _attributes_ stay blocked). Revisit if xterm gains a nonce/adoptedStyleSheets option, or serve the renderer with a per-load nonce.
   - **S** Terminal a11y: xterm `screenReaderMode` is off (performance); the input textarea and screen are labelled and Ctrl+Shift+M leaves the terminal. Consider a settings toggle that enables `screenReaderMode`.
   - **S** A shell that exits by itself leaves jobs it moved to their own process group running (like any terminal); close/stop/quit kill the whole tree.
   - **S** No pty flow control (`pause`/`resume`): a background tab is not polled, so pausing would stall its process; the bounded ring drops the oldest output instead.
   - **S** Packaged builds always use the durable profile under the user's home (the `OMOC_APP_DATA_DIR` isolation is unpackaged-only). On macOS `e2e-smoke packaged` isolates via `CFFIXED_USER_HOME` (one throw-away home per launch group); never run a packaged app by hand with failure scenarios against the real profile — a launch that dies mid-startup leaves owner state the next launch refuses (`owner_unverified` / `native_startup_unverified`), same on `main`. The `crash_restart` relaunch-on-same-profile case is still skipped by default.
2. **M** Windows support (old B02/B18). D: needs a real Windows machine.
3. **S** Export: values >1 MiB with no newline export as `[TRUNCATED]`; unterminated quoted secrets in raw text are not redacted (`renderer/shared/data-transfer`). — **done (follow-ups 2026-10-13):** `[TRUNCATED]` and bare unterminated-quote cases were already fixed on `main`; escaped-quote and quoted `Authorization` leaks now redacted; huge unterminated values keep a `[REDACTED]` marker.
4. **S** Git review is unavailable in repos whose ignored dirs contain symlinks or exceed file caps (e.g. `node_modules`), so plan checks never show a plain pass there (`host/workbench-git-snapshot.mjs` walk). — **done (follow-ups 2026-10-13):** already fixed on `main` (`1929531f`: ignored paths skipped via `check-ignore`; regression test with symlinked `node_modules`).
5. **S** Permission policySync may return BUSY for a drifted session that Native reports active while app status is idle; config reads keep failing while any session has drifted (`workbench-service.mjs` policySync). — **done (follow-ups 2026-10-13):** `mode.set` BUSY is retried (bounded ~2.75s) before surfacing BUSY; `configuration.mcp.read` tolerates drift (mutations still repair and re-verify).
6. **S** Plans: idle poll can cancel the observation `runCheck` started (`OBSERVATION_FAILED`); export summary clears on any snapshot change. — **done (follow-ups 2026-10-13):** already fixed on `main` (`56d9bf2b`: poll skips while `runCheck` observes; export summary keyed on content shape).

### 2026-10-13 — chat stage landed (`main` at `f5e35adc`)

Chat works end to end in the real app: streamed replies, write/read/shell permission prompts, "이 프로젝트에서 항상 허용", agent/model selection, subagent delegation, interrupt, `scoped_edit`, provider/API-key settings and local LM Studio. Full suite 4966/4966, 4 static checks, and e2e-chat (strict subagent), e2e-workbench, e2e-sessions, e2e-ui-states, e2e-macos, e2e-provider all pass.

Open follow-ups (minor, from stage reviews):

7. **S** Subagent child create (`consumeBootstrap` parentID path) has no parent-project transaction gate; later execution is still gated by `enter()`. Adding it needs an overlay recipe change. — **skipped:** accepted / needs a permission-overlay change.
8. **S** Inherited session rules (`*:*:ask` first) shadow agent-level restrictions (e.g. `explore` `*:deny`), so a child agent is never narrower than its parent session. — **skipped:** accepted / needs a permission-overlay change.
9. **S** "항상 허용" is a permanent per-project allow with no revoke UI. — **done (follow-ups 2026-10-13):** Settings "저장된 허용 규칙" lists/removes Native saved rules via `desktop:v1:rules` (`permission.saved.list/remove`, scoped to the workspace project, allow-only; deny floor untouched).
10. **S** Narrow window at 200% zoom: pinned composer (184px) leaves ~6px for the permission queue / stacked notices; e2e-ui-states only requires visibility there. Composer needs a compact layout. — **done (follow-ups 2026-10-13):** composer is a compact grid at `max-height: 600px`; `e2e-ui-states` requires full viewport visibility again.
11. **S** Journal duplicate replies return `{ok:true,status:"duplicate"}` even when the original attempt failed; clients must read the receipt. — **skipped:** accepted / needs a permission-overlay change.
12. **S** Native `model.list` is bounded at 5000 and the catalog shows 300 after local-first sorting; the selected/default model is not pinned into the list. — **done (follow-ups 2026-10-13):** `catalog.list` accepts `pinModels` (selected + saved default) which stay listed past the 300 cap.
