import assert from "node:assert/strict";
import { once } from "node:events";
import http, { type IncomingHttpHeaders } from "node:http";
import net from "node:net";
import test, { type TestContext } from "node:test";
import { MUTATION_OPERATIONS } from "@workbench/contracts/source";
import { syntheticSnapshot } from "./fixture.js";
import { createLocalBridgeServer, type LocalBridgeOptions } from "./server.js";

const UI = "http://127.0.0.1:5420";
const BRIDGE_TEST_PORT = 5318;
const CODE = Buffer.alloc(32, 1).toString("base64url");
const NEW_CODE = Buffer.alloc(32, 2).toString("base64url");
const WRONG_CODE = Buffer.alloc(32, 3).toString("base64url");
const admitted = [
  ["Origin", UI],
  ["Sec-Fetch-Site", "same-site"],
] as const;
const json = [["Content-Type", "application/json"]] as const;
const bearer = (capability: string) =>
  [["Authorization", `Bearer ${capability}`]] as const;
type WireResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: unknown;
  rawBody: string;
};
/* eslint-disable no-unused-vars */
type PairCodeIssuer = (...args: [string]) => void;
type BridgeTestRunner = (...args: [string, PairCodeIssuer]) => Promise<void>;
/* eslint-enable no-unused-vars */

async function withBridge(
  context: TestContext,
  run: BridgeTestRunner,
  options: Omit<LocalBridgeOptions, "testOnly"> & { now?: () => number } = {},
) {
  let issue: PairCodeIssuer | undefined;
  const { now, ...bridgeOptions } = options;
  const server = createLocalBridgeServer({
    trustedOrigins: [UI],
    developmentOrigins: [UI],
    ...bridgeOptions,
    testOnly: {
      ...(now ? { now } : {}),
      captureIssuer: (issuer) => {
        issue = issuer;
      },
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(BRIDGE_TEST_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const close = () =>
    new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  context.after(close);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.ok(issue);
  try {
    await run(`http://127.0.0.1:${address.port}`, issue);
  } finally {
    await close();
  }
}

function wire(
  base: string,
  path: string,
  method = "GET",
  headers: readonly (readonly [string, string])[] = [],
  body?: string,
): Promise<WireResponse> {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(target.port),
        path,
        method,
        headers: [
          "Host",
          target.host,
          ...headers.flat(),
          ...(body === undefined
            ? []
            : ["Content-Length", String(Buffer.byteLength(body))]),
        ],
        setHost: false,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let body: unknown = null;
          if (rawBody) {
            try {
              body = JSON.parse(rawBody);
            } catch {
              body = rawBody;
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
            rawBody,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

const pair = (base: string, code: string) =>
  wire(
    base,
    "/api/v1/pair",
    "POST",
    [...admitted, ...json],
    JSON.stringify({ code }),
  );
function errorIs(
  response: WireResponse,
  status: number,
  code: string,
  cors = true,
) {
  assert.equal(response.status, status);
  const error = (response.body as { error?: Record<string, unknown> })?.error;
  assert.ok(error);
  assert.deepEqual(Object.keys(response.body as object), ["error"]);
  assert.deepEqual(Object.keys(error).sort(), ["code", "message", "requestId"]);
  assert.equal(error.code, code);
  assert.equal(typeof error.message, "string");
  assert.equal(typeof error.requestId, "string");
  assert.ok(
    !response.rawBody.includes(CODE) && !response.rawBody.includes(NEW_CODE),
  );
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(
    response.headers["access-control-allow-origin"],
    cors ? UI : undefined,
  );
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
  if (cors) assert.equal(response.headers.vary, "Origin");
}
async function paired(base: string, issue: PairCodeIssuer, code = CODE) {
  issue(code);
  const response = await pair(base, code);
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], UI);
  const value = response.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), [
    "absoluteTimeoutSeconds",
    "capability",
    "idleTimeoutSeconds",
  ]);
  assert.equal(value.idleTimeoutSeconds, 900);
  assert.equal(value.absoluteTimeoutSeconds, 28800);
  assert.equal(typeof value.capability, "string");
  assert.match(value.capability as string, /^[A-Za-z0-9_-]{43}$/);
  return value.capability as string;
}

test("exact read/control schemas, reissue, and per-capability revoke", async (context) => {
  await withBridge(context, async (base, issue) => {
    const first = await paired(base, issue);
    const snapshot = await wire(base, "/api/v1/snapshot", "GET", [
      ...admitted,
      ...bearer(first),
    ]);
    assert.equal(snapshot.status, 200);
    assert.deepEqual(snapshot.body, syntheticSnapshot);
    const events = await wire(base, "/api/v1/events", "GET", [
      ...admitted,
      ...bearer(first),
    ]);
    assert.equal(events.status, 200);
    assert.deepEqual(events.body, syntheticSnapshot.events);
    const heartbeat = await wire(
      base,
      "/api/v1/pair/heartbeat",
      "POST",
      [...admitted, ...json, ...bearer(first)],
      "{}",
    );
    assert.equal(heartbeat.status, 204);
    assert.equal(heartbeat.rawBody, "");
    const second = await paired(base, issue, NEW_CODE);
    assert.notEqual(first, second);
    const revoked = await wire(
      base,
      "/api/v1/pair/revoke",
      "POST",
      [...admitted, ...json, ...bearer(first)],
      "{}",
    );
    assert.equal(revoked.status, 204);
    assert.equal(revoked.rawBody, "");
    errorIs(
      await wire(base, "/api/v1/snapshot", "GET", [
        ...admitted,
        ...bearer(first),
      ]),
      401,
      "AUTH_REVOKED",
    );
    assert.equal(
      (
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(second),
        ])
      ).status,
      200,
    );
  });
});

test("one-use code, concurrent consume, reissue, and bounded failures", async (context) => {
  await withBridge(context, async (base, issue) => {
    issue(CODE);
    const raced = await Promise.all([pair(base, CODE), pair(base, CODE)]);
    assert.deepEqual(
      raced.map((response) => response.status).sort(),
      [200, 401],
    );
    errorIs(
      raced.find((response) => response.status === 401)!,
      401,
      "BOOTSTRAP_INVALID",
    );
    issue(NEW_CODE);
    errorIs(await pair(base, CODE), 401, "BOOTSTRAP_INVALID");
    assert.equal((await pair(base, NEW_CODE)).status, 200);
    issue(CODE);
    for (let attempt = 1; attempt <= 5; attempt++) {
      errorIs(
        await pair(base, WRONG_CODE),
        attempt === 5 ? 429 : 401,
        attempt === 5 ? "BOOTSTRAP_RATE_LIMITED" : "BOOTSTRAP_INVALID",
      );
    }
    errorIs(await pair(base, CODE), 401, "BOOTSTRAP_INVALID");
  });
});

test("BOM-prefixed pair JSON is invalid and leaves the code usable", async (context) => {
  await withBridge(context, async (base, issue) => {
    issue(CODE);
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [...admitted, ...json],
        `\uFEFF${JSON.stringify({ code: CODE })}`,
      ),
      400,
      "REQUEST_INVALID",
    );
    assert.equal((await pair(base, CODE)).status, 200);
  });
});

test("bootstrap, idle, and absolute expiry use injected time", async (context) => {
  let now = 10_000;
  await withBridge(
    context,
    async (base, issue) => {
      issue(CODE);
      now += 120_000;
      errorIs(await pair(base, CODE), 401, "BOOTSTRAP_INVALID");
      const first = await paired(base, issue);
      now += 900_000;
      errorIs(
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(first),
        ]),
        401,
        "AUTH_EXPIRED",
      );
      const second = await paired(base, issue, NEW_CODE);
      for (let elapsed = 600_000; elapsed <= 28_800_000; elapsed += 600_000) {
        now += 600_000;
        const response = await wire(
          base,
          "/api/v1/pair/heartbeat",
          "POST",
          [...admitted, ...json, ...bearer(second)],
          "{}",
        );
        if (elapsed < 28_800_000) assert.equal(response.status, 204);
        else errorIs(response, 401, "AUTH_EXPIRED");
      }
    },
    { now: () => now },
  );
});

test("request precedence, schema, and unknown mutation routes", async (context) => {
  await withBridge(context, async (base, issue) => {
    issue(CODE);
    errorIs(
      await wire(base, "/api/v1/pair", "POST", [...admitted, ...json], "{}"),
      400,
      "REQUEST_INVALID",
    );
    for (const body of [
      '{"code":"x","extra":1}',
      '{"code":"x","code":"y"}',
      '{"code":null}',
      "{",
    ]) {
      errorIs(
        await wire(base, "/api/v1/pair", "POST", [...admitted, ...json], body),
        400,
        "REQUEST_INVALID",
      );
    }
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [...admitted, ["Content-Type", "text/plain"]],
        JSON.stringify({ code: CODE }),
      ),
      400,
      "REQUEST_INVALID",
    );
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [...admitted, ...json],
        "x".repeat(4097),
      ),
      413,
      "REQUEST_TOO_LARGE",
    );
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [...admitted, ...json, ...bearer(WRONG_CODE)],
        JSON.stringify({ code: CODE }),
      ),
      400,
      "REQUEST_INVALID",
    );
    const capability = await paired(base, issue);
    errorIs(
      await wire(base, "/api/v1/snapshot", "GET", admitted),
      401,
      "AUTH_REQUIRED",
    );
    errorIs(
      await wire(base, "/api/v1/snapshot", "GET", [
        ...admitted,
        ...bearer(WRONG_CODE),
      ]),
      401,
      "AUTH_REQUIRED",
    );
    errorIs(
      await wire(base, "/api/v1/snapshot", "GET", [
        ...admitted,
        ["Authorization", "Basic x"],
      ]),
      400,
      "REQUEST_INVALID",
    );
    errorIs(
      await wire(
        base,
        "/api/v1/pair/revoke",
        "POST",
        [...admitted, ...json, ...bearer(capability)],
        '{"extra":1}',
      ),
      400,
      "REQUEST_INVALID",
    );
    const originalSnapshot = await wire(base, "/api/v1/snapshot", "GET", [
      ...admitted,
      ...bearer(capability),
    ]);
    const originalEvents = await wire(base, "/api/v1/events", "GET", [
      ...admitted,
      ...bearer(capability),
    ]);
    for (const path of [
      "/api/snapshot",
      "/api/events",
      "/health",
      "/api/v1/unknown",
      "/api/mutations/unknown",
      ...MUTATION_OPERATIONS.map((operation) => `/api/mutations/${operation}`),
    ]) {
      errorIs(await wire(base, path, "POST", admitted), 404, "NOT_FOUND");
    }
    assert.deepEqual(
      (
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(capability),
        ])
      ).body,
      originalSnapshot.body,
    );
    assert.deepEqual(
      (
        await wire(base, "/api/v1/events", "GET", [
          ...admitted,
          ...bearer(capability),
        ])
      ).body,
      originalEvents.body,
    );
    errorIs(
      await wire(base, "/api/v1/snapshot", "POST", admitted),
      405,
      "METHOD_NOT_ALLOWED",
    );
    errorIs(
      await wire(base, "/api/v1/snapshot?x=1", "GET", admitted),
      400,
      "REQUEST_INVALID",
    );
    assert.equal(
      (
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(capability),
        ])
      ).status,
      200,
    );
  });
});

test("Host, Origin, metadata, and duplicate headers fail with exact CORS decoration", async (context) => {
  await withBridge(context, async (base, issue) => {
    const capability = await paired(base, issue);
    const path = "/api/v1/snapshot";
    const auth = bearer(capability);
    errorIs(
      await wire(base, path, "GET", [
        ["Host", "evil.invalid"],
        ...admitted,
        ...auth,
      ]),
      403,
      "HOST_DENIED",
      false,
    );
    errorIs(
      await wire(base, path, "GET", [
        ["Origin", "http://evil.invalid"],
        ["Sec-Fetch-Site", "cross-site"],
        ...auth,
      ]),
      403,
      "ORIGIN_DENIED",
      false,
    );
    const badHeaders: Array<Array<[string, string]>> = [
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "cross-site"],
      ],
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "none"],
      ],
      [["Origin", UI]],
      [
        ["Origin", UI],
        ["Origin", UI],
        ["Sec-Fetch-Site", "same-site"],
      ],
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "same-site"],
        ["Sec-Fetch-Site", "same-site"],
      ],
    ];
    for (const headers of badHeaders)
      errorIs(
        await wire(base, path, "GET", [...headers, ...auth]),
        403,
        "ORIGIN_DENIED",
        false,
      );
    errorIs(
      await wire(base, path, "GET", [...admitted, ...auth, ...auth]),
      400,
      "REQUEST_INVALID",
    );
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [...admitted, ...json, ...json],
        JSON.stringify({ code: CODE }),
      ),
      400,
      "REQUEST_INVALID",
    );
    errorIs(
      await wire(base, "/api/v1/unknown", "GET", [
        ["Origin", "http://evil.invalid"],
        ["Sec-Fetch-Site", "cross-site"],
      ]),
      404,
      "NOT_FOUND",
      false,
    );
    errorIs(
      await wire(base, "/api/v1/unknown", "GET", admitted),
      404,
      "NOT_FOUND",
    );
    errorIs(
      await wire(base, path, "POST", admitted),
      405,
      "METHOD_NOT_ALLOWED",
    );
  });
});

test("route-specific preflight and originless production read exception", async (context) => {
  await withBridge(context, async (base, issue) => {
    const cases = [
      ["/api/v1/pair", "POST", "content-type"],
      ["/api/v1/pair/revoke", "POST", "authorization, content-type"],
      ["/api/v1/pair/heartbeat", "POST", "authorization, content-type"],
      ["/api/v1/snapshot", "GET", "authorization"],
      ["/api/v1/events", "GET", "authorization"],
    ] as const;
    for (const [path, method, headers] of cases) {
      const response = await wire(base, path, "OPTIONS", [
        ...admitted,
        ["Access-Control-Request-Method", method],
        ["Access-Control-Request-Headers", headers],
      ]);
      assert.equal(response.status, 204);
      assert.equal(response.rawBody, "");
      assert.equal(response.headers["access-control-allow-origin"], UI);
      assert.equal(response.headers["access-control-allow-methods"], method);
      assert.equal(response.headers["access-control-allow-headers"], headers);
      errorIs(
        await wire(base, path, "OPTIONS", [
          ...admitted,
          ["Access-Control-Request-Method", method],
          ["Access-Control-Request-Headers", "x-unknown"],
        ]),
        403,
        "ORIGIN_DENIED",
        false,
      );
      errorIs(
        await wire(base, path, "OPTIONS", [
          ...admitted,
          ["Access-Control-Request-Method", "DELETE"],
        ]),
        403,
        "ORIGIN_DENIED",
        false,
      );
    }
    errorIs(
      await wire(base, "/api/v1/pair", "OPTIONS", [
        ...admitted,
        ["Access-Control-Request-Method", "POST"],
        ...bearer(WRONG_CODE),
      ]),
      400,
      "REQUEST_INVALID",
      false,
    );
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "OPTIONS",
        [...admitted, ["Access-Control-Request-Method", "POST"]],
        "{}",
      ),
      400,
      "REQUEST_INVALID",
      false,
    );
    issue(CODE);
    assert.equal((await pair(base, CODE)).status, 200);
    errorIs(
      await wire(
        base,
        "/api/v1/pair",
        "POST",
        [["Sec-Fetch-Site", "same-origin"], ...json],
        JSON.stringify({ code: CODE }),
      ),
      403,
      "ORIGIN_DENIED",
      false,
    );
  });
  await withBridge(
    context,
    async (base, issue) => {
      issue(CODE);
      const pairedHere = await wire(
        base,
        "/api/v1/pair",
        "POST",
        [["Origin", base], ["Sec-Fetch-Site", "same-origin"], ...json],
        JSON.stringify({ code: CODE }),
      );
      assert.equal(pairedHere.status, 200);
      const capability = (pairedHere.body as { capability: string }).capability;
      const originless = await wire(base, "/api/v1/snapshot", "GET", [
        ["Sec-Fetch-Site", "same-origin"],
        ...bearer(capability),
      ]);
      assert.equal(originless.status, 200);
      assert.deepEqual(originless.body, syntheticSnapshot);
      assert.equal(
        originless.headers["access-control-allow-origin"],
        undefined,
      );
      errorIs(
        await wire(base, "/api/v1/snapshot", "GET", [
          ["Sec-Fetch-Site", "same-site"],
          ...bearer(capability),
        ]),
        403,
        "ORIGIN_DENIED",
        false,
      );
    },
    {
      allowOriginlessSameOriginRead: true,
      trustedOrigins: [UI, `http://127.0.0.1:${BRIDGE_TEST_PORT}`],
    },
  );
});

test("control JSON accepts only the four JSON whitespace characters and rejects Unicode whitespace without effects", async (context) => {
  let now = 10_000;
  await withBridge(
    context,
    async (base, issue) => {
      const legal = " \t\r\n{ \t\r\n} \t\r\n";
      const invalid = ["\u00a0{}", "{\u2003}", "{}\u2028"];
      const revoked = await paired(base, issue);
      assert.equal(
        (
          await wire(
            base,
            "/api/v1/pair/heartbeat",
            "POST",
            [...admitted, ...json, ...bearer(revoked)],
            legal,
          )
        ).status,
        204,
      );
      for (const body of invalid) {
        errorIs(
          await wire(
            base,
            "/api/v1/pair/revoke",
            "POST",
            [...admitted, ...json, ...bearer(revoked)],
            body,
          ),
          400,
          "REQUEST_INVALID",
        );
        assert.deepEqual(
          (
            await wire(base, "/api/v1/snapshot", "GET", [
              ...admitted,
              ...bearer(revoked),
            ])
          ).body,
          syntheticSnapshot,
        );
      }
      assert.equal(
        (
          await wire(
            base,
            "/api/v1/pair/revoke",
            "POST",
            [...admitted, ...json, ...bearer(revoked)],
            legal,
          )
        ).status,
        204,
      );
      const expiring = await paired(base, issue, NEW_CODE);
      now += 600_000;
      for (const body of invalid)
        errorIs(
          await wire(
            base,
            "/api/v1/pair/heartbeat",
            "POST",
            [...admitted, ...json, ...bearer(expiring)],
            body,
          ),
          400,
          "REQUEST_INVALID",
        );
      now += 300_000;
      errorIs(
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(expiring),
        ]),
        401,
        "AUTH_EXPIRED",
      );
    },
    { now: () => now },
  );
});

test("bridge restart invalidates old in-memory capabilities", async (context) => {
  let previous = "";
  await withBridge(context, async (base, issue) => {
    previous = await paired(base, issue);
  });
  await withBridge(context, async (base, issue) => {
    errorIs(
      await wire(base, "/api/v1/snapshot", "GET", [
        ...admitted,
        ...bearer(previous),
      ]),
      401,
      "AUTH_REQUIRED",
    );
    const current = await paired(base, issue, NEW_CODE);
    assert.equal(
      (
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(current),
        ])
      ).status,
      200,
    );
  });
});

test("WebSocket upgrade closes without a handshake", async (context) => {
  await withBridge(context, async () => {
    const socket = net.connect(BRIDGE_TEST_PORT, "127.0.0.1");
    try {
      await once(socket, "connect");
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      const closed = once(socket, "close");
      socket.write(
        [
          "GET /api/v1/events HTTP/1.1",
          `Host: 127.0.0.1:${BRIDGE_TEST_PORT}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "",
          "",
        ].join("\r\n"),
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Upgrade socket did not close.")),
              1_000,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      assert.equal(
        Buffer.concat(chunks)
          .toString("utf8")
          .includes("101 Switching Protocols"),
        false,
      );
    } finally {
      socket.destroy();
    }
  });
});

test("denied Fetch Metadata closes pair, control, and preflight without consuming state", async (context) => {
  await withBridge(context, async (base, issue) => {
    issue(CODE);
    const deniedCases: Array<Array<[string, string]>> = [
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "cross-site"],
      ],
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "none"],
      ],
      [["Origin", UI]],
      [["Sec-Fetch-Site", "same-origin"]],
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "unknown"],
      ],
      [
        ["Origin", UI],
        ["Origin", UI],
        ["Sec-Fetch-Site", "same-site"],
      ],
      [
        ["Origin", UI],
        ["Sec-Fetch-Site", "same-site"],
        ["Sec-Fetch-Site", "same-site"],
      ],
    ];
    for (const denied of deniedCases)
      errorIs(
        await wire(
          base,
          "/api/v1/pair",
          "POST",
          [...denied, ...json],
          JSON.stringify({ code: CODE }),
        ),
        403,
        "ORIGIN_DENIED",
        false,
      );
    const valid = await pair(base, CODE);
    assert.equal(valid.status, 200);
    const capability = (valid.body as { capability: string }).capability;
    for (const denied of deniedCases) {
      for (const path of ["/api/v1/pair/heartbeat", "/api/v1/pair/revoke"]) {
        errorIs(
          await wire(
            base,
            path,
            "POST",
            [...denied, ...json, ...bearer(capability)],
            "{}",
          ),
          403,
          "ORIGIN_DENIED",
          false,
        );
      }
      errorIs(
        await wire(base, "/api/v1/snapshot", "OPTIONS", [
          ...denied,
          ["Access-Control-Request-Method", "GET"],
          ["Access-Control-Request-Headers", "authorization"],
        ]),
        403,
        "ORIGIN_DENIED",
        false,
      );
    }
    assert.deepEqual(
      (
        await wire(base, "/api/v1/snapshot", "GET", [
          ...admitted,
          ...bearer(capability),
        ])
      ).body,
      syntheticSnapshot,
    );
  });
});
