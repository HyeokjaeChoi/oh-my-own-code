import { redactText } from "./renderer/shared/data-transfer/index.mjs";

// Titles the app itself assigns before Native names a session. Only these may
// be replaced by a Native-generated title; anything else is user-chosen.
const PLACEHOLDERS = new Set(["Workbench", "Untitled session"]);
// OpenCode's own default ("New session - <ISO time>") is not a real title.
const NATIVE_DEFAULT = /^(?:New|Child) session - \d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const MAX_UNITS = 120; // workbench-contract session.rename limit (UTF-16 units)

export const isPlaceholderTitle = (title) =>
  typeof title !== "string" || !title.trim() || PLACEHOLDERS.has(title);

// A Native title as a valid, redacted `session.rename` title, or undefined.
export function nativeSessionTitle(raw) {
  if (typeof raw !== "string") return undefined;
  const text = redactText(raw.slice(0, 1024))
    .text.replace(/[\p{Cc}\s]+/gu, " ")
    .trim();
  let out = "";
  for (const char of text) {
    if (out.length + char.length > MAX_UNITS) break;
    out += char;
  }
  out = out.trim();
  return out && !PLACEHOLDERS.has(out) && !NATIVE_DEFAULT.test(out)
    ? out
    : undefined;
}
