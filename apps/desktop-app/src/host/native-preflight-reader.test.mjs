import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePreflightSnapshot,
  PINNED_MIGRATION_IDS,
} from "../native-preflight-predicates.mjs";

const nonce = "a".repeat(64);
const mapping = (id = "root", extra = {}) => ({
  appSessionId: id,
  nativeSessionId: `ses_${id}`,
  workspaceId: "workspace",
  canonicalPath: "/workspace",
  ...extra,
});
const metadata = () => ({
  operationId: "operation",
  originalRuntimeEpoch: "old-epoch",
  appSessionId: "root",
  workspaceId: "workspace",
  digest: "b".repeat(64),
});
// Exact public selection order: id,parent,suspended,compacting,resume,directory,path,workspace,fork,boundary,metadata.
const row = (id = "root", fork = null, boundary = null) => [
  `ses_${id}`,
  null,
  null,
  null,
  0,
  "/workspace",
  null,
  null,
  fork,
  boundary,
  JSON.stringify(metadata()),
];
const ids = PINNED_MIGRATION_IDS;
const fixture = () => ({
  sessions: [row()],
  pending: [],
  inbox: [],
  kv: [],
  migrations: ids.map((id) => [id, 1]),
  migrationIds: ids,
  legacyStatus: { status: "completed" },
  messages: [],
});
const request = (mappings = [mapping()]) => ({
  version: 1,
  nonce,
  database: "/copy/db.sqlite",
  mappings,
});
const evaluate = (snapshot, mappings, decode = (value) => value) =>
  evaluatePreflightSnapshot(request(mappings), snapshot, decode);
const message = (
  id = "msg_one",
  session = "ses_root",
  type = "user",
  data = { time: { created: 1 }, text: "" },
) => [id, session, type, JSON.stringify(data)];

test("idle root returns only closed root admission metadata with runtimeEpoch translation", () => {
  const result = evaluate(fixture());
  assert.equal(result.allowed, true);
  assert.deepEqual(result.correlations, [
    {
      nativeSessionId: "ses_root",
      appSessionId: "root",
      workspaceId: "workspace",
      runtimeEpoch: "old-epoch",
      operationId: "operation",
      digest: "b".repeat(64),
    },
  ]);
  assert.equal(JSON.stringify(result).includes("/workspace"), false);
  const empty = fixture();
  empty.sessions = [];
  assert.equal(evaluate(empty, []).allowed, true);
});

test("any global pending/inbox row including NULL orphan IDs holds without payload decoding", () => {
  for (const table of ["pending", "inbox"])
    for (const id of [null, "", "orphan"]) {
      const f = fixture();
      f[table] = [[id]];
      assert.equal(evaluate(f).reason, "pending_inbox");
      assert.deepEqual(evaluate(f).correlations, []);
    }
  const f = fixture();
  f.kv = [[null]];
  assert.equal(evaluate(f).allowed, false);
});

test("raw NULL lifecycle, exact mappings, row shape and bounded metadata are required", () => {
  for (const [column, value] of [
    [1, ""],
    [1, "ses_other"],
    [2, 0],
    [3, 0],
    [4, 1],
    [4, null],
    [4, "0"],
    [5, "/elsewhere"],
    [6, "../escape"],
    [7, ""],
    [8, ""],
    [9, "null"],
    [10, "null"],
    [10, "{}"],
    [10, JSON.stringify({ ...metadata(), extra: true })],
  ]) {
    const f = fixture();
    f.sessions[0][column] = value;
    assert.equal(evaluate(f).allowed, false, `column ${column}`);
  }
  for (const mutate of [
    (f) => f.sessions[0].pop(),
    (f) => f.sessions.push(row()),
    (f) => (f.sessions[0][0] = "ses_unknown"),
    (f) => (f.sessions = Array.from({ length: 201 }, () => row())),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).allowed, false);
  }
  const f = fixture();
  f.sessions[0][10] = JSON.stringify({ ...metadata(), appSessionId: "other" });
  assert.equal(evaluate(f).allowed, false);
});

test("ledger exact equality, timestamps, public list uniqueness and legacy completed are mandatory", () => {
  for (const mutate of [
    (f) => f.migrations.pop(),
    (f) => f.migrations.push(["unknown", 1]),
    (f) => (f.migrations[0] = f.migrations[1]),
    (f) => (f.migrations[0][1] = 0),
    (f) => (f.migrations[0][1] = "1"),
    (f) => (f.migrationIds = [...ids.slice(1), ids[1]]),
    (f) => f.migrations[0].push("extra"),
    (f) => (f.legacyStatus = { status: "required" }),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).allowed, false);
  }
});

test("nested forks require exact parent, valid boundary and complete inherited root metadata", () => {
  const f = fixture();
  f.messages = [message()];
  f.sessions.push(
    row(
      "child",
      "ses_root",
      JSON.stringify({ type: "through", messageID: "msg_one" }),
    ),
  );
  f.messages.push(message("msg_child", "ses_child"));
  f.sessions.push(
    row(
      "grandchild",
      "ses_child",
      JSON.stringify({ type: "before", messageID: "msg_child" }),
    ),
  );
  const mappings = [
    mapping(),
    mapping("child", { parentAppSessionId: "root" }),
    mapping("grandchild", { parentAppSessionId: "child" }),
  ];
  assert.equal(evaluate(f, mappings).allowed, true);
  assert.equal(evaluate(f, mappings).correlations.length, 1);
  for (const [index, value] of [
    [8, "ses_unknown"],
    [9, "null"],
    [9, JSON.stringify({ type: "through", messageID: "msg_missing" })],
    [9, JSON.stringify({ type: "through", messageID: "msg_one", extra: true })],
    [10, JSON.stringify({ ...metadata(), operationId: "other" })],
  ]) {
    const broken = globalThis.structuredClone(f);
    broken.sessions[1][index] = value;
    assert.equal(evaluate(broken, mappings).allowed, false);
  }
  assert.equal(
    evaluate(f, [mapping(), mapping("child"), mappings[2]]).allowed,
    false,
  );
  const cycle = fixture();
  cycle.sessions = [
    row("root", "ses_child", '{"type":"through","messageID":"msg_child"}'),
    row("child", "ses_root", '{"type":"through","messageID":"msg_one"}'),
  ];
  cycle.messages = [message(), message("msg_child", "ses_child")];
  assert.equal(
    evaluate(cycle, [
      mapping("root", { parentAppSessionId: "child" }),
      mapping("child", { parentAppSessionId: "root" }),
    ]).allowed,
    false,
  );
});

test("message projection merges authoritative row IDs and applies injected official decoder", () => {
  const f = fixture();
  f.messages = [
    message("msg_one", "ses_root", "user", {
      id: "msg_old_fork",
      type: "assistant",
      time: { created: 1 },
      text: "",
    }),
  ];
  let seen;
  assert.equal(
    evaluate(f, undefined, (value) => {
      seen = value;
      return value;
    }).allowed,
    true,
  );
  assert.equal(seen.id, "msg_one");
  assert.equal(seen.type, "user");
  assert.equal(
    evaluate(f, undefined, () => {
      throw new Error("raw private failure");
    }).reason,
    "native_startup_unverified",
  );
});

test("incomplete assistant/tool/retry/reasoning/shell/compaction histories stay held", () => {
  const complete = { time: { created: 1, completed: 2 }, content: [] };
  const cases = [
    ["assistant", { time: { created: 1 }, content: [] }],
    ["assistant", { ...complete, retry: {} }],
    [
      "assistant",
      {
        ...complete,
        content: [
          { type: "tool", state: { status: "running" }, time: { created: 1 } },
        ],
      },
    ],
    [
      "assistant",
      {
        ...complete,
        content: [
          {
            type: "tool",
            state: { status: "completed" },
            time: { created: 1 },
          },
        ],
      },
    ],
    [
      "assistant",
      { ...complete, content: [{ type: "reasoning", time: { created: 1 } }] },
    ],
    ["shell", { time: { created: 1 }, status: "running" }],
    ["compaction", { time: { created: 1 }, status: "running" }],
  ];
  for (const [type, data] of cases) {
    const f = fixture();
    f.messages = [message("msg_one", "ses_root", type, data)];
    assert.equal(evaluate(f).allowed, false, type);
  }
  for (const [type, data] of [
    ["assistant", complete],
    ["shell", { time: { created: 1, completed: 2 }, status: "killed" }],
    ["compaction", { time: { created: 1 }, status: "failed" }],
    ["idle", { time: { created: 1 }, outcome: "interrupted" }],
  ]) {
    const f = fixture();
    f.messages = [message("msg_one", "ses_root", type, data)];
    assert.equal(evaluate(f).allowed, true, type);
  }
});

test("orphan, duplicate, malformed, unknown and excessive messages fail closed", () => {
  for (const rows of [
    [message("msg_one", "ses_orphan")],
    [message(), message()],
    [["msg_one", "ses_root", "user", "null"]],
    [["msg_one", "ses_root", "user", "{"]],
    [message("msg_one", "ses_root", "unknown")],
    [["msg_one", "ses_root", "user", "x".repeat(1048577)]],
    Array.from({ length: 10001 }, () => message()),
  ]) {
    const f = fixture();
    f.messages = rows;
    assert.equal(evaluate(f).allowed, false);
  }
  const f = fixture();
  const payload = JSON.stringify({
    time: { created: 1 },
    text: "x".repeat(1048400),
  });
  f.messages = Array.from({ length: 65 }, (_, i) => [
    `msg_${i}`,
    "ses_root",
    "user",
    payload,
  ]);
  assert.equal(evaluate(f).allowed, false);
});

test("completed tools and terminal history return no transcript or filesystem data", () => {
  const f = fixture();
  f.sessions[0][6] = "subdirectory";
  f.messages = [
    message("msg_one", "ses_root", "assistant", {
      time: { created: 1, completed: 3 },
      content: [
        { type: "text", text: "private transcript /private/file" },
        {
          type: "tool",
          state: { status: "error" },
          time: { created: 1, completed: 2 },
        },
        { type: "reasoning", time: { created: 1, completed: 2 } },
      ],
    }),
  ];
  const result = evaluate(f);
  assert.equal(result.allowed, true);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(result.counts.messages, 1);
  f.messages[0][3] = JSON.stringify({
    time: { created: 3, completed: 1 },
    content: [],
  });
  assert.equal(evaluate(f).allowed, false);
});

test("failure and sentinel counts remain bounded with no correlation disclosure", () => {
  const f = fixture();
  f.sessions = Array.from({ length: 500 }, () => row());
  const result = evaluate(f);
  assert.equal(result.counts.sessions, 201);
  assert.deepEqual(result.correlations, []);
  const unknown = fixture();
  unknown.migrationIds = [...ids.slice(1), "unexpected_public_migration"];
  assert.equal(evaluate(unknown).allowed, false);
});
