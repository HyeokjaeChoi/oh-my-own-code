// Fixed checked OpenCode 2.0.18 permission entry and inventory patches. Never applied to original install.
const recipe = {
  schemaVersion: 1,
  id: "permission-session-entry-gate-v1",
  serverVersion: "2.0.18",
  files: [
    {
      path: "node_modules/@opencode/server/dist/process.js",
      beforeSha256:
        "90fb992ca4c656649178ddc8af706922262256c13f4f2fc95c5cd95a913f2fcb",
      afterSha256:
        "c553abcc5404848220a97776c0d599ca45f183ca1c113610e6149bd6cf1a862a",
      edits: [
        {
          find: "function* (options, lifecycle, transform) {",
          replace: "function* (options, lifecycle, transform, overrides) {",
        },
        {
          find: "    }, urls).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)), applicationScope);",
          replace:
            "    }, urls, overrides).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)), applicationScope);",
        },
      ],
    },
    {
      path: "node_modules/@opencode/server/dist/process.d.ts",
      beforeSha256:
        "145cc4c09c12627ec49ae134811dfec7773cc462f506e61a9bfec5179eb646a5",
      afterSha256:
        "972489e8409c9b187fc6d60502fd55907407eff495691c490907400059f90338",
      edits: [
        {
          find: 'import { Effect, Scope } from "effect";',
          replace:
            'import { Effect, Scope } from "effect";\nimport type { LayerNode } from "@opencode/util/effect/layer-node";',
        },
        {
          find: "}, lifecycle?: Lifecycle<E, R> | undefined, transform?: Transform | undefined) => Effect.Effect<{",
          replace:
            "}, lifecycle?: Lifecycle<E, R> | undefined, transform?: Transform | undefined, overrides?: LayerNode.Replacements | undefined) => Effect.Effect<{",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-vgpkvtp0.js",
      beforeSha256:
        "a28683ef6d49fad12e71abb5ed77b23aaa093becd9369d5d2eea2c639f524f65",
      afterSha256:
        "aba86336a925c76c0de2e2da6324b85cf11eb304ce85f327c0a9aab613a032a1",
      edits: [
        {
          find: 'import { makeLocationNode } from "@opencode/util/effect/app-node";',
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { makeLocationNode } from "@opencode/util/effect/app-node";',
        },
        {
          find: "  const bus = yield* Service83;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const bus = yield* Service83;",
        },
        {
          find: "  const pending = new Map;",
          replace:
            "  const withProject = (body) => control.transaction([location.project.id], body);\n  const pending = new Map;",
        },
        {
          find: '  const close = Effect.gen(function* () {\n    closed = true;\n    yield* Effect.forEach(Array.from(pending.values()), (item) => bus.publish(Permission.Event.Replied, {\n      sessionID: item.request.sessionID,\n      requestID: item.request.id,\n      reply: "reject"\n    }).pipe(Effect.ensuring(Deferred.fail(item.deferred, new DeclinedError2))));\n    pending.clear();\n  }).pipe(Effect.uninterruptible);\n',
          replace:
            '  const close = withProject((tx) => Effect.gen(function* () {\n    yield* control.inspect(tx, location.project.id);\n    closed = true;\n    yield* Effect.forEach(Array.from(pending.values()), (item) => bus.publish(Permission.Event.Replied, {\n      sessionID: item.request.sessionID,\n      requestID: item.request.id,\n      reply: "reject"\n    }).pipe(Effect.ensuring(Deferred.fail(item.deferred, new DeclinedError2))));\n    pending.clear();\n  }).pipe(Effect.uninterruptible));\n',
        },
        {
          find: "const savedRules = Effect.fnUntraced(function* () {",
          replace: "const savedRules = Effect.fnUntraced(function* (tx) {",
        },
        {
          find: "yield* saved.list({ projectID: location.project.id })",
          replace:
            "yield* saved.listLocked(tx, { projectID: location.project.id })",
        },
        {
          find: "const evaluateInput = Effect.fnUntraced(function* (input) {",
          replace:
            "const evaluateInput = Effect.fnUntraced(function* (input, tx) {\n    yield* control.inspect(tx, location.project.id);",
        },
        {
          find: "...yield* savedRules()",
          replace: "...yield* savedRules(tx)",
        },
        {
          find: '  const ask = Effect.fn("Permission.ask")(function* (input) {\n    if (closed)\n      return { id: input.id ?? ID6.create(), effect: "deny" };\n    const result = yield* evaluateInput(input);\n    const value = request(input, result.message);\n    if (result.effect === "ask")\n      yield* create(value, input.agent);\n    return { id: value.id, effect: result.effect };\n  });\n',
          replace:
            '  const ask = Effect.fn("Permission.ask")((input) => withProject((tx) => Effect.gen(function* () {\n    yield* control.assertExecution(tx, location.project.id);\n    if (closed)\n      return { id: input.id ?? ID6.create(), effect: "deny" };\n    const result = yield* evaluateInput(input, tx);\n    const value = request(input, result.message);\n    if (result.effect === "ask")\n      yield* create(value, input.agent);\n    return { id: value.id, effect: result.effect };\n  })));\n',
        },
        {
          find: '  const assert = Effect.fn("Permission.assert")((input) => Effect.gen(function* () {\n    if (closed)\n      return yield* Effect.die(new DeclinedError2);\n    const result = yield* evaluateInput(input);\n    return yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {\n      if (result.effect === "deny") {\n        return yield* new BlockedError2({\n          rules: relevant(input, result.rules),\n          permission: input.action,\n          resources: input.resources,\n          reason: result.message\n        });\n      }\n      if (result.effect === "allow")\n        return;\n      const item = yield* create(request(input, result.message), input.agent);\n      return yield* restore(Deferred.await(item.deferred)).pipe(Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)), Effect.ensuring(Effect.sync(() => {\n        pending.delete(item.request.id);\n      })));\n    }));\n  }));\n',
          replace:
            '  const assert = Effect.fn("Permission.assert")((input) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {\n    const item = yield* withProject((tx) => Effect.gen(function* () {\n      yield* control.assertExecution(tx, location.project.id);\n      if (closed)\n        return yield* Effect.die(new DeclinedError2);\n      const result = yield* evaluateInput(input, tx);\n      if (result.effect === "deny") {\n        return yield* new BlockedError2({\n          rules: relevant(input, result.rules),\n          permission: input.action,\n          resources: input.resources,\n          reason: result.message\n        });\n      }\n      if (result.effect === "allow")\n        return;\n      return yield* create(request(input, result.message), input.agent);\n    }));\n    if (!item)\n      return;\n    return yield* restore(Deferred.await(item.deferred)).pipe(Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)), Effect.ensuring(withProject((tx) => Effect.gen(function* () {\n      yield* control.inspect(tx, location.project.id);\n      pending.delete(item.request.id);\n    })).pipe(Effect.tapError(() => control.invalidate("pending_cleanup_unverified")))));\n  })));\n',
        },
        {
          find: '  const reply = Effect.fn("Permission.reply")((input) => Effect.uninterruptible(Effect.gen(function* () {\n    const existing = pending.get(input.requestID);\n    if (!existing)\n      return yield* new NotFoundError6({ requestID: input.requestID });\n    yield* bus.publish(Permission.Event.Replied, {\n      sessionID: existing.request.sessionID,\n      requestID: existing.request.id,\n      reply: input.reply\n    });\n    if (input.reply === "reject") {\n      yield* Deferred.fail(existing.deferred, input.message ? new CorrectedError2({ feedback: input.message }) : new DeclinedError2);\n      pending.delete(input.requestID);\n      for (const [id, item] of pending) {\n        if (item.request.sessionID !== existing.request.sessionID)\n          continue;\n        yield* bus.publish(Permission.Event.Replied, {\n          sessionID: item.request.sessionID,\n          requestID: item.request.id,\n          reply: "reject"\n        });\n        yield* Deferred.fail(item.deferred, new DeclinedError2);\n        pending.delete(id);\n      }\n      return;\n    }\n    if (input.reply === "always" && existing.request.save?.length) {\n      yield* saved.add({\n        projectID: location.project.id,\n        action: existing.request.action,\n        resources: existing.request.save\n      });\n    }\n    yield* Deferred.succeed(existing.deferred, undefined);\n    pending.delete(input.requestID);\n    if (input.reply !== "always" || !existing.request.save?.length)\n      return;\n    for (const [id, item] of pending) {\n      const result = yield* evaluateInput({ ...item.request, agent: item.agent }).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.undefined));\n      if (result?.effect !== "allow")\n        continue;\n      yield* bus.publish(Permission.Event.Replied, {\n        sessionID: item.request.sessionID,\n        requestID: item.request.id,\n        reply: "always"\n      });\n      yield* Deferred.succeed(item.deferred, undefined);\n      pending.delete(id);\n    }\n  })));\n',
          replace:
            '  const reply = Effect.fn("Permission.reply")((input) => withProject((tx) => Effect.uninterruptible(Effect.gen(function* () {\n    yield* control.assertExecution(tx, location.project.id);\n    const existing = pending.get(input.requestID);\n    if (!existing)\n      return yield* new NotFoundError6({ requestID: input.requestID });\n    yield* bus.publish(Permission.Event.Replied, {\n      sessionID: existing.request.sessionID,\n      requestID: existing.request.id,\n      reply: input.reply\n    });\n    if (input.reply === "reject") {\n      yield* Deferred.fail(existing.deferred, input.message ? new CorrectedError2({ feedback: input.message }) : new DeclinedError2);\n      pending.delete(input.requestID);\n      for (const [id, item] of pending) {\n        if (item.request.sessionID !== existing.request.sessionID)\n          continue;\n        yield* bus.publish(Permission.Event.Replied, {\n          sessionID: item.request.sessionID,\n          requestID: item.request.id,\n          reply: "reject"\n        });\n        yield* Deferred.fail(item.deferred, new DeclinedError2);\n        pending.delete(id);\n      }\n      return;\n    }\n    if (input.reply === "always" && existing.request.save?.length) {\n      yield* saved.addLocked(tx, {\n        projectID: location.project.id,\n        action: existing.request.action,\n        resources: existing.request.save\n      });\n    }\n    yield* Deferred.succeed(existing.deferred, undefined);\n    pending.delete(input.requestID);\n    if (input.reply !== "always" || !existing.request.save?.length)\n      return;\n    for (const [id, item] of pending) {\n      const result = yield* evaluateInput({ ...item.request, agent: item.agent }, tx).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.undefined));\n      if (result?.effect !== "allow")\n        continue;\n      yield* bus.publish(Permission.Event.Replied, {\n        sessionID: item.request.sessionID,\n        requestID: item.request.id,\n        reply: "always"\n      });\n      yield* Deferred.succeed(item.deferred, undefined);\n      pending.delete(id);\n    }\n  }))));\n',
        },
        {
          find: '  const list = Effect.fn("Permission.list")(function* () {\n    return Array.from(pending.values(), (item) => item.request);\n  });\n  const get = Effect.fn("Permission.get")(function* (id) {\n    return pending.get(id)?.request;\n  });\n  const forSession = Effect.fn("Permission.forSession")(function* (sessionID) {\n    return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID);\n  });\n',
          replace:
            '  const listLocked = (tx) => control.inspect(tx, location.project.id).pipe(Effect.andThen(Effect.sync(() => Array.from(pending.values(), (item) => item.request))));\n  const list = Effect.fn("Permission.list")(() => withProject(listLocked));\n  const get = Effect.fn("Permission.get")((id) => withProject((tx) => control.inspect(tx, location.project.id).pipe(Effect.andThen(Effect.sync(() => pending.get(id)?.request)))));\n  const forSession = Effect.fn("Permission.forSession")((sessionID) => withProject((tx) => listLocked(tx).pipe(Effect.map((items) => items.filter((item) => item.sessionID === sessionID)))));\n',
        },
        {
          find: "return Service49.of({ ask, assert, reply, get, forSession, list, close });",
          replace:
            "return Service49.of({ ask, assert, reply, get, forSession, list, listLocked, close });",
        },
        {
          find: "deps: [node87, node84, node65, node52, node53, node63]",
          replace:
            "deps: [node87, node84, node65, node52, node53, node63, workbenchControlNode]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-7scxvj8s.js",
      beforeSha256:
        "2443ac3488340f40a17b6ae23ab1c9599f32ed2f12d5efb3f48f868c31fd51f9",
      afterSha256:
        "b94b04da1aec07a7a2f5446670ba746d337f4d8c684cd88aa3d8b27142425d9e",
      edits: [
        {
          find: 'import { eq } from "drizzle-orm";',
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { eq } from "drizzle-orm";',
        },
        {
          find: "  const db = (yield* Service84).db;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const db = (yield* Service84).db;",
        },
        {
          find: "  const list = Effect.fnUntraced",
          replace: "  const listRaw = Effect.fnUntraced",
        },
        {
          find: '  const add = Effect.fn("PermissionSaved.add")',
          replace: '  const addRaw = Effect.fn("PermissionSaved.add")',
        },
        {
          find: '  const remove = Effect.fn("PermissionSaved.remove")',
          replace: '  const removeRaw = Effect.fn("PermissionSaved.remove")',
        },
        {
          find: "  return Service51.of({ list, add, remove });",
          replace:
            '  const scope = (input) => typeof input?.projectID === "string" && input.projectID.length ? input.projectID : undefined;\n  const invalid = () => Effect.fail(new Error("native_permission_scope_unverified"));\n  const listLocked = (tx, input) => scope(input) ? control.inspect(tx, input.projectID).pipe(Effect.andThen(listRaw(input))) : invalid();\n  const addLocked = (tx, input) => scope(input) ? control.assertExecution(tx, input.projectID).pipe(Effect.andThen(addRaw(input))) : invalid();\n  const removeLocked = (tx, input) => scope(input) ? control.assertExecution(tx, input.projectID).pipe(Effect.andThen(Effect.gen(function* () {\n    const rows = yield* db.select().from(PermissionTable2).where(eq(PermissionTable2.id, input.id)).all().pipe(Effect.orDie);\n    if (!rows.length)\n      return;\n    if (rows.length !== 1 || rows[0].project_id !== input.projectID)\n      return yield* Effect.fail(new Error("native_permission_scope_unverified"));\n    yield* removeRaw(input.id);\n  }))) : invalid();\n  const list = (input) => scope(input) ? control.transaction([input.projectID], (tx) => listLocked(tx, input)) : invalid();\n  const add = (input) => scope(input) ? control.transaction([input.projectID], (tx) => addLocked(tx, input)) : invalid();\n  const remove = (id) => Effect.gen(function* () {\n    const rows = yield* db.select().from(PermissionTable2).where(eq(PermissionTable2.id, id)).all().pipe(Effect.orDie);\n    if (!rows.length)\n      return;\n    if (rows.length !== 1)\n      return yield* invalid();\n    const projectID = rows[0].project_id;\n    return yield* control.transaction([projectID], (tx) => removeLocked(tx, { projectID, id }));\n  });\n  return Service51.of({ list, add, remove, listLocked, addLocked, removeLocked });',
        },
        {
          find: "deps: [node88]",
          replace: "deps: [node88, workbenchControlNode]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-yp2x3t23.js",
      beforeSha256:
        "ad6fc7b1e763dd7c05a9fe5a6028ad108be368568afc040dbe2f324edc7779d3",
      afterSha256:
        "2646f6b2fccf432303f0a322e1b973d031f50bcd0dc46b47782a3a0759764be3",
      edits: [
        {
          find: 'import { Deferred, Effect, Fiber, FiberSet } from "effect";',
          replace:
            'import { Deferred, Effect, Fiber, FiberSet } from "effect";\nimport { Service as WorkbenchControl } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission } from "../../../../../native-permission-coordinator-admission.mjs";\nimport { Service50 as WorkbenchSessionStore } from "./config-sd0msgcy.js";',
        },
        {
          find: "  const executions = new Map;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  const enter = createCoordinatorAdmission({ control, store });\n  const executions = new Map;",
        },
        {
          find: "  const loop = (key, execution, force) => Effect.suspend(() => options.drain(key, force, execution.scope)).pipe(Effect.andThen(Effect.suspend(() => {\n    if (execution.stopping || execution.pendingWake === undefined)\n      return Effect.void;\n    execution.scope = execution.pendingWake;\n    execution.pendingWake = undefined;\n    return Effect.yieldNow.pipe(Effect.andThen(loop(key, execution, false)));\n  })));\n",
          replace:
            "  const loop = (key, execution, force) => enter(key, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => options.drain(key, force, execution.scope))), Effect.andThen(Effect.suspend(() => {\n    if (execution.stopping || execution.pendingWake === undefined)\n      return Effect.void;\n    return enter(key, () => Effect.sync(() => {\n      if (execution.stopping || execution.pendingWake === undefined)\n        return false;\n      execution.scope = execution.pendingWake;\n      execution.pendingWake = undefined;\n      return true;\n    })).pipe(Effect.flatMap((again) => again ? Effect.yieldNow.pipe(Effect.andThen(loop(key, execution, false))) : Effect.void));\n  })));\n",
        },
        {
          find: "  const start = (key, force, scope) => {",
          replace: "  const startLocked = (key, force, scope) => {",
        },
        {
          find: "Effect.uninterruptible(options.started?.(key) ?? Effect.void)",
          replace:
            "Effect.uninterruptible(enter(key, () => options.started?.(key) ?? Effect.void))",
        },
        {
          find: "Effect.onExit((exit) => Effect.sync(() => settle(key, execution, exit)))",
          replace: "Effect.onExit((exit) => settle(key, execution, exit))",
        },
        {
          find: "  const settle = (key, execution, exit) => {\n    if (execution.pendingWake)\n      start(key, false, execution.pendingWake);\n    else\n      executions.delete(key);\n    Deferred.doneUnsafe(execution.done, exit);\n  };\n",
          replace:
            '  const start = (key, force, scope) => enter(key, () => Effect.sync(() => {\n    const current = executions.get(key);\n    if (current !== undefined) {\n      current.pendingWake = current.pendingWake === "input" ? "input" : scope;\n      return current;\n    }\n    return startLocked(key, force, scope);\n  }));\n  const settle = (key, execution, exit) => Effect.gen(function* () {\n    if (executions.get(key) !== execution)\n      return;\n    executions.delete(key);\n    if (execution.pendingWake !== undefined)\n      yield* Effect.exit(start(key, false, execution.pendingWake));\n  }).pipe(Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(execution.done, exit))));\n',
        },
        {
          find: '  const run = (key) => Effect.suspend(() => {\n    const execution = executions.get(key);\n    if (execution !== undefined) {\n      if (execution.stopping)\n        return Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(run(key)));\n      return Deferred.await(execution.done);\n    }\n    return Deferred.await(start(key, true, "input").done);\n  });\n',
          replace:
            '  const run = (key) => Effect.suspend(() => enter(key, () => Effect.sync(() => {\n    const execution = executions.get(key);\n    return {\n      execution: execution ?? startLocked(key, true, "input"),\n      stopping: execution?.stopping ?? false\n    };\n  })).pipe(Effect.flatMap(({ execution, stopping }) => stopping\n    ? Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(run(key)))\n    : Deferred.await(execution.done))));\n',
        },
        {
          find: '  const wake = (key, scope = "input") => Effect.sync(() => {\n    const execution = executions.get(key);\n    if (execution !== undefined) {\n      execution.pendingWake = execution.pendingWake === "input" ? "input" : scope;\n      return;\n    }\n    start(key, false, scope);\n  });\n',
          replace:
            '  const wake = (key, scope = "input") => enter(key, () => Effect.sync(() => {\n    const execution = executions.get(key);\n    if (execution !== undefined) {\n      execution.pendingWake = execution.pendingWake === "input" ? "input" : scope;\n      return;\n    }\n    startLocked(key, false, scope);\n  }));\n',
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-y8cm73x9.js",
      beforeSha256:
        "7fb5361b02086981ebcfb8d71d5a1d7cf3c5c9b91421829cce640252db450d79",
      afterSha256:
        "f96d58b1e4a68ddd261170f16b953157f590229f52c2ebe4b4b0a50860391b9d",
      edits: [
        {
          find: 'import { makeGlobalNode } from "@opencode/util/effect/app-node";',
          replace:
            'import { node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { makeGlobalNode } from "@opencode/util/effect/app-node";',
        },
        {
          find: "deps: [node52, node49, node87, node88, node58]",
          replace:
            "deps: [node52, node49, node87, node88, node58, workbenchControlNode]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-9qsysn39.js",
      beforeSha256:
        "9ba44fa3bdf13bef28d5eb0c71dea56bbd80526d665c1d1d4853c146db3e084d",
      afterSha256:
        "7e619e08c82a171a669c8743ed2cec700f11b1459d348d7f3a55a37e4435b442",
      edits: [
        {
          find: 'import { DateTime, Effect, Fiber, Scope } from "effect";',
          replace:
            'import { DateTime, Effect, Fiber, Scope } from "effect";\nimport { Service as WorkbenchControl } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission } from "../../../../../native-permission-coordinator-admission.mjs";',
        },
        {
          find: "  const store = yield* Service50;",
          replace:
            "  const store = yield* Service50;\n  const control = yield* WorkbenchControl;\n  const enter = createCoordinatorAdmission({ control, store });\n  // Held entry check only. Positive task leases must be integrated before activation.\n  const guard = (original) => (sessionID, ...args) => enter(sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => original(sessionID, ...args))));",
        },
        {
          find: '  const view = Effect.fn("Session.view")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.time.idle === undefined || input.idle > DateTime.toEpochMillis(session.time.idle) || session.time.viewed !== undefined && DateTime.toEpochMillis(session.time.viewed) >= input.idle)\n      return;\n    yield* bus.publish(SessionEvent2.Viewed, { sessionID, idle: input.idle });\n  });\n',
          replace:
            '  const view = guard(Effect.fn("Session.view")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.time.idle === undefined || input.idle > DateTime.toEpochMillis(session.time.idle) || session.time.viewed !== undefined && DateTime.toEpochMillis(session.time.viewed) >= input.idle)\n      return;\n    yield* bus.publish(SessionEvent2.Viewed, { sessionID, idle: input.idle });\n  }));\n',
        },
        {
          find: '  const rename = Effect.fn("Session.rename")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.Renamed, { sessionID, title: input.title });\n  });\n',
          replace:
            '  const rename = guard(Effect.fn("Session.rename")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.Renamed, { sessionID, title: input.title });\n  }));\n',
        },
        {
          find: '  const setMetadata = Effect.fn("Session.setMetadata")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.MetadataUpdated, { sessionID, metadata: input.metadata });\n  });\n',
          replace:
            '  const setMetadata = guard(Effect.fn("Session.setMetadata")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.MetadataUpdated, { sessionID, metadata: input.metadata });\n  }));\n',
        },
        {
          find: '  const setPermissions = Effect.fn("Session.setPermissions")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.Permissions, { sessionID, permissions: input.permissions });\n  });\n',
          replace:
            '  const setPermissions = guard(Effect.fn("Session.setPermissions")(function* (sessionID, input) {\n    yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.Permissions, { sessionID, permissions: input.permissions });\n  }));\n',
        },
        {
          find: '  const switchAgent = Effect.fn("Session.switchAgent")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.AgentSelected, { sessionID, agent: input.agent, previous: session.agent });\n  });\n',
          replace:
            '  const switchAgent = guard(Effect.fn("Session.switchAgent")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    yield* bus.publish(SessionEvent2.AgentSelected, { sessionID, agent: input.agent, previous: session.agent });\n  }));\n',
        },
        {
          find: '  const switchModel = Effect.fn("Session.switchModel")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.model?.providerID === input.model.providerID && session.model.id === input.model.id && (session.model.variant ?? "default") === (input.model.variant ?? "default"))\n      return;\n    yield* bus.publish(SessionEvent2.ModelSelected, { sessionID, model: input.model, previous: session.model });\n  });\n',
          replace:
            '  const switchModel = guard(Effect.fn("Session.switchModel")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.model?.providerID === input.model.providerID && session.model.id === input.model.id && (session.model.variant ?? "default") === (input.model.variant ?? "default"))\n      return;\n    yield* bus.publish(SessionEvent2.ModelSelected, { sessionID, model: input.model, previous: session.model });\n  }));\n',
        },
        {
          find: '  const cancelInbox = Effect.fn("Session.cancelInbox")((sessionID, inboxID) => mutatePending(sessionID, inboxID, admission.cancel), Effect.uninterruptible);\n',
          replace:
            '  const cancelInbox = guard(Effect.fn("Session.cancelInbox")((sessionID, inboxID) => mutatePending(sessionID, inboxID, admission.cancel), Effect.uninterruptible));\n',
        },
        {
          find: '  const steerInbox = Effect.fn("Session.steerInbox")(function* (sessionID, inboxID) {\n    yield* mutatePending(sessionID, inboxID, admission.steer);\n    yield* execution.wake(sessionID);\n  }, Effect.uninterruptible);\n',
          replace:
            '  const steerInbox = guard(Effect.fn("Session.steerInbox")(function* (sessionID, inboxID) {\n    yield* mutatePending(sessionID, inboxID, admission.steer);\n    yield* execution.wake(sessionID);\n  }, Effect.uninterruptible));\n',
        },
        {
          find: '  const queueInbox = Effect.fn("Session.queueInbox")((sessionID, inboxID) => mutatePending(sessionID, inboxID, admission.queue), Effect.uninterruptible);\n',
          replace:
            '  const queueInbox = guard(Effect.fn("Session.queueInbox")((sessionID, inboxID) => mutatePending(sessionID, inboxID, admission.queue), Effect.uninterruptible));\n',
        },
        {
          find: '  const prompt = Effect.fn("Session.prompt")((sessionID, input) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {\n    const session = yield* get(sessionID);\n    const messageID = input.id ?? SessionMessage2.ID.create();\n    const admitted = yield* Effect.gen(function* () {\n      const existing = yield* admission.reconcile({\n        id: messageID,\n        sessionID: session.id,\n        type: "user",\n        delivery: input.delivery ?? "steer"\n      });\n      if (existing)\n        return existing;\n      const item = yield* restore(prepare2({ session, messageID, input }).pipe(Effect.provideService(Service47, instances), Effect.provideService(FSUtil.Service, fs)));\n      if (session.revert)\n        yield* commit2(bus, session);\n      return yield* admission.admit({\n        id: messageID,\n        sessionID: session.id,\n        item\n      });\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new PromptConflictError2({ sessionID, messageID })));\n    if (input.resume !== false)\n      yield* execution.wake(sessionID);\n    return admitted;\n  })));\n',
          replace:
            '  const prompt = guard(Effect.fn("Session.prompt")((sessionID, input) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {\n    const session = yield* get(sessionID);\n    const messageID = input.id ?? SessionMessage2.ID.create();\n    const admitted = yield* Effect.gen(function* () {\n      const existing = yield* admission.reconcile({\n        id: messageID,\n        sessionID: session.id,\n        type: "user",\n        delivery: input.delivery ?? "steer"\n      });\n      if (existing)\n        return existing;\n      const item = yield* restore(prepare2({ session, messageID, input }).pipe(Effect.provideService(Service47, instances), Effect.provideService(FSUtil.Service, fs)));\n      if (session.revert)\n        yield* commit2(bus, session);\n      return yield* admission.admit({\n        id: messageID,\n        sessionID: session.id,\n        item\n      });\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new PromptConflictError2({ sessionID, messageID })));\n    if (input.resume !== false)\n      yield* execution.wake(sessionID);\n    return admitted;\n  }))));\n',
        },
        {
          find: '  const shell = Effect.fn("Session.shell")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    const running = yield* Effect.gen(function* () {\n      const started = yield* start2({ session, command: input.command }).pipe(Effect.provideService(Service47, instances), Effect.tapError((error) => synthetic(sessionID, {\n        text: `User shell command failed to start:\n${input.command}\n\n${error.message}`,\n        description: input.command,\n        metadata: { source: "shell", state: "error" },\n        resume: false\n      })), Effect.orDie);\n      yield* bus.publish(SessionEvent2.Shell.Started, {\n        sessionID,\n        shell: started.info\n      }, { id: input.id ? Event.ID.make(input.id.replace(/^msg_/, "evt_")) : undefined });\n      const terminal = yield* started.result;\n      const preview = yield* started.output;\n      yield* bus.publish(SessionEvent2.Shell.Ended, {\n        sessionID,\n        shell: terminal.info,\n        output: preview\n      });\n      yield* synthetic(sessionID, {\n        ...userNotification2(terminal),\n        resume: false\n      }).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void), Effect.orDie);\n    }).pipe(Effect.forkIn(scope, { startImmediately: true }));\n    yield* Fiber.join(running);\n  });\n',
          replace:
            '  const shell = guard(Effect.fn("Session.shell")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    const running = yield* Effect.gen(function* () {\n      const started = yield* start2({ session, command: input.command }).pipe(Effect.provideService(Service47, instances), Effect.tapError((error) => synthetic(sessionID, {\n        text: `User shell command failed to start:\n${input.command}\n\n${error.message}`,\n        description: input.command,\n        metadata: { source: "shell", state: "error" },\n        resume: false\n      })), Effect.orDie);\n      yield* bus.publish(SessionEvent2.Shell.Started, {\n        sessionID,\n        shell: started.info\n      }, { id: input.id ? Event.ID.make(input.id.replace(/^msg_/, "evt_")) : undefined });\n      const terminal = yield* started.result;\n      const preview = yield* started.output;\n      yield* bus.publish(SessionEvent2.Shell.Ended, {\n        sessionID,\n        shell: terminal.info,\n        output: preview\n      });\n      yield* synthetic(sessionID, {\n        ...userNotification2(terminal),\n        resume: false\n      }).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void), Effect.orDie);\n    }).pipe(Effect.forkIn(scope, { startImmediately: true }));\n    yield* Fiber.join(running);\n  }));\n',
        },
        {
          find: '  const skill = Effect.fn("Session.skill")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    const skill = yield* get4({ session, skill: input.skill }).pipe(Effect.provideService(Service47, instances));\n    yield* bus.publish(SessionEvent2.Skill.Activated, {\n      sessionID,\n      id: skill.id,\n      name: skill.name,\n      text: skill.content\n    }, { id: input.messageID ? Event.ID.make(input.messageID.replace(/^msg_/, "evt_")) : undefined });\n    if (input.resume !== false)\n      yield* execution.resume(sessionID).pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid);\n  });\n',
          replace:
            '  const skill = guard(Effect.fn("Session.skill")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    const skill = yield* get4({ session, skill: input.skill }).pipe(Effect.provideService(Service47, instances));\n    yield* bus.publish(SessionEvent2.Skill.Activated, {\n      sessionID,\n      id: skill.id,\n      name: skill.name,\n      text: skill.content\n    }, { id: input.messageID ? Event.ID.make(input.messageID.replace(/^msg_/, "evt_")) : undefined });\n    if (input.resume !== false)\n      yield* execution.resume(sessionID).pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid);\n  }));\n',
        },
        {
          find: '  const compact = Effect.fn("Session.compact")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.revert)\n      yield* commit2(bus, session);\n    const inputID = input.id ?? SessionMessage2.ID.create();\n    const admitted = yield* admission.admitCompaction({\n      id: inputID,\n      sessionID,\n      delivery: input.delivery ?? "steer"\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new CompactionConflictError2({ sessionID, inputID })));\n    yield* execution.wake(sessionID);\n    return admitted;\n  });\n',
          replace:
            '  const compact = guard(Effect.fn("Session.compact")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (session.revert)\n      yield* commit2(bus, session);\n    const inputID = input.id ?? SessionMessage2.ID.create();\n    const admitted = yield* admission.admitCompaction({\n      id: inputID,\n      sessionID,\n      delivery: input.delivery ?? "steer"\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new CompactionConflictError2({ sessionID, inputID })));\n    yield* execution.wake(sessionID);\n    return admitted;\n  }));\n',
        },
        {
          find: '  const resume = Effect.fn("Session.resume")(function* (sessionID) {\n    yield* get(sessionID);\n    yield* execution.resume(sessionID);\n  });\n',
          replace:
            '  const resume = guard(Effect.fn("Session.resume")(function* (sessionID) {\n    yield* get(sessionID);\n    yield* execution.resume(sessionID);\n  }));\n',
        },
        {
          find: '  const synthetic = Effect.fn("Session.synthetic")((sessionID, input) => Effect.uninterruptible(Effect.gen(function* () {\n    yield* get(sessionID);\n    const inputID = input.id ?? SessionMessage2.ID.create();\n    const admittedInput = {\n      type: "synthetic",\n      payload: SyntheticPayload2.make({\n        text: input.text,\n        description: input.description,\n        metadata: input.metadata\n      }),\n      delivery: Delivery2.make(input.delivery ?? "steer")\n    };\n    const admitted = yield* admission.admit({\n      id: inputID,\n      sessionID,\n      item: admittedInput\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new SyntheticConflictError2({ sessionID, inputID })));\n    if (input.resume !== false && !(yield* get(sessionID)).revert)\n      yield* execution.wake(sessionID);\n    return admitted;\n  })));\n',
          replace:
            '  const synthetic = guard(Effect.fn("Session.synthetic")((sessionID, input) => Effect.uninterruptible(Effect.gen(function* () {\n    yield* get(sessionID);\n    const inputID = input.id ?? SessionMessage2.ID.create();\n    const admittedInput = {\n      type: "synthetic",\n      payload: SyntheticPayload2.make({\n        text: input.text,\n        description: input.description,\n        metadata: input.metadata\n      }),\n      delivery: Delivery2.make(input.delivery ?? "steer")\n    };\n    const admitted = yield* admission.admit({\n      id: inputID,\n      sessionID,\n      item: admittedInput\n    }).pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => new SyntheticConflictError2({ sessionID, inputID })));\n    if (input.resume !== false && !(yield* get(sessionID)).revert)\n      yield* execution.wake(sessionID);\n    return admitted;\n  }))));\n',
        },
        {
          find: '  const stage = Effect.fn("Session.revert.stage")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    return yield* stage2({ session, messageID: input.messageID, files: input.files }).pipe(Effect.provideService(Service47, instances), Effect.provideService(Service84, database), Effect.provideService(Service83, bus));\n  });\n',
          replace:
            '  const stage = guard(Effect.fn("Session.revert.stage")(function* (sessionID, input) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    return yield* stage2({ session, messageID: input.messageID, files: input.files }).pipe(Effect.provideService(Service47, instances), Effect.provideService(Service84, database), Effect.provideService(Service83, bus));\n  }));\n',
        },
        {
          find: '  const clear = Effect.fn("Session.revert.clear")(function* (sessionID) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    yield* clear2(session).pipe(Effect.provideService(Service47, instances), Effect.provideService(Service83, bus));\n    return yield* execution.wake(sessionID);\n  });\n',
          replace:
            '  const clear = guard(Effect.fn("Session.revert.clear")(function* (sessionID) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    yield* clear2(session).pipe(Effect.provideService(Service47, instances), Effect.provideService(Service83, bus));\n    return yield* execution.wake(sessionID);\n  }));\n',
        },
        {
          find: '  const commit = Effect.fn("Session.revert.commit")(function* (sessionID) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    return yield* commit2(bus, session);\n  });\n',
          replace:
            '  const commit = guard(Effect.fn("Session.revert.commit")(function* (sessionID) {\n    const session = yield* get(sessionID);\n    if (yield* execution.isActive(sessionID))\n      return yield* new BusyError2({ sessionID });\n    return yield* commit2(bus, session);\n  }));\n',
        },
        {
          find: "start2({ session, command: input.command }).pipe(Effect.provideService(Service47, instances),",
          replace:
            "start2({ session, command: input.command }).pipe(Effect.provideService(WorkbenchControl, control), Effect.provideService(Service50, store), Effect.provideService(Service47, instances),",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-kyw5qrb7.js",
      beforeSha256:
        "13f9483384a1d0bf4c771d58a5932f973b950fd0f839db2f73c27ebcaad32805",
      afterSha256:
        "8bb1cbb6771fed3b5a77255c9e17f6ab266251e6031335b439137f8f2815ea77",
      edits: [
        {
          find: 'import { Effect } from "effect";',
          replace:
            'import { Effect } from "effect";\nimport { Service as WorkbenchControl } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission } from "../../../../../native-permission-coordinator-admission.mjs";\nimport { Service50 as WorkbenchSessionStore } from "./config-sd0msgcy.js";',
        },
        {
          find: "  const instances = yield* Service47;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  const enter = createCoordinatorAdmission({ control, store });\n  const session = yield* enter(input.session.id, () => store.get(input.session.id));\n  const instances = yield* Service47;",
        },
        {
          find: "instances.provide(input.session)",
          replace: "instances.provide(session)",
        },
        {
          find: "cwd: input.session.location.directory",
          replace: "cwd: session.location.directory",
        },
        {
          find: "metadata: { sessionID: input.session.id, background: true }",
          replace: "metadata: { sessionID: session.id, background: true }",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-zyp346xr.js",
      beforeSha256:
        "76638b2c4d683d304603080ba002d054cfcf49e037d378071e80b46efb74440b",
      afterSha256:
        "0b365a3c2be9ba0698beb85865a9091b48d12c4f5758317fe173964c0556f819",
      edits: [
        {
          find: '    create: Effect.fn("Session.create")(function* (input) {\n',
          replace:
            '    create: Effect.fn("Session.create")(function* (input) {\n      // No pre-session effect until private bootstrap task authority is wired.\n      // This also refuses direct HTTP creation and duplicate-ID probing.\n      yield* Effect.fail(new Error("native_permission_held"));\n',
        },
        {
          find: "var layer = Layer.effect(Service27, Effect.gen(function* () {",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission } from "../../../../../native-permission-coordinator-admission.mjs";\nvar layer = Layer.effect(Service27, Effect.gen(function* () {',
        },
        {
          find: "  const store = yield* Service50;",
          replace:
            "  const store = yield* Service50;\n  const control = yield* WorkbenchControl;\n  const enter = createCoordinatorAdmission({ control, store });",
        },
        {
          find: "    node64\n  ]",
          replace: "    node64,\n    workbenchControlNode\n  ]",
        },
        {
          find: "  return result;\n}));",
          replace:
            '  // Existing-session effect entries only; create/import need private bootstrap authority.\n  for (const name of ["fork", "remove", "generate", "command", "background", "move"]) {\n    const original = result[name];\n    result[name] = (input, ...args) => enter(typeof input === "string" ? input : input.sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => original(input, ...args))));\n  }\n  const environment = result.environment;\n  result.environment = (input) => input.variables === undefined ? environment(input) : enter(input.sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => environment(input))));\n  return result;\n}));',
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-3w5fmr99.js",
      beforeSha256:
        "28f8e167d496e3469ce4d1532b003b6adbc03c6641734be66a9e7b02fad1584d",
      afterSha256:
        "2b374f48f4be331e06419fb43f30dfab5b2fa72d45b1cc8500d633ab3e6f0a6b",
      edits: [
        {
          find: "// src/tool/runtime.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission, toolSessionID } from "../../../../../native-permission-coordinator-admission.mjs";\nimport { Service50 as WorkbenchSessionStore, node52 as workbenchSessionStoreNode } from "./config-sd0msgcy.js";\n// src/tool/runtime.ts',
        },
        {
          find: "var execute3 = (tool, input, context) => Effect.gen(function* () {\n  const decoded",
          replace:
            "var execute3 = (tool, input, context) => Effect.gen(function* () {\n  const sessionID = toolSessionID(context);\n  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  yield* createCoordinatorAdmission({ control, store })(sessionID, () => Effect.void);\n  const decoded",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-yw6qsgb4.js",
      beforeSha256:
        "3731a6ac99d3de9db8acd15d2ee4a7559b121dfa28e6694c7db5ed38f203e3aa",
      afterSha256:
        "41593f4696861893d2a07d5a02bc6aee294e9440a7ff2c89580334db05156208",
      edits: [
        {
          find: "// src/tool.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\nimport { createCoordinatorAdmission, toolSessionID } from "../../../../../native-permission-coordinator-admission.mjs";\nimport { Service50 as WorkbenchSessionStore, node52 as workbenchSessionStoreNode } from "./config-sd0msgcy.js";\nimport { Service80 as WorkbenchLocation, node84 as workbenchLocationNode } from "./config-vyy061a2.js";\n// src/tool.ts',
        },
        {
          find: "  const hooks = yield* Service61;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  const location = yield* WorkbenchLocation;\n  const enter = createCoordinatorAdmission({ control, store });\n  const hooks = yield* Service61;",
        },
        {
          find: "        execute: Effect.fnUntraced(function* (input) {\n          const context = {",
          replace:
            "        execute: Effect.fnUntraced(function* (input) {\n          const sessionID = toolSessionID(input);\n          yield* enter(sessionID, () => Effect.void);\n          const context = {",
        },
        {
          find: '  const beforeExecute = (name, input, context) => hooks.trigger("tool", "execute.before", {\n    tool: name,\n    sessionID: context.sessionID,\n    agent: context.agent,\n    messageID: context.messageID,\n    id: context.id,\n    input\n  });',
          replace:
            '  const beforeExecute = (name, input, context) => Effect.gen(function* () {\n    const sessionID = toolSessionID(context);\n    yield* enter(sessionID, () => Effect.void);\n    return yield* hooks.trigger("tool", "execute.before", {\n      tool: name,\n      sessionID,\n      agent: context.agent,\n      messageID: context.messageID,\n      id: context.id,\n      input\n    });\n  });',
        },
        {
          find: "execute3(tool, input, context).pipe(Effect.map",
          replace:
            "execute3(tool, input, context).pipe(Effect.provideService(WorkbenchControl, control), Effect.provideService(WorkbenchSessionStore, store), Effect.map",
        },
        {
          find: 'snapshot: Effect.fn("Tool.snapshot")((permissions) => Effect.sync(() => {',
          replace:
            'snapshot: Effect.fn("Tool.snapshot")((permissions) => control.transaction([location.project.id], (tx) => control.assertExecution(tx, location.project.id)).pipe(Effect.andThen(Effect.sync(() => {',
        },
        {
          find: "    }))\n  });",
          replace: "    }))))\n  });",
        },
        {
          find: "  deps: [node63, node62]",
          replace:
            "  deps: [node63, node62, workbenchControlNode, workbenchSessionStoreNode, workbenchLocationNode]",
        },
        {
          find: "// src/tool.ts",
          replace:
            'import { observeRegistration } from "../../../../../native-permission-inventory.mjs";\n// src/tool.ts',
        },
        {
          find: "Context, Effect, Layer, Result, Schema, SchemaIssue",
          replace: "Context, Effect, Layer, Result, Schema, SchemaIssue, Scope",
        },
        {
          find: "  const location = yield* WorkbenchLocation;",
          replace:
            "  const location = yield* WorkbenchLocation;\n  const inventoryHandle = yield* LocationBuildScope;",
        },
        {
          find: "transform: state.transform,",
          replace:
            'transform: observeRegistration(Effect, Scope, control, inventoryHandle, "tool", state.transform),',
        },
        {
          find: "reload: state.reload,",
          replace:
            'reload: () => control.inventoryChanged(inventoryHandle, "tool_reload").pipe(Effect.andThen(state.reload())),',
        },
        {
          find: "Service as WorkbenchControl, node as workbenchControlNode }",
          replace:
            "Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope }",
        },
        {
          find: "      catalog = undefined;",
          replace:
            '      catalog = undefined;\n      if (value.errors.length) return control.inventoryChanged(inventoryHandle, "tool_failed");',
        },
        {
          find: '      if (value.errors.length) return control.inventoryChanged(inventoryHandle, "tool_failed");',
          replace:
            "      return control.inventoryTools(inventoryHandle, Array.from(value.tools.values()), value.errors.length);",
        },
        {
          find: "        editor.tools.set(id, { ...tool, id, options: tool.options && { ...tool.options } });",
          replace:
            "        if (editor.tools.has(id)) control.inventoryMutation(inventoryHandle);\n        editor.tools.set(id, { ...tool, id, options: tool.options && { ...tool.options } });",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-zs6xvgsc.js",
      beforeSha256:
        "ef0790ce1b69287aa37e1983835e3aa4e67c030451cd0d8f394a6068636db695",
      afterSha256:
        "bc91187f78b5c59727654030e9f3f9c0efa133ef72951e0da3d3757f6ef22b34",
      edits: [
        {
          find: "// src/location-services.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/location-services.ts',
        },
        {
          find: 'import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option } from "effect";',
          replace:
            'import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option, Scope } from "effect";',
        },
        {
          find: "    const owner = yield* Effect.scope;",
          replace:
            '    const owner = yield* Effect.scope;\n    const control = yield* WorkbenchControl;\n    const tracked = (effect) => effect.pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? control.invalidate("location_lifecycle_unverified") : Effect.void));',
        },
        {
          find: "      return Layer.fromBuild((memoMap, scope) => Effect.suspend(() => Layer.buildWithMemoMap(layer2(ref, { replacements: bindings }), memoMap, scope)).pipe(Effect.onExit((exit) => {",
          replace:
            '      return Layer.fromBuild((memoMap, scope) => Effect.gen(function* () {\n        yield* Scope.addFinalizer(scope, Effect.suspend(() => build.handle ? tracked(control.locationScopeObserved(build.handle)) : Effect.void));\n        build.handle = yield* tracked(control.locationBegin(ref));\n        yield* tracked(control.locationRootAcquire(build.handle));\n        if (Option.getOrUndefined(MutableHashMap.get(builds, ref)) !== build) {\n          yield* tracked(control.locationFinalizing(build.handle));\n          return yield* Effect.fail(new Error("native_permission_location_invalidated"));\n        }\n        const observedMaps = new WeakMap();\n        const observeMemoMap = (original) => {\n          if (observedMaps.has(original)) return observedMaps.get(original);\n          const observed = Object.create(original);\n          observedMaps.set(original, observed);\n          observedMaps.set(observed, observed);\n          Object.defineProperty(observed, "getOrElseMemoize", { value: (layer, layerScope, construct) => original.getOrElseMemoize(layer, layerScope, (_memo, constructScope) => construct(observed, constructScope).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? tracked(control.locationFinalizing(build.handle)) : Effect.void))) });\n          return observed;\n        };\n        const observedMemoMap = observeMemoMap(memoMap);\n        const context = yield* Layer.buildWithMemoMap(layer2(ref, { replacements: bindings, observeMemoMap }), observedMemoMap, scope).pipe(Effect.provideService(LocationBuildScope, build.handle));\n        yield* Scope.addFinalizer(scope, Effect.suspend(() => tracked(control.locationFinalizing(build.handle))));\n        return context;\n      }).pipe(Effect.onExit((exit) => {',
        },
        {
          find: "              build.close = lifecycle.shutdown;",
          replace:
            "              yield* tracked(control.locationReady(build.handle));\n              build.close = tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(lifecycle.shutdown));",
        },
        {
          find: "                return yield* lifecycle.shutdown;",
          replace:
            "                return yield* tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(lifecycle.shutdown));",
        },
        {
          find: "        return Exit.isFailure(exit) ? finish.pipe",
          replace:
            "        const guardedFinish = build.handle && Exit.isFailure(exit) ? tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(finish)) : finish;\n        return Exit.isFailure(exit) ? guardedFinish.pipe",
        },
        {
          find: "Effect.asVoid) : finish;",
          replace: "Effect.asVoid) : guardedFinish;",
        },
        {
          find: "        MutableHashMap.remove(builds, key);\n        return inner.invalidate(key).pipe(Effect.andThen(build?.close ?? Effect.void));",
          replace:
            "        const finalize = build?.handle ? tracked(control.locationFinalizing(build.handle)) : Effect.void;\n        return finalize.pipe(Effect.andThen(Effect.suspend(() => {\n          MutableHashMap.remove(builds, key);\n          return inner.invalidate(key).pipe(Effect.andThen(build?.close ?? Effect.void));\n        })));",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-vyy061a2.js",
      beforeSha256:
        "5f1e4661eaee95de66c6ea2442985a5ebb4601ad2e2dba4235a50bbb8f72bd19",
      afterSha256:
        "16b123da6ae163a2902c5121dc08509040e3da0c1494e1f00b48933f7078bbe0",
      edits: [
        {
          find: "// src/location.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/location.ts',
        },
        {
          find: "  const project = yield* Service81;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;",
        },
        {
          find: "  const resolved = yield* project.resolve(ref.directory, options);",
          replace:
            "  const resolved = yield* control.locationProjectCandidate(handle);",
        },
        {
          find: "  return Service80.of({",
          replace:
            "  yield* control.locationBind(handle, { directory: ref.directory, workspaceID: ref.workspaceID, project: { id: resolved.id } });\n  return Service80.of({",
        },
        {
          find: "  deps: [node85]",
          replace: "  deps: [workbenchControlNode]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/effect/app-node-builder.js",
      beforeSha256:
        "b77347256dd0c0193319dd0d5ca7c9cb576f6585ad9ebd3f3575d91739669df6",
      afterSha256:
        "cee18a3e9ad7a1d5bc611821875f528a676bad6f51f16a8e0225dd95551b46d1",
      edits: [
        {
          find: "// src/effect/app-node-builder.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/effect/app-node-builder.ts',
        },
        {
          find: "replacements: [node54.replace(buildLocationServiceMap2(bindings)), ...bindings]",
          replace:
            "replacements: [node54.replace(makeGlobalNode({ service: Service52, layer: buildLocationServiceMap2(bindings), deps: [workbenchControlNode] })), ...bindings]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-ph8yj3s6.js",
      beforeSha256:
        "a6ef88862dd38892b7b75e986d77036d44f6bf5d72dc421312322e0f39b08b71",
      afterSha256:
        "f93ae92f8bd8f3ac26091b9ca39ad30fcbc652de3ada36d7f0a9f243328ab3fe",
      edits: [
        {
          find: "LayerNode.compile(graph2, { replacements, shared: Node.tags.values.global })",
          replace:
            "LayerNode.compile(graph2, { replacements, shared: Node.tags.values.global, observeMemoMap: options.observeMemoMap })",
        },
      ],
    },
    {
      path: "node_modules/@opencode/util/dist/effect/layer-node.js",
      beforeSha256:
        "a520c74636237031acaad8e16fb7fa321ca14a0307c9a400a5bf0a988fe09521",
      afterSha256:
        "560b721c3e6782bb857561c08e4bcecafedc5dfb0d10fe2649c1a08337b9028c",
      edits: [
        {
          find: "        const local = shared === undefined ? memoMap : Layer.makeMemoMapUnsafe();",
          replace:
            "        const local = shared === undefined ? memoMap : Layer.makeMemoMapUnsafe();\n        const observedLocal = options.observeMemoMap ? options.observeMemoMap(local) : local;",
        },
        {
          find: "buildContext(implementation, node.shared ? memoMap : local, scope)",
          replace:
            "buildContext(implementation, node.shared ? memoMap : observedLocal, scope)",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-j7k7jnd5.js",
      beforeSha256:
        "c6f1fbdaaec903c9c853e831f096997eb7e25e8690a08ec7f4fa365c09962894",
      afterSha256:
        "3c5a4ff2465ba149b313db0ea37ddd717595dca9380098fcae1e097a78dccb4a",
      edits: [
        {
          find: "// src/plugin/supervisor.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/plugin/supervisor.ts',
        },
        {
          find: "operations, install, running) {",
          replace: "operations, install, running, control, handle) {",
        },
        {
          find: "  for (const operation of operations) {",
          replace:
            "  for (const operation of operations) {\n    yield* control.inventorySource(handle, operation);",
        },
        {
          find: "  const registry = yield* Service37;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;\n  const registry = yield* Service37;",
        },
        {
          find: "    const operations = yield* sources.operations();",
          replace:
            "    const operations = yield* sources.operations();\n    yield* control.inventoryPlan(handle, pre, post, operations);",
        },
        {
          find: "resolve(modules, pre, post, operations, false, running)",
          replace:
            "resolve(modules, pre, post, operations, false, running, control, handle)",
        },
        {
          find: "resolve(modules, pre, post, operations, true, running)",
          replace:
            "resolve(modules, pre, post, operations, true, running, control, handle)",
        },
        {
          find: "  const notify = Effect.gen(function* () {",
          replace:
            '  const notify = Effect.gen(function* () {\n    yield* control.inventoryChanged(handle, "plugin_reload");',
        },
        {
          find: "var nodeDeps = [",
          replace: "var nodeDeps = [\n  workbenchControlNode,",
        },
        {
          find: 'internal.pre.map((plugin) => ({ ...plugin, revision: "internal", source: { type: "builtin" } }))',
          replace:
            'internal.pre.map((plugin) => control.inventoryToolCopy(handle, plugin, Object.freeze({ ...plugin, revision: "internal", source: Object.freeze({ type: "builtin" }) })))',
        },
        {
          find: 'const post = internal.post.map((plugin) => ({\n      ...plugin,\n      revision: "internal",\n      source: { type: "builtin" }\n    }));',
          replace:
            'const post = internal.post.map((plugin) => control.inventoryToolCopy(handle, plugin, Object.freeze({\n      ...plugin,\n      revision: "internal",\n      source: Object.freeze({ type: "builtin" })\n    })));',
        },
        {
          find: "plugin.source ? { ...plugin, source: source(plugin.source) } : plugin",
          replace:
            "plugin.source ? control.inventoryToolCopy(handle, plugin, Object.freeze({ ...plugin, source: source(plugin.source) })) : plugin",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-48y8hbvk.js",
      beforeSha256:
        "618d0d178a428d7a7ec96671edefb11f8cf3c811505e7fae56e7c15d6937dcf0",
      afterSha256:
        "9bb5d24ff8c39f29786075a4d5b5443084d41fb8c626385b36b639618f42b350",
      edits: [
        {
          find: "// src/plugin.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/plugin.ts',
        },
        {
          find: "  const bus = yield* Service83;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;\n  const bus = yield* Service83;",
        },
        {
          find: "    const activation = { plugin, scope: yield* Scope.fork(scope) };",
          replace:
            '    const token = yield* control.inventoryBegin(handle, "plugin", plugin.id);\n    const activation = { plugin, scope: yield* Scope.fork(scope) };\n    yield* Scope.addFinalizer(activation.scope, control.inventoryEnd(token, "disposed"));\n    yield* control.inventoryToolActivation(token, plugin, activation.scope).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? Scope.close(activation.scope, exit) : Effect.void));',
        },
        {
          find: "    if (activation.failure || Exit.isSuccess(exit))",
          replace:
            '    yield* (activation.failure || Exit.isFailure(exit) ? control.inventoryEnd(token, "failed") : control.inventoryRegistered(token));\n    if (activation.failure || Exit.isSuccess(exit))',
        },
        {
          find: "    const definitions = plugins.map",
          replace:
            "    yield* control.inventoryActivation(handle, plugins, failures);\n    const definitions = plugins.map",
        },
        {
          find: "    closed = true;",
          replace:
            '    yield* control.inventoryChanged(handle, "plugin_reload");\n    closed = true;',
        },
        {
          find: "  deps: [requirements3]",
          replace: "  deps: [requirements3, workbenchControlNode]",
        },
        {
          find: "const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }));",
          replace:
            "const definitions = plugins.map((plugin) => control.inventoryToolCopy(handle, plugin, Object.freeze({ ...plugin, id: Plugin.ID.make(plugin.id) })));",
        },
        {
          find: "Effect.suspend(() => plugin.effect({ ...host, storage: storage2(kv, plugin.id) })).pipe(grouped, inherit,",
          replace:
            "Effect.suspend(() => plugin.effect({ ...host, storage: storage2(kv, plugin.id) })).pipe(Effect.tap((result) => control.inventoryToolDeclaration(token, plugin, result)), grouped, inherit,",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-5y480sgp.js",
      beforeSha256:
        "0632bbee9e0b05f2ee384845014c062387f9c8e8eeaafcdd98d59aac9e6bc9bf",
      afterSha256:
        "7bae793b1b7944b5f53f307021b695644dc1de045a517b36cba8cb3829cc176a",
      edits: [
        {
          find: "// src/plugin/hooks.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\nimport { observeRegistration } from "../../../../../native-permission-inventory.mjs";\n// src/plugin/hooks.ts',
        },
        {
          find: "  const callbacks = new Map;",
          replace:
            "  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;\n  const callbacks = new Map;",
        },
        {
          find: "return Service61.of({ has, register, trigger });",
          replace:
            'return Service61.of({ has, register: observeRegistration(Effect, Scope, control, handle, "hook", register), trigger });',
        },
        {
          find: "layer, deps: []",
          replace: "layer, deps: [workbenchControlNode]",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-kcmnw9z9.js",
      beforeSha256:
        "80068552355da82bbe3ebe47c0d6e245da552ab51da9a0dfa3232dfd06752974",
      afterSha256:
        "88cc4934252042f796a32d96dda6d93b4eb1d806f64fe393a54f5f271165adba",
      edits: [
        {
          find: "var Plugin37 = {",
          replace:
            'var readDeclarations2 = new WeakSet;\nvar isReadDeclaration2 = (value) => readDeclarations2.has(value);\nvar readDeclaration2 = (reader, access, sessionInstructions, fs, location, alternatePath, missing) => {\n const declaration = Object.freeze({\n      name: name2,\n      options: Object.freeze({ codemode: false }),\n      description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",\n      input: Input2,\n      output: Output,\n      execute: (input, context) => {\n        return Effect.gen(function* () {\n          const read = (target) => reader.read(target.absolute, target.resource, {\n            offset: input.offset,\n            limit: input.limit\n          });\n          const requested = yield* access.authorizeRead(input.path, context);\n          const result = yield* read(requested).pipe(Effect.map((content) => ({ content, target: requested, path: input.path })), Effect.catchIf((error) => error instanceof NotFound2, () => Effect.gen(function* () {\n            const alternate = yield* alternatePath(requested.absolute).pipe(Effect.orElseSucceed(() => {\n              return;\n            }));\n            if (!alternate)\n              return yield* missing(input.path, requested.absolute);\n            const target = yield* access.authorizeRead(alternate, context, { siblingOf: requested });\n            const content = yield* read(target).pipe(Effect.catchIf((error) => error instanceof NotFound2, () => missing(input.path, requested.absolute)));\n            if (content.type === "list-page")\n              return yield* missing(input.path, requested.absolute);\n            return {\n              content,\n              target,\n              path: join(dirname(input.path), basename(alternate))\n            };\n          })));\n          yield* Effect.gen(function* () {\n            if (result.target.externalDirectory !== undefined)\n              return;\n            const resolved = yield* fs.resolve(result.target.absolute);\n            const root = yield* fs.resolve(location.directory);\n            const discovered = yield* fs.up({\n              targets: [FILENAME],\n              start: result.content.type === "list-page" ? resolved : dirname(resolved),\n              stop: root\n            });\n            const candidates = (yield* Effect.forEach(discovered, fs.resolve)).filter((file) => dirname(file) !== root);\n            if (candidates.length === 0)\n              return;\n            yield* sessionInstructions.load({ sessionID: context.sessionID, paths: candidates });\n          }).pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void));\n          if (result.content.type === "file" && result.content.encoding === "base64" && !MEDIA_MIMES2.has(result.content.mime))\n            return yield* Effect.fail(new BinaryFileError2({ resource: result.target.resource }));\n          return { output: result.content, path: result.path };\n        }).pipe(Effect.map((result) => ({\n          output: result.output,\n          content: toModelContent2(result.path, input.offset, result.output),\n          metadata: { truncated: result.output.type === "file" ? false : result.output.truncated }\n        })), Effect.mapError((error) => {\n          if (error instanceof ToolFailure)\n            return error;\n          const message = error instanceof BinaryFileError2 || error instanceof MediaIngestLimitError2 || error instanceof OffsetOutOfRangeError2 || error instanceof PathKindError2 ? error.message : `Unable to read ${input.path}`;\n          return new ToolFailure({ message, error });\n        }));\n      }\n    });\n readDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin37 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name2,\n      options: { codemode: false },\n      description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",\n      input: Input2,\n      output: Output,\n      execute: (input, context) => {\n        return Effect.gen(function* () {\n          const read = (target) => reader.read(target.absolute, target.resource, {\n            offset: input.offset,\n            limit: input.limit\n          });\n          const requested = yield* access.authorizeRead(input.path, context);\n          const result = yield* read(requested).pipe(Effect.map((content) => ({ content, target: requested, path: input.path })), Effect.catchIf((error) => error instanceof NotFound2, () => Effect.gen(function* () {\n            const alternate = yield* alternatePath(requested.absolute).pipe(Effect.orElseSucceed(() => {\n              return;\n            }));\n            if (!alternate)\n              return yield* missing(input.path, requested.absolute);\n            const target = yield* access.authorizeRead(alternate, context, { siblingOf: requested });\n            const content = yield* read(target).pipe(Effect.catchIf((error) => error instanceof NotFound2, () => missing(input.path, requested.absolute)));\n            if (content.type === "list-page")\n              return yield* missing(input.path, requested.absolute);\n            return {\n              content,\n              target,\n              path: join(dirname(input.path), basename(alternate))\n            };\n          })));\n          yield* Effect.gen(function* () {\n            if (result.target.externalDirectory !== undefined)\n              return;\n            const resolved = yield* fs.resolve(result.target.absolute);\n            const root = yield* fs.resolve(location.directory);\n            const discovered = yield* fs.up({\n              targets: [FILENAME],\n              start: result.content.type === "list-page" ? resolved : dirname(resolved),\n              stop: root\n            });\n            const candidates = (yield* Effect.forEach(discovered, fs.resolve)).filter((file) => dirname(file) !== root);\n            if (candidates.length === 0)\n              return;\n            yield* sessionInstructions.load({ sessionID: context.sessionID, paths: candidates });\n          }).pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void));\n          if (result.content.type === "file" && result.content.encoding === "base64" && !MEDIA_MIMES2.has(result.content.mime))\n            return yield* Effect.fail(new BinaryFileError2({ resource: result.target.resource }));\n          return { output: result.content, path: result.path };\n        }).pipe(Effect.map((result) => ({\n          output: result.output,\n          content: toModelContent2(result.path, input.offset, result.output),\n          metadata: { truncated: result.output.type === "file" ? false : result.output.truncated }\n        })), Effect.mapError((error) => {\n          if (error instanceof ToolFailure)\n            return error;\n          const message = error instanceof BinaryFileError2 || error instanceof MediaIngestLimitError2 || error instanceof OffsetOutOfRangeError2 || error instanceof PathKindError2 ? error.message : `Unable to read ${input.path}`;\n          return new ToolFailure({ message, error });\n        }));\n      }\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = readDeclaration2(reader, access, sessionInstructions, fs, location, (...args) => alternatePath(...args), (...args) => missing(...args));",
        },
        {
          find: "export { name2, Input2, Plugin37, toModelContent2, exports_read };",
          replace:
            "export { readDeclaration2, isReadDeclaration2, name2, Input2, Plugin37, toModelContent2, exports_read };",
        },
        {
          find: "    });\n  })\n};\nvar toModelContent2 =",
          replace:
            "    });\n    return declaration;\n  })\n};\nObject.freeze(Plugin37);\nvar toModelContent2 =",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-8t2s61hj.js",
      beforeSha256:
        "dc829fc3193e71713caec7b0c94915afefc1c398c6c92049d9651b8cffa1b802",
      afterSha256:
        "05294feaf20fb38710fb291aa92cc0efcac94c1528e2b3edc759721c56fcac50",
      edits: [
        {
          find: "// src/plugin/internal.ts",
          replace:
            'import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n// src/plugin/internal.ts',
        },
        {
          find: 'import { Context, Effect } from "effect";',
          replace: 'import { Context, Effect, Scope } from "effect";',
        },
        {
          find: "var requirements2 = LayerNode.group([",
          replace:
            "var requirements2 = LayerNode.group([\n  workbenchControlNode,",
        },
        {
          find: "  const context = Context.pick(...services)(yield* Effect.context());\n  const resolve = (plugins) => plugins.map((plugin) => ({\n    id: plugin.id,\n    effect: (host) => plugin.effect(host).pipe(Effect.provide(context))\n  }));\n  return {\n    pre: resolve(pre),\n    post: resolve(post)\n  };",
          replace:
            "  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;\n  const context = Context.pick(...services)(yield* Effect.context());\n  const resolve = (plugins) => Effect.forEach(plugins, (plugin) => Effect.gen(function* () {\n    const effect = plugin.effect;\n    const resolved = Object.freeze({\n      id: plugin.id,\n      effect: (host) => Effect.gen(function* () {\n        const activationScope = yield* Scope.Scope;\n        const result = yield* effect(host).pipe(Effect.provide(context));\n        yield* control.inventoryToolResult(handle, resolved, result, activationScope);\n        return result;\n      })\n    });\n    return yield* control.inventoryToolResolve(handle, plugin, resolved);\n  }));\n  return { pre: yield* resolve(pre), post: yield* resolve(post) };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-s0ehs66p.js",
      beforeSha256:
        "9a7cb24c50f09a3d07eca739a556f609fe2790016d06c3d352e441781a0f1186",
      afterSha256:
        "a80d330b5f670eb45202a876b8c7ab8782f796f636197095bbed2c9524fcf338",
      edits: [
        {
          find: "  const root = yield* fs.resolve(location.project.directory);\n",
          replace: "  // Resolve root only inside the original load task.\n",
        },
        {
          find: "    yield* Effect.gen(function* () {\n      const alreadyInjected = yield* previouslyInjected(store, input.sessionID);",
          replace:
            "    yield* Effect.gen(function* () {\n      const root = yield* fs.resolve(location.project.directory);\n      const alreadyInjected = yield* previouslyInjected(store, input.sessionID);",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-fcxyj98j.js",
      beforeSha256:
        "0ca34f434362b7a2598849e7f4b5614be97f118a04408b4cad2100a1e0875317",
      afterSha256:
        "ff9addaaa4a3d54af2937c82c3fa80fac57b0709fe9e2238458face0e9c3b88c",
      edits: [
        {
          find: "var Plugin51 = {",
          replace:
            'var questionDeclarations2 = new WeakSet;\nvar isQuestionDeclaration2 = (value) => questionDeclarations2.has(value);\nvar questionDeclaration2 = (forms, permission) => {\n const declaration = Object.freeze({\n      name: name14,\n      options: Object.freeze({ codemode: false }),\n      description: description6,\n      input: Input14,\n      output: Output9,\n      execute: (input, context) => permission.assert({\n        action: "question",\n        resources: ["*"],\n        sessionID: context.sessionID,\n        agent: context.agent,\n        source: { type: "tool", messageID: context.messageID, id: context.id }\n      }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })), Effect.andThen(forms.ask({\n        sessionID: context.sessionID,\n        title: "Questions",\n        metadata: {\n          kind: "question",\n          tool: { messageID: context.messageID, id: context.id }\n        },\n        fields: [\n          toField(input.questions[0], 0),\n          ...input.questions.slice(1).map((question, index) => toField(question, index + 1))\n        ]\n      }).pipe(Effect.orDie)), Effect.flatMap((state) => {\n        if (state.status === "cancelled")\n          return Effect.die(new CancelledError2);\n        const output = {\n          answers: input.questions.map((_, index) => {\n            const value = state.answer[`q${index}`];\n            if (value === undefined)\n              return [];\n            if (typeof value === "object")\n              return Array.from(value);\n            return [String(value)];\n          })\n        };\n        return Effect.succeed({\n          output,\n          content: toModelContent7(input.questions, output.answers),\n          metadata: { answers: output.answers }\n        });\n      }))\n    });\n questionDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin51 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name14,\n      options: { codemode: false },\n      description: description6,\n      input: Input14,\n      output: Output9,\n      execute: (input, context) => permission.assert({\n        action: "question",\n        resources: ["*"],\n        sessionID: context.sessionID,\n        agent: context.agent,\n        source: { type: "tool", messageID: context.messageID, id: context.id }\n      }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })), Effect.andThen(forms.ask({\n        sessionID: context.sessionID,\n        title: "Questions",\n        metadata: {\n          kind: "question",\n          tool: { messageID: context.messageID, id: context.id }\n        },\n        fields: [\n          toField(input.questions[0], 0),\n          ...input.questions.slice(1).map((question, index) => toField(question, index + 1))\n        ]\n      }).pipe(Effect.orDie)), Effect.flatMap((state) => {\n        if (state.status === "cancelled")\n          return Effect.die(new CancelledError2);\n        const output = {\n          answers: input.questions.map((_, index) => {\n            const value = state.answer[`q${index}`];\n            if (value === undefined)\n              return [];\n            if (typeof value === "object")\n              return Array.from(value);\n            return [String(value)];\n          })\n        };\n        return Effect.succeed({\n          output,\n          content: toModelContent7(input.questions, output.answers),\n          metadata: { answers: output.answers }\n        });\n      }))\n    })).pipe(Effect.orDie);',
          replace: "    return questionDeclaration2(forms, permission);",
        },
        {
          find: "\n  })\n};",
          replace: "\n  })\n};\nObject.freeze(Plugin51);",
        },
        {
          find: "export { name14, description6, Input14, Output9, CancelledError2, toModelContent7, Plugin51, exports_question };",
          replace:
            "export { questionDeclaration2, isQuestionDeclaration2, name14, description6, Input14, Output9, CancelledError2, toModelContent7, Plugin51, exports_question };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-ec87pa6m.js",
      beforeSha256:
        "d3cd19fc3d179442a6371f0b0f385ae3207287f98387552f05de4a6592a81980",
      afterSha256:
        "89c41f82e499eea0fc82598dfdc4453ff41133043d3dbcc24086b5f0686cb0b6",
      edits: [
        {
          find: "var Plugin38 = {",
          replace:
            'var globDeclarations2 = new WeakSet;\nvar isGlobDeclaration2 = (value) => globDeclarations2.has(value);\nvar globDeclaration2 = (environment, ripgrep, location, access, permission) => {\n const declaration = Object.freeze({\n      name: name3,\n      options: Object.freeze({ codemode: false }),\n      description: \'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").\',\n      input: Input3,\n      output: Output2,\n      execute: (input, context) => Effect.gen(function* () {\n        const searchPath = input.path === "undefined" || input.path === "null" ? undefined : input.path;\n        const source = { type: "tool", messageID: context.messageID, id: context.id };\n        const target = yield* access.resolve({ path: searchPath ?? ".", kind: "directory" });\n        yield* access.authorizeExternal([target], context);\n        yield* permission.assert({\n          action: name3,\n          resources: [input.pattern],\n          save: ["*"],\n          metadata: {\n            root: searchPath ?? ".",\n            path: searchPath,\n            hidden: input.hidden,\n            limit: input.limit\n          },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const type = yield* typeFollowing2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `Search path does not exist: ${searchPath ?? "."}` }))));\n        if (type !== "directory")\n          return yield* Effect.fail(new ToolFailure({ message: `Search path is not a directory: ${searchPath ?? "."}` }));\n        const root = target.absolute;\n        const limit = input.limit ?? DEFAULT_SEARCH_LIMIT2;\n        const entries = yield* ripgrep.glob({\n          cwd: root,\n          pattern: input.pattern,\n          hidden: input.hidden,\n          limit: limit + 1\n        }).pipe(Effect.timeoutOrElse({\n          duration: DEFAULT_SEARCH_TIMEOUT_MS2,\n          orElse: () => Effect.fail(new ToolFailure({\n            message: `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS2 / 1000} seconds. Consider using a more specific path or pattern.`\n          }))\n        }), Effect.map((result) => result.map((entry) => Entry4.make({\n          ...entry,\n          path: RelativePath2.make(path.relative(location.directory, path.resolve(root, entry.path)))\n        }))));\n        return { entries: entries.slice(0, limit), truncated: entries.length > limit };\n      }).pipe(Effect.map((result) => ({\n        output: result.entries,\n        content: toModelContent3(result.entries.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })), result.truncated),\n        metadata: { count: result.entries.length, truncated: result.truncated }\n      })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to find files matching ${input.pattern}`, error })))\n    });\n globDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin38 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name3,\n      options: { codemode: false },\n      description: \'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").\',\n      input: Input3,\n      output: Output2,\n      execute: (input, context) => Effect.gen(function* () {\n        const searchPath = input.path === "undefined" || input.path === "null" ? undefined : input.path;\n        const source = { type: "tool", messageID: context.messageID, id: context.id };\n        const target = yield* access.resolve({ path: searchPath ?? ".", kind: "directory" });\n        yield* access.authorizeExternal([target], context);\n        yield* permission.assert({\n          action: name3,\n          resources: [input.pattern],\n          save: ["*"],\n          metadata: {\n            root: searchPath ?? ".",\n            path: searchPath,\n            hidden: input.hidden,\n            limit: input.limit\n          },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const type = yield* typeFollowing2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `Search path does not exist: ${searchPath ?? "."}` }))));\n        if (type !== "directory")\n          return yield* Effect.fail(new ToolFailure({ message: `Search path is not a directory: ${searchPath ?? "."}` }));\n        const root = target.absolute;\n        const limit = input.limit ?? DEFAULT_SEARCH_LIMIT2;\n        const entries = yield* ripgrep.glob({\n          cwd: root,\n          pattern: input.pattern,\n          hidden: input.hidden,\n          limit: limit + 1\n        }).pipe(Effect.timeoutOrElse({\n          duration: DEFAULT_SEARCH_TIMEOUT_MS2,\n          orElse: () => Effect.fail(new ToolFailure({\n            message: `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS2 / 1000} seconds. Consider using a more specific path or pattern.`\n          }))\n        }), Effect.map((result) => result.map((entry) => Entry4.make({\n          ...entry,\n          path: RelativePath2.make(path.relative(location.directory, path.resolve(root, entry.path)))\n        }))));\n        return { entries: entries.slice(0, limit), truncated: entries.length > limit };\n      }).pipe(Effect.map((result) => ({\n        output: result.entries,\n        content: toModelContent3(result.entries.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })), result.truncated),\n        metadata: { count: result.entries.length, truncated: result.truncated }\n      })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to find files matching ${input.pattern}`, error })))\n    })).pipe(Effect.orDie);',
          replace:
            "    return globDeclaration2(environment, ripgrep, location, access, permission);",
        },
        {
          find: "\n  })\n};",
          replace: "\n  })\n};\nObject.freeze(Plugin38);",
        },
        {
          find: "export { name3, Input3, Output2, toModelContent3, Plugin38, exports_glob };",
          replace:
            "export { globDeclaration2, isGlobDeclaration2, name3, Input3, Output2, toModelContent3, Plugin38, exports_glob };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-e661jwrm.js",
      beforeSha256:
        "63ef4cf89a3e7e2d1b3d697259d528de1c429558e3c986dfe060471ccb97f7fd",
      afterSha256:
        "48c253ef182349f8442d03c257c77c4cd3ce23dbbfe6c53054345a1cb4b97516",
      edits: [
        {
          find: "var Plugin50 = {",
          replace:
            'var grepDeclarations2 = new WeakSet;\nvar isGrepDeclaration2 = (value) => grepDeclarations2.has(value);\nvar grepDeclaration2 = (environment, ripgrep, location, access, permission) => {\n const declaration = Object.freeze({\n      name: name12,\n      options: Object.freeze({ codemode: false }),\n      description: "Search file contents using ripgrep\'s regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",\n      input: Input12,\n      output: Output8,\n      execute: (input, context) => Effect.gen(function* () {\n        const source = { type: "tool", messageID: context.messageID, id: context.id };\n        const target = yield* access.resolve({ path: input.path ?? "." });\n        yield* access.authorizeExternal([target], context);\n        yield* permission.assert({\n          action: name12,\n          resources: [input.pattern],\n          save: ["*"],\n          metadata: {\n            root: ".",\n            path: input.path,\n            include: input.include,\n            literal: input.literal,\n            caseSensitive: input.caseSensitive,\n            limit: input.limit\n          },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const root = target.absolute;\n        const type = yield* typeFollowing2(environment.files, root).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` }))));\n        const cwd = type === "directory" ? root : path.dirname(root);\n        const limit = input.limit ?? DEFAULT_SEARCH_LIMIT2;\n        const matches = yield* ripgrep.grep({\n          cwd,\n          pattern: input.pattern,\n          file: type === "file" ? path.basename(root) : undefined,\n          include: input.include,\n          literal: input.literal,\n          caseSensitive: input.caseSensitive,\n          limit: limit + 1\n        }).pipe(Effect.timeoutOrElse({\n          duration: DEFAULT_SEARCH_TIMEOUT_MS2,\n          orElse: () => Effect.fail(new ToolFailure({\n            message: `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS2 / 1000} seconds. Consider using a more specific path or pattern.`\n          }))\n        }), Effect.map((result) => result.map((match) => Match2.make({\n          ...match,\n          entry: Entry4.make({\n            ...match.entry,\n            path: RelativePath2.make(path.relative(location.directory, path.resolve(cwd, match.entry.path)))\n          })\n        }))));\n        return { matches: matches.slice(0, limit), truncated: matches.length > limit };\n      }).pipe(Effect.map((result) => ({\n        output: result.matches,\n        content: toModelContent6(result.matches.map((match) => ({\n          ...match,\n          entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) }\n        })), result.truncated),\n        metadata: { matches: result.matches.length, truncated: result.truncated }\n      })), Effect.mapError((error) => error instanceof ToolFailure ? error : error instanceof InvalidPatternError2 ? new ToolFailure({ message: `Invalid regex pattern: ${error.message}` }) : new ToolFailure({ message: `Unable to grep for ${input.pattern}`, error })))\n    });\n grepDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin50 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name12,\n      options: { codemode: false },\n      description: "Search file contents using ripgrep\'s regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",\n      input: Input12,\n      output: Output8,\n      execute: (input, context) => Effect.gen(function* () {\n        const source = { type: "tool", messageID: context.messageID, id: context.id };\n        const target = yield* access.resolve({ path: input.path ?? "." });\n        yield* access.authorizeExternal([target], context);\n        yield* permission.assert({\n          action: name12,\n          resources: [input.pattern],\n          save: ["*"],\n          metadata: {\n            root: ".",\n            path: input.path,\n            include: input.include,\n            literal: input.literal,\n            caseSensitive: input.caseSensitive,\n            limit: input.limit\n          },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const root = target.absolute;\n        const type = yield* typeFollowing2(environment.files, root).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` }))));\n        const cwd = type === "directory" ? root : path.dirname(root);\n        const limit = input.limit ?? DEFAULT_SEARCH_LIMIT2;\n        const matches = yield* ripgrep.grep({\n          cwd,\n          pattern: input.pattern,\n          file: type === "file" ? path.basename(root) : undefined,\n          include: input.include,\n          literal: input.literal,\n          caseSensitive: input.caseSensitive,\n          limit: limit + 1\n        }).pipe(Effect.timeoutOrElse({\n          duration: DEFAULT_SEARCH_TIMEOUT_MS2,\n          orElse: () => Effect.fail(new ToolFailure({\n            message: `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS2 / 1000} seconds. Consider using a more specific path or pattern.`\n          }))\n        }), Effect.map((result) => result.map((match) => Match2.make({\n          ...match,\n          entry: Entry4.make({\n            ...match.entry,\n            path: RelativePath2.make(path.relative(location.directory, path.resolve(cwd, match.entry.path)))\n          })\n        }))));\n        return { matches: matches.slice(0, limit), truncated: matches.length > limit };\n      }).pipe(Effect.map((result) => ({\n        output: result.matches,\n        content: toModelContent6(result.matches.map((match) => ({\n          ...match,\n          entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) }\n        })), result.truncated),\n        metadata: { matches: result.matches.length, truncated: result.truncated }\n      })), Effect.mapError((error) => error instanceof ToolFailure ? error : error instanceof InvalidPatternError2 ? new ToolFailure({ message: `Invalid regex pattern: ${error.message}` }) : new ToolFailure({ message: `Unable to grep for ${input.pattern}`, error })))\n    })).pipe(Effect.orDie);',
          replace:
            "    return grepDeclaration2(environment, ripgrep, location, access, permission);",
        },
        {
          find: "\n  })\n};",
          replace: "\n  })\n};\nObject.freeze(Plugin50);",
        },
        {
          find: "export { name12, Input12, Output8, toModelContent6, Plugin50, exports_grep };",
          replace:
            "export { grepDeclaration2, isGrepDeclaration2, name12, Input12, Output8, toModelContent6, Plugin50, exports_grep };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-ym52mge9.js",
      beforeSha256:
        "ddcfa3ec00066bee8de602338b89add4a1683b71fa8f577accce996000b14f57",
      afterSha256:
        "098985e5a0eec841ef288fbff21a801e52a1fef1130d3a9502e3356934cfe0d3",
      edits: [
        {
          find: "var Plugin44 = {",
          replace:
            'var skillDeclarations2 = new WeakSet;\nvar isSkillDeclaration2 = (value) => skillDeclarations2.has(value);\nvar skillDeclaration2 = (fs, skills, permission) => {\n const declaration = Object.freeze({\n      name: name8,\n      options: Object.freeze({ codemode: false }),\n      description: description3,\n      input: Input8,\n      output: Output5,\n      execute: (input, context) => Effect.gen(function* () {\n        const skill = yield* skills.get(input.id);\n        if (!skill)\n          return yield* unableToLoad(input.id);\n        return yield* Effect.gen(function* () {\n          yield* permission.assert({\n            action: name8,\n            resources: [skill.id],\n            save: [skill.id],\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          return { name: skill.name, ...yield* prepare3(fs, skill) };\n        }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)));\n      }).pipe(Effect.map((output) => ({\n        output,\n        content: output.output,\n        metadata: { name: output.name, directory: output.directory }\n      })))\n    });\n skillDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin44 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name8,\n      options: { codemode: false },\n      description: description3,\n      input: Input8,\n      output: Output5,\n      execute: (input, context) => Effect.gen(function* () {\n        const skill = yield* skills.get(input.id);\n        if (!skill)\n          return yield* unableToLoad(input.id);\n        return yield* Effect.gen(function* () {\n          yield* permission.assert({\n            action: name8,\n            resources: [skill.id],\n            save: [skill.id],\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          return { name: skill.name, ...yield* prepare3(fs, skill) };\n        }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)));\n      }).pipe(Effect.map((output) => ({\n        output,\n        content: output.output,\n        metadata: { name: output.name, directory: output.directory }\n      })))\n    })).pipe(Effect.orDie);',
          replace: "    return skillDeclaration2(fs, skills, permission);",
        },
        {
          find: "\n  })\n};",
          replace: "\n  })\n};\nObject.freeze(Plugin44);",
        },
        {
          find: "export { name8, Input8, Output5, description3, toModelOutput2, Plugin44, exports_skill3 };",
          replace:
            "export { skillDeclaration2, isSkillDeclaration2, name8, Input8, Output5, description3, toModelOutput2, Plugin44, exports_skill3 };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-4xsr0mw7.js",
      beforeSha256:
        "169ec515b2cda2813937ff559cf98ef226603145c5d1308ed4f778fd5ffd491e",
      afterSha256:
        "12a72db159099d3c9894fd09fdaa9ccca4cf89bebf3fb8230d0825a20154bf6f",
      edits: [
        {
          find: "var Plugin43 = {",
          replace:
            'var webfetchDeclarations2 = new WeakSet;\nvar isWebfetchDeclaration2 = (value) => webfetchDeclarations2.has(value);\nvar webfetchDeclaration2 = (http, permission) => {\n const declaration = Object.freeze({\n      name: name7,\n      options: Object.freeze({ codemode: false }),\n      description: description2,\n      input: Input7,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        yield* Effect.try({\n          try: () => assertHttpUrl(new URL(input.url)),\n          catch: (error) => error\n        });\n        yield* permission.assert({\n          action: name7,\n          resources: [input.url],\n          save: ["*"],\n          metadata: input,\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: { type: "tool", messageID: context.messageID, id: context.id }\n        });\n        const { body, contentType } = yield* Effect.gen(function* () {\n          const response = yield* execute(http, input.url, input.format).pipe(Effect.catchIf(isCloudflareChallenge, () => execute(http, input.url, input.format, "opencode")));\n          const contentType = response.headers["content-type"] || "";\n          const mime = mimeFrom(contentType);\n          if (isImageAttachment(mime))\n            return yield* Effect.fail(new Error(`Unsupported fetched image content type: ${mime}`));\n          if (!isTextualMime(mime))\n            return yield* Effect.fail(new Error(`Unsupported fetched file content type: ${mime}`));\n          return { body: yield* collectBody(response), contentType };\n        }).pipe(Effect.timeoutOrElse({\n          duration: Duration.seconds(input.timeout ?? DEFAULT_TIMEOUT_SECONDS2),\n          orElse: () => Effect.fail(new Error("Request timed out"))\n        }));\n        const content = new TextDecoder().decode(body);\n        const output = yield* Effect.try({\n          try: () => convert(content, contentType, input.format),\n          catch: (error) => error\n        });\n        const result = {\n          url: input.url,\n          contentType,\n          format: input.format,\n          output\n        };\n        return { output: result, content: result.output, metadata: { contentType: result.contentType } };\n      }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to fetch ${input.url}`, error })))\n    });\n webfetchDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin43 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name7,\n      options: { codemode: false },\n      description: description2,\n      input: Input7,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        yield* Effect.try({\n          try: () => assertHttpUrl(new URL(input.url)),\n          catch: (error) => error\n        });\n        yield* permission.assert({\n          action: name7,\n          resources: [input.url],\n          save: ["*"],\n          metadata: input,\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: { type: "tool", messageID: context.messageID, id: context.id }\n        });\n        const { body, contentType } = yield* Effect.gen(function* () {\n          const response = yield* execute(http, input.url, input.format).pipe(Effect.catchIf(isCloudflareChallenge, () => execute(http, input.url, input.format, "opencode")));\n          const contentType = response.headers["content-type"] || "";\n          const mime = mimeFrom(contentType);\n          if (isImageAttachment(mime))\n            return yield* Effect.fail(new Error(`Unsupported fetched image content type: ${mime}`));\n          if (!isTextualMime(mime))\n            return yield* Effect.fail(new Error(`Unsupported fetched file content type: ${mime}`));\n          return { body: yield* collectBody(response), contentType };\n        }).pipe(Effect.timeoutOrElse({\n          duration: Duration.seconds(input.timeout ?? DEFAULT_TIMEOUT_SECONDS2),\n          orElse: () => Effect.fail(new Error("Request timed out"))\n        }));\n        const content = new TextDecoder().decode(body);\n        const output = yield* Effect.try({\n          try: () => convert(content, contentType, input.format),\n          catch: (error) => error\n        });\n        const result = {\n          url: input.url,\n          contentType,\n          format: input.format,\n          output\n        };\n        return { output: result, content: result.output, metadata: { contentType: result.contentType } };\n      }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to fetch ${input.url}`, error })))\n    })).pipe(Effect.orDie);',
          replace: "    return webfetchDeclaration2(http, permission);",
        },
        {
          find: "\n  })\n};",
          replace: "\n  })\n};\nObject.freeze(Plugin43);",
        },
        {
          find: "export { name7, MAX_RESPONSE_BYTES3, DEFAULT_TIMEOUT_SECONDS2, MAX_TIMEOUT_SECONDS2, description2, Input7, Plugin43, extractTextFromHTML2, exports_webfetch };",
          replace:
            "export { webfetchDeclaration2, isWebfetchDeclaration2, name7, MAX_RESPONSE_BYTES3, DEFAULT_TIMEOUT_SECONDS2, MAX_TIMEOUT_SECONDS2, description2, Input7, Plugin43, extractTextFromHTML2, exports_webfetch };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-04zc2vp5.js",
      beforeSha256:
        "9587254b3d400ae332f6c358038a4886dbfc42c887c20776a13e089036e26989",
      afterSha256:
        "4d3f044949df287386f4663597af4e4f0e4356e64794a3f0b18270c99fea7e88",
      edits: [
        {
          find: "var Plugin39 = {",
          replace:
            'var editDeclarations2 = new WeakSet;\nvar isEditDeclaration2 = (value) => editDeclarations2.has(value);\nvar editDeclaration2 = (access, fileMutation, environment, formatter, location, permission) => {\n const declaration = Object.freeze({\n      name: name4,\n      options: Object.freeze({ codemode: false, permission: "edit" }),\n      description: "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",\n      input: Input4,\n      output: Output3,\n      execute: (input, context) => {\n        return Effect.gen(function* () {\n          const permissionSource = {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          };\n          if (input.oldString === input.newString) {\n            return yield* new ToolFailure({\n              message: "No changes to apply: oldString and newString are identical."\n            });\n          }\n          if (input.oldString === "") {\n            return yield* new ToolFailure({\n              message: "oldString must not be empty. Use write to create or overwrite a file."\n            });\n          }\n          const target = yield* access.resolve({ path: input.path, kind: "file" });\n          yield* access.authorizeExternal([target], context);\n          const original = yield* readText2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` }))), Effect.catchTag("Environment.WrongKind", (error) => error.actual === "directory" ? Effect.fail(new ToolFailure({ message: `Path is a directory, not a file: ${input.path}` })) : Effect.fail(new ToolFailure({ message: `Unable to edit ${input.path}`, error }))));\n          const source = original.text;\n          const ending = source.includes(crlf) ? crlf : `\n`;\n          const oldString = input.oldString.replaceAll(crlf, `\n`).replaceAll(`\n`, ending);\n          const newString = input.newString.replaceAll(crlf, `\n`).replaceAll(`\n`, ending);\n          const exact = findOccurrences(source, oldString);\n          const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(source), normalizeForMatch(oldString));\n          const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(source, oldString);\n          const matches = exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing;\n          const replacements = matches.length;\n          const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1)).toReversed().reduce((content, match) => `${content.slice(0, match.start)}${newString}${content.slice(match.end)}`, source);\n          const preview = replacements > 0 && (replacements === 1 || input.replaceAll === true) ? fileDiff2(target.resource, source, replaced) : undefined;\n          yield* permission.assert({\n            action: "edit",\n            resources: [target.resource],\n            save: ["*"],\n            metadata: preview ? { files: [preview] } : undefined,\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: permissionSource\n          });\n          if (replacements === 0) {\n            return yield* new ToolFailure({\n              message: `Could not find oldString in ${input.path}. It must match exactly, including whitespace and indentation.`\n            });\n          }\n          if (replacements > 1 && input.replaceAll !== true) {\n            return yield* new ToolFailure({\n              message: `Found ${replacements} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.`\n            });\n          }\n          const replacementBom = replaced.startsWith("\\uFEFF");\n          const result = yield* fileMutation.write({\n            target,\n            content: Bom.join(replaced, original.bom || replacementBom)\n          });\n          const bom = original.bom || replacementBom;\n          const formatted = (yield* formatter.file(target.absolute)) ? yield* syncTextBom2(environment.files, target.absolute, bom) : (yield* readText2(environment.files, target.absolute)).text;\n          return {\n            files: [fileDiff2(result.resource, source, formatted)],\n            replacements\n          };\n        }).pipe(fileMutation.withLock([resolvePath2(location.directory, input.path)]), Effect.map((output) => ({\n          output,\n          content: `Edited ${output.files[0]?.file} (${output.replacements} replacement${output.replacements === 1 ? "" : "s"})`,\n          metadata: { files: output.files }\n        })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to edit ${input.path}`, error })));\n      }\n    });\n editDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin39 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name4,\n      options: { codemode: false, permission: "edit" },\n      description: "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",\n      input: Input4,\n      output: Output3,\n      execute: (input, context) => {\n        return Effect.gen(function* () {\n          const permissionSource = {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          };\n          if (input.oldString === input.newString) {\n            return yield* new ToolFailure({\n              message: "No changes to apply: oldString and newString are identical."\n            });\n          }\n          if (input.oldString === "") {\n            return yield* new ToolFailure({\n              message: "oldString must not be empty. Use write to create or overwrite a file."\n            });\n          }\n          const target = yield* access.resolve({ path: input.path, kind: "file" });\n          yield* access.authorizeExternal([target], context);\n          const original = yield* readText2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` }))), Effect.catchTag("Environment.WrongKind", (error) => error.actual === "directory" ? Effect.fail(new ToolFailure({ message: `Path is a directory, not a file: ${input.path}` })) : Effect.fail(new ToolFailure({ message: `Unable to edit ${input.path}`, error }))));\n          const source = original.text;\n          const ending = source.includes(crlf) ? crlf : `\n`;\n          const oldString = input.oldString.replaceAll(crlf, `\n`).replaceAll(`\n`, ending);\n          const newString = input.newString.replaceAll(crlf, `\n`).replaceAll(`\n`, ending);\n          const exact = findOccurrences(source, oldString);\n          const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(source), normalizeForMatch(oldString));\n          const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(source, oldString);\n          const matches = exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing;\n          const replacements = matches.length;\n          const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1)).toReversed().reduce((content, match) => `${content.slice(0, match.start)}${newString}${content.slice(match.end)}`, source);\n          const preview = replacements > 0 && (replacements === 1 || input.replaceAll === true) ? fileDiff2(target.resource, source, replaced) : undefined;\n          yield* permission.assert({\n            action: "edit",\n            resources: [target.resource],\n            save: ["*"],\n            metadata: preview ? { files: [preview] } : undefined,\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: permissionSource\n          });\n          if (replacements === 0) {\n            return yield* new ToolFailure({\n              message: `Could not find oldString in ${input.path}. It must match exactly, including whitespace and indentation.`\n            });\n          }\n          if (replacements > 1 && input.replaceAll !== true) {\n            return yield* new ToolFailure({\n              message: `Found ${replacements} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.`\n            });\n          }\n          const replacementBom = replaced.startsWith("\\uFEFF");\n          const result = yield* fileMutation.write({\n            target,\n            content: Bom.join(replaced, original.bom || replacementBom)\n          });\n          const bom = original.bom || replacementBom;\n          const formatted = (yield* formatter.file(target.absolute)) ? yield* syncTextBom2(environment.files, target.absolute, bom) : (yield* readText2(environment.files, target.absolute)).text;\n          return {\n            files: [fileDiff2(result.resource, source, formatted)],\n            replacements\n          };\n        }).pipe(fileMutation.withLock([resolvePath2(location.directory, input.path)]), Effect.map((output) => ({\n          output,\n          content: `Edited ${output.files[0]?.file} (${output.replacements} replacement${output.replacements === 1 ? "" : "s"})`,\n          metadata: { files: output.files }\n        })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to edit ${input.path}`, error })));\n      }\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = editDeclaration2(access, fileMutation, environment, formatter, location, permission);",
        },
        {
          find: "\n  })\n};",
          replace:
            "\n    return declaration;\n  })\n};\nObject.freeze(Plugin39);",
        },
        {
          find: "export { name4, Input4, Output3, Plugin39, exports_edit };",
          replace:
            "export { editDeclaration2, isEditDeclaration2, name4, Input4, Output3, Plugin39, exports_edit };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-5m3ds5v3.js",
      beforeSha256:
        "25900de0d0c03cfbc001844a6ff2e26ef7b834a3808bf90990d489d8f3b909ac",
      afterSha256:
        "37899189440fb3491233b3fb13830be7b760e7e5d2bcaa3749039b90d6b2c1c7",
      edits: [
        {
          find: "var Plugin42 = {",
          replace:
            'var writeDeclarations2 = new WeakSet;\nvar isWriteDeclaration2 = (value) => writeDeclarations2.has(value);\nvar writeDeclaration2 = (access, fileMutation, environment, formatter, permission) => {\n const declaration = Object.freeze({\n      name: name6,\n      options: Object.freeze({ codemode: false, permission: "edit" }),\n      description: `Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.`,\n      input: Input6,\n      output: Output4,\n      execute: (input, context) => Effect.gen(function* () {\n        const source = {\n          type: "tool",\n          messageID: context.messageID,\n          id: context.id\n        };\n        const target = yield* access.resolve({ path: input.path, kind: "file" });\n        yield* access.authorizeExternal([target], context);\n        const current = yield* readText2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined));\n        const next = Bom.split(input.content);\n        const preview = fileDiff2(target.resource, current?.text ?? "", next.text, current ? "modified" : "added");\n        yield* permission.assert({\n          action: "edit",\n          resources: [target.resource],\n          save: ["*"],\n          metadata: { files: [preview] },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const result = yield* fileMutation.writeTextPreservingBom({ target, content: input.content });\n        const bom = (yield* readText2(environment.files, target.absolute)).bom;\n        if (yield* formatter.file(target.absolute)) {\n          yield* syncTextBom2(environment.files, target.absolute, bom);\n        }\n        return result;\n      }).pipe(Effect.map((output) => ({ output, content: toModelContent4(output) })), Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })))\n    });\n writeDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin42 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name6,\n      options: { codemode: false, permission: "edit" },\n      description: `Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.`,\n      input: Input6,\n      output: Output4,\n      execute: (input, context) => Effect.gen(function* () {\n        const source = {\n          type: "tool",\n          messageID: context.messageID,\n          id: context.id\n        };\n        const target = yield* access.resolve({ path: input.path, kind: "file" });\n        yield* access.authorizeExternal([target], context);\n        const current = yield* readText2(environment.files, target.absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined));\n        const next = Bom.split(input.content);\n        const preview = fileDiff2(target.resource, current?.text ?? "", next.text, current ? "modified" : "added");\n        yield* permission.assert({\n          action: "edit",\n          resources: [target.resource],\n          save: ["*"],\n          metadata: { files: [preview] },\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source\n        });\n        const result = yield* fileMutation.writeTextPreservingBom({ target, content: input.content });\n        const bom = (yield* readText2(environment.files, target.absolute)).bom;\n        if (yield* formatter.file(target.absolute)) {\n          yield* syncTextBom2(environment.files, target.absolute, bom);\n        }\n        return result;\n      }).pipe(Effect.map((output) => ({ output, content: toModelContent4(output) })), Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })))\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = writeDeclaration2(access, fileMutation, environment, formatter, permission);",
        },
        {
          find: "\n  })\n};",
          replace:
            "\n    return declaration;\n  })\n};\nObject.freeze(Plugin42);",
        },
        {
          find: "export { name6, Input6, Output4, toModelContent4, Plugin42, exports_write };",
          replace:
            "export { writeDeclaration2, isWriteDeclaration2, name6, Input6, Output4, toModelContent4, Plugin42, exports_write };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-8f36rj9w.js",
      beforeSha256:
        "4cfbad9b1b79a35f8996501401ed8229036536a8c4a533451b295a052293fcb6",
      afterSha256:
        "1ad29b2598de1974aa611852f12de78852b73b977c412c5f41d7066dd93c9d36",
      edits: [
        {
          find: "var Plugin46 = {",
          replace:
            'var patchDeclarations2 = new WeakSet;\nvar isPatchDeclaration2 = (value) => patchDeclarations2.has(value);\nvar patchDeclaration2 = (environment, access, fileMutation, formatter, location, permission) => {\n const declaration = Object.freeze({\n      name: name10,\n      options: Object.freeze({ codemode: false, permission: "edit" }),\n      description: patch_default,\n      input: Input10,\n      output: Output6,\n      execute: (input, context) => {\n        const applied = [];\n        const parsed = Patch.parse(input.patchText);\n        const lockTargets = Result.isSuccess(parsed) ? parsed.success.flatMap((hunk) => [\n          resolvePath2(location.directory, hunk.path),\n          ...hunk.type === "update" && hunk.movePath ? [resolvePath2(location.directory, hunk.movePath)] : []\n        ]) : [];\n        const fail = (operation, error) => {\n          const completed = applied.map((item) => item.resource).join(", ");\n          return new ToolFailure({\n            message: `${operation}: ${errorMessage(error)}${completed ? `. Completed before failure: ${completed}` : ""}`\n          });\n        };\n        return Effect.gen(function* () {\n          const source = {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          };\n          if (!input.patchText)\n            return yield* new ToolFailure({ message: "patchText is required" });\n          const hunks = yield* Effect.fromResult(parsed).pipe(Effect.mapError((error) => new ToolFailure({ message: `patch verification failed: ${error.message}` })));\n          if (hunks.length === 0) {\n            return yield* new ToolFailure({ message: "patch rejected: empty patch" });\n          }\n          const prepared = [];\n          const updates = new Map;\n          const resolveTarget = Effect.fnUntraced(function* (value) {\n            const target = yield* access.resolve({ path: value, kind: "file" });\n            if (!target.externalDirectory)\n              return target;\n            yield* access.authorizeExternal([target], context, {\n              filepath: target.absolute,\n              parentDir: target.externalDirectory.directory\n            });\n            return target;\n          });\n          for (const hunk of hunks) {\n            yield* Effect.gen(function* () {\n              const target = yield* resolveTarget(hunk.path);\n              if (hunk.type === "add") {\n                const content = hunk.contents.endsWith(`\n`) || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`;\n                prepared.push({\n                  ...hunk,\n                  target,\n                  content,\n                  before: "",\n                  after: Bom.split(content).text\n                });\n                return;\n              }\n              if (hunk.type === "delete") {\n                const content = yield* readText2(environment.files, target.absolute).pipe(Effect.mapError((error) => new ToolFailure({\n                  message: `patch verification failed: Failed to delete ${target.resource}: ${errorMessage(error)}`\n                })));\n                prepared.push({ ...hunk, target, before: content.text, after: "" });\n                return;\n              }\n              const previous = updates.get(target.absolute);\n              const original = previous ?? (yield* Effect.gen(function* () {\n                const content = yield* readText2(environment.files, target.absolute).pipe(Effect.mapError((error) => new ToolFailure({\n                  message: `patch verification failed: Failed to read file to update ${target.absolute}: ${errorMessage(error)}`\n                })));\n                return Bom.join(content.text, content.bom);\n              }));\n              const before = Bom.split(original).text;\n              const update = yield* Effect.try({\n                try: () => Patch.derive(hunk.path, hunk.chunks, original),\n                catch: (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` })\n              });\n              const moveTarget = hunk.movePath ? yield* resolveTarget(hunk.movePath) : undefined;\n              prepared.push({\n                ...hunk,\n                target,\n                content: Patch.joinBom(update.content, update.bom),\n                before,\n                after: update.content,\n                moveTarget\n              });\n              if (!moveTarget)\n                updates.set(target.absolute, Patch.joinBom(update.content, update.bom));\n            }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to prepare patch at ${hunk.path}`, error })));\n          }\n          const patchFiles = prepared.map((change) => patchFile(change));\n          const targets = prepared.flatMap((change) => [\n            change.target,\n            ...change.type === "update" && change.moveTarget ? [change.moveTarget] : []\n          ]);\n          yield* permission.assert({\n            action: "edit",\n            resources: [...new Set(targets.map((target) => target.resource))],\n            save: ["*"],\n            metadata: {\n              filepath: targets.map((target) => target.resource).join(", "),\n              diff: patchFiles.map((file) => `${file.patch}\n`).join(""),\n              files: patchFiles\n            },\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source\n          });\n          yield* Effect.forEach(prepared, (change) => Effect.gen(function* () {\n            if (change.type === "delete") {\n              yield* environment.files.remove(change.target.absolute).pipe(Effect.mapError((error) => fail(`Failed to delete ${change.target.resource}`, error)));\n              applied.push({\n                type: change.type,\n                resource: change.target.resource,\n                target: change.target.absolute\n              });\n              return;\n            }\n            if (change.type === "update" && change.moveTarget) {\n              const moveTarget = change.moveTarget;\n              yield* environment.files.write(moveTarget.absolute, new TextEncoder().encode(change.content)).pipe(Effect.mapError((error) => fail(`Failed to write ${moveTarget.resource}`, error)));\n              yield* environment.files.remove(change.target.absolute).pipe(Effect.mapError((error) => fail(`Wrote ${moveTarget.resource} but failed to remove ${change.target.resource}`, error)));\n              applied.push({\n                type: change.type,\n                resource: change.moveTarget.resource,\n                target: change.moveTarget.absolute\n              });\n              return;\n            }\n            yield* environment.files.write(change.target.absolute, new TextEncoder().encode(change.content)).pipe(Effect.mapError((error) => fail(`Failed to write ${change.target.resource}`, error)));\n            applied.push({\n              type: change.type,\n              resource: change.target.resource,\n              target: change.target.absolute\n            });\n          }), { discard: true });\n          const formatted = new Map;\n          yield* Effect.forEach([...new Set(applied.filter((item) => item.type !== "delete").map((item) => item.target))], (target) => Effect.gen(function* () {\n            const current = yield* readText2(environment.files, target).pipe(Effect.mapError((error) => fail(`Failed to read ${target}`, error)));\n            formatted.set(target, (yield* formatter.file(target)) ? yield* syncTextBom2(environment.files, target, current.bom).pipe(Effect.mapError((error) => fail(`Failed to sync ${target}`, error))) : current.text);\n          }), { discard: true });\n          const files = prepared.map((change) => {\n            if (change.type === "delete")\n              return patchFile(change);\n            const target = change.type === "update" && change.moveTarget ? change.moveTarget : change.target;\n            return patchFile(change, formatted.get(target.absolute));\n          });\n          return { applied, files };\n        }).pipe(fileMutation.withLock(lockTargets), Effect.map((output) => ({\n          output,\n          content: toModelContent5(output),\n          metadata: { files: output.files }\n        })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to apply patch", error })));\n      }\n    });\n patchDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin46 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name10,\n      options: { codemode: false, permission: "edit" },\n      description: patch_default,\n      input: Input10,\n      output: Output6,\n      execute: (input, context) => {\n        const applied = [];\n        const parsed = Patch.parse(input.patchText);\n        const lockTargets = Result.isSuccess(parsed) ? parsed.success.flatMap((hunk) => [\n          resolvePath2(location.directory, hunk.path),\n          ...hunk.type === "update" && hunk.movePath ? [resolvePath2(location.directory, hunk.movePath)] : []\n        ]) : [];\n        const fail = (operation, error) => {\n          const completed = applied.map((item) => item.resource).join(", ");\n          return new ToolFailure({\n            message: `${operation}: ${errorMessage(error)}${completed ? `. Completed before failure: ${completed}` : ""}`\n          });\n        };\n        return Effect.gen(function* () {\n          const source = {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          };\n          if (!input.patchText)\n            return yield* new ToolFailure({ message: "patchText is required" });\n          const hunks = yield* Effect.fromResult(parsed).pipe(Effect.mapError((error) => new ToolFailure({ message: `patch verification failed: ${error.message}` })));\n          if (hunks.length === 0) {\n            return yield* new ToolFailure({ message: "patch rejected: empty patch" });\n          }\n          const prepared = [];\n          const updates = new Map;\n          const resolveTarget = Effect.fnUntraced(function* (value) {\n            const target = yield* access.resolve({ path: value, kind: "file" });\n            if (!target.externalDirectory)\n              return target;\n            yield* access.authorizeExternal([target], context, {\n              filepath: target.absolute,\n              parentDir: target.externalDirectory.directory\n            });\n            return target;\n          });\n          for (const hunk of hunks) {\n            yield* Effect.gen(function* () {\n              const target = yield* resolveTarget(hunk.path);\n              if (hunk.type === "add") {\n                const content = hunk.contents.endsWith(`\n`) || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`;\n                prepared.push({\n                  ...hunk,\n                  target,\n                  content,\n                  before: "",\n                  after: Bom.split(content).text\n                });\n                return;\n              }\n              if (hunk.type === "delete") {\n                const content = yield* readText2(environment.files, target.absolute).pipe(Effect.mapError((error) => new ToolFailure({\n                  message: `patch verification failed: Failed to delete ${target.resource}: ${errorMessage(error)}`\n                })));\n                prepared.push({ ...hunk, target, before: content.text, after: "" });\n                return;\n              }\n              const previous = updates.get(target.absolute);\n              const original = previous ?? (yield* Effect.gen(function* () {\n                const content = yield* readText2(environment.files, target.absolute).pipe(Effect.mapError((error) => new ToolFailure({\n                  message: `patch verification failed: Failed to read file to update ${target.absolute}: ${errorMessage(error)}`\n                })));\n                return Bom.join(content.text, content.bom);\n              }));\n              const before = Bom.split(original).text;\n              const update = yield* Effect.try({\n                try: () => Patch.derive(hunk.path, hunk.chunks, original),\n                catch: (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` })\n              });\n              const moveTarget = hunk.movePath ? yield* resolveTarget(hunk.movePath) : undefined;\n              prepared.push({\n                ...hunk,\n                target,\n                content: Patch.joinBom(update.content, update.bom),\n                before,\n                after: update.content,\n                moveTarget\n              });\n              if (!moveTarget)\n                updates.set(target.absolute, Patch.joinBom(update.content, update.bom));\n            }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to prepare patch at ${hunk.path}`, error })));\n          }\n          const patchFiles = prepared.map((change) => patchFile(change));\n          const targets = prepared.flatMap((change) => [\n            change.target,\n            ...change.type === "update" && change.moveTarget ? [change.moveTarget] : []\n          ]);\n          yield* permission.assert({\n            action: "edit",\n            resources: [...new Set(targets.map((target) => target.resource))],\n            save: ["*"],\n            metadata: {\n              filepath: targets.map((target) => target.resource).join(", "),\n              diff: patchFiles.map((file) => `${file.patch}\n`).join(""),\n              files: patchFiles\n            },\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source\n          });\n          yield* Effect.forEach(prepared, (change) => Effect.gen(function* () {\n            if (change.type === "delete") {\n              yield* environment.files.remove(change.target.absolute).pipe(Effect.mapError((error) => fail(`Failed to delete ${change.target.resource}`, error)));\n              applied.push({\n                type: change.type,\n                resource: change.target.resource,\n                target: change.target.absolute\n              });\n              return;\n            }\n            if (change.type === "update" && change.moveTarget) {\n              const moveTarget = change.moveTarget;\n              yield* environment.files.write(moveTarget.absolute, new TextEncoder().encode(change.content)).pipe(Effect.mapError((error) => fail(`Failed to write ${moveTarget.resource}`, error)));\n              yield* environment.files.remove(change.target.absolute).pipe(Effect.mapError((error) => fail(`Wrote ${moveTarget.resource} but failed to remove ${change.target.resource}`, error)));\n              applied.push({\n                type: change.type,\n                resource: change.moveTarget.resource,\n                target: change.moveTarget.absolute\n              });\n              return;\n            }\n            yield* environment.files.write(change.target.absolute, new TextEncoder().encode(change.content)).pipe(Effect.mapError((error) => fail(`Failed to write ${change.target.resource}`, error)));\n            applied.push({\n              type: change.type,\n              resource: change.target.resource,\n              target: change.target.absolute\n            });\n          }), { discard: true });\n          const formatted = new Map;\n          yield* Effect.forEach([...new Set(applied.filter((item) => item.type !== "delete").map((item) => item.target))], (target) => Effect.gen(function* () {\n            const current = yield* readText2(environment.files, target).pipe(Effect.mapError((error) => fail(`Failed to read ${target}`, error)));\n            formatted.set(target, (yield* formatter.file(target)) ? yield* syncTextBom2(environment.files, target, current.bom).pipe(Effect.mapError((error) => fail(`Failed to sync ${target}`, error))) : current.text);\n          }), { discard: true });\n          const files = prepared.map((change) => {\n            if (change.type === "delete")\n              return patchFile(change);\n            const target = change.type === "update" && change.moveTarget ? change.moveTarget : change.target;\n            return patchFile(change, formatted.get(target.absolute));\n          });\n          return { applied, files };\n        }).pipe(fileMutation.withLock(lockTargets), Effect.map((output) => ({\n          output,\n          content: toModelContent5(output),\n          metadata: { files: output.files }\n        })), Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to apply patch", error })));\n      }\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = patchDeclaration2(environment, access, fileMutation, formatter, location, permission);",
        },
        {
          find: '\n    const hook = (event) => Effect.sync(() => {\n      const usePatch = event.model.id.includes("gpt-") && !event.model.id.includes("oss") && !event.model.id.includes("gpt-4");\n      if (usePatch) {\n        delete event.tools.edit;\n        delete event.tools.write;\n        return;\n      }\n      delete event.tools.patch;\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n  })\n};',
          replace:
            '\n    const hook = (event) => Effect.sync(() => {\n      const usePatch = event.model.id.includes("gpt-") && !event.model.id.includes("oss") && !event.model.id.includes("gpt-4");\n      if (usePatch) {\n        delete event.tools.edit;\n        delete event.tools.write;\n        return;\n      }\n      delete event.tools.patch;\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n    return declaration;\n  })\n};\nObject.freeze(Plugin46);',
        },
        {
          find: "export { name10, Input10, Applied2, Output6, toModelContent5, Plugin46, exports_patch };",
          replace:
            "export { patchDeclaration2, isPatchDeclaration2, name10, Input10, Applied2, Output6, toModelContent5, Plugin46, exports_patch };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-2et2b5t1.js",
      beforeSha256:
        "42d9a74391603b2d191e2d05cfcb2d502b218f2aee43b3fb28bf0a6ca588ddaa",
      afterSha256:
        "78d1387b72320fc9c5c9e5677be4e1e11d2c9d2c5e6c090b7e711525832f1754",
      edits: [
        {
          find: "var Plugin41 = {",
          replace:
            'var shellDeclarations2 = new WeakSet;\nvar isShellDeclaration2 = (value) => shellDeclarations2.has(value);\nvar shellDeclaration2 = (shell, compatibleShell, prepare, jobs, notifyWhenDone) => {\n const declaration = Object.freeze({\n      name: name5,\n      options: Object.freeze({ codemode: false }),\n      description: description(),\n      input: Input5,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        const timeout = input.background === true ? input.timeout ?? 0 : input.timeout ?? DEFAULT_TIMEOUT_MS2;\n        let finalTimeout = timeout;\n        const info = yield* shell.create({\n          command: input.command,\n          cwd: input.workdir,\n          timeout,\n          shell: yield* compatibleShell,\n          metadata: { sessionID: context.sessionID }\n        }, (invocation) => Effect.gen(function* () {\n          finalTimeout = yield* prepare(invocation, context);\n        }));\n        yield* context.progress({ shellID: info.id });\n        const settled = yield* Deferred.make();\n        const run = Effect.gen(function* () {\n          const result = yield* shell.result(info);\n          if (!result.capture)\n            return yield* new NotFoundError5({ id: info.id });\n          const output = output2(result);\n          return {\n            ...output,\n            output: output.timeout ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.` : output.output,\n            status: "completed"\n          };\n        }).pipe(Effect.tap((output) => Deferred.succeed(settled, output)), Effect.map((output) => resultMessages(output).join(`\n\n`)), Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)));\n        const job = yield* jobs.start({\n          id: info.id,\n          type: name5,\n          title: info.command,\n          metadata: { sessionID: context.sessionID, shellID: info.id },\n          recovery: {\n            kind: "shell",\n            sessionID: context.sessionID,\n            shellID: info.id,\n            command: info.command\n          },\n          run\n        });\n        if (input.background === true) {\n          yield* jobs.background(job.id);\n          yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled);\n          return backgroundResult(info.id, info.file);\n        }\n        const result = yield* jobs.block({ id: job.id, sessionID: context.sessionID }).pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)));\n        if (result?.type === "backgrounded") {\n          yield* shell.timeout(info.id, 0);\n          yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled);\n          return backgroundResult(info.id, info.file);\n        }\n        if (result?.info.status === "error")\n          return yield* Effect.fail(new Error(result.info.error ?? "Command failed"));\n        if (result?.info.status === "cancelled")\n          return yield* Effect.fail(new Error("Command cancelled"));\n        return yield* Deferred.await(settled);\n      }).pipe(Effect.map(toolResult), Effect.mapError((error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error })))\n    });\n shellDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin41 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name5,\n      options: { codemode: false },\n      description: description(),\n      input: Input5,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        const timeout = input.background === true ? input.timeout ?? 0 : input.timeout ?? DEFAULT_TIMEOUT_MS2;\n        let finalTimeout = timeout;\n        const info = yield* shell.create({\n          command: input.command,\n          cwd: input.workdir,\n          timeout,\n          shell: yield* compatibleShell,\n          metadata: { sessionID: context.sessionID }\n        }, (invocation) => Effect.gen(function* () {\n          finalTimeout = yield* prepare(invocation, context);\n        }));\n        yield* context.progress({ shellID: info.id });\n        const settled = yield* Deferred.make();\n        const run = Effect.gen(function* () {\n          const result = yield* shell.result(info);\n          if (!result.capture)\n            return yield* new NotFoundError5({ id: info.id });\n          const output = output2(result);\n          return {\n            ...output,\n            output: output.timeout ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.` : output.output,\n            status: "completed"\n          };\n        }).pipe(Effect.tap((output) => Deferred.succeed(settled, output)), Effect.map((output) => resultMessages(output).join(`\n\n`)), Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)));\n        const job = yield* jobs.start({\n          id: info.id,\n          type: name5,\n          title: info.command,\n          metadata: { sessionID: context.sessionID, shellID: info.id },\n          recovery: {\n            kind: "shell",\n            sessionID: context.sessionID,\n            shellID: info.id,\n            command: info.command\n          },\n          run\n        });\n        if (input.background === true) {\n          yield* jobs.background(job.id);\n          yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled);\n          return backgroundResult(info.id, info.file);\n        }\n        const result = yield* jobs.block({ id: job.id, sessionID: context.sessionID }).pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)));\n        if (result?.type === "backgrounded") {\n          yield* shell.timeout(info.id, 0);\n          yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled);\n          return backgroundResult(info.id, info.file);\n        }\n        if (result?.info.status === "error")\n          return yield* Effect.fail(new Error(result.info.error ?? "Command failed"));\n        if (result?.info.status === "cancelled")\n          return yield* Effect.fail(new Error("Command cancelled"));\n        return yield* Deferred.await(settled);\n      }).pipe(Effect.map(toolResult), Effect.mapError((error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error })))\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = shellDeclaration2(shell, compatibleShell, prepare, jobs, notifyWhenDone);",
        },
        {
          find: '\n    const hook = (event) => Effect.gen(function* () {\n      const tool = event.tools[name5];\n      if (!tool)\n        return;\n      tool.description = description(name15(yield* compatibleShell));\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n  })\n};',
          replace:
            '\n    const hook = (event) => Effect.gen(function* () {\n      const tool = event.tools[name5];\n      if (!tool)\n        return;\n      tool.description = description(name15(yield* compatibleShell));\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n    return declaration;\n  })\n};\nObject.freeze(Plugin41);',
        },
        {
          find: "export { name5, DEFAULT_TIMEOUT_MS2, Input5, Plugin41, exports_shell2 };",
          replace:
            "export { shellDeclaration2, isShellDeclaration2, name5, DEFAULT_TIMEOUT_MS2, Input5, Plugin41, exports_shell2 };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-191v1wnc.js",
      beforeSha256:
        "62b9246e5455e6b2515955c2f519f4b1c1963b48052c8e66f683f0bfca895834",
      afterSha256:
        "430f8d7551622ca4245dbdaa6c3d5214919cca23408e5d87ad9877ae3c908a10",
      edits: [
        {
          find: "var Plugin49 = {",
          replace:
            'var subagentDeclarations2 = new WeakSet;\nvar isSubagentDeclaration2 = (value) => subagentDeclarations2.has(value);\nvar subagentDeclaration2 = (sessions, config, agents, permission, resolveModel, subagents, jobs) => {\n const declaration = Object.freeze({\n      name: name11,\n      options: Object.freeze({ codemode: false }),\n      description: description5,\n      input: Input11,\n      output: Output7,\n      execute: (input, context) => Effect.gen(function* () {\n        const parent = yield* sessions.get(context.sessionID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error })));\n        let current = parent;\n        let depth = 0;\n        while (current.parentID) {\n          depth++;\n          current = yield* sessions.get(current.parentID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error })));\n        }\n        const limit = latest2(yield* config.entries(), "experimental")?.subagent_depth ?? 1;\n        if (depth >= limit)\n          return yield* new ToolFailure({\n            message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`\n          });\n        const agent = yield* agents.resolve(input.agent);\n        if (agent === undefined)\n          return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` });\n        if (agent.mode === "primary")\n          return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` });\n        yield* permission.assert({\n          action: name11,\n          resources: [agent.id],\n          save: [agent.id],\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          }\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })));\n        const existing = input.sessionID === undefined ? undefined : yield* sessions.get(input.sessionID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error })));\n        if (existing !== undefined && existing.parentID !== context.sessionID)\n          return yield* new ToolFailure({\n            message: `Session ${existing.id} is not a child of the current session`\n          });\n        const override = input.model === undefined ? undefined : yield* resolveModel(input.model);\n        if (existing !== undefined) {\n          const switched = existing.agent !== agent.id;\n          const model = override ?? (switched ? agent.model : undefined);\n          yield* Effect.all([\n            switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,\n            model === undefined ? Effect.void : sessions.switchModel({ sessionID: existing.id, model })\n          ]).pipe(Effect.mapError((error) => new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error })));\n        }\n        const model = override ?? agent.model ?? parent.model;\n        const child = existing ?? (yield* sessions.create({\n          parentID: context.sessionID,\n          title: input.description,\n          agent: ID10.make(input.agent),\n          model\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }))));\n        const background = input.background === true;\n        yield* context.progress({ sessionID: child.id, status: "running" });\n        yield* sessions.prompt({\n          sessionID: child.id,\n          text: existing === undefined ? ["You are a subagent spawned by another session.", input.prompt].join(`\n`) : input.prompt,\n          ...background && existing === undefined ? { resume: false } : {}\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error })));\n        const recovery = {\n          kind: "subagent",\n          parentSessionID: context.sessionID,\n          childSessionID: child.id,\n          agent: agent.name,\n          description: input.description\n        };\n        yield* subagents.start(recovery);\n        if (background) {\n          yield* subagents.background(recovery);\n          return backgroundResult(child.id);\n        }\n        const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(Effect.onInterrupt(() => Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {\n          discard: true\n        })));\n        if (result?.type === "backgrounded") {\n          yield* subagents.notify(recovery, result.info.started_at);\n          return backgroundResult(child.id);\n        }\n        if (result?.info.status === "error")\n          return yield* new ToolFailure({\n            message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`\n          });\n        if (result?.info.status === "cancelled")\n          return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` });\n        return {\n          sessionID: child.id,\n          status: "completed",\n          output: result?.info.output ?? NO_TEXT2\n        };\n      }).pipe(Effect.map((output) => ({\n        output,\n        content: output.status === "completed" ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>` : output.output,\n        metadata: { sessionID: output.sessionID, status: output.status }\n      })))\n    });\n subagentDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin49 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name11,\n      options: { codemode: false },\n      description: description5,\n      input: Input11,\n      output: Output7,\n      execute: (input, context) => Effect.gen(function* () {\n        const parent = yield* sessions.get(context.sessionID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error })));\n        let current = parent;\n        let depth = 0;\n        while (current.parentID) {\n          depth++;\n          current = yield* sessions.get(current.parentID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error })));\n        }\n        const limit = latest2(yield* config.entries(), "experimental")?.subagent_depth ?? 1;\n        if (depth >= limit)\n          return yield* new ToolFailure({\n            message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`\n          });\n        const agent = yield* agents.resolve(input.agent);\n        if (agent === undefined)\n          return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` });\n        if (agent.mode === "primary")\n          return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` });\n        yield* permission.assert({\n          action: name11,\n          resources: [agent.id],\n          save: [agent.id],\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: {\n            type: "tool",\n            messageID: context.messageID,\n            id: context.id\n          }\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })));\n        const existing = input.sessionID === undefined ? undefined : yield* sessions.get(input.sessionID).pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error })));\n        if (existing !== undefined && existing.parentID !== context.sessionID)\n          return yield* new ToolFailure({\n            message: `Session ${existing.id} is not a child of the current session`\n          });\n        const override = input.model === undefined ? undefined : yield* resolveModel(input.model);\n        if (existing !== undefined) {\n          const switched = existing.agent !== agent.id;\n          const model = override ?? (switched ? agent.model : undefined);\n          yield* Effect.all([\n            switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,\n            model === undefined ? Effect.void : sessions.switchModel({ sessionID: existing.id, model })\n          ]).pipe(Effect.mapError((error) => new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error })));\n        }\n        const model = override ?? agent.model ?? parent.model;\n        const child = existing ?? (yield* sessions.create({\n          parentID: context.sessionID,\n          title: input.description,\n          agent: ID10.make(input.agent),\n          model\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }))));\n        const background = input.background === true;\n        yield* context.progress({ sessionID: child.id, status: "running" });\n        yield* sessions.prompt({\n          sessionID: child.id,\n          text: existing === undefined ? ["You are a subagent spawned by another session.", input.prompt].join(`\n`) : input.prompt,\n          ...background && existing === undefined ? { resume: false } : {}\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error })));\n        const recovery = {\n          kind: "subagent",\n          parentSessionID: context.sessionID,\n          childSessionID: child.id,\n          agent: agent.name,\n          description: input.description\n        };\n        yield* subagents.start(recovery);\n        if (background) {\n          yield* subagents.background(recovery);\n          return backgroundResult(child.id);\n        }\n        const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(Effect.onInterrupt(() => Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {\n          discard: true\n        })));\n        if (result?.type === "backgrounded") {\n          yield* subagents.notify(recovery, result.info.started_at);\n          return backgroundResult(child.id);\n        }\n        if (result?.info.status === "error")\n          return yield* new ToolFailure({\n            message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`\n          });\n        if (result?.info.status === "cancelled")\n          return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` });\n        return {\n          sessionID: child.id,\n          status: "completed",\n          output: result?.info.output ?? NO_TEXT2\n        };\n      }).pipe(Effect.map((output) => ({\n        output,\n        content: output.status === "completed" ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>` : output.output,\n        metadata: { sessionID: output.sessionID, status: output.status }\n      })))\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = subagentDeclaration2(sessions, config, agents, permission, resolveModel, subagents, jobs);",
        },
        {
          find: '\n    yield* ctx.tool.hook("execute.before", (event) => Effect.sync(() => {\n      if (event.tool !== name11 || !Predicate.isObject(event.input))\n        return;\n      if (event.input.model !== "" && event.input.sessionID !== "")\n        return;\n      const input = { ...event.input };\n      if (input.model === "")\n        delete input.model;\n      if (input.sessionID === "")\n        delete input.sessionID;\n      event.input = input;\n    }));\n    const hook = (event) => Effect.gen(function* () {\n      const tool = event.tools[name11];\n      if (!tool)\n        return;\n      const selected = yield* agents.resolve(event.agent);\n      if (!selected)\n        return;\n      const available = (yield* agents.list()).filter((agent) => agent.mode !== "primary" && !agent.hidden && evaluate2(name11, agent.id, selected.permissions).effect !== "deny").toSorted((a, b) => a.id.localeCompare(b.id));\n      if (available.length === 0)\n        return;\n      tool.description = [\n        tool.description,\n        "",\n        "Available subagents:",\n        ...available.map((agent) => `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`)\n      ].join(`\n`);\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n  })\n};',
          replace:
            '\n    yield* ctx.tool.hook("execute.before", (event) => Effect.sync(() => {\n      if (event.tool !== name11 || !Predicate.isObject(event.input))\n        return;\n      if (event.input.model !== "" && event.input.sessionID !== "")\n        return;\n      const input = { ...event.input };\n      if (input.model === "")\n        delete input.model;\n      if (input.sessionID === "")\n        delete input.sessionID;\n      event.input = input;\n    }));\n    const hook = (event) => Effect.gen(function* () {\n      const tool = event.tools[name11];\n      if (!tool)\n        return;\n      const selected = yield* agents.resolve(event.agent);\n      if (!selected)\n        return;\n      const available = (yield* agents.list()).filter((agent) => agent.mode !== "primary" && !agent.hidden && evaluate2(name11, agent.id, selected.permissions).effect !== "deny").toSorted((a, b) => a.id.localeCompare(b.id));\n      if (available.length === 0)\n        return;\n      tool.description = [\n        tool.description,\n        "",\n        "Available subagents:",\n        ...available.map((agent) => `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`)\n      ].join(`\n`);\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n    return declaration;\n  })\n};\nObject.freeze(Plugin49);',
        },
        {
          find: "export { name11, Input11, Output7, description5, Plugin49, exports_subagent };",
          replace:
            "export { subagentDeclaration2, isSubagentDeclaration2, name11, Input11, Output7, description5, Plugin49, exports_subagent };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-9tndjada.js",
      beforeSha256:
        "a5d09253a81ccc330da2d096afbc4cb8ad14c31feb2af42119f04cb6bf3531ff",
      afterSha256:
        "451c71010064b35d91e8e3fedbc00e6310111c6b0af67305b61f9f8a0ac7a170",
      edits: [
        {
          find: "var Plugin45 = {",
          replace:
            'var websearchDeclarations2 = new WeakSet;\nvar isWebsearchDeclaration2 = (value) => websearchDeclarations2.has(value);\nvar websearchDeclaration2 = (permission, websearch, ctx, forms) => {\n const declaration = Object.freeze({\n      name: name9,\n      options: Object.freeze({ codemode: false }),\n      description: description4,\n      input: Input9,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        yield* permission.assert({\n          action: name9,\n          resources: [input.query],\n          save: ["*"],\n          metadata: input,\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: { type: "tool", messageID: context.messageID, id: context.id }\n        });\n        const search = (providerID) => websearch.query({ ...input, providerID }, {\n          sessionID: context.sessionID,\n          onProvider: (provider) => context.progress({ provider: provider.id })\n        });\n        const result = yield* search().pipe(Effect.catchTag("WebSearch.ProviderRequired", () => {\n          return providerSelectionLock.withPermit(Effect.gen(function* () {\n            if (yield* websearch.default())\n              return;\n            const providers = (yield* ctx.websearch.providers()).data;\n            const defaultProvider = providers[0];\n            if (!defaultProvider)\n              return yield* new ProviderRequiredError2;\n            const response = yield* forms.ask({\n              sessionID: context.sessionID,\n              title: "Web Search",\n              metadata: { kind: "websearch.provider" },\n              fields: [\n                {\n                  key: "choice",\n                  description: "Allow OpenCode to search the web for up-to-date information?",\n                  type: "string",\n                  required: true,\n                  custom: false,\n                  options: [\n                    {\n                      value: "allow",\n                      label: `Allow search via ${providers.map((provider) => provider.name).join(", ")}`\n                    },\n                    {\n                      value: "choose",\n                      label: "Choose another provider"\n                    },\n                    { value: "disable", label: "Disable web search" }\n                  ]\n                }\n              ]\n            });\n            if (response.status === "cancelled")\n              return yield* Effect.fail(new Error("Web search cancelled"));\n            if (response.answer.choice === "disable") {\n              yield* websearch.select(false);\n              return yield* new DisabledError2;\n            }\n            const selection = response.answer.choice === "choose" ? yield* forms.ask({\n              sessionID: context.sessionID,\n              title: "Choose a web search provider",\n              metadata: { kind: "websearch.provider" },\n              fields: [\n                {\n                  key: "provider",\n                  description: "Choose a provider for web search.",\n                  type: "string",\n                  required: true,\n                  custom: false,\n                  options: providers.map((provider) => ({\n                    value: provider.id,\n                    label: provider.name\n                  }))\n                }\n              ]\n            }) : undefined;\n            if (selection?.status === "cancelled")\n              return yield* Effect.fail(new Error("Web search cancelled"));\n            const providerID = selection?.answer.provider ?? "random";\n            if (providerID === "random") {\n              yield* websearch.select("random");\n              return;\n            }\n            const provider = providers.find((provider) => provider.id === providerID);\n            if (!provider)\n              return yield* new ProviderRequiredError2;\n            yield* websearch.select(provider.id);\n            return provider.id;\n          })).pipe(Effect.timeoutOrElse({\n            duration: "1 minute",\n            orElse: () => Effect.fail(new Error("Web search cancelled"))\n          }), Effect.flatMap(search));\n        }));\n        const output = {\n          provider: result.providerID,\n          results: result.results\n        };\n        const content = output.results.length ? output.results.map((result) => {\n          const title = result.title ?? result.url;\n          const published = result.time.published ? `\nPublished: ${new Date(result.time.published).toISOString()}` : "";\n          return `## [${title}](${result.url})${published}${result.content ? `\n\n${result.content}` : ""}`;\n        }).join(`\n\n`) : NO_RESULTS2;\n        return { output, content, metadata: { provider: output.provider } };\n      }).pipe(Effect.mapError((error) => {\n        const fallback = `Unable to search the web for ${input.query}`;\n        if (!Schema.is(RequestError2)(error))\n          return new ToolFailure({ message: fallback, error });\n        const status = HttpClientError.isHttpClientError(error.cause) ? error.cause.response?.status : undefined;\n        return new ToolFailure({\n          message: status === undefined ? fallback : httpErrors.get(status) ?? `Web search request failed (HTTP ${status})`,\n          error,\n          metadata: { provider: error.providerID }\n        });\n      }))\n    });\n websearchDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin45 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => editor.add({\n      name: name9,\n      options: { codemode: false },\n      description: description4,\n      input: Input9,\n      output: Output,\n      execute: (input, context) => Effect.gen(function* () {\n        yield* permission.assert({\n          action: name9,\n          resources: [input.query],\n          save: ["*"],\n          metadata: input,\n          sessionID: context.sessionID,\n          agent: context.agent,\n          source: { type: "tool", messageID: context.messageID, id: context.id }\n        });\n        const search = (providerID) => websearch.query({ ...input, providerID }, {\n          sessionID: context.sessionID,\n          onProvider: (provider) => context.progress({ provider: provider.id })\n        });\n        const result = yield* search().pipe(Effect.catchTag("WebSearch.ProviderRequired", () => {\n          return providerSelectionLock.withPermit(Effect.gen(function* () {\n            if (yield* websearch.default())\n              return;\n            const providers = (yield* ctx.websearch.providers()).data;\n            const defaultProvider = providers[0];\n            if (!defaultProvider)\n              return yield* new ProviderRequiredError2;\n            const response = yield* forms.ask({\n              sessionID: context.sessionID,\n              title: "Web Search",\n              metadata: { kind: "websearch.provider" },\n              fields: [\n                {\n                  key: "choice",\n                  description: "Allow OpenCode to search the web for up-to-date information?",\n                  type: "string",\n                  required: true,\n                  custom: false,\n                  options: [\n                    {\n                      value: "allow",\n                      label: `Allow search via ${providers.map((provider) => provider.name).join(", ")}`\n                    },\n                    {\n                      value: "choose",\n                      label: "Choose another provider"\n                    },\n                    { value: "disable", label: "Disable web search" }\n                  ]\n                }\n              ]\n            });\n            if (response.status === "cancelled")\n              return yield* Effect.fail(new Error("Web search cancelled"));\n            if (response.answer.choice === "disable") {\n              yield* websearch.select(false);\n              return yield* new DisabledError2;\n            }\n            const selection = response.answer.choice === "choose" ? yield* forms.ask({\n              sessionID: context.sessionID,\n              title: "Choose a web search provider",\n              metadata: { kind: "websearch.provider" },\n              fields: [\n                {\n                  key: "provider",\n                  description: "Choose a provider for web search.",\n                  type: "string",\n                  required: true,\n                  custom: false,\n                  options: providers.map((provider) => ({\n                    value: provider.id,\n                    label: provider.name\n                  }))\n                }\n              ]\n            }) : undefined;\n            if (selection?.status === "cancelled")\n              return yield* Effect.fail(new Error("Web search cancelled"));\n            const providerID = selection?.answer.provider ?? "random";\n            if (providerID === "random") {\n              yield* websearch.select("random");\n              return;\n            }\n            const provider = providers.find((provider) => provider.id === providerID);\n            if (!provider)\n              return yield* new ProviderRequiredError2;\n            yield* websearch.select(provider.id);\n            return provider.id;\n          })).pipe(Effect.timeoutOrElse({\n            duration: "1 minute",\n            orElse: () => Effect.fail(new Error("Web search cancelled"))\n          }), Effect.flatMap(search));\n        }));\n        const output = {\n          provider: result.providerID,\n          results: result.results\n        };\n        const content = output.results.length ? output.results.map((result) => {\n          const title = result.title ?? result.url;\n          const published = result.time.published ? `\nPublished: ${new Date(result.time.published).toISOString()}` : "";\n          return `## [${title}](${result.url})${published}${result.content ? `\n\n${result.content}` : ""}`;\n        }).join(`\n\n`) : NO_RESULTS2;\n        return { output, content, metadata: { provider: output.provider } };\n      }).pipe(Effect.mapError((error) => {\n        const fallback = `Unable to search the web for ${input.query}`;\n        if (!Schema.is(RequestError2)(error))\n          return new ToolFailure({ message: fallback, error });\n        const status = HttpClientError.isHttpClientError(error.cause) ? error.cause.response?.status : undefined;\n        return new ToolFailure({\n          message: status === undefined ? fallback : httpErrors.get(status) ?? `Web search request failed (HTTP ${status})`,\n          error,\n          metadata: { provider: error.providerID }\n        });\n      }))\n    })).pipe(Effect.orDie);',
          replace:
            "    const declaration = websearchDeclaration2(permission, websearch, ctx, forms);",
        },
        {
          find: '\n    const hook = (event) => Effect.gen(function* () {\n      const disabled = yield* websearch.default().pipe(Effect.as(false), Effect.catchTag("WebSearch.Disabled", () => Effect.succeed(true)));\n      if (disabled)\n        delete event.tools[name9];\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n  })\n};',
          replace:
            '\n    const hook = (event) => Effect.gen(function* () {\n      const disabled = yield* websearch.default().pipe(Effect.as(false), Effect.catchTag("WebSearch.Disabled", () => Effect.succeed(true)));\n      if (disabled)\n        delete event.tools[name9];\n    });\n    yield* ctx.session.hook("context", hook);\n    yield* ctx.session.hook("compaction", hook);\n    yield* ctx.session.hook("generate", hook);\n    return declaration;\n  })\n};\nObject.freeze(Plugin45);',
        },
        {
          find: "export { name9, NO_RESULTS2, description4, Input9, Plugin45, exports_websearch2 };",
          replace:
            "export { websearchDeclaration2, isWebsearchDeclaration2, name9, NO_RESULTS2, description4, Input9, Plugin45, exports_websearch2 };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-kb6gw2zp.js",
      beforeSha256:
        "d0ad28539fdfed16e4341b00bddc430d343a789caa1957eb8ef409b8584f5d8d",
      afterSha256:
        "fd391a53c1aa1e8dec01941edcf51641aad6090e6be6e77521a1732c9ec2e690",
      edits: [
        {
          find: "var Plugin47 = {",
          replace:
            'var opencodeToolsDeclarations2 = new WeakSet;\nvar isOpencodeToolsDeclaration2 = (value) => opencodeToolsDeclarations2.has(value);\nvar opencodeToolsDeclaration2 = (ctx) => {\n const declaration = Object.freeze({ namespace: Object.freeze({\n        name: "opencode",\n        description: "Tools for managing OpenCode itself, such as working with sessions, searching the available models, and reading MCP resources."\n      }), declarations: Object.freeze([\nObject.freeze({\n        name: "session_rename",\n        description: "Rename a session, or omit sessionID to rename the current session. Use a short, specific title that summarizes the work being done.",\n        input: RenameInput2,\n        output: RenameOutput,\n        options: Object.freeze({ namespace: "opencode", codemode: true }),\n        execute: (input, context) => {\n          const sessionID = input.sessionID ?? context.sessionID;\n          const title = input.title.trim();\n          if (!title)\n            return Effect.fail(new ToolFailure({ message: "Session title must not be empty" }));\n          return ctx.session.update({ sessionID, title }).pipe(Effect.as({\n            output: { sessionID, title },\n            content: `Renamed session ${sessionID} to ${title}.`\n          }), Effect.mapError((error) => new ToolFailure({ message: `Unable to rename session ${sessionID}`, error })));\n        }\n      }),\nObject.freeze({\n        name: "session_move",\n        description: "Move a session to another directory, or omit sessionID to move the current session. The current session moves at the next safe boundary; do not run destination-dependent tools in the same execute call.",\n        input: MoveInput2,\n        output: MoveOutput,\n        options: Object.freeze({ namespace: "opencode", codemode: true, pinned: true }),\n        execute: (input, context) => Effect.gen(function* () {\n          const sessionID = input.sessionID ?? context.sessionID;\n          yield* ctx.session.move({\n            sessionID,\n            directory: input.directory,\n            delivery: "steer"\n          });\n          return {\n            output: { sessionID, directory: input.directory },\n            content: `Moved session ${sessionID} to ${input.directory}.`\n          };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to move session to ${input.directory}`, error })))\n      }),\nObject.freeze({\n        name: "models",\n        description: "Search the models available to use. Use this to turn a model name the user mentions into an exact reference before running a subagent on it. Check your own provider first.",\n        input: ModelsInput2,\n        output: ModelsOutput,\n        options: Object.freeze({ namespace: "opencode", codemode: true }),\n        execute: (input, context) => Effect.gen(function* () {\n          const offset = input.offset ?? 0;\n          const limit = input.limit ?? 20;\n          const own = (yield* ctx.session.get({ sessionID: context.sessionID })).model?.providerID;\n          const terms = input.query?.toLowerCase().split(/\\s+/).filter(Boolean) ?? [];\n          const names = new Map((yield* ctx.provider.list()).data.map((provider) => [provider.id, provider.name]));\n          const provider = input.provider?.toLowerCase();\n          const matching = (yield* ctx.model.list()).data.filter((model) => provider === undefined || model.providerID.toLowerCase() === provider || names.get(model.providerID)?.toLowerCase() === provider).filter((model) => {\n            const text = `${model.providerID}/${model.id} ${model.name}`.toLowerCase();\n            return terms.every((term) => text.includes(term));\n          }).toSorted((left, right) => Number(right.providerID === own) - Number(left.providerID === own) || left.providerID.localeCompare(right.providerID) || right.time.released - left.time.released).filter((model, index, sorted) => {\n            if (input.all || model.family === undefined)\n              return true;\n            return sorted.findIndex((other) => other.providerID === model.providerID && other.family === model.family) === index;\n          });\n          const page = matching.slice(offset, offset + limit);\n          const providers = Array.from(new Set(page.map((model) => model.providerID))).map((id) => ({\n            id,\n            name: names.get(id) ?? id,\n            models: page.filter((model) => model.providerID === id).map((model) => ({\n              id: `${model.providerID}/${model.id}`,\n              name: model.name,\n              released: model.time.released,\n              variants: model.variants.map((variant) => variant.id),\n              cost: model.cost,\n              status: model.status\n            }))\n          }));\n          return {\n            output: {\n              providers,\n              total: matching.length,\n              next: offset + limit < matching.length ? offset + limit : null\n            }\n          };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to list models", error })))\n      })\n]) });\n opencodeToolsDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin47 = {',
        },
        {
          find: '    yield* ctx.tool.transform((draft) => {\n      draft.namespace({\n        name: "opencode",\n        description: "Tools for managing OpenCode itself, such as working with sessions, searching the available models, and reading MCP resources."\n      });\n      draft.add({\n        name: "session_rename",\n        description: "Rename a session, or omit sessionID to rename the current session. Use a short, specific title that summarizes the work being done.",\n        input: RenameInput2,\n        output: RenameOutput,\n        options: { namespace: "opencode", codemode: true },\n        execute: (input, context) => {\n          const sessionID = input.sessionID ?? context.sessionID;\n          const title = input.title.trim();\n          if (!title)\n            return Effect.fail(new ToolFailure({ message: "Session title must not be empty" }));\n          return ctx.session.update({ sessionID, title }).pipe(Effect.as({\n            output: { sessionID, title },\n            content: `Renamed session ${sessionID} to ${title}.`\n          }), Effect.mapError((error) => new ToolFailure({ message: `Unable to rename session ${sessionID}`, error })));\n        }\n      });\n      draft.add({\n        name: "session_move",\n        description: "Move a session to another directory, or omit sessionID to move the current session. The current session moves at the next safe boundary; do not run destination-dependent tools in the same execute call.",\n        input: MoveInput2,\n        output: MoveOutput,\n        options: { namespace: "opencode", codemode: true, pinned: true },\n        execute: (input, context) => Effect.gen(function* () {\n          const sessionID = input.sessionID ?? context.sessionID;\n          yield* ctx.session.move({\n            sessionID,\n            directory: input.directory,\n            delivery: "steer"\n          });\n          return {\n            output: { sessionID, directory: input.directory },\n            content: `Moved session ${sessionID} to ${input.directory}.`\n          };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to move session to ${input.directory}`, error })))\n      });\n      draft.add({\n        name: "models",\n        description: "Search the models available to use. Use this to turn a model name the user mentions into an exact reference before running a subagent on it. Check your own provider first.",\n        input: ModelsInput2,\n        output: ModelsOutput,\n        options: { namespace: "opencode", codemode: true },\n        execute: (input, context) => Effect.gen(function* () {\n          const offset = input.offset ?? 0;\n          const limit = input.limit ?? 20;\n          const own = (yield* ctx.session.get({ sessionID: context.sessionID })).model?.providerID;\n          const terms = input.query?.toLowerCase().split(/\\s+/).filter(Boolean) ?? [];\n          const names = new Map((yield* ctx.provider.list()).data.map((provider) => [provider.id, provider.name]));\n          const provider = input.provider?.toLowerCase();\n          const matching = (yield* ctx.model.list()).data.filter((model) => provider === undefined || model.providerID.toLowerCase() === provider || names.get(model.providerID)?.toLowerCase() === provider).filter((model) => {\n            const text = `${model.providerID}/${model.id} ${model.name}`.toLowerCase();\n            return terms.every((term) => text.includes(term));\n          }).toSorted((left, right) => Number(right.providerID === own) - Number(left.providerID === own) || left.providerID.localeCompare(right.providerID) || right.time.released - left.time.released).filter((model, index, sorted) => {\n            if (input.all || model.family === undefined)\n              return true;\n            return sorted.findIndex((other) => other.providerID === model.providerID && other.family === model.family) === index;\n          });\n          const page = matching.slice(offset, offset + limit);\n          const providers = Array.from(new Set(page.map((model) => model.providerID))).map((id) => ({\n            id,\n            name: names.get(id) ?? id,\n            models: page.filter((model) => model.providerID === id).map((model) => ({\n              id: `${model.providerID}/${model.id}`,\n              name: model.name,\n              released: model.time.released,\n              variants: model.variants.map((variant) => variant.id),\n              cost: model.cost,\n              status: model.status\n            }))\n          }));\n          return {\n            output: {\n              providers,\n              total: matching.length,\n              next: offset + limit < matching.length ? offset + limit : null\n            }\n          };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to list models", error })))\n      });\n    }).pipe(Effect.orDie);',
          replace: "    const declaration = opencodeToolsDeclaration2(ctx);",
        },
        {
          find: "\n  })\n};",
          replace:
            "\n    return declaration;\n  })\n};\nObject.freeze(Plugin47);",
        },
        {
          find: "export { RenameInput2, MoveInput2, ModelsInput2, Plugin47, exports_opencode };",
          replace:
            "export { opencodeToolsDeclaration2, isOpencodeToolsDeclaration2, RenameInput2, MoveInput2, ModelsInput2, Plugin47, exports_opencode };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-e2skv07x.js",
      beforeSha256:
        "86a48168402c0a62344bf1fc645f1e0278c60291d43f8d37aa12f60e138a3a4e",
      afterSha256:
        "e70a138c4d782dd51b1f3d9f7ad77dc59b17f05718109e8dcff91df103bc76a5",
      edits: [
        {
          find: "var Plugin48 = {",
          replace:
            'var mcpResourcesDeclarations2 = new WeakSet;\nvar isMcpResourcesDeclaration2 = (value) => mcpResourcesDeclarations2.has(value);\nvar mcpResourcesDeclaration2 = (mcp, permission) => {\n const declaration = Object.freeze({ namespace: null, declarations: Object.freeze([\nObject.freeze({\n        name: "list_mcp_resources",\n        options: Object.freeze({ namespace: "opencode", codemode: true }),\n        description: "List documents, records, and other data exposed by MCP servers. Use this when the user refers to something that is not a local file, such as a URI with a custom scheme, then load a match with read_mcp_resource. Each entry names the server to read it from. Templates are resources addressed by a parameter such as a record ID; fill in the uriTemplate placeholders before reading.",\n        input: Schema.Struct({\n          server: Schema.optionalKey(Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }))\n        }),\n        output: Schema.Struct({\n          resources: Schema.Array(Resource2),\n          templates: Schema.Array(ResourceTemplate2)\n        }),\n        execute: (input, context) => Effect.gen(function* () {\n          const servers = input.server === undefined ? (yield* mcp.servers()).map((server) => server.name) : [input.server];\n          yield* permission.assert({\n            action: "opencode_list_mcp_resources",\n            resources: servers,\n            save: servers,\n            metadata: {},\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          if (input.server === undefined)\n            return { output: yield* mcp.resourceCatalog() };\n          return { output: yield* mcp.resources({ server: input.server }) };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))\n      }),\nObject.freeze({\n        name: "read_mcp_resource",\n        options: Object.freeze({ namespace: "opencode", codemode: true }),\n        description: "Read one MCP resource by server and URI. Not for local files. Always return the full contents rather than slicing or filtering them; oversized output is truncated automatically and the full content is saved to a file you can read. Images and PDFs are shown to you directly.",\n        input: Schema.Struct({\n          server: Schema.String.annotate({\n            description: "The server field of the discovered resource."\n          }),\n          uri: Schema.String.annotate({\n            description: "Exact resource URI from discovery, an expanded uriTemplate, or the user."\n          })\n        }),\n        output: ResourceContent2,\n        execute: (input, context) => Effect.gen(function* () {\n          yield* permission.assert({\n            action: "opencode_read_mcp_resource",\n            resources: [`${input.server}:${input.uri}`],\n            save: [`${input.server}:*`],\n            metadata: { server: input.server, uri: input.uri },\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          const resource = yield* mcp.readResource(input);\n          if (!resource)\n            return yield* new ToolFailure({\n              message: `MCP server "${input.server}" is not connected or does not expose resources`\n            });\n          return {\n            output: resource,\n            content: resource.contents.flatMap((part) => part.type === "blob" && (part.mimeType?.startsWith("image/") || part.mimeType === "application/pdf") ? [{ type: "file", uri: `data:${part.mimeType};base64,${part.blob}`, mime: part.mimeType }] : [])\n          };\n        }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({\n          message: `Unable to read MCP resource ${input.server}:${input.uri}: ${error.message}`,\n          error\n        })))\n      })\n]) });\n mcpResourcesDeclarations2.add(declaration);\n return declaration;\n};\nvar Plugin48 = {',
        },
        {
          find: '    yield* ctx.tool.transform((editor) => {\n      editor.add({\n        name: "list_mcp_resources",\n        options: { namespace: "opencode", codemode: true },\n        description: "List documents, records, and other data exposed by MCP servers. Use this when the user refers to something that is not a local file, such as a URI with a custom scheme, then load a match with read_mcp_resource. Each entry names the server to read it from. Templates are resources addressed by a parameter such as a record ID; fill in the uriTemplate placeholders before reading.",\n        input: Schema.Struct({\n          server: Schema.optionalKey(Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }))\n        }),\n        output: Schema.Struct({\n          resources: Schema.Array(Resource2),\n          templates: Schema.Array(ResourceTemplate2)\n        }),\n        execute: (input, context) => Effect.gen(function* () {\n          const servers = input.server === undefined ? (yield* mcp.servers()).map((server) => server.name) : [input.server];\n          yield* permission.assert({\n            action: "opencode_list_mcp_resources",\n            resources: servers,\n            save: servers,\n            metadata: {},\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          if (input.server === undefined)\n            return { output: yield* mcp.resourceCatalog() };\n          return { output: yield* mcp.resources({ server: input.server }) };\n        }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))\n      });\n      editor.add({\n        name: "read_mcp_resource",\n        options: { namespace: "opencode", codemode: true },\n        description: "Read one MCP resource by server and URI. Not for local files. Always return the full contents rather than slicing or filtering them; oversized output is truncated automatically and the full content is saved to a file you can read. Images and PDFs are shown to you directly.",\n        input: Schema.Struct({\n          server: Schema.String.annotate({\n            description: "The server field of the discovered resource."\n          }),\n          uri: Schema.String.annotate({\n            description: "Exact resource URI from discovery, an expanded uriTemplate, or the user."\n          })\n        }),\n        output: ResourceContent2,\n        execute: (input, context) => Effect.gen(function* () {\n          yield* permission.assert({\n            action: "opencode_read_mcp_resource",\n            resources: [`${input.server}:${input.uri}`],\n            save: [`${input.server}:*`],\n            metadata: { server: input.server, uri: input.uri },\n            sessionID: context.sessionID,\n            agent: context.agent,\n            source: { type: "tool", messageID: context.messageID, id: context.id }\n          });\n          const resource = yield* mcp.readResource(input);\n          if (!resource)\n            return yield* new ToolFailure({\n              message: `MCP server "${input.server}" is not connected or does not expose resources`\n            });\n          return {\n            output: resource,\n            content: resource.contents.flatMap((part) => part.type === "blob" && (part.mimeType?.startsWith("image/") || part.mimeType === "application/pdf") ? [{ type: "file", uri: `data:${part.mimeType};base64,${part.blob}`, mime: part.mimeType }] : [])\n          };\n        }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({\n          message: `Unable to read MCP resource ${input.server}:${input.uri}: ${error.message}`,\n          error\n        })))\n      });\n    }).pipe(Effect.orDie);',
          replace:
            "    const declaration = mcpResourcesDeclaration2(mcp, permission);",
        },
        {
          find: "\n  })\n};",
          replace:
            "\n    return declaration;\n  })\n};\nObject.freeze(Plugin48);",
        },
        {
          find: "export { Plugin48, exports_mcp_resource };",
          replace:
            "export { mcpResourcesDeclaration2, isMcpResourcesDeclaration2, Plugin48, exports_mcp_resource };",
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-hjbc5kem.js",
      beforeSha256:
        "851f52b95d70a48f17bbc99c233f6f45454dd9a43b979d00d528382d8a990191",
      afterSha256:
        "4d59bde098564f51d483eb3cde6f1dbcd33256d9ee82a12162e641b42c187d54",
      edits: [
        {
          find: '  const installedPath = packageName.startsWith("file://") ? packageName : yield* npm.add(packageName).pipe(Effect.orDie, Effect.map((installed) => resolveModule(installed.name, installed.directory)));\n  const mod = yield* Effect.promise(() => importModule(installedPath));\n  const match = Object.keys(mod).find((name) => name.startsWith("create"));\n  if (!match)\n    return yield* Effect.die(new Error(`Package ${packageName} has no provider factory export`));\n  return mod[match];',
          replace:
            '  return yield* Effect.die(new Error("native_permission_provider_source_unverified"));',
        },
      ],
    },
    {
      path: "node_modules/@opencode/core/dist/chunks/config-zrq68ahz.js",
      beforeSha256:
        "475eaad9396f996a69155ece0828e12135646cad1905c41e2f123a9fa2a34757",
      afterSha256:
        "6aa559ce1a9250e1e67001b76e602c83f08aad15650d423c94039812a9199b45",
      edits: [
        {
          find: '  const resolved = yield* Effect.sync(() => {\n    if (specifier.startsWith("file://") || specifier.startsWith("@opencode/ai/"))\n      return specifier;\n    try {\n      return import.meta.resolve(specifier);\n    } catch {\n      return;\n    }\n  });\n  if (resolved)\n    return yield* importPackage(specifier, resolved);\n  if (!npm) {\n    return yield* new LoadError3({\n      package: specifier,\n      cause: new Error(`Provider package ${specifier} is not installed`)\n    });\n  }\n  const parts = specifier.split("/");\n  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? specifier;\n  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError3({ package: specifier, cause })));\n  const entrypoint = yield* Effect.try({\n    try: () => resolveModule(specifier, installed.directory),\n    catch: (cause) => new LoadError3({ package: specifier, cause })\n  });\n  return yield* importPackage(specifier, entrypoint);',
          replace:
            '  return yield* new LoadError3({\n    package: specifier,\n    cause: new Error("native_permission_provider_source_unverified")\n  });',
        },
      ],
    },
  ],
};
for (const file of recipe.files) {
  for (const edit of file.edits) Object.freeze(edit);
  Object.freeze(file.edits);
  Object.freeze(file);
}
Object.freeze(recipe.files);
export const NATIVE_PERMISSION_OVERLAY_RECIPE = Object.freeze(recipe);

// Digest of the canonical closed recipe; checked against the planner in Node tests.
export const NATIVE_PERMISSION_OVERLAY_RECEIPT = Object.freeze({
  schemaVersion: 1,
  id: recipe.id,
  serverVersion: recipe.serverVersion,
  recipeSha256:
    "c7e9fdcf66d757f5d4a137f6ce70098d95177ff214dfb26291c6bc038553a8cb",
  files: Object.freeze(
    recipe.files.map(({ path, beforeSha256, afterSha256 }) =>
      Object.freeze({ path, beforeSha256, afterSha256 }),
    ),
  ),
});
const exactKeys = (value, fields) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...fields].sort().join();
export function matchesNativePermissionOverlay(value) {
  const expected = NATIVE_PERMISSION_OVERLAY_RECEIPT;
  return (
    exactKeys(value, [
      "schemaVersion",
      "id",
      "serverVersion",
      "recipeSha256",
      "files",
    ]) &&
    ["schemaVersion", "id", "serverVersion", "recipeSha256"].every(
      (key) => value[key] === expected[key],
    ) &&
    Array.isArray(value.files) &&
    value.files.length === expected.files.length &&
    value.files.every(
      (file, index) =>
        exactKeys(file, ["path", "beforeSha256", "afterSha256"]) &&
        ["path", "beforeSha256", "afterSha256"].every(
          (key) => file[key] === expected.files[index][key],
        ),
    )
  );
}
