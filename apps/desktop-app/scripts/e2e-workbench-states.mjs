// Synthetic state coverage of the real Electron renderer. This complements,
// and never substitutes for, the real sidecar/lifecycle E2E scripts.
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  lstat,
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
import {
  GIT_REVIEW_UI_STATES,
  WORKSPACE_FILE_UI_STATES,
  WORKSPACE_FILE_RETAINED_KEY,
  AGENT_UI_STATES,
  AGENT_RETAINED_KEY,
  AGENT_RUNTIME_UI_STATES,
  AGENT_RUNTIME_RETAINED_KEY,
  EXTENSIONS_UI_STATES,
  P7_UI_STATES,
  P7_RETAINED_KEY,
  P7_RECOVERY_TEXT,
  SKILL_UI_STATES,
  SKILL_RETAINED_KEY,
  SKILL_RUNTIME_UI_STATES,
  SKILL_RUNTIME_RETAINED_KEY,
} from "./fixtures/workbench-host.mjs";
import { captureProvenance } from "./build-provenance.mjs";
import { closeComposerPopovers, openComposerPopover } from "./e2e-composer.mjs";
import { openWorkspaceMenu, selectWorkspace } from "./e2e-shell.mjs";

import {
  UI_STATE_FAMILIES,
  uiStateFamilies,
  runUiStateFamilies,
} from "./run-evidence.mjs";
const requestedFamily = process.env.OMOC_UI_STATE_FAMILY ?? "all";
const selectedFamilies = uiStateFamilies(requestedFamily);
const executedFamilies = [];
let activeFamily = "bootstrap";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
// Under run-evidence.mjs the wrapper owns containment and fresh output admission.
// Standalone (nx target), claim a private temp evidence dir ourselves.
if (!process.env.OMOC_EVIDENCE_DIR) {
  process.env.OMOC_EVIDENCE_DIR = await mkdtemp(
    join(tmpdir(), "omoc-ui-evidence-"),
  );
  await writeFile(
    join(process.env.OMOC_EVIDENCE_DIR, ".run-evidence-claim"),
    "",
    {
      mode: 0o600,
    },
  );
  console.log(`Evidence dir: ${process.env.OMOC_EVIDENCE_DIR}`);
}
const run = resolve(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(
  claim.isFile() && !claim.isSymbolicLink(),
  "Evidence wrapper claim required",
);
await captureProvenance(root, { script: "ui-states" });
const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-ui-states-")),
);
const require = createRequire(import.meta.url);
const application = await electron
  .launch({
    timeout: 20000,
    executablePath: require("electron"),
    args: [
      join(desktop, "scripts/fixtures/workbench-host.mjs"),
      `--user-data-dir=${join(fixtureRoot, "electron-bootstrap-profile")}`,
    ],
    env: {
      PATH:
        process.platform === "darwin"
          ? "/usr/bin:/bin:/usr/sbin:/sbin"
          : (process.env.PATH ?? "/usr/bin:/bin"),
      HOME: fixtureRoot,
      TMPDIR: fixtureRoot,
      TMP: fixtureRoot,
      TEMP: fixtureRoot,
      OMOC_UI_TEST_ROOT: fixtureRoot,
      OMOC_DESKTOP_E2E_BACKGROUND: "1",
      OMOC_APP_DATA_DIR: join(fixtureRoot, "app-profile"),
      ...(process.platform === "win32" && {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        USERPROFILE: fixtureRoot,
      }),
    },
  })
  .catch(async (error) => {
    await writeFile(
      join(run, "ui-states-evidence.json"),
      JSON.stringify(
        {
          result: "fail",
          platform: process.platform,
          phase: "launch",
          error: String(error),
          providerExecution: "not performed",
          teardown: {
            exited: false,
            retainedRoot: fixtureRoot,
            reason: "No owned exit handle returned by launcher",
          },
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  });
const processHandle = application.process();
const observations = [];
const screenshots = [];
const p6Accessibility = [];
const p6StateFindings = [];
const p7StorageStates = [];
const configurationStates = [];
const configurationDraftStates = [];
const configurationFileStates = [];
const configurationSaveStates = [];
const configurationInstructionStates = [];
const configurationMcpStates = [];
const configurationSkillStates = [];
const configurationSkillRuntimeStates = [];
const configurationAgentStates = [];
const configurationAgentRuntimeStates = [];
const configurationExtensionStates = [];
const workspaceFileStates = [];
const gitReviewStates = [];
let teardown = { exited: false, retainedRoot: fixtureRoot };
let page;
let currentState = "launch";
let failure;
async function capture(page, name, state) {
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
    family: typeof activeFamily === "undefined" ? "unclassified" : activeFamily,
    pixelDimensions,
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
    osWindowFocusable: native.osWindowFocusable,
    osWindowVisible: native.osWindowVisible,
    osWindowFocused: native.osWindowFocused,
    captureMethod: "BrowserWindow.webContents.capturePage().toPNG()",
    provenance:
      "Built production Electron renderer and preload with a test-only synthetic main process; no provider execution",
  });
}

// Bounded computed-style observations: no text, names, prompts or paths.
async function observeP6Accessibility(page, state) {
  const computed = await page.evaluate(() => {
    const doc = globalThis.document;
    const style = (e) => globalThis.getComputedStyle(e);
    const parse = (value) => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const parts = match[1].split(/[, /]+/).map(Number);
      return parts.length >= 3 && parts.every(Number.isFinite)
        ? [...parts.slice(0, 3), parts[3] ?? 1]
        : null;
    };
    const over = (top, bottom) =>
      top.slice(0, 3).map((c, i) => c * top[3] + bottom[i] * (1 - top[3]));
    const background = (e) => {
      const chain = [];
      let opaque = false;
      for (let node = e; node; node = node.parentElement) {
        const css = style(node),
          color = parse(css.backgroundColor);
        if (
          css.backgroundImage !== "none" ||
          !color ||
          Number(css.opacity) !== 1
        )
          return null;
        chain.push(color);
        if (color[3] === 1) {
          opaque = true;
          break;
        }
      }
      if (!opaque) return null; // Do not assume the canvas color.
      return chain
        .reverse()
        .reduce((base, color) => over(color, base), [0, 0, 0]);
    };
    const luminance = (rgb) =>
      rgb
        .map((c) => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) /
      (Math.min(luminance(a), luminance(b)) + 0.05);
    const visible = (e) => {
      const r = e.getBoundingClientRect(),
        css = style(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.top < window.innerHeight &&
        r.right > 0 &&
        r.left < window.innerWidth &&
        css.visibility === "visible" &&
        !e.closest('[aria-hidden="true"], [inert]')
      );
    };
    const samples = [],
      excluded = {
        disabled: 0,
        unsupportedColorOrBackground: 0,
        transparentControlBoundary: 0,
        offscreenOrHidden: 0,
      };
    const elements = [
      ...doc.querySelectorAll(
        'strong,p,span,label,h1,h2,button,input,textarea,select,[role="button"],[role="status"]',
      ),
    ];
    for (const e of elements) {
      if (!visible(e)) {
        excluded.offscreenOrHidden++;
        continue;
      }
      if (
        e.matches(':disabled,[aria-disabled="true"]') ||
        e.closest(':disabled,[aria-disabled="true"]')
      ) {
        excluded.disabled++;
        continue;
      }
      const css = style(e),
        bg = background(e),
        fg = parse(css.color);
      if (!bg || !fg) {
        excluded.unsupportedColorOrBackground++;
        continue;
      }
      const directText = [...e.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim(),
      );
      if (directText || e.matches("input,textarea,select")) {
        const large =
          parseFloat(css.fontSize) >= 24 ||
          (parseFloat(css.fontSize) >= 18.6667 &&
            Number(css.fontWeight) >= 700);
        const value = ratio(over(fg, bg), bg),
          goal = large ? 3 : 4.5;
        samples.push({
          kind: "text",
          tag: e.tagName.toLowerCase(),
          ratio: value,
          goal,
          largeTextException: large,
          meetsGoal: value >= goal,
        });
      }
      if (e.matches('button,input,textarea,select,[role="button"]')) {
        const border = parse(css.borderTopColor),
          adjacent = background(e.parentElement);
        if (
          border &&
          adjacent &&
          parseFloat(css.borderTopWidth) > 0 &&
          css.borderTopStyle !== "none" &&
          border[3] > 0
        ) {
          const value = ratio(over(border, adjacent), adjacent);
          samples.push({
            kind: "controlBoundary",
            tag: e.tagName.toLowerCase(),
            ratio: value,
            goal: 3,
            meetsGoal: value >= 3,
          });
        } else excluded.transparentControlBoundary++;
        if (e.querySelector("svg")) {
          const value = ratio(over(fg, bg), bg);
          samples.push({
            kind: "controlIcon",
            tag: e.tagName.toLowerCase(),
            ratio: value,
            goal: 3,
            meetsGoal: value >= 3,
          });
        }
      }
    }
    const focused = doc.activeElement;
    let focus = {
      status: "unverified",
      reason:
        "No measurable computed outline; box shadows/pseudo-elements need rendered review",
    };
    if (focused && focused !== doc.body) {
      const css = style(focused),
        color = parse(css.outlineColor),
        bg = background(focused.parentElement);
      if (
        color &&
        bg &&
        parseFloat(css.outlineWidth) > 0 &&
        css.outlineStyle !== "none" &&
        color[3] > 0
      ) {
        const value = ratio(over(color, bg), bg);
        focus = {
          status: "observed",
          ratio: value,
          goal: 3,
          meetsGoal: value >= 3,
          outlineWidth: parseFloat(css.outlineWidth),
          focusVisible: focused.matches(":focus-visible"),
        };
      }
    }
    return {
      samples: samples.slice(0, 256),
      totalSamples: samples.length,
      truncated: samples.length > 256,
      excluded,
      focus,
      limits:
        "Computed sRGB solid backgrounds and visible elements only; clipping, gradients, pseudo-elements, antialiasing and screen-reader output require separate rendered review. Transparent border absence does not establish control contrast failure.",
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    const elements = [...globalThis.document.querySelectorAll("*")]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .slice(0, 2048);
    return {
      mediaMatches: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      computed: elements
        .map((e) => {
          const c = globalThis.getComputedStyle(e);
          return {
            transitionDuration: c.transitionDuration,
            animationName: c.animationName,
            animationDuration: c.animationDuration,
          };
        })
        .filter(
          (c) =>
            c.animationName !== "none" ||
            c.transitionDuration.split(",").some((v) => parseFloat(v) > 0),
        ),
      runningAnimations: globalThis.document.getAnimations().length,
      sampledElements: elements.length,
      limits:
        "Computed CSS and active Web Animations in this state; no claim about future motion or perceived movement.",
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const normal = await page.evaluate(() => ({
    runningAnimations: globalThis.document.getAnimations().length,
    mediaMatches: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
  }));
  p6Accessibility.push({
    state,
    contrast: computed,
    reducedMotion: reduced,
    normalMotion: normal,
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

// Runtime request selects live in the Agent / 모델 chip popovers; only one
// popover is open at a time, so callers visit each select in turn.
async function setRequestSettings(page, open) {
  if (!open) await closeComposerPopovers(page);
}

async function eachRequestSelect(page, visit) {
  for (const [kind, name] of [
    ["agent", "Agent 요청"],
    ["model", "모델 요청"],
  ]) {
    await openComposerPopover(page, kind);
    await visit(page.getByRole("combobox", { name }));
  }
  await closeComposerPopovers(page);
}

async function captureMatrix(page, state) {
  for (const [label, width, height, zoom] of [
    ["normal-1280", 1280, 800, 1],
    ["normal-1180", 1180, 820, 1],
    ["narrow", 760, 600, 1],
    ["normal-200-percent", 1280, 800, 2],
    ["narrow-200-percent", 760, 600, 2],
  ]) {
    currentState = `${state}; ${label}`;
    await setDisplay(page, width, height, zoom);
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
    if (zoom === 1 && width >= 900)
      await expect(
        page.getByRole("complementary", { name: "작업 공간과 세션" }),
      ).toBeVisible();
    const composerInput = page.getByRole("textbox", { name: "메시지 작성" });
    const composerForm = composerInput.locator("xpath=ancestor::form");
    await expect(composerInput).toBeInViewport({ ratio: 1 });
    await expect(composerForm).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const submitControl = page.getByRole("button", {
      name: /^(메시지 보내기|현재 세션 실행 중단)$/,
    });
    await setRequestSettings(page, true);
    await expect(submitControl).toBeInViewport({ ratio: 1 });
    const checkHeight = async (control, expected, what) => {
      // Honors the region's scroll-padding above the pinned composer.
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      const bounds = await control.boundingBox();
      assert.ok(
        bounds && Math.abs(bounds.height - expected) <= 1,
        `Desktop ${what} must be ${expected}px (got ${bounds?.height})`,
      );
    };
    await checkHeight(submitControl, 36, "composer send control");
    await eachRequestSelect(page, (control) =>
      checkHeight(control, 40, "request select"),
    );
    if (state === "permission-long-korean-draft") {
      // Open request settings take the height the permission queue needs.
      await setRequestSettings(page, false);
      await expect(
        page.getByRole("region", { name: "실행 권한 요청" }),
      ).toHaveCount(2);
      await expect(
        page.getByRole("button", { name: "현재 세션 실행 중단", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      // Permission text and actions remain inspectable when the queue yields
      // height to the composer. Scrolling must not move the composer offscreen.
      const permissions = page.getByRole("region", { name: "실행 권한 요청" });
      const visible = (locator) => expect(locator).toBeInViewport({ ratio: 1 });
      for (let index = 0; index < 2; index++) {
        const permission = permissions.nth(index);
        await permission
          .getByText(index ? "src/app.ts" : "src/main.ts", { exact: true })
          .scrollIntoViewIfNeeded();
        await visible(
          permission.getByText(index ? "src/app.ts" : "src/main.ts", {
            exact: true,
          }),
        );
        const warning = permission.getByText(
          "거절하면 이 세션의 다른 대기 중 권한 요청도 취소됩니다.",
          { exact: true },
        );
        await warning.scrollIntoViewIfNeeded();
        await visible(warning);
        for (const name of ["이번만 허용", "거절"]) {
          const action = permission.getByRole("button", { name, exact: true });
          await action.scrollIntoViewIfNeeded();
          await visible(action);
          const bounds = await action.boundingBox();
          assert.ok(
            bounds && Math.abs(bounds.height - 36) <= 1,
            "Desktop permission control must be the approved 36px",
          );
        }
        const allow = permission.getByRole("button", {
          name: "이번만 허용",
          exact: true,
        });
        const reject = permission.getByRole("button", {
          name: "거절",
          exact: true,
        });
        const always = permission.getByRole("button", {
          name: "이 프로젝트에서 항상 허용",
          exact: true,
        });
        await allow.focus();
        await visible(allow);
        await page.keyboard.press("Tab");
        await expect(always).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(reject).toBeFocused();
        await visible(reject);
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(allow).toBeFocused();
        await visible(allow);
      }
      await page.getByRole("textbox", { name: "메시지 작성" }).focus();
      await permissions.first().evaluate((element) => {
        element.parentElement.scrollTop = 0;
      });
      await expect(composerForm).toBeInViewport({ ratio: 1 });
      for (const control of [composerInput, submitControl]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 1 });
      }
      await eachRequestSelect(page, async (control) => {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 1 });
      });
    }
    await setRequestSettings(page, false);
    await capture(
      page,
      `desktop-${state}-${label}-synthetic.png`,
      `${state}; ${label}`,
    );
    if (state === "long-korean-titles" && (width < 900 || zoom === 2)) {
      await page
        .getByRole("button", { name: "작업 공간 탐색 열기", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(
        page,
        `desktop-${state}-${label}-navigation-synthetic.png`,
        `${state}; ${label}; navigation sheet`,
      );
      await page.keyboard.press("Escape");
    }
  }
  currentState = `${state}; restored desktop display`;
  await setDisplay(page, 1440, 960);
  await expect(
    page.getByRole("complementary", { name: "작업 공간과 세션" }),
  ).toBeVisible();
}

async function requestCount() {
  return application.evaluate(
    () =>
      globalThis.__omocUiFixture.requests.filter(
        (request) =>
          !["file.list", "file.read", "catalog.list"].includes(request.type),
      ).length,
  );
}

async function assertComposerGeometry(page) {
  const geometry = await page
    .getByRole("textbox", { name: "메시지 작성" })
    .evaluate((input) => {
      const composer = input.closest("form");
      const toolbar = composer.querySelector(
        'button[aria-label="앱 동작과 명령 열기"]',
      ).parentElement;
      const requests = input.ownerDocument.querySelector(
        '[data-runtime-source="requested"]',
      );
      const requestedTask = requests.closest("details");
      const box = (element) => {
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          bottom: value.bottom,
          height: value.height,
          left: value.left,
          right: value.right,
          width: value.width,
        };
      };
      return {
        composer: box(composer),
        input: box(input),
        toolbar: box(toolbar),
        requests: box(requests),
        requestsExpanded: !requestedTask || requestedTask.open,
        requestsInsideComposer: composer.contains(requests),
      };
    });
  for (const [part, minimum] of Object.entries({ input: 72, toolbar: 32 }))
    assert.ok(
      geometry[part].height >= minimum - 1 && geometry[part].width > 0,
      `Foundation ${part} requires usable dimensions: ${JSON.stringify(geometry[part])}`,
    );
  assert.equal(
    geometry.requestsInsideComposer,
    false,
    "Requested settings task must be outside the message form",
  );
  assert.ok(
    geometry.input.bottom <= geometry.toolbar.top + 1,
    "Composer input and toolbar must not overlap",
  );
  for (const part of ["input", "toolbar"])
    assert.ok(
      geometry.composer.top <= geometry[part].top + 1 &&
        geometry.composer.bottom >= geometry[part].bottom - 1 &&
        geometry.composer.left <= geometry[part].left + 1 &&
        geometry.composer.right >= geometry[part].right - 1,
      "Composer must contain independent input and toolbar",
    );
  if (geometry.requestsExpanded && geometry.requests.height > 0)
    assert.ok(
      geometry.requests.bottom <= geometry.composer.top + 1 ||
        geometry.requests.top >= geometry.composer.bottom - 1 ||
        geometry.requests.right <= geometry.composer.left + 1 ||
        geometry.requests.left >= geometry.composer.right - 1,
      "Expanded requested settings must not overlap the Composer",
    );
  observations.push({
    check:
      "Foundation independent input/toolbar dimensions, containment and separated requested task",
    geometry,
  });
}

async function assertOutsideDismissal(
  page,
  trigger,
  kind,
  inputType = "pointer",
) {
  const before = await requestCount();
  if (kind === "dialog")
    await page.evaluate(() => {
      const main = window.document.querySelector(".main-pane");
      window.__backdropClicks = 0;
      window.__backdropObserver = () => window.__backdropClicks++;
      main.addEventListener("click", window.__backdropObserver);
    });
  await trigger.click();
  const layer = page.getByRole(kind);
  await expect(layer).toBeVisible();
  if (kind === "dialog")
    await page.evaluate(() => {
      window.__backdropClicks = 0;
    });
  // Clicking the surface itself must not dismiss or select an action.
  await layer.click({ position: { x: 1, y: 1 } });
  await expect(layer).toBeVisible();
  const bounds = await layer.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const point =
    kind === "dialog"
      ? { x: bounds.x < 10 ? viewport.width - 8 : 8, y: viewport.height / 2 }
      : { x: viewport.width / 2, y: 15 };
  if (inputType === "touch") {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
    }
  } else {
    await page.mouse.click(point.x, point.y);
  }
  await expect(layer).toBeHidden();
  assert.equal(
    await requestCount(),
    before,
    `${kind} outside ${inputType} must not mutate the host`,
  );
  if (kind === "dialog") {
    assert.equal(
      await page.evaluate(() => window.__backdropClicks),
      0,
      "Backdrop gesture must not click through to underlying main pane",
    );
    await page.evaluate(() => {
      window.document
        .querySelector(".main-pane")
        .removeEventListener("click", window.__backdropObserver);
      delete window.__backdropObserver;
      delete window.__backdropClicks;
    });
  }
  if (kind === "dialog") {
    // A modal backdrop consumes the gesture and restores its opener.
    await expect(trigger).toBeFocused();
  } else {
    // Outside pointer dismissal can keep focus on the clicked target or body.
    // Escape focus return is checked separately. Do not force pointer focus
    // back to the opener or retain focus in an unmounted/hidden menu.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = window.document.activeElement;
          return (
            active?.isConnected &&
            (active === window.document.body ||
              (active.getClientRects().length > 0 &&
                !active.closest('[hidden], [aria-hidden="true"], [inert]')))
          );
        }),
      )
      .toBe(true);
  }
  observations.push(
    `${kind}: inside click preserved layer; outside ${inputType === "touch" ? "CDP synthetic touch (not physical touch)" : "mouse pointer"} dismissed it without host mutation; ${kind === "dialog" ? "modal focus returned to opener" : "pointer focus remained on a connected visible target or body"}`,
  );
}

async function assertNestedMenu(page) {
  const trigger = page.getByRole("button", {
    name: "작업 공간 탐색 열기",
    exact: true,
  });
  const before = await requestCount();
  await trigger.click();
  // Radix marks the parent modal aria-hidden while its portalled menu owns focus.
  const dialog = page.getByRole("dialog", { includeHidden: true });
  await expect(dialog).toBeVisible();
  const menuTrigger = dialog.getByRole("button", {
    name: /^작업 공간 전환:/,
  });
  await menuTrigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.click({ position: { x: 1, y: 1 } });
  await expect(menu).toBeVisible();
  const box = await dialog.boundingBox();
  await page.mouse.click(box.x + 12, box.y + 12);
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  // The parent modal still owns focus after its nested menu closes outside.
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        element.contains(window.document.activeElement),
      ),
    )
    .toBe(true);
  await menuTrigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(menuTrigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  assert.equal(
    await requestCount(),
    before,
    "Nested menu dismissal must not mutate the host",
  );
  observations.push(
    "Nested ActionMenu in navigation sheet: inside click retained both layers; outside pointer dismissed only menu and kept focus in parent modal; first Escape returned focus to menu trigger; second Escape dismissed sheet and returned focus to sheet opener; no host mutation",
  );
}

async function assertSlashOutside(page) {
  const opener = page.getByRole("button", {
    name: "앱 동작과 명령 열기",
    exact: true,
  });
  const input = page.getByRole("textbox", { name: "메시지 작성" });
  const menu = page.getByRole("region", {
    name: "앱 동작 및 런타임 명령",
    exact: true,
  });
  const before = await requestCount();
  for (const touch of [false, true]) {
    await opener.click();
    await expect(menu).toBeVisible();
    await menu.getByText("앱 동작", { exact: true }).click();
    await expect(menu).toBeVisible();
    const box = await input.boundingBox();
    // The menu opens above the toolbar and may cover the input's top-left, so
    // probe the first input corner that lies outside the menu.
    const menuBox = await menu.boundingBox();
    const outside = ({ x, y }) =>
      x < menuBox.x ||
      x > menuBox.x + menuBox.width ||
      y < menuBox.y ||
      y > menuBox.y + menuBox.height;
    const point = [
      { x: box.x + 12, y: box.y + 12 },
      { x: box.x + box.width - 12, y: box.y + 12 },
      { x: box.x + 12, y: box.y + box.height - 12 },
      { x: box.x + box.width - 12, y: box.y + box.height - 12 },
    ].find(outside);
    assert.ok(point, "A slash-outside point must exist on the input");
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1 }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      } finally {
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: false,
        });
        await cdp.detach();
      }
    } else await page.mouse.click(point.x, point.y);
    observations.push(
      await page.evaluate(
        ({ point, touch }) => ({
          check: "Slash outside target probe",
          touch,
          point,
          active: window.document.activeElement?.getAttribute("aria-label"),
          hit: window.document
            .elementFromPoint(point.x, point.y)
            ?.outerHTML.slice(0, 300),
          upperLayers: [
            ...window.document.querySelectorAll(
              '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
            ),
          ].map((element) => element.outerHTML.slice(0, 160)),
        }),
        { point, touch },
      ),
    );
    await expect(menu).toBeHidden();
    await expect(input).toBeFocused();
    assert.equal(
      await requestCount(),
      before,
      "Slash outside dismissal must not execute a command",
    );
  }
  await opener.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(opener).toBeFocused();
  observations.push(
    "Custom slash popup: inside preserved; outside mouse/CDP synthetic touch closed, textarea focus preserved, Escape restored opener, no command executed",
  );
}

async function assertCoarseComposer(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
      )
      .toBe(true);
    // Runtime request selects live inside a collapsed details disclosure.
    const checkCoarse = async (control) => {
      const bounds = await control.boundingBox();
      assert.ok(
        bounds && Math.abs(bounds.height - 44) <= 1,
        "Coarse composer control must be 44px",
      );
      await expect(control).toBeInViewport({ ratio: 1 });
    };
    await checkCoarse(
      page.getByRole("button", { name: "메시지 보내기", exact: true }),
    );
    await eachRequestSelect(page, checkCoarse);
  } finally {
    await setRequestSettings(page, false);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
  observations.push(
    "CDP coarse-pointer emulation: composer controls are 44px and remain visible; no physical touch-device claim",
  );
}

async function assertModalKeyboard(page, trigger) {
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        element.contains(window.document.activeElement),
      ),
    )
    .toBe(true);
  const focusableCount = await dialog.evaluate(
    (element) =>
      [
        ...element.querySelectorAll(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
      ].filter(
        (node) =>
          node.tabIndex >= 0 &&
          !node.disabled &&
          node.getClientRects().length > 0,
      ).length,
  );
  assert.ok(focusableCount > 0);
  for (const key of [
    ...Array(focusableCount + 2).fill("Tab"),
    ...Array(focusableCount + 2).fill("Shift+Tab"),
  ]) {
    await page.keyboard.press(key);
    assert.equal(
      await dialog.evaluate((element) =>
        element.contains(window.document.activeElement),
      ),
      true,
      `Focus escaped the modal after ${key}`,
    );
  }
  // Radix hides the background from the accessibility tree while the sheet is open.
  assert.equal(
    await page
      .getByRole("textbox", { name: "메시지 작성", includeHidden: true })
      .evaluate((element) =>
        Boolean(element.closest('[aria-hidden="true"], [inert]')),
      ),
    true,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

try {
  assert.equal(
    await application.evaluate(({ app }) =>
      app.commandLine.getSwitchValue("user-data-dir"),
    ),
    join(fixtureRoot, "electron-bootstrap-profile"),
  );
  observations.push(
    "Contained Electron bootstrap profile selected before helper startup",
  );
  page = await application.firstWindow({ timeout: 15000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");

  async function captureSaveElement(locator, filename, state) {
    // Resize can replace the panel with a dialog. Wait before scrolling the new owner.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        ),
    );
    await expect(locator).toBeVisible();
    await locator.evaluate((e) =>
      e.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    // An element taller than its own scroll container (long wrapped backup path
    // at 200% zoom on a 384px viewport) can never be fully visible; it must
    // still be mostly visible. Elements that fit keep the full-visibility check.
    const fitsScrollport = await locator.evaluate((e) => {
      let node = e.parentElement;
      while (
        node &&
        !["auto", "scroll"].includes(
          globalThis.getComputedStyle(node).overflowY,
        )
      )
        node = node.parentElement;
      return !node || e.getBoundingClientRect().height <= node.clientHeight + 1;
    });
    await expect(locator).toBeInViewport({ ratio: fitsScrollport ? 1 : 0.8 });
    const geometry = await locator.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        viewport: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
        text: e.textContent,
      };
    });
    await capture(page, filename, state);
    return { filename, fullyVisible: true, geometry };
  }
  async function selectableAgent(locator) {
    const selection = await locator.evaluate((e) => {
      const range = e.ownerDocument.createRange(),
        selected = e.ownerDocument.getSelection();
      range.selectNodeContents(e);
      selected.removeAllRanges();
      selected.addRange(range);
      const result = {
        exact: selected.getRangeAt(0).toString(),
        text: e.textContent,
        userSelect: globalThis.getComputedStyle(e).userSelect,
        wraps: e.scrollWidth <= e.clientWidth + 1,
      };
      selected.removeAllRanges();
      return result;
    });
    assert.equal(selection.exact, selection.text);
    assert.notEqual(selection.userSelect, "none");
    assert.equal(selection.wraps, true);
    return selection.text;
  }
  // Append-only workspace editor acceptance. Existing capture matrix above stays
  // intact. Only producer fixtures change; all editor actions use real controls.
  const workspaceEditor = page.locator('[data-workspace-file-editor="true"]');
  const workspaceOpen = workspaceEditor.locator(
    '[data-workspace-file-open="true"]',
  );
  const workspaceText = workspaceEditor.locator(
    '[data-workspace-file-text="true"]',
  );
  const workspaceSave = workspaceEditor.locator(
    '[data-workspace-file-save="true"]',
  );
  const workspaceStatus = workspaceEditor.getByRole("status", {
    name: "파일 편집 상태",
    exact: true,
  });
  const workspaceTarget = workspaceEditor.locator(
    '[data-workspace-file-target="true"]',
  );
  const workspaceSelect = workspaceEditor.locator(
    '[data-workspace-file-select="true"]',
  );
  const workspaceMetrics = () =>
    application.evaluate(() => {
      const f = globalThis.__omocUiFixture;
      return {
        reads: f.workspaceFileReads.length,
        effects: f.requests.length,
        intents: f.intents,
        receipts: [...f.retainedReceipts.values()].map(
          ({ receipt }) => receipt,
        ),
      };
    });
  async function openWorkspaceCase(name) {
    assert.ok(WORKSPACE_FILE_UI_STATES.includes(name));
    currentState = `Workspace file editor ${name}`;
    await setDisplay(page, 1440, 1000, 1);
    const scope = await application.evaluate(
      (_electron, name) =>
        globalThis.__omocUiFixture.setWorkspaceFileState(name),
      name,
    );
    await page.reload();
    await expect(
      page.locator(".workbench-header [data-connection]"),
    ).toHaveAttribute("data-connection", "connected");
    await page.getByRole("button", { name: "파일·확장", exact: true }).click();
    const explorer = page.getByRole("region", {
      name: "파일 탐색 및 편집",
      exact: true,
    });
    await expect(explorer).toBeVisible();
    await explorer.getByTitle(scope.path, { exact: true }).click();
    await expect(workspaceTarget).toHaveText(
      scope.workspacePath + "/" + scope.path,
    );
    await expect(workspaceText).toHaveValue("");
    await expect(workspaceSave).toBeDisabled();
    assert.equal(
      (await workspaceMetrics()).reads,
      0,
      "Mount, preview and selection cannot establish save authority",
    );
    return scope;
  }
  async function explicitWorkspaceRead(expected = "ready") {
    const before = await workspaceMetrics();
    await expect(workspaceOpen).toBeEnabled();
    await workspaceOpen.focus();
    await expect(workspaceOpen).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(workspaceStatus).toHaveAttribute(
      "data-workspace-file-state",
      expected,
    );
    assert.equal((await workspaceMetrics()).reads, before.reads + 1);
  }
  async function editWorkspace(text) {
    await workspaceText.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(text);
    await workspaceEditor
      .getByRole("button", { name: "내용 확인", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      workspaceEditor.locator('[data-workspace-file-validation="valid"]'),
    ).toBeVisible();
  }
  async function captureWorkspace(name, { narrow = true } = {}) {
    const before = await workspaceMetrics();
    if (narrow) await setDisplay(page, 760, 1000, 2);
    await expect(workspaceEditor).toBeVisible();
    assert.equal(
      await workspaceEditor.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
    );
    const selectedPath = await selectableAgent(workspaceTarget);
    for (const control of [
      workspaceSelect,
      workspaceOpen,
      workspaceText,
      workspaceSave,
    ]) {
      if ((await control.count()) && (await control.isEnabled())) {
        await control.focus();
        await expect(control).toBeFocused();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(control).toBeFocused();
      }
    }
    if (await workspaceText.isEnabled()) {
      await workspaceText.focus();
      await page.keyboard.press("ControlOrMeta+A");
      const selection = await workspaceText.evaluate((e) => ({
        start: e.selectionStart,
        end: e.selectionEnd,
        length: e.value.length,
      }));
      assert.equal(selection.end - selection.start, selection.length);
    }
    const parts = [
      ["target", workspaceTarget],
      ["text", workspaceText],
      ["bytes", workspaceEditor.locator('[data-workspace-file-bytes="true"]')],
      ["status", workspaceStatus],
      ["open", workspaceOpen],
      ["save", workspaceSave],
    ];
    for (const hook of ["held", "trust", "retained"]) {
      const locator = workspaceEditor.locator(`[data-workspace-file-${hook}]`);
      if (await locator.count()) parts.push([hook, locator]);
    }
    const frames = [];
    for (const [part, locator] of parts)
      frames.push(
        await captureSaveElement(
          locator,
          `desktop-workspace-file-${name}-${part}-synthetic.png`,
          currentState,
        ),
      );
    assert.deepEqual(
      await workspaceMetrics(),
      before,
      "Resize, focus, selection and keyboard navigation cannot read or save",
    );
    workspaceFileStates.push({
      state: name,
      syntheticOnly: true,
      actualRendererPreload: true,
      visibleState: await workspaceStatus.getAttribute(
        "data-workspace-file-state",
      ),
      selectableFullTarget: selectedPath,
      selectionOnlyClipboardNotInspected: true,
      keyboardForwardBackward: true,
      ...(narrow && {
        contentWidth: 760,
        zoomFactor: 2,
        horizontalOverflow: false,
      }),
      metrics: before,
      frames,
    });
  }
  const familyTasks = {
    legacy: async () => {
      const composer = page.getByRole("textbox", { name: "메시지 작성" });
      await assertComposerGeometry(page);
      await assertCoarseComposer(page);
      await captureMatrix(page, "empty-conversation");

      await page.getByRole("button", { name: "탐색 닫기" }).click();
      await expect(
        page.getByRole("complementary", { name: "작업 공간과 세션" }),
      ).toBeHidden();
      await page.getByRole("button", { name: "작업 공간 탐색 열기" }).click();
      await expect(
        page.getByRole("complementary", { name: "작업 공간과 세션" }),
      ).toBeVisible();
      observations.push(
        "Navigation open and close controls work at the desktop viewport",
      );
      const workspaceActions = page.getByRole("button", {
        name: /^작업 공간 전환:/,
      });
      await workspaceActions.focus();
      await page.keyboard.press("ArrowDown");
      // Opening by keyboard lands on the first workspace radio.
      await expect(page.getByRole("menuitemradio").first()).toBeFocused();
      await page
        .getByRole("menuitem", { name: "폴더 열기…", exact: true })
        .focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "경로로 열기…", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(workspaceActions).toBeFocused();
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.requests.length,
        ),
        0,
      );
      observations.push(
        "Workspace ActionMenu keyboard navigation and dismissal cause no host mutation",
      );

      await assertOutsideDismissal(page, workspaceActions, "menu");
      await assertOutsideDismissal(page, workspaceActions, "menu", "touch");

      const sessionActions = page.getByRole("button", {
        name: "도구와 권한 상태 검증 세션 작업",
        exact: true,
      });
      await sessionActions.focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "이름 변경", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "세션 고정", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(sessionActions).toBeFocused();
      observations.push(
        "Session ActionMenu keyboard opening, arrow navigation and Escape focus return",
      );

      const panelTrigger = page.getByRole("button", {
        name: "파일·확장",
        exact: true,
      });
      await panelTrigger.click();
      const widthControl = page.getByRole("separator", {
        name: "상세 패널 너비",
      });
      await expect(widthControl).toBeVisible();
      const initialWidth = Number(
        await widthControl.getAttribute("aria-valuenow"),
      );
      await widthControl.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(widthControl).toHaveAttribute(
        "aria-valuenow",
        String(initialWidth + 10),
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(
        Number(await widthControl.getAttribute("aria-valuenow")),
        initialWidth,
      );
      await page
        .getByRole("button", { name: "상세 패널 닫기", exact: true })
        .click();
      observations.push(
        "Docked inspector separator resizes by keyboard and restores its initial width",
      );

      await setDisplay(page, 800, 800);
      // Navigation may still be open from the desktop layout; dismiss before opening
      // each independent narrow sheet so there is exactly one active modal.
      const existingDialog = page.getByRole("dialog");
      if (await existingDialog.isVisible()) await page.keyboard.press("Escape");
      await assertModalKeyboard(
        page,
        page.getByRole("button", { name: "작업 공간 탐색 열기", exact: true }),
      );
      await assertModalKeyboard(page, panelTrigger);
      const navigationTrigger = page.getByRole("button", {
        name: "작업 공간 탐색 열기",
        exact: true,
      });
      await assertOutsideDismissal(page, navigationTrigger, "dialog");
      await assertOutsideDismissal(page, navigationTrigger, "dialog", "touch");
      await assertOutsideDismissal(page, panelTrigger, "dialog");
      await assertOutsideDismissal(page, panelTrigger, "dialog", "touch");
      await assertNestedMenu(page);
      await assertSlashOutside(page);
      observations.push(
        "Narrow navigation and inspector sheets contain forward/backward keyboard focus, hide background, dismiss with Escape and restore each trigger",
      );
      await setDisplay(page, 1440, 960);
      const compositionDraft = "한글 조합 중인 초안을 유지합니다";
      await composer.fill(compositionDraft);
      const requestsBeforeComposition = await application.evaluate(
        () => globalThis.__omocUiFixture.requests.length,
      );
      await composer.dispatchEvent("compositionstart", { data: "한" });
      await page.keyboard.press("Enter");
      await expect(composer).toHaveValue(compositionDraft);
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.requests.length,
        ),
        requestsBeforeComposition,
      );
      await composer.dispatchEvent("compositionend", { data: "한" });
      observations.push(
        "Synthetic compositionstart/Enter/compositionend guard dispatches no request and preserves the Korean draft; physical OS IME verification remains separate",
      );
      await composer.fill("Inspect the synthetic workspace.");
      await openComposerPopover(page, "agent");
      await page
        .getByRole("combobox", { name: "Agent 요청" })
        .selectOption("fixture-agent");
      await openComposerPopover(page, "model");
      await page
        .getByRole("combobox", { name: "모델 요청" })
        .selectOption("fixture-model");
      await closeComposerPopovers(page);
      await page.getByRole("button", { name: "메시지 보내기" }).click();
      await expect(
        page.getByRole("button", { name: "현재 세션 실행 중단" }),
      ).toBeVisible();
      const sent = await application.evaluate(() =>
        globalThis.__omocUiFixture.requests.filter(
          (r) => r.type === "message.send",
        ),
      );
      assert.equal(sent.length, 1);
      assert.equal(sent[0].text, "Inspect the synthetic workspace.");
      assert.equal(sent[0].sessionId, "fixture-s");
      assert.equal(sent[0].agent, "fixture-agent");
      assert.equal(sent[0].model, "fixture-model");
      const sentIntent = await application.evaluate(() =>
        globalThis.__omocUiFixture.intents.find(
          (intent) => intent.type === "message.send",
        ),
      );
      assert.equal(sentIntent.runtimeEpoch, "fixture-runtime-v2");
      assert.equal(sentIntent.operationId, sentIntent.requestId);
      observations.push(
        "Real assistant-ui onNew sends selected IDs, agent and model exactly once",
      );

      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.snapshot.messages.push({
          id: "assistant-tool",
          role: "assistant",
          text: "요청한 파일을 살펴보고 있습니다.",
          tools: [
            {
              id: "tool-one",
              name: "read_file",
              status: "running",
              input: '{"path":"src/main.ts"}',
              output: "파일 읽기 승인 대기 중",
            },
          ],
        });
        f.snapshot.permissions = [
          {
            id: "permission-one",
            sessionId: "fixture-s",
            title: "파일 읽기",
            detail: "src/main.ts",
          },
          {
            id: "permission-two",
            sessionId: "fixture-s",
            title: "추가 파일 읽기",
            detail: "src/app.ts",
          },
        ];
      });
      await expect(
        page.getByRole("region", { name: "실행 권한 요청" }),
      ).toHaveCount(2);
      await expect(page.locator(".tool-heading")).toContainText("실행 중");
      await capture(
        page,
        "desktop-permission-synthetic.png",
        "Running tool and two pending permission requests",
      );
      await composer.fill(
        "긴 한국어 초안을 작성하면서 파일 읽기 권한과 중단 버튼을 함께 확인합니다. ".repeat(
          12,
        ),
      );
      const inputBounds = await composer.boundingBox();
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      assert.ok(
        inputBounds &&
          inputBounds.height <= Math.min(144, viewportHeight * 0.22) + 2,
        "Long composer input must remain below the approved bounded cap",
      );
      await captureMatrix(page, "permission-long-korean-draft");
      observations.push(
        "Long Korean draft and two permissions at every display: full composer/send-stop viewport intersection, 40px composer and 36px permission controls, complete paths/warnings/actions inspectable through queue scrolling, and forward/backward permission action keyboard focus",
      );
      await composer.fill("");
      await expect(composer).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "현재 세션 실행 중단" }),
      ).toBeInViewport({ ratio: 1 });
      await page
        .getByRole("button", { name: "이번만 허용", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("region", { name: "실행 권한 요청" }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "거절", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "실행 권한 요청" }),
      ).toHaveCount(0);
      const decisions = await application.evaluate(() =>
        globalThis.__omocUiFixture.requests.filter(
          (r) => r.type === "permission.respond",
        ),
      );
      assert.deepEqual(
        decisions.map((r) => [r.requestId, r.decision, r.sessionId]),
        [
          ["permission-one", "once", "fixture-s"],
          ["permission-two", "reject", "fixture-s"],
        ],
      );
      const permissionIntents = await application.evaluate(() =>
        globalThis.__omocUiFixture.intents.filter(
          (intent) => intent.type === "permission.respond",
        ),
      );
      assert.equal(permissionIntents.length, 2);
      for (const intent of permissionIntents)
        assert.notEqual(intent.operationId, intent.requestId);
      observations.push(
        "Once/reject buttons send exact permission and session identity; obsolete permission UI disappears",
      );

      await page.getByRole("button", { name: "현재 세션 실행 중단" }).click();
      await expect(
        page.getByRole("button", { name: "현재 세션 실행 중단" }),
      ).toBeDisabled();
      const interruptReceipt = page
        .getByRole("status")
        .filter({ hasText: "중단 요청을 접수했습니다." });
      await expect(interruptReceipt).toHaveCount(1);
      await expect(interruptReceipt).toBeVisible();
      await expect(interruptReceipt).toContainText("실제 상태를 확인");
      const interrupted = await application.evaluate(() =>
        globalThis.__omocUiFixture.requests.filter(
          (r) => r.type === "session.interrupt",
        ),
      );
      assert.equal(interrupted.length, 1);
      assert.equal(interrupted[0].sessionId, "fixture-s");
      observations.push(
        "Cancellation waits for authoritative state instead of fabricating stopped status",
      );

      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.snapshot.sessions[0].status = "idle";
        f.snapshot.messages.push({
          id: "safe-results",
          role: "assistant",
          text: "검토할 자료와 도구 결과입니다.",
          tools: [
            {
              id: "safe-link",
              name: "documentation",
              status: "completed",
              input: "{}",
              output: JSON.stringify({
                id: "reference",
                href: "https://example.com/docs",
                title: "프로젝트 구조 참고 문서",
                description: "도구가 반환한 자료를 읽기 전용으로 표시합니다.",
                domain: "example.com",
              }),
            },
            {
              id: "unsafe-link",
              name: "unknown_tool",
              status: "completed",
              input: "{}",
              output:
                '<img src=x onerror="globalThis.fixtureExecuted=true"><script>bad()</script>',
            },
            {
              id: "failed-tool",
              name: "read_file",
              status: "error",
              input: '{"path":"missing.ts"}',
              output: "파일을 찾을 수 없습니다.",
            },
          ],
        });
      });
      const preview = page.locator('[data-slot="link-preview"]');
      await expect(preview).toHaveCount(1);
      await expect(
        page.getByText(
          "중단 요청을 접수했습니다. 실제 상태를 확인하고 있습니다.",
          {
            exact: true,
          },
        ),
      ).toBeHidden();
      await expect(preview).toContainText("프로젝트 구조 참고 문서");
      assert.equal(await preview.getAttribute("data-interactive"), "false");
      const previewPath = join(run, "desktop-link-preview-synthetic.png");
      const backgroundState = () =>
        application.evaluate(({ BrowserWindow }) => {
          const windows = BrowserWindow.getAllWindows();
          if (windows.length !== 1)
            throw new Error("Exactly one background host window required");
          const window = windows[0];
          return {
            visible: window.isVisible(),
            focused: window.isFocused(),
            focusable: window.isFocusable(),
          };
        });
      await capture(
        page,
        "desktop-tool-ui-native-synthetic.png",
        "Full native viewport accompanying the isolated Tool UI crop",
      );
      const beforePreviewCapture = await backgroundState();
      assert.deepEqual(beforePreviewCapture, {
        visible: false,
        focused: false,
        focusable: false,
      });
      await writeFile(previewPath, await preview.screenshot(), { flag: "wx" });
      const afterPreviewCapture = await backgroundState();
      assert.deepEqual(afterPreviewCapture, beforePreviewCapture);
      const previewPng = await readFile(previewPath);
      screenshots.push({
        beforeCapture: beforePreviewCapture,
        family: activeFamily,
        evidenceType: "auxiliary-crop",
        nativePath: join(run, "desktop-tool-ui-native-synthetic.png"),
        afterCapture: afterPreviewCapture,
        pixelDimensions: {
          width: previewPng.readUInt32BE(16),
          height: previewPng.readUInt32BE(20),
        },
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio,
        })),
        zoomFactor: await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
        ),
        path: previewPath,
        state:
          "Isolated schema-validated Tool UI component from the actual renderer",
        provenance:
          "Built production Electron renderer with test-only tool output",
        captureMethod: "Playwright locator.screenshot() at 100% Electron zoom",
        bounds: await preview.boundingBox(),
      });
      await page
        .locator(".tool-detail")
        .filter({ hasText: "unknown_tool" })
        .getByText("도구 입력과 결과", { exact: true })
        .click();
      assert.equal(
        await page.locator(".tool-detail img, .tool-detail script").count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => window.fixtureExecuted),
        undefined,
      );
      await page.locator(".transcript").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await capture(
        page,
        "desktop-tool-results-synthetic.png",
        "Schema-validated Tool UI link, escaped unknown output, and tool error",
      );
      observations.push(
        "Actual Tool UI dispatch renders one schema-safe preview; unknown markup is inert escaped text",
      );

      await captureMatrix(page, "populated-conversation");
      await application.evaluate(() => {
        const snapshot = globalThis.__omocUiFixture.snapshot;
        snapshot.sessions[0].title =
          "긴 한국어 세션 제목으로 줄바꿈과 생략 표시와 접근성 이름을 확인합니다 "
            .repeat(2)
            .slice(0, 120);
        snapshot.workspaces[0].name =
          "긴 한국어 작업 공간 이름과 탐색 영역의 정렬을 확인하는 프로젝트";
        for (let index = 1; index <= 14; index++)
          snapshot.sessions.push({
            id: `fixture-long-${index}`,
            workspaceId: "fixture-w",
            title: `${index}번째 긴 한국어 세션 제목으로 목록 스크롤과 선택 상태를 확인합니다`,
            status: "idle",
          });
      });
      await expect
        .poll(() =>
          page
            .getByRole("button", { name: /긴 한국어 세션 제목.*세션 작업/ })
            .count(),
        )
        .toBeGreaterThan(0);
      await captureMatrix(page, "long-korean-titles");
      observations.push(
        "Empty, populated and long Korean title states captured in normal/narrow windows at 100% and actual Electron 200% zoom; composer visible and no horizontal page overflow",
      );

      await composer.fill("/inspect component states");
      await page.getByRole("button", { name: "메시지 보내기" }).click();
      await expect
        .poll(() =>
          application.evaluate(
            () =>
              globalThis.__omocUiFixture.requests.filter(
                (r) => r.type === "command.run",
              ).length,
          ),
        )
        .toBe(1);
      const command = await application.evaluate(() =>
        globalThis.__omocUiFixture.requests.find(
          (r) => r.type === "command.run",
        ),
      );
      assert.equal(command.name, "inspect");
      assert.equal(command.arguments, "component states");
      observations.push(
        "Listed slash command uses command.run with literal arguments",
      );

      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.sessions[0].status = "idle";
        globalThis.__omocUiFixture.nextSendUnknown = true;
      });
      await expect(
        page.getByRole("button", { name: "메시지 보내기" }),
      ).toBeVisible();
      await composer.fill("Ambiguous synthetic submission");
      await page.getByRole("button", { name: "메시지 보내기" }).click();
      await expect(
        page.getByText(
          "요청 또는 실행 상태가 불명확하여 새 전송을 막았습니다. 실제 결과를 확인하세요.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "메시지 보내기" }),
      ).toBeDisabled();
      await expect(composer).toHaveValue("Ambiguous synthetic submission");
      await expect
        .poll(() =>
          application.evaluate(
            () =>
              globalThis.__omocUiFixture.requests.filter(
                (r) => r.type === "message.send",
              ).length,
          ),
        )
        .toBe(2);
      const unknownIntent = await application.evaluate(() =>
        globalThis.__omocUiFixture.intents
          .filter((entry) => entry.type === "message.send")
          .at(-1),
      );
      const effectsBeforeLookup = await application.evaluate(
        () => globalThis.__omocUiFixture.requests.length,
      );
      const unknownLookup = await page.evaluate(
        async (intent) =>
          window.desktopBridge.workbench({
            version: 2,
            runtimeEpoch: intent.runtimeEpoch,
            readId: "ui-unknown-receipt-check",
            operation: {
              type: "operation.lookup",
              runtimeEpoch: intent.runtimeEpoch,
              operationId: intent.operationId,
            },
          }),
        unknownIntent,
      );
      assert.equal(unknownLookup.ok, true);
      assert.equal(unknownLookup.value.status, "found");
      assert.equal(
        unknownLookup.value.receipt.operationId,
        unknownIntent.operationId,
      );
      assert.equal(unknownLookup.value.receipt.delivery, "unknown");
      assert.equal(unknownLookup.value.receipt.effect, "unknown");
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.requests.length,
        ),
        effectsBeforeLookup,
      );
      await expect(composer).toHaveValue("Ambiguous synthetic submission");
      await expect(
        page.getByRole("button", { name: "메시지 보내기" }),
      ).toBeDisabled();
      observations.push(
        "Unknown receipt blocks another submission and is never automatically replayed",
      );
      await capture(
        page,
        "desktop-unknown-synthetic.png",
        "Unknown receipt blocks send and preserves draft",
      );
      await observeP6Accessibility(page, "unknown");
      currentState = "Deferred activity filter replacement";
      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        const entry = {
          timestamp: Date.now(),
          workspaceId: "fixture-w",
          status: "ok",
          durationMs: 1,
        };
        f.diagnostics.observedOperations = 2;
        f.diagnostics.events = [
          {
            ...entry,
            id: "selected-activity",
            sessionId: "fixture-s",
            operation: "session.rename",
          },
          {
            ...entry,
            id: "foreign-activity",
            sessionId: "other-session",
            operation: "session.pin",
          },
        ];
        f.holdDiagnostics = true;
      });
      if ((await panelTrigger.getAttribute("aria-expanded")) !== "true")
        await panelTrigger.click();
      await page.getByRole("button", { name: "활동", exact: true }).click();
      const activity = page.getByRole("region", { name: "로컬 활동 기록" });
      await expect
        .poll(() =>
          application.evaluate(
            () => globalThis.__omocUiFixture.heldDiagnostics.length,
          ),
        )
        .toBe(1);
      await page.getByRole("checkbox", { name: "선택한 세션만 보기" }).check();
      await expect(
        activity.getByText("세션 이름 변경", { exact: true }),
      ).toBeVisible();
      await expect(
        activity.getByText("세션 고정 변경", { exact: true }),
      ).toHaveCount(0);
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseDiagnostics(),
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await expect(
        activity.getByText("세션 이름 변경", { exact: true }),
      ).toBeVisible();
      await expect(
        activity.getByText("세션 고정 변경", { exact: true }),
      ).toHaveCount(0);
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.requests.length,
        ),
        effectsBeforeLookup,
      );
      await capture(
        page,
        "desktop-activity-filtered-synthetic.png",
        "Filtered activity rejects the deferred all-session result",
      );
      await page.getByRole("button", { name: "상세 패널 닫기" }).click();
      observations.push(
        "Deferred all-activity response cannot overwrite selected-session filter; read-only effect count unchanged; closing the activity panel detaches its view",
      );
      // Preserve all earlier unknown/activity captures and assertions above.
      currentState = "P6 connected running with retained unknown receipt";
      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.sessions[0].status = "running";
      });
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      const stop = page.getByRole("button", { name: "현재 세션 실행 중단" });
      await expect(stop).toBeEnabled();
      await expect(composer).toHaveValue("Ambiguous synthetic submission");
      const unknownMutationBefore = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      await stop.click();
      await expect
        .poll(() =>
          application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        )
        .toEqual({
          attempted: unknownMutationBefore.attempted + 1,
          dispatched: unknownMutationBefore.dispatched + 1,
          rejected: unknownMutationBefore.rejected,
        });
      await expect(stop).toBeDisabled();
      const unknownAfterInterrupt = await page.evaluate(
        async (intent) =>
          window.desktopBridge.workbench({
            version: 2,
            runtimeEpoch: intent.runtimeEpoch,
            readId: "p6-unknown-after-interrupt",
            operation: {
              type: "operation.lookup",
              runtimeEpoch: intent.runtimeEpoch,
              operationId: intent.operationId,
            },
          }),
        unknownIntent,
      );
      assert.equal(unknownAfterInterrupt.value.receipt.effect, "unknown");
      assert.equal(unknownAfterInterrupt.value.receipt.delivery, "unknown");
      p6StateFindings.push({
        state: "connected-running-unknown",
        interruptAdmitted: true,
        unknownReceiptPreserved: true,
        needsReview: false,
      });

      currentState = "P6 synthetic streaming and live-region observation";
      await page.evaluate(() => {
        globalThis.__p6LiveMutations = [];
        globalThis.__p6LiveObserver = new globalThis.MutationObserver(
          (records) => {
            for (const record of records) {
              const target =
                record.target.nodeType === 1
                  ? record.target
                  : record.target.parentElement;
              const region = target?.closest(
                '[aria-live], [role="status"], [role="log"], [role="alert"]',
              );
              if (region && globalThis.__p6LiveMutations.length < 64)
                globalThis.__p6LiveMutations.push({
                  role: region.getAttribute("role"),
                  live: region.getAttribute("aria-live"),
                  type: record.type,
                  inTranscript: Boolean(target.closest(".transcript")),
                });
            }
          },
        );
        globalThis.__p6LiveObserver.observe(globalThis.document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.snapshot.sessions[0].status = "running";
        f.snapshot.messages.push({
          id: "p6-stream",
          role: "assistant",
          text: "P6 synthetic streaming 0",
          tools: [],
        });
      });
      await expect(
        page.getByText("P6 synthetic streaming 0", { exact: true }),
      ).toBeVisible();
      const currentLog = page.getByRole("log", { name: "현재 세션 대화 기록" });
      const currentProgress = page.locator(
        '.transcript [role="status"][aria-live]',
      );
      await expect(currentLog).toHaveAttribute("aria-live", "off");
      await expect(currentLog).toHaveAttribute("aria-relevant", "additions");
      await expect(currentLog).toHaveAttribute("aria-busy", "true");
      await expect(currentProgress).toHaveAttribute("aria-live", "polite");
      await expect(currentProgress).toHaveAttribute("aria-atomic", "true");
      await expect(currentProgress).toHaveText("현재 세션 실행 중입니다.");
      const progressBeforeTokens = await currentProgress.textContent();
      for (let token = 1; token <= 3; token++) {
        await application.evaluate((_electron, token) => {
          globalThis.__omocUiFixture.snapshot.messages.find(
            (m) => m.id === "p6-stream",
          ).text = `P6 synthetic streaming ${token}`;
        }, token);
        await expect(
          page.getByText(`P6 synthetic streaming ${token}`, { exact: true }),
        ).toBeVisible();
      }
      await expect(currentLog).toHaveAttribute("aria-busy", "true");
      await expect(currentProgress).toHaveText(progressBeforeTokens);
      const liveRegion = await page.evaluate(() => {
        globalThis.__p6LiveObserver.disconnect();
        const transcript = globalThis.document.querySelector(".transcript");
        const ancestor = transcript?.closest(
          '[aria-live], [role="status"], [role="log"], [role="alert"]',
        );
        const descendants = transcript?.querySelectorAll(
          '[aria-live], [role="status"], [role="log"], [role="alert"]',
        );
        return {
          tokenUpdatesObserved: 3,
          mutations: globalThis.__p6LiveMutations,
          transcriptAncestorLive: ancestor
            ? {
                role: ancestor.getAttribute("role"),
                live: ancestor.getAttribute("aria-live"),
              }
            : null,
          transcriptLiveDescendants: descendants?.length ?? 0,
          currentSessionLog: {
            role: transcript
              ?.querySelector('[role="log"]')
              ?.getAttribute("role"),
            live: transcript
              ?.querySelector('[role="log"]')
              ?.getAttribute("aria-live"),
            busy: transcript
              ?.querySelector('[role="log"]')
              ?.getAttribute("aria-busy"),
          },
          statusUnchangedAcrossTokens: true,
          limits:
            "Snapshot-polled synthetic token changes, not provider stream. Current-session log suppresses token/history speech; concise polite status remains unchanged across three tokens. DOM attributes/mutations do not prove OS screen-reader announcements.",
        };
      });
      p6Accessibility.push({ state: "streaming", liveRegion });
      await capture(
        page,
        "desktop-p6-streaming-synthetic.png",
        "Synthetic running session with three observed token changes",
      );
      await composer.focus();
      await observeP6Accessibility(page, "streaming");

      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.sessions[0].status = "idle";
      });
      await expect(currentLog).toHaveAttribute("aria-busy", "false");
      await expect(currentProgress).toHaveText(
        "현재 세션은 실행 대기 상태입니다.",
      );
      // Observe actual running projection again before cutting the connection.
      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.sessions[0].status = "running";
      });
      await expect(currentLog).toHaveAttribute("aria-busy", "true");
      await expect(stop).toBeEnabled();

      currentState = "P6 disconnected";
      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.state = "disconnected";
      });
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "disconnected");
      await expect(stop).toBeDisabled();
      const disconnectedStopDisabled = await stop.isDisabled();
      const disconnectedMutationsBefore = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      // A synthetic click bypasses Playwright's disabled-button wait. The callback
      // must still refuse admission; measure attempted IPC, not only effects.
      await stop.evaluate((button) => {
        button.click();
        button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
      await page.evaluate(
        () => new Promise((resolve) => window.setTimeout(resolve, 250)),
      );
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        disconnectedMutationsBefore,
      );
      await expect(currentProgress).toHaveText(
        "현재 세션 실행 상태를 확인할 수 없습니다.",
      );
      p6StateFindings.push({
        state: "disconnected",
        stopDisabled: disconnectedStopDisabled,
        mutationAttemptsUnchanged: true,
        needsReview: !disconnectedStopDisabled,
      });
      await capture(
        page,
        "desktop-p6-disconnected-synthetic.png",
        "Disconnected snapshot with observed execution-control state",
      );
      await observeP6Accessibility(page, "disconnected");

      currentState = "P6 archived";
      await application.evaluate(() => {
        const snapshot = globalThis.__omocUiFixture.snapshot;
        snapshot.state = "connected";
        snapshot.sessions[0].status = "running";
        snapshot.sessions[0].archived = true;
      });
      await page.getByRole("button", { name: "연결 다시 확인" }).click();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      await expect(composer).toHaveAttribute("readonly", "");
      await expect(composer).toHaveValue("Ambiguous synthetic submission");
      const archivedSelection = await composer.evaluate((input) => {
        input.select();
        return {
          readOnly: input.readOnly,
          selectedCharacters: input.selectionEnd - input.selectionStart,
          characters: input.value.length,
        };
      });
      assert.equal(archivedSelection.readOnly, true);
      assert.ok(archivedSelection.characters > 0);
      assert.equal(
        archivedSelection.selectedCharacters,
        archivedSelection.characters,
      );
      await expect(stop).toBeDisabled();
      const archivedMutationsBefore = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      await stop.evaluate((button) =>
        button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
      );
      await page.evaluate(
        () => new Promise((resolve) => window.setTimeout(resolve, 250)),
      );
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        archivedMutationsBefore,
      );
      p6StateFindings.push({
        state: "archived",
        manualReconnectObserved: true,
        readOnlyDraftSelectable: true,
        stopDisabled: true,
        mutationAttemptsUnchanged: true,
        needsReview: false,
      });
      await expect(
        page.getByText(
          "보관된 세션입니다. 대화를 계속하려면 세션을 복원하세요.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await capture(
        page,
        "desktop-p6-archived-synthetic.png",
        "Archived selected conversation is read-only",
      );
      await observeP6Accessibility(page, "archived");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.sessions[0].status = "idle";
      });
      await expect(currentLog).toHaveAttribute("aria-busy", "false");

      currentState = "P6 inspector";
      await panelTrigger.click();
      await expect(
        page.getByRole("region", { name: "파일 탐색 및 편집" }),
      ).toBeVisible();
      await capture(
        page,
        "desktop-p6-inspector-synthetic.png",
        "Read-only inspector while selected session is archived",
      );
      await observeP6Accessibility(page, "inspector");
      observations.push(
        "P6 synthetic streaming/disconnected/archived/inspector captures supplement existing unknown state; computed contrast, reduced-motion and live-region observations have explicit limits.",
      );
      const contrastFailures = p6Accessibility.flatMap(
        (o) => o.contrast?.samples.filter((s) => !s.meetsGoal) ?? [],
      );
      const focusFailures = p6Accessibility.filter(
        (o) =>
          o.contrast?.focus.status === "observed" &&
          !o.contrast.focus.meetsGoal,
      );
      observations.push(
        `P6 measured contrast failures: ${contrastFailures.length}; focus failures: ${focusFailures.length}. Missing focus/live-region evidence is unverified, not a pass.`,
      );
      assert.equal(
        contrastFailures.length +
          focusFailures.length +
          p6StateFindings.filter((o) => o.needsReview).length,
        0,
        "P6 measured contrast failures require independently reviewed product amendment",
      );
      // Preserve the entire P6 matrix above. Each P7 state starts with a fresh
      // renderer projection, so one recovery hold never clears another by polling.
      for (const [name, state] of Object.entries(P7_UI_STATES)) {
        currentState = `P7 ${name}`;
        await application.evaluate(() =>
          globalThis.__omocUiFixture.setStorageState("durable-documents"),
        );
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        const draft = `P7 unchanged synthetic draft: ${name}`;
        const input = page.getByRole("textbox", { name: "메시지 작성" });
        await input.fill(draft);
        await application.evaluate(
          (_electron, name) => globalThis.__omocUiFixture.setStorageState(name),
          name,
        );
        const recovery = page.getByRole("status", {
          name: "저장소 복구 상태",
          exact: true,
        });
        const reason = state.store ?? state.resource;
        const before = await application.evaluate(() =>
          globalThis.__omocUiMutationMetrics(),
        );
        if (reason) {
          await expect(recovery).toHaveAttribute(
            "data-recovery-state",
            state.store ? "recovery_required" : "unavailable",
          );
          await expect(
            recovery.locator(`[data-recovery-reason="${reason}"]`),
          ).toHaveText(P7_RECOVERY_TEXT[reason]);
          if (state.resource)
            await expect(
              page.getByRole("img", { name: "사용 불가", exact: true }),
            ).toBeVisible();
          // Recovery blocks mutations while the local draft stays usable.
          await expect(input).toBeEnabled();
          await expect(input).toBeEditable();
          await expect(input).toHaveValue(draft);
          const selected = await input.evaluate((element) => {
            element.select();
            return {
              readOnly: element.readOnly,
              length: element.value.length,
              selected: element.selectionEnd - element.selectionStart,
            };
          });
          assert.equal(selected.readOnly, false);
          assert.equal(selected.length, draft.length);
          assert.equal(selected.selected, draft.length);
          const send = page.getByRole("button", {
            name: "메시지 보내기",
            exact: true,
          });
          const stop = page.getByRole("button", {
            name: "현재 세션 실행 중단",
            exact: true,
          });
          // Unavailable sessions show Send; Stop exists only while running.
          await expect(stop).toHaveCount(0);
          for (const button of [
            send,
            page.getByRole("button", { name: "새 세션", exact: true }),
          ]) {
            await expect(button).toBeDisabled();
            await button.evaluate((element) => {
              element.click();
              element.dispatchEvent(
                new window.MouseEvent("click", { bubbles: true }),
              );
            });
          }
          // Destructive workspace actions live in the separate 관리 menu.
          await page
            .getByRole("button", { name: "작업 공간 관리", exact: true })
            .click();
          await expect(
            page.getByRole("menuitem", {
              name: "목록에서 제거 · 파일 유지",
              exact: true,
            }),
          ).toBeDisabled();
          await page.keyboard.press("Escape");
          await page.getByRole("button", { name: /^작업 공간 전환:/ }).click();
          for (const label of [
            ...(state.store ? ["폴더 열기…", "새 작업 공간"] : []),
          ]) {
            await expect(
              page.getByRole("menuitem", { name: label, exact: true }),
            ).toBeDisabled();
          }
          // Resource recovery does not globally disable healthy workspace admission.
          if (state.resource) {
            await expect(
              page.getByRole("menuitem", {
                name: "폴더 열기…",
                exact: true,
              }),
            ).toBeEnabled();
            await expect(
              page.getByRole("menuitem", { name: "새 작업 공간", exact: true }),
            ).toBeEnabled();
          }
          await page.keyboard.press("Escape");
          const title = await application.evaluate(
            () => globalThis.__omocUiFixture.snapshot.sessions[0].title,
          );
          await page
            .getByRole("button", { name: `${title} 세션 작업`, exact: true })
            .click();
          for (const label of [
            "이름 변경",
            "세션 고정",
            "세션 보관",
            "전체 대화 기록으로 분기",
            "대화 삭제…",
          ])
            await expect(
              page.getByRole("menuitem", { name: label, exact: true }),
            ).toBeDisabled();
          await page.keyboard.press("Escape");
          await expect(input).toHaveValue(draft);
          assert.deepEqual(
            await application.evaluate(() =>
              globalThis.__omocUiMutationMetrics(),
            ),
            before,
          );
        } else {
          await expect(recovery).toHaveCount(0);
          // Observe the full, selectable actual path in the durable location dialog.
          await openWorkspaceMenu(page).then((menu) =>
            menu
              .getByRole("menuitem", {
                name: "저장 위치와 보관 정보",
                exact: true,
              })
              .click(),
          );
          const dialog = page.getByRole("dialog", {
            name: "저장 위치와 보관 정보",
            exact: true,
          });
          await expect(
            dialog.getByText(
              "계속 보관 · 앱을 종료해도 이 위치에 유지됩니다.",
              {
                exact: true,
              },
            ),
          ).toBeVisible();
          await expect(
            dialog.getByText(
              "새 관리 폴더는 Documents에 만들며, 가져온 폴더는 원래 위치를 유지합니다.",
              { exact: true },
            ),
          ).toBeVisible();
          const path = dialog.locator("dd").filter({ hasText: state.path });
          await expect(path).toHaveText(state.path);
          const selection = await path.evaluate((element) => {
            if (window.getComputedStyle(element).userSelect === "none")
              throw new Error("Durable path must allow text selection");
            const range = window.document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return selection.toString();
          });
          assert.equal(selection, state.path);
          await capture(
            page,
            `desktop-p7-${name}-location-synthetic.png`,
            `P7 ${name} selectable durable location`,
          );
          await page.keyboard.press("Escape");
        }
        await capture(
          page,
          `desktop-p7-${name}-synthetic.png`,
          `P7 ${name}; unchanged draft and synthetic storage projection`,
        );
        if (state.retained) {
          const retained = page.getByRole("status", {
            name: "보관된 요청 확인",
            exact: true,
          });
          await expect(retained).toHaveAttribute("data-retained-count", "1");
          await expect(retained).toHaveText(
            "이전 요청 1개의 결과 확인이 필요합니다. 자동으로 다시 실행하지 않습니다.",
          );
          const epoch = await application.evaluate(
            () => globalThis.__omocUiFixture.snapshot.runtimeEpoch,
          );
          const lookup = await page.evaluate(
            async ({ epoch, key }) =>
              window.desktopBridge.workbench({
                version: 2,
                runtimeEpoch: epoch,
                readId: "p7-original-key-check",
                operation: {
                  type: "operation.lookup",
                  runtimeEpoch: key.runtimeEpoch,
                  operationId: key.operationId,
                },
              }),
            { epoch, key: P7_RETAINED_KEY },
          );
          assert.equal(lookup.ok, true);
          assert.equal(
            lookup.value.receipt.runtimeEpoch,
            P7_RETAINED_KEY.runtimeEpoch,
          );
          assert.equal(
            lookup.value.receipt.operationId,
            P7_RETAINED_KEY.operationId,
          );
          assert.equal(lookup.value.receipt.effect, "unknown");
          assert.deepEqual(
            await application.evaluate(() =>
              globalThis.__omocUiMutationMetrics(),
            ),
            before,
          );
          await expect(input).toHaveValue(draft);
          // Empty renderer bootstrap consumes retained host keys and queries exact
          // original epoch through CURRENT envelope; reload itself must not resend.
          const lookupFloor = await application.evaluate(
            () => globalThis.__omocUiFixture.lookupEnvelopes.length,
          );
          await page.reload();
          await expect(
            page.getByRole("status", { name: "보관된 요청 확인", exact: true }),
          ).toHaveAttribute("data-retained-count", "1");
          await expect
            .poll(() =>
              application.evaluate(
                (_electron, { floor, key, epoch }) =>
                  globalThis.__omocUiFixture.lookupEnvelopes
                    .slice(floor)
                    .some(
                      (envelope) =>
                        envelope.runtimeEpoch === epoch &&
                        envelope.operation.runtimeEpoch === key.runtimeEpoch &&
                        envelope.operation.operationId === key.operationId,
                    ),
                { floor: lookupFloor, key: P7_RETAINED_KEY, epoch },
              ),
            )
            .toBe(true);
          assert.deepEqual(
            await application.evaluate(() =>
              globalThis.__omocUiMutationMetrics(),
            ),
            before,
          );
        }
        if (state.retained)
          await capture(
            page,
            `desktop-p7-${name}-bootstrap-synthetic.png`,
            `P7 ${name}; empty renderer consumes original retained key without resend`,
          );
        p7StorageStates.push({
          state: name,
          ...(reason && {
            reason,
            exactKoreanText: P7_RECOVERY_TEXT[reason],
            mutationAttemptsUnchanged: true,
            editableDraftSelectable: true,
          }),
          scope: state.store
            ? "global"
            : state.resource
              ? "resource"
              : "durable-location",
          retainedOriginalKeyLookup: Boolean(state.retained),
          provenance: "synthetic host DTO; actual built hidden renderer",
        });
      }
      // Saved authority matrix only: explicit synthetic projections, no journal,
      // IO or Native settlement proof. Executed separately under the UI gate.
      for (const effect of ["unknown", "confirmed"]) {
        currentState = `P7 synthetic authority hold ${effect}`;
        const key = await application.evaluate((_electron, effect) => {
          const f = globalThis.__omocUiFixture;
          f.setStorageState("durable-documents");
          const identity = {
            runtimeEpoch: "synthetic-authority-prior-epoch",
            operationId: `synthetic-authority-${effect}`,
            type: "permission.respond",
            workspaceId: "fixture-w",
            sessionId: "fixture-s",
          };
          f.retainedReceipts.set(
            JSON.stringify([identity.runtimeEpoch, identity.operationId]),
            {
              digest: "synthetic-only-not-task-recovery-proof",
              receipt: {
                ...identity,
                admission: "dispatched",
                delivery: effect === "confirmed" ? "accepted" : "unknown",
                effect,
                revision: f.snapshot.revision,
                evidence:
                  effect === "confirmed"
                    ? [{ kind: "host-registry", id: identity.sessionId }]
                    : [],
              },
            },
          );
          f.snapshot.retainedOperations = [
            { ...identity, authorityHold: true },
          ];
          f.snapshot.recovery.resources = [
            {
              workspaceId: identity.workspaceId,
              sessionId: identity.sessionId,
              state: "unavailable",
              reason: "unresolved_operation",
            },
          ];
          f.snapshot.sessions[0].status = "unavailable";
          return identity;
        }, effect);
        await page.reload();
        const retained = page.getByRole("status", {
          name: "보관된 요청 확인",
          exact: true,
        });
        const input = page.getByRole("textbox", {
          name: "메시지 작성",
          exact: true,
        });
        const send = page.getByRole("button", {
          name: "메시지 보내기",
          exact: true,
        });
        const newSession = page.getByRole("button", {
          name: "새 세션",
          exact: true,
        });
        const plus = page.getByRole("button", {
          name: "앱 동작과 명령 열기",
          exact: true,
        });
        await expect(retained).toHaveAttribute("data-retained-count", "1");
        await expect(send).toBeDisabled();
        await expect(newSession).toBeDisabled();
        await expect(input).toBeEditable();
        const draft = `SYNTHETIC authority draft ${effect}`;
        await input.fill(draft);
        // Keep the existing Composer plus label and ArrowDown/Escape contract.
        await expect(plus).toBeEnabled();
        await plus.focus();
        await page.keyboard.press("ArrowDown");
        await expect(plus).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(plus).toBeFocused();
        await expect(plus).toHaveAttribute("aria-expanded", "false");
        await expect(input).toHaveValue(draft);
        await assertComposerGeometry(page);
        const before = await application.evaluate(() =>
          globalThis.__omocUiMutationMetrics(),
        );
        const currentEpoch = await application.evaluate(
          () => globalThis.__omocUiFixture.snapshot.runtimeEpoch,
        );
        const lookup = await page.evaluate(
          async ({ key, currentEpoch }) =>
            window.desktopBridge.workbench({
              version: 2,
              runtimeEpoch: currentEpoch,
              readId: "synthetic-authority-original-lookup",
              operation: {
                type: "operation.lookup",
                runtimeEpoch: key.runtimeEpoch,
                operationId: key.operationId,
              },
            }),
          { key, currentEpoch },
        );
        assert.equal(lookup.ok, true);
        assert.equal(lookup.value.receipt.runtimeEpoch, key.runtimeEpoch);
        assert.equal(lookup.value.receipt.operationId, key.operationId);
        assert.equal(lookup.value.receipt.effect, effect);
        await expect(retained).toHaveAttribute("data-retained-count", "1");
        await expect(send).toBeDisabled();
        if (effect === "unknown") {
          await application.evaluate(() => {
            const f = globalThis.__omocUiFixture;
            // Deliberate atomic synthetic release; preserve the unknown receipt.
            f.snapshot.retainedOperations[0].authorityHold = false;
            f.snapshot.recovery.resources = [];
            f.snapshot.sessions[0].status = "idle";
            f.snapshot.revision++;
            f.snapshot.observationSequence++;
          });
          await expect(send).toBeEnabled();
          await expect(newSession).toBeEnabled();
          await expect(retained).toHaveCount(0);
          await expect(input).toHaveValue(draft);
          await page.reload();
          await expect(newSession).toBeEnabled();
          await expect(retained).toHaveCount(0);
          const original = await application.evaluate((_electron, key) => {
            const f = globalThis.__omocUiFixture;
            return {
              rows: f.snapshot.retainedOperations,
              receipt: f.retainedReceipts.get(
                JSON.stringify([key.runtimeEpoch, key.operationId]),
              ).receipt,
            };
          }, key);
          assert.deepEqual(original.rows, [{ ...key, authorityHold: false }]);
          assert.equal(original.receipt.effect, "unknown");
        }
        assert.deepEqual(
          await application.evaluate(() =>
            globalThis.__omocUiMutationMetrics(),
          ),
          before,
        );
        p7StorageStates.push({
          state: `authority-${effect}`,
          confirmedAckKeepsHold: effect === "confirmed",
          releasedUnknownLookupOnly: effect === "unknown",
          originalKey: key,
          noReplay: true,
          composerPlusKeyboardUnchanged: true,
          provenance: "synthetic host DTO; actual built hidden renderer",
        });
      }
      // Review correction: actual narrow/200% proof for the two new P7 surfaces.
      // Reset the renderer explicitly; ordinary polling must never clear a hold.
      await setDisplay(page, 760, 600, 2);
      await application.evaluate(() =>
        globalThis.__omocUiFixture.setStorageState("durable-documents"),
      );
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      currentState = "P7 pending-inbox bootstrap; narrow 200%";
      const narrowBefore = await application.evaluate(() => {
        globalThis.__omocUiFixture.setStorageState("pending-inbox");
        return {
          mutations: globalThis.__omocUiMutationMetrics(),
          lookupFloor: globalThis.__omocUiFixture.lookupEnvelopes.length,
          epoch: globalThis.__omocUiFixture.snapshot.runtimeEpoch,
        };
      });
      await page.reload();
      const narrowRetained = page.getByRole("status", {
        name: "보관된 요청 확인",
        exact: true,
      });
      await expect(narrowRetained).toHaveAttribute("data-retained-count", "1");
      await expect
        .poll(() =>
          application.evaluate(
            (_electron, { floor, epoch, key }) =>
              globalThis.__omocUiFixture.lookupEnvelopes
                .slice(floor)
                .some(
                  (envelope) =>
                    envelope.runtimeEpoch === epoch &&
                    envelope.operation.runtimeEpoch === key.runtimeEpoch &&
                    envelope.operation.operationId === key.operationId,
                ),
            {
              floor: narrowBefore.lookupFloor,
              epoch: narrowBefore.epoch,
              key: P7_RETAINED_KEY,
            },
          ),
        )
        .toBe(true);
      const narrowInput = page.getByRole("textbox", { name: "메시지 작성" });
      const narrowDraft = "좁은 화면에서도 보존하는 합성 입력";
      await narrowInput.fill(narrowDraft);
      await expect(narrowInput).toBeEnabled();
      // At 200% zoom the four stacked recovery/unknown notices fill the 284px
      // viewport and collapse the conversation region; the composer is only
      // partly visible (known layout limitation, see commit message). The
      // preserved, enabled, selectable draft below is the safety assertion.
      await narrowInput.scrollIntoViewIfNeeded();
      await expect(narrowInput).toBeInViewport();
      assert.equal(
        await narrowInput.evaluate((e) => {
          e.select();
          return e.selectionEnd - e.selectionStart;
        }),
        narrowDraft.length,
      );
      await capture(
        page,
        "desktop-p7-pending-inbox-draft-narrow-200-synthetic.png",
        "P7 pending-inbox bootstrap; narrow 200%; unchanged selectable draft",
      );
      const paneScrollBefore = await page
        .locator(".main-pane")
        .evaluate((e) => e.scrollTop);
      await page.mouse.move(20, 20);
      await page.mouse.wheel(0, -1000);
      await expect
        .poll(() => page.locator(".main-pane").evaluate((e) => e.scrollTop))
        .toBe(0);
      assert.ok(
        paneScrollBefore > 0,
        "Overflowed recovery must be reachable by real wheel scrolling",
      );
      const narrowRecovery = page.getByRole("status", {
        name: "저장소 복구 상태",
        exact: true,
      });
      await expect(narrowRecovery).toHaveText(P7_RECOVERY_TEXT.pending_inbox);
      await expect(narrowRecovery).toBeInViewport({ ratio: 1 });
      await expect(narrowRetained).toBeInViewport({ ratio: 1 });
      await capture(
        page,
        "desktop-p7-pending-inbox-warnings-narrow-200-synthetic.png",
        "P7 pending-inbox bootstrap; narrow 200%; recovery and retained warnings reached by wheel",
      );
      const retryConnection = page.getByRole("button", {
        name: "연결 다시 확인",
        exact: true,
      });
      // Tab, rather than programmatic focus, must reach the read-only retry.
      for (let tab = 0; tab < 24; tab++) {
        if (
          await retryConnection.evaluate(
            (e) => e === globalThis.document.activeElement,
          )
        )
          break;
        await page.keyboard.press("Tab");
      }
      await expect(retryConnection).toBeFocused();
      await expect(retryConnection).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Enter");
      await expect(narrowInput).toHaveValue(narrowDraft);
      await expect(narrowRetained).toHaveAttribute("data-retained-count", "1");
      await expect(
        page.getByRole("button", { name: "메시지 보내기", exact: true }),
      ).toBeDisabled();
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        narrowBefore.mutations,
      );
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            window.innerWidth + 1,
        ),
        true,
      );
      assert.equal(
        await page
          .locator(".main-pane")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await capture(
        page,
        "desktop-p7-pending-inbox-bootstrap-narrow-200-synthetic.png",
        "P7 pending-inbox bootstrap; narrow 200%; keyboard retry and unchanged draft, no replay",
      );
      p7StorageStates.push({
        state: "pending-inbox-bootstrap-narrow-200",
        retainedOriginalKeyLookup: true,
        keyboardRetry: true,
        unchangedDraft: true,
        mutationAttemptsUnchanged: true,
        provenance: "synthetic host; actual hidden renderer at Electron 200%",
      });

      currentState = "P7 durable Documents location; narrow 200%";
      await application.evaluate(() =>
        globalThis.__omocUiFixture.setStorageState("durable-documents"),
      );
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      const narrowNavigation = page.getByRole("button", {
        name: "작업 공간 탐색 열기",
        exact: true,
      });
      await narrowNavigation.click();
      await openWorkspaceMenu(page).then((menu) =>
        menu
          .getByRole("menuitem", {
            name: "저장 위치와 보관 정보",
            exact: true,
          })
          .click(),
      );
      const narrowDialog = page.getByRole("dialog", {
        name: "저장 위치와 보관 정보",
        exact: true,
      });
      const narrowPath = narrowDialog.locator("dd").filter({
        hasText: P7_UI_STATES["durable-documents"].path,
      });
      await narrowPath.scrollIntoViewIfNeeded();
      await expect(narrowPath).toBeInViewport({ ratio: 1 });
      const narrowSelection = await narrowPath.evaluate((element) => {
        if (globalThis.getComputedStyle(element).userSelect === "none")
          throw new Error("Location path must remain selectable");
        const range = globalThis.document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
      assert.equal(narrowSelection, P7_UI_STATES["durable-documents"].path);
      await capture(
        page,
        "desktop-p7-durable-documents-path-narrow-200-synthetic.png",
        "P7 durable Documents full selected path; narrow 200%",
      );
      const pathBounds = await narrowPath.boundingBox();
      assert.ok(pathBounds);
      await page.mouse.move(
        pathBounds.x + pathBounds.width / 2,
        pathBounds.y + pathBounds.height / 2,
      );
      await page.mouse.wheel(0, 400);
      const durableText = narrowDialog.locator(
        '[data-storage-durability="durable"]',
      );
      await expect(durableText).toBeInViewport({ ratio: 1 });
      await capture(
        page,
        "desktop-p7-durable-documents-location-narrow-200-synthetic.png",
        "P7 durable Documents location; narrow 200%; selectable full path and scrollable information",
      );
      await page.keyboard.press("Escape");
      await expect(narrowDialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^작업 공간 전환:/ }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(narrowNavigation).toBeFocused();
      p7StorageStates.push({
        state: "durable-documents-location-narrow-200",
        fullPathSelectable: true,
        scrollReachable: true,
        escapeReturnsFocus: true,
        provenance: "synthetic host; actual hidden renderer at Electron 200%",
      });
      for (const name of [
        "normal",
        "untrusted",
        "partial",
        "missing",
        "long-path",
      ]) {
        currentState = `Configuration provenance ${name}`;
        await setDisplay(
          page,
          name === "long-path" ? 760 : 1440,
          name === "long-path" ? 600 : 960,
          name === "long-path" ? 2 : 1,
        );
        const expected = await application.evaluate((_electron, state) => {
          const catalog =
            globalThis.__omocUiFixture.setConfigurationState(state);
          return { catalog, mutations: globalThis.__omocUiMutationMetrics() };
        }, name);
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        const sources = page.getByRole("region", {
          name: "설정 출처",
          exact: true,
        });
        await expect(sources).toBeVisible();
        await expect(
          sources.getByText(
            "런타임 설정 문서의 적용 상태는 아직 확인하지 않습니다.",
            { exact: true },
          ),
        ).toBeVisible();
        let selectablePath = false;
        if (name === "missing") {
          await expect(
            sources.getByText("설정 출처 정보를 제공하지 않습니다.", {
              exact: true,
            }),
          ).toBeVisible();
        } else {
          const path = expected.catalog.configuration.entries[0].path;
          const location = sources.getByText(path, { exact: true });
          await expect(location).toBeVisible();
          await expect(
            sources.getByText("파일 발견 · 적용 여부 미확인", { exact: true }),
          ).toBeVisible();
          selectablePath = await location.evaluate((element) => {
            const range = globalThis.document.createRange();
            range.selectNodeContents(element);
            const selection = globalThis.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return (
              selection.toString() === element.textContent &&
              globalThis.getComputedStyle(element).userSelect === "text"
            );
          });
          assert.equal(selectablePath, true);
          if (name === "untrusted")
            await expect(
              sources.getByText(
                "신뢰하지 않은 작업 공간입니다. 파일 위치만 확인하며 구성을 실행하지 않습니다.",
                { exact: true },
              ),
            ).toBeVisible();
          if (name === "partial") {
            await expect(
              sources.getByText("일부 설정 출처를 확인할 수 없습니다.", {
                exact: true,
              }),
            ).toBeVisible();
            await expect(
              sources.getByText("확인할 수 없음", { exact: true }),
            ).toBeVisible();
          }
          if (name === "long-path") {
            await location.scrollIntoViewIfNeeded();
            const dialog = page.getByRole("dialog", {
              name: "파일, 확장 및 활동",
              exact: true,
            });
            await expect(dialog).toBeVisible();
            assert.equal(
              await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
              true,
            );
            assert.equal(
              await location.evaluate(
                (e) => e.scrollWidth <= e.clientWidth + 1,
              ),
              true,
            );
            const scroll = await location.evaluate(
              (e) => e.closest(".catalog").parentElement.scrollTop,
            );
            await page.mouse.move(200, 180);
            await page.mouse.wheel(0, 400);
            await expect
              .poll(() =>
                location.evaluate(
                  (e) => e.closest(".catalog").parentElement.scrollTop,
                ),
              )
              .toBeGreaterThan(scroll);
          }
        }
        await capture(
          page,
          `desktop-configuration-${name}-synthetic.png`,
          currentState,
        );
        if (name === "normal") {
          const mcp = page.getByText("상태: 외부 인증 설정 필요", {
            exact: true,
          });
          await mcp.scrollIntoViewIfNeeded();
          await expect(mcp).toBeInViewport({ ratio: 1 });
          await expect(
            page.getByText("상태: 연결됨 · 런타임 관측", { exact: true }),
          ).toBeVisible();
          await capture(
            page,
            "desktop-configuration-mcp-observed-synthetic.png",
            "Configuration MCP reported needs_auth/connected, no activation",
          );
        }
        const refresh = page
          .getByRole("region", { name: "런타임 확장 목록", exact: true })
          .getByRole("button", { name: "새로고침", exact: true });
        await refresh.focus();
        await expect(refresh).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(sources).toBeVisible();
        assert.deepEqual(
          await application.evaluate(() =>
            globalThis.__omocUiMutationMetrics(),
          ),
          expected.mutations,
        );
        if (name === "long-path") {
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("dialog", {
              name: "파일, 확장 및 활동",
              exact: true,
            }),
          ).toBeHidden();
          await expect(
            page.getByRole("button", { name: "파일·확장", exact: true }),
          ).toBeFocused();
        }
        configurationStates.push({
          state: name,
          discoveredVsRuntimeDistinguished: true,
          runtimeConfigurationNotReported: true,
          selectablePath,
          keyboardRefresh: true,
          mutationAttemptsUnchanged: true,
          ...(name === "long-path" && {
            actualWheelScroll: true,
            zoomFactor: 2,
            horizontalOverflow: false,
            escapeReturnsFocus: true,
          }),
          provenance:
            "synthetic DTO; actual hidden renderer; no SDK initialization proof",
        });
      }
      currentState = "Configuration draft edit and comparison";
      await setDisplay(page, 1440, 960, 1);
      const draftMutations = await application.evaluate(() => {
        const fixture = globalThis.__omocUiFixture;
        fixture.setConfigurationState("normal");
        fixture.snapshot.workspaces.push({
          id: "fixture-draft-w2",
          name: "Draft workspace B",
          path: "/synthetic/draft-b",
          kind: "folder",
          trusted: false,
          trustRevision: 1,
          temporary: true,
        });
        fixture.snapshot.sessions.push({
          id: "fixture-draft-s2",
          workspaceId: "fixture-draft-w2",
          title: "Draft session B",
          status: "idle",
        });
        fixture.sessionMessages = new Map(
          fixture.snapshot.sessions.map((s) => [s.id, []]),
        );
        return globalThis.__omocUiMutationMetrics();
      });
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
      await page
        .getByRole("button", { name: "확장·명령", exact: true })
        .click();
      const drafts = page.getByRole("region", {
        name: "설정 초안",
        exact: true,
      });
      const draftContent = drafts.getByRole("textbox", {
        name: "설정 초안 내용",
        exact: true,
      });
      const draftKind = drafts.getByRole("combobox", {
        name: "초안 종류",
        exact: true,
      });
      const validateDraft = drafts.getByRole("button", {
        name: "형식 검증",
        exact: true,
      });
      const compareDraft = drafts.getByRole("region", {
        name: "초안 변경 비교",
        exact: true,
      });
      await draftContent.fill(
        "# 합성 프로젝트 지침\n\n수정 전 테스트를 확인하세요.",
      );
      await validateDraft.focus();
      await page.keyboard.press("Enter");
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toBeVisible();
      await drafts
        .getByRole("button", { name: "현재 초안을 비교 기준으로", exact: true })
        .click();
      await draftContent.fill(
        "# 합성 프로젝트 지침\n\n수정 후 테스트와 별도 리뷰를 확인하세요.",
      );
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toHaveCount(0);
      await expect(
        compareDraft.getByText("수정 전 테스트를 확인하세요.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        compareDraft.getByText("수정 후 테스트와 별도 리뷰를 확인하세요.", {
          exact: false,
        }),
      ).toBeVisible();
      await capture(
        page,
        "desktop-configuration-draft-instructions-synthetic.png",
        currentState,
      );
      configurationDraftStates.push({
        state: "instructions",
        edited: true,
        keyboardValidation: true,
        editInvalidatesValidation: true,
        explicitMemoryBaseline: true,
        noDiskComparisonClaim: true,
      });

      currentState = "Configuration draft MCP invalid and supported subset";
      await draftKind.selectOption("mcp");
      await draftContent.fill('{"mcpServers":{"example":{"type":"local"}}}');
      await validateDraft.click();
      await expect(
        drafts.locator('[data-draft-validation="unsupported"]'),
      ).toBeVisible();
      await capture(
        page,
        "desktop-configuration-draft-mcp-unsupported-synthetic.png",
        currentState,
      );
      const disabledMcp = JSON.stringify(
        {
          mcp: {
            servers: {
              synthetic: {
                type: "local",
                command: ["node", "./synthetic-server.mjs"],
                disabled: true,
              },
            },
          },
        },
        null,
        2,
      );
      await draftContent.fill(disabledMcp);
      await validateDraft.click();
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toBeVisible();
      await capture(
        page,
        "desktop-configuration-draft-mcp-valid-synthetic.png",
        currentState,
      );
      await draftKind.selectOption("instructions");
      await expect(draftContent).toHaveValue(
        "# 합성 프로젝트 지침\n\n수정 후 테스트와 별도 리뷰를 확인하세요.",
      );
      await page
        .getByRole("button", { name: "상세 패널 닫기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
      await page
        .getByRole("button", { name: "확장·명령", exact: true })
        .click();
      await expect(draftContent).toHaveValue(
        "# 합성 프로젝트 지침\n\n수정 후 테스트와 별도 리뷰를 확인하세요.",
      );
      await selectWorkspace(page, "fixture-draft-w2");
      await expect(draftContent).toHaveValue("");
      await draftContent.fill("# 다른 작업 공간의 초안");
      await selectWorkspace(page, "fixture-w");
      await expect(draftContent).toHaveValue(
        "# 합성 프로젝트 지침\n\n수정 후 테스트와 별도 리뷰를 확인하세요.",
      );
      configurationDraftStates.push({
        state: "mcp",
        unsupportedFormat: true,
        supportedDisabledSubset: true,
        kindIsolation: true,
        panelReopenRetains: true,
        workspaceSwitchIsolates: true,
      });

      currentState = "Configuration draft narrow200 and bounded comparison";
      await draftContent.fill(
        Array.from({ length: 100 }, (_, i) => `합성 긴 초안 이전 줄 ${i}`).join(
          "\n",
        ),
      );
      await drafts
        .getByRole("button", { name: "현재 초안을 비교 기준으로", exact: true })
        .click();
      await draftContent.fill(
        Array.from(
          { length: 100 },
          (_, i) => `합성 긴 초안 수정한 줄 ${i}`,
        ).join("\n"),
      );
      await setDisplay(page, 760, 600, 2);
      await compareDraft.scrollIntoViewIfNeeded();
      const draftDialog = page.getByRole("dialog", {
        name: "파일, 확장 및 활동",
        exact: true,
      });
      await expect(draftDialog).toBeVisible();
      assert.equal(
        await draftDialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      assert.equal(
        await compareDraft.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      const diffRows = compareDraft.locator("[data-diff-kind]");
      await expect(diffRows).toHaveCount(80);
      await expect(
        compareDraft.getByText("변경 줄 120개를 생략했습니다.", {
          exact: false,
        }),
      ).toBeVisible();
      assert.equal(
        await compareDraft.evaluate((e) => {
          const range = globalThis.document.createRange();
          range.selectNodeContents(e);
          const selected = globalThis.getSelection();
          selected.removeAllRanges();
          selected.addRange(range);
          return selected.toString().includes("합성 긴 초안");
        }),
        true,
      );
      await capture(
        page,
        "desktop-configuration-draft-narrow200-synthetic.png",
        currentState,
      );
      await draftContent.scrollIntoViewIfNeeded();
      await draftContent.focus();
      const beforeEnter = await draftContent.evaluate((element) => {
        element.setSelectionRange(element.value.length, element.value.length);
        return element.value;
      });
      await page.keyboard.press("Enter");
      await expect(draftContent).toHaveValue(`${beforeEnter}\n`);
      await validateDraft.scrollIntoViewIfNeeded();
      await validateDraft.focus();
      await page.keyboard.press("Enter");
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toBeVisible();
      await capture(
        page,
        "desktop-configuration-draft-narrow200-controls-synthetic.png",
        currentState,
      );
      const panelScroll = await drafts.evaluate(
        (e) => e.closest(".catalog").parentElement.scrollTop,
      );
      const validateBounds = await validateDraft.boundingBox();
      assert.ok(validateBounds);
      await page.mouse.move(
        validateBounds.x + validateBounds.width / 2,
        validateBounds.y + validateBounds.height / 2,
      );
      await page.mouse.wheel(0, 400);
      await expect
        .poll(() =>
          drafts.evaluate((e) => e.closest(".catalog").parentElement.scrollTop),
        )
        .toBeGreaterThan(panelScroll);
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "파일·확장", exact: true }),
      ).toBeFocused();
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        draftMutations,
      );
      configurationDraftStates.push({
        state: "narrow200",
        zoomFactor: 2,
        horizontalOverflow: false,
        diffRows: 80,
        omittedRows: 120,
        diffSelectable: true,
        textareaEnterIsEdit: true,
        keyboardValidation: true,
        actualWheelScroll: true,
        escapeReturnsFocus: true,
        mutationAttemptsUnchanged: true,
      });
      currentState =
        "Configuration file explicit load and observed disk comparison";
      await setDisplay(page, 1440, 960, 1);
      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.configurationFiles.set(
          JSON.stringify(["fixture-w", "instructions"]),
          "# 합성 파일 지침\n파일 기준으로 비교하세요.\n",
        );
        f.configurationFiles.set(
          JSON.stringify(["fixture-w", "mcp"]),
          JSON.stringify(
            {
              mcp: {
                servers: {
                  synthetic: {
                    type: "local",
                    command: ["node", "./synthetic-server.mjs"],
                    disabled: true,
                  },
                },
              },
            },
            null,
            2,
          ),
        );
      });
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
      await page
        .getByRole("button", { name: "확장·명령", exact: true })
        .click();
      const loadFile = drafts.getByRole("button", {
        name: "파일 불러오기",
        exact: true,
      });
      const readStatus = drafts.getByRole("status", {
        name: "설정 파일 읽기 상태",
        exact: true,
      });
      await draftContent.fill("불러오기 전 합성 초안");
      await loadFile.focus();
      await page.keyboard.press("Enter");
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await expect(draftContent).toHaveValue(
        "# 합성 파일 지침\n파일 기준으로 비교하세요.\n",
      );
      await expect(drafts.locator("[data-draft-validation]")).toHaveCount(0);
      await expect(
        compareDraft.locator("[data-configuration-baseline]"),
      ).toHaveAttribute("data-configuration-baseline", "file");
      await expect(
        compareDraft.locator("[data-configuration-baseline-version]"),
      ).toContainText(/[a-f0-9]{64}/);
      await readStatus.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-loaded-synthetic.png",
        currentState,
      );
      await draftContent.fill(
        "# 합성 파일 지침\n파일과 다른 편집 내용입니다.\n",
      );
      await validateDraft.click();
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toBeVisible();
      await draftContent.fill(
        "# 합성 파일 지침\n수정한 합성 편집 내용을 유지하세요.\n",
      );
      await expect(
        drafts.locator('[data-draft-validation="valid"]'),
      ).toHaveCount(0);
      await compareDraft.scrollIntoViewIfNeeded();
      await expect(
        compareDraft.getByText("파일 기준으로 비교하세요.", { exact: false }),
      ).toBeVisible();
      await expect(
        compareDraft.locator("[data-configuration-baseline-warning]"),
      ).toContainText("현재 디스크 내용과 다를 수");
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-comparison-synthetic.png",
        currentState,
      );
      configurationFileStates.push({
        state: "instructions",
        explicitKeyboardLoad: true,
        observedFileBaseline: true,
        revisionValidationCleared: true,
        externalEditNotMonitoredLabel: true,
      });

      currentState =
        "Configuration file MCP supported and refused private content";
      await draftKind.selectOption("mcp");
      await loadFile.click();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      const loadedMcp = await draftContent.inputValue();
      assert.equal(JSON.parse(loadedMcp).mcp.servers.synthetic.disabled, true);
      await application.evaluate(() =>
        globalThis.__omocUiFixture.configurationFiles.set(
          JSON.stringify(["fixture-w", "mcp"]),
          '{"mcp":{"servers":{"private":{"type":"local","command":["node"],"environment":{"TOKEN":"SYNTHETIC-UI-CONFIG-CANARY"}},"private":{"type":"local","command":["node"]}}}}',
        ),
      );
      await loadFile.click();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "unsupported",
      );
      await expect(draftContent).toHaveValue(loadedMcp);
      assert.equal(
        await drafts.evaluate((e) =>
          e.textContent.includes("SYNTHETIC-UI-CONFIG-CANARY"),
        ),
        false,
      );
      await readStatus.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-unsupported-synthetic.png",
        currentState,
      );
      await application.evaluate(() =>
        globalThis.__omocUiFixture.configurationFiles.delete(
          JSON.stringify(["fixture-w", "mcp"]),
        ),
      );
      await loadFile.click();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "missing",
      );
      await expect(draftContent).toHaveValue(loadedMcp);
      configurationFileStates.push({
        state: "mcp",
        supportedSubsetLoaded: true,
        duplicateSecretMemberRefusedWithoutProjection: true,
        missingPreservesDraft: true,
        noAutomaticConnection: true,
      });

      currentState =
        "Configuration file narrow200 observed baseline and keyboard";
      await draftKind.selectOption("instructions");
      await expect(draftContent).toHaveValue(
        "# 합성 파일 지침\n수정한 합성 편집 내용을 유지하세요.\n",
      );
      await setDisplay(page, 760, 600, 2);
      await compareDraft.scrollIntoViewIfNeeded();
      await expect(
        compareDraft.locator("[data-configuration-baseline]"),
      ).toHaveAttribute("data-configuration-baseline", "file");
      assert.equal(
        await draftDialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      assert.equal(
        await compareDraft.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-narrow200-synthetic.png",
        currentState,
      );
      await loadFile.scrollIntoViewIfNeeded();
      await loadFile.focus();
      await page.keyboard.press("Enter");
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await expect(draftContent).toHaveValue(
        "# 합성 파일 지침\n파일 기준으로 비교하세요.\n",
      );
      await readStatus.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-narrow200-load-synthetic.png",
        currentState,
      );
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "파일·확장", exact: true }),
      ).toBeFocused();
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        draftMutations,
      );
      configurationFileStates.push({
        state: "narrow200",
        zoomFactor: 2,
        observedBaselineVisible: true,
        horizontalOverflow: false,
        explicitKeyboardLoad: true,
        escapeReturnsFocus: true,
        mutationAttemptsUnchanged: true,
        provenance:
          "Synthetic file-read DTO with actual hidden built renderer; real host FD IO covered separately by Node integration tests",
      });
      currentState =
        "Configuration file blank instructions distinct from empty draft validation";
      await setDisplay(page, 1440, 960, 1);
      await application.evaluate(() =>
        globalThis.__omocUiFixture.configurationFiles.set(
          JSON.stringify(["fixture-w", "instructions"]),
          "\ufeff \n\t",
        ),
      );
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
      await page
        .getByRole("button", { name: "확장·명령", exact: true })
        .click();
      await loadFile.focus();
      await page.keyboard.press("Enter");
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await expect(draftContent).toHaveValue("\ufeff \n\t");
      await expect(
        compareDraft.locator("[data-configuration-baseline]"),
      ).toHaveAttribute("data-configuration-baseline", "file");
      await validateDraft.click();
      await expect(
        drafts.locator('[data-draft-validation="invalid"]'),
      ).toBeVisible();
      await expect(
        drafts.getByText("내용을 입력하세요.", { exact: true }),
      ).toBeVisible();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await readStatus.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-blank-synthetic.png",
        currentState,
      );
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        draftMutations,
      );
      configurationFileStates.push({
        state: "blank-instructions",
        explicitKeyboardLoad: true,
        originalBomWhitespacePreserved: true,
        observedFileBaseline: true,
        fileReadAvailableWhileDraftFormatEmpty: true,
        mutationAttemptsUnchanged: true,
      });
      currentState =
        "Configuration file canonical POSIX literal backslash target";
      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.snapshot.workspaces.find((w) => w.id === "fixture-w").path =
          "/fixture/projects/한글\\폴더\\";
        f.configurationFiles.set(
          JSON.stringify(["fixture-w", "instructions"]),
          "# 합성 경로 지침",
        );
      });
      await page.reload();
      await expect(
        page.locator(".workbench-header [data-connection]"),
      ).toHaveAttribute("data-connection", "connected");
      await page
        .getByRole("button", { name: "파일·확장", exact: true })
        .click();
      await page
        .getByRole("button", { name: "확장·명령", exact: true })
        .click();
      await expect(
        drafts.locator("[data-configuration-read-target]"),
      ).toHaveText("읽기 대상: /fixture/projects/한글\\폴더\\/AGENTS.md");
      await loadFile.click();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await expect(draftContent).toHaveValue("# 합성 경로 지침");
      await expect(
        drafts.locator("[data-configuration-baseline-path]"),
      ).toHaveText(
        "마지막으로 불러온 파일 경로: /fixture/projects/한글\\폴더\\/AGENTS.md",
      );
      await readStatus.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          ),
      );
      await capture(
        page,
        "desktop-configuration-file-posix-backslash-synthetic.png",
        currentState,
      );
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        draftMutations,
      );
      configurationFileStates.push({
        state: "posix-literal-backslash",
        fixedTargetMatchesHostJoin: true,
        originalFilenamePreserved: true,
        observedFileBaseline: true,
        mutationAttemptsUnchanged: true,
      });
      currentState = "Configuration save explicit results";
      const saveButton = drafts.locator('[data-configuration-action="save"]');
      const saveStatus = drafts.locator("[data-configuration-save-status]");
      const syntheticOriginal = "# SYNTHETIC SAVE ORIGINAL\n";
      async function openSaveCase(mode = "loaded") {
        await setDisplay(page, 1440, 960, 1);
        await application.evaluate(
          (_electron, { mode, syntheticOriginal }) => {
            const f = globalThis.__omocUiFixture;
            f.setConfigurationState("normal");
            f.holdConfigurationSave = false;
            f.nextConfigurationSave = undefined;
            f.configurationFiles.clear();
            if (mode !== "missing")
              f.configurationFiles.set(
                JSON.stringify(["fixture-w", "instructions"]),
                syntheticOriginal,
              );
          },
          { mode, syntheticOriginal },
        );
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", {
            name: "\uD30C\uC77C\u00B7\uD655\uC7A5",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: "\uD655\uC7A5\u00B7\uBA85\uB839",
            exact: true,
          })
          .click();
        await loadFile.click();
        await expect(readStatus).toHaveAttribute(
          "data-configuration-read-status",
          mode === "missing" ? "missing" : "available",
        );
      }
      await openSaveCase();
      await draftContent.fill("# SYNTHETIC SAVED TEXT\n");
      await expect(saveButton).toBeEnabled();
      await saveButton.focus();
      await page.keyboard.press("Enter");
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "saved",
      );
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-current",
        "true",
      );
      await expect(
        drafts.locator("[data-configuration-save-backup]"),
      ).toContainText(
        /\.omoc-configuration-[a-f0-9]{64}\.instructions\.backup/,
      );
      await expect(
        drafts.locator("[data-configuration-save-version]"),
      ).toContainText(/[a-f0-9]{64}/);
      assert.deepEqual(
        await application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            text: f.configurationFiles.get(
              JSON.stringify(["fixture-w", "instructions"]),
            ),
            original: [...f.configurationBackups.values()].at(-1),
          };
        }),
        { text: "# SYNTHETIC SAVED TEXT\n", original: syntheticOriginal },
      );
      await captureSaveElement(
        drafts.locator("[data-configuration-save-message]"),
        "desktop-configuration-save-confirmed-synthetic.png",
        currentState,
      );
      const normalBackup = await captureSaveElement(
        drafts.locator("[data-configuration-save-backup]"),
        "desktop-configuration-save-confirmed-backup-synthetic.png",
        currentState,
      );
      configurationSaveStates.push({
        state: "confirmed",
        keyboardSave: true,
        verifiedBackup: true,
        observedVersion: true,
        current: true,
        runtimeActivation: false,
        completeBackupCapture: normalBackup,
      });
      for (const [label, width, height] of [
        ["narrow200", 760, 600],
        ["narrow360-200", 360, 800],
      ]) {
        await setDisplay(page, width, height, 2);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              globalThis.requestAnimationFrame(() =>
                globalThis.requestAnimationFrame(resolve),
              ),
            ),
        );
        await expect(draftDialog).toBeVisible();
        assert.equal(
          await draftDialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
        assert.equal(
          await drafts.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
        const frames = [];
        for (const [part, locator] of [
          ["target", drafts.locator("[data-configuration-save-target]")],
          ["control", saveButton],
          ["result", drafts.locator("[data-configuration-save-message]")],
          ["version", drafts.locator("[data-configuration-save-version]")],
          ["backup", drafts.locator("[data-configuration-save-backup]")],
        ]) {
          frames.push(
            await captureSaveElement(
              locator,
              part === "result"
                ? `desktop-configuration-save-${label}-synthetic.png`
                : `desktop-configuration-save-${label}-${part}-synthetic.png`,
              `Configuration save ${label} ${part}`,
            ),
          );
        }
        configurationSaveStates.push({
          state: label,
          zoomFactor: 2,
          contentWidth: width,
          horizontalOverflow: false,
          frames,
        });
      }

      await openSaveCase("missing");
      await draftContent.fill("SYNTHETIC NEW FILE");
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "saved",
      );
      await expect(
        drafts.locator("[data-configuration-save-backup]"),
      ).toHaveCount(0);
      await capture(
        page,
        "desktop-configuration-save-created-synthetic.png",
        "Explicit missing-file creation",
      );
      configurationSaveStates.push({ state: "created", backupInvented: false });

      await openSaveCase();
      await draftContent.fill("");
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "saved",
      );
      assert.equal(
        await application.evaluate(() =>
          globalThis.__omocUiFixture.configurationFiles.get(
            JSON.stringify(["fixture-w", "instructions"]),
          ),
        ),
        "",
      );
      await capture(
        page,
        "desktop-configuration-save-blank-synthetic.png",
        "Explicit blank instructions save",
      );
      configurationSaveStates.push({
        state: "blank",
        savedEmptyInstructions: true,
      });

      for (const outcome of ["denied", "conflict"]) {
        await openSaveCase();
        await draftContent.fill(`SYNTHETIC ${outcome} DRAFT`);
        await application.evaluate((_electron, outcome) => {
          const f = globalThis.__omocUiFixture;
          if (outcome === "conflict")
            f.configurationFiles.set(
              JSON.stringify(["fixture-w", "instructions"]),
              "SYNTHETIC EXTERNAL CHANGE",
            );
          else f.nextConfigurationSave = outcome;
        }, outcome);
        await saveButton.click();
        await expect(saveStatus).toHaveAttribute(
          "data-configuration-save-status",
          outcome,
        );
        await expect(draftContent).toHaveValue(`SYNTHETIC ${outcome} DRAFT`);
        await expect(saveButton).toBeDisabled();
        assert.equal(
          await application.evaluate(() =>
            globalThis.__omocUiFixture.configurationFiles.get(
              JSON.stringify(["fixture-w", "instructions"]),
            ),
          ),
          outcome === "conflict"
            ? "SYNTHETIC EXTERNAL CHANGE"
            : syntheticOriginal,
        );
        await capture(
          page,
          `desktop-configuration-save-${outcome}-synthetic.png`,
          `${outcome} preserves draft and original`,
        );
        configurationSaveStates.push({
          state: outcome,
          draftPreserved: true,
          targetUnchanged: true,
          explicitReloadRequired: true,
        });
      }

      await openSaveCase();
      await draftContent.fill("SYNTHETIC CAPTURED SAVE");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.holdConfigurationSave = true;
      });
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "pending",
      );
      await draftContent.fill("SYNTHETIC NEWER UNSAVED EDIT");
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-current",
        "false",
      );
      await capture(
        page,
        "desktop-configuration-save-pending-newer-synthetic.png",
        "Pending save with newer draft",
      );
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseConfigurationSaves(),
      );
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "saved",
      );
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-current",
        "false",
      );
      await expect(draftContent).toHaveValue("SYNTHETIC NEWER UNSAVED EDIT");
      assert.equal(
        await application.evaluate(() =>
          globalThis.__omocUiFixture.configurationFiles.get(
            JSON.stringify(["fixture-w", "instructions"]),
          ),
        ),
        "SYNTHETIC CAPTURED SAVE",
      );
      await capture(
        page,
        "desktop-configuration-save-previous-revision-synthetic.png",
        "Late save cannot mark newer edits saved",
      );
      configurationSaveStates.push({
        state: "late-save",
        newerDraftPreserved: true,
        current: false,
        capturedTextSaved: true,
      });

      await openSaveCase();
      await draftContent.fill("SYNTHETIC UNKNOWN DRAFT");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.nextConfigurationSave = "unknown";
      });
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "unknown",
      );
      await expect(saveButton).toBeDisabled();
      await expect(loadFile).toBeDisabled();
      await expect(draftContent).toBeEditable();
      await expect(draftContent).toHaveValue("SYNTHETIC UNKNOWN DRAFT");
      const heldSaveCounts = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      await page.keyboard.press("Tab");
      await expect(saveStatus).toHaveAttribute(
        "data-configuration-save-status",
        "unknown",
      );
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        heldSaveCounts,
      );
      await capture(
        page,
        "desktop-configuration-save-unknown-synthetic.png",
        "Unknown save preserves draft and blocks replay",
      );
      configurationSaveStates.push({
        state: "unknown",
        draftEditable: true,
        noResend: true,
        readDisabled: true,
        saveDisabled: true,
      });

      // Append to the previous evidence matrix. These are synthetic host states
      // driven through the actual built renderer/preload and frozen bridge actions.
      currentState = "Selected-session instruction registration";
      const instructionPanel = drafts.locator("[data-instructions-session]");
      const instructionStatus = instructionPanel.locator(
        "[data-instructions-status]",
      );
      const instructionAction = instructionPanel.locator(
        "[data-instructions-action-status]",
      );
      const observeInstructions = instructionPanel.locator(
        '[data-instructions-action="observe"]',
      );
      const applyInstructions = instructionPanel.locator(
        '[data-instructions-action="apply"]',
      );
      const removeInstructions = instructionPanel.locator(
        '[data-instructions-action="remove"]',
      );
      async function openInstructionCase(name, load = true, observe = true) {
        currentState = `Selected-session instructions ${name}`;
        await setDisplay(page, 1440, 960, 1);
        await application.evaluate((_electron, name) => {
          globalThis.__omocUiFixture.setInstructionState(name);
        }, name);
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        await expect(instructionPanel).toHaveAttribute(
          "data-instructions-session",
          "fixture-s",
        );
        await expect(instructionStatus).toHaveAttribute(
          "data-instructions-status",
          "not_observed",
        );
        await expect(applyInstructions).toBeDisabled();
        await expect(removeInstructions).toBeDisabled();
        if (load) {
          await loadFile.click();
          await expect(readStatus).toHaveAttribute(
            "data-configuration-read-status",
            "available",
          );
        }
        // A loaded file alone is insufficient. Observe the selected Native baseline.
        await expect(applyInstructions).toBeDisabled();
        assert.equal(
          await application.evaluate(
            () => globalThis.__omocUiFixture.instructionReads.length,
          ),
          0,
        );
        if (!observe) return;
        await expect(observeInstructions).toBeEnabled();
        await observeInstructions.click();
      }
      async function captureInstructions(name, narrow = false) {
        const frames = [];
        if (narrow) {
          await setDisplay(page, 760, 1000, 2);
          await expect(draftDialog).toBeVisible();
          assert.equal(
            await draftDialog.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
          assert.equal(
            await instructionPanel.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
        }
        for (const [part, locator] of [
          ["session", instructionPanel.locator(":scope > p").nth(1)],
          ["observe", observeInstructions],
          ["apply", applyInstructions],
          ["remove", removeInstructions],
          ["status", instructionStatus.locator(":scope > p").first()],
          ...((await instructionPanel
            .locator("[data-instructions-trust]")
            .count())
            ? [
                [
                  "trust-block",
                  instructionPanel
                    .locator("[data-instructions-trust] p")
                    .nth(0),
                ],
                [
                  "trust-next-step",
                  instructionPanel
                    .locator("[data-instructions-trust] p")
                    .nth(1),
                ],
                [
                  "trust-stored-metadata",
                  instructionPanel
                    .locator("[data-instructions-trust] p")
                    .nth(2),
                ],
              ]
            : []),
          ...((await instructionAction.locator("p").count())
            ? [["result", instructionAction.locator("p").first()]]
            : []),
          ...((await instructionPanel
            .locator("[data-instructions-parent]")
            .count())
            ? [
                [
                  "parent",
                  instructionPanel.locator("[data-instructions-parent]"),
                ],
              ]
            : []),
        ]) {
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-configuration-instructions-${name}-${part}-synthetic.png`,
              `Instructions ${name} ${part}`,
            ),
          );
        }
        configurationInstructionStates.push({
          state: name,
          sessionId: await instructionPanel.getAttribute(
            "data-instructions-session",
          ),
          observation: await instructionStatus.getAttribute(
            "data-instructions-status",
          ),
          origin: await instructionStatus.getAttribute(
            "data-instructions-origin",
          ),
          action: await instructionAction.getAttribute(
            "data-instructions-action-status",
          ),
          ...(narrow && {
            contentWidth: 760,
            zoomFactor: 2,
            horizontalOverflow: false,
          }),
          frames,
        });
      }

      await openInstructionCase("untrusted", false, false);
      const trustNotice = instructionPanel.locator(
        '[data-instructions-trust="untrusted"]',
      );
      await expect(trustNotice).toHaveAttribute("role", "status");
      await expect(trustNotice).toContainText("새 세션");
      await expect(trustNotice).toContainText("원래 세션");
      await expect(trustNotice).toContainText("자동 등록하지 않습니다");
      await expect(trustNotice).toContainText("저장된 등록 기록만으로");
      await expect(observeInstructions).toBeDisabled();
      await expect(applyInstructions).toBeDisabled();
      await expect(removeInstructions).toBeDisabled();
      await expect(instructionStatus).not.toHaveAttribute(
        "data-instructions-origin",
        /direct|fork/,
      );
      const untrustedCounts = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      await captureInstructions("untrusted-guidance-narrow200", true);
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.instructionReads.length,
        ),
        0,
      );
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        untrustedCounts,
      );
      configurationInstructionStates.at(
        -1,
      ).storedMetadataIsNotNativeObservation = true;
      configurationInstructionStates.at(-1).noAutomaticEntryReadOrMutation =
        true;

      await openInstructionCase("missing");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      const beforeInstructionApply = await application.evaluate(() => ({
        text: globalThis.__omocUiFixture.configurationFiles.get(
          JSON.stringify(["fixture-w", "instructions"]),
        ),
        messages: globalThis.__omocUiFixture.sessionMessages.get("fixture-s"),
      }));
      await expect(applyInstructions).toBeEnabled();
      await applyInstructions.focus();
      await page.keyboard.press("Enter");
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "registered",
      );
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "not_observed",
      );
      await expect(removeInstructions).toBeDisabled();
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.instructionReads.length,
        ),
        1,
      );
      await expect(observeInstructions).toBeEnabled();
      await observeInstructions.click();
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "registered",
      );
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-origin",
        "direct",
      );
      assert.deepEqual(
        await application.evaluate(() => ({
          text: globalThis.__omocUiFixture.configurationFiles.get(
            JSON.stringify(["fixture-w", "instructions"]),
          ),
          messages: globalThis.__omocUiFixture.sessionMessages.get("fixture-s"),
        })),
        beforeInstructionApply,
      );
      await captureInstructions("registered-direct");
      await captureInstructions("registered-direct-narrow200", true);

      await openInstructionCase("inherited");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "registered",
      );
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-origin",
        "fork",
      );
      await expect(
        instructionPanel.locator("[data-instructions-parent]"),
      ).toContainText("fixture-instruction-parent");
      // Parent later changes cannot redefine the recorded immediate fork origin.
      await application.evaluate(() => {
        globalThis.__omocUiFixture.instructionEntries.set(
          "fixture-instruction-parent",
          [
            {
              key: "omoc.project-instructions",
              value: "SYNTHETIC PARENT LATER CHANGE",
            },
          ],
        );
      });
      await observeInstructions.click();
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-origin",
        "fork",
      );
      await captureInstructions("inherited-narrow200", true);
      await setDisplay(page, 1440, 960, 1);
      await applyInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "registered",
      );
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "not_observed",
      );
      await observeInstructions.click();
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-origin",
        "direct",
      );
      await expect(
        instructionPanel.locator("[data-instructions-parent]"),
      ).toHaveCount(0);
      await captureInstructions("same-bytes-child-direct");

      // Remove remains available without an AGENTS file observation.
      await openInstructionCase("registered", false);
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "registered",
      );
      await expect(applyInstructions).toBeDisabled();
      await expect(removeInstructions).toBeEnabled();
      await removeInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "removed",
      );
      await observeInstructions.click();
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      await expect(instructionStatus).not.toHaveAttribute(
        "data-instructions-origin",
        /direct|fork/,
      );
      assert.equal(
        await application.evaluate(() =>
          globalThis.__omocUiFixture.configurationFiles.has(
            JSON.stringify(["fixture-w", "instructions"]),
          ),
        ),
        true,
      );
      await captureInstructions("removed-no-file-load-narrow200", true);

      await openInstructionCase("drift");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "changed",
      );
      await expect(applyInstructions).toBeEnabled();
      await expect(removeInstructions).toBeEnabled();
      await captureInstructions("drift-narrow200", true);

      await openInstructionCase("ownership-conflict");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "unavailable",
      );
      await expect(instructionStatus).toContainText("소유권");
      await expect(applyInstructions).toBeDisabled();
      await expect(removeInstructions).toBeDisabled();
      await captureInstructions("ownership-conflict-narrow200", true);

      await openInstructionCase("denied");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      await applyInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "denied",
      );
      await expect(draftContent).toHaveValue(
        "# SYNTHETIC SESSION INSTRUCTIONS\n",
      );
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.instructionEntries.size,
        ),
        0,
      );
      await captureInstructions("denied-narrow200", true);

      await openInstructionCase("registered");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "registered",
      );
      await application.evaluate(() => {
        globalThis.__omocUiFixture.instructionEntries.set("fixture-s", [
          { key: "omoc.project-instructions", value: "SYNTHETIC LATE DRIFT" },
        ]);
      });
      await applyInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "changed",
      );
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-code",
        "INSTRUCTIONS_CHANGED",
      );
      await captureInstructions("changed-before-dispatch");

      await openInstructionCase("late-selection");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      await applyInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "pending",
      );
      await expect
        .poll(() =>
          application.evaluate(
            () => globalThis.__omocUiFixture.heldInstructions.length,
          ),
        )
        .toBe(1);
      await page.locator('button[title="합성 다른 세션"]').click();
      await expect(instructionPanel).toHaveAttribute(
        "data-instructions-session",
        "fixture-instruction-other",
      );
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseInstructions(),
      );
      await expect
        .poll(() =>
          application.evaluate(
            () =>
              globalThis.__omocUiFixture.instructionRegistrations.get(
                "fixture-s",
              )?.origin,
          ),
        )
        .toBe("direct");
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "idle",
      );
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "not_observed",
      );
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.instructionReads.length,
        ),
        1,
      );
      await expect(observeInstructions).toBeEnabled();
      await observeInstructions.click();
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      await captureInstructions("late-selection-no-cross-session-result");

      await openInstructionCase("unknown");
      await expect(instructionStatus).toHaveAttribute(
        "data-instructions-status",
        "missing",
      );
      await applyInstructions.click();
      await expect(instructionAction).toHaveAttribute(
        "data-instructions-action-status",
        "unknown",
      );
      await expect(observeInstructions).toBeDisabled();
      await expect(applyInstructions).toBeDisabled();
      await expect(removeInstructions).toBeDisabled();
      const unknownInstructionCounts = await application.evaluate(() =>
        globalThis.__omocUiMutationMetrics(),
      );
      await draftContent.fill("SYNTHETIC UNKNOWN INSTRUCTION DRAFT");
      await page.keyboard.press("Tab");
      assert.deepEqual(
        await application.evaluate(() => globalThis.__omocUiMutationMetrics()),
        unknownInstructionCounts,
      );
      const retainedInstructionKeys = await application.evaluate(() =>
        [...globalThis.__omocUiFixture.retainedReceipts.values()]
          .filter(
            ({ receipt }) =>
              receipt.type === "configuration.instructions.apply" &&
              receipt.effect === "unknown",
          )
          .map(({ receipt }) => ({
            runtimeEpoch: receipt.runtimeEpoch,
            operationId: receipt.operationId,
            workspaceId: receipt.workspaceId,
            sessionId: receipt.sessionId,
          })),
      );
      assert.equal(retainedInstructionKeys.length, 1);
      assert.equal(retainedInstructionKeys[0].sessionId, "fixture-s");
      await captureInstructions("unknown-narrow200", true);
      configurationInstructionStates.at(-1).originalKeys =
        retainedInstructionKeys;
      configurationInstructionStates.at(-1).noReplay = true;
      // Frozen MCP hooks/labels; all effects below are synthetic fixture effects.
      const mcpPanel = drafts.locator("[data-mcp-workspace]");
      const mcpStatus = mcpPanel.getByRole("status", {
        name: "작업 공간 MCP 관찰 상태",
        exact: true,
      });
      const mcpAction = mcpPanel.getByRole("status", {
        name: "작업 공간 MCP 요청 상태",
        exact: true,
      });
      const mcpObserve = mcpPanel.locator('[data-mcp-action="observe"]');
      const mcpRegister = mcpPanel.locator('[data-mcp-action="register"]');
      const mcpDefinition = mcpPanel.getByRole("combobox", {
        name: "등록할 파일 정의",
        exact: true,
      });
      const ownedMcp = mcpPanel.locator(
        "li[data-mcp-server='demo'][data-mcp-ownership='current_runtime']",
      );
      async function openMcpCase(name, { load = false, observe = true } = {}) {
        currentState = `Workspace MCP ${name}`;
        await setDisplay(page, 1440, 960, 1);
        await application.evaluate(
          (_electron, name) => globalThis.__omocUiFixture.setMcpState(name),
          name,
        );
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        await draftKind.selectOption("mcp");
        await expect(mcpPanel).toHaveAttribute(
          "data-mcp-workspace",
          "fixture-w",
        );
        await expect(mcpStatus).toHaveAttribute(
          "data-mcp-status",
          "not_observed",
        );
        await expect(mcpAction).not.toHaveAttribute(
          "data-mcp-action-status",
          /.+/,
        );
        await expect(mcpRegister).toBeDisabled();
        assert.equal(
          await application.evaluate(
            () => globalThis.__omocUiFixture.mcpReads.length,
          ),
          0,
        );
        assert.equal(
          await application.evaluate(
            () => globalThis.__omocUiFixture.requests.length,
          ),
          0,
        );
        if (load) {
          await loadFile.click();
          await expect(readStatus).toHaveAttribute(
            "data-configuration-read-status",
            "available",
          );
          await expect(mcpDefinition).toHaveValue("");
          await expect(mcpRegister).toBeDisabled();
          await mcpDefinition.selectOption("demo");
          await expect(mcpRegister).toBeDisabled();
        }
        if (observe) {
          await expect(mcpObserve).toBeEnabled();
          await mcpObserve.click();
          await expect(mcpStatus).toHaveAttribute(
            "data-mcp-status",
            "observed",
          );
        }
      }
      async function captureMcp(name, narrow = false) {
        // Responsive panel remount resets local UI choices, while drafts and MCP
        // authority remain in the window store. Explicitly reselect the UI only.
        const definitionChoice = await mcpDefinition.inputValue();
        const beforeResize = await application.evaluate(() => ({
          metrics: globalThis.__omocUiMutationMetrics(),
          reads: globalThis.__omocUiFixture.mcpReads.length,
        }));
        if (narrow) {
          await setDisplay(page, 760, 1000, 2);
          await draftKind.selectOption("mcp");
          if (definitionChoice)
            await mcpDefinition.selectOption(definitionChoice);
          assert.deepEqual(
            await application.evaluate(() => ({
              metrics: globalThis.__omocUiMutationMetrics(),
              reads: globalThis.__omocUiFixture.mcpReads.length,
            })),
            beforeResize,
          );
        }
        assert.equal(
          await mcpPanel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
        if (narrow)
          assert.equal(
            await draftDialog.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
        const frames = [];
        if (name.startsWith("currentdisabled")) {
          const prerequisite = mcpPanel.locator(
            "[data-mcp-removal-prerequisite]",
          );
          await expect(prerequisite).toContainText(
            "작업 공간을 목록에서 제거하려면",
          );
          await expect(prerequisite).toContainText("‘등록 제거’를 각각");
          frames.push(
            await captureSaveElement(
              prerequisite,
              `desktop-configuration-mcp-${name}-removal-prerequisite-synthetic.png`,
              currentState,
            ),
          );
        }
        const controls = mcpPanel.locator("button,select");
        for (let index = 0; index < (await controls.count()); index++) {
          const control = controls.nth(index);
          assert.ok((await control.boundingBox()).height >= 32);
          if (await control.isEnabled()) {
            await control.focus();
            assert.equal(
              await control.evaluate(
                (e) => e === globalThis.document.activeElement,
              ),
              true,
            );
          }
          frames.push(
            await captureSaveElement(
              control,
              `desktop-configuration-mcp-${name}-control-${index}-synthetic.png`,
              currentState,
            ),
          );
        }
        for (const [label, locator] of [
          ["status", mcpStatus],
          ...((await mcpAction.getAttribute("data-mcp-action-status"))
            ? [["action", mcpAction]]
            : []),
        ])
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-configuration-mcp-${name}-${label}-synthetic.png`,
              currentState,
            ),
          );
        configurationMcpStates.push({
          state: name,
          observation: await mcpStatus.getAttribute("data-mcp-status"),
          action: await mcpAction.getAttribute("data-mcp-action-status"),
          workspaceId: await mcpPanel.getAttribute("data-mcp-workspace"),
          syntheticOnly: true,
          keyboardFocus: true,
          ...(narrow && {
            contentWidth: 760,
            zoomFactor: 2,
            horizontalOverflow: false,
            explicitUiReselectionAfterPanelRemount: true,
            reselectionNativeRequestsUnchanged: true,
          }),
          frames,
        });
      }
      for (const name of [
        "currentdisabled",
        "connected",
        "failed",
        "needs_auth",
        "unowned",
        "collision",
        "restart",
      ]) {
        await openMcpCase(name);
        if (["unowned", "collision", "restart"].includes(name)) {
          await expect(
            mcpPanel.locator("li[data-mcp-ownership='unowned']"),
          ).toHaveCount(1);
          await expect(mcpPanel.locator("li [data-mcp-action]")).toHaveCount(0);
        } else {
          await expect(ownedMcp).toHaveCount(1);
          await expect(ownedMcp).toContainText(
            name === "currentdisabled" ? "disabled" : name,
          );
          // Runtime controls need live ownership plus explicit read, no file baseline.
          await expect(
            ownedMcp.locator('[data-mcp-action="remove"]'),
          ).toBeEnabled();
        }
        if (name === "currentdisabled")
          await captureMcp("currentdisabled-desktop");
        await captureMcp(name, true);
        if (name === "restart") {
          const historical = await application.evaluate(() =>
            [...globalThis.__omocUiFixture.retainedReceipts.values()].map(
              (entry) => entry.receipt,
            ),
          );
          assert.equal(
            historical[0].runtimeEpoch,
            "fixture-MCP-original-epoch",
          );
          configurationMcpStates.at(-1).historicalOriginalEpoch =
            historical[0].runtimeEpoch;
        }
      }
      await openMcpCase("missing", { observe: false });
      await application.evaluate(() => {
        globalThis.__omocUiFixture.configurationFiles.set(
          JSON.stringify(["fixture-w", "mcp"]),
          JSON.stringify({
            mcp: {
              servers: {
                demo: {
                  type: "remote",
                  url: "http://127.0.0.1:9/mcp",
                  disabled: true,
                },
              },
            },
          }),
        );
      });
      await loadFile.click();
      await expect(readStatus).toHaveAttribute(
        "data-configuration-read-status",
        "available",
      );
      await mcpDefinition.selectOption("demo");
      await mcpObserve.click();
      await expect(mcpStatus).toHaveAttribute("data-mcp-status", "observed");
      await expect(
        mcpPanel.getByRole("status", {
          name: "지원하지 않는 MCP 변환",
          exact: true,
        }),
      ).toContainText("oauth:false");
      await expect(mcpRegister).toBeDisabled();
      await captureMcp("unsupported-omitted-oauth", true);
      await openMcpCase("untrusted", { observe: false });
      await expect(mcpObserve).toBeDisabled();
      await expect(
        mcpPanel.getByRole("status", {
          name: "MCP 작업 공간 신뢰 상태",
          exact: true,
        }),
      ).toContainText("새 세션");
      await captureMcp("untrusted", true);

      await openMcpCase("missing", { load: true, observe: false });
      // The read is a separate keyboard action after exact file load and choice.
      await mcpObserve.focus();
      await page.keyboard.press("Enter");
      await expect(mcpStatus).toHaveAttribute("data-mcp-status", "observed");
      await expect(mcpRegister).toBeEnabled();
      const mcpOriginal = await draftContent.inputValue();
      await draftContent.fill(mcpOriginal + " ");
      await expect(mcpRegister).toBeDisabled();
      await draftContent.fill(mcpOriginal);
      await mcpObserve.click();
      await expect(mcpRegister).toBeEnabled();
      await mcpRegister.focus();
      await page.keyboard.press("Enter");
      await expect(mcpAction).toHaveAttribute(
        "data-mcp-action-status",
        "registered_disabled",
      );
      await expect(mcpRegister).toBeDisabled();
      await expect(mcpStatus).not.toHaveAttribute(
        "data-mcp-status",
        "observed",
      );
      await captureMcp("keyboard-register-retired-read", true);
      await setDisplay(page, 1440, 960, 1);
      await draftKind.selectOption("mcp");
      await expect(mcpObserve).toBeEnabled();
      await mcpObserve.click();
      await expect(ownedMcp).toHaveCount(1);
      for (const [action, status] of [
        ["connect", "connected"],
        ["disconnect", "disconnected"],
        ["connect", "connected"],
        ["remove", "removed"],
      ]) {
        const button = ownedMcp.locator(`[data-mcp-action="${action}"]`);
        await expect(button).toBeEnabled();
        await button.click();
        await expect(mcpAction).toHaveAttribute(
          "data-mcp-action-status",
          status,
        );
        await expect(mcpStatus).not.toHaveAttribute(
          "data-mcp-status",
          "observed",
        );
        await expect(mcpObserve).toBeEnabled();
        await mcpObserve.click();
        await expect(mcpStatus).toHaveAttribute("data-mcp-status", "observed");
      }
      await expect(ownedMcp).toHaveCount(0);
      assert.equal(await draftContent.inputValue(), mcpOriginal);
      await captureMcp("full-explicit-lifecycle", true);

      for (const [name, status, code] of [
        ["denied", "denied", "CANCELLED"],
        ["changed", "changed", "MCP_CHANGED"],
        ["unknown", "unknown", undefined],
      ]) {
        await openMcpCase(name, { load: true });
        await mcpRegister.click();
        await expect(mcpAction).toHaveAttribute(
          "data-mcp-action-status",
          status,
        );
        if (code)
          await expect(mcpAction).toHaveAttribute("data-mcp-action-code", code);
        await captureMcp(name, true);
        if (name === "unknown") {
          await expect(mcpObserve).toBeDisabled();
          await expect(mcpRegister).toBeDisabled();
          const before = await application.evaluate(() =>
            globalThis.__omocUiMutationMetrics(),
          );
          await draftContent.fill(mcpOriginal + "\n ");
          await page.keyboard.press("Tab");
          const keys = await application.evaluate(() =>
            [...globalThis.__omocUiFixture.retainedReceipts.values()]
              .filter(
                ({ receipt }) =>
                  receipt.type === "configuration.mcp.register" &&
                  receipt.effect === "unknown",
              )
              .map(({ receipt }) => ({
                runtimeEpoch: receipt.runtimeEpoch,
                operationId: receipt.operationId,
                workspaceId: receipt.workspaceId,
                hasSession: Object.hasOwn(receipt, "sessionId"),
              })),
          );
          assert.equal(keys.length, 1);
          assert.equal(keys[0].hasSession, false);
          assert.deepEqual(
            await application.evaluate(() =>
              globalThis.__omocUiMutationMetrics(),
            ),
            before,
          );
          await expect
            .poll(() =>
              application.evaluate(() =>
                globalThis.__omocUiFixture.lookupEnvelopes.some(
                  (envelope) =>
                    envelope.operation.runtimeEpoch ===
                      globalThis.__omocUiFixture.snapshot.runtimeEpoch &&
                    envelope.operation.operationId ===
                      [
                        ...globalThis.__omocUiFixture.retainedReceipts.values(),
                      ].find(
                        ({ receipt }) =>
                          receipt.type === "configuration.mcp.register" &&
                          receipt.effect === "unknown",
                      )?.receipt.operationId,
                ),
              ),
            )
            .toBe(true);
          configurationMcpStates.at(-1).originalKeys = keys;
          configurationMcpStates.at(-1).editableDraft = true;
          configurationMcpStates.at(-1).noReplay = true;
        }
      }
      await openMcpCase("lateworkspace", { load: true });
      await mcpRegister.click();
      await expect(mcpAction).toHaveAttribute(
        "data-mcp-action-status",
        "pending",
      );
      await selectWorkspace(page, "fixture-mcp-other-w");
      await expect(mcpPanel).toHaveAttribute(
        "data-mcp-workspace",
        "fixture-mcp-other-w",
      );
      await application.evaluate(() => globalThis.__omocUiFixture.releaseMcp());
      await expect
        .poll(() =>
          application.evaluate(
            () => globalThis.__omocUiFixture.mcpRegistrations.size,
          ),
        )
        .toBe(1);
      await expect(mcpStatus).toHaveAttribute(
        "data-mcp-status",
        "not_observed",
      );
      await expect(mcpAction).not.toHaveAttribute(
        "data-mcp-action-status",
        /registered_disabled|connected/,
      );
      assert.equal(
        await application.evaluate(
          () => globalThis.__omocUiFixture.mcpReads.length,
        ),
        1,
      );
      await captureMcp("late-workspace-isolation", true);
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      configurationMcpStates.at(-1).keyboardEscape = true;

      // Append Skills after the complete P6/P7/configuration/instructions/MCP
      // matrices. All list/read/edit/validate/save/discard actions use real UI.
      const skillPanel = drafts.getByRole("region", {
        name: "Skill 파일 편집",
        exact: true,
      });
      const skillList = skillPanel.getByRole("button", {
        name: "Skill 파일 목록 확인",
        exact: true,
      });
      const skillRead = skillPanel.getByRole("button", {
        name: "Skill 파일 불러오기",
        exact: true,
      });
      const skillSave = skillPanel.getByRole("button", {
        name: "Skill 파일에 저장",
        exact: true,
      });
      const skillValidate = skillPanel.locator(
        '[data-skill-action="validate"]',
      );
      const skillDiscard = skillPanel.locator('[data-skill-action="discard"]');
      const skillSource = skillPanel.locator("[data-skill-source-select]");
      const skillText = skillPanel.getByRole("textbox", {
        name: "Skill 초안 내용",
        exact: true,
      });
      const skillListStatus = skillPanel.locator("[data-skill-list-status]");
      const skillReadStatus = skillPanel.locator("[data-skill-read-status]");
      const skillSaveStatus = skillPanel.locator("[data-skill-save-status]");
      const skillValidation = skillPanel.locator("[data-skill-validation]");
      const skillPath = skillPanel.locator("[data-skill-path]");
      const skillNative = skillPanel.locator("[data-skill-native]");
      const skillMetrics = () =>
        application.evaluate(() => ({
          mutations: globalThis.__omocUiMutationMetrics(),
          reads: globalThis.__omocUiFixture.skillReads.length,
          runtimeReads: globalThis.__omocUiFixture.skillRuntimeReads.length,
          runtimeEffects: globalThis.__omocUiFixture.skillRuntimeEffects.length,
          sends: globalThis.__omocUiFixture.requests.filter(
            (r) => r.type === "message.send" || r.type === "command.run",
          ).length,
        }));
      async function openSkillCase(name, runtime = false) {
        currentState = `${runtime ? "Skill runtime" : "Skill files"} ${name}`;
        await setDisplay(page, 1440, 960, 1);
        const scope = await application.evaluate(
          (_electron, { name, runtime }) =>
            runtime
              ? globalThis.__omocUiFixture.setSkillRuntimeState(name)
              : globalThis.__omocUiFixture.setSkillState(name),
          { name, runtime },
        );
        const initialMetrics = await skillMetrics();
        assert.equal(initialMetrics.reads, 0);
        assert.equal(initialMetrics.sends, 0);
        assert.equal(initialMetrics.runtimeReads, 0);
        assert.equal(initialMetrics.runtimeEffects, 0);
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        await expect(draftKind.locator('option[value="skills"]')).toHaveText(
          "Skills",
        );
        await draftKind.selectOption("skills");
        await expect(skillPanel).toBeVisible();
        await expect(skillList).toHaveAttribute("data-skill-action", "list");
        await expect(skillRead).toHaveAttribute("data-skill-action", "read");
        await expect(skillSave).toHaveAttribute("data-skill-action", "save");
        await expect(skillListStatus).toHaveAttribute(
          "data-skill-list-status",
          "not_observed",
        );
        await expect(skillReadStatus).toHaveAttribute(
          "data-skill-read-status",
          "not_observed",
        );
        await expect(skillSource).toHaveValue("");
        await expect(skillText).toHaveValue("");
        await expect(skillRead).toBeDisabled();
        await expect(skillSave).toBeDisabled();
        await expect(skillNative).toHaveAttribute(
          "data-skill-native",
          "not_observed",
        );
        await expect(skillNative).toContainText(
          "저장은 파일만 바꿉니다. Native 상태는 아래에서 직접 확인하세요.",
        );
        assert.deepEqual(await skillMetrics(), initialMetrics);
        return scope;
      }
      async function listAndSelectSkill(scope) {
        await skillList.focus();
        await expect(skillList).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(skillListStatus).toHaveAttribute(
          "data-skill-list-status",
          "available",
        );
        assert.equal((await skillMetrics()).reads, 1);
        await skillSource.selectOption(scope.sourceName);
        await expect(skillPanel).toHaveAttribute(
          "data-skill-source",
          scope.sourceName,
        );
        await expect(skillPath).toHaveText(
          `${scope.workspacePath}/.opencode/skills/${scope.sourceName}/SKILL.md`,
        );
        await expect(skillReadStatus).toHaveAttribute(
          "data-skill-read-status",
          "not_observed",
        );
        assert.equal(
          (await skillMetrics()).reads,
          1,
          "Selection must not read a file",
        );
      }
      async function readSkillWithKeyboard(status) {
        await skillRead.focus();
        await expect(skillRead).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(skillReadStatus).toHaveAttribute(
          "data-skill-read-status",
          status,
        );
      }
      async function editValidSkill(text) {
        await skillText.fill(text);
        await expect(skillText).toBeEditable();
        await expect(skillValidation).toHaveAttribute(
          "data-skill-validation",
          "not_validated",
        );
        await expect(skillValidate).toHaveText("형식 검증");
        await skillValidate.click();
        await expect(skillValidation).toHaveAttribute(
          "data-skill-validation",
          "valid",
        );
      }
      async function captureSkill(
        name,
        { narrow = false, focus = skillListStatus } = {},
      ) {
        const before = await skillMetrics();
        assert.equal(
          before.runtimeReads,
          0,
          "File-only flow cannot read Native",
        );
        assert.equal(
          before.runtimeEffects,
          0,
          "File-only flow cannot register or apply Native",
        );
        if (narrow) {
          await setDisplay(page, 760, 1000, 2);
          // Responsive remount resets local kind only; authoritative drafts remain.
          await draftKind.selectOption("skills");
          await expect(draftDialog).toBeVisible();
          assert.deepEqual(
            await skillMetrics(),
            before,
            "Resize/kind reselection cannot read or mutate",
          );
          assert.equal(
            await draftDialog.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
        }
        assert.equal(
          await skillPanel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
        const textSelection = await skillPath.evaluate((e) => {
          const range = e.ownerDocument.createRange();
          range.selectNodeContents(e);
          const selection = e.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const selected = selection.toString();
          const text = e.textContent;
          selection.removeAllRanges();
          return {
            selected,
            text,
            userSelect: globalThis.getComputedStyle(e).userSelect,
            wraps: e.scrollWidth <= e.clientWidth + 1,
          };
        });
        assert.equal(textSelection.selected, textSelection.text);
        assert.notEqual(textSelection.userSelect, "none");
        assert.equal(textSelection.wraps, true);
        const controls = skillPanel.locator("button,select,textarea");
        let focusedControls = 0;
        for (let index = 0; index < (await controls.count()); index++) {
          const control = controls.nth(index);
          assert.ok((await control.boundingBox()).height >= 32);
          if (await control.isEnabled()) {
            await control.focus();
            await expect(control).toBeFocused();
            focusedControls++;
          }
        }
        await expect(skillNative).toHaveAttribute(
          "data-skill-native",
          "not_observed",
        );
        const frames = [];
        for (const [part, locator] of [
          ["path", skillPath],
          ["status", focus],
          ["native", skillNative],
        ])
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-configuration-skill-${name}-${part}-synthetic.png`,
              currentState,
            ),
          );
        configurationSkillStates.push({
          state: name,
          syntheticVirtualFilesystem: true,
          nativeObservation: "not_observed",
          list: await skillListStatus.getAttribute("data-skill-list-status"),
          read: await skillReadStatus.getAttribute("data-skill-read-status"),
          readReason: await skillReadStatus.getAttribute(
            "data-skill-read-reason",
          ),
          save: await skillSaveStatus.getAttribute("data-skill-save-status"),
          saveCurrent: await skillSaveStatus.getAttribute(
            "data-skill-save-current",
          ),
          sourceName: await skillSource.inputValue(),
          focusedControls,
          selectableFullPath: textSelection.selected,
          horizontalOverflow: false,
          ...(narrow && {
            contentWidth: 760,
            zoomFactor: 2,
            explicitKindReselection: true,
            noAutomaticCallsOnResize: true,
          }),
          frames,
        });
      }
      for (const name of SKILL_UI_STATES) {
        const scope = await openSkillCase(name);
        if (["list-unread", "untrusted", "restoredoldkey"].includes(name)) {
          if (name === "untrusted") {
            const trust = skillPanel.locator('[data-skill-trust="untrusted"]');
            await expect(trust).toHaveAttribute("role", "status");
            await expect(trust).toContainText(
              "기존 ‘새 세션’은 신뢰 확인 뒤 새 대화를 만듭니다.",
            );
            await expect(trust).toContainText(
              "Skill 목록과 파일을 직접 불러오세요.",
            );
            await expect(trust).toContainText(
              "자동 등록하거나 실행하지 않습니다.",
            );
            const trustId = await trust.getAttribute("id");
            for (const control of [skillList, skillRead, skillSave]) {
              await expect(control).toBeDisabled();
              assert.ok(
                (await control.getAttribute("aria-describedby"))
                  .split(" ")
                  .includes(trustId),
              );
            }
            await captureSkill(name, { narrow: true, focus: trust });
            configurationSkillStates.at(
              -1,
            ).trustNoticeDescribesDisabledControls = true;
          } else {
            if (name === "restoredoldkey") {
              for (const control of [skillList, skillRead, skillSave])
                await expect(control).toBeDisabled();
              await expect(
                page.getByRole("status", {
                  name: "보관된 요청 확인",
                  exact: true,
                }),
              ).toHaveAttribute("data-retained-count", "1");
              await expect
                .poll(() =>
                  application.evaluate(
                    (_electron, key) =>
                      globalThis.__omocUiFixture.lookupEnvelopes.some(
                        (e) =>
                          e.runtimeEpoch ===
                            globalThis.__omocUiFixture.snapshot.runtimeEpoch &&
                          e.operation.runtimeEpoch === key.runtimeEpoch &&
                          e.operation.operationId === key.operationId,
                      ),
                    SKILL_RETAINED_KEY,
                  ),
                )
                .toBe(true);
              const before = await skillMetrics();
              await page.reload();
              await expect(
                page.locator(".workbench-header [data-connection]"),
              ).toHaveAttribute("data-connection", "connected");
              await page
                .getByRole("button", { name: "파일·확장", exact: true })
                .click();
              await page
                .getByRole("button", { name: "확장·명령", exact: true })
                .click();
              await draftKind.selectOption("skills");
              await expect(skillText).toHaveValue("");
              await expect(skillSource).toHaveValue("");
              assert.deepEqual(await skillMetrics(), before);
              await captureSkill(name, { narrow: true, focus: skillNative });
              configurationSkillStates.at(-1).originalKey = SKILL_RETAINED_KEY;
              configurationSkillStates.at(-1).payloadRestored = false;
              configurationSkillStates.at(-1).noReplayAfterReload = true;
            } else await captureSkill(name);
          }
          continue;
        }
        if (["list-missingparent", "list-denied"].includes(name)) {
          await skillList.click();
          await expect(skillListStatus).toHaveAttribute(
            "data-skill-list-status",
            name === "list-missingparent" ? "missing" : "unavailable",
          );
          await expect(skillListStatus).toContainText(
            name === "list-missingparent"
              ? "관찰 시점에 기존 Skill 폴더를 찾지 못했습니다. 폴더 생성은 지원하지 않습니다."
              : "폴더 또는 파일에 접근할 수 없습니다. 빈 목록이 아닙니다.",
          );
          await expect(skillSource.locator("option")).toHaveCount(1);
          await expect(skillRead).toBeDisabled();
          await captureSkill(name);
          continue;
        }
        await listAndSelectSkill(scope);
        if (
          ["list-available", "list-truncated", "file-unread"].includes(name)
        ) {
          if (name === "list-truncated") {
            await expect(skillSource.locator("option")).toHaveCount(17);
            await expect(
              skillPanel.locator('[data-skill-list-truncated="true"]'),
            ).toContainText("목록 일부만 표시합니다.");
          }
          await expect(skillText).toHaveValue("");
          await captureSkill(name, { narrow: name === "list-truncated" });
          continue;
        }
        const readStatus =
          name === "file-missingleaf"
            ? "missing"
            : name === "file-unsafeunsupported"
              ? "unsupported"
              : ["file-changed", "file-oversize"].includes(name)
                ? "unavailable"
                : "available";
        const heldText = "# SYNTHETIC EDITABLE HELD DRAFT\n";
        if (["unsupported", "unavailable"].includes(readStatus))
          await skillText.fill(heldText);
        await readSkillWithKeyboard(readStatus);
        if (["unsupported", "unavailable"].includes(readStatus)) {
          await expect(skillText).toHaveValue(heldText);
          await expect(skillText).toBeEditable();
          await expect(skillReadStatus).toHaveAttribute(
            "data-skill-read-reason",
            name === "file-unsafeunsupported"
              ? "unsupported_content"
              : name === "file-oversize"
                ? "too_large"
                : "file_changed",
          );
          await skillValidate.click();
          await expect(skillSave).toBeDisabled();
          const before = await skillMetrics();
          await skillText.focus();
          await page.keyboard.press("ControlOrMeta+A");
          const selected = await skillText.evaluate((e) => ({
            start: e.selectionStart,
            end: e.selectionEnd,
            length: e.value.length,
            disabled: e.disabled,
            readOnly: e.readOnly,
          }));
          assert.equal(selected.end - selected.start, selected.length);
          assert.equal(selected.disabled || selected.readOnly, false);
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          assert.deepEqual(
            await skillMetrics(),
            before,
            "Editing held text cannot send a message",
          );
          await captureSkill(name, {
            narrow: name === "file-unsafeunsupported",
            focus: skillReadStatus,
          });
          configurationSkillStates.at(-1).heldDraftEditableSelectable = true;
          continue;
        }
        if (readStatus === "available")
          await expect(skillText).toHaveValue(scope.text);
        if (name === "file-rawunsupportedgrammar") {
          await skillValidate.click();
          await expect(skillValidation).toHaveAttribute(
            "data-skill-validation",
            "unsupported",
          );
          await expect(skillSave).toBeDisabled();
          await captureSkill(name, { focus: skillValidation });
          await editValidSkill("# SYNTHETIC EXPLICIT GRAMMAR REPAIR\n");
          await expect(skillSave).toBeEnabled();
          configurationSkillStates.at(-1).explicitRepairValid = true;
          continue;
        }
        if (name === "file-available") {
          const before = await skillMetrics();
          await skillSource.selectOption(scope.otherSourceName);
          await expect(skillReadStatus).toHaveAttribute(
            "data-skill-read-status",
            "not_observed",
          );
          await expect(skillText).toHaveValue("");
          assert.deepEqual(await skillMetrics(), before);
          await readSkillWithKeyboard("available");
          const other = await skillText.inputValue();
          assert.notEqual(other, scope.text);
          await skillSource.selectOption(scope.sourceName);
          await expect(skillText).toHaveValue(scope.text);
          await expect(
            skillPanel.locator('[data-skill-read-stale="true"]'),
          ).toBeVisible();
          await expect(skillSave).toBeDisabled();
          assert.equal((await skillMetrics()).reads, before.reads + 1);
          await readSkillWithKeyboard("available");
          await expect(
            skillPanel.locator("[data-skill-read-stale]"),
          ).toHaveCount(0);
          await captureSkill(name, { focus: skillReadStatus });
          configurationSkillStates.at(-1).distinctPerFileDrafts = true;
          configurationSkillStates.at(-1).selectionDoesNotRead = true;
          continue;
        }
        const updated = `# SYNTHETIC SKILL ${name.toUpperCase()}\n직접 편집한 파일 내용\n`;
        await editValidSkill(updated);
        await expect(skillSave).toBeEnabled();
        if (name === "dirtyvalid") {
          const before = await skillMetrics();
          await skillText.focus();
          await page.keyboard.press("ControlOrMeta+A");
          assert.equal(
            await skillText.evaluate((e) => e.selectionEnd - e.selectionStart),
            updated.length,
          );
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          assert.deepEqual(await skillMetrics(), before);
          await expect(skillSave).toBeDisabled();
          await skillDiscard.click();
          await expect(skillText).toHaveValue("");
          await expect(skillReadStatus).toHaveAttribute(
            "data-skill-read-status",
            "not_observed",
          );
          await readSkillWithKeyboard("available");
          await editValidSkill(updated);
          await captureSkill(name, { narrow: true, focus: skillValidation });
          configurationSkillStates.at(-1).explicitDiscardAndReread = true;
          configurationSkillStates.at(-1).keyboardEnterNoSend = true;
          continue;
        }
        // Confirmed/missing creation/unknown use actual save action. A receipt
        // retires observation authority; snapshot floor precedes explicit reread.
        const beforeSave = await skillMetrics();
        await skillSave.focus();
        await page.keyboard.press("Enter");
        await expect(skillSaveStatus).toHaveAttribute(
          "data-skill-save-status",
          name === "unknown" ? "unknown" : "saved",
        );
        await expect(skillSaveStatus).toHaveAttribute(
          "data-skill-save-current",
          "true",
        );
        await expect(skillSave).toBeDisabled();
        await expect(skillText).toHaveValue(updated);
        await expect(skillText).toBeEditable();
        assert.equal((await skillMetrics()).reads, beforeSave.reads);
        const original = await application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          const entry = [...f.retainedReceipts.values()].find(
            ({ receipt }) => receipt.type === "configuration.skill.save",
          );
          return {
            receipt: entry.receipt,
            request: f.requests.find(
              (r) => r.type === "configuration.skill.save",
            ),
            backup: [...f.skillBackups.values()].at(-1),
            disk: f.skillFiles.get(f.skillKey("fixture-w", "review-notes")),
            snapshotCount: f.skillSnapshotReads.length,
          };
        });
        assert.equal(original.receipt.workspaceId, scope.workspaceId);
        assert.equal(Object.hasOwn(original.receipt, "sessionId"), false);
        assert.equal(original.request.sourceName, scope.sourceName);
        assert.match(original.request.directoryVersion, /^[a-f0-9]{64}$/);
        assert.equal((await skillMetrics()).sends, 0);
        if (name === "unknown") {
          await expect(skillList).toBeDisabled();
          await expect(skillRead).toBeDisabled();
          assert.equal(original.receipt.effect, "unknown");
          assert.equal(original.receipt.result, undefined);
          assert.equal(original.disk, scope.text);
          const before = await skillMetrics();
          await skillText.focus();
          await page.keyboard.press("ControlOrMeta+A");
          assert.equal(
            await skillText.evaluate((e) => e.selectionEnd - e.selectionStart),
            updated.length,
          );
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          await skillValidate.click();
          await expect(skillSave).toBeDisabled();
          await expect
            .poll(() =>
              application.evaluate(
                (_electron, receipt) =>
                  globalThis.__omocUiFixture.lookupEnvelopes.some(
                    (e) =>
                      e.runtimeEpoch ===
                        globalThis.__omocUiFixture.snapshot.runtimeEpoch &&
                      e.operation.runtimeEpoch === receipt.runtimeEpoch &&
                      e.operation.operationId === receipt.operationId,
                  ),
                original.receipt,
              ),
            )
            .toBe(true);
          assert.deepEqual(await skillMetrics(), before);
          await captureSkill(name, { narrow: true, focus: skillSaveStatus });
          configurationSkillStates.at(-1).originalKey = {
            runtimeEpoch: original.receipt.runtimeEpoch,
            operationId: original.receipt.operationId,
          };
          configurationSkillStates.at(-1).noReplay = true;
          configurationSkillStates.at(-1).heldDraftEditableSelectable = true;
        } else {
          assert.equal(original.receipt.admission, "dispatched");
          assert.equal(original.receipt.delivery, "accepted");
          assert.equal(original.receipt.effect, "confirmed");
          assert.equal(original.receipt.result.kind, "skill_file_saved");
          assert.equal(original.receipt.result.sourceName, scope.sourceName);
          assert.deepEqual(original.receipt.evidence, [
            { kind: "host-registry", id: scope.workspaceId },
          ]);
          assert.equal(original.disk, updated);
          assert.equal(
            original.backup,
            name === "file-missingleaf" ? undefined : scope.text,
          );
          await expect(
            skillPanel.locator('[data-skill-read-stale="true"]'),
          ).toBeVisible();
          if (name === "file-missingleaf")
            await expect(skillPanel.locator("[data-skill-backup]")).toHaveCount(
              0,
            );
          else
            await expect(
              skillPanel.locator("[data-skill-backup]"),
            ).toContainText(/\.omoc-configuration-[a-f0-9]{64}\.skill\.backup/);
          await captureSkill(name, {
            narrow: name === "confirmed",
            focus: skillSaveStatus,
          });
          await expect
            .poll(
              () =>
                application.evaluate(
                  (_electron, { floor, count }) => {
                    const snapshots =
                      globalThis.__omocUiFixture.skillSnapshotReads;
                    return (
                      snapshots.length > count &&
                      snapshots.at(-1).revision >= floor
                    );
                  },
                  {
                    floor: original.receipt.revision,
                    count: original.snapshotCount,
                  },
                ),
              { timeout: 12000 },
            )
            .toBe(true);
          assert.equal(
            (await skillMetrics()).reads,
            beforeSave.reads,
            "Snapshot polling cannot reread Skills",
          );
          await readSkillWithKeyboard("available");
          await expect(skillText).toHaveValue(updated);
          await expect(
            skillPanel.getByText(
              `읽은 파일 버전: ${original.receipt.result.version}`,
              { exact: true },
            ),
          ).toBeVisible();
          await expect(
            skillPanel.locator("[data-skill-read-stale]"),
          ).toHaveCount(0);
          await expect(skillSave).toBeDisabled();
          await editValidSkill(`${updated}Explicit next revision\n`);
          await expect(skillSave).toBeEnabled();
          configurationSkillStates.at(-1).receiptFloor =
            original.receipt.revision;
          configurationSkillStates.at(-1).snapshotBeforeExplicitReread = true;
          configurationSkillStates.at(-1).receiptIsNotReadAuthority = true;
        }
      }
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      configurationSkillStates.at(-1).keyboardEscape = true;
      // Append runtime coverage after every previous evidence matrix. These are
      // synthetic bridge effects, never proof of actual Native/plugin execution.
      const runtimePanel = drafts.locator("[data-skill-runtime]");
      const runtimeObserve = runtimePanel.locator(
        "[data-skill-runtime-observe]",
      );
      const runtimeRegister = runtimePanel.locator(
        "[data-skill-runtime-register]",
      );
      const runtimeStatus = runtimePanel.locator("[data-skill-runtime-status]");
      const runtimeAction = runtimePanel.locator("[data-skill-runtime-action]");
      const runtimeHistory = runtimePanel.locator(
        "[data-skill-runtime-history]",
      );
      const runtimeRow = (nativeId) =>
        runtimePanel.locator(`[data-skill-runtime-row="${nativeId}"]`);
      const runtimeApply = (nativeId) =>
        runtimePanel.locator(`[data-skill-runtime-apply="${nativeId}"]`);
      const runtimeRemove = (nativeId) =>
        runtimePanel.locator(`[data-skill-runtime-remove="${nativeId}"]`);
      async function observeRuntimeWithKeyboard() {
        await expect(runtimeObserve).toBeEnabled();
        await runtimeObserve.focus();
        await expect(runtimeObserve).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(runtimeStatus).toHaveText(
          "현재 Native 상태를 확인했습니다.",
        );
      }
      async function prepareRuntime(name) {
        const scope = await openSkillCase(name, true);
        await expect(runtimePanel).toBeVisible();
        await expect(runtimeRegister).toBeDisabled();
        assert.equal((await skillMetrics()).runtimeReads, 0);
        assert.equal((await skillMetrics()).runtimeEffects, 0);
        if (!["untrusted", "restoredoldkey"].includes(name)) {
          await listAndSelectSkill(scope);
          await readSkillWithKeyboard("available");
          // File list, selection, load and unchanged draft validation have no Native reads.
          await skillValidate.click();
          assert.equal((await skillMetrics()).runtimeReads, 0);
          await expect(runtimeRegister).toBeDisabled();
        }
        return scope;
      }
      async function runtimeOriginal(type) {
        return application.evaluate((_electron, type) => {
          const f = globalThis.__omocUiFixture;
          const entry = [...f.retainedReceipts.values()]
            .filter(({ receipt }) => receipt.type === type)
            .at(-1);
          return {
            receipt: entry?.receipt,
            intent: f.intents.filter((i) => i.type === type).at(-1),
            file: f.skillFiles.get(f.skillKey("fixture-w", "review-notes")),
            snapshotCount: f.skillSnapshotReads.length,
            effects: f.skillRuntimeEffects,
          };
        }, type);
      }
      async function waitRuntimeFloor(receipt) {
        await expect(runtimeStatus).not.toHaveText(
          "현재 Native 상태를 확인했습니다.",
        );
        await expect
          .poll(() =>
            application.evaluate(
              (_electron, floor) =>
                globalThis.__omocUiFixture.skillSnapshotReads.some(
                  (s) => s.revision >= floor,
                ),
              receipt.revision,
            ),
          )
          .toBe(true);
        await expect(runtimeObserve).toBeEnabled();
      }
      async function captureRuntime(name, { narrow = false } = {}) {
        const before = await skillMetrics();
        if (narrow) {
          await setDisplay(page, 760, 1000, 2);
          await draftKind.selectOption("skills");
          await expect(draftDialog).toBeVisible();
        }
        // Refocus and responsive remount must never fetch or execute implicitly.
        await skillText.focus();
        assert.deepEqual(await skillMetrics(), before);
        assert.equal(
          await runtimePanel.evaluate(
            (e) => e.scrollWidth <= e.clientWidth + 1,
          ),
          true,
        );
        if (narrow)
          assert.equal(
            await draftDialog.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
        const frames = [];
        const controls = runtimePanel.locator("button,pre[tabindex]");
        for (let i = 0; i < (await controls.count()); i++) {
          const control = controls.nth(i);
          if (await control.isEnabled()) {
            await control.focus();
            await expect(control).toBeFocused();
          }
          if (await control.evaluate((e) => e.tagName === "BUTTON"))
            assert.ok((await control.boundingBox()).height >= 32);
          frames.push(
            await captureSaveElement(
              control,
              `desktop-configuration-skill-runtime-${name}-control-${i}-synthetic.png`,
              currentState,
            ),
          );
        }
        const content = runtimePanel.locator("[data-skill-runtime-content]");
        const rows = runtimePanel.locator("[data-skill-runtime-row]");
        let fullTargetAndBodySelectable = false;
        for (let i = 0; i < (await rows.count()); i++) {
          const disclosure = await rows.nth(i).evaluate((e) => {
            const pre = e.querySelector("[data-skill-runtime-content]");
            const range = e.ownerDocument.createRange();
            range.selectNodeContents(e);
            const selection = e.ownerDocument.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const all = selection.toString();
            selection.removeAllRanges();
            range.selectNodeContents(pre);
            selection.addRange(range);
            const body = selection.toString();
            const bodyRange = selection.getRangeAt(0).toString();
            selection.removeAllRanges();
            return {
              text: e.textContent,
              all,
              body,
              bodyRange,
              exactBody: pre.textContent,
              userSelect: globalThis.getComputedStyle(pre).userSelect,
              wraps: pre.scrollWidth <= pre.clientWidth + 1,
            };
          });
          assert.ok(disclosure.all.includes("대상 파일:"));
          assert.ok(disclosure.all.includes("적용 대상:"));
          // Chromium rendered selection may omit the final line break at narrow zoom.
          // The actual selected DOM range must still contain every original character.
          assert.equal(disclosure.bodyRange, disclosure.exactBody);
          const rendered = (text) =>
            text.replace(/\r\n/gu, "\n").replace(/\n$/u, "");
          assert.equal(
            rendered(disclosure.body),
            rendered(disclosure.exactBody),
          );
          assert.notEqual(disclosure.userSelect, "none");
          assert.equal(disclosure.wraps, true);
          fullTargetAndBodySelectable = true;
        }
        for (const [part, locator] of [
          ["status", runtimeStatus],
          ...((await runtimeAction.count()) ? [["action", runtimeAction]] : []),
          ...((await runtimeHistory.count())
            ? [["history", runtimeHistory]]
            : []),
          ...Array.from({ length: await content.count() }, (_, i) => [
            `body-${i}`,
            content.nth(i),
          ]),
        ]) {
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-configuration-skill-runtime-${name}-${part}-synthetic.png`,
              currentState,
            ),
          );
        }
        configurationSkillRuntimeStates.push({
          state: name,
          syntheticOnly: true,
          observation: await runtimeStatus.innerText(),
          action: (await runtimeAction.count())
            ? await runtimeAction.getAttribute("data-skill-runtime-action")
            : null,
          metrics: await skillMetrics(),
          keyboardFocus: true,
          fullTargetAndBodySelectable,
          ...(narrow
            ? {
                contentWidth: 760,
                zoomFactor: 2,
                horizontalOverflow: false,
                noImplicitReadOrEffectAfterReselection: true,
              }
            : {}),
          frames,
        });
      }
      for (const name of SKILL_RUNTIME_UI_STATES) {
        const scope = await prepareRuntime(name);
        if (name === "untrusted") {
          await expect(runtimeObserve).toBeDisabled();
          await expect(runtimeRegister).toBeDisabled();
          await expect(
            runtimePanel.locator("[data-skill-runtime-trust]"),
          ).toContainText("새 세션");
          await captureRuntime(name, { narrow: true });
          continue;
        }
        if (name === "restoredoldkey") {
          await expect(runtimeObserve).toBeDisabled();
          await expect
            .poll(() =>
              application.evaluate(
                (_electron, key) =>
                  globalThis.__omocUiFixture.lookupEnvelopes.some(
                    (e) =>
                      e.operation.runtimeEpoch === key.runtimeEpoch &&
                      e.operation.operationId === key.operationId,
                  ),
                SKILL_RUNTIME_RETAINED_KEY,
              ),
            )
            .toBe(true);
          const before = await skillMetrics();
          await page.reload();
          await page
            .getByRole("button", { name: "파일·확장", exact: true })
            .click();
          await page
            .getByRole("button", { name: "확장·명령", exact: true })
            .click();
          await draftKind.selectOption("skills");
          await expect(skillText).toHaveValue("");
          assert.deepEqual(await skillMetrics(), before);
          await captureRuntime(name, { narrow: true });
          configurationSkillRuntimeStates.at(-1).originalKey =
            SKILL_RUNTIME_RETAINED_KEY;
          configurationSkillRuntimeStates.at(-1).noReplayAfterReload = true;
          continue;
        }
        if (name === "unavailable") {
          await runtimeObserve.click();
          await expect(runtimeStatus).toContainText("runtime_error");
          await expect(runtimeRegister).toBeDisabled();
          await captureRuntime(name);
          continue;
        }
        await observeRuntimeWithKeyboard();
        assert.equal((await skillMetrics()).runtimeReads, 1);
        if (
          [
            "owned",
            "already-present",
            "history-unavailable",
            "inherited",
          ].includes(name)
        ) {
          await expect(runtimeRow(scope.nativeId)).toContainText(
            "autoinvoke: false",
          );
          await expect(runtimeRow(scope.nativeId)).toContainText(
            scope.workspacePath,
          );
          await expect(
            runtimeRow(scope.nativeId).locator("[data-skill-runtime-content]"),
          ).toHaveText("# SYNTHETIC SKILL A\n");
          if (name === "owned") {
            await expect(runtimeApply(scope.nativeId)).toBeEnabled();
            await expect(runtimeRemove(scope.nativeId)).toBeEnabled();
          } else {
            await expect(runtimeApply(scope.nativeId)).toBeDisabled();
            await expect(runtimeRemove(scope.nativeId)).toBeEnabled();
            await expect(runtimeHistory).toContainText(
              name === "history-unavailable"
                ? "history_truncated"
                : "fixture-recorded-skill",
            );
            await expect(runtimeHistory).toContainText(
              "직접 적용 또는 fork 출처는 판단하지 않습니다.",
            );
          }
          await captureRuntime(name, {
            narrow: ["owned", "inherited", "history-unavailable"].includes(
              name,
            ),
          });
          continue;
        }
        if (["foreign", "restart"].includes(name)) {
          const foreign = runtimePanel.locator("[data-skill-runtime-unowned]");
          await expect(foreign).toContainText(scope.nativeId);
          await expect(foreign.locator("button")).toHaveCount(0);
          await expect(
            runtimePanel.locator("[data-skill-runtime-row]"),
          ).toHaveCount(0);
          if (name === "restart")
            await expect(runtimeHistory).toContainText(
              "fixture-recorded-skill",
            );
          await captureRuntime(name, { narrow: true });
          continue;
        }
        await expect(runtimeRegister).toBeEnabled();
        const original = await skillText.inputValue();
        if (name === "empty") {
          // Dirty text retires the explicit runtime observation without rereading it.
          await skillText.fill(original + "Dirty draft\n");
          await expect(runtimeRegister).toBeDisabled();
          assert.equal((await skillMetrics()).runtimeReads, 1);
          await skillText.fill(original);
          await observeRuntimeWithKeyboard();
        }
        await runtimeRegister.focus();
        await page.keyboard.press("Enter");
        if (name === "pending") {
          await expect(runtimeAction).toHaveAttribute(
            "data-skill-runtime-action",
            "pending",
          );
          await expect(skillText).toBeEditable();
          await expect(runtimeObserve).toBeDisabled();
          await captureRuntime("pending", { narrow: true });
          await application.evaluate(() =>
            globalThis.__omocUiFixture.releaseSkillRuntime(),
          );
        }
        const expected =
          name === "unknown"
            ? "unknown"
            : ["denied", "changed"].includes(name)
              ? "denied"
              : "registered_disabled";
        await expect(runtimeAction).toHaveAttribute(
          "data-skill-runtime-action",
          expected,
        );
        const registered = await runtimeOriginal(
          "configuration.skill.register",
        );
        assert.equal(registered.file, scope.text);
        if (["denied", "changed"].includes(name)) {
          assert.equal(registered.receipt.effect, "none");
          assert.equal((await skillMetrics()).runtimeEffects, 0);
          await captureRuntime(name);
          continue;
        }
        if (name === "unknown") {
          await expect(runtimeObserve).toBeDisabled();
          await expect(runtimeRegister).toBeDisabled();
          const before = await skillMetrics();
          await skillText.focus();
          await page.keyboard.press("ControlOrMeta+A");
          assert.equal(
            await skillText.evaluate((e) => e.selectionEnd - e.selectionStart),
            original.length,
          );
          await skillText.fill(original + "Editable held draft\n");
          await skillValidate.click();
          await expect(skillSave).toBeDisabled();
          await expect
            .poll(() =>
              application.evaluate(
                (_electron, receipt) =>
                  globalThis.__omocUiFixture.lookupEnvelopes.some(
                    (e) =>
                      e.operation.runtimeEpoch === receipt.runtimeEpoch &&
                      e.operation.operationId === receipt.operationId,
                  ),
                registered.receipt,
              ),
            )
            .toBe(true);
          assert.deepEqual(await skillMetrics(), before);
          await captureRuntime(name, { narrow: true });
          configurationSkillRuntimeStates.at(-1).originalKey = {
            runtimeEpoch: registered.receipt.runtimeEpoch,
            operationId: registered.receipt.operationId,
          };
          configurationSkillRuntimeStates.at(-1).heldDraftEditableSelectable =
            true;
          configurationSkillRuntimeStates.at(-1).noReplay = true;
          continue;
        }
        assert.equal(
          registered.intent.requestId,
          registered.receipt.operationId,
        );
        assert.equal(
          registered.receipt.result.registrationOperationId,
          registered.receipt.operationId,
        );
        assert.equal(Object.hasOwn(registered.receipt, "sessionId"), false);
        await expect(runtimeRegister).toBeDisabled();
        await waitRuntimeFloor(registered.receipt);
        await captureRuntime(`${name}-registered`);
        await observeRuntimeWithKeyboard();
        const nativeId = registered.receipt.result.nativeId;
        await expect(runtimeRow(nativeId)).toContainText("autoinvoke: false");
        await runtimeApply(nativeId).focus();
        await page.keyboard.press("Enter");
        await expect(runtimeAction).toHaveAttribute(
          "data-skill-runtime-action",
          "applied",
        );
        const applied = await runtimeOriginal("configuration.skill.apply");
        assert.equal(applied.receipt.sessionId, scope.sessionId);
        assert.equal(
          applied.receipt.result.registrationOperationId,
          registered.receipt.operationId,
        );
        assert.equal(applied.effects.at(-1).resume, false);
        await waitRuntimeFloor(applied.receipt);
        await observeRuntimeWithKeyboard();
        await expect(runtimeApply(nativeId)).toBeDisabled();
        await expect(runtimeHistory).toContainText(
          applied.receipt.result.nativeMessageId,
        );
        await captureRuntime(`${name}-applied`, { narrow: true });
        await runtimeRemove(nativeId).focus();
        await page.keyboard.press("Enter");
        await expect(runtimeAction).toHaveAttribute(
          "data-skill-runtime-action",
          "removed",
        );
        const removed = await runtimeOriginal("configuration.skill.remove");
        assert.equal(removed.file, scope.text);
        assert.equal(Object.hasOwn(removed.receipt, "sessionId"), false);
        await waitRuntimeFloor(removed.receipt);
        await observeRuntimeWithKeyboard();
        await expect(
          runtimePanel.locator("[data-skill-runtime-row]"),
        ).toHaveCount(0);
        await expect(runtimeHistory).toContainText(
          applied.receipt.result.nativeMessageId,
        );
        await expect(skillText).toHaveValue(original);
        await captureRuntime(`${name}-removed`, { narrow: true });
        configurationSkillRuntimeStates.at(
          -1,
        ).removePreservesFileAndSessionHistory = true;
        assert.equal((await skillMetrics()).runtimeEffects, 3);
        assert.equal((await skillMetrics()).sends, 0);
      }
      // Explicit observation cancellation uses the production renderer cancel action.
      await prepareRuntime("empty");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.holdSkillRuntimeReads = true;
      });
      await runtimeObserve.click();
      const runtimeCancel = runtimePanel.locator("[data-skill-runtime-cancel]");
      await expect(runtimeCancel).toBeVisible();
      await runtimeCancel.focus();
      await page.keyboard.press("Enter");
      await expect(runtimeCancel).toHaveCount(0);
      await expect(runtimeStatus).not.toHaveText(
        "현재 Native 상태를 확인했습니다.",
      );
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseSkillRuntimeReads(),
      );
      await expect(
        runtimePanel.locator("[data-skill-runtime-row]"),
      ).toHaveCount(0);
      await captureRuntime("cancelled", { narrow: true });
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      configurationSkillRuntimeStates.at(-1).keyboardEscape = true;
      // Append Agent coverage once, after the entire original evidence matrix.
      // Production renderer/preload interactions; virtual files and Native rows only.
      const agentPanel = drafts.getByRole("region", {
        name: "Agent 파일 편집",
        exact: true,
      });
      const agentList = agentPanel.locator('[data-agent-action="list"]');
      const agentRead = agentPanel.locator('[data-agent-action="read"]');
      const agentSave = agentPanel.locator('[data-agent-action="save"]');
      const agentValidate = agentPanel.locator(
        '[data-agent-action="validate"]',
      );
      const agentDiscard = agentPanel.locator('[data-agent-action="discard"]');
      const agentSource = agentPanel.locator("[data-agent-source-select]");
      const agentText = agentPanel.getByRole("textbox", {
        name: "Agent 초안 내용",
        exact: true,
      });
      const agentPath = agentPanel.locator("[data-agent-path]");
      const agentListStatus = agentPanel.locator("[data-agent-list-status]");
      const agentReadStatus = agentPanel.locator("[data-agent-read-status]");
      const agentSaveStatus = agentPanel.locator("[data-agent-save-status]");
      const agentValidation = agentPanel.locator("[data-agent-validation]");
      const agentRuntime = drafts.locator("[data-agent-runtime]");
      const agentObserve = agentRuntime.locator("[data-agent-runtime-observe]");
      const agentRegister = agentRuntime.locator(
        "[data-agent-runtime-register]",
      );
      const agentRuntimeStatus = agentRuntime.locator(
        "[data-agent-runtime-status]",
      );
      const agentAction = agentRuntime.locator("[data-agent-runtime-action]");
      const agentRemove = (nativeId) =>
        agentRuntime.locator('[data-agent-runtime-remove="' + nativeId + '"]');
      const agentRow = (nativeId) =>
        agentRuntime.locator('[data-agent-runtime-row="' + nativeId + '"]');
      const agentMetrics = () =>
        application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            reads: f.agentReads.length,
            runtimeReads: f.agentRuntimeReads.length,
            effects: f.agentRuntimeEffects.length,
            mutations: f.requests.length,
            sends: f.requests.filter((r) =>
              ["message.send", "command.run"].includes(r.type),
            ).length,
          };
        });
      const textareaValue = (text) => text.replace(/\r\n/gu, "\n");
      async function openAgentPanel() {
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        await expect(draftKind.locator('option[value="agents"]')).toHaveText(
          "Agents",
        );
        await draftKind.selectOption("agents");
        await expect(agentPanel).toBeVisible();
        await expect(agentRuntime).toBeVisible();
      }
      async function openAgentCase(name, runtime = false) {
        currentState = (runtime ? "Agent runtime " : "Agent files ") + name;
        await setDisplay(page, 1440, 960, 1);
        const scope = await application.evaluate(
          (_electron, { name, runtime }) =>
            runtime
              ? globalThis.__omocUiFixture.setAgentRuntimeState(name)
              : globalThis.__omocUiFixture.setAgentState(name),
          { name, runtime },
        );
        const before = await agentMetrics();
        assert.deepEqual(before, {
          reads: 0,
          runtimeReads: 0,
          effects: 0,
          mutations: 0,
          sends: 0,
        });
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await openAgentPanel();
        await expect(agentListStatus).toHaveAttribute(
          "data-agent-list-status",
          "not_observed",
        );
        await expect(agentReadStatus).toHaveAttribute(
          "data-agent-read-status",
          "not_observed",
        );
        await expect(agentSource).toHaveValue("");
        await expect(agentText).toHaveValue("");
        await expect(agentRegister).toBeDisabled();
        await expect(agentSave).toBeDisabled();
        assert.deepEqual(await agentMetrics(), before);
        return scope;
      }
      async function agentKeyboard(control) {
        await expect(control).toBeEnabled();
        await control.focus();
        await expect(control).toBeFocused();
        await page.keyboard.press("Enter");
      }
      async function listSelectAgent(scope) {
        await agentKeyboard(agentList);
        await expect(agentListStatus).toHaveAttribute(
          "data-agent-list-status",
          "available",
        );
        const before = await agentMetrics();
        await agentSource.selectOption(scope.sourceName);
        await expect(agentPanel).toHaveAttribute(
          "data-agent-source",
          scope.sourceName,
        );
        await expect(agentPath).toHaveText(
          scope.workspacePath + "/.opencode/agents/" + scope.sourceName + ".md",
        );
        await expect(agentText).toHaveValue("");
        assert.deepEqual(
          await agentMetrics(),
          before,
          "Selection cannot read files or Native",
        );
      }
      async function readAgent(status = "available") {
        await agentKeyboard(agentRead);
        await expect(agentReadStatus).toHaveAttribute(
          "data-agent-read-status",
          status,
        );
      }
      async function editAgent(text) {
        await agentText.fill(text);
        await expect(agentText).toBeEditable();
        await expect(agentValidation).toHaveAttribute(
          "data-agent-validation",
          "not_validated",
        );
        await agentKeyboard(agentValidate);
        await expect(agentValidation).toHaveAttribute(
          "data-agent-validation",
          "valid",
        );
      }
      async function captureAgent(
        name,
        { runtime = false, narrow = false, focus = agentReadStatus } = {},
      ) {
        const captureName = `${runtime ? "runtime" : "file"}-${name}`;
        const before = await agentMetrics();
        if (narrow) {
          await setDisplay(page, 760, 1000, 2);
          await draftKind.selectOption("agents");
          await expect(draftDialog).toBeVisible();
          assert.equal(
            await draftDialog.evaluate(
              (e) => e.scrollWidth <= e.clientWidth + 1,
            ),
            true,
          );
        }
        if (await agentText.isEnabled()) await agentText.focus();
        assert.deepEqual(
          await agentMetrics(),
          before,
          "Resize, kind reselection and refocus cannot call the bridge",
        );
        for (const panel of [agentPanel, agentRuntime])
          assert.equal(
            await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
            true,
          );
        const selected = {
          path: await selectableAgent(agentPath),
          systems: [],
          policies: [],
          targets: [],
        };
        const frames = [];
        const controls = (runtime ? agentRuntime : agentPanel).locator(
          "button,select,textarea,pre[tabindex]",
        );
        for (let i = 0; i < (await controls.count()); i++) {
          const control = controls.nth(i);
          if (await control.isEnabled()) {
            await control.focus();
            await expect(control).toBeFocused();
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(control).toBeFocused();
          }
          if (await control.evaluate((e) => e.tagName === "BUTTON"))
            assert.ok((await control.boundingBox()).height >= 32);
        }
        for (const [kind, hook] of [
          ["targets", "path"],
          ["systems", "system"],
          ["policies", "policy"],
        ]) {
          const disclosures = agentRuntime.locator(
            "[data-agent-runtime-" + hook + "]",
          );
          for (let i = 0; i < (await disclosures.count()); i++) {
            selected[kind].push(await selectableAgent(disclosures.nth(i)));
            frames.push(
              await captureSaveElement(
                disclosures.nth(i),
                "desktop-configuration-agent-" +
                  captureName +
                  "-" +
                  kind +
                  "-" +
                  i +
                  "-synthetic.png",
                currentState,
              ),
            );
          }
        }
        for (const [part, locator] of [
          ["path", agentPath],
          ["status", focus],
          ...(runtime
            ? [
                ["runtime-status", agentRuntimeStatus],
                [
                  "policy-help",
                  agentRuntime.locator("[data-agent-runtime-policy-help]"),
                ],
              ]
            : []),
          ...((await agentAction.count()) && runtime
            ? [["action", agentAction]]
            : []),
        ]) {
          frames.push(
            await captureSaveElement(
              locator,
              "desktop-configuration-agent-" +
                captureName +
                "-" +
                part +
                "-synthetic.png",
              currentState,
            ),
          );
        }
        assert.deepEqual(await agentMetrics(), before);
        const entry = {
          state: name,
          syntheticOnly: true,
          actualRendererPreload: true,
          list: await agentListStatus.getAttribute("data-agent-list-status"),
          read: await agentReadStatus.getAttribute("data-agent-read-status"),
          save: await agentSaveStatus.getAttribute("data-agent-save-status"),
          runtimeStatus: await agentRuntimeStatus.innerText(),
          action: (await agentAction.count())
            ? await agentAction.getAttribute("data-agent-runtime-action")
            : null,
          metrics: before,
          selectableFullText: selected,
          keyboardForwardBackward: true,
          ...(narrow && {
            contentWidth: 760,
            zoomFactor: 2,
            horizontalOverflow: false,
            noImplicitCalls: true,
          }),
          frames,
        };
        (runtime
          ? configurationAgentRuntimeStates
          : configurationAgentStates
        ).push(entry);
      }
      async function agentOriginal(type) {
        return application.evaluate((_electron, type) => {
          const f = globalThis.__omocUiFixture;
          const receipt = [...f.retainedReceipts.values()]
            .filter((e) => e.receipt.type === type)
            .at(-1)?.receipt;
          return {
            receipt,
            request: f.requests.filter((r) => r.type === type).at(-1),
            intent: f.intents.filter((r) => r.type === type).at(-1),
            disk: f.agentFiles.get(f.agentKey("fixture-w", "review-notes")),
            backup: [...f.agentBackups.values()].at(-1),
            snapshots: f.agentSnapshotReads.length,
            effects: f.agentRuntimeEffects,
          };
        }, type);
      }
      async function agentFloor(receipt) {
        const before = await agentMetrics();
        await expect
          .poll(() =>
            application.evaluate(
              (_electron, floor) =>
                globalThis.__omocUiFixture.agentSnapshotReads.some(
                  (s) => s.revision >= floor,
                ),
              receipt.revision,
            ),
          )
          .toBe(true);
        assert.deepEqual(
          await agentMetrics(),
          before,
          "Receipt-floor polling cannot read files or Native",
        );
      }
      async function agentOriginalLookup(receipt) {
        await expect
          .poll(() =>
            application.evaluate(
              (_electron, key) =>
                globalThis.__omocUiFixture.lookupEnvelopes.some(
                  (e) =>
                    e.runtimeEpoch ===
                      globalThis.__omocUiFixture.snapshot.runtimeEpoch &&
                    e.operation.runtimeEpoch === key.runtimeEpoch &&
                    e.operation.operationId === key.operationId,
                ),
              receipt,
            ),
          )
          .toBe(true);
      }
      async function heldAgentDraft(text) {
        const before = await agentMetrics();
        await expect(agentText).toBeEditable();
        await agentText.focus();
        await page.keyboard.press("ControlOrMeta+A");
        assert.equal(
          await agentText.evaluate((e) => e.selectionEnd - e.selectionStart),
          text.length,
        );
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await agentValidate.click();
        await expect(agentSave).toBeDisabled();
        await expect(agentRegister).toBeDisabled();
        assert.deepEqual(
          await agentMetrics(),
          before,
          "Editing held drafts cannot send or replay",
        );
      }
      for (const name of AGENT_UI_STATES) {
        const scope = await openAgentCase(name);
        if (["list-unread", "untrusted", "restoredoldkey"].includes(name)) {
          if (name === "untrusted") {
            const trust = agentPanel.locator("[data-agent-trust]");
            await expect(trust).toContainText("새 세션");
            await expect(trust).toContainText("새 대화를 만듭니다");
            for (const control of [agentList, agentRead, agentSave]) {
              await expect(control).toBeDisabled();
              assert.ok(
                (await control.getAttribute("aria-describedby"))
                  .split(" ")
                  .includes(await trust.getAttribute("id")),
              );
            }
          }
          if (name === "restoredoldkey") {
            await agentOriginalLookup(AGENT_RETAINED_KEY);
            await expect(agentList).toBeDisabled();
            const before = await agentMetrics();
            await page.reload();
            await openAgentPanel();
            await expect(agentText).toHaveValue("");
            await expect(agentSource).toHaveValue("");
            assert.deepEqual(await agentMetrics(), before);
          }
          await captureAgent(name, { narrow: name !== "list-unread" });
          continue;
        }
        if (["list-missingparent", "list-denied"].includes(name)) {
          await agentKeyboard(agentList);
          await expect(agentListStatus).toHaveAttribute(
            "data-agent-list-status",
            name === "list-missingparent" ? "missing" : "unavailable",
          );
          await expect(agentRead).toBeDisabled();
          await captureAgent(name, { focus: agentListStatus });
          continue;
        }
        await listSelectAgent(scope);
        if (
          ["list-available", "list-truncated", "file-unread"].includes(name)
        ) {
          if (name === "list-truncated") {
            await expect(agentSource.locator("option")).toHaveCount(17);
            await expect(
              agentPanel.locator("[data-agent-list-truncated]"),
            ).toBeVisible();
          }
          await captureAgent(name, { narrow: name === "list-truncated" });
          continue;
        }
        const statuses = {
          "file-missingleaf": "missing",
          "file-unsafeunsupported": "unsupported",
          "file-changed": "unavailable",
          "file-oversize": "unavailable",
        };
        const blocked = [
          "file-unsafeunsupported",
          "file-changed",
          "file-oversize",
        ].includes(name);
        const held = "# Editable held Agent draft\n";
        if (blocked) await agentText.fill(held);
        await readAgent(statuses[name] ?? "available");
        if (blocked) {
          await expect(agentText).toHaveValue(held);
          await heldAgentDraft(held);
          await captureAgent(name, { narrow: true });
          continue;
        }
        if (name === "file-rawunsupportedgrammar") {
          await expect(agentText).toHaveValue(textareaValue(scope.text));
          await agentValidate.click();
          await expect(agentValidation).toHaveAttribute(
            "data-agent-validation",
            "unsupported",
          );
          await expect(agentSave).toBeDisabled();
          await captureAgent(name, { focus: agentValidation });
          await editAgent("# EXPLICIT SUPPORTED AGENT REPAIR\n");
          await expect(agentSave).toBeEnabled();
          configurationAgentStates.at(-1).explicitRepairRequired = true;
          continue;
        }
        if (name === "file-available") {
          const before = await agentMetrics();
          await agentSource.selectOption(scope.otherSourceName);
          await expect(agentText).toHaveValue("");
          assert.deepEqual(await agentMetrics(), before);
          await readAgent();
          const other = await agentText.inputValue();
          await agentSource.selectOption(scope.sourceName);
          await expect(agentText).toHaveValue(textareaValue(scope.text));
          assert.notEqual(other, await agentText.inputValue());
          await expect(agentSave).toBeDisabled();
          await captureAgent(name);
          configurationAgentStates.at(-1).distinctSourceDrafts = true;
          continue;
        }
        if (name === "file-supportedbom") {
          await expect(agentText).toHaveValue(textareaValue(scope.text));
          const disk = await application.evaluate(() => {
            const f = globalThis.__omocUiFixture;
            return f.agentFiles.get(f.agentKey("fixture-w", "review-notes"));
          });
          assert.equal(disk, scope.text);
          assert.ok(disk.startsWith("\uFEFF") && disk.includes("\r\n"));
          await captureAgent(name, { narrow: true });
          configurationAgentStates.at(-1).exactRawBomCrlfOnVirtualDisk = true;
          continue;
        }
        const updated =
          "# SYNTHETIC EXPLICIT AGENT UPDATE\n" +
          "Updated selectable content. ".repeat(10) +
          "\n";
        await editAgent(updated);
        await expect(agentSave).toBeEnabled();
        if (name === "dirtyvalid") {
          const before = await agentMetrics();
          await agentText.focus();
          await page.keyboard.press("End");
          await page.keyboard.press("Enter");
          assert.deepEqual(await agentMetrics(), before);
          await agentDiscard.click();
          await expect(agentText).toHaveValue("");
          await readAgent();
          await editAgent(updated);
          await captureAgent(name, { narrow: true, focus: agentValidation });
          continue;
        }
        const beforeSave = await agentMetrics();
        await agentKeyboard(agentSave);
        await expect(agentSaveStatus).toHaveAttribute(
          "data-agent-save-status",
          name === "savecancel"
            ? "denied"
            : name === "saveunknown"
              ? "unknown"
              : "saved",
        );
        await expect(agentText).toHaveValue(updated);
        const original = await agentOriginal("configuration.agent.save");
        assert.equal((await agentMetrics()).runtimeReads, 0);
        assert.equal((await agentMetrics()).effects, 0);
        assert.equal((await agentMetrics()).reads, beforeSave.reads);
        if (name === "savecancel") {
          assert.equal(original.receipt.result.code, "CANCELLED");
          assert.equal(original.disk, scope.text);
        } else if (name === "saveunknown") {
          assert.equal(original.receipt.effect, "unknown");
          assert.equal(original.disk, scope.text);
          assert.equal(original.receipt.result, undefined);
          await expect(agentRead).toBeDisabled();
          await heldAgentDraft(updated);
          await agentOriginalLookup(original.receipt);
        } else {
          assert.equal(original.receipt.result.kind, "agent_file_saved");
          assert.equal(original.disk, updated);
          if (name !== "file-missingleaf")
            assert.equal(original.backup, scope.text);
          await agentFloor(original.receipt);
          await expect(agentSave).toBeDisabled();
          await captureAgent(name + "-saved-before-reread", {
            narrow: name === "confirmed",
            focus: agentSaveStatus,
          });
          configurationAgentStates.at(-1).receiptFloor =
            original.receipt.revision;
          await readAgent();
          await expect(agentText).toHaveValue(updated);
          await expect(
            agentPanel.locator("[data-agent-read-stale]"),
          ).toHaveCount(0);
        }
        await captureAgent(name, {
          narrow: ["saveunknown", "confirmed"].includes(name),
          focus: agentSaveStatus,
        });
        configurationAgentStates.at(-1).originalKey = {
          runtimeEpoch: original.receipt.runtimeEpoch,
          operationId: original.receipt.operationId,
        };
        if (name === "confirmed")
          configurationAgentStates.at(-1).snapshotFloorThenExplicitRead = true;
        if (name === "saveunknown") {
          const before = await agentMetrics();
          await page.reload();
          await openAgentPanel();
          await expect(agentText).toHaveValue("");
          await expect(agentSource).toHaveValue("");
          assert.deepEqual(await agentMetrics(), before);
          configurationAgentStates.at(-1).noPayloadRestoreOrReplayAfterReload =
            true;
        }
      }
      for (const name of AGENT_RUNTIME_UI_STATES) {
        const scope = await openAgentCase(name, true);
        if (["restartuntrusted", "restoredoldkey"].includes(name)) {
          await expect(agentObserve).toBeDisabled();
          if (name === "restartuntrusted") {
            await expect(
              agentRuntime.locator("[data-agent-runtime-trust]"),
            ).toContainText("새 세션");
            await expect(
              agentRuntime.locator("[data-agent-runtime-trust]"),
            ).toContainText("새 대화도 생성됩니다");
          } else await agentOriginalLookup(AGENT_RUNTIME_RETAINED_KEY);
          await captureAgent(name, { runtime: true, narrow: true });
          continue;
        }
        await listSelectAgent(scope);
        await readAgent();
        await agentValidate.click();
        assert.equal((await agentMetrics()).runtimeReads, 0);
        await expect(agentRegister).toBeDisabled();
        if (name === "notobserved") {
          await captureAgent(name, { runtime: true, narrow: true });
          continue;
        }
        await agentKeyboard(agentObserve);
        if (["unavailable", "references-unavailable"].includes(name)) {
          await expect(agentRuntimeStatus).toContainText(
            name === "unavailable" ? "runtime_error" : "references_unverified",
          );
          await expect(agentRegister).toBeDisabled();
          await expect(
            agentRuntime.locator("[data-agent-runtime-remove]"),
          ).toHaveCount(0);
          await captureAgent(name, { runtime: true });
          continue;
        }
        await expect(agentRuntimeStatus).toHaveText(
          "현재 Native 상태를 확인했습니다.",
        );
        if (["currentregistered", "globalforeigninuse"].includes(name)) {
          await expect(agentRow(scope.nativeId)).toBeVisible();
          await expect(agentRegister).toBeDisabled();
          await expect(
            agentRuntime.locator("[data-agent-runtime-default]"),
          ).toContainText("fixture-agent");
          await expect(
            agentRuntime.locator("[data-agent-runtime-policy]"),
          ).toHaveText("* / * / ask\nexternal_directory / * / deny");
          await expect(
            agentRuntime.locator("[data-agent-runtime-request]"),
          ).toContainText("model override 없음");
          if (name === "globalforeigninuse") {
            await expect(agentRemove(scope.nativeId)).toBeDisabled();
            await expect(
              agentRuntime.locator("[data-agent-runtime-references]"),
            ).toHaveAttribute("data-agent-runtime-references", "2");
            await expect(agentRuntime).toContainText("archived 세션과");
          } else await expect(agentRemove(scope.nativeId)).toBeEnabled();
          await captureAgent(name, { runtime: true, narrow: true });
          continue;
        }
        if (["unowned", "historicalreceipt"].includes(name)) {
          await expect(
            agentRuntime.locator("[data-agent-runtime-unowned]"),
          ).toContainText(scope.nativeId);
          await expect(
            agentRuntime.locator("[data-agent-runtime-unowned]"),
          ).toContainText("읽기 전용");
          await expect(
            agentRuntime.locator("[data-agent-runtime-remove]"),
          ).toHaveCount(0);
          if (name === "historicalreceipt") {
            const receipt = await page.evaluate(
              ({ epoch, key }) =>
                window.desktopBridge.workbench({
                  version: 2,
                  runtimeEpoch: epoch,
                  readId: "agent-historical-explicit-lookup",
                  operation: {
                    type: "operation.lookup",
                    runtimeEpoch: key.runtimeEpoch,
                    operationId: key.operationId,
                  },
                }),
              {
                epoch: await application.evaluate(
                  () => globalThis.__omocUiFixture.snapshot.runtimeEpoch,
                ),
                key: AGENT_RUNTIME_RETAINED_KEY,
              },
            );
            assert.equal(receipt.value.receipt.effect, "confirmed");
            assert.equal(
              receipt.value.receipt.runtimeEpoch,
              AGENT_RUNTIME_RETAINED_KEY.runtimeEpoch,
            );
            assert.equal("system" in receipt.value.receipt.result, false);
            const before = await agentMetrics();
            await page.reload();
            await openAgentPanel();
            await expect(agentText).toHaveValue("");
            await expect(agentRegister).toBeDisabled();
            await expect(
              agentRuntime.locator("[data-agent-runtime-row]"),
            ).toHaveCount(0);
            assert.deepEqual(await agentMetrics(), before);
          }
          await captureAgent(name, { runtime: true, narrow: true });
          continue;
        }
        await expect(agentRegister).toBeEnabled();
        const beforeRegister = await agentMetrics();
        await agentKeyboard(agentRegister);
        if (name === "pending") {
          await expect(agentAction).toHaveAttribute(
            "data-agent-runtime-action",
            "pending",
          );
          await heldAgentDraft(textareaValue(scope.text));
          await captureAgent("pending-before-ack", {
            runtime: true,
            narrow: true,
          });
          await application.evaluate(() =>
            globalThis.__omocUiFixture.releaseAgentRuntime(),
          );
        }
        await expect(agentAction).toHaveAttribute(
          "data-agent-runtime-action",
          name === "confirmationcancel"
            ? "denied"
            : name === "unknownheld"
              ? "unknown"
              : "registered_primary",
        );
        const original = await agentOriginal("configuration.agent.register");
        assert.equal(original.receipt.sessionId, undefined);
        assert.equal(original.disk, scope.text);
        assert.equal((await agentMetrics()).reads, beforeRegister.reads);
        assert.equal(
          (await agentMetrics()).runtimeReads,
          beforeRegister.runtimeReads,
        );
        if (name === "confirmationcancel") {
          assert.equal(original.receipt.result.code, "CANCELLED");
          assert.equal(original.effects.length, 0);
        } else if (name === "unknownheld") {
          await heldAgentDraft(textareaValue(scope.text));
          await agentOriginalLookup(original.receipt);
          assert.equal(original.receipt.result, undefined);
          assert.equal(original.effects.length, 1);
        } else {
          assert.equal(original.receipt.result.kind, "agent_registered");
          assert.equal(original.intent.step, "native.agent.register");
          assert.equal(original.receipt.result.defaultAgentId, "fixture-agent");
          await expect(agentRegister).toBeDisabled();
          await agentFloor(original.receipt);
          await agentKeyboard(agentObserve);
          await expect(agentRuntimeStatus).toHaveText(
            "현재 Native 상태를 확인했습니다.",
          );
          await expect(
            agentRow(original.receipt.result.nativeId),
          ).toBeVisible();
          if (name === "removed") {
            // Capture full registered disclosure before the explicit remove action.
            await captureAgent("registered-before-remove", {
              runtime: true,
              narrow: true,
            });
            await agentKeyboard(agentRemove(original.receipt.result.nativeId));
            await expect(agentAction).toHaveAttribute(
              "data-agent-runtime-action",
              "removed",
            );
            const removed = await agentOriginal("configuration.agent.remove");
            assert.equal(removed.intent.step, "native.agent.remove");
            assert.equal(removed.disk, scope.text);
            assert.equal(
              removed.receipt.result.defaultAgentId,
              "fixture-agent",
            );
            await agentFloor(removed.receipt);
            await agentKeyboard(agentObserve);
            await expect(agentRuntimeStatus).toHaveText(
              "현재 Native 상태를 확인했습니다.",
            );
            await expect(
              agentRuntime.locator("[data-agent-runtime-row]"),
            ).toHaveCount(0);
          }
        }
        await captureAgent(name, {
          runtime: true,
          narrow: ["unknownheld", "removed"].includes(name),
        });
        if (name === "unknownheld") {
          const before = await agentMetrics();
          await page.reload();
          await openAgentPanel();
          await expect(agentText).toHaveValue("");
          await expect(agentRegister).toBeDisabled();
          assert.deepEqual(await agentMetrics(), before);
          configurationAgentRuntimeStates.at(
            -1,
          ).noPayloadRestoreOrReplayAfterReload = true;
        }
      }
      const cancelledAgentScope = await openAgentCase("notobserved", true);
      await listSelectAgent(cancelledAgentScope);
      await readAgent();
      await application.evaluate(() => {
        globalThis.__omocUiFixture.holdAgentRuntimeReads = true;
      });
      await agentKeyboard(agentObserve);
      const agentCancel = agentRuntime.locator("[data-agent-runtime-cancel]");
      await expect(agentCancel).toBeVisible();
      await agentKeyboard(agentCancel);
      await expect(agentCancel).toHaveCount(0);
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseAgentRuntimeReads(),
      );
      await expect(agentRuntimeStatus).not.toHaveText(
        "현재 Native 상태를 확인했습니다.",
      );
      await expect(
        agentRuntime.locator("[data-agent-runtime-row]"),
      ).toHaveCount(0);
      await expect(agentRegister).toBeDisabled();
      await captureAgent("latecancel", { runtime: true, narrow: true });
      await page.keyboard.press("Escape");
      await expect(draftDialog).toBeHidden();
      configurationAgentRuntimeStates.at(-1).keyboardEscape = true;
    },
    extensions: async () => {
      // Append to the complete legacy matrix. Every case reloads the actual built
      // renderer/window store. Seeding only producer conditions is not UI evidence.
      const extensionPanel = page.locator(
        'section[aria-label="Native 확장 상태"][data-configuration-extensions="true"]',
      );
      const extensionObserve = extensionPanel.locator(
        '[data-extensions-observe="true"]',
      );
      const extensionCancel = extensionPanel.locator(
        '[data-extensions-cancel="true"]',
      );
      const extensionStatus = extensionPanel.locator(
        'p[role="status"][data-extensions-status]',
      );
      const extensionGroup = (group) =>
        extensionPanel.locator(`[data-extensions-group="${group}"]`);
      const extensionMetrics = () =>
        application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            reads: f.extensionReads.length,
            mutations: globalThis.__omocUiMutationMetrics(),
            effects: f.requests.length,
            receipts: [...f.retainedReceipts.values()].map(
              ({ receipt }) => receipt,
            ),
          };
        });
      async function openExtensionsPanel() {
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await page
          .getByRole("button", { name: "확장·명령", exact: true })
          .click();
        await expect(extensionPanel).toBeVisible();
        await expect(extensionObserve).toHaveText("확장 상태 확인");
        await expect(extensionCancel).toHaveText("조회 취소");
      }
      async function openExtensionCase(name) {
        assert.ok(EXTENSIONS_UI_STATES.includes(name));
        currentState = `Native extensions ${name}`;
        await setDisplay(page, 1440, 960, 1);
        const scope = await application.evaluate(
          (_electron, name) =>
            globalThis.__omocUiFixture.setConfigurationState(
              `extensions-${name}`,
            ),
          name,
        );
        const before = await extensionMetrics();
        assert.equal(before.reads, 0);
        assert.equal(before.effects, 0);
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute(
          "data-connection",
          name === "disconnected" ? "disconnected" : "connected",
        );
        await openExtensionsPanel();
        await expect(extensionCancel).toBeDisabled();
        await expect(
          extensionPanel.locator(
            "[data-extension-plugin], [data-extension-tool]",
          ),
        ).toHaveCount(0);
        assert.deepEqual(
          await extensionMetrics(),
          before,
          "Reload and catalog opening must not observe or mutate",
        );
        return { scope, before };
      }
      async function observeExtensions(expected) {
        await expect(extensionObserve).toBeEnabled();
        const before = await extensionMetrics();
        await extensionObserve.focus();
        await expect(extensionObserve).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          expected,
        );
        const after = await extensionMetrics();
        assert.equal(after.reads, before.reads + 1);
        assert.deepEqual(
          { ...after, reads: before.reads },
          before,
          "Explicit read cannot create effects or receipts",
        );
      }
      async function captureExtensions(name, { narrow = false } = {}) {
        const before = await extensionMetrics();
        if (narrow) await setDisplay(page, 760, 1000, 2);
        await expect(extensionPanel).toBeVisible();
        assert.equal(
          await extensionPanel.evaluate(
            (e) => e.scrollWidth <= e.clientWidth + 1,
          ),
          true,
        );
        for (const control of [extensionObserve, extensionCancel]) {
          if (await control.isEnabled()) {
            await control.focus();
            await expect(control).toBeFocused();
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(control).toBeFocused();
          }
          const box = await control.boundingBox();
          assert.ok(box.height >= 32);
        }
        const hooks = extensionGroup("hooks");
        await expect(hooks).toHaveAttribute("aria-label", "Hooks");
        await expect(hooks).toContainText("hook 목록 확인 불가");
        await expect(hooks).toContainText(
          "hook이 없거나 비활성이라는 뜻은 아닙니다.",
        );
        await expect(extensionGroup("plugins")).toHaveAttribute(
          "aria-label",
          "Plugin",
        );
        await expect(extensionGroup("tools")).toHaveAttribute(
          "aria-label",
          "Tools",
        );
        await expect(extensionPanel).toContainText(
          "Native에 등록됨은 도구의 사용 권한이나 실행 성공을 뜻하지 않습니다.",
        );
        await expect(extensionPanel.locator("button")).toHaveCount(2);
        const selected = [],
          frames = [];
        const parts = [
          ["status", extensionStatus],
          ["hooks", hooks],
        ];
        for (const group of ["plugins", "tools"]) {
          const section = extensionGroup(group);
          parts.push([`${group}-heading`, section.locator("h4")]);
          const rows = section.locator("li");
          if (!(await rows.count()))
            parts.push([`${group}-message`, section.locator("p").first()]);
          for (let i = 0; i < (await rows.count()); i++) {
            const paragraphs = rows.nth(i).locator("p");
            for (let p = 0; p < (await paragraphs.count()); p++) {
              const locator = paragraphs.nth(p);
              selected.push(await selectableAgent(locator));
              parts.push([`${group}-${i}-${p}`, locator]);
            }
          }
        }
        const trust = extensionPanel.locator(
          '[data-extensions-trust="untrusted"]',
        );
        if (await trust.count()) parts.push(["trust", trust]);
        for (const [part, locator] of parts)
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-configuration-extensions-${name}-${part}-synthetic.png`,
              currentState,
            ),
          );
        assert.deepEqual(
          await extensionMetrics(),
          before,
          "Resize, Tab, selection and refocus must not observe",
        );
        configurationExtensionStates.push({
          state: name,
          syntheticOnly: true,
          actualRendererPreload: true,
          visibleState: await extensionPanel.getAttribute(
            "data-extensions-state",
          ),
          blocked: await extensionPanel.getAttribute("data-extensions-blocked"),
          metrics: before,
          selectableFullText: selected,
          selectionOnlyClipboardNotInspected: true,
          keyboardForwardBackward: true,
          ...(narrow && {
            contentWidth: 760,
            zoomFactor: 2,
            horizontalOverflow: false,
          }),
          frames,
        });
      }

      await openExtensionCase("not-observed");
      await expect(extensionPanel).toHaveAttribute(
        "data-extensions-state",
        "not_observed",
      );
      await expect(extensionStatus).toHaveText(
        "아직 조회하지 않았습니다. 확장 상태 확인을 선택하세요.",
      );
      await expect(extensionObserve).toBeEnabled();
      await captureExtensions("not-observed-desktop");
      await captureExtensions("not-observed-narrow200", { narrow: true });

      for (const [name, expected] of [
        ["populated", "available"],
        ["empty", "available"],
        ["plugins-unavailable", "partial"],
        ["tools-unavailable", "partial"],
        ["unavailable", "unavailable"],
        ["invalid-response", "unavailable"],
        ["limit-reached", "unavailable"],
        ["unsupported-source", "available"],
      ]) {
        const { scope } = await openExtensionCase(name);
        await observeExtensions(expected);
        const plugins = extensionGroup("plugins"),
          tools = extensionGroup("tools");
        if (["populated", "unsupported-source"].includes(name)) {
          await expect(plugins.locator("[data-extension-plugin]")).toHaveCount(
            4,
          );
          await expect(plugins).toContainText("Native 활성");
          await expect(plugins).toContainText("Native 실패");
          await expect(tools.locator("[data-extension-tool]")).toHaveCount(1);
          await expect(tools).toContainText("Native에 등록됨");
          if (name === "populated")
            await expect(plugins).toContainText(scope.pluginPath);
          else {
            await expect(plugins).toContainText(
              "지원하지 않는 출처 형식입니다. 원본은 표시하지 않습니다.",
            );
            await expect(plugins).not.toContainText("https://");
          }
          await expect(extensionPanel).not.toContainText("SYNTHETIC_PRIVATE");
        } else if (name === "empty") {
          await expect(plugins).toContainText(
            "확인한 Native Plugin 목록에 항목이 없습니다.",
          );
          await expect(tools).toContainText(
            "확인한 Native Tools 목록에 항목이 없습니다.",
          );
        } else {
          for (const [group, failed] of [
            [plugins, name !== "tools-unavailable"],
            [tools, name !== "plugins-unavailable"],
          ])
            if (failed) {
              await expect(group.locator("li")).toHaveCount(0);
              await expect(group).not.toContainText("목록에 항목이 없습니다.");
              await expect(group).toContainText(
                name === "invalid-response"
                  ? "응답 형식을 확인하지 못했습니다. 빈 목록으로 표시하지 않습니다."
                  : name === "limit-reached"
                    ? "목록 확인 한도에 도달했습니다. 일부만 잘라서 표시하지 않습니다."
                    : "Native 정보를 확인할 수 없습니다.",
              );
            }
        }
        if (name === "populated") await captureExtensions("populated-desktop");
        await captureExtensions(`${name}-narrow200`, { narrow: true });
      }

      for (const name of ["pending", "cancel", "escape"]) {
        await openExtensionCase(name);
        await observeExtensions("checking");
        await expect(extensionCancel).toBeEnabled();
        await expect(extensionObserve).toBeDisabled();
        if (name === "pending") {
          await captureExtensions("pending-narrow200", { narrow: true });
          await application.evaluate(() =>
            globalThis.__omocUiFixture.releaseExtensionReads(),
          );
          await expect(extensionPanel).toHaveAttribute(
            "data-extensions-state",
            "available",
          );
          await captureExtensions("pending-completed");
          continue;
        }
        await extensionCancel.focus();
        await page.keyboard.press(name === "escape" ? "Escape" : "Enter");
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          "cancelled",
        );
        await expect(extensionStatus).toBeFocused();
        await expect(extensionPanel).toBeVisible();
        await application.evaluate(() =>
          globalThis.__omocUiFixture.releaseExtensionReads(),
        );
        await expect(
          extensionPanel.locator(
            "[data-extension-plugin], [data-extension-tool]",
          ),
        ).toHaveCount(0);
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          "cancelled",
        );
        await captureExtensions(`${name}-late-response-narrow200`, {
          narrow: true,
        });
        configurationExtensionStates.at(-1).lateSuccessSuppressed = true;
        configurationExtensionStates.at(-1).escapeCancelsAndFocusesStatus =
          name === "escape";
      }

      for (const name of ["late-workspace", "late-epoch", "late-floor"]) {
        await openExtensionCase(name);
        await observeExtensions("checking");
        if (name === "late-workspace") {
          await selectWorkspace(page, "fixture-extensions-other-w");
          await expect(extensionPanel).toHaveAttribute(
            "data-extensions-state",
            "not_observed",
          );
          await selectWorkspace(page, "fixture-w");
        } else {
          await application.evaluate((_electron, name) => {
            const snapshot = globalThis.__omocUiFixture.snapshot;
            if (name === "late-epoch")
              snapshot.runtimeEpoch = "fixture-extensions-next-epoch";
            else snapshot.revision++;
          }, name);
        }
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          "stale",
        );
        await application.evaluate(() =>
          globalThis.__omocUiFixture.releaseExtensionReads(),
        );
        await expect(
          extensionPanel.locator(
            "[data-extension-plugin], [data-extension-tool]",
          ),
        ).toHaveCount(0);
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          "stale",
        );
        assert.equal((await extensionMetrics()).reads, 1);
        await captureExtensions(`${name}-narrow200`, { narrow: true });
        configurationExtensionStates.at(-1).lateSuccessSuppressed = true;
        await observeExtensions("available");
        const latest = await application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            envelope: f.extensionReads.at(-1),
            epoch: f.snapshot.runtimeEpoch,
          };
        });
        assert.equal(latest.envelope.runtimeEpoch, latest.epoch);
        await captureExtensions(`${name}-explicit-current`);
      }

      await openExtensionCase("stale");
      await observeExtensions("available");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.snapshot.revision++;
      });
      await expect(extensionPanel).toHaveAttribute(
        "data-extensions-state",
        "stale",
      );
      await expect(
        extensionPanel.locator(
          "[data-extension-plugin], [data-extension-tool]",
        ),
      ).toHaveCount(0);
      assert.equal((await extensionMetrics()).reads, 1);
      await captureExtensions("successful-history-stale-narrow200", {
        narrow: true,
      });

      for (const name of [
        "held",
        "untrusted",
        "disconnected",
        "snapshot-required",
      ]) {
        const { before } = await openExtensionCase(name);
        const state = name === "snapshot-required" ? "not_observed" : name;
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-state",
          state,
        );
        await expect(extensionPanel).toHaveAttribute(
          "data-extensions-blocked",
          name === "snapshot-required" ? "snapshot_required" : name,
        );
        await expect(extensionObserve).toBeDisabled();
        if (name === "untrusted") {
          const trust = extensionPanel.locator(
            '[data-extensions-trust="untrusted"]',
          );
          await expect(trust).toContainText("새 세션");
          await expect(trust).toContainText("이 작업은 새 세션을 추가합니다.");
        }
        await captureExtensions(`${name}-narrow200`, { narrow: true });
        if (name === "held") {
          assert.equal(before.receipts.length, 1);
          assert.equal(
            before.receipts[0].runtimeEpoch,
            P7_RETAINED_KEY.runtimeEpoch,
          );
          assert.equal(
            before.receipts[0].operationId,
            P7_RETAINED_KEY.operationId,
          );
          await expect
            .poll(() =>
              application.evaluate(() => {
                const f = globalThis.__omocUiFixture;
                return f.lookupEnvelopes.some(
                  (e) =>
                    e.runtimeEpoch === f.snapshot.runtimeEpoch &&
                    e.operation.runtimeEpoch === "fixture-original-epoch" &&
                    e.operation.operationId === "fixture-original-send",
                );
              }),
            )
            .toBe(true);
          await page.reload();
          await openExtensionsPanel();
          await expect(extensionPanel).toHaveAttribute(
            "data-extensions-state",
            "held",
          );
          await expect(extensionObserve).toBeDisabled();
          assert.deepEqual(await extensionMetrics(), before);
          await captureExtensions("held-reload-original-key-narrow200", {
            narrow: true,
          });
          configurationExtensionStates.at(-1).originalKey = P7_RETAINED_KEY;
          configurationExtensionStates.at(-1).noReplayOrHoldClearing = true;
        }
        assert.deepEqual(await extensionMetrics(), before);
      }
    },
    "workspace-files": async () => {
      let workspaceScope = await openWorkspaceCase("ready");
      await captureWorkspace("not-opened-desktop", { narrow: false });
      await explicitWorkspaceRead();
      await expect(workspaceText).toHaveValue(
        workspaceScope.text.replace(/\r\n/g, "\n"),
      );
      await captureWorkspace("exact-bom-crlf-desktop", { narrow: false });
      await captureWorkspace("exact-bom-crlf-narrow200");
      const workspaceEdited =
        "\uFEFFSYNTHETIC KEYBOARD EDIT\n\nTrailing spaces.  \n";
      await editWorkspace(workspaceEdited);
      await expect(workspaceSave).toBeEnabled();
      await workspaceSave.focus();
      await page.keyboard.press("Enter");
      await expect(workspaceStatus).toHaveAttribute(
        "data-workspace-file-state",
        "saved",
      );
      await expect(workspaceText).toHaveValue(workspaceEdited);
      await expect(workspaceSave).toBeDisabled();
      const workspaceSaved = await application.evaluate((_electron, scope) => {
        const f = globalThis.__omocUiFixture,
          receipt = [...f.retainedReceipts.values()].find(
            ({ receipt }) => receipt.type === "file.save",
          ).receipt;
        return {
          text: f.workspaceFiles.get(
            f.workspaceFileKey(scope.workspaceId, scope.path),
          ),
          backup: f.workspaceFileBackups.get(receipt.result.backupId),
          receipt,
          reads: f.workspaceFileReads.length,
        };
      }, workspaceScope);
      assert.equal(workspaceSaved.text, workspaceEdited.replace(/\n/g, "\r\n"));
      assert.equal(workspaceSaved.backup, workspaceScope.text);
      assert.equal(workspaceSaved.reads, 1);
      await captureWorkspace("confirmed-narrow200");
      await expect(workspaceOpen).toBeEnabled(); // Requires an accepted post-receipt snapshot.
      await explicitWorkspaceRead();
      await expect(workspaceText).toHaveValue(workspaceEdited);
      assert.equal((await workspaceMetrics()).effects, 1);
      await captureWorkspace("explicit-reread-narrow200");

      for (const name of [
        "blank",
        "limit",
        "missing",
        "denied",
        "unsupported",
        "oversize",
        "protected",
      ]) {
        workspaceScope = await openWorkspaceCase(name);
        if (name === "protected") {
          await expect(workspaceOpen).toBeDisabled();
          await expect(workspaceEditor).toContainText("전용 편집기");
        } else {
          await explicitWorkspaceRead(
            name === "denied"
              ? "denied"
              : ["missing", "unsupported", "oversize"].includes(name)
                ? "unavailable"
                : "ready",
          );
          if (["blank", "limit"].includes(name)) {
            await expect(workspaceText).toHaveValue(workspaceScope.text);
            await expect(
              workspaceEditor.locator('[data-workspace-file-bytes="true"]'),
            ).toContainText(name === "blank" ? "UTF-8 0" : "65,536 / 65,536");
          }
        }
        await expect(workspaceSave).toBeDisabled();
        await captureWorkspace(`${name}-narrow200`);
      }

      await openWorkspaceCase("pending-read");
      await explicitWorkspaceRead("loading");
      await workspaceText.focus();
      await page.keyboard.press("Escape");
      await expect(workspaceStatus).toBeFocused();
      await expect(workspaceStatus).toHaveAttribute(
        "data-workspace-file-state",
        "ready",
      );
      await expect(workspaceStatus).toContainText("취소");
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseWorkspaceFileReads(),
      );
      await expect(workspaceText).toHaveValue("");
      await expect(workspaceSave).toBeDisabled();
      await captureWorkspace("escape-cancel-late-read-narrow200");

      for (const name of [
        "external-changed",
        "save-denied",
        "unknown",
        "pending-save",
      ]) {
        workspaceScope = await openWorkspaceCase(name);
        await explicitWorkspaceRead();
        await editWorkspace("SYNTHETIC FIRST SAVE\n");
        await workspaceSave.focus();
        await page.keyboard.press("Enter");
        await expect(workspaceStatus).toHaveAttribute(
          "data-workspace-file-state",
          name === "external-changed"
            ? "changed"
            : name === "save-denied"
              ? "denied"
              : name === "pending-save"
                ? "loading"
                : "unknown",
        );
        await workspaceText.focus();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.insertText("SYNTHETIC NEWER RETAINED DRAFT\n");
        await expect(workspaceText).toHaveValue(
          "SYNTHETIC NEWER RETAINED DRAFT\n",
        );
        await expect(workspaceSave).toBeDisabled();
        await captureWorkspace(`${name}-retained-narrow200`);
        if (name === "unknown") {
          const original = (await workspaceMetrics()).receipts.find(
            (r) => r.type === "file.save",
          );
          await expect
            .poll(() =>
              application.evaluate((_electron, original) => {
                const f = globalThis.__omocUiFixture;
                return f.lookupEnvelopes.some(
                  (e) =>
                    e.runtimeEpoch === f.snapshot.runtimeEpoch &&
                    e.operation.runtimeEpoch === original.runtimeEpoch &&
                    e.operation.operationId === original.operationId,
                );
              }, original),
            )
            .toBe(true);
          assert.equal((await workspaceMetrics()).effects, 1);
          await expect(workspaceOpen).toBeDisabled();
        }
        if (name === "pending-save") {
          // A new file gets an editor option only after selection through the explorer.
          await page
            .getByRole("region", { name: "파일 탐색 및 편집", exact: true })
            .getByTitle(workspaceScope.otherPath, { exact: true })
            .click();
          await workspaceText.fill("SYNTHETIC OTHER SELECTED DRAFT");
          await application.evaluate(() =>
            globalThis.__omocUiFixture.releaseWorkspaceFileSaves(),
          );
          await expect
            .poll(
              async () =>
                (await workspaceMetrics()).receipts.find(
                  (r) => r.type === "file.save",
                ).effect,
            )
            .toBe("confirmed");
          await expect(workspaceText).toHaveValue(
            "SYNTHETIC OTHER SELECTED DRAFT",
          );
          await workspaceSelect.selectOption(workspaceScope.path);
          await expect(workspaceText).toHaveValue(
            "SYNTHETIC NEWER RETAINED DRAFT\n",
          );
          await expect(workspaceStatus).toContainText(
            "더 최근에 수정한 초안은 유지됩니다",
          );
          await expect(workspaceSave).toBeDisabled();
          await captureWorkspace("late-ack-newer-draft-narrow200");
        }
      }

      for (const name of ["held", "untrusted", "restored-original"]) {
        workspaceScope = await openWorkspaceCase(name);
        await expect(workspaceOpen).toBeDisabled();
        await workspaceText.fill("SYNTHETIC HELD OR UNTRUSTED EDIT");
        await workspaceSelect.selectOption(workspaceScope.path);
        await expect(workspaceText).toHaveValue(
          "SYNTHETIC HELD OR UNTRUSTED EDIT",
        );
        await expect(workspaceSave).toBeDisabled();
        if (name === "untrusted") {
          const trust = workspaceEditor.locator(
            '[data-workspace-file-trust="untrusted"]',
          );
          await expect(trust).toContainText("새 세션");
          await expect(trust).toContainText("새 세션을 만듭니다");
        } else {
          await expect
            .poll(() =>
              application.evaluate((_electron, original) => {
                const f = globalThis.__omocUiFixture;
                return f.lookupEnvelopes.some(
                  (e) =>
                    e.runtimeEpoch === f.snapshot.runtimeEpoch &&
                    e.operation.runtimeEpoch === original.runtimeEpoch &&
                    e.operation.operationId === original.operationId,
                );
              }, WORKSPACE_FILE_RETAINED_KEY),
            )
            .toBe(true);
        }
        await captureWorkspace(`${name}-editable-narrow200`);
        assert.equal((await workspaceMetrics()).effects, 0);
        assert.equal((await workspaceMetrics()).reads, 0);
      }

      for (const boundary of ["epoch", "root", "trust", "hold"]) {
        workspaceScope = await openWorkspaceCase("ready");
        await explicitWorkspaceRead();
        await editWorkspace("SYNTHETIC BEFORE SCOPE CHANGE");
        await application.evaluate((_electron, boundary) => {
          const f = globalThis.__omocUiFixture,
            w = f.snapshot.workspaces[0];
          if (boundary === "epoch")
            f.snapshot.runtimeEpoch = "fixture-ui-file-retained-epoch";
          if (boundary === "root") w.path = "/synthetic/changed-file-root";
          if (boundary === "trust") {
            w.trusted = false;
            w.trustRevision++;
          }
          if (boundary === "hold")
            f.snapshot.recovery.resources = [
              {
                workspaceId: w.id,
                state: "unavailable",
                reason: "unresolved_operation",
              },
            ];
          f.snapshot.observationSequence++;
        }, boundary);
        if (["epoch", "root"].includes(boundary)) {
          const retained = workspaceSelect.locator('option[value^="draft:"]');
          await expect(retained).toHaveCount(1);
          await workspaceSelect.selectOption(
            await retained.getAttribute("value"),
          );
          await expect(
            workspaceEditor.locator('[data-workspace-file-retained="true"]'),
          ).toBeVisible();
          await expect(workspaceTarget).toHaveText(
            workspaceScope.workspacePath + "/" + workspaceScope.path,
          );
        } else await expect(workspaceOpen).toBeDisabled();
        await expect(workspaceText).toHaveValue(
          "SYNTHETIC BEFORE SCOPE CHANGE",
        );
        await workspaceText.fill("SYNTHETIC SELECTABLE RETAINED EDIT");
        await expect(workspaceOpen).toBeDisabled();
        await expect(workspaceSave).toBeDisabled();
        await captureWorkspace(`${boundary}-retained-draft-narrow200`);
        assert.equal((await workspaceMetrics()).reads, 1);
        assert.equal((await workspaceMetrics()).effects, 0);
      }
    },
    "git-review": async () => {
      // Append-only Git acceptance. All preceding evidence matrices/captures run first.
      // Production Renderer/preload consumes synthetic DTOs; this does not prove G2.
      const gitPanel = page.getByRole("region", {
        name: "Git 변경 검토",
        exact: true,
      });
      const gitRefresh = gitPanel.getByRole("button", {
        name: "Git 상태 새로고침",
        exact: true,
      });
      const gitCancel = gitPanel.getByRole("button", {
        name: "Git 상태 읽기 취소",
        exact: true,
      });
      const gitRead = gitPanel.getByRole("button", {
        name: "선택한 Git 차이 읽기",
        exact: true,
      });
      const gitCancelDiff = gitPanel.getByRole("button", {
        name: "Git 차이 읽기 취소",
        exact: true,
      });
      const gitPath = gitPanel.getByLabel("Git 비교 경로", { exact: true });
      const gitMode = gitPanel.getByLabel("Git 비교 방식", { exact: true });
      const gitBase = gitPanel.getByLabel("Git 기준 branch", { exact: true });
      const gitStatus = gitPanel.locator(
        ':scope > p[role=status][aria-live="polite"]',
      );
      const gitDetailRegion = gitPanel.locator("[data-git-diff-state]");
      const gitDetailStatus = gitDetailRegion.getByRole("status");
      const gitPatch = gitPanel.getByRole("region", {
        name: "Git patch",
        exact: true,
      });
      const gitMetrics = () =>
        application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            reads: f.gitReads.length,
            effects: f.requests.length,
            statusReads: f.gitReads.filter(
              (e) => e.operation.type === "git.review.read",
            ).length,
            diffReads: f.gitReads.filter(
              (e) => e.operation.type === "git.diff.read",
            ).length,
          };
        });
      async function openGitCase(name = "ready") {
        assert.ok(GIT_REVIEW_UI_STATES.includes(name));
        currentState = `Synthetic Git ${name}`;
        await setDisplay(page, 1440, 1000, 1);
        const scope = await application.evaluate(
          (_electron, name) => globalThis.__omocUiFixture.setGitState(name),
          name,
        );
        await page.reload();
        await expect(
          page.locator(".workbench-header [data-connection]"),
        ).toHaveAttribute("data-connection", "connected");
        await page
          .getByRole("button", { name: "파일·확장", exact: true })
          .click();
        await expect(gitPanel).toBeVisible();
        await page
          .getByRole("region", { name: "파일 탐색 및 편집", exact: true })
          .getByTitle(scope.path, { exact: true })
          .click();
        await expect(workspaceText).toBeEnabled();
        await expect(gitPanel).toHaveAttribute(
          "data-git-review-state",
          "empty",
        );
        await expect(gitBase).toHaveValue("");
        await expect(gitRead).toBeDisabled();
        assert.equal(
          (await gitMetrics()).reads,
          0,
          "Mount and explorer selection must never read Git",
        );
        return scope;
      }
      async function observeGitUi(expected = "available") {
        const before = await gitMetrics();
        await expect(gitRefresh).toBeEnabled();
        await gitRefresh.focus();
        await page.keyboard.press("Enter");
        await expect(gitPanel).toHaveAttribute(
          "data-git-review-state",
          expected,
        );
        await expect(gitStatus).toBeFocused();
        assert.equal((await gitMetrics()).statusReads, before.statusReads + 1);
      }
      async function selectGitUi(path, mode = "unstaged", baseRef) {
        const before = await gitMetrics();
        await gitPath.selectOption(path);
        await gitMode.selectOption(mode);
        if (mode === "base") {
          await expect(gitBase).toHaveValue("");
          await expect(gitRead).toBeDisabled();
          if (baseRef) await gitBase.selectOption(baseRef);
        }
        assert.deepEqual(
          await gitMetrics(),
          before,
          "Git selection alone is inert",
        );
      }
      async function readGitUi(expected = "available") {
        const before = await gitMetrics();
        await expect(gitRead).toBeEnabled();
        await gitRead.focus();
        await page.keyboard.press("Enter");
        await expect(gitDetailRegion).toHaveAttribute(
          "data-git-diff-state",
          expected,
        );
        await expect(gitDetailStatus).toBeFocused();
        assert.equal((await gitMetrics()).diffReads, before.diffReads + 1);
      }
      let gitCaptureSerial = 0;
      const gitThemeSurfaces = new Map();
      async function captureGitUi(
        name,
        { theme = "light", narrow = false } = {},
      ) {
        const before = await gitMetrics();
        await page.evaluate((theme) => {
          globalThis.document.documentElement.dataset.theme = theme;
        }, theme);
        await setDisplay(page, narrow ? 760 : 1440, 1000, narrow ? 2 : 1);
        await expect(gitPanel).toBeVisible();
        const appliedTheme = await gitPanel.evaluate((e) => ({
          attribute: e.ownerDocument.documentElement.dataset.theme,
          surface: globalThis.getComputedStyle(e).backgroundColor,
        }));
        assert.equal(appliedTheme.attribute, theme);
        gitThemeSurfaces.set(theme, appliedTheme.surface);
        if (gitThemeSurfaces.has("light") && gitThemeSurfaces.has("dark"))
          assert.notEqual(
            gitThemeSurfaces.get("light"),
            gitThemeSurfaces.get("dark"),
            "Theme evidence requires distinct resolved surfaces",
          );
        assert.equal(
          await gitPanel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
        const selectableMetadata = [];
        for (const dd of await gitPanel.locator("dl dd").all()) {
          selectableMetadata.push({
            text: await dd.textContent(),
            selection: await selectableAgent(dd),
          });
        }
        const controls = [
          gitRefresh,
          gitCancel,
          gitPath,
          gitMode,
          gitBase,
          gitRead,
          gitCancelDiff,
          ...(await gitPanel
            .getByRole("button", { name: /^(Staged|Unstaged) 차이 선택:/u })
            .all()),
        ];
        for (const control of controls)
          if (await control.isEnabled()) {
            await control.scrollIntoViewIfNeeded();
            await control.focus();
            await expect(control).toBeFocused();
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(control).toBeFocused();
          }
        // Capture small fully visible elements, with an exclusive unique PNG per part.
        const parts = [
          ["status", gitStatus],
          ["detail-status", gitDetailStatus],
          ["refresh", gitRefresh],
          ["read", gitRead],
        ];
        if (name.includes("loading"))
          parts.push(
            ["cancel-status", gitCancel],
            ["cancel-diff", gitCancelDiff],
          );
        if (["staged", "unstaged", "diverged-base"].includes(name))
          parts.push(["path", gitPath], ["mode", gitMode], ["base", gitBase]);
        if (await gitPatch.count()) {
          assert.equal(
            await gitPatch.locator("script,img,a,input,button,iframe").count(),
            0,
          );
          parts.push(["patch", gitPatch]);
        }
        let ddIndex = 0;
        if (
          [
            "staged",
            "unstaged",
            "diverged-base",
            "expired-original-base-oid",
          ].includes(name)
        )
          for (const dd of await gitPanel.locator("dl dd").all())
            parts.push([`metadata-${++ddIndex}`, dd]);
        const frames = [],
          serial = ++gitCaptureSerial;
        for (const [part, locator] of parts)
          frames.push(
            await captureSaveElement(
              locator,
              `desktop-git-review-${serial}-${name}-${theme}-${narrow ? "760px200" : "desktop"}-${part}-synthetic.png`,
              currentState,
            ),
          );
        assert.deepEqual(
          await gitMetrics(),
          before,
          "Theme, resize, refocus, selection and keyboard do not query Git",
        );
        gitReviewStates.push({
          state: name,
          syntheticOnly: true,
          actualGitG2: "not established",
          actualRendererPreload: true,
          theme,
          appliedTheme,
          layout: narrow ? "760px200%" : "desktop",
          selectableMetadata,
          keyboardForwardBackward: true,
          status: await gitPanel.getAttribute("data-git-review-state"),
          detail: await gitDetailRegion.getAttribute("data-git-diff-state"),
          metrics: before,
          frames,
        });
      }

      let gitScopeUi = await openGitCase();
      // Wait for a real poll and dispatch refocus; neither may start Git IO.
      const gitBeforeMount = await gitMetrics();
      const initialSequence = await application.evaluate(
        () => globalThis.__omocUiFixture.snapshot.observationSequence,
      );
      await expect
        .poll(() =>
          application.evaluate(
            () => globalThis.__omocUiFixture.snapshot.observationSequence,
          ),
        )
        .toBeGreaterThan(initialSequence);
      await page.evaluate(() =>
        window.dispatchEvent(new globalThis.Event("focus")),
      );
      await setDisplay(page, 760, 1000, 2);
      assert.deepEqual(await gitMetrics(), gitBeforeMount);
      await observeGitUi();
      await expect(
        gitPanel.getByRole("region", { name: "Staged 변경 목록", exact: true }),
      ).toContainText("notes/SYNTHETIC-editor.txt");
      await expect(
        gitPanel.getByRole("region", {
          name: "Unstaged 변경 목록",
          exact: true,
        }),
      ).toContainText("notes/SYNTHETIC-editor.txt");
      for (const label of ["Staged", "Unstaged"]) {
        const row = gitPanel.getByRole("button", {
          name: `${label} 차이 선택: ${gitScopeUi.path}`,
          exact: true,
        });
        const before = await gitMetrics();
        await row.focus();
        await page.keyboard.press("Enter");
        await expect(row).toHaveAttribute("aria-pressed", "true");
        await expect(gitMode).toHaveValue(label.toLowerCase());
        assert.deepEqual(await gitMetrics(), before);
        await readGitUi();
        await expect(gitPatch).toContainText(
          label === "Staged" ? "-SYNTHETIC HEAD" : "-SYNTHETIC INDEX",
        );
        for (const theme of ["light", "dark"])
          for (const narrow of [false, true])
            await captureGitUi(label.toLowerCase(), { theme, narrow });
      }
      await expect(gitPatch).toContainText(
        "<script>SYNTHETIC INERT TEXT</script>",
      );
      assert.equal(
        await gitPatch.locator("*").count(),
        0,
        "Patch is plaintext, with no HTML controls",
      );
      for (const name of [
        "Stage",
        "Unstage",
        "Commit",
        "Restore",
        "Checkout",
        "커밋",
        "복원",
      ])
        assert.equal(
          await gitPanel.getByRole("button", { name, exact: true }).count(),
          0,
        );

      for (const [name, path, mode, reason] of [
        [
          "untracked",
          "notes/SYNTHETIC-untracked.txt",
          "staged",
          "Untracked 파일은 staged 차이가 없습니다",
        ],
        [
          "conflict",
          "notes/SYNTHETIC-conflict.txt",
          "unstaged",
          "충돌한 파일입니다",
        ],
        [
          "protected",
          "AGENTS.md",
          "unstaged",
          "보호된 파일의 내용은 표시하지 않습니다",
        ],
        ["binary", "assets/SYNTHETIC-binary.bin", "unstaged", "Binary"],
        [
          "expired",
          "notes/SYNTHETIC-editor.txt",
          "unstaged",
          "관찰이 만료됐습니다",
        ],
        [
          "stale",
          "notes/SYNTHETIC-editor.txt",
          "unstaged",
          "관찰한 내용이 변경됐습니다",
        ],
      ]) {
        await openGitCase(name);
        await observeGitUi();
        await selectGitUi(path, mode);
        await readGitUi(
          ["expired", "stale"].includes(name) ? "stale" : "unavailable",
        );
        await expect(gitDetailStatus).toContainText(reason);
        await expect(gitPatch).toHaveCount(0);
        await captureGitUi(`${name}-refusal`, { narrow: true, theme: "dark" });
        if (name === "untracked") {
          await gitMode.selectOption("unstaged");
          await readGitUi();
          await expect(gitPatch).toContainText("--- /dev/null");
          await captureGitUi("untracked-unstaged", { narrow: true });
        }
      }
      for (const [name, message] of [
        ["unsupported", "저장소 형식은 지원하지 않습니다"],
        ["configuration", "설정 또는 변환 규칙은 지원하지 않습니다"],
        ["unavailable", "Git 실행 파일을 사용할 수 없습니다"],
      ]) {
        await openGitCase(name);
        await observeGitUi("unavailable");
        await expect(gitStatus).toContainText(message);
        await expect(gitRead).toBeDisabled();
        await captureGitUi(name, { narrow: true });
      }
      for (const name of ["clean", "unborn", "detached"]) {
        gitScopeUi = await openGitCase(name);
        await observeGitUi();
        if (name === "clean")
          await expect(gitPanel).toContainText(
            "관찰한 staged·unstaged 변경이 없습니다",
          );
        else {
          await expect(gitPanel).toContainText(
            name === "unborn" ? "Unborn · 아직 commit 없음" : "Detached HEAD",
          );
          await selectGitUi(gitScopeUi.path, "staged");
          await readGitUi();
        }
        await captureGitUi(name, { narrow: true, theme: "dark" });
      }
      for (const name of [
        "diverged-base",
        "base-only-equal",
        "base-only-different",
      ]) {
        gitScopeUi = await openGitCase(name);
        await observeGitUi();
        await selectGitUi(gitScopeUi.path, "base", "review/diverged-local-tip");
        await readGitUi();
        const originalOid = "2".repeat(40);
        await expect(
          gitPanel
            .getByRole("definition")
            .filter({ hasText: originalOid })
            .first(),
        ).toContainText(originalOid);
        await expect(gitPanel).toContainText("Merge-base를 계산하지 않습니다");
        await expect(gitPatch).toContainText(
          name === "base-only-equal"
            ? "이 비교에서 텍스트 차이 없음"
            : "-SYNTHETIC DIVERGED LOCAL TIP",
        );
        await captureGitUi(name, { narrow: true });
        if (name === "diverged-base") {
          await application.evaluate(() => {
            globalThis.__omocUiFixture.gitState = "expired";
          });
          await readGitUi("stale");
          await expect(gitDetailRegion).toContainText(originalOid);
          await expect(gitDetailStatus).toContainText("관찰이 만료됐습니다");
          await captureGitUi("expired-original-base-oid", {
            narrow: true,
            theme: "dark",
          });
        }
      }

      for (const lane of ["status", "diff"]) {
        gitScopeUi = await openGitCase(
          lane === "status" ? "pending-status" : "pending-diff",
        );
        if (lane === "diff") {
          await observeGitUi();
          await selectGitUi(gitScopeUi.path);
        }
        const trigger = lane === "status" ? gitRefresh : gitRead,
          cancel = lane === "status" ? gitCancel : gitCancelDiff;
        const surface = lane === "status" ? gitPanel : gitDetailRegion,
          attribute =
            lane === "status" ? "data-git-review-state" : "data-git-diff-state";
        const status = lane === "status" ? gitStatus : gitDetailStatus;
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(surface).toHaveAttribute(attribute, "loading");
        await expect(cancel).toBeEnabled();
        await captureGitUi(`${lane}-loading`, { narrow: true, theme: "dark" });
        await cancel.focus();
        await page.keyboard.press("Enter");
        await expect(status).toBeFocused();
        await expect(status).toContainText("읽기를 취소했습니다");
        const beforeRelease = await gitMetrics();
        await application.evaluate(() =>
          globalThis.__omocUiFixture.releaseGitReads(),
        );
        await expect(surface).toHaveAttribute(
          attribute,
          lane === "status" ? "stale" : "error",
        );
        await captureGitUi(`${lane}-cancel-late-inert`, { narrow: true });
        assert.deepEqual(await gitMetrics(), beforeRelease);
      }
      for (const lane of ["status", "diff"]) {
        gitScopeUi = await openGitCase(
          lane === "status" ? "busy-status" : "busy-diff",
        );
        if (lane === "diff") {
          await observeGitUi();
          await selectGitUi(gitScopeUi.path);
        }
        const trigger = lane === "status" ? gitRefresh : gitRead,
          status = lane === "status" ? gitStatus : gitDetailStatus;
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(status).toContainText("다른 읽기가 진행 중입니다");
        await expect(status).toBeFocused();
        const busyMetrics = await gitMetrics();
        await application.evaluate(() =>
          globalThis.__omocUiFixture.gitBusy.clear(),
        );
        await expect(trigger).toBeEnabled();
        assert.deepEqual(
          await gitMetrics(),
          busyMetrics,
          "READ_BUSY readiness must never auto-retry",
        );
        await captureGitUi(`${lane}-read-busy-ready`, { narrow: true });
        if (lane === "status") await observeGitUi();
        else await readGitUi();
      }

      // Real selection actions retire old detail, including path/mode/base ABA.
      for (const field of ["path", "mode", "base"]) {
        gitScopeUi = await openGitCase("pending-diff");
        await observeGitUi();
        await selectGitUi(
          gitScopeUi.path,
          field === "base" ? "base" : "unstaged",
          field === "base" ? "review/diverged-local-tip" : undefined,
        );
        await gitRead.focus();
        await page.keyboard.press("Enter");
        await expect(gitDetailRegion).toHaveAttribute(
          "data-git-diff-state",
          "loading",
        );
        const control =
          field === "path" ? gitPath : field === "mode" ? gitMode : gitBase;
        const original = await control.inputValue();
        await control.selectOption(
          field === "path"
            ? gitScopeUi.otherPath
            : field === "mode"
              ? "staged"
              : "main",
        );
        await control.selectOption(original);
        await application.evaluate(() =>
          globalThis.__omocUiFixture.releaseGitReads(),
        );
        await expect(gitPatch).toHaveCount(0);
        await expect(gitRead).toBeEnabled();
        await captureGitUi(`${field}-aba-late-inert`, {
          narrow: true,
          theme: "dark",
        });
      }
      for (const boundary of [
        "epoch",
        "root",
        "trust",
        "hold",
        "floor",
        "refresh",
      ]) {
        gitScopeUi = await openGitCase("pending-diff");
        await observeGitUi();
        await selectGitUi(gitScopeUi.path);
        await workspaceText.fill("SYNTHETIC EDIT BEFORE GIT SCOPE CHANGE");
        await gitRead.focus();
        await page.keyboard.press("Enter");
        await expect(gitDetailRegion).toHaveAttribute(
          "data-git-diff-state",
          "loading",
        );
        if (boundary === "refresh") {
          // Refresh becomes enabled only after explicit cancellation; it retires detail.
          await gitCancelDiff.focus();
          await page.keyboard.press("Enter");
          await observeGitUi();
        } else {
          await application.evaluate((_electron, boundary) => {
            const f = globalThis.__omocUiFixture,
              w = f.snapshot.workspaces[0];
            if (boundary === "epoch")
              f.snapshot.runtimeEpoch = "fixture-ui-git-next-epoch";
            if (boundary === "root") w.path += "-replaced";
            if (boundary === "trust") {
              w.trusted = false;
              w.trustRevision++;
            }
            if (boundary === "floor") f.snapshot.revision++;
            if (boundary === "hold")
              f.snapshot.recovery.resources = [
                {
                  workspaceId: w.id,
                  state: "unavailable",
                  reason: "unresolved_operation",
                },
              ];
            f.snapshot.observationSequence++;
          }, boundary);
          await expect(gitPanel).toHaveAttribute(
            "data-git-review-state",
            "stale",
          );
        }
        await application.evaluate(() =>
          globalThis.__omocUiFixture.releaseGitReads(),
        );
        await expect(gitPatch).toHaveCount(0);
        if (["epoch", "root"].includes(boundary)) {
          const retained = workspaceSelect.locator('option[value^="draft:"]');
          await expect(retained).toHaveCount(1);
          await workspaceSelect.selectOption(
            await retained.getAttribute("value"),
          );
        }
        await expect(workspaceText).toHaveValue(
          "SYNTHETIC EDIT BEFORE GIT SCOPE CHANGE",
        );
        await workspaceText.fill("SYNTHETIC EDIT AFTER GIT SCOPE CHANGE");
        await captureGitUi(`${boundary}-late-detail-draft-editable`, {
          narrow: true,
        });
        assert.equal((await gitMetrics()).effects, 0);
      }
      for (const name of ["held", "untrusted"]) {
        gitScopeUi = await openGitCase(name);
        await workspaceText.fill("SYNTHETIC GIT INERT EDIT");
        if (name === "held") {
          await expect(gitRefresh).toBeDisabled();
          await expect(gitPanel).toContainText("Git 읽기를 보류합니다");
        } else {
          await expect(gitPanel).toContainText("실행 신뢰가 없는 작업 공간");
          await observeGitUi();
          await selectGitUi(gitScopeUi.path);
          await readGitUi();
        }
        await expect(workspaceText).toHaveValue("SYNTHETIC GIT INERT EDIT");
        await captureGitUi(`${name}-editable`, { narrow: true, theme: "dark" });
        assert.equal((await gitMetrics()).effects, 0);
      }
      gitScopeUi = await openGitCase();
      await workspaceText.fill("SYNTHETIC BEFORE GLOBAL HOLD");
      await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        f.snapshot.state = "unavailable";
        f.snapshot.recovery.store = {
          state: "recovery_required",
          reason: "corrupt_journal",
        };
        f.snapshot.messages = [];
        f.snapshot.permissions = [];
        f.snapshot.observationSequence++;
      });
      await expect(gitRefresh).toBeDisabled();
      await expect(gitPanel).toContainText("Git 읽기를 보류합니다");
      await workspaceText.fill("SYNTHETIC EDIT DURING GLOBAL HOLD");
      await expect(workspaceText).toHaveValue(
        "SYNTHETIC EDIT DURING GLOBAL HOLD",
      );
      await captureGitUi("global-hold-editable", {
        narrow: true,
        theme: "dark",
      });
      assert.equal((await gitMetrics()).reads, 0);

      // Existing app mutation action supplies the real Renderer hold signal.
      gitScopeUi = await openGitCase();
      await page
        .getByRole("region", { name: "파일 탐색 및 편집", exact: true })
        .getByTitle(gitScopeUi.path, { exact: true })
        .click();
      await explicitWorkspaceRead();
      await editWorkspace("SYNTHETIC PENDING FILE SAVE HOLDS GIT");
      await application.evaluate(() => {
        globalThis.__omocUiFixture.holdWorkspaceFileSave = true;
      });
      await workspaceSave.focus();
      await page.keyboard.press("Enter");
      await expect(gitRefresh).toBeDisabled();
      await expect(gitPanel).toContainText("Git 읽기를 보류합니다");
      await workspaceText.fill("SYNTHETIC EDIT DURING APP MUTATION");
      await captureGitUi("app-mutation-hold-editable", { narrow: true });
      await application.evaluate(() =>
        globalThis.__omocUiFixture.releaseWorkspaceFileSaves(),
      );
      await expect(workspaceText).toHaveValue(
        "SYNTHETIC EDIT DURING APP MUTATION",
      );
      observations.push(
        "Git appendix uses synthetic host responses only. Actual Git/root copy/process safety G2 remains outside this UI evidence.",
      );
      assert.deepEqual(errors, []);
    },
  };
  await runUiStateFamilies(requestedFamily, familyTasks, (name) => {
    activeFamily = name;
    executedFamilies.push(name);
  });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    try {
      await capture(
        page,
        "desktop-failure-synthetic.png",
        `Failure during ${currentState}`,
      );
    } catch (captureError) {
      observations.push(`Failure capture unavailable: ${String(captureError)}`);
    }
  }
} finally {
  let timer;
  try {
    const exited =
      processHandle.exitCode !== null
        ? Promise.resolve([processHandle.exitCode])
        : once(processHandle, "exit");
    if (processHandle.exitCode === null)
      await application.evaluate(({ app }) => app.quit());
    const [code] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Synthetic UI host exit unconfirmed")),
          15000,
        );
      }),
    ]);
    assert.equal(code, 0);
    teardown = { exited: true, code };
    await rm(fixtureRoot, { recursive: true, force: false });
  } catch (error) {
    failure ??= error;
    teardown = { ...teardown, error: String(error), retainedRoot: fixtureRoot };
  } finally {
    clearTimeout(timer);
  }
}
const report = {
  requestedFamily,
  executedFamilies,
  omittedFamilies: UI_STATE_FAMILIES.filter(
    (name) => !selectedFamilies.includes(name),
  ),
  result: failure ? "fail" : "pass",
  platform: process.platform,
  provenance:
    "Synthetic main-process fixtures with actual built Electron renderer/preload",
  providerExecution: "not performed",
  observations,
  p6Accessibility,
  p6StateFindings,
  p7StorageStates,
  configurationStates,
  configurationDraftStates,
  configurationFileStates,
  configurationSaveStates,
  configurationInstructionStates,
  configurationMcpStates,
  configurationSkillStates,
  configurationSkillRuntimeStates,
  configurationAgentStates,
  configurationAgentRuntimeStates,
  configurationExtensionStates,
  workspaceFileStates,
  gitReviewStates,
  gitAcceptance:
    "Synthetic DTO/controller/render coverage only; actual Git G2 is not established",
  teardown,
  screenshots,
  ...(failure && { error: String(failure) }),
};
await writeFile(
  join(run, "ui-states-evidence.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (failure) throw failure;
console.log(JSON.stringify(report));
