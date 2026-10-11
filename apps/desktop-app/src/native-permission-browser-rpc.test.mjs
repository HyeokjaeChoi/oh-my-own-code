import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
const require = createRequire(import.meta.url);
const parse = createRequire(require.resolve("eslint"))("espree").parse;
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
function handlers(source) {
  const nodes = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    range: true,
  });
  let found;
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "CallExpression" && n.callee?.property?.name === "register")
      found = n.arguments[1];
    for (const v of Object.values(n))
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
  }
  walk(nodes);
  assert.ok(found);
  return found.properties.map((p) => ({
    key: p.key.name ?? p.key.value,
    value: source.slice(...p.value.range),
    body: source.slice(...p.value.body.range),
  }));
}
const names = [
  "attach",
  "state",
  "command",
  "result",
  "tunnel.open",
  "tunnel.read",
  "tunnel.write",
  "tunnel.close",
];
for (const method of names)
  test(`Browser RPC ${method}: typed refusal before original effect construction and scripted IO`, async () => {
    const path = "node_modules/@opencode/plugin-browser/dist/connection.js";
    const before = await readFile(new URL(path, root), "utf8");
    let after = before;
    const entry = recipe.files.find((f) => f.path === path);
    if (entry) {
      assert.equal(hash(before), entry.beforeSha256);
      for (const e of entry.edits) {
        assert.equal(after.split(e.find).length - 1, 1);
        after = after.replace(e.find, () => e.replace);
      }
      assert.equal(hash(after), entry.afterSha256);
      let restored = after;
      for (const e of [...entry.edits].reverse()) {
        assert.equal(restored.split(e.replace).length - 1, 1);
        restored = restored.replace(e.replace, () => e.find);
      }
      assert.equal(restored, before);
    }
    const old = handlers(before),
      rows = handlers(after);
    assert.deepEqual(
      rows.map((r) => r.key),
      names,
    );
    const row = rows.find((r) => r.key === method),
      original = old.find((r) => r.key === method);
    const { Effect } = await import(
      "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
    );
    const counters = {
      construction: 0,
      session: 0,
      tunnel: 0,
      network: 0,
      file: 0,
      event: 0,
      state: 0,
    };
    const trap = (key) =>
      new Proxy(() => {}, {
        get() {
          counters[key]++;
          throw Error(key);
        },
        apply() {
          counters[key]++;
          throw Error(key);
        },
      });
    const measured = new Proxy(Effect, {
      get(target, key) {
        if (key === "gen")
          return (...args) => {
            counters.construction++;
            return target.gen(...args);
          };
        return target[key];
      },
    });
    const handler = new Function(
      "Effect",
      "ctx",
      "tunnels",
      "browsers",
      "Deferred",
      "BrowserTunnel",
      "Tool",
      "active",
      "close",
      "rpc",
      `return (${row.value});`,
    )(
      measured,
      trap("session"),
      trap("tunnel"),
      trap("state"),
      trap("event"),
      trap("network"),
      trap("file"),
      true,
      trap("state"),
      trap("event"),
    );
    for (const input of [
      {},
      null,
      new Proxy(
        {},
        {
          get() {
            throw Error("input read before refusal");
          },
        },
      ),
    ]) {
      let errors = 0;
      const failure = Object.freeze({
        code: "unavailable",
        message: "native_permission_browser_unverified",
        data: {},
      });
      const call = {
        error(...args) {
          errors++;
          assert.deepEqual(args, [
            "unavailable",
            "native_permission_browser_unverified",
            {},
          ]);
          return failure;
        },
      };
      const program = handler(input, call);
      assert.deepEqual(counters, {
        construction: 0,
        session: 0,
        tunnel: 0,
        network: 0,
        file: 0,
        event: 0,
        state: 0,
      });
      assert.equal(errors, 0, "typed error must be suspended");
      const result = await Effect.runPromise(
        program.pipe(
          Effect.match({
            onFailure: (e) => e,
            onSuccess: () => "unexpected-success",
          }),
        ),
      );
      assert.equal(result, failure);
      assert.equal(errors, 1);
      assert.deepEqual(counters, {
        construction: 0,
        session: 0,
        tunnel: 0,
        network: 0,
        file: 0,
        event: 0,
        state: 0,
      });
    }
    assert.ok(
      row.body.includes(original.body),
      "original method body must remain byte exact in an uninvoked closure",
    );
    assert.equal(await readFile(new URL(path, root), "utf8"), before);
  });
test("Browser RPC schema keys and Scope/event cleanup remain original source bytes", async () => {
  const path = "node_modules/@opencode/plugin-browser/dist/connection.js",
    before = await readFile(new URL(path, root), "utf8");
  const entry = recipe.files.find((f) => f.path === path);
  assert.ok(entry, "missing pre-effect fence");
  let after = before;
  for (const e of entry.edits) after = after.replace(e.find, () => e.replace);
  const old = handlers(before),
    rows = handlers(after);
  // Replacing each guarded property value with the original must restore all registration/lifecycle bytes.
  let restored = after;
  for (let i = 0; i < rows.length; i++) {
    assert.equal(restored.split(rows[i].value).length - 1, 1);
    restored = restored.replace(rows[i].value, () => old[i].value);
  }
  assert.equal(restored, before);
  const rpc = await readFile(
    new URL("node_modules/@opencode/plugin-browser/dist/rpc.js", root),
    "utf8",
  );
  const receipt = JSON.parse(
    await readFile(new URL("../receipt.json", root), "utf8"),
  );
  assert.equal(
    hash(rpc),
    receipt.installEntries.find(
      (e) => e.path === "node_modules/@opencode/plugin-browser/dist/rpc.js",
    )?.sha256,
  );
  assert.equal(
    recipe.files.some((f) => f.path.endsWith("plugin-browser/dist/rpc.js")),
    false,
  );
  assert.match(rpc, /const errors = \{ unavailable: Schema.Struct\(\{\}\) \};/);
  const methodBlock = rpc.slice(
    rpc.indexOf("    methods: {"),
    rpc.indexOf("    events:", rpc.indexOf("    methods: {")),
  );
  const schemaKeys = [
    ...methodBlock.matchAll(/^ {8}(?:"([^"]+)"|(\w+)): /gm),
  ].map((m) => m[1] ?? m[2]);
  assert.deepEqual(schemaKeys, names);
});
