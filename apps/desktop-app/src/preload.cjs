if (process.isMainFrame) {
  const { contextBridge, ipcRenderer, webUtils } = require("electron");

  contextBridge.exposeInMainWorld("desktopBridge", {
    workbench: (...args) => ipcRenderer.invoke("desktop:v2:workbench", ...args),
    terminal: (...args) => ipcRenderer.invoke("desktop:v1:terminal", ...args),
    preview: (...args) => ipcRenderer.invoke("desktop:v1:preview", ...args),
    data: (...args) => ipcRenderer.invoke("desktop:v1:data", ...args),
    automation: (...args) =>
      ipcRenderer.invoke("desktop:v1:automation", ...args),
    provider: (...args) => ipcRenderer.invoke("desktop:v1:provider", ...args),
    rules: (...args) => ipcRenderer.invoke("desktop:v1:rules", ...args),
    notify: (...args) => ipcRenderer.invoke("desktop:v1:notify", ...args),
    plans: (...args) => ipcRenderer.invoke("desktop:v1:plans", ...args),
    worktree: (...args) => ipcRenderer.invoke("desktop:v1:worktree", ...args),
    // Absolute path of a dropped File (drag-and-drop attach). Main still
    // canonicalizes and contains it via context.resolve.
    getPathForFile: (file) => {
      const path = webUtils.getPathForFile(file);
      return typeof path === "string" ? path : "";
    },
    cancelRead: (...args) =>
      ipcRenderer.invoke("desktop:v2:cancel-read", ...args),
    runtimeSnapshot: async (...args) => {
      const value = await ipcRenderer.invoke(
        "desktop:v1:runtime-snapshot",
        ...args,
      );
      if (value?.state === "unavailable" || value?.state === "disconnected") {
        return { state: value.state };
      }
      if (
        value?.state === "connected" &&
        typeof value.serverVersion === "string"
      ) {
        // Namespaced runtimes connect without a bootstrap session.
        const hasSession =
          typeof value.sessionTitle === "string" &&
          typeof value.sessionId === "string";
        return {
          state: "connected",
          serverVersion: value.serverVersion,
          ...(hasSession && {
            sessionTitle: value.sessionTitle,
            sessionId: value.sessionId,
          }),
        };
      }
      throw new Error("invalid_runtime_snapshot");
    },
  });
}
