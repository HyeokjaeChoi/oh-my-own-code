import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStagedPty } from "./host/pty-loader.mjs";

function staged(withShadow) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pty-loader-")));
  mkdirSync(join(root, "node-pty", "lib"), { recursive: true });
  writeFileSync(
    join(root, "node-pty", "lib", "index.js"),
    "module.exports = { spawn() {}, marker: 'staged' };",
  );
  if (withShadow)
    mkdirSync(join(root, "node-pty", withShadow, "Release"), {
      recursive: true,
    });
  return root;
}

test("loadStagedPty loads the staged module", () => {
  assert.equal(loadStagedPty(staged())?.marker, "staged");
});

test("loadStagedPty refuses a missing install or a build/ shadow tree", () => {
  assert.equal(loadStagedPty(join(tmpdir(), "does-not-exist-pty")), undefined);
  assert.equal(loadStagedPty(staged("build")), undefined);
  const nested = staged();
  mkdirSync(join(nested, "node-pty", "lib", "build"));
  assert.equal(loadStagedPty(nested), undefined);
});
