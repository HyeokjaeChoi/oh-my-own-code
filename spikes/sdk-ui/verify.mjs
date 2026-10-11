import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(here, path));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const manifest = json("package.json");
const registry = json("vendor/tool-ui/link-preview.registry.json");
const provenance = json("vendor/tool-ui/provenance.json");
const digest = createHash("sha256").update(read("vendor/tool-ui/link-preview.registry.json")).digest("hex");
assert.equal(digest, provenance.registrySha256);
assert.match(read("vendor/tool-ui/LICENSE.md").toString("utf8"), /^MIT License/);
assert.equal(createHash("sha256").update(read("vendor/tool-ui/LICENSE.md")).digest("hex"), provenance.licenseSha256);
assert.equal(provenance.license, "MIT");
for (const file of registry.files) {
  assert.equal(read(join("vendor/tool-ui", file.path)).toString("utf8"), file.content, file.path);
}
for (const [name, version] of Object.entries(manifest.dependencies)) {
  assert.equal(json(join("node_modules", name, "package.json")).version, version, name);
}
assert.equal(manifest.dependencies["@opencode/sdk"], "2.0.18");
assert.equal(manifest.dependencies["@opencode/client"], "2.0.18");
assert.equal(manifest.dependencies["@assistant-ui/react"], "0.15.22");
assert.equal(manifest.dependencies["@assistant-ui/react-opencode"], undefined);
assert.match(read("pnpm-lock.yaml").toString("utf8"), /'@opencode\/sdk':\s*\n\s*specifier: 2\.0\.18/);
assert.match(read("pnpm-lock.yaml").toString("utf8"), /'@assistant-ui\/react':\s*\n\s*specifier: 0\.15\.22/);
const sdkPackage = json("node_modules/@opencode/sdk/package.json");
assert.equal(sdkPackage.exports["."].import, "./dist/index.js");
assert.equal(sdkPackage.dependencies["@opencode/client"], "2.0.18");
console.log("PASS pinned packages, lockfile, genuine Tool UI registry source and MIT license");

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: here, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${args.join(" ")} exited ${result.status}`);
}
run([resolve(here, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.client-probe.json"]);
console.log("PASS strict @opencode/client public types and injected fetch boundary");
run(["client-probe.mjs"]);
run(["--import", "tsx", "runtime-info-probe.ts"]);
run([resolve(here, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"]);
console.log("PASS TypeScript UI/SDK host type boundary");
run(["--import", "tsx", "probe.tsx"]);
console.log("NOT READY embedded host lifecycle, credentials/config isolation, native event replay and live tool dispatch");
console.log("NOT EXECUTED browser interaction, accessibility, cancel/reconnect and production UI");
