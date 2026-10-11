import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "./workbench-contract.mjs";
import { projectMessages } from "./workbench-service.mjs";

test("runtime options explicit opaque variant is accepted only with a model", () => {
  const request = {
    type: "message.send",
    workspaceId: "w",
    sessionId: "s",
    requestId: "request",
    text: "hello",
    model: "model-hash",
    variant: "provider tier/2026#custom",
  };
  assert.deepEqual(validateRequest(request), request);
  const withoutModel = { ...request };
  delete withoutModel.model;
  assert.throws(() => validateRequest(withoutModel));
  for (const variant of ["", "\n", "a".repeat(257), undefined])
    assert.throws(() => validateRequest({ ...request, variant }));
});
test("runtime options assistant report is from its native message, never inferred", () => {
  const message = {
    id: "assistant",
    type: "assistant",
    agent: "reported-agent",
    model: {
      providerID: "old-provider",
      id: "historical-model",
      variant: "actual",
    },
    content: [{ type: "text", text: "answer" }],
    settings: { private: "DO_NOT_EXPORT" },
  };
  const projected = projectMessages([message])[0];
  assert.deepEqual(projected.runtime, {
    agent: "reported-agent",
    model: {
      providerId: "old-provider",
      id: "historical-model",
      variant: "actual",
    },
  });
  assert.equal(JSON.stringify(projected).includes("DO_NOT_EXPORT"), false);
  for (const model of [
    undefined,
    { id: "bad" },
    { providerID: "provider", id: "model", variant: undefined },
  ])
    assert.equal(
      projectMessages([{ ...message, model }])[0].runtime,
      undefined,
    );
  assert.equal(
    projectMessages([{ ...message, type: "user", text: "user" }])[0].runtime,
    undefined,
  );
});
test("runtime options shared helper projects only bounded catalog options", async () => {
  const {
    projectModelOptions,
    validModelOptions,
    validAssistantRuntime,
    projectSessionSelection,
    validSessionSelection,
  } = await import("./renderer/shared/runtime-options/index.mjs");
  const native = {
    variants: [
      {
        id: "native-only",
        headers: { canary: "PRIVATE" },
        body: { canary: "PRIVATE" },
      },
    ],
    capabilities: {
      tools: true,
      input: ["text", "future-mode"],
      output: ["text"],
    },
  };
  const options = projectModelOptions(native);
  assert.deepEqual(options, {
    variants: { status: "available", ids: ["native-only"] },
    capabilities: native.capabilities,
  });
  assert.equal(JSON.stringify(options).includes("PRIVATE"), false);
  assert.ok(validModelOptions(options));
  for (const variants of [
    undefined,
    [{ id: "x" }, { id: "x" }],
    Array.from({ length: 65 }, (_, i) => ({ id: String(i) })),
    [{ id: "\n" }],
  ])
    assert.deepEqual(projectModelOptions({ variants }).variants, {
      status: "unavailable",
      ids: [],
    });
  for (const capabilities of [
    { tools: true, input: Array(33).fill("text"), output: [] },
    { tools: true, input: ["text", "text"], output: [] },
    { tools: "true", input: [], output: [] },
  ])
    assert.equal(
      projectModelOptions({ variants: [], capabilities }).capabilities,
      undefined,
    );
  assert.equal(validModelOptions({ ...options, body: {} }), false);
  assert.equal(
    validAssistantRuntime({
      agent: "a",
      model: { id: "m", providerId: "p", body: {} },
    }),
    false,
  );
  assert.deepEqual(
    projectSessionSelection(
      { agent: "a", model: { id: "m", providerID: "p" } },
      "session",
    ),
    { sessionId: "session", agent: "a", model: { id: "m", providerId: "p" } },
  );
  assert.equal(projectSessionSelection({}, "session"), undefined);
  assert.equal(
    projectSessionSelection({ agent: "a", model: { id: "m" } }, "session"),
    undefined,
  );
  assert.ok(validSessionSelection({ sessionId: "s", agent: "a" }));
  assert.equal(validSessionSelection({ sessionId: "s" }), false);
});

test("runtime options closed metadata rejects private fields, accessors and malformed text without evaluating getters", async () => {
  const {
    validRuntimeText,
    validRuntimeModel,
    validAssistantRuntime,
    validSessionSelection,
    validModelOptions,
    projectModelOptions,
  } = await import("./renderer/shared/runtime-options/index.mjs");
  for (const text of [
    "",
    "\ud800",
    "line\nnext",
    "\u007f",
    "\u0085",
    "x".repeat(257),
  ])
    assert.equal(validRuntimeText(text), false);
  assert.equal(validRuntimeText("x".repeat(256)), true);
  assert.equal(validRuntimeText("Native/opaque #한글"), true);
  const model = { providerId: "p", id: "m" };
  const original = { agent: "a", model };
  let getterCalls = 0;
  const accessor = { model };
  Object.defineProperty(accessor, "agent", {
    get() {
      getterCalls++;
      return "secret";
    },
    enumerable: true,
  });
  const hidden = { ...original };
  Object.defineProperty(hidden, "privateHeader", { value: "PRIVATE" });
  for (const value of [
    accessor,
    hidden,
    Object.assign(Object.create({ inherited: true }), original),
    { ...original, [Symbol("private")]: "PRIVATE" },
    { ...original, agent: undefined },
    { ...original, model: { ...model, variant: "\ud800" } },
  ])
    assert.equal(validAssistantRuntime(value), false);
  assert.equal(getterCalls, 0);
  assert.equal(
    validRuntimeModel({ ...model, providerID: "private alias" }),
    false,
  );
  assert.equal(
    validSessionSelection({ sessionId: "s", model, operationId: "forged" }),
    false,
  );
  assert.equal(
    validModelOptions({ variants: { status: "unavailable", ids: ["fake"] } }),
    false,
  );
  const variants = Array.from({ length: 64 }, (_, i) => ({
    id: `variant-${i}`,
    body: { secret: "PRIVATE" },
  }));
  const input = ["text"];
  const projected = projectModelOptions({
    variants,
    capabilities: { tools: false, input, output: [] },
  });
  assert.equal(projected.variants.ids.length, 64);
  assert.equal(projected.capabilities.tools, false);
  variants[0].id = "changed";
  input[0] = "changed";
  assert.equal(projected.variants.ids[0], "variant-0");
  assert.deepEqual(projected.capabilities.input, ["text"]);
});
