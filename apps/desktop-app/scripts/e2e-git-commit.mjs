// Focused explicit all-staged Commit evidence. Execute only through run-evidence --script git-commit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { captureProvenance } from "./build-provenance.mjs";
import { selectWorkspace } from "./e2e-shell.mjs";

// The Git write sections live in the 변경 tab's action dock; open one by its toggle.
async function openGitTray(page, label) {
  await page.getByRole("tab", { name: "변경", exact: true }).click();
  const toggle = page
    .getByRole("group", { name: "Git 작업", exact: true })
    .getByRole("button", { name: label, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
}
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw new Error(
    "Use run-evidence.mjs --script git-commit --out <fresh-directory>",
  );
const run = resolve(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(
  claim.isFile() && !claim.isSymbolicLink(),
  "Evidence wrapper claim required",
);

const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-git-commit-")),
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
const commit = () =>
  page.getByRole("region", { name: "전체 staged 변경 Commit", exact: true });
const button = (name) => commit().getByRole("button", { name, exact: true });
const previewButton = () => button("전체 staged Commit 미리보기");
const applyButton = () => button("전체 staged Commit 적용");
const cancelButton = () => button("Commit 미리보기 취소");
const status = () => commit().getByRole("status").last();
const metadata = () =>
  commit().locator('dl[aria-label="Commit 미리보기 출처"]');
const canonical = () =>
  commit().getByLabel("실제 Commit 메시지", { exact: true });
const entries = () =>
  commit().getByRole("list", { name: "전체 staged Commit 경로", exact: true });
const results = () =>
  commit().getByRole("list", { name: "Commit 요청 결과", exact: true });
const operation = () =>
  commit().locator("[data-git-commit-operation-state]").last();
const field = (name) => commit().getByLabel(name, { exact: true });
const syntheticAuthor = {
  name: "SYNTHETIC 작성자",
  email: "synthetic@example.invalid",
};
const syntheticMessage =
  "\ufeffSYNTHETIC <script>inert</script>\r\nsecond line\r\n";
const surfaces = new Map();
async function metrics() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      statusReads: f.gitReads.filter(
        (r) => r.operation.type === "git.review.read",
      ).length,
      previewReads: f.gitCommitReads.length,
      applies: f.requests.filter((r) => r.type === "git.commit.apply").length,
      indexApplies: f.requests.filter((r) => r.type === "git.index.apply")
        .length,
      effects: f.gitCommitEffects.length,
      backups: f.syntheticGitCommitBackups.size,
      heldCalls: f.pendingGitCommitWorkspaces.size,
      heldReads: f.pendingGitCommitReadWorkspaces.size,
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
    (_electron, name) => globalThis.__omocUiFixture.setGitCommitState(name),
    name,
  );
  await page.reload();
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await page.getByRole("button", { name: "보조 패널", exact: true }).click();
  await openGitTray(page, "커밋");
  await expect(commit()).toBeVisible();
  await expect(field("Commit 작성자 이름")).toHaveValue("");
  await expect(field("Commit 작성자 이메일")).toHaveValue("");
  await expect(field("Commit 메시지")).toHaveValue("");
  const m = await metrics();
  assert.equal(m.statusReads, 0);
  assert.equal(m.previewReads, 0);
  assert.equal(m.applies, 0);
  return scope;
}
async function observe() {
  await enterButton(
    git().getByRole("button", { name: "Git 상태 새로고침", exact: true }),
  );
  await expect(git()).toHaveAttribute("data-git-review-state", "available");
}
async function edit(message = syntheticMessage) {
  const before = await metrics();
  await field("Commit 작성자 이름").fill(syntheticAuthor.name);
  await field("Commit 작성자 이메일").fill(syntheticAuthor.email);
  // HTML textarea normalizes CRLF. Use the actual editable text control and its
  // native input event; the preview must match the exact current control value.
  await field("Commit 메시지").fill(message);
  assert.deepEqual(
    await metrics(),
    before,
    "Editing never reads, stages or commits",
  );
  return field("Commit 메시지").inputValue();
}
async function readPreview(expected = "available") {
  const before = await metrics();
  await enterButton(previewButton());
  await expect(commit()).toHaveAttribute("data-git-commit-state", expected);
  await expect(status()).toBeFocused();
  assert.equal((await metrics()).previewReads, before.previewReads + 1);
  if (expected === "available") await expect(applyButton()).toBeEnabled();
  else await expect(applyButton()).toBeDisabled();
  return application.evaluate(
    () =>
      [...globalThis.__omocUiFixture.gitCommitPreviews.values()].at(-1)?.value,
  );
}
async function checkPreview(value) {
  assert.ok(value);
  for (const text of [
    value.workspacePath,
    value.treeOid,
    value.commitOid,
    value.previewDigest,
    value.indexDigest,
    value.treeDigest,
    value.commitBodyDigest,
    value.reference.digest,
    value.reference.nextDigest,
  ])
    await expect(metadata()).toContainText(text);
  for (const log of value.logs) {
    await expect(metadata()).toContainText(log.nextDigest);
    await expect(metadata()).toContainText(log.role);
  }
  await expect(entries().locator("li")).toHaveCount(value.entries.length);
  for (const row of value.entries) {
    await expect(entries()).toContainText(row.path);
    if (row.before) await expect(entries()).toContainText(row.before.oid);
    if (row.after) await expect(entries()).toContainText(row.after.oid);
  }
  assert.equal(await canonical().textContent(), value.canonicalMessage);
  assert.ok(value.canonicalMessage.startsWith("\ufeff"));
  assert.equal(await canonical().locator("script,img,a,iframe").count(), 0);
  assert.ok(
    (await selectable(canonical())).complete,
    "Exact canonical message selectable",
  );
}
// Capture EVERY semantic block of the relevant section, including all metadata,
// staged entries and operation results. Each PNG is the whole hidden native surface.
// Geometry and text hashes bind each coverage row to that actual current capture.
async function recordState(name, { theme = "light", narrow = false } = {}) {
  currentState = name;
  const before = await metrics();
  await page.evaluate((theme) => {
    globalThis.document.documentElement.dataset.theme = theme;
  }, theme);
  await setDisplay(page, narrow ? 760 : 1440, 1000, narrow ? 2 : 1);
  await openGitTray(page, "커밋");
  assert.ok(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth + 1,
    ),
    "No page horizontal overflow",
  );
  assert.ok(
    await commit().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "No Commit horizontal overflow",
  );
  surfaces.set(
    theme,
    await git().evaluate((e) => globalThis.getComputedStyle(e).backgroundColor),
  );
  const coverage = [];
  let previousSurface, surfaceCapture;
  // 진단 정보 holds the runtime identity rows; open it so every fact is inspected.
  await commit().evaluate((e) =>
    e.querySelectorAll("details").forEach((d) => (d.open = true)),
  );
  const blocks = commit().locator(
    "h4,h5,p,legend,label,select,input,textarea,button,dl dt,dl dd,pre,ol li strong,ol li div",
  );
  // The context above Commit is part of the evidence, including current workspace,
  // Git source and status. It must not be replaced by control-only images.
  await git()
    .locator(":scope > details")
    .evaluate((e) => {
      e.open = true;
    });
  const context = git().locator(
    ":scope > details dl dt,:scope > details dl dd",
  );
  for (const [kind, group] of [
    ["context", context],
    // The transient held hint may disappear after receipt reconciliation. Its
    // removal must not shift metadata locators; the persistent Git status is last.
    ["git-status", git().locator(':scope > p[role="status"]').last()],
    ["commit", blocks],
  ]) {
    for (const item of await group.all()) {
      await item.evaluate((e) => {
        const d = e.closest("details");
        if (d) d.open = true;
      });
      await expect(item).toBeVisible();
      await item.evaluate((e) =>
        e.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        }),
      );
      await expect(item).toBeInViewport({ ratio: 1 });
      const geometry = await item.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return {
          tag: e.tagName,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          viewport: {
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
          },
          text: e.textContent ?? "",
          surface: JSON.stringify({
            scrolls: [...globalThis.document.querySelectorAll("*")]
              .filter((n) => n.scrollTop || n.scrollLeft)
              .map((n) => [n.tagName, n.id, n.scrollTop, n.scrollLeft]),
            active: globalThis.document.activeElement?.outerHTML,
          }),
        };
      });
      assert.ok(
        geometry.x >= -1 &&
          geometry.y >= -1 &&
          geometry.x + geometry.width <= geometry.viewport.width + 1 &&
          geometry.y + geometry.height <= geometry.viewport.height + 1,
        "Complete evidence block must fit the captured viewport",
      );
      const file =
        "git-commit-" +
        ++serial +
        "-" +
        name +
        "-" +
        kind +
        "-" +
        theme +
        "-" +
        (narrow ? "760px200" : "desktop") +
        ".png";
      if (geometry.surface !== previousSurface) {
        await capture(page, file, name);
        surfaceCapture = screenshots.at(-1);
        previousSurface = geometry.surface;
      }
      const { text, ...bounds } = geometry;
      delete bounds.surface;
      coverage.push({
        kind,
        geometry: bounds,
        characters: text.length,
        textSha256: createHash("sha256").update(text).digest("hex"),
        capture: surfaceCapture.path,
        pngSha256: surfaceCapture.pngSha256,
        geometrySha256: createHash("sha256")
          .update(JSON.stringify(bounds))
          .digest("hex"),
      });
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(geometry.tag) &&
        (await item.isEnabled())
      ) {
        await item.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(item).toBeFocused();
        await page.keyboard.press("Escape");
        if (narrow) {
          // Escape belongs to the existing modal sheet, not Commit cancellation.
          await expect(commit()).toHaveCount(0);
          const opener = page.getByRole("button", {
            name: "보조 패널",
            exact: true,
          });
          await expect(opener).toBeFocused();
          await page.keyboard.press("Enter");
          await openGitTray(page, "커밋");
          await expect(commit()).toBeVisible();
          await item.focus();
        }
        await expect(item).toBeFocused();
      }
    }
  }
  const selection = [];
  for (const item of await commit()
    .locator("dl dd,pre,ol li strong,ol li div")
    .all())
    selection.push(await selectable(item));
  assert.ok(
    selection.every((s) => s.complete),
    "Full OIDs/digests/paths/message/backups selectable",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new globalThis.Event("focus")),
  );
  await page.waitForTimeout(1300);
  assert.deepEqual(
    await metrics(),
    before,
    "Theme/keyboard/layout/refocus/poll has no automatic Git IO",
  );
  states.push({
    state: name,
    theme,
    narrow,
    commitState: await commit().getAttribute("data-git-commit-state"),
    operationState: (await operation().count())
      ? await operation().getAttribute("data-git-commit-operation-state")
      : null,
    coverage,
    selection,
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
  provenanceBefore = await captureProvenance(root, { script: "git-commit" });
  application = await electron.launch({
    timeout: 20000,
    executablePath: require("electron"),
    args: [
      join(desktop, "scripts/fixtures/workbench-host.mjs"),
      "--user-data-dir=" + join(fixtureRoot, "electron-bootstrap-profile"),
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
  const childOutput = { stdoutBytes: 0, stderrBytes: 0 };
  for (const stream of ["stdout", "stderr"])
    processHandle[stream]?.on("data", (chunk) => {
      childOutput[stream + "Bytes"] = Math.min(
        1_000_000,
        childOutput[stream + "Bytes"] + chunk.length,
      );
    });
  observations.push({ childOutput });
  page = await application.firstWindow({ timeout: 20000 });
  page.on("pageerror", (error) => {
    if (errors.length < 10) errors.push(bounded(error));
  });
  await page.waitForURL(
    pathToFileURL(join(desktop, "dist/app/renderer/index.html")).href,
    { waitUntil: "load", timeout: 20000 },
  );
  const focus = process.env.OMOC_GIT_COMMIT_FOCUS ?? "all";
  assert.ok(["all", "settlement"].includes(focus));
  observations.push({ matrixScope: focus });
  if (focus === "all") {
    for (const name of [
      "ready",
      "sha256",
      "unborn",
      "detached",
      "packed",
      "disabled-existing-logs",
      "absent-logs",
      "new-logs",
      "full-staged-deletion",
    ]) {
      await openCase(name);
      await observe();
      const currentMessage = await edit();
      await openGitTray(page, "Stage");
      const selected = page
        .getByRole("region", { name: "선택한 Git index 변경", exact: true })
        .getByRole("checkbox", {
          name: "Index 경로 선택: notes/SYNTHETIC-editor.txt",
          exact: true,
        });
      await selected.check();
      await openGitTray(page, "커밋");
      assert.equal((await metrics()).indexApplies, 0);
      const value = await readPreview();
      await checkPreview(value);
      assert.equal(
        value.canonicalMessage,
        currentMessage.endsWith("\n") ? currentMessage : currentMessage + "\n",
      );
      assert.equal(
        value.entries.length,
        2,
        "Commit discloses all staged paths despite one selected index path",
      );
      if (name === "sha256") assert.equal(value.commitOid.length, 64);
      if (name === "unborn") assert.equal(value.headOid, null);
      if (name === "detached") assert.equal(value.reference.kind, "head");
      if (["packed", "unborn"].includes(name))
        assert.equal(value.reference.exists, false);
      if (name === "absent-logs") assert.equal(value.logs.length, 0);
      if (name === "full-staged-deletion")
        assert.ok(value.entries.every((e) => e.after === null));
      await recordState(name + "-preview", { theme: "light" });
      await recordState(name + "-preview-dark", {
        theme: "dark",
        narrow: true,
      });
      await enterButton(applyButton());
      await expect(operation()).toHaveAttribute(
        "data-git-commit-operation-state",
        "accepted",
      );
      await expect(applyButton()).toBeDisabled();
      await expect(commit()).toHaveAttribute("data-git-commit-state", "stale");
      await expect(results()).toContainText(value.commitOid);
      const m = await metrics();
      assert.equal(m.applies, 1);
      assert.equal(m.effects, 1);
      assert.equal(m.previewReads, 1);
      assert.equal(m.statusReads, 1);
      assert.equal(
        m.backups,
        value.logs.filter((x) => x.exists).length +
          Number(value.reference.exists),
      );
      await recordState(name + "-committed", { theme: "dark", narrow: true });
      await observe();
      assert.equal(
        (await metrics()).statusReads,
        2,
        "Success needs a new explicit Git read",
      );
    }
    for (const name of ["no_changes", "unsupported_commit_state"]) {
      await openCase(name);
      await observe();
      await edit();
      await readPreview("unavailable");
      await recordState("unavailable-" + name, { theme: "dark", narrow: true });
      assert.equal((await metrics()).applies, 0);
    }
    for (const outcome of [
      "denied",
      "unknown",
      "expired_preview",
      "stale_preview",
      "lock_conflict",
      "unsupported_commit_state",
    ]) {
      await openCase();
      await observe();
      await edit();
      await readPreview();
      await application.evaluate((_electron, outcome) => {
        globalThis.__omocUiFixture.nextGitCommitApply = outcome;
      }, outcome);
      await enterButton(applyButton());
      await expect(operation()).toHaveAttribute(
        "data-git-commit-operation-state",
        outcome === "unknown" ? "unknown" : "failed",
      );
      await recordState("apply-" + outcome, { theme: "light", narrow: true });
      assert.equal((await metrics()).effects, 0);
      if (outcome === "unknown") {
        await field("Commit 메시지").fill("SYNTHETIC unknown held editable");
        await expect(field("Commit 메시지")).toHaveValue(
          "SYNTHETIC unknown held editable",
        );
        await expect(applyButton()).toBeDisabled();
        await expect
          .poll(() =>
            application.evaluate(
              () => globalThis.__omocUiFixture.lookupEnvelopes.length,
            ),
          )
          .toBeGreaterThan(0);
        const lookup = await application.evaluate(() => {
          const f = globalThis.__omocUiFixture;
          return {
            epoch: f.snapshot.runtimeEpoch,
            intent: f.intents.at(-1),
            envelopes: f.lookupEnvelopes,
          };
        });
        assert.ok(
          lookup.envelopes.every(
            (e) =>
              e.runtimeEpoch === lookup.epoch &&
              e.operation.runtimeEpoch === lookup.intent.runtimeEpoch &&
              e.operation.operationId === lookup.intent.operationId,
          ),
        );
        assert.equal((await metrics()).applies, 1);
      }
    }
    await openCase("pending-preview");
    await observe();
    await edit();
    await enterButton(previewButton());
    await expect(commit()).toHaveAttribute("data-git-commit-state", "loading");
    // Escape has no cancellation binding in the frozen Commit section. Verify it
    // preserves focus and pending IO, then use the actual explicit cancel control.
    await cancelButton().focus();
    await page.keyboard.press("Escape");
    await expect(cancelButton()).toBeFocused();
    assert.equal((await metrics()).heldReads, 1);
    await recordState("pending-preview", { theme: "dark", narrow: true });
    await enterButton(cancelButton());
    await expect(status()).toBeFocused();
    await expect(applyButton()).toBeDisabled();
    assert.equal((await metrics()).heldReads, 1);
    await application.evaluate(() =>
      globalThis.__omocUiFixture.releaseGitCommitReads(),
    );
    await expect.poll(async () => (await metrics()).heldReads).toBe(0);
    await expect(applyButton()).toBeDisabled();
    await readPreview();
    observations.push({
      cancelledReadLateReplyIgnored: true,
      escape: "Focus preserved; cancellation uses explicit frozen control",
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
      await edit();
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
          f.snapshot.runtimeEpoch = "synthetic-replacement-commit-epoch";
        if (boundary === "root") w.path = "/synthetic/replaced-commit-root";
        f.snapshot.revision++;
      }, boundary);
      await expect(commit()).toHaveAttribute("data-git-commit-state", "stale", {
        timeout: 10000,
      });
      await expect(applyButton()).toBeDisabled();
      if (["root", "epoch"].includes(boundary)) {
        const draftSelect = field("보존한 Commit 초안");
        const old = await draftSelect
          .locator("option")
          .evaluateAll((options) => options.find((o) => o.value)?.value);
        assert.ok(old);
        await draftSelect.selectOption(old);
        await expect(commit()).toContainText(
          "보존한 초안은 편집과 복사만 가능합니다",
        );
      }
      await field("Commit 메시지").fill("SYNTHETIC historical editable");
      await expect(field("Commit 메시지")).toHaveValue(
        "SYNTHETIC historical editable",
      );
      await expect(previewButton()).toBeDisabled();
      await recordState("historical-" + boundary, {
        theme: "dark",
        narrow: true,
      });
      assert.equal((await metrics()).applies, 0);
    }
    await openCase("retained");
    await expect(previewButton()).toBeDisabled();
    await expect
      .poll(() =>
        application.evaluate(
          () => globalThis.__omocUiFixture.lookupEnvelopes.length,
        ),
      )
      .toBeGreaterThan(0);
    const retained = await application.evaluate(() => {
      const f = globalThis.__omocUiFixture;
      return {
        key: f.gitCommitRetainedKey,
        epoch: f.snapshot.runtimeEpoch,
        envelopes: f.lookupEnvelopes,
      };
    });
    assert.ok(
      retained.envelopes.every(
        (e) =>
          e.runtimeEpoch === retained.epoch &&
          e.operation.runtimeEpoch === retained.key.runtimeEpoch &&
          e.operation.operationId === retained.key.operationId,
      ),
    );
    await field("Commit 메시지").fill("SYNTHETIC retained editable");
    await recordState("retained-original-key", {
      theme: "light",
      narrow: true,
    });
    assert.equal((await metrics()).applies, 0);
  }
  for (const boundary of ["newer-draft", "workspace", "root", "epoch"]) {
    await openCase();
    await observe();
    await edit();
    await readPreview();
    await application.evaluate(() => {
      globalThis.__omocUiFixture.holdGitCommitApply = true;
    });
    await enterButton(applyButton());
    await expect(operation()).toHaveAttribute(
      "data-git-commit-operation-state",
      "pending",
    );
    await expect.poll(async () => (await metrics()).heldCalls).toBe(1);
    await application.evaluate(() =>
      globalThis.__omocUiFixture.confirmGitCommitApplies(),
    );
    // Poll the saved receipt through the real preload; the held apply call stays pending.
    await expect(operation()).toHaveAttribute(
      "data-git-commit-operation-state",
      "accepted",
      { timeout: 10000 },
    );
    assert.equal((await metrics()).heldCalls, 1);
    await expect(previewButton()).toBeDisabled();
    await expect(results()).toContainText("원래 호출이 끝날 때까지 IO 보류");
    await recordState("receipt-before-finally-" + boundary, {
      theme: "dark",
      narrow: true,
    });
    if (boundary === "workspace") {
      await setDisplay(page, 1440, 1000, 1);
      await selectWorkspace(page, "synthetic-index-other-w");
      await page.getByRole("tab", { name: "파일", exact: true }).click();
      await expect(
        page
          .getByTitle("SYNTHETIC selectable other draft", { exact: true })
          .first(),
      ).toBeVisible();
    }
    if (["root", "epoch"].includes(boundary)) {
      await application.evaluate((_electron, boundary) => {
        const f = globalThis.__omocUiFixture;
        if (boundary === "root")
          f.snapshot.workspaces[0].path = "/synthetic/late-commit-root";
        else f.snapshot.runtimeEpoch = "synthetic-late-commit-epoch";
        f.snapshot.revision++;
      }, boundary);
      await expect(previewButton()).toBeDisabled();
      // Wait for the current snapshot to expose an empty new-scope draft.
      await expect(field("Commit 메시지")).toHaveValue("", { timeout: 10000 });
    }
    await openGitTray(page, "커밋");
    await field("Commit 메시지").fill("SYNTHETIC newer independent draft");
    await application.evaluate(() =>
      globalThis.__omocUiFixture.releaseGitCommitApplies(),
    );
    await expect.poll(async () => (await metrics()).heldCalls).toBe(0);
    // The host map can settle before the Renderer receives the reply/finally.
    await expect(results()).not.toContainText(
      "원래 호출이 끝날 때까지 IO 보류",
    );
    // Only the unchanged selected scope asserts readiness. Other scopes retain
    // their actual authority/hold state; a late ACK must not manufacture readiness.
    if (boundary === "newer-draft")
      await expect(
        git().getByRole("button", { name: "Git 상태 새로고침", exact: true }),
      ).toBeEnabled({ timeout: 10000 });
    observations.push({
      settledBoundary: boundary,
      rendererIoSettled: true,
      selectedScopeReadReady: await git()
        .getByRole("button", { name: "Git 상태 새로고침", exact: true })
        .isEnabled(),
      contextBlocks: await git()
        .locator(
          ':scope > details dl dt,:scope > details dl dd,:scope > p[role="status"]',
        )
        .count(),
    });
    await expect(field("Commit 메시지")).toHaveValue(
      "SYNTHETIC newer independent draft",
    );
    assert.equal((await metrics()).applies, 1);
    assert.equal((await metrics()).effects, 1);
    await recordState("late-ack-" + boundary, { theme: "light", narrow: true });
  }
  assert.notEqual(surfaces.get("light"), surfaces.get("dark"));
  assert.deepEqual(errors, []);
  assert.ok(
    screenshots.length > 0 && states.every((s) => s.coverage.length > 0),
  );
  observations.push({
    confirmation:
      "Explicit synthetic decision only; actual Main Native dialog not established",
    lifetime:
      "Owned synthetic Electron exit only; actual Event Host OS lifetime not established",
    canonicalInput:
      "Built HTML textarea input uses its current DOM value; byte-exact BOM/CRLF is separately proven through actual controller Node tests",
  });
} catch (error) {
  failure = error;
  if (page && !page.isClosed())
    try {
      await capture(
        page,
        "git-commit-failure.png",
        "Failure during " + currentState,
      );
    } catch (error) {
      observations.push({ failureCaptureError: bounded(error) });
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
        () => reject(new Error("Synthetic Commit host exit unconfirmed")),
        15000,
      );
    });
    if (processHandle.exitCode === null && processHandle.signalCode === null)
      await Promise.race([
        application
          .evaluate(({ app }) => app.quit())
          .catch((error) => observations.push({ quitRpc: bounded(error) })),
        deadline,
      ]);
    const [code, signal] = await Promise.race([exited, deadline]);
    assert.equal(code, 0, "Owned synthetic host must exit normally");
    teardown = { exited: true, code: 0, signal, retainedRoot: fixtureRoot };
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
    provenanceAfter = await captureProvenance(root, { script: "git-commit" });
    assert.deepEqual(
      provenanceAfter,
      provenanceBefore,
      "Source/build/selected runner identities changed during evidence run",
    );
  } catch (error) {
    failure ??= error;
  }
  // Retain failed namespaces even if the owned child exited. Cleanup follows
  // BOTH actual owned exit0 and the final unchanged source/build provenance check.
  if (!failure && teardown.exited && teardown.code === 0) {
    try {
      await rm(fixtureRoot, { recursive: true, force: false });
      teardown = { exited: true, code: 0 };
    } catch (error) {
      failure = error;
      teardown = {
        ...teardown,
        error: bounded(error),
        retainedRoot: fixtureRoot,
      };
    }
  }
}
const report = {
  result: failure ? "fail" : "pass",
  platform: process.platform,
  provenance:
    "Built Renderer/preload with test-only synthetic Main through git-commit wrapper",
  providerExecution: "not performed",
  actualPublication: "not established",
  actualMainConfirmation: "not established",
  actualEventHostOSLifetime: "not established",
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
  join(run, "git-commit-evidence.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
if (failure) {
  console.error(
    "Commit evidence failed in " + currentState + ": " + bounded(failure),
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      result: "pass",
      report: join(run, "git-commit-evidence.json"),
      states: states.length,
      captures: screenshots.length,
      teardown,
    }),
  );
