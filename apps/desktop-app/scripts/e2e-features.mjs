// Feature e2e: command palette, terminal, plans, permission mode, data export,
// automation, preferences. Real Electron UI with an isolated HOME; no live model.
import {
  openMoreMenuItem,
  openSettings,
  openWorkspaceMenu,
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
import { auditDialogFocus, auditDom, auditTabOrder } from "./e2e-a11y.mjs";
import {
  auditContrast,
  auditFieldBoundaries,
  auditFocusIndicators,
  createVisualAudit,
} from "./e2e-a11y-visual.mjs";

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
const typedProject = join(fixture, "typed-project");
await mkdir(scratch);
await mkdir(project);
await mkdir(typedProject);
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
      const notes = await fn();
      results.push({
        name,
        status: "pass",
        ms: Date.now() - started,
        ...(typeof notes === "string" && { notes }),
      });
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
      .getByRole("button", { name: /^E2E features session(?! 세션 작업)/ })
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
      .getByRole("tab", { name: label, exact: true });
    if (!(await tab.count()))
      await page
        .getByRole("button", { name: "보조 패널", exact: true })
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
      // Opening the tab auto-starts the first shell.
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
      // Without a connected provider the dialog opens on 모델; the toggle is on 일반.
      const general = dialog().getByRole("tab", { name: "일반", exact: true });
      if (await general.isVisible()) await general.click();
      else
        await dialog()
          .getByRole("combobox", { name: "설정 페이지", exact: true })
          .selectOption({ label: "일반" });
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
      await openPanel("작업");
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

  const { eachTheme, visualAudit, takeAuditNotes } = createVisualAudit(page);
  const tagScope = async (locator) => {
    await locator.evaluate((el) => {
      globalThis.document
        .querySelectorAll("[data-a11y-scope]")
        .forEach((n) => n.removeAttribute("data-a11y-scope"));
      el.setAttribute("data-a11y-scope", "");
    });
    return "[data-a11y-scope]";
  };

  await check(
    "permission-presets",
    async () => {
      await selectFixture();
      const panel = await openComposerPopover(page, "permission");
      const mode = (label) =>
        panel.getByRole("radio", { name: new RegExp(`^${label}`) });
      const policy = panel.locator("[data-permission-policy-status]");
      const list = policy.locator("[data-permission-presets]");
      const observe = async () => {
        await policy
          .locator('[data-permission-policy-action="observe"]')
          .click();
        await expect(policy).toHaveAttribute(
          "data-permission-policy-status",
          "observed",
          { timeout: 30000 },
        );
      };
      await mode("범위 내 편집 허용").click();
      await expect(mode("범위 내 편집 허용")).toBeChecked({ timeout: 15000 });
      await policy.locator("summary").click();
      await observe();
      await expect(list.locator("[data-permission-preset]")).toHaveCount(4);
      await expect(list.locator('[data-current="true"]')).toHaveCount(1);
      await expect(
        list.locator('[data-permission-preset="scoped_edit"]'),
      ).toHaveAttribute("data-current", "true");
      await expect(list.locator("[aria-current]")).toContainText(
        "범위 내 편집 허용",
      );
      await expect(policy).toContainText("external_directory");
      await expect(list).toBeVisible();
      const found = await auditDom(page, "[data-permission-presets]");
      assert.equal(found.length, 0, `presets dom: ${found.join("; ")}`);
      // Visual a11y (both themes): current marker, descriptions, floor text.
      const visual = await visualAudit(
        "permission presets (current marker)",
        await tagScope(panel),
      );
      // Changing the mode makes the earlier observation stale: no current.
      await mode("읽기/계획").click();
      await expect(mode("읽기/계획")).toBeChecked({ timeout: 15000 });
      await expect(policy).toHaveAttribute(
        "data-permission-policy-status",
        "stale",
        { timeout: 15000 },
      );
      await expect(list.locator('[data-current="true"]')).toHaveCount(0);
      // Stale warning, no marker.
      visual.push(
        ...(await visualAudit(
          "permission presets (stale warning)",
          await tagScope(panel),
        )),
      );
      assert.equal(visual.length, 0, `presets visual: ${visual.join("; ")}`);
      await observe();
      await expect(
        list.locator('[data-permission-preset="read_plan"]'),
      ).toHaveAttribute("data-current", "true");
      return takeAuditNotes();
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
      await expect(rules.getByText("저장된 규칙이 없습니다.")).toBeVisible({
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
    // Without a connected provider the dialog opens on 모델; the theme is on 일반.
    const general = dialog().getByRole("tab", { name: "일반", exact: true });
    if (await general.isVisible()) await general.click();
    else
      await dialog()
        .getByRole("combobox", { name: "설정 페이지", exact: true })
        .selectOption({ label: "일반" });
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

  await check("layout-panel-width", async () => {
    const storageKey = "omoc.preferences.v1";
    const stored = () =>
      page.evaluate(
        (k) => JSON.parse(globalThis.localStorage.getItem(k) ?? "{}"),
        storageKey,
      );
    const handle = () =>
      page.getByRole("separator", { name: "상세 패널 너비" });
    const reopen = async () => {
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute(
        "data-connection",
        /connected|disconnected|unavailable|starting/,
        {
          timeout: CONNECT_TIMEOUT_MS,
        },
      );
      if (!(await handle().count()))
        await page
          .getByRole("button", { name: "보조 패널", exact: true })
          .click();
    };
    if (!(await handle().count()))
      await page
        .getByRole("button", { name: "보조 패널", exact: true })
        .click();
    await expect(handle()).toBeVisible();
    await handle().focus();
    await page.keyboard.press("Enter"); // reset to the default first
    await expect(handle()).toHaveAttribute("aria-valuenow", "420");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    await expect(handle()).toHaveAttribute("aria-valuenow", "470");
    assert.equal((await stored()).layout?.panelWidth, 470);
    // Appearance preferences saved later must not drop the layout.
    await openSettings(page);
    const general = dialog().getByRole("tab", { name: "일반", exact: true });
    if (await general.isVisible()) await general.click();
    const before = (await stored()).theme ?? "system";
    await dialog()
      .getByRole("radiogroup", { name: "테마" })
      .getByRole("radio", { name: "다크" })
      .check();
    await expect.poll(async () => (await stored()).theme).toBe("dark");
    assert.equal((await stored()).layout?.panelWidth, 470);
    const label = { system: "시스템", light: "라이트", dark: "다크" }[before];
    await dialog()
      .getByRole("radiogroup", { name: "테마" })
      .getByRole("radio", { name: label })
      .check();
    await expect.poll(async () => (await stored()).theme).toBe(before);
    assert.equal((await stored()).layout?.panelWidth, 470);
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
    await reopen();
    await expect(handle()).toHaveAttribute("aria-valuenow", "470");
    // Corrupt / out-of-range storage falls back to a valid width.
    await page.evaluate((k) => {
      const blob = JSON.parse(globalThis.localStorage.getItem(k) ?? "{}");
      globalThis.localStorage.setItem(
        k,
        JSON.stringify({ ...blob, layout: { panelWidth: "wide" } }),
      );
    }, storageKey);
    await reopen();
    await expect(handle()).toHaveAttribute("aria-valuenow", "420");
    await page.evaluate((k) => {
      const blob = JSON.parse(globalThis.localStorage.getItem(k) ?? "{}");
      globalThis.localStorage.setItem(
        k,
        JSON.stringify({ ...blob, layout: { panelWidth: 99999 } }),
      );
    }, storageKey);
    await reopen();
    const max = Math.round(
      (await page.evaluate(() => window.innerWidth)) * 0.6,
    );
    await expect(handle()).toHaveAttribute("aria-valuenow", String(max));
    await page.evaluate(
      (k) => globalThis.localStorage.setItem(k, "{not json"),
      storageKey,
    );
    await reopen();
    await expect(handle()).toHaveAttribute("aria-valuenow", "420");
    // Reset path: double-click restores the default and persists it.
    await handle().focus();
    await page.keyboard.press("ArrowLeft");
    await handle().dblclick();
    await expect(handle()).toHaveAttribute("aria-valuenow", "420");
    assert.equal((await stored()).layout?.panelWidth, 420);
    // Pointer drag persists on release.
    const box = await handle().boundingBox();
    assert.ok(box, "resize handle has a box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 6 });
    await page.mouse.up();
    await expect(handle()).toHaveAttribute("aria-valuenow", "480");
    assert.equal((await stored()).layout?.panelWidth, 480);
    await handle().dblclick();
  });

  const failIfAny = (label, violations) =>
    assert.equal(violations.length, 0, `${label}: ${violations.join("; ")}`);

  await check("a11y-audit-detects-violations", async () => {
    // Guard against a vacuous audit: seeded violations must be reported.
    await page.evaluate(() => {
      const host = globalThis.document.createElement("div");
      host.id = "a11y-seed";
      host.innerHTML =
        '<button></button><img src="data:," /><div tabindex="3"></div>' +
        '<div role="dialog"></div><div role="radiogroup"></div>' +
        '<div role="dialog" aria-modal="true">has text but no name</div>' +
        '<div role="radiogroup"><label>one <input type="radio" /></label></div>' +
        '<div role="region">text region</div>' +
        '<input id="x" /><input id="x" />';
      globalThis.document.body.append(host);
    });
    try {
      const found = (await auditDom(page, "#a11y-seed")).join("\n");
      for (const rule of [
        "unnamed interactive: button",
        "img without alt",
        "positive tabindex",
        "unnamed region",
        "duplicate id: x",
      ])
        assert.ok(found.includes(rule), `audit missed: ${rule}\n${found}`);
      // Two of each: the empty one and the text-filled one must both be flagged.
      for (const rule of ["unnamed dialog", "unnamed radiogroup"])
        assert.equal(
          found.split(rule).length - 1,
          2,
          `audit must flag text-filled ${rule}\n${found}`,
        );
    } finally {
      await page.evaluate(() =>
        globalThis.document.getElementById("a11y-seed")?.remove(),
      );
    }
  });

  await check("a11y-workbench-shell", async () => {
    failIfAny("shell dom", await auditDom(page));
    await page.evaluate(() => globalThis.document.activeElement?.blur());
    const tabs = await auditTabOrder(page, { stops: 40 });
    failIfAny("shell tab order", tabs.violations);
    assert.ok(tabs.stops >= 8, `Tab reached ${tabs.stops} stops`);
  });

  await check("a11y-sidebar-sessions", async () => {
    const list = page.locator('section[aria-label="세션 검색과 최근 세션"]');
    await expect(list).toBeVisible();
    failIfAny(
      "sidebar dom",
      await auditDom(page, 'section[aria-label="세션 검색과 최근 세션"]'),
    );
    const sessions = list.getByRole("button", {
      name: /^E2E features session/,
    });
    assert.ok(
      (await sessions.count()) > 0,
      "the fixture session is listed as a named button",
    );
  });

  await check("a11y-settings-dialog", async () => {
    const opener = page.getByRole("button", { name: "설정", exact: true });
    // The sidebar footer button is the opener whose focus return is asserted.
    await expect(opener).toBeVisible();
    failIfAny(
      "settings focus",
      await auditDialogFocus(page, {
        open: () => openSettings(page),
        openerLocator: opener,
        dialogLocator: dialog(),
      }),
    );
    await openSettings(page);
    await expect(dialog()).toBeVisible();
    failIfAny("settings dom", await auditDom(page, "[role=dialog]"));
    const general = dialog().getByRole("tab", { name: "일반", exact: true });
    if (await general.isVisible()) await general.click();
    failIfAny("settings general dom", await auditDom(page, "[role=dialog]"));
    for (const name of ["테마", "글자 크기", "밀도"]) {
      await expect(dialog().getByRole("radiogroup", { name })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
  });

  await check("a11y-command-palette", async () => {
    await page.keyboard.press(`${mod}+k`);
    const search = page.getByRole("combobox", { name: "명령 검색" });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    failIfAny("palette dom", await auditDom(page, "[role=dialog]"));
    await expect(page.getByRole("listbox")).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(
          () => !!globalThis.document.activeElement?.closest("[role=dialog]"),
        ),
        "focus stays inside the palette",
      );
    }
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  });

  // Visual a11y: WCAG contrast (text) and keyboard focus indicators on each key
  // surface, in both themes (the app follows the OS colour scheme by default),
  // plus text-field boundaries (WCAG 1.4.11). Nothing is allow-listed here.
  await check("a11y-visual-detects-violations", async () => {
    // Guard against a vacuous audit, in both themes: bad seeds must be reported
    // and good seeds (ring, outline, pseudo-element indicators) must not.
    await page.evaluate(() => {
      // CSP forbids inline style attributes/markup: build with the CSSOM.
      const doc = globalThis.document;
      const host = doc.createElement("div");
      host.id = "a11y-visual-seed";
      Object.assign(host.style, { background: "#fff", padding: "8px" });
      const make = (tag, props, style = {}, parent = host) => {
        const el = doc.createElement(tag);
        Object.assign(el, props);
        Object.assign(el.style, style);
        parent.append(el);
        return el;
      };
      const text = { font: "14px sans-serif" };
      const p = (textContent, style, parent) =>
        make("p", { textContent }, { ...text, ...style }, parent);
      p("low contrast text", { color: "#bbb" });
      p("fine text", { color: "#222" });
      // #666 passes on white but not on the 30% black layer under it.
      const veil = make("div", {}, { background: "rgba(0,0,0,0.3)" });
      p("translucent low text", { color: "#666" }, veil);
      p(
        "dark low text",
        { color: "#333" },
        make("div", {}, { background: "#111" }),
      );
      p("gradient text", {
        color: "#222",
        backgroundImage: "linear-gradient(#fff, #eee)",
      });
      // Wrapped so the field's only candidate edges are white-on-white in both themes.
      make(
        "input",
        {},
        { border: "0", background: "#fff" },
        make("div", {}, { background: "#fff" }),
      ).setAttribute("aria-label", "seed field");
      // Bordered counterpart: #767676 on white is 4.54:1, must pass.
      make(
        "input",
        {},
        { border: "1px solid #767676", background: "#fff" },
        make("div", {}, { background: "#fff" }),
      ).setAttribute("aria-label", "bordered seed field");
      // Bordered but only 2.39:1 on its #3d3d3d wrapper, inside an outer card
      // with a strong border that must not rescue it (first edge decides).
      make(
        "input",
        {},
        { border: "1px solid #767676", background: "#3d3d3d" },
        make(
          "div",
          {},
          { background: "#3d3d3d", padding: "4px" },
          make(
            "div",
            {},
            { background: "#fff", border: "2px solid #000", padding: "4px" },
          ),
        ),
      ).setAttribute("aria-label", "weak seed field");
      // Borderless field inside a card with a strong border: the card is the
      // first edge, so this passes.
      make(
        "input",
        {},
        { border: "0", background: "transparent" },
        make(
          "div",
          {},
          { background: "#fff", padding: "4px" },
          make(
            "div",
            {},
            { background: "#fff", border: "1px solid #767676", padding: "4px" },
          ),
        ),
      ).setAttribute("aria-label", "carded seed field");
      const button = (textContent, className, style = {}) =>
        make("button", { textContent, className }, style);
      button("no indicator", "", { outline: "none" });
      button("glow only", "a11y-glow", { outline: "none" });
      button("has outline", "a11y-ok");
      button("has ring", "a11y-ring", { outline: "none" });
      button("has pseudo", "a11y-pe", {
        outline: "none",
        position: "relative",
      });
      const sheet = new globalThis.CSSStyleSheet();
      sheet.replaceSync(
        ".a11y-ok:focus-visible{outline:2px solid #000}" +
          ".a11y-glow:focus-visible{box-shadow:0 0 8px 0 #000}" +
          ".a11y-ring:focus-visible{box-shadow:0 0 0 2px #000}" +
          '.a11y-pe:focus-visible::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:#000}',
      );
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      doc.body.append(host);
    });
    try {
      await eachTheme(async (scheme) => {
        const tag = (what) => `[${scheme}] ${what}`;
        const contrast = (
          await auditContrast(page, "#a11y-visual-seed")
        ).violations.join("\n");
        for (const bad of [
          "low contrast text",
          "translucent low text",
          "dark low text",
          "background image/gradient",
        ])
          assert.ok(contrast.includes(bad), tag(`missed ${bad}\n${contrast}`));
        assert.ok(!contrast.includes("fine text"), tag(contrast));
        const field = (await auditFieldBoundaries(page, "#a11y-visual-seed"))
          .violations;
        assert.equal(field.length, 2, tag("field: " + field.join("\n")));
        assert.ok(field.join().includes('"seed field"'), tag(field.join()));
        assert.ok(field.join().includes("weak seed field"), tag(field.join()));
        assert.ok(!field.join().includes("bordered"), tag(field.join("\n")));
        assert.ok(!field.join().includes("carded"), tag(field.join("\n")));
        // The documented allow-list (reason required) is the only escape.
        assert.equal(
          (
            await auditFieldBoundaries(page, "#a11y-visual-seed", {
              allow: [{ match: /seed field"/, reason: "self-test" }],
            })
          ).violations.length,
          0,
          tag("allow-list ignored"),
        );
        const focus = (
          await auditFocusIndicators(page, "#a11y-visual-seed")
        ).violations.join("\n");
        for (const bad of ["no indicator", "glow only"])
          assert.ok(focus.includes(bad), tag(`missed ${bad}\n${focus}`));
        for (const good of ["has outline", "has ring", "has pseudo"])
          assert.ok(
            !focus.includes(good),
            tag(`false positive ${good}\n${focus}`),
          );
      });
    } finally {
      await page.evaluate(() => {
        globalThis.document.getElementById("a11y-visual-seed")?.remove();
        globalThis.document.adoptedStyleSheets = [];
      });
    }
  });

  await check("a11y-visual-workbench-shell", async () => {
    failIfAny("shell visual", await visualAudit("shell + sidebar", "body"));
    return takeAuditNotes();
  });

  await check(
    "a11y-visual-composer-permission",
    async () => {
      const panel = await openComposerPopover(page, "permission");
      await expect(
        panel.getByRole("radio", { name: /^요청마다 확인/ }),
      ).toBeEnabled({ timeout: 15000 });
      failIfAny(
        "permission visual",
        await visualAudit("permission popover", await tagScope(panel)),
      );
      await page.keyboard.press("Escape");
      return takeAuditNotes();
    },
    { needs: "runtime" },
  );

  await check(
    "a11y-visual-composer-popovers",
    async () => {
      const found = [];
      for (const [kind, surface] of [
        ["attach", "attach popover"],
        ["agent", "agent popover"],
      ]) {
        const panel = await openComposerPopover(page, kind);
        found.push(...(await visualAudit(surface, await tagScope(panel))));
        await page.keyboard.press("Escape");
      }
      failIfAny("composer popovers visual", found);
      return takeAuditNotes();
    },
    { needs: "runtime" },
  );

  await check("a11y-visual-settings-tabs", async () => {
    await openSettings(page);
    await expect(dialog()).toBeVisible();
    const tabs = dialog().getByRole("tab");
    const names = await tabs.allInnerTexts();
    assert.ok(names.length >= 2, "settings has page tabs");
    const found = [];
    for (const name of names) {
      await dialog().getByRole("tab", { name, exact: true }).click();
      found.push(
        ...(await visualAudit(`settings ${name.trim()}`, "[role=dialog]")),
      );
    }
    failIfAny("settings visual", found);
    await page.keyboard.press("Escape");
    return takeAuditNotes();
  });

  await check("a11y-visual-menus", async () => {
    const found = [];
    await openWorkspaceMenu(page);
    found.push(...(await visualAudit("workspace menu", '[role="menu"]')));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    found.push(...(await visualAudit("more menu", '[role="menu"]')));
    await page.keyboard.press("Escape");
    failIfAny("menus visual", found);
    return takeAuditNotes();
  });

  await check(
    "a11y-visual-side-panel",
    async () => {
      await openPanel("작업");
      const tabs = page.locator(".panel-tabs").getByRole("tab");
      const names = await tabs.allInnerTexts();
      assert.ok(names.length >= 2, "side panel has tabs");
      const found = [];
      // The terminal tab is an xterm canvas (not DOM text) and is audited elsewhere.
      for (const name of names.filter((n) => n.trim() !== "터미널")) {
        await page
          .locator(".panel-tabs")
          .getByRole("tab", { name: name.trim(), exact: true })
          .click();
        found.push(...(await visualAudit(`side panel ${name.trim()}`, "body")));
      }
      failIfAny("side panel visual", found);
      return takeAuditNotes();
    },
    { needs: "runtime" },
  );

  await check("a11y-visual-command-palette", async () => {
    await page.keyboard.press(`${mod}+k`);
    await expect(
      page.getByRole("combobox", { name: "명령 검색" }),
    ).toBeVisible();
    failIfAny(
      "palette visual",
      await visualAudit("command palette", "[role=dialog]"),
    );
    await page.keyboard.press("Escape");
    return takeAuditNotes();
  });

  await check(
    "typed-path-import",
    async () => {
      const menu = await openWorkspaceMenu(page);
      await menu.getByRole("menuitem", { name: "경로로 열기…" }).click();
      const field = page.getByRole("textbox", { name: "폴더 경로" });
      await field.fill(join(fixture, "does-not-exist"));
      await page.getByRole("button", { name: "경로로 가져오기" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "폴더 열기" });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("확인하거나");
      assert.ok(!(await alert.innerText()).includes("does-not-exist"));
      // Native confirm: decline first (nothing registers), then accept; the
      // dialog must show the canonical resolved path.
      await application.evaluate(({ dialog: d }) => {
        globalThis.__importPrompts = [];
        globalThis.__importAnswer = 0;
        d.showMessageBox = async (...args) => {
          const options = args.at(-1);
          globalThis.__importPrompts.push(options.detail);
          return {
            response: globalThis.__importAnswer,
            checkboxChecked: false,
          };
        };
      });
      const viaDotDot = `${typedProject}/../typed-project`;
      await field.fill(viaDotDot);
      await page.getByRole("button", { name: "경로로 가져오기" }).click();
      await expect
        .poll(() => application.evaluate(() => globalThis.__importPrompts))
        .toEqual([typedProject]);
      const declined = await bridge({ type: "snapshot" });
      assert.ok(
        !declined.value?.workspaces.some((w) => w.path === typedProject),
        "declined import registered nothing",
      );
      await application.evaluate(() => {
        globalThis.__importAnswer = 1;
      });
      await page.getByRole("button", { name: "경로로 가져오기" }).click();
      await expect(field).toBeHidden();
      const after = await bridge({ type: "snapshot" });
      assert.ok(
        after.value?.workspaces.some((w) => w.path === typedProject),
        "typed path registered",
      );
    },
    { needs: "runtime" },
  );

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
