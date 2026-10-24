import test from "node:test";
import assert from "node:assert/strict";
import {
  latestChecklist,
  latestPlan,
  approvedPlans,
  approvalMessage,
  nextVersion,
  checkKind,
  verifiedChecks,
  findingLines,
} from "./renderer/shared/plan-review/index.mjs";

const user = (id, text) => ({ id, role: "user", text, tools: [] });
const asst = (id, tools = [], extra = {}) => ({
  id,
  role: "assistant",
  text: "",
  tools,
  ...extra,
});
const tool = (id, name, input, status = "completed", output = "") => ({
  id,
  name,
  status,
  input: JSON.stringify(input),
  output,
});
const sh = (id, command, status, output, exit) => ({
  ...tool(id, "bash", { command }, status, output),
  ...(exit !== undefined && { exit }),
});
const edit = (id, status = "completed") =>
  tool(
    id,
    "edit",
    { filePath: "a.ts", oldString: "a", newString: "b" },
    status,
  );

test("checklist: latest todowrite, cancelled excluded from total", () => {
  const todos = (list) => tool("t", "todowrite", { todos: list });
  const messages = [
    asst("a1", [todos([{ content: "old", status: "pending" }])]),
    asst("a2", [
      todos([
        { content: "x", status: "completed" },
        { content: "y", status: "in_progress" },
        { content: "z", status: "cancelled" },
      ]),
    ]),
  ];
  const c = latestChecklist(messages);
  assert.deepEqual([c.done, c.total, c.items.length], [1, 2, 3]);
  assert.equal(latestChecklist([asst("a", [])]), null);
});

test("plan: latest Plan-agent message, case-insensitive", () => {
  const runtime = (agent) => ({ agent, model: { providerId: "p", id: "m" } });
  const messages = [
    asst("a1", [], { text: "p1", runtime: runtime("Plan") }),
    asst("a2", [], { text: "build", runtime: runtime("build") }),
    asst("a3", [], { text: "  ", runtime: runtime("plan") }),
  ];
  assert.equal(latestPlan(messages).id, "a1");
  assert.equal(latestPlan([]), null);
});

test("approved versions: marker scan, runs until next approval", () => {
  const messages = [
    user("u0", "hi"),
    user("u1", approvalMessage(1, "do A")),
    asst("a1"),
    asst("a2"),
    user("u2", "[승인된 계획 v2]\nB"),
    asst("a3"),
    user("u3", "mentions [승인된 계획 v9] later"),
  ];
  const plans = approvedPlans(messages);
  assert.deepEqual(
    plans.map((p) => [p.version, p.messageId, p.runs]),
    [
      [1, "u1", ["a1", "a2"]],
      [2, "u2", ["a3"]],
    ],
  );
  assert.equal(nextVersion(messages), 3);
  assert.equal(nextVersion([]), 1);
  // Count-based: the number written in the marker is ignored.
  const forged = approvedPlans([user("u1", "[승인된 계획 v7]\nX")]);
  assert.equal(forged[0].version, 1);
});

test("check detection", () => {
  const yes = {
    "pnpm run lint": "lint",
    "npm test": "test",
    "cd x && yarn run typecheck": "typecheck",
    "npx tsc --noEmit": "typecheck",
    "pytest -q": "test",
    "cargo test --all": "test",
    "go test ./...": "test",
    "bun run test": "test",
    "node --test src/*.test.mjs": "test",
    "./node_modules/.bin/nx run app:test": "test",
  };
  for (const [cmd, kind] of Object.entries(yes))
    assert.equal(checkKind(cmd), kind, cmd);
  for (const cmd of [
    "ls",
    "cat test.txt",
    "git commit -m 'fix test'",
    "cat lint.log",
    "npm test || echo exit 0",
    "npm test; echo ok",
    "npm test && echo done",
    "echo hi && npm test",
    "npm test | tee out",
    "npm test > out.log",
    "npm test\nrm -rf x",
    "echo $(npm test)",
    "grep lint package.json",
  ])
    assert.equal(checkKind(cmd), null, cmd);
});

test("verified checks use tool status/exit code only; unknown is not a pass", () => {
  const messages = [
    asst(
      "a1",
      [
        sh("c1", "npm test", "completed", "ok", 0),
        sh("c2", "npm run lint", "completed", "boom", 1),
        sh("c3", "npm run typecheck", "completed", "no exit info"),
        sh("c6", "npm test", "completed", "exit code: 0"), // text-derived: never a pass
        sh("c4", "pytest", "error", "Tool error"),
        sh("c5", "vitest", "running", ""),
      ],
      { text: "모든 테스트 통과, 완료" },
    ),
  ];
  const { checks, needsReverify } = verifiedChecks(messages);
  assert.deepEqual(
    checks.map((c) => c.status),
    ["passed", "failed", "unknown", "unknown", "failed", "running"],
  );
  assert.equal(needsReverify, false);
});

test("re-verify needed only when a completed edit follows the last pass", () => {
  const pass = sh("c1", "npm test", "completed", "", 0);
  const run = (...tools) => verifiedChecks([asst("a", tools)]).needsReverify;
  assert.equal(run(pass, edit("e1")), true);
  assert.equal(run(edit("e1"), pass), false);
  assert.equal(run(pass, edit("e1", "error")), false);
  assert.equal(run(edit("e1")), false);
  for (const cmd of [
    "sed -i s/a/b/ a.ts",
    "echo x > a.ts",
    "echo x >> a.ts",
    "cat a | tee b",
    "mv a b",
    "cp a b",
    "rm a",
    "git apply x.patch",
    "git checkout -- a",
    "git restore a",
    "patch -p1 < x",
  ])
    assert.equal(run(pass, sh("s", cmd, "completed", "", 0)), true, cmd);
  assert.equal(run(pass, sh("s", "ls 2>&1", "completed", "", 0)), false);
  assert.equal(run(pass, sh("s", "git status", "completed", "", 0)), false);
  assert.equal(run(pass, sh("s", "rm a", "error", "")), false);
});

test("findings: only lines starting with '- '", () => {
  assert.deepEqual(findingLines("x\n- a.ts:1 bad\n  - nested\n- b"), [
    "- a.ts:1 bad",
    "- b",
  ]);
  assert.equal(findingLines("no list"), null);
});
