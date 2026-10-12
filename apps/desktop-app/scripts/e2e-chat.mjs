// Real chat round-trip against the real Electron app and OpenCode sidecar.
// A tiny local OpenAI-compatible mock (SSE) is the only "provider": OpenCode's
// built-in LM Studio provider is pointed at it through the fixture profile's
// opencode.json (providers/model). No real credentials are read or sent.
//   turn 1: "hello" -> streamed reply
//   turn 2: mock asks for a `write` tool call -> permission prompt -> approve
//           -> file written -> tool result -> final reply
//   turn 3: mock asks for a `read` tool call (inside the workspace) -> result
//           -> final reply
// OMOC_E2E_CONNECT_TIMEOUT_MS (default 150s) bounds the runtime connect wait.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { createWorkbenchBridge } from "./e2e-bridge.mjs";

const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150_000;
const HARD_TIMEOUT_MS = 12 * 60_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const FILE_TEXT = "FIXTURE-FILE-CONTENT-7f3a";
const WRITE_TEXT = "WRITTEN-BY-MOCK-TOOL-CALL";

const fixture = await realpath(await mkdtemp(join(tmpdir(), "omoc-chat-e2e-")));
const scratch = join(fixture, "tmp");
await mkdir(scratch);

// --- mock OpenAI-compatible (LM Studio flavoured) server ------------------
const requests = [];
const sse = (res, chunks) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  const base = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-model",
  };
  for (const delta of chunks)
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
  const finish = chunks.some((c) => c.tool_calls) ? "tool_calls" : "stop";
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
};
const text = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text ?? "").join("")
      : "";
const mock = createServer((req, res) => {
  // OpenCode's built-in LM Studio provider discovers models from this route.
  if (req.method === "GET" && req.url?.startsWith("/api/v1/models")) {
    requests.push({ url: "/api/v1/models", tools: 0 });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          {
            type: "llm",
            key: "mock-model",
            display_name: "Mock Model",
            loaded_instances: [],
            max_context_length: 200000,
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
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const messages = parsed.messages ?? [];
    requests.push({ url: req.url, tools: parsed.tools?.length ?? 0 });
    const last = messages.at(-1);
    const users = messages
      .filter((m) => m.role === "user")
      .map((m) => text(m.content));
    if (!parsed.tools?.length)
      return sse(res, [{ role: "assistant", content: "Mock title" }]);
    if (last?.role === "tool")
      return sse(res, [
        { role: "assistant", content: "Tool result received: " },
        {
          content:
            last.tool_call_id === "call_mock_write"
              ? "write done"
              : text(last.content).includes(FILE_TEXT)
                ? "file read ok"
                : "file missing",
        },
      ]);
    const command = /^(READ|WRITE)-FIXTURE:(\S+)/u.exec(users.at(-1) ?? "");
    if (command) {
      const write = command[1] === "WRITE";
      return sse(res, [
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: write ? "call_mock_write" : "call_mock_read",
              type: "function",
              function: {
                name: write ? "write" : "read",
                arguments: JSON.stringify(
                  write
                    ? { path: command[2], content: WRITE_TEXT }
                    : { path: command[2] },
                ),
              },
            },
          ],
        },
      ]);
    }
    return sse(res, [
      { role: "assistant", content: "Hello " },
      { content: "from " },
      { content: "the mock model." },
    ]);
  });
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const mockPort = mock.address().port;

// The unpackaged, isolated app seeds this file as the profile's opencode.json
// before the first sidecar start (OMOC_E2E_NATIVE_CONFIG; see main.mjs).
const configFile = join(fixture, "native-config.json");
await writeFile(
  configFile,
  `${JSON.stringify({
    model: "lmstudio/mock-model",
    providers: {
      lmstudio: { settings: { baseURL: `http://127.0.0.1:${mockPort}/v1` } },
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
};

let application;
let stderr = "";
async function quit() {
  if (!application) return;
  const handle = application.process();
  const exited = once(handle, "exit");
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  let timer;
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("owned_app_exit_unconfirmed")),
        30_000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  application = undefined;
}

const hard = setTimeout(() => {
  console.error("e2e-chat hard timeout");
  process.exit(2);
}, HARD_TIMEOUT_MS);
const observations = [];
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
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
    { timeout: CONNECT_TIMEOUT_MS },
  );
  const bridge = createWorkbenchBridge(page);
  const composer = page.getByRole("textbox", { name: "메시지 작성" });
  await expect(composer).toBeVisible();
  let initial;
  await expect
    .poll(async () => (initial = await bridge({ type: "snapshot" })).ok, {
      timeout: 30_000,
    })
    .toBe(true);
  const { selectedWorkspaceId: workspaceId, selectedSessionId: sessionId } =
    initial.value;
  const workspace = initial.value.workspaces.find((w) => w.id === workspaceId);
  assert.equal(workspace.trusted, true);
  const fixtureFile = join(workspace.path, "fixture.txt");
  await writeFile(fixtureFile, `${FILE_TEXT}\n`);
  const snapshot = () => bridge({ type: "snapshot", workspaceId, sessionId });

  // Session refresh (permission.list) must succeed on a fresh profile.
  await expect
    .poll(async () => (await snapshot()).value?.error, { timeout: 30_000 })
    .toBeUndefined();
  observations.push("fresh profile: session refresh has no error");

  const idle = async () => {
    await expect
      .poll(async () => (await snapshot()).value?.sessions?.[0]?.status, {
        timeout: 60_000,
      })
      .toBe("idle");
    await expect(
      page.getByText("현재 세션은 실행 대기 상태입니다."),
    ).toBeVisible({ timeout: 60_000 });
  };
  const send = async (message) => {
    await composer.fill(message);
    // Native may report the previous run for a moment after its reply; a BUSY
    // refusal keeps the draft, so retry the click until the composer clears.
    await expect(async () => {
      await page
        .getByRole("button", { name: "메시지 보내기", exact: true })
        .click();
      await expect(composer).toHaveValue("", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
  };

  // Turn 1: streamed plain reply.
  await send("hello");
  await expect(page.getByText("Hello from the mock model.")).toBeVisible({
    timeout: 90_000,
  });
  await idle();
  observations.push("turn 1: send -> streamed mock reply rendered");

  // Turn 2: write tool call -> permission prompt -> approve -> result -> reply.
  const written = join(workspace.path, "written.txt");
  await send(`WRITE-FIXTURE:${written}`);
  const prompt = page.getByRole("region", { name: "실행 권한 요청" });
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  assert.equal(existsSync(written), false, "no write before approval");
  await prompt.getByRole("button", { name: "이번만 허용" }).click();
  await expect(page.getByText("Tool result received: write done")).toBeVisible({
    timeout: 90_000,
  });
  await expect(prompt).toHaveCount(0);
  assert.match(await readFile(written, "utf8"), new RegExp(WRITE_TEXT));
  await idle();
  observations.push(
    "turn 2: write permission prompt approved; file written; result and final reply rendered",
  );

  // Turn 3: read tool (also asks in "ask" mode) -> approve -> result -> reply.
  await send(`READ-FIXTURE:${fixtureFile}`);
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await prompt.getByRole("button", { name: "이 프로젝트에서 항상 허용" }).click();
  await expect(
    page.getByText("Tool result received: file read ok"),
  ).toBeVisible({ timeout: 90_000 });
  await idle();
  observations.push(
    "turn 3: read permission approved (always); result and final reply",
  );

  // Mode change: scoped_edit auto-allows an in-workspace write (no prompt).
  // The mode select may be refused (BUSY) for a moment after the last reply.
  await expect(async () => {
    await page
      .getByRole("combobox", { name: "권한 모드" })
      .selectOption({ label: "범위 내 편집 허용" });
    await expect
      .poll(
        async () => (await snapshot()).value?.sessions?.[0]?.permissionMode,
        { timeout: 3_000 },
      )
      .toBe("scoped_edit");
  }).toPass({ timeout: 60_000 });
  const written2 = join(workspace.path, "written2.txt");
  await send(`WRITE-FIXTURE:${written2}`);
  await expect(page.getByText("Tool result received: write done")).toHaveCount(
    2,
    { timeout: 90_000 },
  );
  assert.equal(await prompt.count(), 0, "no prompt in scoped_edit");
  assert.match(await readFile(written2, "utf8"), new RegExp(WRITE_TEXT));
  observations.push("mode change: scoped_edit write ran without a prompt");
  assert.ok(requests.some((r) => r.tools > 0));
} catch (error) {
  try {
    const page = await application.firstWindow();
    const state = await createWorkbenchBridge(page)({ type: "snapshot" });
    const { messages, permissions, sessions, error } = state.value ?? {};
    console.error(
      "alerts:",
      await page.getByRole("alert").allInnerTexts(),
      JSON.stringify({
        runtime: state.value?.state,
        recovery: state.value?.recovery,
        retained: state.value?.retainedOperations,
        error,
        messages,
        permissions,
        sessions,
      }).slice(0, 4000),
    );
  } catch {
    /* best effort */
  }
  throw error;
} finally {
  clearTimeout(hard);
  await quit().catch((error) => console.error(String(error)));
  console.log(
    "native diagnostics (non-reject):\n" +
      stderr
        .split("\n")
        .filter((line) => !line.includes('"kind":"reject"'))
        .slice(-20)
        .join("\n"),
  );
  mock.close();
  console.log(JSON.stringify({ observations, mockRequests: requests.length }));
}
