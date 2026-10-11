import assert from "node:assert/strict";
import test from "node:test";
import { syntheticSnapshot } from "../../../test-fixtures/synthetic-snapshot.js";
import {
  BridgeResponseError,
  heartbeatBridge,
  pairWithBridge,
  readSyntheticFixture,
  revokeBridge,
} from "./read-synthetic-fixture.js";

const CODE = "A".repeat(43);
const CAPABILITY = "B".repeat(43);
type Call = {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  cache: RequestCache | undefined;
  redirect: RequestRedirect | undefined;
  contentType: string | null;
  authorizationAbsent: boolean;
  bearerMatches: boolean;
  codeBodyMatches: boolean;
  emptyBody: boolean;
};
/* eslint-disable no-unused-vars */
type MockReply = (
  ...args: [string, RequestInit]
) => Response | Promise<Response>;
/* eslint-enable no-unused-vars */

function client(reply: MockReply) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      redirect: init?.redirect,
      contentType: headers.get("content-type"),
      authorizationAbsent: !headers.has("authorization"),
      bearerMatches: headers.get("authorization") === `Bearer ${CAPABILITY}`,
      codeBodyMatches: init?.body === JSON.stringify({ code: CODE }),
      emptyBody: init?.body === "{}",
    });
    return reply(url, init ?? {});
  };
  return { calls, fetcher };
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

test("pair uses direct bridge URL, no credentials, and validates exact response schema", async () => {
  const { calls, fetcher } = client(() =>
    response({
      capability: CAPABILITY,
      idleTimeoutSeconds: 900,
      absoluteTimeoutSeconds: 28800,
    }),
  );
  assert.ok((await pairWithBridge(CODE, fetcher)) === CAPABILITY);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.match(call.url, /^http:\/\/127\.0\.0\.1:(4318|5318)\/api\/v1\/pair$/);
  assert.equal(call.method, "POST");
  assert.equal(call.credentials, "omit");
  assert.equal(call.cache, "no-store");
  assert.equal(call.redirect, "error");
  assert.equal(call.contentType, "application/json");
  assert.equal(call.authorizationAbsent, true);
  assert.equal(call.codeBodyMatches, true);
  assert.equal(call.url.includes(CODE), false);
  for (const malformed of [
    {
      capability: CAPABILITY,
      idleTimeoutSeconds: 1,
      absoluteTimeoutSeconds: 28800,
    },
    {
      capability: "short",
      idleTimeoutSeconds: 900,
      absoluteTimeoutSeconds: 28800,
    },
    {
      capability: CAPABILITY,
      idleTimeoutSeconds: 900,
      absoluteTimeoutSeconds: 28800,
      extra: true,
    },
  ]) {
    await assert.rejects(
      pairWithBridge(CODE, client(() => response(malformed)).fetcher),
    );
  }
});

test("pair exposes only fixed status/code and treats transport failures separately", async () => {
  const rejected = client(() =>
    response(
      {
        error: {
          code: "BOOTSTRAP_INVALID",
          requestId: "safe",
          message: "safe",
        },
      },
      401,
    ),
  );
  await assert.rejects(
    pairWithBridge(CODE, rejected.fetcher),
    (error: unknown) => {
      assert.ok(error instanceof BridgeResponseError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "BOOTSTRAP_INVALID");
      assert.equal(error.message.includes(CODE), false);
      return true;
    },
  );
  await assert.rejects(
    pairWithBridge(
      CODE,
      client(() => {
        throw new TypeError("Failed to fetch");
      }).fetcher,
    ),
    TypeError,
  );
});

test("read validates snapshot and finite event array with direct bearer calls", async () => {
  const { calls, fetcher } = client((url) =>
    response(
      url.endsWith("/api/v1/events")
        ? syntheticSnapshot.events
        : syntheticSnapshot,
    ),
  );
  const result = await readSyntheticFixture(CAPABILITY, fetcher);
  assert.deepEqual(result, syntheticSnapshot);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/api/v1/snapshot", "/api/v1/events"],
  );
  assert.ok(
    calls.every(
      (call) =>
        call.credentials === "omit" &&
        call.cache === "no-store" &&
        call.redirect === "error" &&
        call.bearerMatches,
    ),
  );
  assert.ok(calls.every((call) => !call.url.includes(CAPABILITY)));
});

test("read rejects malformed snapshot events even when the events route is valid", async () => {
  const missingEvents = Object.fromEntries(
    Object.entries(syntheticSnapshot).filter(([key]) => key !== "events"),
  );
  for (const snapshot of [
    missingEvents,
    { ...syntheticSnapshot, events: null },
    { ...syntheticSnapshot, events: [{ type: "unknown" }] },
  ]) {
    const { calls, fetcher } = client((url) =>
      response(
        url.endsWith("/api/v1/events") ? syntheticSnapshot.events : snapshot,
      ),
    );
    await assert.rejects(readSyntheticFixture(CAPABILITY, fetcher));
    assert.deepEqual(
      calls.map((call) => new URL(call.url).pathname),
      ["/api/v1/snapshot", "/api/v1/events"],
    );
  }
});

test("read prioritizes terminal auth and rejects malformed or failed responses", async () => {
  const unauthorized = client((url) =>
    url.endsWith("/events")
      ? response(syntheticSnapshot.events)
      : response({ error: { code: "AUTH_EXPIRED" } }, 401),
  );
  await assert.rejects(
    readSyntheticFixture(CAPABILITY, unauthorized.fetcher),
    (error: unknown) => {
      assert.ok(error instanceof BridgeResponseError);
      assert.equal(error.status, 401);
      return true;
    },
  );
  for (const fixture of [
    (url: string) => response(url.endsWith("/events") ? {} : syntheticSnapshot),
    (url: string) =>
      response(
        url.endsWith("/events")
          ? syntheticSnapshot.events
          : { realPath: "/Users/example" },
      ),
    () => response({ error: { code: "SERVER_ERROR" } }, 500),
  ]) {
    await assert.rejects(
      readSyntheticFixture(CAPABILITY, client(fixture).fetcher),
    );
  }
});

test("heartbeat and revoke require empty 204 and use credential-free direct POST", async () => {
  const { calls, fetcher } = client(() => noContent());
  await heartbeatBridge(CAPABILITY, fetcher);
  await revokeBridge(CAPABILITY, fetcher);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/api/v1/pair/heartbeat", "/api/v1/pair/revoke"],
  );
  assert.ok(
    calls.every(
      (call) =>
        call.method === "POST" &&
        call.credentials === "omit" &&
        call.cache === "no-store" &&
        call.redirect === "error" &&
        call.emptyBody &&
        call.bearerMatches &&
        call.contentType === "application/json",
    ),
  );
  for (const operation of [heartbeatBridge, revokeBridge]) {
    await assert.rejects(
      operation(
        CAPABILITY,
        client(() => response({ error: { code: "AUTH_REVOKED" } }, 401))
          .fetcher,
      ),
      BridgeResponseError,
    );
    await assert.rejects(
      operation(
        CAPABILITY,
        client(() => response({ unexpected: true })).fetcher,
      ),
      BridgeResponseError,
    );
  }
});
