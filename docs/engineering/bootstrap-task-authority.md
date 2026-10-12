# Bootstrap task authority (design, 2026-10-12)

Goal: Native `Session.create`/`fork` only with a durable binding to a live original operation; fresh profile reaches a usable workbench. User decisions: implement fully (no shortcut); include crash reconciler; next phase extends the same task model to `message.send` / tool execution.

Most pieces exist: `host/workbench-task-storage.mjs` (`task.prepare` / `task.bootstrap-binding` / `task.handoff` / `task.observe` / `task_proof` / `task.settle`, closed `bootstrap` binding `{step, reservationDigest, parentIdentityDigest}`), serialized writer `recordTask` (`host/workspace-registry.mjs` ~2528), child handoff store `native-permission-task-handoff.mjs` (`arm`/`consume`/`revoke`, ≤5s expiry, never restored), validator `bootstrapPreparation` (`native-permission-control-input.mjs:110`).

## Four locks that must open together

1. `checkBootstrapTaskAuthority` (`workbench-service.mjs` ~558) always fails when `context.nativeTasks` exists.
2. Child `prepareTask` always returns `held` (`native-permission-control.mjs` ~2119–2185); protocol accepts only held (`event-host-protocol.mjs` ~266).
3. Main never passes `taskAuthoritySource` to `openWorkspaceRegistry` (`main.mjs` ~224) → every `recordTask` fails `task_authority_required`.
4. Overlay makes `Session.create` fail unconditionally; `fork` goes via `enter` → `assertExecution` which always fails (`native-permission-overlay-contract.mjs` ~385/406, control ~1941).

## Guarantees

- No Native create/fork without journal: begin, reservation, dispatch(`native.create|fork`), `task.prepare`, `task.observe{bound}`, `task.handoff{armed}` — same `(runtimeEpoch, operationId)`.
- Native accepts exactly one method: create/fork consume a handoff armed for this launch whose `stageArgumentDigest` equals the digest of the actual input (incl. `permissions`). Direct HTTP / other callers / duplicate-id probes refused.
- No policy gap: permissions travel inside create input (`BASELINE_POLICY`: ask-all + `external_directory` deny floor last); mode rules applied after and verified by readback (`policy()`).
- No replay: handoffs are in-memory with expiry; registry refuses a second `task.prepare` for the same original key. Unsettled task → `taskHeld`, op retained → reconciler (below), never re-issue.
- No children before policy: bootstrap task never reaches `running`; `admitLease`→`assertExecution` stays held for it.

## Data model

No new record kinds. `stageArgumentDigest = sha256("omoc.native.bootstrap.args.v1\n" + canonical(effectArgs[0]))` (create args: id, metadata, location, permissions; fork: sessionID, before). `parentIdentityDigest` (fork) = digest of parent `{id, projectID, directory}`. Identity from the child's prepared result: `taskScopeId`, `locationId`, `projectId`, `modeGeneration`, `inventoryGeneration`, `launchId`.
`nativeTasks` (`event-host-supervisor.mjs` ~647) is the live correlation owner: `prepare` (bootstrap → `prepared`), `arm(row)` (IPC `task-arm`/`task-armed`), `revoke(id)`, `verify(record, ctx)` (sync, in-memory `Map<originalKey, preparedResult>`, cleared on fail/stop/owner loss).

## Flow (create, fork, default-workspace bootstrap) — `bindBootstrapTask(owner, step, args)` from `call()` `beforeEffect` for `native.create|fork`

1. Gate: `nativeTasks.prepare(...)` before `registry.dispatch`; held/failed → clean `effect:none` rejection.
2. `registry.dispatch`.
3. `recordTask(task.prepare)` → `task.observe{bound, launchId}` → `task.handoff{armed, stageArgumentDigest}` (each via `taskAuthoritySource → nativeTasks.verify`).
4. `nativeTasks.arm(row)` (child arms only now).
5. Native call: overlay `Session.create` → `control.consumeBootstrap(input)` (digest, `input.id === plannedNativeSessionId`, location); fork → `enterBootstrap(parentId, input)` checks `parentIdentityDigest` and consumes instead of `assertExecution`.
6. Success: `handoff{consumed}`→`{completed}`, `task.bootstrap-binding{appSessionId,nativeSessionId,metadataDigest}`, `policy()` + readback, `task_proof{settled}`, `task.settle`, existing `projectReceipt`/complete.
7. Failure before 5: revoke, `handoff{revoked}`, `task_proof{no_effect}`, settle (receipt stays `unknown` since dispatch flushed).
8. Failure/timeout at/after 5: write nothing more; held until reconciler.

## Reconciler (included)

On startup, for each unsettled bootstrap task: `session.get(plannedNativeSessionId)`: absent → settle `no_effect`; exact match (id, location/project, permissions ruleset digest = expected baseline) → settle created + bind; anything else → hold. Never re-issue the effect.

## Changes

`workbench-task-storage.mjs` (allow `task_proof{settled}` from bound only for bootstrap with completed handoff + binding); `native-permission-control.mjs` (prepared bootstrap branch, `armBootstrap`/`consumeBootstrap`/`enterBootstrap`, close in `closeRoots`); overlay contract (replace create-fail edit, fork wrapper; regenerate `afterSha256` via `scripts/native-permission-overlay.mjs`, keep graph pin bound to contract receipt); `event-host-protocol/child/supervisor` (prepared shape, task-arm, task-revoke, verify); `main.mjs` (`taskAuthoritySource`, `invalidateTaskAuthority` on runtime loss); `workbench-service.mjs` (gate requires prepare/arm/verify; bind in beforeEffect).

## Open risks

- Bootstrap `inventoryGeneration`/`modeGeneration` use the control's current observed counters (nothing executes) — accepted.
- Overlay change → rebuild staged event host.
- Possible bug: after fork, ws ~4465 checks `policyMatches` (baseline) after `policy(child)` applied mode rules → non-ask child may get UNKNOWN_OUTCOME; verify in fork tests.
