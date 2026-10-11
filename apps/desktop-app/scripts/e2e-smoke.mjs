import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appDir = join(root, "apps", "desktop-app");
const mode = process.argv[2] ?? "dev";
const expectedPlatform = process.argv[3] ?? process.platform;
if (!["dev", "packaged"].includes(mode))
  throw new Error("Usage: e2e-smoke.mjs <dev|packaged> <darwin|win32>");
if (process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error("Desktop E2E must run on a supported native OS");
}
if (process.platform !== expectedPlatform)
  throw new Error(
    `Expected native runner ${expectedPlatform}, found ${process.platform}`,
  );

const require = createRequire(import.meta.url);
const packageName = `OhMyOwnCode-${process.platform}-${process.arch}`;
const packagedExecutable =
  process.platform === "darwin"
    ? join(
        appDir,
        "dist",
        "packages",
        packageName,
        "OhMyOwnCode.app",
        "Contents",
        "MacOS",
        "OhMyOwnCode",
      )
    : join(appDir, "dist", "packages", packageName, "OhMyOwnCode.exe");
const executablePath =
  mode === "dev" ? require("electron") : packagedExecutable;
const args = mode === "dev" ? [join(appDir, "dist", "app")] : [];
const packagedApp =
  process.platform === "darwin"
    ? join(appDir, "dist", "packages", packageName, "OhMyOwnCode.app")
    : join(appDir, "dist", "packages", packageName);
const resourcesPath = join(
  packagedApp,
  process.platform === "darwin" ? "Contents/Resources" : "resources",
);
const packagedSidecar = join(
  resourcesPath,
  "opencode",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "opencode.exe" : "opencode",
);
const appAsar = join(resourcesPath, "app.asar");
const e2eRoot = await mkdtemp(join(tmpdir(), `omoc-desktop-e2e-${mode}-`));
const e2eTmp = join(e2eRoot, "tmp");
const e2eRoaming = join(e2eRoot, "AppData", "Roaming");
const e2eLocal = join(e2eRoot, "AppData", "Local");
await Promise.all(
  [e2eTmp, e2eRoaming, e2eLocal].map((path) =>
    mkdir(path, { recursive: true, mode: 0o700 }),
  ),
);
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  TMPDIR: e2eTmp,
  TMP: e2eTmp,
  TEMP: e2eTmp,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
  ...(process.platform === "win32" && {
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    USERPROFILE: e2eRoot,
    APPDATA: e2eRoaming,
    LOCALAPPDATA: e2eLocal,
  }),
};

async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function treeHash(path) {
  const hash = createHash("sha256");
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const rel = relative(path, entryPath).replaceAll("\\", "/");
      const stats = await lstat(entryPath);
      hash.update(`${rel}\0${stats.mode}\0`);
      if (stats.isSymbolicLink()) hash.update(await readlink(entryPath));
      else if (stats.isDirectory()) await walk(entryPath);
      else if (stats.isFile()) {
        for await (const chunk of createReadStream(entryPath))
          hash.update(chunk);
      }
      hash.update("\0");
    }
  }
  await walk(path);
  return hash.digest("hex");
}

async function packagedIdentity() {
  return {
    appTreeSha256: await treeHash(packagedApp),
    appExecutableSha256: await fileHash(packagedExecutable),
    appAsarSha256: await fileHash(appAsar),
    sidecarSha256: await fileHash(packagedSidecar),
  };
}

async function inspectedIdentity() {
  const output = execFileSync(
    process.execPath,
    [join(appDir, "scripts", "inspect-packaged-bundle.mjs"), expectedPlatform],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const inspection = JSON.parse(output);
  assert.equal(inspection.result, "pass");
  assert.equal(inspection.platform, process.platform);
  assert.equal(inspection.architecture, process.arch);
  assert.deepEqual(
    {
      appTreeSha256: inspection.appTreeSha256,
      appExecutableSha256: inspection.appExecutableSha256,
      appAsarSha256: inspection.appAsarSha256,
      sidecarSha256: inspection.sidecarSha256,
    },
    await packagedIdentity(),
    "inspection and launch must use the exact same app and sidecar bytes",
  );
  return inspection;
}

async function assertUntrustedIpcSender(app, rendererUrl) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "omoc-ipc-probe-"));
  const preloadPath = join(fixtureRoot, "preload.cjs");
  await writeFile(
    preloadPath,
    'const { contextBridge, ipcRenderer } = require("electron");\n' +
      'contextBridge.exposeInMainWorld("probe", { invoke: (payload) => ipcRenderer.invoke("desktop:v1:runtime-snapshot", payload) });\n',
    { mode: 0o600 },
  );
  try {
    const result = await app.evaluate(
      async ({ BrowserWindow }, { preloadPath, rendererUrl }) => {
        const probeWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preloadPath,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await probeWindow.loadURL(rendererUrl);
          return await probeWindow.webContents.executeJavaScript(
            'window.probe.invoke({ malformed: true }).then(() => "accepted", error => String(error))',
          );
        } finally {
          probeWindow.destroy();
        }
      },
      { preloadPath, rendererUrl },
    );
    assert.match(result, /request_denied/, "foreign sender IPC is rejected");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertSubframeNoBridge(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Page.setBypassCSP", { enabled: true });
  try {
    const attached = page.waitForEvent("frameattached");
    await page.evaluate(() => {
      const frame = window.document.createElement("iframe");
      frame.id = "e2e-subframe-probe";
      frame.srcdoc = "<!doctype html><title>isolated frame probe</title>";
      frame.style.display = "none";
      window.document.body.append(frame);
    });
    const frame = await attached;
    await expect.poll(() => frame.url()).toBe("about:srcdoc");
    const bridgeType = await frame.evaluate(() => typeof window.desktopBridge);
    assert.equal(
      bridgeType,
      "undefined",
      "production subframes receive no preload bridge",
    );
  } finally {
    await page.evaluate(() =>
      window.document.getElementById("e2e-subframe-probe")?.remove(),
    );
    await cdp.send("Page.setBypassCSP", { enabled: false });
    await cdp.detach();
  }
}

async function assertTrustedMalformedPayloadDenied(page) {
  const result = await page.evaluate(async () => {
    try {
      await window.desktopBridge.runtimeSnapshot({ malformed: true });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  });
  assert.match(
    result,
    /request_denied/,
    "malformed main-frame IPC is rejected",
  );
}

async function assertStartupFailureScenario(scenario) {
  const scenarioEnv = { ...env, OMOC_DESKTOP_E2E_SCENARIO: scenario };
  let collisionServer;
  let collisionRequests = 0;
  if (scenario === "service-collision") {
    collisionServer = createServer((_request, response) => {
      collisionRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"pid":0,"version":"foreign-fixture"}');
    });
    collisionServer.listen(0, "127.0.0.1");
    await once(collisionServer, "listening");
    scenarioEnv.OMOC_DESKTOP_E2E_PORT = String(collisionServer.address().port);
  }

  const scenarioApp = await electron.launch({
    executablePath,
    args: [],
    env: scenarioEnv,
  });
  const scenarioProcess = scenarioApp.process();
  try {
    const page = await scenarioApp.firstWindow();
    await expect(page.locator(".runtime-state")).toHaveAttribute(
      "data-state",
      "unavailable",
      { timeout: 30_000 },
    );
    const profile = await scenarioApp.evaluate(({ app: electronApp }) =>
      electronApp.getPath("userData"),
    );
    assert.equal(
      sidecarChildPids(scenarioProcess.pid).length,
      0,
      `${scenario} leaves no sidecar child behind`,
    );
    await scenarioApp.evaluate(({ app: electronApp }) => electronApp.quit());
    assert.equal(await waitForExit(scenarioProcess, 20_000), 0);
    assert.equal(existsSync(profile), false, `${scenario} removes its profile`);
    if (scenario === "service-collision") {
      assert.equal(
        collisionRequests,
        0,
        "the app never connects to or reuses the occupied foreign service",
      );
    }
  } finally {
    if (scenarioProcess.exitCode === null) {
      await scenarioApp.evaluate(({ app: electronApp }) => electronApp.quit());
      await waitForExit(scenarioProcess, 20_000);
    }
    if (collisionServer?.listening) {
      collisionServer.close();
      await once(collisionServer, "close");
    }
  }
}

async function assertPackagedStartupFailures() {
  for (const scenario of [
    "startup-failure",
    "startup-timeout",
    "service-collision",
  ]) {
    await assertStartupFailureScenario(scenario);
  }
}

function sidecarChildPids(parentPid) {
  if (process.platform === "win32") {
    const command = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${Number(parentPid)}" | Where-Object { $_.Name -match '^opencode(\\.exe)?$' } | ForEach-Object { $_.ProcessId }`;
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8" },
    );
    return output.split(/\s+/).filter(Boolean).map(Number);
  }
  try {
    const output = execFileSync(
      "pgrep",
      ["-P", String(parentPid), "-f", "opencode.*serve"],
      { encoding: "utf8" },
    );
    return output.split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    if (error?.status === 1 && !error.signal) return [];
    throw error;
  }
}

async function assertNoPreviewSurface(page) {
  assert.equal(
    await page.locator("iframe, webview, [data-preview-surface]").count(),
    0,
    "the workbench exposes no executable preview surface",
  );
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  let timer;
  try {
    return await Promise.race([
      once(child, "exit").then(([code]) => code),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("app_exit_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertCrashAndRestart() {
  const crashApp = await electron.launch({ executablePath, args, env });
  const crashProcess = crashApp.process();
  let crashedPid;
  let crashProfile;
  try {
    const page = await crashApp.firstWindow();
    await expect(page.locator(".runtime-state")).toHaveAttribute(
      "data-state",
      "connected",
      { timeout: 30_000 },
    );
    crashProfile = await crashApp.evaluate(({ app: electronApp }) =>
      electronApp.getPath("userData"),
    );
    const children = sidecarChildPids(crashProcess.pid);
    assert.equal(children.length, 1, "crash fixture owns one sidecar");
    crashedPid = children[0];
    process.kill(crashedPid, "SIGKILL");
    await expect
      .poll(() => page.evaluate(() => window.desktopBridge.runtimeSnapshot()), {
        timeout: 10_000,
      })
      .toMatchObject({ state: "disconnected" });
    await expect(page.locator(".runtime-state")).toHaveAttribute(
      "data-state",
      "disconnected",
      { timeout: 10_000 },
    );
    await crashApp.evaluate(({ app: electronApp }) => electronApp.quit());
    assert.equal(await waitForExit(crashProcess, 20_000), 0);
    assert.equal(processIsRunning(crashedPid), false);
    assert.equal(existsSync(crashProfile), false);
  } finally {
    if (crashProcess.exitCode === null) {
      await crashApp.evaluate(({ app: electronApp }) => electronApp.quit());
      await waitForExit(crashProcess, 20_000);
    }
  }

  const restartApp = await electron.launch({ executablePath, args, env });
  const restartProcess = restartApp.process();
  try {
    const page = await restartApp.firstWindow();
    await expect(page.locator(".runtime-state")).toHaveAttribute(
      "data-state",
      "connected",
      { timeout: 30_000 },
    );
    const children = sidecarChildPids(restartProcess.pid);
    assert.equal(children.length, 1, "restart owns a fresh sidecar");
    assert.notEqual(children[0], crashedPid);
    const profile = await restartApp.evaluate(({ app: electronApp }) =>
      electronApp.getPath("userData"),
    );
    if (process.platform === "win32") {
      await page.close();
    } else {
      await restartApp.evaluate(({ app: electronApp }) => electronApp.quit());
    }
    assert.equal(await waitForExit(restartProcess, 20_000), 0);
    assert.equal(processIsRunning(children[0]), false);
    assert.equal(existsSync(profile), false);
  } finally {
    if (restartProcess.exitCode === null) {
      await restartApp.evaluate(({ app: electronApp }) => electronApp.quit());
      await waitForExit(restartProcess, 20_000);
    }
  }
}

const inspection = mode === "packaged" ? await inspectedIdentity() : null;
if (inspection) await assertPackagedStartupFailures();
const app = await electron.launch({ executablePath, args, env });
const mainProcess = app.process();
let sidecarPids = [];
let userDataPath;
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("textbox", { name: "메시지 작성" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("로컬 런타임 연결됨")).toBeVisible({
    timeout: 30_000,
  });
  const snapshot = await page.evaluate(() =>
    window.desktopBridge.runtimeSnapshot(),
  );
  assert.equal(snapshot.state, "connected");
  assert.equal(snapshot.serverVersion, "2.0.18");
  const rendererCapabilities = await page.evaluate(() => ({
    bridge: Object.keys(window.desktopBridge).sort(),
    require: typeof window.require,
    process: typeof window.process,
  }));
  assert.deepEqual(rendererCapabilities, {
    bridge: ["runtimeSnapshot", "workbench"],
    require: "undefined",
    process: "undefined",
  });
  await assertUntrustedIpcSender(app, page.url());
  await assertSubframeNoBridge(page);
  await assertTrustedMalformedPayloadDenied(page);
  await assertNoPreviewSurface(page);
  userDataPath = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath("userData"),
  );
  assert.match(userDataPath, /oh-my-own-code-electron-/);
  assert.equal(
    relative(e2eRoot, userDataPath).startsWith(".."),
    false,
    "Electron profile is under the disposable temp root",
  );

  let popupOpened = false;
  page.on("popup", () => {
    popupOpened = true;
  });
  await page.evaluate(() => window.open("https://example.com", "external"));
  await page.waitForTimeout(150);
  assert.equal(popupOpened, false);
  const originalUrl = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com";
  });
  await page.waitForTimeout(150);
  assert.equal(page.url(), originalUrl);

  const screenshotPath = join(tmpdir(), `oh-my-own-code-desktop-${mode}.png`);
  await page.screenshot({ path: screenshotPath });

  sidecarPids = sidecarChildPids(mainProcess.pid);
  assert.equal(
    sidecarPids.length,
    1,
    "one exact app-owned OpenCode serve process is running",
  );
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  assert.equal(await waitForExit(mainProcess, 20_000), 0);
  for (const pid of sidecarPids) {
    assert.equal(
      processIsRunning(pid),
      false,
      `owned sidecar ${pid} was reaped after quit`,
    );
  }
  assert.equal(
    existsSync(userDataPath),
    false,
    "temporary Electron profile is removed after quit",
  );
  if (inspection) {
    assert.deepEqual(
      await packagedIdentity(),
      {
        appTreeSha256: inspection.appTreeSha256,
        appExecutableSha256: inspection.appExecutableSha256,
        appAsarSha256: inspection.appAsarSha256,
        sidecarSha256: inspection.sidecarSha256,
      },
      "inspected packaged bytes did not change during the launch",
    );
    assert.deepEqual(await packagedIdentity(), {
      appTreeSha256: inspection.appTreeSha256,
      appExecutableSha256: inspection.appExecutableSha256,
      appAsarSha256: inspection.appAsarSha256,
      sidecarSha256: inspection.sidecarSha256,
    });
  }
  await assertCrashAndRestart();
  await rm(e2eRoot, { recursive: true, force: false });
  console.log(
    JSON.stringify({
      mode,
      result: "pass",
      sidecarCount: sidecarPids.length,
      appExitCode: 0,
      temporaryProfileRemoved: true,
      screenshotPath,
      ...(inspection && {
        appTreeSha256: inspection.appTreeSha256,
        appExecutableSha256: inspection.appExecutableSha256,
        appAsarSha256: inspection.appAsarSha256,
        sidecarSha256: inspection.sidecarSha256,
        securityScenarios: [
          "foreign_sender_malformed_payload",
          "no_subframe_preload_bridge",
          "trusted_main_frame_malformed_payload",
          "no_preview_surface_in_bootstrap",
        ],
        lifecycleScenarios: [
          "quit",
          "child_crash_disconnect",
          "restart",
          "window_close_or_quit",
          "startup_failure",
          "startup_timeout",
          "service_collision",
        ],
      }),
    }),
  );
} catch (error) {
  if (mainProcess.exitCode === null) {
    try {
      await app.evaluate(({ app: electronApp }) => electronApp.quit());
    } catch {
      // Preserve the original E2E failure; the managed app remains available for recovery.
    }
    try {
      await waitForExit(mainProcess, 20_000);
    } catch {
      // Do not force-kill the app because its owned child may still be running.
    }
  }
  if (mainProcess.exitCode === null) {
    throw new Error(
      "E2E failed and the app did not exit cleanly; preserve process state for recovery",
      { cause: error },
    );
  }
  throw error;
}
