// Saved local macOS lifetime acceptance. Zero windows, synthetic contained data.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import { createOSProcessIdentityAdapter } from "../src/sidecar-supervisor.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runRoot = join(repository, "docs/runs/durable-owner-lifetime/evidence");
const hostFile = join(
  repository,
  "apps/desktop-app/scripts/fixtures/owner-lifetime-probe-host.mjs",
);
const ownFile = fileURLToPath(import.meta.url);
const observerFile = join(
  repository,
  "apps/desktop-app/scripts/fixtures/owner-lifetime-exit-observer.py",
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const require = createRequire(import.meta.url);
const children = new Set();
const anchors = [];
let output;
let phase = "arguments";
const descendants = new Map();

async function claim(path) {
  const inside = relative(runRoot, path);
  assert.ok(
    inside &&
      inside !== ".." &&
      !inside.startsWith(`..${sep}`) &&
      !isAbsolute(inside),
  );
  let current = sep;
  for (const part of path.slice(sep.length).split(sep)) {
    current = join(current, part);
    if (current === path) await fs.mkdir(current, { mode: 0o700 });
    else {
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const stat = await fs.lstat(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const handle = await fs.open(
    join(path, ".owner-lifetime-claim"),
    "wx",
    0o600,
  );
  await handle.close();
}
async function boundedFileHash(path) {
  const stat = await fs.lstat(path);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.size <= 1024 ** 3,
  );
  return digest(await fs.readFile(path));
}
async function identities() {
  const provenance = await captureProvenance(repository, {
    script: "smoke",
    mode: "packaged",
    platform: "darwin",
  });
  return {
    provenance,
    host: await boundedFileHash(hostFile),
    probe: await boundedFileHash(ownFile),
    observer: await boundedFileHash(observerFile),
    electron: await boundedFileHash(require("electron")),
  };
}
async function anchor(name) {
  const path = join(output, name);
  await fs.mkdir(path, { mode: 0o700 });
  for (const child of ["app-data", "Documents", "profiles", "home", "tmp"])
    await fs.mkdir(join(path, child), { mode: 0o700 });
  anchors.push(path);
  return path;
}
async function launch(path, native, resourcesPath, observedChildPid) {
  const configuration = join(
    path,
    `configuration-${children.size}-${Date.now()}.json`,
  );
  await fs.writeFile(
    configuration,
    JSON.stringify({
      anchor: path,
      native,
      resourcesPath,
      ...(observedChildPid ? { observedChildPid } : {}),
    }),
    { flag: "wx", mode: 0o600 },
  );
  const child = spawn(
    require("electron"),
    [hostFile, "--configuration", configuration],
    {
      env: {
        HOME: join(path, "home"),
        TMPDIR: join(path, "tmp"),
        TMP: join(path, "tmp"),
        TEMP: join(path, "tmp"),
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        LANG: "C",
        CI: "1",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      shell: false,
    },
  );
  const messages = [];
  let exited;
  let spawnError = false;
  child.on("message", (message) => {
    if (
      messages.length >= 16 ||
      Buffer.byteLength(JSON.stringify(message)) > 16384
    ) {
      spawnError = true;
      return;
    }
    messages.push(message);
    if (
      message.type === "descendant" &&
      ["native", "witness"].includes(message.role) &&
      Number.isSafeInteger(message.pid) &&
      message.pid > 0
    )
      descendants.set(message.pid, {
        role: message.role,
        pid: message.pid,
        appPid: child.pid,
        exited: false,
      });
    if (message.type === "descendant-exit") {
      const tracked = descendants.get(message.pid);
      if (tracked?.appPid === child.pid && tracked.role === message.role) {
        tracked.exited = true;
        tracked.evidence = "owned-child-exit-event";
      }
    }
  });
  const done = new Promise((complete) => {
    child.once("error", () => {
      spawnError = true;
      complete({ error: true });
    });
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      complete(exited);
    });
  });
  const controller = {
    child,
    done,
    async next(type, timeoutMs = 120000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const message = messages.find((entry) => entry.type === type);
        if (message) return message;
        assert.ok(
          !spawnError &&
            !exited &&
            !messages.some((entry) => entry.type === "failure"),
          "Lifetime fixture ended before expected phase",
        );
        await sleep(50);
      }
      throw new Error("Lifetime fixture deadline");
    },
    async close(type = "close") {
      assert.ok(!exited);
      child.send({ type });
      const result = await Promise.race([done, sleep(20000).then(() => null)]);
      assert.ok(
        result && result.code === 0 && result.signal === null,
        "Owned fixture exit unconfirmed",
      );
      return result;
    },
    get exited() {
      return exited;
    },
    get messages() {
      return messages;
    },
  };
  children.add(controller);
  return controller;
}
async function terminal(record, root) {
  const path = join(root, "lifetime-witness-v1", record.nonce, "terminal");
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    try {
      const content = await fs.readFile(path, "utf8");
      if (content.endsWith("\n")) return { path, sha256: digest(content) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await sleep(50);
  }
  throw new Error("Kernel lifetime terminal not published");
}
async function observeHelper(ready) {
  assert.ok(Number.isSafeInteger(ready.witnessPid) && ready.witnessPid > 0);
  const expected = await createOSProcessIdentityAdapter().capture(
    ready.witnessPid,
  );
  assert.ok(expected);
  const child = spawn(
    "/usr/bin/python3",
    [observerFile, JSON.stringify(expected)],
    {
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    },
  );
  let text = "",
    exited;
  child.stdout.on("data", (bytes) => {
    text += bytes.toString("ascii");
    if (text.length > 16) child.kill("SIGKILL");
  });
  const done = new Promise((complete) => {
    child.once("error", () => complete({ error: true }));
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      complete(exited);
    });
  });
  const owned = {
    child,
    done,
    get exited() {
      return exited;
    },
  };
  children.add(owned);
  const until = Date.now() + 10000;
  while (text !== "READY\n" && Date.now() < until && !exited) await sleep(25);
  assert.equal(
    text,
    "READY\n",
    "Exact helper lifetime observer registration failed",
  );
  return {
    async ended() {
      const result = await Promise.race([done, sleep(25000).then(() => null)]);
      assert.deepEqual(result, { code: 0, signal: null });
      assert.equal(text, "READY\nEXIT\n");
      const tracked = descendants.get(expected.pid);
      if (tracked?.role === "witness") {
        tracked.exited = true;
        tracked.evidence = "exact-kernel-exit-observer";
      }
      return {
        identity: expected,
        event: "EVFILT_PROC:NOTE_EXIT",
        observedBeforeAndAfterAttach: true,
        exited: true,
        observerExit: result,
        productionRecoveryInput: false,
      };
    },
  };
}
async function protectedBytes(root) {
  const entries = [];
  async function walk(path, prefix) {
    let stat;
    try {
      stat = await fs.lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)).sort())
        await walk(join(path, name), `${prefix}/${name}`);
    } else {
      assert.ok(entries.length < 2048 && stat.isFile());
      entries.push({
        path: prefix,
        sha256: await boundedFileHash(path),
        size: stat.size,
      });
    }
  }
  for (const path of [
    "owner.json",
    "owner.pending",
    "owner.next",
    "native",
    "metadata",
  ])
    await walk(join(root, path), path);
  return entries;
}
function observedChild(path) {
  // This probe-owned inert process is registered through the production owner.
  // It is not Native and does not read or write the synthetic durable store.
  const child = spawn(
    process.execPath,
    ["--eval", "setInterval(() => {}, 1000)"],
    {
      cwd: path,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: join(path, "home"),
        TMPDIR: join(path, "tmp"),
      },
      stdio: "ignore",
      shell: false,
    },
  );
  let exited;
  const done = new Promise((resolve) => {
    child.once("error", () => resolve({ error: true }));
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      resolve(exited);
    });
  });
  const owned = {
    child,
    done,
    get exited() {
      return exited;
    },
  };
  children.add(owned);
  return owned;
}

const report = {
  result: "fail",
  platform: process.platform,
  architecture: process.arch,
  observations: [],
  failure: null,
  cleanup: [],
  namespacesRetained: anchors,
  limitations: [
    "OS lifetime and owner reacquisition only; nonfresh Native remains blocked.",
    "Zero-window synthetic stores and authentication-free server; no provider/private stores/production Main.",
    "Direct child handles assert cleanup and own SIGKILL; historical recovery has no ownedExited injection.",
    "No Windows, power-loss, hostile same-user or filesystem isolation claim.",
  ],
};
try {
  assert.deepEqual(process.argv.slice(2, 3), ["--out"]);
  assert.equal(process.argv.length, 4);
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const metadata = JSON.parse(
    await fs.readFile(
      join(repository, "apps/desktop-app/package.json"),
      "utf8",
    ),
  );
  assert.equal(
    require("electron/package.json").version,
    metadata.devDependencies.electron,
  );
  const requestedOutput = resolve(repository, process.argv[3]);
  await claim(requestedOutput);
  output = requestedOutput;
  const before = await identities();
  report.before = before;
  const resourcesPath = join(
    repository,
    "apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app/Contents/Resources",
  );
  const inspector = createOSProcessIdentityAdapter();
  for (const kind of ["normal-native", "crash-native", "app-only"]) {
    phase = `${kind}:registration`;
    const path = await anchor(kind);
    const first = await launch(path, kind !== "app-only", resourcesPath);
    const ready = await first.next("ready");
    assert.equal(ready.zeroWindows, true);
    assert.equal(ready.nativeSpawnCount, kind === "app-only" ? 0 : 1);
    assert.ok(ready.record.app.pid === first.child.pid);
    const observedAppIdentity = await inspector.capture(first.child.pid);
    assert.deepEqual(observedAppIdentity, ready.record.app);
    const helperObserver = await observeHelper(ready);
    phase = `${kind}:exit`;
    let exit;
    if (kind === "crash-native") {
      assert.equal(first.child.kill("SIGKILL"), true);
      exit = await Promise.race([first.done, sleep(10000).then(() => null)]);
      assert.equal(exit?.signal, "SIGKILL");
    } else exit = await first.close();
    const proof = await terminal(ready.record, ready.root);
    const helperExit = await helperObserver.ended();
    if (ready.record.child) {
      const tracked = descendants.get(ready.record.child.pid);
      assert.ok(tracked?.role === "native");
      tracked.exited = true;
      tracked.evidence = "context-bound-kernel-child-exit-and-terminal";
    }
    phase = `${kind}:reacquisition`;
    const reopen = await launch(path, false, resourcesPath);
    const reacquired = await reopen.next("ready");
    assert.equal(reacquired.zeroWindows, true);
    assert.equal(reacquired.nativeSpawnCount, 0);
    assert.equal(reacquired.nonfreshStartupHeld, true);
    assert.notEqual(reacquired.record.nonce, ready.record.nonce);
    assert.equal(reacquired.record.child, null);
    const reopenedObserver = await observeHelper(reacquired);
    await reopen.close();
    const reopenedProof = await terminal(reacquired.record, reacquired.root);
    report.observations.push({
      kind,
      original: ready.record,
      originalExit: exit,
      proof,
      reacquired: reacquired.record,
      reopenedProof,
      helperExit,
      reopenedHelperExit: await reopenedObserver.ended(),
      productionHistoricalVerifier: true,
      injectedExitProofs: false,
      nonfreshNativeStarts: 0,
    });
  }
  {
    const path = await anchor("live-app-after-release");
    const first = await launch(path, false, resourcesPath);
    const ready = await first.next("ready");
    const helperObserver = await observeHelper(ready);
    first.child.send({ type: "release-live" });
    await first.next("released");
    const bytes = await protectedBytes(ready.root);
    const contender = await launch(path, false, resourcesPath);
    const blocked = await contender.next("blocked");
    assert.deepEqual(blocked.acquisition, {
      state: "recovery_required",
      reason: "owner_unverified",
    });
    assert.equal(blocked.nativeSpawnCount, 0);
    await contender.done;
    assert.deepEqual(await protectedBytes(ready.root), bytes);
    await first.close("exit-released");
    await terminal(ready.record, ready.root);
    report.observations.push({
      kind: "live-app-after-release",
      blocked,
      bytesPreserved: true,
      helperExit: await helperObserver.ended(),
    });
  }
  {
    phase = "live-child:registration";
    const path = await anchor("live-child");
    const inert = observedChild(path);
    const first = await launch(path, false, resourcesPath, inert.child.pid);
    const ready = await first.next("ready");
    assert.equal(ready.record.child.pid, inert.child.pid);
    const helperObserver = await observeHelper(ready);
    assert.equal(first.child.kill("SIGKILL"), true);
    assert.equal((await first.done).signal, "SIGKILL");
    phase = "live-child:denial";
    const bytes = await protectedBytes(ready.root);
    const contender = await launch(path, false, resourcesPath);
    const blocked = await contender.next("blocked");
    assert.equal(blocked.acquisition.state, "recovery_required");
    assert.ok(
      ["owner_conflict", "owner_unverified"].includes(
        blocked.acquisition.reason,
      ),
    );
    assert.equal(blocked.nativeSpawnCount, 0);
    await contender.done;
    assert.deepEqual(await protectedBytes(ready.root), bytes);
    await assert.rejects(
      fs.lstat(
        join(ready.root, "lifetime-witness-v1", ready.record.nonce, "terminal"),
      ),
      { code: "ENOENT" },
    );
    assert.equal(inert.child.kill("SIGTERM"), true);
    await inert.done;
    await terminal(ready.record, ready.root);
    report.observations.push({
      kind: "live-child",
      blocked,
      bytesPreserved: true,
      inertChildExit: inert.exited,
      helperExit: await helperObserver.ended(),
      productionRecordedChild: true,
      nativeStarts: 0,
    });
  }
  for (const kind of [
    "corrupt-terminal",
    "missing-terminal",
    "incomplete-app-exit",
  ]) {
    phase = `${kind}:registration`;
    const path = await anchor(kind);
    const first = await launch(path, false, resourcesPath);
    const ready = await first.next("ready");
    const helperObserver = await observeHelper(ready);
    await first.close();
    const proof = await terminal(ready.record, ready.root);
    const helperExit = await helperObserver.ended();
    await fs.writeFile(
      join(path, "original-terminal.txt"),
      await fs.readFile(proof.path),
      { flag: "wx", mode: 0o600 },
    );
    const failedPath =
      kind === "incomplete-app-exit"
        ? join(dirname(proof.path), "app.exit")
        : proof.path;
    if (kind === "corrupt-terminal")
      await fs.appendFile(failedPath, "fixture-corruption\n");
    if (kind === "missing-terminal")
      await fs.rename(failedPath, join(path, "retained-missing-terminal.txt"));
    if (kind === "incomplete-app-exit") {
      await fs.writeFile(
        join(path, "original-app-exit.txt"),
        await fs.readFile(failedPath),
        { flag: "wx", mode: 0o600 },
      );
      await fs.writeFile(failedPath, "V1\texit\tapp\t");
    }
    const bytes = await protectedBytes(ready.root);
    const failedProofSha256 =
      kind === "missing-terminal" ? null : await boundedFileHash(failedPath);
    phase = `${kind}:denial`;
    const reopen = await launch(path, false, resourcesPath);
    const blocked = await reopen.next("blocked");
    assert.deepEqual(blocked.acquisition, {
      state: "recovery_required",
      reason:
        kind === "incomplete-app-exit"
          ? "identity_conflict"
          : "owner_unverified",
    });
    assert.equal(blocked.nativeSpawnCount, 0);
    await reopen.done;
    assert.deepEqual(await protectedBytes(ready.root), bytes);
    if (failedProofSha256)
      assert.equal(await boundedFileHash(failedPath), failedProofSha256);
    else await assert.rejects(fs.lstat(failedPath), { code: "ENOENT" });
    report.observations.push({
      kind,
      blocked,
      originalTerminal: proof.sha256,
      failedProofSha256,
      bytesPreserved: true,
      helperExit,
    });
  }
  const after = await identities();
  report.after = after;
  assert.deepEqual(
    after,
    before,
    "Source/build/package/native/helper/probe bytes changed",
  );
  report.identitiesUnchanged = true;
  report.result = "pass";
} catch (error) {
  report.failure = {
    phase,
    name: error?.name ?? "Error",
    code: /^[a-z_]{1,64}$/.test(error?.code ?? "")
      ? error.code
      : "probe_failed",
  };
  report.fixtureMessages = [...children].flatMap(
    (owned) => owned.messages ?? [],
  );
  process.exitCode = 1;
} finally {
  for (const owned of children) {
    if (!owned.exited) {
      // The exact retained ChildProcess is the only forced cleanup target.
      owned.child.kill("SIGKILL");
      await Promise.race([owned.done, sleep(10000)]);
    }
    report.cleanup.push({
      pid: owned.child.pid,
      exited: Boolean(owned.exited),
      exit: owned.exited ?? null,
    });
  }
  report.descendantCleanup = [...descendants.values()];
  report.cleanupUnconfirmed =
    report.cleanup.some((entry) => !entry.exited) ||
    report.descendantCleanup.some((entry) => !entry.exited);
  if (report.cleanupUnconfirmed) {
    report.result = "fail";
    process.exitCode = 1;
  }
  if (output) {
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    assert.ok(Buffer.byteLength(bytes) <= 4 * 1024 * 1024);
    await fs.writeFile(join(output, "owner-lifetime-evidence.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  console.log(
    JSON.stringify({
      result: report.result,
      output,
      namespacesRetained: anchors.length,
      cleanupUnconfirmed: report.cleanupUnconfirmed,
    }),
  );
}
