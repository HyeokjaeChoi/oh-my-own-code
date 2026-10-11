import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const baseline = JSON.parse(
  await fs.readFile(
    new URL("./prechange-inventory.json", import.meta.url),
    "utf8",
  ),
);
const paths = [];
async function walk(folder) {
  for (const e of await fs.readdir(folder, { withFileTypes: true })) {
    const path = join(folder, e.name);
    if (e.isDirectory()) await walk(path);
    else if (e.isFile() && /\.(?:mjs|ts|tsx|mts|css|py)$/u.test(path)) {
      const hash = createHash("sha256")
        .update(await fs.readFile(path))
        .digest("hex");
      if (
        hash !==
        (typeof baseline[path] === "string"
          ? baseline[path]
          : baseline[path]?.sha256)
      )
        paths.push(path);
    }
  }
}
await walk("apps/desktop-app/src");
await walk("apps/desktop-app/scripts");
const configPath = "apps/desktop-app/eslint.config.mjs";
const configHash = createHash("sha256")
  .update(await fs.readFile(configPath))
  .digest("hex");
if (
  configHash !==
  (typeof baseline[configPath] === "string"
    ? baseline[configPath]
    : baseline[configPath]?.sha256)
)
  paths.push(configPath);
paths.sort();
const mode = process.argv[2];
assert.ok(["lint", "format"].includes(mode));
const selected = paths.filter((p) =>
  mode === "lint" ? /\.(?:mjs|ts|tsx|mts)$/u.test(p) : !/\.py$/u.test(p),
);
assert.ok(selected.length > 0);
const args =
  mode === "lint"
    ? [
        "exec",
        "eslint",
        "--config",
        "apps/desktop-app/eslint.config.mjs",
        ...selected,
      ]
    : ["exec", "prettier", "--check", ...selected];
const child = spawnSync("pnpm", args, { stdio: "inherit", timeout: 120000 });
console.log(
  JSON.stringify({
    mode,
    paths: selected,
    exit: child.status,
    error: child.error?.code,
  }),
);
assert.equal(child.error, undefined);
assert.equal(child.status, 0);
