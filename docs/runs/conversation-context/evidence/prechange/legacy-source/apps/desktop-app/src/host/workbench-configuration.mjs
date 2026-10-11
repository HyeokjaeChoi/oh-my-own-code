import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

// Metadata only. Do not read/evaluate these files or invoke Native config.get.
const markers = Object.freeze([
  ["AGENTS.md", "instructions", "file"],
  ["CLAUDE.md", "instructions", "file"],
  ["opencode.json", "configuration", "file"],
  ["opencode.jsonc", "configuration", "file"],
  [".opencode", "configuration", "directory"],
  [".agents", "configuration", "directory"],
  [".claude", "configuration", "directory"],
  [".codex/config.toml", "configuration", "file"],
]);
export function metadataPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    isAbsolute(value) &&
    ![...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
}
export function metadataScope(root, path) {
  if (!metadataPath(path)) return "runtime";
  const within = relative(root, path);
  return within !== ".." &&
    !within.startsWith(`..${sep}`) &&
    !isAbsolute(within)
    ? "workspace"
    : "external";
}
export function skillProvenance(root, item) {
  // Copy no content, options, environment or arbitrary runtime properties.
  const path = Object.getOwnPropertyDescriptor(item, "path");
  const value = path && Object.hasOwn(path, "value") ? path.value : undefined;
  return {
    source: "runtime",
    scope: metadataScope(root, value),
    ...(metadataPath(value) ? { path: value } : {}),
  };
}
const empty = () => ({
  status: "unavailable",
  runtimeStatus: "not_reported",
  reason: "path_denied",
  entries: [],
});
const identityMatches = (a, b) => a.dev === b.dev && a.ino === b.ino;

export async function discoverConfiguration(root, check = () => {}) {
  check();
  if (!metadataPath(root)) return empty();
  const stat = async (path) => {
    check();
    const value = await lstat(path);
    check();
    return value;
  };
  const canonical = async () => {
    check();
    const value = await realpath(root);
    check();
    return value;
  };
  const entries = [];
  try {
    const before = await stat(root);
    if (!before.isDirectory() || before.isSymbolicLink()) return empty();
    if ((await canonical()) !== root) return empty();
    for (const [name, kind, type] of markers) {
      const path = join(root, name);
      let denied = !metadataPath(path);
      let missing = false;
      try {
        let current = root;
        const parts = name.split("/");
        for (let index = 0; index < parts.length && !denied; index++) {
          current = join(current, parts[index]);
          const item = await stat(current);
          denied =
            item.isSymbolicLink() ||
            (index < parts.length - 1
              ? !item.isDirectory()
              : type === "file"
                ? !item.isFile()
                : !item.isDirectory());
        }
      } catch (error) {
        check();
        if (error.appCode) throw error;
        if (error.code === "ENOENT") missing = true;
        else denied = true;
      }
      if (missing) continue;
      entries.push({
        id: createHash("sha256")
          .update(JSON.stringify([root, name]))
          .digest("hex"),
        kind,
        source: "workspace",
        ...(metadataPath(path) ? { path } : {}),
        scope: "workspace",
        state: denied ? "unavailable" : "discovered",
        ...(denied
          ? { reason: "path_denied" }
          : name === ".codex/config.toml"
            ? { reason: "not_reported" }
            : {}),
      });
    }
    if (
      !identityMatches(before, await stat(root)) ||
      (await canonical()) !== root
    )
      return empty();
    return {
      status: entries.some((entry) => entry.state === "unavailable")
        ? "partial"
        : "available",
      runtimeStatus: "not_reported",
      entries,
    };
  } catch (error) {
    check();
    if (error.appCode) throw error;
    return empty();
  }
}
