// Exact pure pinned Native consumer under Node and scripted files. No Native
// module/service/IO execution; this documents the real adapter call contract.
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
  rm,
} from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createWorkspaceRootAuthority } from "./host/workspace-root-authority.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const install = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const { Effect, Context, Schema } = await import(
  new URL("node_modules/effect/dist/index.js", install)
);
const pins = {
  "core/dist/chunks/config-119mbqs2.js":
    "80ddf77b814ec271b0a169c58eb80999867a110dfe7a554838b594ecdfbe0c84",
  "core/dist/chunks/config-b2s03exd.js":
    "4745bfc5e0fe77529523cbddc418c329850fdd9fbb2b8a2166e6f13f6b1a6cbc",
  "core/dist/chunks/config-3smtnn6g.js":
    "d880907bdb6ea46517762b83cb70d876f0d3c3e698d2e13afa977328e0132975",
  "schema/dist/schema.js":
    "f5ca3a5da2eda8726ddfd3003203589eb20487158976beddf3f65ba602acf6c6",
};
const sources = {};
for (const [name, sha256] of Object.entries(pins)) {
  const bytes = await readFile(
    new URL("node_modules/@opencode/" + name, install),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
  sources[name] = bytes.toString("utf8");
}
const branded = await import(
  new URL("node_modules/@opencode/schema/dist/schema.js", install)
);
const mime = sources["core/dist/chunks/config-3smtnn6g.js"];
const detect = new Function(
  mime.slice(
    mime.indexOf("function detect2(bytes)"),
    mime.indexOf("export {"),
  ) + "\nreturn detect2;",
)();
const contentSource = sources["core/dist/chunks/config-b2s03exd.js"];
const content = new Function(
  "Schema",
  contentSource.slice(
    contentSource.indexOf("var Content3 ="),
    contentSource.indexOf("var ListInput5 ="),
  ) + "\nreturn Content3;",
)(Schema);
const original = sources["core/dist/chunks/config-119mbqs2.js"];
const deps = {
  Context,
  Effect,
  Schema,
  path,
  pathToFileURL,
  NonNegativeInt2: branded.NonNegativeInt,
  PositiveInt2: branded.PositiveInt,
  RelativePath2: branded.RelativePath,
  Content3: content,
  detect2: detect,
  // Only presentation MIME lookup is scripted, not content detection or IO.
  lookup: () => "text/plain",
};
const read = new Function(
  ...Object.keys(deps),
  original.slice(
    original.indexOf("var MAX_READ_LINES2 ="),
    original.indexOf("var layer ="),
  ) + "\nreturn read2;",
)(...Object.values(deps));

function files(bytes, options = {}) {
  const calls = [];
  const adapter = {
    read(absolute, range) {
      return Effect.suspend(() => {
        calls.push({ method: "read", absolute, range });
        if (options.failAt === calls.length)
          return Effect.fail(new Error("synthetic second read denied"));
        if (options.directory)
          return Effect.fail({
            _tag: "Environment.WrongKind",
            actual: "directory",
          });
        const start = range?.offset ?? 0;
        const end =
          range?.length === undefined ? bytes.length : start + range.length;
        return Effect.succeed({
          bytes: bytes.subarray(start, end),
          info: { size: options.size ?? bytes.length },
        });
      });
    },
    list(absolute) {
      calls.push({ method: "list", absolute });
      return Effect.succeed(options.entries ?? []);
    },
  };
  return { adapter, calls };
}
const target = "/owned-synthetic/path.txt";

test("actual Native small text consumer uses one bounded range and preserves CRLF", async () => {
  const fixture = files(Buffer.from("\uFEFFone\r\ntwo\r\n"));
  const result = await Effect.runPromise(
    read(fixture.adapter, target, "path.txt"),
  );
  assert.equal(result.content, "one\r\ntwo\r\n");
  assert.equal(result.encoding, "utf8");
  assert.deepEqual(fixture.calls, [
    { method: "read", absolute: target, range: { offset: 0, length: 262144 } },
  ]);
});

test("actual Native media consumer rereads whole content after its first range", async () => {
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(300000),
  ]);
  const fixture = files(bytes);
  const result = await Effect.runPromise(
    read(fixture.adapter, target, "image.png"),
  );
  assert.equal(result.mime, "image/png");
  assert.deepEqual(Buffer.from(result.content, "base64"), bytes);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].range, undefined);
});

test("actual Native oversized media refuses before a whole-content read", async () => {
  const fixture = files(Buffer.from("%PDF-synthetic"), {
    size: 20 * 1024 * 1024 + 1,
  });
  const error = await Effect.runPromise(
    Effect.flip(read(fixture.adapter, target, "large.pdf")),
  );
  assert.equal(error._tag, "ReadTool.MediaIngestLimitError");
  assert.equal(fixture.calls.length, 1);
});

test("actual Native later text page performs subsequent contiguous byte ranges", async () => {
  const bytes = Buffer.from("line\r\n".repeat(100000));
  const fixture = files(bytes);
  const result = await Effect.runPromise(
    read(fixture.adapter, target, "path.txt", { offset: 90000, limit: 2 }),
  );
  assert.equal(result.type, "text-page");
  assert.equal(result.content, "line\nline");
  assert.equal(result.offset, 90000);
  assert.deepEqual(
    fixture.calls.map((row) => row.range.offset),
    [0, 262144, 524288],
  );
});

test("actual Native second read failure cannot disclose first-page output", async () => {
  const fixture = files(Buffer.from("line\n".repeat(100000)), { failAt: 2 });
  const error = await Effect.runPromise(
    Effect.flip(
      read(fixture.adapter, target, "path.txt", { offset: 90000, limit: 2 }),
    ),
  );
  assert.equal(error.message, "synthetic second read denied");
  assert.equal(fixture.calls.length, 2);
});

test("actual Native directory fallback lists once and omits unsupported kinds", async () => {
  const fixture = files(Buffer.alloc(0), {
    directory: true,
    entries: [
      { name: "z.txt", type: "file" },
      { name: "nested", type: "directory" },
      { name: "alias", type: "symlink" },
      { name: "pipe", type: "other" },
    ],
  });
  const result = await Effect.runPromise(
    read(fixture.adapter, target, "directory"),
  );
  assert.equal(result.type, "list-page");
  assert.deepEqual(
    result.entries.map((row) => row.path),
    ["nested/", "alias", "z.txt"],
  );
  assert.deepEqual(
    fixture.calls.map((row) => row.method),
    ["read", "list"],
  );
});

// Node integration: execute the actual resource/files module and pinned read2.
// Only the physical kernel import changes in a temporary module copy. Its other
// imports resolve through symlinks to the actual root guard and validators.
// The scripted known-byte kernel below is not Darwin confinement evidence.
const resourceURL = new URL(
  "./host/native-descriptor-read-resource.mjs",
  import.meta.url,
);
const rootGuardURL = new URL(
  "./host/workspace-root-authority.mjs",
  import.meta.url,
);
const kernelScript = `
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { assertWorkspaceRootGuard } from ${JSON.stringify(rootGuardURL.href)};
export const state = { expected: new Map(), calls: [], outputs: [], afterRead: undefined };
export async function createNativeDescriptorReadKernel(workspace, options) {
  const rootStat = fs.statSync(workspace.path, { bigint: true });
  const identities = new WeakMap();
  let closed = false;
  function check() {
    assert.equal(closed, false);
    options.check();
    assertWorkspaceRootGuard(options.checkRoot, {
      workspaceId: workspace.id, workspacePath: workspace.path,
      dev: String(rootStat.dev), ino: String(rootStat.ino),
    });
  }
  check();
  return Object.freeze({
    read(relative, page) {
      check();
      state.calls.push({ relative, ...page });
      const absolute = join(workspace.path, relative);
      const stat = fs.statSync(absolute, { bigint: true });
      const all = fs.readFileSync(absolute);
      if (page.identity !== undefined) {
        const original = identities.get(page.identity);
        assert.ok(original, "scripted unknown identity");
        assert.equal(original.absolute, absolute);
        // Retain the full actual stat. Ignore only access time during comparison:
        // this Node fixture's own reads can update it without changing the file.
        const stableStat = (value) => Object.fromEntries(
          Object.entries(value).filter(([key]) => !key.startsWith("atime")),
        );
        assert.deepEqual(stableStat(stat), stableStat(original.stat), "scripted original full stat changed");
        assert.deepEqual(all, original.bytes, "scripted original bytes changed");
      }
      assert.deepEqual(all, state.expected.get(relative), "scripted unexpected fixture bytes");
      const identity = page.identity ?? Object.freeze(Object.create(null));
      if (page.identity === undefined) identities.set(identity, { absolute, stat, bytes: all });
      const bytes = Buffer.from(all.subarray(page.offset, page.offset + page.length));
      state.outputs.push(bytes);
      state.afterRead?.(state.calls.length);
      return { bytes, info: { size: Number(stat.size) }, identity };
    },
    list() { throw new Error("scripted list is outside these file fixtures"); },
    close() { closed = true; },
  });
}
`;

async function integrated(t, bytes, name = "note.txt") {
  const temporary = await fs.promises.realpath(
    await mkdtemp(path.join(tmpdir(), "native-consumer-node-")),
  );
  let authority, reader, completion;
  t.after(async () => {
    try {
      if (reader) {
        await reader.close();
        assert.deepEqual(await completion, { complete: true });
      }
    } finally {
      try {
        await authority?.close();
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  });
  const root = path.join(temporary, "workspace");
  const host = path.join(temporary, "host");
  await mkdir(root);
  await mkdir(host);
  const absolute = path.join(root, name);
  await writeFile(absolute, bytes);
  const source = await readFile(resourceURL, "utf8");
  const kernelImport = 'from "./native-descriptor-read.mjs"';
  assert.equal(source.split(kernelImport).length, 2);
  await symlink(
    fileURLToPath(rootGuardURL),
    path.join(host, "workspace-root-authority.mjs"),
  );
  await symlink(
    fileURLToPath(new URL("./renderer/", import.meta.url)),
    path.join(temporary, "renderer"),
  );
  await writeFile(path.join(host, "scripted-kernel.mjs"), kernelScript);
  await writeFile(
    path.join(host, "resource.mjs"),
    source.replace(kernelImport, 'from "./scripted-kernel.mjs"'),
  );
  const api = await import(pathToFileURL(path.join(host, "resource.mjs")));
  const { state } = await import(
    pathToFileURL(path.join(host, "scripted-kernel.mjs"))
  );
  state.expected.set(name, Buffer.from(bytes));
  const workspace = { id: "node-consumer-fixture", path: root };
  authority = await createWorkspaceRootAuthority(workspace);
  reader = api.createNativeDescriptorRead(workspace, {
    checkRoot: authority.assertOpened,
    check: () => {},
  });
  // Real private resource claim, synchronously before the factory microtask.
  completion = api.observeNativeDescriptorRead(reader.resource);
  const view = api.createNativeDescriptorFiles(reader.resource);
  assert.throws(() => api.createNativeDescriptorFiles(reader.resource));
  const calls = [];
  let afterRead;
  const adapter = {
    read(absolute, page) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "read", absolute, page });
          const result = await view.read(absolute, page);
          assert.deepEqual(Object.keys(result).sort(), ["bytes", "info"]);
          await afterRead?.(calls.length);
          return result;
        },
        catch: (error) => error,
      });
    },
    list(absolute) {
      return Effect.tryPromise({
        try: () => {
          calls.push({ method: "list", absolute });
          return view.list(absolute);
        },
        catch: (error) => error,
      });
    },
  };
  return {
    api,
    reader,
    completion,
    view,
    calls,
    state,
    absolute,
    root,
    adapter,
    afterRead(hook) {
      afterRead = hook;
    },
    consume(options) {
      return Effect.runPromise(read(adapter, absolute, name, options));
    },
  };
}

const pngBytes = () =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(300000, 0x61),
  ]);

test("Node integration: actual files view delivers Native small text with one bounded read", async (t) => {
  const f = await integrated(t, Buffer.from("\uFEFFone\r\ntwo\r\n"));
  const result = await f.consume();
  assert.equal(result.content, "one\r\ntwo\r\n");
  assert.equal(result.encoding, "utf8");
  assert.deepEqual(f.calls, [
    {
      method: "read",
      absolute: f.absolute,
      page: { offset: 0, length: 262144 },
    },
  ]);
  assert.deepEqual(f.state.calls, [
    { relative: "note.txt", offset: 0, length: 262144 },
  ]);
});

test("Node integration: three Native text ranges retain the same private original identity", async (t) => {
  const f = await integrated(t, Buffer.from("line\r\n".repeat(100000)));
  const result = await f.consume({ offset: 90000, limit: 2 });
  assert.equal(result.type, "text-page");
  assert.equal(result.content, "line\nline");
  assert.equal(result.offset, 90000);
  assert.deepEqual(
    f.calls.map((call) => call.page),
    [
      { offset: 0, length: 262144 },
      { offset: 262144, length: 262144 },
      { offset: 524288, length: 262144 },
    ],
  );
  const [first, second, third] = f.state.calls;
  assert.equal(Object.hasOwn(first, "identity"), false);
  assert.ok(second.identity);
  assert.equal(third.identity, second.identity);
  assert.ok(f.state.calls.every((call) => call.relative === "note.txt"));
});

test("Node integration: unchanged Native media whole reread returns exact original bytes", async (t) => {
  const bytes = pngBytes();
  const f = await integrated(t, bytes, "image.png");
  const result = await f.consume();
  assert.equal(result.mime, "image/png");
  assert.deepEqual(Buffer.from(result.content, "base64"), bytes);
  assert.deepEqual(
    f.calls.map((call) => call.page),
    [{ offset: 0, length: 262144 }, undefined],
  );
  assert.equal(f.state.calls.length, 2);
  assert.equal(Object.hasOwn(f.state.calls[0], "identity"), false);
  assert.ok(f.state.calls[1].identity);
  assert.equal(f.state.calls[1].length, 20 * 1024 * 1024);
});

for (const mutation of ["in-place", "replacement"]) {
  test(`Node integration: Native media publishes no output after ${mutation} mutation between range and whole read`, async (t) => {
    const bytes = pngBytes();
    const f = await integrated(t, bytes, "image.png");
    let mutated = false;
    f.afterRead(async (call) => {
      if (call !== 1) return;
      const changed = Buffer.from(bytes);
      changed[changed.length - 1] ^= 1;
      if (mutation === "replacement") {
        const replacement = f.absolute + ".replacement";
        await writeFile(replacement, changed);
        await fs.promises.rename(replacement, f.absolute);
      } else {
        await writeFile(f.absolute, changed);
      }
      mutated = true;
    });
    const emitted = [];
    const error = await Effect.runPromise(
      Effect.flip(
        read(f.adapter, f.absolute, "image.png").pipe(
          Effect.tap((value) => Effect.sync(() => emitted.push(value))),
        ),
      ),
    );
    assert.equal(mutated, true);
    assert.match(error.message, /scripted original (full stat|bytes) changed/);
    assert.deepEqual(emitted, []);
    assert.equal(f.calls.length, 2);
    assert.equal(f.state.calls.length, 2);
    assert.ok(f.state.calls[1].identity);
    assert.equal(f.state.outputs.length, 1);
  });
}

test("Node integration: oversized Native media stops before whole read through actual files", async (t) => {
  const bytes = Buffer.alloc(20 * 1024 * 1024 + 1);
  bytes.set(Buffer.from("%PDF-synthetic"));
  const f = await integrated(t, bytes, "large.pdf");
  const error = await Effect.runPromise(
    Effect.flip(read(f.adapter, f.absolute, "large.pdf")),
  );
  assert.equal(error._tag, "ReadTool.MediaIngestLimitError");
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.calls.length, 1);
});

test("Node integration: cancellation inside scripted physical read erases bytes before Native output", async (t) => {
  const f = await integrated(t, Buffer.from("private synthetic text"));
  f.state.afterRead = () => f.reader.cancel();
  const emitted = [];
  const error = await Effect.runPromise(
    Effect.flip(
      read(f.adapter, f.absolute, "note.txt").pipe(
        Effect.tap((value) => Effect.sync(() => emitted.push(value))),
      ),
    ),
  );
  assert.match(error.message, /native_permission_file_io_unverified/);
  assert.deepEqual(emitted, []);
  assert.equal(f.state.outputs.length, 1);
  assert.deepEqual(
    f.state.outputs[0],
    Buffer.alloc("private synthetic text".length),
  );
  assert.deepEqual(await f.completion, { complete: true });
});

test("Node integration: actual files refuses outside paths and reads after resource close", async (t) => {
  const f = await integrated(t, Buffer.from("owned"));
  await assert.rejects(
    f.view.read(f.root + "-sibling/note.txt", { length: 1 }),
  );
  await assert.rejects(f.view.list(path.dirname(f.root)));
  assert.equal(f.state.calls.length, 0);
  await f.reader.ready;
  await f.reader.close();
  await assert.rejects(f.consume(), /native_permission_file_io_unverified/);
  await assert.rejects(f.view.list(f.root));
  assert.equal(f.state.calls.length, 0);
});
