// Original layer behavior with actual pinned Effect and scripted IO services.
// This never imports Native/core or performs network/cache IO.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL(
  "../runtime-event-host/.generated/install/node_modules/",
  import.meta.url,
);
const library = await import(new URL("effect/dist/index.js", root));
assert.equal(
  JSON.parse(await readFile(new URL("effect/package.json", root))).version,
  "4.0.0-rc.112",
);
const {
  Context,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
  Duration,
  Schedule,
  Cause,
} = library;
const original = await readFile(
  new URL("@opencode/core/dist/chunks/config-2synrjax.js", root),
  "utf8",
);
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  "768f6a969bbd880e29e67cf4f28a5395d6a9e18d58dea4c9f19f43366208f999",
);
const source = [
  original.slice(
    original.indexOf("class Service13 extends"),
    original.indexOf("var defaultSource ="),
  ),
  original.slice(
    original.indexOf("function cacheKey(source)"),
    original.indexOf("function configured2(options)"),
  ),
].join("\n");

function fixture() {
  const counts = { network: 0, reads: 0, writes: 0, events: 0 };
  const FS = Context.Service("models-test/fs"),
    Bus = Context.Service("models-test/bus");
  const Metadata = Context.Service("models-test/metadata"),
    KV = Context.Service("models-test/kv");
  const HTTP = Context.Service("models-test/http");
  const client = {
    pipe(...steps) {
      return steps.reduce((value, step) => step(value), this);
    },
    execute: () =>
      Effect.sync(() => {
        counts.network++;
        return { text: Effect.succeed("{}") };
      }),
  };
  const HttpClient = {
    HttpClient: HTTP,
    filterStatusOk: (value) => value,
    retryTransient: () => (value) => value,
  };
  const HttpClientRequest = {
    get: () => ({
      pipe(...steps) {
        return steps.reduce((value, step) => step(value), this);
      },
    }),
    setHeader: () => (value) => value,
  };
  const dependencies = {
    Context,
    Effect,
    Option,
    Schema,
    Semaphore,
    Duration,
    Schedule,
    Cause,
    Layer,
    FSUtil: { Service: FS },
    Service83: Bus,
    Metadata2: Metadata,
    Service67: KV,
    HttpClient,
    HttpClientRequest,
    useragent2: () => "synthetic",
    Hash: {
      fast: () => "synthetic",
      sha256: (text) => createHash("sha256").update(text).digest("hex"),
    },
    ModelsDev: { Event: { Refreshed: { type: "refreshed" } } },
    normalize: (value) => value,
    bundledSnapshot: Effect.succeed([{ id: "pinned-fixture" }]),
    defaultSource: "https://models.opencode.ai",
  };
  const { Service, layer } = new Function(
    ...Object.keys(dependencies),
    `${source}\nreturn {Service:Service13,layer:layer8};`,
  )(...Object.values(dependencies));
  const provided = Layer.mergeAll(
    Layer.succeed(FS, { readJson: () => Effect.die("file read not expected") }),
    Layer.succeed(Bus, {
      publish: () =>
        Effect.sync(() => {
          counts.events++;
        }),
    }),
    Layer.succeed(Metadata, {}),
    Layer.succeed(HTTP, client),
    Layer.succeed(KV, {
      get: () =>
        Effect.sync(() => {
          counts.reads++;
          return undefined;
        }),
      set: () =>
        Effect.sync(() => {
          counts.writes++;
        }),
      remove: () =>
        Effect.sync(() => {
          counts.writes++;
        }),
    }),
  );
  const run = (options, body) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Service;
        return yield* body(service);
      }).pipe(
        Effect.provide(layer(options).pipe(Layer.provide(provided))),
        Effect.scoped,
        Effect.timeout("2 seconds"),
      ),
    );
  return { counts, run };
}

test("original fetch=false acquisition and catalog read never fork an automatic refresh", async () => {
  const f = fixture();
  await f.run({ fetch: false, snapshot: true }, (service) =>
    Effect.gen(function* () {
      for (let i = 0; i < 16; i++) yield* Effect.yieldNow;
      assert.deepEqual(f.counts, {
        network: 0,
        reads: 0,
        writes: 0,
        events: 0,
      });
      assert.deepEqual(yield* service.get(), [{ id: "pinned-fixture" }]);
      assert.deepEqual(f.counts, {
        network: 0,
        reads: 1,
        writes: 0,
        events: 0,
      });
    }),
  );
});

test("original default acquisition does start refresh; false preserves explicit refresh separately", async () => {
  const baseline = fixture();
  await baseline.run(undefined, () =>
    Effect.gen(function* () {
      for (let i = 0; i < 32 && baseline.counts.network === 0; i++)
        yield* Effect.yieldNow;
      assert.equal(baseline.counts.network, 1);
    }),
  );
  const f = fixture();
  await f.run({ fetch: false, snapshot: true }, (service) =>
    Effect.gen(function* () {
      yield* service.refresh();
      assert.equal(f.counts.network, 1);
    }),
  );
});
