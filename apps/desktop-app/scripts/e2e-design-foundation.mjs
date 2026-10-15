// Execute only through the fixed design-foundation evidence wrapper.
import assert from "node:assert/strict";
import { e2ePath } from "./e2e-env.mjs";
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
import { COMPOSER_POPOVERS } from "./e2e-composer.mjs";
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
  await expect(chip("attach")).toBeAttached();
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
  // A details inside a closed composer popover first needs its chip opened.
  const host = task.locator("xpath=ancestor::*[@popover][1]");
  if (await host.count()) {
    if (!(await host.evaluate((el) => el.matches(":popover-open"))))
      await page
        .locator(`[popovertarget="${await host.getAttribute("id")}"]`)
        .click();
  }
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
// Composer controls live in native popovers opened from footer chips.
const chip = (kind) =>
  page.getByRole("button", { name: COMPOSER_POPOVERS[kind] }).first();
const popover = async (kind) =>
  page.locator(`[id="${await chip(kind).getAttribute("popovertarget")}"]`);
const sessionReport = () => page.locator('[data-runtime-source="session"]');
const field = (name) =>
  page.getByRole("combobox", { name, exact: true, includeHidden: true });
// Opens via the keyboard (Enter/Space on the chip) when it is closed.
async function expandPopover(kind, key = "Enter") {
  const panel = await popover(kind);
  if (!(await panel.evaluate((el) => el.matches(":popover-open")))) {
    await reveal(chip(kind));
    await chip(kind).focus();
    await page.keyboard.press(key);
  }
  await expect(panel).toBeVisible();
  return panel;
}
// Esc inside a popover closes it natively and returns focus to its chip.
async function closePopover(kind, control) {
  const baseline = await counters();
  await reveal(control);
  await control.focus();
  await page.keyboard.press("Escape");
  await expect(await popover(kind)).toBeHidden();
  await expect(chip(kind)).toBeFocused();
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
  await expandPopover("agent");
  await field("Agent 요청").selectOption(scope.agent);
  await expandPopover("model");
  await field("모델 요청").selectOption(scope.model);
  await field("Variant 요청").selectOption(scope.variant);
}
async function observe(scope) {
  await expandPopover("attach");
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
  await expect(trigger.locator("svg.lucide-square-slash")).toHaveCount(1);
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
      await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
      await expect(page.locator("[data-run-strip]")).toHaveCount(0);
      await composer().fill(
        "SYNTHETIC Foundation · 긴 한국어 입력 · 다음 요청을 편집합니다.",
      );
      await expect(chip("agent")).toContainText("기본 에이전트");
      await expect(chip("model")).toContainText("기본 모델");
      await expect(send()).toHaveAttribute(
        "title",
        "전송 (Enter) · 줄바꿈 Shift+Enter",
      );
      await reveal(send());
      await shot(`${prefix}-collapsed-idle`);
      await geometry();
      await stagedOnly(`${prefix}-settings-keyboard-disclosure`, async () => {
        await expandPopover("agent", zoom === 2 ? "Space" : "Enter");
        await choose(scope);
        await field("모델 요청").focus();
        await page.keyboard.press("Tab");
        await expect(field("Variant 요청")).toBeFocused();
        await reveal(page.locator('[data-runtime-source="requested"]').last());
        await shot(`${prefix}-expanded-requested`);
        for (const name of ["모델 요청", "Variant 요청"])
          await recordValue(field(name), `${prefix}-${name}`);
        await closePopover("model", field("Variant 요청"));
        await expect(chip("model")).toContainText(scope.variant);
        await expandPopover("agent");
        await recordValue(field("Agent 요청"), `${prefix}-Agent 요청`);
        await closePopover("agent", field("Agent 요청"));
        await reveal(send());
        await send().focus();
        await expect(send()).toBeFocused();
        await expect(send()).toBeInViewport({ ratio: 0.95 });
        await expect(chip("model")).toBeInViewport({ ratio: 0.95 });
        await shot(`${prefix}-selected-summary-final-action`);
        await recordValue(chip("model"), `${prefix}-selected-summary`);
        // Closed popover controls must not be in the keyboard path.
        await chip("agent").focus();
        await page.keyboard.press("Tab");
        await expect(chip("model")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(chip("permission")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(send()).toBeFocused();
      });
    }
  }

  let scope = await scenario("ready");
  await display("light", 1440);
  await composer().fill("SYNTHETIC attachment draft stays editable");
  await stagedOnly("attachment-keyboard-open", async () => {
    await expandPopover("attach", "Space");
    await hook("path").fill(scope.path);
    await hook("path").focus();
    await page.keyboard.press("Tab");
    await expect(hook("observe")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(hook("path")).toBeFocused();
  });
  await observe(scope);
  await expect(hook("text")).toHaveText(scope.text);
  await closePopover("attach", hook("path"));
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
    await expandPopover("model");
    await field("모델 요청").selectOption("fixture-other-model");
    await field("Variant 요청").selectOption("other.variant");
    // The current-session report is a separate muted line from the request.
    await expect(sessionReport()).toContainText("session.variant");
    await reveal(sessionReport());
    await shot("running-native-report-separate-from-request");
    await closePopover("model", field("Variant 요청"));
    await expect(chip("model")).toContainText("other.variant");
    // The run strip appears only while a run is active.
    await expect(page.locator("[data-run-strip]")).toBeVisible();
    await expandPopover("run", "Space");
    await expect(hook("running")).toContainText("Native의 현재 실행 설정");
    await expect(hook("steer")).toBeEnabled();
    await expect(hook("queue")).toBeEnabled();
    await reveal(hook("running"));
    await shot("running-current-run-task");
    await closePopover("run", hook("queue"));
  });

  scope = await scenario("unsupported");
  await display("light", 320);
  await expandPopover("attach");
  await hook("path").fill(scope.path);
  await hook("observe").click();
  await expect(hook("error")).toHaveAttribute(
    "data-context-error",
    "unsupported_content",
  );
  await closePopover("attach", hook("path"));
  await criticalOutsideTask(hook("error"));
  await reveal(hook("error"));
  await shot("unsupported-outside-closed-task");
  scope = await scenario("unsupported-model");
  await display("dark", 320);
  await observe(scope);
  await expandPopover("model");
  await field("모델 요청").selectOption(scope.model);
  await closePopover("model", field("모델 요청"));
  await expandPopover("attach");
  await closePopover("attach", hook("path"));
  await composer().fill("SYNTHETIC unsupported model input stays editable");
  await expect(send()).toBeDisabled();
  await criticalOutsideTask(hook("send-blocked"));
  await reveal(hook("send-blocked"));
  await shot("unsupported-model-outside-closed-task");

  scope = await scenario("ready");
  await display("light", 760, 2);
  await page.clock.install();
  await observe(scope);
  await closePopover("attach", hook("path"));
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

// Additive saved appendix. Main owns the coherent build and actual invocation.
// The shared wrapper's capture budget must accommodate all 47 original frames
// plus these three frames. This file never relaxes wrapper/output validation.
export const SAVED_PERMISSION_POLICY_INVOCATION = Object.freeze([
  "node",
  "apps/desktop-app/scripts/run-evidence.mjs",
  "--out",
  "docs/runs/design-foundation-v2/evidence/permission-policy-r1",
  "--script",
  "design-foundation",
]);
const permissionTask = () =>
  page.locator('details[data-runtime-task="permission"]');
const permissionAction = (action) =>
  page.locator(`[data-permission-policy-action="${action}"]`);
const permissionRules = (source) =>
  page.locator(`[data-permission-policy-source="${source}"]`);
async function permissionCounters() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      reads: globalThis.structuredClone(f.permissionPolicyReads),
      io: f.permissionPolicyIO.length,
      effects: f.requests.length,
      intents: f.intents.length,
      mutations: globalThis.__omocUiMutationMetrics(),
    };
  });
}
async function permissionScenario(name) {
  await scenario("ready");
  const scope = await application.evaluate(
    (_electron, name) =>
      globalThis.__omocUiFixture.setPermissionPolicyState(name),
    name,
  );
  await page.reload();
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-status",
    "not_observed",
  );
  await expect(composer()).toBeEditable();
  assert.equal((await permissionCounters()).reads.length, 0);
  await expand(permissionTask());
  await expect(permissionTask()).toContainText(
    "세션에 저장된 규칙입니다. Agent 규칙·저장된 허용·hook을 합친 최종 실행 판단은 아닙니다.",
  );
  await expect(permissionTask()).toContainText(
    "도구 수준 규칙이며 OS sandbox가 아닙니다.",
  );
  return scope;
}
async function observePermissionPolicy(status = "observed") {
  const before = await permissionCounters();
  await reveal(permissionAction("observe"));
  await expect(permissionAction("observe")).toBeEnabled();
  await permissionAction("observe").focus();
  await page.keyboard.press("Enter");
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-status",
    status,
  );
  const after = await permissionCounters();
  assert.equal(after.reads.length, before.reads.length + 1);
  assert.equal(after.io, before.io + 1);
  assert.equal(after.effects, before.effects);
  assert.equal(after.intents, before.intents);
  assert.deepEqual(after.mutations, before.mutations);
  const wire = after.reads.at(-1);
  assert.equal(wire.version, 2);
  assert.equal(typeof wire.readId, "string");
  const actual = await application.evaluate(() => {
    const s = globalThis.__omocUiFixture.snapshot;
    return {
      epoch: s.runtimeEpoch,
      workspaceId: s.selectedWorkspaceId,
      sessionId: s.selectedSessionId,
    };
  });
  assert.equal(wire.runtimeEpoch, actual.epoch);
  assert.deepEqual(wire.operation, {
    type: "permission.policy.read",
    workspaceId: actual.workspaceId,
    sessionId: actual.sessionId,
  });
  assert.deepEqual(
    Object.keys(wire).sort(),
    ["version", "runtimeEpoch", "readId", "operation"].sort(),
  );
  interactions.push({ name: `permission-policy-${status}`, before, after });
}
async function permissionFullValues(label) {
  const rows = permissionRules("session").locator("li");
  const values = rows.locator("dd");
  await expect(rows).toHaveCount(1);
  await expect(values.nth(0)).toHaveText("SYNTHETIC.action." + "a".repeat(111));
  await expect(values.nth(1)).toHaveText("SYNTHETIC/" + "r".repeat(2038));
  for (const value of [values.nth(0), values.nth(1)]) {
    // Reading DOM text is evidence only. No renderer state is injected here.
    const proof = await value.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      const selection = globalThis.getSelection();
      const range = globalThis.document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      const selected = selection.toString();
      selection.removeAllRanges();
      return {
        text: element.textContent,
        selected,
        userSelect: style.userSelect,
        overflowWrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    assert.equal(proof.selected, proof.text);
    assert.notEqual(proof.userSelect, "none");
    assert.equal(proof.overflowWrap, "anywhere");
    assert.notEqual(proof.whiteSpace, "nowrap");
    assert.ok(
      proof.scrollWidth <= proof.clientWidth + 1,
      JSON.stringify(proof),
    );
    valueCoverage.push({ label, ...proof });
  }
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: globalThis.document.documentElement.scrollWidth,
  }));
  assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
}
async function exercisePermissionPolicy() {
  assert.ok(
    CAPTURE_LIMIT >= screenshots.length + 3,
    "Main must bind a foundation capture budget for the unchanged matrix plus three permission-policy captures",
  );
  await permissionScenario("baseline");
  await display("light", 1440);
  const baseline = await permissionCounters();
  // Real renderer polling/refocus and selection actions, no store injection.
  await page.evaluate(() =>
    window.dispatchEvent(new globalThis.Event("focus")),
  );
  const sessions = page.locator(".session-row button[title]");
  await expect(sessions).toHaveCount(2);
  await sessions.nth(1).click();
  await expect(composer()).toBeEditable();
  await sessions.nth(0).click();
  await expect(composer()).toBeEditable();
  await page.waitForTimeout(1500);
  assert.deepEqual(
    await permissionCounters(),
    baseline,
    "Polling/refocus/selection cannot auto-read policy",
  );
  await expand(permissionTask());
  await observePermissionPolicy();
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-baseline",
    "matches",
  );
  await expect(permissionRules("required").locator("li")).not.toHaveCount(0);
  const observed = await permissionCounters();
  await application.evaluate(() => {
    // Producer floor change only. The real renderer retires its own result.
    const snapshot = globalThis.__omocUiFixture.snapshot;
    snapshot.revision++;
    snapshot.observationSequence++;
  });
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-status",
    "stale",
  );
  await expect(permissionRules("session")).toHaveCount(0);
  assert.deepEqual(await permissionCounters(), observed);

  await permissionScenario("ordered");
  await observePermissionPolicy();
  const rows = permissionRules("session").locator("li");
  await expect(rows).toHaveCount(3);
  assert.deepEqual(await rows.locator("dd:nth-of-type(3)").allTextContents(), [
    "deny",
    "allow",
    "deny",
  ]);
  assert.equal(
    await rows.nth(0).textContent(),
    await rows.nth(2).textContent(),
  );
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-baseline",
    "mismatch",
  );
  const summary = permissionTask().locator(":scope > summary");
  await reveal(summary);
  await summary.click();
  await expect(permissionTask()).not.toHaveAttribute("open", "");
  await expect(summary).toContainText("앱 필수 규칙과 다름");
  await expect(summary).toBeVisible();

  for (const [name, text] of [
    ["absent", "규칙 필드 없음 (absent)"],
    ["empty", "규칙 필드 있음 · 빈 목록 (present)"],
  ]) {
    await permissionScenario(name);
    await observePermissionPolicy();
    await expect(permissionTask()).toContainText(text);
    await expect(permissionRules("session").locator("li")).toHaveCount(0);
  }
  await permissionScenario("unavailable");
  await observePermissionPolicy("unavailable");
  await expect(permissionTask()).toContainText("규칙이 없다는 뜻은 아닙니다.");
  await expect(permissionRules("session")).toHaveCount(0);
  await permissionScenario("mapping-mismatch");
  const mappingBefore = await permissionCounters();
  await reveal(permissionAction("observe"));
  await permissionAction("observe").click();
  await expect(permissionTask()).toHaveAttribute(
    "data-permission-policy-status",
    "error",
  );
  assert.equal((await permissionCounters()).reads.length, 1);
  assert.equal((await permissionCounters()).io, 0);
  const mappingAfter = await permissionCounters();
  assert.equal(mappingAfter.effects, mappingBefore.effects);
  assert.equal(mappingAfter.intents, mappingBefore.intents);
  assert.deepEqual(mappingAfter.mutations, mappingBefore.mutations);

  for (const method of ["cancel", "Escape"]) {
    await permissionScenario("pending");
    const cancelBefore = await permissionCounters();
    await reveal(permissionAction("observe"));
    await permissionAction("observe").click();
    await expect(permissionTask()).toHaveAttribute(
      "data-permission-policy-status",
      "checking",
    );
    await expect(permissionAction("cancel")).toHaveText("확인 취소");
    await composer().fill(`SYNTHETIC editable during ${method}`);
    await reveal(permissionAction("cancel"));
    await permissionAction("cancel").focus();
    await page.keyboard.press("Tab");
    await expect(
      permissionTask().locator("[data-runtime-task-close]"),
    ).toBeFocused();
    if (method === "cancel") {
      await permissionAction("cancel").click();
      await expect(permissionTask().getByRole("status")).toBeFocused();
    } else {
      await page.keyboard.press("Escape");
      await expect(await popover("permission")).toBeHidden();
      await expect(chip("permission")).toBeFocused();
    }
    await expect(permissionTask()).toHaveAttribute(
      "data-permission-policy-status",
      "not_observed",
    );
    await application.evaluate(() =>
      globalThis.__omocUiFixture.releasePermissionPolicyReads(),
    );
    await page.waitForTimeout(50);
    await expect(permissionTask()).toHaveAttribute(
      "data-permission-policy-status",
      "not_observed",
    );
    await expect(permissionRules("session")).toHaveCount(0);
    assert.equal((await permissionCounters()).reads.length, 1);
    const cancelAfter = await permissionCounters();
    assert.equal(cancelAfter.effects, cancelBefore.effects);
    assert.equal(cancelAfter.intents, cancelBefore.intents);
    assert.deepEqual(cancelAfter.mutations, cancelBefore.mutations);
    await expect(composer()).toHaveValue(`SYNTHETIC editable during ${method}`);
  }
  for (const name of ["untrusted", "held"]) {
    await permissionScenario(name);
    await expect(permissionAction("observe")).toBeDisabled();
    await composer().fill(`SYNTHETIC ${name} draft remains editable`);
    await expect(composer()).toHaveValue(
      `SYNTHETIC ${name} draft remains editable`,
    );
    assert.equal((await permissionCounters()).reads.length, 0);
  }
  await permissionScenario("long-values");
  await observePermissionPolicy();
  for (const [theme, width, zoom] of [
    ["light", 1440, 1],
    ["dark", 760, 1],
    ["dark", 1440, 2],
  ]) {
    await display(theme, width, zoom);
    await reveal(permissionTask().locator(":scope > summary"));
    const label = `permission-policy-${theme}-${width}-${zoom * 100}`;
    await permissionFullValues(label);
    await shot(label);
  }
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
  processHandle = application.process();
  for (const stream of ["stdout", "stderr"])
    processHandle[stream]?.on("data", () => {});
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(bounded(error)));
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  await page.route(/^https?:/i, (route) => route.abort("blockedbyclient"));
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await exerciseFoundation();
  await exercisePermissionPolicy();
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
