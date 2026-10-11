import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function configureEphemeralProfile(app, parent = tmpdir()) {
  const root = mkdtempSync(join(parent, "oh-my-own-code-electron-"));
  const paths = {
    userData: join(root, "user-data"),
    sessionData: join(root, "session-data"),
    crashDumps: join(root, "crash-dumps"),
    logs: join(root, "logs"),
  };
  for (const [name, path] of Object.entries(paths)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    app.setPath(name, path);
  }

  let cleaned = false;
  return {
    root,
    paths,
    cleanup() {
      if (cleaned) return;
      rmSync(root, { recursive: true, force: false });
      cleaned = true;
    },
  };
}
