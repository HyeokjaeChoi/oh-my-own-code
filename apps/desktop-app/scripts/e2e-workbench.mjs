import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const run = resolve(
  process.env.OMOC_EVIDENCE_DIR ??
    join(root, "docs/runs/desktop-workbench-core"),
);
await mkdir(run, { recursive: true });
// The host exposes canonical paths. macOS tmpdir may use the /var alias of
// /private/var; normalize the owned fixture before comparing native results.
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-workbench-e2e-")),
);
const scratch = join(fixture, "tmp");
const project = join(fixture, "sample-project");
await mkdir(scratch);
await mkdir(project);
await writeFile(
  join(project, "notes.md"),
  "# Local preview\n\nDisposable workbench validation.\n",
);
await writeFile(
  join(project, ".env"),
  "SYNTHETIC_SECRET=never-render-this-fixture\n",
);
await writeFile(join(fixture, "outside.txt"), "Outside registered workspace\n");
await symlink(join(fixture, "outside.txt"), join(project, "escape.txt"));
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
const application = await electron.launch({
  executablePath: require("electron"),
  args: [join(root, "apps/desktop-app/dist/app")],
  env,
});
const processHandle = application.process();
let closed = false;
let profile;
let childPids = [];
const observations = [];

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
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
    { timeout: 30000 },
  );
  const composer = page.getByRole("textbox", { name: "메시지 작성" });
  await expect(composer).toBeVisible();
  const bridge = (request) =>
    page.evaluate((value) => window.desktopBridge.workbench(value), request);
  const initial = await bridge({ type: "snapshot" });
  assert.equal(initial.ok, true);
  assert.equal(initial.value.state, "connected");
  assert.ok(initial.value.selectedWorkspaceId);
  assert.ok(initial.value.selectedSessionId);
  const workspaceId = initial.value.selectedWorkspaceId;
  const sessionId = initial.value.selectedSessionId;
  const originalTitle = initial.value.sessions.find(
    (item) => item.id === sessionId,
  ).title;
  assert.equal(initial.value.temporary, true);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  assert.equal(await page.locator("iframe,webview").count(), 0);
  observations.push(
    "real Electron workbench and assistant-ui composer with owned OpenCode sidecar",
  );

  const malformed = await bridge({
    type: "arbitrary.rpc",
    command: "not-executable",
  });
  assert.equal(malformed.ok, false);
  const wrongSession = await bridge({
    type: "snapshot",
    workspaceId,
    sessionId: "missing-session",
  });
  assert.equal(wrongSession.ok, false);
  observations.push("closed IPC operations and unknown session rejected");

  // These pickers are replaced only inside this owned test process. This checks
  // renderer-to-main/filesystem integration, not native OS picker interaction.
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, project);
  const imported = await bridge({ type: "workspace.import" });
  assert.equal(imported.ok, true);
  const importedWorkspace = imported.value.workspaces.find(
    (item) => item.path === project,
  );
  assert.ok(importedWorkspace);
  assert.equal(importedWorkspace.trusted, false);
  const untrustedCatalog = await bridge({
    type: "catalog.list",
    workspaceId: importedWorkspace.id,
  });
  assert.equal(untrustedCatalog.ok, true);
  assert.equal(untrustedCatalog.value.models.status, "unavailable");
  const listed = await bridge({
    type: "file.list",
    workspaceId: importedWorkspace.id,
  });
  assert.equal(listed.ok, true);
  assert.ok(listed.value.entries.some((item) => item.name === "notes.md"));
  const preview = await bridge({
    type: "file.read",
    workspaceId: importedWorkspace.id,
    path: "notes.md",
  });
  assert.equal(preview.ok, true);
  assert.match(preview.value.content, /Disposable workbench validation/);
  for (const path of ["../outside.txt", "escape.txt", ".env"]) {
    const denied = await bridge({
      type: "file.read",
      workspaceId: importedWorkspace.id,
      path,
    });
    assert.equal(denied.ok, false, `Unsafe preview rejected: ${path}`);
    assert.equal(
      JSON.stringify(denied).includes("never-render-this-fixture"),
      false,
    );
  }
  observations.push(
    "untrusted import, actual bounded file listing/preview, secret and symlink/traversal rejection",
  );

  const created = await bridge({
    type: "session.create",
    workspaceId,
    title: "E2E second session",
  });
  assert.equal(created.ok, true);
  assert.notEqual(created.value.selectedSessionId, sessionId);
  const original = await bridge({ type: "snapshot", workspaceId, sessionId });
  assert.equal(original.ok, true);
  assert.equal(original.value.selectedSessionId, sessionId);
  observations.push("two real sidecar sessions retain separate identity");

  await composer.fill("Draft stays in this session");
  await page.getByRole("button", { name: "앱 동작과 명령 열기" }).click();
  await expect(
    page.getByRole("region", { name: "앱 동작 및 런타임 명령" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "명령 목록 닫기" }).click();
  await expect(composer).toHaveValue("Draft stays in this session");
  await page
    .getByRole("button", { name: "E2E second session", exact: true })
    .click();
  await expect(composer).toHaveValue("");
  await composer.fill("A separate second-session draft");
  await page.getByRole("button", { name: originalTitle, exact: true }).click();
  await expect(composer).toHaveValue("Draft stays in this session");
  observations.push(
    "actual session navigation preserves separate assistant-ui drafts",
  );
  const catalog = await bridge({
    type: "catalog.list",
    workspaceId,
    sessionId,
  });
  assert.equal(catalog.ok, true);
  for (const name of ["commands", "skills", "mcp", "agents", "models"]) {
    assert.ok(
      ["available", "unavailable"].includes(catalog.value[name].status),
    );
    assert.ok(Array.isArray(catalog.value[name].entries));
  }
  const safeModelFailure = await bridge({
    type: "message.send",
    workspaceId,
    sessionId,
    requestId: "e2e-unsupported-model",
    text: "Synthetic input; do not execute tools.",
    model: "missing-model-fixture",
  });
  assert.equal(safeModelFailure.ok, false);
  observations.push(
    "actual catalog groups and invalid-model send refusal without provider execution",
  );

  await composer.fill("한글 조합 테스트");
  await composer.dispatchEvent("compositionstart");
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
    bubbles: true,
  });
  await composer.dispatchEvent("compositionend");
  await expect(composer).toHaveValue("한글 조합 테스트");
  const noImeSend = await bridge({ type: "snapshot", workspaceId, sessionId });
  assert.equal(noImeSend.ok, true);
  assert.equal(
    noImeSend.value.messages.some((item) => item.text === "한글 조합 테스트"),
    false,
  );
  observations.push("IME composition Enter does not submit a message");

  // Exercise the actual assistant-ui onNew -> preload -> main -> sidecar catalog
  // path. The isolated runtime has no inherited provider credentials.
  await composer.fill("Synthetic composer check without provider credentials.");
  await page
    .getByRole("button", { name: "메시지 보내기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("AUTH_REQUIRED", {
    timeout: 20000,
  });
  await expect(composer).toHaveValue(
    "Synthetic composer check without provider credentials.",
  );
  const noProviderSend = await bridge({
    type: "snapshot",
    workspaceId,
    sessionId,
  });
  assert.equal(noProviderSend.ok, true);
  assert.equal(
    noProviderSend.value.messages.some((item) =>
      item.text.includes("Synthetic composer check"),
    ),
    false,
  );
  await page.screenshot({
    path: join(run, "desktop-workbench-auth-required.png"),
  });
  observations.push(
    "real assistant-ui submission surfaces AUTH_REQUIRED, retains draft and does not fabricate messages",
  );

  await page
    .getByRole("combobox", { name: "작업 공간", exact: true })
    .selectOption(importedWorkspace.id);
  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  await page.getByRole("button", { name: /notes\.md.*파일 미리보기/ }).click();
  await expect(page.getByRole("region", { name: "파일 내용" })).toContainText(
    "Disposable workbench validation",
  );
  await page.screenshot({
    path: join(run, "desktop-workbench-file-preview.png"),
  });
  await page.getByRole("button", { name: "확장·명령", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "런타임 확장 목록" }),
  ).toContainText("MCP");
  await page.screenshot({ path: join(run, "desktop-workbench-catalog.png") });
  await page
    .getByRole("button", { name: "상세 패널 닫기", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "작업 공간", exact: true })
    .selectOption(workspaceId);
  await expect(composer).toBeVisible();
  observations.push(
    "actual read-only file and extension panels render the selected workspace",
  );

  await composer.fill("");
  await page.screenshot({ path: join(run, "desktop-workbench.png") });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await expect
    .poll(() => page.evaluate(() => window.innerWidth))
    .toBeLessThanOrEqual(800);
  await expect(composer).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: join(run, "desktop-workbench-narrow.png") });
  observations.push(
    "actual full and narrow Electron screenshots; no horizontal page overflow",
  );

  const removed = await bridge({
    type: "workspace.remove",
    workspaceId: importedWorkspace.id,
  });
  assert.equal(removed.ok, true);
  assert.equal(existsSync(join(project, "notes.md")), true);
  assert.equal(
    pageErrors.length,
    0,
    "Renderer must not report uncaught exceptions",
  );
  profile = await application.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(relative(fixture, profile).startsWith(".."), false);
  if (process.platform !== "win32") {
    const pids = execFileSync(
      "pgrep",
      ["-P", String(processHandle.pid), "-f", "opencode.*serve"],
      { encoding: "utf8" },
    );
    childPids = pids.trim().split(/\s+/).map(Number);
    assert.equal(childPids.length, 1);
  }
  await application.evaluate(({ app }) => app.quit());
  assert.equal(await waitForExit(), 0);
  closed = true;
  assert.equal(existsSync(profile), false);
  for (const pid of childPids) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
  observations.push(
    "list removal preserves disk data; owned sidecar reaped and temporary Electron profile removed",
  );
  await rm(fixture, { recursive: true, force: false });
  const report = {
    result: "pass",
    platform: process.platform,
    observations,
    nativePickerInteraction:
      "test dialog substitution; OS picker not physically operated",
    providerExecution: "not run; existing credentials not loaded or sent",
    screenshots: [
      join(run, "desktop-workbench.png"),
      join(run, "desktop-workbench-narrow.png"),
      join(run, "desktop-workbench-auth-required.png"),
      join(run, "desktop-workbench-file-preview.png"),
      join(run, "desktop-workbench-catalog.png"),
    ],
  };
  await writeFile(
    join(run, "electron-evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (!closed && processHandle.exitCode === null) {
    try {
      await application.evaluate(({ app }) => app.quit());
      closed = (await waitForExit()) === 0;
    } catch {
      console.error(
        "Owned test application exit unconfirmed; preserved temporary test data.",
      );
    }
  }
  // Preserve bounded synthetic fixture data for diagnosis. Never delete while
  // an owned sidecar may still be using it, and never force-kill unrelated PIDs.
  throw error;
}
