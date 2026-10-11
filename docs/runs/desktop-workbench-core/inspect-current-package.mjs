import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = dirname(fileURLToPath(import.meta.url));
const root = resolve(run, "../../..");
const desktop = join(root, "apps/desktop-app");
const require = createRequire(join(desktop, "package.json"));
const packager = require.resolve("@electron/packager");
const { extractAll } = await import(pathToFileURL(createRequire(packager).resolve("@electron/asar")).href);
const archive = join(desktop, "dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app/Contents/Resources/app.asar");
const scratch = await mkdtemp(join(tmpdir(), "omoc-current-package-"));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) result.push(...await files(directory, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}
try {
  await extractAll(archive, scratch);
  const built = join(desktop, "dist/app");
  const expected = await files(built);
  assert.deepEqual(await files(scratch), expected);
  const compared = [];
  for (const path of expected) {
    const actual = await digest(join(scratch, path));
    assert.equal(actual, await digest(join(built, path)), path);
    compared.push({ path, sha256: actual });
  }
  const report = { result: "pass", archive, appAsarSha256: await digest(archive), matchedFiles: compared.length, files: compared };
  await writeFile(join(run, "package-source-match.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ result: "pass", matchedFiles: compared.length, appAsarSha256: report.appAsarSha256 }));
} finally {
  await rm(scratch, { recursive: true, force: false });
}
