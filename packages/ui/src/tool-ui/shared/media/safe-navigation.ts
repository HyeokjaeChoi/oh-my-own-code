import { sanitizeHref } from "./sanitize-href.js";

export function openSafeNavigationHref(href: string | undefined): boolean {
  const safeHref = sanitizeHref(href);
  if (!safeHref || typeof window === "undefined") return false;
  window.open(safeHref, "_blank", "noopener,noreferrer");
  return true;
}
