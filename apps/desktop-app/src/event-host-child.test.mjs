import assert from "node:assert/strict";
import test from "node:test";
import * as child from "./event-host-child.mjs";

const input = (isClosing = () => false) => ({
  root: "/SYNTHETIC/opencode/event-host/darwin-arm64",
  nonce: "a".repeat(64),
  runtimeEpoch: "main-epoch",
  bootHolds: [],
  options: { port: 0 },
  isClosing,
});

test("held EventHost awaits the checked graph before constructing server start with exact overrides", async () => {
  const overrides = Object.freeze([Object.freeze({ synthetic: true })]);
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  let graphInput;
  let startArgs;
  let loads = 0;
  const expected = Object.freeze({ syntheticEffect: true });
  const options = input();
  const pending = child.prepareHeldEventHostStart(options, {
    createGraph: async (value) => {
      graphInput = value;
      await paused;
      return { overrides };
    },
    loadStart: async () => {
      loads++;
      return (...args) => {
        startArgs = args;
        return expected;
      };
    },
  });
  await Promise.resolve();
  assert.equal(startArgs, undefined);
  assert.equal(loads, 0);
  release();
  assert.equal(await pending, expected);
  assert.equal(loads, 1);
  assert.deepEqual(graphInput, {
    root: options.root,
    nonce: options.nonce,
    runtimeEpoch: "main-epoch",
    bootHolds: [],
  });
  assert.equal(startArgs.length, 4);
  assert.equal(startArgs[0], options.options);
  assert.equal(startArgs[1], undefined);
  assert.equal(startArgs[2], undefined);
  assert.equal(startArgs[3], overrides);
});

test("held EventHost graph failure and close during construction never construct server start", async () => {
  let starts = 0;
  let loads = 0;
  await assert.rejects(
    () =>
      child.prepareHeldEventHostStart(input(), {
        createGraph: async () => {
          throw new Error("unverified_graph");
        },
        loadStart: async () => {
          loads++;
          return () => {
            starts++;
          };
        },
      }),
    /unverified_graph/,
  );
  let closing = false;
  await assert.rejects(
    () =>
      child.prepareHeldEventHostStart(
        input(() => closing),
        {
          createGraph: async () => {
            closing = true;
            return { overrides: Object.freeze([]) };
          },
          loadStart: async () => {
            loads++;
            return () => {
              starts++;
            };
          },
        },
      ),
    /startup_held/,
  );
  assert.equal(starts, 0);
  assert.equal(loads, 0);
});

test("held EventHost close during server module loading never constructs server start", async () => {
  let closing = false;
  let starts = 0;
  await assert.rejects(
    () =>
      child.prepareHeldEventHostStart(
        input(() => closing),
        {
          createGraph: async () => ({ overrides: Object.freeze([]) }),
          loadStart: async () => {
            closing = true;
            return () => {
              starts++;
            };
          },
        },
      ),
    /startup_held/,
  );
  assert.equal(starts, 0);
});

test("held EventHost rejects missing epoch and pre-existing close before graph construction", async () => {
  let graphs = 0;
  const dependencies = {
    createGraph: async () => {
      graphs++;
      return { overrides: [] };
    },
    loadStart: async () => () => {
      throw new Error("unexpected_start");
    },
  };
  await assert.rejects(() =>
    child.prepareHeldEventHostStart(
      { ...input(), runtimeEpoch: undefined },
      dependencies,
    ),
  );
  await assert.rejects(
    () =>
      child.prepareHeldEventHostStart(
        input(() => true),
        dependencies,
      ),
    /startup_held/,
  );
  assert.equal(graphs, 0);
});

test("held EventHost binds the exact graph facade before server construction", async () => {
  const facade = Object.freeze({ prepare() {}, close() {} });
  const order = [];
  let actual;
  await child.prepareHeldEventHostStart(
    {
      ...input(),
      bindTaskControl(value) {
        actual = value;
        order.push("bind");
      },
    },
    {
      createGraph: async () => ({ overrides: [], taskControl: facade }),
      loadStart: async () => () => {
        order.push("start");
        return {};
      },
    },
  );
  assert.equal(actual, facade);
  assert.deepEqual(order, ["bind", "start"]);
});
