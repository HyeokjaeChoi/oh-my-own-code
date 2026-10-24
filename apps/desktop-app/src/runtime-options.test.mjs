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

test("free means every cost tier is zero; variants survive a model switch only if listed", async () => {
  const { isFreeModel, variantForModel } = await import(
    "./renderer/shared/runtime-options/index.mjs"
  );
  assert.equal(isFreeModel({ cost: [{ input: 0, output: 0 }] }), true);
  for (const cost of [
    undefined,
    [],
    [{ input: 0, output: 1 }],
    [
      { input: 0, output: 0 },
      { input: 1, output: 0 },
    ],
    [{ input: "0", output: 0 }],
    [{}],
  ])
    assert.equal(isFreeModel({ cost }), false);
  assert.equal(isFreeModel(undefined), false);
  const high = { variants: { status: "available", ids: ["low", "high"] } };
  assert.equal(variantForModel("high", high), "high");
  assert.equal(variantForModel("max", high), "");
  assert.equal(variantForModel("", high), "");
  assert.equal(
    variantForModel("high", { variants: { status: "available", ids: [] } }),
    "",
  );
  assert.equal(
    variantForModel("high", { variants: { status: "unavailable", ids: [] } }),
    "",
  );
  assert.equal(variantForModel("high", undefined), "");
});

test("OpenRouter free ids count as free even without a cost, under OpenRouter only", async () => {
  const { isFreeModel } = await import(
    "./renderer/shared/runtime-options/index.mjs"
  );
  const or = (id) => ({ providerID: "openrouter", id });
  assert.equal(isFreeModel(or("vendor/model:free")), true);
  assert.equal(isFreeModel(or("openrouter/free")), true);
  assert.equal(isFreeModel(or("vendor/model:freedom")), false);
  assert.equal(isFreeModel(or("vendor/free")), false);
  // Another provider's ":free" lookalike is not free.
  assert.equal(isFreeModel({ providerID: "acme", id: "x:free" }), false);
  assert.equal(isFreeModel({ id: "openrouter/free" }), false);
  assert.equal(
    isFreeModel({ ...or("vendor/model"), cost: [{ input: 1, output: 1 }] }),
    false,
  );
});

test("model picker groups: recents first, free first per provider, filters never hide the selection", async () => {
  const { groupModels, defaultFreeOnly } = await import(
    "./renderer/shared/runtime-options/index.mjs"
  );
  const m = (id, providerId, free) => ({
    id,
    name: id.toUpperCase(),
    providerId,
    provider: providerId,
    ...(free ? { free: true } : {}),
  });
  const entries = [
    m("router", "openrouter", true),
    m("paid-or", "openrouter"),
    m("free-or", "openrouter", true),
    m("claude", "anthropic"),
    m("haiku", "anthropic", true),
  ];
  const run = (o) =>
    groupModels(entries, {
      query: "",
      freeOnly: false,
      recent: [],
      selectedId: "",
      ...o,
    }).map((g) => [g.label, g.items.map((e) => e.id)]);
  assert.deepEqual(run({}), [
    ["openrouter", ["router", "free-or", "paid-or"]],
    ["anthropic", ["haiku", "claude"]],
  ]);
  // Recents (max 3, existing ids only) lead and are not repeated below.
  assert.deepEqual(
    run({ recent: ["claude", "gone", "router", "haiku", "paid-or"] }),
    [
      ["최근", ["claude", "router", "haiku"]],
      ["openrouter", ["free-or", "paid-or"]],
    ],
  );
  // Free filter keeps the selected paid model visible.
  assert.deepEqual(run({ freeOnly: true, selectedId: "claude" }), [
    ["openrouter", ["router", "free-or"]],
    ["anthropic", ["haiku", "claude"]],
  ]);
  // Search matches name or provider and drops the recents group.
  assert.deepEqual(run({ query: " ANTHRO", recent: ["claude"] }), [
    ["anthropic", ["haiku", "claude"]],
  ]);
  // "무료만" defaults on only when every connected provider is OpenRouter.
  assert.equal(defaultFreeOnly(entries.slice(0, 3), undefined), true);
  assert.equal(defaultFreeOnly(entries, undefined), false);
  assert.equal(defaultFreeOnly([], undefined), false);
  assert.equal(defaultFreeOnly(entries.slice(0, 3), false), false);
  assert.equal(defaultFreeOnly(entries, true), true);
});

test("the default model row and chip name the session's model the same way", async () => {
  const { defaultModelText } = await import(
    "./renderer/shared/runtime-options/index.mjs"
  );
  assert.deepEqual(defaultModelText("Free Models Router"), {
    chip: "기본 · Free Models Router",
    hint: "지금: Free Models Router",
  });
  // The same display name the picker rows use ("(free)" is the badge's job).
  assert.equal(defaultModelText("Foo (free)").chip, "기본 · Foo");
  assert.equal(defaultModelText("Foo (free)").hint, "지금: Foo");
  assert.deepEqual(defaultModelText(undefined), {
    chip: "기본 모델",
    hint: "런타임이 정합니다",
  });
});

test('reasoning levels read in Korean and "(free)" is not repeated beside the badge', async () => {
  const { variantLabel, modelDisplayName } = await import(
    "./renderer/shared/runtime-options/index.mjs"
  );
  assert.equal(variantLabel("minimal"), "최소");
  assert.equal(variantLabel("high"), "높음");
  assert.equal(variantLabel("xhigh"), "xhigh");
  assert.equal(variantLabel("toString"), "toString");
  assert.equal(modelDisplayName("DeepSeek R1 (free)"), "DeepSeek R1");
  assert.equal(modelDisplayName("Llama (FREE) "), "Llama");
  assert.equal(modelDisplayName("(free)"), "(free)");
  assert.equal(modelDisplayName("Freedom model"), "Freedom model");
});

import {
  projectUsage,
  validUsage,
  sumUsage,
  formatUsage,
  validAssistantRuntime,
} from "./renderer/shared/runtime-options/index.mjs";
import { activityMatches } from "./renderer/widgets/activity/labels.ts";

const nativeTurn = (extra) => ({
  id: "a",
  type: "assistant",
  agent: "build",
  model: { providerID: "p", id: "m" },
  content: [],
  ...extra,
});
test("usage projects tokens and cost from the native assistant message", () => {
  const projected = projectMessages([
    nativeTurn({
      tokens: {
        input: 1200,
        output: 340,
        reasoning: 0,
        cache: { read: 8000, write: 5 },
      },
      cost: 0.0123,
    }),
  ])[0];
  assert.deepEqual(projected.runtime.usage, {
    input: 1200,
    output: 340,
    reasoning: 0,
    cacheRead: 8000,
    cacheWrite: 5,
    cost: 0.0123,
  });
  assert.ok(validAssistantRuntime(projected.runtime));
  assert.equal(
    formatUsage(projected.runtime.usage),
    "입력 1.2k · 출력 340 · 캐시 8k · $0.01",
  );
});
test("usage missing or invalid is absent, never zero", () => {
  assert.equal(projectMessages([nativeTurn({})])[0].runtime.usage, undefined);
  for (const bad of [-1, 1.5, NaN, Infinity, "3"])
    assert.equal(
      projectUsage({
        tokens: {
          input: bad,
          output: 1,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
      undefined,
    );
  assert.equal(
    projectUsage({ tokens: { input: 1, output: 1, reasoning: 0 } }),
    undefined,
  );
  const noCost = projectUsage({
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: -2,
  });
  assert.ok(noCost && !("cost" in noCost));
  assert.equal(validUsage({ ...noCost, extra: 1 }), false);
  assert.equal(formatUsage(undefined), "확인 불가");
});
test("usage sum counts unknown turns separately", () => {
  const u = {
    input: 10,
    output: 5,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.5,
  };
  const { total, unknown } = sumUsage([u, undefined, u]);
  assert.equal(total.input, 20);
  assert.equal(total.cost, 1);
  assert.equal(unknown, 1);
  assert.equal(sumUsage([undefined]).total, undefined);
});
test("activity filters bucket known operations only", () => {
  const ev = (operation, status = "ok") => ({ operation, status });
  assert.ok(activityMatches("chat", ev("message.send")));
  assert.ok(activityMatches("files", ev("file.save")));
  assert.ok(activityMatches("config", ev("configuration.mcp.connect")));
  assert.ok(!activityMatches("chat", ev("mystery.op")));
  assert.ok(activityMatches("all", ev("mystery.op")));
  assert.ok(activityMatches("failed", ev("x", "error")));
  assert.ok(!activityMatches("failed", ev("x", "ok")));
});
