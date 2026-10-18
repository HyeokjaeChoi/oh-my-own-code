import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_LINE,
  MAX_MATCHES,
  MAX_ROWS,
  deriveToolView,
  effectiveToolStatus,
  permissionsForTool,
} from "./renderer/shared/tool-ui/index.mjs";

const tool = (name, input, output = "", status = "completed") => ({
  name,
  input: typeof input === "string" ? input : JSON.stringify(input),
  output,
  status,
});

test("registry selects renderer by name and aliases", () => {
  assert.equal(
    deriveToolView(
      tool("read", { filePath: "a.ts", offset: 4, limit: 10 }, "x"),
    ).kind,
    "read",
  );
  assert.deepEqual(
    deriveToolView(tool("read", { filePath: "a.ts", offset: 4, limit: 10 }))
      .range,
    { start: 5, end: 14 },
  );
  assert.equal(
    deriveToolView(tool("bash", { command: "ls" }, "exit code: 2")).exitCode,
    2,
  );
  assert.equal(
    deriveToolView(tool("apply_patch", { patchText: "+a\n-b" })).kind,
    "diff",
  );
  const edit = deriveToolView(
    tool("edit", { filePath: "a", oldString: "x", newString: "y" }),
  );
  assert.deepEqual(edit.rows, [
    { sign: "-", text: "x" },
    { sign: "+", text: "y" },
  ]);
  const g = deriveToolView(
    tool("grep", { pattern: "foo" }, "src/a.ts:12:foo()\nbare"),
  );
  assert.deepEqual(g.matches[0], { path: "src/a.ts", line: 12, text: "foo()" });
  assert.equal(
    deriveToolView(tool("webfetch", { url: "https://x.test" })).url,
    "https://x.test",
  );
  assert.equal(
    deriveToolView(
      tool("todowrite", { todos: [{ content: "a", status: "completed" }] }),
    ).items[0].status,
    "completed",
  );
});

test("unknown tool or shape mismatch falls back to generic", () => {
  for (const t of [
    tool("mystery", { a: 1 }),
    tool("read", { nope: 1 }),
    tool("edit", { filePath: "a", oldString: 1, newString: "y" }),
    tool("shell", "{truncated"),
    tool("todowrite", { todos: [{ nope: 1 }] }),
    tool("grep", []),
    null,
  ])
    assert.deepEqual(deriveToolView(t), { kind: "generic" });
});

test("permission correlation by tool id", () => {
  const ps = [
    { id: "p1", toolId: "c1" },
    { id: "p2" },
    { id: "p3", toolId: "c2" },
  ];
  assert.deepEqual(permissionsForTool(ps, "c1"), [ps[0]]);
  assert.deepEqual(permissionsForTool(ps, ""), []);
  assert.equal(effectiveToolStatus("running", [ps[0]]), "needs-permission");
  assert.equal(effectiveToolStatus("completed", [ps[0]]), "completed");
  assert.equal(effectiveToolStatus("running", []), "running");
});

test("hostile and huge input stays bounded and text-only", () => {
  const html = '<img src=x onerror="alert(1)"><script>1</script>';
  const w = deriveToolView(
    tool("write", { path: "a.html", content: `${html}\n`.repeat(5000) }),
  );
  assert.equal(w.rows.length, MAX_ROWS);
  assert.ok(w.hiddenRows >= 4600);
  assert.equal(w.rows[0].text, html);
  const long = deriveToolView(
    tool("edit", { path: "a", oldString: "x".repeat(1e6), newString: "y" }),
  );
  assert.ok(long.rows[0].text.length <= MAX_LINE + 1);
  assert.ok(long.hiddenRows > 0);
  const p = deriveToolView(
    tool("apply_patch", { patchText: "+a\n".repeat(1e5) }),
  );
  assert.equal(p.rows.length, MAX_ROWS);
  assert.ok(p.hiddenRows > 0);
  const g = deriveToolView(
    tool("grep", { pattern: "x" }, "f.ts:1:hit\n".repeat(1000)),
  );
  assert.equal(g.matches.length, MAX_MATCHES);
  assert.equal(g.hiddenMatches, 800);
  const gl = deriveToolView(tool("glob", { pattern: "*" }, "p\n".repeat(500)));
  assert.equal(gl.hiddenMatches, 300);
  assert.equal(
    deriveToolView(tool("grep", { pattern: "x" }, `a:1:${"z".repeat(1e6)}`))
      .matches[0].text.length <=
      MAX_LINE + 1,
    true,
  );
});

test("unknown tools, binary-ish output and deep JSON fall back safely", () => {
  assert.deepEqual(deriveToolView(tool("mcp_weird", { a: 1 })), {
    kind: "generic",
  });
  assert.deepEqual(deriveToolView(tool("__proto__", { a: 1 })), {
    kind: "generic",
  });
  assert.deepEqual(deriveToolView(tool("constructor", { a: 1 })), {
    kind: "generic",
  });
  let deep = "1";
  for (let i = 0; i < 20000; i++) deep = `[${deep}]`;
  assert.deepEqual(deriveToolView(tool("read", deep)), { kind: "generic" });
  const nested =
    '{"filePath":' + '{"a":'.repeat(50) + "1" + "}".repeat(50) + "}";
  assert.deepEqual(deriveToolView(tool("read", nested)), { kind: "generic" });
  const bin = deriveToolView(
    tool("bash", { command: "cat x" }, "\u0000\u0001�‮".repeat(10)),
  );
  assert.equal(bin.kind, "shell");
  assert.equal(bin.exitCode, null);
  assert.equal(deriveToolView(tool("read", { filePath: 1 })).kind, "generic");
});
