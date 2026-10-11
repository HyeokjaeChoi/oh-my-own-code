import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createConversationContextIO } from "./conversation-context-io.mjs";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";
import { validateContextObservation } from "../renderer/shared/conversation-context/index.mjs";

const scope = (extra = {}) => ({
  runtimeEpoch: "epoch",
  sender: "sender",
  check() {},
  ...extra,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function fixture(t, bytes = "\uFEFFline\r\n😀끝\n") {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-context-io-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, "one"));
  const path = "one/note.txt";
  await fs.writeFile(join(root, path), bytes);
  return { workspace: { id: "synthetic", path: root }, path, root };
}
const clone = (v) => globalThis.structuredClone(v);
const acquire = (io, f, descriptors, s = scope()) =>
  io.acquire(descriptors, f.workspace, s);

test("captured exact bytes survive replacement/deletion; old full-source version agrees", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  t.after(() => io.close());
  const old = await readWorkspaceFile(f.workspace, f.path);
  const result = await io.observe(f.workspace, f.path, scope());
  assert.equal(result.status, "available");
  validateContextObservation({
    runtimeEpoch: "epoch",
    revision: 1,
    workspaceId: f.workspace.id,
    workspacePath: f.workspace.path,
    path: f.path,
    ...result,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "descriptor",
    "preview",
    "status",
  ]);
  const d = result.descriptor;
  assert.deepEqual(Object.keys(d).sort(), [
    "capabilityId",
    "digest",
    "mime",
    "name",
    "path",
    "size",
    "source",
    "version",
    "workspaceId",
    "workspacePath",
  ]);
  assert.equal(d.version, old.version);
  assert.equal(d.digest, digest(Buffer.from(old.content)));
  assert.equal(d.size, Buffer.byteLength(old.content));
  assert.equal(d.name, "note.txt");
  assert.equal(d.mime, "text/plain");
  assert.equal(d.source, "file");
  assert.deepEqual(result.preview, { kind: "text", text: old.content });
  assert.ok(Object.isFrozen(d));
  await fs.writeFile(join(f.root, f.path), "replacement");
  await fs.unlink(join(f.root, f.path));
  const held = acquire(io, f, [clone(d)]);
  assert.deepEqual(held.files, [
    {
      uri: `data:text/plain;base64,${Buffer.from(old.content).toString("base64")}`,
      name: "note.txt",
    },
  ]);
  held.release();
  held.release();
});

test("selection uses exact UTF16 offsets, full source version, and selected-byte digest", async (t) => {
  const f = await fixture(t, "\uFEFFa\r\n😀끝\n");
  const io = createConversationContextIO();
  t.after(() => io.close());
  const full = await io.observe(f.workspace, f.path, scope());
  const selection = { version: full.descriptor.version, start: 4, end: 7 };
  const selected = await io.observe(f.workspace, f.path, scope({ selection }));
  assert.equal(selected.status, "available");
  assert.deepEqual(selected.preview, { kind: "text", text: "😀끝" });
  assert.equal(selected.descriptor.version, full.descriptor.version);
  assert.equal(selected.descriptor.source, "selection");
  assert.deepEqual(selected.descriptor.range, { start: 4, end: 7 });
  assert.equal(selected.descriptor.digest, digest("😀끝"));
  assert.equal(selected.descriptor.size, 7);
  assert.ok(Object.isFrozen(selected.descriptor.range));
  for (const invalid of [
    { ...selection, start: 5 },
    { ...selection, end: 5 },
    { ...selection, start: 0, end: 99 },
  ])
    await assert.rejects(
      io.observe(f.workspace, f.path, scope({ selection: invalid })),
      { appCode: "INVALID_REQUEST" },
    );
  await fs.writeFile(join(f.root, f.path), "changed");
  assert.deepEqual(
    await io.observe(f.workspace, f.path, scope({ selection })),
    {
      status: "unavailable",
      reason: "file_changed",
    },
  );
});

test("closed inputs refuse accessors, extra keys, renderer text/MIME/URIs before IO", async () => {
  let calls = 0,
    accessed = false;
  const io = createConversationContextIO({
    io: Object.fromEntries(
      ["lstat", "open", "realpath"].map((k) => [
        k,
        async () => {
          calls++;
          throw new Error("IO");
        },
      ]),
    ),
  });
  const w = { id: "w", path: "/synthetic" };
  for (const s of [
    scope({ mime: "text/plain" }),
    scope({ text: "forged" }),
    scope({ sender: {} }),
    scope({
      selection: { version: "a".repeat(64), start: 0, end: 1, text: "forged" },
    }),
    scope({ selection: { version: "a".repeat(64), start: -1, end: 1 } }),
    scope({ selection: { version: "a".repeat(64), start: 1, end: 1 } }),
    scope({ selection: { version: "a".repeat(64), start: 0, end: 1.1 } }),
    {
      runtimeEpoch: "epoch",
      sender: "sender",
      get check() {
        accessed = true;
        return () => {};
      },
    },
  ])
    await assert.rejects(io.observe(w, "a", s), { appCode: "INVALID_REQUEST" });
  for (const path of [
    "../x",
    "a//b",
    "a\\b",
    "a\0",
    "https://example.test/x",
    "/a",
  ])
    await assert.rejects(io.observe(w, path, scope()), {
      appCode: "INVALID_REQUEST",
    });
  await assert.rejects(io.observe({ ...w, extra: true }, "a", scope()), {
    appCode: "INVALID_REQUEST",
  });
  assert.deepEqual(await io.observe(w, ".env", scope()), {
    status: "unsupported",
    reason: "protected_source",
  });
  assert.equal(calls, 0);
  assert.equal(accessed, false);
  io.close();
});

for (const [name, bytes, mime, kind] of [
  ["png", png, "image/png", "image"],
  ["jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg", "image"],
  ["gif", Buffer.from("GIF89a"), "image/gif", "image"],
  ["webp", Buffer.from("RIFFxxxxWEBP"), "image/webp", "image"],
  ["pdf", Buffer.from("%PDF-1.7\nsynthetic\n"), "application/pdf", "pdf"],
])
  test(`actual signature overrides misleading extension: ${name}`, async (t) => {
    const f = await fixture(t, bytes);
    const io = createConversationContextIO();
    const result = await io.observe(f.workspace, f.path, scope());
    assert.equal(result.status, "available");
    assert.equal(result.descriptor.mime, mime);
    validateContextObservation({
      runtimeEpoch: "epoch",
      revision: 1,
      workspaceId: f.workspace.id,
      workspacePath: f.workspace.path,
      path: f.path,
      ...result,
    });
    assert.equal(result.descriptor.digest, digest(bytes));
    assert.deepEqual(
      result.preview,
      kind === "image"
        ? { kind, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
        : { kind },
    );
    const held = acquire(io, f, [result.descriptor]);
    assert.equal(
      held.files[0].uri,
      `data:${mime};base64,${bytes.toString("base64")}`,
    );
    held.release();
    io.close();
  });

for (const bytes of [
  Buffer.from([0xff]),
  Buffer.from("a\0b"),
  Buffer.from("a\u007f"),
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  Buffer.from('\uFEFF<?xml version="1.0"?><!-- x --><svg/>'),
  Buffer.from("BM\0\0\0"),
  Buffer.from("RIFFxxxxWAVE\0"),
  Buffer.from("\0\0\0\x18ftypavif"),
])
  test(`unsupported content refuses without cache success: ${bytes.toString("hex").slice(0, 24)}`, async (t) => {
    const f = await fixture(t, bytes);
    const io = createConversationContextIO();
    assert.deepEqual(await io.observe(f.workspace, f.path, scope()), {
      status: "unsupported",
      reason: "unsupported_content",
    });
    io.close();
  });

test("optional image validator gets a copy and exact MIME; invalid images are refused", async (t) => {
  const f = await fixture(t, png);
  let seen = 0;
  const io = createConversationContextIO({
    validateImage(bytes, mime) {
      seen++;
      assert.equal(mime, "image/png");
      assert.deepEqual(bytes, png);
      bytes.fill(0);
      return false;
    },
  });
  assert.deepEqual(await io.observe(f.workspace, f.path, scope()), {
    status: "unsupported",
    reason: "unsupported_content",
  });
  assert.equal(seen, 1);
  io.close();
});

test("acquire checks owner, epoch, canonical root, all descriptor fields and order", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  const a = (await io.observe(f.workspace, f.path, scope())).descriptor;
  await fs.writeFile(join(f.root, "other.txt"), "OTHER");
  const b = (await io.observe(f.workspace, "other.txt", scope())).descriptor;
  for (const key of Object.keys(a)) {
    const changed = clone(a);
    changed[key] =
      typeof changed[key] === "number" ? changed[key] + 1 : `${changed[key]}x`;
    assert.throws(() => acquire(io, f, [changed]), {
      appCode: "INVALID_SELECTION",
    });
  }
  for (const d of [
    { ...a, uri: "file:///etc/passwd" },
    { ...a, extra: true },
    { ...a, range: { start: 0, end: 1 } },
  ])
    assert.throws(() => acquire(io, f, [d]), { appCode: "INVALID_SELECTION" });
  assert.throws(() => acquire(io, f, [a, a]), { appCode: "INVALID_SELECTION" });
  for (const s of [
    scope({ sender: "other" }),
    scope({ runtimeEpoch: "other" }),
  ])
    assert.throws(() => acquire(io, f, [a], s), {
      appCode: "INVALID_SELECTION",
    });
  for (const w of [
    { ...f.workspace, id: "other" },
    { ...f.workspace, path: `${f.root}/one` },
  ])
    assert.throws(() => io.acquire([a], w, scope()), {
      appCode: "INVALID_SELECTION",
    });
  const held = acquire(io, f, [b, a]);
  assert.deepEqual(
    held.files.map((file) => file.name),
    ["other.txt", "note.txt"],
  );
  held.release();
  io.close();
});

test("TTL is inactivity based; expiry/revocation never invalidates held calls", async (t) => {
  const f = await fixture(t);
  let time = 0;
  const io = createConversationContextIO({ now: () => time });
  const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
  time = 599999;
  const held = acquire(io, f, [d]);
  time += 599999;
  acquire(io, f, [d]).release();
  time += 600000;
  assert.throws(() => acquire(io, f, [d]), { appCode: "INVALID_SELECTION" });
  assert.ok(held.files[0].uri.startsWith("data:text/plain;base64,"));
  io.closeSender("sender");
  assert.throws(() => acquire(io, f, [d]), { appCode: "INVALID_SELECTION" });
  held.release();
  held.release();
  await assert.rejects(io.observe(f.workspace, f.path, scope()), {
    appCode: "INVALID_SELECTION",
  });
  const fresh = await io.observe(
    f.workspace,
    f.path,
    scope({ sender: "fresh" }),
  );
  assert.equal(fresh.status, "available");
  io.close();
  assert.throws(
    () => acquire(io, f, [fresh.descriptor], scope({ sender: "fresh" })),
    { appCode: "INVALID_SELECTION" },
  );
});

test("bounded LRU evicts unpinned entries only and capacity recovers after release", async (t) => {
  const f = await fixture(t, "x");
  const io = createConversationContextIO();
  const descriptors = [];
  const holds = [];
  for (let i = 0; i < 64; i++) {
    const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
    descriptors.push(d);
    holds.push(acquire(io, f, [d]));
  }
  await assert.rejects(io.observe(f.workspace, f.path, scope()), {
    appCode: "LIMIT_REACHED",
  });
  const other = await io.observe(
    f.workspace,
    f.path,
    scope({ sender: "other" }),
  );
  assert.equal(other.status, "available");
  holds[0].release();
  const next = await io.observe(f.workspace, f.path, scope());
  assert.equal(next.status, "available");
  assert.throws(() => acquire(io, f, [descriptors[0]]), {
    appCode: "INVALID_SELECTION",
  });
  for (const hold of holds) hold.release();
  io.close();
});

test("send count/byte limits are atomic; pinned raw bytes count against 64MiB", async (t) => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 65);
  bytes.write("%PDF-1.7\n");
  const f = await fixture(t, bytes);
  const io = createConversationContextIO();
  const ds = [],
    holds = [];
  for (let i = 0; i < 8; i++) {
    const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
    ds.push(d);
    holds.push(acquire(io, f, [d]));
  }
  const two = acquire(io, f, ds.slice(0, 2));
  two.release();
  assert.throws(() => acquire(io, f, ds.slice(0, 3)), {
    appCode: "LIMIT_REACHED",
  });
  await assert.rejects(io.observe(f.workspace, f.path, scope()), {
    appCode: "LIMIT_REACHED",
  });
  io.closeSender("sender");
  for (const h of holds) h.release();
  io.close();
});

test("oversize sources never use bulk reads; text bound applies before bulk allocation", async (t) => {
  for (const [size, prefix] of [
    [65537, "TEXT"],
    [8 * 1024 * 1024 + 1, "%PDF-1.7"],
  ]) {
    const f = await fixture(t);
    const h = await fs.open(join(f.root, f.path), "w");
    await h.write(prefix);
    await h.truncate(size);
    await h.close();
    let maxRead = 0;
    const io = createConversationContextIO({
      io: {
        ...fs,
        open: async (...a) => {
          const held = await fs.open(...a);
          return {
            stat: (...args) => held.stat(...args),
            close: () => held.close(),
            read: (...args) => {
              maxRead = Math.max(maxRead, args[2]);
              return held.read(...args);
            },
          };
        },
      },
    });
    assert.deepEqual(await io.observe(f.workspace, f.path, scope()), {
      status: "unsupported",
      reason: "too_large",
    });
    assert.ok(maxRead <= 16);
    io.close();
  }
});

test("cancellation, reentrant revocation and validator await cannot publish partial success", async (t) => {
  const f = await fixture(t, png);
  let finish;
  const io = createConversationContextIO({
    validateImage: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = io.observe(f.workspace, f.path, scope());
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  io.closeSender("sender");
  finish(true);
  await assert.rejects(pending, { appCode: "INVALID_SELECTION" });
  io.close();
  let module;
  module = createConversationContextIO();
  const d = (await module.observe(f.workspace, f.path, scope())).descriptor;
  assert.throws(
    () =>
      acquire(
        module,
        f,
        [d],
        scope({
          check() {
            module.closeSender("sender");
          },
        }),
      ),
    { appCode: "INVALID_SELECTION" },
  );
  module.close();
});

test("authority error after acquire validation rolls back pins and preserves appCode", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
  let checks = 0;
  const error = Object.assign(new Error("synthetic cancel"), {
    appCode: "FILE_CHANGED",
  });
  assert.throws(
    () =>
      acquire(
        io,
        f,
        [d],
        scope({
          check() {
            if (++checks === 2) throw error;
          },
        }),
      ),
    (e) => e === error,
  );
  for (let i = 0; i < 64; i++) await io.observe(f.workspace, f.path, scope());
  assert.throws(() => acquire(io, f, [d]), { appCode: "INVALID_SELECTION" });
  io.close();
});

test("closed acquire lists/descriptors refuse getters without invoking them", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
  let accessed = false;
  const list = [];
  Object.defineProperty(list, "0", {
    get() {
      accessed = true;
      return d;
    },
  });
  const accessor = { ...d };
  Object.defineProperty(accessor, "digest", {
    get() {
      accessed = true;
      return d.digest;
    },
  });
  for (const input of [
    list,
    [accessor],
    Array(1),
    Object.assign([d], { extra: true }),
    { 0: d, length: 1 },
    [Object.assign(Object.create({}), d)],
    [{ ...d, range: undefined }],
  ])
    assert.throws(() => acquire(io, f, input), {
      appCode: "INVALID_SELECTION",
    });
  assert.equal(accessed, false);
  assert.throws(() => acquire(io, f, Array(9).fill(d)), {
    appCode: "LIMIT_REACHED",
  });
  assert.deepEqual(acquire(io, f, []).files, []);
  io.close();
});

test("capability collision injection cannot revive expired original descriptors", async (t) => {
  const f = await fixture(t);
  let time = 0;
  const io = createConversationContextIO({
    randomId: () => "same",
    now: () => time,
  });
  const old = (await io.observe(f.workspace, f.path, scope())).descriptor;
  time = 600000;
  const next = (await io.observe(f.workspace, f.path, scope())).descriptor;
  assert.notEqual(old.capabilityId, next.capabilityId);
  assert.throws(() => acquire(io, f, [old]), { appCode: "INVALID_SELECTION" });
  acquire(io, f, [next]).release();
  io.close();
});

test("LRU touch order is independent of equal clocks and pin release is reference counted", async (t) => {
  const f = await fixture(t, "x");
  const io = createConversationContextIO({ now: () => 0 });
  const ds = [];
  for (let i = 0; i < 64; i++)
    ds.push((await io.observe(f.workspace, f.path, scope())).descriptor);
  const first = acquire(io, f, [ds[0]]);
  const second = acquire(io, f, [ds[0]]);
  first.release();
  first.release();
  await io.observe(f.workspace, f.path, scope());
  assert.throws(() => acquire(io, f, [ds[1]]), {
    appCode: "INVALID_SELECTION",
  });
  for (let i = 0; i < 64; i++) await io.observe(f.workspace, f.path, scope());
  acquire(io, f, [ds[0]]).release();
  second.release();
  for (let i = 0; i < 64; i++) await io.observe(f.workspace, f.path, scope());
  assert.throws(() => acquire(io, f, [ds[0]]), {
    appCode: "INVALID_SELECTION",
  });
  io.close();
});

test("positive image validation cannot alter cached bytes; validator errors are closed", async (t) => {
  const f = await fixture(t, png);
  for (const mode of ["valid", "throw", "app", "truthy"]) {
    const error = Object.assign(new Error("synthetic validator error"), {
      appCode: "FILE_CHANGED",
    });
    const io = createConversationContextIO({
      validateImage: async (bytes, mime) => {
        assert.equal(mime, "image/png");
        bytes.fill(0);
        if (mode === "app") throw error;
        if (mode === "throw") throw new Error("PRIVATE");
        return mode === "valid" ? true : { valid: true };
      },
    });
    if (mode === "app")
      await assert.rejects(
        io.observe(f.workspace, f.path, scope()),
        (e) => e === error,
      );
    else {
      const result = await io.observe(f.workspace, f.path, scope());
      if (mode === "valid") {
        const h = acquire(io, f, [result.descriptor]);
        assert.equal(
          h.files[0].uri,
          `data:image/png;base64,${png.toString("base64")}`,
        );
        h.release();
      } else
        assert.deepEqual(result, {
          status: "unsupported",
          reason: "unsupported_content",
        });
    }
    io.close();
  }
});

test("expiry advancing inside the final authority check cannot acquire stale bytes", async (t) => {
  const f = await fixture(t);
  let time = 0,
    checks = 0;
  const io = createConversationContextIO({ now: () => time });
  const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
  assert.throws(
    () =>
      acquire(
        io,
        f,
        [d],
        scope({
          check() {
            if (++checks === 2) time = 600000;
          },
        }),
      ),
    { appCode: "INVALID_SELECTION" },
  );
  io.close();
});

test("input workspace/scope/selection are copied before awaits", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  const w = { ...f.workspace },
    s = scope();
  const pending = io.observe(w, f.path, s);
  w.id = "foreign";
  w.path = "/foreign";
  s.sender = "foreign";
  s.runtimeEpoch = "foreign";
  const result = await pending;
  assert.equal(result.descriptor.workspaceId, f.workspace.id);
  acquire(io, f, [result.descriptor]).release();
  io.close();
});

test("reentrant check cannot replace admitted descriptors with an accessor or new byte order", async (t) => {
  const f = await fixture(t);
  const io = createConversationContextIO();
  const d = (await io.observe(f.workspace, f.path, scope())).descriptor;
  const list = [clone(d)];
  let accessed = false,
    checks = 0;
  const held = acquire(
    io,
    f,
    list,
    scope({
      check() {
        if (++checks === 1)
          Object.defineProperty(list, "0", {
            configurable: true,
            get() {
              accessed = true;
              return d;
            },
          });
      },
    }),
  );
  held.release();
  assert.equal(accessed, false);
  io.close();
});
