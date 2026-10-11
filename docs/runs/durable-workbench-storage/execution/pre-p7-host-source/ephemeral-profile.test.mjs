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
