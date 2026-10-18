import {
  compositeOver,
  contrastRatio,
  flatten,
  parseBoxShadow,
  textContrast,
} from "./a11y-contrast.mjs";

// Dependency-free visual accessibility audits for the e2e suites: WCAG text and
// control-boundary contrast from computed styles, and keyboard focus indicators.
// Colours are normalised by the browser (canvas), so oklch()/color-mix() work.
// The maths lives in a11y-contrast.mjs; this file only reads the page.

const PAGE_HELPERS = `(() => {
  const g = globalThis;
  const canvas = g.document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  g.__a11yNorm = (value) => {
    ctx.fillStyle = "#123456";
    ctx.fillStyle = value;
    if (ctx.fillStyle === "#123456" && value.trim().toLowerCase() !== "#123456")
      return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  // Background layers of el and its ancestors, nearest first, up to the first
  // opaque one. image=true when a gradient/url sits above that opaque layer.
  g.__a11yLayers = (el) => {
    const layers = [];
    let image = false;
    for (let n = el; n; n = n.parentElement) {
      const s = g.getComputedStyle(n);
      const c = g.__a11yNorm(s.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
      if (s.backgroundImage !== "none") image = true;
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    return { layers, image };
  };
  // Jumps finite transitions to their end state (a hidden e2e window never
  // ticks them, so computed colours would lag the real ones); infinite
  // animations (spinners) are left alone. Style flush first, then finish.
  g.__a11ySettle = () => {
    for (let pass = 0; pass < 3; pass++) {
      // Reading every element's style forces lazily-styled subtrees to start
      // their pending transitions so they can be finished too.
      for (const el of g.document.querySelectorAll("*"))
        g.getComputedStyle(el).backgroundColor;
      for (const a of g.document.getAnimations())
        if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
    }
  };
  g.__a11yOpacity = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement)
      o *= Number(g.getComputedStyle(n).opacity);
    return o;
  };
  g.__a11yDescribe = (el) => {
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.split(/\\s+/)[0] : "";
    const role = el.getAttribute("role");
    const label = (el.getAttribute("aria-label") || el.textContent || el.value || "")
      .replace(/\\s+/g, " ").trim().slice(0, 40);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls +
      (role ? "[role=" + role + "]" : "") + ' "' + label + '"';
  };
})()`;

// Installs the page helpers. Colour transitions start at the next frame after a
// theme/tab change and tick slowly in a hidden e2e window, so wait a beat for
// them to exist, then jump them to the end state (see __a11ySettle).
const prepare = async (page) => {
  await page.evaluate(`if (!globalThis.__a11yNorm) ${PAGE_HELPERS}; true`);
  await page.evaluate(async () => {
    await new Promise((r) => globalThis.setTimeout(r, 300));
    globalThis.__a11ySettle();
  });
};

const hex = ({ r, g, b }) =>
  "#" +
  [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * Text contrast of every visible text-bearing element under `scope`.
 * `allow` entries ({ match: RegExp tested on the description, reason }) exempt
 * documented decorative/placeholder cases. Returns { violations, checked, skipped }.
 */
export async function auditContrast(page, scope = "body", { allow = [] } = {}) {
  await prepare(page);
  const items = await page.evaluate((scopeSelector) => {
    const g = globalThis;
    g.__a11ySettle();
    const root = g.document.querySelector(scopeSelector);
    if (!root) return { error: `scope ${scopeSelector} not found` };
    const out = [];
    const skipped = [];
    const seen = new Map();
    const consider = (el, kind) => {
      if (seen.get(el)?.has(kind)) return;
      seen.set(el, (seen.get(el) ?? new Set()).add(kind));
      const s = g.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (s.visibility !== "visible" || s.display === "none") return;
      if (el.closest("[aria-hidden='true'],[inert],[hidden],.xterm")) return;
      const disabled = el.closest(":disabled,[aria-disabled='true']");
      if (disabled) return skipped.push("disabled");
      const color =
        kind === "placeholder"
          ? g.getComputedStyle(el, "::placeholder").color
          : s.color;
      const { layers, image } = g.__a11yLayers(el);
      if (image) return skipped.push("background-image");
      out.push({
        kind,
        description: g.__a11yDescribe(el),
        fg: g.__a11yNorm(color),
        layers,
        opacity: g.__a11yOpacity(el),
        fontSize: Number.parseFloat(s.fontSize),
        fontWeight: Number(s.fontWeight) || 400,
      });
    };
    const all = [root, ...root.querySelectorAll("*")];
    for (const el of all) {
      if (
        [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim() !== "",
        )
      )
        consider(el, "text");
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        if (
          el.value &&
          !/^(checkbox|radio|range|color|file|hidden)$/.test(el.type)
        )
          consider(el, "text");
        if (el.getAttribute("placeholder")) consider(el, "placeholder");
      }
    }
    return { items: out, skipped };
  }, scope);
  if (items.error) return { violations: [items.error], checked: 0, skipped: 0 };
  const violations = [];
  const dedupe = new Set();
  for (const item of items.items) {
    if (!item.fg) continue;
    // The page canvas behind everything is white in this app's default window.
    const result = textContrast({
      fg: item.fg,
      layers: item.layers,
      base: { r: 255, g: 255, b: 255, a: 1 },
      opacity: item.opacity,
      fontSize: item.fontSize,
      fontWeight: item.fontWeight,
    });
    if (result.pass) continue;
    if (allow.some((a) => a.match.test(item.description))) continue;
    const line = `${item.kind} contrast ${result.ratio.toFixed(2)} < ${result.required}: ${item.description} (${hex(result.ink)} on ${hex(result.bg)}, ${item.fontSize}px/${item.fontWeight})`;
    if (!dedupe.has(line)) {
      dedupe.add(line);
      violations.push(line);
    }
  }
  return {
    violations,
    checked: items.items.length,
    skipped: items.skipped.length,
  };
}

/**
 * WCAG 1.4.11 for text fields: the field boundary (border, else its own fill
 * against the surrounding fill) must be >= 3:1 against the surroundings.
 */
export async function auditFieldBoundaries(
  page,
  scope = "body",
  { allow = [] } = {},
) {
  await prepare(page);
  const items = await page.evaluate((scopeSelector) => {
    const g = globalThis;
    g.__a11ySettle();
    const root = g.document.querySelector(scopeSelector);
    if (!root) return { error: `scope ${scopeSelector} not found` };
    const out = [];
    for (const el of root.querySelectorAll(
      "input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select",
    )) {
      const s = g.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || s.visibility !== "visible")
        continue;
      if (el.closest("[aria-hidden='true'],[inert],[hidden],.xterm,:disabled"))
        continue;
      // The field itself, else a wrapper up to three levels up, may draw the edge.
      const chain = [];
      for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
        const ns = g.getComputedStyle(n);
        const border = ["Top", "Right", "Bottom", "Left"]
          .map((side) => ({
            width: Number.parseFloat(ns[`border${side}Width`]),
            style: ns[`border${side}Style`],
            color: g.__a11yNorm(ns[`border${side}Color`]),
          }))
          .find((b) => b.width > 0 && b.style !== "none");
        chain.push({
          border: border?.color ?? null,
          own: g.__a11yNorm(ns.backgroundColor),
          around: g.__a11yLayers(n.parentElement ?? n).layers,
        });
      }
      out.push({ description: g.__a11yDescribe(el), chain });
    }
    return { items: out };
  }, scope);
  if (items.error) return { violations: [items.error], checked: 0 };
  const base = { r: 255, g: 255, b: 255, a: 1 };
  const violations = [];
  for (const item of items.items) {
    let best = 0;
    let note = "";
    for (const level of item.chain) {
      const around = flatten(level.around, base);
      const edge = level.border ?? level.own;
      const ratio = edge?.a
        ? contrastRatio(compositeOver(edge, around), around)
        : 1;
      if (ratio > best) {
        best = ratio;
        note = `${level.border ? "border" : "fill"} ${hex(compositeOver(edge, around))} on ${hex(around)}`;
      }
    }
    if (best >= 3) continue;
    if (allow.some((a) => a.match.test(item.description))) continue;
    violations.push(
      `field boundary contrast ${best.toFixed(2)} < 3: ${item.description} (best edge: ${note || "none"})`,
    );
  }
  return { violations, checked: items.items.length };
}

const FOCUSABLE =
  "a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex='-1']),[role=tab],[role=menuitem],[role=option],[role=radio]";

/**
 * For each focusable control under `scope`: focus it with keyboard modality
 * (:focus-visible) and require a changed outline / ring box-shadow / border /
 * background whose colour is >= 3:1 against the surrounding background. The
 * control, its three nearest ancestors and its label may carry the indicator.
 */
export async function auditFocusIndicators(
  page,
  scope = "body",
  { allow = [] } = {},
) {
  await prepare(page);
  await page.evaluate(() => globalThis.document.activeElement?.blur());
  await page.keyboard.press("Tab"); // keyboard modality => :focus-visible
  await page.evaluate(() => globalThis.document.activeElement?.blur());
  const result = await page.evaluate(
    ({ scopeSelector, focusable }) => {
      const g = globalThis;
      g.__a11ySettle();
      const root = g.document.querySelector(scopeSelector);
      if (!root) return { error: `scope ${scopeSelector} not found` };
      const chain = (el) => {
        const nodes = [el];
        for (
          let n = el.parentElement;
          n && nodes.length < 4;
          n = n.parentElement
        )
          nodes.push(n);
        const label = el.closest("label");
        if (label && !nodes.includes(label)) nodes.push(label);
        return nodes;
      };
      const snap = (n) => {
        const s = g.getComputedStyle(n);
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: Number.parseFloat(s.outlineWidth),
          outline: g.__a11yNorm(s.outlineColor),
          boxShadow: s.boxShadow,
          borderWidth: Number.parseFloat(s.borderTopWidth) || 0,
          borderKey: [
            s.borderTopColor,
            s.borderRightColor,
            s.borderBottomColor,
            s.borderLeftColor,
          ].join("|"),
          border: g.__a11yNorm(s.borderTopColor),
          bg: g.__a11yNorm(s.backgroundColor),
          around: g.__a11yLayers(n.parentElement ?? n).layers,
          // ::before/::after fills (e.g. a focus bar drawn as a pseudo-element).
          pseudo: ["::before", "::after"].flatMap((pseudo) => {
            const ps = g.getComputedStyle(n, pseudo);
            const fill = g.__a11yNorm(ps.backgroundColor);
            return ps.content !== "none" && ps.content !== "normal" && fill?.a
              ? [{ fill, inside: g.__a11yLayers(n).layers }]
              : [];
          }),
        };
      };
      const out = [];
      for (const el of root.querySelectorAll(focusable)) {
        const rect = el.getBoundingClientRect();
        const s = g.getComputedStyle(el);
        if (s.visibility !== "visible" || s.display === "none") continue;
        // Visually-hidden inputs (custom radios/switches) have a ~0 box; their
        // wrapper (label) carries the indicator and is still a real stop.
        if (rect.width === 0 && rect.height === 0) continue;
        if (
          el.closest("[aria-hidden='true'],[inert],[hidden],.xterm,:disabled")
        )
          continue;
        if (
          el.matches("[tabindex]") &&
          el.tagName === "DIV" &&
          !el.getAttribute("role")
        )
          continue;
        const nodes = chain(el);
        const before = nodes.map(snap);
        el.focus({ focusVisible: true });
        g.__a11ySettle();
        if (g.document.activeElement !== el) continue;
        const after = nodes.map(snap);
        const focusVisible = el.matches(":focus-visible");
        el.blur();
        out.push({
          description: g.__a11yDescribe(el),
          focusVisible,
          before,
          after,
        });
      }
      return { items: out };
    },
    { scopeSelector: scope, focusable: FOCUSABLE },
  );
  if (result.error) return { violations: [result.error], checked: 0 };
  const shadowColors = [
    ...new Set(
      result.items.flatMap((item) =>
        item.after.flatMap((n) =>
          parseBoxShadow(n.boxShadow).map((x) => x.color),
        ),
      ),
    ),
  ].filter(Boolean);
  const normalized = await page.evaluate(
    (colors) => colors.map((c) => globalThis.__a11yNorm(c)),
    shadowColors,
  );
  const shadowRgba = new Map(shadowColors.map((c, i) => [c, normalized[i]]));
  const base = { r: 255, g: 255, b: 255, a: 1 };
  const violations = [];
  const dedupe = new Set();
  for (const item of result.items) {
    let best = 0;
    let kind = "none";
    for (let i = 0; i < item.after.length; i++) {
      const b = item.before[i];
      const a = item.after[i];
      const around = flatten(a.around, base);
      const over = (c) => contrastRatio(compositeOver(c, around), around);
      const candidates = [];
      if (
        a.outlineStyle !== "none" &&
        a.outlineWidth > 0 &&
        a.outline?.a > 0 &&
        (b.outlineStyle === "none" ||
          b.outlineWidth === 0 ||
          JSON.stringify(b.outline) !== JSON.stringify(a.outline))
      )
        candidates.push(["outline", over(a.outline)]);
      if (a.boxShadow !== b.boxShadow) {
        const prior = new Set(
          parseBoxShadow(b.boxShadow).map((x) => JSON.stringify(x)),
        );
        for (const sh of parseBoxShadow(a.boxShadow)) {
          const color = shadowRgba.get(sh.color);
          // A ring: crisp (no blur) and offset or spread; soft glows do not count.
          if (
            prior.has(JSON.stringify(sh)) ||
            !color?.a ||
            sh.blur !== 0 ||
            (sh.spread === 0 && sh.x === 0 && sh.y === 0)
          )
            continue;
          candidates.push(["box-shadow", over(color)]);
        }
      }
      if (a.borderKey !== b.borderKey && a.borderWidth > 0 && a.border?.a > 0)
        candidates.push(["border", over(a.border)]);
      for (const p of a.pseudo) {
        if (
          b.pseudo.some(
            (q) => JSON.stringify(q.fill) === JSON.stringify(p.fill),
          )
        )
          continue;
        const inside = flatten(p.inside, base);
        candidates.push([
          "pseudo-element",
          contrastRatio(compositeOver(p.fill, inside), inside),
        ]);
      }
      if (a.bg && b.bg)
        candidates.push([
          "background",
          contrastRatio(
            compositeOver(a.bg, around),
            compositeOver(b.bg, around),
          ),
        ]);
      for (const [k, r] of candidates)
        if (r > best) {
          best = r;
          kind = k;
        }
    }
    if (best >= 3) continue;
    if (allow.some((a) => a.match.test(item.description))) continue;
    const line = `focus indicator ${kind === "none" ? "missing" : `${kind} ${best.toFixed(2)} < 3`}: ${item.description}${item.focusVisible ? "" : " (not :focus-visible)"}`;
    if (!dedupe.has(line)) {
      dedupe.add(line);
      violations.push(line);
    }
  }
  return { violations, checked: result.items.length };
}

/**
 * Runs the contrast + focus audits on `scope` in both themes (emulated OS colour
 * scheme; the app follows it by default). visualAudit returns the violations;
 * field-boundary findings (WCAG 1.4.11) are advisory and collected for
 * takeFieldNotes(), because the borderless fill controls are an open design
 * decision (docs/engineering/backlog-status.md, F-18).
 */
export function createVisualAudit(page) {
  const fieldNotes = [];
  const audited = [];
  const eachTheme = async (fn) => {
    try {
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForFunction(
          (s) => globalThis.document.documentElement.dataset.theme === s,
          scheme,
        );
        await fn(scheme);
      }
    } finally {
      await page.emulateMedia({ colorScheme: null });
    }
  };
  const visualAudit = async (surface, scope) => {
    const found = [];
    let checked = 0;
    await eachTheme(async (scheme) => {
      for (const audit of [auditContrast, auditFocusIndicators]) {
        const r = await audit(page, scope);
        checked += r.checked;
        found.push(...r.violations.map((v) => `[${scheme}] ${v}`));
      }
      const fields = await auditFieldBoundaries(page, scope);
      fieldNotes.push(
        ...fields.violations.map((v) => `(${surface}) [${scheme}] ${v}`),
      );
    });
    if (checked === 0) found.push(`nothing was audited on ${surface}`);
    audited.push(`${surface}=${checked}`);
    return found.map((v) => `(${surface}) ${v}`);
  };
  const takeFieldNotes = () => {
    const notes = [...new Set(fieldNotes.splice(0))];
    const stats = `audited (text+focus checks, 2 themes): ${audited.splice(0).join(", ")}`;
    return notes.length
      ? `${stats}; advisory, ${notes.length} field boundary note(s): ${notes.join("; ")}`
      : stats;
  };
  return { eachTheme, visualAudit, takeFieldNotes };
}
