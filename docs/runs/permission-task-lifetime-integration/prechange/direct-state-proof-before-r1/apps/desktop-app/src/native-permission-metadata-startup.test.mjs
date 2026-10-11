import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";

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
];
const stateText = stateSelections
  .map((row) =>
    row.identity.startsWith("Current")
      ? `const ${row.identity} = ${row.text};`
      : row.text,
  )
  .join("\n");
const actualState = compile(
  `${stateText}\nreturn { create3, shutdown2, reconcile2 };`,
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
    `Effect ${effectPackage.version}; ${effectRows.length} Effect JS files and exact ${runtimeClosure.size} runtime ESM files receipt-verified BEFORE import; closure sha256=${runtimeClosureSHA}. Provider/Model proof reused by import.`,
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
