import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  readWorkspaceFile,
  observeWorkspaceFileBytes,
} from "./workbench-file-edit.mjs";
import { validateWorkspaceFileObservation } from "../renderer/shared/workspace-file/index.mjs";
import {
  configurationFileVersion,
  configurationWorkspaceFileDirectoryVersion,
  configurationBackupId,
} from "./configuration-file-observation.mjs";

async function fixture(t, bytes = "\uFEFFline\r\n\r\nlast\n") {
  const temp = await fs.mkdtemp(join(tmpdir(), "omoc-file-observer-"));
  const root = await fs.realpath(temp);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, "one", "two"), { recursive: true });
  const path = "one/two/note.txt";
  const target = join(root, path);
  await fs.writeFile(target, bytes, { mode: 0o640 });
  return { workspace: { id: "synthetic", path: root }, root, path, target };
}
const publicShape = (body) =>
  validateWorkspaceFileObservation({
    runtimeEpoch: "epoch",
    revision: 1,
    ...body,
  });

test("private root guard requires exact synchronous true before descendant IO", async (t) => {
  const f = await fixture(t);
  for (const answer of [false, undefined, null, 1, Promise.resolve(true)]) {
    const opened = [];
    const io = {
      ...fs,
      open: async (path, ...args) => {
        opened.push(path);
        return fs.open(path, ...args);
      },
    };
    const result = await observeWorkspaceFileBytes(f.workspace, f.path, {
      io,
      checkRoot: () => answer,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "path_denied");
    assert.deepEqual(opened, [f.root]);
    assert.equal(Object.hasOwn(result, "bytes"), false);
  }
  for (const checkRoot of [null, undefined, false, {}])
    await assert.rejects(
      observeWorkspaceFileBytes(f.workspace, f.path, { checkRoot }),
      { appCode: "INVALID_REQUEST" },
    );
});

test("private root guard receives frozen actual root identity and preserves appCode", async (t) => {
  const f = await fixture(t);
  const stat = await fs.stat(f.root, { bigint: true });
  let calls = 0;
  const result = await readWorkspaceFile(f.workspace, f.path, {
    checkRoot: (row) => {
      calls++;
      assert.equal(Object.isFrozen(row), true);
      assert.deepEqual(row, {
        workspaceId: f.workspace.id,
        workspacePath: f.root,
        dev: String(stat.dev),
        ino: String(stat.ino),
      });
      return true;
    },
  });
  assert.equal(result.status, "available");
  assert.ok(calls > 1);
  const error = Object.assign(new Error("revoked"), { appCode: "UNAVAILABLE" });
  await assert.rejects(
    readWorkspaceFile(f.workspace, f.path, {
      checkRoot: () => {
        throw error;
      },
    }),
    (actual) => actual === error,
  );
});

test("protected sources perform no IO or root guard calls", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw new Error("unexpected IO");
  };
  const result = await observeWorkspaceFileBytes(f.workspace, ".env", {
    io: { lstat: forbidden, realpath: forbidden, open: forbidden },
    checkRoot: forbidden,
  });
  assert.equal(result.reason, "protected_source");
  assert.equal(calls, 0);
});

test("actual export preserves exact bytes and binds full ancestry/version/backup", async (t) => {
  const f = await fixture(t);
  const observed = await readWorkspaceFile(f.workspace, f.path);
  assert.equal(observed.status, "available");
  assert.equal(observed.content, "\uFEFFline\r\n\r\nlast\n");
  assert.equal(observed.path, f.path);
  assert.equal(observed.targetPath, f.target);
  assert.equal(Object.hasOwn(observed, "runtimeEpoch"), false);
  assert.equal(Object.hasOwn(observed, "revision"), false);
  publicShape(observed);
  const chain = [];
  for (const path of [f.root, join(f.root, "one"), join(f.root, "one/two")]) {
    const s = await fs.stat(path, { bigint: true });
    chain.push([path, String(s.dev), String(s.ino)]);
  }
  const base = { ...observed, kind: "file" };
  assert.equal(
    observed.directoryVersion,
    configurationWorkspaceFileDirectoryVersion(base, chain),
  );
  assert.equal(
    observed.version,
    configurationFileVersion(
      base,
      await fs.stat(f.root, { bigint: true }),
      await fs.stat(f.target, { bigint: true }),
      await fs.readFile(f.target),
      chain,
    ),
  );
  const changed = chain.map((entry) => [...entry]);
  changed[1][2] += "1";
  assert.notEqual(
    configurationWorkspaceFileDirectoryVersion(base, changed),
    observed.directoryVersion,
  );
  assert.notEqual(
    configurationFileVersion(
      base,
      await fs.stat(f.root, { bigint: true }),
      await fs.stat(f.target, { bigint: true }),
      await fs.readFile(f.target),
      changed,
    ),
    observed.version,
  );
  assert.notEqual(
    configurationWorkspaceFileDirectoryVersion(
      { ...base, path: "other.txt" },
      chain,
    ),
    observed.directoryVersion,
  );
  const key = createHash("sha256")
    .update(JSON.stringify(["epoch", "op"]))
    .digest("hex");
  assert.equal(
    configurationBackupId("epoch", "op", "file"),
    `.omoc-configuration-${key}.file.backup`,
  );
});

test("protected paths do no IO; malformed path/root/options fail before IO", async () => {
  let calls = 0;
  const io = Object.fromEntries(
    ["open", "lstat", "realpath"].map((key) => [
      key,
      async () => {
        calls++;
        throw new Error("unexpected IO");
      },
    ]),
  );
  for (const path of [
    ".env",
    ".agents/a.md",
    "x/AGENTS.md",
    "x/private.key",
    ".omoc-configuration-private.file.backup",
  ]) {
    const body = await readWorkspaceFile(
      { id: "w", path: "/synthetic" },
      path,
      { io },
    );
    assert.equal(body.status, "unsupported");
    assert.equal(body.reason, "protected_source");
    publicShape(body);
  }
  for (const path of [
    "../x",
    "a//b",
    "a\\b",
    "x\0",
    "a/CON.txt",
    "a/\uD800",
    "a/",
    "x:",
  ])
    await assert.rejects(
      readWorkspaceFile({ id: "w", path: "/synthetic" }, path, { io }),
      { appCode: "INVALID_REQUEST" },
    );
  await assert.rejects(
    readWorkspaceFile({ id: "w", path: "/synthetic/../x" }, "a", { io }),
    { appCode: "INVALID_REQUEST" },
  );
  let touched = false;
  await assert.rejects(
    readWorkspaceFile({ id: "w", path: "/synthetic" }, "a", {
      get check() {
        touched = true;
        return () => {};
      },
    }),
    { appCode: "INVALID_REQUEST" },
  );
  assert.equal(touched, false);
  assert.equal(calls, 0);
});

test("missing file/ancestor, symlink, hardlink, directory and FIFO refuse without baselines", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await readWorkspaceFile(f.workspace, "one/two/missing.txt")).reason,
    "missing_file",
  );
  assert.equal(
    (await readWorkspaceFile(f.workspace, "missing/note.txt")).reason,
    "path_missing",
  );
  await fs.symlink(f.target, join(f.root, "alias.txt"));
  await fs.symlink(join(f.root, "one"), join(f.root, "alias"));
  await fs.link(f.target, join(f.root, "hard.txt"));
  for (const path of [
    "alias.txt",
    "alias/two/note.txt",
    "hard.txt",
    f.path,
    "one",
  ]) {
    const body = await readWorkspaceFile(f.workspace, path);
    assert.equal(body.reason, "path_denied");
    assert.equal(Object.hasOwn(body, "version"), false);
    publicShape(body);
  }
  // FIFO lstat is refused before open; no blocking special-file read.
  const { spawnSync } = await import("node:child_process");
  assert.equal(spawnSync("/usr/bin/mkfifo", [join(f.root, "fifo")]).status, 0);
  assert.equal(
    (await readWorkspaceFile(f.workspace, "fifo")).reason,
    "path_denied",
  );
});

for (const [name, bytes, reason] of [
  ["invalid UTF8", Buffer.from([0xff]), "unsupported_content"],
  ["NUL", Buffer.from([65, 0]), "unsupported_content"],
  ["binary control", "hello\u007f", "unsupported_content"],
  ["large", "a".repeat(65537), "too_large"],
])
  test(name, async (t) => {
    const f = await fixture(t, bytes);
    const body = await readWorkspaceFile(f.workspace, f.path);
    assert.equal(body.status, "unsupported");
    assert.equal(body.reason, reason);
    assert.equal(Object.hasOwn(body, "content"), false);
    publicShape(body);
  });

for (const bytes of ["", "\n\r\n", "a".repeat(65536)])
  test(`exact bounded text ${bytes.length}`, async (t) => {
    const f = await fixture(t, bytes);
    assert.equal((await readWorkspaceFile(f.workspace, f.path)).content, bytes);
  });

test("same-device, denied IO and cleanup failure use closed refusal", async (t) => {
  const f = await fixture(t);
  const denied = await readWorkspaceFile(f.workspace, f.path, {
    io: {
      ...fs,
      open: async () => {
        throw Object.assign(new Error("PRIVATE"), { code: "EACCES" });
      },
    },
  });
  assert.equal(denied.reason, "path_denied");
  publicShape(denied);
  const device = await readWorkspaceFile(f.workspace, f.path, {
    io: {
      ...fs,
      lstat: async (path, options) => {
        const s = await fs.lstat(path, options);
        if (path === join(f.root, "one")) s.dev += 1n;
        return s;
      },
    },
  });
  assert.equal(device.reason, "path_denied");
  let opened = 0,
    closed = 0;
  const cleanup = await readWorkspaceFile(f.workspace, f.path, {
    io: {
      ...fs,
      open: async (...args) => {
        const h = await fs.open(...args);
        opened++;
        return {
          stat: (...a) => h.stat(...a),
          read: (...a) => h.read(...a),
          close: async () => {
            await h.close();
            closed++;
            throw new Error("PRIVATE");
          },
        };
      },
    },
  });
  assert.equal(cleanup.reason, "path_denied");
  assert.equal(opened, closed);
});

for (const mutation of ["ancestor", "source", "in-place", "root"])
  test(`mutation during await: ${mutation}; no outside read and all FDs close`, async (t) => {
    const f = await fixture(t);
    let opened = 0,
      closed = 0,
      mutated = false,
      reads = 0;
    const io = {
      ...fs,
      open: async (path, flags) => {
        const h = await fs.open(path, flags);
        opened++;
        return {
          stat: (...args) => h.stat(...args),
          close: async () => {
            await h.close();
            closed++;
          },
          read: async (...args) => {
            reads++;
            const result = await h.read(...args);
            if (!mutated) {
              mutated = true;
              if (mutation === "in-place")
                await fs.writeFile(f.target, "changed bytes");
              else if (mutation === "source") {
                await fs.rename(f.target, f.target + ".old");
                await fs.writeFile(f.target, "replacement");
              } else {
                const p = mutation === "root" ? f.root : join(f.root, "one");
                await fs.rename(p, p + ".old");
                await fs.symlink(p + ".old", p);
                t.after(() =>
                  fs.rm(p + ".old", { recursive: true, force: true }),
                );
              }
            }
            return result;
          },
        };
      },
    };
    const body = await readWorkspaceFile(f.workspace, f.path, { io });
    assert.equal(body.reason, "file_changed");
    assert.equal(Object.hasOwn(body, "content"), false);
    assert.equal(reads, 1);
    assert.equal(opened, closed);
  });

test("check cancellation after open closes every descriptor and preserves app error", async (t) => {
  const f = await fixture(t);
  let opened = 0,
    closed = 0,
    cancelled = false;
  const error = Object.assign(new Error("cancelled"), {
    appCode: "FILE_CHANGED",
  });
  await assert.rejects(
    readWorkspaceFile(f.workspace, f.path, {
      check: () => {
        if (cancelled) throw error;
      },
      io: {
        ...fs,
        open: async (...args) => {
          const h = await fs.open(...args);
          opened++;
          cancelled = true;
          return {
            close: async () => {
              await h.close();
              closed++;
            },
          };
        },
      },
    }),
    (e) => e === error,
  );
  assert.equal(opened, closed);
});

test("ancestor redirected outside during open: no leaf read and no outside change", async (t) => {
  const f = await fixture(t);
  const outside = await fs.mkdtemp(join(tmpdir(), "omoc-file-outside-"));
  const canonicalOutside = await fs.realpath(outside);
  t.after(() => fs.rm(canonicalOutside, { recursive: true, force: true }));
  await fs.writeFile(join(canonicalOutside, "note.txt"), "OUTSIDE-SENTINEL");
  let opened = 0,
    closed = 0,
    reads = 0;
  const body = await readWorkspaceFile(f.workspace, f.path, {
    io: {
      ...fs,
      open: async (path, flags) => {
        if (path === f.target) {
          await fs.rename(join(f.root, "one/two"), join(f.root, "one/two.old"));
          await fs.symlink(canonicalOutside, join(f.root, "one/two"));
        }
        const h = await fs.open(path, flags);
        opened++;
        return {
          stat: (...args) => h.stat(...args),
          close: async () => {
            await h.close();
            closed++;
          },
          read: async (...args) => {
            reads++;
            return h.read(...args);
          },
        };
      },
    },
  });
  assert.equal(body.reason, "file_changed");
  assert.equal(reads, 0);
  assert.equal(opened, closed);
  assert.equal(
    await fs.readFile(join(canonicalOutside, "note.txt"), "utf8"),
    "OUTSIDE-SENTINEL",
  );
  assert.deepEqual(await fs.readdir(canonicalOutside), ["note.txt"]);
});

test("root-level file and maximum ancestor depth bind exact paths", async (t) => {
  const f = await fixture(t);
  for (const path of ["top.txt", Array(31).fill("d").join("/") + "/leaf.txt"]) {
    const full = join(f.root, path);
    const { dirname } = await import("node:path");
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, "\uFEFF\r\n");
    const body = await readWorkspaceFile(f.workspace, path);
    assert.equal(body.status, "available");
    assert.equal(body.content, "\uFEFF\r\n");
    publicShape(body);
  }
});

test("checked byte primitive binds identical full-file versions without text decoding", async (t) => {
  const f = await fixture(t);
  const text = await readWorkspaceFile(f.workspace, f.path);
  const raw = await observeWorkspaceFileBytes(f.workspace, f.path);
  assert.deepEqual(raw.bytes, Buffer.from(text.content));
  assert.equal(raw.version, text.version);
  assert.equal(raw.directoryVersion, text.directoryVersion);
  const bytes = Buffer.from("89504e470d0a1a0a0000", "hex");
  await fs.writeFile(f.target, bytes);
  assert.equal(
    (await readWorkspaceFile(f.workspace, f.path)).reason,
    "unsupported_content",
  );
  assert.deepEqual(
    (await observeWorkspaceFileBytes(f.workspace, f.path)).bytes,
    bytes,
  );
  await assert.rejects(
    readWorkspaceFile(f.workspace, f.path, { maxBytes: 8388608 }),
    { appCode: "INVALID_REQUEST" },
  );
});

for (const mutation of [
  "header-source",
  "header-ancestor",
  "header-root",
  "bulk-source",
])
  test(`checked byte capture rejects ${mutation} and closes all FDs`, async (t) => {
    const f = await fixture(t, Buffer.from("89504e470d0a1a0a0000", "hex"));
    let reads = 0,
      opened = 0,
      closed = 0;
    const result = await observeWorkspaceFileBytes(f.workspace, f.path, {
      maxBytes: 8388608,
      byteLimit: () => 8388608,
      io: {
        ...fs,
        open: async (...args) => {
          const h = await fs.open(...args);
          opened++;
          return {
            stat: (...a) => h.stat(...a),
            close: async () => {
              await h.close();
              closed++;
            },
            read: async (...a) => {
              const read = await h.read(...a);
              reads++;
              if (reads === (mutation === "bulk-source" ? 2 : 1)) {
                if (mutation.endsWith("source"))
                  await fs.writeFile(f.target, "replacement");
                else {
                  const path = mutation.endsWith("root")
                    ? f.root
                    : join(f.root, "one");
                  await fs.rename(path, `${path}.old`);
                  await fs.symlink(`${path}.old`, path);
                  t.after(() =>
                    fs.rm(`${path}.old`, { recursive: true, force: true }),
                  );
                }
              }
              return read;
            },
          };
        },
      },
    });
    assert.equal(result.reason, "file_changed");
    assert.equal(Object.hasOwn(result, "bytes"), false);
    assert.equal(opened, closed);
    assert.equal(reads, mutation === "bulk-source" ? 2 : 1);
  });

test("byte reader tolerates short reads, bounds header, and cleans up cancellation", async (t) => {
  const f = await fixture(t, "a".repeat(100));
  let opened = 0,
    closed = 0,
    reads = 0,
    cancel = false;
  const io = {
    ...fs,
    open: async (...args) => {
      const h = await fs.open(...args);
      opened++;
      return {
        stat: (...a) => h.stat(...a),
        close: async () => {
          await h.close();
          closed++;
        },
        read: async (buffer, offset, length, position) => {
          reads++;
          return h.read(buffer, offset, Math.min(3, length), position);
        },
      };
    },
  };
  const observed = await observeWorkspaceFileBytes(f.workspace, f.path, {
    io,
    maxBytes: 100,
    byteLimit: (head) => {
      assert.equal(head.length, 16);
      return 100;
    },
  });
  assert.deepEqual(observed.bytes, Buffer.from("a".repeat(100)));
  assert.ok(reads > 6);
  assert.equal(opened, closed);
  const error = Object.assign(new Error("synthetic cancellation"), {
    appCode: "NOT_READY",
  });
  await assert.rejects(
    observeWorkspaceFileBytes(f.workspace, f.path, {
      io,
      maxBytes: 100,
      byteLimit: () => {
        cancel = true;
        return 100;
      },
      check: () => {
        if (cancel) throw error;
      },
    }),
    (e) => e === error,
  );
  assert.equal(opened, closed);
});
