// Contained zero-window OS-lifetime fixture. Never imports production Main.
import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  prepareDurableNamespace,
  configureEphemeralProfile,
} from "../../src/ephemeral-profile.mjs";
import {
  createStorageOwner,
  createElectronOwnerKernel,
  createProcessVerifier,
} from "../../src/host/storage-lock.mjs";
import { createLifetimeWitness } from "../../src/host/owner-lifetime.mjs";
import {
  createOSProcessIdentityAdapter,
  freshNativePreflight,
  openDurableManifest,
  startSidecar,
} from "../../src/sidecar-supervisor.mjs";
import { eventHostForResources } from "../../src/event-host-resources.mjs";
import { openWorkspaceRegistry } from "../../src/host/workspace-registry.mjs";

process.umask(0o077);
let owner, runtime, registry, profile, childHandle, witnessChild;
let finished = false;
let nativeSpawnCount = 0;
const reply = (value) => process.send?.(value);
const args = process.argv.slice(2);
assert.equal(args.length, 2);
assert.equal(args[0], "--configuration");
const configPath = resolve(args[1]);
const configuration = JSON.parse(await fs.readFile(configPath, "utf8"));
assert.deepEqual(
  Object.keys(configuration).sort(),
  [
    "anchor",
    "native",
    "resourcesPath",
    ...(Object.hasOwn(configuration, "observedChildPid")
      ? ["observedChildPid"]
      : []),
  ].sort(),
);
assert.equal(typeof configuration.native, "boolean");
if (Object.hasOwn(configuration, "observedChildPid")) {
  assert.equal(configuration.native, false);
  assert.ok(
    Number.isSafeInteger(configuration.observedChildPid) &&
      configuration.observedChildPid > 0,
  );
}
const anchor = await fs.realpath(configuration.anchor);
assert.equal(anchor, configuration.anchor);
const stat = await fs.lstat(anchor);
assert.ok(
  stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === process.getuid() &&
    !(stat.mode & 0o077),
);
const identity = createOSProcessIdentityAdapter();
const assertNoWindows = () =>
  assert.equal(BrowserWindow.getAllWindows().length, 0);
function trackChild(child, role) {
  reply({ type: "descendant", role, pid: child.pid });
  child.once("exit", (code, signal) =>
    reply({ type: "descendant-exit", role, pid: child.pid, code, signal }),
  );
  return child;
}

async function finish(releaseOnly = false) {
  if (finished) return;
  finished = true;
  assertNoWindows();
  let stop;
  if (runtime) {
    stop = await runtime.stop();
    assert.equal(stop.exited, true);
    assert.ok(["complete", "already_stopped"].includes(stop.cleanup));
  }
  if (registry) {
    await registry.checkpoint();
    await registry.close();
  }
  const released = await owner.release(owner.getNonce());
  assert.equal(released.released, true);
  reply({ type: "released", stop, nativeSpawnCount, zeroWindows: true });
  if (releaseOnly) return;
  profile?.cleanup();
  app.exit(0);
}

process.on("message", (message) => {
  if (!message || Object.keys(message).length !== 1) return;
  if (message.type === "close") void finish().catch(() => app.exit(1));
  if (message.type === "release-live")
    void finish(true).catch(() => app.exit(1));
  if (message.type === "exit-released" && finished) {
    profile?.cleanup();
    app.exit(0);
  }
});

try {
  app.setActivationPolicy("prohibited");
  app.setPath("appData", join(anchor, "app-data"));
  app.setPath("documents", join(anchor, "Documents"));
  const namespace = prepareDurableNamespace(app);
  const kernel = createElectronOwnerKernel(app);
  assert.ok(kernel.acquire(namespace.root));
  profile = configureEphemeralProfile(app, join(anchor, "profiles"), [
    namespace.root,
    namespace.documents,
  ]);
  owner = createStorageOwner({
    root: namespace.root,
    kernel,
    processVerifier: createProcessVerifier(identity),
    lifetimeWitness: createLifetimeWitness({
      resourcesPath: configuration.resourcesPath,
      processIdentity: identity,
      // Capture the actual helper handle for test observation only. No fake
      // verifier, completion, historical exit or startup authority is injected.
      spawn: (...parameters) => {
        witnessChild = trackChild(spawn(...parameters), "witness");
        return witnessChild;
      },
    }),
  });
  const acquisition = await owner.acquire({ initialize: namespace.fresh });
  if (acquisition.state !== "ready") {
    reply({
      type: "blocked",
      acquisition,
      nativeSpawnCount,
      zeroWindows: true,
    });
    profile.cleanup();
    app.exit(0);
  } else {
    // Electron waits for entry-module evaluation before emitting ready.
    // Finish all pre-ready setup above, then leave this continuation unawaited.
    void (async () => {
      await app.whenReady();
      assertNoWindows();
      if (configuration.observedChildPid) {
        await owner.markSpawnIntent(owner.getNonce());
        const observed = await identity.capture(configuration.observedChildPid);
        assert.ok(observed);
        await owner.recordChild(owner.getNonce(), observed);
      }
      if (configuration.native) {
        const manifest = await openDurableManifest(namespace, owner, {
          nativeDatabase: join(namespace.data, "event-host.sqlite"),
        });
        registry = await openWorkspaceRegistry({
          directory: namespace.metadata,
          documentsPath: namespace.documents,
          storeId: manifest.storeId,
          runtimeEpoch: randomUUID(),
        });
        assert.equal(freshNativePreflight(namespace, registry), true);
        await registry.recordOwnerIntent({
          ownerNonce: owner.getNonce(),
          phase: "startup",
        });
        runtime = await startSidecar({
          eventHost: eventHostForResources(
            configuration.resourcesPath,
            process.platform,
            process.arch,
          ),
          namespace,
          owner,
          processIdentity: identity,
          preflight: async () => freshNativePreflight(namespace, registry),
          spawnProcess: (...parameters) => {
            nativeSpawnCount++;
            childHandle = trackChild(spawn(...parameters), "native");
            return childHandle;
          },
        });
        assert.equal(nativeSpawnCount, 1);
        assert.equal(runtime.processId, childHandle.pid);
      }
      const record = JSON.parse(
        await fs.readFile(join(namespace.root, "owner.json"), "utf8"),
      );
      reply({
        type: "ready",
        root: namespace.root,
        record,
        witnessPid: witnessChild?.pid,
        nativeSpawnCount,
        zeroWindows: true,
        nonfreshStartupHeld: namespace.fresh
          ? null
          : freshNativePreflight(namespace) === false,
      });
    })().catch(fail);
  }
} catch (error) {
  await fail(error);
}
async function fail(error) {
  reply({
    type: "failure",
    code: /^[a-z_]{1,64}$/.test(error?.code ?? "")
      ? error.code
      : "fixture_failed",
    nativeSpawnCount,
    zeroWindows: BrowserWindow.getAllWindows().length === 0,
  });
  if (runtime) {
    try {
      await runtime.stop();
    } catch {
      /* Retain contained namespace. */
    }
  }
  app.exit(1);
}
