/* global document, DataTransfer, ClipboardEvent */
// Real Electron + real node-pty: terminal tab, colors, line editing, resize, exit code,
// close-tab and quit orphan checks, and the dev-server project action. No model/provider needed.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { createWorkbenchBridge } from "./e2e-bridge.mjs";

if (process.platform === "win32") {
  console.log(
    JSON.stringify({ result: "skipped", reason: "POSIX shell script" }),
  );
  process.exit(0);
}
const CONNECT_TIMEOUT_MS =
  Number(process.env.OMOC_E2E_CONNECT_TIMEOUT_MS) || 150_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const fixture = await realpath(
  await mkdtemp(join(tmpdir(), "omoc-terminal-e2e-")),
);
const scratch = join(fixture, "tmp");
await mkdir(scratch);
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  SHELL: "/bin/bash",
  OMOC_DESKTOP_E2E_BACKGROUND: process.env.OMOC_E2E_FOREGROUND ? "" : "1",
  OMOC_APP_DATA_DIR: join(fixture, "app-profile"),
  HOME: fixture,
  TMPDIR: scratch,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  // Must never reach a terminal child (env allowlist).
  OMOC_E2E_SECRET: "terminal-must-not-see-this",
};
const application = await electron.launch({
  executablePath: require("electron"),
  args: [join(root, "apps/desktop-app/dist/app")],
  env,
});
const proc = application.process();
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const observations = [];
let closed = false;
try {
  const page = await application.firstWindow();
  const pageErrors = [];
  const csp = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
  });
  await expect(page.locator(".workbench-header [data-state]")).toHaveAttribute(
    "data-state",
    "connected",
    { timeout: CONNECT_TIMEOUT_MS },
  );
  const bridge = createWorkbenchBridge(page);
  let initial;
  await expect
    .poll(async () => (initial = await bridge({ type: "snapshot" })).ok, {
      timeout: 30_000,
    })
    .toBe(true);
  const workspace = initial.value.workspaces.find(
    (w) => w.id === initial.value.selectedWorkspaceId,
  );
  assert.equal(workspace.trusted, true);
  // A dev-server style script: prints a banner, reports tty-ness, spawns a child, then idles.
  await writeFile(
    join(workspace.path, "package.json"),
    JSON.stringify({
      name: "e2e-app",
      scripts: {
        dev: `node -e "const c=require('child_process').spawn('sleep',['300']);console.log('\\x1b[32mLocal:\\x1b[0m http://localhost:5173/ TTY='+process.stdout.isTTY+' CHILD='+c.pid+' SELF='+process.pid+' SECRET='+(process.env.OMOC_E2E_SECRET||'none'));setInterval(()=>{},1000)"`,
      },
    }),
  );
  const term = (request) =>
    page.evaluate((r) => window.desktopBridge.terminal(r), request);
  const readAll = async (terminalId) =>
    (await term({ type: "terminal.read", terminalId, cursor: 0 })).value;
  const list = async () =>
    (await term({ type: "terminal.list", workspaceId: workspace.id })).value;

  await page.getByRole("button", { name: "파일·확장", exact: true }).click();
  await page.getByRole("button", { name: "터미널", exact: true }).click();
  await page.getByRole("button", { name: "새 터미널" }).click();
  const screen = page.getByRole("group", { name: "터미널 화면" });
  await expect(screen.locator(".xterm")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "실행 중" }),
  ).toBeVisible();
  const typed = async (text) => {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };
  await screen.locator(".xterm").click();
  const [first] = await list();
  const out = async () => (await readAll(first.terminalId)).output;
  const waitOut = (re) => expect.poll(out, { timeout: 15_000 }).toMatch(re);

  // tty, shell pid and secret-free environment
  await typed(
    "[ -t 0 ] && echo TTY_YES; echo SH_$$; echo ENV_${OMOC_E2E_SECRET:-clean}; pwd; stty size",
  );
  await waitOut(/\r\nENV_clean\r\n/);
  const text = await out();
  assert.match(text, /\r\nTTY_YES\r\n/);
  assert.ok(
    text.includes(`\r\n${workspace.path}\r\n`),
    "starts in workspace dir",
  );
  const shellPid = Number(/\r\nSH_(\d+)\r\n/.exec(text)[1]);
  assert.ok(alive(shellPid));
  const size1 = /\r\n(\d+) (\d+)\r\n/.exec(
    text.slice(text.indexOf("ENV_clean")),
  );
  assert.ok(size1 && Number(size1[2]) > 20, `fitted size ${size1?.[0]}`);
  assert.notEqual(`${size1[1]}x${size1[2]}`, "24x80", "resize reached the pty");
  observations.push("terminal is a tty in the workspace dir with a clean env");

  // colors rendered by xterm
  await typed("printf '\\033[31mREDTEXT\\033[0m\\n'");
  await expect(
    screen.locator(".xterm-fg-1", { hasText: "REDTEXT" }),
  ).toBeVisible();
  observations.push("ANSI colors rendered by xterm.js");

  // paste: control characters (ESC) are stripped; oversized pastes are refused with a notice
  const paste = (value) =>
    page.evaluate((v) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", v);
      document.querySelector(".xterm-helper-textarea").dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, value);
  await paste("echo PA\x1b[201~STE");
  await page.keyboard.press("Enter");
  await waitOut(/\r\nPA\[201~STE\r\n/);
  await paste("x".repeat(1024 * 1024 + 1));
  await expect(page.getByRole("alert")).toContainText("붙여넣기가 너무 커서");
  observations.push("paste strips ESC and refuses >1 MiB with a notice");

  // keyboard-trap escape: the chord moves focus out of the terminal; hint is exposed
  const textarea = screen.locator(".xterm-helper-textarea");
  await expect(textarea).toHaveAttribute(
    "aria-describedby",
    "omoc-terminal-hint",
  );
  await expect(page.locator("#omoc-terminal-hint")).toContainText(
    "Ctrl+Shift+M",
  );
  await textarea.focus();
  await page.keyboard.press("Control+Shift+M");
  await expect(
    page.getByRole("button", { name: "중지", exact: true }),
  ).toBeFocused();
  await screen.locator(".xterm").click();
  observations.push("Ctrl+Shift+M releases keyboard focus from the terminal");

  // line editing handled by the shell's readline: Left arrow + insert
  await page.keyboard.type("echo ABD");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("C");
  await page.keyboard.press("Enter");
  await waitOut(/\r\nABCD\r\n/);
  observations.push("readline line editing works (cursor keys)");

  // resize: widening the detail panel refits xterm; stty must follow the fitted grid
  let probe = 0;
  const sizeOf = async () => {
    const n = ++probe;
    await typed(`echo S${n}_$(stty size | tr ' ' x)`);
    const re = new RegExp(`\\r\\nS${n}_(\\d+)x(\\d+)\\r\\n`);
    await expect.poll(out, { timeout: 15_000 }).toMatch(re);
    return re
      .exec(await out())
      .slice(1)
      .map(Number);
  };
  const before = await sizeOf();
  const separator = page.getByRole("separator");
  await separator.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
  await screen.locator(".xterm").click();
  await expect
    .poll(async () => (await sizeOf())[1], { timeout: 20_000 })
    .toBeGreaterThan(before[1]);
  observations.push(`resize propagated to pty (cols ${before[1]} -> wider)`);

  // exit code
  await typed("exit 7");
  await expect(
    page.getByRole("status").filter({ hasText: "종료 코드 7" }),
  ).toBeVisible();
  assert.equal((await list())[0].exitCode, 7);
  observations.push("exit code 7 shown and reported");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  assert.equal((await list()).length, 0);

  // close tab kills the whole tree incl. background jobs
  await page.getByRole("button", { name: "새 터미널" }).click();
  await expect(screen.locator(".xterm")).toBeVisible();
  await screen.locator(".xterm").click();
  const [second] = await list();
  const out2 = async () => (await readAll(second.terminalId)).output;
  await typed("set +H");
  await typed("sleep 300 & echo BG_$!; echo SH2_$$");
  await expect.poll(out2).toMatch(/\r\nSH2_\d+\r\n/);
  const o2 = await out2();
  const bg = Number(/\r\nBG_(\d+)\r\n/.exec(o2)[1]);
  const sh2 = Number(/\r\nSH2_(\d+)\r\n/.exec(o2)[1]);
  assert.ok(alive(bg) && alive(sh2));
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect
    .poll(() => alive(bg) || alive(sh2), { timeout: 10_000 })
    .toBe(false);
  observations.push("closing a tab kills the shell and its background job");

  // dev-server project action on the pty
  await page.getByText(/프로젝트 스크립트/).click();
  await page.getByRole("button", { name: /run dev 실행/ }).click();
  await expect(screen.locator(".xterm")).toBeVisible();
  const [dev] = await list();
  await expect
    .poll(async () => (await readAll(dev.terminalId)).output, {
      timeout: 20_000,
    })
    .toMatch(
      /Local:.*http:\/\/localhost:5173\/ TTY=true CHILD=\d+ SELF=\d+ SECRET=none/,
    );
  const devOut = (await readAll(dev.terminalId)).output;
  const [, childPid, selfPid] = /CHILD=(\d+) SELF=(\d+)/
    .exec(devOut)
    .map(Number);
  assert.ok(alive(childPid) && alive(selfPid));
  await expect(
    screen.locator(".xterm-fg-2", { hasText: "Local:" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "중지", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "종료됨" }),
  ).toBeVisible();
  await expect
    .poll(() => alive(childPid) || alive(selfPid), { timeout: 10_000 })
    .toBe(false);
  observations.push(
    "dev-server action runs on a tty; stop kills server and its child",
  );

  // quit sweeps whatever is still running
  await page.getByRole("button", { name: "새 터미널" }).click();
  const tabs = await list();
  const live = tabs.find((t) => t.status === "running");
  await screen.locator(".xterm").click();
  const out3 = async () => (await readAll(live.terminalId)).output;
  await typed("set +H");
  await typed("sleep 300 & echo QBG_$!");
  await expect.poll(out3).toMatch(/\r\nQBG_\d+\r\n/);
  const quitBg = Number(/\r\nQBG_(\d+)\r\n/.exec(await out3())[1]);
  assert.ok(alive(quitBg));
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  assert.deepEqual(csp, [], "no CSP violations");
  await application.evaluate(({ app }) => app.quit());
  const exit = proc.exitCode ?? (await once(proc, "exit"))[0];
  assert.equal(exit, 0);
  closed = true;
  await expect.poll(() => alive(quitBg), { timeout: 10_000 }).toBe(false);
  observations.push("app quit leaves no terminal processes behind");
  await rm(fixture, { recursive: true, force: true });
  console.log(
    JSON.stringify(
      { result: "pass", platform: process.platform, observations },
      null,
      2,
    ),
  );
} catch (error) {
  if (!closed && proc.exitCode === null) {
    try {
      await application.evaluate(({ app }) => app.quit());
    } catch {
      console.error(
        "Owned test application exit unconfirmed; fixture preserved.",
      );
    }
  }
  throw error;
}
