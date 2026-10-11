// Browser-safe scalar projection. No IO, callbacks, schemas or executable data.
export const EXTENSIONS_LIMITS = Object.freeze({ plugins: 128, tools: 128 });
const invalid = () => {
  throw new Error("extensions_invalid");
};
const limitError = Object.freeze(new Error("extensions_limit"));
const safe = (value, bytes) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= bytes &&
  value.isWellFormed() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  new globalThis.TextEncoder().encode(value).length <= bytes;
const id = (value) =>
  safe(value, 512) &&
  /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:[:/][A-Za-z0-9_.-]+)*$/u.test(
    value,
  );
const workspaceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value);
const wireId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);
const data = (value) =>
  Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value") &&
          !["__proto__", "prototype", "constructor"].includes(key),
      ),
  );
const closed = (value, required, optional = []) =>
  data(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Reflect.ownKeys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );

// Portable lexical metadata check. This does not resolve or authorize a path.
function path(value) {
  if (!safe(value, 32768) || /[<>"|?*]/u.test(value)) return false;
  let parts;
  if (/^[A-Za-z]:\\/u.test(value)) {
    if (value.includes("/") || value.slice(2).includes(":")) return false;
    parts = value.slice(3).split("\\");
  } else if (value.startsWith("\\\\")) {
    if (value.includes("/") || value.includes(":")) return false;
    parts = value.slice(2).split("\\");
    if (parts.length < 3) return false;
  } else if (value.startsWith("/")) {
    if (value.includes("\\") || value.includes(":")) return false;
    parts = value.slice(1).split("/");
  } else return false;
  return parts.every((part) => part.length > 0 && ![".", ".."].includes(part));
}
function target(value) {
  if (!safe(value, 512)) return false;
  // Exact npm name with an optional exact version or dist tag. No URLs/ranges.
  const name = value.match(
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*/u,
  )?.[0];
  return (
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@(?:[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[a-z][a-z0-9-]*))?$/u.test(
      value,
    ) && name.length <= 214
  );
}
function dense(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    invalid();
  if (value.length > limit) throw limitError;
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let i = 0; i < value.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(i));
    if (!slot || !Object.hasOwn(slot, "value")) invalid();
  }
}
function validSource(value) {
  if (!data(value)) return false;
  if (["builtin", "sdk"].includes(value.type)) return closed(value, ["type"]);
  if (value.type === "local")
    return (
      (closed(value, ["type", "path"]) && path(value.path)) ||
      (closed(value, ["type", "reason"]) &&
        value.reason === "unsupported_source")
    );
  if (value.type === "package")
    return (
      (closed(value, ["type", "target"]) && target(value.target)) ||
      (closed(value, ["type", "reason"]) &&
        value.reason === "unsupported_source")
    );
  return false;
}
function validPlugin(value) {
  return (
    closed(value, ["id", "state", "source", "features"], ["reason"]) &&
    id(value.id) &&
    validSource(value.source) &&
    closed(value.features, ["server", "tui", "rpc"]) &&
    ["server", "tui", "rpc"].every(
      (key) => typeof value.features[key] === "boolean",
    ) &&
    (value.state === "active"
      ? !Object.hasOwn(value, "reason")
      : value.state === "failed" && value.reason === "native_failed")
  );
}
const validTool = (value) =>
  closed(value, ["id", "name"]) &&
  id(value.id) &&
  safe(value.name, 512) &&
  value.name.trim() === value.name &&
  !value.name.includes("://");
function source(raw) {
  if (
    !data(raw) ||
    !Object.hasOwn(raw, "type") ||
    !["builtin", "package", "local", "sdk"].includes(raw.type)
  )
    invalid();
  if (["builtin", "sdk"].includes(raw.type)) return { type: raw.type };
  if (raw.type === "local")
    return Object.hasOwn(raw, "path") && path(raw.path)
      ? { type: "local", path: raw.path }
      : { type: "local", reason: "unsupported_source" };
  return Object.hasOwn(raw, "target") && target(raw.target)
    ? { type: "package", target: raw.target }
    : { type: "package", reason: "unsupported_source" };
}
function plugin(raw) {
  if (
    !data(raw) ||
    !["id", "state", "source", "features"].every((key) =>
      Object.hasOwn(raw, key),
    ) ||
    !id(raw.id) ||
    !closed(raw.features, [], ["server", "tui", "rpc"]) ||
    !data(raw.state) ||
    !(raw.state.status === "active"
      ? closed(raw.state, ["status"])
      : raw.state.status === "failed" &&
        closed(raw.state, ["status", "error"], ["ref"]) &&
        typeof raw.state.error === "string" &&
        (!Object.hasOwn(raw.state, "ref") || typeof raw.state.ref === "string"))
  )
    invalid();
  const features = {};
  for (const key of ["server", "tui", "rpc"]) {
    if (
      Object.hasOwn(raw.features, key) &&
      typeof raw.features[key] !== "boolean"
    )
      invalid();
    features[key] = Object.hasOwn(raw.features, key)
      ? raw.features[key]
      : false;
  }
  return {
    id: raw.id,
    state: raw.state.status,
    source: source(raw.source),
    features,
    ...(raw.state.status === "failed" ? { reason: "native_failed" } : {}),
  };
}
function tool(raw) {
  if (!data(raw) || !["id", "name"].every((key) => Object.hasOwn(raw, key)))
    invalid();
  const result = { id: raw.id, name: raw.name };
  if (!validTool(result)) invalid();
  return result;
}
function project(raw, limit, convert) {
  try {
    dense(raw, limit);
    const rows = [],
      ids = new Set();
    for (let i = 0; i < raw.length; i++) {
      const row = convert(
        Object.getOwnPropertyDescriptor(raw, String(i)).value,
      );
      if (ids.has(row.id)) invalid();
      ids.add(row.id);
      rows.push(row);
    }
    return { status: "available", rows };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error === limitError ? "limit_reached" : "invalid_response",
    };
  }
}
export function projectNativePlugins(rawArray) {
  return project(rawArray, EXTENSIONS_LIMITS.plugins, plugin);
}
export function projectNativeTools(rawArray) {
  return project(rawArray, EXTENSIONS_LIMITS.tools, tool);
}
function group(value, limit, validate) {
  if (!data(value)) invalid();
  if (value.status === "unavailable") {
    if (
      !closed(value, ["status", "reason"]) ||
      !["runtime_unavailable", "invalid_response", "limit_reached"].includes(
        value.reason,
      )
    )
      invalid();
    return;
  }
  if (!closed(value, ["status", "rows"]) || value.status !== "available")
    invalid();
  dense(value.rows, limit);
  const ids = new Set();
  for (const row of value.rows) {
    if (!validate(row) || ids.has(row.id)) invalid();
    ids.add(row.id);
  }
}
function inventory(value, full) {
  if (
    !closed(value, [
      "workspaceId",
      "workspacePath",
      "status",
      "plugins",
      "tools",
      "hooks",
      ...(full ? ["runtimeEpoch", "revision"] : []),
    ]) ||
    !workspaceId(value.workspaceId) ||
    !path(value.workspacePath)
  )
    invalid();
  if (
    full &&
    (!wireId(value.runtimeEpoch) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0)
  )
    invalid();
  group(value.plugins, EXTENSIONS_LIMITS.plugins, validPlugin);
  group(value.tools, EXTENSIONS_LIMITS.tools, validTool);
  const count =
    Number(value.plugins.status === "available") +
    Number(value.tools.status === "available");
  if (
    value.status !== ["unavailable", "partial", "available"][count] ||
    !closed(value.hooks, ["status", "reason"]) ||
    value.hooks.status !== "not_reported" ||
    value.hooks.reason !== "inventory_not_supported"
  )
    invalid();
  return value;
}
export function validateExtensionsInventory(core) {
  return inventory(core, false);
}
export function validateExtensionsObservation(full) {
  return inventory(full, true);
}
