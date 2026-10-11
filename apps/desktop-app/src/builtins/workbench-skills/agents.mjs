// Fixed trusted producer. No discovery, file IO, model calls or user module loading.
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import {
  NATIVE_AGENTS_RPC,
  NATIVE_AGENT_LIMITS,
  validateAgentRpc,
  validAgentOwner,
  sameAgentOwner,
  validNativeAgent,
  validAgentProjection,
  validateAgentRpcResult,
  nativeAgentDigest,
  nativeAgentOperationKey,
  nativeAgentRequestDigest,
} from "../../native-agents-protocol.mjs";
import { BASELINE_POLICY } from "../../renderer/shared/configuration-draft/policy.mjs";

const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
// Read data descriptors only. Never invoke caller getters or toJSON hooks.
function snapshot(value) {
  if (!value || typeof value !== "object") return value;
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error("invalid_context");
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1)
    throw new Error("invalid_context");
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const slot = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !Object.hasOwn(slot, "value"))
      throw new Error("invalid_context");
    Object.defineProperty(result, key, {
      value: snapshot(slot.value),
      enumerable: true,
    });
  }
  return Object.freeze(result);
}
function projection(record) {
  const result = {};
  for (const key of ["id", "name", "mode", "hidden"]) {
    const slot = record && Object.getOwnPropertyDescriptor(record, key);
    if (!slot || !Object.hasOwn(slot, "value"))
      throw new RegistryError("identity_conflict");
    result[key] = slot.value;
  }
  if (!validAgentProjection(result))
    throw new RegistryError("identity_conflict");
  return Object.freeze(result);
}
const refused = (code) => Object.freeze({ denied: code });
const unknown = (reason) => Object.freeze({ status: "unknown", reason });
class RegistryError extends Error {
  constructor(reason) {
    super("Native Agent registry unavailable.");
    this.reason = reason;
  }
}
function denied(context, code) {
  const message = "Native Agent request denied.";
  if (typeof context?.error === "function")
    return context.error("denied", message, { code });
  throw Object.assign(new Error(message), {
    type: "denied",
    data: { code },
  });
}
function validOptions(value) {
  return Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === 1 &&
      Object.hasOwn(
        Object.getOwnPropertyDescriptor(value, "nonce") ?? {},
        "value",
      ) &&
      typeof value.nonce === "string" &&
      /^[a-f0-9]{64}$/u.test(value.nonce),
  );
}

export async function setupNativeAgents(ctx) {
  let directory;
  try {
    if (!validOptions(ctx.options)) throw new Error();
    directory = ctx.location.directory;
    validateAgentRpc("observe", {
      nonce: ctx.options.nonce,
      workspaceId: "context",
      workspacePath: directory,
    });
    if (resolve(directory) !== directory) throw new Error();
  } catch {
    throw new Error("invalid_context");
  }
  const authority = Buffer.from(ctx.options.nonce, "hex");
  const owned = new Map(); // sourceName -> immutable original owner and record
  const operations = new Map(); // original [epoch, opid], never evicted/replayed
  let desired = Object.freeze([]);
  let active = true;
  let uncertain = false;
  let transformFailed = false;
  let transformInstalled = false;
  let queue = Promise.resolve();
  let queued = 0;
  let closing;
  const registrations = [];
  const current = () => active && ctx.location.directory === directory;
  const publish = () => (desired = Object.freeze([...owned.values()]));
  const deliver = (result, context) =>
    result.denied ? denied(context, result.denied) : result;

  function prepare(method, input) {
    // Portable RPC schemas are not an authority check. Validate direct calls too.
    try {
      validateAgentRpc(method, input);
    } catch {
      return refused("invalid_context");
    }
    if (!current()) return refused("invalid_context");
    if (!timingSafeEqual(authority, Buffer.from(input.nonce, "hex")))
      return refused("nonce_mismatch");
    const requestedRoot = input.owner?.workspacePath ?? input.workspacePath;
    if (requestedRoot !== directory) return refused("invalid_context");
    // Clone before enqueue/await. Never retain a caller-owned mutable object.
    try {
      return snapshot(input);
    } catch {
      return refused("invalid_context");
    }
  }

  async function nativeList() {
    // The actual Promise endpoint preserves both location and data.
    let native;
    try {
      const response = await ctx.agent.list();
      if (
        !response ||
        Object.keys(response).sort().join() !== "data,location" ||
        !response.location ||
        Object.keys(response.location).join() !== "directory" ||
        response.location.directory !== directory
      )
        throw new RegistryError("runtime_error");
      native = response.data;
    } catch {
      throw new RegistryError("runtime_error");
    }
    if (!Array.isArray(native)) throw new RegistryError("runtime_error");
    if (native.length > NATIVE_AGENT_LIMITS.native)
      throw new RegistryError("retained_limit");
    if (Reflect.ownKeys(native).length !== native.length + 1)
      throw new RegistryError("identity_conflict");
    const ids = new Set();
    const rows = [];
    for (let i = 0; i < native.length; i++) {
      const slot = Object.getOwnPropertyDescriptor(native, String(i));
      if (!slot || !Object.hasOwn(slot, "value"))
        throw new RegistryError("identity_conflict");
      const record = slot.value;
      const minimal = projection(record);
      if (ids.has(minimal.id)) throw new RegistryError("identity_conflict");
      ids.add(minimal.id);
      const held = desired.find((row) => row.record.id === minimal.id);
      if (held && !validNativeAgent(record, held.owner))
        throw new RegistryError("identity_conflict");
      rows.push(held ? snapshot(record) : minimal);
    }
    return Object.freeze(rows);
  }

  function consistent(native, workspaceId) {
    if (transformFailed || owned.size > NATIVE_AGENT_LIMITS.owned) return false;
    for (const [sourceName, row] of owned) {
      const record = native.find((item) => item.id === row.record.id);
      if (
        !validAgentOwner(row.owner) ||
        row.owner.workspaceId !== workspaceId ||
        row.owner.workspacePath !== directory ||
        row.owner.sourceName !== sourceName ||
        !validNativeAgent(row.record, row.owner) ||
        row.recordDigest !== nativeAgentDigest(row.record) ||
        !validNativeAgent(record, row.owner) ||
        nativeAgentDigest(record) !== row.recordDigest
      )
        return false;
    }
    return true;
  }

  async function observe(input) {
    try {
      const native = await nativeList();
      if (!current())
        return freeze({ status: "unavailable", reason: "invalid_context" });
      if (!consistent(native, input.workspaceId))
        return freeze({ status: "unavailable", reason: "identity_conflict" });
      return freeze(
        validateAgentRpcResult("observe", {
          status: "ready",
          version: 1,
          workspaceId: input.workspaceId,
          workspacePath: directory,
          rows: [...owned.values()],
          native: native.map(projection),
          defaultAgentId: native[0]?.id ?? null,
        }),
      );
    } catch (error) {
      return freeze({
        status: "unavailable",
        reason: error instanceof RegistryError ? error.reason : "runtime_error",
      });
    }
  }

  async function mutate(method, input, operation) {
    const complete = (result) => {
      operation.result = result;
      operation.pending = false;
      Object.freeze(operation);
      return result;
    };
    if (uncertain) return complete(refused("changed"));
    let before;
    try {
      before = await nativeList();
    } catch (error) {
      return complete(
        refused(
          error.reason === "retained_limit" ? "retained_limit" : "changed",
        ),
      );
    }
    if (!current()) return complete(refused("invalid_context"));
    if (!consistent(before, input.owner.workspaceId))
      return complete(refused("changed"));
    const prior = owned.get(input.owner.sourceName);
    const defaultAgentId = before[0]?.id ?? null;
    let result;
    if (method === "register") {
      if (prior || defaultAgentId === null) return complete(refused("changed"));
      if (before.some((record) => record.id === input.record.id))
        return complete(refused("collision"));
      if (
        owned.size >= NATIVE_AGENT_LIMITS.owned ||
        before.length + 1 > NATIVE_AGENT_LIMITS.native
      )
        return complete(refused("retained_limit"));
      try {
        await installTransform();
        if (!current() || transformFailed || uncertain) throw new Error();
        const installed = await nativeList();
        if (
          !current() ||
          !consistent(installed, input.owner.workspaceId) ||
          (installed[0]?.id ?? null) !== defaultAgentId ||
          installed.some((record) => record.id === input.record.id) ||
          installed.length + 1 > NATIVE_AGENT_LIMITS.native
        )
          throw new Error();
      } catch {
        // Registration may already have installed a hook. Never claim rollback.
        uncertain = true;
        return complete(unknown("verification_failed"));
      }
      const row = freeze({
        owner: input.owner,
        record: input.record,
        recordDigest: input.recordDigest,
      });
      owned.set(input.owner.sourceName, row);
      result = freeze({
        status: "registered",
        ...row,
        defaultAgentId,
      });
    } else {
      // Authenticated Main has just proved global session-reference absence.
      // The plugin session domain has no list method; never invent one here.
      if (
        !prior ||
        !sameAgentOwner(prior.owner, input.registration) ||
        prior.record.id !== input.nativeId ||
        prior.recordDigest !== input.recordDigest ||
        defaultAgentId === input.nativeId
      )
        return complete(refused("changed"));
      owned.delete(input.owner.sourceName);
      result = freeze({
        status: "removed",
        owner: input.owner,
        registration: input.registration,
        nativeId: input.nativeId,
        recordDigest: input.recordDigest,
        defaultAgentId,
      });
    }
    publish();
    try {
      await ctx.agent.reload();
    } catch {
      uncertain = true;
      return complete(unknown("reload_failed"));
    }
    // No rollback: reload may already have changed Native state.
    try {
      const after = await nativeList();
      if (
        !current() ||
        !consistent(after, input.owner.workspaceId) ||
        (after[0]?.id ?? null) !== defaultAgentId ||
        (method === "remove" &&
          after.some((record) => record.id === input.nativeId)) ||
        (method === "remove" && owned.has(input.owner.sourceName))
      )
        throw new RegistryError("identity_conflict");
    } catch {
      uncertain = true;
      return complete(unknown("verification_failed"));
    }
    return complete(freeze(validateAgentRpcResult(method, result)));
  }

  function handler(method) {
    return (input, context) => {
      const prepared = prepare(method, input);
      if (prepared.denied)
        return Promise.resolve().then(() => deliver(prepared, context));
      let operation;
      let key;
      let digest;
      if (method !== "observe") {
        key = nativeAgentOperationKey(prepared.owner);
        digest = nativeAgentRequestDigest(method, prepared);
        const cached = operations.get(key);
        if (cached) {
          if (cached.digest !== digest)
            return Promise.resolve().then(() =>
              denied(context, "identity_conflict"),
            );
          // Pending duplicates share the first promise, even at queue capacity.
          return cached.promise.then((result) => deliver(result, context));
        }
        if (operations.size >= NATIVE_AGENT_LIMITS.operations)
          return Promise.resolve().then(() =>
            denied(context, "retained_limit"),
          );
      }
      if (queued >= NATIVE_AGENT_LIMITS.operations)
        return Promise.resolve().then(() => denied(context, "retained_limit"));
      if (method !== "observe") {
        // Reserve capacity and original identity synchronously, before any await.
        operation = {
          digest,
          result: unknown("verification_failed"),
          pending: true,
        };
        operations.set(key, operation);
      }
      queued++;
      const work = queue.then(async () => {
        if (!current()) {
          const result = refused("invalid_context");
          if (operation) {
            operation.result = result;
            operation.pending = false;
            Object.freeze(operation);
          }
          return result;
        }
        return method === "observe"
          ? observe(prepared)
          : mutate(method, prepared, operation);
      });
      // A denial or a disconnected caller cannot poison subsequent queue work.
      queue = work.then(
        () => {},
        () => {},
      );
      const settled = work.finally(() => {
        queued--;
      });
      if (operation) operation.promise = settled;
      return settled.then((result) => deliver(result, context));
    };
  }

  async function close() {
    if (!closing) {
      active = false;
      desired = Object.freeze([]);
      owned.clear();
      // Do not await the handler queue: a host reload may itself await disposal.
      closing = Promise.allSettled(
        registrations.map((registration) =>
          Promise.resolve().then(() => registration.dispose()),
        ),
      ).then((results) => {
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Native Agent cleanup failed.");
      });
    }
    return closing;
  }

  async function installTransform() {
    if (transformInstalled) return;
    // Main dispatches accepted mutations only after Native startup. Install once,
    // after the post-config transform, so its global deny remains on builtins.
    const registration = await ctx.agent.transform(applyDesired);
    if (!current()) {
      // close deliberately does not wait for this queue. A late registration
      // must dispose itself, even when close has already disposed its list.
      await registration.dispose();
      throw new Error("Native Agent registration closed.");
    }
    registrations.push(registration);
    transformInstalled = true;
  }

  function applyDesired(editor) {
    if (!active) return;
    try {
      if (!current() || transformFailed) throw new Error();
      const base = editor.list();
      if (
        !Array.isArray(base) ||
        base.length + desired.length > NATIVE_AGENT_LIMITS.native ||
        new Set(base.map((record) => projection(record).id)).size !==
          base.length ||
        desired.some((row) =>
          base.some((record) => record.id === row.record.id),
        )
      )
        throw new Error();
      // Check all collisions before adding any record. This hook is synchronous.
      for (const row of desired) {
        editor.update(row.record.id, (record) => {
          // update creates a permissive missing default. Replace ALL fields,
          // including model/steps/unknowns; never append inherited rules.
          for (const key of Reflect.ownKeys(record)) delete record[key];
          Object.assign(record, {
            ...row.record,
            mode: "primary",
            hidden: false,
            request: { settings: {}, headers: {}, body: {} },
            permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
          });
        });
      }
    } catch {
      // Native State.group may swallow this exception and retry without us.
      // Exact public bytes alone must never turn that failed group into ownership.
      transformFailed = true;
      uncertain = true;
      throw new Error("Native Agent transform failed.");
    }
  }

  try {
    registrations.push(
      await ctx.rpc.register(NATIVE_AGENTS_RPC, {
        observe: handler("observe"),
        register: handler("register"),
        remove: handler("remove"),
      }),
    );
  } catch {
    await close();
    throw new Error("Native Agent setup failed.");
  }
  return Object.freeze({ dispose: close });
}
