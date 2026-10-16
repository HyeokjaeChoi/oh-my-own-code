// Feature e2e: command palette, terminal, plans, permission mode, data export,
// automation, preferences. Real Electron UI with an isolated HOME; no live model.
import {
  openMoreMenuItem,
  openSettings,
  selectWorkspace,
} from "./e2e-shell.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { createWorkbenchBridge } from "./e2e-bridge.mjs";
import { openComposerPopover } from "./e2e-composer.mjs";

const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const run = resolve(
  process.env.OMOC_EVIDENCE_DIR ?? join(root, "docs/runs/desktop-features"),
);
await mkdir(run, { recursive: true });
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-features-e2e-")),
);
const scratch = join(fixture, "tmp");
const project = join(fixture, "sample-project");
const SECRET = "never-render-this-fixture";
await mkdir(scratch);
await mkdir(project);
await writeFile(join(project, ".env"), `SYNTHETIC_SECRET=${SECRET}\n`);
await writeFile(
  join(project, "package.json"),
  JSON.stringify({
    name: "sample-project",
    private: true,
    scripts: { hello: "echo omoc-script-$((1+2))" },
  }),
);
await writeFile(join(project, "notes.md"), "# fixture\n");
const git = (...args) =>
  execFileSync("git", args, { cwd: project, stdio: "ignore" });
git("init", "-q");
git("add", "package.json", "notes.md");
git(
  "-c",
  "user.name=e2e",
  "-c",
  "user.email=e2e@example.invalid",
  "commit",
  "-q",
  "-m",
  "fixture",
);
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  OMOC_DESKTOP_E2E_BACKGROUND: process.env.OMOC_E2E_FOREGROUND ? "" : "1",
  OMOC_APP_DATA_DIR: join(fixture, "app-profile"),
  HOME: fixture,
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  ...(process.platform === "win32" && {
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    USERPROFILE: fixture,
    APPDATA: join(fixture, "AppData/Roaming"),
    LOCALAPPDATA: join(fixture, "AppData/Local"),
  }),
};
// Electron intermittently exits during startup on a loaded machine; retry.
let application;
for (let attempt = 1; !application; attempt++) {
  try {
    application = await electron.launch({
      executablePath: require("electron"),
      args: [join(root, "apps/desktop-app/dist/app")],
      env,
    });
  } catch (error) {
    if (attempt >= 5) throw error;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const processHandle = application.process();
const results = [];
let closed = false;

async function waitForExit(timeoutMs = 20000) {
  if (processHandle.exitCode !== null) return processHandle.exitCode;
  let timer;
  try {
    return await Promise.race([
      once(processHandle, "exit").then(([code]) => code),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("owned_app_exit_unconfirmed")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  const page = await application.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Runtime-dependent checks are reported "blocked" when the sidecar is down.
  const stateOf = () =>
    page
      .locator(".workbench-header [data-connection]")
      .getAttribute("data-connection", { timeout: 1000 })
      .catch(() => "unknown");
  let connected = false;
  for (let i = 0; i < CONNECT_TIMEOUT_MS / 1000 && !connected; i++) {
    connected = (await stateOf()) === "connected";
    if (!connected) await page.waitForTimeout(1000);
  }
  const bridge = createWorkbenchBridge(page);
  const call = (channel, request) =>
    page.evaluate(([c, r]) => window.desktopBridge[c](r), [channel, request]);
  const dialog = () => page.getByRole("dialog");
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  async function check(name, fn, { needs } = {}) {
    const started = Date.now();
    try {
      if (needs === "runtime" && !workspace)
        throw Object.assign(new Error("runtime unavailable"), {
          blocked: true,
        });
      await fn();
      results.push({ name, status: "pass", ms: Date.now() - started });
    } catch (error) {
      const file = `${name}-failure.png`;
      await page.screenshot({ path: join(run, file) }).catch(() => {});
      results.push({
        name,
        status: error?.blocked ? "blocked" : "fail",
        ms: Date.now() - started,
        error: String(error?.message ?? error).slice(0, 2000),
        screenshot: file,
      });
    }
    // Reset transient UI so checks stay independent.
    for (let i = 0; i < 3 && (await dialog().count()); i++)
      await page.keyboard.press("Escape");
  }

  // Setup (not a check): import fixture, trust it via stubbed confirm dialog,
  // create a session in it and select it. Needs a connected runtime.
  let workspace;
  let sessionId;
  const selectFixture = async () => {
    // With the side panel open the sidebar is a sheet behind this button.
    await selectWorkspace(page, workspace.id);
    await page
      .getByRole("button", { name: "E2E features session", exact: true })
      .click();
    if (await dialog().count()) await page.keyboard.press("Escape");
  };
  if (connected) {
    await application.evaluate(({ dialog: d }, selected) => {
      d.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selected],
      });
      d.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, project);
    await bridge({ type: "snapshot" });
    const imported = await bridge({ type: "workspace.import" });
    workspace = imported.value?.workspaces.find((w) => w.path === project);
    if (workspace) {
      const created = await bridge({
        type: "session.create",
        workspaceId: workspace.id,
        title: "E2E features session",
      });
      sessionId = created.value?.selectedSessionId;
      if (sessionId) {
        // The import/trust/create ran out-of-band: reload so the renderer
        // store starts from the trusted state instead of a stale snapshot.
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected", {
          timeout: CONNECT_TIMEOUT_MS,
        });
        await selectFixture();
      } else workspace = undefined;
    }
  }

  const openPanel = async (label) => {
    const tab = page
      .locator(".panel-tabs")
      .getByRole("button", { name: label, exact: true });
    if (!(await tab.count()))
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
    await tab.click();
  };

  await check("command-palette", async () => {
    await page.keyboard.press(`${mod}+k`);
    const search = page.getByRole("combobox", { name: "명령 검색" });
    await expect(search).toBeVisible();
    const options = page.getByRole("option");
    const before = await options.count();
    await search.fill("설정");
    await expect(
      page.getByRole("option", { name: /설정·단축키 열기/ }),
    ).toHaveCount(1);
    assert.ok((await options.count()) < before, "filter narrows list");
    await search.fill("zzz-no-such-command");
    await expect(page.getByText("일치하는 항목이 없습니다.")).toBeVisible();
    await search.fill("설정");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "설정", exact: true }),
    ).toBeVisible();
    await expect(search).toBeHidden();
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${mod}+k`);
    await expect(search).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  });

  await check(
    "terminal-panel",
    async () => {
      await openPanel("터미널");
      const panel = page.getByRole("region", { name: "작업 공간 터미널" });
      await panel.getByRole("button", { name: "새 터미널" }).click();
      await expect(panel.getByRole("status")).toHaveText("실행 중");
      const screen = panel.getByRole("group", { name: "터미널 화면" });
      await expect(screen.locator(".xterm")).toBeVisible();
      await screen.locator(".xterm").click();
      // Arithmetic makes the result differ from the echoed command line.
      await page.keyboard.type("echo omoc-e2e-$((40+2))");
      await page.keyboard.press("Enter");
      await expect(screen).toContainText("omoc-e2e-42", { timeout: 15000 });
      await panel.getByText(/프로젝트 스크립트/).click();
      await panel.getByRole("button", { name: /run hello 실행/ }).click();
      await expect(screen).toContainText("omoc-script-3", { timeout: 20000 });
    },
    { needs: "runtime" },
  );

  await check(
    "terminal-screen-reader",
    async () => {
      // The terminal from terminal-panel is still mounted behind the sheet.
      // The modal sheet hides the page from role queries, so use a CSS locator.
      const screen = page.locator('[aria-label="터미널 화면"]');
      await expect(screen.locator(".xterm-accessibility")).toHaveCount(0);
      await openSettings(page);
      const toggle = dialog().getByLabel(/터미널 스크린 리더 모드/);
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(screen.locator(".xterm-accessibility")).toHaveCount(1);
      await toggle.uncheck();
      await expect(screen.locator(".xterm-accessibility")).toHaveCount(0);
      await page.keyboard.press("Escape");
    },
    { needs: "runtime" },
  );

  await check(
    "plans-panel",
    async () => {
      await mkdir(join(project, ".omoc/plans"), { recursive: true });
      await writeFile(
        join(project, ".omoc/plans/disk-plan.md"),
        "# Disk plan\n\n- [ ] first step\n",
      );
      await openPanel("계획");
      const panel = page.getByRole("region", { name: "계획과 검증" });
      await expect(
        panel.getByRole("button", { name: "disk-plan.md" }),
      ).toBeVisible({ timeout: 15000 });
      await panel
        .getByRole("textbox", { name: "새 계획 제목" })
        .fill("ui plan");
      await panel.getByRole("button", { name: "만들기", exact: true }).click();
      await expect(
        panel.getByRole("heading", { name: /\.omoc\/plans\/.*ui-plan.*\.md/ }),
      ).toBeVisible({ timeout: 15000 });
      await panel.getByRole("button", { name: "승인", exact: true }).click();
      await expect(panel.getByText(/승인됨 v1/).first()).toBeVisible({
        timeout: 15000,
      });
      const listed = await call("plans", {
        type: "plans.list",
        workspaceId: workspace.id,
      });
      assert.equal(listed.ok, true);
      assert.ok(
        listed.value.plans.some((p) => p.path.endsWith("disk-plan.md")),
      );
      assert.equal(listed.value.approvals.length, 1);
    },
    { needs: "runtime" },
  );

  await check(
    "permission-mode",
    async () => {
      await selectFixture();
      const panel = await openComposerPopover(page, "permission");
      const mode = (label) =>
        panel.getByRole("radio", { name: new RegExp(`^${label}`) });
      await expect(mode("요청마다 확인")).toBeEnabled({ timeout: 15000 });
      for (const label of ["범위 내 편집 허용", "읽기/계획", "요청마다 확인"]) {
        await mode(label).click();
        await expect(mode(label)).toBeChecked({ timeout: 15000 });
      }
      await mode("범위 내 편집 허용").click();
      await expect(mode("범위 내 편집 허용")).toBeChecked();
      await expect
        .poll(async () => {
          const snap = await bridge({ type: "snapshot" });
          return snap.value?.sessions.find((s) => s.id === sessionId)
            ?.permissionMode;
        })
        .toBe("scoped_edit");
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected", {
        timeout: CONNECT_TIMEOUT_MS,
      });
      await selectFixture();
      const reopened = await openComposerPopover(page, "permission");
      await expect(
        reopened.getByRole("radio", { name: /^범위 내 편집 허용/ }),
      ).toBeChecked({ timeout: 15000 });
    },
    { needs: "runtime" },
  );

  await check(
    "data-export",
    async () => {
      const out = join(fixture, "export-ui.json");
      const outMsg = join(fixture, "export-messages.json");
      await application.evaluate(({ dialog: d }, p) => {
        d.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, out);
      await openMoreMenuItem(page, "데이터·내보내기");
      await page.getByRole("button", { name: "요약 확인" }).click();
      await expect(page.getByText(/메시지 \d+개, 도구 호출/)).toBeVisible();
      await page.getByRole("button", { name: "파일로 저장" }).click();
      await expect(
        page.getByText("저장했습니다: export-ui.json"),
      ).toBeVisible();
      const ui = JSON.parse(await readFile(out, "utf8"));
      assert.equal(ui.format, "omoc-session-export");
      await page.keyboard.press("Escape");
      // Messages carrying the .env secret and home path, through the same IPC.
      await application.evaluate(({ dialog: d }, p) => {
        d.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, outMsg);
      const dotenv = await readFile(join(project, ".env"), "utf8");
      const saved = await call("data", {
        type: "export.save",
        session: { id: "e2e-export", title: "E2E export" },
        includeToolOutputs: true,
        messages: [
          {
            id: "m1",
            role: "user",
            text: `${dotenv.trim()} in ${project}/.env`,
          },
          {
            id: "m2",
            role: "assistant",
            text: `Opened ${project}/notes.md`,
            tools: [
              {
                id: "t1",
                name: "read",
                status: "completed",
                input: `${project}/.env`,
                output: dotenv,
              },
            ],
          },
        ],
      });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal(saved.value.saved, true);
      const raw = await readFile(outMsg, "utf8");
      assert.equal(raw.includes(SECRET), false, "secret leaked into export");
      assert.equal(raw.includes(project), false, "home path not redacted");
      assert.equal(raw.includes(fixture), false, "home path not redacted");
      assert.ok(raw.includes("~/sample-project/notes.md"), "home becomes ~");
      assert.ok(raw.includes("[REDACTED]"));
    },
    { needs: "runtime" },
  );

  await check(
    "automation",
    async () => {
      await openMoreMenuItem(page, "자동화");
      const sheet = dialog();
      // Closing a sheet opened from "더 보기" returns focus to that button.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "더 보기", exact: true }),
      ).toBeFocused();
      await openMoreMenuItem(page, "자동화");
      await sheet.getByRole("button", { name: "새 자동화" }).click();
      await sheet.getByLabel("이름").fill("E2E script job");
      await sheet.getByLabel("작업 공간").selectOption(workspace.id);
      await sheet.getByLabel("종류").selectOption("script");
      const script = sheet.getByRole("combobox", { name: /^스크립트/ });
      await expect(script).toContainText("hello");
      await script.selectOption("hello");
      await sheet.getByRole("button", { name: "저장" }).click();
      await expect(sheet.getByText("E2E script job")).toBeVisible();
      await expect(sheet.getByText("스크립트 hello")).toBeVisible();
      const listed = await call("automation", { type: "automation.list" });
      assert.ok(listed.value.jobs.some((j) => j.name === "E2E script job"));
      await sheet.getByRole("button", { name: "삭제" }).click();
      await expect(sheet.getByText("E2E script job")).toHaveCount(0);
      await expect(sheet.getByText("등록된 작업이 없습니다.")).toBeVisible();
    },
    { needs: "runtime" },
  );

  await check(
    "saved-rules-settings",
    async () => {
      await openSettings(page);
      await dialog().getByRole("tab", { name: "권한" }).click();
      const rules = dialog().getByRole("region", {
        name: "저장된 허용 규칙",
      });
      await expect(rules.getByText("저장된 규칙이 없습니다")).toBeVisible({
        timeout: 15000,
      });
      await expect(rules.getByText(/프로젝트별로 저장/)).toBeVisible();
      assert.equal(await rules.getByRole("button").count(), 0);
      await page.keyboard.press("Escape");
    },
    { needs: "runtime" },
  );

  await check("compact-composer", async () => {
    // Short windows pin a compact composer: input, "+", summary and send stay
    // reachable inside the viewport.
    await page.setViewportSize({ width: 760, height: 560 });
    try {
      const form = page
        .getByRole("textbox", { name: "메시지 작성" })
        .locator("xpath=ancestor::form");
      await expect(form).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "메시지 보내기" }),
      ).toBeInViewport({ ratio: 1 });
      const box = await form.boundingBox();
      assert.ok(box && box.height <= 160, `composer height ${box?.height}`);
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  });

  await check("forced-colors-borders", async () => {
    // Borderless surfaces keep a transparent 1px border, which Windows High
    // Contrast (forced colors) turns into a visible system-colour outline.
    await page.emulateMedia({ forcedColors: "active" });
    try {
      await page.getByRole("button", { name: "더 보기", exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const border = await menu.evaluate((el) => {
        const style = globalThis.getComputedStyle(el);
        return {
          width: style.borderTopWidth,
          style: style.borderTopStyle,
          color: style.borderTopColor,
        };
      });
      assert.equal(border.width, "1px");
      assert.equal(border.style, "solid");
      assert.notEqual(border.color, "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
    } finally {
      await page.emulateMedia({ forcedColors: "none" });
    }
  });

  await check("preferences-theme", async () => {
    await openSettings(page);
    const theme = dialog().getByRole("radiogroup", { name: "테마" });
    await theme.getByRole("radio", { name: "다크" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(dialog().getByRole("status")).toHaveText("저장됨");
    await theme.getByRole("radio", { name: "라이트" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await theme.getByRole("radio", { name: "다크" }).check();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  results.push({
    name: "no-renderer-page-errors",
    status: pageErrors.length ? "fail" : "pass",
    ...(pageErrors.length && { error: pageErrors.slice(0, 5).join("\n") }),
  });
  await application.evaluate(({ app }) => app.quit());
  assert.equal(await waitForExit(), 0);
  closed = true;
} catch (error) {
  results.push({ name: "harness", status: "fail", error: String(error) });
  if (!closed && processHandle.exitCode === null) {
    try {
      await application.evaluate(({ app }) => app.quit());
      closed = (await waitForExit()) === 0;
    } catch {
      console.error("Owned test application exit unconfirmed.");
    }
  }
}
const failed = results.filter((r) => r.status !== "pass");
await writeFile(
  join(run, "features-summary.json"),
  `${JSON.stringify({ platform: process.platform, results }, null, 2)}\n`,
);
console.log(JSON.stringify(results, null, 2));
if (closed && !failed.length)
  await rm(fixture, { recursive: true, force: true });
else console.error(`Fixture preserved: ${fixture}`);
process.exit(failed.length ? 1 : 0);
