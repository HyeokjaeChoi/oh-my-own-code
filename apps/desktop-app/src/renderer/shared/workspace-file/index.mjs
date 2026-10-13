// Browser-safe lexical metadata and exact text checks. No IO or write authority.
export const WORKSPACE_FILE_FEATURE = "workspace_file_save_v1";
export const WORKSPACE_FILE_LIMITS = Object.freeze({
  bytes: 65536,
  pathBytes: 2048,
  rootBytes: 4096,
  components: 32,
  componentBytes: 255,
});
const bytes = (value) => new globalThis.TextEncoder().encode(value).length;
const safe = (v, max) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  v.isWellFormed() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v) &&
  bytes(v) <= max;
const device =
  /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu;
export function validWorkspaceFilePath(value) {
  if (
    !safe(value, WORKSPACE_FILE_LIMITS.pathBytes) ||
    /[\\:<>"|?*]/u.test(value)
  )
    return false;
  const parts = value.split("/");
  return (
    parts.length <= WORKSPACE_FILE_LIMITS.components &&
    parts.every(
      (part) =>
        safe(part, WORKSPACE_FILE_LIMITS.componentBytes) &&
        ![".", ".."].includes(part) &&
        !/[. ]$/u.test(part) &&
        !device.test(part),
    )
  );
}
// NTFS upcases dotless i to I, which /iu does not; fold it so ".gıt" is ".git".
const protectedName = (original) => {
  const part = original.replaceAll("\u0131", "i");
  return protectedFolded(part);
};
const protectedFolded = (part) =>
  /^\.omoc-configuration-/iu.test(part) ||
  /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.config|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|opencode\.jsonc?|id_(rsa|ed25519|ecdsa)(?:\.pub)?|\.opencode|\.agents|\.codex|\.claude|AGENTS\.md|CLAUDE\.md)$/iu.test(
    part,
  ) ||
  /\.(pem|key|p12|pfx|keystore)$/iu.test(part) ||
  // NTFS 8.3 short alias (GIT~1, ENV~1.): may name any protected entry above.
  /^[^.]{1,6}~[0-9]{1,6}(?:\.[^.]{0,3})?$/u.test(part);
export function workspaceFilePathReason(value) {
  if (!validWorkspaceFilePath(value)) return "invalid_path";
  return value.split("/").some(protectedName) ? "protected_source" : undefined;
}
export function validWorkspaceFileRoot(value) {
  if (!safe(value, WORKSPACE_FILE_LIMITS.rootBytes) || /[<>"|?*]/u.test(value))
    return false;
  let parts;
  if (value.startsWith("/")) {
    if (/[\\:]/u.test(value)) return false;
    if (value === "/") return true;
    parts = value.slice(1).split("/");
  } else if (/^[A-Za-z]:\\/u.test(value)) {
    if (value.includes("/") || value.slice(2).includes(":")) return false;
    if (value.length === 3) return true;
    parts = value.slice(3).split("\\");
  } else if (value.startsWith("\\\\")) {
    if (value.includes("/") || value.includes(":")) return false;
    parts = value.slice(2).split("\\");
    if (parts.length < 3) return false;
  } else return false;
  return parts.every((part) => part.length > 0 && ![".", ".."].includes(part));
}
export function workspaceFileTargetPath(root, path) {
  if (!validWorkspaceFileRoot(root) || !validWorkspaceFilePath(path))
    return undefined;
  const separator = root.startsWith("/") ? "/" : "\\";
  return (
    root +
    (root.endsWith(separator) ? "" : separator) +
    path.split("/").join(separator)
  );
}
export const workspaceFileContentFits = (text) =>
  typeof text === "string" &&
  text.length <= WORKSPACE_FILE_LIMITS.bytes &&
  text.isWellFormed() &&
  ![...text].some((char) => {
    const code = char.codePointAt(0);
    return (
      (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159)
    );
  }) &&
  bytes(text) <= WORKSPACE_FILE_LIMITS.bytes;
export const workspaceFileWriteFits = workspaceFileContentFits;
export const workspaceFileIssueMessages = Object.freeze({
  too_large: "파일은 UTF-8 기준 64KiB 이하여야 합니다.",
  unsupported_content: "사용할 수 없는 문자 또는 잘못된 Unicode가 있습니다.",
});
export function validateWorkspaceFileText(text) {
  if (
    typeof text !== "string" ||
    text.length > WORKSPACE_FILE_LIMITS.bytes ||
    bytes(text) > WORKSPACE_FILE_LIMITS.bytes
  )
    return { status: "invalid", issues: ["too_large"] };
  return workspaceFileContentFits(text)
    ? { status: "valid", issues: [] }
    : { status: "invalid", issues: ["unsupported_content"] };
}
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(v);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const data = (v) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const closed = (v, required) =>
  data(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Reflect.ownKeys(v).every((k) => required.includes(k));
const invalid = () => {
  throw new Error("INVALID_REQUEST");
};
export function validateWorkspaceFileObservation(value) {
  if (!data(value)) invalid();
  const available = value.status === "available";
  const keys = [
    "runtimeEpoch",
    "revision",
    "workspaceId",
    "workspacePath",
    "path",
    "targetPath",
    "status",
    ...(available ? ["content", "version", "directoryVersion"] : ["reason"]),
  ];
  if (
    !closed(value, keys) ||
    !id(value.runtimeEpoch) ||
    !id(value.workspaceId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !validWorkspaceFilePath(value.path) ||
    workspaceFileTargetPath(value.workspacePath, value.path) !==
      value.targetPath
  )
    invalid();
  const reason = workspaceFilePathReason(value.path);
  if (available) {
    if (
      reason ||
      !workspaceFileContentFits(value.content) ||
      !hex(value.version) ||
      !hex(value.directoryVersion)
    )
      invalid();
  } else if (value.status === "unsupported") {
    if (
      reason === "protected_source"
        ? value.reason !== reason
        : !["too_large", "unsupported_content"].includes(value.reason)
    )
      invalid();
  } else if (
    value.status !== "unavailable" ||
    reason ||
    !["missing_file", "path_missing", "path_denied", "file_changed"].includes(
      value.reason,
    )
  )
    invalid();
  return value;
}
export function validateWorkspaceFileSave(value) {
  if (!data(value) || !id(value.requestId)) invalid();
  if (value.status === "saved") {
    if (
      !closed(value, ["requestId", "status", "version", "backupId"]) ||
      !hex(value.version) ||
      typeof value.backupId !== "string" ||
      !/^\.omoc-configuration-[a-f0-9]{64}\.file\.backup$/u.test(value.backupId)
    )
      invalid();
  } else if (
    value.status !== "unknown" ||
    !closed(value, ["requestId", "status"])
  )
    invalid();
  return value;
}
