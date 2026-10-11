// Browser-safe preview request validation and URL policy. No IO.
export const PREVIEW_LIMITS = Object.freeze({
  urlChars: 2048,
  fileBytes: 5 * 1024 * 1024,
  pathChars: 1024,
});
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Normalized URL string for a local dev-server URL, else undefined.
// WHATWG parsing neutralizes `localhost.evil.com` (different host), `http://localhost@evil.com`
// (userinfo is rejected outright) and numeric tricks (`127.1` normalizes to 127.0.0.1, still loopback).
// 0.0.0.0 and `localhost.` are not in the set and are rejected.
export function parseLocalUrl(raw) {
  if (typeof raw !== "string" || raw.length > PREVIEW_LIMITS.urlChars)
    return undefined;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" || u.username || u.password) return undefined;
  if (!LOOPBACK.has(u.hostname)) return undefined;
  return u.href;
}
// http(s) URL for the "open externally" fallback (after a UI confirm), else undefined.
export function parseExternalUrl(raw) {
  if (typeof raw !== "string" || raw.length > PREVIEW_LIMITS.urlChars)
    return undefined;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname)
    return undefined;
  return u.href;
}
// Navigation guard: "inert" views (workspace HTML) may never navigate; url views only to local URLs.
export function navigationDecision(mode, url) {
  if (mode === "url" && parseLocalUrl(url)) return "allow";
  if (mode === "url" && parseExternalUrl(url)) return "external";
  return "deny";
}

const bound = (v) => Number.isInteger(v) && v >= 0 && v <= 20000;
const schemas = {
  "preview.open": ["url"],
  "preview.openFile": ["workspaceId", "path"],
  "preview.bounds": ["x", "y", "width", "height"],
  "preview.nav": ["action"],
  "preview.state": [],
  "preview.openExternal": ["url"],
  "preview.close": [],
};
// Returns the request when valid, otherwise undefined.
export function validatePreviewRequest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.hasOwn(schemas, value.type)
  )
    return undefined;
  const keys = schemas[value.type];
  const allowed = new Set(["type", ...keys]);
  if (
    Reflect.ownKeys(value).some((k) => !allowed.has(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    return undefined;
  for (const k of keys) {
    const v = value[k];
    if (
      k === "url" &&
      !(typeof v === "string" && v.length <= PREVIEW_LIMITS.urlChars)
    )
      return undefined;
    if (
      k === "workspaceId" &&
      !(typeof v === "string" && /^[\w.:-]{1,256}$/.test(v))
    )
      return undefined;
    if (
      k === "path" &&
      !(
        typeof v === "string" &&
        v.length > 0 &&
        v.length <= PREVIEW_LIMITS.pathChars &&
        v.isWellFormed() &&
        !v.includes("\0")
      )
    )
      return undefined;
    if (["x", "y", "width", "height"].includes(k) && !bound(v))
      return undefined;
    if (k === "action" && !["back", "forward", "reload"].includes(v))
      return undefined;
  }
  return value;
}
