import test from "node:test";
import assert from "node:assert/strict";
import {
  configurationFileWriteFits,
  validateConfigurationDraft as hostValidation,
} from "./renderer/shared/configuration-draft/validation.mjs";
import {
  validateConfigurationDraft,
  compareConfigurationDraft,
  configurationDraftFits,
  configurationFileContentFits,
  configurationTargetPath,
} from "./renderer/shared/configuration-draft/index.ts";

const mcp = (config, name = "example") =>
  JSON.stringify({ mcp: { servers: { [name]: config } } });
const local = {
  type: "local",
  command: ["node", "./synthetic-server.mjs"],
  disabled: true,
};

test("fixed configuration target preserves literal POSIX backslashes and canonical Windows forms", () => {
  for (const [root, expected] of [
    ["/", "/AGENTS.md"],
    ["/literal\\name\\", "/literal\\name\\/AGENTS.md"],
    ["C:\\", "C:\\AGENTS.md"],
    ["C:\\space\\name", "C:\\space\\name\\AGENTS.md"],
    ["\\\\server\\share", "\\\\server\\share\\AGENTS.md"],
    ["C:/space/name", "C:/space/name/AGENTS.md"],
  ])
    assert.equal(configurationTargetPath(root, "instructions"), expected);
});

test("disk content acceptance preserves blank instructions while draft format still rejects empty", () => {
  for (const text of ["", " \n\t", "\ufeff", "\ufeff \r\n\t"]) {
    assert.equal(configurationFileContentFits("instructions", text), true);
    assert.equal(
      validateConfigurationDraft("instructions", text).issues[0],
      "empty",
    );
    assert.equal(configurationFileContentFits("mcp", text), false);
  }
  for (const text of ["\u0000", " \n\u0085", "x".repeat(32769)])
    assert.equal(configurationFileContentFits("instructions", text), false);
});

test("host and editor share validation and reject hidden duplicate JSON members", () => {
  assert.equal(hostValidation, validateConfigurationDraft);
  const safe = JSON.stringify(local);
  const hidden =
    '{"type":"local","command":["node"],"environment":{"TOKEN":"SYNTHETIC-DUPLICATE-CANARY"}}';
  for (const text of [
    `{"mcp":{"servers":{"example":${hidden}}},"mcp":{"servers":{"example":${safe}}}}`,
    `{"mcp":{"servers":{"example":${hidden}},"servers":{"example":${safe}}}}`,
    `{"mcp":{"servers":{"example":${hidden},"example":${safe}}}}`,
    '{"mcp":{"servers":{"example":{"type":"local","command":["SYNTHETIC-DUPLICATE-CANARY"],"command":["node"]}}}}',
    String.raw`{"mcp":{"servers":{"example":{"type":"local","command":["node"],"disabled":false,"disabl\u0065d":true}}}}`,
    String.raw`{"mcp":{"servers":{"example":{"type":"local","command":["node"]},"exampl\u0065":{"type":"local","command":["node"]}}}}`,
  ]) {
    const result = hostValidation("mcp", text);
    assert.equal(result.status, "unsupported");
    assert.deepEqual(result.issues, ["unsupported_shape"]);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-DUPLICATE-CANARY/);
  }
  assert.equal(
    hostValidation(
      "mcp",
      mcp({ ...local, command: ["node", '{"duplicate":1,"duplicate":2}'] }),
    ).status,
    "valid",
  );
});

test("instructions are bounded text, not Native activation or a policy check", () => {
  assert.deepEqual(
    validateConfigurationDraft(
      "instructions",
      "# 지침\n\n테스트를 확인하세요.\t끝\r\n",
    ),
    { status: "valid", issues: [] },
  );
  assert.equal(
    validateConfigurationDraft("instructions", " \n ").status,
    "invalid",
  );
  for (const char of ["\0", "\u0001", "\u007f", "\u0085"])
    assert.deepEqual(
      validateConfigurationDraft("instructions", "text" + char),
      { status: "invalid", issues: ["control_bytes"] },
    );
  assert.equal(configurationDraftFits("가".repeat(10922)), true);
  assert.equal(configurationDraftFits("가".repeat(10923)), false);
  assert.deepEqual(
    validateConfigurationDraft("instructions", "가".repeat(10923)),
    { status: "invalid", issues: ["too_large"] },
  );
});

test("actual pinned MCP subset validates local argv and remote URL without execution", () => {
  for (const config of [
    local,
    { ...local, cwd: "./tools", protocol: "auto", codemode: false },
    {
      type: "remote",
      url: "https://synthetic.invalid/mcp",
      oauth: false,
      disabled: true,
    },
  ])
    assert.deepEqual(validateConfigurationDraft("mcp", mcp(config)), {
      status: "valid",
      issues: [],
    });
  for (const command of [
    [],
    "node",
    [""],
    ["node", "bad\narg"],
    Array(33).fill("x"),
  ])
    assert.deepEqual(
      validateConfigurationDraft("mcp", mcp({ ...local, command })),
      { status: "invalid", issues: ["invalid_command"] },
    );
  for (const protocol of [["auto"], 1, null, "future"])
    assert.equal(
      validateConfigurationDraft("mcp", mcp({ ...local, protocol })).status,
      "invalid",
    );
  for (const url of [
    "file:///tmp/x",
    "https://user:password@synthetic.invalid",
    "https://synthetic.invalid?token=secret",
    "https://synthetic.invalid/#secret",
    "not a url",
  ])
    assert.deepEqual(
      validateConfigurationDraft("mcp", mcp({ type: "remote", url })),
      { status: "invalid", issues: ["invalid_url"] },
    );
});

test("unsupported credentials/vendor/prototype fields never enter diagnostics", () => {
  const canary = "CANARY-PRIVATE-DO-NOT-EXPORT";
  for (const value of [
    { mcpServers: { example: { ...local } } },
    { providers: { key: canary } },
    {
      mcp: {
        servers: { example: { ...local, environment: { TOKEN: canary } } },
      },
    },
    {
      mcp: {
        servers: {
          example: {
            type: "remote",
            url: "https://synthetic.invalid",
            headers: { Authorization: canary },
          },
        },
      },
    },
    {
      mcp: {
        servers: {
          example: {
            type: "remote",
            url: "https://synthetic.invalid",
            oauth: { client_secret: canary },
          },
        },
      },
    },
  ]) {
    const result = validateConfigurationDraft("mcp", JSON.stringify(value));
    assert.equal(result.status, "unsupported");
    assert.equal(JSON.stringify(result).includes(canary), false);
  }
  for (const name of ["__proto__", "constructor", "prototype", "bad name"])
    assert.deepEqual(validateConfigurationDraft("mcp", mcp(local, name)), {
      status: "invalid",
      issues: ["invalid_server"],
    });
  assert.equal(
    validateConfigurationDraft(
      "mcp",
      JSON.stringify({
        mcp: {
          servers: Object.fromEntries(
            Array.from({ length: 17 }, (_, i) => [`s${i}`, local]),
          ),
        },
      }),
    ).status,
    "invalid",
  );
});

test("malformed/deep input has bounded diagnostics; brackets in quoted argv are data", () => {
  assert.deepEqual(
    validateConfigurationDraft("mcp", '{"secret":"CANARY-invalid'),
    { status: "invalid", issues: ["json_invalid"] },
  );
  assert.deepEqual(
    validateConfigurationDraft("mcp", "[".repeat(17) + "0" + "]".repeat(17)),
    { status: "invalid", issues: ["too_deep"] },
  );
  assert.equal(
    validateConfigurationDraft(
      "mcp",
      mcp({ ...local, command: ["node", '["\\escaped\\"' + "[".repeat(30)] }),
    ).status,
    "valid",
  );
  assert.equal(
    validateConfigurationDraft("mcp", '{"mcp":{"servers":{}}}').status,
    "invalid",
  );
});

test("comparison retains plain markup as text and exact line positions", () => {
  const diff = compareConfigurationDraft(
    "first\nold\nlast",
    "first\n<script>new</script>\nlast",
  );
  assert.deepEqual(diff, {
    rows: [
      { kind: "context", text: "first", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "old", oldLine: 2 },
      { kind: "added", text: "<script>new</script>", newLine: 2 },
      { kind: "context", text: "last", oldLine: 3, newLine: 3 },
    ],
    added: 1,
    removed: 1,
    omitted: 0,
    bounded: true,
  });
  assert.deepEqual(compareConfigurationDraft("same", "same"), {
    rows: [],
    added: 0,
    removed: 0,
    omitted: 0,
    bounded: true,
  });
  assert.equal(compareConfigurationDraft("", "new\n").added, 2);
});

test("large opposing changes show both directions with exact omitted count", () => {
  const before = Array.from({ length: 1000 }, (_, i) => `old${i}`).join("\n"),
    after = Array.from({ length: 1000 }, (_, i) => `new${i}`).join("\n"),
    diff = compareConfigurationDraft(before, after);
  assert.equal(diff.rows.length, 80);
  assert.equal(diff.added, 1000);
  assert.equal(diff.removed, 1000);
  assert.equal(diff.omitted, 1920);
  assert.equal(diff.rows.filter((r) => r.kind === "removed").length, 40);
  assert.equal(diff.rows.filter((r) => r.kind === "added").length, 40);
  assert.deepEqual(compareConfigurationDraft("x".repeat(32769), "okay"), {
    rows: [],
    added: 0,
    removed: 0,
    omitted: 0,
    bounded: false,
  });
});

test("configuration write preserves supported Unicode and refuses lossy lone surrogates", () => {
  for (const text of [
    "",
    " ",
    "\ufeff",
    "normal\ntext",
    "emoji\ud83d\ude00",
    "a".repeat(32768),
  ])
    assert.equal(configurationFileWriteFits("instructions", text), true);
  for (const text of [
    "\ud800",
    "\udfff",
    "a\ud800z",
    "\u0000",
    "a".repeat(32769),
  ])
    assert.equal(configurationFileWriteFits("instructions", text), false);
  assert.equal(configurationFileWriteFits("mcp", mcp(local)), true);
  assert.equal(configurationFileWriteFits("mcp", ""), false);
  assert.equal(
    configurationFileWriteFits(
      "mcp",
      '{"mcp":{"servers":{}},"env":{"PRIVATE":"synthetic"}}',
    ),
    false,
  );
});
