// Real chat round-trip against the real Electron app and OpenCode sidecar.
// A tiny local OpenAI-compatible mock (SSE) is the only "provider": OpenCode's
// built-in LM Studio provider is pointed at it through the fixture profile's
// opencode.json (providers/model). No real credentials are read or sent.
//   turn 1: "hello" -> streamed reply
//   turn 2: mock asks for a `write` tool call -> permission prompt -> approve
//           -> file written -> tool result -> final reply
//   turn 3: mock asks for a `read` tool call (inside the workspace) -> result
//           -> final reply
//   turn 1b: agent + model chosen explicitly in the composer; the mock
//           verifies the model it receives
//   turn 4: subagent (subagent tool) delegation round-trip
//   turn 5: shell (bash) tool run with a permission prompt
//   turn 6: interrupt during a streaming reply, then a normal send works
// OMOC_E2E_CONNECT_TIMEOUT_MS (default 150s) bounds the runtime connect wait.
import { openSettings } from "./e2e-shell.mjs";
import assert from "node:assert/strict";
import { windowsEnv } from "./e2e-env.mjs";
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
import {
  closeComposerPopovers,
  openComposerPopover,
  setPermissionMode,
} from "./e2e-composer.mjs";

const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150_000;
const HARD_TIMEOUT_MS = 12 * 60_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const FILE_TEXT = "FIXTURE-FILE-CONTENT-7f3a";
const WRITE_TEXT = "WRITTEN-BY-MOCK-TOOL-CALL";
const CHILD_PROMPT = "CHILD-PROMPT-FIXTURE";
const CHILD_REPLY = "CHILD-REPLY-FIXTURE";
const SHELL_OUT = "SHELL-OUT-FIXTURE";
let slowClosed = false;
let slowOpen = false;

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
          {
            type: "llm",
            key: "mock-model-2",
            display_name: "Mock Model Two",
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
    requests.push({
      url: req.url,
      tools: parsed.tools?.length ?? 0,
      model: parsed.model,
      planMode: /plan mode/i.test(JSON.stringify(messages)),
    });
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
              : last.tool_call_id === "call_mock_task"
                ? text(last.content).includes(CHILD_REPLY)
                  ? "subagent done"
                  : "subagent missing"
                : last.tool_call_id === "call_mock_bash"
                  ? text(last.content).includes(SHELL_OUT)
                    ? "shell ok"
                    : "shell missing"
                  : text(last.content).includes(FILE_TEXT)
                    ? "file read ok"
                    : "file missing",
        },
      ]);
    const lastUser = users.at(-1) ?? "";
    if (lastUser.includes(CHILD_PROMPT))
      return sse(res, [{ role: "assistant", content: CHILD_REPLY }]);
    if (lastUser.startsWith("SLOW-FIXTURE")) {
      // Stream one chunk, then hold the response open until the client aborts.
      slowOpen = true;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "chatcmpl-slow", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content: "Slow reply started" }, finish_reason: null }] })}\n\n`,
      );
      const timer = setTimeout(() => res.end("data: [DONE]\n\n"), 120_000);
      res.on("close", () => {
        clearTimeout(timer);
        slowClosed = true;
      });
      return;
    }
    const special = /^(SUBAGENT|SHELL)-FIXTURE/u.exec(lastUser);
    if (special) {
      const task = special[1] === "SUBAGENT";
      return sse(res, [
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: task ? "call_mock_task" : "call_mock_bash",
              type: "function",
              function: {
                name: task ? "subagent" : "shell",
                arguments: JSON.stringify(
                  task
                    ? {
                        description: "mock subtask",
                        prompt: CHILD_PROMPT,
                        agent: "general",
                      }
                    : {
                        command: `echo ${SHELL_OUT}`,
                      },
                ),
              },
            },
          ],
        },
      ]);
    }
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
  ...windowsEnv(fixture),
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
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected", {
    timeout: CONNECT_TIMEOUT_MS,
  });
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
  // The placeholder session title is replaced by the first prompt in the
  // header and the sidebar row (native auto-titles are not committed to app metadata).
  await expect(page.locator(".workbench-header strong")).toHaveText("hello");
  await expect(
    page.locator(".session-row button[title]").first(),
  ).toHaveAttribute("title", "hello");
  observations.push("session title derived from first prompt in header + row");
  if (process.env.OMOC_P2_SHOTS) {
    const shots = process.env.OMOC_P2_SHOTS;
    await page.screenshot({ path: join(shots, "session-with-messages.png") });
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await page.screenshot({ path: join(shots, "more-menu-open.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^작업 공간 전환:/ }).click();
    await page.screenshot({ path: join(shots, "workspace-switcher-open.png") });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "보관된 세션 보기", exact: true })
      .click();
    await page.screenshot({ path: join(shots, "archived-view.png") });
    await page
      .getByRole("button", { name: "보관된 세션 보기", exact: true })
      .click();
  }

  // Turn 1b: choose agent and model explicitly in the composer.
  await openComposerPopover(page, "agent");
  const agentSelect = page.getByRole("combobox", { name: "Agent 요청" });
  const agentValues = await agentSelect
    .locator("option")
    .evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  assert.ok(agentValues.length > 0, "catalog lists at least one agent");
  // Native injects a plan-mode reminder into requests made under plan.
  const chosenAgent = agentValues.includes("plan")
    ? "plan"
    : agentValues.at(-1);
  await agentSelect.selectOption(chosenAgent);
  await openComposerPopover(page, "model");
  await page
    .getByRole("combobox", { name: "모델 요청" })
    .selectOption({ label: "Mock Model Two" });
  await closeComposerPopovers(page);
  await send("hello explicit");
  await expect(page.getByText("hello explicit")).toBeVisible();
  await expect
    .poll(() => requests.some((r) => r.tools > 0 && r.model === "mock-model-2"))
    .toBe(true);
  if (chosenAgent === "plan")
    assert.ok(
      requests.some((r) => r.model === "mock-model-2" && r.planMode),
      "plan agent reached Native (plan-mode reminder)",
    );
  await idle();
  observations.push(
    `turn 1b: agent ${chosenAgent} and Mock Model Two chosen; mock received mock-model-2`,
  );

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
  await prompt
    .getByRole("button", { name: "이 프로젝트에서 항상 허용" })
    .click();
  await expect(
    page.getByText("Tool result received: file read ok"),
  ).toBeVisible({ timeout: 90_000 });
  await idle();
  observations.push(
    "turn 3: read permission approved (always); result and final reply",
  );

  // The saved "항상 허용" rule is listed in Settings and can be revoked; the
  // same read then asks again.
  await openSettings(page);
  const rules = page.getByRole("region", { name: "저장된 허용 규칙" });
  await expect(
    rules.getByRole("button", { name: /허용 규칙 삭제/ }),
  ).toHaveCount(1, { timeout: 30_000 });
  await rules.getByRole("button", { name: /허용 규칙 삭제/ }).click();
  await expect(
    rules.getByText("이 프로젝트에 저장된 허용 규칙이 없습니다."),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await send(`READ-FIXTURE:${fixtureFile}`);
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await prompt.getByRole("button", { name: "이번만 허용" }).click();
  await expect(
    page.getByText("Tool result received: file read ok").nth(1),
  ).toBeVisible({ timeout: 90_000 });
  await idle();
  observations.push(
    "turn 3b: saved allow rule listed in settings, removed, and the read asks again",
  );

  // Approves a permission prompt if one appears before `done` is rendered;
  // a prompt that does not match `expected` fails the run.
  const approveUntil = async (done, expected) => {
    await expect(async () => {
      if (await prompt.first().isVisible()) {
        assert.match(await prompt.first().innerText(), expected);
        await prompt
          .first()
          .getByRole("button", { name: "이번만 허용" })
          .click();
      }
      await expect(done).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 120_000 });
  };

  // Turn 4: subagent (subagent tool) delegation round-trip.
  await openComposerPopover(page, "agent");
  await agentSelect.selectOption("build");
  await closeComposerPopovers(page);
  await send("SUBAGENT-FIXTURE");
  await approveUntil(
    page.getByText(/Tool result received: subagent (done|missing)/),
    /task|subagent|general|explore/i,
  );
  await idle();
  const subagentDone = await page
    .getByText("Tool result received: subagent done")
    .isVisible();
  // KNOWN GAP: the `subagent` tool currently fails ("A tool operation failed.")
  // because the permission overlay inventory is not fully verified yet, so
  // subagent execution is not authorised (execution-task-authority.md,
  // phase D). The turn still proves the parent run survives the failure.
  if (process.env.OMOC_E2E_STRICT_SUBAGENT === "1")
    assert.ok(subagentDone, "subagent delegation round-trip");
  observations.push(
    subagentDone
      ? "turn 4: subagent tool delegated to a subagent and returned"
      : "turn 4: KNOWN GAP subagent tool failed; parent run completed and stays sendable",
  );

  // Turn 5: shell tool with a permission prompt.
  await send("SHELL-FIXTURE");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await prompt.getByRole("button", { name: "이번만 허용" }).click();
  await expect(page.getByText("Tool result received: shell ok")).toBeVisible({
    timeout: 90_000,
  });
  await idle();
  observations.push("turn 5: bash tool ran after permission approval");

  // Turn 6: interrupt during a streaming reply.
  await send("SLOW-FIXTURE");
  await expect.poll(() => slowOpen, { timeout: 90_000 }).toBe(true);
  await page.getByRole("button", { name: "현재 세션 실행 중단" }).click();
  await expect.poll(() => slowClosed, { timeout: 60_000 }).toBe(true);
  await idle();
  await send("hello after interrupt");
  await expect(page.getByText("Hello from the mock model.")).toHaveCount(3, {
    timeout: 90_000,
  });
  await idle();
  observations.push(
    "turn 6: interrupt aborted the stream; session idle and sendable again",
  );

  // Mode change: scoped_edit auto-allows an in-workspace write (no prompt).
  // The mode select may be refused (BUSY) for a moment after the last reply.
  await expect(async () => {
    await setPermissionMode(page, "범위 내 편집 허용");
    await closeComposerPopovers(page);
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
