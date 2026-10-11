import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentFile,
  validateAgentFile,
  validAgentSourceName,
} from "./renderer/shared/configuration-draft/agent.mjs";
import {
  BASELINE_POLICY,
  policyMatches,
} from "./renderer/shared/configuration-draft/policy.mjs";
import {
  nativeAgentId,
  nativeAgentDigest,
  validNativeAgent,
  validateAgentRpc,
  NATIVE_AGENTS_RPC,
} from "./native-agents-protocol.mjs";

const owner = {
  runtimeEpoch: "epoch",
  operationId: "register",
  workspaceId: "workspace",
  workspacePath: "/tmp/workspace",
  sourceName: "reviewer",
  digest: "a".repeat(64),
};
const record = () => ({
  id: nativeAgentId(owner),
  name: "reviewer",
  system: "Inspect the change.",
  mode: "primary",
  hidden: false,
  request: { settings: {}, headers: {}, body: {} },
  permissions: BASELINE_POLICY.map((x) => ({ ...x })),
});
test("agents supported grammar preserves exact Native derived system across BOM and newline forms", () => {
  for (const bom of ["", "\uFEFF"])
    for (const nl of ["\n", "\r\n"]) {
      const text =
        bom +
        [
          "---",
          '{"description":"Review changes","mode":"primary","color":"#12aBcD"}',
          "---",
          "  Inspect the change.  ",
          "",
        ].join(nl);
      assert.equal(validateAgentFile(text).status, "valid");
      assert.deepEqual(parseAgentFile(text), {
        system: "Inspect the change.",
        description: "Review changes",
        mode: "primary",
        color: "#12aBcD",
      });
    }
  assert.deepEqual(parseAgentFile("  Plain body.\n"), {
    system: "Plain body.",
    mode: "primary",
  });
});
test("agents reject unsupported permission/model/legacy conversion and duplicate metadata", () => {
  for (const meta of [
    '{"permissions":[]}',
    '{"model":"some/model"}',
    '{"mode":"subagent"}',
    '{"hidden":true}',
    '{"description":"a","description":"b"}',
    'description: "legacy YAML"',
  ]) {
    assert.equal(
      validateAgentFile(`---\n${meta}\n---\nBody`).status,
      "unsupported",
      meta,
    );
    assert.equal(parseAgentFile(`---\n${meta}\n---\nBody`), undefined);
  }
  for (const name of [
    "../review",
    "a/b",
    "__proto__",
    "constructor",
    ".",
    "a.md",
    "",
  ])
    assert.equal(validAgentSourceName(name), false, name);
  assert.equal(validAgentSourceName("reviewer-1"), true);
  assert.equal(validateAgentFile(" ").status, "invalid");
  assert.equal(validateAgentFile("\ud800").status, "invalid");
});

test("agent JSON description values may contain quoted keys without duplicate-key confusion", () => {
  const description = 'Inspect the literal "mode": "primary".';
  const text = `---\n${JSON.stringify({ description })}\n---\nBody`;
  assert.equal(validateAgentFile(text).status, "valid");
  assert.equal(parseAgentFile(text).description, description);
});

test("agent frontmatter rejects ill-formed Unicode after JSON escape decoding", () => {
  for (const escaped of ["\\ud800", "\\udfff", "x\\ud800y"]) {
    const text = `---\n{"description":"${escaped}"}\n---\nBody`;
    assert.equal(validateAgentFile(text).status, "unsupported");
    assert.equal(parseAgentFile(text), undefined);
  }
  assert.equal(
    validateAgentFile('---\n{"description":"\\ud83d\\udd0e Review"}\n---\nBody')
      .status,
    "valid",
  );
});

test("supported agent file conversion agrees with actual pinned inert Markdown parser", async () => {
  const { parseOption2 } = await import(
    "../dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-5daktx2q.js"
  );
  for (const nl of ["\n", "\r\n"])
    for (const bom of ["", "\uFEFF"])
      for (const front of [false, true]) {
        const body = `  First line.${nl}Second line.${nl}`;
        const text =
          bom +
          (front
            ? [
                "---",
                '{"description":"Review","mode":"primary"}',
                "---",
                body,
              ].join(nl)
            : body);
        const actual = parseOption2(text);
        assert.equal(parseAgentFile(text).system, actual.content.trim());
        if (front)
          assert.equal(
            parseAgentFile(text).description,
            actual.data.description,
          );
      }
});
test("agents authority cannot inherit broad Native defaults or execute accessor permissions", () => {
  const good = record();
  assert.equal(validNativeAgent(good, owner), true);
  for (const patch of [
    { model: { id: "x", providerID: "p" } },
    { permissions: [{ action: "*", resource: "*", effect: "allow" }] },
    {
      request: { settings: {}, headers: { Authorization: "secret" }, body: {} },
    },
    { mode: "all" },
    { hidden: true },
  ])
    assert.equal(validNativeAgent({ ...good, ...patch }, owner), false);
  let reads = 0;
  const sparse = Array(3);
  assert.equal(policyMatches(sparse), false);
  const accessor = [...BASELINE_POLICY];
  Object.defineProperty(accessor, 0, {
    get() {
      reads++;
      return BASELINE_POLICY[0];
    },
  });
  assert.equal(policyMatches(accessor), false);
  assert.equal(reads, 0);
  assert.equal(nativeAgentDigest(good).length, 64);
  assert.notEqual(
    nativeAgentId(owner),
    nativeAgentId({ ...owner, operationId: "different" }),
  );
});
test("agents private RPC retains raw excess keys and original owner identity", () => {
  const input = {
    nonce: "b".repeat(64),
    owner,
    record: record(),
    recordDigest: nativeAgentDigest(record()),
    expectedNativeId: null,
  };
  assert.equal(validateAgentRpc("register", input), input);
  const schema = NATIVE_AGENTS_RPC.methods.register.input["~standard"];
  assert.ok(schema.validate({ ...input, extra: true }).issues);
  assert.ok(
    schema.validate({
      ...input,
      record: {
        ...record(),
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      },
    }).issues,
  );
  assert.throws(() =>
    validateAgentRpc("remove", {
      nonce: input.nonce,
      owner: { ...owner, operationId: "remove" },
      registration: owner,
      nativeId: nativeAgentId(owner),
      recordDigest: input.recordDigest,
      method: "shell",
    }),
  );
});
