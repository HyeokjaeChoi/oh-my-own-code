export const ERRORS = Object.freeze({
  READ_BUSY: "The read capacity is occupied.",
  READ_TIMEOUT: "The whole-read deadline expired.",
  STALE_EPOCH: "The runtime epoch is no longer current.",
  STALE_REVISION: "The expected revision is no longer current.",
  ARCHIVED_SESSION: "Restore this archived session before executing.",
  EMPTY_SESSION: "Add conversation history before forking this session.",
  HAS_DESCENDANTS: "Remove descendant conversations first.",
  DESCENDANTS_UNVERIFIED: "The descendant list could not be verified.",
  INVALID_REQUEST: "Invalid workbench request.",
  NOT_FOUND: "The workspace or session is not registered.",
  BUSY: "The session is busy or its outcome is unconfirmed.",
  CANCELLED: "The operation was cancelled.",
  UNAVAILABLE: "The runtime is unavailable.",
  AUTH_REQUIRED: "No verified model credentials are available.",
  POLICY_UNVERIFIED: "The required permission policy could not be verified.",
  INVALID_SELECTION: "The selected runtime option is unavailable.",
  STALE_PERMISSION: "This permission request is no longer pending.",
  DUPLICATE_CONFLICT:
    "This request ID was already used with different content.",
  LIMIT_REACHED: "The temporary workbench limit was reached.",
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME:
    "The operation outcome is unknown. It will not be resent automatically.",
});
export function failure(code) {
  return { ok: false, code, message: ERRORS[code] ?? ERRORS.RUNTIME_ERROR };
}
export function fail(code) {
  const error = new Error(ERRORS[code]);
  error.appCode = code;
  throw error;
}
const schemas = {
  "operation.lookup": [["runtimeEpoch", "operationId"], []],
  snapshot: [[], ["workspaceId", "sessionId"]],
  "diagnostics.list": [[], ["workspaceId", "sessionId"]],
  "session.rename": [["workspaceId", "sessionId", "requestId", "title"], []],
  "session.pin": [["workspaceId", "sessionId", "requestId", "pinned"], []],
  "session.archive": [
    ["workspaceId", "sessionId", "requestId", "archived"],
    [],
  ],
  "session.fork": [["workspaceId", "sessionId", "requestId"], ["title"]],
  "session.remove": [["workspaceId", "sessionId", "requestId"], []],
  "workspace.import": [[], []],
  "workspace.create": [[], ["name"]],
  "workspace.remove": [["workspaceId"], []],
  "session.create": [["workspaceId"], ["title"]],
  "message.send": [
    ["workspaceId", "sessionId", "requestId", "text"],
    ["agent", "model"],
  ],
  "session.interrupt": [["workspaceId", "sessionId"], []],
  "permission.respond": [
    ["workspaceId", "sessionId", "requestId", "decision"],
    [],
  ],
  "catalog.list": [["workspaceId"], ["sessionId"]],
  "command.run": [
    ["workspaceId", "sessionId", "requestId", "name", "arguments"],
    [],
  ],
  "file.list": [["workspaceId"], ["path"]],
  "file.read": [["workspaceId", "path"], []],
};
export function validateRequest(value) {
  assertPlain(value);
  const schema = Object.hasOwn(schemas, value.type) && schemas[value.type];
  if (!schema) fail("INVALID_REQUEST");
  const [required, optional] = schema;
  const allowed = new Set(["type", ...required, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    fail("INVALID_REQUEST");
  for (const [key, entry] of Object.entries(value)) {
    if (["pinned", "archived"].includes(key)) {
      if (typeof entry !== "boolean") fail("INVALID_REQUEST");
      continue;
    }
    if (["runtimeEpoch", "operationId"].includes(key) && !validWireId(entry))
      fail("INVALID_REQUEST");
    if (key === "requestId" && typeof entry === "string" && entry.length > 128)
      fail("INVALID_REQUEST");
    const max = ["text", "arguments"].includes(key)
      ? 32000
      : key === "path"
        ? 2048
        : 256;
    if (typeof entry !== "string" || entry.length > max || entry.includes("\0"))
      fail("INVALID_REQUEST");
    if (
      (key.endsWith("Id") || ["agent", "model"].includes(key)) &&
      !/^[\w.:-]{1,256}$/.test(entry)
    )
      fail("INVALID_REQUEST");
  }
  if (value.sessionId && !value.workspaceId) fail("INVALID_REQUEST");
  if (value.type === "message.send" && !value.text.trim())
    fail("INVALID_REQUEST");
  if (
    value.type === "permission.respond" &&
    !["once", "reject"].includes(value.decision)
  )
    fail("INVALID_REQUEST");
  if (
    ["session.rename", "session.fork"].includes(value.type) &&
    Object.hasOwn(value, "title")
  ) {
    if (
      !value.title.trim() ||
      value.title.trim().length > 120 ||
      [...value.title].some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
      )
    )
      fail("INVALID_REQUEST");
    return { ...value, title: value.title.trim() };
  }
  return { ...value };
}
export const BASELINE_POLICY = Object.freeze([
  Object.freeze({ action: "*", resource: "*", effect: "ask" }),
  Object.freeze({
    action: "external_directory",
    resource: "*",
    effect: "deny",
  }),
  Object.freeze({ action: "subagent", resource: "*", effect: "deny" }),
]);
export function policyMatches(rules) {
  return (
    Array.isArray(rules) &&
    rules.length === BASELINE_POLICY.length &&
    rules.every(
      (rule, index) =>
        rule &&
        Object.keys(rule).length === 3 &&
        ["action", "resource", "effect"].every(
          (key) => rule[key] === BASELINE_POLICY[index][key],
        ),
    )
  );
}
export function portableName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 100 &&
    !/[<>:"/\\|?*]/.test(name) &&
    ![...name].some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) &&
    !/[. ]$/.test(name) &&
    name === name.trim() &&
    !/^\.{1,2}$/.test(name) &&
    !/^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(
      name,
    )
  );
}

// Frozen v2 wire schema. Sender identity comes only from main-process admission.
export const READ_TYPES = Object.freeze([
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "operation.lookup",
]);
export function validWireId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
function assertPlain(value) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  )
    fail("INVALID_REQUEST");
}
function closed(value, allowed) {
  assertPlain(value);
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("INVALID_REQUEST");
}
export function validateEnvelope(value) {
  closed(value, [
    "version",
    "runtimeEpoch",
    "readId",
    "operationId",
    "expectedRevision",
    "operation",
  ]);
  if (value.version !== 2) fail("INVALID_REQUEST");
  const operation = validateRequest(value.operation);
  const read = READ_TYPES.includes(operation.type);
  const bootstrap = operation.type === "snapshot";
  if (read) {
    if (
      !validWireId(value.readId) ||
      Object.hasOwn(value, "operationId") ||
      Object.hasOwn(value, "expectedRevision")
    )
      fail("INVALID_REQUEST");
    if (
      (!bootstrap || Object.hasOwn(value, "runtimeEpoch")) &&
      !validWireId(value.runtimeEpoch)
    )
      fail("INVALID_REQUEST");
  } else if (
    !validWireId(value.operationId) ||
    !validWireId(value.runtimeEpoch) ||
    Object.hasOwn(value, "readId")
  )
    fail("INVALID_REQUEST");
  if (
    Object.hasOwn(value, "expectedRevision") &&
    (!Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  )
    fail("INVALID_REQUEST");
  return { ...value, operation };
}
export function validateCancel(value) {
  closed(value, ["version", "runtimeEpoch", "readId"]);
  if (
    value.version !== 2 ||
    !validWireId(value.runtimeEpoch) ||
    !validWireId(value.readId)
  )
    fail("INVALID_REQUEST");
  return { ...value };
}
