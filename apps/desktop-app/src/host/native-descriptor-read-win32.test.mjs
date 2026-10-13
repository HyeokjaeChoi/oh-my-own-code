import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as io from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";
import {
  createWin32DescriptorReadKernel,
  win32FailureKind,
  win32PathKind,
} from "./native-descriptor-read-win32.mjs";
import {
  nativeDescriptorFailureKind,
  nativeDescriptorPathKind,
} from "./native-descriptor-read.mjs";

async function fixture(t) {
  const parent = await io.realpath(
    await io.mkdtemp(join(tmpdir(), "omoc-w32read-")),
  );
  const root = join(parent, "root");
  await io.mkdir(join(root, "nested"), { recursive: true });
  await io.writeFile(join(root, "nested", "note.txt"), "abcdefghij");
  await io.writeFile(join(root, "other.txt"), "other");
  await io.mkdir(join(parent, "outside"));
  await io.writeFile(join(parent, "outside", "secret.txt"), "secret");
  const workspace = { id: "w32", path: root };
  const owner = await createWorkspaceRootAuthority(workspace);
  t.after(async () => {
    await owner.close();
    await io.rm(parent, { recursive: true, force: true });
  });
  const make = (check = () => {}, fsImpl = nodeFs) =>
    createWin32DescriptorReadKernel(
      workspace,
      { checkRoot: owner.assertOpened, check },
      fsImpl,
    );
  return { parent, root, owner, workspace, make };
}
const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected failure");
};

test("reads regular files with offset/length and stable identity", async (t) => {
  const f = await fixture(t);
  const k = f.make();
  const first = k.read("nested/note.txt", { offset: 2, length: 4 });
  assert.equal(first.bytes.toString(), "cdef");
  assert.equal(first.info.size, 10);
  const again = k.read("nested/note.txt", {
    identity: first.identity,
    offset: 0,
  });
  assert.equal(again.identity, first.identity);
  assert.throws(
    () => k.read("other.txt", { identity: first.identity }),
    /invalid_request/,
  );
  assert.equal(k.read("other.txt", { offset: 99 }).bytes.length, 0);
  for (const bad of [
    { offset: -1 },
    { length: 0 },
    { length: 1e9 },
    { extra: 1 },
  ])
    assert.throws(() => k.read("other.txt", bad), /invalid_request/);
  k.close();
  assert.throws(() => k.read("other.txt"));
});

test("typed wrong kind, missing and invalid paths", async (t) => {
  const f = await fixture(t);
  const k = f.make();
  let error = failure(() => k.read("nested"));
  assert.equal(nativeDescriptorPathKind(error), "directory");
  assert.equal(win32PathKind(error), "directory");
  error = failure(() => k.read(""));
  assert.equal(nativeDescriptorPathKind(error), "directory");
  error = failure(() => k.list("other.txt"));
  assert.equal(nativeDescriptorPathKind(error), "file");
  for (const method of ["read", "list"]) {
    error = failure(() => k[method]("nested/missing.txt"));
    assert.equal(nativeDescriptorFailureKind(error), "missing");
    assert.equal(win32FailureKind(error), "missing");
    assert.match(error.message, /path_missing/);
  }
  for (const bad of [
    "../x",
    "a/../b",
    "/abs",
    "a\\b",
    "nul",
    "con.txt",
    "a.",
    "GIT~1/x",
    "x:y",
    ".//a",
  ])
    assert.throws(() => k.read(bad), /invalid_request/, bad);
});

test("symlinks and junction-like links are never followed", async (t) => {
  const f = await fixture(t);
  await io.symlink(
    join(f.parent, "outside", "secret.txt"),
    join(f.root, "leaf-link.txt"),
  );
  await io.symlink(join(f.parent, "outside"), join(f.root, "dir-link"));
  const k = f.make();
  assert.throws(() => k.read("leaf-link.txt"), /unsupported_file/);
  assert.throws(() => k.read("dir-link/secret.txt"), /unsupported_file/);
  assert.throws(() => k.list("dir-link"));
  const rows = k.list("");
  assert.deepEqual(rows.map((row) => [row.name, row.type]).sort(), [
    ["dir-link", "symlink"],
    ["leaf-link.txt", "symlink"],
    ["nested", "directory"],
    ["other.txt", "file"],
  ]);
});

test("hard-linked files are refused", async (t) => {
  const f = await fixture(t);
  await io.link(join(f.root, "other.txt"), join(f.root, "twin.txt"));
  const k = f.make();
  assert.throws(() => k.read("twin.txt"), /unsupported_file/);
  assert.throws(() => k.read("other.txt"), /unsupported_file/);
});

test("content swapped during the read is not disclosed", async (t) => {
  const f = await fixture(t);
  let armed = false;
  const hostile = {
    ...nodeFs,
    constants: nodeFs.constants,
    readSync(...args) {
      if (armed) nodeFs.appendFileSync(join(f.root, "other.txt"), "tamper");
      return nodeFs.readSync(...args);
    },
  };
  const k = f.make(() => {}, hostile);
  armed = true;
  assert.throws(() => k.read("other.txt"));
});

test("a replaced root revokes the shared guard permanently", async (t) => {
  const f = await fixture(t);
  const k = f.make();
  assert.equal(k.read("other.txt").bytes.toString(), "other");
  await io.rename(f.root, join(f.parent, "moved-root"));
  await io.mkdir(f.root);
  assert.throws(() => k.read("other.txt"));
  await io.rm(f.root, { recursive: true });
  await io.rename(join(f.parent, "moved-root"), f.root);
  // Restoring the original name must not revive the kernel's authority.
  assert.throws(() => k.read("other.txt"));
  await assert.rejects(f.owner.assertCurrent());
});

test("an ancestor replaced while an operation is walking is refused", async (t) => {
  const f = await fixture(t);
  let swapped = false;
  const hostile = {
    ...nodeFs,
    constants: nodeFs.constants,
    openSync(...args) {
      if (!swapped) {
        swapped = true;
        nodeFs.renameSync(join(f.root, "nested"), join(f.parent, "moved"));
        nodeFs.mkdirSync(join(f.root, "nested"));
        nodeFs.writeFileSync(join(f.root, "nested", "note.txt"), "forged....");
      }
      return nodeFs.openSync(...args);
    },
  };
  const k = f.make(() => {}, hostile);
  assert.throws(() => k.read("nested/note.txt"));
});

test("authority callback runs and its failure aborts without classification", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const boom = new Error("owner_lost");
  const k = f.make(() => {
    calls++;
    if (calls > 6) throw boom;
  });
  assert.throws(
    () => k.read("nested/note.txt"),
    (error) => error === boom,
  );
  assert.equal(win32FailureKind(boom), undefined);
  assert.throws(
    () => f.make(async () => {}).read("other.txt"),
    /invalid_request/,
  );
});

test("directory listing is bounded and rejects unrepresentable names", async (t) => {
  const f = await fixture(t);
  const k = f.make();
  assert.deepEqual(
    k.list("nested").map((row) => row.name),
    ["note.txt"],
  );
  await io.mkdir(join(f.root, "many"));
  await Promise.all(
    Array.from({ length: 4100 }, (_, i) =>
      io.writeFile(join(f.root, "many", `f${i}.txt`), ""),
    ),
  );
  assert.throws(() => k.list("many"), /directory_too_large/);
});
