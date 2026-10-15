// Execute only through the fixed conversation-markdown evidence wrapper.
import assert from "node:assert/strict";
import { e2ePath } from "./e2e-env.mjs";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { captureProvenance } from "./build-provenance.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
if (!process.env.OMOC_EVIDENCE_DIR)
  throw Error("Use fixed conversation-markdown run-evidence selector");
const run = await realpath(process.env.OMOC_EVIDENCE_DIR);
const claim = await lstat(join(run, ".run-evidence-claim"));
assert.ok(claim.isFile() && !claim.isSymbolicLink());
const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-markdown-ui-")),
);
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
let teardown = { exited: false, retainedRoot: fixtureRoot };
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

const code = 'const 한글 = "값";\n' + "x".repeat(240) + "\n";
const rich =
  "# Markdown 표시\n\n**굵게** *기울임* ~~이전~~ `inline`\n\n> 인용문\n\n1. 순서 하나\n2. 순서 둘\n\n- [x] 확인\n- [ ] 대기\n\n[합성 주소](https://example.invalid/long/" +
  "segment/".repeat(8) +
  ")\n\n![대체 이미지](https://remote.invalid/tracker.png)\n\n<script>globalThis.__unsafe=true</script>\n\n```typescript\n" +
  code +
  "```\n\n| 이름 | 긴 내용 |\n| --- | --- |\n| SYNTHETIC | " +
  "tablevalue".repeat(50) +
  " |";
async function messages(text, status = "idle", role = "assistant") {
  await application.evaluate(
    (_e, { text, status, role }) => {
      const f = globalThis.__omocUiFixture;
      f.snapshot.sessions[0].status = status;
      const m = { id: "markdown-a", role, text, tools: [] };
      f.snapshot.messages = [m];
      f.sessionMessages.set("fixture-s", [m]);
      f.snapshot.revision++;
      f.snapshot.observationSequence++;
    },
    { text, status, role },
  );
}
async function clipboard(mode = "success") {
  await page.evaluate((mode) => {
    const control = { mode, writes: [], settle: undefined };
    globalThis.__markdownClipboard = control;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value:
        mode === "absent"
          ? undefined
          : {
              writeText(text) {
                control.writes.push(text);
                if (control.mode === "reject")
                  return Promise.reject(Error("synthetic denied"));
                if (control.mode === "throw") throw Error("synthetic thrown");
                if (control.mode === "pending")
                  return new Promise((resolve, reject) => {
                    control.settle = { resolve, reject };
                  });
                return Promise.resolve();
              },
            },
    });
  }, mode);
}
const copies = () =>
  page.getByRole("button", { name: "표시된 메시지 복사", exact: true });
const codeCopy = () =>
  page.getByRole("button", { name: "코드 복사", exact: true });
const status = () =>
  page.locator("[data-copy-control=message] [data-copy-status]");
async function enter(button) {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}
async function shot(name) {
  currentState = name;
  // DOM assertions can resolve before Chromium paints the new copy status.
  // Let two animation frames finish, then yield past the last pre-paint callback.
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
async function reveal(locator, ratio = 0.9) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  await locator.evaluate((e) =>
    e.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  await expect(locator).toBeInViewport({ ratio });
}
async function noOverflow() {
  const geometry = await page.evaluate(() => ({
    page: globalThis.document.documentElement.scrollWidth,
    width: window.innerWidth,
    conversation: globalThis.document
      .querySelector("[data-conversation]")
      ?.getBoundingClientRect().width,
    code: [...globalThis.document.querySelectorAll("[data-markdown-code]")].map(
      (e) => ({
        client: e.clientWidth,
        scroll: e.scrollWidth,
        selection: globalThis.getComputedStyle(e).userSelect,
      }),
    ),
    tables: [
      ...globalThis.document.querySelectorAll("[data-markdown-table]"),
    ].map((e) => ({ client: e.clientWidth, scroll: e.scrollWidth })),
  }));
  assert.ok(geometry.page <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.code.length);
  return geometry;
}
try {
  before = await captureProvenance(root, { script: "conversation-markdown" });
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
  page.on("pageerror", (e) => errors.push(bounded(e)));
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  await expect(
    page.locator(".workbench-header [data-connection]"),
  ).toHaveAttribute("data-connection", "connected");
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.enablePerformanceSessions();
    f.snapshot.permissions = [];
    f.sessionMessages.set("fixture-p6-b", [
      {
        id: "markdown-a",
        role: "assistant",
        text: "다른 세션의 같은 ID",
        tools: [],
      },
    ]);
  });
  await messages(rich);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Markdown 표시", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page
      .locator(
        ".transcript img,.transcript iframe,.transcript script,.transcript a[href]",
      )
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => globalThis.__unsafe === true), false);
  await expect(page.locator("[data-markdown-image]")).toContainText(
    "대체 이미지",
  );
  await expect(page.locator("[data-markdown-link]")).toContainText(
    "https://example.invalid/long/",
  );
  for (const input of await page
    .locator(".transcript input[type=checkbox]")
    .all())
    await expect(input).toBeDisabled();
  await clipboard();
  await enter(codeCopy());
  await expect(
    page.locator("[data-copy-control=code] [data-copy-status]"),
  ).toHaveText("복사했습니다.");
  assert.deepEqual(
    await page.evaluate(() => globalThis.__markdownClipboard.writes),
    [code],
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await codeCopy().evaluate((e) => e === globalThis.document.activeElement),
    false,
  );
  await page.keyboard.press("Shift+Tab");
  await expect(codeCopy()).toBeFocused();
  await shot("code-copy-keyboard");
  await clipboard();
  await enter(copies());
  assert.deepEqual(
    await page.evaluate(() => globalThis.__markdownClipboard.writes),
    [rich],
  );
  await shot("message-copy");
  for (const theme of ["light", "dark"])
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
      await reveal(
        page.getByRole("heading", { name: "Markdown 표시", exact: true }),
      );
      await noOverflow();
      await shot(`${theme}-${width}-zoom${zoom}-prose`);
      await reveal(codeCopy());
      await expect(page.locator("[data-markdown-code]")).toBeInViewport({
        ratio: 0.5,
      });
      const selected = await page
        .locator("[data-markdown-code] code")
        .evaluate((e) => {
          const range = globalThis.document.createRange();
          range.selectNodeContents(e);
          const selection = globalThis.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const value = selection.getRangeAt(0).cloneContents().textContent;
          selection.removeAllRanges();
          return value;
        });
      assert.equal(selected, code);
      await shot(`${theme}-${width}-zoom${zoom}-code`);
      await reveal(page.locator("[data-markdown-table] th").first());
      await shot(`${theme}-${width}-zoom${zoom}-table`);
    }
  await setDisplay(page, 1440, 1000, 1);
  for (const mode of ["reject", "absent", "throw"]) {
    await clipboard(mode);
    await enter(copies());
    await expect(status().first()).toHaveText(
      "복사하지 못했습니다. 텍스트를 선택해 복사해 주세요.",
    );
    await shot(`clipboard-${mode}`);
  }
  await clipboard("pending");
  await enter(copies());
  await expect(copies()).toBeDisabled();
  await expect(status().first()).toHaveText("복사 중입니다.");
  await reveal(status().first());
  await shot("clipboard-pending");
  assert.notEqual(
    screenshots.at(-1).pngSha256,
    screenshots.at(-2).pngSha256,
    "Pending native frame must differ from the preceding failure frame",
  );
  assert.equal(
    await page.evaluate(() => globalThis.__markdownClipboard.writes.length),
    1,
  );
  await messages("변경된 메시지");
  await expect(page.locator("[data-markdown-text]")).toContainText(
    "변경된 메시지",
  );
  await expect(copies()).toBeEnabled();
  await page.evaluate(() => globalThis.__markdownClipboard.settle.resolve());
  await expect(page.locator("[data-copy-status]")).not.toHaveText(
    "복사했습니다.",
  );
  await shot("late-copy-after-text-change");
  await clipboard("pending");
  await enter(copies());
  await page.getByRole("button", { name: "P6 Session B", exact: true }).click();
  await expect(page.locator("[data-markdown-text]")).toContainText(
    "다른 세션의 같은 ID",
  );
  await page.evaluate(() => globalThis.__markdownClipboard.settle.resolve());
  await expect(page.locator("[data-copy-status]")).not.toHaveText(
    "복사했습니다.",
  );
  await shot("late-copy-after-session-switch");
  await page.getByRole("button", { name: "P6 Session A", exact: true }).click();
  await messages('부분 수신\n\n```js\nconst partial = "아직', "running");
  await expect(page.locator("[data-markdown-code]")).toContainText(
    "const partial",
  );
  await expect(page.locator("[data-markdown-text]")).toHaveAttribute(
    "data-status",
    "running",
  );
  await shot("partial-stream");
  await messages('완료된 수신\n\n```js\nconst partial = "완료";\n```', "idle");
  await expect(page.locator("[data-markdown-code]")).toContainText("완료");
  await shot("completed-stream");
  await messages("# 사용자 원문\n**문자**\n```sh\necho x\n```", "idle", "user");
  await expect(page.locator("[data-literal-text]")).toContainText("**문자**");
  assert.equal(await codeCopy().count(), 0);
  await shot("literal-user");
  await messages("원래 코드\n\n```js\nconst old = 1;\n```");
  await expect(codeCopy()).toBeVisible();
  await clipboard("pending");
  await enter(codeCopy());
  await expect(codeCopy()).toBeDisabled();
  await messages("새 코드\n\n```js\nconst changed = 2;\n```");
  await expect(page.locator("[data-markdown-code]")).toContainText(
    "const changed = 2;",
  );
  await page.evaluate(() => globalThis.__markdownClipboard.settle.resolve());
  await expect(
    page.locator("[data-copy-control=code] [data-copy-status]"),
  ).not.toHaveText("복사했습니다.");
  await shot("late-copy-after-code-change");
  await messages("보관된 표시 · 복사 가능");
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.snapshot.workspaces[0].trusted = false;
    f.snapshot.revision++;
    f.snapshot.observationSequence++;
  });
  await page.reload();
  await clipboard();
  await expect(copies()).toBeEnabled();
  await enter(copies());
  await expect(status().first()).toHaveText("복사했습니다.");
  await shot("untrusted-read-only-copy");
  await application.evaluate(() => {
    const f = globalThis.__omocUiFixture;
    f.snapshot.temporary = false;
    f.snapshot.workspaces[0].temporary = false;
    f.snapshot.workspaces[0].trusted = true;
    f.snapshot.workspaces[0].trustRevision++;
    // Store recovery intentionally contains no transcript under validateSnapshot.
    // Exercise the actual connected global operation hold with retained metadata.
    const receipt = {
      runtimeEpoch: "fixture-original-epoch",
      operationId: "synthetic-unresolved-import",
      type: "workspace.import",
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: f.snapshot.revision,
      evidence: [],
    };
    f.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      {
        digest: "synthetic-no-replay-payload",
        receipt,
      },
    );
    f.snapshot.revision++;
    f.snapshot.observationSequence++;
  });
  await page.reload();
  await clipboard();
  await expect(copies()).toBeEnabled();
  await enter(copies());
  await expect(status()).toHaveText("복사했습니다.");
  await expect(
    page.getByRole("status", { name: "보관된 요청 확인", exact: true }),
  ).toHaveAttribute("data-retained-count", "1");
  await expect(
    page.getByRole("button", { name: "새 세션", exact: true }).first(),
  ).toBeDisabled();
  await shot("retained-global-operation-copy");
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  assert.equal(
    await application.evaluate(
      () => globalThis.__omocUiFixture.requests.length,
    ),
    0,
  );
} catch (error) {
  failure = error;
  if (page)
    try {
      await shot("failure");
    } catch (captureError) {
      errors.push(bounded(captureError));
    }
} finally {
  let timer, listener;
  try {
    if (processHandle) {
      const exited =
        processHandle.exitCode !== null || processHandle.signalCode !== null
          ? Promise.resolve([processHandle.exitCode, processHandle.signalCode])
          : new Promise((resolve) => {
              listener = (code, signal) => resolve([code, signal]);
              processHandle.once("exit", listener);
            });
      const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("Owned Electron exit unproved")),
          15000,
        );
      });
      await Promise.race([
        application.evaluate(({ app }) => app.quit()).catch(() => {}),
        deadline,
      ]);
      const [code, signal] = await Promise.race([exited, deadline]);
      teardown = { exited: true, code, signal, retainedRoot: fixtureRoot };
      assert.equal(code, 0);
    }
  } catch (error) {
    failure ??= error;
    teardown.error = bounded(error);
  } finally {
    clearTimeout(timer);
    if (listener) processHandle?.removeListener("exit", listener);
  }
  try {
    after = await captureProvenance(root, { script: "conversation-markdown" });
    assert.deepEqual(after, before);
  } catch (error) {
    failure ??= error;
  }
}
await writeFile(
  join(run, "conversation-markdown-evidence.json"),
  JSON.stringify(
    {
      result: failure ? "fail" : "pass",
      state: currentState,
      platform: process.platform,
      states,
      screenshots,
      pageErrors: errors,
      externalRequests,
      teardown,
      sourceBuildProvenance: { before, after },
      clipboard:
        "Controlled renderer writeText adapter only; real OS clipboard untouched",
      providerExecution: "not performed",
      productionMain: "not performed",
      ...(failure && { error: bounded(failure) }),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
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
