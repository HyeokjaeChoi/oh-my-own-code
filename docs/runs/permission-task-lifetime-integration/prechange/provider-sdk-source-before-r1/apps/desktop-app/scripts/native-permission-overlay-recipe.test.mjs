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

test("pinned overlay recipe binds exact fifty source files and preserves frozen preparation data", () => {
  const recipe = NATIVE_PERMISSION_OVERLAY_RECIPE;
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.id, "permission-session-entry-gate-v1");
  assert.equal(
    NATIVE_PERMISSION_OVERLAY_RECEIPT.recipeSha256,
    "350de623382fdd92ef4ca436c4f0cecb5b8b8804ffc1cb6719bc12962d92e307",
  );
  assert.deepEqual(
    recipe.files.map(({ path }) => path),
    [
      "node_modules/@opencode/server/dist/process.js",
      "node_modules/@opencode/server/dist/process.d.ts",
      "node_modules/@opencode/core/dist/chunks/config-vgpkvtp0.js",
      "node_modules/@opencode/core/dist/chunks/config-7scxvj8s.js",
      "node_modules/@opencode/core/dist/chunks/config-yp2x3t23.js",
      "node_modules/@opencode/core/dist/chunks/config-y8cm73x9.js",
      "node_modules/@opencode/core/dist/chunks/config-9qsysn39.js",
      "node_modules/@opencode/core/dist/chunks/config-kyw5qrb7.js",
      "node_modules/@opencode/core/dist/chunks/config-zyp346xr.js",
      "node_modules/@opencode/core/dist/chunks/config-3w5fmr99.js",
      "node_modules/@opencode/core/dist/chunks/config-yw6qsgb4.js",
      "node_modules/@opencode/core/dist/chunks/config-zs6xvgsc.js",
      "node_modules/@opencode/core/dist/chunks/config-vyy061a2.js",
      "node_modules/@opencode/core/dist/effect/app-node-builder.js",
      "node_modules/@opencode/core/dist/chunks/config-ph8yj3s6.js",
      "node_modules/@opencode/util/dist/effect/layer-node.js",
      "node_modules/@opencode/core/dist/chunks/config-j7k7jnd5.js",
      "node_modules/@opencode/core/dist/chunks/config-48y8hbvk.js",
      "node_modules/@opencode/core/dist/chunks/config-5y480sgp.js",
      "node_modules/@opencode/core/dist/chunks/config-kcmnw9z9.js",
      "node_modules/@opencode/core/dist/chunks/config-8t2s61hj.js",
      "node_modules/@opencode/core/dist/chunks/config-s0ehs66p.js",
      "node_modules/@opencode/core/dist/chunks/config-fcxyj98j.js",
      "node_modules/@opencode/core/dist/chunks/config-ec87pa6m.js",
      "node_modules/@opencode/core/dist/chunks/config-e661jwrm.js",
      "node_modules/@opencode/core/dist/chunks/config-ym52mge9.js",
      "node_modules/@opencode/core/dist/chunks/config-4xsr0mw7.js",
      "node_modules/@opencode/core/dist/chunks/config-04zc2vp5.js",
      "node_modules/@opencode/core/dist/chunks/config-5m3ds5v3.js",
      "node_modules/@opencode/core/dist/chunks/config-8f36rj9w.js",
      "node_modules/@opencode/core/dist/chunks/config-2et2b5t1.js",
      "node_modules/@opencode/core/dist/chunks/config-191v1wnc.js",
      "node_modules/@opencode/core/dist/chunks/config-9tndjada.js",
      "node_modules/@opencode/core/dist/chunks/config-kb6gw2zp.js",
      "node_modules/@opencode/core/dist/chunks/config-e2skv07x.js",
      "node_modules/@opencode/core/dist/chunks/config-hjbc5kem.js",
      "node_modules/@opencode/core/dist/chunks/config-zrq68ahz.js",
      "node_modules/@opencode/plugin-browser/dist/tools.js",
      "node_modules/@opencode/plugin-browser/dist/index.js",
      "node_modules/@opencode/plugin-browser/dist/connection.js",
      "node_modules/@opencode/core/dist/chunks/config-reg6q42h.js",
      "node_modules/@opencode/core/dist/chunks/config-6pc27hjz.js",
      "node_modules/@opencode/core/dist/chunks/config-rqzxc8xy.js",
      "node_modules/@opencode/core/dist/chunks/config-y6mhz57t.js",
      "node_modules/@opencode/core/dist/chunks/config-wc3fc9cn.js",
      "node_modules/@opencode/core/dist/chunks/config-qg3g05ea.js",
      "node_modules/@opencode/core/dist/chunks/config-24dcb14g.js",
      "node_modules/@opencode/core/dist/chunks/config-s72nwfj1.js",
      "node_modules/@opencode/core/dist/chunks/config-k35dwc4g.js",
      "node_modules/@opencode/core/dist/chunks/config-jjkms2e6.js",
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
      "9ba44fa3bdf13bef28d5eb0c71dea56bbd80526d665c1d1d4853c146db3e084d",
      "13f9483384a1d0bf4c771d58a5932f973b950fd0f839db2f73c27ebcaad32805",
      "76638b2c4d683d304603080ba002d054cfcf49e037d378071e80b46efb74440b",
      "28f8e167d496e3469ce4d1532b003b6adbc03c6641734be66a9e7b02fad1584d",
      "3731a6ac99d3de9db8acd15d2ee4a7559b121dfa28e6694c7db5ed38f203e3aa",
      "ef0790ce1b69287aa37e1983835e3aa4e67c030451cd0d8f394a6068636db695",
      "5f1e4661eaee95de66c6ea2442985a5ebb4601ad2e2dba4235a50bbb8f72bd19",
      "b77347256dd0c0193319dd0d5ca7c9cb576f6585ad9ebd3f3575d91739669df6",
      "a6ef88862dd38892b7b75e986d77036d44f6bf5d72dc421312322e0f39b08b71",
      "a520c74636237031acaad8e16fb7fa321ca14a0307c9a400a5bf0a988fe09521",
      "c6f1fbdaaec903c9c853e831f096997eb7e25e8690a08ec7f4fa365c09962894",
      "618d0d178a428d7a7ec96671edefb11f8cf3c811505e7fae56e7c15d6937dcf0",
      "0632bbee9e0b05f2ee384845014c062387f9c8e8eeaafcdd98d59aac9e6bc9bf",
      "80068552355da82bbe3ebe47c0d6e245da552ab51da9a0dfa3232dfd06752974",
      "dc829fc3193e71713caec7b0c94915afefc1c398c6c92049d9651b8cffa1b802",
      "9a7cb24c50f09a3d07eca739a556f609fe2790016d06c3d352e441781a0f1186",
      "0ca34f434362b7a2598849e7f4b5614be97f118a04408b4cad2100a1e0875317",
      "d3cd19fc3d179442a6371f0b0f385ae3207287f98387552f05de4a6592a81980",
      "63ef4cf89a3e7e2d1b3d697259d528de1c429558e3c986dfe060471ccb97f7fd",
      "ddcfa3ec00066bee8de602338b89add4a1683b71fa8f577accce996000b14f57",
      "169ec515b2cda2813937ff559cf98ef226603145c5d1308ed4f778fd5ffd491e",
      "9587254b3d400ae332f6c358038a4886dbfc42c887c20776a13e089036e26989",
      "25900de0d0c03cfbc001844a6ff2e26ef7b834a3808bf90990d489d8f3b909ac",
      "4cfbad9b1b79a35f8996501401ed8229036536a8c4a533451b295a052293fcb6",
      "42d9a74391603b2d191e2d05cfcb2d502b218f2aee43b3fb28bf0a6ca588ddaa",
      "62b9246e5455e6b2515955c2f519f4b1c1963b48052c8e66f683f0bfca895834",
      "a5d09253a81ccc330da2d096afbc4cb8ad14c31feb2af42119f04cb6bf3531ff",
      "d0ad28539fdfed16e4341b00bddc430d343a789caa1957eb8ef409b8584f5d8d",
      "86a48168402c0a62344bf1fc645f1e0278c60291d43f8d37aa12f60e138a3a4e",
      "851f52b95d70a48f17bbc99c233f6f45454dd9a43b979d00d528382d8a990191",
      "475eaad9396f996a69155ece0828e12135646cad1905c41e2f123a9fa2a34757",
      "2b1d050aef767adf67c33bf9c49aa8be0b8fac00d12739194f27ee2d8ee6a08f",
      "59c4cabfd2600b32607a1c992997bdf8af907b6d7d38d257bbe650585ec2d2df",
      "fab5aa00ce73654bfe7fbae7b6515a6ee066bef25b27d17c2376524e1c61bc32",
      "b10fab02eb67bfa0934749bed80d39dec63b5c637869d9602bcfaa5c184a5d17",
      "3b103c91b39ad69105df8a163bcd8448f607173628b308c3d303f67ec67ced24",
      "86ae5494267970e69ebf63e2210a45edda46eda22b770ad7db1d5b04024167b6",
      "6f790cf53a5b9936a321d96690bb3d8df91b21394ecf8300b7312abccaa5ca43",
      "62ffc4147f8643754fa751a358c368f2e92cc9e16f333e5206dbf50dae0b9919",
      "d331640c8a22f82e3cebbe589c70a91a8714aaa2f22c861347beca7b9519ff37",
      "7a93abf2599e0791542542cc833682044d74715f59a993c16703a4010025a746",
      "9c0ddee3be266043cdb5cf067b7702c01eb01e9032ef7f325d06450a2b00bca1",
      "4de77d12d359cb50e516b4d94aa9821ee9064f968cf4df88204ae6a5d4e9de5b",
      "41ef32b91423ae872404c04d42a1c9f736248cf7a6bed21aa4376d5b964f0bb5",
    ],
  );
  assert.deepEqual(
    recipe.files.map(({ afterSha256 }) => afterSha256),
    [
      "c553abcc5404848220a97776c0d599ca45f183ca1c113610e6149bd6cf1a862a",
      "972489e8409c9b187fc6d60502fd55907407eff495691c490907400059f90338",
      "aba86336a925c76c0de2e2da6324b85cf11eb304ce85f327c0a9aab613a032a1",
      "b94b04da1aec07a7a2f5446670ba746d337f4d8c684cd88aa3d8b27142425d9e",
      "2646f6b2fccf432303f0a322e1b973d031f50bcd0dc46b47782a3a0759764be3",
      "f96d58b1e4a68ddd261170f16b953157f590229f52c2ebe4b4b0a50860391b9d",
      "7e619e08c82a171a669c8743ed2cec700f11b1459d348d7f3a55a37e4435b442",
      "8bb1cbb6771fed3b5a77255c9e17f6ab266251e6031335b439137f8f2815ea77",
      "0b365a3c2be9ba0698beb85865a9091b48d12c4f5758317fe173964c0556f819",
      "2b374f48f4be331e06419fb43f30dfab5b2fa72d45b1cc8500d633ab3e6f0a6b",
      "41593f4696861893d2a07d5a02bc6aee294e9440a7ff2c89580334db05156208",
      "bc91187f78b5c59727654030e9f3f9c0efa133ef72951e0da3d3757f6ef22b34",
      "16b123da6ae163a2902c5121dc08509040e3da0c1494e1f00b48933f7078bbe0",
      "cee18a3e9ad7a1d5bc611821875f528a676bad6f51f16a8e0225dd95551b46d1",
      "f93ae92f8bd8f3ac26091b9ca39ad30fcbc652de3ada36d7f0a9f243328ab3fe",
      "560b721c3e6782bb857561c08e4bcecafedc5dfb0d10fe2649c1a08337b9028c",
      "3c5a4ff2465ba149b313db0ea37ddd717595dca9380098fcae1e097a78dccb4a",
      "9bb5d24ff8c39f29786075a4d5b5443084d41fb8c626385b36b639618f42b350",
      "7bae793b1b7944b5f53f307021b695644dc1de045a517b36cba8cb3829cc176a",
      "cff48d472dc10e83b0cf655eca9824902da13516ac7025b347a8a6a18f5fe434",
      "05294feaf20fb38710fb291aa92cc0efcac94c1528e2b3edc759721c56fcac50",
      "a80d330b5f670eb45202a876b8c7ab8782f796f636197095bbed2c9524fcf338",
      "0f40403ae7d0614fc1d1f51c8c9321d3cb7f5b0e848ab88c72189e8ecae2619c",
      "9297bbe1596c90666a7d6707866ab2e9e1a2956e8969477d34446386781b6863",
      "2deb3be7cc5cdd160cd68950b564b3ebc1db21cbe66d783a36fc33cee7c9e184",
      "48664b0250602465ee7fe1ef64c17bebd5723583268e0da23a279e9eb458820d",
      "b6912e2a00a74dfe64cb1601b9b74846f814ad2ed6b7719d85283acca9cacb4b",
      "36af2b1115f08de693491cd929ae1fe2e4b958a7d4128003ccb41e85de7618fe",
      "5ccc740267c844a5f68f4b639b753151120975c4e16ca53cb686c617703d7289",
      "a3be350f855d099e35628b4a3600951678b1a73c416133d1677fe2a0f4b80ee3",
      "f5ba27687bc5f26999d08a824810448c67ce351ea28ce134d287acb94a983d8e",
      "dd4d4ebec21d338532a2f51b4c5af9665593cef1d0c42d06729e042e42866f56",
      "ec7ec9be3b5d9eaf56749c2b6b4e8203a6f634b79c051c3f48b04ad3068ef567",
      "956300ddfeddaac19203cdac70d9f22ed740e0229fd965d27b0febf66e7ab606",
      "b2a7eaac90a055a8a47efb388680951707dd34505083e2c434cdf7fc2051b1c4",
      "4d59bde098564f51d483eb3cde6f1dbcd33256d9ee82a12162e641b42c187d54",
      "6aa559ce1a9250e1e67001b76e602c83f08aad15650d423c94039812a9199b45",
      "389c2e178db87ae42762be88a66c5d21b9b7aefe147b10d684063089c8f181dc",
      "2aa9cdd94c1f35cc0a50df277869d8187605f7eb17aa08a60fb3188396a04b5b",
      "8a5a402cd961b0b3bbb5fa69136a6756594f6b97112ac7cca8451f86e4ea4af7",
      "002177f08714b6798352c375c6f41bb3cd7b76020a4ea06e0ee009bd402886a5",
      "0e4ccef9da1fe2f379afdbfff1796738baa82f040da58ea7616c17e690ea75b9",
      "2fca7722fedf71ac05f793b7195f85589701322d888918218841083917dd96a2",
      "09d1ba5b97f0a7a6c877c629becf28372ea8f3e559d5a06cddc6de9103d69be1",
      "800b6f1e4df1054f5738ef50e6e553512e8536bf2e2bb6b93f71704efed1090a",
      "9d9fe5a8007ee9e0329c6d12d47d165c25b4750b714737701686302a1d2edaa0",
      "405e3b13eeda182d27d724a6c1965dc1b46965739e0e527e5be73ed239f41f45",
      "9050fc73856e6e0d67d7ecfbf1cb62edd7f0091bed77715e4d54209feaac20c2",
      "3f6d1bc9d4e756fe8ecf68bf3ced1e66ad2aa7ffdf1bddf87f534ccd8cfda46c",
      "b2a39cf6b580b48c038560868a0949890d9d0d5c49e377391fc89c5a883af896",
    ],
  );
  assert.equal(recipe.serverVersion, "2.0.18");
  assert.equal(recipe.files.length, 50);
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
  assert.equal(plan.files.length, 50);
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
    let restored = actual.content.toString("utf8");
    for (const edit of [...expected.edits].reverse()) {
      assert.equal(restored.split(edit.replace).length - 1, 1);
      restored = restored.replace(edit.replace, () => edit.find);
    }
    assert.equal(restored, originals[index].toString("utf8"));
    assert.equal(
      hash(await readFile(new URL(expected.path, root))),
      expected.beforeSha256,
    );
  }
  for (const js of plan.files.filter(({ path }) => path.endsWith(".js"))) {
    for (const [phase, content] of [
      ["before", files.find(({ path }) => path === js.path).content],
      ["after", js.content],
    ]) {
      const parsed = spawnSync(
        process.execPath,
        ["--check", "--input-type=module"],
        { input: content, encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
      );
      assert.equal(parsed.error, undefined);
      assert.equal(parsed.signal, null);
      assert.equal(parsed.status, 0, `${phase} ${js.path}: ${parsed.stderr}`);
    }
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

test("fifty-file consumer refuses missing, duplicate and extra sources and keeps recipe output order", async () => {
  const files = await inputs();
  assert.equal(files.length, 50);
  for (const [index] of files.entries()) {
    assert.throws(() =>
      planNativePermissionOverlay(
        NATIVE_PERMISSION_OVERLAY_RECIPE,
        files.filter((_, position) => position !== index),
      ),
    );
    assert.throws(() =>
      planNativePermissionOverlay(NATIVE_PERMISSION_OVERLAY_RECIPE, [
        ...files,
        files[index],
      ]),
    );
  }
  assert.throws(() =>
    planNativePermissionOverlay(NATIVE_PERMISSION_OVERLAY_RECIPE, [
      ...files,
      {
        path: "node_modules/@opencode/core/dist/extra.js",
        content: Buffer.from("export {};\n"),
      },
    ]),
  );
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    [...files].reverse(),
  );
  assert.deepEqual(
    plan.files.map(({ path }) => path),
    NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(({ path }) => path),
  );
});

// Source/transformation checks only. Main owns the actual-function behavior test.
test("checked Session entries guard before original effect construction and release the short admission first", async () => {
  const files = await inputs();
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    files,
  );
  const source = (name) =>
    plan.files.find(({ path }) => path.endsWith(name)).content.toString("utf8");
  const session = source("config-9qsysn39.js");
  const shell = source("config-kyw5qrb7.js");
  const factory = source("config-zyp346xr.js");
  for (const text of [session, shell, factory]) {
    assert.equal(
      text.split(
        'from "../../../../../native-permission-coordinator-admission.mjs";',
      ).length - 1,
      1,
    );
    assert.equal(
      text.split("const control = yield* WorkbenchControl;").length - 1,
      1,
    );
    assert.equal(
      text.split(
        "const enter = createCoordinatorAdmission({ control, store });",
      ).length - 1,
      1,
    );
  }
  assert.ok(
    session.includes(
      "const guard = (original) => (sessionID, ...args) => enter(sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => original(sessionID, ...args))));",
    ),
  );
  for (const name of [
    "view",
    "rename",
    "setMetadata",
    "setPermissions",
    "switchAgent",
    "switchModel",
    "cancelInbox",
    "steerInbox",
    "queueInbox",
    "prompt",
    "shell",
    "skill",
    "compact",
    "resume",
    "synthetic",
    "revert.stage",
    "revert.clear",
    "revert.commit",
  ]) {
    const local = name.split(".").at(-1);
    assert.equal(
      session.split(`const ${local} = guard(Effect.fn("Session.${name}")`)
        .length - 1,
      1,
      name,
    );
  }
  // Read-only methods and cancellation intent retain the exact original body.
  const before = files
    .find(({ path }) => path.endsWith("config-9qsysn39.js"))
    .content.toString("utf8");
  for (const [name, next] of [
    ["get", "message"],
    ["message", "view"],
    ["inbox", "cancelInbox"],
    ["wait", "resume"],
    ["interrupt", "stage"],
  ]) {
    const start = before.indexOf(`  const ${name} =`);
    const end = before.indexOf(`  const ${next} =`, start);
    assert.ok(start >= 0 && end > start);
    assert.ok(session.includes(before.slice(start, end)), name);
  }
  assert.ok(
    session.includes(
      "start2({ session, command: input.command }).pipe(Effect.provideService(WorkbenchControl, control), Effect.provideService(Service50, store), Effect.provideService(Service47, instances),",
    ),
  );

  const admission = shell.indexOf(
    "const session = yield* enter(input.session.id, () => store.get(input.session.id));",
  );
  assert.ok(admission >= 0);
  for (const effect of [
    "const instances = yield* Service47;",
    "yield* awaitActivation2",
    "yield* shell.create({",
  ])
    assert.ok(shell.indexOf(effect) > admission, effect);
  assert.ok(shell.includes("instances.provide(session)"));
  assert.ok(shell.includes("cwd: session.location.directory"));
  assert.ok(
    shell.includes("metadata: { sessionID: session.id, background: true }"),
  );
  assert.equal(shell.includes("input.session.location"), false);
  assert.equal(shell.includes("instances.provide(input.session)"), false);

  assert.ok(
    factory.includes(
      'for (const name of ["fork", "remove", "generate", "command", "background", "move"])',
    ),
  );
  assert.ok(
    factory.includes(
      'result[name] = (input, ...args) => enter(typeof input === "string" ? input : input.sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => original(input, ...args))));',
    ),
  );
  assert.ok(
    factory.includes(
      "result.environment = (input) => input.variables === undefined ? environment(input) : enter(input.sessionID, () => Effect.void).pipe(Effect.andThen(Effect.suspend(() => environment(input))));",
    ),
  );
  const originalFactory = files
    .find(({ path }) => path.endsWith("config-zyp346xr.js"))
    .content.toString("utf8");
  const dependencies = (text) =>
    text.slice(
      text.indexOf("  deps: ["),
      text.indexOf("\n});", text.indexOf("  deps: [")),
    );
  assert.equal(
    dependencies(factory),
    dependencies(originalFactory).replace(
      "    node64\n",
      "    node64,\n    workbenchControlNode\n",
    ),
  );
  assert.ok(
    factory.includes(
      'import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";',
    ),
  );
});

test("fixed fourteen families publish at original transform positions and preserve all plugin setup and hook bytes", async () => {
  let families = 0;
  const plan = planNativePermissionOverlay(
    NATIVE_PERMISSION_OVERLAY_RECIPE,
    await inputs(),
  );
  for (const file of NATIVE_PERMISSION_OVERLAY_RECIPE.files) {
    const transform = file.edits.find((edit) =>
      edit.find.startsWith("    yield* ctx.tool.transform("),
    );
    if (!transform) continue;
    families++;
    const factory = file.edits.find((edit) =>
      edit.find.startsWith("var Plugin"),
    );
    const family = factory.replace.match(/var (\w+)Declarations2/)[1];
    const cap = family[0].toUpperCase() + family.slice(1);
    const before = await readFile(new URL(file.path, root), "utf8");
    const after = plan.files
      .find((row) => row.path === file.path)
      .content.toString();
    const pluginText = (source) => {
      const start = source.indexOf(factory.find);
      const end = source.indexOf("\n  })\n};", start) + "\n  })\n};".length;
      assert.ok(start >= 0 && end > start);
      return source.slice(start, end);
    };
    let expected = pluginText(before).replace(
      transform.find,
      () => transform.replace,
    );
    if (!transform.replace.includes("    return declaration;"))
      expected = expected.replace(
        "\n  })\n};",
        "\n    return declaration;\n  })\n};",
      );
    assert.equal(
      pluginText(after),
      expected,
      `${family}: original setup/hook order changed`,
    );
    assert.equal(
      transform.replace.split(
        `ctx.tool.transform(${family}Publication2(declaration)).pipe(Effect.orDie)`,
      ).length - 1,
      1,
    );
    const exports = file.edits.find((edit) => edit.find.startsWith("export {"));
    assert.ok(
      exports.replace.includes(`${family}Publication2, get${cap}Publication2,`),
    );
  }
  assert.equal(families, 14);
});

test("provider extension preserves every archived recipe entry as a byte-equivalent object and stays within 256 edits", async () => {
  const archive = new URL(
    "../../../docs/runs/permission-task-lifetime-integration/prechange/provider-transform-source-before-r1/",
    import.meta.url,
  );
  const path = "apps/desktop-app/src/native-permission-overlay-contract.mjs";
  const bytes = await readFile(new URL(path, archive), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", archive), "utf8"),
  );
  assert.equal(
    hash(bytes),
    manifest.files.find((row) => row.path === path).sha256,
  );
  // Only the saved literal recipe is evaluated; no saved module or provider runs.
  const literal = bytes.slice(
    bytes.indexOf("const recipe = ") + "const recipe = ".length,
    bytes.indexOf(";\nfor (const file"),
  );
  const before = new Function(`return (${literal});`)();
  assert.equal(before.files.length, 44);
  assert.equal(NATIVE_PERMISSION_OVERLAY_RECIPE.files.length, 50);
  assert.deepEqual(
    NATIVE_PERMISSION_OVERLAY_RECIPE.files.slice(0, 44),
    before.files,
  );
  for (const [index, entry] of before.files.entries())
    assert.equal(
      JSON.stringify(NATIVE_PERMISSION_OVERLAY_RECIPE.files[index]),
      JSON.stringify(entry),
    );
  const edits = NATIVE_PERMISSION_OVERLAY_RECIPE.files.reduce(
    (count, file) => count + file.edits.length,
    0,
  );
  assert.equal(edits, 216);
  assert.ok(edits <= 256);
});
