import { isPathInside, killProcessTree } from "./platform-paths.mjs";
import { assertWindowsPrivateDirectories } from "./windows-acl.mjs";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  lstat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { EVENT_HOST_CODE_ASSETS } from "./event-host-resources.mjs";
import { createNativeSkillsClient } from "./native-skills-client.mjs";
import { createNativeAgentsClient } from "./native-agents-client.mjs";
import { createNativeExtensionsClient } from "./native-extensions-client.mjs";
import {
  eventHostEnvironment,
  validateHostMessage,
} from "./event-host-protocol.mjs";
import { initialization } from "./native-permission-control-input.mjs";
import { createNativeTaskLedger } from "./native-permission-task-ledger.mjs";
import { createNativeTaskRequestContext } from "./native-permission-task-request.mjs";

const VERSION = "2.0.18";
const ENGINE = "1.4.2";

// The package owner's module remains the authority for layout and byte validation.
export { eventHostForResources } from "./event-host-resources.mjs";

const contains = (parent, path) => isPathInside(parent, path);
function overlaps(a, b) {
  return contains(a, b) || contains(b, a);
}

// POSIX: owned by this uid with no group/other bits. Windows has neither; there
// the directory must be a real directory here and its DACL is verified in one
// batch (assertWindowsPrivateDirectories) by the caller.
const privateStat = (stat, platform) =>
  platform === "win32" ||
  (stat.uid === process.getuid() && !(stat.mode & 0o077));
async function checkedDirectory(path, platform = process.platform) {
  const stat = await lstat(path);
  if (
    !isAbsolute(path) ||
    (await realpath(path)) !== path ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !privateStat(stat, platform)
  )
    throw new Error("storage_denied");
}

// Injections belong to trusted Main and synthetic unit tests, never renderer input.
export async function startEventHost({
  eventHost,
  runtimeEpoch,
  namespace,
  owner,
  processIdentity,
  preflight,
  signal,
  port = 0,
  platform = process.platform,
  arch = process.arch,
  spawnProcess = spawn,
  createDirectory = mkdir,
  writeConfig = writeFile,
  removeRoot = rm,
  makeRoot = async () =>
    realpath(await mkdtemp(join(tmpdir(), "oh-my-own-code-event-host-"))),
  verifyResources,
  assertPrivateDirectories = assertWindowsPrivateDirectories,
  makeClient,
  startupTimeoutMs = 20_000,
  stopTimeoutMs = 5_000,
  requestTimeoutMs = 5_000,
  // Trusted Main callback: synchronous loss barrier for durable task authority.
  onTaskAuthorityLoss,
  // Trusted Main log sink for bounded, redacted child diagnostics.
  onDiagnostic,
} = {}) {
  // Main and the existing startup preflight reject every retained operation.
  // This empty original-key table never releases the graph's boot-held state.
  const permissionInit = initialization({ runtimeEpoch, bootHolds: [] });
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("invalid_sidecar_port");
  const aborted = () => {
    if (signal?.aborted) throw new Error("startup_aborted");
  };
  const guard = async () => {
    aborted();
    if (
      !namespace ||
      !owner ||
      (await owner.assertOwned(owner.getNonce())).state !== "ready"
    )
      throw new Error("owner_unverified");
    if (typeof preflight !== "function" || (await preflight()) !== true)
      throw new Error("native_startup_unverified");
    aborted();
  };
  await guard();
  const validator =
    verifyResources ??
    (await import("./event-host-resources.mjs")).verifyEventHostResources;
  const verifiedManifest = await validator(eventHost, {
    platform,
    arch,
    requirePermissionOverlay: true,
  });
  if (
    !verifyResources &&
    !EVENT_HOST_CODE_ASSETS.every((path) =>
      verifiedManifest.entries.some(
        (entry) =>
          entry.path === path && entry.type === "file" && entry.mode === 0o644,
      ),
    )
  )
    throw new Error("configuration_resources_unverified");
  aborted();
  const root = await makeRoot();
  const workspace = join(root, "workspace");
  const nonce = randomBytes(32).toString("hex");
  const password = randomBytes(32).toString("hex");
  const nativeTaskRequests = createNativeTaskRequestContext();
  // Live task correlation (assigned once the host channel exists). In memory
  // only; cleared on failure, stop and child exit.
  let ledger;
  const dropTaskAuthority = () => {
    ledger?.clear();
    try {
      onTaskAuthorityLoss?.();
    } catch {
      /* the loss barrier must not mask the original failure */
    }
  };
  let child,
    exitResult,
    resolveExit,
    ready,
    resolveReady,
    stopping = false;
  let spawnIntent = false;
  let uncertain = false,
    recorded = false,
    initialized = false,
    scopeClosed = false;
  let stopPromise,
    cleanupDone = false,
    failureReason,
    connected = false;
  let ownedIdentity,
    observationRequest,
    observationActive = false,
    pendingHostRequests = 0,
    taskPreparationRequest,
    taskHandoffRequest,
    taskPreparationActive = false,
    configurationRequest,
    configurationActive = false,
    configurationPrepared,
    configurationPreparedKind;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const readiness = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let wakeFailure;
  const failed = new Promise((resolve) => {
    wakeFailure = resolve;
  });
  const fail = (reason) => {
    nativeTaskRequests.close();
    dropTaskAuthority();
    uncertain = true;
    failureReason ??= reason;
    wakeFailure();
    if (connected && !stopping) void stop();
  };
  const bounded = (promise, ms, timeout) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeout)), ms);
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
  const live = () => {
    aborted();
    if (failureReason) throw new Error(failureReason);
    if (exitResult) throw new Error("sidecar_exited_early");
  };
  const onAbort = () => fail("startup_aborted");
  const send = (message) =>
    new Promise((resolve, reject) => {
      try {
        if (!child.connected) throw new Error("ipc_lost");
        child.send(message, (error) =>
          error ? reject(new Error("ipc_send_failed")) : resolve(),
        );
      } catch {
        reject(new Error("ipc_send_failed"));
      }
    });
  const stop = () => {
    if (cleanupDone)
      return Promise.resolve({
        exited: true,
        forced: false,
        cleanup: "already_stopped",
      });
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
      nativeTaskRequests.close();
      dropTaskAuthority();
      if (observationActive) fail("idle_interrupted");
      signal?.removeEventListener("abort", onAbort);
      let forced = false;
      if (child && !exitResult) {
        try {
          // Even a child rejected before init gets only a nonce-scoped stop.
          await bounded(
            send({ type: "stop", nonce }),
            stopTimeoutMs,
            "stop_send_timeout",
          );
          await bounded(exited, stopTimeoutMs, "stop_timeout");
        } catch {
          uncertain = true;
          forced = true;
          try {
            killProcessTree(child, "SIGKILL", { platform });
          } catch {
            /* exact handle only */
          }
          try {
            await bounded(exited, stopTimeoutMs, "exit_timeout");
          } catch {
            /* retain */
          }
        }
      }
      if (
        (spawnIntent && !child) ||
        (child &&
          (!exitResult ||
            !recorded ||
            !initialized ||
            !scopeClosed ||
            uncertain ||
            exitResult.code !== 0 ||
            exitResult.signal))
      )
        return {
          exited: false,
          forced,
          cleanup: "incomplete",
          recoveryPath: root,
        };
      try {
        if (
          Object.values(namespace).some(
            (path) =>
              typeof path === "string" &&
              isAbsolute(path) &&
              overlaps(root, path),
          )
        )
          throw new Error("disposable_root_overlap");
        await removeRoot(root, { recursive: true, force: false });
        cleanupDone = true;
        return { exited: true, forced, cleanup: "complete" };
      } catch {
        return {
          exited: false,
          forced,
          cleanup: "incomplete",
          recoveryPath: root,
        };
      }
    })();
    return stopPromise;
  };
  try {
    await checkedDirectory(root);
    if (
      Object.values(namespace).some(
        (path) =>
          typeof path === "string" && isAbsolute(path) && overlaps(root, path),
      )
    )
      throw new Error("disposable_root_overlap");
    await checkedDirectory(namespace.root);
    for (const key of ["config", "data", "state"]) {
      if (
        !contains(namespace.root, namespace[key]) ||
        namespace[key] === namespace.root
      )
        throw new Error("storage_denied");
      await checkedDirectory(namespace[key], platform);
    }
    for (const directory of ["home", "cache", "tmp", "workspace"])
      await createDirectory(join(root, directory), {
        recursive: true,
        mode: 0o700,
      });
    for (const directory of ["home", "cache", "tmp", "workspace"])
      await checkedDirectory(join(root, directory), platform);
    const configPath = join(namespace.config, "opencode");
    await createDirectory(configPath, { recursive: true, mode: 0o700 });
    await checkedDirectory(configPath, platform);
    await assertPrivateDirectories(
      [
        namespace.root,
        namespace.config,
        namespace.data,
        namespace.state,
        root,
        join(root, "home"),
        join(root, "cache"),
        join(root, "tmp"),
        join(root, "workspace"),
        configPath,
      ],
      { platform },
    );
    const configFile = join(configPath, "opencode.json");
    try {
      // Preserve the original supervisor's exclusive empty-config policy.
      // Child's explicit inline deny policy disables project discovery.
      await writeConfig(configFile, "{}\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await lstat(configFile);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        !privateStat(stat, platform)
      )
        throw new Error("storage_denied");
    }
    const database = join(namespace.data, "event-host.sqlite");
    for (const candidate of [
      database,
      `${database}-wal`,
      `${database}-shm`,
      `${database}-journal`,
    ]) {
      try {
        const stat = await lstat(candidate);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          !privateStat(stat, platform)
        )
          throw new Error("storage_denied");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await guard();
    // Detect resource mutation during profile setup before acquiring spawn intent.
    await validator(eventHost, {
      platform,
      arch,
      requirePermissionOverlay: true,
    });
    await guard();
    if ((await owner.markSpawnIntent(owner.getNonce())).state !== "ready")
      throw new Error("owner_unverified");
    spawnIntent = true;
    aborted();
    child = spawnProcess(eventHost.enginePath, [eventHost.hostPath], {
      cwd: workspace,
      env: eventHostEnvironment({
        platform,
        root,
        configPath,
        dataPath: namespace.data,
        statePath: namespace.state,
        systemRoot: process.env.SystemRoot,
      }),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    child.on("error", () => fail("child_error"));
    child.once("exit", (code, exitSignal) => {
      nativeTaskRequests.close();
      dropTaskAuthority();
      exitResult = { code, signal: exitSignal };
      try {
        processIdentity?.observeExit?.(child.pid);
      } catch {
        fail("identity_exit_failed");
      }
      resolveExit(exitResult);
      if (!stopping || !scopeClosed) fail("sidecar_exited_early");
    });
    child.on("disconnect", () => {
      if (!scopeClosed) fail("ipc_lost");
    });
    child.on("message", (message) => {
      try {
        validateHostMessage(message, "parent");
        if (
          !initialized ||
          message.nonce !== nonce ||
          message.pid !== child.pid
        )
          throw new Error("invalid_ipc");
        if (message.type === "ready") {
          if (
            ready ||
            stopping ||
            message.engineVersion !== ENGINE ||
            message.serverVersion !== VERSION ||
            (port && message.port !== port)
          )
            throw new Error("invalid_ipc");
          ready = message;
          resolveReady(message);
        } else if (message.type === "scope-closed") {
          if (
            !stopping ||
            scopeClosed ||
            message.observerGap ||
            message.live !== 0
          )
            throw new Error("scope_unconfirmed");
          scopeClosed = true;
        } else if (
          [
            "configuration-result",
            "git-branch-restore-result",
            "git-index-result",
            "git-commit-result",
          ].includes(message.type)
        ) {
          if (
            !configurationRequest ||
            configurationRequest.requestId !== message.requestId ||
            configurationRequest.resultType !== message.type ||
            stopping
          )
            throw new Error("unexpected_configuration_result");
          const pending = configurationRequest;
          configurationRequest = undefined;
          pending.resolve(message.result);
        } else if (message.type === "task-preparation") {
          if (
            !taskPreparationRequest ||
            stopping ||
            taskPreparationRequest.requestId !== message.requestId ||
            !isDeepStrictEqual(taskPreparationRequest.request, message.request)
          )
            throw new Error("unexpected_task_preparation");
          const pending = taskPreparationRequest;
          taskPreparationRequest = undefined;
          pending.resolve(message.result);
        } else if (message.type === "task-handoff-result") {
          if (
            !taskHandoffRequest ||
            stopping ||
            taskHandoffRequest.requestId !== message.requestId ||
            taskHandoffRequest.action !== message.action ||
            taskHandoffRequest.handoffId !== message.handoffId
          )
            throw new Error("unexpected_task_handoff");
          const pending = taskHandoffRequest;
          taskHandoffRequest = undefined;
          pending.resolve(message.status);
        } else if (message.type === "diagnostic") {
          try {
            onDiagnostic?.(message.diagnostic);
          } catch {
            /* logging must not affect the host */
          }
        } else if (message.type === "observation") {
          if (
            !observationRequest ||
            message.requestId !== observationRequest.requestId ||
            stopping
          )
            throw new Error("unexpected_observation");
          observationRequest.resolve(message);
          observationRequest = undefined;
        } else fail("child_hold");
      } catch {
        fail("invalid_ipc");
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    const identity = await bounded(
      Promise.race([
        processIdentity?.capture?.(child.pid),
        failed.then(() => {
          throw new Error("child_failed");
        }),
      ]),
      startupTimeoutMs,
      "identity_timeout",
    );
    live();
    if (
      !identity ||
      identity.pid !== child.pid ||
      !Number.isSafeInteger(child.pid) ||
      child.pid <= 0 ||
      (
        await bounded(
          owner.recordChild(owner.getNonce(), identity),
          startupTimeoutMs,
          "record_timeout",
        )
      ).state !== "ready"
    )
      throw new Error("owner_unverified");
    ownedIdentity = identity;
    recorded = true;
    live();
    initialized = true;
    await bounded(
      send({
        type: "init",
        nonce,
        runtimeEpoch: permissionInit.runtimeEpoch,
        password,
        port,
        root,
        workspace,
        configPath,
        namespaceRoot: namespace.root,
        dataPath: namespace.data,
        statePath: namespace.state,
        database,
        engineVersion: ENGINE,
        serverVersion: VERSION,
      }),
      startupTimeoutMs,
      "init_timeout",
    );
    await bounded(
      Promise.race([
        readiness,
        failed.then(() => {
          throw new Error("child_failed");
        }),
      ]),
      startupTimeoutMs,
      "sidecar_start_timeout",
    );
    live();
    const baseUrl = `http://127.0.0.1:${ready.port}`;
    const factory =
      makeClient ??
      (async (url, secret) => {
        const { OpenCode } = await import("@opencode/client");
        return OpenCode.make({
          baseUrl: url,
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`,
          },
          fetch: nativeTaskRequests.wrapFetch(async (request, init) => {
            live();
            if ((await owner.assertOwned(owner.getNonce())).state !== "ready") {
              fail("owner_unverified");
              throw new Error("owner_unverified");
            }
            live();
            nativeTaskRequests.assertCurrent();
            if (stopping || uncertain) throw new Error("event_host_held");
            return fetch(request, init);
          }),
        });
      });
    const rawClient = await bounded(
      Promise.race([
        Promise.resolve().then(() => factory(baseUrl, password)),
        failed.then(() => {
          throw new Error("child_failed");
        }),
      ]),
      requestTimeoutMs,
      "client_timeout",
    );
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
      : AbortSignal.timeout(requestTimeoutMs);
    const info = await bounded(
      Promise.race([
        rawClient.server.info({ signal: requestSignal }),
        failed.then(() => {
          throw new Error("child_failed");
        }),
      ]),
      requestTimeoutMs,
      "identity_request_timeout",
    );
    if (info.pid !== child.pid || info.version !== VERSION)
      throw new Error("sidecar_identity_mismatch");
    live();
    // Count SDK Promise calls and live async iterators through their settlement.
    // Stable cached wrappers preserve service method-identity comparisons.
    const proxies = new WeakMap();
    const track = (value) => {
      if (!value || (typeof value !== "object" && typeof value !== "function"))
        return value;
      if (proxies.has(value)) return proxies.get(value);
      if (typeof value === "function") {
        const wrapped = function (...args) {
          if (observationActive || stopping || uncertain || exitResult)
            throw new Error("event_host_held");
          pendingHostRequests++;
          let settled = false;
          const settle = () => {
            if (!settled) {
              settled = true;
              pendingHostRequests--;
            }
          };
          const output = (result) => {
            if (!result?.[Symbol.asyncIterator]) {
              settle();
              return result;
            }
            const iterator = result[Symbol.asyncIterator]();
            const advance = async (method, input) => {
              try {
                if (!iterator[method] && method === "throw") throw input;
                if (!iterator[method] && method === "next")
                  throw new TypeError("Invalid async iterator");
                const item = iterator[method]
                  ? await iterator[method](input)
                  : { done: true, value: input };
                if (item.done) settle();
                return item;
              } catch (error) {
                settle();
                throw error;
              }
            };
            return {
              [Symbol.asyncIterator]() {
                return this;
              },
              next: (input) => advance("next", input),
              return: (input) => advance("return", input),
              throw: (error) => advance("throw", error),
            };
          };
          try {
            const result = value.apply(this, args);
            if (result?.then)
              return Promise.resolve(result).then(
                (result) => {
                  try {
                    return output(result);
                  } catch (error) {
                    settle();
                    throw error;
                  }
                },
                (error) => {
                  settle();
                  throw error;
                },
              );
            return output(result);
          } catch (error) {
            settle();
            throw error;
          }
        };
        proxies.set(value, wrapped);
        return wrapped;
      }
      const proxy = new Proxy(value, {
        get: (target, key) => track(Reflect.get(target, key)),
      });
      proxies.set(value, proxy);
      return proxy;
    };
    // Single-flight host request to the child for task preparation/handoff.
    const taskCall = async (build, register) => {
      live();
      if (
        !connected ||
        stopping ||
        uncertain ||
        observationActive ||
        configurationActive ||
        configurationPrepared ||
        taskPreparationActive
      )
        throw new Error("task_preparation_held");
      taskPreparationActive = true;
      pendingHostRequests++;
      try {
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
        if (stopping || uncertain) throw new Error("task_preparation_held");
        const requestId = randomBytes(32).toString("hex");
        const message = build(requestId);
        validateHostMessage(message, "child");
        const response = new Promise((resolve) => register(requestId, resolve));
        await bounded(
          send(message),
          Math.min(startupTimeoutMs, 10000),
          "task_send_timeout",
        );
        const result = await bounded(
          Promise.race([
            response,
            failed.then(() => {
              throw new Error("task_preparation_held");
            }),
            exited.then(() => {
              throw new Error("task_preparation_held");
            }),
          ]),
          Math.min(startupTimeoutMs, 10000),
          "task_preparation_timeout",
        );
        live();
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
        if (stopping || uncertain) throw new Error("task_preparation_held");
        return result;
      } catch (error) {
        if (!stopping) fail("task_preparation_unconfirmed");
        throw error;
      } finally {
        taskPreparationRequest = undefined;
        taskHandoffRequest = undefined;
        taskPreparationActive = false;
        pendingHostRequests--;
      }
    };
    const taskLive = () => connected && !stopping && !uncertain && !exitResult;
    ledger = createNativeTaskLedger({
      runtimeEpoch: permissionInit.runtimeEpoch,
      isLive: taskLive,
      onUnconfirmed: () => fail("task_preparation_unconfirmed"),
      // Read-only complete scan of Native's sessions (absence cross-check and
      // fork-child discovery) for startup reconciliation. Exhausts the cursor
      // contract; any irregularity is an error, which always holds.
      listSessions: async () => {
        const all = [];
        const seen = new Set();
        let cursor;
        for (let page = 0; page < 100; page++) {
          const result = await bounded(
            Promise.resolve().then(() =>
              rawClient.session.list({
                limit: 100,
                ...(cursor && { cursor }),
              }),
            ),
            requestTimeoutMs,
            "reconcile_read_timeout",
          );
          const next = result?.cursor?.next;
          if (
            !Array.isArray(result?.data) ||
            result.data.length > 100 ||
            result.data.some((item) => typeof item?.id !== "string") ||
            (next !== undefined &&
              next !== null &&
              (typeof next !== "string" || !next.length || seen.has(next)))
          )
            throw new Error("reconcile_list_invalid");
          all.push(...result.data);
          if (next === undefined || next === null) return all;
          seen.add(next);
          cursor = next;
        }
        throw new Error("reconcile_list_invalid");
      },
      // Read-only observation of one planned session for startup reconciliation.
      readSession: (sessionID) =>
        bounded(
          Promise.resolve().then(() => rawClient.session.get({ sessionID })),
          requestTimeoutMs,
          "reconcile_read_timeout",
        ),
      channel: {
        prepare: (request) =>
          taskCall(
            (requestId) => ({
              type: "task-prepare",
              nonce,
              requestId,
              request,
            }),
            (requestId, resolve) => {
              taskPreparationRequest = { requestId, request, resolve };
            },
          ),
        arm: (request) =>
          taskCall(
            (requestId) => ({ type: "task-arm", nonce, requestId, request }),
            (requestId, resolve) => {
              taskHandoffRequest = {
                requestId,
                action: "arm",
                handoffId: request.handoffId,
                resolve,
              };
            },
          ),
        revoke: (handoffId) =>
          taskCall(
            (requestId) => ({
              type: "task-revoke",
              nonce,
              requestId,
              handoffId,
            }),
            (requestId, resolve) => {
              taskHandoffRequest = {
                requestId,
                action: "revoke",
                handoffId,
                resolve,
              };
            },
          ),
      },
    });
    const nativeTasks = Object.freeze({
      prepare: ledger.prepare,
      arm: ledger.arm,
      revoke: ledger.revoke,
      verify: ledger.verify,
      reconcile: ledger.reconcile,
    });
    const configurationCall = async (type, fields) => {
      const indexRequest = type.startsWith("git-index-");
      const commitRequest = type.startsWith("git-commit-");
      const branchRestoreRequest = type.startsWith("git-branch-restore-");
      const gitRequest = indexRequest || commitRequest || branchRestoreRequest;
      const kind = branchRestoreRequest
        ? "git-branch-restore"
        : commitRequest
          ? "git-commit"
          : indexRequest
            ? "git-index"
            : "configuration";
      live();
      if (
        !connected ||
        stopping ||
        observationActive ||
        configurationRequest ||
        configurationActive
      )
        throw new Error("configuration_busy");
      // Reserve before the owner await so a second request cannot replace correlation.
      configurationActive = true;
      pendingHostRequests++;
      try {
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
        const requestId = randomBytes(32).toString("hex");
        const message = { type, nonce, requestId, ...fields };
        validateHostMessage(message, "child");
        const response = new Promise((resolve) => {
          configurationRequest = {
            requestId,
            resolve,
            resultType: `${kind}-result`,
          };
        });
        await bounded(
          send(message),
          Math.min(startupTimeoutMs, 10000),
          "configuration_send_timeout",
        );
        const result = await bounded(
          Promise.race([
            response,
            failed.then(() => {
              throw new Error("configuration_failed");
            }),
          ]),
          Math.min(startupTimeoutMs, 10000),
          "configuration_timeout",
        );
        live();
        if (gitRequest) {
          const allowed = type.endsWith("-prepare")
            ? ["prepared", "unknown"]
            : type.endsWith("-publish")
              ? [commitRequest ? "committed" : "applied", "unknown"]
              : ["aborted", "unknown"];
          if (!allowed.includes(result.status))
            throw new Error("invalid_git_index_result");
          configurationPrepared =
            result.status === "prepared" ? result.token : undefined;
          configurationPreparedKind = configurationPrepared ? kind : undefined;
        } else if (type === "configuration-prepare") {
          if (!["staged", "unknown"].includes(result.status))
            throw new Error("invalid_configuration_result");
          if (result.status === "staged") {
            configurationPrepared = result.token;
            configurationPreparedKind = kind;
          }
        } else {
          if (
            type === "configuration-publish" &&
            !["saved", "unknown"].includes(result.status)
          )
            throw new Error("invalid_configuration_result");
          if (
            type === "configuration-abort" &&
            !["aborted", "unknown"].includes(result.status)
          )
            throw new Error("invalid_configuration_result");
          configurationPrepared = undefined;
          configurationPreparedKind = undefined;
        }
        return result;
      } catch {
        // A timed-out phase may still be touching files. Hold until owned exit.
        fail(
          branchRestoreRequest
            ? "git_branch_restore_unconfirmed"
            : commitRequest
              ? "git_commit_unconfirmed"
              : indexRequest
                ? "git_index_unconfirmed"
                : "configuration_unconfirmed",
        );
        // Logical failure does not settle an in-flight publisher. Keep its caller
        // and private artifact alive until the exact owned process has exited.
        if (gitRequest) await exited;
        throw new Error(
          branchRestoreRequest
            ? "git_branch_restore_unconfirmed"
            : commitRequest
              ? "git_commit_unconfirmed"
              : indexRequest
                ? "git_index_unconfirmed"
                : "configuration_unconfirmed",
        );
      } finally {
        configurationRequest = undefined;
        configurationActive = false;
        pendingHostRequests--;
      }
    };
    const configurationSave = {
      prepare(operation) {
        if (configurationPrepared)
          return Promise.reject(new Error("configuration_busy"));
        return configurationCall("configuration-prepare", { operation });
      },
      publish({ token }) {
        if (
          token !== configurationPrepared ||
          configurationPreparedKind !== "configuration"
        )
          return Promise.reject(new Error("invalid_configuration_token"));
        return configurationCall("configuration-publish", { token });
      },
      abort({ token }) {
        if (
          token !== configurationPrepared ||
          configurationPreparedKind !== "configuration"
        )
          return Promise.resolve({
            status: "unknown",
            reason: "invalid_token",
          });
        return configurationCall("configuration-abort", { token });
      },
    };
    const gitMetadataAdapter = (kind) => ({
      prepare(operation) {
        if (configurationPrepared)
          return Promise.reject(new Error("configuration_busy"));
        return configurationCall(`${kind}-prepare`, { operation });
      },
      publish({ token }) {
        if (
          token !== configurationPrepared ||
          configurationPreparedKind !== kind
        )
          return Promise.reject(
            new Error(
              kind === "git-branch-restore"
                ? "invalid_git_branch_restore_token"
                : kind === "git-index"
                  ? "invalid_git_index_token"
                  : "invalid_git_commit_token",
            ),
          );
        return configurationCall(`${kind}-publish`, { token });
      },
      abort({ token }) {
        if (
          token !== configurationPrepared ||
          configurationPreparedKind !== kind
        )
          return Promise.resolve({
            status: "unknown",
            reason: "invalid_request",
          });
        return configurationCall(`${kind}-abort`, { token });
      },
    });
    const gitIndex = gitMetadataAdapter("git-index"),
      gitCommit = gitMetadataAdapter("git-commit"),
      gitBranchRestore = gitMetadataAdapter("git-branch-restore");
    const client = track(rawClient);
    const nativeSkillApi = createNativeSkillsClient({
      client: rawClient,
      nonce,
      timeoutMs: requestTimeoutMs,
      assertLive: async () => {
        live();
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
      },
    });
    const nativeSkills = Object.freeze(
      Object.fromEntries(
        Object.entries(nativeSkillApi).map(([name, method]) => [
          name,
          track(method),
        ]),
      ),
    );
    const nativeAgentApi = createNativeAgentsClient({
      client: rawClient,
      nonce,
      timeoutMs: requestTimeoutMs,
      assertLive: async () => {
        live();
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
      },
    });
    const nativeAgents = Object.freeze(
      Object.fromEntries(
        Object.entries(nativeAgentApi).map(([name, method]) => [
          name,
          track(method),
        ]),
      ),
    );
    const nativeExtensionApi = createNativeExtensionsClient({
      // Track the nested RPC itself: a deadline must not hide an unsettled
      // request from owner shutdown/idle observation.
      client: { rpc: (namespace) => track(rawClient.rpc(namespace)) },
      nonce,
      timeoutMs: requestTimeoutMs,
      assertLive: async () => {
        live();
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        live();
      },
    });
    const nativeExtensions = Object.freeze({
      observe: track(nativeExtensionApi.observe),
    });
    const observeIdle = async () => {
      live();
      if (
        !connected ||
        stopping ||
        pendingHostRequests ||
        configurationPrepared ||
        observationActive
      )
        throw new Error("event_host_not_idle");
      observationActive = true;
      const checkOwner = async () => {
        if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        const current = await processIdentity.capture(child.pid);
        if (
          !current ||
          Object.entries(ownedIdentity).some(
            ([key, value]) => current[key] !== value,
          )
        )
          throw new Error("owner_unverified");
        live();
      };
      try {
        await bounded(
          checkOwner(),
          requestTimeoutMs,
          "observe_identity_timeout",
        );
        if (pendingHostRequests || observationRequest || stopping)
          throw new Error("event_host_not_idle");
        const requestId = randomBytes(32).toString("hex");
        const response = new Promise((resolve) => {
          observationRequest = { requestId, resolve };
        });
        await bounded(
          send({ type: "observe", nonce, requestId }),
          requestTimeoutMs,
          "observe_send_timeout",
        );
        const observation = await bounded(
          Promise.race([
            response,
            failed.then(() => {
              throw new Error("child_failed");
            }),
          ]),
          requestTimeoutMs,
          "observe_timeout",
        );
        await bounded(
          checkOwner(),
          requestTimeoutMs,
          "observe_identity_timeout",
        );
        if (observation.observerGap) {
          fail("descendant_unverified");
          throw new Error("idle_proof_failed");
        }
        if (
          pendingHostRequests ||
          stopping ||
          observation.live !== 0 ||
          !observation.allExited
        )
          throw new Error("event_host_not_idle");
        return {
          pid: child.pid,
          observerGap: false,
          live: 0,
          allExited: true,
          pendingHostRequests: 0,
          scope: "direct JS ChildProcess/Bun handles only",
        };
      } catch (error) {
        // A definite busy refusal does not assert exit. Protocol/identity loss holds.
        if (error.message !== "event_host_not_idle") fail("idle_proof_failed");
        throw new Error(
          error.message === "event_host_not_idle"
            ? "event_host_not_idle"
            : "idle_proof_failed",
        );
      } finally {
        observationRequest = undefined;
        observationActive = false;
      }
    };
    connected = true;
    return {
      snapshot: () =>
        exitResult || uncertain
          ? { state: "disconnected" }
          : { state: "connected", serverVersion: VERSION },
      workbenchContext: () => ({
        client,
        session: undefined,
        configurationSave,
        gitIndex,
        gitCommit,
        gitBranchRestore,
        nativeSkills,
        nativeAgents,
        nativeExtensions,
        nativeTaskRequests,
        nativeTasks,
      }),
      stop,
      observeIdle,
      processId: child.pid,
      workspace,
      eventHost,
    };
  } catch (error) {
    if (child) uncertain = true;
    const cleanup = await stop();
    const failure = new Error("OpenCode event host unavailable");
    failure.reason = /^[a-z_]+$/.test(error.message)
      ? error.message
      : "event_host_failed";
    failure.cleanupComplete = cleanup.exited && cleanup.cleanup === "complete";
    failure.stopOwnedSidecar = stop;
    if (cleanup.recoveryPath) failure.recoveryPath = cleanup.recoveryPath;
    throw failure;
  } finally {
    // Keep IPC/exit observers for the complete owned lifetime.
    if (!child || stopping) signal?.removeEventListener("abort", onAbort);
  }
}
