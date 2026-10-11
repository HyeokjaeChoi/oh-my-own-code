import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeSkillId,
  nativeSkillDigest,
  validNativeSkill,
  NATIVE_SKILLS_RPC,
  validateSkillRpc,
} from "./native-skills-protocol.mjs";
const epoch = "runtime-one",
  workspaceId = "workspace-one",
  sourceName = "demo",
  operationId = "operation-one";
const root = "/synthetic/workspace";
const owner = {
  runtimeEpoch: epoch,
  operationId,
  workspaceId,
  workspacePath: root,
  sourceName,
  digest: "a".repeat(64),
};
const record = {
  id: nativeSkillId(owner),
  name: "Demo",
  autoinvoke: false,
  path: root + "/.opencode/skills/demo/SKILL.md",
  content: "# Demo\n",
};
test("Native Skill private protocol: deterministic original key and exact inactive record", () => {
  assert.equal(nativeSkillId(owner), nativeSkillId({ ...owner }));
  assert.notEqual(nativeSkillId({ ...owner, operationId: "other" }), record.id);
  assert.equal(validNativeSkill(record, owner), true);
  for (const changed of [
    { ...record, autoinvoke: true },
    { ...record, metadata: {} },
    { ...record, path: root + "/other/SKILL.md" },
    { ...record, id: "foreign" },
    { ...record, content: "\u0000" },
  ])
    assert.equal(validNativeSkill(changed, owner), false);
  assert.match(nativeSkillDigest(record), /^[a-f0-9]{64}$/);
  assert.notEqual(
    nativeSkillDigest({ ...record, content: "# Changed\n" }),
    nativeSkillDigest(record),
  );
});
test("Native Skill private protocol: closed nonce/root/identity/digest inputs", () => {
  const request = {
    nonce: "b".repeat(64),
    owner,
    record,
    recordDigest: nativeSkillDigest(record),
    expectedNativeId: null,
  };
  assert.equal(validateSkillRpc("registerDisabled", request), request);
  for (const changed of [
    { ...request, extra: true },
    { ...request, nonce: "" },
    { ...request, recordDigest: "c".repeat(64) },
    { ...request, owner: { ...owner, sourceName: "../bad" } },
    { ...request, owner: { ...owner, sessionId: "s" } },
  ])
    assert.throws(
      () => validateSkillRpc("registerDisabled", changed),
      /native_skill_invalid/,
    );
  assert.throws(
    () => validateSkillRpc("unknown", request),
    /native_skill_invalid/,
  );
  assert.equal(NATIVE_SKILLS_RPC.id, "omoc.workbench.skills.v1");
  assert.deepEqual(Object.keys(NATIVE_SKILLS_RPC.methods).sort(), [
    "observe",
    "registerDisabled",
    "removeOwned",
  ]);
});

test("runtime conversion matches actual pinned inert parser bytes and forces inactive Native record", async () => {
  const { parseSkillRuntimeRecord, skillRuntimeDigest } = await import(
    "./host/workbench-native-skills.mjs"
  );
  const { parse2 } = await import(
    "../dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-0bywbddq.js"
  );
  for (const newline of ["\n", "\r\n"])
    for (const bom of ["", "\uFEFF"])
      for (const frontmatter of [false, true]) {
        const body = `# Body${newline}Second line${newline}`;
        const text =
          bom +
          (frontmatter
            ? [
                "---",
                'name: "Name"',
                'description: "Description"',
                "metadata:",
                "  opencode/autoinvoke: true",
                "---",
                "",
              ].join(newline)
            : "") +
          body;
        const owner = {
          runtimeEpoch: "epoch",
          operationId: "op",
          workspaceId: "w",
          workspacePath: "/synthetic/w",
          sourceName: "one",
          digest: skillRuntimeDigest(text),
        };
        const record = parseSkillRuntimeRecord(owner, text);
        const actual = parse2(
          "/synthetic/w/.opencode/skills",
          record.path,
          text,
        );
        assert.equal(actual._tag, "Parsed");
        assert.equal(record.content, actual.skill.content);
        assert.equal(record.name, actual.skill.name);
        assert.equal(record.description, actual.skill.description);
        assert.equal(record.autoinvoke, false);
      }
});
test("production Skill history follows pinned cursor rules and refuses incomplete evidence", async () => {
  const { scanNativeSkillHistory } = await import(
    "./host/workbench-native-skills.mjs"
  );
  const row = {
    id: "msg_one",
    type: "skill",
    skill: "native",
    name: "Name",
    text: "Body",
  };
  let calls = 0;
  const result = await scanNativeSkillHistory(async (input) => {
    calls++;
    assert.ok(!(input.cursor && input.order));
    return input.cursor
      ? { data: [], cursor: {} }
      : { data: [row], cursor: { next: "after-one" } };
  }, "session");
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].nativeId, "native");
  await assert.rejects(
    scanNativeSkillHistory(
      async () => ({ data: [], cursor: { next: "same" } }),
      "session",
    ),
  );
  await assert.rejects(
    scanNativeSkillHistory(
      async () => ({ data: [row, row], cursor: {} }),
      "session",
    ),
  );
});
