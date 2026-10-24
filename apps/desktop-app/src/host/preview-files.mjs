import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  PREVIEW_LIMITS,
  PREVIEW_SCHEME,
} from "../renderer/shared/preview/index.mjs";

const fail = (code) => Object.assign(new Error(code), { previewCode: code });
const PDF_BYTES = 25 * 1024 * 1024;
// Entry kinds (what a user can open) and the extra subresource types an HTML page may load.
const KINDS = {
  ".html": ["html", "text/html; charset=utf-8"],
  ".htm": ["html", "text/html; charset=utf-8"],
  ".md": ["markdown", "text/html; charset=utf-8"],
  ".markdown": ["markdown", "text/html; charset=utf-8"],
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".gif": ["image", "image/gif"],
  ".webp": ["image", "image/webp"],
  ".svg": ["image", "image/svg+xml"],
  ".pdf": ["pdf", "application/pdf"],
};
const ASSETS = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
// Scripts only from the preview origin (no inline); no plugins; no network beyond the preview
// origin (file mode never reaches loopback; webRequest enforces the same independently).
const HTML_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const STATIC_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:";
const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function previewKind(path) {
  return KINDS[extname(path).toLowerCase()]?.[0];
}
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
// `relPath` is workspace-relative and untrusted. Absolute paths, `..`/`.git` segments (after
// decoding), NULs and symlink escapes are refused; returns the realpath of an existing file.
export async function resolvePreviewFile(
  root,
  relPath,
  { assets = false } = {},
) {
  if (
    typeof relPath !== "string" ||
    !relPath ||
    relPath.includes("\0") ||
    relPath.includes("\\") ||
    isAbsolute(relPath)
  )
    throw fail("PATH_DENIED");
  const segments = relPath.split("/").filter((s) => s !== "" && s !== ".");
  if (
    !segments.length ||
    segments.some((s) => s === ".." || s.toLowerCase() === ".git")
  )
    throw fail("PATH_DENIED");
  const ext = extname(relPath).toLowerCase();
  const type = KINDS[ext]?.[1] ?? (assets ? ASSETS[ext] : undefined);
  if (!type) throw fail("UNSUPPORTED_TYPE");
  let real;
  let st;
  try {
    const base = await realpath(root);
    real = await realpath(resolve(base, ...segments));
    if (!inside(base, real)) throw fail("PATH_DENIED");
    st = await stat(real);
  } catch (err) {
    throw err?.previewCode ? err : fail("NOT_FOUND");
  }
  if (!st.isFile()) throw fail("NOT_FOUND");
  if (st.nlink !== 1) throw fail("PATH_DENIED"); // hardlink may alias a file outside the workspace
  if (st.size > (ext === ".pdf" ? PDF_BYTES : PREVIEW_LIMITS.fileBytes))
    throw fail("TOO_LARGE");
  return { real, ext, type, st };
}

// Opens without following links and re-checks the opened inode against the resolved one
// (closes swap/hardlink races between resolve and read).
async function readChecked({ real, ext, st }) {
  const max = ext === ".pdf" ? PDF_BYTES : PREVIEW_LIMITS.fileBytes;
  let handle;
  try {
    handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw fail("PATH_DENIED");
  }
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.ino !== st.ino ||
      info.dev !== st.dev ||
      info.size > max
    )
      throw fail("PATH_DENIED");
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(bytes, 0, info.size, 0);
    if (bytesRead !== info.size) throw fail("PATH_DENIED");
    return bytes;
  } finally {
    await handle.close();
  }
}

// Serves workspace files to the isolated preview session under `omoc-preview://<token>/<path>`.
// One unguessable token per opened preview maps to one workspace root; revoked when the view dies.
export function createPreviewFiles({ resolveWorkspace }) {
  const sites = new Map(); // token -> root
  const respond = (status, type, body, csp = STATIC_CSP) => ({
    status,
    headers: {
      "content-type": type,
      ...(csp && { "content-security-policy": csp }),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
    body,
  });
  return {
    async register(workspaceId, path) {
      const root = resolveWorkspace(workspaceId);
      if (!root) throw fail("NOT_FOUND");
      await resolvePreviewFile(root, path); // refuses before any view exists
      const token = randomBytes(16).toString("hex");
      sites.set(token, root);
      const origin = `${PREVIEW_SCHEME}://${token}/`;
      const entry = origin + path.split("/").map(encodeURIComponent).join("/");
      return { token, origin, entry };
    },
    revoke: (token) => void sites.delete(token),
    async serve(raw) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        return respond(400, "text/plain", "bad request");
      }
      const root = sites.get(u.hostname);
      if (u.protocol !== `${PREVIEW_SCHEME}:` || !root)
        return respond(404, "text/plain", "not found");
      try {
        const rel = decodeURIComponent(u.pathname.slice(1));
        const file = await resolvePreviewFile(root, rel, { assets: true });
        const bytes = await readChecked(file);
        const kind = KINDS[file.ext]?.[0];
        if (kind === "markdown")
          return respond(
            200,
            file.type,
            `<!doctype html><meta charset="utf-8"><title>${escapeHtml(rel)}</title><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,Menlo,monospace;margin:0;padding:16px">${escapeHtml(bytes.toString("utf8"))}</pre>`,
          );
        return respond(
          200,
          file.type,
          bytes,
          kind === "html" ? HTML_CSP : file.ext === ".pdf" ? "" : STATIC_CSP,
        );
      } catch (err) {
        const code = err?.previewCode;
        return respond(
          code === "NOT_FOUND" ? 404 : 403,
          "text/plain",
          code ?? "denied",
        );
      }
    },
  };
}
