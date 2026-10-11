import assert from "node:assert/strict";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { readSkillFile } from "./workbench-skills.mjs";
import { readAgentFile } from "./workbench-agents.mjs";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";
import { createConfigurationSaveKernel } from "./configuration-save-kernel.mjs";
import {
  configurationBackupId,
  configurationFileVersion,
} from "./configuration-file-observation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const evidence =
  process.env.OMOC_KERNEL_EVIDENCE ??
  join(tmpdir(), "omoc-configuration-skill-files-kernel-r2");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (process.argv[2] === "--kernel-fixture") {
  await fixture(process.argv[3]);
} else {
  const { test } = await import("node:test");
  test("Node import is inert; factory refuses Node and closed options", async () => {
    assert.deepEqual(
      Object.keys(await import("./configuration-save-kernel.mjs")),
      ["createConfigurationSaveKernel"],
    );
    await assert.rejects(createConfigurationSaveKernel(), {
      message: "unsupported_runtime",
    });
    await assert.rejects(createConfigurationSaveKernel({ io: {} }), {
      message: "invalid_request",
    });
    let touched = false;
    const accessor = {
      get check() {
        touched = true;
        throw new Error("PRIVATE");
      },
    };
    await assert.rejects(createConfigurationSaveKernel(accessor), {
      message: "invalid_request",
    });
    assert.equal(touched, false);
    await assert.rejects(
      createConfigurationSaveKernel(
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("PRIVATE");
            },
          },
        ),
      ),
      { message: "invalid_request" },
    );
  });

  test(
    "owned production kernel on manifest-verified app-staged pinned Bun",
    { timeout: 60000 },
    async (t) => {
      assert.equal(process.platform, "darwin");
      assert.equal(process.arch, "arm64");
      const { eventHostForResources, verifyEventHostResources } = await import(
        "../event-host-resources.mjs"
      );
      const descriptor = eventHostForResources(
        join(repo, "apps/desktop-app/dist/resources"),
        process.platform,
        process.arch,
      );
      // Actual full resource manifest/locked package validation, without loading the host.
      const manifest = await verifyEventHostResources(descriptor);
      const pins = JSON.parse(
        fs.readFileSync(
          join(repo, "apps/desktop-app/runtime-event-host/installer-pins.json"),
          "utf8",
        ),
      );
      const bunHash = hash(fs.readFileSync(descriptor.enginePath));
      assert.equal(bunHash, pins.bun.binarySha256);
      assert.equal(
        manifest.entries.find((e) => e.path === "runtime/bun").sha256,
        bunHash,
      );
      const freeze = JSON.parse(
        fs.readFileSync(
          join(
            repo,
            "docs/runs/configuration-save/kernel-helper-freeze-r1.json",
          ),
          "utf8",
        ),
      );
      // Freeze current source bytes for this execution; historical records stay intact.
      freeze.sourceHashes = Object.fromEntries(
        [
          ...Object.keys(freeze.sourceHashes),
          "apps/desktop-app/src/renderer/shared/configuration-draft/skill.mjs",
          "apps/desktop-app/src/host/workbench-skills.mjs",
          "apps/desktop-app/src/host/workbench-agents.mjs",
          "apps/desktop-app/src/host/configuration-source-files.mjs",
          "apps/desktop-app/src/renderer/shared/configuration-draft/agent.mjs",
          "apps/desktop-app/src/host/configuration-save-kernel.mjs",
          "apps/desktop-app/src/host/workbench-file-edit.mjs",
          "apps/desktop-app/src/renderer/shared/workspace-file/index.mjs",
        ].map((path) => [path, hash(fs.readFileSync(join(repo, path)))]),
      );
      fs.mkdirSync(evidence, { recursive: true });
      const root = fs.mkdtempSync(
        join(fs.realpathSync(evidence), "synthetic-"),
      );
      fs.mkdirSync(join(root, "home"), { mode: 0o700 });
      fs.mkdirSync(join(root, "tmp"), { mode: 0o700 });
      const child = spawnSync(
        descriptor.enginePath,
        [fileURLToPath(import.meta.url), "--kernel-fixture", root],
        {
          cwd: root,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: join(root, "home"),
            TMPDIR: join(root, "tmp"),
            OMOC_KERNEL_EVIDENCE: fs.realpathSync(evidence),
          },
          encoding: "utf8",
          timeout: 40000,
          maxBuffer: 1024 * 1024,
        },
      );
      // The child emits only fixed test labels/results, never document or attribute values.
      fs.writeFileSync(
        join(root, "execution.json"),
        JSON.stringify(
          {
            status: child.status,
            signal: child.signal,
            stdout: child.stdout,
            stderr: child.stderr,
          },
          null,
          2,
        ),
      );
      assert.equal(child.error, undefined);
      assert.equal(
        child.status,
        0,
        `Synthetic fixture failed; inspect ${root}/execution.json`,
      );
      const result = JSON.parse(child.stdout);
      assert.equal(result.bunVersion, "1.4.2");
      assert.equal(result.result, "pass");
      for (const observation of result.observations) {
        await t.test(observation.name, () =>
          assert.equal(observation.status, "pass"),
        );
      }
      const { readConfigurationFile } = await import(
        "./workbench-configuration-files.mjs"
      );
      for (const saved of result.savedObservations) {
        await t.test(
          `actual-Node-reader-parity-${saved.kind}-${saved.workspaceId}`,
          async () => {
            const workspace = {
              id: saved.workspaceId,
              path: saved.workspacePath,
            };
            const observed =
              saved.kind === "file"
                ? await readWorkspaceFile(workspace, saved.path)
                : saved.kind === "skill"
                  ? await readSkillFile(workspace, saved.sourceName)
                  : saved.kind === "agent"
                    ? await readAgentFile(workspace, saved.sourceName)
                    : await readConfigurationFile(workspace, saved.kind);
            assert.equal(observed.status, "available");
            assert.equal(observed.version, saved.version);
          },
        );
      }
      assert.equal(hash(fs.readFileSync(descriptor.enginePath)), bunHash);
      for (const [path, sha] of Object.entries(freeze.sourceHashes))
        assert.equal(hash(fs.readFileSync(join(repo, path))), sha);
      fs.writeFileSync(
        join(root, "verification.json"),
        JSON.stringify(
          {
            result: "pass",
            platform: process.platform,
            arch: process.arch,
            engineSha256: bunHash,
            manifestSha256: hash(fs.readFileSync(descriptor.manifestPath)),
            helperHashes: freeze.sourceHashes,
            kernelSha256: hash(
              fs.readFileSync(join(here, "configuration-save-kernel.mjs")),
            ),
            testSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
            observations: result.observations,
            actualNodeReaderParity: result.savedObservations.length,
            scope:
              "Owned production kernel only; synthetic files retained; no EventHost/server/provider/Electron/database loaded.",
          },
          null,
          2,
        ),
      );
      t.diagnostic(`Retained synthetic evidence: ${root}`);
    },
  );
}

async function fixture(root) {
  assert.ok(
    root &&
      fs.realpathSync(root) === root &&
      root.startsWith(`${fs.realpathSync(evidence)}/synthetic-`),
  );
  const { dlopen, ptr } = await import("bun:ffi");
  const lib = dlopen("/usr/lib/libSystem.B.dylib", {
    fcntl: { args: ["i32", "i32"], returns: "i32" },
    fsetxattr: {
      args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
      returns: "i32",
    },
    fgetxattr: {
      args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
      returns: "i64",
    },
  });
  const fdSet = () =>
    Array.from({ length: 512 }, (_, i) => i + 3).filter(
      (fd) => lib.symbols.fcntl(fd, 1) >= 0,
    );
  const warm = await createConfigurationSaveKernel();
  fs.mkdirSync(join(root, "warm"));
  const warmPrepared = warm.prepare({
    runtimeEpoch: "warm",
    operationId: "warm",
    workspaceId: "warm",
    workspacePath: join(root, "warm"),
    kind: "instructions",
    text: "SYNTHETIC",
    expectation: "missing",
  });
  assert.equal(warmPrepared.status, "staged", warmPrepared.reason);
  warm.abort({ token: warmPrepared.token });
  warm.close();
  // Warm Bun's process/event-loop internals before measuring kernel descriptors.
  assert.equal(spawnSync("/usr/bin/true", [], { stdio: "ignore" }).status, 0);
  await new Promise((done) => setTimeout(done, 1));
  const baseline = fdSet();
  const observations = [];
  const savedObservations = [];
  let serial = 0;
  const kernels = [];
  async function kernel(opts) {
    const k = await createConfigurationSaveKernel(opts);
    kernels.push(k);
    return k;
  }
  function make(
    name,
    {
      kind = "instructions",
      missing = false,
      body = "SYNTHETIC-ORIGINAL",
      mode = 0o640,
    } = {},
  ) {
    const dir = join(root, `${++serial}-${name}`);
    fs.mkdirSync(dir, { mode: 0o700 });
    const target = join(
      dir,
      kind === "instructions" ? "AGENTS.md" : "opencode.json",
    );
    if (!missing) fs.writeFileSync(target, body, { mode });
    return { dir, target, kind };
  }
  function request(f, text = "SYNTHETIC-NEW", overrides = {}) {
    const base = {
      runtimeEpoch: "synthetic-epoch",
      operationId: `operation-${serial}`,
      workspaceId: `workspace-${serial}`,
      workspacePath: f.dir,
      kind: f.kind,
      text,
    };
    return fs.existsSync(f.target)
      ? {
          ...base,
          expectation: "version",
          version: configurationFileVersion(
            { ...base, path: f.target },
            fs.statSync(f.dir, { bigint: true }),
            fs.statSync(f.target, { bigint: true }),
            fs.readFileSync(f.target),
          ),
          ...overrides,
        }
      : { ...base, expectation: "missing", ...overrides };
  }
  const backup = (r) =>
    join(
      r.workspacePath,
      configurationBackupId(r.runtimeEpoch, r.operationId, r.kind),
    );
  function staged(k, r) {
    const p = k.prepare(r);
    if (p.status !== "staged") {
      const failure = new Error("stage_failed");
      failure.kernelReason = p.reason;
      throw failure;
    }
    assert.match(p.token, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(p).sort(), ["status", "token"]);
    return p;
  }
  const unknown = (r, reason) => {
    assert.equal(r.status, "unknown");
    if (reason) assert.equal(r.reason, reason);
    assert.deepEqual(Object.keys(r).sort(), ["reason", "status"]);
  };
  function xattr(path, name, value) {
    const fd = fs.openSync(
      path,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const nb = Buffer.from(`${name}\0`),
        vb = Buffer.from(value);
      assert.equal(
        lib.symbols.fsetxattr(
          fd,
          ptr(nb),
          ptr(vb.length ? vb : Buffer.alloc(1)),
          vb.length,
          0,
          0,
        ),
        0,
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  function readAttr(path, name) {
    const fd = fs.openSync(
      path,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const nb = Buffer.from(`${name}\0`),
        value = Buffer.alloc(32768);
      const n = Number(
        lib.symbols.fgetxattr(fd, ptr(nb), ptr(value), value.length, 0, 0),
      );
      assert.ok(n >= 0);
      return value.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  }
  async function run(name, fn) {
    try {
      await fn();
      for (const k of kernels.splice(0)) {
        k.close();
        k.close();
      }
      assert.deepEqual(fdSet(), baseline);
      observations.push({ name, status: "pass", fdCleanup: true });
    } catch (failure) {
      for (const k of kernels.splice(0)) {
        try {
          k.close();
        } catch {
          /* Preserve failure evidence even if cleanup fails. */
        }
      }
      // No assertions containing raw bodies are serialized.
      fs.writeFileSync(
        join(root, "failed-case.json"),
        JSON.stringify(
          {
            name,
            failureCode: failure.code,
            kernelReason: failure.kernelReason,
            location: failure.stack
              ?.split("\n")
              .filter((line) => /^\s+at /.test(line))
              .slice(0, 4),
            baselineFDs: baseline,
            observedFDs: fdSet(),
            completed: observations,
            fdCleanup: JSON.stringify(fdSet()) === JSON.stringify(baseline),
          },
          null,
          2,
        ),
      );
      throw new Error(`Synthetic kernel case failed: ${name}`);
    }
  }
  async function skillFixture(name, content = "# Original\n", kind = "skill") {
    const f = make(name, { missing: true });
    f.kind = kind;
    f.sourceName = "example";
    f.parent =
      kind === "skill"
        ? join(f.dir, ".opencode", "skills", f.sourceName)
        : join(f.dir, ".opencode", "agents");
    fs.mkdirSync(f.parent, { recursive: true });
    f.target = join(
      f.parent,
      kind === "skill" ? "SKILL.md" : `${f.sourceName}.md`,
    );
    if (content !== null) fs.writeFileSync(f.target, content, { mode: 0o640 });
    const workspace = { id: `workspace-${serial}`, path: f.dir };
    const baseline = await (kind === "skill" ? readSkillFile : readAgentFile)(
      workspace,
      f.sourceName,
    );
    assert.equal(baseline.status, content === null ? "missing" : "available");
    f.request = {
      runtimeEpoch: "synthetic-epoch",
      operationId: `operation-${serial}`,
      workspaceId: workspace.id,
      workspacePath: f.dir,
      kind,
      sourceName: f.sourceName,
      text: "# New\n",
      directoryVersion: baseline.directoryVersion,
      expectation: content === null ? "missing" : "version",
      ...(content === null ? {} : { version: baseline.version }),
    };
    f.backup = join(
      f.parent,
      configurationBackupId(
        f.request.runtimeEpoch,
        f.request.operationId,
        kind,
      ),
    );
    return f;
  }
  async function fileFixture(
    name,
    original = "\uFEFFOriginal\r\n\r\n",
    path = "one/two/note.txt",
  ) {
    const f = make(name, { missing: true });
    f.kind = "file";
    f.path = path;
    f.target = join(f.dir, path);
    f.parent = dirname(f.target);
    fs.mkdirSync(f.parent, { recursive: true });
    fs.writeFileSync(f.target, original, { mode: 0o640 });
    const workspace = { id: `workspace-${serial}`, path: f.dir };
    const baseline = await readWorkspaceFile(workspace, path);
    assert.equal(baseline.status, "available");
    f.request = {
      runtimeEpoch: "synthetic-epoch",
      operationId: `operation-${serial}`,
      workspaceId: workspace.id,
      workspacePath: f.dir,
      kind: "file",
      path,
      text: "\uFEFFNew\r\n\r\n",
      expectation: "version",
      version: baseline.version,
      directoryVersion: baseline.directoryVersion,
    };
    f.backup = join(
      f.parent,
      configurationBackupId(
        f.request.runtimeEpoch,
        f.request.operationId,
        "file",
      ),
    );
    return f;
  }
  try {
    await run(
      "file-existing-only-exact-bytes-mode-backup-reader-parity-64KiB",
      async () => {
        for (const text of ["", "\uFEFFNew\r\n\r\n", "a".repeat(65536)]) {
          const f = await fileFixture("file-exact"),
            k = await kernel();
          f.request.text = text;
          const p = staged(k, f.request);
          assert.equal(fdSet().length, baseline.length + 5);
          for (const fd of fdSet().filter((fd) => !baseline.includes(fd)))
            assert.equal(lib.symbols.fcntl(fd, 1) & 1, 1);
          const saved = k.publish({ token: p.token });
          assert.equal(saved.status, "saved");
          assert.equal(
            saved.backupId,
            configurationBackupId(
              f.request.runtimeEpoch,
              f.request.operationId,
              "file",
            ),
          );
          assert.equal(fs.readFileSync(f.target, "utf8"), text);
          assert.equal(
            fs.readFileSync(f.backup, "utf8"),
            "\uFEFFOriginal\r\n\r\n",
          );
          assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
          const read = await readWorkspaceFile(
            { id: f.request.workspaceId, path: f.dir },
            f.path,
          );
          assert.equal(saved.version, read.version);
          savedObservations.push({
            kind: "file",
            workspaceId: f.request.workspaceId,
            workspacePath: f.dir,
            path: f.path,
            version: saved.version,
          });
          unknown(k.publish({ token: p.token }), "invalid_token");
        }
      },
    );
    await run(
      "file-closed-request-grammar-and-text-budget-no-stage",
      async () => {
        const f = await fileFixture("file-grammar"),
          k = await kernel();
        for (const changes of [
          { expectation: "missing", version: undefined },
          { expectation: undefined },
          { version: undefined },
          { directoryVersion: undefined },
          { sourceName: "other" },
          { path: "../escape" },
          { path: "one//two/note.txt" },
          { path: "one/CON.txt" },
          { path: "one/AGENTS.md" },
          { path: ".agents/note.txt" },
          { path: ".env" },
          { path: "x/" + "a".repeat(256) },
          { path: "a/".repeat(32) + "x" },
          { path: Array(9).fill("a".repeat(250)).join("/") },
          { workspacePath: "/" + "한".repeat(1366) },
          { workspacePath: f.dir + "/../other" },
          { workspaceId: "a".repeat(129) },
          { text: "a".repeat(65537) },
          { text: "한".repeat(21846) },
          { text: "\uD800" },
          { text: "\0" },
          { text: "\u007f" },
        ])
          unknown(k.prepare({ ...f.request, ...changes }), "invalid_request");
        const { version: _version, ...missing } = f.request;
        unknown(
          k.prepare({ ...missing, expectation: "missing" }),
          "invalid_request",
        );
        assert.equal(fs.existsSync(f.backup), false);
        assert.equal(
          fs.readFileSync(f.target, "utf8"),
          "\uFEFFOriginal\r\n\r\n",
        );
      },
    );
    await run(
      "file-current-user-readonly-original-denied-before-any-stage",
      async () => {
        assert.notEqual(process.getuid(), 0);
        const f = await fileFixture("file-readonly"),
          k = await kernel();
        fs.chmodSync(f.target, 0o440);
        f.request.version = (
          await readWorkspaceFile(
            { id: f.request.workspaceId, path: f.dir },
            f.path,
          )
        ).version;
        unknown(k.prepare(f.request), "path_denied");
        assert.equal(fs.existsSync(f.backup), false);
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o440);
        assert.equal(
          fs.readFileSync(f.target, "utf8"),
          "\uFEFFOriginal\r\n\r\n",
        );
      },
    );
    await run(
      "file-injected-check-EACCES-unknown-no-stage-all-FDs-closed",
      async () => {
        const f = await fileFixture("file-injected-denial");
        let calls = 0;
        const k = await kernel({
          check() {
            if (++calls === 2)
              throw Object.assign(new Error("PRIVATE"), { code: "EACCES" });
          },
        });
        unknown(k.prepare(f.request), "path_denied");
        assert.equal(fs.existsSync(f.backup), false);
        assert.deepEqual(fdSet(), baseline);
      },
    );
    await run(
      "file-post-precheck-in-place-change-retains-external-backup-unknown",
      async () => {
        const f = await fileFixture("file-last-moment-change");
        let armed = false,
          calls = 0;
        const k = await kernel({
          check() {
            if (armed && ++calls === 2)
              fs.writeFileSync(f.target, "EXTERNAL-LAST-MOMENT");
          },
        });
        const p = staged(k, f.request);
        armed = true;
        unknown(k.publish({ token: p.token }), "file_changed");
        assert.equal(fs.readFileSync(f.target, "utf8"), f.request.text);
        assert.equal(fs.readFileSync(f.backup, "utf8"), "EXTERNAL-LAST-MOMENT");
        unknown(k.publish({ token: p.token }), "invalid_token");
        assert.deepEqual(fdSet(), baseline);
      },
    );
    await run("file-missing-leaf-and-parent-never-created", async () => {
      for (const missing of ["leaf", "parent"]) {
        const f = await fileFixture("file-no-create"),
          k = await kernel();
        fs.unlinkSync(f.target);
        if (missing === "parent") fs.rmdirSync(f.parent);
        unknown(k.prepare(f.request), "path_missing");
        assert.equal(fs.existsSync(f.target), false);
        assert.equal(fs.existsSync(f.backup), false);
        if (missing === "parent") assert.equal(fs.existsSync(f.parent), false);
      }
    });
    await run(
      "file-stale-source-and-stale-complete-ancestor-baseline-no-stage",
      async () => {
        for (const mutation of ["source", "ancestor"]) {
          const f = await fileFixture("file-stale"),
            k = await kernel();
          if (mutation === "source") fs.writeFileSync(f.target, "EXTERNAL");
          else {
            // Preserve root times by replacing a deeper ancestor only.
            fs.renameSync(f.parent, f.parent + ".old");
            fs.mkdirSync(f.parent);
            fs.renameSync(join(f.parent + ".old", "note.txt"), f.target);
          }
          unknown(k.prepare(f.request), "file_changed");
          assert.equal(fs.existsSync(f.backup), false);
        }
      },
    );
    for (const component of ["", "one", "one/two"]) {
      for (const replacement of ["directory", "symlink", "missing"]) {
        await run(
          `file-held-ancestor-${component || "root"}-${replacement}`,
          async () => {
            const f = await fileFixture("file-held"),
              k = await kernel(),
              p = staged(k, f.request);
            const moved = join(f.dir, component),
              retained = moved + ".retained";
            fs.renameSync(moved, retained);
            if (replacement === "directory") fs.mkdirSync(moved);
            if (replacement === "symlink") fs.symlinkSync(retained, moved);
            unknown(k.publish({ token: p.token }), "file_changed");
            const suffix =
              component === "one/two"
                ? "note.txt"
                : component === "one"
                  ? "two/note.txt"
                  : f.path;
            assert.equal(
              fs.readFileSync(join(retained, suffix), "utf8"),
              "\uFEFFOriginal\r\n\r\n",
            );
            assert.equal(
              fs.readFileSync(
                join(
                  dirname(join(retained, suffix)),
                  configurationBackupId(
                    f.request.runtimeEpoch,
                    f.request.operationId,
                    "file",
                  ),
                ),
                "utf8",
              ),
              f.request.text,
            );
            unknown(k.publish({ token: p.token }), "invalid_token");
          },
        );
      }
    }
    await run(
      "file-check-replacement-before-stage-and-rename-keeps-outside-sentinel",
      async () => {
        for (const phase of ["stage", "rename"]) {
          const f = await fileFixture("file-outside"),
            outside = make("outside", { missing: true });
          const sentinel = join(outside.dir, "note.txt");
          fs.writeFileSync(sentinel, "OUTSIDE-SENTINEL");
          let calls = 0,
            armed = false;
          const k = await kernel({
            check() {
              if (phase === "stage" ? ++calls === 2 : armed && ++calls === 2) {
                fs.renameSync(f.parent, f.parent + ".retained");
                fs.symlinkSync(outside.dir, f.parent);
              }
            },
          });
          if (phase === "stage") unknown(k.prepare(f.request), "file_changed");
          else {
            const p = staged(k, f.request);
            calls = 0;
            armed = true;
            unknown(k.publish({ token: p.token }), "file_changed");
          }
          assert.equal(fs.readFileSync(sentinel, "utf8"), "OUTSIDE-SENTINEL");
          assert.deepEqual(fs.readdirSync(outside.dir), ["note.txt"]);
          assert.equal(
            fs.readFileSync(join(f.parent + ".retained", "note.txt"), "utf8"),
            "\uFEFFOriginal\r\n\r\n",
          );
          assert.equal(
            fs.existsSync(
              join(
                f.parent + ".retained",
                configurationBackupId(
                  f.request.runtimeEpoch,
                  f.request.operationId,
                  "file",
                ),
              ),
            ),
            phase === "rename",
          );
        }
      },
    );
    await run(
      "file-check-concurrent-in-place-before-stage-no-creation",
      async () => {
        const f = await fileFixture("file-pre-stage-race");
        let calls = 0;
        const k = await kernel({
          check() {
            if (++calls === 2) fs.writeFileSync(f.target, "EXTERNAL");
          },
        });
        unknown(k.prepare(f.request), "file_changed");
        assert.equal(fs.readFileSync(f.target, "utf8"), "EXTERNAL");
        assert.equal(fs.existsSync(f.backup), false);
      },
    );
    await run(
      "file-prepared-concurrent-in-place-and-source-alias-no-publication",
      async () => {
        for (const mutation of [
          "in-place",
          "replacement",
          "symlink",
          "hardlink",
        ]) {
          const f = await fileFixture("file-source-race"),
            k = await kernel(),
            p = staged(k, f.request);
          if (mutation === "in-place") fs.writeFileSync(f.target, "EXTERNAL");
          if (mutation === "replacement") {
            fs.renameSync(f.target, f.target + ".old");
            fs.writeFileSync(f.target, "EXTERNAL");
          }
          if (mutation === "symlink") {
            fs.renameSync(f.target, f.target + ".old");
            fs.symlinkSync(f.target + ".old", f.target);
          }
          if (mutation === "hardlink")
            fs.linkSync(f.target, f.target + ".link");
          unknown(k.publish({ token: p.token }));
          assert.notEqual(fs.readFileSync(f.target, "utf8"), f.request.text);
          assert.equal(fs.readFileSync(f.backup, "utf8"), f.request.text);
          unknown(k.publish({ token: p.token }), "invalid_token");
        }
      },
    );
    await run("file-initial-alias-hardlink-binary-large-no-stage", async () => {
      for (const mutation of [
        "symlink",
        "hardlink",
        "invalid-utf8",
        "binary",
        "large",
      ]) {
        const f = await fileFixture("file-source-refused"),
          k = await kernel();
        if (mutation === "symlink") {
          fs.renameSync(f.target, f.target + ".old");
          fs.symlinkSync(f.target + ".old", f.target);
        }
        if (mutation === "hardlink") fs.linkSync(f.target, f.target + ".link");
        if (mutation === "invalid-utf8")
          fs.writeFileSync(f.target, Buffer.from([0xff]));
        if (mutation === "binary") fs.writeFileSync(f.target, Buffer.from([0]));
        if (mutation === "large")
          fs.writeFileSync(f.target, Buffer.alloc(65537, 65));
        unknown(k.prepare(f.request));
        assert.equal(fs.existsSync(f.backup), false);
      }
    });
    await run(
      "file-mode-opaque-xattrs-preserved-and-metadata-budget-unchanged",
      async () => {
        const f = await fileFixture("file-metadata"),
          k = await kernel();
        const opaque = Buffer.from([0, 255, 128]);
        xattr(f.target, "com.omoc.synthetic.file", opaque);
        f.request.version = (
          await readWorkspaceFile(
            { id: f.request.workspaceId, path: f.dir },
            f.path,
          )
        ).version;
        const p = staged(k, f.request),
          saved = k.publish({ token: p.token });
        assert.equal(saved.status, "saved");
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
        assert.ok(readAttr(f.target, "com.omoc.synthetic.file").equals(opaque));
        assert.ok(readAttr(f.backup, "com.omoc.synthetic.file").equals(opaque));
        const large = await fileFixture("file-metadata-large");
        xattr(large.target, "com.omoc.synthetic.file", Buffer.alloc(32768, 65));
        unknown(k.prepare(large.request), "unsupported_metadata");
        assert.equal(fs.existsSync(large.backup), false);
      },
    );
    await run(
      "file-collision-abort-expiry-retain-stage-close-chain",
      async () => {
        const f = await fileFixture("file-abort"),
          k = await kernel();
        const p = staged(k, f.request);
        assert.equal(k.abort({ token: p.token }).status, "aborted");
        assert.deepEqual(fdSet(), baseline);
        assert.equal(
          fs.readFileSync(f.target, "utf8"),
          "\uFEFFOriginal\r\n\r\n",
        );
        assert.equal(fs.readFileSync(f.backup, "utf8"), f.request.text);
        unknown(k.publish({ token: p.token }), "invalid_token");
        const exp = await fileFixture("file-expiry"),
          short = await kernel({ timeoutMs: 10 });
        const token = staged(short, exp.request);
        await new Promise((done) => setTimeout(done, 30));
        assert.deepEqual(fdSet(), baseline);
        unknown(short.publish({ token: token.token }), "expired");
        assert.equal(
          fs.readFileSync(exp.target, "utf8"),
          "\uFEFFOriginal\r\n\r\n",
        );
        const collision = await fileFixture("file-collision");
        fs.writeFileSync(collision.backup, "FOREIGN");
        unknown(k.prepare(collision.request), "stage_collision");
        assert.equal(fs.readFileSync(collision.backup, "utf8"), "FOREIGN");
      },
    );
    await run(
      "file-post-exchange-authority-failure-unknown-no-replay-original-backup",
      async () => {
        const f = await fileFixture("file-unknown");
        let armed = false,
          calls = 0;
        const k = await kernel({
          check() {
            if (armed && ++calls === 3) throw new Error("PRIVATE");
          },
        });
        const p = staged(k, f.request);
        armed = true;
        unknown(k.publish({ token: p.token }), "io_failed");
        assert.equal(fs.readFileSync(f.target, "utf8"), f.request.text);
        assert.equal(
          fs.readFileSync(f.backup, "utf8"),
          "\uFEFFOriginal\r\n\r\n",
        );
        unknown(k.publish({ token: p.token }), "invalid_token");
        assert.deepEqual(fdSet(), baseline);
      },
    );
    await run("agent-exact-replacement-backup-and-reader-parity", async () => {
      const original = "---\nmodel: legacy\n---\nOriginal\n";
      const f = await skillFixture("agent-replace", original, "agent"),
        k = await kernel();
      f.request.text =
        '\uFEFF---\r\n{"description":"Review","mode":"primary"}\r\n---\r\nNew body\r\n';
      const p = staged(k, f.request),
        saved = k.publish({ token: p.token });
      assert.equal(saved.status, "saved");
      assert.equal(fs.readFileSync(f.backup, "utf8"), original);
      assert.equal(fs.readFileSync(f.target, "utf8"), f.request.text);
      const read = await readAgentFile(
        { id: f.request.workspaceId, path: f.dir },
        f.sourceName,
      );
      assert.equal(saved.version, read.version);
      savedObservations.push({
        workspaceId: f.request.workspaceId,
        workspacePath: f.dir,
        kind: "agent",
        sourceName: f.sourceName,
        version: saved.version,
      });
      unknown(k.publish({ token: p.token }), "invalid_token");
    });
    await run(
      "agent-missing-leaf-only-no-ancestor-creation-and-closed-grammar",
      async () => {
        const f = await skillFixture("agent-missing", null, "agent"),
          k = await kernel();
        unknown(
          k.prepare({
            ...f.request,
            text: '---\n{"permissions":[]}\n---\nBody',
          }),
          "invalid_request",
        );
        const p = staged(k, f.request);
        assert.equal(k.publish({ token: p.token }).status, "saved");
        const unavailable = await skillFixture(
          "agent-no-parents",
          null,
          "agent",
        );
        fs.rmdirSync(unavailable.parent);
        unknown(k.prepare(unavailable.request), "path_missing");
        assert.equal(fs.existsSync(unavailable.parent), false);
      },
    );
    for (const replacement of ["directory", "symlink", "missing"]) {
      await run(`agent-held-parent-${replacement}`, async () => {
        const f = await skillFixture("agent-race", "Original", "agent"),
          k = await kernel(),
          p = staged(k, f.request);
        fs.renameSync(f.parent, f.parent + ".old");
        if (replacement === "directory") fs.mkdirSync(f.parent);
        if (replacement === "symlink")
          fs.symlinkSync(f.parent + ".old", f.parent);
        unknown(k.publish({ token: p.token }), "file_changed");
        assert.equal(
          fs.readFileSync(
            join(f.parent + ".old", `${f.sourceName}.md`),
            "utf8",
          ),
          "Original",
        );
      });
    }
    await run(
      "skill-raw-unsupported-conversion-exact-version-backup",
      async () => {
        const original = "---\ncustom: &anchor value\n---\n# Original\n";
        const f = await skillFixture("skill-convert", original),
          k = await kernel();
        const opaque = Buffer.from([0, 255, 128]);
        xattr(f.target, "com.omoc.synthetic.skill", opaque);
        // Metadata changes participate in the exact original file version.
        f.request.version = (
          await readSkillFile(
            { id: f.request.workspaceId, path: f.dir },
            f.sourceName,
          )
        ).version;
        const p = staged(k, f.request);
        assert.equal(fdSet().length, baseline.length + 6);
        for (const fd of fdSet().filter((fd) => !baseline.includes(fd)))
          assert.equal(lib.symbols.fcntl(fd, 1) & 1, 1);
        const saved = k.publish({ token: p.token });
        assert.equal(saved.status, "saved");
        assert.equal(fs.readFileSync(f.backup, "utf8"), original);
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
        assert.ok(
          readAttr(f.target, "com.omoc.synthetic.skill").equals(opaque),
        );
        const read = await readSkillFile(
          { id: f.request.workspaceId, path: f.dir },
          f.sourceName,
        );
        assert.equal(read.version, saved.version);
        savedObservations.push({
          workspaceId: f.request.workspaceId,
          workspacePath: f.dir,
          kind: "skill",
          sourceName: f.sourceName,
          version: saved.version,
        });
        unknown(k.publish({ token: p.token }), "invalid_token");
      },
    );
    await run("skill-missing-create-and-directory-binding", async () => {
      const f = await skillFixture("skill-missing", null),
        k = await kernel();
      const p = staged(k, f.request);
      const saved = k.publish({ token: p.token });
      assert.equal(saved.status, "saved");
      assert.equal(Object.hasOwn(saved, "backupId"), false);
      const read = await readSkillFile(
        { id: f.request.workspaceId, path: f.dir },
        f.sourceName,
      );
      assert.equal(read.version, saved.version);
      assert.equal(fs.existsSync(f.backup), false);
      const stale = await skillFixture("skill-stale-missing", null);
      fs.renameSync(stale.parent, `${stale.parent}.old`);
      fs.mkdirSync(stale.parent);
      unknown(k.prepare(stale.request), "file_changed");
      assert.equal(fs.existsSync(stale.backup), false);
    });
    for (const ancestor of [
      ".opencode",
      ".opencode/skills",
      ".opencode/skills/example",
    ]) {
      for (const replacement of ["directory", "symlink", "missing"]) {
        await run(
          `skill-held-ancestor-${ancestor}-${replacement}`,
          async () => {
            const f = await skillFixture("skill-race"),
              k = await kernel(),
              p = staged(k, f.request);
            const path = join(f.dir, ancestor);
            fs.renameSync(path, `${path}.old`);
            if (replacement === "directory") fs.mkdirSync(path);
            if (replacement === "symlink") fs.symlinkSync(`${path}.old`, path);
            unknown(k.publish({ token: p.token }), "file_changed");
            assert.equal(fs.existsSync(join(f.dir, "AGENTS.md")), false);
            unknown(k.publish({ token: p.token }), "invalid_token");
          },
        );
      }
    }
    await run(
      "skill-closed-request-required-directory-version-no-mkdir",
      async () => {
        const f = await skillFixture("skill-invalid"),
          k = await kernel();
        for (const changes of [
          { sourceName: "../outside" },
          { directoryVersion: undefined },
          { directoryVersion: "bad" },
          { text: "---\nunknown: data\n---\n# Body" },
          { path: f.target },
        ])
          unknown(k.prepare({ ...f.request, ...changes }), "invalid_request");
        const legacy = {
          ...request(make("legacy-extra")),
          sourceName: "example",
          directoryVersion: "a".repeat(64),
        };
        unknown(k.prepare(legacy), "invalid_request");
        fs.rmSync(join(f.dir, ".opencode"), { recursive: true });
        unknown(k.prepare(f.request), "path_missing");
        assert.equal(fs.existsSync(join(f.dir, ".opencode")), false);
      },
    );
    await run(
      "skill-stage-collision-foreign-bytes-retained-and-denied-not-missing",
      async () => {
        const f = await skillFixture("skill-collision"),
          k = await kernel();
        fs.writeFileSync(f.backup, "SYNTHETIC-FOREIGN");
        unknown(k.prepare(f.request), "stage_collision");
        assert.equal(fs.readFileSync(f.backup, "utf8"), "SYNTHETIC-FOREIGN");
        assert.deepEqual(fdSet(), baseline);
        fs.unlinkSync(f.backup);
        fs.chmodSync(f.parent, 0);
        try {
          unknown(k.prepare(f.request), "path_denied");
        } finally {
          fs.chmodSync(f.parent, 0o700);
        }
        assert.equal(fs.readFileSync(f.target, "utf8"), "# Original\n");
      },
    );
    await run(
      "skill-after-publication-unknown-original-backup-no-replay",
      async () => {
        const f = await skillFixture("skill-unknown");
        let armed = false,
          checks = 0;
        const k = await kernel({
          check() {
            if (armed && ++checks === 3) throw new Error("PRIVATE");
          },
        });
        const p = staged(k, f.request);
        armed = true;
        unknown(k.publish({ token: p.token }), "io_failed");
        assert.equal(fs.readFileSync(f.target, "utf8"), f.request.text);
        assert.equal(fs.readFileSync(f.backup, "utf8"), "# Original\n");
        unknown(k.publish({ token: p.token }), "invalid_token");
        assert.deepEqual(fdSet(), baseline);
      },
    );
    await run(
      "skill-deadline-closes-complete-ancestor-chain-retains-stage",
      async () => {
        const f = await skillFixture("skill-expiry"),
          k = await kernel({ timeoutMs: 10 });
        const p = staged(k, f.request);
        assert.equal(fdSet().length, baseline.length + 6);
        await new Promise((done) => setTimeout(done, 30));
        assert.deepEqual(fdSet(), baseline);
        unknown(k.publish({ token: p.token }), "expired");
        assert.equal(fs.readFileSync(f.target, "utf8"), "# Original\n");
        assert.equal(fs.readFileSync(f.backup, "utf8"), f.request.text);
      },
    );
    await run("skill-check-race-before-stage-and-before-rename", async () => {
      for (const phase of ["stage", "rename"]) {
        const f = await skillFixture(`skill-${phase}`);
        let calls = 0,
          armed = false;
        const k = await kernel({
          check() {
            if (phase === "stage" ? ++calls === 2 : armed && ++calls === 2) {
              fs.renameSync(f.parent, `${f.parent}.old`);
              fs.mkdirSync(f.parent);
            }
          },
        });
        if (phase === "stage") unknown(k.prepare(f.request), "file_changed");
        else {
          const p = staged(k, f.request);
          calls = 0;
          armed = true;
          unknown(k.publish({ token: p.token }), "file_changed");
        }
        assert.equal(fs.existsSync(f.target), false);
        assert.equal(
          fs.readFileSync(join(`${f.parent}.old`, "SKILL.md"), "utf8"),
          "# Original\n",
        );
      }
    });
    await run(
      "matching-swap-original-mode-opaque-xattrs-reader-version",
      async () => {
        const f = make("matching");
        const opaque = Buffer.from([0, 255, 128, 10, 0]);
        xattr(f.target, "com.omoc.synthetic", opaque);
        xattr(f.target, "com.omoc.empty", Buffer.alloc(0));
        const r = request(f, "\ufeffSYNTHETIC-NEW\n"),
          k = await kernel();
        const p = staged(k, r);
        assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
        const original = fs.statSync(f.target, { bigint: true });
        const saved = k.publish({ token: p.token });
        assert.equal(saved.status, "saved");
        savedObservations.push({
          workspaceId: r.workspaceId,
          workspacePath: r.workspacePath,
          kind: r.kind,
          version: saved.version,
        });
        assert.equal(
          saved.backupId,
          configurationBackupId(r.runtimeEpoch, r.operationId, r.kind),
        );
        assert.equal(fs.readFileSync(f.target, "utf8"), r.text);
        assert.equal(fs.readFileSync(backup(r), "utf8"), "SYNTHETIC-ORIGINAL");
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
        assert.ok(readAttr(f.target, "com.omoc.synthetic").equals(opaque));
        assert.equal(readAttr(f.target, "com.omoc.empty").length, 0);
        assert.equal(
          fs.statSync(backup(r), { bigint: true }).ino,
          original.ino,
        );
        assert.notEqual(
          fs.statSync(backup(r), { bigint: true }).ctimeNs,
          original.ctimeNs,
        );
        assert.equal(
          saved.version,
          configurationFileVersion(
            { ...r, path: f.target },
            fs.statSync(f.dir, { bigint: true }),
            fs.statSync(f.target, { bigint: true }),
            fs.readFileSync(f.target),
          ),
        );
        unknown(k.publish({ token: p.token }), "invalid_token");
        unknown(k.prepare(request(f)), "stage_collision");
        assert.equal(fs.readFileSync(f.target, "utf8"), r.text);
      },
    );
    await run(
      "missing-exclusive-create-and-exact32768-byte-bound",
      async () => {
        const f = make("missing", { missing: true }),
          k = await kernel();
        const r = request(f, "한".repeat(10922) + "ab"),
          p = staged(k, r);
        assert.equal(Buffer.byteLength(r.text), 32768);
        assert.equal(fs.existsSync(f.target), false);
        const saved = k.publish({ token: p.token });
        assert.equal(saved.status, "saved");
        savedObservations.push({
          workspaceId: r.workspaceId,
          workspacePath: r.workspacePath,
          kind: r.kind,
          version: saved.version,
        });
        assert.equal(Object.hasOwn(saved, "backupId"), false);
        assert.equal(fs.existsSync(backup(r)), false);
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o600);
        assert.equal(
          saved.version,
          configurationFileVersion(
            { ...r, path: f.target },
            fs.statSync(f.dir, { bigint: true }),
            fs.statSync(f.target, { bigint: true }),
            fs.readFileSync(f.target),
          ),
        );
      },
    );
    await run("stage-collision-retains-existing-entry", async () => {
      const f = make("collision"),
        k = await kernel(),
        r = request(f);
      fs.writeFileSync(backup(r), "SYNTHETIC-COLLISION");
      const updated = request(f);
      unknown(k.prepare(updated), "stage_collision");
      assert.equal(fs.readFileSync(backup(r), "utf8"), "SYNTHETIC-COLLISION");
      assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
    });
    await run("stale-version-before-stage", async () => {
      const f = make("stale"),
        r = request(f),
        k = await kernel();
      fs.writeFileSync(f.target, "SYNTHETIC-EXTERNAL");
      unknown(k.prepare(r), "file_changed");
      assert.equal(fs.existsSync(backup(r)), false);
    });
    for (const mutation of [
      "in-place",
      "replacement",
      "symlink",
      "root-move",
      "stage-replacement",
      "metadata-change",
    ]) {
      await run(`prepared-${mutation}-unknown-no-publication`, async () => {
        const f = make(mutation),
          r = request(f),
          k = await kernel(),
          p = staged(k, r);
        if (mutation === "in-place")
          fs.writeFileSync(f.target, "SYNTHETIC-EXTERNAL");
        if (mutation === "replacement" || mutation === "symlink") {
          fs.renameSync(f.target, join(f.dir, "kept-original"));
          if (mutation === "replacement")
            fs.writeFileSync(f.target, "SYNTHETIC-EXTERNAL");
          else fs.symlinkSync(join(f.dir, "kept-original"), f.target);
        }
        if (mutation === "root-move") {
          fs.renameSync(f.dir, `${f.dir}.moved`);
          fs.symlinkSync(join(root, "home"), f.dir);
        }
        if (mutation === "stage-replacement") {
          fs.renameSync(backup(r), `${backup(r)}.kept`);
          fs.writeFileSync(backup(r), "SYNTHETIC-STAGE-EXTERNAL");
        }
        if (mutation === "metadata-change")
          xattr(f.target, "com.omoc.external", "SYNTHETIC-ATTR");
        unknown(k.publish({ token: p.token }));
        unknown(k.publish({ token: p.token }), "invalid_token");
        if (mutation === "root-move") {
          assert.equal(
            fs.readFileSync(join(`${f.dir}.moved`, "AGENTS.md"), "utf8"),
            "SYNTHETIC-ORIGINAL",
          );
          assert.equal(fs.existsSync(join(root, "home", "AGENTS.md")), false);
        } else if (mutation === "symlink")
          assert.equal(
            fs.readFileSync(join(f.dir, "kept-original"), "utf8"),
            "SYNTHETIC-ORIGINAL",
          );
        else assert.notEqual(fs.readFileSync(f.target, "utf8"), r.text);
      });
    }
    for (const mutation of [
      "replacement",
      "in-place",
      "symlink",
      "root-move",
      "missing-collision",
    ]) {
      await run(
        `post-precheck-${mutation}-retention-no-rollback-replay`,
        async () => {
          const f = make(`race-${mutation}`, {
            missing: mutation === "missing-collision",
          });
          const r = request(f);
          let phase = false,
            checks = 0;
          const k = await kernel({
            check() {
              if (!phase || ++checks !== 2) return;
              if (mutation === "replacement" || mutation === "symlink") {
                fs.renameSync(f.target, join(f.dir, "kept-original"));
                if (mutation === "replacement")
                  fs.writeFileSync(f.target, "SYNTHETIC-CONFLICT");
                else fs.symlinkSync(join(f.dir, "kept-original"), f.target);
              } else if (mutation === "in-place")
                fs.writeFileSync(f.target, "SYNTHETIC-CONFLICT");
              else if (mutation === "root-move") {
                fs.renameSync(f.dir, `${f.dir}.moved`);
                fs.symlinkSync(join(root, "home"), f.dir);
              } else fs.writeFileSync(f.target, "SYNTHETIC-CONFLICT");
            },
          });
          const p = staged(k, r);
          phase = true;
          unknown(k.publish({ token: p.token }));
          const dir = mutation === "root-move" ? `${f.dir}.moved` : f.dir;
          const target = join(dir, "AGENTS.md"),
            displaced = join(
              dir,
              configurationBackupId(r.runtimeEpoch, r.operationId, r.kind),
            );
          if (mutation === "missing-collision")
            assert.equal(fs.readFileSync(target, "utf8"), "SYNTHETIC-CONFLICT");
          else {
            assert.equal(fs.readFileSync(target, "utf8"), r.text);
            if (mutation === "symlink") {
              assert.ok(fs.lstatSync(displaced).isSymbolicLink());
              assert.equal(
                fs.readFileSync(join(dir, "kept-original"), "utf8"),
                "SYNTHETIC-ORIGINAL",
              );
            } else
              assert.equal(
                fs.readFileSync(displaced, "utf8"),
                mutation === "root-move"
                  ? "SYNTHETIC-ORIGINAL"
                  : "SYNTHETIC-CONFLICT",
              );
          }
          const before = fs.readFileSync(target);
          unknown(k.publish({ token: p.token }), "invalid_token");
          assert.ok(fs.readFileSync(target).equals(before));
          if (mutation === "root-move")
            assert.equal(fs.existsSync(join(root, "home", "AGENTS.md")), false);
        },
      );
    }
    await run(
      "initial-symlink-hardlink-executable-unsupported-profile",
      async () => {
        const k = await kernel();
        for (const profile of ["symlink", "hardlink", "executable", "setuid"]) {
          const f = make(profile),
            r = request(f);
          if (profile === "symlink") {
            fs.renameSync(f.target, `${f.target}.kept`);
            fs.symlinkSync(`${f.target}.kept`, f.target);
          }
          if (profile === "hardlink") fs.linkSync(f.target, `${f.target}.link`);
          if (profile === "executable") fs.chmodSync(f.target, 0o700);
          if (profile === "setuid") fs.chmodSync(f.target, 0o4600);
          unknown(k.prepare(r));
          assert.equal(fs.existsSync(backup(r)), false);
        }
      },
    );
    await run("repeated-ordinary-metadata-keeps-native-errno", async () => {
      const f = make("repeated-metadata"),
        k = await kernel(),
        original = fs.readFileSync(f.target);
      for (let i = 0; i < 256; i++) {
        const r = request(f, "SYNTHETIC-STAGED", {
          operationId: `metadata-${i}`,
        });
        const p = staged(k, r);
        assert.deepEqual(k.abort({ token: p.token }), { status: "aborted" });
        assert.deepEqual(fs.readFileSync(f.target), original);
        assert.equal(fs.readFileSync(backup(r), "utf8"), "SYNTHETIC-STAGED");
      }
    });
    await run("actual-ACL-and-BSD-flags-refused", async () => {
      const k = await kernel();
      const acl = make("ACL"),
        flagged = make("flags");
      assert.equal(
        spawnSync("/bin/chmod", ["+a", "everyone deny write", acl.target])
          .status,
        0,
      );
      unknown(k.prepare(request(acl)), "unsupported_metadata");
      assert.equal(
        spawnSync("/usr/bin/chflags", ["nodump", flagged.target]).status,
        0,
      );
      unknown(k.prepare(request(flagged)), "unsupported_metadata");
    });
    await run(
      "actual-stage-inherited-ACL-refused-before-publication",
      async () => {
        const f = make("inherited-ACL", { missing: true }),
          k = await kernel();
        assert.equal(
          spawnSync("/bin/chmod", [
            "+a",
            "everyone allow read,file_inherit",
            f.dir,
          ]).status,
          0,
        );
        const r = request(f);
        unknown(k.prepare(r), "unsupported_metadata");
        assert.equal(fs.existsSync(f.target), false);
        assert.equal(fs.existsSync(backup(r)), true);
      },
    );
    await run("metadata32-name-and32768-aggregate-bounds", async () => {
      const k = await kernel();
      const names = make("many-attributes");
      for (let i = 0; i < 33; i++)
        xattr(names.target, `com.omoc.attr${i}`, "x");
      unknown(k.prepare(request(names)), "unsupported_metadata");
      const bytes = make("large-attribute");
      xattr(bytes.target, "com.omoc.large", Buffer.alloc(32768, 65));
      unknown(k.prepare(request(bytes)), "unsupported_metadata");
    });
    await run("stage-inherited-metadata-rechecked", async () => {
      const f = make("stage-metadata"),
        r = request(f);
      let checks = 0;
      const k = await kernel({
        check() {
          if (++checks === 3)
            xattr(backup(r), "com.omoc.injected", "SYNTHETIC");
        },
      });
      const p = staged(k, r);
      unknown(k.publish({ token: p.token }));
      assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
    });
    await run(
      "source-full-content-invalid-UTF8-MCP-controls-size",
      async () => {
        const k = await kernel();
        for (const [name, opts] of [
          ["utf8", { body: Buffer.from([255]) }],
          ["controls", { body: "SYNTHETIC\u0000" }],
          ["large", { body: "a".repeat(32769) }],
          [
            "unsupported-mcp",
            {
              kind: "mcp",
              body: '{"mcp":{"servers":{}},"private":"SYNTHETIC"}',
            },
          ],
          ["duplicate-mcp", { kind: "mcp", body: '{"mcp":{},"mcp":{}}' }],
        ]) {
          const f = make(name, opts),
            r = request(
              f,
              f.kind === "mcp"
                ? '{"mcp":{"servers":{"demo":{"type":"local","command":["synthetic"]}}}}'
                : "NEW",
            );
          unknown(k.prepare(r), "unsupported_content");
          assert.equal(fs.existsSync(backup(r)), false);
        }
      },
    );
    await run("MCP-supported-whole-text-and-empty-instructions", async () => {
      const body =
        '{"mcp":{"servers":{"demo":{"type":"local","command":["synthetic"]}}}}';
      const f = make("mcp", { kind: "mcp", body }),
        k = await kernel();
      const p = staged(k, request(f, `${body}\n`));
      assert.equal(k.publish({ token: p.token }).status, "saved");
      const empty = make("empty");
      const e = staged(k, request(empty, ""));
      assert.equal(k.publish({ token: e.token }).status, "saved");
      assert.equal(fs.statSync(empty.target).size, 0);
    });
    await run("request-closed-own-data-body-bound-surrogates", async () => {
      const f = make("requests"),
        r = request(f),
        k = await kernel();
      for (const bad of [
        { ...r, text: "a".repeat(32769) },
        { ...r, text: "한".repeat(10923) },
        { ...r, text: "\ud800" },
        { ...r, text: "\udfff" },
        { ...r, text: "a\u0000b" },
        { ...r, io: {} },
        { ...r, workspacePath: `${f.dir}/..` },
        { ...r, operationId: "../outside" },
        { ...r, expectation: "missing" },
        { ...r, version: "bad" },
        { ...r, kind: "other" },
        Object.create(r),
        { ...r, [Symbol("private")]: true },
      ])
        unknown(k.prepare(bad), "invalid_request");
      let touched = false;
      const getter = {
        ...r,
        get text() {
          touched = true;
          throw new Error("PRIVATE");
        },
      };
      unknown(k.prepare(getter), "invalid_request");
      assert.equal(touched, false);
      assert.equal(fs.existsSync(backup(r)), false);
      const validPair = staged(k, request(f, "\ud83d\ude00"));
      assert.equal(k.abort({ token: validPair.token }).status, "aborted");
    });
    await run(
      "active-token-bounded-abort-invalid-token-and-retention",
      async () => {
        const f = make("busy"),
          r = request(f),
          k = await kernel(),
          p = staged(k, r);
        unknown(k.prepare(r), "busy");
        unknown(k.publish({ token: "a".repeat(64) }), "invalid_token");
        unknown(k.publish({ token: p.token, io: {} }), "invalid_request");
        assert.equal(k.abort({ token: p.token }).status, "aborted");
        unknown(k.abort({ token: p.token }), "invalid_token");
        unknown(k.publish({ token: p.token }), "invalid_token");
        assert.equal(fs.readFileSync(backup(r), "utf8"), r.text);
        unknown(k.prepare(request(f)), "stage_collision");
        k.close();
        unknown(k.prepare(r), "closed");
        unknown(k.publish({ token: p.token }), "closed");
      },
    );
    await run(
      "deadline-timer-expiry-closes-all-FDs-without-publish",
      async () => {
        const f = make("expiry"),
          r = request(f),
          k = await kernel({ timeoutMs: 10 }),
          p = staged(k, r);
        assert.equal(fdSet().length, baseline.length + 3);
        for (const fd of fdSet().filter((fd) => !baseline.includes(fd)))
          assert.equal(lib.symbols.fcntl(fd, 1) & 1, 1);
        await new Promise((done) => setTimeout(done, 30));
        assert.deepEqual(fdSet(), baseline);
        unknown(k.publish({ token: p.token }), "expired");
        assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
        assert.ok(fs.existsSync(backup(r)));
      },
    );
    await run("deadline-before-event-loop-tick-no-replay", async () => {
      const f = make("blocking-expiry"),
        r = request(f),
        k = await kernel({ timeoutMs: 1 }),
        p = staged(k, r);
      const until = Date.now() + 5;
      while (Date.now() < until) {
        /* bounded synthetic stall */
      }
      unknown(k.publish({ token: p.token }), "expired");
      assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
    });
    await run(
      "check-failure-sanitized-stage-retained-and-FDs-closed",
      async () => {
        const f = make("check-failure"),
          r = request(f);
        let calls = 0;
        const k = await kernel({
          check() {
            if (++calls === 3) throw new Error("PRIVATE-SYNTHETIC-ERROR");
          },
        });
        unknown(k.prepare(r), "io_failed");
        assert.deepEqual(fdSet(), baseline);
        assert.ok(fs.existsSync(backup(r)));
        assert.equal(fs.readFileSync(f.target, "utf8"), "SYNTHETIC-ORIGINAL");
      },
    );
    await run(
      "reentrant-check-cannot-close-or-prepare-during-publication",
      async () => {
        const f = make("reentry"),
          r = request(f);
        let k,
          phase = false;
        k = await kernel({
          check() {
            if (!phase) return;
            unknown(k.prepare(r), "busy");
            assert.throws(() => k.close(), { message: "busy" });
          },
        });
        const p = staged(k, r);
        phase = true;
        assert.equal(k.publish({ token: p.token }).status, "saved");
      },
    );
    await run(
      "close-active-preparation-retains-stage-and-closes-FDs",
      async () => {
        const f = make("close"),
          r = request(f),
          k = await kernel(),
          p = staged(k, r);
        k.close();
        assert.deepEqual(fdSet(), baseline);
        unknown(k.publish({ token: p.token }), "closed");
        assert.ok(fs.existsSync(backup(r)));
      },
    );
    console.log(
      JSON.stringify({
        result: "pass",
        bunVersion: globalThis.Bun.version,
        observations,
        savedObservations,
      }),
    );
  } finally {
    lib.close();
  }
}
