// Browser-safe inert file validation. This module never loads or activates Skills.
export const SKILL_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  scan: 64,
});
export const validSkillSourceName = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export const skillDraftKey = (workspaceId, path, sourceName) =>
  JSON.stringify([workspaceId, path, sourceName]);
const controls = (text, multiline = false) =>
  [...text].some((char) => {
    const code = char.charCodeAt(0);
    return (
      (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
      (code >= 127 && code <= 159)
    );
  });
export const skillFileContentFits = (text) =>
  typeof text === "string" &&
  text.length <= SKILL_LIMITS.bytes &&
  text.isWellFormed() &&
  !controls(text, true) &&
  new globalThis.TextEncoder().encode(text).length <= SKILL_LIMITS.bytes;
export const skillIssueMessages = Object.freeze({
  empty: "Markdown 본문을 입력하세요.",
  too_large: "파일은 UTF-8 기준 32KiB 이하여야 합니다.",
  control_bytes: "사용할 수 없는 문자 또는 잘못된 Unicode가 있습니다.",
  unsupported_frontmatter:
    "지원하는 앞머리는 name과 description의 JSON 문자열, metadata 아래의 opencode/autoinvoke: true 또는 false입니다. 다른 YAML 문법은 지원하지 않습니다.",
});
const result = (status, ...issues) => ({ status, issues });
export function validateSkillFile(text) {
  if (
    typeof text !== "string" ||
    text.length > SKILL_LIMITS.bytes ||
    new globalThis.TextEncoder().encode(text).length > SKILL_LIMITS.bytes
  )
    return result("invalid", "too_large");
  if (!skillFileContentFits(text)) return result("invalid", "control_bytes");
  let body = text.replace(/^\uFEFF/u, "");
  if (body.startsWith("---")) {
    const lines = body.split(/\r?\n/u);
    const end = lines.indexOf("---", 1);
    if (lines[0] !== "---" || end < 1)
      return result("unsupported", "unsupported_frontmatter");
    const seen = new Set();
    let metadata = false,
      auto = false;
    for (const line of lines.slice(1, end)) {
      if (line === "") continue;
      if (line === "metadata:" && !seen.has("metadata")) {
        seen.add("metadata");
        metadata = true;
        continue;
      }
      if (
        metadata &&
        !auto &&
        /^ {2}opencode\/autoinvoke: (true|false)$/u.test(line)
      ) {
        auto = true;
        metadata = false;
        continue;
      }
      if (metadata) return result("unsupported", "unsupported_frontmatter");
      const match = /^(name|description): (".*")$/u.exec(line);
      if (!match || seen.has(match[1]))
        return result("unsupported", "unsupported_frontmatter");
      let value;
      try {
        value = JSON.parse(match[2]);
      } catch {
        return result("unsupported", "unsupported_frontmatter");
      }
      if (
        typeof value !== "string" ||
        !value.trim() ||
        !value.isWellFormed() ||
        controls(value) ||
        value.length > (match[1] === "name" ? 256 : 1024)
      )
        return result("unsupported", "unsupported_frontmatter");
      seen.add(match[1]);
    }
    if (metadata) return result("unsupported", "unsupported_frontmatter");
    body = lines.slice(end + 1).join("\n");
  }
  return body.trim() ? result("valid") : result("invalid", "empty");
}
export const skillFileWriteFits = (text) =>
  validateSkillFile(text).status === "valid";
