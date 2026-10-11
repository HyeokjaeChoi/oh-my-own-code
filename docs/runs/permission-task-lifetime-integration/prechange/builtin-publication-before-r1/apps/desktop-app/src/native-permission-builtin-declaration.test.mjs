import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve("eslint"));
const espree = eslintRequire("espree");
const eslintScope = eslintRequire("eslint-scope");
function assertClosedFactory(before, source) {
  const analyze = (text) =>
    eslintScope.analyze(
      espree.parse(text, {
        ecmaVersion: "latest",
        sourceType: "module",
        range: true,
      }),
      { ecmaVersion: 2024, sourceType: "module" },
    );
  const original = analyze(before);
  const locals = new Set(
    original.scopes
      .find((scope) =>
        scope.variables.some(
          (variable) =>
            variable.name === "ctx" &&
            variable.defs.some((definition) => definition.type === "Parameter"),
        ),
      )
      .variables.map((variable) => variable.name),
  );
  const extracted = analyze(source);
  assert.deepEqual(
    [
      ...new Set(
        extracted.globalScope.through.map(
          (reference) => reference.identifier.name,
        ),
      ),
    ].filter((name) => locals.has(name)),
    [],
    "factory lost original plugin closure dependencies",
  );
}

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
  [
    "edit",
    "04zc2vp5",
    "Plugin39",
    "access, fileMutation, environment, formatter, location, permission",
  ],
  [
    "write",
    "5m3ds5v3",
    "Plugin42",
    "access, fileMutation, environment, formatter, permission",
  ],
  [
    "patch",
    "8f36rj9w",
    "Plugin46",
    "environment, access, fileMutation, formatter, location, permission",
  ],
  [
    "shell",
    "2et2b5t1",
    "Plugin41",
    "shell, compatibleShell, prepare, jobs, notifyWhenDone",
  ],
  [
    "subagent",
    "191v1wnc",
    "Plugin49",
    "sessions, config, agents, permission, resolveModel, subagents, jobs",
  ],
  ["websearch", "9tndjada", "Plugin45", "permission, websearch, ctx, forms"],
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
    if (family === "shell") names.push("description");
    const values = names.map((name) =>
      name.startsWith("name")
        ? family
        : name === "description"
          ? new Function(
              `return (${before.slice(before.indexOf("var description = ") + "var description = ".length, before.indexOf(";", before.indexOf("var description = ")))});`,
            )()
          : Object.freeze({ placeholder: name }),
    );
    const factoryStart = after.indexOf(`var ${family}Declarations2 =`);
    const factoryEnd = after.indexOf(`var ${plugin} =`, factoryStart);
    assert.ok(factoryStart >= 0 && factoryEnd > factoryStart);
    assertClosedFactory(before, after.slice(factoryStart, factoryEnd));
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
    // Hook-bearing families retain every original setup byte except the
    // transform assignment and final return. Do not run their service setup.
    if (["patch", "shell", "subagent", "websearch"].includes(family)) {
      const pluginStart = before.indexOf(`var ${plugin} =`);
      const pluginEnd =
        before.indexOf("\n  })\n};", pluginStart) + "\n  })\n};".length;
      const originalEffect = before.slice(pluginStart, pluginEnd);
      const transformedStart = after.indexOf(`var ${plugin} =`);
      const transformedEnd =
        after.indexOf("\n  })\n};", transformedStart) + "\n  })\n};".length;
      const transform = entry.edits.find((edit) =>
        edit.find.startsWith(prefix),
      );
      assert.equal(
        after.slice(transformedStart, transformedEnd),
        originalEffect
          .replace(transform.find, transform.replace)
          .replace("\n  })\n};", "\n    return declaration;\n  })\n};"),
      );
      assert.ok(
        after.lastIndexOf("yield* ctx.session.hook", transformedEnd) <
          after.indexOf("    return declaration;", transformedStart),
      );
      return;
    }
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

for (const [family, chunk, plugin, dependencies, ids] of [
  [
    "opencodeTools",
    "kb6gw2zp",
    "Plugin47",
    "ctx",
    ["session_rename", "session_move", "models"],
  ],
  [
    "mcpResources",
    "e2skv07x",
    "Plugin48",
    "mcp, permission",
    ["list_mcp_resources", "read_mcp_resource"],
  ],
]) {
  test(`${family}: exact literal declarations, namespace, inert closure and private bundle brand`, async () => {
    const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    const entry = recipe.files.find((file) => file.path === path);
    assert.ok(entry, `${family} bundle extraction is missing`);
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
    const transform = entry.edits.find((edit) =>
      edit.find.startsWith("    yield* ctx.tool.transform("),
    );
    // Extract literal object expressions. Never call a fake editor or transform.
    const objects = [
      ...transform.find.matchAll(
        / {6}(?:draft|editor)\.add\(([\s\S]*?)\n {6}\}\);/g,
      ),
    ].map((match) => match[1] + "\n      }");
    assert.equal(objects.length, ids.length);
    const headers = objects
      .map((object) => object.slice(0, object.indexOf("        execute:")))
      .join("\n");
    const names = [
      ...new Set(
        [...headers.matchAll(/(?:input|output): ([A-Za-z][\w]*)[,\n]/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    if (family === "mcpResources")
      names.push("Schema", "Resource2", "ResourceTemplate2");
    let calls = 0;
    const trap = new Proxy(
      () => {
        calls++;
        throw Error("callback called");
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
    // Actual schema constructors only; no Native services or plugin module load.
    const { Schema } = await import(
      "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
    );
    const values = names.map((name) =>
      name === "Schema" ? Schema : Schema.String,
    );
    const start = after.indexOf(`var ${family}Declarations2 =`);
    const end = after.indexOf(`var ${plugin} =`, start);
    assert.ok(start >= 0 && end > start);
    const source = after.slice(start, end);
    assertClosedFactory(before, source);
    const evaluate = () =>
      new Function(
        ...names,
        `${source}\nreturn { make: ${family}Declaration2, accepts: is${family[0].toUpperCase() + family.slice(1)}Declaration2 };`,
      )(...values);
    const factory = evaluate();
    const args = dependencies.split(", ");
    const bundle = factory.make(...args.map(() => trap));
    assert.deepEqual(Object.keys(bundle).sort(), ["declarations", "namespace"]);
    assert.ok(Object.isFrozen(bundle));
    assert.ok(Object.isFrozen(bundle.declarations));
    assert.deepEqual(
      bundle.declarations.map((row) => row.name),
      ids,
    );
    const namespace = transform.find.match(
      / {6}draft\.namespace\(([\s\S]*?)\);/,
    );
    assert.deepEqual(
      bundle.namespace,
      namespace ? new Function(`return (${namespace[1]});`)() : null,
    );
    if (namespace) assert.ok(Object.isFrozen(bundle.namespace));
    for (const [index, object] of objects.entries()) {
      const original = new Function(...names, ...args, `return (${object});`)(
        ...values,
        ...args.map(() => trap),
      );
      const declaration = bundle.declarations[index];
      assert.equal(declaration.execute.toString(), original.execute.toString());
      assert.deepEqual(declaration.options, original.options);
      assert.equal(declaration.name, original.name);
      assert.equal(declaration.description, original.description);
      for (const key of ["input", "output"]) {
        if (
          (family === "mcpResources" && key === "input") ||
          (family === "mcpResources" && index === 0 && key === "output")
        )
          assert.deepEqual(
            Schema.toJsonSchemaDocument(declaration[key]),
            Schema.toJsonSchemaDocument(original[key]),
          );
        else assert.equal(declaration[key], original[key]);
      }
      assert.ok(Object.isFrozen(declaration));
      assert.ok(Object.isFrozen(declaration.options));
      assert.equal(factory.accepts(declaration), false);
      assert.equal(factory.accepts(original), false);
    }
    assert.equal(factory.accepts(bundle), true);
    assert.equal(factory.accepts({ ...bundle }), false);
    assert.equal(
      factory.accepts(
        Object.freeze({
          namespace: bundle.namespace,
          declarations: bundle.declarations,
        }),
      ),
      false,
    );
    assert.equal(evaluate().accepts(bundle), false);
    assert.equal(factory.accepts(undefined), false);
    assert.equal(factory.accepts(new Proxy(bundle, {})), false);
    const pluginStart = before.indexOf(`var ${plugin} =`);
    const pluginEnd =
      before.indexOf("\n  })\n};", pluginStart) + "\n  })\n};".length;
    const afterStart = after.indexOf(`var ${plugin} =`);
    const afterEnd =
      after.indexOf("\n  })\n};", afterStart) + "\n  })\n};".length;
    assert.equal(
      after.slice(afterStart, afterEnd),
      before
        .slice(pluginStart, pluginEnd)
        .replace(transform.find, transform.replace)
        .replace("\n  })\n};", "\n    return declaration;\n  })\n};"),
    );
    assert.match(after, new RegExp(`Object\\.freeze\\(${plugin}\\)`));
    assert.equal(calls, 0);
  });
}
