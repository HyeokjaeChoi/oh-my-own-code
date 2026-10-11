import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localResourceImports } from "./local-resource-imports.mjs";
import { permissionTestInputClosure } from "./permission-test-input-closure.mjs";
test("source-copy fixture has no staging, preparation, overlay or verifier import dependency", async () => {
  const start = new URL(
      "./native-permission-test-fixture.mjs",
      import.meta.url,
    ),
    pending = [start],
    seen = new Set();
  while (pending.length) {
    const url = pending.shift();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    for (const path of localResourceImports(
      await readFile(url, "utf8"),
      url.pathname,
    ))
      pending.push(new URL(path, url));
  }
  for (const name of [
    "stage-event-host.mjs",
    "prepare-event-host.mjs",
    "native-permission-overlay.mjs",
    "native-permission-overlay-contract.mjs",
    "event-host-resources.mjs",
  ])
    assert.equal(
      [...seen].some((path) => path.endsWith("/" + name)),
      false,
      `unrelated dependency: ${name}`,
    );
});

test("resource parser preserves actual syntax and fail-closed malformed/template handling", () => {
  assert.deepEqual(
    localResourceImports(
      JSON.stringify({ data: 'import "./text.mjs"' }),
      "package.json",
    ),
    [],
  );
  const source =
    "const data=" +
    JSON.stringify('import x from "./fake.mjs"') +
    ';\n// import "./comment.mjs";\nimport "./real.mjs"; export {x} from "./export.mjs"; const p=import("./dynamic.mjs");';
  assert.deepEqual(localResourceImports(source), [
    "./real.mjs",
    "./export.mjs",
    "./dynamic.mjs",
  ]);
  assert.throws(
    () => localResourceImports("import(`./${name}.mjs`)"),
    /dynamic resource import/,
  );
  assert.throws(
    () => localResourceImports("import {"),
    /Invalid resource module syntax/,
  );
  assert.throws(() => localResourceImports("{", "package.json"));
});

test("contracted descriptor and task input scopes contain their current checked import and copy closure", async () => {
  const root = new URL("../../../", import.meta.url),
    run = "docs/runs/permission-task-lifetime-integration/";
  const manifest = JSON.parse(
    await readFile(
      new URL("./permission-test-inputs.json", import.meta.url),
      "utf8",
    ),
  );
  const contract = JSON.parse(
    await readFile(new URL(run + "contract.json", root), "utf8"),
  );
  const selected = process.env.PERMISSION_TEST_CHECK;
  assert.ok(
    ["native-descriptor-read", "native-task-read"].includes(selected),
    "contracted check selector required",
  );
  const selectedCheck = contract.checks[selected];
  assert.deepEqual(selectedCheck.argv.slice(0, 3), [
    "/usr/bin/env",
    `PERMISSION_TEST_CHECK=${selected}`,
    "node",
  ]);
  for (const name of [selected]) {
    const row = manifest.checks[name];
    assert.deepEqual(
      contract.checks[name].argv
        .filter((value) => value.endsWith(".test.mjs"))
        .sort(),
      row.seeds.filter((value) => value.endsWith(".test.mjs")).sort(),
    );
    const current = await permissionTestInputClosure(row.seeds);
    assert.deepEqual(
      current,
      row.files,
      `${name}: update reviewed input closure before accepting changed imports`,
    );
    const scope = contract.checks[name].input_scope.paths;
    for (const file of current)
      assert.ok(scope.includes(file), `${name}: missing input ${file}`);
    for (const file of [
      "apps/desktop-app/scripts/permission-test-inputs.json",
      "package.json",
      "pnpm-lock.yaml",
      "apps/desktop-app/package.json",
    ])
      assert.ok(scope.includes(file));
    for (const excluded of [
      "stage-event-host.mjs",
      "prepare-event-host.mjs",
      "native-permission-overlay-contract.mjs",
      "native-permission-control.mjs",
      "native-permission-inventory.mjs",
    ])
      assert.equal(
        current.some((file) => file.endsWith("/" + excluded)),
        false,
        `${name}: unrelated dependency reintroduced`,
      );
  }
  await assert.rejects(
    () => permissionTestInputClosure(["../README.md"]),
    /unclosed_test_input_path/,
  );
});
