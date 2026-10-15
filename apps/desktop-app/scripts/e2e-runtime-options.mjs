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
import { openComposerPopover } from "./e2e-composer.mjs";
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
// Agent and model/variant live in separate chip popovers; `requested` is the
// model fieldset (model + variant + hints).
const requested = () =>
  page.locator('fieldset[data-runtime-source="requested"]').last();
const sessionReport = () => page.locator('[data-runtime-source="session"]');
const responseReport = () => page.locator("[data-response-runtime]").first();
const agentRequest = () =>
  page.getByRole("combobox", {
    name: "Agent 요청",
    exact: true,
    includeHidden: true,
  });
const modelRequest = () =>
  page.getByRole("combobox", {
    name: "모델 요청",
    exact: true,
    includeHidden: true,
  });
const variantRequest = () =>
  page.getByRole("combobox", {
    name: "Variant 요청",
    exact: true,
    includeHidden: true,
  });
const composer = () =>
  page.getByRole("textbox", { name: "메시지 작성", exact: true });
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
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await expect(requested()).toBeAttached();
  return scope;
}
async function reveal(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 0.5 });
}
async function expand(locator) {
  if (!(await locator.evaluate((element) => element.open))) {
    const summary = locator.locator("summary");
    await reveal(summary);
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(locator).toHaveAttribute("open", "");
}
async function geometry() {
  const value = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  assert.ok(value.scrollWidth <= value.width + 1, JSON.stringify(value));
}
async function choose(scope, variant = scope.variant) {
  await expect(
    modelRequest().locator(`option[value="${scope.model}"]`),
  ).toHaveCount(1);
  await openComposerPopover(page, "agent");
  await agentRequest().selectOption(scope.agent);
  await openComposerPopover(page, "model");
  await modelRequest().selectOption(scope.model);
  await variantRequest().selectOption(variant);
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
  await choose(scope);
  await composer().fill("SYNTHETIC next-send request");
  await openComposerPopover(page, "model");
  await modelRequest().focus();
  await page.keyboard.press("Tab");
  await expect(variantRequest()).toBeFocused();
  await shot("requested-keyboard");
  assert.equal(
    (await sends()).length,
    initialSends,
    "Option changes must stage only",
  );
  await openComposerPopover(page, "model");
  await expect(sessionReport()).toContainText("session-model");
  await expect(sessionReport()).toContainText("session.variant");
  await expand(responseReport());
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
      await expand(responseReport());
      await reveal(modelRequest());
      await shot(`${theme}-${width}-zoom${zoom}-requested`);
      await reveal(sessionReport());
      await shot(`${theme}-${width}-zoom${zoom}-session`);
      await reveal(responseReport().locator("summary"));
      await shot(`${theme}-${width}-zoom${zoom}-response`);
      if (zoom === 2) {
        const values = responseReport().locator("dd");
        await expect(values).toHaveCount(4);
        for (let index = 0; index < 4; index++) {
          await values.nth(index).scrollIntoViewIfNeeded();
          await expect(values.nth(index)).toBeInViewport({ ratio: 0.95 });
          await shot(`${theme}-200-response-value-${index}`);
        }
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
  await openComposerPopover(page, "model");
  await expect(variantRequest().locator("option:checked")).toContainText(
    "사용 불가",
  );
  await expect(variantRequest()).toHaveValue(scope.variant);
  await expect(send()).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Variant");
  await reveal(variantRequest());
  await shot("removed-variant-retained-blocked");
  assert.equal((await sends()).length, initialSends);
  await modelRequest().selectOption("fixture-other-model");
  await expect(variantRequest()).toHaveValue("");
  await expect(page.locator('[data-variant-cleared="true"]')).toBeVisible();
  await shot("model-change-clears-variant");
  assert.equal((await sends()).length, initialSends);

  for (const name of ["missing", "malformed", "duplicate"]) {
    scope = await scenario(name);
    await choose(scope, "");
    await composer().fill("SYNTHETIC model with no explicit variant");
    await expect(requested()).toContainText(
      "Variant 목록을 확인할 수 없습니다.",
    );
    await expect(variantRequest().locator("option")).toHaveCount(1);
    await expect(send()).toBeEnabled();
    await reveal(variantRequest());
    await shot(`${name}-variants-unavailable`);
  }

  await scenario("absent");
  await openComposerPopover(page, "model");
  await expect(sessionReport()).toContainText(
    "현재 세션: 설정 보고가 없습니다.",
  );
  await reveal(sessionReport());
  await shot("session-no-report");
  await expand(responseReport());
  await expect(responseReport()).toContainText(
    "이 응답에 실행 정보 보고가 없습니다.",
  );
  await reveal(responseReport().locator("summary"));
  await shot("response-no-report");
  await scenario("failed");
  await openComposerPopover(page, "model");
  await expect(sessionReport()).toContainText(
    "현재 세션: 설정 보고가 없습니다.",
  );
  await shot("failed-session-refresh");
  await expand(responseReport());
  await expect(responseReport()).toContainText("response-model");
  await shot("failed-session-independent-response");
  await scenario("historical");
  await expand(responseReport());
  await expect(responseReport()).toContainText("removed-response-model");
  await expect(modelRequest().locator("option")).not.toContainText([
    "removed-response-model",
  ]);
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
  await shot("explicit-request-pending-ack");
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseSendAcks(),
  );
  await expect(modelRequest()).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "현재 세션 실행 중단", exact: true }),
  ).toBeVisible();
  await openComposerPopover(page, "model");
  await modelRequest().selectOption("fixture-other-model");
  await expect(variantRequest()).toHaveValue("");
  await variantRequest().selectOption("other.variant");
  await composer().fill("SYNTHETIC editable next running draft");
  await reveal(modelRequest());
  await shot("running-next-draft");
  let requests = await sends();
  assert.equal(requests.length, initialSends + 1);
  assert.equal(requests.at(-1).model, scope.model);
  assert.equal(requests.at(-1).variant, scope.variant);
  await openComposerPopover(page, "model");
  await expect(sessionReport()).toContainText("session.variant");
  await shot("running-distinct-session-setting");
  await expand(responseReport());
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
  await openComposerPopover(page, "model");
  await expect(sessionReport()).toContainText("session.variant");
  await shot("omitted-request-preserves-observed-variant");

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
  await expect(modelRequest()).toHaveValue("");
  await expect(variantRequest()).toHaveValue("");
  await reveal(composer());
  await shot("unknown-original-key-no-replay");
  assert.equal((await sends()).length, initialSends + 2);
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
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
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
