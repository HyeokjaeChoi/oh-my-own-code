import assert from "node:assert/strict";
import test from "node:test";

const load = () => import("./permission-input-digest.mjs");
const prompt = () => ({ sessionID: "native-1", text: "hello" });
const file = (
  bytes = Buffer.from("x"),
  mime = "text/plain",
  name = "a.txt",
) => ({
  name,
  uri: `data:${mime};base64,${bytes.toString("base64")}`,
});

test("prompt input digest matches independently computed BOM/CRLF and explicit-presence vectors", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  const input = { sessionID: "native-1", text: "\uFEFFHello\r\n" };
  assert.equal(
    digest(input),
    "be49c3d75e9310ef66ce787195a9fa990e3d9c5156fde4c7b85e493582fb1cfc",
  );
  assert.equal(
    digest({ ...input, delivery: "steer" }),
    "d1fd981beba3e53ab2653f9e81bb7159c5902699b9ded129c70ba6621055e426",
  );
});

test("prompt input digest preserves file order and duplicate names in independent Unicode vectors", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  const files = [file(Buffer.alloc(0)), file()];
  const input = { sessionID: "native-1", text: "한글🙂\r\n", files };
  const before = globalThis.structuredClone(input);
  assert.equal(
    digest(input),
    "543d891862be773de30009807ced7c5a2bf7a0577fc8a70e50b364d1941c05d7",
  );
  assert.equal(
    digest({ ...input, files: [...files].reverse() }),
    "11fce30c1c122346168057477e66ede639b7d747213fbf9024c13d06b01db94c",
  );
  assert.deepEqual(input, before);
});

test("prompt input digest rejects caller-selected Native extras and malformed optional values", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  for (const extra of [
    { id: "chosen" },
    { resume: true },
    { model: "model" },
    { agent: "agent" },
  ])
    assert.throws(() => digest({ ...prompt(), ...extra }));
  for (const delivery of [null, undefined, "", "later", false])
    assert.throws(() => digest({ ...prompt(), delivery }));
  for (const files of [null, undefined, [], {}, [file(), null]])
    assert.throws(() => digest({ ...prompt(), files }));
});

test("exact prompt fields change identity without normalizing original text", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  const base = digest(prompt());
  assert.match(base, /^[a-f0-9]{64}$/);
  for (const change of [
    { sessionID: "native-2" },
    { text: "hello\r\n" },
    { delivery: "queue" },
    { files: [file()] },
  ])
    assert.notEqual(digest({ ...prompt(), ...change }), base);
  assert.notEqual(
    digest({ ...prompt(), text: "é" }),
    digest({ ...prompt(), text: "e\u0301" }),
  );
  const withFile = digest({ ...prompt(), files: [file()] });
  for (const changed of [
    file(Buffer.from("y")),
    file(undefined, "application/pdf"),
    file(undefined, undefined, "b.txt"),
  ])
    assert.notEqual(digest({ ...prompt(), files: [changed] }), withFile);
});

test("prompt text follows exact UTF16 limit and refuses malformed Unicode", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  for (const text of ["x".repeat(32000), "🙂".repeat(16000)])
    assert.match(digest({ ...prompt(), text }), /^[a-f0-9]{64}$/);
  for (const text of [
    "x".repeat(32001),
    "🙂".repeat(16000) + "x",
    "",
    " \t\r\n",
    "x\0y",
    "\ud800",
    "\udc00",
    1,
    new String("x"),
  ])
    assert.throws(() => digest({ ...prompt(), text }));
});

test("hostile objects are refused without executing caller code", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  let called = 0;
  const getter = () => {
    called++;
    throw new Error("caller code");
  };
  const proxied = (value) =>
    new Proxy(value, {
      get: getter,
      ownKeys: getter,
      getPrototypeOf: getter,
      getOwnPropertyDescriptor: getter,
    });
  const accessor = Object.defineProperty(prompt(), "text", {
    enumerable: true,
    get: getter,
  });
  const hidden = Object.defineProperty(prompt(), "hidden", { value: true });
  const symbol = { ...prompt(), [Symbol("extra")]: true };
  const custom = Object.assign(Object.create({ inherited: true }), prompt());
  const inherited = Object.create(prompt());
  const arrayAccessor = [file()];
  Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: getter });
  const fileAccessor = Object.defineProperty(file(), "uri", {
    enumerable: true,
    get: getter,
  });
  const hiddenArray = [file()];
  Object.defineProperty(hiddenArray, "extra", { value: true });
  const sparse = [file(), file(), file()];
  delete sparse[1];
  for (const input of [
    proxied(prompt()),
    accessor,
    hidden,
    symbol,
    custom,
    inherited,
    null,
    [],
    ...[
      proxied([file()]),
      [proxied(file())],
      arrayAccessor,
      [fileAccessor],
      hiddenArray,
      new Array(1),
      sparse,
    ].map((files) => ({ ...prompt(), files })),
  ])
    assert.throws(() => digest(input));
  assert.equal(called, 0);
});

test("file counts and single-component UTF8 names have closed boundaries", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  assert.match(
    digest({ ...prompt(), files: Array.from({ length: 8 }, () => file()) }),
    /^[a-f0-9]{64}$/,
  );
  assert.throws(() =>
    digest({ ...prompt(), files: Array.from({ length: 9 }, () => file()) }),
  );
  for (const name of ["a".repeat(255), "한".repeat(85)])
    assert.match(
      digest({ ...prompt(), files: [file(undefined, undefined, name)] }),
      /^[a-f0-9]{64}$/,
    );
  for (const name of [
    "a".repeat(256),
    "한".repeat(86),
    "a/b",
    "a\\b",
    ".",
    "..",
    "CON",
    "NUL.txt",
    "a\0b",
    "",
  ])
    assert.throws(() =>
      digest({ ...prompt(), files: [file(undefined, undefined, name)] }),
    );
});

test("only exact canonical data URIs are accepted", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  for (const mime of [
    "text/plain",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ])
    assert.match(
      digest({ ...prompt(), files: [file(Buffer.alloc(0), mime)] }),
      /^[a-f0-9]{64}$/,
    );
  for (const uri of [
    "https://example.com/a",
    "file:///a",
    "data:text/plain;base64",
    "data:TEXT/PLAIN;base64,eA==",
    "data:text/plain;charset=utf-8;base64,eA==",
    "data:text/html;base64,eA==",
    "data:text/plain;base64,Zh==",
    "data:text/plain;base64,AAB=",
    "data:text/plain;base64,A",
    "data:text/plain;base64,====",
    "data:text/plain;base64,eA==\n",
    "data:text/plain;base64,e A==",
    "data:text/plain;base64,eA",
    "data:text/plain;base64,eA===",
    "data:text/plain;base64,_w==",
  ])
    assert.throws(() =>
      digest({ ...prompt(), files: [{ name: "a.txt", uri }] }),
    );
});

test("decoded per-file and aggregate byte limits hold above the control metadata budget", async () => {
  const { permissionPromptInputDigest: digest } = await load();
  assert.match(
    digest({ ...prompt(), files: [file(Buffer.alloc(65536))] }),
    /^[a-f0-9]{64}$/,
  );
  assert.throws(() =>
    digest({ ...prompt(), files: [file(Buffer.alloc(65537))] }),
  );
  const media = file(Buffer.alloc(8388608), "image/png");
  assert.match(
    digest({ ...prompt(), files: [media, media] }),
    /^[a-f0-9]{64}$/,
  );
  assert.throws(() =>
    digest({ ...prompt(), files: [file(Buffer.alloc(8388609), "image/png")] }),
  );
  assert.throws(() => digest({ ...prompt(), files: [media, media, file()] }));
});
