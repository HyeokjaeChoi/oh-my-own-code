// Fixed checked OpenCode 2.0.18 coordinator/project gate patches. Never applied to original install.
const recipe = {
  schemaVersion: 1,
  id: "permission-coordinator-gate-v1",
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
            "import { Service as WorkbenchControl, node as workbenchControlNode } from " +
            JSON.stringify("../../../../../native-permission-control.mjs") +
            ';\nimport { makeLocationNode } from "@opencode/util/effect/app-node";',
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
            "import { Service as WorkbenchControl, node as workbenchControlNode } from " +
            JSON.stringify("../../../../../native-permission-control.mjs") +
            ';\nimport { eq } from "drizzle-orm";',
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
            'import { Deferred, Effect, Fiber, FiberSet } from "effect";\nimport { Service as WorkbenchControl } from ' +
            JSON.stringify("../../../../../native-permission-control.mjs") +
            ";\nimport { createCoordinatorAdmission } from " +
            JSON.stringify(
              "../../../../../native-permission-coordinator-admission.mjs",
            ) +
            ";\nimport { Service50 as WorkbenchSessionStore } from " +
            JSON.stringify("./config-sd0msgcy.js") +
            ";",
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
            "import { node as workbenchControlNode } from " +
            JSON.stringify("../../../../../native-permission-control.mjs") +
            ';\nimport { makeGlobalNode } from "@opencode/util/effect/app-node";',
        },
        {
          find: "deps: [node52, node49, node87, node88, node58]",
          replace:
            "deps: [node52, node49, node87, node88, node58, workbenchControlNode]",
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
    "3d88e2b4a817ebf5f133399207708d1068034154aa7ef70b09b8296c84a9dc22",
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
