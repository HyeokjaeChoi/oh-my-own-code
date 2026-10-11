import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import path from "node:path";

// No Native/core module import, report, plan or ledger dependency. Original and
// recipe-patched expressions below are evaluated, with a closed input
// vocabulary. Scripted Bus/Integration/Location are NOT upstream Layer evidence.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const receipt = JSON.parse(await readFile(new URL("../receipt.json", root)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chunks = "node_modules/@opencode/core/dist/chunks/";
const pins = {
  "config-gh5tebn4.js":
    "3fd56d8e579c116c8e766b080295d35dc0af3ac04a276834fa4649b7bfe29cef",
  "config-gk30pdy3.js":
    "3e6a9601868a860703d8fb99a2b10558a4450f9046077ce70d904d3c8c37e1ca",
  "config-k1qb6em6.js":
    "dc81c5bdef2b2b06ae3dd10c7d2d7643a7d20963481b8f1d088ba89ae545b7c3",
  "config-qsdy395h.js":
    "8e9698a19c34b64dd75b6e5cb7c9cf8b464e31a7172e7f238a0963240fae61e0",
  "config-skwjfd4r.js":
    "26b0675f239f11bb5053567ad0ce8f3d32aa2e559d8158947db4ea69e4b34ffc",
  "config-vaz5h5qv.js":
    "61e70c3fbcb62f304a6e930404e6f306a36385c5e93d58ef8ae5da2bc87aac2e",
  "config-znr04804.js":
    "5d3cbf85696f24f6e07fc226754ca19544d15a19abd82eaf01dfbbbb49c7107d",
  "config-rtyr3d5h.js":
    "266273e7fa161f5a7bf45bb62f6260eb708c25a36acd4cfb6a9f07d400b6d68f",
  "config-y71avatq.js":
    "6c63b1335401386d089eba016d2397567465713e2fc2fa123407e4eeca7b45ac",
  "config-zrq68ahz.js":
    "475eaad9396f996a69155ece0828e12135646cad1905c41e2f123a9fa2a34757",
  "config-2e655exz.js":
    "dec09d0bf8fa0b6716b82502604014af9db5734d2ac3ef3315c6bfb89767824e",
  "config-rdw6cm16.js":
    "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
};
async function pinned(path, expected) {
  const rows = receipt.installEntries.filter((row) => row.path === path);
  assert.equal(rows.length, 1, `unique receipt identity: ${path}`);
  if (expected) assert.equal(rows[0].sha256, expected, path);
  const bytes = await readFile(new URL(path, root));
  assert.equal(sha(bytes), rows[0].sha256, path);
  return bytes.toString("utf8");
}
const originals = Object.fromEntries(
  await Promise.all(
    Object.entries(pins).map(async ([name, hash]) => [
      name,
      await pinned(chunks + name, hash),
    ]),
  ),
);
const effectPackage = JSON.parse(
  await pinned("node_modules/effect/package.json"),
);
assert.equal(effectPackage.version, "4.0.0-rc.112");
// Verify the installed Effect JS closure before its first import, not just its
// barrel. No original application dependency module is imported.
const effectRows = receipt.installEntries.filter(
  (row) =>
    row.path.startsWith("node_modules/effect/") && row.path.endsWith(".js"),
);
assert.ok(
  effectRows.some((row) => row.path === "node_modules/effect/dist/index.js"),
);
await Promise.all(effectRows.map((row) => pinned(row.path)));
// The Effect barrel also reaches fast-check/pure-rand. Verify its exact static
// ESM closure and package export resolution BEFORE importing any runtime code.
const runtimeClosure = new Map();
const runtimePackages = new Map([["effect", effectPackage]]);
async function runtimePackage(name) {
  if (!runtimePackages.has(name))
    runtimePackages.set(
      name,
      JSON.parse(await pinned(`node_modules/${name}/package.json`)),
    );
  return runtimePackages.get(name);
}
async function verifyRuntime(path) {
  if (runtimeClosure.has(path)) return;
  assert.ok(
    ["effect", "fast-check", "pure-rand"].some((name) =>
      path.startsWith(`node_modules/${name}/`),
    ),
    `unexpected runtime dependency: ${path}`,
  );
  const text = await pinned(path);
  runtimeClosure.set(path, sha(text));
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  for (const node of source.statements) {
    if (
      !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier
    )
      continue;
    const spec = node.moduleSpecifier.text;
    if (spec === "node:assert") continue;
    let dependency;
    if (spec.startsWith(".")) {
      const url = new URL(spec, new URL(path, root));
      assert.ok(url.href.startsWith(root.href));
      dependency = url.href.slice(root.href.length);
    } else {
      const [name, ...parts] = spec.split("/");
      assert.ok(
        ["effect", "fast-check", "pure-rand"].includes(name),
        `unknown runtime package: ${spec}`,
      );
      const pkg = await runtimePackage(name);
      let target = pkg.exports[parts.length ? "./" + parts.join("/") : "."];
      if (target === undefined && name === "effect" && parts.length === 1) {
        assert.equal(pkg.exports["./*"], "./dist/*.js");
        target = pkg.exports["./*"].replace("*", parts[0]);
      }
      if (target && typeof target === "object") target = target.import;
      if (target && typeof target === "object") target = target.default;
      assert.equal(typeof target, "string", `closed import export: ${spec}`);
      dependency = `node_modules/${name}/${target.replace(/^\.\//, "")}`;
    }
    await verifyRuntime(dependency);
  }
}
await verifyRuntime("node_modules/effect/dist/index.js");
const runtimeClosureSHA = sha(
  JSON.stringify([...runtimeClosure].sort(([a], [b]) => a.localeCompare(b))),
);
const {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Latch,
  Layer,
  Queue,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SynchronizedRef,
} = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);

function select(name, identity, kind = "variable", text = originals[name]) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const matches = [];
  function visit(node) {
    if (
      (kind === "variable" && ts.isVariableDeclaration(node)) ||
      (kind === "function" && ts.isFunctionDeclaration(node)) ||
      (kind === "class" && ts.isClassDeclaration(node))
    ) {
      if (node.name?.getText(source) === identity) matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `${name}: unique ${identity}`);
  const node = matches[0];
  const selected = kind === "variable" ? node.initializer : node;
  assert.ok(selected);
  return {
    text: selected.getText(source),
    line:
      source.getLineAndCharacterOfPosition(selected.getStart(source)).line + 1,
    end: source.getLineAndCharacterOfPosition(selected.end).line + 1,
    identity,
    name,
  };
}

// TypeScript resolves local symbols, including nested closures. Unknown free
// names fail BEFORE evaluation; no fallback Proxy/Effect.void dependency exists.
const builtins = {
  Map,
  Set,
  WeakMap,
  WeakSet,
  Array,
  Object,
  structuredClone: globalThis.structuredClone,
  undefined,
  Error,
  String,
};
function compile(text, inputs) {
  const code = `function extracted(${Object.keys(inputs).join(",")}) { ${text} }`;
  const file = ts.createSourceFile(
    "extracted.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const host = {
    getSourceFile: (name) => (name === file.fileName ? file : undefined),
    getDefaultLibFileName: () => "unused.d.ts",
    writeFile: () => assert.fail("no compiler writes"),
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === file.fileName,
    readFile: () => undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const checker = ts
    .createProgram([file.fileName], { noLib: true }, host)
    .getTypeChecker();
  const unknown = new Set();
  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      node.kind === ts.SyntaxKind.ImportKeyword
    )
      assert.fail("extracted application imports refused");
    if (ts.isIdentifier(node) && !checker.getSymbolAtLocation(node)) {
      const parent = node.parent;
      const property =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
          parent.name === node);
      if (!property && !Object.hasOwn(builtins, node.text))
        unknown.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.deepEqual(
    [...unknown].sort(),
    [],
    "unknown original dependency refused",
  );
  const environment = { ...builtins, ...inputs };
  return new Function(...Object.keys(environment), `"use strict"; ${text}`)(
    ...Object.values(environment),
  );
}

const stateName = "config-rdw6cm16.js";
const stateSelections = [
  select(stateName, "CurrentGroup"),
  select(stateName, "CurrentBatch"),
  select(stateName, "disable", "function"),
  select(stateName, "run", "function"),
  select(stateName, "shutdown2", "function"),
  select(stateName, "create3", "function"),
  select(stateName, "reconcile2", "function"),
  select(stateName, "group2", "function"),
  select(stateName, "batch2", "function"),
  select(stateName, "inherit2"),
];
const stateText = stateSelections
  .map((row) =>
    row.identity.startsWith("Current") || row.identity === "inherit2"
      ? `const ${row.identity} = ${row.text};`
      : row.text,
  )
  .join("\n");
const actualState = compile(
  `${stateText}\nreturn { create3, shutdown2, reconcile2, group2, batch2, inherit2, CurrentGroup, CurrentBatch };`,
  {
    Cause,
    Context,
    Effect,
    Exit,
    Fiber,
    Scope,
  },
);

// Provider/Model acquisition remains in its separately contracted suite. Do not
// import that test module here and register its passing cases a second time.

const evidence = [...stateSelections];
function expression(file, name, kind = "variable") {
  const row = select(file, name, kind);
  evidence.push(row);
  return row.text;
}
const integrationFile = "config-vaz5h5qv.js";
const mcpFile = "config-znr04804.js";
const integrationLayer = expression(integrationFile, "layer");
function lifecycleExpression(file, name) {
  // Test-only mutation: exercise the actual original constructors for RED.
  if (process.env.METADATA_LIFETIME_ORIGINAL_RED === "1")
    return select(file, name).text;
  let text = originals[file];
  const row = recipe.files.find((item) => item.path === chunks + file);
  if (!row) return select(file, name).text; // Actual original RED before patch.
  assert.equal(sha(text), row.beforeSha256);
  for (const edit of row.edits) {
    assert.equal(text.split(edit.find).length, 2);
    text = text.replace(edit.find, edit.replace);
  }
  assert.equal(sha(text), row.afterSha256);
  return select(file, name, "variable", text).text;
}
const integrationClass = expression(integrationFile, "Service72", "class");
const credentialClass = expression("config-rtyr3d5h.js", "Service73", "class");
const credentialLayer = expression("config-rtyr3d5h.js", "layer");
const providerClass = expression("config-zrq68ahz.js", "Service71", "class");
const providerLayer = expression("config-zrq68ahz.js", "layer");
const mcpClass = expression(mcpFile, "Service32", "class");
const mcpOriginal = expression(mcpFile, "layer13");
const mutex = compile(
  `return ${expression("config-y71avatq.js", "makeUnsafe2")};`,
  { Effect, Semaphore },
);
const constants = Object.fromEntries(
  ["attemptLifetime", "terminalRetention", "scrubInterval"].map((name) => [
    name,
    compile(`return ${expression(integrationFile, name)};`, { Duration }),
  ]),
);

// Only the import CALL is replaced, including dormant OAuth authorization.
// The promise thunk, generator, status mutation, forks and reconcile stay exact.
// Reverse reconstruction proves that no other expression bytes were changed.
function refuseImports(original) {
  const file = ts.createSourceFile(
    "boundary.js",
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  const sites = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      assert.equal(node.arguments.length, 1);
      assert.ok(ts.isStringLiteral(node.arguments[0]));
      const path = node.arguments[0].text;
      assert.ok(["../mcp/oauth.js", "../mcp/client.js"].includes(path));
      sites.push({
        start: node.getStart(file),
        end: node.end,
        text: node.getText(file),
        replacement: `deniedImport(${JSON.stringify(path)})`,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(sites.length, 3);
  let changed = original;
  for (const site of sites.toReversed())
    changed =
      changed.slice(0, site.start) + site.replacement + changed.slice(site.end);
  let offset = 0;
  const changedSites = sites.map((site) => {
    const start = site.start + offset;
    offset += site.replacement.length - (site.end - site.start);
    return { ...site, start };
  });
  let reversed = changed;
  for (const site of changedSites.toReversed()) {
    assert.equal(
      reversed.slice(site.start, site.start + site.replacement.length),
      site.replacement,
    );
    reversed =
      reversed.slice(0, site.start) +
      site.text +
      reversed.slice(site.start + site.replacement.length);
  }
  assert.equal(
    reversed,
    original,
    "only exact dynamic-import boundaries substituted",
  );
  return changed;
}
const mcpLayer = refuseImports(mcpOriginal);
const cloneConfig = compile(`return ${expression(mcpFile, "cloneConfig")};`, {
  structuredClone: globalThis.structuredClone,
});
const mcpConstants = Object.fromEntries(
  ["GLOBAL_ELICITATION_SESSION_ID", "URL_ELICITATION_FIELD_KEY"].map((name) => [
    name,
    compile(`return ${expression(mcpFile, name)};`, {}),
  ]),
);
const run = (effect) => Effect.runPromise(effect);
const close = (scope) => run(Scope.close(scope, Exit.void));
function setup(options = {}) {
  const calls = [];
  const forbidden =
    (name) =>
    (...args) => {
      calls.push(["refused", name, args]);
      throw Error(`external_refused:${name}`);
    };
  const poison = (name) =>
    new Proxy(
      {},
      { get: (_target, key) => forbidden(`${name}.${String(key)}`)() },
    );
  const gate = Deferred.makeUnsafe();
  const scrubbed = Deferred.makeUnsafe();
  const statusEntered = Deferred.makeUnsafe();
  const clocksEntered = Deferred.makeUnsafe();
  const delivered = Deferred.makeUnsafe();
  const refs = [];
  let modifications = 0;
  let integrationState;
  let integrationOwnerScope;
  let mcpState;
  let mcpOwnerScope;
  let providerState;
  let queue;
  let subscriberScope;
  let releaseBoundary;
  const boundary = new Promise((resolve) => {
    releaseBoundary = resolve;
  });
  const bus = {
    publish(type, data) {
      calls.push(["publish.construct", type, data]);
      return Effect.gen(function* () {
        calls.push(["publish.execute", type, data]);
        if (options.blockStatus && type === "MCP.StatusChanged") {
          yield* Deferred.succeed(statusEntered, undefined);
          yield* Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => calls.push(["publish.interrupt", type])),
            ),
          );
        }
      });
    },
    subscribe(type) {
      calls.push(["subscribe.construct", type]);
      return Stream.unwrap(
        Effect.gen(function* () {
          subscriberScope = yield* Scope.Scope;
          queue = yield* Queue.unbounded();
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => calls.push(["subscribe.release"])),
          );
          calls.push(["subscribe.acquire"]);
          yield* Deferred.succeed(gate, undefined);
          return Stream.fromQueue(queue).pipe(
            Stream.tap(() => Deferred.succeed(delivered, undefined)),
          );
        }),
      );
    },
  };
  // Every external operation is an explicit throwing standin. No real process,
  // environment, credential database, filesystem, OAuth or client is supplied.
  const Service83 = Context.Service("script/startup/Bus");
  const Service80 = Context.Service("script/startup/Location");
  const Service78 = Context.Service("script/startup/Environment");
  const Service74 = Context.Service("script/startup/Form");
  const ProcessService = Context.Service("script/startup/Process");
  const Service84 = Context.Service("script/startup/Database");
  const { Service71 } = compile(`${providerClass}; return {Service71};`, {
    Context,
  });
  const { Service73 } = compile(`${credentialClass}; return {Service73};`, {
    Context,
  });
  const { Service72 } = compile(`${integrationClass}; return {Service72};`, {
    Context,
  });
  const { Service32 } = compile(`${mcpClass}; return {Service32};`, {
    Context,
  });
  const db = Object.fromEntries(
    ["select", "transaction", "update", "insert", "delete"].map((name) => [
      name,
      forbidden(`database.${name}`),
    ]),
  );
  const inputs = {
    Cause,
    Context,
    Deferred,
    Duration,
    Effect,
    Exit,
    Fiber,
    FiberSet,
    Latch,
    Layer,
    Schedule,
    Scope,
    Semaphore,
    Stream,
    Service83,
    Service80,
    Service78,
    Service74,
    Service73,
    Service72,
    Service32,
    Service84,
    Service71,
    Schema: {
      decodeUnknownSync(value) {
        assert.equal(value, "scripted credential value schema");
        calls.push(["credential.decoder.construct"]);
        return forbidden("credential.decode");
      },
    },
    Value2: "scripted credential value schema",
    Info29: forbidden("Credential.Info.new"),
    ID14: { create: forbidden("Credential.ID.create") },
    CredentialTable2: Object.freeze({}),
    asc: forbidden("database.asc"),
    desc: forbidden("database.desc"),
    eq: forbidden("database.eq"),
    from2: forbidden("error.from"),
    Model: { Info: { default: forbidden("Model.Info.default") } },
    Provider: { Event: { Updated: "Provider.Updated" } },
    Event17: { Updated: "Integration.Updated" },
    Credential: {
      Event: { Updated: "Credential.Updated", Switched: "Credential.Switched" },
    },
    Info26: { empty: forbidden("Provider.Info.empty") },
    index: forbidden("Provider.index"),
    key2: forbidden("Provider.key"),
    rewrite2: forbidden("Provider.rewrite"),
    mergeOverlay2: forbidden("Provider.mergeOverlay"),
    mergeHeaders2: forbidden("Provider.mergeHeaders"),
    modelSettings2: forbidden("Provider.modelSettings"),
    freeze(value, deep) {
      assert.equal(deep, true);
      assert.deepEqual(value.providers, []);
      return value;
    },
    shutdown2: actualState.shutdown2,
    ...constants,
    AppProcess: {
      Service: ProcessService,
      collectStream: forbidden("process.collectStream"),
    },
    ChildProcess: { make: forbidden("process.make") },
    Clock: {
      currentTimeMillis: Effect.gen(function* () {
        calls.push(["clock.read"]);
        if (calls.filter((row) => row[0] === "clock.read").length === 2)
          yield* Deferred.succeed(clocksEntered, undefined);
        if (options.blockClock)
          return yield* Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => calls.push(["clock.interrupt"])),
            ),
          );
        return yield* Clock.currentTimeMillis;
      }),
    },
    // Observe real Ref modifications; maps and real synchronization stay intact.
    SynchronizedRef: {
      ...SynchronizedRef,
      makeUnsafe(value) {
        const ref = SynchronizedRef.makeUnsafe(value);
        refs.push(ref);
        return ref;
      },
      modify(ref, update) {
        return SynchronizedRef.modify(ref, (current) => {
          calls.push(["scrub.modify", refs.indexOf(ref), current.size]);
          const result = update(current);
          modifications++;
          if (modifications === 2) releaseScrubs();
          return result;
        });
      },
    },
    Integration: { Event: { Updated: "Integration.Updated" } },
    Info28: { make: forbidden("Integration.Info.make") },
    Key4: { make: forbidden("Credential.Key.make") },
    AttemptID2: { create: forbidden("AttemptID.create") },
    Attempt2: forbidden("Attempt.new"),
    CommandAttempt2: { make: forbidden("CommandAttempt.make") },
    AuthorizationError2: forbidden("AuthorizationError.new"),
    AttemptNotFoundError2: forbidden("AttemptNotFound.new"),
    CodeRequiredError2: forbidden("CodeRequired.new"),
    validateAnswer2: forbidden("validateAnswer"),
    validateFields2: forbidden("validateFields"),
    process: poison("process"),
    create3(input) {
      calls.push(["state.create", input.name]);
      const state = actualState.create3(input);
      if (input.name === "integration") integrationState = state;
      else if (input.name === "mcp") mcpState = state;
      else if (input.name === "provider") providerState = state;
      else assert.fail(`unowned State ${input.name}`);
      return state;
    },
    reconcile2(root, fork, work) {
      if (mcpOwnerScope) assert.equal(root, mcpOwnerScope);
      mcpOwnerScope = root;
      calls.push(["reconcile.construct"]);
      return actualState.reconcile2(root, fork, work);
    },
    makeUnsafe2: mutex,
    endpointLoads: mutex(),
    cloneConfig,
    createHash,
    isDeepStrictEqual,
    ID13: { make: (value) => value },
    MethodID2: { make: (value) => value },
    ServerName2: { make: (value) => value },
    Event18: { Switched: "Credential.Switched" },
    McpEvent: {
      StatusChanged: "MCP.StatusChanged",
      ToolsChanged: "MCP.ToolsChanged",
      ResourcesChanged: "MCP.ResourcesChanged",
    },
    PromptsChanged2: "MCP.PromptsChanged",
    ...mcpConstants,
    ID15: { create: forbidden("Form.ID.create") },
    toElicitationField: forbidden("Form.field"),
    waitForAbort: forbidden("process.waitForAbort"),
    ResourceCatalog2: poison("ResourceCatalog"),
    Resource2: poison("Resource"),
    ResourceTemplate2: poison("ResourceTemplate"),
    ResourceContent2: poison("ResourceContent"),
    NotFoundError4: forbidden("MCP.NotFound.new"),
    ToolCallError2: forbidden("MCP.ToolCall.new"),
    mergeCatalogs: forbidden("MCP.mergeCatalogs"),
    crypto: {
      randomUUID() {
        calls.push(["uuid.scripted"]);
        return "synthetic-connection-id";
      },
    },
    deniedImport(path) {
      calls.push(["import.refused", path]);
      releaseBoundary(path);
      return forbidden(`dynamic-import:${path}`)();
    },
  };
  // Record cancellation of actual scrub fibers without altering original forks.
  inputs.Effect = {
    ...Effect,
    forkIn: (scope, config) => (effect) => {
      if (integrationOwnerScope) assert.equal(scope, integrationOwnerScope);
      integrationOwnerScope = scope;
      calls.push(["scrub.fork"]);
      return Effect.forkIn(
        scope,
        config,
      )(
        effect.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => calls.push(["scrub.interrupt"])),
          ),
        ),
      );
    },
  };
  function releaseScrubs() {
    Effect.runSync(Deferred.succeed(scrubbed, undefined));
  }
  const clayer = compile(`return ${credentialLayer};`, inputs);
  const player = compile(`return ${providerLayer};`, { ...inputs, Effect });
  const ilayer = compile(
    `return ${options.patchedLifecycle ? lifecycleExpression(integrationFile, "layer") : integrationLayer};`,
    inputs,
  );
  // MCP receives the real Effect namespace; only Integration forks are observed.
  const selectedMcp = options.patchedLifecycle
    ? refuseImports(lifecycleExpression(mcpFile, "layer13"))
    : mcpLayer;
  const mlayer = compile(`return (${selectedMcp})();`, { ...inputs, Effect });
  let context = Context.empty();
  for (const [tag, service] of [
    [Service83, bus],
    [Service84, { db }],
    [ProcessService, { spawn: forbidden("process.spawn") }],
    [Service80, { directory: "/synthetic/never-opened" }],
    [Service78, { files: poison("FS"), spawner: poison("spawner") }],
    [Service74, { ask: forbidden("form.ask"), reply: forbidden("form.reply") }],
  ])
    context = Context.add(context, tag, service);
  return {
    calls,
    refs,
    gate,
    scrubbed,
    boundary,
    statusEntered,
    clocksEntered,
    delivered,
    get integrationState() {
      return integrationState;
    },
    get integrationOwnerScope() {
      return integrationOwnerScope;
    },
    get mcpState() {
      return mcpState;
    },
    get mcpOwnerScope() {
      return mcpOwnerScope;
    },
    get providerState() {
      return providerState;
    },
    get subscriberScope() {
      return subscriberScope;
    },
    buildCredential: (scope) =>
      Layer.buildWithScope(clayer, scope).pipe(Effect.provide(context)),
    credential: (ctx) => Context.get(ctx, Service73),
    supplyCredential(service) {
      context = Context.add(context, Service73, service);
    },
    buildProvider: (scope, integration) =>
      Layer.buildWithScope(player, scope).pipe(
        Effect.provide(Context.add(context, Service72, integration)),
      ),
    buildIntegration: (scope) =>
      Layer.buildWithScope(ilayer, scope).pipe(Effect.provide(context)),
    buildMCP: (scope, integration) =>
      Layer.buildWithScope(mlayer, scope).pipe(
        Effect.provide(Context.add(context, Service72, integration)),
      ),
    integration: (ctx) => Context.get(ctx, Service72),
    mcp: (ctx) => Context.get(ctx, Service32),
    emit: (id) => Queue.offer(queue, { data: { integrationID: id } }),
    forbidden,
  };
}
const count = (f, name) => f.calls.filter((row) => row[0] === name).length;
function noExternal(f) {
  assert.deepEqual(
    f.calls.filter(
      (row) => row[0] === "refused" || row[0] === "import.refused",
    ),
    [],
  );
}
async function acquired(options = {}) {
  const f = setup(options);
  const scope = await run(Scope.make());
  try {
    f.credentialService = f.credential(await run(f.buildCredential(scope)));
    f.supplyCredential(f.credentialService);
    f.integrationService = f.integration(await run(f.buildIntegration(scope)));
    f.mcpService = f.mcp(await run(f.buildMCP(scope, f.integrationService)));
    await run(Deferred.await(f.gate));
    return { f, scope };
  } catch (error) {
    await close(scope);
    throw error;
  }
}

test("startup extraction refuses unknown dependencies and unrewritten imports", () => {
  assert.throws(
    () => compile("return unknownExternal();", {}),
    /unknown original dependency/,
  );
  assert.throws(() => compile(`return ${mcpOriginal};`, {}), /imports refused/);
});

test(
  "Integration + MCP: real empty scrub, empty reconcile and scoped cleanup",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired();
    try {
      await run(Deferred.await(f.scrubbed));
      assert.equal(
        count(f, "credential.decoder.construct"),
        1,
        "actual Credential constructor builds decoder without database calls",
      );
      assert.equal(f.refs.length, 2);
      assert.deepEqual(
        await Promise.all(
          f.refs.map((ref) =>
            run(SynchronizedRef.get(ref)).then((value) => [...value]),
          ),
        ),
        [[], []],
      );
      assert.deepEqual(
        f.calls.filter((row) => row[0] === "scrub.modify"),
        [
          ["scrub.modify", 0, 0],
          ["scrub.modify", 1, 0],
        ],
      );
      assert.equal(count(f, "scrub.fork"), 2);
      assert.equal(count(f, "publish.execute"), 0);
      assert.notEqual(f.subscriberScope, scope);
      assert.deepEqual(await run(f.mcpService.servers()), []);
      await run(f.mcpService.reload());
      await run(f.mcpService.reload());
      assert.deepEqual(await run(f.mcpService.servers()), []);
      await run(f.integrationService.reload());
      assert.deepEqual(
        f.calls.filter((row) => row[0] === "publish.execute"),
        [["publish.execute", "Integration.Updated", {}]],
      );
    } finally {
      await close(scope);
    }
    assert.equal(count(f, "scrub.interrupt"), 2);
    assert.equal(count(f, "subscribe.release"), 1);
    noExternal(f);
  },
);

test(
  "Integration: Scope close cancels both blocked scrub reads",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired({ blockClock: true });
    try {
      // A scheduler yield is bounded and has no real timer/network dependency.
      await run(Effect.yieldNow);
      assert.equal(count(f, "clock.read"), 2);
      assert.equal(count(f, "scrub.modify"), 0);
    } finally {
      await close(scope);
    }
    assert.equal(count(f, "clock.interrupt"), 2);
    assert.equal(count(f, "scrub.interrupt"), 2);
    assert.equal(count(f, "subscribe.release"), 1);
    noExternal(f);
  },
);

for (const config of [
  { type: "local", command: ["never-run"], disabled: true },
  {
    type: "remote",
    url: "https://never.invalid/mcp",
    oauth: false,
    disabled: true,
  },
  { type: "remote", url: "https://never.invalid/mcp", disabled: true },
])
  test(
    `MCP disabled notification: ${config.type}, OAuth=${config.oauth !== false}`,
    { timeout: 5000 },
    async () => {
      const { f, scope } = await acquired();
      const registrationScope = await run(Scope.make());
      try {
        await run(
          f.mcpService
            .transform((editor) => editor.set("synthetic", config))
            .pipe(Scope.provide(registrationScope)),
        );
        const rows = await run(f.mcpService.servers());
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status.status, "disabled");
        const oauth = config.type === "remote" && config.oauth !== false;
        const expected = oauth
          ? "mcp_" +
            createHash("sha1")
              .update("synthetic\x00" + config.url)
              .digest("hex")
              .slice(0, 16)
          : undefined;
        assert.equal(rows[0].integrationID, expected);
        assert.deepEqual(
          [...f.integrationState.get().integrations.keys()],
          oauth ? [expected] : [],
        );
        if (oauth) {
          const entry = f.integrationState.get().integrations.get(expected);
          assert.deepEqual(entry.ref, {
            id: expected,
            name: "synthetic",
            metadata: { source: "mcp" },
          });
          assert.equal(entry.methods[0].type, "oauth");
          assert.equal(
            typeof entry.implementations.get(expected).authorize,
            "function",
          );
        }
        assert.deepEqual(
          f.calls
            .filter((row) => row[0] === "publish.execute")
            .map((row) => row[1]),
          oauth
            ? ["Integration.Updated", "MCP.StatusChanged"]
            : ["MCP.StatusChanged"],
        );
        await run(f.mcpService.reload());
        assert.equal(
          count(f, "publish.execute"),
          oauth ? 2 : 1,
          "unchanged reconciliation does not restart or publish",
        );
        await run(f.emit(expected ?? "unowned"));
        await run(Deferred.await(f.delivered));
        await run(Effect.yieldNow);
        assert.equal(
          count(f, "import.refused"),
          0,
          "disabled/unowned Credential.Switched cannot start",
        );
      } finally {
        await close(registrationScope);
        await close(scope);
      }
      assert.deepEqual([...f.integrationState.get().integrations.keys()], []);
      assert.equal(count(f, "subscribe.release"), 1);
      noExternal(f);
    },
  );

for (const config of [
  { type: "local", command: ["never-run"] },
  { type: "remote", url: "https://never.invalid/mcp", oauth: false },
  { type: "remote", url: "https://never.invalid/mcp" },
])
  test(
    `MCP enabled notification refuses before import: ${config.type}, OAuth=${config.oauth !== false}`,
    { timeout: 5000 },
    async () => {
      const { f, scope } = await acquired();
      try {
        // First empty reconcile selects subsequent replaceServer's awaited branch.
        await run(f.mcpService.reload());
        await assert.rejects(
          run(f.mcpService.add("synthetic", config)),
          /external_refused:dynamic-import/,
        );
        const oauth = config.type === "remote" && config.oauth !== false;
        const path = oauth ? "../mcp/oauth.js" : "../mcp/client.js";
        assert.equal(await f.boundary, path);
        assert.deepEqual(
          f.calls.filter((row) => row[0] === "import.refused"),
          [["import.refused", path]],
        );
        assert.deepEqual(
          f.calls.filter((row) => row[0] === "refused").map((row) => row[1]),
          [`dynamic-import:${path}`],
        );
        assert.deepEqual(
          f.calls
            .filter((row) => row[0] === "publish.execute")
            .map((row) => row[1]),
          oauth
            ? ["Integration.Updated", "MCP.StatusChanged"]
            : ["MCP.StatusChanged"],
        );
        assert.equal(
          (await run(f.mcpService.servers()))[0].status.status,
          "pending",
        );
      } finally {
        await close(scope);
      }
      assert.equal(count(f, "subscribe.release"), 1);
    },
  );

test(
  "Provider notification -> actual Integration.list -> actual Credential.all refuses database factory",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired();
    const providerScope = await run(Scope.make());
    try {
      await run(f.buildProvider(providerScope, f.integrationService));
      assert.equal(
        count(f, "refused"),
        0,
        "all three original constructors leave database untouched",
      );
      await assert.rejects(
        run(f.providerState.reload()),
        /external_refused:database.select/,
      );
      assert.deepEqual(
        f.calls.filter((row) => row[0] === "refused").map((row) => row[1]),
        ["database.select"],
      );
      assert.equal(
        count(f, "publish.execute"),
        0,
        "Provider Updated cannot publish after failed credential query",
      );
    } finally {
      await close(providerScope);
      await close(scope);
    }
    assert.equal(count(f, "subscribe.release"), 2);
    assert.equal(
      f.providerState.revision(),
      2,
      "actual Provider shutdown closes State",
    );
    await run(f.providerState.reload());
    assert.equal(
      count(f, "refused"),
      1,
      "closed Provider State cannot issue another credential query",
    );
  },
);

for (const config of [
  { type: "local", command: ["never-run"] },
  { type: "remote", url: "https://never.invalid/mcp" },
])
  test(
    `MCP first reconciliation forks enabled ${config.type} startup; refusal precedes external import`,
    { timeout: 5000 },
    async () => {
      const { f, scope } = await acquired();
      const registrationScope = await run(Scope.make());
      try {
        await run(
          f.mcpService
            .transform((editor) => editor.set("synthetic", config))
            .pipe(Scope.provide(registrationScope)),
        );
        assert.equal(
          await f.boundary,
          config.type === "remote" ? "../mcp/oauth.js" : "../mcp/client.js",
        );
        assert.equal(count(f, "import.refused"), 1);
        assert.deepEqual(
          f.calls.filter((row) => row[0] === "refused").map((row) => row[1]),
          [
            `dynamic-import:${config.type === "remote" ? "../mcp/oauth.js" : "../mcp/client.js"}`,
          ],
        );
        assert.equal(
          (await run(f.mcpService.servers()))[0].status.status,
          "pending",
        );
      } finally {
        await close(registrationScope);
        await close(scope);
      }
      assert.equal(count(f, "subscribe.release"), 1);
    },
  );

test(
  "Integration retains original reload notification after owner close; scrub cancellation is not State shutdown",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired();
    await run(Deferred.await(f.scrubbed));
    await close(scope);
    assert.equal(count(f, "scrub.interrupt"), 2);
    assert.equal(count(f, "publish.execute"), 0);
    await run(f.integrationService.reload());
    assert.deepEqual(
      f.calls.filter((row) => row[0] === "publish.execute"),
      [["publish.execute", "Integration.Updated", {}]],
    );
    assert.equal(f.integrationState.revision(), 1);
    // Closed MCP FiberSet refuses reconcile work. Actual reconcile2 suppresses
    // the interrupt only because the captured root is closed.
    await run(f.mcpService.reload());
    assert.equal(count(f, "publish.execute"), 1);
    noExternal(f);
  },
);

test(
  "MCP root close cancels blocked reconciliation notification and actual reconcile waiter settles",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired({ blockStatus: true });
    const fiber = Effect.runFork(
      f.mcpService.add("synthetic", {
        type: "local",
        command: ["never-run"],
        disabled: true,
      }),
    );
    try {
      await run(Deferred.await(f.statusEntered));
      assert.equal(count(f, "import.refused"), 0);
    } finally {
      await close(scope);
    }
    const exit = await run(Fiber.await(fiber));
    assert.equal(
      Exit.isSuccess(exit),
      true,
      "original reconcile2 suppresses closed-root interruption",
    );
    assert.equal(count(f, "publish.interrupt"), 1);
    assert.equal(count(f, "subscribe.release"), 1);
    noExternal(f);
  },
);

test("startup pins and exact original expression closure remain unchanged", async (t) => {
  for (const [file, hash] of Object.entries(pins))
    await pinned(chunks + file, hash);
  for (const [path, hash] of runtimeClosure)
    assert.equal(sha(await pinned(path)), hash);
  for (const name of runtimePackages.keys())
    await pinned(`node_modules/${name}/package.json`);
  t.diagnostic(
    `receipt sha256=${sha(await readFile(new URL("../receipt.json", root)))}; reused proof sha256=${sha(await readFile(new URL("./native-permission-service-acquisition.test.mjs", import.meta.url)))}`,
  );
  for (const row of evidence)
    t.diagnostic(
      `${chunks}${row.name}:${row.line}-${row.end} ${row.identity} sha256=${pins[row.name]}`,
    );
  t.diagnostic(
    `Effect ${effectPackage.version}; ${effectRows.length} Effect JS files and exact ${runtimeClosure.size} runtime ESM files receipt-verified BEFORE import; closure sha256=${runtimeClosureSHA}. Provider/Model proof remains separately contracted, with no duplicate test import.`,
  );
  t.diagnostic(
    "Node expression proof only. Explicit Bus/Database/Process/Environment/Form/schema/Clock/UUID standins; original Credential/Integration/Provider constructors and State/keyed mutex/Layer/Scope/FiberSet used. Only three dynamic-import call boundaries substituted with reverse equality. No Native/core module or external client imported. Control held, inventory incomplete; no compiler/handoff/startup authority.",
  );
});

for (const serviceName of ["integration", "mcp"]) {
  test(
    `patched ${serviceName} owner close shuts State before later reload`,
    { timeout: 5000 },
    async () => {
      const { f, scope } = await acquired({ patchedLifecycle: true });
      await run(Deferred.await(f.scrubbed));
      await close(scope);
      const service = f[`${serviceName}Service`];
      const state = f[`${serviceName}State`];
      const revision = state.revision();
      const calls = [...f.calls];
      await run(service.reload());
      await run(service.reload());
      assert.equal(state.revision(), revision);
      assert.deepEqual(f.calls, calls);
      noExternal(f);
    },
  );
}

test(
  "patched Integration notification refuses original Bus factory during owner closing",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired({ patchedLifecycle: true });
    await run(Deferred.await(f.scrubbed));
    assert.notEqual(f.integrationOwnerScope, scope);
    await run(
      Scope.addFinalizer(
        f.integrationOwnerScope,
        Effect.gen(function* () {
          assert.equal(f.integrationOwnerScope.state._tag, "Closed");
          yield* f.integrationService.reload();
          assert.equal(count(f, "publish.construct"), 0);
          assert.equal(count(f, "publish.execute"), 0);
        }),
      ),
    );
    await close(scope);
    noExternal(f);
  },
);

test(
  "patched MCP owner closing refuses reconciliation factory before State shutdown finalizer",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired({ patchedLifecycle: true });
    await run(f.mcpService.reload());
    const owner = f.mcpOwnerScope;
    assert.ok(owner);
    assert.notEqual(owner, scope);
    const before = count(f, "reconcile.construct");
    await run(
      Scope.addFinalizer(
        owner,
        Effect.gen(function* () {
          assert.equal(owner.state._tag, "Closed");
          yield* f.mcpService.reload();
          assert.equal(count(f, "reconcile.construct"), before);
        }),
      ),
    );
    await close(scope);
    noExternal(f);
  },
);

test(
  "patched services preserve live metadata notifications and disabled MCP behavior",
  { timeout: 5000 },
  async () => {
    const { f, scope } = await acquired({ patchedLifecycle: true });
    try {
      await run(f.integrationService.reload());
      await run(
        f.mcpService.add("synthetic", {
          type: "local",
          command: ["never-run"],
          disabled: true,
        }),
      );
      assert.deepEqual(
        f.calls
          .filter((row) => row[0] === "publish.execute")
          .map((row) => row[1]),
        ["Integration.Updated", "MCP.StatusChanged"],
      );
      assert.deepEqual(await run(f.mcpService.servers()), [
        {
          name: "synthetic",
          status: { status: "disabled" },
          integrationID: undefined,
        },
      ]);
      assert.equal(count(f, "import.refused"), 0);
      noExternal(f);
    } finally {
      await close(scope);
    }
  },
);

// Revision30: exact original direct Native registrations. No Host, Control,
// recipe transform or application import participates in these added proofs.
const directState = actualState;
const observeEntries = compile(
  `return ${expression("config-qsdy395h.js", "observe2")};`,
  { Effect, Stream },
);
const directWorktreePlugin = expression("config-gk30pdy3.js", "Plugin7");
const directMCPPlugin = expression("config-k1qb6em6.js", "Plugin8");
const directMCPRegister = expression("config-k1qb6em6.js", "register2");
const worktreeClass = expression("config-skwjfd4r.js", "Service17", "class");
const worktreeLayer = expression("config-skwjfd4r.js", "layer");

async function directFixture(kind, options = {}) {
  const calls = [],
    registrations = [];
  const Service64 = Context.Service(`script/direct/${kind}/Config`);
  const Service80 = Context.Service(`script/direct/${kind}/Location`);
  const GlobalService = Context.Service(`script/direct/${kind}/Global`);
  const Service32 = compile(`${mcpClass}; return Service32;`, { Context });
  const Service17 = compile(`${worktreeClass}; return Service17;`, { Context });
  const subscribed = Deferred.makeUnsafe();
  let refreshed = Deferred.makeUnsafe();
  const readBlocked = Deferred.makeUnsafe();
  const queue = await run(Queue.unbounded());
  let entries = options.entries ?? [],
    state,
    service,
    base;
  let reads = 0;
  const scope = await run(Scope.make());
  const config = {
    entries() {
      calls.push(["entries.construct"]);
      return Effect.gen(function* () {
        calls.push(["entries.execute", ++reads]);
        if (options.failRead === reads)
          throw Error("scripted config read failure");
        if (options.blockRead === reads) {
          yield* Deferred.succeed(readBlocked, undefined);
          yield* Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => calls.push(["entries.interrupt"])),
            ),
          );
        }
        return globalThis.structuredClone(entries);
      });
    },
  };
  const event = {
    subscribe() {
      calls.push(["events.construct"]);
      return Stream.unwrap(
        Effect.gen(function* () {
          calls.push(["events.acquire"]);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => calls.push(["events.release"])),
          );
          yield* Deferred.succeed(subscribed, undefined);
          return Stream.fromQueue(queue);
        }),
      );
    },
  };
  const refuse = (name) => () => {
    calls.push(["external.refused", name]);
    throw Error(`external_refused:${name}`);
  };
  const dependency = (name, fields) =>
    new Proxy(Object.freeze(fields), {
      get(target, key) {
        calls.push(["dependency.read", name, String(key)]);
        if (!Object.hasOwn(target, key))
          return refuse(`${name}.${String(key)}`)();
        return target[key];
      },
    });
  const location = dependency("Location", {
    directory: "/scripted/project",
    project: dependency("Location.project", {
      id: "abcdef-project",
      canonical: "/scripted/project",
    }),
  });
  const global = dependency("Global", {
    home: "/scripted/home",
    data: "/scripted/data",
  });
  const inputs = {
    Effect,
    Stream,
    Context,
    Layer,
    path,
    Service64,
    Service80,
    Service32,
    Service17,
    Global: { Service: GlobalService },
    // Pure synthetic brand standin; no actual path validation or file access.
    AbsolutePath2: {
      make: (value) => {
        calls.push(["path.brand", value]);
        return value;
      },
    },
    observe2: observeEntries,
    // Plugin SDK define is an explicit identity standin; SDK startup is untested.
    define: (plugin) => plugin,
    make12: Effect.sync(() => {
      calls.push(["git.strategy.acquire"]);
      return dependency("Git", {
        id: "scripted-git",
        create: refuse("git.create"),
        remove: refuse("git.remove"),
        list: refuse("git.list"),
      });
    }),
    create3: (settings) => {
      state = directState.create3(settings);
      return state;
    },
  };
  try {
    if (kind === "worktree") {
      const layer = compile(`return ${worktreeLayer};`, inputs);
      let context = Context.make(Service80, location);
      context = Context.add(context, GlobalService, global);
      service = Context.get(
        await run(
          Layer.buildWithScope(layer, scope).pipe(Effect.provide(context)),
        ),
        Service17,
      );
    } else {
      base = await acquired();
      service = base.f.mcpService;
      state = base.f.mcpState;
    }
    const native = service;
    service = {
      ...native,
      transform(callback) {
        calls.push(["transform.construct", callback]);
        return Effect.withFiber((fiber) =>
          Effect.gen(function* () {
            const group = yield* directState.CurrentGroup;
            const batch = yield* directState.CurrentBatch;
            const registrationScope = yield* Scope.Scope;
            registrations.push({
              callback,
              fiber,
              group,
              batch,
              scope: registrationScope,
            });
            calls.push(["transform.execute"]);
            // Observation only: same callback, original State and original editor.
            return yield* native.transform(callback);
          }),
        );
      },
      reload() {
        calls.push(["reload.construct"]);
        return native.reload().pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              calls.push(["reload.execute"]);
              yield* Deferred.succeed(refreshed, undefined);
            }),
          ),
        );
      },
    };
    const register2 = compile(`return ${directMCPRegister};`, inputs);
    const plugin = compile(
      `return ${kind === "worktree" ? directWorktreePlugin : directMCPPlugin};`,
      { ...inputs, register2 },
    );
    assert.equal(
      plugin.id,
      kind === "worktree" ? "opencode.config.worktree" : "opencode.config.mcp",
    );
    let context = Context.make(Service64, config);
    context = Context.add(
      context,
      kind === "worktree" ? Service17 : Service32,
      service,
    );
    context = Context.add(context, Service80, location);
    context = Context.add(context, GlobalService, global);
    const ctx = new Proxy(
      { event },
      {
        get(target, key) {
          assert.equal(
            key,
            "event",
            "original plugin must not request any Host decorator",
          );
          return target[key];
        },
      },
    );
    const activation = plugin
      .effect(ctx)
      .pipe(Effect.provide(context), Scope.provide(scope));
    return {
      calls,
      registrations,
      scope,
      state,
      service,
      base,
      activation,
      subscribed,
      readBlocked,
      get refreshed() {
        return refreshed;
      },
      prepareRefresh() {
        refreshed = Deferred.makeUnsafe();
      },
      setEntries(value) {
        entries = value;
      },
      emit(type = "config.updated") {
        return Queue.offer(queue, { type });
      },
      async close() {
        try {
          await close(scope);
        } finally {
          if (base) await close(base.scope);
        }
      },
      noExternal() {
        assert.deepEqual(
          calls.filter((row) => row[0] === "external.refused"),
          [],
        );
        if (base) noExternal(base.f);
      },
    };
  } catch (error) {
    await close(scope);
    if (base) await close(base.scope);
    throw error;
  }
}
const directCount = (f, name) =>
  f.calls.filter((row) => row[0] === name).length;
const document = (info) => ({ type: "document", info });

for (const kind of ["worktree", "mcp"]) {
  test(
    `original Config ${kind}: direct native registration, setup order, actual editor replay and disposal`,
    { timeout: 5000 },
    async () => {
      const first =
        kind === "worktree"
          ? [
              { type: "ignored", info: { worktree: { directory: "never" } } },
              document({}),
              document({ worktree: { directory: "relative" } }),
              document({ worktree: { directory: "~/final" } }),
            ]
          : [
              {
                type: "ignored",
                info: {
                  mcp: {
                    servers: { ignored: { type: "local", command: ["never"] } },
                  },
                },
              },
              document({
                mcp: {
                  timeout: { request: 1, connect: 2 },
                  servers: {
                    shared: {
                      type: "local",
                      command: ["never"],
                      disabled: true,
                    },
                  },
                },
              }),
              document({
                mcp: {
                  timeout: { request: 3 },
                  servers: {
                    shared: {
                      type: "remote",
                      url: "https://never.invalid",
                      oauth: false,
                      disabled: true,
                      timeout: { request: 4 },
                    },
                  },
                },
              }),
            ];
      const f = await directFixture(kind, { entries: first });
      let activationFiber;
      try {
        await run(
          Effect.withFiber((fiber) => {
            activationFiber = fiber;
            return f.activation;
          }),
        );
        await run(Deferred.await(f.subscribed));
        assert.equal(f.registrations.length, 1);
        assert.equal(f.registrations[0].fiber, activationFiber);
        assert.equal(f.registrations[0].scope, f.scope);
        assert.equal(f.registrations[0].group, undefined);
        const names = f.calls.map((row) => row[0]);
        const registration = names.indexOf("transform.execute");
        assert.ok(names.indexOf("events.acquire") < registration);
        assert.equal(
          names
            .slice(0, registration)
            .filter((name) => name === "entries.execute").length,
          kind === "worktree" ? 2 : 1,
        );
        assert.equal(
          directCount(f, "entries.construct"),
          kind === "worktree" ? 3 : 1,
        );
        if (kind === "worktree") {
          assert.equal(directCount(f, "git.strategy.acquire"), 1);
          assert.equal(f.state.get().directory, "/scripted/home/final");
          assert.deepEqual(
            [...f.state.get().strategies.keys()],
            ["scripted-git"],
          );
          assert.equal(f.state.get().selected, "scripted-git");
        } else {
          assert.deepEqual(
            [...f.state.get().servers],
            [
              [
                "shared",
                {
                  type: "remote",
                  url: "https://never.invalid",
                  oauth: false,
                  disabled: true,
                  timeout: { request: 4, connect: 2 },
                },
              ],
            ],
          );
          assert.deepEqual(await run(f.base.f.mcpService.servers()), [
            {
              name: "shared",
              status: { status: "disabled" },
              integrationID: undefined,
            },
          ]);
          // A later native transform overrides config defaults during replay.
          const higher = await run(
            f.state
              .transform((editor) =>
                editor.set("shared", {
                  type: "local",
                  command: ["override"],
                  disabled: true,
                }),
              )
              .pipe(Scope.provide(f.scope)),
          );
          await run(f.service.reload());
          assert.deepEqual(f.state.get().servers.get("shared").command, [
            "override",
          ]);
          await run(higher.dispose);
        }
        const changed =
          kind === "worktree"
            ? [document({ worktree: { directory: "updated" } })]
            : [
                document({
                  mcp: {
                    servers: {
                      new: {
                        type: "local",
                        command: ["never"],
                        disabled: true,
                      },
                    },
                  },
                }),
              ];
        f.setEntries(changed);
        f.prepareRefresh();
        const before = directCount(f, "entries.execute");
        // A non-config event is filtered; the next config event is the barrier.
        await run(f.emit("other.updated"));
        await run(f.emit());
        await run(Deferred.await(f.refreshed));
        assert.equal(directCount(f, "entries.execute"), before + 1);
        if (kind === "worktree")
          assert.equal(f.state.get().directory, "/scripted/project/updated");
        else assert.deepEqual([...f.state.get().servers.keys()], ["new"]);
        assert.equal(
          f.registrations.length,
          1,
          "updates replay the same original callback without re-registration",
        );
      } finally {
        await f.close();
      }
      assert.equal(directCount(f, "events.release"), 1);
      if (kind === "worktree")
        assert.equal(f.state.get().directory, "/scripted/data/worktree/abcdef");
      else assert.deepEqual([...f.state.get().servers], []);
      const reads = directCount(f, "entries.execute");
      await run(f.emit());
      await run(Effect.yieldNow);
      assert.equal(directCount(f, "entries.execute"), reads);
      f.noExternal();
    },
  );

  test(
    `original Config ${kind}: failed initial read precedes transform; acquired subscription is scoped`,
    { timeout: 5000 },
    async () => {
      const f = await directFixture(kind, { failRead: 1 });
      try {
        await assert.rejects(run(f.activation), /scripted config read failure/);
        assert.equal(f.registrations.length, 0);
        assert.equal(
          directCount(f, "events.acquire"),
          kind === "worktree" ? 0 : 1,
        );
      } finally {
        await f.close();
      }
      assert.equal(
        directCount(f, "events.release"),
        kind === "worktree" ? 0 : 1,
      );
      f.noExternal();
    },
  );

  test(
    `original Config ${kind}: owner close interrupts blocked event refresh and disposes transform`,
    { timeout: 5000 },
    async () => {
      const f = await directFixture(kind, {
        blockRead: kind === "worktree" ? 3 : 2,
      });
      try {
        await run(f.activation);
        await run(f.emit());
        await run(Deferred.await(f.readBlocked));
        assert.equal(f.registrations.length, 1);
      } finally {
        await f.close();
      }
      assert.equal(directCount(f, "entries.interrupt"), 1);
      assert.equal(directCount(f, "events.release"), 1);
      assert.equal(directCount(f, "reload.execute"), 0);
      f.noExternal();
    },
  );
}

// This uses the actual native State functions, not an authority API. Scope and
// Context propagation in the real Effect runtime is observable, not a grant.
test(
  "original State: activation Fiber, inherited sibling group and ungrouped late callback differ",
  { timeout: 5000 },
  async () => {
    const f = await directFixture("worktree", {
      entries: [document({ worktree: { directory: "original" } })],
    });
    const reports = [];
    let owner, sibling, inheritedGroup;
    try {
      await run(
        directState.group2((failure, notification) =>
          reports.push({ failure, notification }),
        )(
          Effect.withFiber((fiber) =>
            Effect.gen(function* () {
              owner = fiber;
              inheritedGroup = yield* directState.CurrentGroup;
              yield* f.activation;
              const child = yield* Effect.forkIn(f.scope)(
                f.service
                  .transform((editor) =>
                    editor.configure({ directory: "/scripted/sibling" }),
                  )
                  .pipe(Scope.provide(f.scope)),
              );
              sibling = child;
              yield* Fiber.join(child);
            }),
          ),
        ),
      );
      assert.equal(f.registrations[0].fiber, owner);
      assert.equal(f.registrations[1].fiber, sibling);
      assert.notEqual(owner, sibling);
      assert.equal(f.registrations[0].group, inheritedGroup);
      assert.equal(f.registrations[1].group, inheritedGroup);
      assert.equal(inheritedGroup.registrations.size, 2);
      assert.equal(f.state.get().directory, "/scripted/sibling");
      // Fresh Fiber after activation; original State accepts a late registration
      // with the same Scope but no group and no remembered activation identity.
      await run(
        f.service
          .transform((editor) =>
            editor.configure({ directory: "/scripted/late" }),
          )
          .pipe(Scope.provide(f.scope)),
      );
      assert.equal(f.registrations[2].group, undefined);
      assert.ok(
        f.registrations.every((registration) => registration.scope === f.scope),
      );
      assert.notEqual(f.registrations[2].fiber, owner);
      assert.equal(f.state.get().directory, "/scripted/late");
      await run(
        f.state
          .transform(() => {
            throw Error("scripted replay failure");
          })
          .pipe(
            Effect.provideService(directState.CurrentGroup, inheritedGroup),
            Scope.provide(f.scope),
          ),
      );
      assert.equal(inheritedGroup.failed, true);
      assert.equal(inheritedGroup.registrations.size, 0);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].failure.state, "worktree");
      assert.match(reports[0].failure.cause.message, /scripted replay failure/);
      await run(reports[0].notification);
      assert.equal(
        f.state.get().directory,
        "/scripted/late",
        "ungrouped late callback survives captured group disable",
      );
    } finally {
      await f.close();
    }
    assert.equal(f.state.get().directory, "/scripted/data/worktree/abcdef");
    f.noExternal();
  },
);

test(
  "original State: actual batch inheritance, detached late batch and shutdown suppress final notifications",
  { timeout: 5000 },
  async () => {
    const scope = await run(Scope.make());
    const notifications = [];
    const state = directState.create3({
      name: "scripted-counter",
      initial: () => ({ count: 0 }),
      editor: (value) => value,
      notify: (value) => Effect.sync(() => notifications.push(value.count)),
    });
    let inherit, batch;
    try {
      await run(
        directState
          .batch2(
            Effect.gen(function* () {
              batch = yield* directState.CurrentBatch;
              inherit = yield* directState.inherit2();
              yield* state.transform((value) => value.count++);
              const child = yield* Effect.forkIn(scope)(
                inherit(state.transform((value) => value.count++)),
              );
              yield* Fiber.join(child);
              assert.equal(state.get().count, 2);
              assert.deepEqual(notifications, []);
            }),
          )
          .pipe(Scope.provide(scope)),
      );
      assert.equal(batch.active, false);
      assert.deepEqual(notifications, [2]);
      await run(inherit(state.reload()));
      assert.deepEqual(
        notifications,
        [2, 2],
        "inactive captured batch does not defer a late reload",
      );
      await run(directState.shutdown2(Scope.close(scope, Exit.void)));
      assert.deepEqual(notifications, [2, 2]);
      const revision = state.revision();
      await run(state.reload());
      assert.equal(state.revision(), revision);
      assert.equal(
        state.get().count,
        2,
        "shutdown retains last snapshot while removing registrations",
      );
    } finally {
      await close(scope);
    }
  },
);

test("direct Native proof limits: original expressions and explicit scripted setup dependencies", (t) => {
  for (const name of [
    "config-gk30pdy3.js",
    "config-k1qb6em6.js",
    "config-qsdy395h.js",
    "config-skwjfd4r.js",
    stateName,
  ]) {
    assert.equal(sha(originals[name]), pins[name]);
    for (const row of evidence.filter((row) => row.name === name))
      t.diagnostic(
        `${name}:${row.line}-${row.end} ${row.identity} sha256=${pins[name]}`,
      );
  }
  t.diagnostic(
    "Exact original Plugin7/Plugin8/register2/observe2 and Worktree Layer/editor; original State group/batch/inherit/transform/replay/disposal/shutdown. No substitutions in these expressions. Existing actual MCP Layer uses only its separately declared reversible import refusals. Config.entries, event stream/Bus, Location/Global service tags and values, define identity, AbsolutePath brand and Git strategy acquisition are explicit synthetic standins. Sibling/late/failure counter callbacks are scripted State probes. MCP reconciliation and notification use original code with existing scripted Bus. No actual Config loader, Git strategy, Host decorator, Native/core import or physical operation; no positive inventory/runtime/compiler/task authority. Original State captures Scope/group/batch, not a trusted activation-Fiber identity.",
  );
});

for (const server of [
  { type: "local", command: ["never-run"] },
  { type: "remote", url: "https://never.invalid/mcp" },
])
  test(
    `original Config MCP enabled ${server.type}: metadata registration reaches original startup import refusal`,
    { timeout: 5000 },
    async () => {
      const f = await directFixture("mcp", {
        entries: [document({ mcp: { servers: { enabled: server } } })],
      });
      try {
        await run(f.activation);
        const expected =
          server.type === "local" ? "../mcp/client.js" : "../mcp/oauth.js";
        assert.equal(await f.base.f.boundary, expected);
        assert.equal(f.registrations.length, 1);
        assert.deepEqual(
          f.base.f.calls.filter((row) => row[0] === "import.refused"),
          [["import.refused", expected]],
        );
        assert.deepEqual(
          f.base.f.calls
            .filter((row) => row[0] === "refused")
            .map((row) => row[1]),
          [`dynamic-import:${expected}`],
        );
        assert.deepEqual(
          (await run(f.base.f.mcpService.servers())).map((row) => row.status),
          [{ status: "pending" }],
        );
      } finally {
        await f.close();
      }
      assert.equal(directCount(f, "events.release"), 1);
      assert.deepEqual([...f.state.get().servers], []);
      assert.deepEqual(
        f.calls.filter((row) => row[0] === "external.refused"),
        [],
      );
    },
  );

test(
  "original entry observer: failure in second setup read leaves subscription for Scope cleanup, without registration",
  { timeout: 5000 },
  async () => {
    const f = await directFixture("worktree", { failRead: 2 });
    try {
      await assert.rejects(run(f.activation), /scripted config read failure/);
      assert.equal(f.registrations.length, 0);
      assert.equal(directCount(f, "events.acquire"), 1);
      assert.equal(directCount(f, "events.release"), 0);
    } finally {
      await f.close();
    }
    assert.equal(directCount(f, "events.release"), 1);
    f.noExternal();
  },
);

test(
  "original direct Worktree State: Closed Scope before LIFO disposal still permits actual callback replay",
  { timeout: 5000 },
  async () => {
    const f = await directFixture("worktree", {
      entries: [document({ worktree: { directory: "during-close" } })],
    });
    let observed = false;
    try {
      await run(f.activation);
      await run(
        Scope.addFinalizer(
          f.scope,
          Effect.sync(() => {
            assert.equal(f.scope.state._tag, "Closed");
            const brands = directCount(f, "path.brand");
            f.state.invalidate();
            assert.equal(
              f.state.get().directory,
              "/scripted/project/during-close",
            );
            assert.equal(
              directCount(f, "path.brand"),
              brands + 2,
              "original initial factory and ConfigWorktree callback both ran after Scope became Closed",
            );
            observed = true;
          }),
        ),
      );
    } finally {
      await f.close();
    }
    assert.equal(observed, true);
    assert.equal(f.state.get().directory, "/scripted/data/worktree/abcdef");
    assert.equal(directCount(f, "events.release"), 1);
    f.noExternal();
  },
);

test(
  "original Config MCP callback preserves a preceding native server via actual editor.get",
  { timeout: 5000 },
  async () => {
    const f = await directFixture("mcp", {
      entries: [
        document({
          mcp: {
            servers: {
              shared: {
                type: "local",
                command: ["config-default"],
                disabled: true,
              },
            },
          },
        }),
      ],
    });
    try {
      await run(
        f.state
          .transform((editor) =>
            editor.set("shared", {
              type: "local",
              command: ["preceding-native"],
              disabled: true,
            }),
          )
          .pipe(Scope.provide(f.scope)),
      );
      await run(f.activation);
      assert.equal(f.registrations.length, 1);
      assert.deepEqual(f.state.get().servers.get("shared").command, [
        "preceding-native",
      ]);
      await run(f.service.reload());
      assert.deepEqual(f.state.get().servers.get("shared").command, [
        "preceding-native",
      ]);
    } finally {
      await f.close();
    }
    f.noExternal();
  },
);

// Revision31: Config.entries above is a cached-entry standin, NOT evidence of
// actual Config layer isolation. This separate proof executes discover3 only.
const discoveryFile = "config-gh5tebn4.js";
const discoveryOriginal = expression(discoveryFile, "discover3");
const discoveryNames = compile(
  `return ${expression(discoveryFile, "names3")};`,
  {},
);
function discoveryFixture({ patched = false, forbid = false, omit } = {}) {
  const calls = [];
  const FSService = Context.Service("script/discovery/FS");
  const GlobalService = Context.Service("script/discovery/Global");
  const Service80 = Context.Service("script/discovery/Location");
  const directory = "/scripted/project/nested";
  const operation =
    (name, implementation) =>
    (...args) => {
      calls.push([`${name}.construct`, ...args]);
      if (forbid) throw Error(`external_refused:${name}:${String(args[0])}`);
      return Effect.sync(() => {
        calls.push([`${name}.execute`, ...args]);
        return implementation(...args);
      });
    };
  const fs = {
    resolve: operation("FS.resolve", (item) => path.resolve(item)),
    up: operation("FS.up", (input) => {
      assert.deepEqual(input, { targets: ["."], start: directory });
      return [directory, "/scripted/project"];
    }),
    isDir: operation("FS.isDir", (item) => {
      assert.ok(
        [directory + "/.opencode", "/scripted/project/.opencode"].includes(
          item,
        ),
      );
      return item === "/scripted/project/.opencode";
    }),
  };
  const selected = patched
    ? lifecycleExpression(discoveryFile, "discover3")
    : discoveryOriginal;
  const discover = compile(`return ${selected};`, {
    Effect,
    path,
    names3: discoveryNames,
    Service80,
    FSUtil: { Service: FSService },
    Global: { Service: GlobalService },
    AbsolutePath2: {
      make: (value) => {
        calls.push(["path.brand", value]);
        return value;
      },
    },
  });
  let context = Context.empty();
  for (const [name, tag, value] of [
    ["FS", FSService, fs],
    [
      "Global",
      GlobalService,
      { config: "/scripted/config", home: "/scripted/home" },
    ],
    ["Location", Service80, { directory }],
  ])
    if (name !== omit) context = Context.add(context, tag, value);
  return {
    calls,
    selected,
    discover: (options) => discover(options).pipe(Effect.provide(context)),
  };
}
const emptyDiscovery = {
  global: undefined,
  explicit: undefined,
  direct: [],
  project: [],
  claude: [],
  agents: [],
};
const discoveryResolves = [
  "/scripted/config",
  "/scripted/home/.claude",
  "/scripted/home/.agents",
  "/scripted/project/nested",
  "/scripted/config/opencode.json",
  "/scripted/config/opencode.jsonc",
];

test("original ConfigDiscovery fixed flags: six scripted resolves despite empty result; first external canary refuses", async (t) => {
  const options = { project: false, global: false };
  const f = discoveryFixture();
  assert.deepEqual(await run(f.discover(options)), emptyDiscovery);
  assert.deepEqual(
    f.calls
      .filter((row) => row[0] === "FS.resolve.execute")
      .map((row) => row[1]),
    discoveryResolves,
  );
  assert.equal(
    f.calls.filter(
      (row) => row[0] === "FS.up.construct" || row[0] === "FS.isDir.construct",
    ).length,
    0,
  );
  const canary = discoveryFixture({ forbid: true });
  await assert.rejects(
    run(canary.discover(options)),
    /external_refused:FS.resolve:\/scripted\/config/,
  );
  assert.deepEqual(
    canary.calls.filter((row) => row[0].startsWith("FS.")),
    [["FS.resolve.construct", "/scripted/config"]],
  );
  t.diagnostic(
    `original ${discoveryFile} sha256=${pins[discoveryFile]}; exact original fixed-flags resolve paths=${JSON.stringify(discoveryResolves)}; FS/Global/Location/AbsolutePath are scripted, real Effect only; not Config layer acquisition evidence`,
  );
});

test("recipe ConfigDiscovery fixed flags: successful empty result before any FS or path factory", async (t) => {
  const f = discoveryFixture({ patched: true, forbid: true });
  t.after(() =>
    t.diagnostic(`observed setup calls=${JSON.stringify(f.calls)}`),
  );
  for (const options of [
    { project: false, global: false },
    { project: false, global: false, file: undefined },
  ]) {
    assert.deepEqual(await run(f.discover(options)), emptyDiscovery);
    assert.deepEqual(
      f.calls,
      [],
      "no FS method or path brand may be constructed",
    );
  }
  // The one source change must leave the three captures and every other
  // original statement byte-identical; selection and recipe hashes are checked
  // by the existing compiler/lifecycle helper before expression evaluation.
  const statements = (text) => {
    const source = ts.createSourceFile(
      "discover.js",
      `const value = ${text}`,
      ts.ScriptTarget.Latest,
      true,
    );
    assert.equal(source.parseDiagnostics.length, 0);
    const body =
      source.statements[0].declarationList.declarations[0].initializer
        .arguments[0].body;
    return body.statements.map((node) => node.getText(source));
  };
  const before = statements(discoveryOriginal),
    after = statements(f.selected);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  assert.deepEqual(after.slice(4), before.slice(3));
});

for (const patched of [false, true])
  test(`${patched ? "recipe" : "original"} ConfigDiscovery other flags and explicit file retain original branch results and calls`, async () => {
    for (const options of [
      undefined,
      {},
      { project: true, global: true },
      { project: true, global: false },
      { project: false, global: true },
      { global: false },
      { project: false },
      { project: false, global: false, file: "/scripted/explicit.json" },
      { project: false, global: false, file: "" },
      { project: false, global: false, file: null },
      { project: false, global: false, file: false },
      { project: false, global: false, file: 0 },
      ...[null, 0, ""].flatMap((value) => [
        { project: value, global: false },
        { project: false, global: value },
      ]),
      { project: true, global: false, file: "/scripted/explicit.json" },
    ]) {
      const f = discoveryFixture({ patched });
      const result = await run(f.discover(options));
      const project = options?.project !== false,
        global = options?.global !== false;
      const parents = ["/scripted/project", "/scripted/project/nested"];
      assert.deepEqual(result, {
        global: global ? "/scripted/config" : undefined,
        explicit: options?.file ? "/scripted/explicit.json" : undefined,
        direct: project
          ? parents.flatMap((base) =>
              discoveryNames.map((name) => base + "/" + name),
            )
          : [],
        project: project
          ? parents.map((base) => ({
              path: base + "/.opencode",
              present: base === "/scripted/project",
            }))
          : [],
        claude: [
          ...(global ? ["/scripted/home/.claude"] : []),
          ...(project ? parents.map((base) => base + "/.claude") : []),
        ],
        agents: [
          ...(global ? ["/scripted/home/.agents"] : []),
          ...(project ? parents.map((base) => base + "/.agents") : []),
        ],
      });
      assert.equal(
        f.calls.filter((row) => row[0] === "FS.resolve.execute").length,
        project ? 18 : 6,
      );
      assert.equal(
        f.calls.filter((row) => row[0] === "FS.up.execute").length,
        project ? 1 : 0,
      );
      assert.equal(
        f.calls.filter((row) => row[0] === "FS.isDir.execute").length,
        project ? 2 : 0,
      );
      const baseline = discoveryFixture();
      assert.deepEqual(await run(baseline.discover(options)), result);
      assert.deepEqual(
        f.calls,
        baseline.calls,
        "all other branches retain the complete original scripted call trace",
      );
    }
  });

test("recipe ConfigDiscovery empty-source guard retains all three required service captures", async () => {
  for (const omit of ["FS", "Global", "Location"]) {
    const f = discoveryFixture({ patched: true, forbid: true, omit });
    await assert.rejects(
      run(f.discover({ project: false, global: false })),
      /Service not found/,
    );
    assert.deepEqual(
      f.calls,
      [],
      `${omit} must be captured before the guard returns`,
    );
  }
});

// Revision33: constructor-only closure. Original module import graphs, schemas,
// JSONC semantics and native binding loaders remain explicitly outside proof.
const constructorPins = {
  "config-9b1g8vzp.js":
    "28b29cab6feed7de88d6f0828be712d0f37bcbb6d501584f1db1d07e93ce2966",
  "config-j56e64zr.js":
    "ac9ba0f05604dda5e3438a64e2c73413f0c42ac6686b3dad3258551b7342fa44",
  "config-954548m7.js":
    "0c9b9f1c5b81af3f06baf706ea431cfe81500f3ce42df9f2fa30cd0ce773259d",
  "config-b7j7903f.js":
    "27115008f705bb7c797fed072d5ea4b6bfadea519cb995861c3ad377fa3506d6",
  "config-ersz45vm.js":
    "009c2290d49d245552fd27e98d6cc6aa9580c073373156c66e7cf57f021bc4ef",
};
for (const [name, hash] of Object.entries(constructorPins)) {
  pins[name] = hash;
  originals[name] = await pinned(chunks + name, hash);
}
const { FiberMap, Option, PubSub, RcMap } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const constructorSelections = [
  select("config-9b1g8vzp.js", "layer21"),
  select("config-j56e64zr.js", "plan2", "function"),
  select("config-954548m7.js", "layer22"),
  select("config-b7j7903f.js", "layer"),
  select("config-ersz45vm.js", "make12"),
];
function constructorExpression(name, identity) {
  const row = constructorSelections.find(
    (row) => row.name === name && row.identity === identity,
  );
  assert.ok(row);
  return row.text;
}
function constructorCanary(calls, name) {
  return (...args) => {
    calls.push([name, ...args]);
    throw Error(`constructor_external_refused:${name}`);
  };
}
const constructorPlan = compile(
  `${constructorExpression("config-j56e64zr.js", "plan2")}\nreturn plan2;`,
  {
    JSON,
    path,
    FSUtil: {
      contains: (directory, file) =>
        file === directory || file.startsWith(directory + "/"),
    },
  },
);
const fixedConstructorContent = JSON.stringify({
  worktree: { directory: "/synthetic/app/worktrees" },
});

async function configConstructorFixture({
  originalDiscovery = false,
  blockWellknown = false,
} = {}) {
  const calls = [];
  const tags = Object.fromEntries(
    [
      "FS",
      "Global",
      "Service64",
      "Service80",
      "Service65",
      "Service83",
      "Service73",
      "Service66",
    ].map((name) => [name, Context.Service(`script/constructor/${name}`)]),
  );
  const forbidden = (name) => constructorCanary(calls, name);
  const fs = Object.fromEntries(
    [
      "resolve",
      "up",
      "isDir",
      "isFile",
      "readFileStringSafe",
      "writeWithDirs",
    ].map((name) => [name, forbidden(`FS.${name}`)]),
  );
  originalDiscovery ||= process.env.CONFIG_CONSTRUCTOR_ORIGINAL_RED === "1";
  const discover3 = compile(
    `return ${originalDiscovery ? discoveryOriginal : lifecycleExpression(discoveryFile, "discover3")};`,
    {
      Effect,
      path,
      names3: discoveryNames,
      Service80: tags.Service80,
      FSUtil: { Service: tags.FS },
      Global: { Service: tags.Global },
      AbsolutePath2: {
        make: (value) => {
          calls.push(["discovery.path.brand", value]);
          return value;
        },
      },
    },
  );
  const blocked = Deferred.makeUnsafe();
  const entered = Deferred.makeUnsafe();
  const events = [
    Object.freeze({ kind: "credential.switched" }),
    Object.freeze({ kind: "wellknown.updated" }),
  ];
  const bus = {
    subscribe(event) {
      assert.ok(events.includes(event));
      calls.push(["bus.subscribe.construct", event.kind]);
      return Stream.unwrap(
        Effect.acquireRelease(
          Effect.sync(() => {
            calls.push(["bus.subscribe.acquire", event.kind]);
            return Stream.never;
          }),
          () =>
            Effect.sync(() =>
              calls.push(["bus.subscribe.release", event.kind]),
            ),
        ),
      );
    },
    publish: forbidden("bus.publish"),
  };
  const wellknown = {
    entries: () => {
      calls.push(["wellknown.entries.construct"]);
      return Effect.gen(function* () {
        calls.push(["wellknown.entries.execute"]);
        yield* Deferred.succeed(entered, undefined);
        if (blockWellknown) yield* Deferred.await(blocked);
        return [];
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => calls.push(["wellknown.entries.interrupt"])),
        ),
      );
    },
    snapshot: () => {
      calls.push(["wellknown.snapshot"]);
      return [];
    },
    resolve: forbidden("wellknown.resolve"),
    refresh: forbidden("wellknown.refresh"),
  };
  // Deliberately bounded JSON/schema/normalizer/substitution standins. They do
  // not prove JSONC parsing, schema decoding or original import acquisition.
  const parse = (text, errors, options) => {
    assert.equal(text, fixedConstructorContent);
    assert.deepEqual(errors, []);
    assert.deepEqual(options, { allowTrailingComma: true });
    calls.push(["parser.parse"]);
    return JSON.parse(text);
  };
  const normalize2 = (input) => {
    assert.deepEqual(input, JSON.parse(fixedConstructorContent));
    calls.push(["normalizer.normalize"]);
    return { type: "accepted", encoded: input, diagnostics: [] };
  };
  const Info = Object.freeze({ standin: "Info" });
  const Schema = {
    decodeUnknownOption: (schema, options) => {
      assert.equal(schema, Info);
      assert.deepEqual(options, {
        errors: "all",
        onExcessProperty: "ignore",
        propertyOrder: "original",
      });
      calls.push(["schema.decoder.construct"]);
      return (input) => {
        calls.push(["schema.decode"]);
        return Option.some(input);
      };
    },
  };
  class Document {
    constructor(input) {
      assert.deepEqual(input, {
        type: "document",
        info: JSON.parse(fixedConstructorContent),
      });
      Object.assign(this, input);
      calls.push(["document.construct"]);
    }
  }
  const layer21 = compile(
    `return ${constructorExpression("config-9b1g8vzp.js", "layer21")};`,
    {
      ...tags,
      JSON,
      Effect,
      Layer,
      Semaphore,
      FiberMap,
      PubSub,
      Schema,
      Info,
      Option,
      Stream,
      path,
      isDeepStrictEqual,
      FSUtil: { Service: tags.FS, FileSystemError: class extends Error {} },
      Global: { Service: tags.Global },
      names3: discoveryNames,
      discover3,
      plan2: constructorPlan,
      parse,
      normalize2,
      Document,
      Directory: class {
        constructor() {
          forbidden("directory.construct")();
        }
      },
      AbsolutePath2: { make: forbidden("config.path.brand") },
      substitute2: (input) => {
        assert.deepEqual(input, {
          type: "virtual",
          source: "OPENCODE_CONFIG_CONTENT",
          dir: "/synthetic/project",
          text: fixedConstructorContent,
        });
        calls.push(["substitute.construct"]);
        return Effect.sync(() => {
          calls.push(["substitute.execute"]);
          return input.text;
        });
      },
      applyEdits: forbidden("jsonc.applyEdits"),
      modify: forbidden("jsonc.modify"),
      Event: { Updated: {} },
      Event18: { Switched: events[0] },
      Event13: { Updated: events[1] },
    },
  );
  let context = Context.empty();
  for (const [tag, value] of [
    [tags.FS, fs],
    [tags.Global, { config: "/synthetic/config", home: "/synthetic/home" }],
    [tags.Service80, { directory: "/synthetic/project" }],
    [tags.Service65, { subscribe: forbidden("watcher.subscribe") }],
    [tags.Service83, bus],
    [tags.Service73, { list: forbidden("credentials.list") }],
    [tags.Service66, wellknown],
  ])
    context = Context.add(context, tag, value);
  const scope = await run(Scope.make());
  const layer = layer21({
    project: false,
    global: false,
    content: fixedConstructorContent,
  });
  return {
    calls,
    scope,
    entered,
    blocked,
    layer,
    tags,
    context,
    acquire: Layer.buildWithScope(layer, scope).pipe(Effect.provide(context)),
  };
}
function constructorNoExternal(calls) {
  assert.deepEqual(
    calls.filter(([name]) =>
      /^(FS\.|process\.|native\.|database\.|watcher\.|credentials\.|wellknown\.(resolve|refresh)|jsonc\.)/.test(
        name,
      ),
    ),
    [],
  );
}

test("constructor Config original discovery RED: fixed Graph flags reach FS.resolve before cached entries", async () => {
  const f = await configConstructorFixture({ originalDiscovery: true });
  try {
    const exit = await run(Effect.exit(f.acquire));
    assert.ok(Exit.isFailure(exit));
    assert.match(
      Cause.pretty(exit.cause),
      /constructor_external_refused:FS.resolve/,
    );
    assert.equal(f.calls.filter(([name]) => name === "FS.resolve").length, 1);
    assert.equal(
      f.calls.some(([name]) => name === "substitute.construct"),
      false,
    );
    assert.equal(
      f.calls.some(([name]) => name === "bus.subscribe.acquire"),
      false,
    );
  } finally {
    await close(f.scope);
  }
});

test("constructor Config patched discovery GREEN: original layer loads fixed content before cached reads; scoped bus cleanup", async () => {
  const f = await configConstructorFixture();
  try {
    assert.deepEqual(f.calls, []); // Layer construction itself is lazy.
    const service = Context.get(await run(f.acquire), f.tags.Service64);
    const first = await run(service.entries());
    assert.deepEqual(
      first.map((entry) => ({ ...entry })),
      [{ type: "document", info: JSON.parse(fixedConstructorContent) }],
    );
    const loadedCalls = f.calls.slice();
    assert.equal(await run(service.entries()), first);
    assert.deepEqual(f.calls, loadedCalls); // Cache only after actual load.
    assert.equal(f.calls.filter(([name]) => name === "parser.parse").length, 1);
    assert.equal(
      f.calls.filter(([name]) => name === "wellknown.entries.execute").length,
      1,
    );
    assert.equal(
      f.calls.filter(([name]) => name === "bus.subscribe.acquire").length,
      2,
    );
    assert.deepEqual(await run(service.compatibility()), {
      claude: [],
      agents: [],
    });
    // Constructing an update Effect is lazy; executing it reaches the FS fence.
    const update = service.update({ shell: "scripted" });
    constructorNoExternal(f.calls);
    const updateExit = await run(Effect.exit(update));
    assert.ok(Exit.isFailure(updateExit));
    assert.match(
      Cause.pretty(updateExit.cause),
      /constructor_external_refused:config.path.brand/,
    );
  } finally {
    await close(f.scope);
  }
  assert.equal(
    f.calls.filter(([name]) => name === "bus.subscribe.release").length,
    2,
  );
  constructorNoExternal(f.calls);
});

test("constructor Config blocked inert WellKnown read is interrupted; no cache or subscriptions published", async () => {
  const f = await configConstructorFixture({ blockWellknown: true });
  const caller = await run(Scope.make());
  try {
    const fiber = await run(f.acquire.pipe(Effect.forkIn(caller)));
    await run(Deferred.await(f.entered));
    await run(Fiber.interrupt(fiber));
    assert.equal(
      f.calls.filter(([name]) => name === "wellknown.entries.interrupt").length,
      1,
    );
    assert.equal(
      f.calls.some(([name]) => name === "bus.subscribe.acquire"),
      false,
    );
    constructorNoExternal(f.calls);
  } finally {
    await close(caller);
    await close(f.scope);
  }
});

test("constructor Watch plan: fixed empty sources create zero targets; nonempty branch keeps directory and parent entries", () => {
  assert.deepEqual([...constructorPlan(emptyDiscovery)], []);
  const plan = [
    ...constructorPlan({
      global: "/synthetic/config",
      explicit: "/synthetic/out/config.json",
      direct: ["/synthetic/config/opencode.json"],
      project: [
        { path: "/synthetic/project/.opencode", present: true },
        { path: "/synthetic/missing/.opencode", present: false },
      ],
      claude: [],
      agents: [],
    }).values(),
  ];
  assert.deepEqual(plan, [
    {
      path: "/synthetic/config",
      type: "directory",
      ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"],
    },
    {
      path: "/synthetic/project/.opencode",
      type: "directory",
      ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"],
    },
    { path: "/synthetic/project", type: "entries", names: [".opencode"] },
    { path: "/synthetic/missing", type: "entries", names: [".opencode"] },
    { path: "/synthetic/out", type: "entries", names: ["config.json"] },
  ]);
});

async function watcherConstructorFixture({ enabled, refuse = false } = {}) {
  const calls = [];
  const Service65 = Context.Service("script/constructor/watcher");
  const Native3 = Context.Service("script/constructor/watcher-native");
  const ready = Deferred.makeUnsafe();
  const layer22 = compile(
    `return ${constructorExpression("config-954548m7.js", "layer22")};`,
    { Effect, Layer, Service65, Native3, RcMap, PubSub, Stream, path },
  );
  const scope = await run(Scope.make());
  const context = Context.make(Native3, {
    subscribe: (input) => {
      calls.push(["native.subscribe.construct", input]);
      if (refuse) throw Error("constructor_external_refused:native.subscribe");
      return Effect.sync(() => {
        calls.push(["native.subscribe.acquire"]);
        return {
          backend: "scripted",
          unsubscribe: () => {
            calls.push(["native.unsubscribe"]);
            return Promise.resolve();
          },
        };
      });
    },
  });
  const service = Context.get(
    await run(
      Layer.buildWithScope(layer22({ enabled }), scope).pipe(
        Effect.provide(context),
      ),
    ),
    Service65,
  );
  return { calls, scope, service, ready };
}

test("constructor Watcher enabled: Layer and subscribe Effect construction do not start native watch; stream Scope releases subscription", async () => {
  const f = await watcherConstructorFixture();
  const consumer = await run(Scope.make());
  try {
    assert.deepEqual(f.calls, []);
    const subscription = f.service.subscribe(
      {
        type: "entries",
        path: "/synthetic/project",
        names: ["opencode.json", "opencode.json"],
      },
      Deferred.succeed(f.ready, undefined),
    );
    assert.deepEqual(f.calls, []);
    const stream = await run(subscription);
    assert.deepEqual(f.calls, []);
    await run(Stream.runDrain(stream).pipe(Effect.forkIn(consumer)));
    await run(Deferred.await(f.ready));
    assert.equal(
      f.calls.filter(([name]) => name === "native.subscribe.acquire").length,
      1,
    );
    assert.deepEqual(f.calls[0][1].names, ["opencode.json"]);
    await close(consumer);
    await close(f.scope);
    assert.equal(
      f.calls.filter(([name]) => name === "native.unsubscribe").length,
      1,
    );
  } finally {
    await close(consumer);
    await close(f.scope);
  }
});

test("constructor Watcher disabled: stream remains empty without Native service dependency", async () => {
  const Service65 = Context.Service("script/constructor/watcher-disabled");
  const Native3 = Context.Service("script/constructor/missing-native");
  const layer22 = compile(
    `return ${constructorExpression("config-954548m7.js", "layer22")};`,
    { Effect, Layer, Service65, Native3, RcMap, PubSub, Stream, path },
  );
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(layer22({ enabled: false })),
          Service65,
        );
        yield* service
          .subscribe({ type: "directory", path: "/synthetic/project" })
          .pipe(Effect.flatMap(Stream.runDrain));
      }),
    ),
  );
});

test("constructor Watcher stream invocation RED canary: native subscribe is reached only when stream runs", async () => {
  const f = await watcherConstructorFixture({ refuse: true });
  try {
    const stream = await run(
      f.service.subscribe({
        type: "entries",
        path: "/synthetic/project",
        names: [],
      }),
    );
    assert.deepEqual(f.calls, []);
    const exit = await run(Effect.exit(Effect.scoped(Stream.runDrain(stream))));
    assert.ok(Exit.isFailure(exit));
    assert.match(
      Cause.pretty(exit.cause),
      /constructor_external_refused:native.subscribe/,
    );
  } finally {
    await close(f.scope);
  }
});

async function gitConstructorFixture() {
  const calls = [];
  const Service82 = Context.Service("script/constructor/git");
  const FSService = Context.Service("script/constructor/git-fs");
  const ProcessService = Context.Service("script/constructor/git-process");
  const forbidden = (name) => constructorCanary(calls, name);
  const schemaBoundary = (name) =>
    class {
      constructor(...args) {
        forbidden(name)(...args);
      }
    };
  const file = "config-b7j7903f.js";
  const constants = compile(
    ["snapshotConfigFile", "snapshotConfigInclude", "snapshotConfig"]
      .map((name) => `const ${name} = ${select(file, name).text};`)
      .join("\n") +
      "\nreturn { snapshotConfigFile, snapshotConfigInclude, snapshotConfig };",
    {},
  );
  const inputs = {
    Effect,
    Layer,
    path,
    Number,
    RegExp,
    Boolean,
    Service82,
    FSUtil: { Service: FSService, windowsPath: forbidden("FS.windowsPath") },
    AppProcess: { Service: ProcessService },
    makeUnsafe2: mutex,
    ...constants,
    Repository2: schemaBoundary("schema.Repository"),
    OperationError3: schemaBoundary("schema.OperationError"),
    WorktreeError2: schemaBoundary("schema.WorktreeError"),
    Worktree2: schemaBoundary("schema.Worktree"),
    AbsolutePath2: { make: forbidden("schema.AbsolutePath") },
    RelativePath2: { make: forbidden("schema.RelativePath") },
    TreeID2: { make: forbidden("schema.TreeID") },
    ChildProcess: { make: forbidden("process.ChildProcess.make") },
    gitExecutable2: "scripted-git-never-executed",
    MAX_TOTAL_PATCH_BYTES2: 0,
    chunksByFile2: forbidden("patch.chunksByFile"),
    emptyPatch2: forbidden("patch.emptyPatch"),
  };
  const helperNames = ["run", "execute", "nuls", "resolvePath"];
  const originalHelpers = helperNames
    .map((name) => select(file, name, "function").text)
    .join("\n");
  const layer = compile(
    `${originalHelpers}\nreturn ${constructorExpression(file, "layer")};`,
    inputs,
  );
  const fs = Object.fromEntries(
    [
      "up",
      "ensureDir",
      "writeFileString",
      "readFileString",
      "copyFile",
      "stat",
      "remove",
    ].map((name) => [name, forbidden(`FS.${name}`)]),
  );
  let context = Context.make(FSService, fs);
  context = Context.add(context, ProcessService, {
    run: forbidden("process.run"),
  });
  const scope = await run(Scope.make());
  const service = Context.get(
    await run(Layer.buildWithScope(layer, scope).pipe(Effect.provide(context))),
    Service82,
  );
  return {
    calls,
    scope,
    service,
    Service82,
    FSService,
    fs,
    context,
    helperNames,
  };
}

function worktreeConstructor(inputs) {
  return compile(
    `return ${constructorExpression("config-ersz45vm.js", "make12")};`,
    inputs,
  );
}

test("constructor Git original layer: all original method factories are lazy; discovery and history invocation hit IO fences", async () => {
  const f = await gitConstructorFixture();
  try {
    assert.deepEqual(f.calls, []);
    assert.deepEqual(Object.keys(f.service), [
      "repo",
      "remote",
      "history",
      "sync",
      "worktree",
      "index",
      "tree",
    ]);
    const repository = {
      worktree: "/synthetic/project",
      gitDirectory: "/synthetic/project/.git",
      commonDirectory: "/synthetic/project/.git",
    };
    const discover = f.service.repo.discover(repository.worktree);
    const head = f.service.history.head(repository);
    assert.deepEqual(f.calls, []);
    const discoveryExit = await run(Effect.exit(discover));
    assert.ok(Exit.isFailure(discoveryExit));
    assert.match(
      Cause.pretty(discoveryExit.cause),
      /constructor_external_refused:FS.up/,
    );
    const headExit = await run(Effect.exit(head));
    assert.ok(Exit.isFailure(headExit));
    assert.match(
      Cause.pretty(headExit.cause),
      /constructor_external_refused:process.ChildProcess.make/,
    );
    assert.deepEqual(
      f.calls.map(([name]) => name),
      ["FS.up", "process.ChildProcess.make"],
    );
  } finally {
    await close(f.scope);
  }
});

test("constructor WorktreeGit.make12 with original Git: strategy construction is IO-free; create/remove/list Effects are lazy and refuse at discover", async () => {
  const f = await gitConstructorFixture();
  const calls = [];
  try {
    const make12 = worktreeConstructor({
      Effect,
      Service82: f.Service82,
      FSUtil: { Service: f.FSService },
      Worktree: {
        StrategyID: {
          make: (value) => {
            assert.equal(value, "git");
            calls.push(["strategy.brand", value]);
            return value;
          },
        },
      },
      DirectoryUnavailableError2: class extends Error {},
      canonical2: constructorCanary(calls, "FS.canonical"),
    });
    let context = Context.make(f.Service82, f.service);
    context = Context.add(context, f.FSService, f.fs);
    const strategy = await run(make12.pipe(Effect.provide(context)));
    assert.equal(strategy.id, "git");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(calls, [["strategy.brand", "git"]]);
    const operations = [
      strategy.create({
        sourceDirectory: "/synthetic/source",
        directory: "/synthetic/target",
      }),
      strategy.remove({ directory: "/synthetic/target" }),
      strategy.list("/synthetic/target"),
    ];
    assert.deepEqual(f.calls, []);
    for (const effect of operations) {
      const exit = await run(Effect.exit(effect));
      assert.ok(Exit.isFailure(exit));
      assert.match(
        Cause.pretty(exit.cause),
        /constructor_external_refused:FS.up/,
      );
    }
    assert.deepEqual(
      f.calls.map(([name]) => name),
      ["FS.up", "FS.up", "FS.up"],
    );
    assert.deepEqual(calls, [["strategy.brand", "git"]]);
  } finally {
    await close(f.scope);
  }
});

test("constructor WorktreeGit original positive list/remove preserve scripted results; canonical IO remains an explicit method boundary", async () => {
  const calls = [];
  const FSService = Context.Service("script/constructor/strategy-fs");
  const Service82 = Context.Service("script/constructor/strategy-git");
  const repository = { worktree: "/synthetic/source" };
  const make12 = worktreeConstructor({
    Effect,
    Service82,
    FSUtil: { Service: FSService },
    Worktree: { StrategyID: { make: (value) => value } },
    DirectoryUnavailableError2: class extends Error {},
    canonical2: constructorCanary(calls, "FS.canonical"),
  });
  let entries = [];
  const git = {
    repo: {
      discover: (directory) =>
        Effect.sync(() => {
          calls.push(["git.discover", directory]);
          return repository;
        }),
    },
    worktree: {
      list: (input) =>
        Effect.sync(() => {
          assert.equal(input, repository);
          calls.push(["git.list"]);
          return entries;
        }),
      remove: (input) =>
        Effect.sync(() => {
          calls.push(["git.remove", input]);
        }),
      create: constructorCanary(calls, "git.create"),
    },
  };
  const fs = Object.freeze({ standin: "FS-no-methods" });
  const strategy = await run(
    make12.pipe(
      Effect.provide(
        Context.make(Service82, git).pipe(Context.add(FSService, fs)),
      ),
    ),
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(await run(strategy.list("/synthetic/source")), []);
  await run(strategy.remove({ directory: "/synthetic/target", force: false }));
  assert.deepEqual(calls.at(-1), [
    "git.remove",
    { repository, directory: "/synthetic/target", force: false },
  ]);
  entries = [{ directory: "/synthetic/source", kind: "main" }];
  const exit = await run(Effect.exit(strategy.list("/synthetic/source")));
  assert.ok(Exit.isFailure(exit));
  assert.match(
    Cause.pretty(exit.cause),
    /constructor_external_refused:FS.canonical/,
  );
});

test("constructor linked Config → original Worktree Layer → Plugin7 setup: cache follows load, original State replay and scoped observer disposal", async () => {
  const config = await configConstructorFixture();
  const git = await gitConstructorFixture();
  const calls = [];
  const Service17 = compile(`${worktreeClass}; return Service17;`, { Context });
  const global = { data: "/synthetic/data", home: "/synthetic/home" };
  const location = {
    directory: "/synthetic/project",
    project: { id: "abcdef1234", canonical: "/synthetic/project" },
  };
  const AbsolutePath2 = {
    make: (value) => {
      calls.push(["path.brand", value]);
      return value;
    },
  };
  const make12 = worktreeConstructor({
    Effect,
    Service82: git.Service82,
    FSUtil: { Service: git.FSService },
    Worktree: { StrategyID: { make: (value) => value } },
    DirectoryUnavailableError2: class extends Error {},
    canonical2: constructorCanary(calls, "FS.canonical"),
  });
  const worktree = compile(`return ${worktreeLayer};`, {
    Effect,
    Layer,
    Service17,
    Service80: config.tags.Service80,
    Global: { Service: config.tags.Global },
    path,
    AbsolutePath2,
    make12,
    create3: actualState.create3,
  });
  const event = await run(Queue.unbounded());
  try {
    const configContext = await run(config.acquire);
    let context = Context.merge(config.context, configContext);
    context = Context.add(context, git.Service82, git.service);
    context = Context.add(context, git.FSService, git.fs);
    context = Context.add(context, config.tags.Service80, location);
    context = Context.add(context, config.tags.Global, global);
    const worktreeContext = await run(
      Layer.buildWithScope(worktree, config.scope).pipe(
        Effect.provide(context),
      ),
    );
    context = Context.merge(context, worktreeContext);
    const plugin = compile(`return ${directWorktreePlugin};`, {
      Effect,
      Service64: config.tags.Service64,
      Service17,
      Service80: config.tags.Service80,
      Global: { Service: config.tags.Global },
      path,
      AbsolutePath2,
      observe2: observeEntries,
      define: (value) => value,
    });
    assert.equal(plugin.id, "opencode.config.worktree");
    // Scripted event service only. Original observe2 owns its Fiber/Scope.
    const ctx = {
      event: {
        subscribe: () =>
          Stream.unwrap(
            Effect.acquireRelease(
              Effect.sync(() => {
                calls.push(["observer.acquire"]);
                return Stream.fromQueue(event);
              }),
              () => Effect.sync(() => calls.push(["observer.release"])),
            ),
          ),
      },
    };
    await run(
      plugin
        .effect(ctx)
        .pipe(Effect.provide(context), Scope.provide(config.scope)),
    );
    const service = Context.get(worktreeContext, Service17);
    const value = service.get();
    assert.equal(value.directory, "/synthetic/app/worktrees");
    assert.equal(value.selected, "git");
    assert.equal(value.strategies.get("git").id, "git");
    assert.equal(
      calls.filter(([name]) => name === "observer.acquire").length,
      1,
    );
    constructorNoExternal(config.calls);
    assert.deepEqual(git.calls, []);
    await close(config.scope);
    assert.equal(
      calls.filter(([name]) => name === "observer.release").length,
      1,
    );
    // Registration finalizers dispose the original transform on owner close.
    assert.equal(service.get().directory, "/synthetic/data/worktree/abcdef");
    assert.deepEqual(git.calls, []);
  } finally {
    await close(config.scope);
    await close(git.scope);
    await run(Queue.shutdown(event));
  }
});

test("constructor Config seven service captures are mandatory before parser/load/subscription effects", async () => {
  for (const name of [
    "FS",
    "Global",
    "Service80",
    "Service65",
    "Service83",
    "Service73",
    "Service66",
  ]) {
    const f = await configConstructorFixture();
    try {
      const context = Context.omit(f.tags[name])(f.context);
      const exit = await run(
        Effect.exit(
          Layer.buildWithScope(f.layer, f.scope).pipe(Effect.provide(context)),
        ),
      );
      assert.ok(Exit.isFailure(exit), `missing ${name} must refuse`);
      assert.match(Cause.pretty(exit.cause), /Service not found/);
      assert.deepEqual(
        f.calls,
        [],
        `no dependency work before mandatory ${name} capture`,
      );
    } finally {
      await close(f.scope);
    }
  }
});

test("constructor WorktreeGit requires both captured FS and Git services before strategy brand or method factory use", async () => {
  const FSService = Context.Service("script/constructor/required-fs");
  const Service82 = Context.Service("script/constructor/required-git");
  const calls = [];
  const make12 = worktreeConstructor({
    Effect,
    Service82,
    FSUtil: { Service: FSService },
    Worktree: {
      StrategyID: { make: constructorCanary(calls, "strategy.brand") },
    },
    DirectoryUnavailableError2: class extends Error {},
    canonical2: constructorCanary(calls, "FS.canonical"),
  });
  for (const context of [Context.empty(), Context.make(FSService, {})]) {
    const exit = await run(Effect.exit(make12.pipe(Effect.provide(context))));
    assert.ok(Exit.isFailure(exit));
    assert.match(Cause.pretty(exit.cause), /Service not found/);
    assert.deepEqual(calls, []);
  }
});

test("constructor proof receipt and source closure with explicit unresolved import/schema/parser boundaries", async (t) => {
  const dependencySelections = [
    select(discoveryFile, "discover3"),
    select(discoveryFile, "names3"),
    select("config-y71avatq.js", "makeUnsafe2"),
    ...["run", "execute", "nuls", "resolvePath"].map((name) =>
      select("config-b7j7903f.js", name, "function"),
    ),
    ...["snapshotConfigFile", "snapshotConfigInclude", "snapshotConfig"].map(
      (name) => select("config-b7j7903f.js", name),
    ),
    select("config-skwjfd4r.js", "Service17", "class"),
    select("config-skwjfd4r.js", "layer"),
    select("config-gk30pdy3.js", "Plugin7"),
    select("config-qsdy395h.js", "observe2"),
    ...stateSelections,
  ];
  for (const row of [...constructorSelections, ...dependencySelections])
    t.diagnostic(
      `${chunks}${row.name}:${row.line}-${row.end} ${row.identity} sha256=${pins[row.name]}`,
    );
  const discoveryOverlay = recipe.files.find(
    (row) => row.path === chunks + discoveryFile,
  );
  assert.equal(discoveryOverlay.beforeSha256, pins[discoveryFile]);
  t.diagnostic(
    `ConfigDiscovery actual overlay after sha256=${discoveryOverlay.afterSha256}; constructor closure distinct original chunks=${new Set([...constructorSelections, ...dependencySelections].map((row) => row.name)).size}`,
  );
  t.diagnostic(
    `receipt sha256=${sha(await readFile(new URL("../receipt.json", root)))}; Effect ${effectPackage.version}; Effect JS=${effectRows.length}; static runtime closure=${runtimeClosure.size}; closure sha256=${runtimeClosureSHA}`,
  );
  t.diagnostic(
    "Exact original constructor expressions unchanged. Config uses actual recipe-pinned discovery fastpath and original watcher plan; original Git keyed mutex/helpers, WorktreeGit.make12, Worktree layer, Plugin7, observe2 and State participate. Explicit tags/services, inert WellKnown, Bus/event streams, JSON-only parser, normalizer, Info decoder/Document, brands and dormant error/patch/process boundaries are standins. Cached entries only after actual Config load. No original ConfigVariable/ConfigNormalize/JSONC/schema imports or full native module import/binding/dependency acquisition proof; nativeLayer2 and loader remain unexecuted. Constructor does not call IO; Watcher stream execution and Git/Worktree method execution reach canaries. Scope cleanup proves only these extracted subscriptions, not full runtime settlement, background refresh lifetime or same-Control wiring. No factory release, approval, full CODE, inventory, execution or Task authority.",
  );
});
