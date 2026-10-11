import { stat, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  DATA_LIMITS,
  WIPE_WORD,
  validateDataRequest,
} from "../renderer/shared/data-transfer/index.mjs";

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });

// Separate channel: export/import/retention/wipe are host-owned app-data operations.
// dialogs: {saveFile(defaultName), openFile(), confirmWipe(), wipe()} supplied by main.
export function bindDataIpc({ ipcMain, admit, host, dialogs, appDataRoot }) {
  ipcMain.handle("desktop:v1:data", async (event, ...args) => {
    if (!admit(event) || args.length !== 1) return err("INVALID_REQUEST");
    const r = validateDataRequest(args[0]);
    if (!r) return err("INVALID_REQUEST");
    try {
      switch (r.type) {
        case "export.preview":
          return ok(host.exportPreview(r));
        case "export.save": {
          const { doc, summary } = host.exportBuild(r);
          const path = await dialogs.saveFile(
            `omoc-session-${doc.exportedAt.slice(0, 10)}.json`,
          );
          if (!path) return ok({ saved: false, summary });
          const tmp = `${path}.${randomUUID()}.tmp`;
          await writeFile(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
          await rename(tmp, path);
          return ok({ saved: true, name: basename(path), summary });
        }
        case "import.open": {
          const path = await dialogs.openFile();
          if (!path) return ok({ imported: false });
          if ((await stat(path)).size > DATA_LIMITS.fileBytes)
            return err("TOO_LARGE");
          return ok({
            imported: true,
            archive: await host.importText(await readFile(path, "utf8")),
          });
        }
        case "archives.list":
          return ok(await host.list());
        case "archives.get":
          return ok(await host.get(r.id));
        case "archives.remove":
          return ok(await host.remove(r.id));
        case "retention.get":
          return ok(await host.retention());
        case "retention.preview":
          return ok(await host.retentionPreview(r.days));
        case "retention.set":
          return ok(await host.retentionSet(r.days));
        case "wipe.info":
          return ok({ root: appDataRoot() });
        default:
          if (r.word !== WIPE_WORD) return err("CONFIRM_MISMATCH");
          if (!(await dialogs.confirmWipe())) return ok({ started: false });
          dialogs.wipe();
          return ok({ started: true });
      }
    } catch (e) {
      return err(e?.dataCode ?? "RUNTIME_ERROR");
    }
  });
}
