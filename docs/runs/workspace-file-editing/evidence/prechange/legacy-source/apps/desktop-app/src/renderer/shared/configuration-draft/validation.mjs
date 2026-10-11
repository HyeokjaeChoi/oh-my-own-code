const CONFIGURATION_DRAFT_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  diffRows: 80,
});
const emptyConfigurationDraft = Object.freeze({
  text: "",
  baseline: "",
  revision: 0,
  validation: null,
});
const configurationIssueMessages = {
  empty: "\uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694.",
  too_large:
    "\uCD08\uC548\uC740 UTF-8 \uAE30\uC900 32KiB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  control_bytes:
    "\uC0AC\uC6A9\uD560 \uC218 \uC5C6\uB294 \uC81C\uC5B4 \uBB38\uC790\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
  json_invalid:
    "JSON \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694. JSONC \uC8FC\uC11D\uC740 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  too_deep:
    "JSON \uC911\uCCA9\uC740 16\uB2E8\uACC4 \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  unsupported_shape:
    "\uC774 \uD3B8\uC9D1\uAE30\uB294 MCP servers \uD615\uC2DD\uB9CC \uAC80\uC0AC\uD569\uB2C8\uB2E4. \uB2E4\uB978 \uC124\uC815\uACFC \uC778\uC99D \uD544\uB4DC\uB294 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  invalid_server:
    "\uC11C\uBC84 \uC774\uB984\uACFC \uAC1C\uC218\uB97C \uD655\uC778\uD558\uC138\uC694. \uCD5C\uB300 16\uAC1C\uC785\uB2C8\uB2E4.",
  invalid_command:
    "\uBA85\uB839\uC740 \uBE44\uC5B4 \uC788\uC9C0 \uC54A\uC740 \uBB38\uC790\uC5F4 \uBC30\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.",
  invalid_url:
    "HTTP \uB610\uB294 HTTPS \uC8FC\uC18C\uB97C \uC0AC\uC6A9\uD558\uC138\uC694. \uC8FC\uC18C\uC758 \uC778\uC99D \uC815\uBCF4\xB7\uCFFC\uB9AC\xB7fragment\uB294 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  invalid_option:
    "\uC635\uC158\uC758 \uD615\uC2DD\uC774\uB098 \uC9C0\uC6D0 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694.",
};
const configurationDraftKey = (workspaceId, path, kind) =>
  JSON.stringify([workspaceId, path, kind]);
const configurationDraftFits = (text) =>
  typeof text === "string" &&
  text.length <= CONFIGURATION_DRAFT_LIMITS.bytes &&
  new globalThis.TextEncoder().encode(text).length <=
    CONFIGURATION_DRAFT_LIMITS.bytes;
const controls = (text, multiline = false) =>
  [...text].some((char) => {
    const code = char.charCodeAt(0);
    return (
      (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
      (code >= 127 && code <= 159)
    );
  });
const object = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
const closed = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));
const basicString = (value, max) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !controls(value);
const result = (status, ...issues) => ({ status, issues });
function depthExceeded(text) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      if (++depth > 16) return true;
    } else if (char === "]" || char === "}") depth--;
  }
  return false;
}
function validateConfigurationDraft(kind, text) {
  if (!configurationDraftFits(text)) return result("invalid", "too_large");
  if (!text.trim()) return result("invalid", "empty");
  if (controls(text, true)) return result("invalid", "control_bytes");
  if (kind === "instructions") return result("valid");
  if (kind !== "mcp") return result("unsupported", "unsupported_shape");
  if (depthExceeded(text)) return result("invalid", "too_deep");
  let parsed;
  try {
    parsed = JSON.parse(text);
    if (duplicateMembers(text))
      return result("unsupported", "unsupported_shape");
  } catch {
    return result("invalid", "json_invalid");
  }
  if (
    !object(parsed) ||
    !closed(parsed, ["mcp"]) ||
    !object(parsed.mcp) ||
    !closed(parsed.mcp, ["servers"]) ||
    !object(parsed.mcp.servers)
  )
    return result("unsupported", "unsupported_shape");
  const servers = Object.entries(parsed.mcp.servers);
  if (!servers.length || servers.length > 16)
    return result("invalid", "invalid_server");
  for (const [name, config] of servers) {
    if (
      !/^[A-Za-z0-9_.-]{1,80}$/.test(name) ||
      ["__proto__", "prototype", "constructor"].includes(name) ||
      !object(config)
    )
      return result("invalid", "invalid_server");
    const common = ["type", "disabled", "codemode", "protocol"];
    if (config.type === "local") {
      if (!closed(config, [...common, "command", "cwd"]))
        return result("unsupported", "unsupported_shape");
      if (
        !Array.isArray(config.command) ||
        !config.command.length ||
        config.command.length > 32 ||
        !config.command.every((part) => basicString(part, 1024))
      )
        return result("invalid", "invalid_command");
      if (config.cwd !== void 0 && !basicString(config.cwd, 1024))
        return result("invalid", "invalid_option");
    } else if (config.type === "remote") {
      if (!closed(config, [...common, "url", "oauth"]))
        return result("unsupported", "unsupported_shape");
      if (!basicString(config.url, 2048))
        return result("invalid", "invalid_url");
      try {
        const url = new URL(config.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          return result("invalid", "invalid_url");
      } catch {
        return result("invalid", "invalid_url");
      }
      if (config.oauth !== void 0 && config.oauth !== false)
        return result("unsupported", "unsupported_shape");
    } else return result("unsupported", "unsupported_shape");
    for (const key of ["disabled", "codemode"])
      if (config[key] !== void 0 && typeof config[key] !== "boolean")
        return result("invalid", "invalid_option");
    if (
      config.protocol !== void 0 &&
      (typeof config.protocol !== "string" ||
        !["legacy", "auto", "2026-07-28"].includes(config.protocol))
    )
      return result("invalid", "invalid_option");
  }
  return result("valid");
}
function configurationFileContentFits(kind, text) {
  if (!configurationDraftFits(text) || controls(text, true)) return false;
  return (
    kind === "instructions" ||
    (kind === "mcp" &&
      validateConfigurationDraft(kind, text).status === "valid")
  );
}
// TextEncoder replaces lone UTF16 surrogates. Refuse that lossy write.
function configurationFileWriteFits(kind, text) {
  return (
    configurationFileContentFits(kind, text) &&
    ![...text].some((char) => {
      const code = char.charCodeAt(0);
      return char.length === 1 && code >= 0xd800 && code <= 0xdfff;
    })
  );
}
function configurationTargetPath(root, kind) {
  // Canonical POSIX roots can contain literal backslashes in a filename.
  const separator = root.startsWith("/") || !root.includes("\\") ? "/" : "\\";
  const base = root.endsWith(separator) ? root.slice(0, -1) : root;
  return `${base}${separator}${kind === "instructions" ? "AGENTS.md" : "opencode.json"}`;
}
export {
  configurationTargetPath,
  configurationFileContentFits,
  configurationFileWriteFits,
  CONFIGURATION_DRAFT_LIMITS,
  configurationDraftFits,
  configurationDraftKey,
  configurationIssueMessages,
  emptyConfigurationDraft,
  validateConfigurationDraft,
};

function duplicateMembers(text) {
  const tokens = [...text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]/g)].map(
    (match) => match[0],
  );
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const keys = stack.at(-1);
      const key = JSON.parse(token);
      if (!keys || keys.has(key)) return true;
      keys.add(key);
    }
  }
  return false;
}
