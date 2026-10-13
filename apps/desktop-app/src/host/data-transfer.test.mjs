import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DATA_LIMITS,
  WIPE_WORD,
  buildExport,
  parseImport,
  redactText,
  retentionCandidates,
  validateDataRequest,
} from "../renderer/shared/data-transfer/index.mjs";
import { bindDataIpc } from "./data-ipc.mjs";
import { createDataHost, wipeAppDataSync } from "./data-host.mjs";

const HOME = "/Users/alice";
const FAKE_KEYS = [
  "sk-" + "a".repeat(32),
  "sk-ant-api03-" + "Z9".repeat(20),
  "ghp_" + "A1".repeat(15),
  "AKIA" + "ABCDEFGHIJKLMNOP",
  "xoxb-" + "1234567890-abcdef",
  "sk_" + "live_" + "Ab1".repeat(8),
  "rk_" + "test_" + "Ab1".repeat(8),
  "glpat-" + "x1".repeat(12),
  "npm_" + "Ab1".repeat(10),
  "ya29." + "Ab1_".repeat(8),
  "eyJ" + "hbGciOiJI" + ".eyJzdWIiOiIx" + ".abcdefghijkl",
];
const messages = [
  { id: "m1", role: "user", text: `my key ${FAKE_KEYS[0]} in ${HOME}/proj` },
  {
    id: "m2",
    role: "assistant",
    text: "done",
    tools: [
      {
        id: "t1",
        name: "bash",
        status: "completed",
        input: "cat .env",
        output: "OPENAI_API_KEY=abc123\nPORT=3000",
      },
      {
        id: "t2",
        name: "read",
        status: "completed",
        input: `${HOME}/a.txt`,
        output: `Authorization: Bearer ${"t".repeat(20)}\nhello ${HOME}/a.txt`,
      },
    ],
  },
];
const build = (extra = {}) =>
  buildExport({
    session: { id: "s1", title: `t ${HOME}` },
    messages,
    now: "2026-01-01T00:00:00.000Z",
    home: HOME,
    ...extra,
  });

test("redaction strips key patterns and the home path", () => {
  for (const key of FAKE_KEYS) {
    const { text } = redactText(`x ${key} y`);
    assert.ok(!text.includes(key), key);
  }
  assert.equal(
    redactText("export API_TOKEN=hunter2", {}).text,
    "export API_TOKEN=[REDACTED]",
  );
  assert.equal(
    redactText('{"password": "p@ss"}').text,
    '{"password": [REDACTED]}',
  );
  assert.equal(redactText(`${HOME}/x ${HOME}`, { home: HOME }).text, "~/x ~");
  assert.equal(
    redactText("/Users/alicia/x", { home: HOME }).text,
    "/Users/alicia/x",
  );
  assert.ok(
    !redactText(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    ).text.includes("abc"),
  );
});

test("redaction drops URL credentials and runs before clipping", () => {
  assert.equal(
    redactText("git clone https://bob:hunter2@example.com/r.git").text,
    "git clone https://[REDACTED]@example.com/r.git",
  );
  const key = "sk-" + "a".repeat(40);
  const { doc } = build({
    messages: [
      {
        id: "m1",
        role: "user",
        text: `${"x".repeat(DATA_LIMITS.text - 11)} ${key}`,
      },
    ],
  });
  assert.ok(!doc.sessions[0].messages[0].text.includes("sk-"));
});

test("export clip never cuts a [REDACTED] marker mid-token", () => {
  const key = "sk-" + "a".repeat(40);
  const n = DATA_LIMITS.text;
  for (let pad = 0; pad < 12; pad += 3) {
    const { doc } = build({
      messages: [
        {
          id: "m1",
          role: "user",
          text: `${"a ".repeat((n - 12 + pad) / 2)} ${key} tail`,
        },
      ],
    });
    const t = doc.sessions[0].messages[0].text;
    assert.ok(t.length <= n);
    assert.ok(
      !/\[R(E(D(A(C(T(E(D)?)?)?)?)?)?)?$/.test(t.replace(/\[REDACTED\]$/, "")),
    );
  }
});

test("export pre-clip never leaks a secret fragment at the tail", () => {
  const n = DATA_LIMITS.text;
  const many = Array.from({ length: 20 }, () => "sk-" + "b".repeat(300)).join(
    " ",
  );
  const jwt = `eyJ${"h".repeat(60)}.eyJ${"p".repeat(300)}.${"s".repeat(60)}`;
  const secrets = [
    ["QQQQ", `{"client_secret": "QQQQ${"x".repeat(1200)}`],
    ["PPPP", `password="PPPP long pass phrase ${"y ".repeat(600)}`],
    ["eyJhhhh", jwt],
  ];
  for (const [needle, secret] of secrets) {
    for (const off of [0, 5, 100, 400, 700]) {
      const lead = n + 4096 - off - 10;
      const text = `${many}\n${"a ".repeat((lead - many.length - 1) / 2)}${secret} tail`;
      const { doc } = build({ messages: [{ id: "m1", role: "user", text }] });
      const t = doc.sessions[0].messages[0].text;
      assert.ok(
        !t.includes(needle) && !/sk-bbb|eyJ/.test(t),
        `leak ${needle} at off ${off}: ${t.slice(-30)}`,
      );
    }
  }
});

test("long single-line values keep content and leak no secret at any cut offset", () => {
  const n = DATA_LIMITS.text;
  const plain = build({
    messages: [{ id: "m1", role: "user", text: "word ".repeat(40000) }],
  }).doc.sessions[0].messages[0].text;
  assert.ok(plain.length > n - 10 && plain !== "[TRUNCATED]");
  const jwt = `eyJ${"h".repeat(60)}.eyJ${"p".repeat(300)}.${"s".repeat(60)}`;
  const secrets = [
    ["QQQQ", `password="QQQQ ${"y ".repeat(600)}`],
    ["QQQQ", `token='QQQQ${"x".repeat(1200)}`],
    ["eyJhhhh", jwt],
  ];
  for (const [needle, secret] of secrets)
    for (const off of [0, 5, 100, 400, 700, 2000]) {
      const lead = n + 4096 - off - 10;
      const text = `${"a ".repeat(lead / 2)}${secret}`;
      const t = build({ messages: [{ id: "m1", role: "user", text }] }).doc
        .sessions[0].messages[0].text;
      assert.ok(t.length > 1000 && t !== "[TRUNCATED]");
      assert.ok(!t.includes(needle) && !t.includes("eyJ"), `leak at ${off}`);
    }
});

test("unterminated quoted secrets are redacted in raw text", () => {
  const { text } = redactText("password=\"abc123\nnext line ok\napi_key='zzz9");
  assert.ok(!/abc123|zzz9/.test(text) && text.includes("next line ok"));
});

test("escaped-quote and quoted-header secrets are redacted without a leak", () => {
  const { text } = redactText(
    `password="ab\\"cd1234" ok\nAuthorization: "Bearer zz9988 yy7766\nx-api-key: 'qq5544`,
  );
  assert.ok(!/cd1234|zz9988|yy7766|qq5544/.test(text) && text.includes("ok"));
});

test("a huge unterminated quoted value exports as a redacted marker", () => {
  const big = `password="${"x".repeat(1.5 * 1024 * 1024)}`;
  const t = build({ messages: [{ id: "m1", role: "user", text: big }] }).doc
    .sessions[0].messages[0].text;
  assert.equal(t, "password=[REDACTED]");
});

test("redaction is idempotent", () => {
  const once = redactText(
    `${FAKE_KEYS.join(" ")} TOKEN=zzz Authorization: Bearer abcdefghij ${HOME}`,
    { home: HOME },
  ).text;
  assert.equal(redactText(once, { home: HOME }).text, once);
});

test("tool outputs are excluded by default and .env output is dropped", () => {
  const off = build();
  assert.ok(
    off.doc.sessions[0].messages[1].tools.every((t) => !("output" in t)),
  );
  assert.equal(off.summary.toolOutputsIncluded, false);
  const on = build({ includeToolOutputs: true });
  const [env, read] = on.doc.sessions[0].messages[1].tools;
  assert.ok(!env.output.includes("abc123"));
  assert.equal(on.summary.redactions.envOutputs, 1);
  assert.ok(!read.output.includes("t".repeat(20)));
  assert.ok(read.output.includes("~/a.txt"));
  const json = JSON.stringify(on.doc);
  assert.ok(!json.includes(HOME) && !json.includes(FAKE_KEYS[0]));
  assert.ok(on.summary.redactions.secrets >= 2);
});

test("export schema round-trips through import validation", () => {
  const { doc } = build({ includeToolOutputs: true });
  assert.equal(doc.format, "omoc-session-export");
  assert.equal(doc.version, 1);
  const parsed = parseImport(JSON.stringify(doc));
  assert.deepEqual(parsed.doc, doc);
});

test("import rejects wrong format, version, size and malformed input", () => {
  const { doc } = build();
  const bad = (v) => parseImport(JSON.stringify(v)).error;
  assert.equal(parseImport("{nope").error, "MALFORMED");
  assert.equal(bad({ ...doc, format: "other" }), "WRONG_FORMAT");
  assert.equal(bad([]), "WRONG_FORMAT");
  assert.equal(bad({ ...doc, version: 2 }), "UNSUPPORTED_VERSION");
  assert.equal(bad({ ...doc, sessions: [] }), "MALFORMED");
  assert.equal(bad({ ...doc, exportedAt: "never" }), "MALFORMED");
  assert.equal(
    bad({
      ...doc,
      sessions: [
        {
          ...doc.sessions[0],
          messages: [{ id: "x", role: "system", text: "" }],
        },
      ],
    }),
    "MALFORMED",
  );
  assert.equal(
    parseImport("x".repeat(DATA_LIMITS.fileBytes + 1)).error,
    "TOO_LARGE",
  );
});

test("import re-redacts and drops unknown fields", () => {
  const { doc } = build();
  doc.sessions[0].messages[0].text = `leak ${FAKE_KEYS[0]}`;
  doc.sessions[0].messages[0].extra = "x";
  const out = parseImport(JSON.stringify(doc)).doc;
  assert.ok(!out.sessions[0].messages[0].text.includes(FAKE_KEYS[0]));
  assert.ok(!("extra" in out.sessions[0].messages[0]));
});

test("retention selection is pure and date based", () => {
  const now = "2026-06-01T00:00:00.000Z";
  const rows = [
    { id: "old", at: "2026-01-01T00:00:00.000Z" },
    { id: "new", at: "2026-05-20T00:00:00.000Z" },
    { id: "bad", at: "nope" },
  ];
  assert.deepEqual(
    retentionCandidates(rows, 30, now).map((r) => r.id),
    ["old"],
  );
  assert.deepEqual(retentionCandidates(rows, 365, now), []);
  assert.deepEqual(retentionCandidates(rows, 0, now), []);
  assert.deepEqual(retentionCandidates(rows, 7, now), []);
});

test("request validation is closed", () => {
  assert.ok(validateDataRequest({ type: "archives.list" }));
  assert.equal(validateDataRequest({ type: "archives.list", x: 1 }), undefined);
  assert.equal(
    validateDataRequest({ type: "retention.set", days: 7 }),
    undefined,
  );
  assert.equal(
    validateDataRequest({ type: "archives.get", id: "../x" }),
    undefined,
  );
  assert.equal(validateDataRequest({ type: "nope" }), undefined);
});

test("data host stores archives atomically and sweeps by age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omoc-data-"));
  let clock = "2026-01-01T00:00:00.000Z";
  const host = createDataHost({
    metadataDir: () => dir,
    now: () => clock,
    home: HOME,
  });
  const info = await host.importText(JSON.stringify(build().doc));
  assert.equal((await host.list()).length, 1);
  await assert.rejects(host.importText("{}"), { dataCode: "WRONG_FORMAT" });
  clock = "2026-06-01T00:00:00.000Z";
  assert.equal((await host.retentionPreview(30)).due[0].id, info.id);
  assert.equal((await host.retentionSet(30)).removed, 1);
  assert.equal((await host.list()).length, 0);
  assert.equal((await host.retention()).days, 30);
});

test("data host get reads one archive and validates the id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omoc-data-"));
  const host = createDataHost({ metadataDir: () => dir, home: HOME });
  const info = await host.importText(JSON.stringify(build().doc));
  assert.equal((await host.get(info.id)).id, info.id);
  await assert.rejects(host.get("../x"), { dataCode: "INVALID_REQUEST" });
  await assert.rejects(host.get("a".repeat(8)), { dataCode: "NOT_FOUND" });
});

test("wipe IPC refuses when this process does not own storage", async () => {
  let handler;
  let wiped = 0;
  const dialogs = {
    confirmWipe: async () => true,
    wipe: () => wiped++,
  };
  const bind = (owned) =>
    bindDataIpc({
      ipcMain: { handle: (_c, h) => (handler = h) },
      admit: () => true,
      host: {},
      dialogs,
      appDataRoot: () => "/x",
      owned: () => owned,
    });
  const req = { type: "wipe.run", word: WIPE_WORD };
  bind(false);
  assert.deepEqual(await handler({}, req), { ok: false, code: "NOT_OWNER" });
  assert.equal(wiped, 0);
  bind(true);
  assert.deepEqual(await handler({}, req), {
    ok: true,
    value: { started: true },
  });
  assert.equal(wiped, 1);
});

test("app-data wipe stays inside the directory", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "omoc-wipe-")));
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  const root = join(base, "a", "b", "storage");
  mkdirSync(join(root, "metadata"), { recursive: true });
  writeFileSync(join(root, "metadata", "plans.json"), "{}");
  symlinkSync(outside, join(root, "link"));
  assert.deepEqual(wipeAppDataSync(root), { ok: true });
  assert.ok(!existsSync(root));
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
});

test("app-data wipe refuses symlink roots, relative and shallow paths", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "omoc-wipe-")));
  const target = join(base, "x", "y", "real");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "f"), "1");
  const link = join(base, "link");
  symlinkSync(target, link);
  assert.equal(wipeAppDataSync(link).ok, false);
  assert.equal(wipeAppDataSync("relative/dir").ok, false);
  assert.equal(wipeAppDataSync("/").ok, false);
  assert.equal(wipeAppDataSync(join(base, "missing")).ok, false);
  assert.ok(existsSync(join(target, "f")));
});
