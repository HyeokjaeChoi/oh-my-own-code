// Newly execute the exact affected Node set; native kernel fixtures have a separate contracted check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const argv = JSON.parse(
  await readFile(new URL("./unit-argv-r1.json", import.meta.url), "utf8"),
);
assert.ok(
  Array.isArray(argv) &&
    argv[0] === "node" &&
    argv.includes("--test-concurrency=1"),
);
const result = spawnSync(argv[0], argv.slice(1), {
  stdio: "inherit",
  timeout: 600000,
});
assert.equal(result.error, undefined);
assert.equal(result.status, 0);
