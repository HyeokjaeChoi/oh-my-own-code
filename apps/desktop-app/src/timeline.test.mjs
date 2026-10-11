import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveTimeline,
  filterTimeline,
} from "./renderer/shared/projection/timeline.mjs";
const input = {
  sessionId: "s1",
  messages: [
    { id: "m1", role: "user", text: "hi", tools: [] },
    {
      id: "m2",
      role: "assistant",
      text: "ok",
      tools: [
        { id: "t1", name: "bash", status: "completed" },
        { id: "t2", name: "edit", status: "error" },
      ],
    },
  ],
  permissions: [{ id: "p1", sessionId: "s1", title: "run" }],
  sessions: [
    { id: "c1", parentSessionId: "s1", title: "child", status: "idle" },
    { id: "x", parentSessionId: "other", title: "no", status: "idle" },
  ],
  events: [
    {
      id: "e2",
      timestamp: 20,
      operation: "message.send",
      sessionId: "c1",
      status: "ok",
    },
    {
      id: "e1",
      timestamp: 10,
      operation: "command.run",
      sessionId: "s1",
      status: "error",
    },
    { id: "e3", timestamp: 10, operation: "session.fork", status: "ok" },
    { id: "e4", operation: "x", sessionId: "s1", status: "ok" },
  ],
};
test("ordering: untimed in source order, then timed with stable ties", () => {
  const t = deriveTimeline(input);
  assert.deepEqual(
    t.map((e) => e.title),
    [
      "나: hi",
      "도우미: ok",
      "bash",
      "edit",
      "run",
      "child",
      "x",
      "command.run",
      "session.fork",
      "message.send",
    ],
  );
});
test("kinds and jump targets", () => {
  const t = deriveTimeline(input);
  const by = (title) => t.find((e) => e.title === title);
  assert.equal(by("edit").kind, "error");
  assert.deepEqual(by("edit").target, {
    type: "message",
    messageId: "m2",
    toolId: "t2",
  });
  assert.deepEqual(by("run").target, {
    type: "permission",
    permissionId: "p1",
  });
  assert.deepEqual(by("child").target, { type: "session", sessionId: "c1" });
  assert.equal(by("session.fork").target, null);
  assert.equal(by("command.run").kind, "error");
});
test("filters by kind and session", () => {
  const t = deriveTimeline(input);
  assert.deepEqual(
    filterTimeline(t, { kinds: new Set(["tool"]) }).map((e) => e.title),
    ["bash"],
  );
  assert.deepEqual(
    filterTimeline(t, { sessionIds: new Set(["c1"]) }).map((e) => e.title),
    ["child", "message.send"],
  );
  assert.equal(filterTimeline(t).length, t.length);
});
