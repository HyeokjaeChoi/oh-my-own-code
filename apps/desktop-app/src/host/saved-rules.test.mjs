import test from "node:test";
import assert from "node:assert/strict";
import { createSavedRulesHost } from "./saved-rules-host.mjs";
import { bindSavedRulesIpc } from "./saved-rules-ipc.mjs";

const setup = ({ owned = true } = {}) => {
  const calls = [];
  const rows = [
    { id: "r1", projectID: "p1", action: "bash", resource: "git status" },
    { id: "r2", projectID: "p1", action: "edit", resource: "*" },
    { id: "other", projectID: "p2", action: "bash", resource: "rm *" },
  ];
  const client = {
    location: {
      get: async ({ location }) => ({
        project: { id: location.directory === "/a" ? "p1" : "p2" },
      }),
    },
    permission: {
      saved: {
        list: async ({ projectID }) => {
          calls.push(["list", projectID]);
          // A misbehaving Native could return other projects' rows too.
          return rows;
        },
        remove: async ({ id }) => {
          calls.push(["remove", id]);
          const at = rows.findIndex((r) => r.id === id);
          rows.splice(at, 1);
        },
      },
    },
  };
  const host = createSavedRulesHost({
    context: () => ({ client }),
    resolveWorkspace: (id) => (id === "wa" ? "/a" : undefined),
    owned: () => owned,
  });
  const channels = new Map();
  bindSavedRulesIpc({
    ipcMain: { handle: (c, h) => channels.set(c, h) },
    admit: () => true,
    host,
  });
  const invoke = (...a) => channels.get("desktop:v1:rules")({}, ...a);
  return { calls, rows, host, invoke, channels };
};

test("lists only the workspace project's rows", async () => {
  const f = setup();
  const r = await f.invoke({ type: "rules.list", workspaceId: "wa" });
  assert.deepEqual(
    r.value.rules.map((x) => x.id),
    ["r1", "r2"],
  );
  assert.deepEqual(
    await f.invoke({ type: "rules.list", workspaceId: "nope" }),
    {
      ok: false,
      code: "UNAVAILABLE",
    },
  );
});

test("remove deletes a listed row and refuses other projects' or unknown ids", async () => {
  const f = setup();
  assert.deepEqual(
    await f.invoke({ type: "rules.remove", workspaceId: "wa", id: "r1" }),
    { ok: true, value: { removed: true } },
  );
  for (const id of ["other", "missing"])
    assert.equal(
      (await f.invoke({ type: "rules.remove", workspaceId: "wa", id })).code,
      "NOT_FOUND",
    );
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "remove"),
    [["remove", "r1"]],
  );
});

test("remove is refused when storage is not owned", async () => {
  const f = setup({ owned: false });
  const r = await f.invoke({
    type: "rules.remove",
    workspaceId: "wa",
    id: "r1",
  });
  assert.equal(r.code, "UNAVAILABLE");
  assert.equal(f.calls.length, 0);
});

test("closed request validation", async () => {
  const f = setup();
  assert.deepEqual([...f.channels.keys()], ["desktop:v1:rules"]);
  for (const bad of [
    undefined,
    [],
    { type: "rules.add", workspaceId: "wa" },
    { type: "rules.list" },
    { type: "rules.list", workspaceId: "wa", projectID: "p2" },
    { type: "rules.remove", workspaceId: "wa" },
    { type: "rules.remove", workspaceId: "wa", id: "../x" },
    { type: "rules.remove", workspaceId: "wa", id: "r1", action: "x" },
  ])
    assert.equal((await f.invoke(bad)).code, "INVALID_REQUEST");
  assert.equal(
    (await f.invoke({ type: "rules.list", workspaceId: "wa" }, 1)).code,
    "INVALID_REQUEST",
  );
  assert.equal(f.calls.length, 0);
});
