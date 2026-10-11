import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { executableForResources, startSidecar } from "./sidecar-supervisor.mjs";
import { configureEphemeralProfile } from "./ephemeral-profile.mjs";
import {
  acceptsNoIpcArguments,
  admitsRendererRequest,
} from "./renderer-admission.mjs";

import { createWorkbenchService } from "./workbench-service.mjs";
import { bindWorkbenchIpc } from "./host/workbench-ipc.mjs";

let workbench;
const here = dirname(fileURLToPath(import.meta.url));
const developmentUrl = process.env.OMOC_DESKTOP_DEV_URL;
const ephemeralProfile = configureEphemeralProfile(app);
let mainWindow;
let runtime;
let stopPromise;
let startupPromise;
let startupAbortController;
let startupError;
let startupComplete = false;
let quitAfterStartup = false;
let quitPromise;

function allowedRendererUrl(raw) {
  if (developmentUrl && !app.isPackaged) return raw === developmentUrl;
  return raw === pathToFileURL(join(here, "renderer", "index.html")).href;
}

function admit(event) {
  return Boolean(
    mainWindow &&
      admitsRendererRequest(event, mainWindow.webContents, allowedRendererUrl),
  );
}

function bindIpc() {
  bindWorkbenchIpc({ ipcMain, admit, service: () => workbench });
  ipcMain.handle("desktop:v1:runtime-snapshot", (event, ...args) => {
    if (!admit(event)) throw new Error("request_denied");
    if (!acceptsNoIpcArguments(args)) throw new Error("request_denied");
    return runtime?.snapshot() ?? { state: "unavailable" };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!allowedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const senderScope = String(mainWindow.webContents.id);
  mainWindow.webContents.once("destroyed", () =>
    workbench?.closeSender(senderScope),
  );
  mainWindow.webContents.on("render-process-gone", () =>
    workbench?.closeSender(senderScope),
  );
  mainWindow.on("closed", () => {
    workbench?.closeSender(senderScope);
    mainWindow = undefined;
  });
  if (developmentUrl && !app.isPackaged) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(join(here, "renderer", "index.html"));
  }
}

async function stopRuntime() {
  if (!runtime) return { exited: true, cleanup: "complete" };
  if (stopPromise) return stopPromise;
  workbench?.close();
  const active = runtime;
  stopPromise = active
    .stop()
    .then((result) => {
      if (result.exited && result.cleanup === "complete") {
        runtime = undefined;
      }
      return result;
    })
    .catch(() => ({ exited: false, cleanup: "incomplete" }))
    .finally(() => {
      stopPromise = undefined;
    });
  return stopPromise;
}

function reportStopFailure() {
  dialog.showErrorBox(
    "Runtime exit unconfirmed",
    "The app could not confirm that its temporary OpenCode process stopped. Keep the app open and try quitting again.",
  );
}

function reportCleanupFailure(recoveryPath) {
  dialog.showErrorBox(
    "Temporary data cleanup failed",
    `The app stopped its OpenCode process but could not remove its owned temporary folder. After the app exits, remove this folder manually:\n${recoveryPath}`,
  );
}

async function finishSidecarStop(stop) {
  let result;
  try {
    result = await stop();
    if (result.exited && result.cleanup === "failed") result = await stop();
  } catch {
    reportStopFailure();
    return;
  }
  if (
    result.exited &&
    ["complete", "already_stopped"].includes(result.cleanup)
  ) {
    startupError = undefined;
    app.quit();
  } else if (
    result.exited &&
    result.cleanup === "failed" &&
    result.recoveryPath
  ) {
    reportCleanupFailure(result.recoveryPath);
    runtime = undefined;
    startupError = undefined;
    app.quit();
  } else {
    reportStopFailure();
  }
}

function requestQuit() {
  if (quitPromise) return quitPromise;
  quitPromise = (async () => {
    quitAfterStartup = true;
    if (!startupComplete && startupPromise) {
      startupAbortController?.abort();
      try {
        runtime = await startupPromise;
      } catch (error) {
        startupError = error;
      }
      startupComplete = true;
    }

    if (runtime) {
      await finishSidecarStop(stopRuntime);
      return;
    }

    if (
      startupError?.cleanupComplete === false &&
      startupError.stopOwnedSidecar
    ) {
      await finishSidecarStop(startupError.stopOwnedSidecar);
      return;
    }

    app.quit();
  })().finally(() => {
    quitPromise = undefined;
  });
  return quitPromise;
}

app.whenReady().then(async () => {
  let binaryPath = executableForResources(
    app.isPackaged ? process.resourcesPath : join(here, "..", "resources"),
    process.platform,
    process.arch,
  );
  const e2eScenario = app.isPackaged
    ? process.env.OMOC_DESKTOP_E2E_SCENARIO
    : undefined;
  const e2ePort = Number(process.env.OMOC_DESKTOP_E2E_PORT);
  if (e2eScenario === "startup-failure") binaryPath += ".missing-e2e-fixture";
  startupAbortController = new AbortController();
  startupPromise = startSidecar({
    binaryPath,
    signal: startupAbortController.signal,
    ...(e2eScenario === "startup-timeout" && { startupTimeoutMs: 25 }),
    ...(e2eScenario === "service-collision" &&
      Number.isInteger(e2ePort) &&
      e2ePort > 0 &&
      e2ePort <= 65535 && { port: e2ePort }),
  });
  try {
    runtime = await startupPromise;
  } catch (error) {
    startupError = error;
    runtime = undefined;
  }
  startupComplete = true;
  if (quitAfterStartup) return;
  workbench = createWorkbenchService({
    runtime,
    async pickDirectory() {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    async confirmSessionRemoval({ title, workspaceName, path }) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "대화 기록 삭제",
        message: `“${title}” 대화 기록을 삭제하시겠습니까?`,
        detail: `작업공간: ${workspaceName}\n${path}\n대화 기록만 삭제하며 프로젝트 파일과 폴더는 유지됩니다.`,
        buttons: ["취소", "대화 기록 삭제"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmTrust(path) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Trust this workspace?",
        message:
          "Opening a session can load project configuration and plugins.",
        detail: path,
        buttons: ["Cancel", "Trust and open"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
  });
  bindIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  if (!startupPromise && !runtime) return;
  if (startupComplete && !runtime && startupError?.cleanupComplete !== false)
    return;
  event.preventDefault();
  void requestQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  try {
    ephemeralProfile.cleanup();
  } catch {
    dialog.showErrorBox(
      "Temporary data cleanup failed",
      `The app could not remove its owned temporary Electron profile. After the app exits, remove this folder manually:\n${ephemeralProfile.root}`,
    );
  }
});

process.on("uncaughtException", () => {
  void requestQuit().then(() => {
    process.exitCode = 1;
  });
});

process.on("unhandledRejection", () => {
  void requestQuit().then(() => {
    process.exitCode = 1;
  });
});
