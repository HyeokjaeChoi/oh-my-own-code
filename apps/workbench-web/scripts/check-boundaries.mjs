import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  analyzeSource,
  bridgeSourceRoot,
  contractsSourceRoot,
  repositoryRoot,
  uiSourceRoot,
} from "./boundary-policy.mjs";

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collect(path) : [path];
    }),
  );
  return files.flat();
}

const browserFiles = (
  await collect(resolve(repositoryRoot, "apps/workbench-web/src"))
).filter(
  (path) => /\.(?:ts|tsx)$/.test(path) && !/\.test\.(?:ts|tsx)$/.test(path),
);
const shippedUiFiles = (await collect(uiSourceRoot)).filter((path) =>
  /\.(?:ts|tsx)$/.test(path),
);
const shippedContractFiles = (await collect(contractsSourceRoot)).filter(
  (path) => /\.(?:ts|tsx)$/.test(path) && !/\.test\.(?:ts|tsx)$/.test(path),
);
for (const path of [
  ...browserFiles,
  ...shippedUiFiles,
  ...shippedContractFiles,
]) {
  const source = await readFile(path, "utf8");
  const violations = analyzeSource({
    importer: path,
    sourceText: source,
    kind:
      path.startsWith(`${uiSourceRoot}/`) ||
      path.startsWith(`${contractsSourceRoot}/`)
        ? "package"
        : "browser",
  });
  assert.deepEqual(
    violations,
    [],
    `${path} violates browser, bridge, or FSD boundaries`,
  );
}

const bridgeFiles = (await collect(bridgeSourceRoot)).filter((path) =>
  /\.(?:ts|tsx)$/.test(path),
);
for (const path of bridgeFiles) {
  const source = await readFile(path, "utf8");
  const violations = analyzeSource({
    importer: path,
    sourceText: source,
    kind: "bridge",
  });
  assert.deepEqual(
    violations,
    [],
    `${path} violates bridge dependency boundaries`,
  );
}
const bridgePackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "apps/local-bridge/package.json"),
    "utf8",
  ),
);
const uiPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/ui/package.json"), "utf8"),
);
const contractsPackage = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages/contracts/package.json"),
    "utf8",
  ),
);
assert.equal(
  Object.keys(bridgePackage.dependencies ?? {}).some((name) =>
    name.startsWith("@opencode/"),
  ),
  false,
);
assert.deepEqual(
  Object.keys(uiPackage.exports ?? {}).sort(),
  ["."],
  "UI consumers must use its single public package entry",
);
assert.equal(uiPackage.exports["."].import, "./src/index.ts");
assert.deepEqual(
  Object.keys(contractsPackage.exports ?? {}).sort(),
  [".", "./source"],
  "contract consumers must use declared public package entries",
);
assert.equal(contractsPackage.exports["./source"], "./src/index.ts");

const browserOutputRoot = resolve(repositoryRoot, "apps/workbench-web/dist");
const browserBundles = (await collect(browserOutputRoot)).filter((path) =>
  /\.js$/.test(path),
);
assert.ok(browserBundles.length > 0, "production browser bundle must exist");
for (const path of browserBundles) {
  const bundle = await readFile(path, "utf8");
  assert.doesNotMatch(
    bundle,
    /@opencode\//,
    `${path} must not include the SDK`,
  );
  assert.doesNotMatch(
    bundle,
    /createLocalBridgeServer|Synthetic bridge listening|POLICY_DENY/,
    `${path} must not include bridge control-plane implementation`,
  );
  assert.doesNotMatch(
    bundle,
    /node:(?:fs|http|net|child_process)/,
    `${path} must not include Node.js server modules`,
  );
}
process.stdout.write(
  `PASS browser/bridge FSD boundaries and ${browserBundles.length} production bundle(s) for ${browserFiles.length + bridgeFiles.length} source files\n`,
);
