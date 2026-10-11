import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltinDeclarationProjector } from "./native-permission-tool-data.mjs";

function fixture(convert) {
  const values = new WeakSet();
  let definitions = 0;
  const accepts = (value) => values.has(value);
  const make = (minimum = -0.5) => {
    const value = Object.freeze({
      name: "read",
      description: "Fixed declaration",
      options: Object.freeze({ codemode: false }),
      input: { type: "number", minimum },
      output: { type: "string" },
      execute: () => {
        throw Error("execute must not run");
      },
    });
    values.add(value);
    return value;
  };
  const project = createBuiltinDeclarationProjector({
    pluginId: "opencode.tool.read",
    sourceSha256: "a".repeat(64),
    accepts,
    definition: (tool) => {
      definitions++;
      if (convert) return convert(tool);
      return {
        type: "tool",
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
      };
    },
  });
  return { make, project, definitions: () => definitions };
}

test("branded fixed declaration binds exact schema/options/source without execute", () => {
  const f = fixture();
  const value = f.make();
  const [row] = f.project(value);
  assert.equal(row.toolId, "read");
  assert.equal(row.sourceSha256, "a".repeat(64));
  assert.match(row.schemaDigest, /^[a-f0-9]{64}$/u);
  assert.match(row.optionsDigest, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(row));
  assert.notEqual(f.project(f.make(-0.25))[0].schemaDigest, row.schemaDigest);
  value.input.minimum = -9;
  assert.match(row.schemaDigest, /^[a-f0-9]{64}$/u);
  assert.notEqual(f.project(value)[0].schemaDigest, row.schemaDigest);
});

test("schema JSON rejects callbacks, accessors, cycles, holes, nonfinite and over-budget data", () => {
  for (const invalid of [
    undefined,
    NaN,
    Infinity,
    () => {},
    new Date(),
    new Array(1),
    { hidden: undefined },
    { long: "x".repeat(1024 * 1024) },
  ]) {
    const f = fixture((tool) => ({
      type: "tool",
      name: tool.name,
      description: "fixed",
      inputSchema: invalid,
    }));
    assert.throws(() => f.project(f.make()));
  }
  let getters = 0;
  const invalid = {
    get type() {
      getters++;
      return "string";
    },
  };
  const cyclic = {};
  cyclic.self = cyclic;
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        getters++;
        return [];
      },
    },
  );
  for (const value of [invalid, cyclic, proxy]) {
    const f = fixture((tool) => ({
      type: "tool",
      name: tool.name,
      description: "fixed",
      inputSchema: value,
    }));
    assert.throws(() => f.project(f.make()));
  }
  assert.equal(getters, 0);
});

test("pinned original Native definition converter accepts real Effect schemas without core import", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const root = new URL(
    "../runtime-event-host/.generated/install/node_modules/",
    import.meta.url,
  );
  const { Schema } = await import(new URL("effect/dist/index.js", root));
  assert.equal(
    JSON.parse(await readFile(new URL("effect/package.json", root))).version,
    "4.0.0-rc.112",
  );
  const source = await readFile(
    new URL("@opencode/core/dist/chunks/config-3w5fmr99.js", root),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "28f8e167d496e3469ce4d1532b003b6adbc03c6641734be66a9e7b02fad1584d",
  );
  // Extract fixed pure functions only: do not run original imports or Cache setup.
  const definitionSource = source.slice(
    source.indexOf("var definition2 ="),
    source.indexOf("var execute3 ="),
  );
  const helpers = source.slice(
    source.indexOf("var isStandardSchema ="),
    source.indexOf("\nexport {"),
  );
  let foreign = 0;
  const definition = new Function(
    "Schema",
    "$ZodType",
    "toJSONSchema",
    `${definitionSource}\n${helpers}\nreturn definition2;`,
  )(Schema, class {}, () => {
    foreign++;
    throw Error("unverified Zod branch");
  });
  // Fixed fixture schema values are real pinned Effect constructors. This is
  // converter compatibility, not acceptance of all original builtin schemas.
  const values = new WeakSet();
  const declaration = Object.freeze({
    name: "read",
    description: "fixed",
    input: Schema.Struct({
      amount: Schema.Number.check(
        Schema.isBetween({ minimum: -0.5, maximum: 1.25 }),
      ),
    }),
    output: Schema.Array(Schema.String),
    options: Object.freeze({ codemode: false }),
    execute: () => {
      throw Error("execute must not run");
    },
  });
  values.add(declaration);
  const project = createBuiltinDeclarationProjector({
    pluginId: "opencode.tool.read",
    sourceSha256: "a".repeat(64),
    accepts: (item) => values.has(item),
    definition,
  });
  const [row] = project(declaration);
  assert.match(row.schemaDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(project(declaration), [row]);
  assert.equal(foreign, 0);
});

test("fixed bundles bind every effective ID and namespace; reordered or substituted rows refuse", () => {
  const branded = new WeakSet();
  const make = (names, namespaceDescription = "fixed") => {
    const bundle = Object.freeze({
      namespace: Object.freeze({
        name: "opencode",
        description: namespaceDescription,
      }),
      declarations: Object.freeze(
        names.map((name) =>
          Object.freeze({
            name,
            description: "fixed",
            input: {},
            options: Object.freeze({ namespace: "opencode", codemode: true }),
            execute: () => {
              throw Error("execute must not run");
            },
          }),
        ),
      ),
    });
    branded.add(bundle);
    return bundle;
  };
  const project = createBuiltinDeclarationProjector({
    pluginId: "opencode.tools",
    sourceSha256: "a".repeat(64),
    accepts: (value) => branded.has(value),
    definition: (tool) => ({
      type: "tool",
      name: `${tool.options.namespace}_${tool.name}`,
      description: tool.description,
      inputSchema: tool.input,
    }),
  });
  const names = ["session_rename", "session_move", "models"];
  const rows = project(make(names));
  assert.deepEqual(
    rows.map((row) => row.toolId),
    names.map((name) => `opencode_${name}`),
  );
  assert.ok(Object.isFrozen(rows));
  assert.notEqual(
    project(make(names, "changed"))[0].optionsDigest,
    rows[0].optionsDigest,
  );
  assert.throws(() => project(make([...names].reverse())));
  assert.throws(() => project(make(["session_rename"])));
  assert.throws(() =>
    project(make(["session_rename", "session_move", "foreign"])),
  );
});

test("unbranded declaration refuses before getters or original schema conversion", () => {
  const f = fixture();
  let getters = 0;
  assert.throws(() =>
    f.project({
      get input() {
        getters++;
        return {};
      },
    }),
  );
  assert.equal(getters, 0);
  assert.equal(f.definitions(), 0);
});
