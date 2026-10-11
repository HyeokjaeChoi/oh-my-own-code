import assert from "node:assert/strict";
import test from "node:test";
import {
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
