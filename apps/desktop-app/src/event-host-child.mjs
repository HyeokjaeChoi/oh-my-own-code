import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDiagnosticEmitter,
  eventHostEnvironment,
  validateHostMessage,
} from "./event-host-protocol.mjs";
import { isPathInside, trustedSystemRoot } from "./platform-paths.mjs";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import {
  eventHostEnginePath,
  verifyEventHostResources,
} from "./event-host-resources.mjs";
import { createNativePermissionGraph } from "./native-permission-graph.mjs";
import { initialization } from "./native-permission-control-input.mjs";

import { createGitMetadataKernel } from "./host/git-metadata-kernel.mjs";
import { createConfigurationSaveKernel } from "./host/configuration-save-kernel.mjs";
import { createWin32ConfigurationSaveKernel } from "./host/configuration-save-kernel-win32.mjs";

// Exact JS handles supply exit evidence. This does not enumerate OS descendants.
export function createDirectHandleObserver(
  nodeCP,
  bun,
  synchronize = () => {},
) {
  const records = new Set();
  let gap = false;
  const observe = (handle) => {
    if (records.size >= 100000) {
      gap = true;
      return handle;
    }
    const record = { exited: false };
    records.add(record);
    if (handle?.once) {
      handle.once("exit", () => {
        record.exited = true;
      });
      handle.once("error", () => {
        gap = true;
      });
    } else if (handle?.exited?.then) {
      handle.exited.then(
        () => {
          record.exited = true;
        },
        () => {
          gap = true;
        },
      );
    } else gap = true;
    return handle;
  };
  const sync = (fn, kind) =>
    function (...args) {
      try {
        const result = fn.apply(this, args);
        const exited =
          kind === "bun"
            ? Number.isInteger(result.exitCode)
            : Number.isInteger(result.status) ||
              typeof result.signal === "string";
        if (!exited || result.error || records.size >= 100000) gap = true;
        else records.add({ exited: true });
        return result;
      } catch (error) {
        gap = true;
        throw error;
      }
    };
  try {
    for (const key of ["spawn", "exec", "execFile", "fork"]) {
      const original = nodeCP[key];
      nodeCP[key] = function (...args) {
        try {
          return observe(original.apply(this, args));
        } catch (error) {
          gap = true;
          throw error;
        }
      };
    }
    nodeCP.spawnSync = sync(nodeCP.spawnSync, "node");
    for (const key of ["execSync", "execFileSync"])
      nodeCP[key] = () => {
        gap = true;
        throw new Error("descendant_unverified");
      };
    const original = bun.spawn;
    bun.spawn = function (...args) {
      try {
        return observe(original.apply(this, args));
      } catch (error) {
        gap = true;
        throw error;
      }
    };
    bun.spawnSync = sync(bun.spawnSync, "bun");
    synchronize();
  } catch {
    gap = true;
  }
  return {
    snapshot: () => ({
      observerGap: gap,
      live: [...records].filter((record) => !record.exited).length,
    }),
    async settle(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (
        !gap &&
        [...records].some((record) => !record.exited) &&
        Date.now() < deadline
      )
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(20, Math.max(1, deadline - Date.now()))),
        );
      return this.snapshot();
    },
  };
}
const contains = (root, path) => isPathInside(root, path);
function directory(path) {
  const stat = lstatSync(path);
  if (
    realpathSync(path) !== path ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    // Windows: the supervisor verified every directory's DACL before spawn;
    // the child may not start processes, so it only re-checks the shape here.
    (process.platform !== "win32" &&
      (stat.uid !== process.getuid() || stat.mode & 0o077))
  )
    throw new Error("storage_denied");
}
function guardInit(input) {
  const resourceRoot = dirname(fileURLToPath(import.meta.url));
  if (
    globalThis.Bun?.version !== "1.4.2" ||
    process.execPath !==
      eventHostEnginePath(resourceRoot, process.platform, process.arch)
  )
    throw new Error("runtime_identity_mismatch");
  directory(input.root);
  directory(input.namespaceRoot);
  if (
    contains(input.root, input.namespaceRoot) ||
    contains(input.namespaceRoot, input.root) ||
    input.workspace !== join(input.root, "workspace") ||
    !contains(input.namespaceRoot, input.configPath) ||
    input.configPath === input.namespaceRoot ||
    input.database !== join(input.dataPath, "event-host.sqlite") ||
    !contains(input.namespaceRoot, input.dataPath) ||
    input.dataPath === input.namespaceRoot ||
    !contains(input.namespaceRoot, input.statePath) ||
    input.statePath === input.namespaceRoot ||
    process.cwd() !== input.workspace
  )
    throw new Error("storage_denied");
  for (const path of [
    input.workspace,
    input.configPath,
    input.dataPath,
    input.statePath,
    join(input.root, "home"),
    join(input.root, "cache"),
    join(input.root, "tmp"),
  ])
    directory(path);
  for (const candidate of [
    join(input.configPath, "opencode.json"),
    input.database,
    `${input.database}-wal`,
    `${input.database}-shm`,
    `${input.database}-journal`,
  ]) {
    try {
      const stat = lstatSync(candidate);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.platform !== "win32" &&
          (stat.uid !== process.getuid() || stat.mode & 0o077))
      )
        throw new Error("storage_denied");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const expected = eventHostEnvironment({
    platform: process.platform,
    root: input.root,
    configPath: input.configPath,
    dataPath: input.dataPath,
    statePath: input.statePath,
    systemRoot: trustedSystemRoot(),
  });
  for (const [key, value] of Object.entries(expected))
    if (process.env[key] !== value) throw new Error("environment_denied");
  const allowed = new Set([
    ...Object.keys(expected),
    "NODE_CHANNEL_FD",
    "NODE_CHANNEL_SERIALIZATION_MODE",
  ]);
  for (const key of Object.keys(process.env))
    if (!allowed.has(key)) throw new Error("environment_denied");
}

// The production caller supplies the fixed pinned server import. Test seams
// are private function arguments and cannot be selected by an IPC request.
export async function prepareHeldEventHostStart(
  {
    root,
    nonce,
    runtimeEpoch,
    bootHolds,
    options,
    isClosing,
    bindTaskControl,
    diagnostic,
  },
  { createGraph = createNativePermissionGraph, loadStart },
) {
  const permissionInit = initialization({ runtimeEpoch, bootHolds });
  if (isClosing()) throw new Error("startup_held");
  const graph = await createGraph(
    { root, nonce, ...permissionInit },
    diagnostic,
  );
  if (isClosing()) throw new Error("startup_held");
  if (bindTaskControl) {
    if (
      ["prepare", "arm", "revoke", "close"].some(
        (name) => typeof graph.taskControl?.[name] !== "function",
      )
    )
      throw new Error("startup_held");
    bindTaskControl(graph.taskControl);
  }
  const start = await loadStart();
  if (isClosing()) throw new Error("startup_held");
  return start(options, undefined, undefined, graph.overrides);
}

export function runEventHostChild() {
  let nonce,
    initialized = false,
    closing = false,
    importing = false,
    ready = false,
    observing = false;
  let scope, fiber, Effect, Scope, Exit, Fiber, Logger, Cause, References;
  let observer, initialization;
  let gitMetadataKernel,
    taskControl,
    taskPreparationTask,
    taskPreparing = false,
    taskHandoffing = false;
  let configurationKernel,
    configurationTask,
    configurationPrepared,
    configurationActive = false;
  const emit = (message) => {
    if (nonce && process.connected) {
      try {
        process.send({ ...message, nonce, pid: process.pid }, () => {});
      } catch {
        /* IPC loss retains parent hold */
      }
    }
  };
  // Bounded, redacted, deduplicated diagnostics for Main logs only. Never
  // carries authority; failures here cannot change host state.
  const diagnostic = createDiagnosticEmitter(
    (message) => emit(message),
    () => closing,
  );
  const bounded = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stop_timeout")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const stop = async () => {
    if (closing) return;
    closing = true;
    const taskRevocation = taskControl?.close("child_stopping");
    clearTimeout(initTimer);
    try {
      // Initialization can be between async imports and scope/fiber creation.
      // Wait for it to acknowledge closing before attempting scope finalization.
      if (importing && initialization)
        await bounded(
          initialization.catch(() => {}),
          5000,
        );
      if (taskRevocation)
        await bounded(Effect.runPromise(taskRevocation), 5000);
      if (taskPreparationTask)
        await bounded(
          taskPreparationTask.catch(() => {}),
          5000,
        );
      if (configurationTask)
        await bounded(
          configurationTask.catch(() => {}),
          5000,
        );
      if (configurationKernel)
        await bounded(Promise.resolve(configurationKernel.close()), 5000);
      if (gitMetadataKernel)
        await bounded(Promise.resolve(gitMetadataKernel.close()), 5000);
      if (fiber) await bounded(Effect.runPromise(Fiber.interrupt(fiber)), 5000);
      if (scope)
        await bounded(Effect.runPromise(Scope.close(scope, Exit.void)), 5000);
      const observation = observer
        ? await observer.settle(1000)
        : { observerGap: !initialized, live: 0 };
      if (observation.observerGap || observation.live) {
        emit({ type: "hold" });
        return;
      }
      if (process.connected)
        await bounded(
          new Promise((resolve, reject) => {
            process.send(
              { type: "scope-closed", nonce, pid: process.pid, ...observation },
              (error) => (error ? reject(error) : resolve()),
            );
          }),
          1000,
        );
      else throw new Error("ipc_lost");
      const final = observer.snapshot();
      if (final.observerGap || final.live) {
        emit({ type: "hold" });
        return;
      }
      process.exit(0);
    } catch {
      emit({ type: "hold" });
    }
  };
  const initialize = async (input) => {
    guardInit(input);
    if (process.platform !== "win32") process.umask(0o077);
    observer = createDirectHandleObserver(
      cp,
      globalThis.Bun,
      syncBuiltinESMExports,
    );
    if (observer.snapshot().observerGap || closing)
      throw new Error("startup_held");
    importing = true;
    const resourceRoot = dirname(fileURLToPath(import.meta.url));
    await verifyEventHostResources(
      {
        root: resourceRoot,
        enginePath: eventHostEnginePath(
          resourceRoot,
          process.platform,
          process.arch,
        ),
        hostPath: join(resourceRoot, "host.mjs"),
        manifestPath: join(resourceRoot, "manifest.json"),
      },
      {
        platform: process.platform,
        arch: process.arch,
        requirePermissionOverlay: true,
      },
    );
    if (closing) throw new Error("startup_held");
    ({ Effect, Scope, Exit, Fiber, Logger, Cause, References } = await import(
      "effect"
    ));
    if (closing) throw new Error("startup_held");
    scope = await Effect.runPromise(Scope.make());
    if (closing) throw new Error("startup_held");
    const server = await prepareHeldEventHostStart(
      {
        root: resourceRoot,
        nonce: input.nonce,
        runtimeEpoch: input.runtimeEpoch,
        bootHolds: [],
        isClosing: () => closing,
        diagnostic,
        bindTaskControl: (value) => {
          taskControl = value;
        },
        options: {
          events: { persist: true },
          hostname: "127.0.0.1",
          port: input.port,
          password: input.password,
          app: { version: "2.0.18" },
          database: { path: input.database },
          config: {
            directory: input.configPath,
            project: false,
            content: nativeSkillsConfig(
              dirname(fileURLToPath(import.meta.url)),
              input.nonce,
            ),
          },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
      },
      {
        loadStart: async () => (await import("@opencode/server/process")).start,
      },
    );
    if (closing) throw new Error("startup_held");
    // Native error logs (including 5xx defects) become bounded diagnostics.
    const nativeErrors = Logger.make((entry) => {
      try {
        const level = String(entry.logLevel);
        const reasons = entry.cause?.reasons?.length ?? 0;
        if (!reasons && !["Error", "Fatal"].includes(level)) return;
        const failure = reasons ? Cause.squash(entry.cause) : undefined;
        const notes = entry.fiber.getRef(References.CurrentLogAnnotations);
        let route;
        try {
          route = `${notes?.["http.method"] ?? ""} ${new URL(String(notes?.["http.url"]), "http://x").pathname}`;
        } catch {
          /* no HTTP context for this log entry */
        }
        diagnostic({
          kind: "native",
          tag: failure?._tag ?? failure?.name ?? level,
          route,
          status: Number(notes?.["http.status"]) || undefined,
        });
      } catch {
        /* best effort */
      }
    });
    fiber = Effect.runFork(
      server.pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(
          Logger.layer([nativeErrors], { mergeWithExisting: true }),
        ),
      ),
    );
    importing = false;
    const result = await Effect.runPromise(Fiber.join(fiber));
    if (
      closing ||
      observer.snapshot().observerGap ||
      result.address._tag !== "TcpAddress" ||
      !Number.isInteger(result.address.port) ||
      result.address.port <= 0 ||
      result.address.port > 65535 ||
      (input.port && input.port !== result.address.port)
    )
      throw new Error("startup_held");
    ready = true;
    emit({
      type: "ready",
      port: result.address.port,
      engineVersion: "1.4.2",
      serverVersion: "2.0.18",
    });
  };
  process.on("message", (message) => {
    try {
      validateHostMessage(message, "child");
      if (message.type === "init") {
        if (initialized || closing) throw new Error("duplicate_init");
        initialized = true;
        nonce = message.nonce;
        clearTimeout(initTimer);
        initialization = initialize(message);
        initialization.catch(() => {
          emit({ type: "hold" });
          void stop();
        });
      } else if (message.type === "task-prepare") {
        if (
          !ready ||
          closing ||
          message.nonce !== nonce ||
          taskPreparing ||
          taskHandoffing ||
          observing ||
          configurationActive ||
          configurationPrepared ||
          !taskControl
        )
          throw new Error("task_preparation_held");
        taskPreparing = true;
        const request = message.request;
        taskPreparationTask = Effect.runPromise(taskControl.prepare(request))
          .then((result) => {
            if (closing) return;
            const response = {
              type: "task-preparation",
              nonce,
              pid: process.pid,
              requestId: message.requestId,
              request,
              result,
            };
            validateHostMessage(response, "parent");
            emit(response);
          })
          .catch(() => {
            emit({ type: "hold" });
            void stop();
          })
          .finally(() => {
            taskPreparing = false;
          });
      } else if (["task-arm", "task-revoke"].includes(message.type)) {
        if (
          !ready ||
          closing ||
          message.nonce !== nonce ||
          taskPreparing ||
          taskHandoffing ||
          observing ||
          configurationActive ||
          configurationPrepared ||
          !taskControl
        )
          throw new Error("task_handoff_held");
        taskHandoffing = true;
        const arming = message.type === "task-arm";
        const handoffId = arming
          ? message.request.handoffId
          : message.handoffId;
        // A typed refusal is a normal answer (nothing armed); only transport or
        // protocol faults hold the host.
        Effect.runPromise(
          arming
            ? taskControl.arm(message.request)
            : taskControl.revoke(message.handoffId),
        )
          .then(
            () => "ok",
            () => "refused",
          )
          .then((status) => {
            if (closing) return;
            const response = {
              type: "task-handoff-result",
              nonce,
              pid: process.pid,
              requestId: message.requestId,
              action: arming ? "arm" : "revoke",
              handoffId,
              status,
            };
            validateHostMessage(response, "parent");
            emit(response);
          })
          .catch(() => {
            emit({ type: "hold" });
            void stop();
          })
          .finally(() => {
            taskHandoffing = false;
          });
      } else if (message.type === "project-hold") {
        if (
          !ready ||
          closing ||
          message.nonce !== nonce ||
          taskPreparing ||
          taskHandoffing ||
          observing ||
          configurationActive ||
          configurationPrepared ||
          typeof taskControl?.holdProject !== "function"
        )
          throw new Error("task_handoff_held");
        taskHandoffing = true;
        // A typed refusal is a normal answer; only transport faults hold the host.
        Effect.runPromise(
          taskControl.holdProject(message.projectId, message.held),
        )
          .then(
            () => "ok",
            () => "refused",
          )
          .then((status) => {
            if (closing) return;
            const response = {
              type: "project-hold-result",
              nonce,
              pid: process.pid,
              requestId: message.requestId,
              projectId: message.projectId,
              held: message.held,
              status,
            };
            validateHostMessage(response, "parent");
            emit(response);
          })
          .catch(() => {
            emit({ type: "hold" });
            void stop();
          })
          .finally(() => {
            taskHandoffing = false;
          });
      } else if (
        [
          "configuration-prepare",
          "configuration-publish",
          "configuration-abort",
          "git-branch-restore-prepare",
          "git-branch-restore-publish",
          "git-branch-restore-abort",
          "git-commit-prepare",
          "git-commit-publish",
          "git-commit-abort",
          "git-index-prepare",
          "git-index-publish",
          "git-index-abort",
        ].includes(message.type)
      ) {
        if (
          !ready ||
          closing ||
          observing ||
          configurationActive ||
          message.nonce !== nonce
        )
          throw new Error("invalid_configuration");
        configurationActive = true;
        const indexRequest = message.type.startsWith("git-index-");
        const commitRequest = message.type.startsWith("git-commit-");
        const branchRestoreRequest = message.type.startsWith(
          "git-branch-restore-",
        );
        const resultType = branchRestoreRequest
          ? "git-branch-restore-result"
          : commitRequest
            ? "git-commit-result"
            : indexRequest
              ? "git-index-result"
              : "configuration-result";
        configurationTask = (async () => {
          if (indexRequest || commitRequest || branchRestoreRequest)
            gitMetadataKernel ??= await createGitMetadataKernel({
              check() {
                if (closing || !process.connected) throw new Error("closing");
              },
            });
          else
            configurationKernel ??=
              process.platform === "win32"
                ? createWin32ConfigurationSaveKernel({
                    check() {
                      if (closing || !process.connected)
                        throw new Error("closing");
                    },
                    checkRoot: undefined,
                    timeoutMs: 10000,
                  })
                : await createConfigurationSaveKernel();
          const kernel = branchRestoreRequest
            ? gitMetadataKernel.branchRestore
            : commitRequest
              ? gitMetadataKernel.commit
              : indexRequest
                ? gitMetadataKernel.index
                : configurationKernel;
          if (closing) throw new Error("closing");
          const result = message.type.endsWith("-prepare")
            ? await kernel.prepare(message.operation)
            : message.type.endsWith("-publish")
              ? await kernel.publish({ token: message.token })
              : await kernel.abort({ token: message.token });
          configurationPrepared = ["staged", "prepared"].includes(result.status)
            ? result.token
            : undefined;
          if (!closing) {
            const response = {
              type: resultType,
              nonce,
              pid: process.pid,
              requestId: message.requestId,
              result,
            };
            validateHostMessage(response, "parent");
            emit(response);
          }
        })()
          .catch(() => {
            if (!closing)
              emit({
                type: resultType,
                requestId: message.requestId,
                result: { status: "unknown", reason: "io_failed" },
              });
          })
          .finally(() => {
            configurationActive = false;
          });
      } else if (message.type === "observe") {
        if (
          !ready ||
          closing ||
          observing ||
          taskPreparing ||
          taskHandoffing ||
          configurationActive ||
          configurationPrepared ||
          message.nonce !== nonce
        )
          throw new Error("invalid_observe");
        observing = true;
        observer
          .settle(1000)
          .then(
            (observation) => {
              if (!closing)
                emit({
                  type: "observation",
                  requestId: message.requestId,
                  ...observation,
                  allExited: observation.live === 0,
                });
            },
            () => {
              emit({ type: "hold" });
              void stop();
            },
          )
          .finally(() => {
            observing = false;
          });
      } else {
        if (nonce && message.nonce !== nonce) throw new Error("invalid_nonce");
        nonce ??= message.nonce;
        void stop();
      }
    } catch {
      emit({ type: "hold" });
      void stop();
    }
  });
  process.on("disconnect", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
  process.on("SIGINT", () => {
    void stop();
  });
  const initTimer = setTimeout(() => {
    void stop();
  }, 10000);
}

// Importing protocol helpers in Main/tests never initializes server or Bun.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runEventHostChild();
