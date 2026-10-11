import { expect, test, type Page, type Response } from "@playwright/test";
import {
  createLocalBridgeServer,
  type LocalBridgeServer,
} from "../../local-bridge/src/server.js";

const BRIDGE = "http://127.0.0.1:5318";
const UI = "http://127.0.0.1:5420";
const CODE = Buffer.alloc(32, 11).toString("base64url");
const NEW_CODE = Buffer.alloc(32, 12).toString("base64url");
const WRONG_CODE = Buffer.alloc(32, 13).toString("base64url");
let bridge: LocalBridgeServer | undefined;
let issue: ((code: string) => void) | undefined;
let bridgeTime = Date.now();
const observedBridgeRequests: Array<{ pathname: string; method: string }> = [];

function issueCode(code: string) {
  if (!issue) throw new Error("In-process fixture issuer unavailable.");
  issue(code);
}

test.beforeAll(async () => {
  const fixture = createLocalBridgeServer({
    trustedOrigins: [UI],
    developmentOrigins: [UI],
    testOnly: {
      now: () => bridgeTime,
      captureIssuer: (issuer) => {
        issue = issuer;
      },
    },
  });
  fixture.on("request", (request) => {
    const url = new URL(request.url ?? "/", BRIDGE);
    observedBridgeRequests.push({
      pathname: url.pathname,
      method: request.method ?? "",
    });
  });
  bridge = fixture;
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(5318, "127.0.0.1", () => {
      fixture.off("error", reject);
      resolve();
    });
  });
  if (!issue) throw new Error("In-process fixture issuer unavailable.");
});

test.afterAll(async () => {
  const owned = bridge;
  if (owned?.listening) {
    await new Promise<void>((resolve, reject) =>
      owned.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function pairPage(page: Page, code = CODE) {
  issueCode(code);
  await page.goto("/");
  const input = page.getByLabel("터미널 pairing code");
  await input.fill(code);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(
    page.getByText("연결됨 · 합성 읽기 전용", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toBeVisible();
}

test("real Chromium preflight pairs and reads directly, then revokes only its tab", async ({
  page,
  context,
}) => {
  const requestStart = observedBridgeRequests.length;
  await pairPage(page);
  const bridgeRequests = observedBridgeRequests.slice(requestStart);
  expect(
    bridgeRequests.some(
      (request) =>
        request.pathname === "/api/v1/pair" && request.method === "OPTIONS",
    ),
  ).toBe(true);
  expect(
    bridgeRequests.some(
      (request) =>
        request.pathname === "/api/v1/pair" && request.method === "POST",
    ),
  ).toBe(true);
  expect(
    bridgeRequests.some((request) => request.pathname === "/api/v1/snapshot"),
  ).toBe(true);
  expect(
    bridgeRequests.some((request) => request.pathname === "/api/v1/events"),
  ).toBe(true);
  expect(
    bridgeRequests.filter((request) => request.pathname.includes("mutations")),
  ).toEqual([]);
  await expect(page.locator(".run-status")).toHaveText("합성 완료");
  await expect(
    page.locator('.transcript-message[data-provenance="event"]'),
  ).toContainText("이 메시지는 합성 이벤트 fixture에서 왔습니다.");
  await expect(page.locator(".omoc-link-preview")).toHaveAttribute(
    "lang",
    "ko-KR",
  );
  await expect(page.getByRole("link")).toHaveCount(0);

  const other = await context.newPage();
  try {
    await pairPage(other, NEW_CODE);
    await page.getByRole("button", { name: "연결 끊기" }).click();
    await expect(page.getByLabel("터미널 pairing code")).toBeVisible();
    await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
      0,
    );
    await other.getByRole("button", { name: "새로고침" }).click();
    await expect(
      other.getByText("합성 링크 결과를 확인해 주세요."),
    ).toBeVisible();
    const data = await other.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    }));
    expect(data).toEqual({ local: 0, session: 0, cookies: "" });
  } finally {
    await other.close();
  }
  expect(
    observedBridgeRequests
      .slice(requestStart)
      .some(
        (request) =>
          request.pathname === "/api/v1/pair/revoke" &&
          request.method === "POST",
      ),
  ).toBe(true);
  expect(
    observedBridgeRequests.filter((request) =>
      request.pathname.includes("mutations"),
    ),
  ).toEqual([]);
});

test("trusted origin reads application errors; denied origin sees opaque fetch failure", async ({
  page,
}) => {
  await page.goto("/");
  const trusted = await page.evaluate(async (bridgeOrigin) => {
    const response = await fetch(`${bridgeOrigin}/api/v1/unknown`, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    return {
      status: response.status,
      code: (await response.json()).error.code,
    };
  }, BRIDGE);
  expect(trusted).toEqual({ status: 404, code: "NOT_FOUND" });
  const unauthenticated = await page.evaluate(async (bridgeOrigin) => {
    const response = await fetch(`${bridgeOrigin}/api/v1/snapshot`, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    return {
      status: response.status,
      code: (await response.json()).error.code,
    };
  }, BRIDGE);
  expect(unauthenticated).toEqual({ status: 401, code: "AUTH_REQUIRED" });
  await page.goto("data:text/html,<title>isolated</title>");
  const denied = await page.evaluate(async (bridgeOrigin) => {
    try {
      const response = await fetch(`${bridgeOrigin}/api/v1/unknown`, {
        credentials: "omit",
      });
      return { readable: true, status: response.status };
    } catch (error) {
      return {
        readable: false,
        name: error instanceof Error ? error.name : "unknown",
      };
    }
  }, BRIDGE);
  expect(denied).toEqual({ readable: false, name: "TypeError" });
});

test("validation and rejected code keep safe feedback and keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("터미널 pairing code");
  await input.fill("invalid");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveValue("invalid");
  issueCode(CODE);
  await input.fill(WRONG_CODE);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(
    page
      .locator(".field-feedback")
      .filter({ hasText: /code가 만료되었거나 이미 사용됐을 수 있습니다/ }),
  ).toBeVisible();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
});

test("pair progress clears code before await and moves focus from disabled Pair", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${BRIDGE}/api/v1/pair`, async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  issueCode(CODE);
  await page.goto("/");
  const input = page.getByLabel("터미널 pairing code");
  await input.fill(CODE);
  const button = page.getByRole("button", { name: "연결", exact: true });
  await button.focus();
  await button.press("Enter");
  await expect(input).toHaveValue("");
  await expect(button).toBeDisabled();
  await expect(page.getByText("pairing 요청을 보내고 있습니다…")).toBeFocused();
  release();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "LinkPreview 합성 흐름" }),
  ).toBeFocused();
});

test("malformed pair 200, server 5xx, and opaque CORS denial require a fresh code", async ({
  page,
}) => {
  for (const outcome of ["malformed", "server", "cors"] as const) {
    let observedStatus: number | undefined;
    const captureResponse = (response: Response) => {
      if (new URL(response.url()).pathname === "/api/v1/pair")
        observedStatus = response.status();
    };
    page.on("response", captureResponse);
    if (outcome !== "cors") {
      await page.route(`${BRIDGE}/api/v1/pair`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        if (outcome === "malformed")
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": UI },
            body: '{"capability":"invalid"}',
          });
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "access-control-allow-origin": UI },
          body: '{"error":{"code":"UNAVAILABLE"}}',
        });
      });
    }
    issueCode(CODE);
    await page.goto(outcome === "cors" ? "http://localhost:5420/" : "/");
    const input = page.getByLabel("터미널 pairing code");
    await input.fill(CODE);
    await page.getByRole("button", { name: "연결", exact: true }).click();
    await expect(
      page
        .locator(".field-feedback")
        .filter({ hasText: /브리지에서 code가 이미 사용됐을 수 있습니다/ }),
    )
      .toBeVisible({ timeout: 2000 })
      .catch(() => {
        throw new Error(
          `Pair outcome ${outcome} did not reach an expected safe state (status=${observedStatus ?? "opaque"}).`,
        );
      });
    await expect(input).toHaveValue("");
    await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
      0,
    );
    if (outcome !== "cors") await page.unroute(`${BRIDGE}/api/v1/pair`);
    page.off("response", captureResponse);
  }
});

test("read failure retains retry, terminal auth clears data, revoke failure is unconfirmed", async ({
  page,
}) => {
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: '{"error":{"code":"UNAVAILABLE"}}',
    });
  });
  issueCode(CODE);
  await page.goto("/");
  await page.getByLabel("터미널 pairing code").fill(CODE);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(
    page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeFocused();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
  await page.unroute(`${BRIDGE}/api/v1/snapshot`);
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toBeVisible();
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: '{"error":{"code":"AUTH_EXPIRED"}}',
    });
  });
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(
    page.getByText(/브리지 자격이 만료되거나 폐기되었습니다/),
  ).toBeVisible();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
  await page.unroute(`${BRIDGE}/api/v1/snapshot`);

  await pairPage(page, NEW_CODE);
  await page.route(`${BRIDGE}/api/v1/pair/revoke`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: '{"error":{"code":"AUTH_REVOKED"}}',
    });
  });
  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect(
    page.getByText(/브리지에서 폐기를 확인하지 못했습니다/),
  ).toBeVisible();
  await expect(page.getByLabel("터미널 pairing code")).toBeFocused();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
});

test("heartbeat recovery keeps read failure visible and resumes its cadence", async ({
  page,
}) => {
  await page.clock.install();
  await pairPage(page);
  let heartbeatCount = 0;
  await page.route(`${BRIDGE}/api/v1/pair/heartbeat`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    heartbeatCount += 1;
    if (heartbeatCount === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": UI },
        body: '{"error":{"code":"UNAVAILABLE"}}',
      });
    return route.continue();
  });
  await page.clock.fastForward(300_000);
  await expect(
    page.locator(".connection-actions .operation-status"),
  ).toContainText(/연결 갱신을 확인하지 못했습니다/);
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toBeVisible();
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: '{"error":{"code":"UNAVAILABLE"}}',
    });
  });
  await page.getByRole("button", { name: "연결 확인 다시 시도" }).click();
  await expect(
    page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
  ).toBeVisible();
  expect(heartbeatCount).toBe(2);
  await page.clock.fastForward(300_000);
  await expect.poll(() => heartbeatCount).toBe(3);
  await expect(
    page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
  ).toBeVisible();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
});

test("malformed read is recoverable and late refresh cannot restore disconnected data", async ({
  page,
}) => {
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: "{}",
    });
  });
  issueCode(CODE);
  await page.goto("/");
  await page.getByLabel("터미널 pairing code").fill(CODE);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(
    page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
  ).toBeVisible();
  await page.unroute(`${BRIDGE}/api/v1/snapshot`);
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toBeVisible();

  let release: () => void = () => undefined;
  let pending: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    pending = resolve;
  });
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    pending();
    await gate;
    await route.continue().catch(() => undefined);
  });
  await page.getByRole("button", { name: "새로고침" }).click();
  await started;
  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect(page.getByLabel("터미널 pairing code")).toBeVisible();
  release();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
});

test("disconnect during deliberately held initial read ignores its late response", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let readCount = 0;
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    readCount += 1;
    started();
    await gate;
    await route.continue().catch(() => undefined);
  });
  try {
    issueCode(CODE);
    await page.goto("/");
    await page.getByLabel("터미널 pairing code").fill(CODE);
    await page.getByRole("button", { name: "연결", exact: true }).click();
    await entered;
    await expect(page.getByText("읽기 전용 데이터 연결 중…")).toBeVisible();
    await page.getByRole("button", { name: "연결 끊기" }).click();
    await expect(page.getByLabel("터미널 pairing code")).toBeVisible();
    release();
    await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
      0,
    );
    await expect(
      page.getByText("연결됨 · 합성 읽기 전용", { exact: true }),
    ).toHaveCount(0);
    expect(readCount).toBe(1);
  } finally {
    release();
    await page.unroute(`${BRIDGE}/api/v1/snapshot`);
  }
});

test("bridge clock expiry yields an actual Chromium 401 and clears the tab", async ({
  page,
}) => {
  await pairPage(page);
  bridgeTime += 900_000;
  const expired = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/snapshot" &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "새로고침" }).click();
  const response = await expired;
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe("AUTH_EXPIRED");
  await expect(
    page.getByText(/브리지 자격이 만료되거나 폐기되었습니다/),
  ).toBeVisible();
  await expect(page.getByText("합성 링크 결과를 확인해 주세요.")).toHaveCount(
    0,
  );
  await expect(page.getByLabel("터미널 pairing code")).toBeVisible();
});

test("timer firing during a failed manual read defers heartbeat and retains cadence", async ({
  page,
}) => {
  await page.clock.install();
  await pairPage(page);
  // Leave room for the timer to have been scheduled after pairing rendered.
  await page.clock.fastForward(295_000);
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let activeRead = false;
  let heartbeatCount = 0;
  let overlap = false;
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    activeRead = true;
    started();
    await gate;
    activeRead = false;
    await route
      .fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": UI },
        body: '{"error":{"code":"UNAVAILABLE"}}',
      })
      .catch(() => undefined);
  });
  await page.route(`${BRIDGE}/api/v1/pair/heartbeat`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    heartbeatCount += 1;
    if (activeRead) overlap = true;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "새로고침" }).click();
    await entered;
    // Cross the five-minute deadline while the read is held, staying below
    // the read's 15-second request timeout.
    await page.clock.fastForward(10_000);
    expect(heartbeatCount).toBe(0);
    release();
    await expect(
      page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
    ).toBeVisible();
    await expect.poll(() => heartbeatCount).toBe(1);
    expect(overlap).toBe(false);
    await page.clock.fastForward(300_000);
    await expect.poll(() => heartbeatCount).toBe(2);
    await expect(
      page.getByText(/읽기 오류: 검증된 데이터를 표시할 수 없습니다/),
    ).toBeVisible();
  } finally {
    release();
    await page.unroute(`${BRIDGE}/api/v1/snapshot`);
    await page.unroute(`${BRIDGE}/api/v1/pair/heartbeat`);
  }
});

test("failed heartbeat remains visible after a successful read and recovery refresh", async ({
  page,
}) => {
  await page.clock.install();
  await pairPage(page);
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let heartbeatCount = 0;
  let readCount = 0;
  await page.route(`${BRIDGE}/api/v1/pair/heartbeat`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    heartbeatCount += 1;
    if (heartbeatCount === 1) {
      started();
      await gate;
      return route
        .fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "access-control-allow-origin": UI },
          body: '{"error":{"code":"UNAVAILABLE"}}',
        })
        .catch(() => undefined);
    }
    return route.continue();
  });
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "GET") readCount += 1;
    await route.continue();
  });
  try {
    await page.clock.fastForward(300_000);
    await entered;
    await page.getByRole("button", { name: "새로고침" }).click();
    expect(readCount).toBe(0);
    release();
    await expect(
      page.locator(".connection-actions .operation-status"),
    ).toContainText(/연결 갱신을 확인하지 못했습니다/);
    await expect(
      page.getByText("합성 링크 결과를 확인해 주세요."),
    ).toBeVisible();
    await page.getByRole("button", { name: "연결 확인 다시 시도" }).click();
    await expect(
      page.getByText("연결됨 · 합성 읽기 전용", { exact: true }),
    ).toBeVisible();
    expect(heartbeatCount).toBe(2);
    expect(readCount).toBe(1);
  } finally {
    release();
    await page.unroute(`${BRIDGE}/api/v1/pair/heartbeat`);
    await page.unroute(`${BRIDGE}/api/v1/snapshot`);
  }
});

test("a read success cannot erase a deferred heartbeat failure", async ({
  page,
}) => {
  await page.clock.install();
  await pairPage(page);
  // Leave room for the timer to have been scheduled after pairing rendered.
  await page.clock.fastForward(295_000);
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let activeRead = false;
  let overlap = false;
  let heartbeatCount = 0;
  await page.route(`${BRIDGE}/api/v1/snapshot`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    activeRead = true;
    started();
    await gate;
    activeRead = false;
    await route.continue().catch(() => undefined);
  });
  await page.route(`${BRIDGE}/api/v1/pair/heartbeat`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    heartbeatCount += 1;
    if (activeRead) overlap = true;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": UI },
      body: '{"error":{"code":"UNAVAILABLE"}}',
    });
  });
  try {
    await page.getByRole("button", { name: "새로고침" }).click();
    await entered;
    // Cross the five-minute deadline while the read is held, staying below
    // the read's 15-second request timeout.
    await page.clock.fastForward(10_000);
    expect(heartbeatCount).toBe(0);
    release();
    await expect.poll(() => heartbeatCount).toBe(1);
    await expect(
      page.locator(".connection-actions .operation-status"),
    ).toContainText(/연결 갱신을 확인하지 못했습니다/);
    await expect(
      page.getByText("합성 링크 결과를 확인해 주세요."),
    ).toBeVisible();
    expect(overlap).toBe(false);
  } finally {
    release();
    await page.unroute(`${BRIDGE}/api/v1/snapshot`);
    await page.unroute(`${BRIDGE}/api/v1/pair/heartbeat`);
  }
});

test("synthetic preview remains inert and layout fits narrow screens", async ({
  page,
}) => {
  await pairPage(page);
  const preview = page.locator(".omoc-link-preview");
  await expect(preview).toContainText("안전한 합성 링크");
  await expect(preview).not.toHaveAttribute("data-interactive", "true");
  await expect(preview).not.toHaveAttribute("tabindex", /.+/);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(
      dimensions.document,
      `document overflows at ${width}px`,
    ).toBeLessThanOrEqual(dimensions.viewport);
  }
});
