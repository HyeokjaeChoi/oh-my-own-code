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
// ponytail: no extra text cap here; projection already bounds input (8KB) and
// output (64KB), so these caps only bound row/DOM counts.
const TRUNCATED = "… 표시 길이 제한";
export const MAX_ROWS = 400;
export const MAX_MATCHES = 200;
export const MAX_LINE = 2000;
const clipLine = (t) => (t.length > MAX_LINE ? `${t.slice(0, MAX_LINE)}…` : t);
// Drops projection's trailing truncation marker; `cut` counts it as hidden.
function lines(out) {
  const all = out ? out.split("\n").filter(Boolean) : [];
  const cut = all.at(-1) === TRUNCATED;
  if (cut) all.pop();
  return { all, cut: cut ? 1 : 0 };
}
// Each side gets its own budget so a long "-" block cannot push out every "+".
function sideRows(old, add) {
  const o = old === "" ? [] : old.split("\n");
  const a = add.split("\n");
  const delN = Math.min(o.length, MAX_ROWS - Math.min(a.length, MAX_ROWS / 2));
  const addN = Math.min(a.length, MAX_ROWS - delN);
  const row = (sign) => (text) => ({ sign, text: clipLine(text) });
  return {
    rows: [
      ...o.slice(0, delN).map(row("-")),
      ...a.slice(0, addN).map(row("+")),
    ],
    hiddenRows: o.length - delN + (a.length - addN),
  };
}

function pathList(pattern, scope, output) {
  const { all, cut } = lines(output);
  return {
    pattern,
    scope,
    matches: all.slice(0, MAX_MATCHES).map((p) =>
      // Clipped paths are not real paths: show them as plain text.
      p.length > MAX_LINE
        ? { path: null, line: null, text: clipLine(p) }
        : { path: p, line: null, text: "" },
    ),
    hiddenMatches: Math.max(0, all.length - MAX_MATCHES) + cut,
  };
}

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
    return {
      path,
      ...sideRows(i.oldString, i.newString),
      replaceAll: i.replaceAll === true,
    };
  },
  write(i) {
    const path = str(i.filePath) ?? str(i.path);
    if (!path || typeof i.content !== "string") return null;
    return { path, ...sideRows("", i.content), replaceAll: false };
  },
  patch(i) {
    const text = str(i.patchText) ?? str(i.patch);
    if (!text) return null;
    const all = text.split("\n");
    const rows = all.slice(0, MAX_ROWS).map((t) => ({
      sign: t.startsWith("+") ? "+" : t.startsWith("-") ? "-" : " ",
      text: clipLine(t),
    }));
    return {
      path: null,
      rows,
      hiddenRows: Math.max(0, all.length - MAX_ROWS),
      replaceAll: false,
    };
  },
  shell(i, output, _status, exit) {
    const command = str(i.command);
    if (!command) return null;
    return {
      command,
      description: str(i.description),
      // Only the runtime's structured exit status; never parsed from output text.
      exitCode:
        Number.isInteger(exit) && exit >= 0 && exit <= 255 ? exit : null,
      output,
    };
  },
  grep(i, output) {
    const pattern = str(i.pattern);
    if (!pattern) return null;
    const { all, cut } = lines(output);
    const matches = all.slice(0, MAX_MATCHES).map((l) => {
      const m = /^(.+?):(\d+)[:-](.*)$/.exec(clipLine(l));
      return m
        ? { path: m[1], line: Number(m[2]), text: m[3] }
        : { path: null, line: null, text: clipLine(l) };
    });
    return {
      pattern,
      scope: str(i.path),
      matches,
      hiddenMatches: all.length - matches.length + cut,
    };
  },
  glob(i, output) {
    const pattern = str(i.pattern);
    if (!pattern) return null;
    return pathList(pattern, str(i.path), output);
  },
  list(i, output) {
    return pathList("", str(i.path) ?? ".", output);
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
  const data = build(input, output, tool.status, tool.exit);
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
