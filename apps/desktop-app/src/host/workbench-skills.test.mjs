import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const api = () => import("./workbench-skills.mjs");
async function fixture(t, content = "# Synthetic\n") {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-skill-")),
  );
  const workspace = { id: "synthetic", path: join(parent, "workspace") };
  const dir = join(workspace.path, ".opencode", "skills", "example");
  await fs.mkdir(dir, { recursive: true });
  const target = join(dir, "SKILL.md");
  if (content !== null) await fs.writeFile(target, content);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { workspace, dir, target };
}
function instrument(hook = async () => {}) {
  const handles = [];
  const io = {
    ...fs,
    async open(path, flags) {
      const h = await fs.open(path, flags);
      const entry = { path, closed: 0 };
      handles.push(entry);
      return {
        stat: (...args) => h.stat(...args),
        async read(...args) {
          const r = await h.read(...args);
          await hook("read", path);
          return r;
        },
        async close() {
          entry.closed++;
          return h.close();
        },
      };
    },
  };
  return { io, handles };
}
test("exact raw unsupported grammar and canonical identity shape", async (t) => {
  const content = "---\ncustom: &anchor value\n---\n# Body\n";
  const f = await fixture(t, content);
  const { readSkillFile, listSkillFiles } = await api();
  const r = await readSkillFile(f.workspace, "example");
  assert.equal(r.status, "available");
  assert.equal(r.content, content);
  assert.deepEqual(Object.keys(r).sort(), [
    "content",
    "directoryVersion",
    "path",
    "sourceName",
    "status",
    "version",
    "workspaceId",
    "workspacePath",
  ]);
  const paths = [
    f.workspace.path,
    join(f.workspace.path, ".opencode"),
    join(f.workspace.path, ".opencode", "skills"),
    f.dir,
  ];
  const chain = await Promise.all(
    paths.map(async (p) => {
      const s = await fs.stat(p, { bigint: true });
      return [p, String(s.dev), String(s.ino)];
    }),
  );
  assert.equal(
    r.directoryVersion,
    createHash("sha256")
      .update(
        JSON.stringify([f.workspace.id, f.workspace.path, "example", chain]),
      )
      .digest("hex"),
  );
  assert.deepEqual(await listSkillFiles(f.workspace), {
    workspaceId: f.workspace.id,
    workspacePath: f.workspace.path,
    path: paths[2],
    status: "available",
    entries: [{ sourceName: "example", path: f.target }],
    truncated: false,
  });
});
test("only missing leaf has directoryVersion; missing ancestors are unavailable", async (t) => {
  const f = await fixture(t, null);
  const { readSkillFile, listSkillFiles } = await api();
  const missing = await readSkillFile(f.workspace, "example");
  assert.equal(missing.status, "missing");
  assert.equal(missing.reason, "missing_file");
  assert.match(missing.directoryVersion, /^[a-f0-9]{64}$/);
  await fs.rmdir(f.dir);
  assert.equal(
    (await readSkillFile(f.workspace, "example")).reason,
    "path_missing",
  );
  await fs.rmdir(join(f.workspace.path, ".opencode", "skills"));
  const list = await listSkillFiles(f.workspace);
  assert.equal(list.status, "missing");
  assert.equal(list.reason, "path_missing");
  assert.equal(Object.hasOwn(list, "entries"), false);
  assert.equal(Object.hasOwn(list, "truncated"), false);
});
test("denied traversal never reports missing", async (t) => {
  const f = await fixture(t);
  const { readSkillFile, listSkillFiles } = await api();
  const io = {
    ...fs,
    async lstat(path, ...args) {
      if (path.endsWith("/.opencode"))
        throw Object.assign(new Error("private"), { code: "EACCES" });
      return fs.lstat(path, ...args);
    },
  };
  for (const r of [
    await readSkillFile(f.workspace, "example", { io }),
    await listSkillFiles(f.workspace, { io }),
  ]) {
    assert.equal(r.status, "unavailable");
    assert.equal(r.reason, "path_denied");
  }
});
for (const ancestor of [
  ".opencode",
  ".opencode/skills",
  ".opencode/skills/example",
]) {
  for (const replacement of ["directory", "symlink", "missing"]) {
    test(`read rejects ancestor ${ancestor} ${replacement}; closes all FDs`, async (t) => {
      const f = await fixture(t);
      const path = join(f.workspace.path, ancestor);
      let done = false;
      const probe = instrument(async () => {
        if (done) return;
        done = true;
        await fs.rename(path, `${path}.moved`);
        if (replacement === "directory") await fs.mkdir(path);
        if (replacement === "symlink") await fs.symlink(`${path}.moved`, path);
      });
      const r = await (
        await api()
      ).readSkillFile(f.workspace, "example", { io: probe.io });
      assert.equal(r.status, "unavailable");
      assert.equal(r.reason, "file_changed");
      assert.ok(probe.handles.length >= 5);
      assert.ok(probe.handles.every((h) => h.closed === 1));
    });
  }
}
test("safe bounded byte read, encoding, links and file replacement", async (t) => {
  const f = await fixture(t);
  const { readSkillFile } = await api();
  for (const [bytes, status, reason] of [
    [Buffer.alloc(32769, 65), "unavailable", "too_large"],
    [Buffer.from([0xff]), "unsupported", "unsupported_content"],
    [Buffer.from("a\0b"), "unsupported", "unsupported_content"],
  ]) {
    await fs.writeFile(f.target, bytes);
    const r = await readSkillFile(f.workspace, "example");
    assert.equal(r.status, status);
    assert.equal(r.reason, reason);
  }
  await fs.writeFile(f.target, "# Valid");
  await fs.link(f.target, `${f.target}.link`);
  assert.equal(
    (await readSkillFile(f.workspace, "example")).reason,
    "path_denied",
  );
  await fs.unlink(`${f.target}.link`);
  let done = false;
  const p = instrument(async () => {
    if (!done) {
      done = true;
      await fs.rename(f.target, `${f.target}.old`);
      await fs.writeFile(f.target, "# Other");
    }
  });
  assert.equal(
    (await readSkillFile(f.workspace, "example", { io: p.io })).reason,
    "file_changed",
  );
  assert.ok(p.handles.every((h) => h.closed === 1));
});
test("list is metadata-only, bounded to 64 scans and 16 rows", async (t) => {
  const f = await fixture(t);
  const { listSkillFiles } = await api();
  for (let n = 0; n < 80; n++) await fs.mkdir(join(f.dir, "..", `entry-${n}`));
  let scans = 0,
    contentOpens = 0;
  const io = {
    ...fs,
    async open(path, ...args) {
      if (path.endsWith("SKILL.md")) contentOpens++;
      return fs.open(path, ...args);
    },
    async opendir(...args) {
      const d = await fs.opendir(...args);
      return {
        async read() {
          scans++;
          return d.read();
        },
        close: () => d.close(),
      };
    },
  };
  const r = await listSkillFiles(f.workspace, { io });
  assert.equal(r.status, "available");
  assert.equal(r.entries.length, 16);
  assert.equal(r.truncated, true);
  assert.ok(scans <= 64);
  assert.equal(contentOpens, 0);
});
test("invalid names, accessors and cancellation do not leak acquired handles", async (t) => {
  const f = await fixture(t);
  const { readSkillFile } = await api();
  for (const name of ["../x", "a/b", "A", "", "x".repeat(65)])
    await assert.rejects(readSkillFile(f.workspace, name), {
      appCode: "INVALID_REQUEST",
    });
  const p = instrument();
  let cancelled = false;
  const io = {
    ...p.io,
    async open(...args) {
      const h = await p.io.open(...args);
      cancelled = true;
      return h;
    },
  };
  await assert.rejects(
    readSkillFile(f.workspace, "example", {
      io,
      check() {
        if (cancelled)
          throw Object.assign(new Error("cancelled"), {
            appCode: "STALE_REVISION",
          });
      },
    }),
    { appCode: "STALE_REVISION" },
  );
  assert.ok(p.handles.every((h) => h.closed === 1));
});

test("list scan budget includes invalid names and skips symlink aliases", async (t) => {
  const f = await fixture(t);
  const { listSkillFiles } = await api();
  let reads = 0;
  const io = {
    ...fs,
    async opendir() {
      return {
        async read() {
          reads++;
          return { name: "../invalid" };
        },
        async close() {},
      };
    },
  };
  const r = await listSkillFiles(f.workspace, { io });
  assert.equal(r.status, "available");
  assert.equal(r.entries.length, 0);
  assert.equal(r.truncated, true);
  assert.equal(reads, 64);
  await fs.symlink(f.dir, join(f.dir, "..", "alias"));
  const actual = await listSkillFiles(f.workspace);
  assert.deepEqual(
    actual.entries.map((e) => e.sourceName),
    ["example"],
  );
});

test("list keeps accepted child identities through enumeration; closes every handle once", async (t) => {
  const f = await fixture(t);
  const { listSkillFiles } = await api();
  const p = instrument();
  let read = 0;
  const io = {
    ...p.io,
    async opendir() {
      return {
        async read() {
          if (++read === 1) return { name: "example" };
          await fs.rename(f.dir, `${f.dir}.old`);
          await fs.mkdir(f.dir);
          return null;
        },
        async close() {},
      };
    },
  };
  const r = await listSkillFiles(f.workspace, { io });
  assert.equal(r.status, "unavailable");
  assert.equal(r.reason, "file_changed");
  assert.ok(p.handles.every((h) => h.closed === 1));
});

test("list cancellation after child close never closes the same FD twice", async (t) => {
  const f = await fixture(t);
  const { listSkillFiles } = await api();
  const p = instrument();
  let cancelled = false;
  const io = {
    ...p.io,
    async open(path, ...args) {
      const h = await p.io.open(path, ...args);
      if (path === f.dir)
        return {
          ...h,
          async close() {
            await h.close();
            cancelled = true;
          },
        };
      return h;
    },
  };
  await assert.rejects(
    listSkillFiles(f.workspace, {
      io,
      check() {
        if (cancelled)
          throw Object.assign(new Error("cancelled"), {
            appCode: "STALE_REVISION",
          });
      },
    }),
    { appCode: "STALE_REVISION" },
  );
  assert.ok(p.handles.every((h) => h.closed === 1));
});
