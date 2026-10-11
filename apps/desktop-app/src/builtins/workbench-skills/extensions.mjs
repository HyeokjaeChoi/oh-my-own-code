// Fixed observe-only producer. No loader, transforms, reloads or hook callbacks.
import { timingSafeEqual } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  NATIVE_EXTENSIONS_RPC_DEFINITION,
  validateExtensionRpc,
  validateExtensionRpcResult,
} from "../../native-extensions-protocol.mjs";
import {
  projectNativePlugins,
  projectNativeTools,
} from "../../renderer/shared/configuration-draft/extensions.mjs";

const data = (value) =>
  Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
      ),
  );
const closed = (value, keys) =>
  data(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const unavailable = (reason) => ({ status: "unavailable", reason });
// Native preserves a Schema.Class Location.Info. Read only its known own data
// fields, never a prototype method, getter or serialization hook.
function ownValue(value, key) {
  const slot = Object.getOwnPropertyDescriptor(value, key);
  if (!slot || !Object.hasOwn(slot, "value"))
    throw new Error("invalid_context");
  return slot.value;
}
function nativeFields(value, keys, required) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  )
    throw new Error("invalid_context");
  return Object.fromEntries(
    Reflect.ownKeys(value).map((key) => [key, ownValue(value, key)]),
  );
}
const safeScalar = (value, limit) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value.isWellFormed() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  Buffer.byteLength(value, "utf8") <= limit;
function canonicalPath(value) {
  if (
    !safeScalar(value, 32768) ||
    !isAbsolute(value) ||
    resolve(value) !== value
  )
    throw new Error("invalid_context");
  return value;
}
function location(value) {
  const fields = nativeFields(
    value,
    ["directory", "workspaceID", "project"],
    ["directory"],
  );
  const { workspaceID } = fields;
  if (
    workspaceID !== undefined &&
    (typeof workspaceID !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,256}$/u.test(workspaceID))
  )
    throw new Error("invalid_context");
  let project;
  if (fields.project !== undefined) {
    // Project is a Native Schema.Struct; keep only detached bounded identity.
    if (!closed(fields.project, ["id", "directory", "canonical"]))
      throw new Error("invalid_context");
    const id = ownValue(fields.project, "id");
    if (!safeScalar(id, 512)) throw new Error("invalid_context");
    project = Object.freeze({
      id,
      directory: canonicalPath(ownValue(fields.project, "directory")),
      canonical: canonicalPath(ownValue(fields.project, "canonical")),
    });
  }
  return Object.freeze({
    directory: canonicalPath(fields.directory),
    workspaceID,
    project,
  });
}
function sameLocation(value, expected) {
  const actual = location(value);
  return (
    actual.directory === expected.directory &&
    actual.workspaceID === expected.workspaceID &&
    actual.project?.id === expected.project?.id &&
    actual.project?.directory === expected.project?.directory &&
    actual.project?.canonical === expected.project?.canonical
  );
}
function denied(context, code) {
  const message = "Native extension request denied.";
  if (typeof context?.error === "function")
    return context.error("denied", message, { code });
  throw Object.assign(new Error(message), { type: "denied", data: { code } });
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function setupNativeExtensions(ctx) {
  let canonical, nonce;
  try {
    const options = ownValue(ctx, "options");
    if (!closed(options, ["nonce"])) throw new Error();
    nonce = options.nonce;
    canonical = location(ownValue(ctx, "location"));
    validateExtensionRpc("observe", {
      nonce,
      workspaceId: "context",
      workspacePath: canonical.directory,
    });
    if (resolve(canonical.directory) !== canonical.directory) throw new Error();
  } catch {
    throw new Error("invalid_context");
  }
  const authority = Buffer.from(nonce, "hex");
  let active = true,
    registration,
    closing;
  function current(context) {
    try {
      return (
        active &&
        !context?.signal?.aborted &&
        sameLocation(ownValue(ctx, "location"), canonical) &&
        closed(ownValue(ctx, "options"), ["nonce"]) &&
        ownValue(ownValue(ctx, "options"), "nonce") === nonce
      );
    } catch {
      return false;
    }
  }
  async function plugins(context) {
    if (!current(context)) return unavailable("runtime_unavailable");
    let response;
    try {
      if (typeof ctx.plugin?.list !== "function")
        return unavailable("runtime_unavailable");
      response = await ctx.plugin.list();
    } catch {
      return unavailable("runtime_unavailable");
    }
    if (!current(context)) return unavailable("runtime_unavailable");
    try {
      if (
        !closed(response, ["location", "data"]) ||
        // The adapted public endpoint encodes Location.PublicRef, not Info.
        !closed(response.location, ["directory"]) ||
        response.location.directory !== canonical.directory
      )
        return unavailable("invalid_response");
      return projectNativePlugins(response.data);
    } catch {
      return unavailable("invalid_response");
    }
  }
  async function tools(context) {
    if (!current(context)) return unavailable("runtime_unavailable");
    let response;
    try {
      if (typeof ctx.tool?.list !== "function")
        return unavailable("runtime_unavailable");
      response = await ctx.tool.list();
    } catch {
      return unavailable("runtime_unavailable");
    }
    if (!current(context)) return unavailable("runtime_unavailable");
    return projectNativeTools(response);
  }
  async function observe(input, context) {
    let prepared;
    try {
      validateExtensionRpc("observe", input);
      if (!current(context) || input.workspacePath !== canonical.directory)
        return denied(context, "invalid_context");
      if (!timingSafeEqual(authority, Buffer.from(input.nonce, "hex")))
        return denied(context, "nonce_mismatch");
      prepared = Object.freeze({
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
      });
    } catch {
      return denied(context, "invalid_context");
    }
    const [pluginGroup, toolGroup] = await Promise.all([
      plugins(context),
      tools(context),
    ]);
    if (!current(context)) return denied(context, "invalid_context");
    const count =
      Number(pluginGroup.status === "available") +
      Number(toolGroup.status === "available");
    return freeze(
      validateExtensionRpcResult("observe", {
        ...prepared,
        status: ["unavailable", "partial", "available"][count],
        plugins: pluginGroup,
        tools: toolGroup,
        hooks: { status: "not_reported", reason: "inventory_not_supported" },
      }),
    );
  }
  function dispose() {
    if (!closing) {
      active = false;
      closing = Promise.resolve()
        .then(() => registration?.dispose())
        .catch(() => {
          throw new Error("Native extension cleanup failed.");
        });
    }
    return closing;
  }
  try {
    registration = await ctx.rpc.register(NATIVE_EXTENSIONS_RPC_DEFINITION, {
      observe,
    });
  } catch {
    await dispose();
    throw new Error("Native extension setup failed.");
  }
  return Object.freeze({ dispose });
}
