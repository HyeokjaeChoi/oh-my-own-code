// Execute only through the fixed conversation-context evidence wrapper.
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
import { COMPOSER_POPOVERS, openComposerPopover } from "./e2e-composer.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw Error("Use fixed conversation-context run-evidence selector");
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
const valueCoverage = [];
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

// Saved only. Main owns coherent build, source review and explicit invocation.
export const SAVED_INVOCATION = Object.freeze([
  "node",
  "apps/desktop-app/scripts/run-evidence.mjs",
  "--script",
  "conversation-context",
  "--out",
  "docs/runs/conversation-context/evidence/hidden-r1",
]);
// Hooks inspected in the actual renderer feature. No store injection or fake UI.
// Attach, request and running-task controls live in native popovers; only one
// popover is open at a time, so each step opens the one it needs.
const attachTrigger = () =>
  page.getByRole("button", { name: COMPOSER_POPOVERS.attach }).first();
const composer = () =>
  page.getByRole("textbox", { name: "메시지 작성", exact: true });
const send = () =>
  page.getByRole("button", { name: "메시지 보내기", exact: true });
const hook = (name) => page.locator(`[data-context-${name}]`);
const requests = () =>
  application.evaluate(() => globalThis.__omocUiFixture.requests);
async function reveal(locator, ratio = 0.95) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio });
}
async function expand(locator) {
  if (!(await locator.evaluate((element) => element.open))) {
    const summary = locator.locator(":scope > summary");
    await reveal(summary);
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(locator).toHaveAttribute("open", "");
}
async function scenario(name) {
  currentState = `scenario-${name}`;
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.releaseContextReads?.();
    f.releaseContextPrompts?.();
    f.releaseContextForks?.();
    f.releaseContextCancels?.();
  });
  const scope = await application.evaluate(
    (_electron, name) =>
      globalThis.__omocUiFixture.setConversationContextState(name),
    name,
  );
  await page.reload();
  const connected = !["global-held"].includes(name);
  if (connected)
    await expect(
      page.locator(".workbench-header [data-state]"),
    ).toHaveAttribute("data-state", "connected");
  await expect(attachTrigger()).toBeAttached();
  await openComposerPopover(page, "attach");
  assert.deepEqual(
    await application.evaluate(() => [
      globalThis.__omocUiFixture.contextReads.length,
      globalThis.__omocUiFixture.inboxReads.length,
    ]),
    [0, 0],
    "Reload never auto-observes Context or inbox",
  );
  return scope;
}
async function observe(scope) {
  await hook("path").fill(scope.path);
  await reveal(hook("observe"));
  await hook("observe").click();
  await expect(hook("item")).toHaveCount(1);
}
async function noHorizontalOverflow() {
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
}
async function inspectLegacyGeometry() {
  const source = await readFile(
    new URL("./e2e-workbench-states.mjs", import.meta.url),
    "utf8",
  );
  const code = source.match(
    /async function assertComposerGeometry\(page\) \{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(code, "Execute actual legacy composer check");
  const observations = [];
  await new Function("assert", "observations", `return (${code});`)(
    assert,
    observations,
  )(page);
  assert.equal(observations.length, 1);
  const contextGeometry = await composer().evaluate((input) => {
    const form = input.closest("form");
    const context = input.ownerDocument.querySelector("[data-context-tasks]");
    const toolbar = form.querySelector(
      'button[aria-label="앱 동작과 명령 열기"]',
    ).parentElement;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      input: box(input),
      context: box(context),
      toolbar: box(toolbar),
      form: box(form),
      contextInsideForm: form.contains(context),
    };
  });
  assert.equal(contextGeometry.contextInsideForm, false);
  assert.ok(
    contextGeometry.context.bottom <= contextGeometry.form.top + 1,
    "Context tasks must stay outside and above the message form",
  );
  assert.ok(contextGeometry.input.bottom <= contextGeometry.toolbar.top + 1);
  assert.ok(contextGeometry.form.bottom >= contextGeometry.toolbar.bottom);
  legacyGeometryEvidence = {
    path: "apps/desktop-app/scripts/e2e-workbench-states.mjs",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    functionSha256: createHash("sha256").update(code).digest("hex"),
    observations,
    contextGeometry,
  };
}
async function captureValues(prefix, selectors) {
  const targets = [];
  for (const selector of selectors) {
    const values = page.locator(selector);
    const count = await values.count();
    assert.ok(count > 0, `Required Context value missing: ${selector}`);
    for (let index = 0; index < count; index++)
      targets.push({
        selector,
        index,
        locator: values.nth(index),
        covered: false,
      });
  }
  for (const target of targets) {
    if (target.covered) continue;
    await reveal(target.locator);
    // One original native frame can prove multiple fully exposed values. The
    // observer accounts for scroll-container clipping, not just window bounds.
    const exposed = await Promise.all(
      targets
        .filter((x) => !x.covered)
        .map(async (x) => {
          const observed = await x.locator.evaluate(
            (element) =>
              new Promise((resolve) => {
                const observer = new globalThis.IntersectionObserver(
                  ([entry]) => {
                    observer.disconnect();
                    const rect = element.getBoundingClientRect();
                    resolve({
                      ratio: entry.intersectionRatio,
                      rect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                      },
                    });
                  },
                  { threshold: [0, 0.95, 1] },
                );
                observer.observe(element);
              }),
          );
          return { target: x, observed };
        }),
    );
    const visible = exposed.filter(
      (x) =>
        x.observed.ratio >= 0.95 &&
        x.observed.rect.width > 0 &&
        x.observed.rect.height > 0,
    );
    assert.ok(
      visible.some((x) => x.target === target),
      "Revealed value must be in this frame",
    );
    const frame = screenshots.length;
    await shot(`${prefix}-values-${frame}`);
    for (const x of visible) {
      // Keep the guarantee on both sides of capture; never credit a value that
      // moved out of the clipped viewport while the native frame was captured.
      await expect(x.target.locator).toBeInViewport({ ratio: 0.95 });
      x.target.covered = true;
      valueCoverage.push({
        prefix,
        selector: x.target.selector,
        index: x.target.index,
        frame,
        path: screenshots[frame].path,
        ...x.observed,
      });
    }
  }
  assert.ok(
    targets.every((x) => x.covered),
    "All requested values need original native-frame evidence",
  );
}

async function captureResponsive(prefix, selectors) {
  for (const theme of ["light", "dark"]) {
    for (const [width, zoom] of [
      [320, 1],
      [760, 1],
      [760, 2],
    ]) {
      await setDisplay(page, width, 1000, zoom);
      await page.evaluate((theme) => {
        globalThis.document.documentElement.dataset.theme = theme;
        globalThis.document.documentElement.style.colorScheme = theme;
      }, theme);
      await noHorizontalOverflow();
      await captureValues(`${prefix}-${theme}-${width}-zoom${zoom}`, selectors);
    }
  }
  await setDisplay(page, 1440, 1000, 1);
}
async function exerciseConversationContext() {
  let scope = await scenario("ready");
  await setDisplay(page, 1440, 1000, 1);
  await inspectLegacyGeometry();
  const initial = (await requests()).length;
  await openComposerPopover(page, "model");
  await page
    .getByRole("combobox", { name: "모델 요청", exact: true })
    .selectOption(scope.model);
  await openComposerPopover(page, "attach");
  await hook("path").fill(scope.path);
  await hook("path").focus();
  await page.keyboard.press("Tab");
  await expect(hook("observe")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(hook("path")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(hook("item")).toHaveCount(1);
  assert.equal(await hook("text").textContent(), scope.text);
  await expect(hook("item")).toContainText("44 bytes");
  await composer().fill("SYNTHETIC staged request");
  await expand(hook("item").locator("details"));
  for (const theme of ["light", "dark"]) {
    for (const [width, zoom] of [
      [1440, 1],
      [760, 1],
      [320, 1],
      [760, 2],
    ]) {
      await setDisplay(page, width, 1000, zoom);
      await page.evaluate((theme) => {
        globalThis.document.documentElement.dataset.theme = theme;
        globalThis.document.documentElement.style.colorScheme = theme;
      }, theme);
      await noHorizontalOverflow();
      const prefix = `${theme}-${width}-zoom${zoom}`;
      // Expose each actual path/source/bytes/hash/preview/control, including200%.
      await captureValues(prefix, [
        "[data-context-item] > strong",
        "[data-context-item] > span",
        "[data-context-item] dd",
        "[data-context-preview] > strong",
        "[data-context-text]",
        "[data-context-reobserve]",
        "[data-context-remove]",
        "[data-context-close-preview]",
      ]);
      await reveal(send());
      await send().focus();
      await expect(send()).toBeFocused();
      await shot(`${prefix}-final-send-control`);
      assert.equal(
        (await requests()).length,
        initial,
        "Layout/keyboard inspection must not submit",
      );
    }
  }
  await setDisplay(page, 1440, 1000, 1);
  // Actual DOM selection uses captured UTF-16 offsets. Never fabricate its text.
  await hook("text").evaluate((element) => {
    const range = globalThis.document.createRange();
    range.setStart(element.firstChild, 1);
    range.setEnd(element.firstChild, 24);
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    element.dispatchEvent(
      new globalThis.MouseEvent("mouseup", { bubbles: true }),
    );
  });
  await expect(hook("selection")).toBeEnabled();
  await hook("selection").click();
  await expect(page.locator('[data-context-source="selection"]')).toHaveCount(
    1,
  );
  await reveal(
    page.locator('[data-context-source="selection"] > span').first(),
  );
  await shot("captured-selection-reference");
  assert.equal((await requests()).length, initial);
  await composer().focus();
  await page.keyboard.press("Escape");
  await expect(composer()).toHaveValue("SYNTHETIC staged request");
  assert.equal((await requests()).length, initial);
  const commands = page.getByRole("button", {
    name: "앱 동작과 명령 열기",
    exact: true,
  });
  await reveal(commands);
  await commands.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "앱 동작 및 런타임 명령", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "앱 동작 및 런타임 명령", exact: true }),
  ).toHaveCount(0);
  await expect(commands).toBeFocused();
  assert.equal((await requests()).length, initial);
  // Enter runs the real normal-send path only after explicit staging.
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdContextPrompt = true;
  });
  await composer().focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.heldContextPrompts.length,
      ),
    )
    .toBe(1);
  await shot("normal-context-pending-ACK");
  await composer().fill("SYNTHETIC next editable draft");
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseContextPrompts(),
  );
  await expect(composer()).toHaveValue("SYNTHETIC next editable draft");
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.pendingContextIO.size,
      ),
    )
    .toBe(0);
  assert.equal((await requests()).length, initial + 1);
  await shot("known-request-admission-next-draft");

  for (const name of ["image", "pdf"]) {
    scope = await scenario(name);
    await observe(scope);
    await expect(hook("preview")).toHaveAttribute("data-context-preview", name);
    if (name === "image") {
      await expect(hook("image")).toHaveAttribute(
        "src",
        /^data:image\/png;base64,/,
      );
      await expect
        .poll(() =>
          hook("image").evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    } else
      await expect(hook("pdf")).toContainText(
        "PDF 내용 미리보기를 사용할 수 없습니다.",
      );
    await reveal(hook(name));
    await shot(`${name}-captured-preview`);
    await expand(hook("item").locator("details"));
    await captureResponsive(name, [
      "[data-context-item] > strong",
      "[data-context-item] > span",
      "[data-context-item] dd",
      `[data-context-${name}]`,
      "[data-context-close-preview]",
    ]);
    await setDisplay(page, 1440, 1000, 1);
  }
  for (const [name, reason] of Object.entries({
    missing: "missing_file",
    denied: "path_denied",
    protected: "protected_source",
    oversized: "too_large",
    changed: "file_changed",
    unsupported: "unsupported_content",
  })) {
    scope = await scenario(name);
    await hook("path").fill(scope.path);
    await hook("observe").click();
    await expect(hook("error")).toHaveAttribute("data-context-error", reason);
    await expect(hook("item")).toHaveCount(0);
    await reveal(hook("error"));
    await shot(`${name}-explicit-refusal`);
    await captureResponsive(name, [
      "[data-context-error]",
      "[data-context-observe]",
    ]);
  }
  for (const name of ["unsupported-model", "missing-capabilities"]) {
    scope = await scenario(name);
    await observe(scope);
    await openComposerPopover(page, "model");
    await page
      .getByRole("combobox", { name: "모델 요청", exact: true })
      .selectOption(scope.model);
    await composer().fill("SYNTHETIC unsupported input remains editable");
    await expect(send()).toBeDisabled();
    await reveal(hook("send-blocked"));
    await shot(`${name}-no-text-substitution`);
    await captureResponsive(name, [
      "[data-context-send-blocked]",
      "[data-context-item] > span",
      '[aria-label="메시지 보내기"]',
    ]);
  }
  scope = await scenario("ready");
  await page.clock.install();
  await observe(scope);
  await application.evaluate(() =>
    globalThis.__omocUiFixture.expireContextCapabilities(),
  );
  await page.clock.fastForward(600001);
  await expect(hook("error")).toHaveAttribute(
    "data-context-error",
    "CONTEXT_EXPIRED",
  );
  await expect(hook("item")).toHaveCount(1);
  await composer().fill("SYNTHETIC expiry retains editable summary");
  await expect(send()).toBeDisabled();
  await reveal(hook("error"));
  await shot("expired-no-automatic-reread");
  await captureResponsive("expired", [
    "[data-context-error]",
    "[data-context-item] > strong",
    "[data-context-reobserve]",
    '[aria-label="메시지 보내기"]',
  ]);
  assert.equal(
    await application.evaluate(
      () => globalThis.__omocUiFixture.contextReads.length,
    ),
    1,
  );

  scope = await scenario("ready");
  const beforeFork = (await requests()).length;
  await page.locator(`[data-context-edit="${scope.userMessageId}"]`).click();
  await expect(hook("boundary")).toContainText(scope.userMessageId);
  await hook("branch-text").fill("SYNTHETIC edited branch draft");
  await captureResponsive("branch", [
    "[data-context-boundary]",
    "[data-context-branch-text]",
    "[data-context-branch-confirm]",
    "[data-context-branch-close]",
  ]);
  await setDisplay(page, 1440, 1000, 1);
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdContextFork = true;
  });
  await hook("branch-confirm").click();
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.heldContextForks.length,
      ),
    )
    .toBe(1);
  await shot("branch-only-pending");
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseContextForks(),
  );
  await expect(composer()).toHaveValue("SYNTHETIC edited branch draft");
  const forkRequests = (await requests()).slice(beforeFork);
  assert.deepEqual(
    forkRequests.map((r) => r.type),
    ["session.fork"],
  );
  assert.equal(forkRequests[0].before, scope.userMessageId);
  await shot("confirmed-branch-explicit-send-required");

  for (const delivery of ["steer", "queue"]) {
    scope = await scenario("running");
    const count = (await requests()).length;
    await composer().fill(`SYNTHETIC current-run ${delivery}`);
    await openComposerPopover(page, "model");
    await page
      .getByRole("combobox", { name: "모델 요청", exact: true })
      .selectOption("fixture-other-model");
    await openComposerPopover(page, "run");
    if (delivery === "steer")
      await captureValues("running-current-run", [
        "[data-context-steer]",
        "[data-context-queue]",
        "[data-context-inbox-observe]",
      ]);
    await hook(delivery).click();
    await expect.poll(async () => (await requests()).length).toBe(count + 1);
    const request = (await requests()).at(-1);
    assert.equal(request.delivery, delivery);
    for (const key of ["model", "agent", "variant", "attachments"])
      assert.equal(Object.hasOwn(request, key), false);
    await hook("inbox-observe").click();
    await expect(hook("inbox-row")).toHaveCount(1);
    await reveal(hook("inbox-row"));
    await shot(`${delivery}-scoped-inbox`);
  }
  scope = await scenario("queued");
  await openComposerPopover(page, "run");
  await hook("inbox-observe").click();
  await expect(hook("inbox-row")).toHaveCount(1);
  await captureResponsive("inbox", [
    "[data-context-inbox-row] > span",
    "[data-context-inbox-row] pre",
    "[data-context-inbox-cancel]",
  ]);
  await setDisplay(page, 1440, 1000, 1);
  await hook("inbox-cancel").click();
  await expect(hook("notice")).toContainText("취소 요청");
  await reveal(hook("notice"));
  await shot("cancel-request-ACK-not-cancelled");
  await captureResponsive("cancel-request-ACK", [
    "[data-context-notice]",
    "[data-context-inbox-observe]",
  ]);
  await hook("inbox-observe").click();
  await expect(hook("inbox-row")).toHaveCount(1);
  await shot("cancel-ACK-does-not-prove-nonexecution");

  scope = await scenario("pending-read");
  await hook("path").fill(scope.path);
  await hook("observe").click();
  await expect(hook("cancel-read")).toBeVisible();
  await hook("cancel-read").click();
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.snapshot.runtimeEpoch = "fixture-context-late-read-epoch";
    f.releaseContextReads();
  });
  await expect(hook("item")).toHaveCount(0);
  await shot("cancelled-late-read-never-revives");
  scope = await scenario("ready");
  await composer().fill("SYNTHETIC late request");
  const beforeLate = (await requests()).length;
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdContextPrompt = true;
  });
  await composer().focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.heldContextPrompts.length,
      ),
    )
    .toBe(1);
  await composer().fill("SYNTHETIC newer draft under late ACK");
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.snapshot.runtimeEpoch = "fixture-context-late-ACK-epoch";
    f.releaseContextPrompts();
  });
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.pendingContextIO.size,
      ),
    )
    .toBe(0);
  assert.equal((await requests()).length, beforeLate + 1);
  await shot("late-ACK-unknown-no-replay");
  await scenario("unknown");
  await expect(send()).toBeDisabled();
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
  await composer().fill("SYNTHETIC inert unknown draft");
  await openComposerPopover(page, "run");
  await shot("unknown-original-key-editable-no-replay");
  await captureResponsive("unknown", [
    '[aria-label="메시지 작성"]',
    '[aria-label="메시지 보내기"]',
    "[data-context-inbox-observe]",
  ]);
  for (const name of ["held", "global-held", "untrusted"]) {
    await scenario(name);
    await composer().fill(`SYNTHETIC ${name} inert draft`);
    await expect(hook("observe")).toBeDisabled();
    // The queue entry point stays available; its status strip does not.
    await expect(page.locator("[data-run-strip]")).toHaveCount(0);
    await openComposerPopover(page, "run");
    await expect(hook("inbox-observe")).toBeDisabled();
    await expect(send()).toBeDisabled();
    await reveal(composer());
    await shot(`${name}-editable-effects-held`);
  }
}

try {
  before = await captureProvenance(root, { script: "conversation-context" });
  fixtureRoot = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-conversation-context-ui-")),
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
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await exerciseConversationContext();
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
    after = await captureProvenance(root, { script: "conversation-context" });
    if (before) assert.deepEqual(after, before);
  } catch (error) {
    failure ??= error;
  }
}
try {
  await writeFile(
    join(run, "conversation-context-evidence.json"),
    JSON.stringify(
      {
        result: failure ? "fail" : "pass",
        state: currentState,
        platform: process.platform,
        states,
        screenshots,
        legacyGeometryEvidence,
        valueCoverage,
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
