// Pure WCAG 2.x colour maths for the e2e accessibility audits (no dependencies).
// Colours are { r, g, b, a } with r/g/b 0-255 and a 0-1.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const channel = (token, scale) =>
  token.endsWith("%")
    ? (parseFloat(token) / 100) * scale
    : Number.parseFloat(token);

/** Parses #rgb[a], #rrggbb[aa], rgb()/rgba() (comma or space syntax), `transparent`. */
export function parseColor(input) {
  const text = String(input ?? "")
    .trim()
    .toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const h =
      hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = (i) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const [rgb, slashAlpha] = fn[1].split("/");
  let alpha = slashAlpha;
  const parts = rgb.split(/[\s,]+/).filter(Boolean);
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map((p) => channel(p, 255));
  const a = alpha === undefined ? 1 : channel(alpha.trim(), 1);
  if ([r, g, b, a].some(Number.isNaN)) return null;
  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    a: clamp(a, 0, 1),
  };
}

/** Source-over compositing of `fg` on `bg`. */
export function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f, b) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

/** Flattens background layers (nearest first) over an opaque `base`. */
export function flatten(layers, base) {
  return layers.reduceRight(
    (under, layer) => compositeOver(layer, under),
    base,
  );
}

export function relativeLuminance({ r, g, b }) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of two opaque colours (alpha is ignored; composite first). */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG "large text": >= 24px, or >= 18.66px (14pt) when bold. */
export const isLargeText = (fontSizePx, fontWeight) =>
  fontSizePx >= 24 || (fontSizePx >= 18.66 && Number(fontWeight) >= 700);
export const requiredTextRatio = (fontSizePx, fontWeight) =>
  isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;

/**
 * Text contrast: the foreground (with its own alpha and the element's effective
 * opacity) over the flattened ancestor background layers.
 */
export function textContrast({
  fg,
  layers,
  base,
  opacity = 1,
  fontSize,
  fontWeight,
}) {
  const bg = flatten(layers, base);
  const ink = compositeOver({ ...fg, a: fg.a * opacity }, bg);
  const required = requiredTextRatio(fontSize, fontWeight);
  const ratio = contrastRatio(ink, bg);
  return { ratio, required, pass: ratio >= required, ink, bg };
}

/** Splits a computed `box-shadow` into { color, x, y, blur, spread, inset }. */
export function parseBoxShadow(value) {
  if (!value || value === "none") return [];
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => {
    const inset = /\binset\b/.test(part);
    const color =
      /(?:rgba?|color|oklch|oklab|hsla?|lab|lch|color-mix)\([^)]*(?:\([^)]*\)[^)]*)*\)/.exec(
        part,
      )?.[0] ?? "";
    const nums = part
      .replace(color, "")
      .replace("inset", "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => Number.parseFloat(n));
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    return { color, x, y, blur, spread, inset };
  });
}
