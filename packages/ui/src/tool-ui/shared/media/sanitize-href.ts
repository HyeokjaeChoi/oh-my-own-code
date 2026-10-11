/** Allow safe navigation only; app-side payload validation separately requires HTTP(S). */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function sanitizeHref(href?: string): string | undefined {
  if (!href) return undefined;
  const candidate = href.trim();
  if (!candidate) return undefined;

  if (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith("?") ||
    candidate.startsWith("#")
  ) {
    if (candidate.startsWith("//") || hasControlCharacters(candidate))
      return undefined;
    return candidate;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
