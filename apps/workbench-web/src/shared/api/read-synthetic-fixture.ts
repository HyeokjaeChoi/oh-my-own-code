import {
  SyntheticSnapshotSchema,
  type SyntheticSnapshot,
} from "@workbench/contracts/source";

type BridgeEnvironment = {
  DEV: boolean;
  VITE_BRIDGE_ORIGIN?: string;
};

const environment = (import.meta as ImportMeta & { env?: BridgeEnvironment })
  .env ?? { DEV: false };

function bridgeUrl(path: string): string {
  const configuredOrigin = environment.VITE_BRIDGE_ORIGIN;
  const origin = configuredOrigin
    ? new URL(configuredOrigin).origin
    : environment.DEV
      ? window.location.port === "5420"
        ? "http://127.0.0.1:5318"
        : "http://127.0.0.1:4318"
      : typeof window === "undefined"
        ? "http://127.0.0.1:4318"
        : window.location.origin;
  return new URL(path, origin).toString();
}

const requestDefaults = {
  cache: "no-store",
  credentials: "omit",
  redirect: "error",
} as const;

export class BridgeResponseError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super("브리지 요청을 완료하지 못했습니다.");
    this.status = status;
    this.code = code;
    this.name = "BridgeResponseError";
  }
}

async function responseCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body))
      return null;
    const error = body.error;
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      typeof error.code !== "string"
    )
      return null;
    return error.code;
  } catch {
    return null;
  }
}

async function requireStatus(
  response: Response,
  expectedStatus: number,
): Promise<void> {
  if (response.status === expectedStatus) return;
  throw new BridgeResponseError(response.status, await responseCode(response));
}

function authHeaders(capability: string): HeadersInit {
  return { Authorization: `Bearer ${capability}` };
}

export async function pairWithBridge(
  code: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const requestBody = JSON.stringify({ code });
  code = "";
  const response = await fetcher(bridgeUrl("/api/v1/pair"), {
    ...requestDefaults,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
    ...(signal ? { signal } : {}),
  });
  await requireStatus(response, 200);

  const responseBody: unknown = await response.json();
  if (
    typeof responseBody !== "object" ||
    responseBody === null ||
    Object.keys(responseBody).length !== 3 ||
    !(
      "capability" in responseBody &&
      typeof responseBody.capability === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(responseBody.capability) &&
      "idleTimeoutSeconds" in responseBody &&
      responseBody.idleTimeoutSeconds === 900 &&
      "absoluteTimeoutSeconds" in responseBody &&
      responseBody.absoluteTimeoutSeconds === 28800
    )
  ) {
    throw new Error("브리지 응답 형식을 확인할 수 없습니다.");
  }
  return responseBody.capability;
}

export async function readSyntheticFixture(
  capability: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SyntheticSnapshot> {
  const init = {
    ...requestDefaults,
    headers: authHeaders(capability),
    ...(signal ? { signal } : {}),
  } as const;
  const results = await Promise.allSettled([
    fetcher(bridgeUrl("/api/v1/snapshot"), init),
    fetcher(bridgeUrl("/api/v1/events"), init),
  ]);

  const unauthorized = results.find(
    (result) => result.status === "fulfilled" && result.value.status === 401,
  );
  if (unauthorized?.status === "fulfilled") {
    throw new BridgeResponseError(401, await responseCode(unauthorized.value));
  }

  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;

  const [snapshotResult, eventsResult] = results;
  if (
    snapshotResult.status !== "fulfilled" ||
    eventsResult.status !== "fulfilled"
  )
    throw new Error("브리지 응답을 확인할 수 없습니다.");

  await Promise.all([
    requireStatus(snapshotResult.value, 200),
    requireStatus(eventsResult.value, 200),
  ]);
  const [snapshot, events] = await Promise.all([
    snapshotResult.value.json(),
    eventsResult.value.json(),
  ]);
  if (!Array.isArray(events))
    throw new Error("브리지 이벤트 형식을 확인할 수 없습니다.");
  const validatedSnapshot = SyntheticSnapshotSchema.parse(snapshot);
  const validatedEvents = SyntheticSnapshotSchema.shape.events.parse(events);
  return { ...validatedSnapshot, events: validatedEvents };
}

export async function heartbeatBridge(
  capability: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetcher(bridgeUrl("/api/v1/pair/heartbeat"), {
    ...requestDefaults,
    method: "POST",
    headers: {
      ...authHeaders(capability),
      "Content-Type": "application/json",
    },
    body: "{}",
    ...(signal ? { signal } : {}),
  });
  await requireStatus(response, 204);
  if (response.headers.get("Content-Length") === "0") return;
  if (response.body !== null) {
    const reader = response.body.getReader();
    const { done } = await reader.read();
    if (!done) {
      await reader.cancel();
      throw new Error("브리지 응답 형식을 확인할 수 없습니다.");
    }
  }
}

export async function revokeBridge(
  capability: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetcher(bridgeUrl("/api/v1/pair/revoke"), {
    ...requestDefaults,
    method: "POST",
    headers: {
      ...authHeaders(capability),
      "Content-Type": "application/json",
    },
    body: "{}",
    ...(signal ? { signal } : {}),
  });
  await requireStatus(response, 204);
  if (response.headers.get("Content-Length") === "0") return;
  if (response.body !== null) {
    const reader = response.body.getReader();
    const { done } = await reader.read();
    if (!done) {
      await reader.cancel();
      throw new Error("브리지 응답 형식을 확인할 수 없습니다.");
    }
  }
}
