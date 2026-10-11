import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECEIPT } from "../src/native-permission-overlay-contract.mjs";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-recipe.mjs";
import { planNativePermissionOverlay } from "./native-permission-overlay.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
async function inputs() {
  return Promise.all(
    NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
      path,
      content: await readFile(new URL(path, root)),
    })),
  );
}

test("pinned overlay recipe binds exact six source files and preserves frozen preparation data", () => {
  const recipe = NATIVE_PERMISSION_OVERLAY_RECIPE;
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.id, "permission-coordinator-gate-v1");
  assert.deepEqual(
    recipe.files.map(({ path }) => path),
    [
      "node_modules/@opencode/server/dist/process.js",
      "node_modules/@opencode/server/dist/process.d.ts",
      "node_modules/@opencode/core/dist/chunks/config-vgpkvtp0.js",
      "node_modules/@opencode/core/dist/chunks/config-7scxvj8s.js",
      "node_modules/@opencode/core/dist/chunks/config-yp2x3t23.js",
      "node_modules/@opencode/core/dist/chunks/config-y8cm73x9.js",
    ],
  );
  assert.deepEqual(
    recipe.files.map(({ beforeSha256 }) => beforeSha256),
    [
      "90fb992ca4c656649178ddc8af706922262256c13f4f2fc95c5cd95a913f2fcb",
      "145cc4c09c12627ec49ae134811dfec7773cc462f506e61a9bfec5179eb646a5",
      "a28683ef6d49fad12e71abb5ed77b23aaa093becd9369d5d2eea2c639f524f65",
      "2443ac3488340f40a17b6ae23ab1c9599f32ed2f12d5efb3f48f868c31fd51f9",
      "ad6fc7b1e763dd7c05a9fe5a6028ad108be368568afc040dbe2f324edc7779d3",
      "7fb5361b02086981ebcfb8d71d5a1d7cf3c5c9b91421829cce640252db450d79",
    ],
  );
  assert.deepEqual(
    recipe.files.slice(0, 4).map(({ afterSha256 }) => afterSha256),
    [
      "c553abcc5404848220a97776c0d599ca45f183ca1c113610e6149bd6cf1a862a",
      "972489e8409c9b187fc6d60502fd55907407eff495691c490907400059f90338",
      "aba86336a925c76c0de2e2da6324b85cf11eb304ce85f327c0a9aab613a032a1",
      "b94b04da1aec07a7a2f5446670ba746d337f4d8c684cd88aa3d8b27142425d9e",
    ],
  );
  assert.equal(recipe.serverVersion, "2.0.18");
  assert.equal(recipe.files.length, 6);
  assert.equal(Object.isFrozen(recipe), true);
  assert.equal(Object.isFrozen(recipe.files), true);
  for (const file of recipe.files) {
    assert.equal(Object.isFrozen(file), true);
    assert.equal(Object.isFrozen(file.edits), true);
    assert.match(file.beforeSha256, /^[a-f0-9]{64}$/);
    assert.match(file.afterSha256, /^[a-f0-9]{64}$/);
    for (const edit of file.edits) assert.equal(Object.isFrozen(edit), true);
  }
});

test("actual pinned source transforms to exact checked output without executing or changing Native", async () => {
  const files = await inputs();
  const originals = files.map(({ content }) => Buffer.from(content));
  const receipt = JSON.parse(
    await readFile(new URL("../receipt.json", root), "utf8"),
  );
  for (const file of NATIVE_PERMISSION_OVERLAY_RECIPE.files) {
    const entry = receipt.installEntries.find(({ path }) => path === file.path);
    assert.equal(entry?.type, "file");
    assert.equal(entry.sha256, file.beforeSha256);
  }
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    files,
  );
  assert.equal(plan.files.length, 6);
  assert.equal(
    plan.recipeSha256,
    NATIVE_PERMISSION_OVERLAY_RECEIPT.recipeSha256,
  );
  for (const [
    index,
    expected,
  ] of NATIVE_PERMISSION_OVERLAY_RECIPE.files.entries()) {
    const actual = plan.files.find(({ path }) => path === expected.path);
    assert.equal(hash(files[index].content), expected.beforeSha256);
    assert.deepEqual(files[index].content, originals[index]);
    assert.equal(hash(actual.content), expected.afterSha256);
    assert.equal(actual.beforeSha256, expected.beforeSha256);
    assert.equal(actual.afterSha256, expected.afterSha256);
    assert.equal(
      hash(await readFile(new URL(expected.path, root))),
      expected.beforeSha256,
    );
  }
  for (const js of plan.files.filter(({ path }) => path.endsWith(".js"))) {
    const parsed = spawnSync(
      process.execPath,
      ["--check", "--input-type=module"],
      { input: js.content, encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
    );
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.signal, null);
    assert.equal(parsed.status, 0, `${js.path}: ${parsed.stderr}`);
  }
});

test("fourth argument forwards overrides while original lifecycle and HTTP transform positions stay identical", async () => {
  const files = await inputs();
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    files,
  );
  for (const before of files) {
    const after = plan.files
      .find(({ path }) => path === before.path)
      .content.toString("utf8");
    let restored = after;
    for (const edit of [
      ...NATIVE_PERMISSION_OVERLAY_RECIPE.files.find(
        ({ path }) => path === before.path,
      ).edits,
    ].reverse()) {
      assert.equal(restored.split(edit.replace).length - 1, 1);
      restored = restored.replace(edit.replace, () => edit.find);
    }
    assert.equal(restored, before.content.toString("utf8"));
  }
  const js = plan.files
    .find(({ path }) => path.endsWith("process.js"))
    .content.toString("utf8");
  assert.ok(
    js.includes("function* (options, lifecycle, transform, overrides) {"),
  );
  assert.ok(js.includes("}, urls, overrides).pipe("));
  assert.ok(js.includes("transform ? transform(app) : app"));
  assert.ok(js.includes("if (lifecycle)"));
});

test("changed pinned bytes and output pins refuse the entire plan with original source preserved", async () => {
  const files = await inputs();
  const original = files.map(({ content }) => Buffer.from(content));
  for (const [index] of files.entries()) {
    const drifted = files.map(({ path, content }) => ({
      path,
      content: Buffer.from(content),
    }));
    drifted[index].content[0] ^= 1;
    assert.throws(() =>
      planNativePermissionOverlay(NATIVE_PERMISSION_OVERLAY_RECIPE, drifted),
    );
    const recipe = JSON.parse(JSON.stringify(NATIVE_PERMISSION_OVERLAY_RECIPE));
    recipe.files[index].afterSha256 = "0".repeat(64);
    assert.throws(() => planNativePermissionOverlay(recipe, files));
  }
  for (const [index, file] of files.entries())
    assert.deepEqual(file.content, original[index]);
  assert.equal(fileURLToPath(root).includes(".generated/install"), true);
});

// Static source guards only. These assertions do not establish Native approval.
test("patched Permission and Saved sources share the fixed control and preserve gate ordering", async () => {
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    await inputs(),
  );
  const source = (name) =>
    plan.files.find(({ path }) => path.endsWith(name)).content.toString("utf8");
  const permission = source("config-vgpkvtp0.js");
  const saved = source("config-7scxvj8s.js");
  const controlImport =
    'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";';
  for (const text of [permission, saved]) {
    assert.equal(text.split(controlImport).length - 1, 1);
    assert.equal(
      text.split("const control = yield* WorkbenchControl;").length - 1,
      1,
    );
    assert.match(text, /deps: \[.*workbenchControlNode\]/u);
  }
  for (const [name, next] of [
    ["ask", "assert"],
    ["assert", "reply"],
    ["reply", "listLocked"],
  ]) {
    const start = permission.indexOf(`  const ${name} =`);
    const end = permission.indexOf(`  const ${next} =`, start);
    assert.ok(start >= 0 && end > start);
    const body = permission.slice(start, end);
    const held = body.indexOf(
      "yield* control.assertExecution(tx, location.project.id);",
    );
    assert.ok(held >= 0);
    for (const mutation of [
      "yield* evaluateInput(",
      "yield* create(",
      "pending.get(",
      "bus.publish(",
    ]) {
      const index = body.indexOf(mutation);
      if (index >= 0) assert.ok(held < index, `${name}: ${mutation}`);
    }
  }
  assert.ok(
    permission.includes(
      "yield* saved.listLocked(tx, { projectID: location.project.id })",
    ),
  );
  assert.ok(permission.includes("yield* saved.addLocked(tx, {"));
  assert.ok(!permission.includes("yield* saved.list("));
  assert.ok(!permission.includes("yield* saved.add("));
  assert.ok(
    permission.includes(
      "    }));\n    if (!item)\n      return;\n    return yield* restore(Deferred.await(item.deferred))",
    ),
  );
  assert.ok(permission.includes("Effect.ensuring(withProject((tx) =>"));
  assert.ok(
    saved.includes(
      "control.inspect(tx, input.projectID).pipe(Effect.andThen(listRaw(input)))",
    ),
  );
  assert.ok(
    saved.includes(
      "control.assertExecution(tx, input.projectID).pipe(Effect.andThen(addRaw(input)))",
    ),
  );
  assert.ok(
    saved.includes(
      "control.transaction([projectID], (tx) => removeLocked(tx, { projectID, id }))",
    ),
  );
  assert.ok(saved.includes("rows[0].project_id !== input.projectID"));
});
