// Real built Electron/preload + owned OpenCode sidecar. Only native dialog
// responses are substituted, inside this disposable test process.
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { probeSessionHistory } from "./fixtures/session-history-probe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const run = resolve(
  process.env.OMOC_EVIDENCE_DIR ??
    join(root, "docs/runs/desktop-session-lifecycle"),
);
await mkdir(run, { recursive: true });
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-session-e2e-")),
);
const scratch = join(fixture, "tmp");
const project = join(fixture, "session-project");
await mkdir(scratch);
await mkdir(project);
const sentinel = join(project, "keep-project.txt");
const sentinelContent =
  "Owned project sentinel: conversation deletion must preserve this file.\n";
await writeFile(sentinel, sentinelContent);
const require = createRequire(import.meta.url);
const observations = [];
const screenshots = [];
let application;
let processHandle;
let closed = false;
let profile;
let childPids = [];
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
function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function failure(result, code) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, code);
}
try {
  observations.push(await probeSessionHistory(root));
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(root, "apps/desktop-app/dist/app")],
    env: {
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
    },
  });
  processHandle = application.process();
  const page = await application.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
    { timeout: 30000 },
  );
  const bridge = (request) =>
    page.evaluate((value) => window.desktopBridge.workbench(value), request);
  const initial = success(await bridge({ type: "snapshot" }));
  assert.equal(initial.temporary, true);
  // Never inherit user credentials/configuration. Import and trust only our
  // empty owned fixture; this does not exercise physical OS dialog controls.
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, project);
  const imported = success(await bridge({ type: "workspace.import" }));
  const workspaceId = imported.workspaces.find(
    (item) => item.path === project,
  )?.id;
  assert.ok(workspaceId);
  const created = success(
    await bridge({
      type: "session.create",
      workspaceId,
      title: "Lifecycle parent",
    }),
  );
  const sessionId = created.selectedSessionId;
  assert.ok(sessionId);
  const target = { workspaceId, sessionId };
  const mutation = (type, requestId, extra = {}) =>
    bridge({ type, ...target, requestId, ...extra });
  const getSession = (snapshot, id = sessionId) =>
    snapshot.sessions.find((item) => item.id === id);
  const renamedTitle = "Lifecycle renamed redaction-canary";
  const renamed = success(
    await mutation("session.rename", "rename-one", { title: renamedTitle }),
  );
  assert.equal(getSession(renamed).title, renamedTitle);
  assert.equal(
    getSession(
      success(
        await mutation("session.rename", "rename-one", { title: renamedTitle }),
      ),
    ).title,
    renamedTitle,
  );
  failure(
    await mutation("session.rename", "rename-one", {
      title: "Conflicting title",
    }),
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    getSession(
      success(await mutation("session.pin", "pin-one", { pinned: true })),
    ).pinned,
    true,
  );
  assert.equal(
    getSession(
      success(await mutation("session.pin", "pin-two", { pinned: false })),
    ).pinned,
    false,
  );
  observations.push(
    "Real SDK rename, pin/unpin, successful duplicate and conflicting request ID",
  );

  const archived = success(
    await mutation("session.archive", "archive-one", { archived: true }),
  );
  assert.equal(getSession(archived).archived, true);
  assert.notEqual(archived.selectedSessionId, sessionId);
  const archivedRead = success(await bridge({ type: "snapshot", ...target }));
  assert.equal(getSession(archivedRead).archived, true);
  failure(
    await bridge({
      type: "message.send",
      ...target,
      requestId: "archived-send",
      text: "Never execute redaction-canary",
    }),
    "ARCHIVED_SESSION",
  );
  failure(
    await bridge({
      type: "command.run",
      ...target,
      requestId: "archived-command",
      name: "fixture-command",
      arguments: "Never execute",
    }),
    "ARCHIVED_SESSION",
  );
  assert.equal(
    getSession(
      success(
        await mutation("session.archive", "restore-one", { archived: false }),
      ),
    ).archived,
    false,
  );
  observations.push(
    "Archive selects a safe successor; archived history stays readable and main refuses execution; restore succeeds",
  );

  const forkRequest = {
    type: "session.fork",
    ...target,
    requestId: "empty-fork",
  };
  failure(await bridge(forkRequest), "EMPTY_SESSION");
  failure(await bridge(forkRequest), "EMPTY_SESSION");
  assert.equal(
    getSession(success(await bridge({ type: "snapshot", ...target }))).status,
    "idle",
  );
  const childId = success(
    await bridge({
      type: "session.create",
      workspaceId,
      title: "History fork fixture",
    }),
  ).selectedSessionId;
  observations.push(
    "Actual Electron rejects empty-history fork with a repeatable fixed error and keeps parent idle; populated history fork is verified in the companion production-service/real-SDK probe",
  );

  // Capture confirmation semantics without displaying/answering an OS modal.
  // Store only the bounded synthetic options needed to assert the contract.
  await application.evaluate(({ dialog }) => {
    globalThis.__sessionE2eDialogs = [];
    globalThis.__sessionE2eConfirm = false;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__sessionE2eDialogs.push({
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        buttons: options.buttons,
        message: options.message,
        detail: options.detail,
      });
      return {
        response: globalThis.__sessionE2eConfirm
          ? options.cancelId === 0
            ? 1
            : 0
          : options.cancelId,
        checkboxChecked: false,
      };
    };
  });
  const removeChild = {
    type: "session.remove",
    workspaceId,
    sessionId: childId,
    requestId: "cancel-child",
  };
  failure(await bridge(removeChild), "CANCELLED");
  failure(await bridge(removeChild), "CANCELLED");
  const dialogs = await application.evaluate(
    () => globalThis.__sessionE2eDialogs,
  );
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].defaultId, dialogs[0].cancelId);
  assert.ok(JSON.stringify(dialogs[0]).includes("History fork fixture"));
  assert.ok(JSON.stringify(dialogs[0]).includes("session-project"));
  assert.ok(
    getSession(
      success(
        await bridge({ type: "snapshot", workspaceId, sessionId: childId }),
      ),
      childId,
    ),
  );
  await application.evaluate(() => {
    globalThis.__sessionE2eConfirm = true;
  });
  const confirmed = { ...removeChild, requestId: "confirm-child" };
  const removed = success(await bridge(confirmed));
  assert.equal(getSession(removed, childId), undefined);
  assert.equal(removed.selectedWorkspaceId, workspaceId);
  assert.equal(
    getSession(success(await bridge(confirmed)), childId),
    undefined,
  );
  assert.equal(
    await application.evaluate(() => globalThis.__sessionE2eDialogs.length),
    2,
  );
  assert.equal(await readFile(sentinel, "utf8"), sentinelContent);
  observations.push(
    "Cancellation replay does not prompt; confirmed child deletion replay does not remove again; project sentinel survives",
  );

  const diagnostics = success(
    await bridge({ type: "diagnostics.list", workspaceId }),
  );
  assert.ok(diagnostics.observedOperations > 0);
  assert.ok(diagnostics.events.length > 0 && diagnostics.events.length <= 500);
  for (const value of [
    diagnostics.startedAt,
    diagnostics.observedOperations,
    diagnostics.errors,
    diagnostics.unknownOutcomes,
    diagnostics.droppedEvents,
  ])
    assert.ok(Number.isFinite(value) && value >= 0);
  const allowedKeys = new Set([
    "id",
    "timestamp",
    "operation",
    "workspaceId",
    "sessionId",
    "status",
    "durationMs",
    "code",
  ]);
  for (const event of diagnostics.events) {
    assert.ok(Object.keys(event).every((key) => allowedKeys.has(key)));
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    assert.ok(["ok", "error", "unknown", "cancelled"].includes(event.status));
  }
  const serialized = JSON.stringify(diagnostics);
  for (const forbidden of [
    fixture,
    project,
    renamedTitle,
    "redaction-canary",
    "Never execute",
    "History fork fixture",
    "keep-project.txt",
  ])
    assert.equal(serialized.includes(forbidden), false);
  const filtered = success(
    await bridge({ type: "diagnostics.list", ...target }),
  );
  assert.ok(
    filtered.events.every(
      (event) =>
        event.workspaceId === workspaceId && event.sessionId === sessionId,
    ),
  );
  assert.equal(filtered.observedOperations, diagnostics.observedOperations);
  const afterPolls = success(
    await bridge({ type: "diagnostics.list", workspaceId }),
  );
  assert.equal(afterPolls.observedOperations, diagnostics.observedOperations);
  observations.push(
    "Diagnostics use bounded metadata-only DTO, omit synthetic content/paths, filter events and keep app-wide counters; diagnostic reads do not create events",
  );

  // Exercise the production session controls as well as the closed IPC API.
  await page
    .getByRole("combobox", { name: "작업 공간", exact: true })
    .selectOption(workspaceId);
  const search = page.getByRole("searchbox", { name: "세션 검색" });
  await search.fill("no-matching-session-fixture");
  await expect(
    page.getByText("검색 결과가 없습니다.", { exact: true }),
  ).toBeVisible();
  await search.fill("");
  const actions = () =>
    page.getByRole("button", {
      name: `${renamedTitle} 세션 작업`,
      exact: true,
    });
  await actions().focus();
  await page.keyboard.press("ArrowDown");
  const renameItem = page.getByRole("menuitem", {
    name: "이름 변경",
    exact: true,
  });
  await expect(renameItem).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "세션 고정", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(actions()).toBeFocused();
  await actions().click();
  await page.getByRole("menuitem", { name: "이름 변경", exact: true }).click();
  await page
    .getByRole("textbox", { name: "세션 이름", exact: true })
    .fill("   ");
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("1~120");
  await page
    .getByRole("textbox", { name: "세션 이름", exact: true })
    .fill(renamedTitle);
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await expect(actions()).toHaveAttribute("aria-expanded", "false");
  await actions().click();
  await page.getByRole("menuitem", { name: "세션 고정", exact: true }).click();
  await expect(actions()).toHaveAttribute("aria-expanded", "false");
  await actions().click();
  await expect(
    page.getByRole("menuitem", { name: "고정 해제", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "세션 보관", exact: true }).click();
  await expect(actions()).toHaveCount(0);
  await page.getByRole("button", { name: "보관된 세션", exact: true }).click();
  await actions().click();
  await page.getByRole("menuitem", { name: "세션 복원", exact: true }).click();
  await expect(actions()).toHaveCount(0);
  await page.getByRole("button", { name: "활성 세션", exact: true }).click();
  await expect(actions()).toBeVisible();
  observations.push(
    "Actual renderer search, Escape focus return, rename validation/save, pin, archive and restore controls",
  );
  const capture = join(run, "desktop-session-lifecycle.png");
  await page.screenshot({ path: capture });
  screenshots.push(capture);
  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  await page.getByRole("button", { name: "활동", exact: true }).click();
  const activity = page.getByRole("region", { name: "로컬 활동 기록" });
  await expect(activity).toContainText("앱 전체 집계");
  await expect(activity).toContainText("이름 변경");
  await page.getByRole("checkbox", { name: "선택한 세션만 보기" }).check();
  await expect(activity).toContainText("선택한 세션의 기록");
  const activityCapture = join(run, "desktop-session-activity.png");
  await page.screenshot({ path: activityCapture });
  screenshots.push(activityCapture);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await expect(activity).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const narrowCapture = join(run, "desktop-session-activity-narrow.png");
  await page.screenshot({ path: narrowCapture });
  screenshots.push(narrowCapture);
  observations.push(
    "Actual activity panel renders operation metadata and session filter at desktop and narrow viewports without horizontal overflow",
  );
  assert.deepEqual(pageErrors, []);
  profile = await application.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(relative(fixture, profile).startsWith(".."), false);
  if (process.platform !== "win32") {
    childPids = execFileSync(
      "pgrep",
      ["-P", String(processHandle.pid), "-f", "opencode.*serve"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    assert.equal(childPids.length, 1);
  }
  await application.evaluate(({ app }) => app.quit());
  assert.equal(await waitForExit(), 0);
  closed = true;
  assert.equal(existsSync(profile), false);
  for (const pid of childPids)
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(await readFile(sentinel, "utf8"), sentinelContent);
  await rm(fixture, { recursive: true, force: false });
  observations.push(
    "Owned sidecar reaped, temporary Electron profile removed, sentinel preserved until explicit owned fixture cleanup",
  );
  const report = {
    result: "pass",
    platform: process.platform,
    observations,
    screenshots,
    nativeDialogs:
      "Test-only main-process substitution; default cancellation and confirmation options asserted, physical OS dialogs not operated",
    providerExecution:
      "Not performed; isolated HOME/config with no inherited provider credentials",
    historyFixture:
      "Actual Electron empty-session refusal plus populated synthetic history through production service and real SDK; no provider execution",
  };
  await writeFile(
    join(run, "session-lifecycle-evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (application && !closed && processHandle.exitCode === null) {
    try {
      await application.evaluate(({ app }) => app.quit());
      closed = (await waitForExit()) === 0;
    } catch {
      console.error(
        "Owned test application exit unconfirmed; preserved temporary test data.",
      );
    }
  }
  // Never remove fixture data while an owned sidecar might still be using it.
  throw error;
}
