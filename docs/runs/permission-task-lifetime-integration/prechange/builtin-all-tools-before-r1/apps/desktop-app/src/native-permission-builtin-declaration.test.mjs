import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";

const families = [
  ["question", "fcxyj98j", "Plugin51", "forms, permission"],
  [
    "glob",
    "ec87pa6m",
    "Plugin38",
    "environment, ripgrep, location, access, permission",
  ],
  [
    "grep",
    "e661jwrm",
    "Plugin50",
    "environment, ripgrep, location, access, permission",
  ],
  ["skill", "ym52mge9", "Plugin44", "fs, skills, permission"],
  ["webfetch", "4xsr0mw7", "Plugin43", "http, permission"],
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const prefix = "    yield* ctx.tool.transform((editor) => editor.add(";
const suffix = ")).pipe(Effect.orDie);";
for (const [family, chunk, plugin, dependencies] of families) {
  test(`${family}: exact original closure, inert factory and private declaration membership`, async () => {
    const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    const entry = recipe.files.find((file) => file.path === path);
    assert.ok(entry, `${family} declaration extraction is missing`);
    const before = await readFile(new URL(path, root), "utf8");
    assert.equal(hash(before), entry.beforeSha256);
    let after = before;
    for (const edit of entry.edits) {
      assert.equal(after.split(edit.find).length - 1, 1);
      after = after.replace(edit.find, () => edit.replace);
    }
    assert.equal(hash(after), entry.afterSha256);
    let restored = after;
    for (const edit of [...entry.edits].reverse()) {
      assert.equal(restored.split(edit.replace).length - 1, 1);
      restored = restored.replace(edit.replace, () => edit.find);
    }
    assert.equal(restored, before);
    assert.equal(await readFile(new URL(path, root), "utf8"), before);
    const start = before.indexOf(prefix) + prefix.length;
    const object = before.slice(start, before.indexOf(suffix, start));
    const header = object.slice(0, object.indexOf("      execute:"));
    const names = [
      ...header.matchAll(
        /(?:name|description|input|output): ([A-Za-z][\w]*)[,\n]/g,
      ),
    ].map((match) => match[1]);
    let calls = 0;
    const trap = new Proxy(
      () => {
        calls++;
        throw Error("setup executed");
      },
      {
        get() {
          calls++;
          throw Error("service accessed");
        },
        apply() {
          calls++;
          throw Error("service called");
        },
      },
    );
    const values = names.map((name) =>
      name.startsWith("name") ? family : Object.freeze({ placeholder: name }),
    );
    const factoryStart = after.indexOf(`var ${family}Declarations2 =`);
    const factoryEnd = after.indexOf(`var ${plugin} =`, factoryStart);
    assert.ok(factoryStart >= 0 && factoryEnd > factoryStart);
    const factory = new Function(
      ...names,
      `${after.slice(factoryStart, factoryEnd)}\nreturn { make: ${family}Declaration2, accepts: is${family[0].toUpperCase() + family.slice(1)}Declaration2 };`,
    )(...values);
    const declaration = factory.make(
      ...dependencies.split(", ").map(() => trap),
    );
    const original = new Function(
      ...names,
      ...dependencies.split(", "),
      `return (${object});`,
    )(...values, ...dependencies.split(", ").map(() => trap));
    assert.equal(calls, 0);
    assert.equal(declaration.execute.toString(), original.execute.toString());
    for (const key of ["name", "description", "input", "output"])
      assert.equal(declaration[key], original[key]);
    assert.deepEqual(declaration.options, original.options);
    assert.ok(Object.isFrozen(declaration));
    assert.ok(Object.isFrozen(declaration.options));
    assert.equal(factory.accepts(declaration), true);
    assert.equal(factory.accepts({ ...declaration }), false);
    assert.equal(factory.accepts(original), false);
    assert.equal(factory.accepts(undefined), false);
    assert.match(after, new RegExp(`Object\\.freeze\\(${plugin}\\)`));
    // Run only the extracted generator with inert service values, never a Native module.
    const effectStart = after.indexOf(
      "function* (ctx) {",
      after.indexOf(`var ${plugin} =`),
    );
    const effectEnd = after.indexOf("\n  })\n};", effectStart);
    const body = after.slice(effectStart, effectEnd) + "\n}";
    const tokens = [...body.matchAll(/yield\* ([\w.]+);/g)].map(
      (match) => match[1],
    );
    const args = [...new Set(tokens.map((token) => token.split(".")[0]))];
    const token = {
      *[Symbol.iterator]() {
        return yield "service";
      },
    };
    const serviceValues = args.map((name) =>
      tokens.some((value) => value === `${name}.Service`)
        ? { Service: token }
        : tokens.some((value) => value === `${name}.HttpClient`)
          ? { HttpClient: token }
          : token,
    );
    const generator = new Function(
      ...args,
      `${family}Declaration2`,
      `return (${body});`,
    )(
      ...serviceValues,
      factory.make,
    )({
      get tool() {
        calls++;
        throw Error("transform accessed");
      },
    });
    let step = generator.next();
    let acquisitions = 0;
    while (!step.done) {
      assert.equal(step.value, "service");
      acquisitions++;
      step = generator.next(trap);
    }
    assert.equal(acquisitions, dependencies.split(", ").length);
    assert.equal(factory.accepts(step.value), true);
    assert.equal(step.value.execute.toString(), original.execute.toString());
    assert.equal(calls, 0);
  });
}
