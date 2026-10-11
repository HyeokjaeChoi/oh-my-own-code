import { probeWorkspaceMeta } from "./host/workspace-meta.mjs";
import { createConversationContextIO } from "./host/conversation-context-io.mjs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  executableForResources,
  startSidecar,
  openDurableManifest,
  createOSProcessIdentityAdapter,
} from "./sidecar-supervisor.mjs";
import { eventHostForResources } from "./event-host-resources.mjs";
import {
  configureEphemeralProfile,
  prepareDurableNamespace,
} from "./ephemeral-profile.mjs";
import {
  acceptsNoIpcArguments,
  admitsRendererRequest,
} from "./renderer-admission.mjs";

import { createWorkbenchService } from "./workbench-service.mjs";
import { bindWorkbenchIpc } from "./host/workbench-ipc.mjs";
import { setInterval } from "node:timers";
import {
  createTerminalHost,
  resolveLoginPath,
} from "./host/terminal-host.mjs";
import { bindTerminalIpc } from "./host/terminal-ipc.mjs";
import { createPlansHost } from "./host/plans-host.mjs";
import { bindPlansIpc } from "./host/plans-ipc.mjs";
import { createDataHost, wipeAppDataSync } from "./host/data-host.mjs";
import { bindDataIpc } from "./host/data-ipc.mjs";
import { createPreviewHost } from "./host/preview-host.mjs";
import { bindPreviewIpc } from "./host/preview-ipc.mjs";
import { createPreviewViewFactory } from "./host/preview-view.mjs";
import { createWorktreeHost } from "./host/worktree-host.mjs";
import { bindWorktreeIpc } from "./host/worktree-ipc.mjs";
import {
  createStorageOwner,
  createElectronOwnerKernel,
  createProcessVerifier,
} from "./host/storage-lock.mjs";
import { openWorkspaceRegistry } from "./host/workspace-registry.mjs";
import { createLifetimeWitness } from "./host/owner-lifetime.mjs";
import { createNativePreflight } from "./host/native-preflight.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

let workbench;
const worktrees = createWorktreeHost({
  documentsRoot: () => namespace.documents,
  linksFile: () => join(namespace.metadata, "worktree-links.json"),
});
const terminals = createTerminalHost({
  resolveWorkspace: (id) => workbench?.terminalRoot(id),
  loginPath: resolveLoginPath(),
});
const plans = createPlansHost({
  resolveWorkspace: (id) => workbench?.terminalRoot(id),
  storeFile: () => join(namespace.metadata, "plans.json"),
  terminals: (owner, workspaceId) => terminals.list(owner, workspaceId),
});
// Set by the confirmed "앱 데이터 삭제"; executed in will-quit after storage is released.
let wipeOnQuit = false;
// True only after this process acquired the storage owner; wipe never runs otherwise.
let ownedStorage = false;
const dataHost = createDataHost({
  metadataDir: () => namespace.metadata,
  appVersion: app.getVersion(),
});
const previews = createPreviewHost({
  createView: createPreviewViewFactory({ getWindow: () => mainWindow }),
  resolveWorkspace: (id) => workbench?.terminalRoot(id),
  openExternal: (url) => shell.openExternal(url),
});
const here = dirname(fileURLToPath(import.meta.url));
const developmentUrl = process.env.OMOC_DESKTOP_DEV_URL;
const runtimeEpoch = randomUUID();
let namespace;
let owner;
let registry;
let initialRecovery;
let kernel;
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
try {
  if (!gotInstanceLock) throw new Error("second_instance");
  namespace = prepareDurableNamespace(app);
  kernel = createElectronOwnerKernel(app);
  // This call must stay synchronous, before whenReady and profile override.
  if (!kernel.acquire(namespace.root)) initialRecovery = "owner_conflict";
} catch {
  initialRecovery = "storage_denied";
}
const ephemeralProfile = configureEphemeralProfile(
  app,
  undefined,
  namespace ? [namespace.root, namespace.documents] : [],
);
const processIdentity = createOSProcessIdentityAdapter();
const registryPromise = (async () => {
  if (initialRecovery) {
    if (initialRecovery === "owner_conflict") {
      registry = await openWorkspaceRegistry({
        runtimeEpoch,
        recoveryReason: initialRecovery,
      });
      return registry;
    }
    throw Object.assign(new Error("storage unavailable"), {
      storageReason: initialRecovery,
    });
  }
  owner = createStorageOwner({
    root: namespace.root,
    kernel,
    processVerifier: createProcessVerifier(processIdentity),
    lifetimeWitness: createLifetimeWitness({
      resourcesPath: app.isPackaged
        ? process.resourcesPath
        : join(here, "..", "resources"),
      processIdentity,
    }),
  });
  const result = await owner.acquire({ initialize: namespace.fresh });
  ownedStorage = result.state === "ready";
  if (result.state !== "ready") {
    if (["owner_conflict", "owner_unverified"].includes(result.reason)) {
      registry = await openWorkspaceRegistry({
        runtimeEpoch,
        recoveryReason: result.reason,
      });
      return registry;
    }
    throw Object.assign(new Error("owner unavailable"), {
      storageReason: result.reason,
    });
  }
  try {
    const manifest = await openDurableManifest(namespace, owner, {
      nativeDatabase: join(namespace.data, "event-host.sqlite"),
    });
    let ownerReason;
    const requireOwner = async () => {
      if (ownerReason)
        throw Object.assign(new Error("owner unavailable"), {
          storageReason: ownerReason,
        });
      try {
        const current = await owner.assertOwned(owner.getNonce());
        if (current.state !== "ready") {
          ownerReason = current.reason;
          throw Object.assign(new Error("owner unavailable"), {
            storageReason: ownerReason,
          });
        }
      } catch (error) {
        ownerReason ??= "owner_unverified";
        // Loss revokes live task facts immediately; it does not settle IO or
        // alter any durable original receipt. The facade may not exist yet.
        registry?.invalidateTaskAuthority?.();
        throw error;
      }
    };
    const storage = await openWorkspaceRegistry({
      directory: namespace.metadata,
      storeId: manifest.storeId,
      documentsPath: namespace.documents,
      runtimeEpoch,
      pathIO: {
        mkdir: async (...args) => {
          await requireOwner();
          return mkdir(...args);
        },
      },
    });
    // One registry authority with an owner fence, never a second journal/root.
    registry = {
      ...storage,
      status: () =>
        ownerReason
          ? {
              ...storage.status(),
              state: "recovery_required",
              reason: ownerReason,
            }
          : storage.status(),
      readView: () => {
        const view = storage.readView();
        if (ownerReason) {
          view.recovery.store = {
            state: "recovery_required",
            reason: ownerReason,
          };
          view.state = "unavailable";
          view.messages = [];
          view.permissions = [];
        }
        return view;
      },
    };
    for (const method of [
      "begin",
      "reserve",
      "dispatch",
      "complete",
      "materializeManaged",
      "recordOwnerIntent",
      "recordMigrationPhase",
      "checkpoint",
      "recordTask",
      "recordPermissionReconciled",
      "permissionProgress",
    ]) {
      registry[method] = async (...args) => {
        await requireOwner();
        const result = await storage[method](...args);
        if (
          [
            "dispatch",
            "recordTask",
            "recordPermissionReconciled",
            "permissionProgress",
          ].includes(method)
        )
          await requireOwner();
        return result;
      };
    }
    return registry;
  } catch (error) {
    throw Object.assign(new Error("manifest unavailable"), {
      storageReason: ["identity_conflict", "unsupported_version"].includes(
        error.message,
      )
        ? error.message
        : "storage_denied",
    });
  }
})();
registryPromise.catch(() => {});
let storageShutdown = false;
let nativePreflight;
async function finishStorage() {
  if (storageShutdown) return;
  previews.closeAll();
  await terminals.closeAll();
  await workbench?.drain();
  const inspection = await nativePreflight?.close();
  if (inspection && (!inspection.exited || inspection.cleanup !== "complete"))
    throw new Error("native preflight cleanup unconfirmed");
  if (registry) {
    if (registry.status().state === "ready") {
      if (owner?.getNonce())
        await registry.recordOwnerIntent({
          ownerNonce: owner.getNonce(),
          phase: "shutdown",
        });
      await registry.checkpoint();
    }
    await registry.close();
  }
  if (owner?.getNonce()) {
    const result = await owner.release(owner.getNonce());
    if (!result.released) throw new Error("owner release unconfirmed");
  }
  storageShutdown = true;
}
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
    !quitAfterStartup &&
      mainWindow &&
      admitsRendererRequest(event, mainWindow.webContents, allowedRendererUrl),
  );
}

function bindIpc() {
  bindWorkbenchIpc({ ipcMain, admit, service: () => workbench });
  bindTerminalIpc({ ipcMain, admit, host: terminals });
  bindPlansIpc({ ipcMain, admit, host: plans });
  bindPreviewIpc({ ipcMain, admit, host: previews });
  bindDataIpc({
    ipcMain,
    admit,
    host: dataHost,
    appDataRoot: () => namespace?.root,
    owned: () => ownedStorage,
    dialogs: {
      async saveFile(defaultPath) {
        const r = await dialog.showSaveDialog(mainWindow, {
          title: "세션 내보내기",
          defaultPath,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return r.canceled ? undefined : r.filePath;
      },
      async openFile() {
        const r = await dialog.showOpenDialog(mainWindow, {
          title: "내보낸 기록 가져오기",
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return r.canceled ? undefined : r.filePaths[0];
      },
      async confirmWipe() {
        const r = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "앱 데이터 삭제",
          message: "앱 데이터를 모두 삭제하고 앱을 종료하시겠습니까?",
          detail: `${namespace?.root}\n\n이 폴더의 내용(워크스페이스 목록, 저널, 계획, 워크트리 링크, 가져온 기록, Native 대화 기록 데이터)이 삭제되며 되돌릴 수 없습니다.\n프로젝트 폴더와 Git 저장소, 외부 제공자에 이미 전송된 데이터는 삭제되지 않습니다.`,
          buttons: ["취소", "삭제 후 종료"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return r.response === 1;
      },
      wipe() {
        wipeOnQuit = true;
        void requestQuit();
      },
    },
  });
  // Retention for imported archives: at start, then daily.
  void dataHost.sweep().catch(() => undefined);
  setInterval(
    () => void dataHost.sweep().catch(() => undefined),
    86400000,
  ).unref();
  bindWorktreeIpc({
    ipcMain,
    admit,
    host: worktrees,
    info: (id) => workbench?.workspaceInfo(id),
    async confirmDelete({ kind, path, reasons, force }) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "실제 삭제",
        message:
          kind === "worktree"
            ? "이 워크트리 폴더를 디스크에서 삭제하시겠습니까?"
            : "이 앱이 만든 폴더를 디스크에서 삭제하시겠습니까?",
        detail: `${path}\n\n폴더와 안의 파일이 디스크에서 삭제되며 되돌릴 수 없습니다.${kind === "worktree" ? "\n브랜치는 삭제하지 않습니다." : ""}${force ? `\n\n강제 삭제 사유:\n${reasons.join("\n")}` : ""}\n\n목록 제거·대화 기록 삭제와는 별개 작업입니다.`,
        buttons: ["취소", force ? "강제로 삭제" : "삭제"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
  });
  // Workspace removal/untrust has no hook; sweep so its terminals never outlive it.
  setInterval(() => void terminals.reap(), 2000).unref();
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
  mainWindow.webContents.once("destroyed", () => {
    workbench?.closeSender(senderScope);
    void terminals.closeOwner(senderScope);
    previews.closeOwner(senderScope);
  });
  mainWindow.webContents.on("render-process-gone", () => {
    workbench?.closeSender(senderScope);
    void terminals.closeOwner(senderScope);
    previews.closeOwner(senderScope);
  });
  mainWindow.on("closed", () => {
    workbench?.closeSender(senderScope);
    void terminals.closeOwner(senderScope);
    previews.closeOwner(senderScope);
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
  const active = runtime;
  stopPromise = Promise.resolve()
    .then(async () => {
      await workbench?.drain();
      workbench?.close();
      return active.stop();
    })
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
    await finishStorage();
    app.quit();
  } else if (
    result.exited &&
    result.cleanup === "failed" &&
    result.recoveryPath
  ) {
    reportCleanupFailure(result.recoveryPath);
    runtime = undefined;
    startupError = undefined;
    await finishStorage();
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

    await finishStorage();
    app.quit();
  })()
    .catch((error) => {
      startupError = error;
      reportStopFailure();
    })
    .finally(() => {
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
  startupPromise = (async () => {
    const store = await registryPromise;
    const view = store.readView();
    if (view.recovery.store.state !== "ready")
      throw Object.assign(new Error("storage recovery"), {
        storageReason: view.recovery.store.reason,
      });
    // Unresolved app operations never authorize Native recovery or replay.
    if (view.retainedOperations.length)
      throw Object.assign(new Error("pending recovery"), {
        storageReason: "native_startup_unverified",
      });
    const eventHost = eventHostForResources(
      app.isPackaged ? process.resourcesPath : join(here, "..", "resources"),
      process.platform,
      process.arch,
    );
    nativePreflight = createNativePreflight({
      namespace,
      owner,
      registry: store,
      eventHost,
      processIdentity,
      signal: startupAbortController.signal,
    });
    if (!(await nativePreflight.check()))
      throw Object.assign(new Error("native startup unverified"), {
        storageReason: nativePreflight.reason(),
      });
    await store.recordOwnerIntent({
      ownerNonce: owner.getNonce(),
      phase: "startup",
    });
    if (e2eScenario === "startup-failure") {
      throw new Error("event_host_missing_e2e_fixture");
    }
    return startSidecar({
      eventHost,
      runtimeEpoch,
      namespace,
      owner,
      processIdentity,
      preflight: nativePreflight.check,
      binaryPath,
      signal: startupAbortController.signal,
      ...(e2eScenario === "startup-timeout" && { startupTimeoutMs: 25 }),
      ...(e2eScenario === "service-collision" &&
        Number.isInteger(e2ePort) &&
        e2ePort > 0 &&
        e2ePort <= 65535 && { port: e2ePort }),
    });
  })();
  startupPromise.catch(() => {});
  workbench = createWorkbenchService({
    contextIO: createConversationContextIO({
      validateImage: (bytes) => !nativeImage.createFromBuffer(bytes).isEmpty(),
    }),
    registry: registryPromise,
    runtimeReady: startupPromise,
    runtimeEpoch,
    bootstrap: true,
    probeWorkspace: probeWorkspaceMeta,
    async pickDirectory() {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    async confirmAgentRuntime({
      action,
      workspacePath,
      sourceName,
      nativeId,
      path,
      system,
      digest,
      systemDigest,
      permissions,
      defaultAgentId,
    }) {
      const registering = action === "register";
      const label = registering ? "primary agent 등록" : "등록 제거";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: `Native Agent ${label}`,
        message: registering
          ? "이 파일을 작업 공간의 primary agent로 등록하시겠습니까?"
          : "이 작업 공간의 Native Agent 등록을 제거하시겠습니까?",
        detail: `작업 공간: ${workspacePath}\n원본: ${sourceName}\n파일: ${path}\nNative ID: ${nativeId}\n기본 agent: ${defaultAgentId}\n파일 SHA256: ${digest}\nNative system SHA256: ${systemDigest}\n범위: 이 작업 공간의 모든 세션\n기본 agent와 현재 세션 선택은 유지됩니다. 다음 요청에 사용할 agent는 별도로 선택합니다.\n${registering ? "primary · visible · model override 없음 · request settings/headers/body 비어 있음" : "전체 세션 참조가 없어야 제거할 수 있습니다. 파일과 기존 세션 기록은 유지됩니다."}\n권한:\n${permissions.map((r) => `${r.action} / ${r.resource} / ${r.effect}`).join("\n")}\n모델을 시작하지 않습니다.\n\nNative system:\n${system}`,
        buttons: ["취소", label],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmSkillRuntime({
      action,
      workspacePath,
      sessionId,
      nativeSessionId,
      sourceName,
      nativeId,
      name,
      path,
      content,
      digest,
      bodyDigest,
    }) {
      const labels = {
        register: "비활성 등록",
        remove: "등록 제거",
        apply: "선택한 세션에 적용",
      };
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: `Native Skill ${labels[action]}`,
        message:
          action === "register"
            ? "이 Skill을 자동 호출이 꺼진 상태로 등록하시겠습니까?"
            : action === "remove"
              ? "이 작업 공간의 Native Skill 등록을 제거하시겠습니까?"
              : "이 Skill 내용을 선택한 세션 기록에 추가하시겠습니까?",
        detail: `작업 공간: ${workspacePath}\n원본 폴더: ${sourceName}\n파일: ${path}\nNative ID: ${nativeId}\n이름: ${name}\n${sessionId ? `세션: ${sessionId} (${nativeSessionId})\n` : "범위: 이 작업 공간의 모든 세션\n"}파일 SHA256: ${digest}\nNative 본문 SHA256: ${bodyDigest}\n${action === "register" ? "파일 설정과 관계없이 autoinvoke:false로 등록합니다." : action === "remove" ? "기존 세션에 기록된 Skill 내용은 유지됩니다. 과거 context를 지우지 않습니다." : "resume:false로 기록합니다. 모델을 시작하지 않습니다. 모델의 실제 사용은 확인하지 않았습니다."}\n저장 파일은 변경하지 않습니다.\n\n적용 본문:\n${content}`,
        buttons: ["취소", labels[action]],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmMcp({
      action,
      workspacePath,
      sourceName,
      nativeName,
      definition,
      digest,
      sourceVersion,
    }) {
      const labels = {
        register: "비활성 등록",
        connect: "연결",
        disconnect: "연결 해제",
        remove: "등록 제거",
      };
      const target =
        definition?.type === "local"
          ? `명령 인자: ${JSON.stringify(definition.command)}\n실행 폴더: ${definition.cwd}`
          : definition?.type === "remote"
            ? `원격 주소: ${definition.url}\n인증은 기존 외부 설정에서 관리합니다.`
            : "";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: `MCP ${labels[action]}`,
        message:
          action === "register"
            ? "MCP 서버를 실행하지 않고 비활성 상태로 등록하시겠습니까?"
            : `이 작업 공간의 MCP 서버를 ${labels[action]}하시겠습니까?`,
        detail: `작업 공간: ${workspacePath}\n원본 서버 이름: ${sourceName}\nNative 등록 이름: ${nativeName}\n범위: 이 작업 공간의 모든 세션과 이후 새 세션\n${target}\n${digest ? `등록 요청 SHA256: ${digest}\n파일 관찰 버전: ${sourceVersion}\n` : ""}${action === "register" ? "파일의 활성 설정과 관계없이 비활성 상태로 등록합니다. 실행하려면 별도로 연결해야 합니다." : action === "connect" ? "표시한 명령 또는 주소로 연결합니다. 도구와 지침이 작업 공간의 모든 세션에 제공될 수 있습니다. 연결 중 Native가 만료된 원격 연결을 다시 연결할 수 있습니다." : "Native 연결 상태를 확인합니다. 모든 하위 프로세스의 종료를 확인하는 기능은 아닙니다."}\n저장 파일과 대화 기록은 변경하지 않습니다. 모델의 실제 사용은 확인하지 않았습니다.`,
        buttons: ["취소", labels[action]],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmInstructions({
      action,
      workspacePath,
      sessionId,
      sessionTitle,
      targetPath,
      digest,
      sourceVersion,
      empty,
    }) {
      const removing = action === "remove";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: removing ? "세션 지침 등록 해제" : "세션 지침 등록",
        message: removing
          ? "이 세션의 앱 지침 등록을 해제하시겠습니까?"
          : empty
            ? "빈 지침을 이 세션에 등록하시겠습니까?"
            : "이 파일의 지침을 이 세션에 등록하시겠습니까?",
        detail: `작업 공간: ${workspacePath}\n세션: ${sessionTitle} (${sessionId})\n${removing ? "AGENTS.md 파일과 대화 기록은 유지합니다. 과거 모델 context는 지우지 않습니다." : `파일: ${targetPath}\n파일 관찰 버전: ${sourceVersion}\n내용 SHA256: ${digest}\n기존 앱 지침을 이 내용으로 대체합니다.`}\n다음 context 준비부터 사용할 등록입니다. 모델의 실제 소비는 확인하지 않았습니다.`,
        buttons: ["취소", removing ? "등록 해제" : "세션에 등록"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmGitBranchRestore({
      workspacePath,
      action,
      branch,
      source,
      currentBranch,
      headOid,
      nextHeadOid,
      author,
      timestamp,
      paths,
      metadata,
      backups,
    }) {
      const title =
        action === "create"
          ? "Local branch 생성"
          : action === "select"
            ? "Local branch 선택 · 실제 checkout"
            : "선택한 worktree 파일 복원";
      const file = (v) =>
        v
          ? `${v.bytes} bytes · mode ${v.mode.toString(8)} · SHA-256 ${v.digest}`
          : "없음";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title,
        message: `${title}을 적용하시겠습니까?`,
        detail: `${workspacePath}\n현재: ${currentBranch ?? "detached HEAD"}\nHEAD: ${headOid} → ${nextHeadOid}\n${action === "restore" ? `복원 기준: ${source === "index" ? "INDEX" : "HEAD"}\nindex와 HEAD는 유지합니다. 선택한 파일의 현재 내용·존재·mode를 대체합니다.` : `대상: ${branch}\n작성자: ${author.name} <${author.email}>\n시각: ${new Date(timestamp * 1000).toISOString()}\n${action === "create" ? "현재 HEAD에 새 branch를 만들며 전환하지 않습니다." : "작업 파일과 index를 바꾸고 마지막에 HEAD를 전환합니다."}`}\n\n${paths.map((p) => `${p.path}\n현재: ${file(p.before)}\n적용 후: ${file(p.after)}`).join("\n\n")}\n\nMetadata\n${metadata.map((m) => `${m.role}: ${m.before ? `${m.before.bytes} bytes / ${m.before.digest}` : "없음"} → ${m.after.bytes} bytes / ${m.after.digest}`).join("\n")}\n\n보관 위치 · Git metadata root\n${backups.map((b) => `${b.role}${b.path ? ` / ${b.path}` : ""}: ${b.backupId ?? "기존 파일 없음 · backup 없음"}`).join("\n")}\n여러 파일을 순서대로 변경합니다. 중간 오류가 나면 일부 변경이 남을 수 있습니다. 자동 복구·재실행하지 않습니다.`,
        buttons: ["취소", "적용"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmGitCommit({
      workspacePath,
      author,
      timestamp,
      canonicalMessage,
      entries,
      headOid,
      treeOid,
      commitOid,
      reference,
      logs,
      backups,
    }) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "stage 전체 commit",
        message: "표시한 stage 변경 전체로 commit을 만드시겠습니까?",
        detail: `${workspacePath}\n대상: ${reference.name ?? "detached HEAD"}\n작성자: ${author.name} <${author.email}>\n시각: ${new Date(timestamp * 1000).toISOString()}\n부모: ${headOid ?? "없음 (첫 commit)"}\ntree: ${treeOid}\ncommit: ${commitOid}\n\n${entries.map((x) => x.path).join("\n")}\n\n정확한 메시지\n${canonicalMessage}\n\n서명과 hooks 없이 로컬 commit을 만듭니다. 작업 파일과 index는 유지합니다. ${logs.length}개 reflog와 현재 reference를 바꿉니다.\n${backups.map((x) => `${x.role}: ${x.backupId ?? "기존 파일 없음 · backup 없음"}`).join("\n")}\n중간 오류가 나면 결과 확인이 필요하며 자동 재실행하지 않습니다.`,
        buttons: ["취소", "commit 만들기"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmGitIndex({
      workspacePath,
      action,
      paths,
      indexExists,
      backupId,
    }) {
      const staging = action === "stage";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: staging ? "선택한 파일 stage" : "선택한 파일 unstage",
        message: staging
          ? "선택한 파일의 stage 내용을 현재 파일로 바꾸시겠습니까?"
          : "선택한 파일의 stage 내용을 HEAD 기준으로 되돌리시겠습니까?",
        detail: `${workspacePath}\n\n${paths.join("\n")}\n\n작업 파일은 바꾸지 않습니다. 선택한 파일의 기존 stage 내용은 대체됩니다. 새 blob object가 남을 수 있습니다.\n${indexExists ? `기존 index 보관: ${backupId}` : "기존 index가 없어 원본 backup은 만들지 않습니다."}`,
        buttons: ["취소", staging ? "stage 적용" : "unstage 적용"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    async confirmConfigurationSave({
      kind,
      targetPath,
      expectation,
      text,
      previousText,
      backupId,
    }) {
      const ordinaryFile = kind === "file";
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: ordinaryFile ? "파일 저장" : "설정 파일 저장",
        message:
          expectation === "missing"
            ? "새 설정 파일을 만드시겠습니까?"
            : text.trim()
              ? "이 내용으로 파일을 바꾸시겠습니까?"
              : "파일 내용을 비우시겠습니까?",
        detail: `${targetPath}\n${backupId ? `기존 파일 보관: ${backupId}\n` : ""}${ordinaryFile ? "이 파일만 저장합니다. Native 실행이나 설정 적용은 수행하지 않습니다." : "파일 저장만 수행합니다. 런타임 적용은 별도입니다."}\n\n${ordinaryFile ? `기존 내용\n${previousText}\n\n저장할 내용\n` : ""}${text}`,
        buttons: ["취소", "파일에 저장"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
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
  try {
    runtime = await startupPromise;
  } catch (error) {
    startupError = error;
  }
  startupComplete = true;
  if (quitAfterStartup) return;
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  if (storageShutdown) return;
  event.preventDefault();
  void requestQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  terminals.killAllSync();
  if (wipeOnQuit) {
    let result = { ok: false, reason: "STORAGE_NOT_RELEASED" };
    try {
      if (storageShutdown && namespace && ownedStorage)
        result = wipeAppDataSync(namespace.root);
    } catch {
      result = { ok: false, reason: "REMOVE_FAILED" };
    }
    if (!result.ok)
      dialog.showErrorBox(
        "App data deletion failed",
        `앱 데이터를 삭제하지 못했습니다 (${result.reason}). 앱 종료 후 직접 삭제하세요:\n${namespace?.root}`,
      );
  }
  try {
    if (storageShutdown) ephemeralProfile.cleanup();
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
