// Windows-only environment entries an Electron child needs when HOME/TMP are redirected.
import { join } from "node:path";

export function windowsEnv(root, platform = process.platform) {
  if (platform !== "win32") return {};
  return {
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    USERPROFILE: root,
    APPDATA: join(root, "AppData", "Roaming"),
    LOCALAPPDATA: join(root, "AppData", "Local"),
  };
}
// POSIX tests pin a minimal PATH; Windows must keep its own.
export const e2ePath = (posixPath = "/usr/bin:/bin:/usr/sbin:/sbin") =>
  process.platform === "win32" ? (process.env.PATH ?? "") : posixPath;
