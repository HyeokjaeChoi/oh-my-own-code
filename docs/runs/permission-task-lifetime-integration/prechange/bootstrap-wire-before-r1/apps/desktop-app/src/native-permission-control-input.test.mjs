import assert from "node:assert/strict";
import test from "node:test";
import { taskPreparation } from "./native-permission-control-input.mjs";

const request = () => ({
  originKind: "prompt",
  origin: {
    runtimeEpoch: "epoch-1",
    operationId: "operation:1.0",
    type: "message.send",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace:1",
  appSessionId: "app.session",
  nativeSessionId: "ses_native",
  inputDigest: "b".repeat(64),
});
const refused = (value) =>
  assert.throws(() => taskPreparation(value), /native_permission_input/);

test("prompt preparation is a detached immutable closed metadata snapshot", () => {
  const input = request();
  const result = taskPreparation(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.origin, input.origin);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.origin));
  input.origin.digest = "c".repeat(64);
  input.workspaceId = "changed";
  assert.equal(result.origin.digest, "a".repeat(64));
  assert.equal(result.workspaceId, "workspace:1");
  assert.throws(() => {
    result.origin.operationId = "changed";
  }, TypeError);
});

test("all metadata and original fields are required; extras and undefined are refused", () => {
  for (const key of Object.keys(request())) {
    const input = request();
    delete input[key];
    refused(input);
    refused({ ...request(), [key]: undefined });
  }
  for (const key of Object.keys(request().origin)) {
    const input = request();
    delete input.origin[key];
    refused(input);
    refused({
      ...request(),
      origin: { ...request().origin, [key]: undefined },
    });
  }
  for (const extra of [
    "text",
    "files",
    "taskScopeId",
    "locationId",
    "inventoryGeneration",
    "modeGeneration",
    "onAcquire",
  ]) {
    refused({ ...request(), [extra]: "untrusted" });
    refused({
      ...request(),
      origin: { ...request().origin, [extra]: undefined },
    });
  }
  for (const originKind of [
    undefined,
    "command",
    "mutation",
    "bootstrap",
    "Prompt",
  ])
    refused({ ...request(), originKind });
  refused({
    ...request(),
    origin: { ...request().origin, type: "message.edit" },
  });
});

test("existing shared wire syntax and exact lowercase 64hex digests are enforced", () => {
  const slots = [
    "runtimeEpoch",
    "operationId",
    "workspaceId",
    "appSessionId",
    "nativeSessionId",
  ];
  for (const key of slots) {
    for (const value of ["A_.:-9", "x".repeat(128)]) {
      const input = request();
      (key in input.origin ? input.origin : input)[key] = value;
      assert.ok(taskPreparation(input));
    }
    for (const value of [
      undefined,
      null,
      1,
      {},
      "",
      "x".repeat(129),
      "x y",
      "x/y",
      "é",
      "x\n",
      "x\0",
    ]) {
      const input = request();
      (key in input.origin ? input.origin : input)[key] = value;
      refused(input);
    }
  }
  for (const key of ["digest", "inputDigest"]) {
    for (const value of [
      undefined,
      null,
      1,
      {},
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(64) + "\n",
    ]) {
      const input = request();
      (key === "digest" ? input.origin : input)[key] = value;
      refused(input);
    }
  }
});

test("accessors, proxies, prototypes, symbols and hidden fields run no caller code", () => {
  let calls = 0;
  const trap = () => {
    calls++;
    throw new Error("caller trap");
  };
  const proxy = (value) =>
    new Proxy(value, {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    });
  refused(proxy(request()));
  refused({ ...request(), origin: proxy(request().origin) });
  for (const nested of [false, true]) {
    const base = nested ? request().origin : request();
    const wrap = (value) => (nested ? { ...request(), origin: value } : value);
    for (const key of Object.keys(base)) {
      refused(
        wrap(
          Object.defineProperty({ ...base }, key, {
            enumerable: true,
            get: trap,
          }),
        ),
      );
      refused(
        wrap(Object.defineProperty({ ...base }, key, { enumerable: false })),
      );
    }
    for (const value of [
      Object.assign(Object.create(null), base),
      Object.assign(Object.create({ authority: true }), base),
      { ...base, [Symbol("extra")]: true },
    ])
      refused(wrap(value));
  }
  for (const value of [undefined, null, [], "prompt", 1]) refused(value);
  assert.equal(calls, 0);
});
