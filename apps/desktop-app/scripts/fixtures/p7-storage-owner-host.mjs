import { policyMatches } from "../../src/renderer/shared/configuration-draft/policy.mjs";
// Test-only zero-window Electron owner. Never imports/launches production main.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOSProcessIdentityAdapter,
  startSidecar,
  openDurableManifest,
  freshNativePreflight,
} from "../../src/sidecar-supervisor.mjs";
import { prepareDurableNamespace } from "../../src/ephemeral-profile.mjs";
import {
  createElectronOwnerKernel,
  createProcessVerifier,
  createStorageOwner,
} from "../../src/host/storage-lock.mjs";

import { createLifetimeWitness } from "../../src/host/owner-lifetime.mjs";
import { createNativePreflight } from "../../src/host/native-preflight.mjs";
import { mcpNativeName } from "../../src/host/workbench-mcp.mjs";
import { INSTRUCTION_KEY } from "../../src/host/workbench-instructions.mjs";
import { configurationFileWriteFits } from "../../src/renderer/shared/configuration-draft/validation.mjs";

// Observe the real SDK methods; do not replace their implementation or results.
export function observeInstructionClient(client, counts) {
  const entry = client?.session?.instructions?.entry;
  for (const method of ["list", "put", "remove"]) {
    if (typeof entry?.[method] !== "function") continue;
    const original = entry[method];
    entry[method] = (...args) => {
      counts[method]++;
      return original(...args);
    };
  }
  return client;
}

export function createSyntheticInstructionConfirmation(namespace, state) {
  return async (request) => {
    const fields = [
      "action",
      "workspaceId",
      "sessionId",
      "sessionTitle",
      "workspacePath",
      "expectedRegistrationVersion",
    ];
    assert.ok(Object.isFrozen(request));
    assert.ok(["apply", "remove"].includes(request.action));
    if (request.action === "apply")
      fields.push("targetPath", "digest", "sourceVersion", "empty");
    assert.deepEqual(Object.keys(request).sort(), fields.sort());
    for (const name of [
      "workspaceId",
      "sessionId",
      "sessionTitle",
      "workspacePath",
    ])
      assert.equal(typeof request[name], "string");
    assert.match(request.expectedRegistrationVersion, /^[a-f0-9]{64}$/);
    assert.ok(resolve(request.workspacePath).startsWith(`${namespace}/`));
    if (request.action === "apply") {
      assert.equal(
        request.targetPath,
        join(request.workspacePath, "AGENTS.md"),
      );
      for (const name of ["digest", "sourceVersion"])
        assert.match(request[name], /^[a-f0-9]{64}$/);
      assert.equal(typeof request.empty, "boolean");
    }
    assert.ok(state.requests.length < 128);
    state.requests.push({ ...request });
    return state.enabled === true;
  };
}

// Counts are observations around the original SDK methods, never replacements.
export function observeMcpClient(client, counts, fault = {}) {
  for (const method of ["list", "add", "connect", "disconnect", "remove"]) {
    if (typeof client?.mcp?.[method] !== "function") continue;
    const original = client.mcp[method];
    client.mcp[method] = async (...args) => {
      counts[method]++;
      const result = await original(...args);
      if (method === "add" && fault.nextAddPostread) {
        fault.nextAddPostread = false;
        fault.failRead = true;
      } else if (method === "list" && fault.failRead) {
        fault.failRead = false;
        throw new Error("Explicit synthetic post-add read failure");
      }
      return result;
    };
  }
  return client;
}
export function createSyntheticMcpConfirmation(namespace, state) {
  return async (request) => {
    assert.ok(Object.isFrozen(request));
    assert.ok(
      ["register", "connect", "disconnect", "remove"].includes(request.action),
    );
    const fields = [
      "action",
      "workspaceId",
      "workspacePath",
      "sourceName",
      "nativeName",
      "expectedObservationVersion",
      "digest",
      "sourceVersion",
    ];
    if (["register", "connect"].includes(request.action))
      fields.push("definition");
    assert.deepEqual(Object.keys(request).sort(), fields.sort());
    assert.equal(
      request.nativeName,
      mcpNativeName(request.workspaceId, request.sourceName),
    );
    assert.ok(resolve(request.workspacePath).startsWith(`${namespace}/`));
    for (const name of [
      "expectedObservationVersion",
      "digest",
      "sourceVersion",
    ])
      assert.match(request[name], /^[a-f0-9]{64}$/);
    if (request.definition) {
      const definition = request.definition;
      assert.ok(Object.isFrozen(definition));
      assert.equal(definition.disabled, true);
      if (definition.type === "local") {
        assert.ok(Object.isFrozen(definition.command));
        assert.equal(definition.cwd, request.workspacePath);
        assert.equal(
          definition.command[1],
          fileURLToPath(new URL("./synthetic-mcp-server.mjs", import.meta.url)),
        );
        assert.deepEqual(definition.command.slice(2, 3), ["--startup"]);
        assert.ok(resolve(definition.command[3]).startsWith(`${namespace}/`));
        assert.equal(definition.command[4], "--marker");
        assert.equal(definition.command.length, 6);
      } else {
        assert.equal(definition.type, "remote");
        assert.equal(definition.oauth, false);
        const url = new URL(definition.url);
        assert.equal(url.protocol, "http:");
        assert.equal(url.hostname, "127.0.0.1");
      }
    }
    assert.ok(state.requests.length < 128);
    // Persist only target digests and closed authority data in the in-memory metric.
    const { definition: _definition, ...target } = request;
    state.requests.push(target);
    return state.enabled === true;
  };
}

// New saved-probe authority is opt-in. Historical fixture inputs cannot enter it.
export function validateProductionProbeOptions(message, productionAuthority) {
  if (message.productionAuthority === true) {
    assert.ok(
      typeof message.resourcesPath === "string" &&
        resolve(message.resourcesPath) === message.resourcesPath,
    );
    assert.ok(!message.ownedExited?.length && !message.unverified?.length);
  }
  if (message.useProductionPreflight === true) {
    assert.equal(productionAuthority, true);
    assert.notEqual(message.allowSyntheticStart, true);
    assert.ok(message.eventHost);
  }
}

// Public SDK enqueue path in pinned2.0.18 is session.synthetic(resume:false).
// session.inbox exposes list/cancel/update; it has no public enqueue method.
// This producer never writes an app registry intent and never resumes a session.
export async function retainNativeOnlyInbox(client, sessionID, readOptions) {
  if (
    typeof client?.session?.synthetic !== "function" ||
    typeof client?.session?.inbox?.list !== "function"
  )
    return { status: "unmet_proof", reason: "public_producer_unavailable" };
  const inbox = await client.session.synthetic(
    {
      sessionID,
      text: "Native preflight synthetic pending inbox",
      resume: false,
    },
    readOptions,
  );
  assert.ok(typeof inbox?.id === "string" && inbox.id.length > 0);
  const pending = await client.session.inbox.list({ sessionID }, readOptions);
  assert.ok(
    Array.isArray(pending) && pending.some((item) => item.id === inbox.id),
  );
  return {
    status: "produced",
    count: pending.length,
    publicAPI: "session.synthetic:resume:false+session.inbox.list",
    appRegistryIntent: false,
    resumed: false,
  };
}

const same = (a, b) =>
  ["pid", "platform", "bootId", "startToken"].every(
    (key) => a?.[key] === b?.[key],
  );
export function observeBootstrapClient(client, failures) {
  for (const method of ["create", "get", "update"]) {
    const original = client.session[method];
    if (typeof original !== "function") continue;
    const record = (error) => {
      if (failures.length >= 8) return;
      const entry = { method };
      for (const key of ["name", "code", "_tag", "kind"]) {
        if (
          typeof error?.[key] === "string" &&
          /^[A-Za-z0-9_-]{1,64}$/.test(error[key])
        )
          entry[key] = error[key];
      }
      if (
        Number.isInteger(error?.status) &&
        error.status >= 100 &&
        error.status <= 599
      )
        entry.status = error.status;
      failures.push(entry);
    };
    client.session[method] = (...args) => {
      try {
        return Promise.resolve(original(...args)).catch((error) => {
          record(error);
          throw error;
        });
      } catch (error) {
        record(error);
        throw error;
      }
    };
  }
  return client;
}
export async function captureDarwinIdentity(pid = process.pid) {
  const identity = await createOSProcessIdentityAdapter().capture(pid);
  assert.ok(identity, "Exact OS process identity unavailable");
  return identity;
}
// Explicit controlled crash fixture only. No production clean-stop authority.
export async function stopIdleSyntheticEventHost({
  runtime,
  nativeChild,
  nativeIdentity,
  captureIdentity,
  drain,
  timeoutMs = 10000,
}) {
  assert.ok(runtime?.eventHost);
  assert.ok(
    Number.isSafeInteger(nativeChild?.pid) &&
      nativeChild.pid > 0 &&
      nativeIdentity?.pid === nativeChild.pid &&
      ["platform", "bootId", "startToken"].every(
        (key) =>
          typeof nativeIdentity[key] === "string" &&
          nativeIdentity[key].length > 0,
      ),
  );
  await drain?.();
  assert.equal(typeof runtime.observeIdle, "function");
  const observation = await runtime.observeIdle();
  assert.ok(
    !observation.observerGap &&
      observation.live === 0 &&
      observation.allExited === true &&
      observation.pendingHostRequests === 0,
  );
  assert.ok(same(nativeIdentity, await captureIdentity(nativeChild.pid)));
  let timer;
  let onExit;
  const exited = new Promise((resolveExit, reject) => {
    timer = setTimeout(
      () => reject(new Error("Owned native crash exit unconfirmed")),
      timeoutMs,
    );
    onExit = (code, signal) => resolveExit({ code, signal });
    nativeChild.once("exit", onExit);
  });
  let nativeExit;
  try {
    assert.equal(nativeChild.kill("SIGKILL"), true);
    nativeExit = await exited;
  } finally {
    clearTimeout(timer);
    nativeChild.off("exit", onExit);
  }
  assert.equal(nativeExit.signal, "SIGKILL");
  return {
    exited: true,
    forced: true,
    cleanup: "incomplete",
    recoveryPath: resolve(runtime.workspace, ".."),
    nativeStarted: true,
    nativeIdentity,
    nativeExit,
    idleObservation: observation,
    ownerCleanRelease: false,
  };
}
// ownedExited entries come ONLY from the probe's observed exit/close events.
// No age, ESRCH or PID absence is used as exit evidence.
export function fixtureProcessVerifier({
  ownedExited = [],
  unverified = [],
  adapter = createOSProcessIdentityAdapter(),
} = {}) {
  return createProcessVerifier({
    captureCurrent: () => adapter.capture(process.pid),
    inspect: async (expected) => {
      if (unverified.some((id) => same(id, expected)))
        return { state: "unverified" };
      if (ownedExited.some((id) => same(id, expected)))
        return { state: "exited", identity: expected, evidence: "owned_exit" };
      return adapter.inspect(expected);
    },
  });
}

// Controlled synthetic fixture only. Check the original mapping before deletion,
// then validate the import response and a fresh SDK read; never repair Native data.
export async function importSyntheticNativeHistory(
  client,
  expected,
  readOptions,
) {
  const reject = "Native history mapping rejected";
  assert.ok(
    expected &&
      typeof expected.sessionId === "string" &&
      typeof expected.location?.directory === "string" &&
      resolve(expected.location.directory) === expected.location.directory &&
      expected.metadata &&
      typeof expected.metadata === "object" &&
      !Array.isArray(expected.metadata),
    reject,
  );
  const original = globalThis.structuredClone(expected);
  const check = (info) =>
    assert.ok(
      info?.id === original.sessionId &&
        isDeepStrictEqual(info.location, original.location) &&
        isDeepStrictEqual(info.metadata, original.metadata),
      reject,
    );
  check(
    await client.session.get({ sessionID: original.sessionId }, readOptions),
  );
  const transfer = await client.session.export(
    { sessionID: original.sessionId },
    readOptions,
  );
  check(transfer?.info);
  const input = {
    ...globalThis.structuredClone(transfer),
    location: globalThis.structuredClone(original.location),
    messages: [
      {
        id: "msg_p7history001",
        type: "user",
        time: { created: Date.now() },
        text: "P7 synthetic durable history",
      },
    ],
  };
  await client.session.remove({ sessionID: original.sessionId }, readOptions);
  check(await client.session.import(input, readOptions));
  check(
    await client.session.get({ sessionID: original.sessionId }, readOptions),
  );
  return { id: original.sessionId, syntheticHistory: true };
}

// Pinned v2.0.18 uses an exclusive cursor; omit after to include sequence 0.
// A valid sync marker alone is diagnostic, never event-history acceptance.
// Preserve arrival order and hash actual SDK events; never synthesize history.
// Pass-through observers only; actual production functions and owner guards remain.
export function observeSyntheticSkillsRuntime(runtime, counts, fault = {}) {
  const context = runtime.workbenchContext(),
    nativeSkills = context.nativeSkills;
  if (!nativeSkills) return runtime;
  const observed = Object.fromEntries(
    ["observe", "registerDisabled", "removeOwned"].map((method) => [
      method,
      async (...args) => {
        counts[method]++;
        const result = await nativeSkills[method](...args);
        if (method === "registerDisabled" && fault.nextRegisterAck) {
          fault.nextRegisterAck = false;
          throw new Error("Explicit synthetic Skill acknowledgement loss.");
        }
        return result;
      },
    ]),
  );
  const client = context.client,
    apply = client.session.skill;
  client.session.skill = async (...args) => {
    counts.apply++;
    return apply(...args);
  };
  return {
    ...runtime,
    workbenchContext: () => ({ ...context, nativeSkills: observed }),
  };
}
export function syntheticSkillConfirmation(namespace, state) {
  return async (request) => {
    assert.ok(["register", "remove", "apply"].includes(request.action));
    assert.ok(resolve(request.workspacePath).startsWith(`${namespace}/`));
    assert.equal(request.autoinvoke, false);
    state.requests.push({
      action: request.action,
      workspaceId: request.workspaceId,
      ...(request.sessionId && { sessionId: request.sessionId }),
      nativeId: request.nativeId,
      sourceName: request.sourceName,
      digest: request.digest,
      bodyDigest: request.bodyDigest,
    });
    assert.ok(state.requests.length <= 64);
    return state.enabled === true;
  };
}

export function observeSyntheticAgentsRuntime(runtime, counts, fault = {}) {
  const context = runtime.workbenchContext();
  if (!context.nativeAgents) return runtime;
  const nativeAgents = Object.freeze(
    Object.fromEntries(
      ["observe", "register", "remove"].map((method) => [
        method,
        async (...args) => {
          counts[method]++;
          const result = await context.nativeAgents[method](...args);
          if (method === "register" && fault.nextRegisterAck) {
            fault.nextRegisterAck = false;
            throw new Error("Explicit synthetic Agent acknowledgement loss.");
          }
          return result;
        },
      ]),
    ),
  );
  fault.saveTrace ??= [];
  const configurationSave =
    context.configurationSave &&
    Object.fromEntries(
      ["prepare", "publish", "abort"].map((method) => [
        method,
        async (...args) => {
          const result = await context.configurationSave[method](...args);
          fault.saveTrace ??= [];
          fault.saveTrace.push({
            method,
            ...Object.fromEntries(
              ["status", "reason", "version", "backupId"]
                .filter((key) => typeof result[key] === "string")
                .map((key) => [key, result[key]]),
            ),
          });
          assert.ok(fault.saveTrace.length <= 16);
          return result;
        },
      ]),
    );
  return {
    ...runtime,
    workbenchContext: () => ({
      ...context,
      nativeAgents,
      ...(configurationSave && { configurationSave }),
    }),
  };
}
export function syntheticAgentConfirmation(namespace, state) {
  return async (request) => {
    assert.ok(Object.isFrozen(request));
    assert.ok(["register", "remove"].includes(request.action));
    assert.ok(resolve(request.workspacePath).startsWith(`${namespace}/`));
    assert.equal(request.mode, "primary");
    assert.equal(request.hidden, false);
    assert.equal(policyMatches(request.permissions), true);
    assert.notEqual(request.defaultAgentId, request.nativeId);
    state.requests.push(
      Object.fromEntries(
        [
          "action",
          "workspaceId",
          "nativeId",
          "sourceName",
          "digest",
          "systemDigest",
          "defaultAgentId",
        ].map((key) => [key, request[key]]),
      ),
    );
    assert.ok(state.requests.length <= 64);
    return state.enabled === true;
  };
}

export async function readNativeHistoricalLog(client, sessionId) {
  const events = [];
  const diagnostic = {
    after: null,
    follow: false,
    count: 0,
    events: [],
    head: { seen: false, aggregateMatches: false, sequence: null },
    completed: false,
  };
  const reject = "Native historical log stream rejected";
  const safeSequence = (seq) =>
    Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
  const knownKeys = ["type", "data", "durable", "aggregateID", "seq"];
  const knownTypes = [
    "session.created",
    "session.renamed",
    "session.metadata.updated",
    "session.deleted",
    "log.synced",
  ];
  try {
    let previous = -1;
    for await (const event of client.session.log(
      { sessionID: sessionId, follow: false },
      { signal: AbortSignal.timeout(5000) },
    )) {
      diagnostic.count++;
      const keys = event && typeof event === "object" ? Object.keys(event) : [];
      if (diagnostic.events.length < 129)
        diagnostic.events.push({
          keys: knownKeys.filter((key) => keys.includes(key)),
          unknownKeyCount: keys.filter((key) => !knownKeys.includes(key))
            .length,
          type: knownTypes.includes(event?.type) ? event.type : "other",
          sequence: safeSequence(event?.durable?.seq ?? event?.seq),
          aggregateMatches:
            (event?.durable?.aggregateID ?? event?.aggregateID) === sessionId,
          dataSessionMatches: event?.data?.sessionID === sessionId,
        });
      assert.ok(
        diagnostic.count <= 129 && event && !diagnostic.head.seen,
        reject,
      );
      if (event.type === "log.synced") {
        diagnostic.head = {
          seen: true,
          aggregateMatches: event.aggregateID === sessionId,
          sequence: safeSequence(event.seq),
        };
        assert.ok(
          diagnostic.head.aggregateMatches &&
            (event.seq === undefined ||
              (safeSequence(event.seq) !== null && event.seq >= previous)),
          reject,
        );
        continue;
      }
      assert.ok(
        typeof event.type === "string" &&
          event.type.startsWith("session.") &&
          event.durable &&
          Number.isSafeInteger(event.durable.seq) &&
          event.durable.seq >= 0 &&
          event.durable.seq > previous &&
          event.durable.version === 1 &&
          event.durable.aggregateID === sessionId &&
          events.length < 128,
        reject,
      );
      if (event.type === "session.renamed")
        assert.ok(
          event.data?.sessionID === sessionId &&
            typeof event.data.title === "string",
          reject,
        );
      previous = event.durable.seq;
      events.push({
        type: event.type,
        aggregateID: event.durable.aggregateID,
        version: event.durable.version,
        sequence: event.durable.seq,
        sha256: createHash("sha256")
          .update(JSON.stringify(event))
          .digest("hex"),
        ...(event.type === "session.renamed" && {
          dataSessionID: event.data.sessionID,
          titleSha256: createHash("sha256")
            .update(event.data.title)
            .digest("hex"),
        }),
      });
    }
    assert.ok(diagnostic.head.seen, reject);
    diagnostic.completed = true;
    return { events, diagnostic };
  } catch {
    // No SDK exception text, metadata, title, body, IDs or credentials cross IPC.
    throw Object.assign(new Error(reject), { nativeLogDiagnostic: diagnostic });
  }
}

async function startOwnerHost() {
  const { app, BrowserWindow } = await import("electron");
  assert.equal(process.platform, "darwin");
  assert.ok(process.send, "Owned IPC process channel is required");
  const namespace = process.env.OMOC_P7_NAMESPACE;
  assert.ok(namespace && resolve(namespace) === namespace);
  assert.equal(await fs.realpath(namespace), namespace);
  assert.equal((await fs.lstat(namespace)).isSymbolicLink(), false);
  assert.equal(
    app.commandLine.getSwitchValue("user-data-dir"),
    join(namespace, "electron-bootstrap-profile"),
  );
  app.setActivationPolicy("prohibited");
  const profile = join(namespace, `electron-profile-${process.pid}`);
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  app.setPath("logs", profile);
  app.setPath("crashDumps", profile);
  for (const name of ["Documents", "appData", "imported"])
    await fs.mkdir(join(namespace, name), { recursive: true, mode: 0o700 });
  const durable = prepareDurableNamespace({
    getPath: (name) => {
      assert.ok(["documents", "appData"].includes(name));
      return join(namespace, name === "documents" ? "Documents" : "appData");
    },
  });
  const kernel = createElectronOwnerKernel(app);
  const processIdentity = createOSProcessIdentityAdapter();
  const identity = await processIdentity.capture(process.pid);
  assert.ok(identity, "Production OS identity unavailable");
  let owner;
  let ownerNonce;
  let runtime;
  let registry;
  let service;
  let productionAuthority = false;
  let configurationSaveConfirmation = false;
  const skillConfirmation = { enabled: false, requests: [] };
  const agentConfirmation = { enabled: false, requests: [] };
  const agentCounts = { observe: 0, register: 0, remove: 0 };
  const agentFault = {};
  const syntheticAgentReferences = [];
  const skillFault = {};
  const skillCounts = {
    observe: 0,
    registerDisabled: 0,
    removeOwned: 0,
    apply: 0,
  };
  const instructionConfirmation = { enabled: false, requests: [] };
  const instructionCounts = { list: 0, put: 0, remove: 0 };
  const mcpConfirmation = { enabled: false, requests: [] };
  const mcpCounts = { list: 0, add: 0, connect: 0, disconnect: 0, remove: 0 };
  const mcpFault = {};
  let preflight;
  let witnessChild;
  let nativeSpawnCount = 0;
  const descendants = [];
  const track = (child, role) => {
    assert.ok(descendants.length < 64 && Number.isSafeInteger(child.pid));
    const entry = { role, pid: child.pid, exited: false };
    descendants.push(entry);
    if (process.connected)
      process.send({ event: "descendant", role, pid: child.pid }, () => {});
    child.once("exit", (code, signal) => {
      entry.exited = true;
      entry.exit = { code, signal };
      if (process.connected)
        process.send(
          { event: "descendant-exit", role, pid: child.pid, code, signal },
          () => {},
        );
    });
    return child;
  };
  async function closePreflight() {
    if (!preflight) return undefined;
    const result = await preflight.close();
    if (result.exited && result.cleanup === "complete") preflight = undefined;
    return result;
  }
  const bootstrapFailures = [];
  let nativeChild;
  let nativeIdentity;
  let nativeExit;
  let stopFailedStart;
  let retainedForcedStop;
  const ownedExited = [];
  const send = (item) => process.send(item);
  const noWindows = () => {
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    return { windows: 0, activationPolicy: "prohibited" };
  };
  async function stopRuntime(signal) {
    if (retainedForcedStop) return retainedForcedStop;
    if (!runtime && stopFailedStart) {
      const stopped = await stopFailedStart();
      assert.equal(stopped.exited, true, "Failed startup child exit required");
      assert.ok(!nativeChild || nativeExit, "Owned exit event required");
      stopFailedStart = undefined;
      return {
        ...stopped,
        nativeStarted: !!nativeChild,
        nativeIdentity,
        nativeExit,
      };
    }
    if (!runtime)
      return {
        exited: !nativeChild || !!nativeExit,
        cleanup: "not_started",
        nativeStarted: !!nativeChild,
        nativeIdentity,
        nativeExit,
      };
    if (signal && runtime.eventHost) {
      // Controlled idle crash only: retain the profile and dirty owner, never
      // turn missing scope-close evidence into a production clean stop.
      assert.equal(signal, "SIGKILL");
      retainedForcedStop = await stopIdleSyntheticEventHost({
        runtime,
        nativeChild,
        nativeIdentity,
        captureIdentity: captureDarwinIdentity,
        drain: () => service?.drain?.(),
      });
      assert.deepEqual(retainedForcedStop.nativeExit, nativeExit);
      runtime = undefined;
      return retainedForcedStop;
    }
    if (signal) {
      assert.ok(
        nativeChild?.pid &&
          same(nativeIdentity, await captureDarwinIdentity(nativeChild.pid)),
      );
      nativeChild.kill(signal);
    }
    const stopped = await runtime.stop();
    assert.equal(stopped.exited, true, "Owned native exit must be confirmed");
    assert.ok(nativeExit, "Native owned handle exit event required");
    runtime = undefined;
    return {
      ...stopped,
      nativeStarted: !!nativeChild,
      nativeIdentity,
      nativeExit,
    };
  }
  let lane = Promise.resolve();
  process.on("message", (message) => {
    lane = lane.then(async () => {
      try {
        assert.ok(
          message && typeof message.id === "string" && message.id.length <= 128,
        );
        noWindows();
        let value;
        switch (message.command) {
          case "acquire": {
            const root = durable.root;
            await fs.mkdir(root, { recursive: true, mode: 0o700 });
            validateProductionProbeOptions(message, productionAuthority);
            productionAuthority = message.productionAuthority === true;
            const { spawn } = await import("node:child_process");
            if (!productionAuthority)
              ownedExited.push(...(message.ownedExited ?? []));
            owner = createStorageOwner({
              root,
              kernel,
              processVerifier: productionAuthority
                ? createProcessVerifier(processIdentity)
                : fixtureProcessVerifier({
                    ownedExited,
                    unverified: message.unverified ?? [],
                    adapter: processIdentity,
                  }),
              ...(productionAuthority && {
                lifetimeWitness: createLifetimeWitness({
                  resourcesPath: message.resourcesPath,
                  processIdentity,
                  spawn: (...args) => {
                    witnessChild = track(spawn(...args), "witness");
                    return witnessChild;
                  },
                }),
              }),
            });
            value = await owner.acquire({
              initialize: message.initialize === true,
            });
            ownerNonce = owner.getNonce();
            if (productionAuthority)
              value = {
                ...value,
                productionAuthority: true,
                witnessPid: witnessChild?.pid,
              };
            break;
          }
          case "dirty":
            assert.equal(
              (await owner.markSpawnIntent(ownerNonce)).state,
              "ready",
            );
            if (message.childIdentity)
              assert.equal(
                (await owner.recordChild(ownerNonce, message.childIdentity))
                  .state,
                "ready",
              );
            kernel.release(); // Explicit fault fixture: dirty record remains unchanged.
            value = { dirty: true, ...noWindows() };
            break;
          case "start": {
            validateProductionProbeOptions(message, productionAuthority);
            const previousClose = await closePreflight();
            assert.ok(
              !previousClose ||
                (previousClose.exited && previousClose.cleanup === "complete"),
            );
            assert.ok(
              !runtime &&
                !retainedForcedStop &&
                !stopFailedStart &&
                (!nativeChild || nativeExit),
              "Previous owned child must stop before another start",
            );
            nativeChild = undefined;
            nativeIdentity = undefined;
            nativeExit = undefined;
            assert.equal((await owner.assertOwned(ownerNonce)).state, "ready");
            const { openWorkspaceRegistry } = await import(
              "../../src/host/workspace-registry.mjs"
            );
            const { createWorkbenchService } = await import(
              "../../src/workbench-service.mjs"
            );
            const { spawn } = await import("node:child_process");
            const manifest = await openDurableManifest(
              durable,
              owner,
              message.eventHost
                ? { nativeDatabase: join(durable.data, "event-host.sqlite") }
                : undefined,
            );
            const directory = durable.metadata;
            const documentsPath = durable.documents;
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            await fs.mkdir(documentsPath, { recursive: true, mode: 0o700 });
            registry = await openWorkspaceRegistry({
              directory,
              documentsPath,
              storeId: manifest.storeId,
              runtimeEpoch: message.runtimeEpoch,
            });
            const productionHold = () => {
              const reason = preflight.reason();
              const runtimeReady = Promise.reject(
                Object.assign(new Error("Native preflight held"), {
                  storageReason: reason,
                }),
              );
              runtimeReady.catch(() => {});
              service = createWorkbenchService({
                registry,
                runtimeReady,
                runtimeEpoch: message.runtimeEpoch,
                bootstrap: false,
              });
              return {
                blocked: true,
                metadataOnly: true,
                spawned: nativeSpawnCount,
                reason,
                startupAuthority: "production-native-preflight",
                fresh: durable.fresh,
                ...noWindows(),
              };
            };
            if (message.useProductionPreflight === true) {
              preflight = createNativePreflight({
                namespace: durable,
                owner,
                registry,
                eventHost: message.eventHost,
                processIdentity,
                // Observation only: decisions use the default reader/verifier.
                spawn: (...args) => track(spawn(...args), "inspector"),
              });
              if (!(await preflight.check())) {
                value = productionHold();
                break;
              }
              await registry.recordOwnerIntent({
                ownerNonce,
                phase: "startup",
              });
            }
            try {
              runtime = await startSidecar({
                binaryPath: message.binaryPath,
                ...(message.eventHost && {
                  makeClient: async (baseUrl, password) => {
                    const { OpenCode } = await import("@opencode/client");
                    return observeMcpClient(
                      observeInstructionClient(
                        observeBootstrapClient(
                          OpenCode.make({
                            baseUrl,
                            headers: {
                              authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
                            },
                            fetch: (url, init) =>
                              fetch(url, { ...init, redirect: "error" }),
                          }),
                          bootstrapFailures,
                        ),
                        instructionCounts,
                      ),
                      mcpCounts,
                      mcpFault,
                    );
                  },
                }),
                ...(message.eventHost && { eventHost: message.eventHost }),
                namespace: durable,
                owner,
                processIdentity: {
                  ...processIdentity,
                  capture: async (pid) => {
                    const captured = await processIdentity.capture(pid);
                    if (pid === nativeChild?.pid) nativeIdentity = captured;
                    return captured;
                  },
                },
                preflight:
                  message.useProductionPreflight === true
                    ? preflight.check
                    : async () =>
                        message.allowSyntheticStart === true
                          ? registry.status().state === "ready" &&
                            registry.readView().retainedOperations.length === 0
                          : freshNativePreflight(durable, registry),
                spawnProcess: (...args) => {
                  // Each launch has its own exit proof. A prior exit cannot prove this child exited.
                  nativeIdentity = undefined;
                  nativeExit = undefined;
                  nativeChild = productionAuthority
                    ? track(spawn(...args), "native")
                    : spawn(...args);
                  nativeSpawnCount++;
                  nativeChild.once("exit", (code, signal) => {
                    nativeExit = { code, signal };
                    if (nativeIdentity && !productionAuthority)
                      ownedExited.push(nativeIdentity);
                  });
                  return nativeChild;
                },
              });
            } catch (error) {
              // A later supervisor recheck can hold after startup intent. Still
              // report the actual zero-executor outcome without swallowing a
              // spawned child's cleanup handle or fabricating a positive proof.
              if (
                message.useProductionPreflight === true &&
                !nativeChild &&
                (error.message === "native_startup_unverified" ||
                  error.reason === "native_startup_unverified")
              ) {
                let startupCleanup;
                if (typeof error.stopOwnedSidecar === "function") {
                  startupCleanup = await error.stopOwnedSidecar();
                  if (
                    !startupCleanup.exited ||
                    startupCleanup.cleanup !== "complete"
                  )
                    throw error;
                }
                value = {
                  ...productionHold(),
                  ...(startupCleanup && { startupCleanup }),
                };
                break;
              }
              throw error;
            }
            nativeIdentity = await processIdentity.capture(runtime.processId);
            assert.ok(nativeIdentity);
            service = createWorkbenchService({
              runtime: observeSyntheticAgentsRuntime(
                observeSyntheticSkillsRuntime(runtime, skillCounts, skillFault),
                agentCounts,
                agentFault,
              ),
              registry,
              runtimeEpoch: message.runtimeEpoch,
              bootstrap:
                message.useProductionPreflight === true
                  ? message.bootstrap !== false
                  : message.bootstrap === true,
              pickDirectory: async () => join(namespace, "imported"),
              confirmTrust: async () => true,
              confirmSessionRemoval: async () => true,
              // Explicit controlled synthetic confirmation only; never production Main UI.
              confirmConfigurationSave: async ({ targetPath }) =>
                productionAuthority &&
                configurationSaveConfirmation &&
                resolve(targetPath).startsWith(`${namespace}/`),
              confirmAgentRuntime: syntheticAgentConfirmation(
                namespace,
                agentConfirmation,
              ),
              confirmSkillRuntime: syntheticSkillConfirmation(
                namespace,
                skillConfirmation,
              ),
              confirmMcp: createSyntheticMcpConfirmation(
                namespace,
                mcpConfirmation,
              ),
              confirmInstructions: createSyntheticInstructionConfirmation(
                namespace,
                instructionConfirmation,
              ),
            });
            value = {
              processId: runtime.processId,
              nativeIdentity,
              namespace: durable,
              nativeVersion: manifest.nativeVersion,
              ...(message.useProductionPreflight === true && {
                fresh: durable.fresh,
                spawned: nativeSpawnCount,
                blocked: false,
              }),
              ...(message.useProductionPreflight !== true && {
                preflightScope: "historical-fresh-only-helper",
              }),
              startupAuthority:
                message.useProductionPreflight === true
                  ? "production-native-preflight"
                  : message.allowSyntheticStart === true
                    ? "explicit-trusted-synthetic-only"
                    : "production-fresh-preflight",
              ...noWindows(),
            };
            break;
          }
          case "blocked-start": {
            const { openWorkspaceRegistry } = await import(
              "../../src/host/workspace-registry.mjs"
            );
            const { createWorkbenchService } = await import(
              "../../src/workbench-service.mjs"
            );
            const blockedOwner = owner.status().state !== "ready";
            const manifest = blockedOwner
              ? undefined
              : await openDurableManifest(
                  durable,
                  owner,
                  message.eventHost
                    ? {
                        nativeDatabase: join(durable.data, "event-host.sqlite"),
                      }
                    : undefined,
                );
            const pending = message.reason === "pending_inbox";
            const nativeHold =
              pending || message.reason === "native_startup_unverified";
            registry = await openWorkspaceRegistry({
              ...(manifest && {
                directory: durable.metadata,
                documentsPath: durable.documents,
                storeId: manifest.storeId,
              }),
              runtimeEpoch: message.runtimeEpoch,
              ...(!nativeHold && { recoveryReason: message.reason }),
            });
            if (pending)
              assert.ok(registry.readView().retainedOperations.length > 0);
            if (nativeHold) {
              assert.equal(durable.fresh, false);
              assert.equal(freshNativePreflight(durable, registry), false);
              if (!pending)
                assert.equal(registry.readView().retainedOperations.length, 0);
            }
            let spawned = 0;
            let blocked = false;
            const runtimeReady = startSidecar({
              binaryPath: message.binaryPath,
              ...(message.eventHost && { eventHost: message.eventHost }),
              namespace: durable,
              owner,
              processIdentity: {
                ...processIdentity,
                capture: async (pid) => {
                  const captured = await processIdentity.capture(pid);
                  if (pid === nativeChild?.pid) nativeIdentity = captured;
                  return captured;
                },
              },
              preflight: async () => freshNativePreflight(durable, registry),
              spawnProcess: () => {
                spawned++;
                throw new Error("Forbidden native spawn");
              },
            }).catch((error) => {
              if (nativeHold) error.storageReason = "native_startup_unverified";
              throw error;
            });
            runtimeReady.catch(() => {});
            service = createWorkbenchService({
              registry,
              runtimeReady,
              runtimeEpoch: message.runtimeEpoch,
              ...(!nativeHold && { recoveryReason: message.reason }),
            });
            try {
              await runtimeReady;
            } catch {
              blocked = true;
            }
            assert.equal(blocked, true);
            assert.equal(spawned, 0);
            value = {
              spawned,
              blocked,
              preflightScope: "historical-fresh-only-helper",
              ...noWindows(),
            };
            break;
          }
          case "mcp-fault":
            assert.equal(productionAuthority, true);
            assert.equal(message.mode, "next-add-postread");
            mcpFault.nextAddPostread = true;
            value = {
              authority:
                "explicit-synthetic-service-failure-not-Native-behavior",
              mode: message.mode,
            };
            break;
          case "mcp-confirmation":
            assert.equal(productionAuthority, true);
            assert.equal(typeof message.enabled, "boolean");
            mcpConfirmation.enabled = message.enabled;
            value = {
              enabled: mcpConfirmation.enabled,
              authority: "explicit-synthetic-MCP-confirmation",
            };
            break;
          case "mcp-metrics":
            assert.equal(productionAuthority, true);
            value = {
              counts: { ...mcpCounts },
              confirmations: mcpConfirmation.requests.map((request) => ({
                ...request,
              })),
            };
            break;
          case "instructions-confirmation":
            assert.equal(productionAuthority, true);
            assert.equal(typeof message.enabled, "boolean");
            instructionConfirmation.enabled = message.enabled;
            value = {
              enabled: instructionConfirmation.enabled,
              authority: "explicit-synthetic-instruction-confirmation",
            };
            break;
          case "instructions-metrics":
            assert.equal(productionAuthority, true);
            value = {
              counts: { ...instructionCounts },
              confirmations: instructionConfirmation.requests.map(
                (request) => ({ ...request }),
              ),
            };
            break;
          case "configuration-save-confirmation":
            assert.equal(productionAuthority, true);
            assert.equal(typeof message.enabled, "boolean");
            configurationSaveConfirmation = message.enabled;
            value = {
              enabled: configurationSaveConfirmation,
              authority: "explicit-synthetic-save-confirmation",
            };
            break;
          case "assert-owned":
            value = await owner.assertOwned(ownerNonce);
            break;
          case "handle":
            value = await service.handle(message.envelope, "p7-owned-probe");
            break;
          case "skills-fault":
            assert.equal(productionAuthority, true);
            assert.equal(message.mode, "next-register-ack");
            skillFault.nextRegisterAck = true;
            value = {
              mode: message.mode,
              authority:
                "explicit-synthetic-service-ack-loss-not-Native-behavior",
            };
            break;
          case "skills-confirmation":
            assert.equal(productionAuthority, true);
            assert.equal(typeof message.enabled, "boolean");
            skillConfirmation.enabled = message.enabled;
            value = {
              enabled: skillConfirmation.enabled,
              authority: "explicit-synthetic-Skill-confirmation",
            };
            break;
          case "skills-metrics":
            assert.equal(productionAuthority, true);
            value = {
              counts: { ...skillCounts },
              confirmations: skillConfirmation.requests.map((r) => ({ ...r })),
            };
            break;
          case "agents-metrics":
            assert.equal(productionAuthority, true);
            value = {
              counts: { ...agentCounts },
              confirmations: agentConfirmation.requests.map((r) => ({ ...r })),
            };
            break;
          case "agents-confirmation":
            assert.equal(productionAuthority, true);
            assert.equal(typeof message.enabled, "boolean");
            agentConfirmation.enabled = message.enabled;
            value = {
              enabled: agentConfirmation.enabled,
              authority: "explicit-synthetic-Agent-confirmation",
            };
            break;
          case "agents-fault":
            assert.equal(productionAuthority, true);
            assert.equal(message.mode, "next-register-ack");
            agentFault.nextRegisterAck = true;
            value = {
              mode: message.mode,
              authority:
                "explicit-synthetic-service-ack-loss-after-actual-Native",
            };
            break;
          case "extensions-public": {
            assert.equal(productionAuthority, true);
            assert.ok(runtime?.eventHost);
            const { runExtensionsPublic } = await import(
              "./native-extensions-public.mjs"
            );
            value = await runExtensionsPublic({
              runtime,
              registry,
              service,
              namespace,
              durable,
            });
            break;
          }
          case "agents-public": {
            assert.equal(productionAuthority, true);
            assert.ok(runtime?.eventHost);
            const { runAgentsPublic } = await import(
              "./native-agents-public.mjs"
            );
            value = await runAgentsPublic({
              runtime,
              registry,
              service,
              namespace,
              confirmation: agentConfirmation,
              counts: agentCounts,
              saveTrace: agentFault.saveTrace ?? [],
            });
            syntheticAgentReferences.push(value.syntheticReference);
            break;
          }
          case "agents-reference-cleanup": {
            assert.equal(productionAuthority, true);
            const { cleanupSyntheticAgentReferences } = await import(
              "./native-agents-public.mjs"
            );
            value = await cleanupSyntheticAgentReferences({
              client: runtime.workbenchContext().client,
              registry,
              namespace,
              references: syntheticAgentReferences,
            });
            break;
          }
          case "agents-prerequisite": {
            assert.equal(productionAuthority, true);
            assert.ok(runtime?.eventHost);
            const { runAgentsPrerequisite } = await import(
              "./native-agents-prerequisite.mjs"
            );
            value = await runAgentsPrerequisite({
              runtime,
              registry,
              namespace,
            });
            syntheticAgentReferences.push(value.syntheticReference);
            break;
          }
          case "skills-prerequisite": {
            assert.equal(productionAuthority, true);
            assert.ok(runtime?.eventHost);
            const { runSkillsPrerequisite } = await import(
              "./native-skills-prerequisite.mjs"
            );
            value = await runSkillsPrerequisite({
              runtime,
              registry,
              namespace,
            });
            break;
          }
          case "native": {
            assert.ok(runtime);
            const { client } = runtime.workbenchContext();
            const readOptions = { signal: AbortSignal.timeout(5000) };
            if (
              [
                "instructions-list",
                "instructions-put",
                "instructions-remove",
              ].includes(message.operation)
            ) {
              assert.equal(productionAuthority, true);
              const view = registry.readView();
              const mapped = view.sessions.filter(
                (s) => s.nativeSessionId === message.sessionId,
              );
              assert.equal(mapped.length, 1);
              const workspace = view.workspaces.find(
                (w) => w.workspaceId === mapped[0].workspaceId,
              );
              assert.ok(
                workspace &&
                  resolve(workspace.canonicalPath).startsWith(`${namespace}/`),
              );
              const native = await client.session.get(
                { sessionID: message.sessionId },
                readOptions,
              );
              assert.equal(native.id, message.sessionId);
              assert.equal(native.location?.directory, workspace.canonicalPath);
            }
            const operations = {
              "instructions-list": async () => {
                const entries = await client.session.instructions.entry.list(
                  { sessionID: message.sessionId },
                  readOptions,
                );
                assert.ok(Array.isArray(entries) && entries.length <= 64);
                // Never return unrelated Native values over probe IPC.
                return entries.filter((entry) => entry.key === INSTRUCTION_KEY);
              },
              "instructions-put": async () => {
                assert.ok(
                  configurationFileWriteFits("instructions", message.value),
                );
                const ack = await client.session.instructions.entry.put(
                  {
                    sessionID: message.sessionId,
                    key: INSTRUCTION_KEY,
                    value: message.value,
                  },
                  readOptions,
                );
                assert.equal(ack, undefined);
                return { acknowledged: true };
              },
              "instructions-remove": async () => {
                const ack = await client.session.instructions.entry.remove(
                  { sessionID: message.sessionId, key: INSTRUCTION_KEY },
                  readOptions,
                );
                assert.equal(ack, undefined);
                return { acknowledged: true };
              },
              export: () =>
                client.session.export(
                  { sessionID: message.sessionId },
                  readOptions,
                ),
              get: () =>
                client.session.get(
                  { sessionID: message.sessionId },
                  readOptions,
                ),
              list: () => {
                assert.ok(
                  Number.isSafeInteger(message.limit) &&
                    message.limit > 0 &&
                    message.limit <= 100,
                );
                assert.ok(
                  message.cursor === undefined ||
                    (typeof message.cursor === "string" &&
                      message.cursor.length > 0 &&
                      Buffer.byteLength(message.cursor) <= 4096),
                );
                return client.session.list(
                  {
                    limit: message.limit,
                    ...(message.cursor !== undefined && {
                      cursor: message.cursor,
                    }),
                  },
                  readOptions,
                );
              },
              messages: () =>
                client.message.list(
                  { sessionID: message.sessionId, limit: 100 },
                  readOptions,
                ),
              inbox: () =>
                client.session.inbox.list(
                  { sessionID: message.sessionId },
                  readOptions,
                ),
              history: async () => {
                const view = registry.readView();
                const mapped = view.sessions.filter(
                  (s) => s.nativeSessionId === message.sessionId,
                );
                assert.equal(
                  mapped.length,
                  1,
                  "Native history mapping rejected",
                );
                const workspace = view.workspaces.find(
                  (w) => w.workspaceId === mapped[0].workspaceId,
                );
                assert.ok(
                  workspace &&
                    message.location?.directory === workspace.canonicalPath,
                  "Native history mapping rejected",
                );
                const admitted = registry.lookupIdentity({
                  runtimeEpoch: message.metadata?.originalRuntimeEpoch,
                  operationId: message.metadata?.operationId,
                });
                assert.ok(
                  admitted?.type === "workspace.create" &&
                    isDeepStrictEqual(message.metadata, {
                      operationId: admitted.operationId,
                      originalRuntimeEpoch: admitted.runtimeEpoch,
                      appSessionId: mapped[0].appSessionId,
                      workspaceId: workspace.workspaceId,
                      digest: admitted.digest,
                    }),
                  "Native history mapping rejected",
                );
                if (
                  productionAuthority &&
                  client.session.instructions?.entry?.list
                ) {
                  const entries = await client.session.instructions.entry.list(
                    { sessionID: message.sessionId },
                    readOptions,
                  );
                  assert.ok(
                    Array.isArray(entries) &&
                      !entries.some((entry) => entry.key === INSTRUCTION_KEY),
                    "Seed history before registering instructions",
                  );
                }
                return importSyntheticNativeHistory(
                  client,
                  {
                    sessionId: message.sessionId,
                    location: message.location,
                    metadata: message.metadata,
                  },
                  readOptions,
                );
              },
              log: () => readNativeHistoricalLog(client, message.sessionId),
            };
            assert.ok(Object.hasOwn(operations, message.operation));
            value = await operations[message.operation]();
            break;
          }
          case "retain-inbox": {
            const { client } = runtime.workbenchContext();
            const request = {
              type: "message.send",
              workspaceId: message.workspaceId,
              sessionId: message.appSessionId,
              requestId: "synthetic-inbox-request",
              text: "P7 synthetic pending inbox",
            };
            const digest = createHash("sha256")
              .update(
                JSON.stringify(
                  Object.keys(request)
                    .sort()
                    .map((k) => [k, request[k]]),
                ),
              )
              .digest("hex");
            const identity = {
              runtimeEpoch: message.runtimeEpoch,
              operationId: "p7-synthetic-pending",
              type: request.type,
              workspaceId: request.workspaceId,
              sessionId: request.sessionId,
              digest,
            };
            await registry.begin(identity);
            await registry.dispatch({
              runtimeEpoch: identity.runtimeEpoch,
              operationId: identity.operationId,
              step: "native.send",
              nativeSessionId: message.nativeSessionId,
            });
            const inbox = await client.session.synthetic(
              {
                sessionID: message.nativeSessionId,
                text: request.text,
                resume: false,
              },
              { signal: AbortSignal.timeout(5000) },
            );
            await registry.complete({
              runtimeEpoch: identity.runtimeEpoch,
              operationId: identity.operationId,
              receipt: {
                runtimeEpoch: identity.runtimeEpoch,
                operationId: identity.operationId,
                type: identity.type,
                workspaceId: identity.workspaceId,
                sessionId: identity.sessionId,
                admission: "dispatched",
                delivery: "unknown",
                effect: "unknown",
                revision: 0,
                evidence: [{ kind: "native_inbox", id: inbox.id }],
              },
              delta: { workspaces: [], sessions: [], tombstones: [] },
              verifiedNativeSessionIds: [],
            });
            await registry.checkpoint();
            value = {
              key: {
                runtimeEpoch: identity.runtimeEpoch,
                operationId: identity.operationId,
              },
              inboxId: inbox.id,
              provenance:
                "Explicit synthetic resume:false SDK inbox fixture; production registry uncertainty; no provider execution",
            };
            break;
          }
          case "retain-native-only-inbox": {
            assert.equal(productionAuthority, true);
            assert.ok(runtime?.eventHost);
            const before = registry.readView();
            assert.equal(before.retainedOperations.length, 0);
            assert.equal(
              before.sessions.filter(
                (entry) => entry.nativeSessionId === message.nativeSessionId,
              ).length,
              1,
            );
            const { client } = runtime.workbenchContext();
            value = await retainNativeOnlyInbox(
              client,
              message.nativeSessionId,
              { signal: AbortSignal.timeout(5000) },
            );
            const after = registry.readView();
            assert.equal(after.retainedOperations.length, 0);
            assert.equal(after.revision, before.revision);
            break;
          }
          case "probe-processes":
            assert.equal(productionAuthority, true);
            value = { nativeSpawnCount, descendants, ...noWindows() };
            break;
          case "owner-proof":
            assert.equal(productionAuthority, true);
            value = JSON.parse(
              await fs.readFile(join(durable.root, "owner.json"), "utf8"),
            );
            break;
          case "bootstrap-diagnostics":
            value = { failures: bootstrapFailures };
            break;
          case "view":
            value = registry.readView();
            break;
          case "identity":
            value = registry.lookupIdentity(message.key);
            break;
          case "checkpoint":
            value = await registry.checkpoint();
            break;
          case "stop-native":
            value = await stopRuntime(message.signal);
            break;
          case "stop": {
            await service?.drain?.();
            service?.close();
            value = await stopRuntime();
            const preflightClose = await closePreflight();
            if (
              preflightClose &&
              (!preflightClose.exited || preflightClose.cleanup !== "complete")
            ) {
              value = {
                ...value,
                preflightClose,
                cleanup: "incomplete",
                ...noWindows(),
              };
              break;
            }
            if (registry?.status().state === "ready")
              await registry.checkpoint();
            await registry?.close();
            if (retainedForcedStop) {
              // Keep the dirty record. The legacy path injects controlled exit
              // evidence; the opt-in production path requires real witness files.
              kernel.release();
            } else if (ownerNonce && owner.status().state === "ready") {
              assert.equal((await owner.release(ownerNonce)).released, true);
            }
            value = {
              ...value,
              ...(preflightClose && { preflightClose }),
              ...noWindows(),
            };
            break;
          }
          case "quit":
            assert.ok(
              !runtime &&
                !preflight &&
                !stopFailedStart &&
                (!nativeChild || nativeExit),
              "No quit with unconfirmed child",
            );
            value = noWindows();
            noWindows();
            send({ id: message.id, ok: true, value });
            app.exit(0);
            return;
          default:
            throw new Error("Unknown closed owner-host command");
        }
        noWindows();
        send({ id: message.id, ok: true, value });
      } catch (error) {
        if (typeof error.stopOwnedSidecar === "function")
          stopFailedStart = error.stopOwnedSidecar;
        // No passwords, raw startup output or provider credentials in evidence.
        send({
          id: message.id,
          ok: false,
          error: {
            ...(message.command === "extensions-public" &&
              /^(SEED|BASELINE|OBSERVE|CLOSED-REFUSAL|REPEAT|PRESERVATION)$/u.test(
                error.extensionPhase,
              ) && {
                extensionPhase: error.extensionPhase,
                ...(error.extensionAssertion && {
                  extensionAssertion: error.extensionAssertion,
                }),
              }),
            ...(message.command === "skills-prerequisite" &&
              error.skillDiagnostic && {
                skillDiagnostic: error.skillDiagnostic,
              }),
            ...(error.nativeLogDiagnostic && {
              nativeLogDiagnostic: error.nativeLogDiagnostic,
            }),
            ...(["agents-prerequisite", "agents-public"].includes(
              message.command,
            ) &&
              error.agentDiagnostic && {
                agentDiagnostic: error.agentDiagnostic,
              }),
            name: productionAuthority ? "Error" : error.name,
            code: productionAuthority
              ? message.command === "skills-prerequisite" &&
                /^SKILL_PREREQUISITE_(OBSERVE|SECURITY_REFUSALS|REGISTER|SESSION_APPLY|REMOVE)$/u.test(
                  error.code,
                )
                ? error.code
                : ["agents-prerequisite", "agents-public"].includes(
                      message.command,
                    ) &&
                    /^AGENT_PREREQUISITE_(OBSERVE|SECURITY|REGISTER|REFERENCES|REMOVE)$/u.test(
                      error.code,
                    )
                  ? error.code
                  : "PROBE_ASSERTION"
              : (error.code ?? error.appCode ?? "PROBE_ASSERTION"),
            message: productionAuthority
              ? "Production probe command failed"
              : String(error.message).slice(0, 512),
          },
        });
      }
    });
  });
  process.on("disconnect", () => {
    // A lost parent never authorizes cleaning durable state. Stop our owned
    // child; retain namespace regardless of teardown result.
    lane.finally(async () => {
      try {
        await stopRuntime();
        await closePreflight();
      } finally {
        app.exit(1);
      }
    });
  });
  send({ event: "ready", identity, namespace: durable, ...noWindows() });
}
if (
  process.argv.some((arg) => resolve(arg) === fileURLToPath(import.meta.url))
) {
  startOwnerHost().catch(() => {
    process.exitCode = 1;
    process.disconnect?.();
  });
}
