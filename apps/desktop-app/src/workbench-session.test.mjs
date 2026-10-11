import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "./workbench-contract.mjs";

test("lifecycle validates strict booleans, normalized titles and bounded request IDs", () => {
  const target = { workspaceId: "w", sessionId: "s", requestId: "r" };
  assert.equal(
    validateRequest({ type: "session.pin", ...target, pinned: true }).pinned,
    true,
  );
  assert.equal(
    validateRequest({ type: "session.rename", ...target, title: "  renamed  " })
      .title,
    "renamed",
  );
  for (const request of [
    { type: "session.pin", ...target, pinned: "true" },
    { type: "session.archive", ...target, archived: 1 },
    { type: "session.rename", ...target, title: "\nsecret" },
    { type: "session.rename", ...target, title: " " },
    { type: "session.rename", ...target, title: "x".repeat(121) },
    { type: "session.remove", ...target, requestId: "x".repeat(129) },
    { type: "session.fork", ...target, before: "message" },
    { type: "diagnostics.list", sessionId: "s" },
  ])
    assert.throws(() => validateRequest(request), {
      appCode: "INVALID_REQUEST",
    });
});

import { mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchService } from "./workbench-service.mjs";
import { BASELINE_POLICY } from "./workbench-contract.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "session-lifecycle-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = new Map();
  const calls = [];
  let counter = 0;
  const make = (id, extra = {}) => ({
    id,
    title: "Private title",
    location: { directory: root },
    permissions: BASELINE_POLICY,
    ...extra,
  });
  records.set("sdk-parent", make("sdk-parent"));
  const state = { active: {}, inbox: [], confirm: true };
  const track =
    (name, fn) =>
    async (...args) => {
      calls.push({ name, args });
      return fn(...args);
    };
  const client = {
    session: {
      get: track("get", ({ sessionID }) => {
        if (state.get) return state.get(sessionID);
        if (!records.has(sessionID))
          throw {
            _tag: "SessionNotFoundError",
            sessionID,
            message: "private path",
          };
        return globalThis.structuredClone(records.get(sessionID));
      }),
      update: track("update", async ({ sessionID, ...patch }) => {
        if (state.update) return state.update(sessionID, patch);
        Object.assign(records.get(sessionID), patch);
      }),
      active: track("active", () => state.active),
      inbox: {
        list: track("inbox", ({ sessionID }) =>
          state.inbox.filter((i) => i.sessionID === sessionID),
        ),
      },
      fork: track("fork", ({ sessionID }) => {
        const child = make(`sdk-child-${++counter}`, {
          parentID: sessionID,
          title: "Fork",
        });
        records.set(child.id, child);
        return state.fork
          ? state.fork(child)
          : globalThis.structuredClone(child);
      }),
      list: track("list", (input) =>
        state.list
          ? state.list(input)
          : {
              data: [...records.values()].filter(
                (s) => !input.parentID || s.parentID === input.parentID,
              ),
              cursor: {},
            },
      ),
      remove: track("remove", ({ sessionID }) => {
        if (state.remove) return state.remove(sessionID);
        records.delete(sessionID);
      }),
      create: track("create", () => {
        const child = make(`sdk-created-${++counter}`);
        records.set(child.id, child);
        return child;
      }),
      interrupt: track("interrupt", () => ({})),
    },
    message: { list: async () => ({ data: [], cursor: {} }) },
    permission: { list: async () => [], reply: track("reply", () => {}) },
  };
  const service = createWorkbenchService({
    trustedTestAdapter: true,
    runtime: {
      workspace: root,
      snapshot: () => ({ state: "connected" }),
      workbenchContext: () => ({ client, session: records.get("sdk-parent") }),
    },
    pickDirectory: async () => root,
    confirmTrust: async () => true,
    confirmSessionRemoval: track("confirm", () =>
      typeof state.confirm === "function" ? state.confirm() : state.confirm,
    ),
  });
  t.after(() => service.close());
  const initial = await service.handle({ type: "snapshot" });
  assert.equal(initial.ok, true);
  const target = {
    workspaceId: initial.value.selectedWorkspaceId,
    sessionId: initial.value.selectedSessionId,
  };
  let rid = 0;
  const request = (type, fields = {}) => ({
    type,
    ...target,
    requestId: `request-${++rid}`,
    ...fields,
  });
  return { service, state, client, records, root, calls, target, request };
}

test("rename verification, pin, archive/read/restore and foreign ownership", async (t) => {
  const f = await fixture(t);
  const renamed = await f.service.handle(
    f.request("session.rename", { title: "  New name  " }),
  );
  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.sessions[0].title, "New name");
  assert.equal(
    (await f.service.handle(f.request("session.pin", { pinned: true }))).value
      .sessions[0].pinned,
    true,
  );
  const archived = await f.service.handle(
    f.request("session.archive", { archived: true }),
  );
  assert.equal(archived.value.selectedSessionId, undefined);
  assert.equal(
    (await f.service.handle({ type: "snapshot", ...f.target })).value
      .sessions[0].archived,
    true,
  );
  for (const type of ["message.send", "command.run"]) {
    assert.equal(
      (
        await f.service.handle(
          f.request(
            type,
            type === "message.send"
              ? { text: "private prompt" }
              : { name: "build", arguments: "secret" },
          ),
        )
      ).code,
      "ARCHIVED_SESSION",
    );
  }
  assert.equal(
    (await f.service.handle(f.request("session.archive", { archived: false })))
      .value.selectedSessionId,
    f.target.sessionId,
  );
  assert.equal(
    (
      await f.service.handle(
        f.request("session.pin", { pinned: true, workspaceId: "foreign" }),
      )
    ).code,
    "NOT_FOUND",
  );
});

test("workspace lock rejects existing mutations while native removal waits; cancellation is remembered", async (t) => {
  const f = await fixture(t);
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  f.state.confirm = () =>
    new Promise((resolve) => {
      release = resolve;
      entered();
    });
  const req = f.request("session.remove");
  const pending = f.service.handle(req);
  await waiting;
  for (const request of [
    { type: "workspace.remove", workspaceId: f.target.workspaceId },
    { type: "session.create", workspaceId: f.target.workspaceId },
    f.request("message.send", { text: "private" }),
    { type: "session.interrupt", ...f.target },
    {
      type: "permission.respond",
      ...f.target,
      requestId: "permission",
      decision: "reject",
    },
    f.request("session.pin", { pinned: true }),
    req,
  ])
    assert.equal((await f.service.handle(request)).code, "BUSY");
  release(false);
  assert.equal((await pending).code, "CANCELLED");
  assert.equal((await f.service.handle(req)).code, "CANCELLED");
  assert.equal(f.calls.filter((c) => c.name === "confirm").length, 1);
  assert.equal(f.calls.filter((c) => c.name === "remove").length, 0);
});

test("active/inbox checks and post-dialog races block effects", async (t) => {
  for (const cause of ["active", "inbox", "dialog"])
    await t.test(cause, async (t) => {
      const f = await fixture(t);
      if (cause === "active")
        f.state.active = { "sdk-parent": { type: "running" } };
      if (cause === "inbox") f.state.inbox = [{ sessionID: "sdk-parent" }];
      if (cause === "dialog")
        f.state.confirm = () => {
          f.state.active = { "sdk-parent": { type: "running" } };
          return true;
        };
      assert.equal(
        (await f.service.handle(f.request("session.remove"))).code,
        "BUSY",
      );
      assert.equal(f.calls.filter((c) => c.name === "remove").length, 0);
    });
});

test("fork applies policy and title, links parent, and exact duplicates never fork again", async (t) => {
  const f = await fixture(t);
  const req = f.request("session.fork", { title: "History branch" });
  const result = await f.service.handle(req);
  assert.equal(result.ok, true);
  const child = result.value.sessions.find(
    (s) => s.id === result.value.selectedSessionId,
  );
  assert.equal(child.parentSessionId, f.target.sessionId);
  assert.equal(child.title, "History branch");
  assert.deepEqual(f.records.get("sdk-child-1").permissions, BASELINE_POLICY);
  assert.equal((await f.service.handle(req)).ok, true);
  assert.equal(
    (await f.service.handle({ ...req, title: "Other" })).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(f.calls.filter((c) => c.name === "fork").length, 1);
  assert.equal(
    (await f.service.handle(f.request("session.remove"))).code,
    "HAS_DESCENDANTS",
  );
});

test("typed empty-session fork rejection is a saved fixed failure and leaves parent idle", async (t) => {
  const f = await fixture(t);
  f.client.session.fork = async () => {
    f.calls.push({ name: "fork" });
    throw {
      _tag: "InvalidRequestError",
      kind: "empty_session",
      message: "Cannot fork empty session: private-session-path",
    };
  };
  const req = f.request("session.fork");
  const result = await f.service.handle(req);
  assert.deepEqual(result, {
    ok: false,
    code: "EMPTY_SESSION",
    message: "Add conversation history before forking this session.",
  });
  assert.deepEqual(await f.service.handle(req), result);
  assert.equal(f.calls.filter((c) => c.name === "fork").length, 1);
  assert.equal(f.records.size, 1);
  const snapshot = await f.service.handle({ type: "snapshot", ...f.target });
  assert.equal(snapshot.value.sessions.length, 1);
  assert.equal(snapshot.value.sessions[0].status, "idle");
  const diagnostics = await f.service.handle({ type: "diagnostics.list" });
  assert.equal(diagnostics.value.events.at(-1).code, "EMPTY_SESSION");
  assert.equal(
    JSON.stringify(diagnostics).includes("private-session-path"),
    false,
  );
  assert.equal(
    (await f.service.handle(f.request("session.pin", { pinned: true }))).ok,
    true,
  );
});

test("empty-session lookalikes and errors after fork remain unknown", async (t) => {
  for (const [name, error, afterFork] of [
    [
      "message only",
      new Error("Cannot fork empty session: private-session-path"),
    ],
    ["missing tag", { kind: "empty_session" }],
    ["wrong tag", { _tag: "TransportError", kind: "empty_session" }],
    ["wrong kind", { _tag: "InvalidRequestError", kind: "other" }],
    ["missing kind", { _tag: "InvalidRequestError" }],
    [
      "policy rejection",
      { _tag: "InvalidRequestError", kind: "empty_session" },
      true,
    ],
  ])
    await t.test(name, async (t) => {
      const f = await fixture(t);
      const reject = () => {
        throw error;
      };
      if (afterFork) f.state.update = reject;
      else f.state.fork = reject;
      const req = f.request("session.fork");
      assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
      assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
      assert.equal(f.calls.filter((c) => c.name === "fork").length, 1);
      const snapshot = await f.service.handle({
        type: "snapshot",
        ...f.target,
      });
      assert.equal(snapshot.value.sessions[0].status, "unknown");
    });
});

test("fork transport, identity, policy and title failures remain unknown and cannot replay", async (t) => {
  for (const cause of ["transport", "identity", "policy", "title"])
    await t.test(cause, async (t) => {
      const f = await fixture(t);
      if (cause === "transport")
        f.state.fork = () => {
          throw new Error("private credential and path");
        };
      if (cause === "identity")
        f.state.fork = (child) => ({
          ...child,
          location: { directory: "/missing" },
        });
      if (cause === "policy")
        f.state.update = () => {
          throw new Error("secret");
        };
      if (cause === "title")
        f.state.update = (id, patch) => {
          if (patch.permissions) Object.assign(f.records.get(id), patch);
        };
      const req = f.request("session.fork", { title: "New" });
      assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
      assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
      assert.equal(f.calls.filter((c) => c.name === "fork").length, 1);
      const snapshot = await f.service.handle({
        type: "snapshot",
        ...f.target,
      });
      assert.equal(snapshot.value.sessions[0].status, "unknown");
      for (const child of snapshot.value.sessions.slice(1)) {
        assert.equal(child.status, "unknown");
        assert.equal(child.archived, true);
      }
    });
});

test("authoritative descendants include unregistered children and empty-page pagination", async (t) => {
  const f = await fixture(t);
  f.state.list = ({ cursor, ...input }) => {
    assert.deepEqual(input, { limit: 100 });
    return cursor
      ? {
          data: [{ id: "sdk-unregistered", fork: { sessionID: "sdk-parent" } }],
          cursor: {},
        }
      : { data: [], cursor: { next: "page-two" } };
  };
  assert.equal(
    (await f.service.handle(f.request("session.remove"))).code,
    "HAS_DESCENDANTS",
  );
  assert.equal(
    f.calls.some((c) => c.name === "confirm"),
    false,
  );
});

test("invalid/repeated/exhausted cursors and malformed pages fail closed", async (t) => {
  for (const cause of [
    "repeated",
    "invalid",
    "exhausted",
    "malformed",
    "failure",
  ])
    await t.test(cause, async (t) => {
      const f = await fixture(t);
      let pages = 0;
      f.state.list = () => {
        pages++;
        if (cause === "failure") throw new Error("secret");
        if (cause === "malformed") return { data: [] };
        return {
          data: [],
          cursor: {
            next:
              cause === "repeated"
                ? "same"
                : cause === "invalid"
                  ? 42
                  : `page-${pages}`,
          },
        };
      };
      assert.equal(
        (await f.service.handle(f.request("session.remove"))).code,
        "DESCENDANTS_UNVERIFIED",
      );
      assert.ok(pages <= 100);
      assert.equal(
        f.calls.some((c) => c.name === "remove" || c.name === "confirm"),
        false,
      );
    });
});

test("new authoritative child during confirmation blocks removal", async (t) => {
  const f = await fixture(t);
  f.state.confirm = () => {
    f.records.set("unregistered", {
      id: "unregistered",
      parentID: "sdk-parent",
    });
    return true;
  };
  assert.equal(
    (await f.service.handle(f.request("session.remove"))).code,
    "HAS_DESCENDANTS",
  );
  assert.equal(
    f.calls.some((c) => c.name === "remove"),
    false,
  );
});

test("verified deletion preserves files and removed-target duplicate receipts", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, "sentinel.txt"), "project stays");
  const req = f.request("session.remove");
  const result = await f.service.handle(req);
  assert.equal(result.ok, true);
  assert.equal(result.value.sessions.length, 0);
  assert.equal((await f.service.handle(req)).ok, true);
  assert.equal(
    (await f.service.handle({ ...req, sessionId: "foreign" })).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    (await f.service.handle(f.request("session.remove"))).code,
    "NOT_FOUND",
  );
  assert.equal(f.calls.filter((c) => c.name === "remove").length, 1);
  assert.equal(
    await readFile(join(f.root, "sentinel.txt"), "utf8"),
    "project stays",
  );
});

test("generic get failure needs exhaustive absence proof, including empty next pages", async (t) => {
  for (const cause of [
    "scan-success",
    "later-target",
    "scan-failure",
    "wrong-typed-id",
  ])
    await t.test(cause, async (t) => {
      const f = await fixture(t);
      let removed = false;
      f.state.remove = (id) => {
        removed = true;
        f.records.delete(id);
      };
      f.state.get = (id) => {
        if (!removed) return globalThis.structuredClone(f.records.get(id));
        if (cause === "wrong-typed-id")
          throw {
            _tag: "SessionNotFoundError",
            sessionID: "different",
            message: "private",
          };
        throw new Error("private path provider error");
      };
      f.state.list = (input) => {
        if (!removed) return { data: [], cursor: {} };
        if (cause === "scan-failure" || cause === "wrong-typed-id")
          throw new Error("no proof");
        if (!input.cursor) return { data: [], cursor: { next: "next" } };
        return {
          data: cause === "later-target" ? [{ id: "sdk-parent" }] : [],
          cursor: {},
        };
      };
      const req = f.request("session.remove");
      const result = await f.service.handle(req);
      assert.equal(result.ok, cause === "scan-success");
      if (!result.ok) {
        assert.equal(result.code, "UNKNOWN_OUTCOME");
        assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
        assert.equal(
          (await f.service.handle({ type: "snapshot" })).value.sessions.length,
          1,
        );
      }
      assert.equal(f.calls.filter((c) => c.name === "remove").length, 1);
    });
});

test("diagnostics retain bounded redacted mutation metadata, app-wide counters and no polls", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 505; i++)
    assert.equal(
      (
        await f.service.handle(
          f.request("session.pin", { pinned: Boolean(i % 2) }),
        )
      ).ok,
      true,
    );
  await f.service.handle(
    f.request("session.rename", { title: "private-title-secret" }),
  );
  await f.service.handle({ type: "snapshot" });
  await f.service.handle({ type: "diagnostics.list" });
  await f.service.handle(
    f.request("session.pin", {
      pinned: true,
      sessionId: "private-injected-id",
    }),
  );
  const all = (await f.service.handle({ type: "diagnostics.list" })).value;
  const filtered = (
    await f.service.handle({ type: "diagnostics.list", ...f.target })
  ).value;
  assert.equal(all.events.length, 500);
  assert.equal(all.observedOperations, 506);
  assert.equal(all.droppedEvents, 6);
  assert.equal(filtered.observedOperations, all.observedOperations);
  for (const event of all.events) {
    assert.deepEqual(
      Object.keys(event).sort(),
      [
        "durationMs",
        "id",
        "operation",
        "sessionId",
        "status",
        "timestamp",
        "workspaceId",
      ].sort(),
    );
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
  }
  const encoded = JSON.stringify(all);
  for (const secret of [
    f.root,
    "private-title-secret",
    "private-injected-id",
    "sdk-parent",
  ])
    assert.equal(encoded.includes(secret), false);
});

test("receipt capacity fails explicitly without evicting removed or successful targets", async (t) => {
  const f = await fixture(t);
  const first = f.request("session.pin", { pinned: true });
  assert.equal((await f.service.handle(first)).ok, true);
  // Known busy outcomes also reserve their IDs, independent of live records.
  f.state.active = { "sdk-parent": { type: "running" } };
  for (let i = 1; i < 2048; i++)
    assert.equal(
      (await f.service.handle(f.request("session.pin", { pinned: true }))).code,
      "BUSY",
    );
  assert.equal(
    (await f.service.handle(f.request("session.pin", { pinned: true }))).code,
    "LIMIT_REACHED",
  );
  assert.equal((await f.service.handle(first)).ok, true);
});

test("SDK identity and location changes at confirmation are rejected before deletion", async (t) => {
  for (const cause of ["identity", "location"])
    await t.test(cause, async (t) => {
      const f = await fixture(t);
      f.state.confirm = () => {
        const record = f.records.get("sdk-parent");
        if (cause === "identity") record.id = "foreign-session";
        else record.location.directory = "/missing-workspace";
        return true;
      };
      assert.equal(
        (await f.service.handle(f.request("session.remove"))).ok,
        false,
      );
      assert.equal(
        f.calls.some((c) => c.name === "remove"),
        false,
      );
    });
});

test("a pre-existing create lock prevents lifecycle and workspace removal races", async (t) => {
  const f = await fixture(t);
  let entered;
  let release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  f.client.session.create = () =>
    new Promise((resolve) => {
      release = resolve;
      entered();
    });
  const creating = f.service.handle({
    type: "session.create",
    workspaceId: f.target.workspaceId,
  });
  await waiting;
  assert.equal(
    (await f.service.handle(f.request("session.remove"))).code,
    "BUSY",
  );
  assert.equal(
    (
      await f.service.handle({
        type: "workspace.remove",
        workspaceId: f.target.workspaceId,
      })
    ).code,
    "BUSY",
  );
  const child = { ...f.records.get("sdk-parent"), id: "created" };
  f.records.set(child.id, child);
  release(child);
  assert.equal((await creating).ok, true);
});

test("rename mismatch is unknown and diagnostics never disclose raw SDK errors", async (t) => {
  const f = await fixture(t);
  f.state.update = () => {
    throw new Error(`private-token ${f.root}`);
  };
  const req = f.request("session.rename", { title: "private-title" });
  assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
  assert.equal((await f.service.handle(req)).code, "UNKNOWN_OUTCOME");
  const diagnostics = (await f.service.handle({ type: "diagnostics.list" }))
    .value;
  assert.equal(diagnostics.observedOperations, 1);
  assert.equal(diagnostics.unknownOutcomes, 1);
  assert.equal(diagnostics.events[0].code, "UNKNOWN_OUTCOME");
  for (const secret of ["private-token", "private-title", f.root])
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
});

test("unfiltered lineage scan rejects malformed relationships and accepts unrelated sessions", async (t) => {
  for (const lineage of [
    { parentID: 42 },
    { fork: {} },
    { fork: [] },
    { fork: { sessionID: null } },
  ]) {
    await t.test(JSON.stringify(lineage), async (t) => {
      const f = await fixture(t);
      f.state.list = () => ({
        data: [{ id: "sdk-other", ...lineage }],
        cursor: {},
      });
      assert.equal(
        (await f.service.handle(f.request("session.remove"))).code,
        "DESCENDANTS_UNVERIFIED",
      );
      assert.equal(
        f.calls.some((c) => c.name === "confirm"),
        false,
      );
    });
  }
  await t.test("unrelated lineage does not falsely block", async (t) => {
    const f = await fixture(t);
    f.state.confirm = false;
    f.state.list = () => ({
      data: [
        {
          id: "sdk-other",
          parentID: "unrelated",
          fork: { sessionID: "elsewhere" },
        },
      ],
      cursor: {},
    });
    assert.equal(
      (await f.service.handle(f.request("session.remove"))).code,
      "CANCELLED",
    );
  });
});
