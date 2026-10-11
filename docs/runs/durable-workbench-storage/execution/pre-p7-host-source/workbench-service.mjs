import { randomUUID, createHash } from "node:crypto";
import {
  createHostAdmission,
  currentScope,
} from "./host/workbench-admission.mjs";
import { performance } from "node:perf_hooks";
import { basename } from "node:path";
import {
  BASELINE_POLICY,
  ERRORS,
  fail,
  failure,
  policyMatches,
  portableName,
  validateRequest,
} from "./workbench-contract.mjs";
import {
  canonicalDirectory,
  createFolder,
  listFiles,
  readFilePreview,
} from "./host/workbench-files.mjs";

const lifecycleTypes = new Set([
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
]);
const mutationTypes = new Set([
  ...lifecycleTypes,
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "command.run",
  "session.interrupt",
  "permission.respond",
]);
const clip = (value, size = 8000) =>
  typeof value === "string" ? value.slice(0, size) : "";
const opaque = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const available = (entries) => ({ status: "available", entries });
const unavailable = () => ({ status: "unavailable", entries: [] });
const emptyCatalog = () =>
  Object.fromEntries(
    ["commands", "skills", "mcp", "agents", "models"].map((key) => [
      key,
      unavailable(),
    ]),
  );
const fingerprint = (request) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(request)
          .sort()
          .map((key) => [key, request[key]]),
      ),
    )
    .digest("hex");
function structuredError(error) {
  return error?.status === 401 ||
    error?.status === 403 ||
    error?.type === "ProviderAuthError"
    ? "AUTH_REQUIRED"
    : "RUNTIME_ERROR";
}
export function projectMessages(data) {
  if (!Array.isArray(data)) fail("RUNTIME_ERROR");
  return data
    .slice(-100)
    .filter(
      (message) =>
        opaque(message.id) && ["user", "assistant"].includes(message.type),
    )
    .map((message) => ({
      id: message.id,
      role: message.type,
      text:
        message.type === "user"
          ? clip(message.text, 32000)
          : clip(
              (message.content ?? [])
                .filter((part) => part.type === "text")
                .map((part) => clip(part.text, 32000))
                .join(""),
              32000,
            ),
      tools:
        message.type === "assistant"
          ? (message.content ?? [])
              .filter((part) => part.type === "tool" && opaque(part.id))
              .slice(0, 40)
              .map((part) => ({
                id: part.id,
                name: clip(part.name, 128),
                status:
                  part.state?.status === "streaming"
                    ? "pending"
                    : ["running", "completed", "error"].includes(
                          part.state?.status,
                        )
                      ? part.state.status
                      : "error",
                input: clip(
                  typeof part.state?.input === "string"
                    ? part.state.input
                    : JSON.stringify(part.state?.input ?? {}),
                ),
                output: !["streaming", "running", "completed"].includes(
                  part.state?.status,
                )
                  ? ERRORS.TOOL_ERROR
                  : clip(
                      (part.state?.content ?? [])
                        .filter((item) => item.type === "text")
                        .map((item) => clip(item.text))
                        .join("\n"),
                    ),
              }))
          : [],
    }));
}

export function createWorkbenchService({
  runtime,
  pickDirectory,
  confirmTrust,
  confirmSessionRemoval = async () => false,
  deadlineMs = 10000,
  trustedTestAdapter = false,
}) {
  const workspaces = new Map();
  const sessions = new Map();
  const reads = new Map();
  const lifecycleReceipts = new Map();
  const diagnostics = {
    startedAt: Date.now(),
    observedOperations: 0,
    errors: 0,
    unknownOutcomes: 0,
    droppedEvents: 0,
    events: [],
  };
  function observe(request, result, started, owned) {
    const unknown =
      result.code === "UNKNOWN_OUTCOME" || result.value?.status === "unknown";
    const code = unknown
      ? "UNKNOWN_OUTCOME"
      : Object.hasOwn(ERRORS, result.code)
        ? result.code
        : undefined;
    const status = unknown
      ? "unknown"
      : result.ok
        ? "ok"
        : code === "CANCELLED"
          ? "cancelled"
          : "error";
    const elapsed = performance.now() - started;
    diagnostics.observedOperations++;
    if (status === "error") diagnostics.errors++;
    if (unknown) diagnostics.unknownOutcomes++;
    diagnostics.events.push({
      id: randomUUID(),
      timestamp: Date.now(),
      operation: request.type,
      ...owned,
      status,
      durationMs: Number.isFinite(elapsed)
        ? Math.max(0, Math.min(elapsed, 86400000))
        : 0,
      ...(code && { code }),
    });
    if (diagnostics.events.length > 500) {
      diagnostics.events.shift();
      diagnostics.droppedEvents++;
    }
  }
  const controller = new AbortController();
  let revision = 0;
  let defaultWorkspace;
  let defaultSession;
  const context = runtime?.workbenchContext?.();
  const client = context?.client;
  let ready;
  const host = createHostAdmission({
    execute: handleRequest,
    ready: () => ready,
    revision: () => revision,
    projectReceipt,
    deadlineMs,
  });
  const effectMethods = new Set(
    [
      client?.session?.update,
      client?.session?.create,
      client?.session?.fork,
      client?.session?.remove,
      client?.session?.switchAgent,
      client?.session?.switchModel,
      client?.session?.prompt,
      client?.session?.command,
      client?.session?.interrupt,
      client?.permission?.reply,
    ].filter(Boolean),
  );
  function checkLive() {
    currentScope()?.check();
    if (controller.signal.aborted) fail("UNAVAILABLE");
  }
  function markEffect() {
    checkLive();
    currentScope()?.markEffect();
  }
  async function call(fn, ...args) {
    checkLive();
    if (!client || runtime.snapshot().state !== "connected")
      fail("UNAVAILABLE");
    const primary =
      [
        client.session?.create,
        client.session?.fork,
        client.session?.remove,
        client.session?.prompt,
        client.session?.command,
        client.session?.interrupt,
        client.permission?.reply,
      ].includes(fn) ||
      (fn === client.session?.update && Object.hasOwn(args[0] ?? {}, "title"));
    return host.sdk(fn, args, effectMethods.has(fn), primary);
  }
  function projectReceipt(record, request, response, effected) {
    record.revision = revision;
    const value = response.value;
    if (!response.ok && record.verifiedNone) {
      record.admission = "rejected";
      record.delivery = "pending";
      record.effect = "none";
      record.result = { kind: "rejected", code: response.code };
      return;
    }
    if (!response.ok || value?.status === "unknown") {
      record.delivery = effected ? "unknown" : "pending";
      record.effect = effected ? "unknown" : "none";
      if (!effected) {
        record.admission = "rejected";
        record.result = { kind: "rejected", code: response.code };
      }
      return;
    }
    const w = value?.selectedWorkspaceId ?? request.workspaceId;
    const sid = value?.selectedSessionId ?? request.sessionId;
    if (
      ["workspace.import", "workspace.create", "session.create"].includes(
        request.type,
      )
    ) {
      record.result = {
        kind: "created",
        workspaceId: w,
        ...(request.type === "session.create" && {
          sessionId: sid,
          nativeSessionId: sessions.get(sid)?.sdkId,
        }),
      };
    } else if (request.type === "session.fork") {
      record.result = {
        kind: "forked",
        workspaceId: w,
        sessionId: sid,
        nativeSessionId: sessions.get(sid)?.sdkId,
      };
    } else if (["workspace.remove", "session.remove"].includes(request.type)) {
      record.result = {
        kind: "removed",
        workspaceId: request.workspaceId,
        workspaceRemoved: request.type === "workspace.remove",
        removedSessionIds:
          record.removedSessionIds ?? [request.sessionId].filter(Boolean),
      };
    } else if (
      ["session.rename", "session.pin", "session.archive"].includes(
        request.type,
      )
    ) {
      record.result = {
        kind: "metadata",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
      };
    } else {
      const receipt = sessions
        .get(request.sessionId)
        ?.receipts.get(record.operationId);
      record.result = {
        kind: "delivery",
        status: value.status,
        ...(receipt?.inboxId && { nativeInboxId: receipt.inboxId }),
        ...(request.type === "permission.respond" && {
          nativeRequestId: request.requestId,
        }),
      };
      record.delivery = "accepted";
      record.effect = "pending";
      record.evidence = [
        {
          kind: "native-ack",
          ...(receipt?.inboxId
            ? { id: receipt.inboxId }
            : request.type === "permission.respond"
              ? { id: request.requestId }
              : {}),
        },
      ];
      return;
    }
    record.admission = "dispatched";
    record.delivery = "accepted";
    record.effect = "confirmed";
    record.evidence = [
      {
        kind: "host-registry",
        id: record.result.sessionId ?? record.result.workspaceId,
      },
    ];
  }
  function workspace(id) {
    checkLive();
    const value = workspaces.get(id);
    if (!value) fail("NOT_FOUND");
    return value;
  }
  function session(wid, sid) {
    const value = sessions.get(sid);
    if (!value || value.workspaceId !== wid || !workspaces.has(wid))
      fail("NOT_FOUND");
    return value;
  }
  async function recheck(w) {
    if (
      workspaces.get(w.id) !== w ||
      (await canonicalDirectory(w.path)) !== w.path ||
      workspaces.get(w.id) !== w
    )
      fail("FILE_DENIED");
    checkLive();
  }
  function addWorkspace(path, trusted, temporary = false) {
    checkLive();
    const old = [...workspaces.values()].find((w) => w.path === path);
    if (old) return old;
    if (workspaces.size >= 100) fail("LIMIT_REACHED");
    const w = {
      id: randomUUID(),
      name: basename(path),
      path,
      kind: "folder",
      trusted,
      trustRevision: 1,
      temporary,
      lock: false,
    };
    workspaces.set(w.id, w);
    revision++;
    return w;
  }
  async function addSession(w, info) {
    if (
      !opaque(info?.id) ||
      (await canonicalDirectory(info.location?.directory)) !== w.path ||
      [...sessions.values()].some((s) => s.sdkId === info.id)
    )
      fail("RUNTIME_ERROR");
    checkLive();
    if (workspaces.get(w.id) !== w) fail("NOT_FOUND");
    const s = {
      id: randomUUID(),
      workspaceId: w.id,
      sdkId: info.id,
      title: clip(info.title, 256) || "Untitled session",
      status: "idle",
      lock: false,
      unknown: false,
      pinned: false,
      archived: false,
      receipts: new Map(),
      invalidPermissions: new Set(),
      messages: [],
      permissions: [],
      generation: 0,
    };
    sessions.set(s.id, s);
    const record = currentScope()?.record;
    if (record && ["session.create", "session.fork"].includes(record.type)) {
      record.result = {
        kind: record.type === "session.fork" ? "forked" : "created",
        workspaceId: w.id,
        sessionId: s.id,
        nativeSessionId: s.sdkId,
      };
      record.evidence = [{ kind: "native-session", id: s.sdkId }];
    }
    revision++;
    return s;
  }
  async function policy(s) {
    try {
      await call(client.session.update, {
        sessionID: s.sdkId,
        permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
      });
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (
        info?.id !== s.sdkId ||
        (await canonicalDirectory(info.location?.directory)) !==
          workspace(s.workspaceId).path ||
        !policyMatches(info.permissions)
      )
        fail("POLICY_UNVERIFIED");
      s.policyError = false;
      return info;
    } catch {
      checkLive();
      s.policyError = true;
      fail("POLICY_UNVERIFIED");
    }
  }
  ready = host.startup(async () => {
    if (!client || !context?.session) return;
    const path = await canonicalDirectory(runtime.workspace);
    const w = addWorkspace(path, true, true);
    const s = await addSession(w, context.session);
    defaultWorkspace = w.id;
    defaultSession = s.id;
    try {
      await policy(s);
    } catch {
      checkLive();
      /* Expose initial policy failure; execution remains gated. */
    }
  });
  // Attach immediately; an unavailable startup must not emit an unhandled rejection.
  ready.catch(() => {});
  function base(w, s) {
    checkLive();
    return {
      runtimeEpoch: host.epoch,
      revision: ++revision,
      state: runtime?.snapshot().state ?? "unavailable",
      temporary: true,
      workspaces: [...workspaces.values()].map(
        ({ id, name, path, kind, trusted, trustRevision, temporary }) => ({
          id,
          name,
          path,
          kind,
          trusted,
          trustRevision,
          temporary,
        }),
      ),
      sessions: [...sessions.values()].map(
        ({
          id,
          workspaceId,
          title,
          status,
          pinned,
          archived,
          parentSessionId,
        }) => ({
          id,
          workspaceId,
          title,
          status,
          pinned,
          archived,
          ...(parentSessionId && { parentSessionId }),
        }),
      ),
      ...(w && { selectedWorkspaceId: w.id }),
      ...(s && { selectedSessionId: s.id }),
      messages: s?.messages ?? [],
      permissions: s?.permissions ?? [],
      ...(s?.error
        ? { error: s.error }
        : s?.policyError
          ? {
              error: {
                code: "POLICY_UNVERIFIED",
                message: ERRORS.POLICY_UNVERIFIED,
              },
            }
          : {}),
    };
  }
  async function refresh(s) {
    if (reads.has(s.id)) return reads.get(s.id);
    const generation = s.generation;
    const read = (async () => {
      try {
        const info = await call(client.session.get, { sessionID: s.sdkId });
        const active = await call(client.session.active);
        const inbox = await call(client.session.inbox.list, {
          sessionID: s.sdkId,
        });
        const messages = await call(client.message.list, {
          sessionID: s.sdkId,
          limit: 100,
          order: "desc",
        });
        const pending = await call(client.permission.list, {
          sessionID: s.sdkId,
        });
        if (
          info?.id !== s.sdkId ||
          (await canonicalDirectory(info.location?.directory)) !==
            workspace(s.workspaceId).path ||
          !active ||
          typeof active !== "object" ||
          !Array.isArray(inbox) ||
          !Array.isArray(messages?.data) ||
          !Array.isArray(pending)
        )
          fail("RUNTIME_ERROR");
        checkLive();
        if (s.generation !== generation || s.lock || sessions.get(s.id) !== s)
          return;
        s.messages = projectMessages([...messages.data].reverse());
        s.permissions = pending
          .filter(
            (p) =>
              p.sessionID === s.sdkId &&
              opaque(p.id) &&
              !s.invalidPermissions.has(p.id),
          )
          .slice(0, 100)
          .map((p) => ({
            id: p.id,
            sessionId: s.id,
            title: clip(p.action, 128),
            detail: clip(
              Array.isArray(p.resources)
                ? p.resources.filter((x) => typeof x === "string").join("\n")
                : "",
              2000,
            ),
          }));
        const running =
          active[s.sdkId]?.type === "running" ||
          inbox.some((item) => item.sessionID === s.sdkId);
        const observedReceipt = [...s.receipts.values()].some(
          (r) =>
            r.inboxId &&
            (inbox.some((i) => i.id === r.inboxId) ||
              messages.data.some((m) => m.id === r.inboxId)),
        );
        if (running)
          s.status = s.status === "stopping" ? "stopping" : "running";
        else if (
          !s.unknown &&
          (!s.awaiting ||
            observedReceipt ||
            (typeof info.time?.idle === "number" &&
              info.time.idle >= s.awaiting))
        ) {
          s.status = "idle";
          s.awaiting = undefined;
        } else s.status = s.unknown ? "unknown" : s.status;
        s.title = clip(info.title, 256) || s.title;
        const latest = messages.data.find((m) => m.type === "assistant");
        const failed = latest?.error ? latest : undefined;
        const code = s.unknown
          ? "UNKNOWN_OUTCOME"
          : failed
            ? structuredError(failed.error)
            : info.outcome === "failed"
              ? "RUNTIME_ERROR"
              : undefined;
        s.error = code ? { code, message: ERRORS[code] } : undefined;
      } catch {
        checkLive();
        if (s.generation === generation && !s.lock) {
          s.status = "unknown";
          s.error = { code: "RUNTIME_ERROR", message: ERRORS.RUNTIME_ERROR };
        }
      }
    })().finally(() => reads.delete(s.id));
    reads.set(s.id, read);
    return read;
  }
  async function catalog(w) {
    if (!w.trusted) return { dto: emptyCatalog(), models: new Map() };
    await recheck(w);
    const location = { location: { directory: w.path } };
    const group = async (fn) => {
      try {
        const result = await call(fn, location);
        if (!Array.isArray(result?.data)) throw new Error();
        return result.data.slice(0, 300);
      } catch {
        checkLive();
        return null;
      }
    };
    const commands = await group(client.command?.list);
    const skills = await group(client.skill?.list);
    const mcp = await group(client.mcp?.list);
    const agents = await group(client.agent?.list);
    const models = await group(client.model?.list);
    const providers = await group(client.provider?.list);
    const integrations = await group(client.integration?.list);
    const simple = (items, key = "id") =>
      items === null
        ? unavailable()
        : available(
            items
              .filter((i) => opaque(i[key]) && typeof i.name === "string")
              .map((i) => ({
                id: i[key],
                name: clip(i.name, 256),
                ...(typeof i.description === "string"
                  ? { description: clip(i.description, 1000) }
                  : {}),
              })),
          );
    const modelMap = new Map();
    for (const model of models ?? []) {
      const provider = providers?.find(
        (p) => p.id === model.providerID && p.activation !== "disabled",
      );
      const integration = integrations?.find(
        (i) => i.id === provider?.integrationID,
      );
      const authenticated = integration?.connections?.some(
        (c) => c.type === "credential" || c.type === "env",
      );
      if (
        model.enabled === true &&
        opaque(model.id) &&
        opaque(model.providerID) &&
        provider &&
        authenticated
      ) {
        const id = createHash("sha256")
          .update(JSON.stringify([model.providerID, model.id]))
          .digest("hex");
        modelMap.set(id, model);
      }
    }
    return {
      models: modelMap,
      dto: {
        commands: simple(commands, "name"),
        skills: simple(skills),
        agents: simple(
          agents?.filter(
            (a) => !a.hidden && ["primary", "all"].includes(a.mode),
          ) ?? null,
        ),
        mcp:
          mcp === null
            ? unavailable()
            : available(
                mcp
                  .filter((i) => opaque(i.name))
                  .map((i) => ({
                    id: i.name,
                    name: clip(i.name, 256),
                    status: [
                      "connected",
                      "pending",
                      "disabled",
                      "failed",
                      "needs_auth",
                    ].includes(i.status?.status)
                      ? i.status.status
                      : "unavailable",
                  })),
              ),
        models:
          models === null || providers === null || integrations === null
            ? unavailable()
            : available(
                [...modelMap].map(([id, m]) => ({
                  id,
                  name: clip(m.name, 256),
                  status: clip(m.status, 32),
                })),
              ),
      },
    };
  }
  async function send(request, w, s) {
    if (s.archived) fail("ARCHIVED_SESSION");
    const hash = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const previous = s.receipts.get(receiptKey);
    if (previous) {
      if (previous.hash !== hash) fail("DUPLICATE_CONFLICT");
      return previous.result?.ok === false
        ? previous.result
        : {
            ok: true,
            value: {
              requestId: request.requestId,
              status: previous.unknown ? "unknown" : "duplicate",
            },
          };
    }
    if (w.lock || s.lock || s.status !== "idle" || s.unknown) fail("BUSY");
    // Never evict old IDs then silently replay them. A full bounded registry fails closed.
    if (s.receipts.size >= 256) fail("LIMIT_REACHED");
    const receipt = { hash };
    s.receipts.set(receiptKey, receipt);
    s.lock = true;
    w.lock = true;
    s.generation++;
    let dispatched = false;
    let switching = false;
    try {
      await recheck(w);
      if (!w.trusted) fail("INVALID_SELECTION");
      await policy(s);
      const active = await call(client.session.active);
      const inbox = await call(client.session.inbox.list, {
        sessionID: s.sdkId,
      });
      if (!active || typeof active !== "object" || !Array.isArray(inbox))
        fail("RUNTIME_ERROR");
      if (active[s.sdkId] || inbox.some((item) => item.sessionID === s.sdkId)) {
        s.status = "running";
        fail("BUSY");
      }
      const inventory = await catalog(w);
      if (!inventory.models.size) fail("AUTH_REQUIRED");
      if (
        request.agent &&
        !inventory.dto.agents.entries.some((a) => a.id === request.agent)
      )
        fail("INVALID_SELECTION");
      if (request.model && !inventory.models.has(request.model))
        fail("INVALID_SELECTION");
      if (
        request.type === "command.run" &&
        !inventory.dto.commands.entries.some((c) => c.id === request.name)
      )
        fail("INVALID_SELECTION");
      switching = true;
      if (request.agent)
        await call(client.session.switchAgent, {
          sessionID: s.sdkId,
          agent: request.agent,
        });
      // An omitted selection means the runtime's own resolution, including any
      // session/agent defaults and variant. Catalog order is never a default.
      if (request.model) {
        const selected = inventory.models.get(request.model);
        await call(client.session.switchModel, {
          sessionID: s.sdkId,
          model: { id: selected.id, providerID: selected.providerID },
        });
      }
      await policy(s);
      switching = false;
      await recheck(w);
      s.status = "running";
      s.awaiting = Date.now();
      dispatched = true;
      if (request.type === "message.send") {
        const result = await call(client.session.prompt, {
          sessionID: s.sdkId,
          text: request.text,
        });
        if (
          !opaque(result?.id) ||
          result.sessionID !== s.sdkId ||
          result.type !== "user" ||
          result.payload?.text !== request.text
        )
          throw new Error("invalid_receipt");
        receipt.inboxId = result.id;
      } else
        await call(client.session.command, {
          sessionID: s.sdkId,
          name: request.name,
          text: request.arguments,
        });
      receipt.result = {
        ok: true,
        value: { requestId: request.requestId, status: "accepted" },
      };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        receipt.unknown = true;
        receipt.result = {
          ok: true,
          value: { requestId: request.requestId, status: "unknown" },
        };
      } else {
        if (switching && error.appCode !== "POLICY_UNVERIFIED") {
          s.unknown = true;
          s.status = "unknown";
        }
        receipt.result = failure(error.appCode ?? "RUNTIME_ERROR");
      }
    } finally {
      s.lock = false;
      w.lock = false;
      s.generation++;
      revision++;
    }
    return receipt.result;
  }
  function successor(w) {
    return [...sessions.values()].find(
      (item) => item.workspaceId === w.id && !item.archived,
    );
  }
  function safeSnapshot(w, preferred) {
    if (!w || workspaces.get(w.id) !== w) return base();
    const selected =
      preferred &&
      sessions.get(preferred.id) === preferred &&
      !preferred.archived
        ? preferred
        : successor(w);
    return base(w, selected);
  }
  async function idleIdentity(w, s) {
    await recheck(w);
    if (sessions.get(s.id) !== s || s.workspaceId !== w.id) fail("NOT_FOUND");
    if (s.unknown || s.status !== "idle" || s.awaiting) fail("BUSY");
    const info = await call(client.session.get, { sessionID: s.sdkId });
    const active = await call(client.session.active);
    const inbox = await call(client.session.inbox.list, { sessionID: s.sdkId });
    if (
      info?.id !== s.sdkId ||
      (await canonicalDirectory(info.location?.directory)) !== w.path ||
      !active ||
      typeof active !== "object" ||
      Array.isArray(active) ||
      !Array.isArray(inbox)
    )
      fail("RUNTIME_ERROR");
    await recheck(w);
    if (sessions.get(s.id) !== s) fail("NOT_FOUND");
    if (
      active[s.sdkId] ||
      inbox.length ||
      s.unknown ||
      s.status !== "idle" ||
      s.awaiting
    )
      fail("BUSY");
    return info;
  }
  // Exhaust the installed SDK's cursor contract, including empty intermediate pages.
  async function scanSessions(input, visit, code) {
    const seen = new Set();
    let cursor;
    try {
      for (let page = 0; page < 100; page++) {
        const result = await call(client.session.list, {
          ...input,
          limit: 100,
          ...(cursor && { cursor }),
        });
        if (
          !result ||
          !Array.isArray(result.data) ||
          result.data.length > 100 ||
          !result.cursor ||
          typeof result.cursor !== "object" ||
          Array.isArray(result.cursor) ||
          result.data.some((item) => !opaque(item?.id))
        )
          fail(code);
        const next = result.cursor.next;
        if (
          next !== undefined &&
          next !== null &&
          (typeof next !== "string" ||
            !next.length ||
            next.length > 8192 ||
            [...next].some(
              (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
            ) ||
            seen.has(next))
        )
          fail(code);
        visit(result.data);
        if (next === undefined || next === null) return;
        seen.add(next);
        cursor = next;
      }
      fail(code);
    } catch (error) {
      if (error.appCode === "HAS_DESCENDANTS") throw error;
      fail(code);
    }
  }
  async function noDescendants(s) {
    if ([...sessions.values()].some((item) => item.parentSessionId === s.id))
      fail("HAS_DESCENDANTS");
    await scanSessions(
      {},
      (data) => {
        for (const item of data) {
          if (
            (item.parentID != null && !opaque(item.parentID)) ||
            (item.fork != null &&
              (typeof item.fork !== "object" ||
                Array.isArray(item.fork) ||
                !opaque(item.fork.sessionID)))
          )
            fail("DESCENDANTS_UNVERIFIED");
          if (item.parentID === s.sdkId || item.fork?.sessionID === s.sdkId)
            fail("HAS_DESCENDANTS");
        }
      },
      "DESCENDANTS_UNVERIFIED",
    );
  }
  async function verifyRemoved(s) {
    // Only this exact typed SDK error proves absence; generic failures fall back to a complete scan.
    try {
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (info?.id === s.sdkId) fail("UNKNOWN_OUTCOME");
    } catch (error) {
      if (
        error?._tag === "SessionNotFoundError" &&
        error.sessionID === s.sdkId &&
        typeof error.message === "string"
      )
        return;
      if (error.appCode === "UNKNOWN_OUTCOME") throw error;
    }
    await scanSessions(
      {},
      (data) => {
        if (data.some((item) => item.id === s.sdkId)) fail("UNKNOWN_OUTCOME");
      },
      "UNKNOWN_OUTCOME",
    );
  }
  async function lifecycle(request) {
    const hash = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const prior = lifecycleReceipts.get(receiptKey);
    if (prior) {
      if (prior.hash !== hash) fail("DUPLICATE_CONFLICT");
      if (!prior.result) fail("BUSY");
      if (!prior.result.ok) return prior.result;
      return {
        ok: true,
        value: safeSnapshot(
          workspaces.get(request.workspaceId),
          sessions.get(prior.selectedSessionId),
        ),
      };
    }
    const w = workspace(request.workspaceId);
    const s = session(w.id, request.sessionId);
    if (lifecycleReceipts.size >= 2048) fail("LIMIT_REACHED");
    const receipt = { hash };
    lifecycleReceipts.set(receiptKey, receipt);
    const started = performance.now();
    let locked = false;
    let dispatched = false;
    let child;
    try {
      if (
        w.lock ||
        s.lock ||
        s.status !== "idle" ||
        s.unknown ||
        s.awaiting ||
        [...sessions.values()].some(
          (item) => item.workspaceId === w.id && item.lock,
        )
      )
        fail("BUSY");
      w.lock = true;
      s.lock = true;
      locked = true;
      s.generation++;
      await idleIdentity(w, s);
      if (request.type === "session.rename") {
        dispatched = true;
        await call(client.session.update, {
          sessionID: s.sdkId,
          title: request.title,
        });
        const updated = await idleIdentity(w, s);
        if (updated.title !== request.title) fail("UNKNOWN_OUTCOME");
        s.title = request.title;
      } else if (request.type === "session.pin") {
        markEffect();
        s.pinned = request.pinned;
      } else if (request.type === "session.archive") {
        markEffect();
        s.archived = request.archived;
      } else if (request.type === "session.fork") {
        if (!w.trusted) fail("INVALID_SELECTION");
        if (sessions.size >= 200) fail("LIMIT_REACHED");
        dispatched = true;
        let forked;
        try {
          forked = await call(client.session.fork, { sessionID: s.sdkId });
        } catch (error) {
          // Only this typed SDK rejection proves the fork had no effect.
          if (
            error?._tag === "InvalidRequestError" &&
            error.kind === "empty_session"
          ) {
            dispatched = false;
            const record = currentScope()?.record;
            if (record) {
              record.verifiedNone = true;
              record.evidence = [
                { kind: "native-rejected-empty", id: s.sdkId },
              ];
            }
            fail("EMPTY_SESSION");
          }
          throw error;
        }
        child = await addSession(w, forked);
        child.parentSessionId = s.id;
        child.archived = true;
        child.unknown = true;
        child.status = "unknown";
        await policy(child);
        if (request.title)
          await call(client.session.update, {
            sessionID: child.sdkId,
            title: request.title,
          });
        const checked = await call(client.session.get, {
          sessionID: child.sdkId,
        });
        if (
          checked?.id !== child.sdkId ||
          (await canonicalDirectory(checked.location?.directory)) !== w.path ||
          !policyMatches(checked.permissions) ||
          (request.title && checked.title !== request.title)
        )
          fail("UNKNOWN_OUTCOME");
        await idleIdentity(w, s);
        child.title = clip(checked.title, 256) || child.title;
        child.archived = false;
        child.unknown = false;
        child.status = "idle";
      } else if (request.type === "session.remove") {
        await noDescendants(s);
        const info = await idleIdentity(w, s);
        markEffect();
        if (
          !(await confirmSessionRemoval({
            title: clip(info.title, 256) || s.title,
            workspaceName: w.name,
            path: w.path,
          }))
        )
          fail("CANCELLED");
        await idleIdentity(w, s);
        await noDescendants(s);
        await idleIdentity(w, s);
        dispatched = true;
        await call(client.session.remove, { sessionID: s.sdkId });
        await verifyRemoved(s);
        sessions.delete(s.id);
      }
      const selected =
        child ?? (sessions.has(s.id) && !s.archived ? s : successor(w));
      defaultWorkspace = w.id;
      defaultSession = selected?.id;
      receipt.selectedSessionId = selected?.id;
      receipt.result = { ok: true, value: safeSnapshot(w, selected) };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        if (child) {
          child.unknown = true;
          child.status = "unknown";
          child.archived = true;
        }
        receipt.result = failure("UNKNOWN_OUTCOME");
      } else
        receipt.result = failure(
          Object.hasOwn(ERRORS, error.appCode)
            ? error.appCode
            : "RUNTIME_ERROR",
        );
    } finally {
      if (locked) {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
      // Keep only the outcome, never a stale snapshot containing conversation text.
      const result = receipt.result;
      observe(request, result, started, { workspaceId: w.id, sessionId: s.id });
      if (result.ok) receipt.result = { ok: true };
    }
    return receipt.result.ok
      ? {
          ok: true,
          value: safeSnapshot(w, sessions.get(receipt.selectedSessionId)),
        }
      : receipt.result;
  }
  async function execute(request) {
    await ready;
    checkLive();
    if (lifecycleTypes.has(request.type)) return lifecycle(request);
    const w = request.workspaceId ? workspace(request.workspaceId) : undefined;
    const s = request.sessionId
      ? session(request.workspaceId, request.sessionId)
      : undefined;
    if (request.type === "diagnostics.list")
      return {
        ...diagnostics,
        events: diagnostics.events
          .filter(
            (event) =>
              (!w || event.workspaceId === w.id) &&
              (!s || event.sessionId === s.id),
          )
          .map((event) => ({ ...event })),
      };
    if (request.type === "snapshot") {
      const selectedW = w ?? workspaces.get(defaultWorkspace);
      const selectedS =
        s ??
        (w
          ? [...sessions.values()].find(
              (item) => item.workspaceId === w.id && !item.archived,
            )
          : sessions.get(defaultSession));
      if (selectedS) await refresh(selectedS);
      return base(selectedW, selectedS);
    }
    if (
      request.type === "workspace.import" ||
      request.type === "workspace.create"
    ) {
      if (workspaces.size >= 100) fail("LIMIT_REACHED");
      if (request.name?.trim() && !portableName(request.name))
        fail("INVALID_REQUEST");
      markEffect();
      const picked = await pickDirectory();
      checkLive();
      if (!picked) fail("CANCELLED");
      markEffect();
      const path =
        request.type === "workspace.create"
          ? await createFolder(picked, request.name)
          : await canonicalDirectory(picked);
      // Both ordinary new directories and imports require native trust before SDK activation.
      return base(addWorkspace(path, false));
    }
    if (request.type === "workspace.remove") {
      if (
        w.lock ||
        [...sessions.values()].some(
          (item) =>
            item.workspaceId === w.id &&
            (item.lock || item.status !== "idle" || item.unknown),
        )
      )
        fail("BUSY");
      markEffect();
      const record = currentScope()?.record;
      if (record)
        record.removedSessionIds = [...sessions.values()]
          .filter((item) => item.workspaceId === w.id)
          .map((item) => item.id);
      for (const item of sessions.values())
        if (item.workspaceId === w.id) {
          sessions.delete(item.id);
          item.generation++;
        }
      workspaces.delete(w.id);
      return base();
    }
    if (request.type === "session.create") {
      if (w.lock) fail("BUSY");
      if (sessions.size >= 200) fail("LIMIT_REACHED");
      w.lock = true;
      try {
        await recheck(w);
        if (!w.trusted) {
          markEffect();
          if (!(await confirmTrust(w.path))) fail("CANCELLED");
          await recheck(w);
          markEffect();
          w.trusted = true;
          w.trustRevision++;
        }
        const info = await call(client.session.create, {
          title: request.title || "Untitled session",
          location: { directory: w.path },
          permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
        });
        const created = await addSession(w, info);
        await policy(created);
        return base(w, created);
      } finally {
        w.lock = false;
      }
    }
    if (request.type === "catalog.list") return (await catalog(w)).dto;
    if (request.type === "file.list" || request.type === "file.read") {
      await recheck(w);
      try {
        return request.type === "file.list"
          ? await listFiles(w.path, request.path)
          : await readFilePreview(w.path, request.path);
      } catch (error) {
        fail(error.appCode ?? "FILE_DENIED");
      }
    }
    if (request.type === "message.send" || request.type === "command.run")
      return send(request, w, s);
    if (request.type === "session.interrupt") {
      if (w.lock || s.lock) fail("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        const acknowledgement = await call(client.session.interrupt, {
          sessionID: s.sdkId,
        });
        if (acknowledgement?.interrupted !== true) fail("UNKNOWN_OUTCOME");
        s.status = "stopping";
        return { status: "stopping" };
      } catch {
        s.unknown = true;
        s.status = "unknown";
        return { status: "unknown" };
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    if (request.type === "permission.respond") {
      if (w.lock || s.lock) fail("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        const pending = await call(client.permission.list, {
          sessionID: s.sdkId,
        });
        if (
          !Array.isArray(pending) ||
          s.invalidPermissions.has(request.requestId) ||
          !pending.some(
            (p) => p.id === request.requestId && p.sessionID === s.sdkId,
          )
        )
          fail("STALE_PERMISSION");
        if (s.invalidPermissions.size + pending.length > 2048)
          fail("LIMIT_REACHED");
        markEffect();
        for (const p of pending)
          if (
            p.sessionID === s.sdkId &&
            (request.decision === "reject" || p.id === request.requestId)
          )
            s.invalidPermissions.add(p.id);
        s.permissions = [];
        try {
          await call(client.permission.reply, {
            sessionID: s.sdkId,
            requestID: request.requestId,
            decision: request.decision,
          });
          return { requestId: request.requestId, status: "decided" };
        } catch {
          s.unknown = true;
          s.status = "unknown";
          return { requestId: request.requestId, status: "unknown" };
        }
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    fail("INVALID_REQUEST");
  }
  async function handleRequest(value) {
    let request;
    let owned;
    let result;
    const started = performance.now();
    try {
      request = validateRequest(value);
      await ready;
      checkLive();
      const w = workspaces.get(request.workspaceId);
      const s = sessions.get(request.sessionId);
      if (
        (!request.workspaceId || w) &&
        (!request.sessionId || (s && s.workspaceId === w?.id))
      )
        owned = {
          ...(w && { workspaceId: w.id }),
          ...(s && { sessionId: s.id }),
        };
      const executed = await execute(request);
      result =
        lifecycleTypes.has(request.type) ||
        request.type === "message.send" ||
        request.type === "command.run"
          ? executed
          : { ok: true, value: executed };
    } catch (error) {
      result = failure(
        Object.hasOwn(ERRORS, error.appCode) ? error.appCode : "RUNTIME_ERROR",
      );
    }
    if (
      owned &&
      mutationTypes.has(request?.type) &&
      !lifecycleTypes.has(request.type) &&
      result.value?.status !== "duplicate"
    )
      observe(request, result, started, owned);
    return result;
  }
  return {
    handle(value, sender) {
      if (trustedTestAdapter && sender === undefined)
        return host.trusted(() => handleRequest(value));
      return host.handle(value, sender);
    },
    cancelRead: (value, sender) => host.cancel(value, sender),
    closeSender: (sender) => host.closeSender(sender),
    close() {
      controller.abort();
      host.close();
    },
  };
}
