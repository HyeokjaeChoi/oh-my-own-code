// Focused selected-index evidence. Execute only through run-evidence --script git-index.
import assert from "node:assert/strict";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { captureProvenance } from "./build-provenance.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw new Error(
    "Use run-evidence.mjs --script git-index --out <fresh-directory>",
  );
const run = resolve(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(
  claim.isFile() && !claim.isSymbolicLink(),
  "Evidence wrapper claim required",
);

const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-git-index-")),
);
const require = createRequire(import.meta.url);
const screenshots = [],
  observations = [],
  states = [],
  errors = [];
const bounded = (error) => String(error).slice(0, 2000);
let application,
  processHandle,
  page,
  failure,
  provenanceBefore,
  provenanceAfter;
let teardown = { exited: false, retainedRoot: fixtureRoot };
let currentState = "launch",
  serial = 0;

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

async function selectable(locator) {
  return locator.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection = element.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString(),
      expected = element.textContent,
      cloned = selection.getRangeAt(0).cloneContents().textContent,
      userSelect = globalThis.getComputedStyle(element).userSelect;
    // Chromium omits the final rendered line break in Selection.toString().
    // Require an exact full DOM range and exact body; permit only that one
    // observed serialization difference. Original source/append bytes stay exact.
    const withoutFinalBreak = expected.replace(/(?:\r\n|\r|\n)$/u, "");
    selection.removeAllRanges();
    return {
      complete:
        cloned === expected &&
        userSelect === "text" &&
        (selected === expected || selected === withoutFinalBreak),
      characters: expected.length,
      selectedCharacters: selected.length,
      clonedCharacters: cloned.length,
      userSelect,
      finalLineBreakOmitted: selected !== expected,
    };
  });
}

const git = () =>
  page.getByRole("region", { name: "Git 변경 검토", exact: true });
const index = () =>
  page.getByRole("region", { name: "선택한 Git index 변경", exact: true });
const button = (name) => index().getByRole("button", { name, exact: true });
const previewButton = () => button("Index 변경 미리보기");
const applyButton = () => button("Index 변경 적용");
const status = () => index().locator("[data-git-index-status]");
const preview = () => index().locator("[data-git-index-preview]");
const result = () => index().locator("[data-git-index-result]");
const pathCheckbox = (path = "notes/SYNTHETIC-editor.txt") =>
  index().getByRole("checkbox", {
    name: `Index 경로 선택: ${path}`,
    exact: true,
  });
const composer = () =>
  page.getByRole("textbox", { name: "메시지 작성", exact: true });
const themeSurfaces = new Map();
async function metrics() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      statusReads: f.gitReads.filter(
        (r) => r.operation.type === "git.review.read",
      ).length,
      previewReads: f.gitIndexReads.length,
      applies: f.requests.filter((r) => r.type === "git.index.apply").length,
      effects: f.gitIndexEffects.length,
      backups: f.syntheticGitIndexBackups.size,
      heldCalls: f.pendingGitIndexWorkspaces.size,
      heldReads: f.pendingGitIndexReadWorkspaces.size,
    };
  });
}
async function enterButton(locator) {
  await expect(locator).toBeEnabled();
  await locator.evaluate((e) =>
    e.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press("Enter");
}
async function openCase(name = "ready") {
  currentState = name;
  await setDisplay(page, 1440, 1000, 1);
  const scope = await application.evaluate(
    (_electron, name) => globalThis.__omocUiFixture.setGitIndexState(name),
    name,
  );
  await page.reload();
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  await expect(index()).toBeVisible();
  await expect(index()).toHaveAttribute("data-git-index-state", "empty");
  await expect(previewButton()).toBeDisabled();
  const before = await metrics();
  assert.equal(before.statusReads, 0);
  assert.equal(before.previewReads, 0);
  assert.equal(before.applies, 0);
  return scope;
}
async function observe() {
  const before = await metrics();
  await enterButton(
    git().getByRole("button", { name: "Git 상태 새로고침", exact: true }),
  );
  await expect(git()).toHaveAttribute("data-git-review-state", "available");
  assert.equal((await metrics()).statusReads, before.statusReads + 1);
}
async function select(action = "stage") {
  const before = await metrics();
  await pathCheckbox().check();
  await index().getByLabel("Index 작업", { exact: true }).selectOption(action);
  assert.deepEqual(await metrics(), before, "Path/action selection is local");
}
async function readPreview(expected = "available") {
  const before = await metrics();
  await enterButton(previewButton());
  await expect(index()).toHaveAttribute("data-git-index-state", expected);
  await expect(status()).toBeFocused();
  assert.equal((await metrics()).previewReads, before.previewReads + 1);
  if (expected === "available") {
    await expect(preview()).toHaveAttribute(
      "data-git-index-preview",
      "current",
    );
    await expect(applyButton()).toBeEnabled();
  } else await expect(applyButton()).toBeDisabled();
  return application.evaluate(
    () =>
      [...globalThis.__omocUiFixture.gitIndexPreviews.values()].at(-1)?.value,
  );
}
async function recordState(name, { theme = "light", narrow = false } = {}) {
  currentState = name;
  const before = await metrics();
  await page.evaluate((theme) => {
    globalThis.document.documentElement.dataset.theme = theme;
  }, theme);
  await setDisplay(page, narrow ? 760 : 1440, 1000, narrow ? 2 : 1);
  await expect(index()).toBeVisible();
  assert.ok(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth + 1,
    ),
    "No page horizontal overflow",
  );
  assert.ok(
    await index().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "No index panel horizontal overflow",
  );
  themeSurfaces.set(
    theme,
    await git().evaluate((e) => globalThis.getComputedStyle(e).backgroundColor),
  );
  const controls = [
    index().getByLabel("Index 작업", { exact: true }),
    previewButton(),
    button("Index 미리보기 취소"),
    applyButton(),
  ];
  const visibility = [];
  for (const locator of [status(), ...controls]) {
    await expect(locator).toBeVisible();
    await locator.evaluate((e) =>
      e.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect(locator).toBeInViewport({ ratio: 1 });
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
      };
    });
    const file = `git-index-${++serial}-${name}-${theme}-${narrow ? "760px200" : "desktop"}.png`;
    await capture(page, file, name);
    const enabled = await locator.isEnabled();
    if (enabled && (await locator.getAttribute("tabindex")) !== "-1") {
      await locator.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(locator).toBeFocused();
    }
    visibility.push({
      label: await locator.textContent(),
      enabled,
      geometry,
      capture: join(run, file),
    });
  }
  // Controls alone do not show lower metadata. Capture representative complete
  // fields separately so independent review can inspect wrapping and results.
  const details = [];
  if (
    [
      "ready-stage-preview",
      "ready-unstage-preview",
      "sha256-stage-preview",
      "absent-stage-preview",
    ].includes(name)
  ) {
    for (const at of [0, 4, 5, 6])
      details.push(preview().locator("dd").nth(at));
    for (const at of [0, 1])
      details.push(index().locator("[data-git-index-entries] dd").nth(at));
  }
  if (
    [
      "ready-stage-applied",
      "sha256-stage-applied",
      "absent-stage-applied",
      "apply-unknown",
    ].includes(name)
  ) {
    for (const at of [0, 1, 3]) details.push(result().locator("dd").nth(at));
    if (name !== "apply-unknown") details.push(result().locator("dd").last());
  }
  for (const locator of details) {
    await expect(locator).toBeVisible();
    await locator.evaluate((e) =>
      e.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect(locator).toBeInViewport({ ratio: 1 });
    const file = `git-index-${++serial}-${name}-metadata-${theme}-${narrow ? "760px200" : "desktop"}.png`;
    await capture(page, file, name);
    visibility.push({
      label: await locator.evaluate(
        (e) => e.previousElementSibling?.textContent,
      ),
      metadata: true,
      capture: join(run, file),
    });
  }
  const selection = [];
  for (const dd of await index().locator("dl dd").all())
    selection.push(await selectable(dd));
  for (const span of await index().locator("label span").all())
    selection.push(await selectable(span));
  assert.ok(
    selection.every((s) => s.complete),
    "Complete paths, OIDs, digests and backup metadata selectable",
  );
  assert.equal(
    await index()
      .locator("dl script,dl img,dl a,dl iframe,dl button,dl input")
      .count(),
    0,
    "Metadata is inert",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new globalThis.Event("focus")),
  );
  await page.waitForTimeout(1300);
  assert.deepEqual(
    await metrics(),
    before,
    "Theme/layout/keyboard/refocus/poll never read or apply automatically",
  );
  states.push({
    state: name,
    theme,
    narrow,
    indexState: await index().getAttribute("data-git-index-state"),
    previewState: (await preview().count())
      ? await preview().getAttribute("data-git-index-preview")
      : null,
    resultState: (await result().count())
      ? await result().getAttribute("data-git-index-result")
      : null,
    status: await status().textContent(),
    selection,
    visibility,
    before,
    after: await metrics(),
  });
}

try {
  assert.equal(
    await realpath(run),
    run,
    "Evidence namespace must be canonical",
  );
  provenanceBefore = await captureProvenance(root, { script: "git-index" });
  application = await electron.launch({
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
  });
  processHandle = application.process();
  // Raw child output is drained with bounded counters; it is never copied to the report.
  const childOutput = { stdoutBytes: 0, stderrBytes: 0 };
  for (const stream of ["stdout", "stderr"])
    processHandle[stream]?.on("data", (chunk) => {
      childOutput[`${stream}Bytes`] = Math.min(
        1_000_000,
        childOutput[`${stream}Bytes`] + chunk.length,
      );
    });
  observations.push({ childOutput });
  page = await application.firstWindow({ timeout: 20000 });
  page.on("pageerror", (error) => {
    if (errors.length < 10) errors.push(bounded(error));
  });
  // firstWindow can return before Main's initial loadFile finishes. Reloading
  // then aborts that load and correctly makes the synthetic host exit with 1.
  // Wait for the exact built entry's completed navigation before fixture reset.
  await page.waitForURL(
    pathToFileURL(join(desktop, "dist/app/renderer/index.html")).href,
    { waitUntil: "load", timeout: 20000 },
  );

  for (const name of ["ready", "sha256", "absent", "unborn-existing"]) {
    for (const action of ["stage", "unstage"]) {
      const scope = await openCase(name);
      await observe();
      await select(action);
      if (name === "absent" && action === "unstage") {
        await readPreview("unavailable");
        await recordState("absent-unstage-no-changes", {
          theme: "dark",
          narrow: true,
        });
        continue;
      }
      const value = await readPreview();
      await expect(preview()).toContainText(scope.workspacePath);
      await expect(preview()).toContainText(value.indexDigest);
      await expect(preview()).toContainText(value.nextIndexDigest);
      await expect(index().locator("[data-git-index-entries]")).toContainText(
        value.entries[0].after?.oid ?? "없음",
      );
      if (name === "absent")
        await expect(preview()).toContainText("backup은 생성하지 않음");
      await recordState(`${name}-${action}-preview`, {
        theme: action === "stage" ? "light" : "dark",
        narrow: name === "sha256",
      });
      if (name === "ready" && action === "stage")
        await recordState("ready-preview-dark-desktop", { theme: "dark" });
      await enterButton(applyButton());
      await expect(result()).toHaveAttribute(
        "data-git-index-result",
        "applied",
      );
      await expect(applyButton()).toBeDisabled();
      await expect(preview()).toHaveAttribute(
        "data-git-index-preview",
        "historical",
      );
      const after = await metrics();
      assert.equal(after.applies, 1);
      assert.equal(after.effects, 1);
      assert.equal(after.statusReads, 1);
      assert.equal(after.previewReads, 1);
      assert.equal(after.backups, name === "absent" ? 0 : 1);
      await recordState(`${name}-${action}-applied`, {
        theme: "dark",
        narrow: true,
      });
      await observe();
      assert.equal(
        (await metrics()).statusReads,
        2,
        "Post-receipt floor needs explicit status reread",
      );
    }
  }
  for (const reason of [
    "no_changes",
    "stale_observation",
    "expired_observation",
    "lock_conflict",
    "unsupported_index_mutation",
  ]) {
    await openCase(reason);
    await observe();
    await select();
    const stale = ["stale_observation", "expired_observation"].includes(reason);
    await readPreview(stale ? "stale" : "unavailable");
    if (stale) {
      await expect(preview()).toHaveAttribute(
        "data-git-index-preview",
        "historical",
      );
      await expect(git()).toHaveAttribute("data-git-review-state", "stale");
    }
    await recordState(`refused-${reason}`, { theme: "dark", narrow: true });
    assert.equal((await metrics()).applies, 0);
  }
  for (const outcome of [
    "denied",
    "unknown",
    "stale_preview",
    "expired_preview",
    "lock_conflict",
    "unsupported_index_mutation",
  ]) {
    await openCase();
    await observe();
    await select();
    await readPreview();
    await application.evaluate((_electron, outcome) => {
      globalThis.__omocUiFixture.nextGitIndexApply = outcome;
    }, outcome);
    await enterButton(applyButton());
    await expect(result()).toHaveAttribute(
      "data-git-index-result",
      outcome === "unknown" ? "unknown" : "denied",
    );
    await recordState(`apply-${outcome}`, { theme: "light", narrow: true });
    assert.equal((await metrics()).effects, 0);
    if (outcome === "unknown") {
      const keys = await application.evaluate(() => {
        const f = globalThis.__omocUiFixture;
        return { intent: f.intents.at(-1), lookups: f.lookups };
      });
      assert.ok(
        keys.lookups.some(
          (k) =>
            k.runtimeEpoch === keys.intent.runtimeEpoch &&
            k.operationId === keys.intent.operationId,
        ),
      );
      assert.equal((await metrics()).applies, 1);
    }
  }
  await openCase("pending-preview");
  await observe();
  await select();
  await enterButton(previewButton());
  await expect(index()).toHaveAttribute("data-git-index-state", "loading");
  await recordState("pending-preview", { theme: "dark", narrow: true });
  await enterButton(button("Index 미리보기 취소"));
  await expect(applyButton()).toBeDisabled();
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseGitIndexReads(),
  );
  await expect.poll(async () => (await metrics()).heldReads).toBe(0);
  await expect(applyButton()).toBeDisabled();
  await readPreview();
  observations.push({
    cancelledReadLateReplyIgnored: true,
    escapeCancellation:
      "No index Escape contract; explicit cancel control exercised",
  });

  for (const boundary of [
    "held",
    "global-held",
    "untrusted",
    "epoch",
    "root",
  ]) {
    await openCase();
    await observe();
    await select();
    await readPreview();
    await application.evaluate((_electron, boundary) => {
      const f = globalThis.__omocUiFixture,
        w = f.snapshot.workspaces[0];
      if (boundary === "held")
        f.snapshot.recovery.resources.push({
          workspaceId: w.id,
          state: "unavailable",
          reason: "unresolved_operation",
        });
      if (boundary === "global-held") {
        f.snapshot.recovery.store = {
          state: "recovery_required",
          reason: "corrupt_journal",
        };
        f.snapshot.state = "unavailable";
        f.snapshot.messages = [];
        f.snapshot.permissions = [];
      }
      if (boundary === "untrusted") {
        w.trusted = false;
        w.trustRevision++;
      }
      if (boundary === "epoch")
        f.snapshot.runtimeEpoch = "synthetic-replacement-index-epoch";
      if (boundary === "root") w.path = "/synthetic/replaced-index-root";
      f.snapshot.revision++;
    }, boundary);
    await expect(preview()).toHaveAttribute(
      "data-git-index-preview",
      "historical",
      { timeout: 10000 },
    );
    await expect(applyButton()).toBeDisabled();
    await recordState(`historical-${boundary}`, {
      theme: "dark",
      narrow: true,
    });
    assert.equal((await metrics()).applies, 0);
  }
  await openCase("retained");
  await expect(previewButton()).toBeDisabled();
  await expect
    .poll(() =>
      application.evaluate(() => globalThis.__omocUiFixture.lookups.length),
    )
    .toBeGreaterThan(0);
  const retained = await application.evaluate(() => ({
    key: globalThis.__omocUiFixture.gitIndexRetainedKey,
    lookups: globalThis.__omocUiFixture.lookups,
  }));
  assert.ok(
    retained.lookups.every(
      (k) =>
        k.runtimeEpoch === retained.key.runtimeEpoch &&
        k.operationId === retained.key.operationId,
    ),
  );
  await recordState("retained-original-key", { theme: "light", narrow: true });
  assert.equal((await metrics()).applies, 0);

  await openCase();
  await observe();
  await select();
  await readPreview();
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdGitIndexApply = true;
  });
  await enterButton(applyButton());
  await expect(result()).toHaveAttribute("data-git-index-result", "pending");
  await expect.poll(async () => (await metrics()).heldCalls).toBe(1);
  // Sidebar uses the real public selection control; no Renderer state injection.
  await setDisplay(page, 1440, 1000, 1);
  await page
    .getByLabel("작업 공간", { exact: true })
    .selectOption("synthetic-index-other-w");
  await expect(
    page
      .getByTitle("SYNTHETIC selectable other draft", { exact: true })
      .first(),
  ).toBeVisible();
  const draft = "SYNTHETIC newer independent draft";
  await composer().fill(draft);
  await application.evaluate(() =>
    globalThis.__omocUiFixture.confirmGitIndexApplies(),
  );
  assert.equal(
    (await metrics()).heldCalls,
    1,
    "Confirmed receipt cannot release actual call",
  );
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseGitIndexApplies(),
  );
  await expect.poll(async () => (await metrics()).heldCalls).toBe(0);
  await expect(composer()).toHaveValue(draft);
  assert.equal((await metrics()).applies, 1);
  assert.equal((await metrics()).effects, 1);
  observations.push({
    lateAckPreservesSelectableOtherDraft: true,
    confirmation:
      "Explicit synthetic decision only; real Main dialog not established",
  });
  assert.notEqual(themeSurfaces.get("light"), themeSurfaces.get("dark"));
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    try {
      await capture(
        page,
        "git-index-failure.png",
        `Failure during ${currentState}`,
      );
    } catch (error) {
      observations.push({ failureCaptureError: bounded(error) });
    }
  }
} finally {
  let timer, exitListener;
  try {
    assert.ok(processHandle, "No owned exit handle returned by launcher");
    const exited =
      processHandle.exitCode !== null || processHandle.signalCode !== null
        ? Promise.resolve([processHandle.exitCode, processHandle.signalCode])
        : new Promise((resolve) => {
            exitListener = (code, signal) => resolve([code, signal]);
            processHandle.once("exit", exitListener);
          });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Synthetic index host exit unconfirmed")),
        15000,
      );
    });
    if (processHandle.exitCode === null && processHandle.signalCode === null)
      await Promise.race([
        application
          .evaluate(({ app }) => app.quit())
          .catch((error) => {
            observations.push({ quitRpc: bounded(error) });
          }),
        deadline,
      ]);
    const [code, signal] = await Promise.race([exited, deadline]);
    assert.equal(code, 0, "Owned synthetic host must exit normally");
    teardown = { exited: true, code: 0, signal, retainedRoot: fixtureRoot };
    if (!failure) {
      await rm(fixtureRoot, { recursive: true, force: false });
      teardown = { exited: true, code: 0 };
    }
  } catch (error) {
    failure ??= error;
    teardown = {
      ...teardown,
      error: bounded(error),
      retainedRoot: fixtureRoot,
    };
  } finally {
    clearTimeout(timer);
    if (exitListener) processHandle?.removeListener("exit", exitListener);
  }
  try {
    provenanceAfter = await captureProvenance(root, { script: "git-index" });
    assert.deepEqual(
      provenanceAfter,
      provenanceBefore,
      "Source/build/selected runner identities changed during evidence run",
    );
  } catch (error) {
    failure ??= error;
  }
}
const report = {
  result: failure ? "fail" : "pass",
  platform: process.platform,
  provenance:
    "Built Renderer/preload with test-only synthetic Main through git-index wrapper",
  providerExecution: "not performed",
  actualPublication: "not established",
  actualMainConfirmation: "not established",
  fixtureRoot,
  state: currentState,
  states,
  observations,
  screenshots,
  teardown,
  sourceBuildProvenance: { before: provenanceBefore, after: provenanceAfter },
  ...(failure && { error: bounded(failure) }),
};
await writeFile(
  join(run, "git-index-evidence.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { flag: "wx" },
);
if (failure) {
  console.error(
    `Index evidence failed in ${currentState}: ${bounded(failure)}`,
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      result: "pass",
      report: join(run, "git-index-evidence.json"),
      states: states.length,
      captures: screenshots.length,
      teardown,
    }),
  );
