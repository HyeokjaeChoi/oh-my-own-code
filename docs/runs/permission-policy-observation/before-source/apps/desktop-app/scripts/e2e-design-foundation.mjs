// Execute only through the fixed design-foundation evidence wrapper.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
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
import { captureProvenance } from "./build-provenance.mjs";
import { FOUNDATION_CAPTURE_LIMIT } from "./run-evidence.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw Error("Use fixed design-foundation run-evidence selector");
const run = await realpath(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(claim.isFile() && !claim.isSymbolicLink());
let fixtureRoot;
const require = createRequire(import.meta.url);
const screenshots = [],
  states = [],
  errors = [],
  externalRequests = [];
let application,
  processHandle,
  page,
  failure,
  before,
  after,
  currentState = "launch";
let legacyGeometryEvidence;
const interactions = [];
const valueCoverage = [];
const CAPTURE_LIMIT = FOUNDATION_CAPTURE_LIMIT;
let teardown = { launchAttempted: false, exited: false };
const bounded = (e) => String(e).slice(0, 2000);
async function capture(page, name, state) {
  const path = join(run, name);
  // CDP page.screenshot clips Electron's zoomed viewport on macOS. Capture the
  // complete native content surface without a CSS-coordinate clip rectangle.
  const native = await application.evaluate(
    async ({ BrowserWindow, screen }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1)
        throw new Error("Exactly one background host window required");
      const window = windows[0];
      const before = {
        visible: window.isVisible(),
        focused: window.isFocused(),
        focusable: window.isFocusable(),
      };
      if (before.visible || before.focused || before.focusable)
        throw new Error(
          "Verification window must be hidden and nonfocusable before capture",
        );
      const image = await window.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      return {
        before,
        png: image.toPNG().toString("base64"),
        contentBounds: window.getContentBounds(),
        windowBounds: window.getBounds(),
        displayScaleFactor: screen.getDisplayMatching(window.getBounds())
          .scaleFactor,
        zoomFactor: window.webContents.getZoomFactor(),
        osWindowVisible: window.isVisible(),
        osWindowFocused: window.isFocused(),
        osWindowFocusable: window.isFocusable(),
      };
    },
  );
  assert.equal(
    native.osWindowVisible,
    false,
    "Verification window must stay hidden",
  );
  assert.equal(
    native.osWindowFocused,
    false,
    "Verification window must not take OS focus",
  );
  assert.equal(
    native.osWindowFocusable,
    false,
    "Verification window must stay nonfocusable after capture",
  );
  assert.deepEqual(native.before, {
    visible: false,
    focused: false,
    focusable: false,
  });
  const png = Buffer.from(native.png, "base64");
  await writeFile(path, png, { flag: "wx" });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const pixelDimensions = {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
  for (const dimension of ["width", "height"])
    assert.ok(
      Math.abs(
        pixelDimensions[dimension] -
          native.contentBounds[dimension] * native.displayScaleFactor,
      ) <= 1,
      `Native capture does not cover the complete content ${dimension}`,
    );
  screenshots.push({
    pixelDimensions,
    pngSha256: createHash("sha256").update(png).digest("hex"),
    geometrySha256: createHash("sha256")
      .update(
        JSON.stringify({
          pixelDimensions,
          contentBounds: native.contentBounds,
          windowBounds: native.windowBounds,
          zoomFactor: native.zoomFactor,
        }),
      )
      .digest("hex"),
    path,
    state,
    viewport: await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
    })),
    contentBounds: native.contentBounds,
    windowBounds: native.windowBounds,
    displayScaleFactor: native.displayScaleFactor,
    zoomFactor: native.zoomFactor,
    beforeCapture: native.before,
    afterCapture: {
      visible: native.osWindowVisible,
      focused: native.osWindowFocused,
      focusable: native.osWindowFocusable,
    },
    osWindowFocusable: native.osWindowFocusable,
    osWindowVisible: native.osWindowVisible,
    osWindowFocused: native.osWindowFocused,
    captureMethod: "BrowserWindow.webContents.capturePage().toPNG()",
    provenance:
      "Built production Electron renderer and preload with a test-only synthetic main process; no provider execution",
  });
}

async function setDisplay(page, width, height, zoomFactor = 1) {
  const contentWidth = await application.evaluate(
    ({ BrowserWindow }, display) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(display.width, display.height);
      window.webContents.setZoomFactor(display.zoomFactor);
      return window.getContentSize()[0];
    },
    { width, height, zoomFactor },
  );
  await expect
    .poll(() =>
      page.evaluate(
        (expected) => Math.abs(window.innerWidth - expected),
        contentWidth / zoomFactor,
      ),
    )
    .toBeLessThanOrEqual(1);
}

async function shot(name) {
  assert.ok(
    screenshots.length < CAPTURE_LIMIT,
    "Foundation capture budget exceeded",
  );
  currentState = name;
  // Two RAF callbacks run before paint. A task after the second callback is the
  // post-paint barrier used by the existing production-renderer evidence runner.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(() =>
            globalThis.setTimeout(resolve, 0),
          ),
        ),
      ),
  );
  await capture(
    page,
    `${String(screenshots.length).padStart(3, "0")}-${name}.png`,
    name,
  );
  states.push(name);
}

async function stopOwnedApplication(application, processHandle) {
  if (!processHandle)
    return { exited: false, reason: "No owned process handle" };
  let listener, quitError, cleanupError;
  const exited =
    processHandle.exitCode !== null || processHandle.signalCode !== null
      ? Promise.resolve([processHandle.exitCode, processHandle.signalCode])
      : new Promise((resolve) => {
          listener = (code, signal) => resolve([code, signal]);
          processHandle.once("exit", listener);
        });
  async function within(promise, ms) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(Error("Owned Electron exit deadline")),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const signals = [];
  try {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      void Promise.resolve()
        .then(() => application.evaluate(({ app }) => app.quit()))
        .catch((error) => {
          quitError = bounded(error);
        });
    }
    let exit;
    try {
      exit = await within(exited, 15000);
    } catch (error) {
      cleanupError = bounded(error);
      signals.push("SIGTERM");
      processHandle.kill("SIGTERM");
      try {
        exit = await within(exited, 5000);
      } catch {
        signals.push("SIGKILL");
        processHandle.kill("SIGKILL");
        exit = await within(exited, 5000);
      }
    }
    return {
      exited: true,
      pid: processHandle.pid,
      code: exit[0],
      signal: exit[1],
      signals,
      ...(quitError && { quitError }),
      ...(cleanupError && { cleanupError }),
    };
  } catch (error) {
    return {
      exited: false,
      pid: processHandle.pid,
      signals,
      error: bounded(error),
    };
  } finally {
    if (listener) processHandle.removeListener("exit", listener);
  }
}

// Saved only. Main owns final UI checkpoint, coherent build and runtime invocation.
export const SAVED_INVOCATION = Object.freeze([
  "node",
  "apps/desktop-app/scripts/run-evidence.mjs",
  "--script",
  "design-foundation",
  "--out",
  "docs/runs/design-foundation-v2/evidence/hidden-r1",
]);
const composer = () =>
  page.getByRole("textbox", { name: "메시지 작성", exact: true });
const send = () =>
  page.getByRole("button", { name: "메시지 보내기", exact: true });
const hook = (name) => page.locator(`[data-context-${name}]`);
async function counters() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      requests: f.requests.length,
      contextReads: f.contextReads.length,
      inboxReads: f.inboxReads.length,
      effects: f.contextEffects.length,
      fileBytes: f.workspaceFileReads.length,
      mutations: globalThis.__omocUiMutationMetrics(),
    };
  });
}
async function scenario(name) {
  const scope = await application.evaluate(
    (_electron, name) =>
      globalThis.__omocUiFixture.setConversationContextState(name),
    name,
  );
  await page.reload();
  await expect(hook("section")).toBeAttached();
  await expect(composer()).toBeEditable();
  assert.equal((await counters()).contextReads, 0);
  assert.equal((await counters()).inboxReads, 0);
  return scope;
}
async function reveal(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 0.95 });
}
async function expand(task, key = "Enter") {
  if (!(await task.evaluate((el) => el.open))) {
    const summary = task.locator(":scope > summary");
    await reveal(summary);
    await summary.focus();
    await page.keyboard.press(key);
  }
  await expect(task).toHaveAttribute("open", "");
}
async function geometry() {
  const source = await readFile(
    new URL("./e2e-workbench-states.mjs", import.meta.url),
    "utf8",
  );
  const code = source.match(
    /async function assertComposerGeometry\(page\) \{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(code);
  const observations = [];
  await new Function("assert", "observations", `return (${code});`)(
    assert,
    observations,
  )(page);
  legacyGeometryEvidence = {
    path: "apps/desktop-app/scripts/e2e-workbench-states.mjs",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    functionSha256: createHash("sha256").update(code).digest("hex"),
    observations,
  };
}
async function display(theme, width, zoom = 1) {
  await setDisplay(page, width, 1000, zoom);
  await page.evaluate((theme) => {
    globalThis.document.documentElement.dataset.theme = theme;
    globalThis.document.documentElement.style.colorScheme = theme;
  }, theme);
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: globalThis.document.documentElement.scrollWidth,
  }));
  assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
}
// Actual frozen UI checkpoint: source owns these presentation-only hooks.
const requestedTask = () =>
  page.locator('details[data-runtime-task="requested"]');
const requestedSummary = () =>
  page.locator('[data-runtime-summary="requested"]');
const nativeReport = () =>
  page.locator('details[data-runtime-source="session"]');
const field = (name) => page.getByRole("combobox", { name, exact: true });
async function closeTask(task, control) {
  const baseline = await counters();
  await reveal(control);
  await control.focus();
  await page.keyboard.press("Escape");
  await expect(task).not.toHaveAttribute("open", "");
  await expect(task.locator(":scope > summary")).toBeFocused();
  assert.deepEqual(
    await counters(),
    baseline,
    "Closing a task must not read source bytes or mutate",
  );
}
async function stagedOnly(name, action) {
  const baseline = await counters();
  await action();
  const after = await counters();
  assert.deepEqual(
    after,
    baseline,
    `${name}: presentation must not read source bytes or mutate`,
  );
  interactions.push({ name, before: baseline, after });
}
async function recordValue(locator, label) {
  await expect(locator).toBeInViewport({ ratio: 0.95 });
  valueCoverage.push({
    label,
    text: await locator.evaluate((el) =>
      el.tagName === "SELECT"
        ? el.selectedOptions[0]?.textContent
        : el.textContent,
    ),
    selectedValue: await locator.evaluate((el) =>
      el.tagName === "SELECT" ? el.value : null,
    ),
    frame: screenshots.length - 1,
    path: screenshots.at(-1).path,
  });
}
async function choose(scope) {
  await field("Agent 요청").selectOption(scope.agent);
  await field("모델 요청").selectOption(scope.model);
  await field("Variant 요청").selectOption(scope.variant);
}
async function observe(scope) {
  await expand(hook("section"));
  await hook("path").fill(scope.path);
  await hook("observe").click();
  await expect(hook("item")).toHaveCount(1);
}
async function criticalOutsideTask(locator) {
  await expect(locator).toBeVisible();
  assert.equal(
    await locator.evaluate((el) => Boolean(el.closest("details"))),
    false,
    "Critical status must remain outside collapsed disclosures",
  );
}
async function commandMenuRegression() {
  await scenario("ready");
  await display("light", 1440);
  const trigger = page.getByRole("button", {
    name: "앱 동작과 명령 열기",
    exact: true,
  });
  const menu = page.getByRole("region", {
    name: "앱 동작 및 런타임 명령",
    exact: true,
  });
  await expect(trigger).toHaveText("");
  await expect(trigger.locator("svg.lucide-plus")).toHaveCount(1);
  const composerBefore = await trigger
    .locator("xpath=ancestor::form")
    .boundingBox();
  await trigger.click();
  await expect(menu).toBeVisible();
  assert.equal(
    await menu.evaluate((element) => element.matches(":popover-open")),
    true,
  );
  const composerAfter = await trigger
    .locator("xpath=ancestor::form")
    .boundingBox();
  assert.deepEqual(
    composerAfter,
    composerBefore,
    "Popover must not resize or move Composer",
  );
  await shot("collapsed-command-menu-first-items");
  const first = menu.locator("button[data-command]").first();
  const close = menu.getByRole("button", {
    name: "명령 목록 닫기",
    exact: true,
  });
  const pointerReachable = async (button) => {
    const proof = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2,
        y = box.top + box.height / 2;
      const hit = globalThis.document.elementFromPoint(x, y);
      return {
        label: element.textContent || element.getAttribute("aria-label"),
        x,
        y,
        reachable: Boolean(hit && element.contains(hit)),
      };
    });
    assert.equal(proof.reachable, true, JSON.stringify(proof));
    return proof;
  };
  const firstProof = await pointerReachable(first);
  const closeProof = await pointerReachable(close);
  // Trial hit tests are real pointer checks without creating a session.
  await first.click({ trial: true });
  await close.click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  const last = menu.locator("button[data-command]").last();
  await expect(last).toBeFocused();
  await last.scrollIntoViewIfNeeded();
  const lastProof = await pointerReachable(last);
  await last.click({ trial: true });
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await pointerReachable(first);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const [theme, width, zoom] of [
    ["light", 320, 1],
    ["dark", 760, 2],
    ["dark", 1440, 1],
  ]) {
    await display(theme, width, zoom);
    await trigger.click();
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
    );
    await pointerReachable(first);
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(first).toBeFocused();
    await page.keyboard.press("End");
    await expect(last).toBeFocused();
    await pointerReachable(last);
    if (width === 320) await shot("narrow-command-menu-last-item");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    // The popup can cover the textbox center; click a genuinely outside gutter.
    await page.mouse.click(1, 1);
    await expect(menu).toHaveCount(0);
  }
  interactions.push({
    state: "command-menu-closed-default-hit-test",
    firstProof,
    closeProof,
    lastProof,
  });
}

async function exerciseFoundation() {
  await commandMenuRegression();
  for (const theme of ["light", "dark"]) {
    for (const [width, zoom] of [
      [1440, 1],
      [760, 1],
      [320, 1],
      [760, 2],
    ]) {
      const scope = await scenario("ready");
      await display(theme, width, zoom);
      const prefix = `${theme}-${width}-zoom${zoom}`;
      for (const task of [
        hook("section"),
        hook("running-task"),
        requestedTask(),
        nativeReport(),
      ])
        await expect(task).not.toHaveAttribute("open", "");
      await composer().fill(
        "SYNTHETIC Foundation · 긴 한국어 입력 · 다음 요청을 편집합니다.",
      );
      await expect(requestedSummary()).toContainText("Native에서 결정");
      await reveal(send());
      await shot(`${prefix}-collapsed-idle`);
      await geometry();
      await stagedOnly(`${prefix}-settings-keyboard-disclosure`, async () => {
        await expand(requestedTask(), zoom === 2 ? "Space" : "Enter");
        await choose(scope);
        await field("Agent 요청").focus();
        await page.keyboard.press("Tab");
        await expect(field("모델 요청")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(field("Variant 요청")).toBeFocused();
        await reveal(page.locator('[data-runtime-source="requested"]'));
        await shot(`${prefix}-expanded-requested`);
        for (const name of ["Agent 요청", "모델 요청", "Variant 요청"])
          await recordValue(field(name), `${prefix}-${name}`);
        await closeTask(requestedTask(), field("Variant 요청"));
        await expect(requestedSummary()).toContainText(scope.agent);
        await expect(requestedSummary()).toContainText(scope.model);
        await expect(requestedSummary()).toContainText(scope.variant);
        await reveal(send());
        await send().focus();
        await expect(send()).toBeFocused();
        await expect(send()).toBeInViewport({ ratio: 0.95 });
        await expect(requestedSummary()).toBeInViewport({ ratio: 0.95 });
        await shot(`${prefix}-selected-summary-final-action`);
        await recordValue(requestedSummary(), `${prefix}-selected-summary`);
        // Closed settings controls must not be in the keyboard path.
        await requestedTask().locator(":scope > summary").focus();
        await page.keyboard.press("Tab");
        await expect(nativeReport().locator(":scope > summary")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(composer()).toBeFocused();
      });
    }
  }

  let scope = await scenario("ready");
  await display("light", 1440);
  await composer().fill("SYNTHETIC attachment draft stays editable");
  await stagedOnly("attachment-keyboard-open", async () => {
    await expand(hook("section"), "Space");
    await hook("path").fill(scope.path);
    await hook("path").focus();
    await page.keyboard.press("Tab");
    await expect(hook("observe")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(hook("path")).toBeFocused();
  });
  await observe(scope);
  await expect(hook("text")).toHaveText(scope.text);
  await closeTask(hook("section"), hook("path"));
  await expect(hook("summary")).toBeVisible();
  await reveal(hook("item"));
  await shot("attachment-compact-collapsed");
  await stagedOnly("attachment-metadata-disclosure", async () => {
    await expand(hook("item").locator("details"));
    await reveal(hook("item").locator("dl"));
    await shot("attachment-expanded-original-metadata");
    await recordValue(
      hook("item").locator("dl"),
      "original-path-size-source-version-hash",
    );
    await display("dark", 760, 2);
    for (const [index, label] of [
      [0, "long-source-path"],
      [4, "original-sha256"],
    ]) {
      const value = hook("item").locator("dd").nth(index);
      await reveal(value);
      await shot(`attachment-200-${label}`);
      await recordValue(value, label);
    }
  });
  await display("light", 1440);
  await hook("reobserve").click();
  await expect(hook("text")).toHaveText(scope.text);
  await reveal(hook("text"));
  await shot("attachment-explicit-reobserve-preview");
  await stagedOnly("preview-close-restores-origin", async () => {
    await hook("close-preview").click();
    await expect(hook("preview")).toHaveCount(0);
    await expect(hook("reobserve")).toBeFocused();
  });
  assert.equal(
    (await counters()).contextReads,
    2,
    "Only the two explicit file requests are permitted",
  );

  scope = await scenario("ready");
  await display("light", 1440);
  const retainedDraft =
    "SYNTHETIC ordinary draft retained while branch task is open";
  await composer().fill(retainedDraft);
  const origin = page.locator(`[data-context-edit="${scope.userMessageId}"]`);
  await stagedOnly("branch-first-task-Escape-return", async () => {
    await origin.click();
    await expect(hook("branch-text")).toBeFocused();
    await expect(hook("boundary")).toContainText(scope.userMessageId);
    await expect(
      page.locator('[data-composer-state="branch-retained"]'),
    ).toBeHidden();
    assert.equal(
      await hook("branch").evaluate(
        (el) => el.parentElement.firstElementChild === el,
      ),
      true,
    );
    await reveal(hook("boundary"));
    await shot("branch-first-task-boundary");
    await hook("branch-text").fill("SYNTHETIC uncommitted branch edit");
    await page.keyboard.press("Escape");
    await expect(hook("branch")).toHaveCount(0);
    await expect(origin).toBeFocused();
    await expect(composer()).toHaveValue(retainedDraft);
  });
  const beforeFork = await counters();
  await origin.click();
  await expect(hook("branch-text")).toBeFocused();
  await hook("branch-text").fill("SYNTHETIC edited branch draft · 한국어 입력");
  await display("dark", 760, 2);
  await reveal(hook("branch-confirm"));
  await expect(hook("branch-close")).toBeInViewport({ ratio: 0.95 });
  await shot("branch-200-edit-confirm-close");
  await display("light", 1440);
  await hook("branch-confirm").click();
  await expect(composer()).toHaveValue(
    "SYNTHETIC edited branch draft · 한국어 입력",
  );
  const forkRequests = await application.evaluate(
    (_electron, from) => globalThis.__omocUiFixture.requests.slice(from),
    beforeFork.requests,
  );
  assert.deepEqual(
    forkRequests.map((r) => r.type),
    ["session.fork"],
  );
  assert.equal(forkRequests[0].before, scope.userMessageId);
  await reveal(send());
  await shot("branch-confirmed-separate-send-required");

  scope = await scenario("running");
  await display("dark", 1440);
  await composer().fill("SYNTHETIC next draft during the current run");
  await stagedOnly("running-requested-distinct-from-current-run", async () => {
    await expand(requestedTask());
    await field("모델 요청").selectOption("fixture-other-model");
    await field("Variant 요청").selectOption("other.variant");
    await closeTask(requestedTask(), field("Variant 요청"));
    await expand(hook("running-task"), "Space");
    await expect(hook("running")).toContainText("Native의 현재 실행 설정");
    await expect(hook("steer")).toBeEnabled();
    await expect(hook("queue")).toBeEnabled();
    await reveal(hook("running"));
    await shot("running-current-run-task");
    await closeTask(hook("running-task"), hook("queue"));
    await expand(nativeReport());
    await expect(nativeReport()).toContainText("session.variant");
    await reveal(nativeReport());
    await shot("running-native-report-separate-from-request");
    await closeTask(
      nativeReport(),
      page.locator("[data-runtime-report-close]"),
    );
    await expect(requestedSummary()).toContainText("fixture-other-model");
    await expect(requestedSummary()).toContainText("other.variant");
  });

  scope = await scenario("unsupported");
  await display("light", 320);
  await expand(hook("section"));
  await hook("path").fill(scope.path);
  await hook("observe").click();
  await expect(hook("error")).toHaveAttribute(
    "data-context-error",
    "unsupported_content",
  );
  await closeTask(hook("section"), hook("path"));
  await criticalOutsideTask(hook("error"));
  await reveal(hook("error"));
  await shot("unsupported-outside-closed-task");
  scope = await scenario("unsupported-model");
  await display("dark", 320);
  await observe(scope);
  await expand(requestedTask());
  await field("모델 요청").selectOption(scope.model);
  await closeTask(requestedTask(), field("모델 요청"));
  await closeTask(hook("section"), hook("path"));
  await composer().fill("SYNTHETIC unsupported model input stays editable");
  await expect(send()).toBeDisabled();
  await criticalOutsideTask(hook("send-blocked"));
  await reveal(hook("send-blocked"));
  await shot("unsupported-model-outside-closed-task");

  scope = await scenario("ready");
  await display("light", 760, 2);
  await page.clock.install();
  await observe(scope);
  await closeTask(hook("section"), hook("path"));
  await application.evaluate(() =>
    globalThis.__omocUiFixture.expireContextCapabilities(),
  );
  await page.clock.fastForward(600001);
  await expect(hook("error")).toHaveAttribute(
    "data-context-error",
    "CONTEXT_EXPIRED",
  );
  await composer().fill("SYNTHETIC expiry keeps draft editable");
  await expect(send()).toBeDisabled();
  await criticalOutsideTask(hook("error"));
  await reveal(hook("error"));
  await shot("expired-200-outside-closed-task");
  assert.equal(
    (await counters()).contextReads,
    1,
    "Expiry must not automatically reread",
  );

  for (const name of ["unknown", "held", "global-held", "untrusted"]) {
    await scenario(name);
    await display(name === "unknown" ? "dark" : "light", 320);
    await stagedOnly(`${name}-inert-draft-and-closed-tasks`, async () => {
      await composer().fill(`SYNTHETIC ${name} · 편집 가능한 입력`);
      await expect(send()).toBeDisabled();
      await criticalOutsideTask(hook("held"));
      if (name === "unknown") {
        await expect
          .poll(() =>
            application.evaluate(() =>
              globalThis.__omocUiFixture.lookups.some(
                (r) =>
                  r.runtimeEpoch === "fixture-original-context-epoch" &&
                  r.operationId === "fixture-original-context-send",
              ),
            ),
          )
          .toBe(true);
      }
      await reveal(hook("held"));
      await shot(`${name}-visible-outside-closed-task`);
    });
  }

  await scenario("ready");
  await display("light", 1440);
  await stagedOnly("wide-navigation-and-side-task", async () => {
    const trigger = page.getByRole("button", {
      name: "파일·확장",
      exact: true,
    });
    await trigger.click();
    await expect(
      page.getByRole("complementary", {
        name: "파일, 확장 및 활동",
        exact: true,
      }),
    ).toBeVisible();
    await shot("wide-navigation-side-task");
    await page
      .getByRole("button", { name: "상세 패널 닫기", exact: true })
      .click();
    await expect(trigger).toBeFocused();
  });
  await display("dark", 320);
  await stagedOnly("narrow-navigation-Escape-return", async () => {
    const trigger = page.getByRole("button", {
      name: "작업 공간 탐색 열기",
      exact: true,
    });
    await trigger.click();
    await expect(
      page.getByRole("button", { name: "작업 공간과 세션 닫기", exact: true }),
    ).toBeVisible();
    await shot("narrow-navigation");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
  await stagedOnly("narrow-side-task-return", async () => {
    const trigger = page.getByRole("button", {
      name: "파일·확장",
      exact: true,
    });
    await trigger.click();
    const back = page.getByRole("button", {
      name: "대화로 돌아가기",
      exact: true,
    });
    await reveal(back);
    await shot("narrow-side-task-return");
    await back.click();
    await expect(trigger).toBeFocused();
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  await composer().fill(
    "SYNTHETIC reduced motion · 긴 한국어 입력을 유지합니다.",
  );
  await reveal(send());
  await shot("reduced-motion-narrow-collapsed");
  assert.ok(screenshots.length <= CAPTURE_LIMIT);
}

try {
  before = await captureProvenance(root, { script: "design-foundation" });
  fixtureRoot = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-design-foundation-ui-")),
  );
  teardown.retainedRoot = fixtureRoot;
  teardown.launchAttempted = true;
  application = await electron.launch({
    timeout: 20000,
    executablePath: require("electron"),
    args: [
      join(desktop, "scripts/fixtures/workbench-host.mjs"),
      "--user-data-dir=" + join(fixtureRoot, "bootstrap"),
    ],
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: fixtureRoot,
      TMPDIR: fixtureRoot,
      TMP: fixtureRoot,
      TEMP: fixtureRoot,
      OMOC_UI_TEST_ROOT: fixtureRoot,
    },
  });
  processHandle = application.process();
  for (const stream of ["stdout", "stderr"])
    processHandle[stream]?.on("data", () => {});
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(bounded(error)));
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  await page.route(/^https?:/i, (route) => route.abort("blockedbyclient"));
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await exerciseFoundation();
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  if (page)
    try {
      await shot("failure");
    } catch (captureError) {
      errors.push(bounded(captureError));
    }
} finally {
  try {
    if (processHandle) {
      teardown = {
        ...teardown,
        ...(await stopOwnedApplication(application, processHandle)),
      };
      assert.equal(
        teardown.exited,
        true,
        "Owned Electron exit must be observed",
      );
      assert.equal(teardown.code, 0, "Owned Electron must exit successfully");
      assert.deepEqual(
        teardown.signals,
        [],
        "Forced cleanup is failed evidence",
      );
    }
  } catch (error) {
    failure ??= error;
    teardown.error = bounded(error);
  }
  try {
    if (legacyGeometryEvidence) {
      const currentLegacySource = await readFile(
        new URL("./e2e-workbench-states.mjs", import.meta.url),
        "utf8",
      );
      assert.equal(
        createHash("sha256").update(currentLegacySource).digest("hex"),
        legacyGeometryEvidence.sourceSha256,
      );
    }
    after = await captureProvenance(root, { script: "design-foundation" });
    if (before) assert.deepEqual(after, before);
  } catch (error) {
    failure ??= error;
  }
}
try {
  await writeFile(
    join(run, "design-foundation-evidence.json"),
    JSON.stringify(
      {
        result: failure ? "fail" : "pass",
        state: currentState,
        platform: process.platform,
        states,
        screenshots,
        legacyGeometryEvidence,
        valueCoverage,
        interactions,
        captureLimit: CAPTURE_LIMIT,
        pageErrors: errors,
        externalRequests,
        teardown,
        sourceBuildProvenance: { before, after },
        fixture:
          "Explicit synthetic Main scenarios; actual production renderer/preload and frozen public projections",
        clipboard: "not performed",
        providerExecution: "not performed",
        productionMain: "not performed",
        ...(failure && { error: bounded(failure) }),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} catch (error) {
  failure ??= error;
}
if (failure) {
  console.error(bounded(failure));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      result: "pass",
      states: states.length,
      captures: screenshots.length,
    }),
  );
