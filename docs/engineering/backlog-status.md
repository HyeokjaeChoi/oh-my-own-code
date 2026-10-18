# Backlog status (F-01..F-18)

Refreshed 2026-10-11 from current `apps/desktop-app` source (branch `audit-refresh`); rows touched since are marked with their date. Supersedes `docs/runs/full-product-coverage-audit/*` (2026-10-09). Evidence is static source reading; nothing was run. `workbench-web` ignored. Paths are relative to `apps/desktop-app/src/`.

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

| Clause                                                  | Status  | Evidence                                                                                                   |
| ------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Create, rename, pin, archive/restore, delete            | done    | contract `:151-171`; `features/sessions/index.tsx`                                                         |
| Search                                                  | done    | `sessions/index.tsx:50`                                                                                    |
| Recent reopen                                           | done    | `sessions/index.tsx` recent group (last 5, persisted), `recentSessions`; `e2e-chat` F-04 turn (2026-10-18) |
| Unread state                                            | done    | `trackSessions`, `data-session-unread` dot; permission dot; `e2e-chat` F-04 turn (2026-10-18)              |
| Two parallel sessions on different paths, no cross-talk | partial | per-session locks in service; no dedicated test found                                                      |
| Fork vs empty new session                               | done    | `sessions/index.tsx:244`, `session.create`                                                                 |
| Restore after restart, missing path shown               | partial | registry/journal restore (`host/storage-journal.mjs`); missing-path UI unverified                          |

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

Model-initiated `subagent` works in the real app (2026-10-13/14): `OMOC_E2E_STRICT_SUBAGENT=1 e2e-chat` asserts the round-trip. Child create is gated on the parent project's admission and on the removal hold (a removed workspace's sessions are refused).

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

| Clause                                              | Status  | Evidence                                                                                                               |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| File tree                                           | done    | `widgets/explorer/index.tsx`, `file.list`                                                                              |
| File search                                         | done    | `host/workbench-file-search.mjs`, `explorer/index.tsx:30`                                                              |
| Open/edit/save text, external-change conflict       | done    | `file.edit.read`/`file.save`; `features/workspace-file-editor`                                                         |
| Changed files; staged/unstaged/base diff            | done    | `git.review.read`, `git.diff.read`; `features/git-review`; macOS only (pinned Apple git), win32 `platform_unavailable` |
| Line feedback                                       | done    | `features/line-feedback`                                                                                               |
| Stage/unstage, commit, branch, restore with confirm | done    | `git.index/commit/branch/restore.*`; `branch-restore.tsx`; macOS only, win32 reports `platform_unavailable`            |
| Protects origin repo / other worktrees              | partial | owner-fence kernels; no worktree-aware tests                                                                           |

## F-12 Terminal

| Clause                                                    | Status  | Evidence                                                                                                                                                                                           |
| --------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal in workspace dir, tabs, input, exit code, output | done    | `host/terminal-host.mjs`, `widgets/terminal/index.tsx:148`                                                                                                                                         |
| Real PTY                                                  | done    | `node-pty` in `host/terminal-host.mjs`, xterm.js in `widgets/terminal/xterm-view.tsx`; `scripts/e2e-terminal.mjs`; Windows ConPTY and `package-windows` staging untested (needs a Windows machine) |
| Resize                                                    | done    | `terminal.resize` -> `pty.resize`, fit addon + debounced `createResizeSync` with rate-limit retry; `e2e-terminal` polls the first resize                                                           |
| Close tab vs stop process; orphan sweep                   | done    | `reap` `main.mjs:256`, `closeAll`                                                                                                                                                                  |
| Build/lint/test/dev actions                               | done    | package.json scripts, lockfile pm, argv spawn: `host/project-actions.mjs`, `terminalHost.startScript`; recent-run history not kept                                                                 |
| Command attribution                                       | partial | tab label `<pm> run <script>` shows its action; agent-started commands not applicable (no agent terminal)                                                                                          |

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

| Clause                                   | Status  | Evidence                                                                                                                                                                                  |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconnect, runtime exit, partial failure | done    | `operation.lookup`, sidecar-supervisor, recovery journal                                                                                                                                  |
| App crash / force quit, relaunch         | partial | idle checkpoint (relaunch after any completed op is ready); `retain_tail_as_unknown` dialog for in-flight rename/pin/archive/config save; task/permission/execution in flight still holds |
| Abort vs confirmed stop                  | done    | `session.interrupt` + status                                                                                                                                                              |
| Resubscribe + re-snapshot, gap marked    | partial | `snapshot`; projection has no gap marker, so no divider                                                                                                                                   |
| Session/history export/import            | partial | `host/data-host.mjs`, `features/data-transfer` (current session; archive view only)                                                                                                       |
| Retention settings, app-data deletion    | partial | imported archives only; wipe in `data-host.mjs`; native archived-session retention not done (no timestamps)                                                                               |

## F-18 Convenience/automation

| Clause                                         | Status  | Evidence                                                                                                                                |
| ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Shortcut help                                  | done    | `features/preferences/index.tsx:97`                                                                                                     |
| Command palette (keyboard global)              | done    | `features/palette`, `shared/palette` (Cmd+K on macOS, Ctrl+K elsewhere)                                                                 |
| Theme, font size, density                      | done    | `shared/preferences/index.mjs` (localStorage)                                                                                           |
| Layout setting                                 | partial | detail panel width already user-resizable; no persisted layout preference                                                               |
| Accessibility                                  | partial | aria labels present; terminal screen-reader mode toggle in Settings (2026-10-14, `e2e-features`); no audit evidence                     |
| Notifications (done/error/approval), redaction | done    | `features/notifications`, `shared/notifications` (generic text; OS opt-in, `host/notify-host.mjs`); approval only for selected session  |
| Local recurring jobs                           | done    | `host/automation-host.mjs`, `automation-runners.mjs`, `features/automation` (missed shown, not backfilled; runs only while app is open) |

## Remaining work

Current as of 2026-10-14 (branch `backlog3`, after `main` at `ec039547`). The F-xx tables above are per-clause status; this section is the single de-duplicated work list. Earlier numbering (items 1-14) is retired; the old numbers appear in parentheses only where a commit message or run note cites them.

### Done (do not reopen)

- **Real PTY terminal** (F-12): `node-pty` + `xterm.js`, resize sync, orphan sweep, keyboard-trap escape chord, safe paste, no OSC 8 activation; `e2e-terminal`, `e2e-features` terminal checks. Windows ConPTY is still untested (below).
- **Terminal screen-reader mode** — 2026-10-14: Settings "터미널 스크린 리더 모드" (`terminalScreenReader`, default off, persisted with the other preferences) toggles xterm `screenReaderMode` live; `e2e-features` `terminal-screen-reader`.
- **Export redaction** (escaped-quote and quoted `Authorization` leaks, oversized unterminated values) — 2026-10-13.
- **Git review with ignored symlinked dirs / file caps** (`check-ignore`, regression test) — 2026-10-13.
- **Permission policySync BUSY / config reads under drift** (bounded ~2.75s retry; `configuration.mcp.read` tolerates drift) — 2026-10-13.
- **Plans: poll vs `runCheck`, export summary key** — 2026-10-13.
- **Saved "항상 허용" rules** list/revoke UI (`permission.saved.list/remove`) — 2026-10-13.
- **Narrow-window composer** compact grid; `e2e-ui-states` full viewport again — 2026-10-13.
- **`catalog.list` pins selected/default model** past the 300 cap — 2026-10-13.
- **Subagent child create gated on parent admission** (`enter(parentID)` after `consumeBootstrap`) — 2026-10-14; strict mode holds, `e2e-chat` (`OMOC_E2E_STRICT_SUBAGENT=1`) passes.
- **Journal replay returns the original failure** (unknown outcome replays as `UNKNOWN_OUTCOME`) — 2026-10-14. All `scripts/*.test.mjs` run in the nx test target.
- **Removed-workspace parent no longer passes the gates** (old #14) — 2026-10-14: the permission control keeps a per-project removal hold (`holdProject` is on the control API like `armBootstrap`; Main reaches it through a new closed `project-hold` IPC message). `workspace.remove` sets it; `assertExecution` (prompt, tools, lease admission, and subagent child create, which relies on the overlay's `enter(parentID)` -> `assertExecution`) and `enterBootstrap` (fork) refuse a held project. The overlay recipe and digests are unchanged. Native project ids are shared by git worktrees/clones of one repo (`global` for commit-less repos), so the hold is conservative about sharing: it is skipped when any other registered workspace resolves to the project (from its sessions and from Native's `project.list` canonical/sandbox directories, so sessionless worktrees count), is never set for `global`, and is skipped entirely if any other workspace's lookup fails (an unresolved lookup means "possibly shared"). Holding several projects is all-or-nothing (already-set holds are rolled back and the removal refused). It is cleared when a session is created on, or a workspace is imported on, a held project (explicit user registration), or when the same path is re-imported. Limits: in memory per run (not re-derived after restart); a partially completed removal leaves the hold until re-import; darwin `realpath` does not case-normalize, so a case-only re-import of the same folder does not clear it by path; the lookups are sequential (one SDK call per scope lane).
- **`e2e-sessions` `POLICY_UNVERIFIED` on `session.create`** (old #13) — 2026-10-14: mitigated, root cause not reproduced. Every failure inside the post-create policy step is reported as `POLICY_UNVERIFIED`, including a transient Native read failure; the readback of the just-created session is read-only, so it now settles within 3 bounded attempts (200 ms apart) before failing closed. Unit-tested: a transient read failure and a transient permission mismatch then match both pass; a persistent read failure and a persistent mismatch still fail closed. The first failure was seen once; ~15 runs of the script on this branch (several under 12 busy-loop CPU hogs and 3 concurrent copies) never produced it, only unrelated load flakes (see "New open items"). Other places that map a transient condition to `POLICY_UNVERIFIED` and were not changed: a single-flight `task_preparation_held` from the event host (another task/observation call in flight) and the child's 5 s bootstrap-workspace inspection deadline (`prepareBootstrap` -> `bootstrapRefusal`). If it recurs, check which of these fired (the refusal is `effect: none`, so a repeat of the same `session.create` is safe).

### Needs a Windows machine

Nothing here can be proven on macOS. Wire-level pieces are implemented and unit-tested with injected `win32`; see `windows-verification.md` for the run checklist.

- **ConPTY and `package-windows`**: `node-pty` ConPTY (`useConpty`), `package-windows` staging of `node-pty/prebuilds/win32-x64`, and the xterm renderer under Windows; run `e2e-terminal`, `e2e-features`, `e2e-smoke packaged win32`.
- **Git review / commit / index / branch restore on win32**: all report `platform_unavailable`. Review snapshot needs a trust anchor (Git for Windows under `%ProgramFiles%` with an ACL-verified chain, a version allowlist that accepts `2.54.x.windows.N`, `core.symlinks=false` / `core.filemode=false` / `core.ignorecase=true` in `minimalConfig`, directory handles). Commit / index / branch restore need a new path-based kernel replacing the `bun:ffi` `openat`/`renameatx_np` one in `git-metadata-kernel.mjs` (same identity proofs, exclusive `link` publication), then enabling the three request paths and `e2e-git-*`.
- **Bun IPC with `bun.exe`**: `stdio: ["ignore","ignore","ignore","ipc"]` and `fs.openSync` on directories under Bun, first thing to check when startup fails.
- **Antivirus sharing**: `EPERM`/sharing violations on `node_modules` beyond the retry budget.
- **AVX2**: `@oven/bun-windows-x64` needs it; older CPUs need a baseline build with its own pin.
- Also on that list: CIM/PowerShell cold-start cost, Chromium `lockfile` in the user-data root, extended/device path refusals, `process.umask` no-op.

### Accepted / won't do

- **Inherited session rules shadow agent-level restrictions** (old #8), accepted 2026-10-14: the parent session policy is the authority; agent-level restrictions (e.g. `explore` `*:deny`) are advisory for children and must not be relied on to narrow a child below its parent.
- **No pty flow control** (`pause`/`resume`): a background tab is not polled, so pausing would stall its process; the bounded ring drops the oldest output instead.
- **A shell that exits by itself leaves jobs it moved to their own process group running** (like any terminal); close/stop/quit kill the whole tree.
- **CSP `style-src-elem 'unsafe-inline'`** (evaluated 2026-10-14, left as is): xterm.js 6.0.0 creates three `<style>` elements at runtime (DOM renderer theme, dimensions, scrollbar) with `textContent`, has no `nonce` option and no `adoptedStyleSheets` path, so the directive is needed for them, not for `xterm.css` (which is a bundled file allowed by `'self'`). A per-load nonce would need (1) serving the renderer through a custom protocol so the CSP can carry a fresh nonce (it is currently `loadFile` with a `<meta>` CSP, and `onHeadersReceived` does not apply to `file://`), and (2) monkey-patching `document.createElement("style")` to stamp the nonce, since xterm never sets it. That is more moving parts and attack surface than the directive it removes (inline style attributes and scripts stay blocked). Revisit if xterm adds a nonce or constructable-stylesheet option.
- **Packaged builds always use the durable profile** under the user's home (the `OMOC_APP_DATA_DIR` isolation is unpackaged-only). On macOS `e2e-smoke packaged` isolates via `CFFIXED_USER_HOME`; never run a packaged app by hand with failure scenarios against the real profile (a launch that dies mid-startup leaves owner state the next launch refuses: `owner_unverified` / `native_startup_unverified`). The old `crash_restart` case (SIGKILLs the sidecar) is still skipped by default; `e2e-smoke dev` now covers a main-process `process.crash()` relaunch and a mid-flight rename recovered through the dialog.
- **Crash relaunch bug** (fixed 2026-10-15): only a clean quit checkpointed the journal, so any crash or force quit left `unconfirmed_tail` and every later launch stayed unavailable. Now an owner-fenced idle checkpoint runs whenever no operation is in flight, and an in-flight non-authority operation can be recorded as UNKNOWN after confirmation (`docs/engineering/bootstrap-task-authority.md`, "Crash recovery without authority").
- **Remaining crash hold**: a crash while a task/permission/execution operation (send, command, permission reply, git, fork, create, MCP/skill/agent) is in flight, or with an uncertain checkpoint marker, still holds the store read-only (explained by a startup dialog with the data location). No in-app escape yet; the dialog only points to the data location.

### New open items

- **e2e-sessions is load-sensitive** (found 2026-10-14 while trying to reproduce old #13): under heavy CPU load it fails with `READ_BUSY` on the initial `snapshot` (the script retries only the first one) and with a 5 s `toBeFocused` timeout on the session menu "이름 변경" item. Test-only; give those waits the same bounded settle as the idle waits if it flakes in CI.
- **Leased file reads** (`plainRead`) are guarded by `Permission.assert` first; the removal hold does not apply to them separately.
- **Native per-run `outcome:failed` is not projected** into the subagent tree (F-07); model-initiated child permission inheritance is Native-internal.
- **Remaining `partial`/`missing` F-xx clauses** (typed-path import, tool-ui cards and direct tool run, permission presets view, layout preference, accessibility audit evidence) are tracked in the tables above, not repeated here.

## Polish review minors (open)

- `inlineExplained` still hides a RUNTIME_ERROR banner from the read-failure path while the last assistant turn carries an old explained failure; main does not tag the error with its source turn.
- `readSessionTimes` burns the 30s throttle after a failed list read (old values kept); acceptable, retry on the next window.
