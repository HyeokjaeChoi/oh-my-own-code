import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";

async function fixture(t) {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-root-object-")),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = join(parent, "root");
  await fs.mkdir(root);
  await fs.writeFile(join(root, "note.txt"), "original");
  return { parent, root, workspace: { id: "w1", path: root } };
}
const load = () => import("./workspace-root-authority.mjs");

test("root owner binds actual opened directory identity and close revokes immediately", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  const stat = await fs.stat(root, { bigint: true });
  const row = {
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  assert.equal(owner.assertOpened(row), true);
  for (const change of [
    { workspaceId: "w2" },
    { workspacePath: root + "-other" },
    { ino: String(stat.ino + 1n) },
    { dev: "00" },
    { extra: true },
  ])
    assert.throws(() => owner.assertOpened({ ...row, ...change }));
  const pending = owner.close();
  assert.throws(() => owner.assertOpened(row));
  assert.equal(owner.close(), pending);
  await pending;
});

test("observer refuses a replacement at the same pathname before opening any descendant", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  await fs.rename(root, root + "-original");
  await fs.mkdir(root);
  await fs.writeFile(join(root, "note.txt"), "foreign");
  const opened = [];
  const io = {
    ...fs,
    open: async (path, ...args) => {
      opened.push(path);
      return fs.open(path, ...args);
    },
  };
  const result = await readWorkspaceFile(workspace, "note.txt", {
    io,
    checkRoot: owner.assertOpened,
  });
  assert.deepEqual(result.status, "unavailable");
  assert.equal(result.reason, "path_denied");
  assert.deepEqual(opened, [root]);
  assert.equal(await fs.readFile(join(root, "note.txt"), "utf8"), "foreign");
});

test("observer checks retained owner after reentrant authority checks and keeps bytes private", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(() => owner.close());
  const accepted = await readWorkspaceFile(workspace, "note.txt", {
    checkRoot: owner.assertOpened,
  });
  assert.equal(accepted.content, "original");
  let validated = false,
    reads = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (args[0] !== root) {
        const read = handle.read.bind(handle);
        handle.read = (...values) => {
          reads++;
          return read(...values);
        };
      }
      return handle;
    },
  };
  const result = await readWorkspaceFile(workspace, "note.txt", {
    io,
    checkRoot: (identity) => {
      const answer = owner.assertOpened(identity);
      validated = true;
      return answer;
    },
    check: () => {
      if (validated) void owner.close();
    },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(Object.hasOwn(result, "content"), false);
  assert.equal(reads, 0);
});

test("root owner refuses malformed descriptor inputs and cleans failed acquisition", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { workspace } = await fixture(t);
  let invoked = 0,
    opened = 0,
    closed = 0;
  const getter = () => {
    invoked++;
    throw new Error("caller");
  };
  for (const candidate of [
    new Proxy(workspace, { ownKeys: getter, getPrototypeOf: getter }),
    Object.defineProperty({ ...workspace }, "path", { get: getter }),
    { ...workspace, extra: true },
  ])
    await assert.rejects(createWorkspaceRootAuthority(candidate));
  assert.equal(invoked, 0);
  const io = {
    ...fs,
    open: async (...args) => {
      opened++;
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closed++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(
    createWorkspaceRootAuthority(workspace, {
      io,
      check: () => {
        if (opened) throw new Error("revoked");
      },
    }),
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test("root replacement during acquisition is refused and the opened replacement FD is closed", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { root, workspace } = await fixture(t);
  let opened = 0,
    closed = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      await fs.rename(root, root + "-original");
      await fs.mkdir(root);
      await fs.writeFile(join(root, "note.txt"), "replacement");
      const handle = await fs.open(...args);
      opened++;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closed++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(createWorkspaceRootAuthority(workspace, { io }), {
    message: "native_permission_root_unverified",
  });
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  assert.equal(
    await fs.readFile(join(root, "note.txt"), "utf8"),
    "replacement",
  );
});

test("a symlink root is refused before open and revocation does not reopen the path", async (t) => {
  const { createWorkspaceRootAuthority } = await load();
  const { parent, root, workspace } = await fixture(t);
  const alias = join(parent, "alias");
  await fs.symlink(root, alias);
  let opens = 0,
    closes = 0;
  const io = {
    ...fs,
    open: async (...args) => {
      opens++;
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        return close();
      };
      return handle;
    },
  };
  await assert.rejects(
    createWorkspaceRootAuthority({ ...workspace, path: alias }, { io }),
  );
  assert.equal(opens, 0);
  const owner = await createWorkspaceRootAuthority(workspace, { io });
  const stat = await fs.stat(root, { bigint: true });
  const row = {
    workspaceId: workspace.id,
    workspacePath: root,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  const proxy = new Proxy(row, {
    ownKeys: () => {
      throw new Error("unexpected caller trap");
    },
  });
  assert.throws(() => owner.assertOpened(proxy), {
    message: "native_permission_root_unverified",
  });
  assert.equal(owner.assertOpened(row), true);
  await owner.close();
  await owner.close();
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.throws(() => owner.assertOpened(row));
});
