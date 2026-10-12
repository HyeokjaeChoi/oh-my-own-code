# Execution task authority — phase 2 (design, 2026-10-12)

Builds on `bootstrap-task-authority.md`. Goal: message send, commands, tool execution, subagents and permission replies run in the desktop app under durable task authority. Nothing is ever replayed after a crash.

## User decisions

- Inventory: **complete verification first** — execution is allowed only after every tool, hook and transform in the location's inventory has adapter proof (no minimal "pinned generations" shortcut).
- Git repositories: **supported in this phase** (today `host/native-bootstrap-workspace.mjs` refuses any `.git`/`.hg` in the parent chain). Keep root pinning and path containment.
- Subagents (task tool): **in scope** — create with `parentID` only from a fiber holding a running coordinator lease for that parent; child inherits lineage.
- "Always allow" permission replies: **in scope** — saving a rule is a mode/policy change (bumps mode generation, running leases go stale).
- Pending inbox items after crash: **left for the user** (held, Cancel offered; never auto-run).
- e2e send uses a mock provider.

## Blocker #1: `permission.list` → HTTP 500 on fresh sessions

`session.permission.list` is the first per-location route; `instances.provide(session)` builds the location through the overlaid LayerMap → Location overlay → inventory hooks → `locationReady`. Any undeclared failure → 500. Inventory rejections set a launch-wide `runtimeHeld`, after which every location build and `prepareTask` fails. Event-host child does not forward Native error logs. Suspects: inventory hook rejection (most likely), `.git` refusal, 32-location cap. Also blocks `instructionIdentity` (send) and `workspaceIdleIdentity` (MCP).

## Model (summary)

- **Prepare** (child, non-bootstrap): `prepared` only if `!runtimeHeld`, location ready + root pinned, inventory complete and verified; returns `{taskScopeId, projectId, locationId, locationIncarnation, modeGeneration, inventoryGeneration, launchId}`.
- **Durable intent**: `task.prepare` (prompt/command/mutation binding; planned inbox id passed as `id` to `session.prompt`), `task.observe{bound}`; per Native step write `task.handoff{armed, stageArgumentDigest}` → arm in child → Native call → `consumed` → `completed`.
- **Consume**: generalise the bootstrap slot to a map keyed `(step, digest)`; coordinator `enter({step,args})` → `control.enterTask` consumes instead of `assertExecution` for setPermissions, switchAgent/Model, prompt, command, inbox cancel/steer/queue.
- **Running**: on prompt consume, child registers an origin scope with current generations; runner drain promotion calls `admitLease(coordinator)` and emits `task-promoted`; Main writes input pending→promoted, `task.observe{running}`.
- **Positive `assertExecution`**: only on a fiber holding a running lease for the project whose scope is current and whose mode/inventory/location-incarnation generations match.
- **Tool leases**: tool execute/beforeExecute/snapshot admit `direct_tool|shell` leases under the coordinator lease.
- **Permission replies**: mutation task (`native.permission`, digest of `{sessionID, requestID, decision, message}`) consumed by overlaid `Permission.reply`; "always" additionally a policy change.
- **Mode changes / policySync**: mutation tasks consumed by `setPermissions`; ruleset change bumps `project.generation` in the same transaction; mutation tasks settle from `bound` once handoff completed; readback stays.
- **Settle**: input consumed + lease fiber exit proof → `task-settled` → promoted→settled, `task_proof{settled}`, `task.settle`, receipt confirmed.
- **Interrupt**: unguarded (reduces effects); `observe{cancelling}` then settle after fiber-exit proof. Inbox cancel = mutation task → `no_effect`.
- **Crash/reconcile**: prompt task unsettled → look up planned inbox id; absent & never consumed → `no_effect` (user may resend); present → delivered, run outcome `UNKNOWN_OUTCOME`. Pending inbox stays held (user cancels). Mutation → readback digest; match settles, else hold.

## Order

- **A. Unblock & diagnose**: bounded 5xx diagnostics from event-host child (route, error tag, control reject code, `runtimeHeld`); fix the failing location/inventory hook; git repository support; tolerant refresh (permissions unavailable but transcript readable, switching works, send/reply disabled).
- **B. Complete inventory verification**: adapter proof for every tool/hook/transform; `inventoryLookup` positive path; generation tracking.
- **C. Mutation tasks**: generalised handoffs, mode.set/policySync, agent/model selection, permission reply incl. "always", inbox cancel, generation bump, settle + reconcile.
- **D. Execution**: prompt/command tasks, promote/lease/running, positive `assertExecution`, tool leases, subagents, settle/interrupt, prompt reconcile, e2e send with mock provider.
  Each step: Sonnet implements → fresh Opus review → fix until no critical/major.
