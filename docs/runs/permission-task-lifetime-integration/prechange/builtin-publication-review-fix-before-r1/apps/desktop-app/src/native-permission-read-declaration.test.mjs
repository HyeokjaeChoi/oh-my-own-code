// Exact pinned Native declaration code under Node; no Native module imports or IO callbacks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as currentRecipe } from "./native-permission-overlay-contract.mjs";
const NATIVE_PERMISSION_OVERLAY_RECIPE =
  process.env.OMOC_READ_METADATA_PRECHANGE === "1"
    ? (
        await import(
          new URL(
            "../../../docs/runs/permission-task-lifetime-integration/prechange/read-metadata-registration-before-r1/apps/desktop-app/src/native-permission-overlay-contract.mjs",
            import.meta.url,
          )
        )
      ).NATIVE_PERMISSION_OVERLAY_RECIPE
    : currentRecipe;
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const path = "node_modules/@opencode/core/dist/chunks/config-kcmnw9z9.js";
const before = await readFile(new URL(path, root));
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, root)),
  })),
);
const output = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  inputs,
).files.find((row) => row.path === path);
const source = output?.content.toString() ?? before.toString();
const start = source.includes("var readDeclarations2 = ")
  ? source.indexOf("var readDeclarations2 = ")
  : source.indexOf("var readDeclaration2 = ");
const end = source.indexOf("var Plugin37 =", start);
const effect = await import(new URL("node_modules/effect/dist/index.js", root));
const { Effect, Context } = effect;
function factory(input, output) {
  assert.ok(
    start >= 0 && end > start,
    "Native Read needs a declaration constructor outside transform callbacks",
  );
  return new Function(
    "name2",
    "Input2",
    "Output",
    source.slice(start, end) +
      "\nreturn { make: readDeclaration2, publish: readPublication2, lookup: getReadPublication2 };",
  )("read", input, output);
}
test("actual Native Read declaration construction does not invoke service, transform or execution callbacks", () => {
  const input = Object.freeze({ opaque: "input" }),
    output = Object.freeze({ opaque: "output" });
  const { make: create, publish, lookup } = factory(input, output);
  let calls = 0;
  const poison = new Proxy(
    {},
    {
      get() {
        calls++;
        throw Error("service access during metadata construction");
      },
    },
  );
  const callback = () => {
    calls++;
    throw Error("callback during metadata construction");
  };
  const declaration = create(
    poison,
    poison,
    poison,
    poison,
    poison,
    callback,
    callback,
  );
  assert.equal(calls, 0);
  assert.equal(declaration.name, "read");
  assert.equal(declaration.input, input);
  assert.equal(declaration.output, output);
  assert.equal(typeof declaration.execute, "function");
  const publication = publish(declaration);
  assert.equal(calls, 0);
  assert.equal(lookup(publication), declaration);
  assert.equal(
    lookup(() => {}),
    undefined,
  );
  assert.throws(() => publish({ ...declaration }), /unbranded/);
  assert.equal(declaration.options.codemode, false);
  assert.ok(Object.isFrozen(declaration));
  assert.ok(Object.isFrozen(declaration.options));
});
test("actual Native Plugin publishes and returns the same declaration without service execution", async () => {
  const input = {},
    output = {};
  const { make: create, publish, lookup } = factory(input, output);
  let executed = 0,
    transforms = 0,
    created,
    registered;
  const poison = new Proxy(
    {},
    {
      get() {
        executed++;
        throw Error("execution during registration");
      },
    },
  );
  const tags = Object.fromEntries(
    ["Service7", "Service21", "Service12", "Service80", "FileSystem"].map(
      (name) => [
        name,
        class extends Context.Service()(`read-declaration/${name}`) {},
      ],
    ),
  );
  const pluginEnd = source.indexOf("var toModelContent2 =", end);
  assert.ok(pluginEnd > end);
  const deps = {
    Effect,
    readPublication2: publish,
    ...tags,
    FSUtil: { Service: tags.FileSystem },
    readDeclaration2: (...args) => {
      created = create(...args);
      return created;
    },
  };
  const plugin = new Function(
    ...Object.keys(deps),
    source.slice(end, pluginEnd) + "\nreturn Plugin37;",
  )(...Object.values(deps));
  let program = plugin.effect({
    tool: {
      transform: (callback) =>
        Effect.sync(() => {
          transforms++;
          assert.equal(lookup(callback), created);
          callback({
            add: (declaration) => {
              registered = declaration;
            },
          });
        }),
    },
  });
  for (const tag of Object.values(tags))
    program = program.pipe(Effect.provideService(tag, poison));
  const returned = await Effect.runPromise(program);
  assert.equal(returned, registered);
  assert.equal(executed, 0);
  assert.equal(
    transforms,
    1,
    "Read must publish at the original transform statement",
  );
  assert.equal(registered, created);
  assert.equal(registered.input, input);
});
test("Read declaration overlay binds actual original Native source bytes and preserves original install", () => {
  const file = NATIVE_PERMISSION_OVERLAY_RECIPE.files.find(
    (row) => row.path === path,
  );
  assert.ok(file);
  assert.equal(
    createHash("sha256").update(before).digest("hex"),
    file.beforeSha256,
  );
  assert.equal(
    createHash("sha256").update(output.content).digest("hex"),
    file.afterSha256,
  );
  assert.ok(
    before.toString().includes("ctx.tool.transform((editor) => editor.add({"),
  );
  assert.ok(
    source.includes(
      "ctx.tool.transform(readPublication2(declaration)).pipe(Effect.orDie)",
    ),
  );
});

test("shared declaration preserves the exact original Native execute function body without calling it", () => {
  const text = before.toString();
  const prefix = "yield* ctx.tool.transform((editor) => editor.add(";
  const begin = text.indexOf(prefix) + prefix.length;
  const finish = text.indexOf(")).pipe(Effect.orDie);", begin);
  assert.ok(begin >= prefix.length && finish > begin);
  const original = new Function(
    "name2",
    "Input2",
    "Output",
    `return (${text.slice(begin, finish)});`,
  )("read", {}, {});
  const poison = () => {
    throw Error("must not execute");
  };
  const declaration = factory({}, {}).make(
    poison,
    poison,
    poison,
    poison,
    poison,
    poison,
    poison,
  );
  assert.equal(declaration.execute.toString(), original.execute.toString());
});
