import {
  validApiKey,
  validBaseUrl,
  validProviderId,
} from "./provider-host.mjs";

const err = (code) => ({ ok: false, code });
const exact = (r, keys) =>
  Object.keys(r).sort().join() === [...keys, "type"].sort().join();

// Closed request set. The key exists only in `provider.connect` and is never echoed.
export function bindProviderIpc({ ipcMain, admit, host }) {
  ipcMain.handle("desktop:v1:provider", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = args[0];
    if (!r || typeof r !== "object" || Array.isArray(r))
      return err("INVALID_REQUEST");
    if (r.type === "provider.list" && exact(r, [])) return host.list();
    if (
      r.type === "provider.connect" &&
      exact(r, ["id", "key"]) &&
      validProviderId(r.id)
    )
      return validApiKey(r.key)
        ? host.connect(r.id, r.key)
        : err("INVALID_KEY");
    if (
      r.type === "provider.remove" &&
      exact(r, ["id"]) &&
      validProviderId(r.id)
    )
      return host.remove(r.id);
    if (
      r.type === "provider.local" &&
      exact(r, ["baseUrl"]) &&
      (r.baseUrl === "" || validBaseUrl(r.baseUrl))
    )
      return host.setLocalBaseUrl(r.baseUrl);
    return err("INVALID_REQUEST");
  });
}
