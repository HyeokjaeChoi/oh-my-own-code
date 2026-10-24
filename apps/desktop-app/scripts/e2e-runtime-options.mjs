// Execute only through the fixed runtime-options evidence wrapper.
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
import {
  closeComposerPopovers,
  modelOption,
  openComposerPopover,
  pickModel,
  pickVariant,
} from "./e2e-composer.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw Error("Use fixed runtime-options run-evidence selector");
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

// Selectors come from the actual runtime-options renderer source checkpoint.
// Agent, model and effort (추론 강도) live in separate chip popovers; `requested`
// is the model popover body (search + list + hint).
const requested = () =>
  page
    .locator('[data-runtime-source="requested"]')
    .filter({ has: page.locator("[data-model-picker]") });
const responseReport = () => page.locator("[data-response-runtime]").first();
// The session's own report is no longer a line in the picker: a mismatch with
// the next request shows as a dot on the model chip with the detail in its title.
const modelChip = () => page.getByRole("button", { name: "모델:" }).first();
const effortChip = () =>
  page.getByRole("button", { name: "추론 강도:" }).first();
// Agent rows are radios named by the agent's display name; values are ids.
const agentRadio = (id) =>
  page.locator(
    `[role="radiogroup"][aria-label="에이전트"] input[value="${id}"]`,
  );
const modelSearch = () =>
  page.getByRole("combobox", {
    name: "모델 검색",
    exact: true,
    includeHidden: true,
  });
const variantGroup = () =>
  page.getByRole("radiogroup", { name: "추론 강도", includeHidden: true });
// Not by role: the textarea is a combobox while the `@` list is open.
const composer = () => page.locator('textarea[aria-label="메시지 작성"]');
const send = () =>
  page.getByRole("button", { name: "메시지 보내기", exact: true });
const sends = () =>
  application.evaluate(() =>
    globalThis.__omocUiFixture.requests.filter(
      (r) => r.type === "message.send",
    ),
  );
async function scenario(name) {
  currentState = `scenario-${name}`;
  const scope = await application.evaluate(
    (_electron, name) =>
      globalThis.__omocUiFixture.setRuntimeOptionsState(name),
    name,
  );
  await page.reload();
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await expect(modelChip()).toBeAttached();
  return scope;
}
async function reveal(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 0.5 });
}
// The turn meta shows on hover or focus; hovering the turn reveals it.
async function showResponse() {
  // An open popover sits above the composer, over the lower transcript.
  await closeComposerPopovers(page);
  await reveal(responseReport());
  await responseReport().hover();
  await expect(responseReport()).toBeVisible();
}
async function geometry() {
  const value = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  assert.ok(value.scrollWidth <= value.width + 1, JSON.stringify(value));
}
async function choose(scope, variant = scope.variant) {
  await openComposerPopover(page, "agent");
  await agentRadio(scope.agent).check();
  await pickModel(page, scope.model);
  await pickVariant(page, variant);
}
async function refreshCatalog() {
  // Dispatch a synthetic renderer event to the actual onRefocus read listener.
  // This never calls BrowserWindow.focus/show or takes foreground OS focus.
  await page.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.Event("focus")),
  );
}
async function exerciseRuntimeOptions() {
  let scope = await scenario("supported");
  const initialSends = (await sends()).length;
  // Execute the actual legacy check against this current production renderer.
  const legacySource = await readFile(
    new URL("./e2e-workbench-states.mjs", import.meta.url),
    "utf8",
  );
  const legacyGeometry = legacySource.match(
    /async function assertComposerGeometry\(page\) \{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(legacyGeometry);
  const geometryObservations = [];
  await new Function("assert", "observations", `return (${legacyGeometry});`)(
    assert,
    geometryObservations,
  )(page);
  assert.equal(geometryObservations.length, 1);
  legacyGeometryEvidence = {
    path: "apps/desktop-app/scripts/e2e-workbench-states.mjs",
    sourceSha256: createHash("sha256").update(legacySource).digest("hex"),
    functionSha256: createHash("sha256").update(legacyGeometry).digest("hex"),
    observations: geometryObservations,
  };
  // No explicit model: the chip and the checked default row say the same
  // thing, the model the session reports.
  await expect(modelChip()).toContainText("기본 · ");
  const reported = ((await modelChip().textContent()) ?? "")
    .split("기본 · ")[1]
    ?.trim();
  assert.ok(reported, "chip names the session model");
  await openComposerPopover(page, "model");
  const defaultRow = page.locator('[role="option"][data-model-option=""]');
  await expect(defaultRow).toContainText(`지금: ${reported}`);
  await expect(defaultRow).toHaveAttribute("aria-selected", "true");
  await closeComposerPopovers(page);
  // The sidebar time comes from the session's own updatedAt, not observation.
  await expect(
    page.locator(".session-list li").filter({ hasText: "Runtime Session B" }),
  ).toContainText("3시간");
  // Mode switching: no agent chip by default; Shift+Tab cycles and wraps.
  const indicator = () => page.getByRole("button", { name: /^에이전트 모드:/ });
  await expect(indicator()).toHaveCount(0);
  // The `/` entry removes the slash token and opens the popover inside the card's bounds.
  await composer().fill("");
  await composer().focus();
  await page.keyboard.type("/에이");
  await page.getByRole("button", { name: "에이전트 모드 바꾸기" }).click();
  const modePanel = page.getByRole("group", { name: "에이전트", exact: true });
  await expect(modePanel).toBeVisible();
  await expect(composer()).toHaveValue("");
  const edges = await modePanel.evaluate((el) => {
    const p = el.getBoundingClientRect();
    const c = el.ownerDocument
      .querySelector("[class*=composerCard]")
      .getBoundingClientRect();
    return { left: p.left - c.left, bottom: p.bottom - c.top };
  });
  assert.ok(edges.left >= -0.5, `popover left of card: ${edges.left}`);
  assert.ok(edges.bottom <= 0.5, `popover overlaps card: ${edges.bottom}`);
  // The composer is its invoker: Escape returns focus there.
  await page.keyboard.press("Escape");
  await expect(modePanel).toBeHidden();
  await expect(composer()).toBeFocused();
  await closeComposerPopovers(page);
  await openComposerPopover(page, "agent");
  const agentCount =
    (await page
      .locator('[role="radiogroup"][aria-label="에이전트"] input')
      .count()) - 1;
  assert.ok(agentCount >= 1, "catalog lists agents");
  await closeComposerPopovers(page);
  await composer().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(indicator()).toHaveCount(1);
  await expect(indicator()).toHaveAttribute(
    "aria-label",
    /\(Shift\+Tab으로 전환\)$/,
  );
  await expect(
    page.getByRole("status").filter({ hasText: "에이전트:" }),
  ).toHaveCount(1);
  await expect(composer()).toBeFocused();
  for (let i = 1; i < agentCount; i++) await page.keyboard.press("Shift+Tab");
  await expect(indicator()).toHaveCount(1);
  await page.keyboard.press("Shift+Tab");
  await expect(indicator()).toHaveCount(0);
  // The indicator opens the existing agent popover.
  await page.keyboard.press("Shift+Tab");
  await indicator().click();
  await expect(
    page.getByRole("group", { name: "에이전트", exact: true }),
  ).toBeVisible();
  await closeComposerPopovers(page);
  // While the `@` list is open Shift+Tab is left to the browser (focus moves).
  await composer().fill("@");
  await expect(page.locator("[data-context-mention]")).toBeVisible();
  await composer().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(composer()).not.toBeFocused();
  await expect(indicator()).toHaveCount(1);
  await composer().fill("");
  await closeComposerPopovers(page);
  await choose(scope);
  await composer().fill("SYNTHETIC next-send request");
  await openComposerPopover(page, "model");
  await modelSearch().focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: "무료만" })).toBeFocused();
  await page.keyboard.press("Tab");
  // Reasoning levels are their own chip: opening it focuses the selected level.
  await openComposerPopover(page, "effort");
  await expect(
    variantGroup().getByRole("radio", { name: scope.variant, exact: true }),
  ).toBeFocused();
  await shot("requested-keyboard");
  assert.equal(
    (await sends()).length,
    initialSends,
    "Option changes must stage only",
  );
  await expect(modelChip()).toHaveAttribute("title", /session-model/);
  await expect(effortChip()).toHaveAttribute("title", /session\.variant/);
  await expect(effortChip().locator("[data-runtime-mismatch]")).toHaveCount(1);
  await showResponse();
  await expect(responseReport()).toContainText("response-model");
  await expect(responseReport()).toContainText("response.variant");
  for (const theme of ["light", "dark"]) {
    for (const [width, zoom] of [
      [1440, 1],
      [760, 1],
      [760, 2],
      [320, 1],
    ]) {
      await setDisplay(page, width, 1000, zoom);
      await page.evaluate((theme) => {
        globalThis.document.documentElement.dataset.theme = theme;
        globalThis.document.documentElement.style.colorScheme = theme;
      }, theme);
      await geometry();
      await openComposerPopover(page, "model");
      await reveal(modelSearch());
      await shot(`${theme}-${width}-zoom${zoom}-requested`);
      await reveal(modelChip());
      await shot(`${theme}-${width}-zoom${zoom}-session`);
      await showResponse();
      await shot(`${theme}-${width}-zoom${zoom}-response`);
      if (zoom === 2) {
        // The whole turn meta must be readable: it wraps, never clips.
        await expect(responseReport()).toBeInViewport({ ratio: 0.95 });
        await shot(`${theme}-200-response-value-0`);
        await openComposerPopover(page, "model");
        const hint = requested().locator("p").first();
        await hint.scrollIntoViewIfNeeded();
        await expect(hint).toBeInViewport({ ratio: 0.95 });
        await shot(`${theme}-200-composer-guidance`);
        await send().focus();
        await expect(send()).toBeFocused();
        await expect(send()).toBeInViewport({ ratio: 0.95 });
        await shot(`${theme}-200-send-keyboard-access`);
        assert.equal((await sends()).length, initialSends);
      }
    }
  }
  await setDisplay(page, 1440, 1000, 1);
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "light";
    globalThis.document.documentElement.style.colorScheme = "light";
  });
  assert.equal((await sends()).length, initialSends);

  await application.evaluate(
    (_electron, variant) =>
      globalThis.__omocUiFixture.removeRuntimeVariant(variant),
    scope.variant,
  );
  await refreshCatalog();
  await openComposerPopover(page, "effort");
  const unavailableVariant = variantGroup().getByRole("radio", {
    name: `${scope.variant} (사용 불가)`,
    exact: true,
  });
  await expect(unavailableVariant).toBeChecked();
  await expect(send()).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("추론 강도");
  await reveal(variantGroup());
  await shot("removed-variant-retained-blocked");
  assert.equal((await sends()).length, initialSends);
  await pickModel(page, "fixture-other-model");
  // Choosing a model always closes the picker; the effort chip now reads 기본.
  await expect(page.locator("[data-model-picker]")).toBeHidden();
  await expect(effortChip()).toContainText("기본");
  await openComposerPopover(page, "effort");
  await expect(
    variantGroup().getByRole("radio", {
      name: "기본 (모델 기본값)",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.locator('[data-variant-cleared="true"]')).toContainText(
    "추론 강도 요청을 지웠습니다",
  );
  await shot("model-change-clears-variant");
  assert.equal((await sends()).length, initialSends);

  for (const name of ["missing", "malformed", "duplicate"]) {
    scope = await scenario(name);
    await choose(scope, "");
    await composer().fill("SYNTHETIC model with no explicit variant");
    // No usable list and nothing requested: there is no effort chip to open.
    await expect(effortChip()).toHaveCount(0);
    await expect(send()).toBeEnabled();
    await reveal(modelChip());
    await shot(`${name}-variants-unavailable`);
  }

  // Default model + effort: a variant request needs an explicit model, so the
  // reported model is pinned in the same update and send stays enabled.
  scope = await scenario("supported");
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    const base = JSON.parse(JSON.stringify(f.catalog.models.entries[0]));
    f.catalog.models.entries.push({
      ...base,
      id: "fixture-reported-model",
      name: "SYNTHETIC reported model",
      providerId: "synthetic",
      modelId: "session-model",
    });
  });
  await page.reload();
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await composer().fill("SYNTHETIC default model with effort");
  await expect(send()).toBeEnabled();
  await expect(effortChip()).toBeVisible();
  await pickVariant(page, scope.variant);
  await closeComposerPopovers(page);
  await expect(modelChip()).toContainText("SYNTHETIC reported model");
  await expect(effortChip()).toContainText(scope.variant);
  await expect(send()).toBeEnabled();
  await shot("default-model-effort-pins-reported-model");

  await scenario("absent");
  // No session report: nothing to compare, so the chip carries no mismatch dot.
  await expect(modelChip().locator("[data-runtime-mismatch]")).toHaveCount(0);
  await expect(modelChip()).not.toHaveAttribute("title", /현재 세션/);
  await reveal(modelChip());
  await shot("session-no-report");
  await showResponse();
  await expect(responseReport()).toHaveAttribute(
    "title",
    /이 응답에 실행 정보 보고가 없습니다/,
  );
  await expect(responseReport()).toContainText("실행 정보 없음");
  await shot("response-no-report");
  await scenario("failed");
  await expect(modelChip().locator("[data-runtime-mismatch]")).toHaveCount(0);
  await shot("failed-session-refresh");
  await showResponse();
  await expect(responseReport()).toContainText("response-model");
  await shot("failed-session-independent-response");
  await scenario("historical");
  await showResponse();
  await expect(responseReport()).toContainText("removed-response-model");
  await openComposerPopover(page, "model");
  const options = page.locator('[role="option"][data-model-option]');
  await expect(options.first()).toBeVisible();
  await expect(options).not.toContainText(["removed-response-model"]);
  await closeComposerPopovers(page);
  await shot("historical-response-read-only");
  assert.equal((await sends()).length, initialSends);

  scope = await scenario("supported");
  await choose(scope);
  await composer().fill("SYNTHETIC explicit immutable request");
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdSendAck = true;
  });
  await composer().focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sends()).length).toBe(initialSends + 1);
  await expect
    .poll(() =>
      application.evaluate(
        () => globalThis.__omocUiFixture.heldSendAcks.length,
      ),
    )
    .toBe(1);
  // The composer empties on Enter, not on the ACK.
  await expect(composer()).toHaveValue("");
  // No "checking the connection" status while a send merely awaits its ACK,
  // even past the 1.5s grace for lasting holds.
  await page.waitForTimeout(2000);
  await expect(page.locator("[data-context-held]")).toHaveCount(0);
  // No typing over a send that may still fail; an option change during the
  // send neither brings the text back nor keeps it after acceptance.
  await expect(composer()).toHaveAttribute("readonly", "");
  await pickVariant(page, "");
  await closeComposerPopovers(page);
  await expect(composer()).toHaveValue("");
  await shot("explicit-request-pending-ack");
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseSendAcks(),
  );
  await expect(composer()).not.toHaveAttribute("readonly", "");
  await expect(composer()).toHaveValue("");
  await openComposerPopover(page, "model");
  await expect(modelSearch()).toBeEnabled();
  await closeComposerPopovers(page);
  await expect(
    page.getByRole("button", { name: "현재 세션 실행 중단", exact: true }),
  ).toBeVisible();
  await pickModel(page, "fixture-other-model");
  await openComposerPopover(page, "effort");
  await expect(
    variantGroup().getByRole("radio", {
      name: "기본 (모델 기본값)",
      exact: true,
    }),
  ).toBeChecked();
  await pickVariant(page, "other.variant");
  await composer().fill("SYNTHETIC editable next running draft");
  await reveal(effortChip());
  await shot("running-next-draft");
  let requests = await sends();
  assert.equal(requests.length, initialSends + 1);
  assert.equal(requests.at(-1).model, scope.model);
  assert.equal(requests.at(-1).variant, scope.variant);
  await expect(effortChip()).toHaveAttribute("title", /session\.variant/);
  await shot("running-distinct-session-setting");
  await showResponse();
  await expect(responseReport()).toContainText("response.variant");
  await shot("running-distinct-response-report");

  scope = await scenario("supported");
  await choose(scope, "");
  await composer().fill("SYNTHETIC variant omitted, no reset claim");
  await composer().focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sends()).length).toBe(initialSends + 2);
  requests = await sends();
  assert.equal(Object.hasOwn(requests.at(-1), "variant"), false);
  await expect(effortChip()).toHaveAttribute("title", /session\.variant/);
  await shot("omitted-request-preserves-observed-variant");

  // Korean IME: each composition update must stay one composing syllable
  // (no stale re-render committing jamo), and Enter after it sends.
  scope = await scenario("supported");
  await choose(scope, "");
  await closeComposerPopovers(page);
  await composer().fill("");
  await composer().focus();
  const cdp = await page.context().newCDPSession(page);
  for (const text of ["ㅁ", "마", "만"])
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: 1,
      selectionEnd: 1,
    });
  await cdp.send("Input.insertText", { text: "만" });
  for (const text of ["ㄷ", "드", "들"])
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: 1,
      selectionEnd: 1,
    });
  await cdp.send("Input.insertText", { text: "들" });
  await expect(composer()).toHaveValue("만들");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sends()).length).toBe(initialSends + 3);
  assert.equal((await sends()).at(-1).text, "만들");
  await cdp.detach();

  // A send that is not accepted gives the text back to the composer.
  scope = await scenario("supported");
  await choose(scope, "");
  await closeComposerPopovers(page);
  await composer().fill("SYNTHETIC not accepted");
  await application.evaluate(() => {
    globalThis.__omocUiFixture.nextSendUnknown = true;
  });
  await composer().focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sends()).length).toBe(initialSends + 4);
  await expect(composer()).toHaveValue("SYNTHETIC not accepted");

  // A failed last turn is explained on the turn itself; the generic page
  // banner stays hidden and no provider text is shown.
  await scenario("supported");
  await application.evaluate(() => {
    const fixture = globalThis.__omocUiFixture;
    const snapshot = fixture.snapshot;
    const messages = [
      { id: "fail-user", role: "user", text: "SYNTHETIC ask", tools: [] },
      {
        id: "fail-assistant",
        role: "assistant",
        text: "",
        tools: [],
        failure: { status: 403, kind: "auth" },
      },
    ];
    snapshot.messages = messages;
    fixture.sessionMessages.set("fixture-s", messages);

    snapshot.error = {
      code: "AUTH_REQUIRED",
      message: "No verified model credentials are available.",
    };
  });
  await page.reload();
  const authNote = page.locator('[data-free-failure="auth"]');
  await expect(authNote).toContainText(
    "제공자가 요청을 거부했습니다. 키 또는 요금제를 확인하세요.",
  );
  await expect(
    authNote.getByRole("button", { name: "설정 열기" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "요청을 완료하지 못했습니다. 연결과 현재 상태를 다시 확인하세요.",
    ),
  ).toHaveCount(0);
  await shot("inline-auth-failure");
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "dark";
    globalThis.document.documentElement.style.colorScheme = "dark";
  });
  await shot("inline-auth-failure-dark");
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "light";
    globalThis.document.documentElement.style.colorScheme = "light";
  });

  await scenario("unknown");
  await expect(send()).toBeDisabled();
  await expect
    .poll(() =>
      application.evaluate(() =>
        globalThis.__omocUiFixture.lookups.some(
          (r) =>
            r.runtimeEpoch === "fixture-original-runtime-epoch" &&
            r.operationId === "fixture-original-runtime-send",
        ),
      ),
    )
    .toBe(true);
  await openComposerPopover(page, "model");
  await expect(modelOption(page, "")).toHaveAttribute("aria-selected", "true");
  await expect(effortChip()).toHaveCount(0);
  await reveal(composer());
  await shot("unknown-original-key-no-replay");
  assert.equal((await sends()).length, initialSends + 4);
  const original = await application.evaluate(
    () => globalThis.__omocUiFixture.snapshot.retainedOperations[0],
  );
  assert.equal(Object.hasOwn(original, "model"), false);
  assert.equal(Object.hasOwn(original, "variant"), false);
}

try {
  before = await captureProvenance(root, { script: "runtime-options" });
  fixtureRoot = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-runtime-options-ui-")),
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
  await exerciseRuntimeOptions();
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
    after = await captureProvenance(root, { script: "runtime-options" });
    if (before) assert.deepEqual(after, before);
  } catch (error) {
    failure ??= error;
  }
}
try {
  await writeFile(
    join(run, "runtime-options-evidence.json"),
    JSON.stringify(
      {
        result: failure ? "fail" : "pass",
        state: currentState,
        platform: process.platform,
        states,
        screenshots,
        legacyGeometryEvidence,
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
