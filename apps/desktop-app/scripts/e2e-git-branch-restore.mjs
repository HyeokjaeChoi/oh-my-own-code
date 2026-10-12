// Focused explicit branch/restore evidence. Execute only through run-evidence --script git-branch-restore.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    "Use run-evidence.mjs --script git-branch-restore --out <fresh-directory>",
  );
const run = resolve(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(
  claim.isFile() && !claim.isSymbolicLink(),
  "Evidence wrapper claim required",
);

const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-git-branch-restore-")),
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
const section = () =>
  page.getByRole("region", {
    name: "Branch 생성·선택과 파일 복원",
    exact: true,
  });
const control = (name) =>
  section().locator(`[data-git-branch-restore-control="${name}"]`);
const command = (name) =>
  section().locator(`[data-git-branch-restore-command="${name}"]`);
const status = () => section().locator("[data-git-branch-restore-status]");
const preview = () => section().locator("[data-git-branch-restore-preview]");
const results = () => section().locator("[data-git-branch-restore-result]");
const syntheticAuthor = {
  name: "SYNTHETIC 작성자",
  email: "synthetic@example.invalid",
};
const surfaces = new Map();
async function metrics() {
  return application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    return {
      statusReads: f.gitReads.filter(
        (r) => r.operation.type === "git.review.read",
      ).length,
      previewReads: f.gitBranchRestoreReads.length,
      applies: f.requests.filter((r) =>
        ["git.branch.apply", "git.restore.apply"].includes(r.type),
      ).length,
      rejectedApplies: [...f.retainedReceipts.values()].filter(
        ({ receipt }) =>
          ["git.branch.apply", "git.restore.apply"].includes(receipt.type) &&
          receipt.admission === "rejected" &&
          receipt.effect === "none" &&
          receipt.result?.kind === "rejected",
      ).length,
      effects: f.gitBranchRestoreEffects.length,
      backups: f.syntheticGitBranchRestoreBackups.size,
      heldCalls: f.pendingGitBranchRestoreWorkspaces.size,
      heldReads: f.pendingGitBranchRestoreReadWorkspaces.size,
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
    (_electron, name) =>
      globalThis.__omocUiFixture.setGitBranchRestoreState(name),
    name,
  );
  await page.reload();
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  await expect(section()).toBeVisible();
  await expect(control("name")).toHaveValue("");
  await expect(control("email")).toHaveValue("");
  assert.deepEqual(await metrics(), {
    statusReads: 0,
    previewReads: 0,
    applies: 0,
    rejectedApplies: 0,
    effects: 0,
    backups: 0,
    heldCalls: 0,
    heldReads: 0,
  });
  return scope;
}
async function observe() {
  await enterButton(
    git().getByRole("button", { name: "Git 상태 새로고침", exact: true }),
  );
  await expect(git()).toHaveAttribute("data-git-review-state", "available");
}
async function edit(action = "create", source = "head", paths = []) {
  const before = await metrics();
  await control("action").selectOption(action);
  if (action === "restore") {
    await control("source").selectOption(source);
    await control("paths").fill(paths.join("\n"));
  } else {
    await control("branch").fill(
      action === "create"
        ? "refs/heads/SYNTHETIC-new"
        : "refs/heads/review/diverged-local-tip",
    );
    await control("name").fill(syntheticAuthor.name);
    await control("email").fill(syntheticAuthor.email);
  }
  assert.deepEqual(
    await metrics(),
    before,
    "Draft editing does not read or apply",
  );
}
async function readPreview() {
  const before = await metrics();
  await enterButton(command("preview"));
  await expect(section()).toHaveAttribute(
    "data-git-branch-restore-state",
    "available",
  );
  await expect(status()).toBeFocused();
  await expect(command("apply")).toBeEnabled();
  assert.equal((await metrics()).previewReads, before.previewReads + 1);
  assert.equal((await metrics()).applies, before.applies);
  const value = await application.evaluate(
    () =>
      [...globalThis.__omocUiFixture.gitBranchRestorePreviews.values()].at(-1)
        ?.value,
  );
  assert.ok(value, "Actual consumed synthetic preview required");
  for (const key of [
    "previewId",
    "previewDigest",
    "occupancyDigest",
    "headOid",
    "nextHeadOid",
    "treeOid",
    "headDigest",
    "indexDigest",
  ])
    await expect(preview()).toContainText(value[key]);
  await expect(section().locator("[data-git-branch-restore-path]")).toHaveCount(
    value.paths.length,
  );
  for (const p of value.paths) {
    const row = section()
      .locator("[data-git-branch-restore-path]")
      .filter({ hasText: p.path });
    for (const text of [
      p.path,
      p.before?.digest,
      p.after?.digest,
      p.beforeEntry?.oid,
      p.afterEntry?.oid,
    ].filter(Boolean))
      await expect(row).toContainText(text);
  }
  await expect(
    section().locator("[data-git-branch-restore-metadata]"),
  ).toHaveCount(value.metadata.length);
  for (const m of value.metadata) {
    const row = section().locator(
      `[data-git-branch-restore-metadata="${m.role}"]`,
    );
    await expect(row).toContainText(m.after.digest);
    if (m.before) await expect(row).toContainText(m.before.digest);
  }
  return value;
}
// Capture all semantic blocks, context, full paths, metadata, loss and results.
// Each coverage row binds a visible full block to an exclusive native PNG.
async function recordState(name, { theme = "light", narrow = false } = {}) {
  currentState = name;
  const before = await metrics();
  await page.evaluate((theme) => {
    globalThis.document.documentElement.dataset.theme = theme;
  }, theme);
  await setDisplay(page, narrow ? 760 : 1440, 1000, narrow ? 2 : 1);
  assert.ok(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth + 1,
    ),
    "No page horizontal overflow",
  );
  assert.ok(
    await section().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "No branch/restore horizontal overflow",
  );
  surfaces.set(
    theme,
    await git().evaluate((e) => globalThis.getComputedStyle(e).backgroundColor),
  );
  const coverage = [];
  let previousSurface, surfaceCapture;
  const groups = [
    ["context", git().locator(":scope > dl dt,:scope > dl dd")],
    ["git-status", git().locator(':scope > p[role="status"]').last()],
    [
      "branch-restore",
      section().locator(
        "h4,p,legend,label,select,input,textarea,button,dl dt,dl dd",
      ),
    ],
  ];
  for (const [kind, group] of groups)
    for (const item of await group.all()) {
      await expect(item).toBeVisible();
      await item.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const points = [
          [r.left + 1, r.top + 1],
          [r.right - 1, r.top + 1],
          [r.left + 1, r.bottom - 1],
          [r.right - 1, r.bottom - 1],
          [r.left + r.width / 2, r.top + r.height / 2],
        ];
        const complete =
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= globalThis.innerWidth &&
          r.bottom <= globalThis.innerHeight &&
          points.every(([x, y]) =>
            e.contains(e.ownerDocument.elementFromPoint(x, y)),
          );
        // Keep the exact current surface when it already contains the full,
        // unoccluded block. All viewport, PNG, focus and selection checks below
        // still run for every block; only redundant centered scrolling is gone.
        if (!complete)
          e.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
      });
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
      const file = `git-branch-restore-${++serial}-${name}-${kind}-${theme}-${narrow ? "760px200" : "desktop"}.png`;
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
          await expect(section()).toHaveCount(0);
          const opener = page.getByRole("button", {
            name: "파일·확장",
            exact: true,
          });
          await expect(opener).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(section()).toBeVisible();
          await item.focus();
        }
        await expect(item).toBeFocused();
      }
    }
  const selection = [];
  for (const item of await section()
    .locator("dl dd,[data-git-branch-restore-path] > p")
    .all())
    selection.push(await selectable(item));
  assert.ok(
    selection.every((s) => s.complete),
    "Full paths/digests/loss/backups selectable",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new globalThis.Event("focus")),
  );
  await page.waitForTimeout(1300);
  assert.deepEqual(
    await metrics(),
    before,
    "Theme/keyboard/layout/refocus/poll never performs automatic Git IO",
  );
  states.push({
    state: name,
    theme,
    narrow,
    branchRestoreState: await section().getAttribute(
      "data-git-branch-restore-state",
    ),
    operationStates: await results().evaluateAll((es) =>
      es.map((e) => e.dataset.gitBranchRestoreResult),
    ),
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
  provenanceBefore = await captureProvenance(root, {
    script: "git-branch-restore",
  });
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
  for (const action of ["create", "select", "restore-index", "restore-head"]) {
    const restore = action.startsWith("restore"),
      scope = await openCase(restore ? "restore-changes" : "ready");
    await observe();
    await edit(
      restore ? "restore" : action,
      action === "restore-index" ? "index" : "head",
      scope.paths,
    );
    const value = await readPreview();
    await expect(section()).toContainText("실제 checkout");
    for (const theme of ["light", "dark"])
      for (const narrow of [false, true])
        await recordState("preview-" + action, { theme, narrow });
    await enterButton(command("apply"));
    await expect(results().last()).toHaveAttribute(
      "data-git-branch-restore-result",
      "applied",
    );
    await expect(command("apply")).toBeDisabled();
    await expect(
      section().locator("[data-git-branch-restore-io-held]").last(),
    ).toContainText("Renderer 호출 종료");
    assert.equal((await metrics()).effects, 1);
    assert.equal((await metrics()).statusReads, 1);
    const completed = await application.evaluate(() => {
      const f = globalThis.__omocUiFixture;
      return [...f.retainedReceipts.values()].find(
        (r) => r.receipt.result?.kind === "git_branch_restore_applied",
      )?.receipt;
    });
    assert.ok(completed);
    assert.equal(completed.result.action, value.action);
    for (const b of completed.result.backups)
      if (b.backupId) await expect(results().last()).toContainText(b.backupId);
    await recordState("success-" + action, { theme: "dark", narrow: true });
    await observe();
    assert.equal((await metrics()).statusReads, 2);
    observations.push({
      action,
      successInvalidated: true,
      newExplicitRead: true,
      confirmation: "synthetic only",
    });
  }
  for (const [name, action] of [
    ["dirty", "select"],
    ["branch_occupied", "select"],
    ["branch_conflict", "select"],
    ["protected_source", "select"],
    ["unsupported_configuration", "create"],
    ["unsupported_branch_restore_state", "create"],
    ["unborn", "create"],
  ]) {
    await openCase(name);
    await observe();
    await edit(action);
    await enterButton(command("preview"));
    await expect(section()).toHaveAttribute(
      "data-git-branch-restore-state",
      "unavailable",
    );
    await expect(command("apply")).toBeDisabled();
    await expect(status()).toBeFocused();
    await recordState("refusal-" + name, { theme: "dark", narrow: true });
    assert.equal((await metrics()).effects, 0);
    assert.equal((await metrics()).applies, 0);
  }
  for (const name of ["denied", "unknown"]) {
    await openCase(name);
    await observe();
    await edit();
    await readPreview();
    await enterButton(command("apply"));
    await expect(results().last()).toHaveAttribute(
      "data-git-branch-restore-result",
      name === "denied" ? "denied" : "unknown",
    );
    assert.equal((await metrics()).effects, 0);
    assert.equal((await metrics()).applies, name === "denied" ? 0 : 1);
    assert.equal((await metrics()).rejectedApplies, name === "denied" ? 1 : 0);
    await control("branch").fill("refs/heads/SYNTHETIC-still-editable");
    await expect(command("apply")).toBeDisabled();
    await recordState(name, { theme: "light", narrow: true });
    if (name === "unknown") {
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
          key: f.intents.at(-1),
          envelopes: f.lookupEnvelopes,
        };
      });
      assert.ok(
        lookup.envelopes.every(
          (e) =>
            e.runtimeEpoch === lookup.epoch &&
            e.operation.runtimeEpoch === lookup.key.runtimeEpoch &&
            e.operation.operationId === lookup.key.operationId,
        ),
      );
    }
  }
  await openCase("pending-preview");
  await observe();
  await edit();
  await enterButton(command("preview"));
  await expect(section()).toHaveAttribute(
    "data-git-branch-restore-state",
    "reading",
  );
  await enterButton(command("cancel-preview"));
  assert.equal((await metrics()).heldReads, 1);
  await expect(command("apply")).toBeDisabled();
  await recordState("cancelled-preview-held", { theme: "dark", narrow: true });
  await application.evaluate(() =>
    globalThis.__omocUiFixture.releaseGitBranchRestoreReads(),
  );
  await expect.poll(async () => (await metrics()).heldReads).toBe(0);
  await expect(command("apply")).toBeDisabled();
  await readPreview();
  for (const boundary of [
    "held",
    "global-held",
    "untrusted",
    "root",
    "epoch",
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
      if (boundary === "root") w.path = "/synthetic/replaced-branch-root";
      if (boundary === "epoch")
        f.snapshot.runtimeEpoch = "synthetic-replacement-branch-epoch";
      f.snapshot.revision++;
    }, boundary);
    await expect(command("apply")).toBeDisabled({ timeout: 10000 });
    if (["root", "epoch"].includes(boundary)) {
      const draft = section().locator("[data-git-branch-restore-draft]");
      await expect
        .poll(() => draft.locator("option").count())
        .toBeGreaterThan(1);
      const old = await draft
        .locator("option")
        .evaluateAll((options) => options.find((o) => o.value)?.value);
      assert.ok(old);
      await draft.selectOption(old);
    }
    await control("branch").fill("refs/heads/SYNTHETIC-historical-editable");
    await expect(control("branch")).toHaveValue(
      "refs/heads/SYNTHETIC-historical-editable",
    );
    await expect(command("preview")).toBeDisabled();
    await recordState("historical-" + boundary, {
      theme: "dark",
      narrow: true,
    });
    assert.equal((await metrics()).applies, 0);
  }
  await openCase("retained");
  await expect(command("preview")).toBeDisabled();
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
      key: f.gitBranchRestoreRetainedKey,
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
  await control("branch").fill("refs/heads/SYNTHETIC-retained-editable");
  await recordState("retained-original-key", { theme: "light", narrow: true });
  assert.equal((await metrics()).applies, 0);
  for (const boundary of ["newer-draft", "workspace", "root", "epoch"]) {
    await openCase();
    await observe();
    await edit();
    await readPreview();
    await application.evaluate(() => {
      globalThis.__omocUiFixture.holdGitBranchRestoreApply = true;
    });
    await enterButton(command("apply"));
    await expect.poll(async () => (await metrics()).heldCalls).toBe(1);
    await expect(results().last()).toHaveAttribute(
      "data-git-branch-restore-result",
      "pending",
    );
    await application.evaluate(() =>
      globalThis.__omocUiFixture.confirmGitBranchRestoreApplies(),
    );
    await expect(results().last()).toHaveAttribute(
      "data-git-branch-restore-result",
      "applied",
      { timeout: 10000 },
    );
    assert.equal((await metrics()).heldCalls, 1);
    await expect(
      section().locator("[data-git-branch-restore-io-held]").last(),
    ).toContainText("호출 종료 대기");
    await expect(command("preview")).toBeDisabled();
    await recordState("receipt-before-finally-" + boundary, {
      theme: "dark",
      narrow: true,
    });
    if (boundary === "workspace") {
      await setDisplay(page, 1440, 1000, 1);
      await page
        .getByLabel("작업 공간", { exact: true })
        .selectOption("synthetic-index-other-w");
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
          f.snapshot.workspaces[0].path = "/synthetic/late-branch-root";
        else f.snapshot.runtimeEpoch = "synthetic-late-branch-epoch";
        f.snapshot.revision++;
      }, boundary);
      await expect(control("branch")).toHaveValue("", { timeout: 10000 });
    }
    await control("branch").fill("refs/heads/SYNTHETIC-newer-draft");
    await application.evaluate(() =>
      globalThis.__omocUiFixture.releaseGitBranchRestoreApplies(),
    );
    await expect.poll(async () => (await metrics()).heldCalls).toBe(0);
    await expect(
      section().locator("[data-git-branch-restore-io-held]").last(),
    ).toContainText("Renderer 호출 종료");
    await expect(control("branch")).toHaveValue(
      "refs/heads/SYNTHETIC-newer-draft",
    );
    assert.equal((await metrics()).applies, 1);
    assert.equal((await metrics()).effects, 1);
    await recordState("late-ack-" + boundary, { theme: "light", narrow: true });
  }
  assert.notEqual(surfaces.get("light"), surfaces.get("dark"));
  assert.deepEqual(errors, []);
  assert.ok(
    screenshots.length > 0 &&
      states.every((s) => s.coverage.some((c) => c.kind === "branch-restore")),
  );
  observations.push({
    confirmation:
      "Explicit synthetic decision only; actual Main Native dialog not established",
    lifetime:
      "Owned synthetic Electron exit only; actual EventHost OS lifetime not established",
    publication: "Synthetic maps do not establish Git/kernel/journal IO",
  });
} catch (error) {
  failure = error;
  if (page && !page.isClosed())
    try {
      await capture(
        page,
        "git-branch-restore-failure.png",
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
        () =>
          reject(new Error("Synthetic Branch/restore host exit unconfirmed")),
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
    provenanceAfter = await captureProvenance(root, {
      script: "git-branch-restore",
    });
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
    "Built Renderer/preload with test-only synthetic Main through git-branch-restore wrapper",
  providerExecution: "not performed",
  actualPublication: "not established",
  actualMainConfirmation: "not established",
  actualEventHostOSLifetime: "not established",
  fixtureRoot,
  state: currentState,
  states,
  observations,
  pageErrors: errors,
  screenshots,
  teardown,
  sourceBuildProvenance: { before: provenanceBefore, after: provenanceAfter },
  ...(failure && { error: bounded(failure) }),
};
await writeFile(
  join(run, "git-branch-restore-evidence.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
if (failure) {
  console.error(
    "Branch/restore evidence failed in " +
      currentState +
      ": " +
      bounded(failure),
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      result: "pass",
      report: join(run, "git-branch-restore-evidence.json"),
      states: states.length,
      captures: screenshots.length,
      teardown,
    }),
  );
