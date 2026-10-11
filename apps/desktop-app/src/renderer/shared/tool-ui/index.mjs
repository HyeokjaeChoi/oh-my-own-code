// Pure tool-part view models. Anything unrecognised or malformed => generic.
// Output is only ever text; callers must render it as text, never HTML.
const ALIAS = {
  bash: "shell",
  task: "subagent",
  apply_patch: "patch",
  todoread: "todowrite",
};
export const canonicalToolName = (name) => ALIAS[name] ?? name;
const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
function parse(text) {
  try {
    return obj(JSON.parse(text));
  } catch {
    return null;
  }
}
const lines = (out) => (out ? out.split("\n").filter(Boolean) : []);

const BUILDERS = {
  read(i, output) {
    const path = str(i.filePath) ?? str(i.path);
    if (!path) return null;
    const offset = num(i.offset);
    const limit = num(i.limit);
    return {
      path,
      range:
        offset !== null || limit !== null
          ? {
              start: (offset ?? 0) + 1,
              end: limit !== null ? (offset ?? 0) + limit : null,
            }
          : null,
      content: output,
    };
  },
  edit(i) {
    const path = str(i.filePath) ?? str(i.path);
    if (
      !path ||
      typeof i.oldString !== "string" ||
      typeof i.newString !== "string"
    )
      return null;
    const rows = [
      ...i.oldString.split("\n").map((text) => ({ sign: "-", text })),
      ...i.newString.split("\n").map((text) => ({ sign: "+", text })),
    ];
    return { path, rows, replaceAll: i.replaceAll === true };
  },
  write(i) {
    const path = str(i.filePath) ?? str(i.path);
    if (!path || typeof i.content !== "string") return null;
    return {
      path,
      rows: i.content.split("\n").map((text) => ({ sign: "+", text })),
      replaceAll: false,
    };
  },
  patch(i) {
    const text = str(i.patchText) ?? str(i.patch);
    return text
      ? {
          path: null,
          rows: text.split("\n").map((t) => ({
            sign: t.startsWith("+") ? "+" : t.startsWith("-") ? "-" : " ",
            text: t,
          })),
          replaceAll: false,
        }
      : null;
  },
  shell(i, output) {
    const command = str(i.command);
    if (!command) return null;
    const exit = /(?:exit(?: code)?|exited with)[:= ]+(-?\d+)/i.exec(output);
    return {
      command,
      description: str(i.description),
      exitCode: exit ? Number(exit[1]) : null,
      output,
    };
  },
  grep(i, output) {
    const pattern = str(i.pattern);
    if (!pattern) return null;
    const matches = lines(output)
      .slice(0, 200)
      .map((l) => {
        const m = /^(.+?):(\d+)[:-](.*)$/.exec(l);
        return m
          ? { path: m[1], line: Number(m[2]), text: m[3] }
          : { path: null, line: null, text: l };
      });
    return { pattern, scope: str(i.path), matches };
  },
  glob(i, output) {
    const pattern = str(i.pattern);
    if (!pattern) return null;
    return {
      pattern,
      scope: str(i.path),
      matches: lines(output)
        .slice(0, 200)
        .map((path) => ({ path, line: null, text: "" })),
    };
  },
  list(i, output) {
    return {
      pattern: "",
      scope: str(i.path) ?? ".",
      matches: lines(output)
        .slice(0, 200)
        .map((path) => ({ path, line: null, text: "" })),
    };
  },
  webfetch(i) {
    const url = str(i.url);
    return url ? { url, query: null } : null;
  },
  websearch(i) {
    const query = str(i.query);
    return query ? { url: null, query } : null;
  },
  todowrite(i) {
    if (!Array.isArray(i.todos)) return null;
    const items = i.todos.map((t) => {
      const o = obj(t);
      const content = o && str(o.content);
      return content ? { content, status: str(o.status) ?? "pending" } : null;
    });
    return items.length > 0 && items.every(Boolean) ? { items } : null;
  },
};
const KIND = {
  read: "read",
  edit: "diff",
  write: "diff",
  patch: "diff",
  shell: "shell",
  grep: "search",
  glob: "search",
  list: "search",
  webfetch: "web",
  websearch: "web",
  todowrite: "todo",
};

/** tool: {name,input,output,status} -> {kind, ...fields}; kind "generic" on any mismatch. */
export function deriveToolView(tool) {
  const name = canonicalToolName(tool?.name);
  const build = Object.hasOwn(BUILDERS, name) ? BUILDERS[name] : null;
  const input = parse(typeof tool?.input === "string" ? tool.input : "");
  const output = typeof tool?.output === "string" ? tool.output : "";
  if (!build || !input) return { kind: "generic" };
  const data = build(input, output, tool.status);
  return data ? { kind: KIND[name], name, ...data } : { kind: "generic" };
}

/** Permission requests tied to this tool call (Native permission.source.id === tool part id). */
export const permissionsForTool = (permissions, toolId) =>
  (Array.isArray(permissions) ? permissions : []).filter(
    (p) => typeof toolId === "string" && toolId !== "" && p.toolId === toolId,
  );

export const effectiveToolStatus = (status, permissions) =>
  permissions.length > 0 && (status === "pending" || status === "running")
    ? "needs-permission"
    : status;
