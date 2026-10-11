import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rendererRoot = join(
  root,
  "apps",
  "desktop-app",
  "dist",
  "app",
  "renderer",
);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.(?:html|js|css)$/.test(entry.name)) files.push(path);
  }
}

await collect(rendererRoot);
assert(
  files.some((path) => path.endsWith("index.html")),
  "renderer HTML exists",
);
assert(
  files.some((path) => path.endsWith(".js")),
  "renderer JavaScript exists",
);

const forbidden = [
  /server password\s+\S+/i,
  /opencode:[^\s"'`]+/i,
  /https?:\/\/127\.0\.0\.1:\d+/i,
  /\bipcRenderer\b/,
  /\bchild_process\b/,
];
const hashes = [];
for (const file of files) {
  const source = await readFile(file);
  const text = source.toString("utf8");
  for (const pattern of forbidden)
    assert.equal(
      pattern.test(text),
      false,
      `${pattern} must not appear in ${file}`,
    );
  hashes.push({
    file: file.slice(rendererRoot.length + 1),
    sha256: createHash("sha256").update(source).digest("hex"),
  });
}
const html = await readFile(join(rendererRoot, "index.html"), "utf8");
assert.match(
  html,
  /connect-src 'none'/,
  "renderer CSP denies network connections",
);
console.log(JSON.stringify({ result: "pass", rendererFiles: hashes }, null, 2));
