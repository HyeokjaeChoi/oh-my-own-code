import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  childEnvironment,
  endpointFrom,
  executableForResources,
  startSidecar,
} from "./sidecar-supervisor.mjs";
import { sidecarPackageName } from "./sidecar-package.mjs";

test("EventHost sidecar lane forwards the original epoch and retains startup preflight refusal", async () => {
  let spawns = 0;
  let setups = 0;
  const options = {
    eventHost: {},
    namespace: {},
    owner: {
      getNonce: () => "synthetic-owner",
      assertOwned: async () => ({ state: "ready" }),
    },
    preflight: async () => false,
    spawnProcess: () => {
      spawns++;
    },
    createDirectory: async () => {
      setups++;
    },
  };
  await assert.rejects(
    startSidecar({ ...options, runtimeEpoch: "main-epoch" }),
    /native_startup_unverified/,
  );
  for (const runtimeEpoch of [undefined, null, "", "with spaces"])
    await assert.rejects(
      startSidecar({ ...options, runtimeEpoch }),
      /native_permission_input/,
    );
  assert.equal(spawns, 0);
  assert.equal(setups, 0);
});

class FakeChild extends EventEmitter {
  constructor({ pid = 4242, exitOnKill = true } = {}) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killSignals = [];
    this.exitOnKill = exitOnKill;
  }

  kill(signal) {
    this.killSignals.push(signal);
    if (this.exitOnKill) queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

test("accepts only a loopback HTTP endpoint with a server password", () => {
  assert.deepEqual(
    endpointFrom("listening http://127.0.0.1:43121\nserver password secret\n"),
    { url: "http://127.0.0.1:43121", password: "secret" },
  );
  assert.equal(
    endpointFrom("listening https://127.0.0.1:43121\nserver password secret"),
    null,
  );
  assert.equal(
    endpointFrom("listening http://localhost:43121\nserver password secret"),
    null,
  );
  assert.equal(
    endpointFrom("listening http://192.168.1.8:43121\nserver password secret"),
    null,
  );
  assert.equal(
    endpointFrom("listening http://127.0.0.1:0\nserver password secret"),
    null,
  );
  assert.equal(endpointFrom("listening http://127.0.0.1:43121"), null);
});

test("creates a minimal sidecar environment without inherited credentials", () => {
  const root = join("/tmp", "owned-runtime");
  const env = childEnvironment(root, "darwin", undefined);
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "HOME",
      "OPENCODE_CONFIG_DIR",
      "OPENCODE_DISABLE_AUTOUPDATE",
      "PATH",
      "TEMP",
      "TMP",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
    ].sort(),
  );
  assert.equal(env.HOME, root);
  assert.equal(env.XDG_CONFIG_HOME, join(root, "config"));
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("OPENCODE_SERVER_PASSWORD" in env, false);
  assert.equal("NODE_OPTIONS" in env, false);
});

test("redirects Windows-native profiles and app-data paths into the owned root", () => {
  const env = childEnvironment(
    "C:\\Temp\\owned-runtime",
    "win32",
    "C:\\Windows",
  );
  assert.equal(env.USERPROFILE, "C:\\Temp\\owned-runtime");
  assert.equal(env.APPDATA, "C:\\Temp\\owned-runtime\\AppData\\Roaming");
  assert.equal(env.LOCALAPPDATA, "C:\\Temp\\owned-runtime\\AppData\\Local");
  assert.equal(env.SystemRoot, "C:\\Windows");
  for (const value of [env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA]) {
    assert.ok(
      value === env.USERPROFILE || value.startsWith(`${env.USERPROFILE}\\`),
    );
    assert.equal(value.includes("Users\\"), false);
  }
});

test("resolves the same sidecar directory layout used by development and packaged apps", () => {
  assert.equal(
    executableForResources(join("/app", "resources"), "darwin", "arm64"),
    join("/app", "resources", "opencode", "darwin-arm64", "opencode"),
  );
  assert.match(
    executableForResources("C:\\app\\resources", "win32", "x64"),
    /opencode[\\/]win32-x64[\\/]opencode\.exe$/,
  );
});

test("maps Windows runtime naming to the pinned npm package name", () => {
  assert.equal(
    sidecarPackageName("darwin", "arm64"),
    "@opencode/cli-darwin-arm64",
  );
  assert.equal(sidecarPackageName("win32", "x64"), "@opencode/cli-windows-x64");
});

test("starts an authenticated synthetic session and reaps only its owned child", async () => {
  const child = new FakeChild();
  let observedSpawn;
  let observedAuthorization;
  let observedSession;
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    port: 43123,
    spawnProcess(binary, args, options) {
      observedSpawn = { binary, args, options };
      queueMicrotask(() =>
        child.stdout.write(
          "OpenCode server listening on http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    makeClient(baseUrl, password) {
      observedAuthorization = Buffer.from(`opencode:${password}`).toString(
        "base64",
      );
      assert.equal(baseUrl, "http://127.0.0.1:43121");
      return {
        server: {
          info: async ({ signal }) => {
            assert.equal(signal instanceof AbortSignal, true);
            return { pid: child.pid, version: "2.0.18" };
          },
        },
        session: {
          create: async (input) => {
            observedSession = input;
            return { id: "synthetic-session" };
          },
        },
      };
    },
  });

  assert.equal(observedSpawn.binary, "/owned/opencode");
  assert.deepEqual(observedSpawn.args, [
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    "43123",
  ]);
  assert.equal(
    runtime.workspace.startsWith(observedSpawn.options.env.HOME),
    true,
  );
  assert.equal(
    observedAuthorization,
    Buffer.from("opencode:test-secret").toString("base64"),
  );
  assert.equal(observedSession.location.directory, runtime.workspace);
  assert.deepEqual(runtime.snapshot(), {
    state: "connected",
    serverVersion: "2.0.18",
    sessionTitle: "임시 데스크톱 작업 공간",
    sessionId: "synthetic-session",
  });

  const root = dirname(runtime.workspace);
  assert.deepEqual(await runtime.stop(), {
    exited: true,
    forced: false,
    cleanup: "complete",
  });
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
  assert.equal(existsSync(root), false);
});

test("rejects a sidecar port outside the valid TCP range before setup", async () => {
  await assert.rejects(startSidecar({ port: 65536 }), /invalid_sidecar_port/);
});

test("reports disconnection when the exact owned sidecar exits after readiness", async () => {
  const child = new FakeChild();
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    spawnProcess() {
      queueMicrotask(() =>
        child.stdout.write(
          "listening http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: { create: async () => ({ id: "synthetic-session" }) },
    }),
  });
  child.emit("exit", 1, null);
  assert.deepEqual(runtime.snapshot(), { state: "disconnected" });
  assert.deepEqual(await runtime.stop(), {
    exited: true,
    forced: false,
    cleanup: "complete",
  });
  assert.deepEqual(child.killSignals, []);
});

test("removes an owned root when setup fails before spawn", async () => {
  let root;
  await assert.rejects(
    startSidecar({
      binaryPath: "/owned/opencode",
      platform: "darwin",
      writeConfig(path) {
        root = dirname(dirname(dirname(path)));
        throw new Error("synthetic write failure");
      },
      spawnProcess() {
        assert.fail("setup failure must prevent spawn");
      },
    }),
    (error) => {
      assert.equal(error.cleanupComplete, true);
      return true;
    },
  );
  assert.equal(existsSync(root), false);
});

test("removes an owned root when the first setup directory fails", async () => {
  let root;
  await assert.rejects(
    startSidecar({
      binaryPath: "/owned/opencode",
      platform: "darwin",
      createDirectory(path) {
        root = dirname(dirname(path));
        throw new Error("synthetic directory failure");
      },
      spawnProcess() {
        assert.fail("setup failure must prevent spawn");
      },
    }),
    (error) => {
      assert.equal(error.cleanupComplete, true);
      return true;
    },
  );
  assert.equal(existsSync(root), false);
});

test("preserves and identifies the exact owned root when cleanup fails", async () => {
  let root;
  await assert.rejects(
    startSidecar({
      binaryPath: "/owned/opencode",
      platform: "darwin",
      writeConfig(path) {
        root = dirname(dirname(dirname(path)));
        throw new Error("synthetic write failure");
      },
      removeRoot() {
        throw new Error("synthetic removal failure");
      },
      spawnProcess() {
        assert.fail("setup failure must prevent spawn");
      },
    }),
    (error) => {
      assert.equal(error.cleanupComplete, false);
      assert.equal(error.recoveryPath, root);
      return true;
    },
  );
  assert.equal(existsSync(root), true);
  await rm(root, { recursive: true, force: false });
});

test("rejects a sidecar identity mismatch and waits for the owned process before cleanup", async () => {
  const child = new FakeChild({ exitOnKill: false });
  let root;
  let failure;
  await assert.rejects(
    startSidecar({
      binaryPath: "/owned/opencode",
      platform: "darwin",
      startupTimeoutMs: 500,
      stopTimeoutMs: 10,
      spawnProcess(_binary, _args, options) {
        root = options.env.HOME;
        queueMicrotask(() =>
          child.stdout.write(
            "listening http://127.0.0.1:43121\nserver password test-secret\n",
          ),
        );
        return child;
      },
      makeClient: () => ({
        server: { info: async () => ({ pid: 99, version: "2.0.18" }) },
      }),
    }),
    (error) => {
      failure = error;
      return /OpenCode sidecar unavailable \(Error\)/.test(error.message);
    },
  );
  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(
    existsSync(root),
    true,
    "scratch is preserved when exit could not be confirmed",
  );
  child.emit("exit", null, "SIGKILL");
  assert.equal((await failure.stopOwnedSidecar()).cleanup, "complete");
  assert.equal(existsSync(root), false);
});

test("aborts a stalled session request and reaps its sidecar", async () => {
  const child = new FakeChild();
  const controller = new AbortController();
  let root;
  await assert.rejects(
    startSidecar({
      binaryPath: "/owned/opencode",
      platform: "darwin",
      signal: controller.signal,
      spawnProcess(_binary, _args, options) {
        root = options.env.HOME;
        queueMicrotask(() =>
          child.stdout.write(
            "listening http://127.0.0.1:43121\nserver password test-secret\n",
          ),
        );
        return child;
      },
      makeClient: () => ({
        server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
        session: {
          create: async (_input, { signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new Error("request aborted")),
                { once: true },
              );
              queueMicrotask(() => controller.abort());
            }),
        },
      }),
    }),
    /OpenCode sidecar unavailable/,
  );
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
  assert.equal(existsSync(root), false);
});

test("allows cleanup to be retried until the owned process exits", async () => {
  const child = new FakeChild({ exitOnKill: false });
  let root;
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    stopTimeoutMs: 5,
    spawnProcess(_binary, _args, options) {
      root = options.env.HOME;
      queueMicrotask(() =>
        child.stdout.write(
          "listening http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: { create: async () => ({ id: "synthetic-session" }) },
    }),
  });

  assert.deepEqual(await runtime.stop(), {
    exited: false,
    forced: true,
    cleanup: "incomplete",
  });
  assert.equal(existsSync(root), true);
  child.exitOnKill = true;
  assert.deepEqual(await runtime.stop(), {
    exited: true,
    forced: false,
    cleanup: "complete",
  });
  assert.equal(existsSync(root), false);
});

test("does not treat a process error as proof that an owned PID exited", async () => {
  const child = new FakeChild({ exitOnKill: false });
  let root;
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    stopTimeoutMs: 5,
    spawnProcess(_binary, _args, options) {
      root = options.env.HOME;
      queueMicrotask(() =>
        child.stdout.write(
          "listening http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: { create: async () => ({ id: "synthetic-session" }) },
    }),
  });
  child.emit("error", new Error("synthetic signal failure"));
  assert.deepEqual(await runtime.stop(), {
    exited: false,
    forced: true,
    cleanup: "incomplete",
  });
  assert.equal(existsSync(root), true);
  child.emit("exit", null, "SIGKILL");
  assert.equal((await runtime.stop()).cleanup, "complete");
  assert.equal(existsSync(root), false);
});

test("returns a recoverable cleanup failure after exit and permits one retry", async () => {
  const child = new FakeChild();
  let root;
  let attempts = 0;
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    spawnProcess(_binary, _args, options) {
      root = options.env.HOME;
      queueMicrotask(() =>
        child.stdout.write(
          "listening http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    removeRoot(...args) {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic removal failure");
      return rm(...args);
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: { create: async () => ({ id: "synthetic-session" }) },
    }),
  });
  assert.deepEqual(await runtime.stop(), {
    exited: true,
    forced: false,
    cleanup: "failed",
    recoveryPath: root,
  });
  assert.equal(existsSync(root), true);
  assert.deepEqual(await runtime.stop(), {
    exited: true,
    forced: false,
    cleanup: "complete",
  });
  assert.equal(existsSync(root), false);
});

test("does not terminate a ready sidecar after ordinary runtime output", async () => {
  const child = new FakeChild();
  const runtime = await startSidecar({
    binaryPath: "/owned/opencode",
    platform: "darwin",
    spawnProcess(_binary, _args) {
      queueMicrotask(() =>
        child.stdout.write(
          "listening http://127.0.0.1:43121\nserver password test-secret\n",
        ),
      );
      return child;
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: { create: async () => ({ id: "synthetic-session" }) },
    }),
  });
  child.stdout.write("x".repeat(40 * 1024));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(child.killSignals, []);
  await runtime.stop();
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("durable startup requires callable verified preflight before any setup or spawn", async () => {
  for (const preflight of [
    undefined,
    false,
    async () => false,
    async () => {
      throw new Error("pending");
    },
  ]) {
    let calls = 0;
    const owner = {
      getNonce: () => "nonce",
      assertOwned: async () => ({ state: "ready" }),
    };
    await assert.rejects(
      startSidecar({
        namespace: { root: "/synthetic/private" },
        owner,
        preflight,
        spawnProcess: () => {
          calls++;
        },
        createDirectory: () => {
          calls++;
        },
        writeConfig: () => {
          calls++;
        },
      }),
    );
    assert.equal(calls, 0);
  }
});

import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createStorageOwner,
  createProcessVerifier,
  createElectronOwnerKernel,
} from "./host/storage-lock.mjs";
import {
  openDurableManifest,
  createOSProcessIdentityAdapter,
} from "./sidecar-supervisor.mjs";

test("owned durable child stop preserves config/data/state/WAL, then clean owner release and controlled reacquire", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "p7-durable-supervisor-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const namespace = {
    root,
    documents: root,
    fresh: true,
    metadata: join(root, "metadata"),
    config: join(root, "native", "config"),
    data: join(root, "native", "data"),
    state: join(root, "native", "state"),
  };
  let held = false;
  const kernel = {
    acquire: () => {
      held = true;
      return true;
    },
    isHeld: () => held,
    release: () => {
      held = false;
    },
  };
  const appIdentity = {
    pid: 1234,
    platform: "darwin",
    bootId: "synthetic-boot",
    startToken: "app-1",
  };
  const childIdentity = { ...appIdentity, pid: 4242, startToken: "child-1" };
  const exitProof = new Set();
  const verifier = createProcessVerifier({
    captureCurrent: async () => appIdentity,
    inspect: async (identity) => ({
      state: exitProof.has(identity.startToken) ? "exited" : "alive",
      identity,
      evidence: exitProof.has(identity.startToken)
        ? "owned_exit"
        : "os_identity",
    }),
  });
  const owner = createStorageOwner({ root, kernel, processVerifier: verifier });
  assert.equal((await owner.acquire({ initialize: true })).state, "ready");
  const manifest = await openDurableManifest(namespace, owner);
  assert.equal(manifest.nativeVersion, "2.0.18");
  await mkdir(join(namespace.config, "opencode"));
  const config = join(namespace.config, "opencode", "opencode.json");
  await writeFile(config, '{"synthetic":true}\n', { mode: 0o600 });
  const wal = join(namespace.data, "opencode.db-wal");
  await writeFile(wal, "synthetic WAL");
  const stateFile = join(namespace.state, "sentinel");
  await writeFile(stateFile, "synthetic state");
  let creates = 0;
  let env;
  const child = new FakeChild();
  const runtime = await startSidecar({
    namespace,
    owner,
    preflight: async () => true,
    processIdentity: {
      capture: async () => childIdentity,
      observeExit: () => exitProof.add(childIdentity.startToken),
    },
    binaryPath: "/synthetic/opencode",
    spawnProcess(_binary, _args, options) {
      env = options.env;
      queueMicrotask(() =>
        child.stdout.write(
          "http://127.0.0.1:43121\nserver password synthetic\n",
        ),
      );
      return child;
    },
    makeClient: () => ({
      server: { info: async () => ({ pid: child.pid, version: "2.0.18" }) },
      session: {
        create: () => {
          creates++;
        },
      },
    }),
  });
  assert.equal(creates, 0);
  assert.equal(runtime.workbenchContext().session, undefined);
  assert.equal(env.XDG_CONFIG_HOME, namespace.config);
  assert.equal(env.XDG_DATA_HOME, namespace.data);
  assert.equal(env.XDG_STATE_HOME, namespace.state);
  assert.equal((await runtime.stop()).exited, true);
  assert.equal((await owner.release(owner.getNonce())).released, true);
  assert.equal(await readFile(config, "utf8"), '{"synthetic":true}\n');
  assert.equal(await readFile(wal, "utf8"), "synthetic WAL");
  assert.equal(await readFile(stateFile, "utf8"), "synthetic state");
  // Controlled synthetic lifetime proof for the previous app is explicit. It is
  // not inferred from cleanShutdown or absence of a historical PID.
  exitProof.add(appIdentity.startToken);
  const nextIdentity = { ...appIdentity, pid: 1235, startToken: "app-2" };
  const next = createStorageOwner({
    root,
    kernel,
    processVerifier: createProcessVerifier({
      captureCurrent: async () => nextIdentity,
      inspect: async (identity) => ({
        state: exitProof.has(identity.startToken) ? "exited" : "alive",
        identity,
        evidence: "os_identity",
      }),
    }),
  });
  assert.equal((await next.acquire()).state, "ready");
  assert.equal((await next.release(next.getNonce())).released, true);
});

test("kernel binds the same canonical root synchronously before readiness and profile override", () => {
  const calls = [];
  let held = false;
  const kernel = createElectronOwnerKernel({
    setPath: (...args) => calls.push(args),
    hasSingleInstanceLock: () => held,
    requestSingleInstanceLock: () => {
      calls.push(["acquire"]);
      held = true;
      return true;
    },
    releaseSingleInstanceLock: () => {
      held = false;
    },
  });
  assert.equal(kernel.acquire("/synthetic/store"), true);
  assert.equal(kernel.acquire("/synthetic/store"), true);
  assert.equal(kernel.acquire("/synthetic/other"), false);
  assert.deepEqual(calls, [["userData", "/synthetic/store"], ["acquire"]]);
});

test("OS adapter uses boot and microsecond birth identity, never PID absence or random tokens as exit proof", async () => {
  let missing = false;
  const probes = [];
  const adapter = createOSProcessIdentityAdapter({
    platform: "darwin",
    probe: async (command, args) => {
      probes.push([command, args]);
      if (command.includes("sysctl"))
        return "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      if (missing) throw new Error("missing");
      return "1700000000:123456";
    },
  });
  const identity = await adapter.capture(4242);
  assert.equal(identity.startToken.length, 64);
  assert.equal((await adapter.inspect(identity)).state, "alive");
  missing = true;
  assert.equal((await adapter.inspect(identity)).state, "unverified");
  adapter.observeExit(4242);
  assert.equal((await adapter.inspect(identity)).evidence, "owned_exit");
  assert.ok(
    probes.some(
      ([command, args]) =>
        command === "/usr/bin/python3" && args[1].includes("proc_pidinfo"),
    ),
  );
  const winProbes = [];
  const win = createOSProcessIdentityAdapter({
    platform: "win32",
    probe: async (command, args) => {
      winProbes.push([command, args]);
      return "OK:133800000012345678";
    },
  });
  const winIdentity = await win.capture(4242);
  assert.equal(winIdentity.platform, "win32");
  assert.equal(winIdentity.startToken.length, 64);
  assert.match(
    winProbes[0][0],
    /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/,
  );
  assert.ok(winProbes.every(([, args]) => args.includes("-NoProfile")));
  // One PowerShell launch per sample: no separate boot probe on Windows.
  assert.equal(winProbes.length, 1);
  assert.equal((await win.inspect(winIdentity)).state, "alive");
  assert.equal(winProbes.length, 2);
  // The script fails closed: Stop, own-process positive control, exact output.
  const script = winProbes[0][1].at(-1);
  assert.match(script, /^\$ErrorActionPreference='Stop'/);
  assert.match(script, /ProcessId = \$PID/);
  assert.match(script, /'OK:'\+/);

  let mode = "same";
  let rawValue = "";
  const outputs = {
    same: "OK:133800000012345678",
    absent: "ABSENT",
    reused: "OK:133800099999999999",
  };
  const winProbe = createOSProcessIdentityAdapter({
    platform: "win32",
    probe: async () => {
      if (mode === "throws") throw new Error("powershell failed");
      return mode === "raw" ? rawValue : outputs[mode];
    },
  });
  const known = await winProbe.capture(4242);
  assert.equal((await winProbe.inspect(known)).state, "alive");
  mode = "absent";
  assert.deepEqual(await winProbe.inspect(known), {
    state: "exited",
    identity: known,
    evidence: "os_identity",
  });
  mode = "reused";
  assert.equal((await winProbe.inspect(known)).state, "exited");
  // Any failure, noise or malformed output is unverified, never "exited".
  for (const bad of [
    "throws",
    "garbage",
    "",
    "133800000012345678",
    "OK:12",
    "ABSENT\nOK:133800000012345678",
    "absent",
    "ABSENT ",
    "OK:133800000012345678\r\nWARNING: x",
  ]) {
    mode = bad === "throws" ? "throws" : "raw";
    rawValue = bad;
    assert.equal(
      (await winProbe.inspect(known)).state,
      "unverified",
      JSON.stringify(bad),
    );
  }
  mode = "absent";
  assert.equal(await winProbe.capture(4243), null);
  // The boot identity never changes on Windows, so a clock step cannot fake an exit.
  const first = await createOSProcessIdentityAdapter({
    platform: "win32",
    probe: async () => "OK:133800000012345678",
  }).capture(7);
  const second = await createOSProcessIdentityAdapter({
    platform: "win32",
    probe: async () => "OK:133800000012345678",
  }).capture(7);
  assert.equal(first.bootId, second.bootId);
  assert.equal(
    await createOSProcessIdentityAdapter({ platform: "freebsd" }).capture(4242),
    null,
  );
});

import { freshNativePreflight } from "./sidecar-supervisor.mjs";
test("zero retained app keys cannot prove safe existing native inbox startup", async () => {
  const registry = {
    status: () => ({ state: "ready" }),
    readView: () => ({ retainedOperations: [] }),
  };
  let starts = 0;
  const namespace = { root: "/synthetic/existing", fresh: false };
  assert.equal(freshNativePreflight(namespace, registry), false);
  await assert.rejects(
    startSidecar({
      namespace,
      owner: {
        getNonce: () => "n",
        assertOwned: async () => ({ state: "ready" }),
      },
      preflight: async () => freshNativePreflight(namespace, registry),
      spawnProcess: () => {
        starts++;
      },
    }),
  );
  assert.equal(starts, 0);
  assert.equal(
    freshNativePreflight({ ...namespace, fresh: true }, registry),
    true,
  );
});

test("event host database path is durably bound and incompatible manifest stays byte identical", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "event-host-manifest-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const namespace = {
    root,
    fresh: true,
    metadata: join(root, "metadata"),
    config: join(root, "config"),
    data: join(root, "data"),
    state: join(root, "state"),
  };
  const owner = {
    getNonce: () => "synthetic",
    assertOwned: async () => ({ state: "ready" }),
  };
  const nativeDatabase = join(namespace.data, "event-host.sqlite");
  const first = await openDurableManifest(namespace, owner, { nativeDatabase });
  assert.equal(first.paths.database, nativeDatabase);
  const before = await readFile(join(root, "manifest.json"));
  assert.deepEqual(
    await openDurableManifest({ ...namespace, fresh: false }, owner, {
      nativeDatabase,
    }),
    first,
  );
  await assert.rejects(
    openDurableManifest({ ...namespace, fresh: false }, owner),
    /identity_conflict/,
  );
  await assert.rejects(
    openDurableManifest(namespace, owner, {
      nativeDatabase: join(root, "foreign.sqlite"),
    }),
    /identity_conflict/,
  );
  assert.deepEqual(await readFile(join(root, "manifest.json")), before);
});
test("legacy durable manifest is never silently changed to the event host database", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "event-host-legacy-manifest-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const namespace = {
    root,
    fresh: true,
    metadata: join(root, "metadata"),
    config: join(root, "config"),
    data: join(root, "data"),
    state: join(root, "state"),
  };
  const owner = {
    getNonce: () => "synthetic",
    assertOwned: async () => ({ state: "ready" }),
  };
  await openDurableManifest(namespace, owner);
  const before = await readFile(join(root, "manifest.json"));
  await assert.rejects(
    openDurableManifest({ ...namespace, fresh: false }, owner, {
      nativeDatabase: join(namespace.data, "event-host.sqlite"),
    }),
    /identity_conflict/,
  );
  assert.deepEqual(await readFile(join(root, "manifest.json")), before);
});

import { sidecarBinaryName } from "./sidecar-package.mjs";
test("sidecar binary naming and staged layout have no darwin-only names", () => {
  assert.equal(sidecarBinaryName("win32"), "opencode.exe");
  assert.equal(sidecarBinaryName("darwin"), "opencode");
  assert.equal(
    executableForResources("C:\\r", "win32", "x64").replaceAll("\\", "/"),
    "C:\\r/opencode/win32-x64/opencode.exe".replaceAll("\\", "/"),
  );
});
