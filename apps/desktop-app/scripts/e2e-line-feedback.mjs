// Focused feedback evidence. Execute only through run-evidence --script feedback.
import assert from "node:assert/strict";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { captureProvenance } from "./build-provenance.mjs";
import {
  formatLineFeedback,
  appendLineFeedback,
} from "../src/renderer/shared/line-feedback/index.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw new Error(
    "Use run-evidence.mjs --script feedback --out <fresh-directory>",
  );
const run = resolve(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(
  claim.isFile() && !claim.isSymbolicLink(),
  "Evidence wrapper claim required",
);
await captureProvenance(root, { script: "feedback" });
const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-line-feedback-")),
);
const require = createRequire(import.meta.url);
const screenshots = [],
  observations = [],
  states = [],
  errors = [];
const bounded = (error) => String(error).slice(0, 2000);
let application, processHandle, page, failure;
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

// Instrumentation reads only the explicit synthetic Main fixture. Renderer state
// is exercised through its real controls, never injected or reconstructed here.
async function metrics() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      fileReads: f.workspaceFileReads.length,
      gitReads: f.gitReads.length,
      effects: f.requests.length,
      intents: f.intents.length,
      mutation: globalThis.__omocUiMutationMetrics(),
      sends: f.requests.filter((r) => r.type === "message.send").length,
      fileBackups: f.workspaceFileBackups.size,
    };
  });
}
const feedback = () =>
  page.getByRole("region", { name: "파일·diff 줄 피드백", exact: true });
const hook = (name) => feedback().locator(`[data-line-feedback-${name}]`);
const editor = () => page.locator('[data-workspace-file-editor="true"]');
const composer = () =>
  page.getByRole("textbox", { name: "메시지 작성", exact: true });
const git = () =>
  page.getByRole("region", { name: "Git 변경 검토", exact: true });
async function enterButton(button) {
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}
async function selectSource(kind, comment = "SYNTHETIC 줄 의견") {
  const before = await metrics();
  await hook("source").selectOption(kind);
  await expect(hook("status")).toBeFocused();
  await hook("comment").fill(comment);
  assert.deepEqual(
    await metrics(),
    before,
    "Source/comment selection is local only",
  );
}
async function openCase(name = "ready", kind = "file", patch) {
  currentState = `${kind}-${name}`;
  await setDisplay(page, 1440, 1000, 1);
  const scope = await application.evaluate(
    (_electron, { name, kind, patch }) => {
      const f = globalThis.__omocUiFixture;
      const scope =
        kind === "git" ? f.setGitState(name) : f.setWorkspaceFileState(name);
      if (patch !== undefined) f.gitPatchOverride = patch;
      return scope;
    },
    { name, kind, patch },
  );
  const beforeMount = await metrics();
  await page.reload();
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  const explorer = page.getByRole("region", {
    name: "파일 탐색 및 편집",
    exact: true,
  });
  await explorer.getByTitle(scope.path, { exact: true }).click();
  await expect(editor().locator("[data-workspace-file-target]")).toHaveText(
    `${scope.workspacePath}/${scope.path}`,
  );
  await expect(feedback()).toBeVisible();
  const m = await metrics();
  assert.equal(m.fileReads, beforeMount.fileReads);
  assert.equal(
    m.gitReads,
    beforeMount.gitReads,
    "Mount and preview must not query Git or establish a file baseline",
  );
  return scope;
}
async function readFileBaseline() {
  const before = await metrics();
  const open = editor().locator("[data-workspace-file-open]");
  await enterButton(open);
  await expect
    .poll(async () => (await metrics()).fileReads)
    .toBe(before.fileReads + 1);
  await expect(open).toBeEnabled();
  // A new baseline must preserve an unsaved file draft. Its real UI correctly
  // remains changed, while a pristine draft is ready. Neither is a failed read.
  await expect(editor().locator("[data-workspace-file-state]")).toHaveAttribute(
    "data-workspace-file-state",
    /^(?:ready|changed)$/,
  );
  const observation = await application.evaluate(
    () => globalThis.__omocUiFixture.lastWorkspaceFileObservation,
  );
  assert.equal(observation.status, "available");
  return observation;
}
async function readGit(mode, scope, baseRef) {
  const before = await metrics();
  await enterButton(
    git().getByRole("button", { name: "Git 상태 새로고침", exact: true }),
  );
  await expect(git()).toHaveAttribute("data-git-review-state", "available");
  await git()
    .getByLabel("Git 비교 경로", { exact: true })
    .selectOption(scope.path);
  await git().getByLabel("Git 비교 방식", { exact: true }).selectOption(mode);
  if (mode === "base")
    await git()
      .getByLabel("Git 기준 branch", { exact: true })
      .selectOption(baseRef);
  assert.equal((await metrics()).gitReads, before.gitReads + 1);
  await enterButton(
    git().getByRole("button", { name: "선택한 Git 차이 읽기", exact: true }),
  );
  await expect(git().locator("[data-git-diff-state]")).toHaveAttribute(
    "data-git-diff-state",
    "available",
  );
  assert.equal((await metrics()).gitReads, before.gitReads + 2);
  return application.evaluate(
    () => globalThis.__omocUiFixture.lastGitDiffObservation,
  );
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
const themeSurfaces = new Map();
async function recordState(
  name,
  { source, theme = "light", narrow = false, parts } = {},
) {
  currentState = name;
  const before = await metrics();
  await page.evaluate((theme) => {
    globalThis.document.documentElement.dataset.theme = theme;
  }, theme);
  await setDisplay(page, narrow ? 760 : 1440, 1000, narrow ? 2 : 1);
  await expect(feedback()).toBeVisible();
  const surface = await feedback().evaluate(
    (e) => globalThis.getComputedStyle(e).backgroundColor,
  );
  themeSurfaces.set(theme, surface);
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth + 1,
    ),
    true,
    "No horizontal page overflow",
  );
  assert.equal(
    await feedback().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
  );
  const targets = parts ?? [
    ["status", hook("status")],
    ["comment", hook("comment")],
    ["preview", hook("preview")],
    ["append", hook("append")],
  ];
  const visibility = [];
  for (const [part, locator] of targets) {
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
    const filename = `feedback-${++serial}-${name}-${theme}-${narrow ? "760px200" : "desktop"}-${part}.png`;
    await capture(page, filename, name);
    visibility.push({
      part,
      path: join(run, filename),
      fullyVisible: true,
      geometry,
    });
  }
  const selection = [];
  for (const dd of await feedback().locator("dl dd").all())
    selection.push(await selectable(dd));
  selection.push(await selectable(hook("preview")));
  assert.ok(
    selection.every((s) => s.complete),
    "Full path/version/excerpt must remain selectable",
  );
  assert.equal(
    await hook("preview").locator("script,img,a,iframe,input,button").count(),
    0,
    "Excerpt is inert text",
  );
  // All required controls remain reachable after scroll, including in the dialog.
  const controls = [
    "source",
    "history",
    "side",
    "start",
    "end",
    "comment",
    "append",
    "discard",
  ];
  for (const name of controls) {
    const control = hook(name);
    await expect(control).toBeVisible();
    // Center within nested scroll containers rather than leaving a control on
    // their clipped edge after a minimal scroll. Keep full-visibility required.
    await control.evaluate((e) =>
      e.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      }),
    );
    await expect(control).toBeInViewport({ ratio: 1 });
    if (await control.isEnabled()) {
      await control.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
    }
  }
  const comment = await hook("comment").inputValue();
  if (await hook("comment").isEnabled()) {
    await hook("comment").focus();
    await page.keyboard.press("Escape");
    await expect(hook("status")).toBeFocused();
    await expect(hook("comment")).toHaveValue(comment);
  }
  await page.evaluate(() =>
    window.dispatchEvent(new globalThis.Event("focus")),
  );
  // Allow one existing poll; neither poll nor refocus can read feedback sources.
  await page.waitForTimeout(1300);
  assert.deepEqual(
    await metrics(),
    before,
    "Theme/zoom/scroll/keyboard/Escape/refocus/poll must not query sources or mutate",
  );
  states.push({
    state: name,
    source,
    theme,
    narrow,
    reason: await feedback().getAttribute("data-line-feedback-state"),
    status: await hook("status").getAttribute("data-line-feedback-status"),
    visibility,
    selection,
    before,
    after: await metrics(),
  });
  await setDisplay(page, 1440, 1000, 1);
}
async function assertRefused(reason) {
  await expect(feedback()).toHaveAttribute("data-line-feedback-state", reason);
  await expect(hook("append")).toBeDisabled();
}
async function expectComposed(source, selection, comment, prefix = "") {
  const expected = appendLineFeedback(
    prefix,
    formatLineFeedback(source, selection, comment).text,
  );
  await expect(composer()).toHaveValue(expected);
  return expected;
}

try {
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

  const scope = await openCase();
  const baseline = await readFileBaseline();
  const prefix = "SYNTHETIC existing composer";
  const agent = page.getByLabel("Agent 요청", { exact: true });
  const model = page.getByLabel("모델 요청", { exact: true });
  await composer().fill(prefix);
  await agent.selectOption("fixture-agent");
  await model.selectOption("fixture-model");
  await editor()
    .locator("[data-workspace-file-text]")
    .fill("SYNTHETIC UNSAVED DIFFERENT TEXT\n");
  await selectSource("file", "SYNTHETIC 첫 의견");
  await hook("end").fill("3");
  await hook("comment").focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("SYNTHETIC 둘째 의견");
  const comment = await hook("comment").inputValue();
  assert.equal(comment, "SYNTHETIC 첫 의견\nSYNTHETIC 둘째 의견");
  assert.equal(await hook("preview").textContent(), scope.text);
  await expect(hook("session")).toContainText(baseline.version);
  await expect(hook("session")).toContainText(baseline.directoryVersion);
  assert.equal(
    (await metrics()).sends,
    0,
    "Textarea Enter is a newline, never Send",
  );
  await recordState("file-original-baseline", {
    source: baseline,
    parts: [
      ["path", hook("session").locator("dd").nth(1)],
      ["version", hook("session").locator("dd").nth(3)],
      ["excerpt", hook("preview")],
      ["comment", hook("comment")],
    ],
  });
  const beforeAppend = await metrics();
  await recordState("file-original-baseline-dark-desktop", {
    source: baseline,
    theme: "dark",
    parts: [
      ["path", hook("session").locator("dd").nth(1)],
      ["version", hook("session").locator("dd").nth(3)],
      ["excerpt", hook("preview")],
      ["comment", hook("comment")],
    ],
  });
  await enterButton(hook("append"));
  await expect(hook("status")).toHaveAttribute(
    "data-line-feedback-status",
    "ADDED",
  );
  await expect(hook("status")).toBeFocused();
  const expected = await expectComposed(
    { kind: "file", observation: baseline },
    { side: "file", start: 1, end: 3 },
    comment,
    prefix,
  );
  await expect(agent).toHaveValue("fixture-agent");
  await expect(model).toHaveValue("fixture-model");
  assert.deepEqual(
    await metrics(),
    beforeAppend,
    "Append is explicit local composer editing only",
  );
  await recordState("file-added-separate-send", {
    source: baseline,
    theme: "dark",
    narrow: true,
  });

  await composer().fill("x".repeat(32000));
  await assertRefused("DRAFT_TOO_LARGE");
  await recordState("composer-overflow", {
    theme: "light",
    narrow: true,
    parts: [
      ["status", hook("status")],
      ["disabled-append", hook("append")],
    ],
  });
  await expect(composer()).toHaveValue("x".repeat(32000));
  await composer().fill(expected);

  // New source is a new draft; resuming the original cannot relabel its bytes.
  const originalId = await hook("history").inputValue();
  await readFileBaseline();
  await selectSource("file", "SYNTHETIC new source comment");
  const newId = await hook("history").inputValue();
  assert.notEqual(originalId, newId);
  await hook("history").selectOption(originalId);
  await assertRefused("STALE_SOURCE");
  await hook("comment").fill("SYNTHETIC retained original edit");
  await expect(hook("session")).toContainText(baseline.version);
  await recordState("retained-source-resume", {
    source: baseline,
    theme: "dark",
    narrow: true,
  });
  const beforeDiscard = await metrics();
  await enterButton(hook("discard"));
  await expect(composer()).toHaveValue(expected);
  await expect(
    hook("history").locator(`option[value="${originalId}"]`),
  ).toHaveCount(0);
  assert.deepEqual(await metrics(), beforeDiscard);
  await hook("history").selectOption(newId);

  for (const [mode, side, line] of [
    ["staged", "old", 8],
    ["unstaged", "new", 12],
    ["base", "new", 12],
  ]) {
    const path = "notes/SYNTHETIC-editor.txt";
    const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -8 +12 @@\n-SYNTHETIC OLD\n\\ No newline at end of file\n+SYNTHETIC NEW\n\\ No newline at end of file\n`;
    const scope = await openCase("ready", "git", patch);
    const observation = await readGit(mode, scope, "review/diverged-local-tip");
    await selectSource("git", `SYNTHETIC ${mode} 의견`);
    await hook("side").selectOption(side);
    await hook("start").fill(String(line));
    await hook("end").fill(String(line));
    assert.equal(
      await hook("preview").textContent(),
      side === "old" ? "SYNTHETIC OLD" : "SYNTHETIC NEW",
    );
    await expect(hook("session")).toContainText(observation.sourceDigest);
    if (mode === "base") {
      assert.equal(observation.baseOid, "2".repeat(40));
      await expect(hook("session")).toContainText(observation.baseOid);
    }
    const before = await metrics();
    await enterButton(hook("append"));
    await expectComposed(
      { kind: "git", observation },
      { side, start: line, end: line },
      `SYNTHETIC ${mode} 의견`,
    );
    assert.deepEqual(await metrics(), before);
    await recordState(`git-${mode}-${side}`, {
      source: observation,
      theme: mode === "unstaged" ? "dark" : "light",
      narrow: mode !== "staged",
    });
    if (mode === "staged") {
      await recordState("git-staged-old-dark-desktop", {
        source: observation,
        theme: "dark",
      });
    }
  }

  for (const [name, patch, side, reason] of [
    [
      "absent-side",
      "--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+SYNTHETIC\n",
      "old",
      "INVALID_LINE_RANGE",
    ],
    [
      "malformed-header",
      "--- /dev/null\n+++ b/x\n@@ -1 +1 @@\n-SYNTHETIC\n+SYNTHETIC\n",
      "old",
      "UNSUPPORTED_DIFF",
    ],
  ]) {
    const scope = await openCase("ready", "git", patch);
    const observation = await readGit("unstaged", scope);
    await selectSource("git");
    await hook("side").selectOption(side);
    await assertRefused(reason);
    await recordState(`git-${name}`, {
      source: observation,
      theme: "dark",
      narrow: true,
      parts: [
        ["status", hook("status")],
        ["side", hook("side")],
        ["disabled-append", hook("append")],
      ],
    });
  }

  await openCase("protected");
  const protectedBefore = await metrics();
  await expect(editor().locator("[data-workspace-file-open]")).toBeDisabled();
  await expect(
    editor().locator('[data-workspace-file-state="unavailable"]'),
  ).toBeVisible();
  await hook("source").selectOption("file");
  await assertRefused("MISSING_SOURCE");
  assert.deepEqual(
    await metrics(),
    protectedBefore,
    "Protected source is refused before any IO",
  );
  await recordState("protected-source", {
    narrow: true,
    parts: [
      ["status", hook("status")],
      ["source", hook("source")],
      ["disabled-append", hook("append")],
    ],
  });

  for (const boundary of ["root", "held", "trust"]) {
    await openCase();
    const observation = await readFileBaseline();
    await selectSource("file");
    await application.evaluate((_electron, boundary) => {
      const f = globalThis.__omocUiFixture;
      if (boundary === "root") f.snapshot.workspaces[0].path += "-changed";
      if (boundary === "held")
        f.snapshot.recovery.resources = [
          {
            workspaceId: "fixture-w",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ];
      if (boundary === "trust") {
        f.snapshot.workspaces[0].trusted = false;
        f.snapshot.workspaces[0].trustRevision++;
      }
      f.snapshot.observationSequence++;
    }, boundary);
    await assertRefused(
      boundary === "root"
        ? "STALE_SOURCE"
        : boundary === "held"
          ? "HELD"
          : "UNTRUSTED",
    );
    await hook("comment").fill(`SYNTHETIC editable during ${boundary}`);
    await expect(hook("session")).toContainText(observation.workspacePath);
    await recordState(`original-draft-${boundary}`, {
      source: observation,
      theme: boundary === "held" ? "light" : "dark",
      narrow: true,
      parts: [
        ["status", hook("status")],
        ["comment", hook("comment")],
        ["disabled-append", hook("append")],
      ],
    });
  }

  await openCase();
  const sendBaseline = await readFileBaseline();
  await selectSource("file", "SYNTHETIC after old Send");
  await composer().fill("SYNTHETIC old Send");
  await application.evaluate(() => {
    globalThis.__omocUiFixture.holdSendAck = true;
  });
  const beforeSend = await metrics();
  await enterButton(
    page.getByRole("button", { name: "메시지 보내기", exact: true }),
  );
  await expect
    .poll(async () => (await metrics()).sends)
    .toBe(beforeSend.sends + 1);
  assert.equal(
    await application.evaluate(
      () => globalThis.__omocUiFixture.heldSendAcks.length,
    ),
    1,
  );
  // This assertion deliberately exposes the pending-Send append contract. Main
  // owns any Renderer repair; this runner cannot bypass a disabled real button.
  await enterButton(hook("append"));
  const newer = await expectComposed(
    { kind: "file", observation: sendBaseline },
    { side: "file", start: 1, end: 1 },
    "SYNTHETIC after old Send",
    "SYNTHETIC old Send",
  );
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseSendAcks(),
  );
  await expect(composer()).toHaveValue(newer);
  await recordState("late-send-ack-newer-context", {
    source: sendBaseline,
    theme: "light",
    parts: [
      ["status", hook("status")],
      ["comment", hook("comment")],
    ],
  });
  assert.equal(
    (await metrics()).sends,
    beforeSend.sends + 1,
    "Append never dispatches a second Send",
  );
  const sent = await application.evaluate(() =>
    globalThis.__omocUiFixture.requests.filter(
      (r) => r.type === "message.send",
    ),
  );
  assert.equal(sent.at(-1).text, "SYNTHETIC old Send");
  assert.notEqual(
    themeSurfaces.get("light"),
    themeSurfaces.get("dark"),
    "Both themes require distinct computed surfaces",
  );
  assert.ok(
    states.some((state) => state.theme === "dark" && !state.narrow),
    "Desktop dark requires actual captured state evidence",
  );
  // Local Escape must not disable ordinary modal dismissal outside that scope.
  await setDisplay(page, 760, 1000, 2);
  const modal = page.getByRole("dialog", {
    name: "파일, 확장 및 활동",
    exact: true,
  });
  await expect(modal).toBeVisible();
  const close = modal.getByRole("button", {
    name: "파일, 확장 및 활동 닫기",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  observations.push({ outsideFeedbackEscapeClosesModal: true });
  assert.deepEqual(errors, []);
  observations.push({
    exactBaseline: true,
    unsavedTextExcluded: true,
    separateSendCount: 1,
    syntheticOnly: true,
    actualGitG2: "not established",
  });
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    try {
      await capture(
        page,
        "feedback-failure.png",
        `Failure during ${currentState}`,
      );
    } catch (captureError) {
      observations.push({ failureCaptureError: bounded(captureError) });
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
        () => reject(new Error("Synthetic feedback host exit unconfirmed")),
        15000,
      );
    });
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      // Shutdown, including the app RPC, is bounded. No private-store cleanup.
      await Promise.race([
        application
          .evaluate(({ app }) => app.quit())
          .catch((error) => {
            observations.push({ quitRpc: bounded(error) });
          }),
        deadline,
      ]);
    }
    const [code, signal] = await Promise.race([exited, deadline]);
    teardown = { exited: true, code, signal, retainedRoot: fixtureRoot };
    assert.equal(code, 0, "Owned synthetic host must exit normally");
    await rm(fixtureRoot, { recursive: true, force: false });
    teardown = { exited: true, code: 0 };
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
}
const report = {
  result: failure ? "fail" : "pass",
  platform: process.platform,
  provenance:
    "Synthetic Main with actual built Renderer/preload through fixed feedback wrapper",
  providerExecution: "not performed",
  actualGitG2: "not established",
  fixtureRoot,
  state: currentState,
  states,
  observations,
  screenshots,
  teardown,
  ...(failure && { error: bounded(failure) }),
};
await writeFile(
  join(run, "line-feedback-evidence.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { flag: "wx" },
);
if (failure) {
  console.error(
    `Feedback evidence failed in ${currentState}: ${bounded(failure)}`,
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      result: "pass",
      report: join(run, "line-feedback-evidence.json"),
      states: states.length,
      captures: screenshots.length,
      teardown,
    }),
  );
