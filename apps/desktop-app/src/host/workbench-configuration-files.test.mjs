import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readConfigurationFile } from "./workbench-configuration-files.mjs";

const limit = 32768;
const runFile = promisify(execFile);
const canary = "SYNTHETIC_CONFIGURATION_REFUSAL_CANARY";
const supported = JSON.stringify({
  mcp: {
    servers: {
      local: { type: "local", command: ["synthetic", "--help"] },
      remote: {
        type: "remote",
        url: "https://example.invalid/mcp",
        oauth: false,
      },
    },
  },
});

async function fixture(t) {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-config-read-")),
  );
  const path = join(parent, "workspace");
  await fs.mkdir(path);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return {
    parent,
    workspace: { id: "synthetic-workspace", path },
    target: join(path, "AGENTS.md"),
  };
}

// All injected operations use actual temporary files and actual FileHandles.
function instrument(
  workspace,
  { after = () => {}, chunk = Infinity, readResult } = {},
) {
  const handles = [];
  const events = [];
  const record = async (operation, detail, action) => {
    const result = await action();
    events.push(operation);
    await after(operation, detail, result);
    return result;
  };
  const io = {
    lstat: (path, options) =>
      record("lstat", { path, options }, () => fs.lstat(path, options)),
    realpath: (path) => record("realpath", { path }, () => fs.realpath(path)),
    async open(path, flags) {
      const handle = await fs.open(path, flags);
      const label = path === workspace.path ? "root" : "file";
      const entry = { handle, path, flags, closes: 0 };
      handles.push(entry);
      events.push(`${label}.open`);
      // The hook runs after acquisition, before the reader's admission check.
      await after(`${label}.open`, entry, handle);
      return {
        stat: (options) =>
          record(`${label}.stat`, { options }, () => handle.stat(options)),
        read: (buffer, offset, length, position) =>
          record(`${label}.read`, { buffer, offset, length, position }, () =>
            readResult
              ? readResult({ buffer, offset, length, position, handle })
              : handle.read(buffer, offset, Math.min(length, chunk), position),
          ),
        async close() {
          entry.closes++;
          return record(`${label}.close`, entry, () => handle.close());
        },
      };
    },
  };
  const assertClosed = () => {
    for (const { handle, closes } of handles) {
      assert.equal(closes, 1);
      assert.equal(handle.fd, -1);
    }
  };
  return { io, handles, events, assertClosed };
}

function refusal(result, workspace, kind, status, reason) {
  assert.deepEqual(result, {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    kind,
    path: join(
      workspace.path,
      kind === "instructions" ? "AGENTS.md" : "opencode.json",
    ),
    status,
    reason,
  });
  assert.equal(JSON.stringify(result).includes(canary), false);
}

test("fixed instruction and MCP paths return exact DTOs and leave original bytes unchanged", async (t) => {
  const { workspace, target } = await fixture(t);
  for (const [kind, text] of [
    ["instructions", "# Synthetic\n한국어 😀\ttext\r\n"],
    ["instructions", ""],
    ["instructions", " \n\t"],
    ["mcp", supported],
  ]) {
    const path =
      kind === "instructions" ? target : join(workspace.path, "opencode.json");
    await fs.writeFile(path, text);
    const tracked = instrument(workspace);
    const result = await readConfigurationFile(workspace, kind, {
      io: tracked.io,
    });
    assert.match(result.version, /^[a-f0-9]{64}$/);
    assert.deepEqual(result, {
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      kind,
      path,
      status: "available",
      content: text,
      version: result.version,
    });
    assert.equal(await fs.readFile(path, "utf8"), text);
    assert.equal(tracked.handles.length, 2);
    for (const { flags } of tracked.handles) {
      assert.ok(flags & constants.O_NOFOLLOW);
      assert.ok(flags & constants.O_NONBLOCK);
    }
    tracked.assertClosed();
  }
  // Also exercise the uninjected production IO default.
  assert.equal(
    (await readConfigurationFile(workspace, "mcp")).content,
    supported,
  );
});

test("malformed direct arguments reject with existing INVALID_REQUEST before IO", async (t) => {
  const { workspace } = await fixture(t);
  let touched = false;
  const io = {
    lstat() {
      touched = true;
    },
    realpath() {
      touched = true;
    },
    open() {
      touched = true;
    },
  };
  for (const bad of [
    null,
    undefined,
    [],
    "root",
    {},
    { id: "", path: workspace.path },
    { id: "bad/id", path: workspace.path },
    { id: "x", path: "relative" },
    { id: "x", path: "/bad\0path" },
    { id: "x", path: "/bad\u0085path" },
    { id: "x", path: "/" + "x".repeat(4096) },
  ]) {
    await assert.rejects(readConfigurationFile(bad, "instructions", { io }), {
      appCode: "INVALID_REQUEST",
    });
  }
  for (const kind of [
    undefined,
    null,
    "config",
    "../opencode.json",
    {},
    "constructor",
  ])
    await assert.rejects(readConfigurationFile(workspace, kind, { io }), {
      appCode: "INVALID_REQUEST",
    });
  await assert.rejects(
    readConfigurationFile(workspace, "instructions", { check: null, io }),
    { appCode: "INVALID_REQUEST" },
  );
  await assert.rejects(
    readConfigurationFile(workspace, "instructions", { io: {} }),
    { appCode: "INVALID_REQUEST" },
  );
  for (const options of [null, [], 1, "options", { path: "/arbitrary" }])
    await assert.rejects(
      readConfigurationFile(workspace, "instructions", options),
      { appCode: "INVALID_REQUEST" },
    );
  const accessor = Object.defineProperty({}, "id", {
    get() {
      touched = true;
      return "synthetic";
    },
  });
  await assert.rejects(
    readConfigurationFile(accessor, "instructions", { io }),
    { appCode: "INVALID_REQUEST" },
  );
  const accessorOptions = Object.defineProperty({}, "check", {
    get() {
      touched = true;
      return () => {};
    },
  });
  await assert.rejects(
    readConfigurationFile(workspace, "instructions", accessorOptions),
    { appCode: "INVALID_REQUEST" },
  );
  assert.equal(touched, false);
});

test("stable target absence alone is missing; missing or noncanonical roots are denied", async (t) => {
  const { parent, workspace } = await fixture(t);
  for (const kind of ["instructions", "mcp"]) {
    const tracked = instrument(workspace);
    refusal(
      await readConfigurationFile(workspace, kind, { io: tracked.io }),
      workspace,
      kind,
      "missing",
      "missing_file",
    );
    assert.equal(tracked.handles.length, 1);
    tracked.assertClosed();
  }
  for (const path of [
    join(parent, "absent"),
    `${workspace.path}/../workspace`,
  ]) {
    const input = { ...workspace, path };
    refusal(
      await readConfigurationFile(input, "instructions"),
      input,
      "instructions",
      "unavailable",
      "path_denied",
    );
  }
});

test("unsupported MCP documents refuse the whole original text with fixed diagnostics", async (t) => {
  const { workspace } = await fixture(t);
  const path = join(workspace.path, "opencode.json");
  const local = { type: "local", command: ["synthetic"] };
  const remote = { type: "remote", url: "https://example.invalid/mcp" };
  const wrap = (server) =>
    JSON.stringify({ mcp: { servers: { sample: server } } });
  const cases = [
    "",
    `// ${canary}\n${supported}`,
    `${supported.slice(0, -1)},}`,
    JSON.stringify({ ...JSON.parse(supported), provider: { token: canary } }),
    JSON.stringify({ ...JSON.parse(supported), instructions: canary }),
    wrap({ ...local, environment: { TOKEN: canary } }),
    wrap({ ...remote, headers: { Authorization: canary } }),
    wrap({ ...remote, oauth: { token: canary } }),
    wrap({ ...remote, oauth: true }),
    wrap({ ...remote, url: `https://user:${canary}@example.invalid/mcp` }),
    wrap({ ...remote, url: `https://example.invalid/mcp?token=${canary}` }),
    wrap({ ...local, unknown: canary }),
    wrap({ ...local, command: [] }),
    wrap({ ...local, disabled: "false" }),
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"]}}},"mcp":${supported.slice(7, -1)}}`,
    `{"mcp":{"servers":{},"servers":{"sample":{"type":"local","command":["${canary}"]}}}}`,
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"]},"sample":{"type":"local","command":["ok"]}}}}`,
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"],"command":["ok"]}}}}`,
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"],"\\u0063ommand":["ok"]}}}}`,
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"]},"\\u0073ample":{"type":"local","command":["ok"]}}}}`,
    `{"mcp":{"servers":{},"\\u0073ervers":{"sample":{"type":"local","command":["${canary}"]}}}}`,
    `{"mcp":{"servers":{"sample":{"type":"local","command":["${canary}"]}}},"\\u006dcp":${supported.slice(7, -1)}}`,
  ];
  for (const content of cases) {
    await fs.writeFile(path, content);
    const tracked = instrument(workspace);
    refusal(
      await readConfigurationFile(workspace, "mcp", { io: tracked.io }),
      workspace,
      "mcp",
      "unsupported",
      "unsupported_content",
    );
    assert.equal(await fs.readFile(path, "utf8"), content);
    tracked.assertClosed();
  }
});

test("binary, forbidden C0/C1 controls and invalid UTF8 never return content", async (t) => {
  const { workspace, target } = await fixture(t);
  for (const bytes of [
    Buffer.from(`${canary}\0`),
    Buffer.from(`${canary}\x01`),
    Buffer.from(`${canary}\x7f`),
    Buffer.from(`${canary}\u0085`),
    Buffer.from([0xff]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from([0xed, 0xa0, 0x80]),
  ]) {
    await fs.writeFile(target, bytes);
    const tracked = instrument(workspace);
    refusal(
      await readConfigurationFile(workspace, "instructions", {
        io: tracked.io,
      }),
      workspace,
      "instructions",
      "unsupported",
      "unsupported_content",
    );
    assert.deepEqual(await fs.readFile(target), bytes);
    tracked.assertClosed();
  }
});

test("symlinks, hardlinks, directories and FIFO targets fail closed", async (t) => {
  const { parent, workspace, target } = await fixture(t);
  const outside = join(parent, "synthetic-outside");
  await fs.writeFile(outside, canary);
  for (const create of [
    () => fs.symlink(outside, target),
    () => fs.link(outside, target),
    () => fs.mkdir(target),
  ]) {
    await create();
    const tracked = instrument(workspace);
    refusal(
      await readConfigurationFile(workspace, "instructions", {
        io: tracked.io,
      }),
      workspace,
      "instructions",
      "unavailable",
      "path_denied",
    );
    tracked.assertClosed();
    await fs.rm(target, { recursive: true });
  }
  if (process.platform !== "win32") {
    await runFile("mkfifo", [target]);
    const tracked = instrument(workspace);
    refusal(
      await readConfigurationFile(workspace, "instructions", {
        io: tracked.io,
      }),
      workspace,
      "instructions",
      "unavailable",
      "path_denied",
    );
    tracked.assertClosed();
  }
  const alias = join(parent, "root-alias");
  await fs.symlink(workspace.path, alias, "dir");
  const input = { ...workspace, path: alias };
  refusal(
    await readConfigurationFile(input, "instructions"),
    input,
    "instructions",
    "unavailable",
    "path_denied",
  );
  assert.equal(await fs.readFile(outside, "utf8"), canary);
});

test("partial reads accumulate exact bytes through the inclusive byte limit", async (t) => {
  const { workspace, target } = await fixture(t);
  for (const content of ["한국어😀".repeat(7), "x".repeat(limit)]) {
    await fs.writeFile(target, content);
    const tracked = instrument(workspace, { chunk: 37 });
    const result = await readConfigurationFile(workspace, "instructions", {
      io: tracked.io,
    });
    assert.equal(result.status, "available");
    assert.equal(result.content, content);
    assert.ok(
      tracked.events.filter((event) => event === "file.read").length > 1,
    );
    tracked.assertClosed();
  }
});

test("initial overflow and growth during read are bounded at limit plus one byte", async (t) => {
  const { workspace, target } = await fixture(t);
  await fs.writeFile(target, "x".repeat(limit + 1));
  let tracked = instrument(workspace);
  refusal(
    await readConfigurationFile(workspace, "instructions", { io: tracked.io }),
    workspace,
    "instructions",
    "unavailable",
    "too_large",
  );
  assert.equal(tracked.events.includes("file.read"), false);
  tracked.assertClosed();
  await fs.writeFile(target, "x".repeat(limit));
  let grown = false;
  let requested = 0;
  tracked = instrument(workspace, {
    chunk: 2048,
    after: async (operation, detail, result) => {
      if (operation !== "file.read") return;
      assert.ok(detail.offset + detail.length <= limit + 1);
      requested += result.bytesRead;
      if (!grown) {
        grown = true;
        await fs.appendFile(target, "overflow");
      }
    },
  });
  refusal(
    await readConfigurationFile(workspace, "instructions", { io: tracked.io }),
    workspace,
    "instructions",
    "unavailable",
    "too_large",
  );
  assert.equal(requested, limit + 1);
  tracked.assertClosed();
});

test("file replacement, rewrite, unlink and hardlink creation during FD read are detected", async (t) => {
  for (const action of ["replace", "rewrite", "unlink", "hardlink", "symlink"])
    await t.test(action, async (t) => {
      const { parent, workspace, target } = await fixture(t);
      await fs.writeFile(target, "original-content");
      let changed = false;
      const tracked = instrument(workspace, {
        after: async (operation) => {
          if (operation !== "file.read" || changed) return;
          changed = true;
          if (action === "replace") {
            await fs.rename(target, join(parent, "old-file"));
            await fs.writeFile(target, "original-content");
          }
          if (action === "rewrite") {
            await fs.writeFile(target, "modified-content");
            await fs.utimes(target, 1, 1);
          }
          if (action === "unlink") await fs.unlink(target);
          if (action === "hardlink")
            await fs.link(target, join(parent, "second-link"));
          if (action === "symlink") {
            await fs.rename(target, join(parent, "old-file"));
            await fs.symlink(join(parent, "old-file"), target);
          }
        },
      });
      refusal(
        await readConfigurationFile(workspace, "instructions", {
          io: tracked.io,
        }),
        workspace,
        "instructions",
        "unavailable",
        "file_changed",
      );
      tracked.assertClosed();
    });
});

test("root identity replacement invalidates an unchanged held target FD", async (t) => {
  const { parent, workspace, target } = await fixture(t);
  await fs.writeFile(target, "same-content");
  let changed = false;
  const tracked = instrument(workspace, {
    after: async (operation) => {
      if (operation !== "file.read" || changed) return;
      changed = true;
      await fs.rename(workspace.path, join(parent, "old-root"));
      await fs.mkdir(workspace.path);
      await fs.writeFile(target, "same-content");
    },
  });
  refusal(
    await readConfigurationFile(workspace, "instructions", { io: tracked.io }),
    workspace,
    "instructions",
    "unavailable",
    "file_changed",
  );
  tracked.assertClosed();
});

test("unrelated directory timestamp changes do not reject a stable file", async (t) => {
  const { workspace, target } = await fixture(t);
  await fs.writeFile(target, "stable-content");
  let changed = false;
  const tracked = instrument(workspace, {
    after: async (operation) => {
      if (operation !== "file.read" || changed) return;
      changed = true;
      await fs.writeFile(
        join(workspace.path, "unrelated-synthetic"),
        "unrelated",
      );
    },
  });
  assert.equal(
    (await readConfigurationFile(workspace, "instructions", { io: tracked.io }))
      .content,
    "stable-content",
  );
  tracked.assertClosed();
});

test("missing observation rechecks root identity and target absence", async (t) => {
  for (const action of ["root", "target"])
    await t.test(action, async (t) => {
      const { parent, workspace, target } = await fixture(t);
      const tracked = instrument(workspace);
      const lstat = tracked.io.lstat;
      let changed = false;
      tracked.io.lstat = async (...args) => {
        try {
          return await lstat(...args);
        } catch (error) {
          if (args[0] === target && error.code === "ENOENT" && !changed) {
            changed = true;
            if (action === "root") {
              await fs.rename(workspace.path, join(parent, "old-root"));
              await fs.mkdir(workspace.path);
            } else await fs.writeFile(target, canary);
          }
          throw error;
        }
      };
      refusal(
        await readConfigurationFile(workspace, "instructions", {
          io: tracked.io,
        }),
        workspace,
        "instructions",
        "unavailable",
        "file_changed",
      );
      tracked.assertClosed();
    });
});

test("versions are stable observations and change with raw bytes, file or root identity and timestamps", async (t) => {
  const { parent, workspace, target } = await fixture(t);
  await fs.writeFile(target, "same-content");
  const read = () => readConfigurationFile(workspace, "instructions");
  let previous = (await read()).version;
  assert.equal((await read()).version, previous);
  for (const change of [
    () => fs.writeFile(target, "new-content"),
    () => fs.utimes(target, 10, 10),
    async () => {
      await fs.rename(target, join(parent, "old-target"));
      await fs.writeFile(target, "new-content");
    },
    async () => {
      await fs.rename(workspace.path, join(parent, "old-workspace"));
      await fs.mkdir(workspace.path);
      await fs.rename(join(parent, "old-workspace", "AGENTS.md"), target);
    },
  ]) {
    await change();
    const current = (await read()).version;
    assert.match(current, /^[a-f0-9]{64}$/);
    assert.notEqual(current, previous);
    previous = current;
  }
  // UTF8 BOM is preserved in content and is part of the raw-byte version.
  await fs.writeFile(
    target,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("BOM text")]),
  );
  assert.equal((await read()).content, "\ufeffBOM text");
});

test("admission failure propagates unchanged after every awaited IO, including open and cleanup", async (t) => {
  for (const code of ["READ_TIMEOUT", "CANCELLED", "STALE_EPOCH"]) {
    const { workspace, target } = await fixture(t);
    await fs.writeFile(target, "bounded-content");
    const baseline = instrument(workspace);
    await readConfigurationFile(workspace, "instructions", { io: baseline.io });
    baseline.assertClosed();
    for (let stop = 0; stop < baseline.events.length; stop++) {
      let completed = 0;
      let cancelled = false;
      const error = Object.assign(new Error("fixed synthetic admission"), {
        appCode: code,
      });
      const tracked = instrument(workspace, {
        after: () => {
          if (completed++ === stop) cancelled = true;
        },
      });
      await assert.rejects(
        readConfigurationFile(workspace, "instructions", {
          io: tracked.io,
          check: () => {
            if (cancelled) throw error;
          },
        }),
        (actual) => actual === error,
      );
      tracked.assertClosed();
    }
  }
});

test("admission surrounds successful and rejected IO; raw IO errors stay private", async (t) => {
  const { workspace, target } = await fixture(t);
  await fs.writeFile(target, "bounded-content");
  let checks = 0;
  const tracked = instrument(workspace, {
    after: () => {
      assert.ok(checks > 0);
      checks = 0;
    },
  });
  await readConfigurationFile(workspace, "instructions", {
    io: tracked.io,
    check: () => {
      checks++;
    },
  });
  assert.ok(checks > 0);
  tracked.assertClosed();
  const error = Object.assign(new Error(canary), { code: "EACCES" });
  const denied = instrument(workspace);
  denied.io.open = async () => {
    throw error;
  };
  refusal(
    await readConfigurationFile(workspace, "instructions", { io: denied.io }),
    workspace,
    "instructions",
    "unavailable",
    "path_denied",
  );
  const deadline = Object.assign(new Error("fixed deadline"), {
    appCode: "READ_TIMEOUT",
  });
  let expired = false;
  denied.io.open = async () => {
    expired = true;
    throw error;
  };
  await assert.rejects(
    readConfigurationFile(workspace, "instructions", {
      io: denied.io,
      check: () => {
        if (expired) throw deadline;
      },
    }),
    (actual) => actual === deadline,
  );
});

test("short EOF, read errors and inconsistent byte counts fail closed and close both FDs", async (t) => {
  const { workspace, target } = await fixture(t);
  await fs.writeFile(target, "bounded-content");
  for (const readResult of [
    () => ({ bytesRead: 0 }),
    () => ({ bytesRead: -1 }),
    () => ({ bytesRead: limit + 2 }),
    () => ({ bytesRead: 0.5 }),
    () => {
      throw new Error(canary);
    },
  ]) {
    const tracked = instrument(workspace, { readResult });
    const result = await readConfigurationFile(workspace, "instructions", {
      io: tracked.io,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(Object.hasOwn(result, "content"), false);
    assert.equal(Object.hasOwn(result, "version"), false);
    assert.equal(JSON.stringify(result).includes(canary), false);
    tracked.assertClosed();
  }
});
