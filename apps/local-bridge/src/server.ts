import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  SyntheticSnapshotSchema,
  type SyntheticSnapshot,
} from "@workbench/contracts";
import {
  ROUTES,
  headerValues,
  hostAdmission,
  originAdmission,
  preflightAdmission,
  routeOf,
  trustedResponseOrigin,
  type BridgeErrorCode,
  type BridgeRoute,
  type OriginPolicy,
} from "./browser-admission.js";
import { syntheticSnapshot } from "./fixture.js";

const CODE_LIFETIME_MS = 120_000;
const IDLE_LIFETIME_MS = 900_000;
const ABSOLUTE_LIFETIME_MS = 28_800_000;
const MAX_BODY_BYTES = 4_096;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ERROR_MESSAGES: Record<BridgeErrorCode, string> = {
  REQUEST_INVALID: "The request is invalid.",
  REQUEST_TOO_LARGE: "The request body is too large.",
  HOST_DENIED: "The request is not allowed.",
  ORIGIN_DENIED: "The request is not allowed.",
  NOT_FOUND: "The route was not found.",
  METHOD_NOT_ALLOWED: "The method is not allowed.",
  BOOTSTRAP_INVALID: "The pairing code is invalid or unavailable.",
  BOOTSTRAP_RATE_LIMITED: "A new pairing code is required.",
  AUTH_REQUIRED: "A valid capability is required.",
  AUTH_EXPIRED: "The capability has expired.",
  AUTH_REVOKED: "The capability has been revoked.",
};

interface BootstrapState {
  digest: Buffer;
  expiresAt: number;
  failures: number;
}

interface CapabilityState {
  origin: string;
  issuedAt: number;
  lastActivityAt: number;
  status: "active" | "expired" | "revoked";
}

export interface LocalBridgeOptions {
  snapshot?: SyntheticSnapshot;
  trustedOrigins?: readonly string[];
  developmentOrigins?: readonly string[];
  allowOriginlessSameOriginRead?: boolean;
  /** In-process test fixture only. Never pass deterministic codes through env, argv, or HTTP. */
  testOnly?: {
    now?: () => number;
    // eslint-disable-next-line no-unused-vars
    captureIssuer?: (...args: [(...args: [string]) => void]) => void;
  };
}

export type LocalBridgeServer = Server & { issuePairingCode: () => string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function validSecret(value: string): boolean {
  return (
    SECRET_PATTERN.test(value) &&
    Buffer.from(value, "base64url").length === 32 &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

function reply(
  request: IncomingMessage,
  response: ServerResponse,
  policy: OriginPolicy,
  status: number,
  body?: unknown,
  preflightDenied = false,
  route?: BridgeRoute,
): void {
  const headers: Record<string, string | number> = {
    "cache-control": "no-store",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const origin = preflightDenied
    ? null
    : trustedResponseOrigin(request, policy);
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
    if (request.method === "OPTIONS" && route && status === 204) {
      headers["access-control-allow-methods"] = ROUTES[route].method;
      headers["access-control-allow-headers"] =
        ROUTES[route].headers.join(", ");
    }
  }
  if (status === 204) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  const serialized = JSON.stringify(body ?? null);
  headers["content-type"] = "application/json; charset=utf-8";
  headers["content-length"] = Buffer.byteLength(serialized);
  response.writeHead(status, headers);
  response.end(serialized);
}

function replyError(
  request: IncomingMessage,
  response: ServerResponse,
  policy: OriginPolicy,
  status: number,
  code: BridgeErrorCode,
  preflightDenied = false,
): void {
  reply(
    request,
    response,
    policy,
    status,
    { error: { code, requestId: randomUUID(), message: ERROR_MESSAGES[code] } },
    preflightDenied,
  );
}

function readBody(request: IncomingMessage): Promise<Buffer | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    request.on("data", (part: Buffer) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        settled = true;
        resolve("too-large");
      } else {
        chunks.push(chunk);
      }
    });
    request.once("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.once("error", (error) => {
      if (!settled) reject(error);
    });
    request.once("aborted", () => {
      if (!settled) reject(new Error("Request aborted."));
    });
  });
}

function validJsonContentType(request: IncomingMessage): boolean {
  const values = headerValues(request, "content-type");
  return (
    values.length === 1 &&
    /^application\/json(?:; charset=utf-8)?$/i.test(values[0] ?? "")
  );
}

function parsePairBody(body: Buffer): { code: string } | null {
  try {
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(body);
    const match =
      /^\s*\{\s*("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")\s*\}\s*$/s.exec(
        source,
      );
    if (!match || JSON.parse(match[1] ?? "") !== "code") return null;
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || !("code" in parsed))
      return null;
    const code = (parsed as { code: unknown }).code;
    return typeof code === "string" ? { code } : null;
  } catch {
    return null;
  }
}

function validEmptyControlBody(body: Buffer): boolean {
  try {
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(body);
    const parsed: unknown = JSON.parse(source);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    );
  } catch {
    return false;
  }
}

function currentOrigin(request: IncomingMessage): string {
  return (
    headerValues(request, "origin")[0] ??
    `http://127.0.0.1:${request.socket.localPort}`
  );
}

export function createLocalBridgeServer(
  options: LocalBridgeOptions = {},
): LocalBridgeServer {
  const fixture = SyntheticSnapshotSchema.parse(
    options.snapshot ?? syntheticSnapshot,
  );
  const developmentOrigins = new Set(
    options.developmentOrigins ??
      options.trustedOrigins ?? ["http://127.0.0.1:4200"],
  );
  const trustedOrigins = new Set(options.trustedOrigins ?? developmentOrigins);
  for (const origin of trustedOrigins) {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1"
    ) {
      throw new Error("Invalid trusted bridge UI origin configuration.");
    }
  }
  for (const origin of developmentOrigins) {
    if (!trustedOrigins.has(origin)) {
      throw new Error("Development origin must be explicitly trusted.");
    }
  }
  const policy: OriginPolicy = {
    trustedOrigins,
    developmentOrigins,
    allowOriginlessSameOriginRead:
      options.allowOriginlessSameOriginRead ?? false,
  };
  const now = options.testOnly?.now ?? Date.now;
  const capabilities = new Map<string, CapabilityState>();
  let bootstrap: BootstrapState | null = null;

  function setBootstrapCode(code: string): void {
    if (!validSecret(code))
      throw new Error("Invalid in-process test pairing code.");
    bootstrap = {
      digest: digest(code),
      expiresAt: now() + CODE_LIFETIME_MS,
      failures: 0,
    };
  }

  function issuePairingCode(): string {
    const code = randomBytes(32).toString("base64url");
    setBootstrapCode(code);
    return code;
  }

  options.testOnly?.captureIssuer?.(setBootstrapCode);

  function authenticate(
    request: IncomingMessage,
  ):
    | { capability: CapabilityState }
    | { status: number; code: BridgeErrorCode } {
    const values = headerValues(request, "authorization");
    if (values.length === 0) return { status: 401, code: "AUTH_REQUIRED" };
    if (values.length !== 1) return { status: 400, code: "REQUEST_INVALID" };
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(values[0] ?? "");
    if (!match || !validSecret(match[1] ?? "")) {
      return { status: 400, code: "REQUEST_INVALID" };
    }
    const capability = capabilities.get(digest(match[1] ?? "").toString("hex"));
    if (!capability || capability.origin !== currentOrigin(request)) {
      return { status: 401, code: "AUTH_REQUIRED" };
    }
    if (capability.status === "revoked")
      return { status: 401, code: "AUTH_REVOKED" };
    if (
      capability.status === "expired" ||
      now() >= capability.issuedAt + ABSOLUTE_LIFETIME_MS ||
      now() >= capability.lastActivityAt + IDLE_LIFETIME_MS
    ) {
      capability.status = "expired";
      return { status: 401, code: "AUTH_EXPIRED" };
    }
    return { capability };
  }

  const server = createServer(async (request, response) => {
    const hostError = hostAdmission(request);
    if (hostError) {
      request.resume();
      replyError(request, response, policy, hostError.status, hostError.code);
      return;
    }

    const routeResult = routeOf(request);
    if (!("route" in routeResult)) {
      request.resume();
      replyError(
        request,
        response,
        policy,
        routeResult.status,
        routeResult.code,
      );
      return;
    }
    const route = routeResult.route;
    if (
      request.method !== "OPTIONS" &&
      request.method !== ROUTES[route].method
    ) {
      request.resume();
      replyError(request, response, policy, 405, "METHOD_NOT_ALLOWED");
      return;
    }

    const isPreflight = request.method === "OPTIONS";
    const originError = originAdmission(
      request,
      policy,
      !isPreflight &&
        (route === "/api/v1/snapshot" || route === "/api/v1/events"),
    );
    if (originError) {
      request.resume();
      replyError(
        request,
        response,
        policy,
        originError.status,
        originError.code,
        isPreflight,
      );
      return;
    }
    if (isPreflight) {
      const preflightError = preflightAdmission(request, route);
      if (preflightError) {
        request.resume();
        replyError(
          request,
          response,
          policy,
          preflightError.status,
          preflightError.code,
          true,
        );
        return;
      }
    }

    if (headerValues(request, "content-type").length > 1) {
      request.resume();
      replyError(
        request,
        response,
        policy,
        400,
        "REQUEST_INVALID",
        isPreflight,
      );
      return;
    }
    if (isPreflight && headerValues(request, "authorization").length > 0) {
      request.resume();
      replyError(request, response, policy, 400, "REQUEST_INVALID", true);
      return;
    }
    let body: Buffer | "too-large";
    try {
      body = await readBody(request);
    } catch {
      if (!response.headersSent && !response.destroyed) {
        replyError(
          request,
          response,
          policy,
          400,
          "REQUEST_INVALID",
          isPreflight,
        );
      }
      return;
    }
    if (body === "too-large") {
      replyError(
        request,
        response,
        policy,
        413,
        "REQUEST_TOO_LARGE",
        isPreflight,
      );
      return;
    }
    if (isPreflight) {
      if (body.length !== 0) {
        replyError(request, response, policy, 400, "REQUEST_INVALID", true);
      } else {
        reply(request, response, policy, 204, undefined, false, route);
      }
      return;
    }
    if (route === "/api/v1/snapshot" || route === "/api/v1/events") {
      if (body.length !== 0) {
        replyError(request, response, policy, 400, "REQUEST_INVALID");
        return;
      }
    } else if (!validJsonContentType(request)) {
      replyError(request, response, policy, 400, "REQUEST_INVALID");
      return;
    }

    let pairCode: string | null = null;
    if (route === "/api/v1/pair") {
      const parsed = parsePairBody(body);
      if (!parsed) {
        replyError(request, response, policy, 400, "REQUEST_INVALID");
        return;
      }
      pairCode = parsed.code.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
      if (headerValues(request, "authorization").length > 0) {
        replyError(request, response, policy, 400, "REQUEST_INVALID");
        return;
      }
    } else if (
      (route === "/api/v1/pair/heartbeat" || route === "/api/v1/pair/revoke") &&
      !validEmptyControlBody(body)
    ) {
      replyError(request, response, policy, 400, "REQUEST_INVALID");
      return;
    }

    if (route === "/api/v1/pair") {
      const current = bootstrap;
      if (!current || now() >= current.expiresAt) {
        bootstrap = null;
        replyError(request, response, policy, 401, "BOOTSTRAP_INVALID");
        return;
      }
      const supplied = pairCode ?? "";
      const matched =
        validSecret(supplied) &&
        timingSafeEqual(digest(supplied), current.digest);
      if (!matched) {
        current.failures += 1;
        if (current.failures >= 5) {
          bootstrap = null;
          replyError(request, response, policy, 429, "BOOTSTRAP_RATE_LIMITED");
        } else {
          replyError(request, response, policy, 401, "BOOTSTRAP_INVALID");
        }
        return;
      }
      bootstrap = null;
      const capability = randomBytes(32).toString("base64url");
      const instant = now();
      capabilities.set(digest(capability).toString("hex"), {
        origin: currentOrigin(request),
        issuedAt: instant,
        lastActivityAt: instant,
        status: "active",
      });
      reply(request, response, policy, 200, {
        capability,
        idleTimeoutSeconds: IDLE_LIFETIME_MS / 1_000,
        absoluteTimeoutSeconds: ABSOLUTE_LIFETIME_MS / 1_000,
      });
      return;
    }

    const auth = authenticate(request);
    if (!("capability" in auth)) {
      replyError(request, response, policy, auth.status, auth.code);
      return;
    }
    if (route === "/api/v1/pair/revoke") {
      auth.capability.status = "revoked";
      reply(request, response, policy, 204);
      return;
    }
    auth.capability.lastActivityAt = now();
    if (route === "/api/v1/pair/heartbeat") {
      reply(request, response, policy, 204);
    } else if (route === "/api/v1/snapshot") {
      reply(request, response, policy, 200, fixture);
    } else {
      reply(request, response, policy, 200, fixture.events);
    }
  }) as LocalBridgeServer;

  server.issuePairingCode = issuePairingCode;
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("close", () => {
    bootstrap = null;
    capabilities.clear();
  });
  return server;
}

const bridgePort = Number(process.env.BRIDGE_PORT ?? "4318");
if (
  Number.isInteger(bridgePort) &&
  bridgePort > 0 &&
  bridgePort <= 65_535 &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "The bridge launcher requires an interactive terminal.\n",
    );
    process.exitCode = 1;
  } else {
    const server = createLocalBridgeServer();
    server.listen(bridgePort, "127.0.0.1", () => {
      const address = server.address();
      const listeningPort =
        address && typeof address !== "string" ? address.port : bridgePort;
      process.stdout.write(
        `Synthetic bridge listening on http://127.0.0.1:${listeningPort}\n`,
      );
      process.stdout.write(`Pairing code: ${server.issuePairingCode()}\n`);
      process.stdout.write("Type pair to issue a new pairing code.\n");
    });
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    terminal.on("line", (line) => {
      if (line === "pair" && server.listening) {
        process.stdout.write(`Pairing code: ${server.issuePairingCode()}\n`);
      }
    });
    server.on("close", () => terminal.close());
  }
}
