// First run + free-model fallback against the real Electron app and sidecar.
// A local OpenAI-compatible mock stands in for OpenRouter (baseURL seeded via
// OMOC_E2E_NATIVE_CONFIG). Only a FAKE key is ever typed.
//   1. fresh profile (no provider): empty state shows the first-run card;
//      Settings opens on the 모델 tab.
//   2. invalid key shape -> inline field error, no secret echoed.
//   3. fake key -> connected -> "Free Models Router" is the composer model.
//   4. a ":free" model answers 404 -> one sentence + fallback button ->
//      the same prompt is resent on openrouter/free; the model is marked
//      "사용 불가" in the picker.
//   5. a provider 401 shows an inline auth note and no generic page banner.
import assert from "node:assert/strict";
import { windowsEnv } from "./e2e-env.mjs";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { openSettings } from "./e2e-shell.mjs";
import { openComposerPopover } from "./e2e-composer.mjs";

const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150_000;
const HARD_TIMEOUT_MS = 8 * 60_000;
const FAKE_KEY = "sk-or-fake-e2e-key-0123456789";
const SHOTS = process.env.OMOC_E2E_SHOTS;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-onboarding-e2e-")),
);
const scratch = join(fixture, "tmp");
await mkdir(scratch);

const seen = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(404).end();
      return;
    }
    seen.push({
      auth: req.headers.authorization,
      model: parsed.model,
      tools: Boolean(parsed.tools?.length),
      text: JSON.stringify(parsed.messages ?? []).includes("FALLBACK-PROMPT"),
    });
    if (
      parsed.tools?.length &&
      JSON.stringify(parsed.messages ?? []).includes("AUTH-PROMPT")
    ) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "PROVIDER-PRIVATE-TEXT", code: 401 },
        }),
      );
      return;
    }
    if (parsed.tools?.length && parsed.model !== "openrouter/free") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "No endpoints found: unavailable for free",
            code: 404,
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const base = {
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
    };
    const chunk = (delta, finish_reason = null) =>
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({
      role: "assistant",
      content: parsed.tools?.length ? "Router " : "Title",
    });
    if (parsed.tools?.length) chunk({ content: "mock reply." });
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const port = mock.address().port;

const configFile = join(fixture, "native-config.json");
await writeFile(
  configFile,
  `${JSON.stringify({
    providers: {
      openrouter: { settings: { baseURL: `http://127.0.0.1:${port}/v1` } },
    },
  })}\n`,
  { mode: 0o600 },
);
const env = {
  OMOC_E2E_NATIVE_CONFIG: configFile,
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  OMOC_DESKTOP_E2E_BACKGROUND: process.env.OMOC_E2E_FOREGROUND ? "" : "1",
  OMOC_APP_DATA_DIR: join(fixture, "app-profile"),
  HOME: fixture,
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  ...windowsEnv(fixture),
};

let application;
let stderr = "";
const hard = setTimeout(() => {
  console.error("e2e-onboarding hard timeout");
  process.exit(2);
}, HARD_TIMEOUT_MS);
const observations = [];
const shot = async (page, name) => {
  if (SHOTS)
    await page.screenshot({
      path: join(
        SHOTS,
        `${name}-${process.env.OMOC_E2E_SCHEME ?? "light"}-${process.env.OMOC_E2E_SIZE ?? "default"}.png`,
      ),
    });
};
try {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(root, "apps/desktop-app/dist/app")],
    env,
  });
  application.process().stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-20_000);
  });
  const page = await application.firstWindow();
  if (process.env.OMOC_E2E_SIZE) {
    const [width, height] = process.env.OMOC_E2E_SIZE.split("x").map(Number);
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(
          size.width,
          size.height,
        ),
      { width, height },
    );
  }
  if (process.env.OMOC_E2E_SCHEME)
    await page.emulateMedia({ colorScheme: process.env.OMOC_E2E_SCHEME });
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected", {
    timeout: CONNECT_TIMEOUT_MS,
  });

  // 1. First run: card + positioning line; Settings opens on 모델.
  const card = page.locator("[data-first-run]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(
    card.getByRole("heading", { name: "무료 모델로 바로 시작" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "신용카드 없이, 어떤 모델로든 — 한국어로 쓰는 코딩 에이전트.",
    ),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "키 발급" })).toBeVisible();
  // The card replaces the generic "no models" notice.
  await expect(page.locator("[data-no-models]")).toHaveCount(0);
  await shot(page, "first-run-empty");
  await openSettings(page);
  await expect(
    page.getByRole("tab", { name: "모델", selected: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기", exact: true }).click();
  observations.push("no provider -> first-run card; settings opens on 모델");

  // 2. Invalid key: inline field error under the labelled input.
  const input = card.getByLabel("OpenRouter API 키");
  await input.fill("short");
  await input.press("Enter");
  await expect(card.getByText("API 키가 올바르지 않습니다")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await shot(page, "first-run-error");
  observations.push("invalid key -> inline error (Enter submits)");

  // 3. Fake key -> connected -> router selected.
  await input.fill(FAKE_KEY);
  await card.getByRole("button", { name: "연결", exact: true }).click();
  await expect(page.getByText("연결됨 · Free Models Router")).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, "first-run-connected");
  await expect(
    page.getByRole("button", { name: /^모델:.*Free Models Router/ }),
  ).toBeVisible();
  assert.ok(!(await page.content()).includes(FAKE_KEY), "key not in DOM");
  assert.ok(
    !(
      await page.evaluate(() => JSON.stringify({ ...globalThis.localStorage }))
    ).includes(FAKE_KEY),
  );
  observations.push("fake key -> 연결됨 · Free Models Router, router selected");

  // 4. A free model answers 404 -> fallback resends on the router.
  const composer = page.getByRole("textbox", { name: "메시지 작성" });
  const panel = await openComposerPopover(page, "model");
  await panel.getByRole("combobox", { name: "모델 검색" }).fill("free");
  const freeOption = panel
    .getByRole("option")
    .filter({ hasNotText: "Free Models Router" })
    .first();
  await expect(freeOption).toBeVisible();
  const freeId = await freeOption.getAttribute("data-model-option");
  await freeOption.click();
  await composer.fill("FALLBACK-PROMPT");
  await page
    .getByRole("button", { name: "메시지 보내기", exact: true })
    .click();
  const note = page.locator('[data-free-failure="unavailable"]');
  await expect(note).toContainText("이 모델은 지금 무료로 쓸 수 없습니다.", {
    timeout: 90_000,
  });
  await shot(page, "free-failure");
  const before = seen.filter((r) => r.tools).length;
  await note
    .getByRole("button", { name: "Free Models Router로 다시 보내기" })
    .click();
  await expect(page.getByText("Router mock reply.")).toBeVisible({
    timeout: 90_000,
  });
  const resent = seen.filter((r) => r.tools).slice(before);
  assert.ok(
    resent.some((r) => r.model === "openrouter/free" && r.text),
    "same prompt resent on openrouter/free",
  );
  // The 404 model is remembered and tagged in the picker (still selectable).
  const again = await openComposerPopover(page, "model");
  await expect(
    again.locator(`[data-model-option="${freeId}"]`).getByText("사용 불가"),
  ).toBeVisible();
  await shot(page, "picker-unavailable");
  observations.push(
    "free 404 -> fallback button -> resent on router; picker tags 사용 불가",
  );

  // 5. A provider rejection (401) shows inline on its turn, not as the page
  // banner, with a short cause (never the provider's text) and a way to Settings.
  await composer.fill("AUTH-PROMPT");
  await page
    .getByRole("button", { name: "메시지 보내기", exact: true })
    .click();
  const authNote = page.locator('[data-free-failure="auth"]');
  await expect(authNote).toContainText(
    "제공자가 요청을 거부했습니다. 키 또는 요금제를 확인하세요.",
    { timeout: 90_000 },
  );
  await expect(
    authNote.getByRole("button", { name: "설정 열기" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "요청을 완료하지 못했습니다. 연결과 현재 상태를 다시 확인하세요.",
    ),
  ).toHaveCount(0);
  assert.ok(
    !(await page.content()).includes("PROVIDER-PRIVATE-TEXT"),
    "provider text not in DOM",
  );
  await shot(page, "auth-failure");
  observations.push("provider 401 -> inline auth note, no page banner");

  assert.ok(!stderr.includes(FAKE_KEY), "key not in Main stderr");
  assert.ok(seen.some((r) => r.auth === `Bearer ${FAKE_KEY}`));
} catch (error) {
  console.error(
    "stderr tail:",
    stderr.split("\n").slice(-15).join("\n").replaceAll(FAKE_KEY, "<key>"),
  );
  throw error;
} finally {
  clearTimeout(hard);
  if (application) {
    const exited = once(application.process(), "exit");
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await Promise.race([exited, new Promise((r) => setTimeout(r, 30_000))]);
  }
  mock.close();
  await rm(fixture, { recursive: true, force: true });
  console.log(JSON.stringify({ observations, mockRequests: seen.length }));
}
