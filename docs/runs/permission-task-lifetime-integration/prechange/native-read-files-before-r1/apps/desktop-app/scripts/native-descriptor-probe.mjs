// Owned file/directory kernel probe. Never starts Native, providers or a server.
// --prepare copies a pinned engine and records inputs; it does not execute it.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(import.meta.url);
const repo = resolve(dirname(script), "../../..");
const pinnedEngine = join(
  repo,
  "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/runtime/bun",
);
const engineSha256 =
  "35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5";
const inputs = [
  "apps/desktop-app/scripts/native-descriptor-probe.mjs",
  "apps/desktop-app/src/host/native-descriptor-read.mjs",
  "apps/desktop-app/src/host/native-descriptor-read-resource.mjs",
  "apps/desktop-app/src/host/darwin-descriptor-ffi.mjs",
  "apps/desktop-app/src/host/darwin-directory-entry.mjs",
  "apps/desktop-app/src/host/workspace-root-authority.mjs",
  "apps/desktop-app/src/renderer/shared/workspace-file/index.mjs",
  "apps/desktop-app/runtime-event-host/installer-pins.json",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fingerprints = () =>
  Object.fromEntries(
    inputs.map((name) => [name, hash(fs.readFileSync(join(repo, name)))]),
  );
const write = (path, value) =>
  fs.writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const load = (name) =>
  import(pathToFileURL(join(repo, "apps/desktop-app/src/host", name)).href);
function readOwnedJSON(root, name, limit = 65536, binding = false) {
  const path = join(root, name),
    before = fs.lstatSync(path, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.uid, BigInt(process.getuid()));
  assert.equal(before.nlink, 1n);
  assert.equal(before.mode & 0o777n, 0o600n);
  assert.ok(before.size <= BigInt(limit));
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const held = fs.fstatSync(fd, { bigint: true });
    assert.equal(held.dev, before.dev);
    assert.equal(held.ino, before.ino);
    const bytes = Buffer.alloc(limit + 1);
    let count = 0,
      read;
    do {
      read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      count += read;
    } while (read > 0 && count < bytes.length);
    assert.ok(count <= limit);
    const after = fs.fstatSync(fd, { bigint: true });
    for (const key of [
      "dev",
      "ino",
      "size",
      "mtimeNs",
      "ctimeNs",
      "mode",
      "nlink",
    ])
      assert.equal(after[key], before[key]);
    const raw = bytes.subarray(0, count);
    const value = JSON.parse(raw.toString("utf8"));
    return binding ? { value, sha256: hash(raw) } : value;
  } finally {
    fs.closeSync(fd);
  }
}
function marker(root) {
  assert.equal(root, fs.realpathSync(root));
  assert.ok(basename(root).startsWith("omoc-descriptor-probe-"));
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, 0o700);
  const value = readOwnedJSON(root, "marker.json", 4096);
  assert.deepEqual(Object.keys(value).sort(), ["nonce", "root"]);
  assert.equal(value.root, root);
  assert.match(value.nonce, /^[a-f0-9-]{36}$/);
  return value;
}
function prepare() {
  assert.equal(process.release.name, "node");
  assert.equal(globalThis.Bun, undefined);
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const before = fingerprints();
  const pins = JSON.parse(fs.readFileSync(join(repo, inputs.at(-1)), "utf8"));
  assert.equal(pins.bun.version, "1.4.2");
  assert.equal(pins.bun.binarySha256, engineSha256);
  const stat = fs.lstatSync(pinnedEngine);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(hash(fs.readFileSync(pinnedEngine)), engineSha256);
  const root = fs.mkdtempSync(
    join(fs.realpathSync(tmpdir()), "omoc-descriptor-probe-"),
  );
  fs.chmodSync(root, 0o700);
  for (const name of ["home", "tmp", "config", "cache", "data", "state"])
    fs.mkdirSync(join(root, name), { mode: 0o700 });
  const nonce = randomUUID();
  write(join(root, "marker.json"), { root, nonce });
  const engine = join(root, "bun");
  fs.copyFileSync(pinnedEngine, engine, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(engine, 0o500);
  assert.equal(hash(fs.readFileSync(engine)), engineSha256);
  assert.deepEqual(fingerprints(), before);
  const input = {
    schemaVersion: 1,
    kind: "owned-descriptor-kernel-probe",
    root,
    nonce,
    engineSha256,
    sourceHashes: before,
    argv: [engine, "--no-install", "--no-env-file", script, "--fixture", root],
    environment: {
      PATH: "/usr/bin:/bin",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
      OMOC_DESCRIPTOR_PROBE_NONCE: nonce,
    },
    timeoutMs: 30000,
    limits:
      "Source/engine before-after hashes are not an OS sandbox or change-and-restore proof. Synthetic namespaces retained. No Native/provider/server or task execution approval.",
  };
  write(join(root, "input.json"), input);
  const inputSha256 = readOwnedJSON(root, "input.json", 65536, true).sha256;
  process.stdout.write(
    JSON.stringify({
      prepared: true,
      executed: false,
      input: join(root, "input.json"),
      command: [
        process.execPath,
        script,
        "--execute",
        join(root, "input.json"),
        "--input-sha256",
        inputSha256,
      ],
    }) + "\n",
  );
}
function execute(inputPath, expectedInputSha256) {
  assert.equal(process.release.name, "node");
  assert.equal(globalThis.Bun, undefined);
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(inputPath, resolve(inputPath));
  assert.equal(basename(inputPath), "input.json");
  const root = dirname(inputPath),
    owned = marker(root);
  assert.match(expectedInputSha256, /^[a-f0-9]{64}$/);
  const captured = readOwnedJSON(root, "input.json", 65536, true);
  assert.equal(captured.sha256, expectedInputSha256);
  const input = captured.value;
  assert.deepEqual(Object.keys(input).sort(), [
    "argv",
    "engineSha256",
    "environment",
    "kind",
    "limits",
    "nonce",
    "root",
    "schemaVersion",
    "sourceHashes",
    "timeoutMs",
  ]);
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.kind, "owned-descriptor-kernel-probe");
  assert.equal(input.root, root);
  assert.equal(input.nonce, owned.nonce);
  assert.equal(input.engineSha256, engineSha256);
  assert.equal(input.timeoutMs, 30000);
  assert.deepEqual(input.argv, [
    join(root, "bun"),
    "--no-install",
    "--no-env-file",
    script,
    "--fixture",
    root,
  ]);
  assert.deepEqual(Object.keys(input.sourceHashes).sort(), [...inputs].sort());
  assert.deepEqual(fingerprints(), input.sourceHashes);
  const environment = {
    PATH: "/usr/bin:/bin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    OMOC_DESCRIPTOR_PROBE_NONCE: owned.nonce,
  };
  assert.deepEqual(input.environment, environment);
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "bun",
    "cache",
    "config",
    "data",
    "home",
    "input.json",
    "marker.json",
    "state",
    "tmp",
  ]);
  for (const name of ["home", "tmp", "config", "cache", "data", "state"]) {
    const path = join(root, name),
      stat = fs.lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(path), path);
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(path), []);
  }
  const engine = join(root, "bun"),
    engineStat = fs.lstatSync(engine);
  assert.ok(engineStat.isFile() && !engineStat.isSymbolicLink());
  assert.equal(engineStat.uid, process.getuid());
  assert.equal(engineStat.nlink, 1);
  assert.equal(engineStat.mode & 0o777, 0o500);
  assert.equal(hash(fs.readFileSync(engine)), engineSha256);
  assert.equal(hash(fs.readFileSync(pinnedEngine)), engineSha256);
  // Exclusive intent prevents replay after parent interruption or ambiguous exit.
  write(join(root, "execution-intent.json"), {
    inputSha256: captured.sha256,
    sourceHashes: input.sourceHashes,
    engineSha256,
    argv: input.argv,
  });
  const child = spawnSync(engine, input.argv.slice(1), {
    cwd: root,
    env: environment,
    stdio: "ignore",
    timeout: input.timeoutMs,
    killSignal: "SIGKILL",
  });
  let sourceStable = false,
    engineStable = false;
  try {
    sourceStable =
      JSON.stringify(fingerprints()) === JSON.stringify(input.sourceHashes);
  } catch {
    /* Missing/changed inputs must still produce failure metadata. */
  }
  try {
    engineStable =
      hash(fs.readFileSync(engine)) === engineSha256 &&
      hash(fs.readFileSync(pinnedEngine)) === engineSha256;
  } catch {
    /* Preserve actual child exit even when bytes cannot be read back. */
  }
  let result;
  try {
    result = readOwnedJSON(root, "fixture-result.json");
  } catch {
    result = undefined;
  }
  const passed =
    child.status === 0 &&
    !child.signal &&
    !child.error &&
    sourceStable &&
    engineStable &&
    result?.passed === true;
  write(join(root, "execution.json"), {
    passed,
    pid: child.pid,
    exitCode: child.status,
    signal: child.signal,
    errorCode: child.error?.code,
    sourceStable,
    engineStable,
    result,
    namespaceRetained: root,
    limits: input.limits,
  });
  process.stdout.write(
    JSON.stringify({
      passed,
      report: join(root, "execution.json"),
      namespaceRetained: root,
    }) + "\n",
  );
  if (!passed) process.exitCode = 1;
}
function fds() {
  return fs
    .readdirSync("/dev/fd")
    .flatMap((name) => {
      if (!/^\d+$/.test(name)) return [];
      try {
        const stat = fs.fstatSync(Number(name), { bigint: true });
        return [[name, String(stat.dev), String(stat.ino), String(stat.mode)]];
      } catch {
        return [];
      } // The enumeration's own temporary FD is already closed.
    })
    .sort((a, b) => Number(a[0]) - Number(b[0]));
}
async function fixture(root) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(fs.realpathSync(process.cwd()), root);
  const owned = marker(root);
  assert.equal(process.env.OMOC_DESCRIPTOR_PROBE_NONCE, owned.nonce);
  assert.ok(fs.existsSync(join(root, "execution-intent.json")));
  const { createNativeDescriptorReadKernel, nativeDescriptorPathKind } =
    await load("native-descriptor-read.mjs");
  const { createWorkspaceRootAuthority } = await load(
    "workspace-root-authority.mjs",
  );
  const { createNativeDescriptorRead, observeNativeDescriptorRead } =
    await load("native-descriptor-read-resource.mjs");
  const cases = [];
  let sequence = 0;
  async function run(name, body, options = {}) {
    const caseRoot = join(root, "case-" + ++sequence);
    fs.mkdirSync(caseRoot, { mode: 0o700 });
    const path = join(caseRoot, "workspace");
    fs.mkdirSync(path);
    fs.mkdirSync(join(path, "nested"));
    fs.writeFileSync(join(path, "note.txt"), "synthetic bytes\r\n");
    const workspace = { id: "probe_" + sequence, path };
    const owner = await createWorkspaceRootAuthority(workspace);
    let kernel, failure;
    const authority = { callback: () => {} };
    const before = fds();
    try {
      if (options.kernel !== false)
        kernel = await createNativeDescriptorReadKernel(workspace, {
          checkRoot: owner.assertOpened,
          check: () => authority.callback(),
        });
      await body({ root: caseRoot, workspace, owner, kernel, authority });
    } catch (error) {
      failure = {
        stage: "case_body",
        kind: error?.name ?? "Error",
        code: [
          "native_permission_file_unverified",
          "native_permission_path_kind",
          "unsupported_directory_entry",
          "unsupported_file",
          "invalid_request",
        ].includes(error?.message)
          ? error.message
          : undefined,
      };
    } finally {
      try {
        kernel?.close();
      } catch {
        failure = "KernelCleanupUnverified";
      }
      await owner.close();
    }
    await new Promise((done) => setImmediate(done));
    // Owner FD existed in before; compare the same ownership interval by
    // taking the post-close owner out of the baseline via actual inode identity.
    const after = fds();
    const rootStat = fs.statSync(workspace.path, { bigint: true });
    const baseline = before.filter(
      (row) =>
        !(row[1] === String(rootStat.dev) && row[2] === String(rootStat.ino)),
    );
    const ownerDescriptors = before.length - baseline.length;
    if (ownerDescriptors !== 1)
      failure = {
        stage: "descriptor_baseline",
        kind: "OwnerDescriptorBaselineUnverified",
      };
    const closed = JSON.stringify(baseline) === JSON.stringify(after);
    cases.push({
      name,
      passed: !failure && closed,
      failure,
      descriptorsReturnedToBaseline: closed,
      ownerDescriptors,
      baselineFDs: baseline.length,
      finalFDs: after.length,
    });
  }
  // Warm FFI, directory enumeration and runtime internals before comparing FDs.
  await run("warmup", async ({ kernel }) => {
    kernel.read("note.txt");
    kernel.list();
  });
  await run(
    "exact byte pages and immutable original identity",
    async ({ workspace, kernel }) => {
      const data = Buffer.from("\uFEFF" + "line\r\n".repeat(50000));
      fs.writeFileSync(join(workspace.path, "nested", "large.txt"), data);
      const first = kernel.read("nested/large.txt");
      const second = kernel.read("nested/large.txt", {
        offset: first.bytes.length,
        length: data.length - first.bytes.length,
        identity: first.identity,
      });
      assert.deepEqual(Buffer.concat([first.bytes, second.bytes]), data);
      fs.writeFileSync(join(workspace.path, "nested", "large.txt"), "changed");
      assert.throws(() =>
        kernel.read("nested/large.txt", { identity: first.identity }),
      );
    },
  );
  await run(
    "root and nested directory records preserve names/kinds",
    async ({ workspace, kernel }) => {
      fs.writeFileSync(join(workspace.path, "한글.txt"), "owned");
      fs.symlinkSync("note.txt", join(workspace.path, "alias.txt"));
      const rows = kernel.list();
      assert.ok(Object.isFrozen(rows));
      assert.deepEqual(
        rows.find((row) => row.name === "한글.txt"),
        { name: "한글.txt", type: "file" },
      );
      assert.equal(rows.find((row) => row.name === "nested").type, "directory");
      assert.equal(
        rows.find((row) => row.name === "alias.txt").type,
        "symlink",
      );
      assert.deepEqual(kernel.list("nested"), []);
    },
  );
  await run(
    "wrong kind is privately classified after original cleanup",
    async ({ kernel }) => {
      assert.throws(
        () => kernel.read("nested"),
        (error) => nativeDescriptorPathKind(error) === "directory",
      );
      assert.throws(
        () => kernel.list("note.txt"),
        (error) => nativeDescriptorPathKind(error) === "file",
      );
      assert.equal(
        nativeDescriptorPathKind(
          Object.assign(new Error("native_permission_path_kind"), {
            kind: "file",
          }),
        ),
        undefined,
      );
    },
  );
  await run(
    "traversal/symlink/hardlink have no outside content effect",
    async ({ root: caseRoot, workspace, kernel }) => {
      const outside = join(caseRoot, "outside.txt");
      fs.writeFileSync(outside, "OWNED_OUTSIDE_SENTINEL");
      const before = hash(fs.readFileSync(outside));
      fs.symlinkSync(outside, join(workspace.path, "alias"));
      fs.linkSync(outside, join(workspace.path, "hard"));
      for (const path of ["../outside.txt", outside, "alias", "hard"])
        assert.throws(() => kernel.read(path));
      assert.throws(() => kernel.list("alias"));
      assert.equal(hash(fs.readFileSync(outside)), before);
    },
  );
  await run(
    "observed root replacement cannot resurrect any shared authority",
    async ({ root: caseRoot, workspace, owner, kernel }) => {
      const moved = join(caseRoot, "moved");
      fs.renameSync(workspace.path, moved);
      fs.mkdirSync(workspace.path);
      try {
        assert.throws(() => kernel.read("note.txt"));
      } finally {
        fs.rmdirSync(workspace.path);
        fs.renameSync(moved, workspace.path);
      }
      assert.throws(() => kernel.read("note.txt"));
      await assert.rejects(owner.assertCurrent());
    },
  );
  await run(
    "directory changed after stream close cannot publish old rows",
    async ({ workspace, kernel, authority }) => {
      const target = join(workspace.path, "nested"),
        stat = fs.statSync(target, { bigint: true });
      let saw = false,
        changed = false;
      authority.callback = () => {
        const active = fds().some(
          (row) => row[1] === String(stat.dev) && row[2] === String(stat.ino),
        );
        if (active) saw = true;
        else if (saw && !changed) {
          changed = true;
          fs.writeFileSync(join(target, "late.txt"), "OWNED_EXTERNAL_CHANGE");
        }
      };
      assert.throws(() => kernel.list("nested"));
      assert.equal(changed, true);
    },
  );
  await run(
    "whole directory budget refuses instead of returning a partial list",
    async ({ workspace, kernel }) => {
      for (let i = 0; i < 4097; i++)
        fs.writeFileSync(join(workspace.path, "nested", "entry-" + i), "");
      assert.throws(() => kernel.list("nested"), /directory_too_large/);
    },
  );
  await run(
    "actual resource retains original file IO through reentrant cancellation",
    async ({ workspace, owner, authority }) => {
      const stat = fs.statSync(join(workspace.path, "note.txt"), {
        bigint: true,
      });
      let cancelled = false,
        reader;
      reader = createNativeDescriptorRead(workspace, {
        checkRoot: owner.assertOpened,
        check: () => authority.callback(),
      });
      const completion = observeNativeDescriptorRead(reader.resource);
      const access = await reader.ready;
      authority.callback = () => {
        if (
          !cancelled &&
          fds().some(
            (row) => row[1] === String(stat.dev) && row[2] === String(stat.ino),
          )
        ) {
          cancelled = true;
          reader.cancel();
        }
      };
      assert.throws(() => access.read("note.txt"));
      assert.equal(cancelled, true);
      assert.deepEqual(await completion, { complete: true });
      assert.deepEqual(await reader.close(), { complete: true });
    },
    { kernel: false },
  );
  await run(
    "actual resource owns directory stream through its final close",
    async ({ workspace, owner }) => {
      const reader = createNativeDescriptorRead(workspace, {
        checkRoot: owner.assertOpened,
        check() {},
      });
      const completion = observeNativeDescriptorRead(reader.resource);
      const access = await reader.ready;
      assert.ok(access.list().some((row) => row.name === "note.txt"));
      assert.deepEqual(await reader.close(), { complete: true });
      assert.deepEqual(await completion, { complete: true });
    },
    { kernel: false },
  );
  const passed = cases.every((row) => row.passed);
  write(join(root, "fixture-result.json"), {
    passed,
    bunVersion: globalThis.Bun.version,
    cases,
    limits:
      "Owned physical file/directory smoke only; not Native execution, task authority, OS sandbox, power-loss or same-user change-and-restore proof. No provider/server/private originals. Node scripted tests supply failure-injection timing evidence separately.",
  });
  if (!passed) process.exitCode = 1;
}
const [mode, input, flag, expectedInputSha256] = process.argv.slice(2);
if (mode === "--prepare" && input === undefined) prepare();
else if (
  mode === "--execute" &&
  typeof input === "string" &&
  flag === "--input-sha256" &&
  typeof expectedInputSha256 === "string" &&
  process.argv.length === 6
)
  execute(input, expectedInputSha256);
else if (
  mode === "--fixture" &&
  typeof input === "string" &&
  process.argv.length === 4
)
  await fixture(input).catch((error) => {
    try {
      const owned = marker(input);
      assert.equal(owned.nonce, process.env.OMOC_DESCRIPTOR_PROBE_NONCE);
      write(join(input, "fixture-result.json"), {
        passed: false,
        fatal: error?.name ?? "Error",
        limits: "Controlled probe failed; no acceptance claim.",
      });
    } catch {
      /* Parent preserves missing-report/exit failure metadata. */
    }
    process.exitCode = 1;
  });
else
  throw new Error(
    "Use --prepare or a separately reviewed --execute input.json",
  );
