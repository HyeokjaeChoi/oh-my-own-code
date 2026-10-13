// Provider/API-key flow against the real Electron app and OpenCode sidecar.
// A local OpenAI-compatible mock is the only "provider": OpenRouter's baseURL
// is pointed at it through the fixture opencode.json (OMOC_E2E_NATIVE_CONFIG).
// The test sets a FAKE key through the settings UI, expects it to reach the
// mock as a bearer token, then sends a message and checks the reply.
// Also checks error display (rejected key shape) and that the key is not echoed.
import assert from "node:assert/strict";
import { windowsEnv } from "./e2e-env.mjs";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150_000;
const HARD_TIMEOUT_MS = 8 * 60_000;
const FAKE_KEY = "sk-or-fake-e2e-key-0123456789";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-provider-e2e-")),
);
const scratch = join(fixture, "tmp");
await mkdir(scratch);

const seen = [];
let discoveries = 0;
const mock = createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/api/v1/models")) {
    discoveries++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          {
            type: "llm",
            key: "local-mock",
            display_name: "Local Mock",
            loaded_instances: [],
            max_context_length: 8000,
            capabilities: { trained_for_tool_use: true, vision: false },
          },
        ],
      }),
    );
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    seen.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
    });
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(404).end();
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
      content: parsed.tools?.length ? "Provider " : "Title",
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
  console.error("e2e-provider hard timeout");
  process.exit(2);
}, HARD_TIMEOUT_MS);
const observations = [];
async function start(environment) {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(root, "apps/desktop-app/dist/app")],
    env: environment,
  });
  application.process().stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-20_000);
  });
  const window = await application.firstWindow();
  await expect(
    window.locator(".workbench-header [data-state]"),
  ).toHaveAttribute("data-state", "connected", { timeout: CONNECT_TIMEOUT_MS });
  return window;
}
async function stop() {
  if (!application) return;
  const exited = once(application.process(), "exit");
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await Promise.race([exited, new Promise((r) => setTimeout(r, 30_000))]);
  application = undefined;
}
try {
  const page = await start(env);
  const composer = page.getByRole("textbox", { name: "메시지 작성" });
  await expect(composer).toBeVisible();

  // No credential yet: the provider has no usable model.
  await page.getByRole("button", { name: "설정·단축키" }).click();
  const section = page.getByRole("region", { name: "모델 제공자" });
  await expect(section).toBeVisible();
  await section.getByLabel("제공자 선택").selectOption({ label: "OpenRouter" });

  // Error state: a malformed key is refused with a visible message.
  await section.getByLabel("API 키").fill("short");
  await section.getByRole("button", { name: "키 저장" }).click();
  await expect(section.getByRole("alert")).toContainText(
    "API 키가 올바르지 않습니다",
  );
  observations.push("malformed key -> visible error");

  // Connect with the fake key.
  await section.getByLabel("API 키").fill(FAKE_KEY);
  await section.getByRole("button", { name: "키 저장" }).click();
  await expect(section.getByText("API 키를 설정했습니다.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(section.getByLabel("API 키")).toHaveValue("");
  await expect(section.getByText("OpenRouter · 설정됨")).toBeVisible();
  assert.ok(!(await section.innerText()).includes(FAKE_KEY), "key not echoed");
  observations.push(
    "key stored via Native; UI shows 설정됨, input cleared, key not echoed",
  );

  // Default model: pick the first provider model; it persists in localStorage.
  const defaults = section.getByLabel("기본 모델");
  await expect
    .poll(async () => (await defaults.locator("option").count()) > 1, {
      timeout: 60_000,
    })
    .toBe(true);
  const firstValue = await defaults
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await defaults.selectOption(firstValue);
  assert.equal(
    await page.evaluate(() =>
      globalThis.localStorage.getItem("omoc.defaultModel.v1"),
    ),
    firstValue,
  );
  observations.push("model list populated after connect; default model saved");
  await page.keyboard.press("Escape");

  // Send: the default model is preselected; the mock sees the fake key.
  await composer.fill("hello");
  await expect(async () => {
    await page
      .getByRole("button", { name: "메시지 보내기", exact: true })
      .click();
    await expect(composer).toHaveValue("", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText("Provider mock reply.")).toBeVisible({
    timeout: 90_000,
  });
  assert.ok(
    seen.some((r) => r.auth === `Bearer ${FAKE_KEY}`),
    "mock received the stored key as a bearer token",
  );
  observations.push("send -> mock reply rendered; mock received the key");

  // The key must not leak into the renderer, its storage, or Main's stderr.
  assert.ok(!(await page.content()).includes(FAKE_KEY), "key not in DOM");
  assert.ok(
    !(
      await page.evaluate(() => JSON.stringify({ ...globalThis.localStorage }))
    ).includes(FAKE_KEY),
  );
  assert.ok(!stderr.includes(FAKE_KEY), "key not in Main stderr");
  const profileFiles = async (dir) =>
    (await readdir(dir, { withFileTypes: true, recursive: true }))
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name));
  const profile = join(fixture, "app-profile");
  const live = (await profileFiles(profile)).filter(
    (f) =>
      f.endsWith(join("native", "config", "opencode", "opencode.json")) ||
      /native[\\/]log[\\/]/u.test(f),
  );
  assert.ok(
    live.some((f) => f.endsWith("opencode.json")),
    "profile config",
  );
  for (const f of live)
    assert.ok(!(await readFile(f, "utf8")).includes(FAKE_KEY), f);
  observations.push(
    "key absent from DOM, localStorage, stderr, profile opencode.json/logs",
  );

  await page.getByRole("button", { name: "설정·단축키" }).click();

  // Local provider: LM Studio base URL set through the UI -> its models appear.
  await section
    .getByLabel("로컬 제공자 주소")
    .fill(`http://127.0.0.1:${port}/v1`);
  await section.getByRole("button", { name: "주소 저장" }).click();
  await expect(
    section.getByText(/로컬 제공자 주소를 저장했습니다/u),
  ).toBeVisible();
  // Native reads the address at startup: relaunch the same profile (no reseed).
  await stop();
  const { OMOC_E2E_NATIVE_CONFIG: _seed, ...relaunchEnv } = env;
  const again = await start(relaunchEnv);
  await again.getByRole("button", { name: "설정·단축키" }).click();
  await expect(
    again
      .getByRole("region", { name: "모델 제공자" })
      .getByLabel("로컬 제공자 주소"),
  ).toHaveValue(`http://127.0.0.1:${port}/v1`);
  await expect.poll(() => discoveries, { timeout: 60_000 }).toBeGreaterThan(0);
  // Workspace trust persists across restart, so the catalog is not empty.
  await expect
    .poll(
      async () =>
        again
          .getByRole("region", { name: "모델 제공자" })
          .getByLabel("기본 모델")
          .locator("option")
          .count(),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(1);
  observations.push(
    "local base URL saved via UI; after relaunch Native discovered models at that address; catalog has models (workspace trust persisted)",
  );

  // Remove: connection disappears (after relaunch, where the stored key still works).
  const again2 = again.getByRole("region", { name: "모델 제공자" });
  await again2.getByRole("button", { name: "OpenRouter 연결 해제" }).click();
  await expect(again2.getByText("API 키를 제거했습니다.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(again2.getByText("OpenRouter · 설정됨")).toHaveCount(0);
  observations.push("remove key -> connection gone");
} catch (error) {
  console.error(
    "stderr tail:",
    stderr
      .split("\n")
      .filter((l) => !l.includes('"kind":"reject"'))
      .slice(-15)
      .join("\n")
      .replaceAll(FAKE_KEY, "<key>"),
  );
  throw error;
} finally {
  clearTimeout(hard);
  await stop();
  mock.close();
  console.log(JSON.stringify({ observations, mockRequests: seen.length }));
}
