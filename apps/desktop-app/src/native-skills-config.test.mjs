import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import { EVENT_HOST_CONFIG } from "./event-host-protocol.mjs";

const install = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const consumerPath =
  "node_modules/@opencode/core/dist/chunks/config-s4enseaf.js";
const consumerSha =
  "164d7b54c26bec17fc4291f61569c602598b63f66c90052650ac80be2d079cdf";
const receipt = JSON.parse(
  await readFile(new URL("../receipt.json", install), "utf8"),
);
const bytes = await readFile(new URL(consumerPath, install));
assert.equal(createHash("sha256").update(bytes).digest("hex"), consumerSha);
assert.deepEqual(
  receipt.installEntries
    .filter((row) => row.path === consumerPath)
    .map((row) => row.sha256),
  [consumerSha],
);
const source = ts.createSourceFile(
  consumerPath,
  bytes.toString("utf8"),
  ts.ScriptTarget.Latest,
  true,
);
assert.equal(source.parseDiagnostics.length, 0);
const declarations = source.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations]);
const matches = declarations.filter(
  (declaration) => declaration.name.getText(source) === "substitute2",
);
assert.equal(matches.length, 1);
const expression = matches[0].initializer.getText(source);
// Evaluate the exact pinned original generator body, not a replacement string
// algorithm. Effect.fn declaration, process.env and file continuation are
// explicit standins. This proves pure source behavior, not Effect scheduling,
// Native acquisition or an actual external file read.
const makeConsumer = new Function(
  "Effect",
  "process",
  "substituteFiles",
  `return (${expression});`,
);
function decodeThroughOriginal(text) {
  const consumer = makeConsumer(
    { fn: () => (generator) => generator },
    { env: { OMOC_LITERAL: "SYNTHETIC_REPLACEMENT" } },
    () => {
      throw new Error("synthetic_file_factory_reached");
    },
  );
  const result = consumer({
    type: "virtual",
    dir: "/scripted/workspace",
    text,
  }).next();
  assert.equal(result.done, true);
  return JSON.parse(result.value);
}
async function fixture(t, name) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-config-literal-test-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, name, "opencode/event-host/darwin-arm64");
  const plugin = join(root, "builtins/workbench-skills");
  await mkdir(plugin, { recursive: true, mode: 0o700 });
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "@oh-my-own-code/workbench-skills",
      private: true,
      type: "module",
      version: "1.0.0",
    }),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(plugin, "server.mjs"), "// inert synthetic fixture\n", {
    flag: "wx",
    mode: 0o600,
  });
  const nonce = "c".repeat(64);
  return {
    root,
    plugin,
    nonce,
    expected: {
      ...JSON.parse(EVENT_HOST_CONFIG),
      plugins: [{ package: plugin, options: { nonce } }],
    },
  };
}

test("literal config env token cannot replace the checked resource path", async (t) => {
  const f = await fixture(t, "{env:OMOC_LITERAL}");
  const text = nativeSkillsConfig(f.root, f.nonce);
  assert.deepEqual(JSON.parse(text), f.expected);
  assert.deepEqual(decodeThroughOriginal(text), f.expected);
});

test("literal config file token cannot construct the original file continuation", async (t) => {
  const f = await fixture(t, "{file:synthetic.txt}");
  const text = nativeSkillsConfig(f.root, f.nonce);
  assert.deepEqual(JSON.parse(text), f.expected);
  assert.deepEqual(decodeThroughOriginal(text), f.expected);
});

test("literal config keeps mixed tokens, Unicode, quotes and backslashes byte-exact after decode", async (t) => {
  const f = await fixture(
    t,
    '한글-"quote"-\\backslash-{env:OMOC_LITERAL}-{file:synthetic.txt}-{env:OMOC_LITERAL}',
  );
  const text = nativeSkillsConfig(f.root, f.nonce);
  assert.deepEqual(JSON.parse(text), f.expected);
  assert.deepEqual(decodeThroughOriginal(text), f.expected);
  assert.equal(decodeThroughOriginal(text).plugins[0].package, f.plugin);
});

test("ordinary config serialization and closed deny policy remain unchanged", async (t) => {
  const f = await fixture(t, "ordinary-{ENV:literal}-{files:literal}");
  const text = nativeSkillsConfig(f.root, f.nonce);
  assert.equal(text, JSON.stringify(f.expected));
  assert.deepEqual(decodeThroughOriginal(text), f.expected);
  assert.deepEqual(JSON.parse(EVENT_HOST_CONFIG).plugins, []);
  assert.deepEqual(decodeThroughOriginal(text).permissions, [
    { action: "*", resource: "*", effect: "deny" },
  ]);
  assert.throws(
    () => nativeSkillsConfig(f.root, "invalid"),
    /native_skill_resources_unverified/,
  );
  await writeFile(
    join(f.plugin, "package.json"),
    JSON.stringify({ name: "changed" }),
  );
  assert.throws(
    () => nativeSkillsConfig(f.root, f.nonce),
    /native_skill_resources_unverified/,
  );
});

// Original ConfigVariable with real pinned Effect and the real third-party
// JSONC parser. No original application module is imported. Schema/normalize,
// service acquisition and complete Config startup remain outside this proof.
import { createRequire } from "node:module";
const runtimePackages = ["effect", "fast-check", "pure-rand", "jsonc-parser"];
const runtimeRows = receipt.installEntries.filter(
  (row) =>
    runtimePackages.some((name) =>
      row.path.startsWith(`node_modules/${name}/`),
    ) &&
    (row.path.endsWith(".js") || row.path.endsWith("/package.json")),
);
assert.ok(runtimeRows.length > 480);
assert.equal(
  new Set(runtimeRows.map((row) => row.path)).size,
  runtimeRows.length,
);
for (const [name, version] of [
  ["effect", "4.0.0-rc.112"],
  ["jsonc-parser", "3.3.1"],
]) {
  const packagePath = `node_modules/${name}/package.json`;
  assert.ok(runtimeRows.some((row) => row.path === packagePath));
  const metadata = JSON.parse(await readFile(new URL(packagePath, install)));
  assert.equal(metadata.version, version);
}

await Promise.all(
  runtimeRows.map(async (row) => {
    const content = await readFile(new URL(row.path, install));
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      row.sha256,
      row.path,
    );
    if (!row.path.endsWith(".js")) return;
    const ast = ts.createSourceFile(
      row.path,
      content.toString(),
      ts.ScriptTarget.Latest,
      true,
    );
    assert.equal(ast.parseDiagnostics.length, 0);
    if (!row.path.startsWith("node_modules/jsonc-parser/lib/umd/")) return;
    function checkRequires(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        assert.equal(node.arguments.length, 1);
        assert.ok(ts.isStringLiteral(node.arguments[0]));
        const name = node.arguments[0].text;
        assert.ok(name.startsWith("./"));
        const target = new URL(`${name}.js`, new URL(row.path, install));
        assert.ok(
          target.href.startsWith(
            new URL("node_modules/jsonc-parser/lib/umd/", install).href,
          ),
        );
        assert.ok(
          runtimeRows.some(
            (entry) => new URL(entry.path, install).href === target.href,
          ),
        );
      }
      ts.forEachChild(node, checkRequires);
    }
    checkRequires(ast);
  }),
);
const { Effect: RealEffect, Context: RealContext } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const requirePinned = createRequire(new URL("package.json", install));
const { parse: parseJsonc } = requirePinned("jsonc-parser");
const fileExpressions = declarations.filter(
  (declaration) => declaration.name.getText(source) === "substituteFiles",
);
assert.equal(fileExpressions.length, 1);
const fileExpression = fileExpressions[0].initializer.getText(source);
class CheckedFS extends RealContext.Service()("test/ConfigData/FS") {}
function realConsumer() {
  const substituteFiles = new Function(
    "Effect",
    "FSUtil",
    "path",
    "os",
    "InvalidError2",
    `return (${fileExpression});`,
  )(
    RealEffect,
    { Service: CheckedFS },
    {
      dirname: () => "/scripted",
      isAbsolute: () => false,
      resolve: join,
      join,
    },
    { homedir: () => "/scripted/home" },
    class extends Error {},
  );
  return makeConsumer(
    RealEffect,
    { env: { OMOC_LITERAL: "SYNTHETIC_REPLACEMENT" } },
    substituteFiles,
  );
}
async function parseWithRealConsumer(text, calls) {
  const replaced = await RealEffect.runPromise(
    realConsumer()({
      type: "virtual",
      dir: "/scripted/workspace",
      source: "OPENCODE_CONFIG_CONTENT",
      text,
    }).pipe(
      RealEffect.provideService(CheckedFS, {
        readFileString: (path) => {
          calls.push(["file.read.factory", path]);
          return RealEffect.fail(new Error("external_file_refused"));
        },
      }),
    ),
  );
  const errors = [];
  const parsed = parseJsonc(replaced, errors, { allowTrailingComma: true });
  return { parsed, errors };
}

test("real pinned ConfigVariable and JSONC preserve fixed config without IO", async (t) => {
  const f = await fixture(t, "real-{env:OMOC_LITERAL}-{file:synthetic.txt}");
  const calls = [];
  const result = await parseWithRealConsumer(
    nativeSkillsConfig(f.root, f.nonce),
    calls,
  );
  assert.deepEqual(result, { parsed: f.expected, errors: [] });
  assert.deepEqual(calls, []);
});

test("real original ConfigVariable unshielded file branch reaches refused FS canary", async () => {
  const calls = [];
  await assert.rejects(
    parseWithRealConsumer('{"path":"{file:synthetic.txt}"}', calls),
  );
  assert.deepEqual(calls, [
    ["file.read.factory", "/scripted/workspace/synthetic.txt"],
  ]);
});

test("real pinned JSONC parser accepts native flags and reports malformed input", async () => {
  const calls = [];
  const valid = await parseWithRealConsumer('{/*comment*/"value":1,}', calls);
  assert.deepEqual(valid, { parsed: { value: 1 }, errors: [] });
  const invalid = await parseWithRealConsumer('{"value":', calls);
  assert.ok(invalid.errors.length > 0);
  assert.deepEqual(calls, []);
});
