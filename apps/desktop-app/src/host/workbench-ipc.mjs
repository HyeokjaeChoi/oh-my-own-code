import { failure } from "../workbench-contract.mjs";

// Electron sender/frame authority is checked before payload parsing or allocation.
export function bindWorkbenchIpc({ ipcMain, admit, service }) {
  ipcMain.handle("desktop:v2:workbench", (event, ...args) => {
    if (!admit(event) || args.length !== 1) return failure("INVALID_REQUEST");
    return (
      service()?.handle(args[0], String(event.sender.id)) ??
      failure("UNAVAILABLE")
    );
  });
  ipcMain.handle("desktop:v2:cancel-read", (event, ...args) => {
    if (!admit(event) || args.length !== 1) return failure("INVALID_REQUEST");
    return (
      service()?.cancelRead(args[0], String(event.sender.id)) ??
      failure("UNAVAILABLE")
    );
  });
}
