import type { IncomingMessage } from "node:http";

export type BridgeRoute =
  | "/api/v1/pair"
  | "/api/v1/pair/heartbeat"
  | "/api/v1/pair/revoke"
  | "/api/v1/snapshot"
  | "/api/v1/events";

export type BridgeErrorCode =
  | "REQUEST_INVALID"
  | "REQUEST_TOO_LARGE"
  | "HOST_DENIED"
  | "ORIGIN_DENIED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "BOOTSTRAP_INVALID"
  | "BOOTSTRAP_RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "AUTH_REVOKED";

type AdmissionError = { status: number; code: BridgeErrorCode };

export const ROUTES: Readonly<
  Record<BridgeRoute, { method: "GET" | "POST"; headers: readonly string[] }>
> = {
  "/api/v1/pair": { method: "POST", headers: ["content-type"] },
  "/api/v1/pair/heartbeat": {
    method: "POST",
    headers: ["authorization", "content-type"],
  },
  "/api/v1/pair/revoke": {
    method: "POST",
    headers: ["authorization", "content-type"],
  },
  "/api/v1/snapshot": { method: "GET", headers: ["authorization"] },
  "/api/v1/events": { method: "GET", headers: ["authorization"] },
};

export function headerValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

export function hasDuplicateFetchMetadata(request: IncomingMessage): boolean {
  const names = new Set<string>();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase() ?? "";
    if (!name.startsWith("sec-fetch-")) continue;
    if (names.has(name)) return true;
    names.add(name);
  }
  return false;
}

export function hostAdmission(request: IncomingMessage): AdmissionError | null {
  const host = headerValues(request, "host");
  const port = request.socket.localPort;
  if (
    request.socket.remoteAddress !== "127.0.0.1" ||
    request.socket.localAddress !== "127.0.0.1" ||
    !Number.isInteger(port) ||
    host.length !== 1 ||
    host[0] !== `127.0.0.1:${port}`
  ) {
    return { status: 403, code: "HOST_DENIED" };
  }
  return null;
}

export function routeOf(
  request: IncomingMessage,
): { route: BridgeRoute } | AdmissionError {
  const raw = request.url;
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    // eslint-disable-next-line no-control-regex
    /[?#\\\u0000-\u001f\u007f]/.test(raw) ||
    /%(?![0-9a-fA-F]{2})/.test(raw)
  ) {
    return { status: 400, code: "REQUEST_INVALID" };
  }
  let path: string;
  try {
    const url = new URL(raw, "http://127.0.0.1");
    if (url.pathname !== raw) return { status: 400, code: "REQUEST_INVALID" };
    path = url.pathname;
  } catch {
    return { status: 400, code: "REQUEST_INVALID" };
  }
  if (!Object.prototype.hasOwnProperty.call(ROUTES, path)) {
    return { status: 404, code: "NOT_FOUND" };
  }
  return { route: path as BridgeRoute };
}

export interface OriginPolicy {
  trustedOrigins: ReadonlySet<string>;
  developmentOrigins: ReadonlySet<string>;
  allowOriginlessSameOriginRead: boolean;
}

function validOrigin(value: string): boolean {
  if (value === "null" || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === value &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function originAdmission(
  request: IncomingMessage,
  policy: OriginPolicy,
  allowOmission: boolean,
): AdmissionError | null {
  const origins = headerValues(request, "origin");
  const sites = headerValues(request, "sec-fetch-site");
  if (
    hasDuplicateFetchMetadata(request) ||
    origins.length > 1 ||
    sites.length !== 1
  ) {
    return { status: 403, code: "ORIGIN_DENIED" };
  }
  const site = sites[0];
  if (origins.length === 0) {
    return allowOmission &&
      policy.allowOriginlessSameOriginRead &&
      site === "same-origin"
      ? null
      : { status: 403, code: "ORIGIN_DENIED" };
  }
  const origin = origins[0] ?? "";
  if (!validOrigin(origin) || !policy.trustedOrigins.has(origin)) {
    return { status: 403, code: "ORIGIN_DENIED" };
  }
  if (
    site !== "same-origin" &&
    !(site === "same-site" && policy.developmentOrigins.has(origin))
  ) {
    return { status: 403, code: "ORIGIN_DENIED" };
  }
  return null;
}

export function trustedResponseOrigin(
  request: IncomingMessage,
  policy: OriginPolicy,
): string | null {
  if (hostAdmission(request) || originAdmission(request, policy, false))
    return null;
  return headerValues(request, "origin")[0] ?? null;
}

export function preflightAdmission(
  request: IncomingMessage,
  route: BridgeRoute,
): AdmissionError | null {
  const methods = headerValues(request, "access-control-request-method");
  const headers = headerValues(request, "access-control-request-headers");
  if (
    methods.length !== 1 ||
    methods[0] !== ROUTES[route].method ||
    headers.length > 1
  ) {
    return { status: 403, code: "ORIGIN_DENIED" };
  }
  const requested =
    headers.length === 0 || headers[0]?.trim() === ""
      ? []
      : (headers[0] ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase());
  if (
    requested.some((header) => !/^[a-z0-9-]+$/.test(header)) ||
    new Set(requested).size !== requested.length ||
    requested.some((header) => !ROUTES[route].headers.includes(header))
  ) {
    return { status: 403, code: "ORIGIN_DENIED" };
  }
  return null;
}
