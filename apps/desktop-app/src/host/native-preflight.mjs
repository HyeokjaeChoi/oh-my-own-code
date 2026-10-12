import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { spawn as spawnProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { STORE_RECOVERY_REASONS, validWireId } from "../workbench-contract.mjs";
import { EVENT_HOST_CONFIG } from "../event-host-protocol.mjs";
import { verifyNativePreflightResources } from "../native-preflight-resources.mjs";
import {
  PREFLIGHT_LIMITS,
  validatePreflightRequest,
  validatePreflightDecision,
} from "../native-preflight-protocol.mjs";

const LIMITS = [256, 64, 4, 64].map((value) => value * 1024 ** 2);
const SUFFIXES = ["", "-wal", "-shm", "-journal"];
const fail = () => {
  throw new Error("native_startup_unverified");
};
const sameStat = (a, b) =>
  [
    "dev",
    "ino",
    "uid",
    "gid",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ].every((key) => a[key] === b[key]);
const inside = (root, value) => {
  const path = relative(root, value);
  return (
    path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  );
};
const sameDirectoryIdentity = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);
const overlaps = (a, b) => a === b || inside(a, b) || inside(b, a);
function owned(stat, directory) {
  if (
    stat.uid !== BigInt(process.getuid()) ||
    (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
  )
    fail();
}
function viewBinding(registry) {
  if (registry.status().state !== "ready" || registry.status().closed) fail();
  const { observationSequence: _sequence, ...view } = registry.readView();
  // Retained operations are tolerated ONLY as the reconciler's plan: each one
  // an unsettled bootstrap create with a recognised durable trail, every
  // recovery resource explained by those candidates. The strict path below (no
  // retained operation, nothing unavailable) is unchanged.
  const plan = registry.reconcilePlan?.() ?? { eligible: true, candidates: [] };
  const reconciling = plan.candidates.length > 0;
  if (
    view.recovery.store.state !== "ready" ||
    !validWireId(view.runtimeEpoch) ||
    !Number.isSafeInteger(view.revision) ||
    (reconciling
      ? !plan.eligible ||
        view.retainedOperations.length !== plan.candidates.length
      : view.state !== "ready" ||
        view.recovery.resources.length ||
        view.retainedOperations.length)
  )
    fail();
  return view;
}
// Sessions an unsettled bootstrap create may have produced before the crash.
function provisionalFor(registry) {
  const plan = registry.reconcilePlan?.() ?? { candidates: [] };
  return plan.candidates
    .filter(({ operation }) => operation.identity.type !== "session.fork")
    .map(({ operation }) => ({
      appSessionId: operation.reservation.appSessionId,
      nativeSessionId: operation.reservation.plannedNativeSessionId,
      workspaceId: operation.reservation.workspace.workspaceId,
      canonicalPath: operation.reservation.workspace.canonicalPath,
      operationId: operation.identity.operationId,
      originalRuntimeEpoch: operation.identity.runtimeEpoch,
      digest: operation.identity.digest,
    }));
}
// Fork children an unsettled bootstrap fork may have produced (id unknown).
function forkChildrenFor(registry, mappings) {
  const plan = registry.reconcilePlan?.() ?? { candidates: [] };
  return plan.candidates
    .filter(({ operation }) => operation.identity.type === "session.fork")
    .map(({ operation }) => {
      const parent = mappings.find(
        (mapping) => mapping.appSessionId === operation.identity.sessionId,
      );
      if (!parent) fail();
      return {
        appSessionId: operation.reservation.appSessionId,
        workspaceId: parent.workspaceId,
        canonicalPath: parent.canonicalPath,
        parentAppSessionId: parent.appSessionId,
        parentNativeSessionId: parent.nativeSessionId,
      };
    });
}
function mappingsFor(view, provisional = [], forkApps = []) {
  // A candidate's own partial session mapping is judged as provisional.
  const planned = new Set([
    ...provisional.map((entry) => entry.appSessionId),
    ...forkApps,
  ]);
  const mappings = view.sessions
    .filter((session) => !planned.has(session.appSessionId))
    .map((session) => {
      const workspace = view.workspaces.find(
        (value) => value.workspaceId === session.workspaceId,
      );
      if (
        !workspace ||
        session.lifecycleState !== "active" ||
        session.status !== "idle"
      )
        fail();
      return {
        appSessionId: session.appSessionId,
        nativeSessionId: session.nativeSessionId,
        workspaceId: session.workspaceId,
        canonicalPath: workspace.canonicalPath,
        ...(session.parentSessionId && {
          parentAppSessionId: session.parentSessionId,
        }),
      };
    });
  return mappings.sort((a, b) => a.appSessionId.localeCompare(b.appSessionId));
}
function confirmed(registry, identity, mapping, kind) {
  if (!identity) fail();
  const key = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  if (!isDeepStrictEqual(registry.lookupIdentity(key), identity)) fail();
  const found = registry.lookup(key);
  const receipt = found?.receipt;
  if (
    found?.status !== "found" ||
    receipt?.effect !== "confirmed" ||
    !["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
      (field) => receipt[field] === identity[field],
    ) ||
    receipt.result?.kind !== kind ||
    receipt.result.workspaceId !== mapping.workspaceId ||
    receipt.result.sessionId !== mapping.appSessionId ||
    receipt.result.nativeSessionId !== mapping.nativeSessionId
  )
    fail();
}
function correlate(registry, mappings, provisional, decision) {
  const roots = mappings.filter((mapping) => !mapping.parentAppSessionId);
  // Provisional sessions are checked by the reader against their own original
  // operation; only mapped roots need a confirmed receipt here.
  const planned = new Set(provisional.map((entry) => entry.nativeSessionId));
  decision = {
    ...decision,
    correlations: decision.correlations.filter(
      (entry) => !planned.has(entry.nativeSessionId),
    ),
  };
  if (decision.correlations.length !== roots.length) fail();
  for (const mapping of mappings) {
    if (mapping.parentAppSessionId) {
      const identity = registry.lookupForkIdentity({
        appSessionId: mapping.appSessionId,
      });
      if (
        identity?.type !== "session.fork" ||
        identity.workspaceId !== mapping.workspaceId ||
        identity.sessionId !== mapping.parentAppSessionId
      )
        fail();
      confirmed(registry, identity, mapping, "forked");
      continue;
    }
    const correlation = decision.correlations.find(
      (entry) => entry.nativeSessionId === mapping.nativeSessionId,
    );
    if (
      !correlation ||
      correlation.appSessionId !== mapping.appSessionId ||
      correlation.workspaceId !== mapping.workspaceId
    )
      fail();
    const identity = registry.lookupIdentity({
      runtimeEpoch: correlation.runtimeEpoch,
      operationId: correlation.operationId,
    });
    if (
      !identity ||
      !["session.create", "workspace.import", "workspace.create"].includes(
        identity.type,
      ) ||
      identity.digest !== correlation.digest ||
      (identity.workspaceId !== undefined &&
        identity.workspaceId !== mapping.workspaceId)
    )
      fail();
    confirmed(registry, identity, mapping, "created");
  }
}

// Injection is constructor-only for bounded host tests. Stored/renderer inputs
// cannot select a process, filesystem implementation, verifier or deadline.
export function createNativePreflight({
  namespace,
  owner,
  registry,
  eventHost,
  processIdentity,
  signal,
  io = fs,
  spawn = spawnProcess,
  resourceVerifier = verifyNativePreflightResources,
  deadlineMs = PREFLIGHT_LIMITS.deadlineMs,
  stopTimeoutMs = 2000,
} = {}) {
  let flight;
  let current;
  let closed = false;
  let uncertain = false;
  let latestReason = "native_startup_unverified";
  const timeout = Math.max(
    1,
    Math.min(PREFLIGHT_LIMITS.deadlineMs, deadlineMs),
  );
  const stopTimeout = Math.max(1, Math.min(5000, stopTimeoutMs));
  const abort = () => current?.controller.abort();
  signal?.addEventListener("abort", abort);
  async function fence(context) {
    if (
      closed ||
      uncertain ||
      signal?.aborted ||
      context.controller.signal.aborted
    )
      fail();
    if (!context.nonce || owner.getNonce() !== context.nonce) fail();
    const status = await owner.assertOwned(context.nonce);
    if (status.state !== "ready") {
      latestReason = STORE_RECOVERY_REASONS.includes(status.reason)
        ? status.reason
        : "owner_unverified";
      fail();
    }
    if (
      closed ||
      signal?.aborted ||
      context.controller.signal.aborted ||
      owner.getNonce() !== context.nonce
    )
      fail();
  }
  async function directory(context, path) {
    await fence(context);
    if (resolve(path) !== path || (await io.realpath(path)) !== path) fail();
    const stat = await io.lstat(path, { bigint: true });
    owned(stat, true);
    const handle = await io.open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    context.directories.push({ path, stat, handle });
    if (!sameStat(stat, await handle.stat({ bigint: true }))) fail();
    const names = (await io.readdir(path)).sort();
    if (names.length > 200) fail();
    context.directories.at(-1).names = names;
    await fence(context);
    return names;
  }
  async function file(context, path, limit, optional = false) {
    await fence(context);
    let stat;
    try {
      stat = await io.lstat(path, { bigint: true });
    } catch (error) {
      if (optional && error.code === "ENOENT") {
        context.absent.push(path);
        return undefined;
      }
      throw error;
    }
    owned(stat, false);
    if (stat.size > BigInt(limit)) fail();
    const handle = await io.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const entry = { path, stat, handle };
    context.files.push(entry);
    if (!sameStat(stat, await handle.stat({ bigint: true }))) fail();
    await fence(context);
    return entry;
  }
  async function workspaceDirectory(context, path) {
    await fence(context);
    if (resolve(path) !== path || (await io.realpath(path)) !== path) fail();
    const stat = await io.lstat(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    await io.access(path, constants.R_OK | constants.X_OK);
    const handle = await io.open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    context.directories.push({ path, stat, handle, workspace: true });
    if (!sameDirectoryIdentity(stat, await handle.stat({ bigint: true })))
      fail();
    await fence(context);
  }
  async function read(context, entry, destination) {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let length = 0;
    for (;;) {
      await fence(context);
      const { bytesRead } = await entry.handle.read(
        buffer,
        0,
        buffer.length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
      if (BigInt(length) > entry.stat.size) fail();
      hash.update(buffer.subarray(0, bytesRead));
      if (destination) {
        let written = 0;
        while (written < bytesRead) {
          await fence(context);
          const value = await destination.write(
            buffer,
            written,
            bytesRead - written,
            length - bytesRead + written,
          );
          if (value.bytesWritten < 1) fail();
          written += value.bytesWritten;
        }
      }
    }
    if (BigInt(length) !== entry.stat.size) fail();
    if (
      !sameStat(entry.stat, await entry.handle.stat({ bigint: true })) ||
      !sameStat(entry.stat, await io.lstat(entry.path, { bigint: true }))
    )
      fail();
    return hash.digest("hex");
  }
  // Failure/cancellation still verifies originals, without granting or spawning.
  async function unchanged(context) {
    for (const directory of context.directories) {
      if (directory.workspace) {
        if (
          !sameDirectoryIdentity(
            directory.stat,
            await directory.handle.stat({ bigint: true }),
          ) ||
          !sameDirectoryIdentity(
            directory.stat,
            await io.lstat(directory.path, { bigint: true }),
          ) ||
          (await io.realpath(directory.path)) !== directory.path
        )
          fail();
        await io.access(directory.path, constants.R_OK | constants.X_OK);
        continue;
      }
      if (
        !sameStat(
          directory.stat,
          await directory.handle.stat({ bigint: true }),
        ) ||
        !sameStat(
          directory.stat,
          await io.lstat(directory.path, { bigint: true }),
        ) ||
        !isDeepStrictEqual(
          directory.names,
          (await io.readdir(directory.path)).sort(),
        ) ||
        (await io.realpath(directory.path)) !== directory.path
      )
        fail();
    }
    for (const entry of context.files) {
      if (
        !sameStat(entry.stat, await entry.handle.stat({ bigint: true })) ||
        !sameStat(entry.stat, await io.lstat(entry.path, { bigint: true }))
      )
        fail();
      if (entry.hash) {
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        for (;;) {
          const { bytesRead } = await entry.handle.read(
            buffer,
            0,
            buffer.length,
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
          if (BigInt(offset) > entry.stat.size) fail();
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (
          BigInt(offset) !== entry.stat.size ||
          hash.digest("hex") !== entry.hash ||
          !sameStat(entry.stat, await entry.handle.stat({ bigint: true })) ||
          !sameStat(entry.stat, await io.lstat(entry.path, { bigint: true }))
        )
          fail();
      }
    }
    for (const path of context.absent) {
      try {
        await io.lstat(path);
        fail();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  async function prepare(context) {
    const base = join(namespace.data, "event-host.sqlite");
    for (const path of [namespace.root, join(namespace.root, "native")])
      await directory(context, path);
    const configNames = await directory(context, namespace.config);
    if (!isDeepStrictEqual(configNames, ["opencode"])) fail();
    if (
      !isDeepStrictEqual(
        await directory(context, join(namespace.config, "opencode")),
        ["opencode.json"],
      )
    )
      fail();
    const config = await file(
      context,
      join(namespace.config, "opencode", "opencode.json"),
      64,
    );
    const bytes = Buffer.alloc(Number(config.stat.size));
    await config.handle.read(bytes, 0, bytes.length, 0);
    if (bytes.toString("utf8") !== "{}\n") fail();
    config.hash = await read(context, config);
    const stateNames = await directory(context, namespace.state);
    if (stateNames.some((name) => name !== "opencode")) fail();
    if (
      stateNames.length &&
      (await directory(context, join(namespace.state, "opencode"))).length
    )
      fail();
    const dataNames = await directory(context, namespace.data);
    const allowed = SUFFIXES.map(
      (suffix) => `event-host.sqlite${suffix}`,
    ).concat("opencode");
    if (dataNames.some((name) => !allowed.includes(name))) fail();
    if (dataNames.includes("opencode")) {
      const root = join(namespace.data, "opencode");
      const names = await directory(context, root);
      if (names.some((name) => !["repos", "shell", "log"].includes(name)))
        fail();
      for (const name of names) {
        const entries = await directory(context, join(root, name));
        if (name !== "shell" && entries.length) fail();
        for (const entry of entries) {
          if (
            (entry !== "global" && !/^[a-f0-9]{40}$/.test(entry)) ||
            (await directory(context, join(root, name, entry))).length
          )
            fail();
        }
      }
    }
    const manifest = await file(
      context,
      join(namespace.root, "manifest.json"),
      16384,
    );
    const manifestBytes = Buffer.alloc(Number(manifest.stat.size));
    await manifest.handle.read(manifestBytes, 0, manifestBytes.length, 0);
    const value = JSON.parse(manifestBytes.toString("utf8"));
    if (
      value.schemaVersion !== 5 ||
      value.nativeVersion !== "2.0.18" ||
      value.storageGeneration !== 1 ||
      !isDeepStrictEqual(value.paths, {
        root: namespace.root,
        metadata: namespace.metadata,
        config: namespace.config,
        data: namespace.data,
        state: namespace.state,
        database: base,
      })
    )
      fail();
    manifest.hash = await read(context, manifest);
    for (let i = 0; i < SUFFIXES.length; i++) {
      const entry = await file(
        context,
        `${base}${SUFFIXES[i]}`,
        LIMITS[i],
        i !== 0,
      );
      if (entry) context.databaseFiles.push(entry);
    }
    const parent = await io.realpath(tmpdir());
    const copy = await io.mkdtemp(join(parent, "omoc-native-preflight-"));
    context.copy = await io.realpath(copy);
    if (
      context.copy !== copy ||
      [namespace.root, namespace.documents, eventHost.root].some((path) =>
        overlaps(copy, path),
      )
    )
      fail();
    context.copyStat = await io.lstat(copy, { bigint: true });
    owned(context.copyStat, true);
    for (const name of ["home", "config", "data", "state", "cache", "tmp"])
      await io.mkdir(join(copy, name), { mode: 0o700 });
    context.database = join(copy, "data", "event-host.sqlite");
    for (const entry of context.databaseFiles) {
      const suffix = entry.path.slice(base.length);
      const target = await io.open(
        `${context.database}${suffix}`,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        entry.hash = await read(context, entry, target);
        await target.sync();
      } finally {
        await target.close();
      }
    }
    for (const path of [join(copy, "data"), copy]) {
      const handle = await io.open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await unchanged(context);
    await fence(context);
  }
  async function inspector(context, request, resources) {
    await fence(context);
    const child = spawn(resources.engine, [resources.entry], {
      cwd: context.copy,
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: join(context.copy, "home"),
        XDG_CONFIG_HOME: join(context.copy, "config"),
        XDG_DATA_HOME: join(context.copy, "data"),
        XDG_STATE_HOME: join(context.copy, "state"),
        XDG_CACHE_HOME: join(context.copy, "cache"),
        TMPDIR: join(context.copy, "tmp"),
        TMP: join(context.copy, "tmp"),
        TEMP: join(context.copy, "tmp"),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(context.copy, "cache"),
        OPENCODE_CONFIG_DIR: join(context.copy, "config"),
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        MSGPACKR_NATIVE_ACCELERATION_DISABLED: "true",
      },
    });
    context.child = child;
    context.exited = false;
    let failed = false;
    let size = 0;
    const chunks = [];
    let timer;
    const stop = () => {
      child.stdin?.destroy();
      try {
        child.kill("SIGTERM");
      } catch {
        failed = true;
      }
    };
    context.controller.signal.addEventListener("abort", stop);
    context.exit = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => {
        context.exited = true;
        clearTimeout(timer);
        try {
          processIdentity?.observeExit?.(child.pid);
        } catch {
          failed = true;
        }
        context.exitResult = { code, signal };
      });
      child.once("close", () => {
        if (!context.exited && !child.pid) context.exited = true;
        resolveExit(context.exitResult ?? { code: undefined });
      });
      child.once("error", () => {
        failed = true;
        context.controller.abort();
      });
    });
    child.stdin?.on("error", () => {
      failed = true;
      context.controller.abort();
    });
    child.stdout?.on("data", (bytes) => {
      size += bytes.length;
      if (size > PREFLIGHT_LIMITS.responseBytes) {
        failed = true;
        context.controller.abort();
      } else chunks.push(bytes);
    });
    timer = setTimeout(() => context.controller.abort(), timeout);
    try {
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) fail();
      context.processIdentity = await processIdentity.capture(child.pid);
      if (!context.processIdentity || context.processIdentity.pid !== child.pid)
        fail();
      await fence(context);
      child.stdin.write(`${JSON.stringify(request)}\n`);
      // Keep the pipe open: EOF is the child's parent-loss signal.
      const result = await Promise.race([
        context.exit,
        new Promise((resolveAbort) => {
          if (context.controller.signal.aborted) resolveAbort(undefined);
          else
            context.controller.signal.addEventListener(
              "abort",
              () => resolveAbort(undefined),
              { once: true },
            );
        }),
      ]);
      if (
        !result ||
        failed ||
        result.code !== 0 ||
        result.signal ||
        context.controller.signal.aborted
      )
        fail();
      const bytes = Buffer.concat(chunks);
      const text = bytes.toString("utf8");
      if (
        !Buffer.from(text).equals(bytes) ||
        !text.endsWith("\n") ||
        text.slice(0, -1).includes("\n")
      )
        fail();
      return validatePreflightDecision(JSON.parse(text), request.nonce);
    } finally {
      clearTimeout(timer);
      context.controller.signal.removeEventListener("abort", stop);
      if (!context.exited) {
        stop();
        let exited = await bounded(
          context.exit.then(() => true),
          stopTimeout,
          false,
        );
        if (!exited) {
          try {
            child.kill("SIGKILL");
          } catch {
            failed = true;
          }
          exited = await bounded(
            context.exit.then(() => true),
            stopTimeout,
            false,
          );
        }
        if (!exited) uncertain = true;
      }
      child.stdin?.destroy();
    }
  }
  async function run() {
    const context = {
      nonce: owner.getNonce(),
      controller: new AbortController(),
      directories: [],
      files: [],
      absent: [],
      databaseFiles: [],
      exited: true,
    };
    current = context;
    latestReason = "native_startup_unverified";
    let allowed = false;
    try {
      await fence(context);
      const view = viewBinding(registry);
      context.view = view;
      if (namespace.fresh === true) {
        await fence(context);
        if (!isDeepStrictEqual(view, viewBinding(registry))) fail();
        allowed = true;
      } else {
        const provisional = provisionalFor(registry);
        const forkApps = registry
          .reconcilePlan?.()
          .candidates.filter(
            ({ operation }) => operation.identity.type === "session.fork",
          )
          .map(({ operation }) => operation.reservation.appSessionId);
        const mappings = mappingsFor(view, provisional, forkApps ?? []);
        const forkChildren = forkChildrenFor(registry, mappings);
        for (const path of [
          ...new Set(mappings.map((mapping) => mapping.canonicalPath)),
        ])
          await workspaceDirectory(context, path);
        const resources = await resourceVerifier(eventHost);
        await fence(context);
        await prepare(context);
        const request = validatePreflightRequest({
          version: 1,
          nonce: randomBytes(32).toString("hex"),
          database: context.database,
          mappings,
          ...(provisional.length && { provisional }),
          ...(forkChildren.length && { provisionalForks: forkChildren }),
        });
        const decision = await inspector(context, request, resources);
        await fence(context);
        await unchanged(context);
        if (!isDeepStrictEqual(resources, await resourceVerifier(eventHost)))
          fail();
        await fence(context);
        if (!isDeepStrictEqual(view, viewBinding(registry))) fail();
        if (!decision.allowed) {
          latestReason = decision.reason;
          return false;
        }
        if (
          decision.counts.sessions < mappings.length ||
          decision.counts.sessions >
            mappings.length + provisional.length + forkChildren.length ||
          decision.counts.pending !== 0 ||
          decision.counts.inbox !== 0 ||
          decision.counts.kv !== 0 ||
          decision.counts.migrations !== 48
        )
          fail();
        correlate(registry, mappings, provisional, decision);
        await fence(context);
        if (!isDeepStrictEqual(view, viewBinding(registry))) fail();
        // The inline policy is fixed in source; result cannot select startup flags.
        if (EVENT_HOST_CONFIG !== JSON.stringify(JSON.parse(EVENT_HOST_CONFIG)))
          fail();
        allowed = true;
      }
    } catch {
      allowed = false;
    } finally {
      try {
        await unchanged(context);
      } catch {
        uncertain = true;
        allowed = false;
        latestReason = "native_startup_unverified";
      }
      if (context.copy && context.exited && !uncertain) {
        try {
          if ((await io.realpath(context.copy)) !== context.copy) fail();
          const copyStat = await io.lstat(context.copy, { bigint: true });
          owned(copyStat, true);
          if (
            !["dev", "ino", "uid", "mode"].every(
              (key) => copyStat[key] === context.copyStat[key],
            )
          )
            fail();
          await io.rm(context.copy, { recursive: true, force: false });
          context.copy = undefined;
        } catch {
          uncertain = true;
          allowed = false;
        }
      }
      try {
        await unchanged(context);
      } catch {
        uncertain = true;
        allowed = false;
        latestReason = "native_startup_unverified";
      }
      for (const entry of [...context.files, ...context.directories]) {
        try {
          await entry.handle.close();
        } catch {
          uncertain = true;
          allowed = false;
        }
      }
    }
    if (allowed) {
      try {
        await fence(context);
        if (!isDeepStrictEqual(context.view, viewBinding(registry))) fail();
      } catch {
        allowed = false;
      }
    }
    return allowed && !closed && !uncertain && !signal?.aborted;
  }
  async function bounded(task, ms, value) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((resolveWait) => {
          timer = setTimeout(() => resolveWait(value), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    check() {
      if (flight || closed || uncertain || signal?.aborted)
        return Promise.resolve(false);
      const task = run();
      flight = task;
      task
        .finally(() => {
          if (flight === task) flight = undefined;
        })
        .catch(() => {});
      return task;
    },
    reason: () => latestReason,
    async close() {
      closed = true;
      signal?.removeEventListener("abort", abort);
      abort();
      const settled =
        !flight ||
        (await bounded(
          flight.then(
            () => true,
            () => true,
          ),
          5000,
          false,
        ));
      const complete =
        settled &&
        !uncertain &&
        (!current?.child || current.exited) &&
        !current?.copy;
      return {
        exited: !current?.child || current.exited,
        cleanup: complete ? "complete" : "incomplete",
        ...(current?.copy && { recoveryPath: current.copy }),
      };
    },
  };
}
