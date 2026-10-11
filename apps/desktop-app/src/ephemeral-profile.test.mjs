import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureEphemeralProfile } from "./ephemeral-profile.mjs";

test("confines Electron profile, session, log, and crash paths to removable temp storage", () => {
  const parent = mkdtempSync(join(tmpdir(), "oh-my-own-code-profile-test-"));
  const configured = new Map();
  const profile = configureEphemeralProfile(
    { setPath: (name, path) => configured.set(name, path) },
    parent,
  );
  try {
    assert.deepEqual(
      [...configured.keys()],
      ["userData", "sessionData", "crashDumps", "logs"],
    );
    for (const [name, path] of configured) {
      assert.equal(path, profile.paths[name]);
      assert.equal(path.startsWith(profile.root), true);
      assert.equal(existsSync(path), true);
    }
    profile.cleanup();
    assert.equal(existsSync(profile.root), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

import { mkdirSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { prepareDurableNamespace } from "./ephemeral-profile.mjs";
import { createElectronOwnerKernel } from "./host/storage-lock.mjs";

test("native Documents/appData resolution and sync canonical kernel precede ephemeral override", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "p7-path-order-")));
  try {
    const documents = join(parent, "Documents");
    const appData = join(parent, "AppData");
    mkdirSync(documents, { mode: 0o700 });
    mkdirSync(appData, { mode: 0o700 });
    const sentinel = join(documents, "sentinel");
    writeFileSync(sentinel, "synthetic user project");
    const calls = [];
    let held = false;
    const app = {
      getPath(name) {
        calls.push(`get:${name}`);
        return name === "documents" ? documents : appData;
      },
      setPath(name, path) {
        calls.push(`set:${name}:${path}`);
      },
      hasSingleInstanceLock: () => held,
      requestSingleInstanceLock() {
        calls.push("kernel");
        held = true;
        return true;
      },
      releaseSingleInstanceLock() {
        held = false;
      },
    };
    const namespace = prepareDurableNamespace(app);
    const kernel = createElectronOwnerKernel(app);
    assert.equal(kernel.acquire(namespace.root), true);
    const profile = configureEphemeralProfile(app, parent, [
      namespace.root,
      documents,
    ]);
    assert.deepEqual(calls.slice(0, 4), [
      "get:documents",
      "get:appData",
      `set:userData:${namespace.root}`,
      "kernel",
    ]);
    assert.notEqual(profile.paths.userData, namespace.root);
    assert.equal(kernel.acquire(namespace.root), true);
    profile.cleanup();
    assert.equal(readFileSync(sentinel, "utf8"), "synthetic user project");
    assert.equal(existsSync(namespace.root), true);
    kernel.release();
    assert.equal(prepareDurableNamespace(app).fresh, false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
