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
| Revoke saved rules                              | missing | none                                                                  |
| Enforced at execution boundary                  | partial | `native-permission-*.mjs` overlay; no mode switching                  |
| Mid-run switch, child, batch, expiry, duplicate | partial | duplicates guarded by requestId; rest unproven                        |

## F-10 Preview

| Clause                                       | Status  | Evidence                                                |
| -------------------------------------------- | ------- | ------------------------------------------------------- |
| Browser/artifact tabs, URL/HTML/MD/image/PDF | missing | `webviewTag: false` (`main.mjs:278`), no preview widget |
| Nav/reload/resize/open external              | missing | none                                                    |
| Dev server start/stop/port/logs              | missing | none                                                    |
| No local exec for preview content            | n/a     | nothing to isolate yet                                  |

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
| Real PTY                                                  | partial | pipes only, no tty (`terminal-host.mjs:44`)                                                                                        |
| Resize                                                    | partial | stub `{resized:false}` (`:180`)                                                                                                    |
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
| Command palette (keyboard global)              | partial | slash menu only                                                                                                                         |
| Theme, font size, density                      | done    | `shared/preferences/index.mjs` (localStorage)                                                                                           |
| Layout setting                                 | partial | detail panel width already user-resizable; no persisted layout preference                                                               |
| Accessibility                                  | partial | aria labels present; no audit evidence                                                                                                  |
| Notifications (done/error/approval), redaction | done    | `features/notifications`, `shared/notifications` (generic text; OS opt-in, `host/notify-host.mjs`); approval only for selected session  |
| Local recurring jobs                           | done    | `host/automation-host.mjs`, `automation-runners.mjs`, `features/automation` (missed shown, not backfilled; runs only while app is open) |

## Remaining work, ordered

D = needs user decision.

1. **S** Import by typed path + show branch/writable (F-01). No deps.
2. **S** Unread + recent-reopen state (F-04). Needs renderer/store only if kept local; D if persisted in main.
3. **S** Message retry as new send; no tool re-run (F-05). Dep: none.
4. **S** Terminal resize/command attribution labels (F-12). PTY swap is item 12.
5. **M** Permission presets, remember, revoke (F-09). Dep: confirm which SDK/native rules are writable. D: weakens/widens authority.
6. **M** Physical delete with dirty/terminal/path preview (F-03). Dep: 1. D: new destructive fs boundary.
7. **M** Git worktree create/detect (F-01/F-02). Dep: git kernels. D: new git write op.
8. **M** App command palette completion + project action runner (F-13, F-12). Dep: 4.
9. **M** Usage/context/token display from runtime (F-16 half). D if runtime lacks fields.
10. **M** Timeline filters + navigation (F-16). Dep: 9 optional.
11. **L** Plan/checklist + review domain (F-15). D: new domain model.
12. **L** Real PTY via `node-pty` (F-12). D: new native dependency and runtime boundary; also needed for dev server.
13. **L** Preview tabs and dev server (F-10). Dep: 12 for dev server. D: new untrusted-content runtime boundary (WebContentsView, origin isolation).
14. **L** Subagent delegation, tree, abort + tool-ui cards + direct tool calls (F-07/F-08). Policy now allows `subagent` per mode (user decision); UI/tree/queue landed, live Native verification pending.
15. **L** Export/import/retention/app-data delete, notifications, recurring jobs (F-17/F-18). D: data-transfer redaction rules, OS notification permission, scheduler model.

Decisions needed from user: items 5, 6, 7, 12, 13, 14, 15 (and 2/9 conditionally). Windows (old B02/B18) is outside this table.
