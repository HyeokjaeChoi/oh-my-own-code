import assert from "node:assert/strict";
import test from "node:test";
import {
  visibleSessions,
  sessionSuccessor,
  validSessionTitle,
  isPlaceholderTitle,
  titleFromPrompt,
  withDisplayTitles,
} from "./renderer/features/sessions/navigation.ts";
const sessions = [
  { id: "a", workspaceId: "w", title: "Alpha", status: "idle" },
  { id: "b", workspaceId: "w", title: "Beta", status: "idle", pinned: true },
  {
    id: "c",
    workspaceId: "w",
    title: "Beta old",
    status: "idle",
    archived: true,
    pinned: true,
  },
  { id: "d", workspaceId: "other", title: "Beta", status: "idle" },
  {
    id: "e",
    workspaceId: "w",
    title: "Beta two",
    status: "idle",
    pinned: true,
  },
];
test("search, ownership, archive filter and stable pinned ordering compose without mutating authority", () => {
  assert.deepEqual(
    visibleSessions(sessions, "w", "", false).map((s) => s.id),
    ["b", "e", "a"],
  );
  assert.deepEqual(
    visibleSessions(sessions, "w", " BETA ", false).map((s) => s.id),
    ["b", "e"],
  );
  assert.deepEqual(
    visibleSessions(sessions, "w", "beta", true).map((s) => s.id),
    ["c"],
  );
  assert.deepEqual(
    sessions.map((s) => s.id),
    ["a", "b", "c", "d", "e"],
  );
});
test("selection stays by ID and successors cannot cross workspace or select archives", () => {
  assert.equal(sessionSuccessor(sessions, "w", "a"), "a");
  assert.equal(sessionSuccessor(sessions, "w", "c"), "b");
  assert.equal(sessionSuccessor(sessions, "w", "d"), "b");
  assert.equal(sessionSuccessor(sessions, "empty", "a"), undefined);
});
test("rename rejects blank, controls and oversized titles", () => {
  for (const title of ["", "  ", "line\nnew", "\u007f", "a".repeat(121)])
    assert.equal(validSessionTitle(title), false);
  assert.equal(validSessionTitle("  새 이름  "), true);
});
test("confirmed removed IDs cannot be retained or picked from a stale successor list", () => {
  assert.equal(sessionSuccessor(sessions, "w", "a", "a"), "b");
  assert.equal(sessionSuccessor(sessions, "w", "b", "a"), "b");
  assert.equal(sessionSuccessor(sessions, "w", "c", "b"), "e");
  assert.equal(
    sessionSuccessor([sessions[0], sessions[2], sessions[3]], "w", "a", "a"),
    undefined,
  );
});
test("trackSessions marks finished background runs unread and keeps recent opens", async () => {
  const { trackSessions, emptyActivity } = await import(
    "./renderer/features/sessions/navigation.ts"
  );
  const s = (id, status) => ({ id, workspaceId: "w", title: id, status });
  let a = trackSessions(
    emptyActivity,
    [s("a", "idle"), s("b", "running")],
    "a",
  );
  assert.deepEqual(a.unread, []);
  a = trackSessions(a, [s("a", "idle"), s("b", "idle")], "a");
  assert.deepEqual(a.unread, ["b"]);
  a = trackSessions(a, [s("a", "idle"), s("b", "idle")], "b");
  assert.deepEqual(a.unread, []);
  assert.deepEqual(a.recent, ["b", "a"]);
  a = trackSessions(a, [s("a", "idle")], "a");
  assert.deepEqual(a.recent, ["a"]);
});

test("last activity is stamped on observed status changes only; relativeTime is compact Korean", async () => {
  const { trackSessions, emptyActivity, relativeTime } = await import(
    "./renderer/features/sessions/navigation.ts"
  );
  const s = (id, status) => ({ id, workspaceId: "w", title: id, status });
  // First sighting has no time; a change stamps it; no change keeps it.
  let a = trackSessions(emptyActivity, [s("a", "idle")], "a", 1000);
  assert.deepEqual(a.active, {});
  a = trackSessions(a, [s("a", "running")], "a", 2000);
  assert.deepEqual(a.active, { a: 2000 });
  a = trackSessions(a, [s("a", "running")], "a", 9000);
  assert.deepEqual(a.active, { a: 2000 });
  a = trackSessions(a, [], "a", 9500);
  assert.deepEqual(a.active, {});
  const now = 1_000_000_000;
  const ago = (ms) => relativeTime(now - ms, now);
  assert.equal(ago(5_000), "방금");
  assert.equal(ago(3 * 60_000), "3분");
  assert.equal(ago(2 * 3_600_000), "2시간");
  assert.equal(ago(30 * 3_600_000), "어제");
  assert.equal(ago(3 * 86_400_000), "3일");
  assert.equal(ago(15 * 86_400_000), "2주");
});

test("placeholder titles display as 새 세션 or the first prompt; stored title is kept", () => {
  assert.equal(isPlaceholderTitle("Untitled session"), true);
  assert.equal(isPlaceholderTitle("Workbench"), true);
  assert.equal(isPlaceholderTitle("Alpha"), false);
  assert.equal(titleFromPrompt("  hello\n  world  "), "hello world");
  assert.equal(titleFromPrompt("x".repeat(60)), `${"x".repeat(48)}…`);
  const list = [
    { id: "1", workspaceId: "w", title: "Untitled session", status: "idle" },
    { id: "2", workspaceId: "w", title: "Workbench", status: "idle" },
    { id: "3", workspaceId: "w", title: "Alpha", status: "idle" },
  ];
  const shown = withDisplayTitles(list, { 2: "first prompt" });
  assert.deepEqual(
    shown.map((s) => [s.title, s.storedTitle]),
    [
      ["새 세션", "Untitled session"],
      ["first prompt", "Workbench"],
      ["Alpha", "Alpha"],
    ],
  );
});
