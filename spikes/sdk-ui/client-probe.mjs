import assert from "node:assert/strict";
import { ClientError, OpenCode } from "@opencode/client";

const baseUrl = "https://synthetic.invalid";
const infoUrl = "https://synthetic.invalid/api/info";
const expectedRequest = { url: infoUrl, method: "GET", body: undefined };

function createProbe(response) {
  const requests = [];
  const client = OpenCode.make({
    baseUrl,
    fetch: async (input, init) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      return response();
    },
  });
  return { client, requests };
}

function assertOneInfoRequest(requests) {
  assert.deepEqual(requests, [expectedRequest]);
}

const originalFetch = globalThis.fetch;
let ambientFetchCalls = 0;
globalThis.fetch = async () => {
  ambientFetchCalls += 1;
  throw new Error("Unexpected ambient fetch blocked by synthetic probe");
};

try {
  const syntheticInfo = {
    version: "synthetic-v2",
    pid: 1,
    urls: [],
    paths: { tmp: "/synthetic" },
  };
  const success = createProbe(
    () => new Response(JSON.stringify(syntheticInfo), { headers: { "content-type": "application/json" } }),
  );
  assert.deepEqual(await success.client.server.info(), syntheticInfo);
  assertOneInfoRequest(success.requests);

  const transportCause = new Error("synthetic transport rejection");
  const transport = createProbe(() => {
    throw transportCause;
  });
  await assert.rejects(transport.client.server.info(), (error) => {
    assert.ok(error instanceof ClientError);
    assert.equal(error.reason, "Transport");
    assert.equal(error.cause, transportCause);
    return true;
  });
  assertOneInfoRequest(transport.requests);

  const unavailable = createProbe(() => new Response("synthetic unavailable", { status: 503 }));
  await assert.rejects(unavailable.client.server.info(), (error) => {
    assert.ok(error instanceof ClientError);
    assert.equal(error.reason, "UnexpectedStatus");
    assert.deepEqual(error.cause, { status: 503 });
    return true;
  });
  assertOneInfoRequest(unavailable.requests);

  const malformedJson = createProbe(
    () => new Response("{", { headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(malformedJson.client.server.info(), (error) => {
    assert.ok(error instanceof ClientError);
    assert.equal(error.reason, "MalformedResponse");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
  assertOneInfoRequest(malformedJson.requests);

  const incompleteInfo = { version: "synthetic-v2" };
  const validJsonWithInvalidShape = createProbe(
    () => new Response(JSON.stringify(incompleteInfo), { headers: { "content-type": "application/json" } }),
  );
  assert.deepEqual(await validJsonWithInvalidShape.client.server.info(), incompleteInfo);
  assertOneInfoRequest(validJsonWithInvalidShape.requests);

  assert.equal(ambientFetchCalls, 0, "all requests must stay on the injected synthetic fetch");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS success: exactly one injected synthetic GET /api/info with no body");
console.log("PASS transport rejection: ClientError Transport; exactly one injected GET with no body");
console.log("PASS non-2xx response: ClientError UnexpectedStatus; exactly one injected GET with no body");
console.log("PASS malformed JSON: ClientError MalformedResponse; exactly one injected GET with no body");
console.log("OBSERVED valid JSON with an incomplete ServerInfo shape resolves unchanged; no runtime schema validation");
console.log("PASS no ambient fetch was attempted");
