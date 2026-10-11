// Browser-safe inert agent file grammar. Never evaluates code or loads config.
export const AGENT_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  scan: 64,
});
export const validAgentSourceName = (v) =>
  typeof v === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(v) &&
  !["__proto__", "prototype", "constructor"].includes(v);
export const agentDraftKey = (workspaceId, path, sourceName) =>
  JSON.stringify([workspaceId, path, sourceName]);
const controls = (v, multiline = false) =>
  [...v].some((c) => {
    const code = c.charCodeAt(0);
    return (
      (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
      (code >= 127 && code <= 159)
    );
  });
export const agentFileContentFits = (v) =>
  typeof v === "string" &&
  v.length <= AGENT_LIMITS.bytes &&
  v.isWellFormed() &&
  !controls(v, true) &&
  new globalThis.TextEncoder().encode(v).length <= AGENT_LIMITS.bytes;
export const agentIssueMessages = Object.freeze({
  empty: "Markdown 본문을 입력하세요.",
  too_large: "파일은 UTF-8 기준 32KiB 이하여야 합니다.",
  control_bytes: "사용할 수 없는 문자 또는 잘못된 Unicode가 있습니다.",
  unsupported_frontmatter:
    "앞머리는 description, mode: primary, color의 JSON만 지원합니다. model·권한·실행 설정과 다른 YAML 형식은 지원하지 않습니다.",
});
const issue = (status, code) => ({ status, issues: code ? [code] : [] });
function parse(text) {
  let body = text.replace(/^\uFEFF/u, ""),
    metadata = {};
  if (body.startsWith("---")) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(
      body,
    );
    if (!match) return undefined;
    try {
      metadata = JSON.parse(match[1]);
      if (
        !metadata ||
        Object.getPrototypeOf(metadata) !== Object.prototype ||
        Reflect.ownKeys(metadata).some(
          (k) => !["description", "mode", "color"].includes(k),
        )
      )
        return undefined;
      // Accepted metadata is flat scalar JSON. Detect duplicate decoded keys,
      // including escaped names, before JSON.parse can silently replace them.
      const keys = [...match[1].matchAll(/("(?:[^"\\]|\\[\s\S])*")\s*:/gu)].map(
        (m) => JSON.parse(m[1]),
      );
      if (new Set(keys).size !== keys.length) return undefined;
    } catch {
      return undefined;
    }
    body = match[2];
  }
  if (
    Object.hasOwn(metadata, "description") &&
    (typeof metadata.description !== "string" ||
      !metadata.description.isWellFormed() ||
      !metadata.description.trim() ||
      metadata.description.length > 1024 ||
      controls(metadata.description))
  )
    return undefined;
  if (Object.hasOwn(metadata, "mode") && metadata.mode !== "primary")
    return undefined;
  if (
    Object.hasOwn(metadata, "color") &&
    (typeof metadata.color !== "string" ||
      !/^#[a-f0-9]{6}$/iu.test(metadata.color))
  )
    return undefined;
  return { system: body.trim(), ...metadata, mode: "primary" };
}
export function validateAgentFile(text) {
  if (
    typeof text !== "string" ||
    text.length > AGENT_LIMITS.bytes ||
    new globalThis.TextEncoder().encode(text).length > AGENT_LIMITS.bytes
  )
    return issue("invalid", "too_large");
  if (!agentFileContentFits(text)) return issue("invalid", "control_bytes");
  const parsed = parse(text);
  if (!parsed) return issue("unsupported", "unsupported_frontmatter");
  return parsed.system ? issue("valid") : issue("invalid", "empty");
}
export function parseAgentFile(text) {
  return validateAgentFile(text).status === "valid" ? parse(text) : undefined;
}
export const agentFileWriteFits = (text) =>
  validateAgentFile(text).status === "valid";
