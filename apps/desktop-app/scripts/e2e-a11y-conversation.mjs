// Visual a11y of the conversation with tool cards and a pending permission
// request (contrast + keyboard focus indicators, light and dark). Uses the
// synthetic UI fixture host: e2e-features has no model, so no tool cards there.
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { e2ePath } from "./e2e-env.mjs";
import { createVisualAudit } from "./e2e-a11y-visual.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-a11y-conversation-")),
);
const tool = (id, name, input, output = "ok", status = "completed") => ({
  id,
  name,
  status,
  input: JSON.stringify(input),
  output,
});
const messages = [
  { id: "u1", role: "user", text: "도구 카드를 보여 주세요.", tools: [] },
  {
    id: "a1",
    role: "assistant",
    text: "아래는 도구 실행 결과입니다.",
    tools: [
      tool(
        "t-read",
        "read",
        { filePath: "src/main.ts" },
        "export {};\nconst a = 1;",
      ),
      tool("t-edit", "edit", {
        filePath: "src/main.ts",
        oldString: "const a = 1;",
        newString: "const a = 2;",
      }),
      tool("t-write", "write", {
        filePath: "notes.md",
        content: "# 메모\n내용",
      }),
      tool("t-bash", "bash", { command: "echo hello" }, "hello"),
      tool("t-grep", "grep", { pattern: "needle" }, "src/a.ts:3:needle here"),
      tool("t-todo", "todowrite", {
        todos: [
          { content: "첫 작업", status: "completed" },
          { content: "둘째 작업", status: "pending" },
        ],
      }),
      tool(
        "t-fail",
        "read",
        { filePath: "missing.ts" },
        "파일을 찾을 수 없습니다.",
        "error",
      ),
      tool("t-generic", "unknown_tool", {}, "결과 텍스트"),
    ],
  },
];

let application;
let failure;
try {
  application = await electron.launch({
    timeout: 30000,
    executablePath: require("electron"),
    args: [
      join(desktop, "scripts/fixtures/workbench-host.mjs"),
      "--user-data-dir=" + join(fixtureRoot, "bootstrap"),
    ],
    env: {
      PATH: e2ePath(),
      HOME: fixtureRoot,
      TMPDIR: fixtureRoot,
      TMP: fixtureRoot,
      TEMP: fixtureRoot,
      OMOC_UI_TEST_ROOT: fixtureRoot,
      OMOC_DESKTOP_E2E_BACKGROUND: "1",
      OMOC_APP_DATA_DIR: join(fixtureRoot, "app-profile"),
    },
  });
  const page = await application.firstWindow();
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await application.evaluate((_e, list) => {
    const f = globalThis.__omocUiFixture;
    f.enablePerformanceSessions();
    f.snapshot.sessions[0].status = "idle";
    f.snapshot.messages = list;
    f.sessionMessages.set("fixture-s", list);
    f.snapshot.permissions = [
      {
        id: "permission-a11y",
        sessionId: "fixture-s",
        title: "파일 읽기",
        detail: "src/main.ts",
      },
    ];
    f.snapshot.revision++;
    f.snapshot.observationSequence++;
  }, messages);
  await page.reload();
  await expect(page.getByText("아래는 도구 실행 결과입니다.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "실행 권한 요청" }),
  ).toHaveCount(1);
  const cards = await page.locator("[data-tool-card],.tool-heading").count();
  assert.ok(cards > 0, "tool cards are rendered");
  // Tool cards are collapsed <details>: open them so diff/output text is audited.
  // Open details only (clicking triggers could change state); a few rounds
  // because nested details mount once their parent is open.
  for (let round = 0; round < 3; round++)
    await page.evaluate(() => {
      for (const d of globalThis.document.querySelectorAll(
        "details:not([open])",
      ))
        d.open = true;
    });
  // Pin what the audit must see, so a layout change cannot silently empty it:
  // the error badge (the dark-theme contrast fix) and expanded-only output.
  await expect(
    page.locator('[data-tool-state="error"] summary [class*=summaryState]'),
  ).toHaveText("오류");
  await expect(page.getByText("src/a.ts:3:needle here")).toBeVisible();
  const { visualAudit, takeAuditNotes } = createVisualAudit(page);
  const found = await visualAudit("conversation + tool cards", "body");
  assert.equal(found.length, 0, found.join("\n"));
  console.log(JSON.stringify({ result: "pass", notes: takeAuditNotes() }));
} catch (error) {
  failure = error;
  console.error(String(error?.message ?? error).slice(0, 4000));
  process.exitCode = 1;
} finally {
  await application?.evaluate(({ app }) => app.quit()).catch(() => {});
  await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
}
void failure;
