import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  syntheticEventHost,
  put,
} from "../scripts/build-provenance-test-fixture.mjs";
import {
  eventHostForResources,
  inventoryEventHostTree,
} from "./event-host-resources.mjs";
import {
  NATIVE_PREFLIGHT_ASSETS,
  verifyNativePreflightResources,
} from "./native-preflight-resources.mjs";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-preflight-resources-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await syntheticEventHost(root);
  const descriptor = eventHostForResources(root, "darwin", "arm64");
  const manifest = JSON.parse(
    await fs.readFile(descriptor.manifestPath, "utf8"),
  );
  const refresh = async () => {
    const links = Object.fromEntries(
      manifest.entries
        .filter((entry) => entry.type === "symlink")
        .map(({ path, target }) => [path, { target }]),
    );
    const entries = await inventoryEventHostTree(descriptor.root, { links });
    // inventory ignores only its own resource manifest.
    await fs.writeFile(
      descriptor.manifestPath,
      JSON.stringify({ ...manifest, entries }),
    );
  };
  return { descriptor, refresh };
}
test("old event-host inventory cannot authorize readonly inspection; fixed assets are required", async (t) => {
  const { descriptor, refresh } = await fixture(t);
  await assert.rejects(verifyNativePreflightResources(descriptor));
  for (const path of NATIVE_PREFLIGHT_ASSETS)
    await put(descriptor.root, path, "// inert inspection asset\n");
  await refresh();
  const actual = await verifyNativePreflightResources(descriptor);
  assert.equal(
    actual.entry,
    join(descriptor.root, "native-preflight-reader.mjs"),
  );
  assert.equal(actual.engine, descriptor.enginePath);
  assert.match(actual.inventorySha256, /^[a-f0-9]{64}$/);
  await fs.appendFile(actual.entry, "// drift\n");
  await assert.rejects(verifyNativePreflightResources(descriptor));
});
test("stored descriptor substitution and executable permissions cannot choose inspector bytes", async (t) => {
  const { descriptor, refresh } = await fixture(t);
  for (const path of NATIVE_PREFLIGHT_ASSETS)
    await put(descriptor.root, path, "// inert asset\n");
  await refresh();
  await assert.rejects(
    verifyNativePreflightResources({
      ...descriptor,
      enginePath: "/usr/local/bin/bun",
    }),
  );
  await fs.chmod(join(descriptor.root, "native-preflight-reader.mjs"), 0o755);
  await refresh();
  await assert.rejects(verifyNativePreflightResources(descriptor));
});
