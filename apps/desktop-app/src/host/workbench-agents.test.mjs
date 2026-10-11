import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-agent-file-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = { id: "workspace", path: root };
  const directory = join(root, ".opencode", "agents");
  await fs.mkdir(directory, { recursive: true });
  return { workspace, directory, target: join(directory, "reviewer.md") };
}

test("agent reader lists only flat regular safe Markdown files without reading content", async (t) => {
  const { listAgentFiles, readAgentFile } = await import(
    "./workbench-agents.mjs"
  );
  const f = await fixture(t);
  const text = '\uFEFF---\r\n{"description":"Review"}\r\n---\r\nBody\r\n';
  await fs.writeFile(f.target, text);
  await fs.mkdir(join(f.directory, "nested.md"));
  await fs.writeFile(join(f.directory, "constructor.md"), "Body");
  await fs.symlink(f.target, join(f.directory, "linked.md"));
  await fs.writeFile(join(f.directory, "hard.md"), "Body");
  await fs.link(
    join(f.directory, "hard.md"),
    join(f.directory, "hard-other.md"),
  );
  const handles = [];
  const io = {
    ...fs,
    async open(path, flags) {
      const h = await fs.open(path, flags);
      const entry = { path, reads: 0, closed: 0 };
      handles.push(entry);
      return {
        stat: (...a) => h.stat(...a),
        read: (...a) => {
          entry.reads++;
          return h.read(...a);
        },
        close: () => {
          entry.closed++;
          return h.close();
        },
      };
    },
  };
  const listed = await listAgentFiles(f.workspace, { io });
  assert.equal(listed.status, "available");
  assert.deepEqual(listed.entries, [
    { sourceName: "reviewer", path: f.target },
  ]);
  assert.equal(
    handles.every((h) => h.reads === 0 && h.closed === 1),
    true,
  );
  const read = await readAgentFile(f.workspace, "reviewer");
  assert.equal(read.status, "available");
  assert.equal(read.content, text);
  assert.match(read.version, /^[a-f0-9]{64}$/u);
  assert.match(read.directoryVersion, /^[a-f0-9]{64}$/u);
});

test("agent reads require existing ancestors and exact stable single-link leaf", async (t) => {
  const { listAgentFiles, readAgentFile } = await import(
    "./workbench-agents.mjs"
  );
  const f = await fixture(t);
  const missing = await readAgentFile(f.workspace, "reviewer");
  assert.equal(missing.status, "missing");
  assert.match(missing.directoryVersion, /^[a-f0-9]{64}$/u);
  await fs.writeFile(f.target, "Body");
  await fs.link(f.target, join(f.directory, "alias"));
  assert.equal(
    (await readAgentFile(f.workspace, "reviewer")).reason,
    "path_denied",
  );
  await fs.unlink(join(f.directory, "alias"));
  let replaced = false;
  const io = {
    ...fs,
    async open(path, flags) {
      const h = await fs.open(path, flags);
      return {
        stat: (...a) => h.stat(...a),
        close: () => h.close(),
        async read(...a) {
          const r = await h.read(...a);
          if (path === f.target && !replaced) {
            replaced = true;
            await fs.rename(f.directory, f.directory + ".old");
            await fs.mkdir(f.directory);
          }
          return r;
        },
      };
    },
  };
  assert.equal(
    (await readAgentFile(f.workspace, "reviewer", { io })).reason,
    "file_changed",
  );
  await fs.rmdir(f.directory);
  assert.equal((await listAgentFiles(f.workspace)).status, "missing");
  await assert.rejects(
    readAgentFile(f.workspace, "../reviewer"),
    (e) => e.appCode === "INVALID_REQUEST",
  );
});

test("agent listing retains every accepted leaf identity throughout later directory enumeration", async (t) => {
  const { listAgentFiles } = await import("./workbench-agents.mjs");
  const f = await fixture(t);
  await fs.writeFile(f.target, "Body");
  let count = 0,
    closed = false;
  const io = {
    ...fs,
    async opendir() {
      return {
        async read() {
          count++;
          if (count === 1) return { name: "reviewer.md" };
          await fs.rename(f.target, f.target + ".old");
          await fs.writeFile(f.target, "Other");
          return null;
        },
        async close() {
          closed = true;
        },
      };
    },
  };
  const result = await listAgentFiles(f.workspace, { io });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "file_changed");
  assert.equal(closed, true);
});
