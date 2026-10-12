import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { planNativePermissionOverlay } from "./native-permission-overlay.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const root = "node_modules/@opencode/server/";
const limit = 32 * 1024 * 1024;

function fixture(source = "before", replacement = "after") {
  return {
    recipe: {
      schemaVersion: 1,
      id: "synthetic-overlay",
      serverVersion: "2.0.18",
      files: [
        {
          path: root + "process.js",
          beforeSha256: digest(source),
          afterSha256: digest(replacement),
          edits: [{ find: source, replace: replacement }],
        },
      ],
    },
    files: [{ path: root + "process.js", content: Buffer.from(source) }],
  };
}

const plan = ({ recipe, files }) => planNativePermissionOverlay(recipe, files);
const rejects = (change) => {
  const input = fixture();
  change(input);
  assert.throws(() => plan(input), TypeError);
};

test("exact synchronous API returns deterministic frozen records and detached bytes", () => {
  const input = fixture();
  const original = Buffer.from(input.files[0].content);
  const first = plan(input);
  const second = plan(input);
  assert.equal(first instanceof Promise, false);
  assert.deepEqual(Object.keys(first).sort(), [
    "files",
    "recipeSha256",
    "schemaVersion",
  ]);
  assert.deepEqual(Object.keys(first.files[0]).sort(), [
    "afterSha256",
    "beforeSha256",
    "content",
    "path",
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.files[0].content.toString(), "after");
  assert.equal(first.files[0].beforeSha256, digest(original));
  assert.equal(first.files[0].afterSha256, digest("after"));
  for (const value of [first, first.files, first.files[0]])
    assert.ok(Object.isFrozen(value));
  assert.ok(Buffer.isBuffer(first.files[0].content));
  assert.notStrictEqual(first.files[0].content, input.files[0].content);
  assert.notStrictEqual(first.files[0].content, second.files[0].content);
  assert.notStrictEqual(
    first.files[0].content.buffer,
    input.files[0].content.buffer,
  );
  assert.notStrictEqual(
    first.files[0].content.buffer,
    second.files[0].content.buffer,
  );
  first.files[0].content.fill(0);
  assert.equal(second.files[0].content.toString(), "after");
  assert.deepEqual(input.files[0].content, original);
  input.files[0].content.fill(1);
  input.recipe.files[0].edits[0].replace = "mutated";
  input.recipe.files[0].path = "mutated";
  assert.equal(second.files[0].path, root + "process.js");
  assert.equal(second.files[0].content.toString(), "after");
});

test("literal replacement tokens never expand; BOM, CRLF and Unicode bytes survive", () => {
  const source = "\ufeff시작\r\nANCHOR\r\n끝";
  const replace = "$& $$ $` $' $1 $<name>";
  const input = fixture(source, "\ufeff시작\r\n" + replace + "\r\n끝");
  input.recipe.files[0].edits = [{ find: "ANCHOR", replace }];
  assert.equal(
    plan(input).files[0].content.toString(),
    "\ufeff시작\r\n" + replace + "\r\n끝",
  );
});

test("edits run in recipe order against each successive result", () => {
  const input = fixture("abc", "final");
  input.recipe.files[0].edits = [
    { find: "abc", replace: "middle" },
    { find: "middle", replace: "final" },
  ];
  assert.equal(plan(input).files[0].content.toString(), "final");
  input.recipe.files[0].edits.reverse();
  assert.throws(() => plan(input));
});

test("canonical recipe digest sorts every object key and keeps array order", () => {
  const input = fixture();
  const canonical =
    '{"files":[{"afterSha256":' +
    JSON.stringify(digest("after")) +
    ',"beforeSha256":' +
    JSON.stringify(digest("before")) +
    ',"edits":[{"find":"before","replace":"after"}],"path":"node_modules/@opencode/server/process.js"}],"id":"synthetic-overlay","schemaVersion":1,"serverVersion":"2.0.18"}';
  assert.equal(plan(input).recipeSha256, digest(canonical));
  const file = input.recipe.files[0];
  input.recipe = {
    files: [
      {
        edits: [{ replace: "after", find: "before" }],
        afterSha256: file.afterSha256,
        path: file.path,
        beforeSha256: file.beforeSha256,
      },
    ],
    serverVersion: "2.0.18",
    id: "synthetic-overlay",
    schemaVersion: 1,
  };
  assert.equal(plan(input).recipeSha256, digest(canonical));
});

test("exact path set ignores supplied file order but preserves recipe order", () => {
  const input = fixture();
  input.recipe.files.push({
    ...input.recipe.files[0],
    path: root + "process.d.ts",
  });
  input.files.unshift({
    path: root + "process.d.ts",
    content: Buffer.from("before"),
  });
  assert.deepEqual(
    plan(input).files.map((file) => file.path),
    input.recipe.files.map((file) => file.path),
  );
  const orderedDigest = plan(input).recipeSha256;
  input.files.reverse();
  assert.equal(plan(input).recipeSha256, orderedDigest);
  const result = plan(input);
  assert.notStrictEqual(
    result.files[0].content.buffer,
    result.files[1].content.buffer,
  );
  input.recipe.files.reverse();
  assert.notEqual(plan(input).recipeSha256, orderedDigest);
  rejects(({ files }) => files.pop());
  rejects(({ files }) => files.push({ ...files[0], path: root + "extra.js" }));
  rejects(({ files }) => files.push(files[0]));
  rejects(({ recipe }) => recipe.files.push(recipe.files[0]));
  rejects(({ files }) => {
    files[0].path = root + "other.js";
  });
});

test("hash drift, missing/ambiguous/overlapping anchors and final output drift fail closed", () => {
  rejects(({ files }) => {
    files[0].content[0] = 0x61;
  });
  rejects(({ recipe }) => {
    recipe.files[0].beforeSha256 = "0".repeat(64);
  });
  rejects(({ recipe }) => {
    recipe.files[0].afterSha256 = "0".repeat(64);
  });
  rejects(({ recipe }) => {
    recipe.files[0].edits[0].find = "absent";
  });
  for (const source of ["before before", "aaa"]) {
    const input = fixture(source);
    input.recipe.files[0].edits[0].find = source === "aaa" ? "aa" : "before";
    assert.throws(() => plan(input));
  }
  const input = fixture();
  input.recipe.files.push({
    ...input.recipe.files[0],
    path: root + "last.js",
    afterSha256: "0".repeat(64),
  });
  input.files.push({ path: root + "last.js", content: Buffer.from("before") });
  const before = input.files.map((file) => Buffer.from(file.content));
  assert.throws(() => plan(input));
  assert.deepEqual(
    input.files.map((file) => file.content),
    before,
  );
});

test("paths must be relative normalized contained node_modules/@opencode file paths", () => {
  for (const path of [
    "",
    "/" + root + "a.js",
    "../" + root + "a.js",
    "node_modules/@opencode-other/a.js",
    "node_modules/@opencode/a.js",
    root,
    root + "../a.js",
    root + "./a.js",
    root + "/a.js",
    root + "a.js/",
    root + "a\\b.js",
    root + "a\0.js",
    "C:/" + root + "a.js",
  ]) {
    rejects(({ recipe, files }) => {
      recipe.files[0].path = path;
      files[0].path = path;
    });
  }
});

test("closed records reject missing/unknown/undefined fields, bad versions and digest forms", () => {
  const locations = [
    (x) => x.recipe,
    (x) => x.recipe.files[0],
    (x) => x.recipe.files[0].edits[0],
    (x) => x.files[0],
  ];
  for (const locate of locations) {
    rejects((x) => {
      locate(x).extra = true;
    });
    rejects((x) => {
      delete locate(x)[Object.keys(locate(x))[0]];
    });
    rejects((x) => {
      locate(x)[Object.keys(locate(x))[0]] = undefined;
    });
  }
  for (const value of [null, 0, "1", 2, NaN, -0])
    rejects(({ recipe }) => {
      recipe.schemaVersion = value;
    });
  rejects(({ recipe }) => {
    recipe.serverVersion = "2.0.19";
  });
  for (const value of ["", null, 10, "bad\0id", "\ud800"])
    rejects(({ recipe }) => {
      recipe.id = value;
    });
  for (const key of ["beforeSha256", "afterSha256"])
    for (const value of [
      "A".repeat(64),
      "f".repeat(63),
      "g".repeat(64),
      0,
      "f".repeat(64) + "\n",
    ])
      rejects(({ recipe }) => {
        recipe.files[0][key] = value;
      });
  for (const key of ["find", "replace"])
    for (const value of [null, 1, undefined, "\ud800", "\udc00", "a\0b"])
      rejects(({ recipe }) => {
        recipe.files[0].edits[0][key] = value;
      });
  rejects(({ recipe }) => {
    recipe.files[0].edits[0].find = "";
  });
});

test("all record/array layers reject accessors, symbols, custom prototypes and hidden extras without calling getters", () => {
  const locations = [
    (x) => x.recipe,
    (x) => x.recipe.files,
    (x) => x.recipe.files[0],
    (x) => x.recipe.files[0].edits,
    (x) => x.recipe.files[0].edits[0],
    (x) => x.files,
    (x) => x.files[0],
  ];
  for (const locate of locations) {
    let calls = 0;
    rejects((x) => {
      const object = locate(x);
      Object.defineProperty(object, Object.keys(object)[0], {
        get() {
          calls++;
          throw Error("getter invoked");
        },
        enumerable: true,
      });
    });
    assert.equal(calls, 0);
    rejects((x) => {
      locate(x)[Symbol("extra")] = 1;
    });
    rejects((x) => {
      Object.setPrototypeOf(locate(x), {});
    });
    rejects((x) => {
      Object.defineProperty(locate(x), "hidden", { value: 1 });
    });
  }
  rejects((x) => {
    x.recipe = new Proxy(x.recipe, {
      get() {
        throw Error("proxy accessed");
      },
    });
  });
  rejects((x) => {
    x.files[0].content = new Proxy(x.files[0].content, {});
  });
});

test("dense arrays reject holes, undefined, extras and nonarrays", () => {
  for (const key of ["files", "edits"])
    for (const value of [null, {}, [undefined], new Array(1)])
      rejects(({ recipe }) => {
        (key === "files" ? recipe : recipe.files[0])[key] = value;
      });
  for (const value of [null, {}, [undefined], new Array(1)])
    rejects((x) => {
      x.files = value;
    });
  for (const locate of [
    (x) => x.recipe.files,
    (x) => x.recipe.files[0].edits,
    (x) => x.files,
  ])
    rejects((x) => {
      locate(x).extra = 1;
    });
});

test("malformed roots, null prototypes and hidden required fields fail closed", () => {
  for (const value of [undefined, null, true, 1, "recipe", [], () => {}]) {
    rejects((input) => {
      input.recipe = value;
    });
  }
  for (const locate of [
    (input) => input.recipe,
    (input) => input.recipe.files[0],
    (input) => input.recipe.files[0].edits[0],
    (input) => input.files[0],
  ]) {
    rejects((input) => {
      Object.setPrototypeOf(locate(input), null);
    });
    rejects((input) => {
      const value = locate(input);
      Object.defineProperty(value, Object.keys(value)[0], {
        enumerable: false,
      });
    });
  }
});

test("accessor attempts cannot mutate source bytes during validation", () => {
  const input = fixture();
  const original = Buffer.from(input.files[0].content);
  let calls = 0;
  Object.defineProperty(input.recipe.files[0].edits[0], "replace", {
    enumerable: true,
    get() {
      calls++;
      input.files[0].content.fill(0);
      return "after";
    },
  });
  assert.throws(() => plan(input), TypeError);
  assert.equal(calls, 0);
  assert.deepEqual(input.files[0].content, original);
});

test("opaque Buffer metadata, getters, methods and iterator never execute or project", () => {
  const bufferInput = fixture();
  const source = bufferInput.files[0].content;
  const originalBytes = Uint8Array.prototype.slice.call(source);
  const expected = plan(fixture());
  let calls = 0;
  for (const key of [
    "toString",
    "toJSON",
    "valueOf",
    "length",
    "byteLength",
    "byteOffset",
    "buffer",
    "extra",
    Symbol.iterator,
    Symbol.toPrimitive,
    Symbol.toStringTag,
  ]) {
    Object.defineProperty(source, key, {
      enumerable: true,
      get() {
        calls++;
        throw Error("must not execute original Buffer metadata");
      },
    });
  }
  Object.defineProperty(source, "hidden", {
    get() {
      calls++;
      throw Error("hidden getter");
    },
  });
  const actual = plan(bufferInput);
  assert.equal(calls, 0);
  assert.deepEqual(actual, expected);
  assert.deepEqual(Uint8Array.prototype.slice.call(source), originalBytes);
  assert.notStrictEqual(actual.files[0].content.buffer, originalBytes.buffer);
  assert.equal(Object.hasOwn(actual.files[0].content, "extra"), false);
  assert.equal(Object.hasOwn(actual.files[0].content, "hidden"), false);
  assert.deepEqual(Object.getOwnPropertySymbols(actual.files[0].content), []);
});

test("source requires ordinary nonshared Buffer with exact valid UTF-8 text bytes", () => {
  for (const content of [
    "before",
    new Uint8Array([1]),
    null,
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from([0xff]),
    Buffer.from("a\0b"),
  ]) {
    rejects(({ recipe, files }) => {
      files[0].content = content;
      if (Buffer.isBuffer(content))
        recipe.files[0].beforeSha256 = digest(content);
    });
  }
  rejects(({ files }) => {
    files[0].content = Buffer.from(new SharedArrayBuffer(6));
  });
  rejects(({ files }) => {
    Object.setPrototypeOf(files[0].content, Uint8Array.prototype);
  });
  const input = fixture("\ufffd", "ok");
  assert.equal(
    plan(input).files[0].content.toString(),
    "ok",
    "An actual encoded replacement character is valid UTF-8",
  );
});

test("empty replacement and no-op edits preserve exact bytes", () => {
  assert.equal(plan(fixture("before", "")).files[0].content.length, 0);
  const input = fixture("same", "same");
  assert.equal(plan(input).files[0].content.toString(), "same");
  input.recipe.files[0].edits = [];
  assert.throws(() => plan(input), /edit required/);
});

test("64 files and 512 total edits accepted; excess counts rejected", () => {
  const input = fixture("abcdefgh", "ABCDEFGH");
  const edits = [..."abcdefgh"].map((find) => ({
    find,
    replace: find.toUpperCase(),
  }));
  input.recipe.files = Array.from({ length: 64 }, (_, i) => ({
    ...input.recipe.files[0],
    path: root + i + ".js",
    edits,
  }));
  input.files = input.recipe.files.map(({ path }) => ({
    path,
    content: Buffer.from("abcdefgh"),
  }));
  assert.equal(plan(input).files.length, 64);
  input.recipe.files[0].edits = [...edits, { find: "A", replace: "A" }];
  assert.throws(() => plan(input));
  input.recipe.files[0].edits = edits;
  input.recipe.files.push({ ...input.recipe.files[0], path: root + "65.js" });
  input.files.push({ path: root + "65.js", content: Buffer.from("abcdefgh") });
  assert.throws(() => plan(input));
  rejects((input) => {
    input.files = Array.from({ length: 65 }, () => input.files[0]);
  });
  rejects(({ recipe }) => {
    recipe.files[0].edits = Array.from({ length: 513 }, () => ({
      find: "before",
      replace: "after",
    }));
  });
});

test("fixed 35-file smoke remains accepted", () => {
  const input = fixture("before", "after");
  input.recipe.files = Array.from({ length: 35 }, (_, i) => ({
    ...input.recipe.files[0],
    path: root + i + ".js",
  }));
  input.files = input.recipe.files.map(({ path }) => ({
    path,
    content: Buffer.from("before"),
  }));
  assert.equal(plan(input).files.length, 35);
});

test("512 recipe files are accepted; 513 recipe or source files refuse before planning", () => {
  const input = fixture("before", "after");
  input.recipe.files = Array.from({ length: 512 }, (_, i) => ({
    ...input.recipe.files[0],
    path: root + i + ".js",
  }));
  input.files = input.recipe.files.map(({ path }) => ({
    path,
    content: Buffer.from("before"),
  }));
  assert.equal(plan(input).files.length, 512);
  const extra = { ...input.recipe.files[0], path: root + "extra.js" };
  input.recipe.files.push(extra);
  input.files.push({ path: extra.path, content: Buffer.from("before") });
  assert.throws(() => plan(input), /count limit/);
  input.recipe.files.pop();
  assert.throws(() => plan(input), /count limit/);
});

test("32MiB combined input/output boundary and expansion bounds fail closed", () => {
  const source = "x".repeat(limit / 64 - 1) + "z";
  const input = fixture(source, source);
  input.recipe.files = Array.from({ length: 32 }, (_, i) => ({
    ...input.recipe.files[0],
    path: root + i + ".js",
    edits: [{ find: "z", replace: "z" }],
  }));
  input.files = input.recipe.files.map(({ path }) => ({
    path,
    content: Buffer.from(source),
  }));
  assert.equal(
    plan(input).files.reduce((n, file) => n + file.content.length, 0),
    limit / 2,
  );
  input.recipe.files[31].edits = [{ find: source, replace: source + "x" }];
  input.recipe.files[31].afterSha256 = digest(source + "x");
  assert.throws(() => plan(input));
  rejects(({ files }) => {
    files[0].content = Buffer.alloc(limit + 1);
  });
  const expanding = fixture("x", "x".repeat(limit));
  assert.throws(() => plan(expanding));
  const actualExpansion = fixture("x", "x".repeat(limit / 2));
  actualExpansion.recipe.files[0].edits[0].find = "x";
  actualExpansion.files[0].content = Buffer.from("x" + "y".repeat(limit / 2));
  actualExpansion.recipe.files[0].beforeSha256 = digest(
    actualExpansion.files[0].content,
  );
  assert.throws(() => plan(actualExpansion), /output byte limit/);
  rejects(({ recipe }) => {
    recipe.files[0].edits[0].replace = "한".repeat(Math.floor(limit / 3) + 1);
  });
  const transient = fixture("x", "x");
  transient.recipe.files[0].edits = [
    { find: "x", replace: "y".repeat(limit) },
    { find: "y".repeat(limit), replace: "x" },
  ];
  assert.throws(() => plan(transient));
});

test("ordinary input larger than 16MiB shrinks within the combined 32MiB bound", () => {
  const input = fixture("x".repeat(17 * 1024 * 1024), "짧음\r\n");
  const originalHash = input.recipe.files[0].beforeSha256;
  const result = plan(input);
  assert.equal(result.files[0].content.toString(), "짧음\r\n");
  assert.equal(result.files[0].afterSha256, digest("짧음\r\n"));
  assert.equal(digest(input.files[0].content), originalHash);
  assert.notStrictEqual(
    result.files[0].content.buffer,
    input.files[0].content.buffer,
  );
});
