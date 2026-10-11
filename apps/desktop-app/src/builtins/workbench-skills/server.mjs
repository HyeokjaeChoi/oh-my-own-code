// Fixed trusted producer. No discovery, file IO, activation or user module loading.
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { setupNativeAgents } from "./agents.mjs";
import { setupNativeExtensions } from "./extensions.mjs";
import {
  NATIVE_SKILLS_RPC,
  NATIVE_SKILL_LIMITS,
  validateSkillRpc,
  validSkillOwner,
  sameSkillOwner,
  validNativeSkill,
  validObservedNativeSkill,
  nativeSkillDigest,
  nativeSkillOperationKey,
  nativeSkillRequestDigest,
} from "../../native-skills-protocol.mjs";

const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const snapshot = (value) => freeze(JSON.parse(JSON.stringify(value)));
const refused = (code) => Object.freeze({ denied: code });
const unknown = (reason) => Object.freeze({ status: "unknown", reason });
class RegistryError extends Error {
  constructor(reason) {
    super("Native Skill registry unavailable.");
    this.reason = reason;
  }
}
function denied(context, code) {
  const message = "Native Skill request denied.";
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

export default Object.freeze({
  id: "omoc.workbench.skills",
  async setup(ctx) {
    let directory;
    try {
      if (!validOptions(ctx.options)) throw new Error();
      directory = ctx.location.directory;
      validateSkillRpc("observe", {
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
        validateSkillRpc(method, input);
      } catch {
        return refused("invalid_context");
      }
      if (!current()) return refused("invalid_context");
      if (!timingSafeEqual(authority, Buffer.from(input.nonce, "hex")))
        return refused("nonce_mismatch");
      const requestedRoot = input.owner?.workspacePath ?? input.workspacePath;
      if (requestedRoot !== directory) return refused("invalid_context");
      // Clone before enqueue/await. Never retain a caller-owned mutable object.
      return snapshot(input);
    }

    async function nativeList() {
      // The actual Promise endpoint preserves both location and data.
      let native;
      try {
        const response = await ctx.skill.list();
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
      if (native.length > NATIVE_SKILL_LIMITS.native)
        throw new RegistryError("retained_limit");
      const ids = new Set();
      for (const record of native) {
        if (!validObservedNativeSkill(record) || ids.has(record.id))
          throw new RegistryError("identity_conflict");
        ids.add(record.id);
      }
      return snapshot(native);
    }

    function consistent(native, workspaceId) {
      if (transformFailed || owned.size > NATIVE_SKILL_LIMITS.owned)
        return false;
      for (const [sourceName, row] of owned) {
        const record = native.find((item) => item.id === row.record.id);
        if (
          !validSkillOwner(row.owner) ||
          row.owner.workspaceId !== workspaceId ||
          row.owner.workspacePath !== directory ||
          row.owner.sourceName !== sourceName ||
          !validNativeSkill(row.record, row.owner) ||
          row.recordDigest !== nativeSkillDigest(row.record) ||
          !validNativeSkill(record, row.owner) ||
          nativeSkillDigest(record) !== row.recordDigest
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
        return freeze({
          status: "ready",
          version: 1,
          workspaceId: input.workspaceId,
          workspacePath: directory,
          rows: [...owned.values()],
          native,
        });
      } catch (error) {
        return freeze({
          status: "unavailable",
          reason:
            error instanceof RegistryError ? error.reason : "runtime_error",
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
      let result;
      if (method === "registerDisabled") {
        if (input.expectedNativeId !== (prior?.record.id ?? null))
          return complete(refused("changed"));
        if (before.some((record) => record.id === input.record.id))
          return complete(refused("collision"));
        if (
          (!prior && owned.size >= NATIVE_SKILL_LIMITS.owned) ||
          before.length + (prior ? 0 : 1) > NATIVE_SKILL_LIMITS.native
        )
          return complete(refused("retained_limit"));
        const row = freeze({
          owner: input.owner,
          record: input.record,
          recordDigest: input.recordDigest,
        });
        owned.set(input.owner.sourceName, row);
        result = freeze({
          status: "registered_disabled",
          ...row,
          previousNativeId: prior?.record.id ?? null,
        });
      } else {
        if (
          !prior ||
          !sameSkillOwner(prior.owner, input.registration) ||
          prior.record.id !== input.nativeId ||
          prior.recordDigest !== input.recordDigest
        )
          return complete(refused("changed"));
        owned.delete(input.owner.sourceName);
        result = freeze({
          status: "removed",
          owner: input.owner,
          registration: input.registration,
          nativeId: input.nativeId,
          recordDigest: input.recordDigest,
        });
      }
      publish();
      try {
        await ctx.skill.reload();
      } catch {
        uncertain = true;
        return complete(unknown("reload_failed"));
      }
      // No rollback: reload may already have changed Native state.
      try {
        const after = await nativeList();
        const absentId =
          method === "removeOwned" ? input.nativeId : prior?.record.id;
        if (
          !current() ||
          !consistent(after, input.owner.workspaceId) ||
          (absentId && after.some((record) => record.id === absentId)) ||
          (method === "removeOwned" && owned.has(input.owner.sourceName))
        )
          throw new RegistryError("identity_conflict");
      } catch {
        uncertain = true;
        return complete(unknown("verification_failed"));
      }
      return complete(result);
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
          key = nativeSkillOperationKey(prepared.owner);
          digest = nativeSkillRequestDigest(method, prepared);
          const cached = operations.get(key);
          if (cached) {
            if (cached.digest !== digest)
              return Promise.resolve().then(() =>
                denied(context, "identity_conflict"),
              );
            // Pending duplicates share the first promise, even at queue capacity.
            return cached.promise.then((result) => deliver(result, context));
          }
          if (operations.size >= NATIVE_SKILL_LIMITS.operations)
            return Promise.resolve().then(() =>
              denied(context, "retained_limit"),
            );
        }
        if (queued >= NATIVE_SKILL_LIMITS.operations)
          return Promise.resolve().then(() =>
            denied(context, "retained_limit"),
          );
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
            throw new Error("Native Skill cleanup failed.");
        });
      }
      return closing;
    }

    try {
      registrations.push(
        await ctx.skill.transform((editor) => {
          if (!active) return;
          try {
            if (!current() || transformFailed) throw new Error();
            const base = editor.list();
            if (
              !Array.isArray(base) ||
              base.length + desired.length > NATIVE_SKILL_LIMITS.native ||
              desired.some((row) =>
                base.some((record) => record.id === row.record.id),
              )
            )
              throw new Error();
            // Check all collisions before adding any record. This hook is synchronous.
            for (const row of desired) editor.add({ ...row.record });
          } catch {
            // Native State.group may swallow this exception and retry without us.
            // Exact public bytes alone must never turn that failed group into ownership.
            transformFailed = true;
            uncertain = true;
            throw new Error("Native Skill transform failed.");
          }
        }),
      );
      registrations.push(
        await ctx.rpc.register(NATIVE_SKILLS_RPC, {
          observe: handler("observe"),
          registerDisabled: handler("registerDisabled"),
          removeOwned: handler("removeOwned"),
        }),
      );
      registrations.push(await setupNativeAgents(ctx));
      registrations.push(await setupNativeExtensions(ctx));
    } catch {
      await close();
      throw new Error("Native Skill setup failed.");
    }
    return close;
  },
});
