import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateHostMessage } from "./event-host-protocol.mjs";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import { verifyEventHostResources } from "./event-host-resources.mjs";

import { createGitMetadataKernel } from "./host/git-metadata-kernel.mjs";
import { createConfigurationSaveKernel } from "./host/configuration-save-kernel.mjs";

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
const contains = (root, path) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
};
function directory(path) {
  const stat = lstatSync(path);
  if (
    realpathSync(path) !== path ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    throw new Error("storage_denied");
}
function guardInit(input) {
  const resourceRoot = dirname(fileURLToPath(import.meta.url));
  if (
    globalThis.Bun?.version !== "1.4.2" ||
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    process.execPath !== join(resourceRoot, "runtime", "bun")
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
        stat.uid !== process.getuid() ||
        stat.mode & 0o077
      )
        throw new Error("storage_denied");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const expected = {
    HOME: join(input.root, "home"),
    XDG_CONFIG_HOME: input.configPath,
    XDG_DATA_HOME: input.dataPath,
    XDG_STATE_HOME: input.statePath,
    XDG_CACHE_HOME: join(input.root, "cache"),
    TMPDIR: join(input.root, "tmp"),
    TMP: join(input.root, "tmp"),
    TEMP: join(input.root, "tmp"),
    OPENCODE_CONFIG_DIR: input.configPath,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
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

export function runEventHostChild() {
  let nonce,
    initialized = false,
    closing = false,
    importing = false,
    ready = false,
    observing = false;
  let scope, fiber, Effect, Scope, Exit, Fiber, observer, initialization;
  let gitMetadataKernel;
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
    clearTimeout(initTimer);
    try {
      // Initialization can be between async imports and scope/fiber creation.
      // Wait for it to acknowledge closing before attempting scope finalization.
      if (importing && initialization)
        await bounded(
          initialization.catch(() => {}),
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
    process.umask(0o077);
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
        enginePath: join(resourceRoot, "runtime/bun"),
        hostPath: join(resourceRoot, "host.mjs"),
        manifestPath: join(resourceRoot, "manifest.json"),
      },
      { platform: process.platform, arch: process.arch },
    );
    if (closing) throw new Error("startup_held");
    ({ Effect, Scope, Exit, Fiber } = await import("effect"));
    if (closing) throw new Error("startup_held");
    const { start } = await import("@opencode/server/process");
    if (closing) throw new Error("startup_held");
    scope = await Effect.runPromise(Scope.make());
    if (closing) throw new Error("startup_held");
    fiber = Effect.runFork(
      start({
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
      }).pipe(Effect.provideService(Scope.Scope, scope)),
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
          else configurationKernel ??= await createConfigurationSaveKernel();
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
