// Node unit boundary only: real Effect and exact pinned inert Schema errors.
// Resource/auxiliary/classifiers are test-scripted, NOT genuine kernel acceptance.
// No Native import, service installation, Task/lease grant or physical settlement proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataModule = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const install = new URL(
  "../runtime-event-host/.generated/install/node_modules/",
  import.meta.url,
);
const effectURL = new URL("effect/dist/index.js", install).href;
const { Effect, Exit, Fiber, Cause } = await import(effectURL);
const effectPackage = JSON.parse(
  await readFile(new URL("effect/package.json", install), "utf8"),
);
assert.equal(effectPackage.version, "4.0.0-rc.112");
const errorSource = await readFile(
  new URL("@opencode/core/dist/chunks/config-2a5m3afh.js", install),
  "utf8",
);
assert.equal(
  createHash("sha256").update(errorSource).digest("hex"),
  "fd544f0132b2ce6354556cefcf1eb6cd08ffc8aef152d334538ef87ba5498f97",
);
const start = errorSource.indexOf("var FileType2 =");
const end = errorSource.indexOf("var typeFollowing2 =");
assert.ok(start >= 0 && end > start);
const errorsURL = dataModule(
  `import { Schema } from ${JSON.stringify(effectURL)};\n` +
    errorSource.slice(start, end) +
    "\nexport { Failed2 as Failed, NotFound2 as NotFound, WrongKind2 as WrongKind };",
);
const { Failed, NotFound, WrongKind } = await import(errorsURL);

// Private WeakMaps model the producer classifier contract only. They do not
// attest actual descriptor observations or original claimed-resource identity.
const fixtureURL = dataModule(`
const resources = new WeakMap(), kinds = new WeakMap(), failures = new WeakMap();
export const nativeDescriptorPathKind = error => kinds.get(error);
export const nativeDescriptorFailureKind = error => failures.get(error);
export function classify(error, kind, failure) {
  if (kind) kinds.set(error, kind);
  if (failure) failures.set(error, failure);
  return error;
}
export function assertNativeDescriptorReadCurrent(resource) {
  const state = resources.get(resource);
  if (!state) throw new Error('test_scripted_unknown_resource');
  state.checks++;
  state.current(state.checks);
}
export function createNativeReadAuxiliary(resource, root) {
  const state = resources.get(resource);
  if (!state || root !== state.root) throw new Error('test_scripted_aux_rejected');
  return state.aux;
}
export function scriptedFixture(root) {
  const resource = Object.freeze({});
  const state = { root, checks: 0, calls: [], current() {}, body() {} };
  const method = name => (...args) => {
    state.calls.push([name, ...args]);
    return state.body(name, ...args);
  };
  state.aux = {
    files: { read: method('files.read'), list: method('files.list') },
    fs: {
      resolve: method('fs.resolve'), readDirectory: method('fs.readDirectory'),
      up: method('fs.up'), readFileStringSafe: method('fs.readFileStringSafe')
    }
  };
  resources.set(resource, state);
  return { resource, state };
}
`);
const { classify, scriptedFixture } = await import(fixtureURL);
const source = await readFile(
  new URL("./native-permission-read-effect.mjs", import.meta.url),
  "utf8",
);
// Copy production verbatim except dependency import specifiers. Keep the real
// control-input helpers and node:util proxy guard; never stub capture semantics.
const replacements = new Map([
  ["effect", effectURL],
  ["@opencode/core/environment/files", errorsURL],
  [
    "./native-permission-control-input.mjs",
    new URL("./native-permission-control-input.mjs", import.meta.url).href,
  ],
  ["./host/native-read-auxiliary.mjs", fixtureURL],
  ["./host/native-descriptor-read-resource.mjs", fixtureURL],
  ["./host/native-descriptor-read.mjs", fixtureURL],
]);
let copied = source;
for (const [from, to] of replacements) {
  const needle = `from "${from}"`;
  assert.equal(
    copied.split(needle).length,
    2,
    `one dependency import: ${from}`,
  );
  copied = copied.replace(needle, `from ${JSON.stringify(to)}`);
}
const { createNativeReadEffects } = await import(dataModule(copied));
const root = "/test-scripted/root";
const path = root + "/AGENTS.md";
function fixture() {
  const f = scriptedFixture(root);
  return { ...f, api: createNativeReadEffects(f.resource, root) };
}
async function failed(effect, Class = Failed, at = path) {
  const exit = await Effect.runPromiseExit(effect);
  assert.ok(Exit.isFailure(exit));
  const error = Exit.findErrorOption(exit);
  assert.equal(error._tag, "Some");
  assert.ok(error.value instanceof Class);
  assert.equal(error.value.path, at);
  return error.value;
}

test("frozen adapter returns exact results/calls; captures input before run without IO", async () => {
  const { api, state } = fixture();
  assert.ok(
    Object.isFrozen(api) &&
      Object.isFrozen(api.files) &&
      Object.isFrozen(api.fs),
  );
  const page = { offset: 2, length: 3 };
  const input = { targets: ["AGENTS.md"], start: root, stop: root };
  const read = api.files.read(path, page);
  const up = api.fs.up(input);
  page.offset = 99;
  input.targets[0] = "changed";
  input.start = "/changed";
  assert.deepEqual(state.calls, []);
  assert.equal(state.checks, 0);
  const rows = Object.freeze([{ name: "AGENTS.md", type: "file" }]);
  const result = { bytes: Buffer.from("abc"), info: { size: 3 } };
  const cases = [
    [read, "files.read", [path, { offset: 2, length: 3 }], result],
    [api.files.list(root), "files.list", [root], rows],
    [api.fs.resolve(path), "fs.resolve", [path], path],
    [api.fs.readDirectory(root), "fs.readDirectory", [root], ["AGENTS.md"]],
    [
      up,
      "fs.up",
      [{ targets: ["AGENTS.md"], start: root, stop: root }],
      [path],
    ],
    [
      api.fs.readFileStringSafe(path),
      "fs.readFileStringSafe",
      [path],
      "instructions",
    ],
  ];
  for (const [effect, name, args, value] of cases) {
    assert.ok(Effect.isEffect(effect));
    state.body = () => value;
    assert.equal(await Effect.runPromise(effect), value);
    assert.deepEqual(state.calls.at(-1), [name, ...args]);
  }
  assert.equal(state.calls.length, 6);
});

test("caller error fields and actual extracted WrongKind/NotFound remain Failed", async () => {
  const f = fixture();
  for (const cause of [
    Object.assign(new Error("native_permission_path_kind"), {
      _tag: "Environment.WrongKind",
      actual: "directory",
      code: "ENOENT",
      kind: "missing",
    }),
    { _tag: "Environment.NotFound", path, code: 2 },
    new WrongKind({ path, actual: "directory" }),
    new NotFound({ path }),
  ]) {
    f.state.body = () => {
      throw cause;
    };
    const error = await failed(f.api.files.read(path));
    assert.equal(error.cause, cause);
    assert.equal(error._tag, "Environment.Failed");
  }
});

test("only test-scripted private producer identity converts kind/missing", async () => {
  const f = fixture();
  const kind = classify(new Error("opaque"), "directory");
  const missing = classify(new Error("opaque"), undefined, "missing");
  f.state.body = () => {
    throw kind;
  };
  assert.equal(
    (await failed(f.api.files.read(path), WrongKind)).actual,
    "directory",
  );
  f.state.body = () => {
    throw missing;
  };
  await failed(f.api.files.read(path), NotFound);
  // Identical public fields cannot copy private classification.
  const clone = Object.assign(new Error(kind.message), kind);
  f.state.body = () => {
    throw clone;
  };
  assert.equal((await failed(f.api.files.read(path))).cause, clone);
});

test("authority failure before IO is always Failed, including classified errors", async () => {
  for (const cause of [
    classify(new Error("revoked"), "directory"),
    classify(new Error("revoked"), undefined, "missing"),
  ]) {
    const f = fixture();
    f.state.current = () => {
      throw cause;
    };
    assert.equal((await failed(f.api.files.read(path))).cause, cause);
    assert.deepEqual(f.state.calls, []);
  }
});

test("both post-await authority checks fail closed and erase returned bytes", async () => {
  for (const check of [2, 3]) {
    const f = fixture();
    const bytes = Buffer.from("secret");
    const cause = classify(new Error("revoked"), "directory");
    f.state.body = () => ({ bytes, info: { size: bytes.length } });
    f.state.current = (n) => {
      if (n === check) throw cause;
    };
    await failed(f.api.files.read(path));
    assert.deepEqual(bytes, Buffer.alloc(6));
    assert.equal(f.state.calls.length, 1);
    assert.equal(f.state.checks, check);
  }
});

test("actual Effect interruption discards late result and erases bytes; no physical settlement claim", async () => {
  const f = fixture();
  const started = Promise.withResolvers();
  const pending = Promise.withResolvers();
  const bytes = Buffer.from("secret");
  let delivered = false;
  f.state.body = () => {
    started.resolve();
    return pending.promise;
  };
  const fiber = Effect.runFork(
    f.api.files.read(path).pipe(
      Effect.map((value) => {
        delivered = true;
        return value;
      }),
    ),
  );
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  const exit = fiber.pollUnsafe();
  assert.ok(Exit.isFailure(exit));
  assert.ok(Cause.hasInterrupts(exit.cause));
  assert.equal(delivered, false);
  assert.deepEqual(bytes, Buffer.from("secret"));
  pending.resolve({ bytes, info: { size: 6 } });
  // Drain the original pending Promise's continuation, without a timing sleep.
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(bytes, Buffer.alloc(6));
  assert.equal(delivered, false);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.checks, 1);
});
