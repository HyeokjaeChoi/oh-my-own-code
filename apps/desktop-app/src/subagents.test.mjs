import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveChildTree,
  renderBrief,
  briefTitle,
  drainQueue,
  cancelAll,
  parseSubagentResult,
  DEFAULT_CAP,
} from "./renderer/shared/subagents/index.mjs";
import { drainQueuePerParent } from "./renderer/shared/subagents/index.mjs";

const s = (id, status, extra = {}) => ({
  id,
  workspaceId: "w",
  title: id,
  status,
  ...extra,
});

test("tree: two parallel running, one failed, one waiting permission, one done", () => {
  const rows = deriveChildTree({
    rootId: "p",
    sessions: [
      s("p", "running"),
      s("a", "running", { parentSessionId: "p" }),
      s("b", "running", { parentSessionId: "p" }),
      s("c", "unknown", { parentSessionId: "p" }),
      s("d", "running", { parentSessionId: "p" }),
      s("e", "idle", { parentSessionId: "p" }),
      s("a1", "idle", { parentSessionId: "a" }),
      s("other", "running"),
    ],
    permissions: [{ sessionId: "d" }],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.depth]),
    [
      ["a", "running", 0],
      ["a1", "done", 1],
      ["b", "running", 0],
      ["c", "failed", 0],
      ["d", "waiting", 0],
      ["e", "done", 0],
    ],
  );
});

test("tree: app-side lineage, queued rows, archived hidden, cycles safe", () => {
  const rows = deriveChildTree({
    rootId: "p",
    sessions: [
      s("x", "idle"),
      s("y", "idle", { archived: true, parentSessionId: "p" }),
      s("p", "idle", { parentSessionId: "x" }),
    ],
    lineage: { x: "p" },
    queued: [{ id: "q1", parentId: "p", title: "대기", brief: {} }],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.origin]),
    [
      ["x", "done", "delegated"],
      ["q1", "queued", "delegated"],
    ],
  );
});

test("brief rendering includes only filled sections, marks new context", () => {
  const text = renderBrief({
    role: "리뷰어",
    goal: "diff 검토",
    inputs: "src/a.mjs",
    ownedPaths: ["src/a/", "src/b/"],
    acceptance: "",
  });
  assert.match(text, /새 컨텍스트/);
  assert.match(text, /## 역할\n리뷰어/);
  assert.match(text, /## 담당 경로\nsrc\/a\/\nsrc\/b\//);
  assert.doesNotMatch(text, /수락 기준/);
  assert.equal(briefTitle({ role: "R", goal: "g".repeat(200) }).length, 80);
});

test("queue: FIFO, cap default 3, never negative", () => {
  const q = ["1", "2", "3", "4"];
  assert.equal(DEFAULT_CAP, 3);
  assert.deepEqual(drainQueue({ queued: q, runningCount: 0 }), {
    start: ["1", "2", "3"],
    rest: ["4"],
  });
  assert.deepEqual(drainQueue({ queued: q, runningCount: 2 }), {
    start: ["1"],
    rest: ["2", "3", "4"],
  });
  assert.deepEqual(drainQueue({ queued: q, runningCount: 5 }), {
    start: [],
    rest: q,
  });
});

test("cancel-all fans out to active children only and survives failures", async () => {
  const calls = [];
  const out = await cancelAll(
    [
      { id: "a", status: "running" },
      { id: "b", status: "done" },
      { id: "c", status: "waiting" },
      { id: "d", status: "running" },
      { id: "e", status: "queued" },
    ],
    async (id) => {
      calls.push(id);
      if (id === "c") throw new Error("x");
      return id !== "d";
    },
  );
  assert.deepEqual(calls, ["a", "c", "d"]);
  assert.deepEqual(out, { cancelled: ["a"], failed: ["c", "d"] });
});

test("subagent tool output parsing", () => {
  assert.deepEqual(
    parseSubagentResult(
      '<subagent sessionID="ses_1" state="completed">\n최종 답\n둘째 줄\n</subagent>',
    ),
    { sessionId: "ses_1", state: "completed", text: "최종 답\n둘째 줄" },
  );
  assert.equal(parseSubagentResult("plain"), null);
});

test("drainQueuePerParent counts running children per parent", () => {
  const q = [
    { id: "1", parentId: "a" },
    { id: "2", parentId: "b" },
    { id: "3", parentId: "a" },
  ];
  const out = drainQueuePerParent({
    queued: q,
    runningByParent: new Map([["a", 2]]),
    cap: 3,
  });
  assert.deepEqual(
    out.start.map((x) => x.id),
    ["1", "2"],
  );
  assert.deepEqual(
    out.rest.map((x) => x.id),
    ["3"],
  );
});
