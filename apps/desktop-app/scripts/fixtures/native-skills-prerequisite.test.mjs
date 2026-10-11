import test from "node:test";
import assert from "node:assert/strict";
import { readNativeSkillHistory } from "./native-skills-prerequisite.mjs";
const message = {
  id: "msg_one",
  type: "skill",
  skill: "native_one",
  name: "One",
  text: "Body",
};
test("pinned last data-page cursor requires reading the empty terminal page", async () => {
  const calls = [];
  const client = {
    message: {
      list: async (input) => {
        calls.push(input);
        assert.ok(
          !(input.cursor && input.order),
          "pinned endpoint rejects cursor combined with order",
        );
        return input.cursor
          ? { data: [], cursor: {} }
          : { data: [message], cursor: { next: "after-one" } };
      },
    },
  };
  assert.deepEqual(await readNativeSkillHistory(client, "session-one"), [
    message,
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, "after-one");
  assert.ok(
    calls.every(
      (x) =>
        x.type === "skill" &&
        (x.cursor ? x.order === undefined : x.order === "asc") &&
        x.limit === 64 &&
        x.sessionID === "session-one",
    ),
  );
});
test("incomplete, repeated, malformed and duplicate history is not absence", async (t) => {
  const cases = [
    ["repeated cursor", async () => ({ data: [], cursor: { next: "loop" } })],
    [
      "page bound",
      async (input) => ({
        data: [],
        cursor: { next: `${input.cursor ?? "start"}x` },
      }),
    ],
    ["invalid cursor", async () => ({ data: [], cursor: { next: "bad\n" } })],
    ["missing cursor", async () => ({ data: [] })],
    ["duplicate ID", async () => ({ data: [message, message], cursor: {} })],
    [
      "wrong type",
      async () => ({ data: [{ ...message, type: "user" }], cursor: {} }),
    ],
  ];
  for (const [name, list] of cases)
    await t.test(name, async () => {
      await assert.rejects(
        readNativeSkillHistory({ message: { list } }, "session-one"),
      );
    });
});

test("Skill probe observes actual calls and fails confirmation closed without copying body", async () => {
  const { observeSyntheticSkillsRuntime, syntheticSkillConfirmation } =
    await import("./p7-storage-owner-host.mjs");
  const result = Object.freeze({ status: "actual" }),
    calls = [];
  const nativeSkills = Object.freeze(
    Object.fromEntries(
      ["observe", "registerDisabled", "removeOwned"].map((method) => [
        method,
        async (...args) => {
          calls.push({ method, args });
          return result;
        },
      ]),
    ),
  );
  const context = {
    nativeSkills,
    client: {
      session: {
        skill: async (...args) => {
          calls.push({ method: "apply", args });
          return result;
        },
      },
    },
  };
  const runtime = Object.freeze({
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => context,
  });
  const counts = { observe: 0, registerDisabled: 0, removeOwned: 0, apply: 0 };
  const observed = observeSyntheticSkillsRuntime(runtime, counts);
  for (const method of ["observe", "registerDisabled", "removeOwned"])
    assert.equal(
      await observed
        .workbenchContext()
        .nativeSkills[method]({ opaque: "retained" }),
      result,
    );
  const input = { sessionID: "session", id: "skill", resume: false };
  assert.equal(
    await observed.workbenchContext().client.session.skill(input),
    result,
  );
  assert.equal(calls.at(-1).args[0], input);
  assert.deepEqual(counts, {
    observe: 1,
    registerDisabled: 1,
    removeOwned: 1,
    apply: 1,
  });
  const state = { enabled: false, requests: [] },
    confirm = syntheticSkillConfirmation("/synthetic", state),
    request = {
      action: "apply",
      workspacePath: "/synthetic/workspace",
      workspaceId: "w",
      sessionId: "s",
      nativeId: "native",
      sourceName: "demo",
      digest: "a".repeat(64),
      bodyDigest: "b".repeat(64),
      autoinvoke: false,
      content: "Synthetic body must not be copied to logs",
    };
  assert.equal(await confirm(request), false);
  assert.equal(Object.hasOwn(state.requests[0], "content"), false);
  state.enabled = true;
  assert.equal(await confirm(request), true);
  await assert.rejects(confirm({ ...request, workspacePath: "/outside" }));
});

test("controlled ACK loss occurs after actual adapter effect and is consumed once", async () => {
  const { observeSyntheticSkillsRuntime } = await import(
    "./p7-storage-owner-host.mjs"
  );
  const counts = { observe: 0, registerDisabled: 0, removeOwned: 0, apply: 0 };
  const fault = { nextRegisterAck: true };
  let effects = 0;
  const result = { status: "registered_disabled" };
  const runtime = {
    workbenchContext: () => ({
      nativeSkills: {
        observe: async () => ({}),
        removeOwned: async () => ({}),
        registerDisabled: async () => {
          effects++;
          return result;
        },
      },
      client: { session: { skill: async () => ({}) } },
    }),
  };
  const adapter = observeSyntheticSkillsRuntime(
    runtime,
    counts,
    fault,
  ).workbenchContext().nativeSkills;
  await assert.rejects(adapter.registerDisabled({}), /acknowledgement loss/);
  assert.equal(effects, 1);
  assert.equal(counts.registerDisabled, 1);
  assert.equal(fault.nextRegisterAck, false);
  assert.equal(await adapter.registerDisabled({}), result);
  assert.equal(effects, 2);
});
