import {
  compositeOver,
  contrastRatio,
  flatten,
  formatRatio,
  parseBoxShadow,
  textContrast,
} from "./a11y-contrast.mjs";

// Dependency-free visual accessibility audits for the e2e suites: WCAG text and
// control-boundary contrast from computed styles, and keyboard focus indicators.
// Colours are normalised by the browser (canvas), so oklch()/color-mix() work.
// The maths lives in a11y-contrast.mjs; this file only reads the page.
// Limitation: backgrounds come from the DOM ancestor chain only. Positioned
// overlays, backdrop-filter, pseudo-element fills and z-index overlap behind a
// text element are not modelled (text over a gradient/url image fails instead).
// Every skipped category is returned in `skips` and printed in the check notes.

const NO_BASE = { r: 255, g: 255, b: 255, a: 1 }; // window canvas under html

// Allow-list entries are { match: RegExp on the element description, reason }.
function checkAllow(allow) {
  for (const a of allow)
    if (!(a.match instanceof RegExp) || !String(a.reason ?? "").trim())
      throw new Error("allow entries need { match: RegExp, reason: string }");
  return (description) => allow.some((a) => a.match.test(description));
}

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
  g.__a11ySettle = (nodes) => {
    const list = nodes ?? [...g.document.querySelectorAll("*")];
    for (let pass = 0; pass < 3; pass++) {
      // Reading style forces lazily-styled subtrees to start their pending
      // transitions so they can be finished too (nodes: only that chain).
      for (const el of list) g.getComputedStyle(el).backgroundColor;
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
// them to exist, then jump them to the end state (see __a11ySettle). 300ms is
// a few frames and more than twice the 120ms motion-fast token; the settle
// itself does not depend on it, it only lets the transitions be created.
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
 * Fails (not skips) on text over a background image/gradient and on colours the
 * browser cannot parse, unless an `allow` entry ({ match, reason }) covers it.
 * WCAG-exempt disabled text is skipped; every skip is counted in `skips`.
 * Returns { violations, checked, skips }.
 */
export async function auditContrast(page, scope = "body", { allow = [] } = {}) {
  const allowed = checkAllow(allow);
  await prepare(page);
  const items = await page.evaluate((scopeSelector) => {
    const g = globalThis;
    g.__a11ySettle();
    const root = g.document.querySelector(scopeSelector);
    if (!root) return { error: `scope ${scopeSelector} not found` };
    const out = [];
    const skips = {};
    const skip = (reason) => (skips[reason] = (skips[reason] ?? 0) + 1);
    const seen = new Map();
    const consider = (el, kind) => {
      if (seen.get(el)?.has(kind)) return;
      seen.set(el, (seen.get(el) ?? new Set()).add(kind));
      const s = g.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (s.visibility !== "visible" || s.display === "none") return;
      if (el.closest("[aria-hidden='true'],[inert],[hidden],.xterm")) return;
      if (el.closest(":disabled,[aria-disabled='true']"))
        return skip("disabled text (WCAG-exempt)");
      const color =
        kind === "placeholder"
          ? g.getComputedStyle(el, "::placeholder").color
          : s.color;
      const { layers, image } = g.__a11yLayers(el);
      const opacity = g.__a11yOpacity(el);
      if (opacity < 1 && layers.length) skip("opacity<1 (approximate)");
      out.push({
        kind,
        description: g.__a11yDescribe(el),
        fg: g.__a11yNorm(color),
        layers,
        image,
        opacity,
        fontSize: Number.parseFloat(s.fontSize),
        fontWeight: Number(s.fontWeight) || 400,
      });
    };
    for (const el of [root, ...root.querySelectorAll("*")]) {
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
        // The placeholder is only visible while the field is empty.
        if (el.getAttribute("placeholder") && !el.value)
          consider(el, "placeholder");
      }
    }
    return { items: out, skips };
  }, scope);
  if (items.error) return { violations: [items.error], checked: 0, skips: {} };
  const violations = [];
  const dedupe = new Set();
  const add = (line) => {
    if (!dedupe.has(line)) {
      dedupe.add(line);
      violations.push(line);
    }
  };
  for (const item of items.items) {
    if (allowed(item.description)) continue;
    if (!item.fg) {
      add(`${item.kind} colour not parsable: ${item.description}`);
      continue;
    }
    if (item.image) {
      add(
        `${item.kind} over a background image/gradient, contrast unverifiable: ${item.description}`,
      );
      continue;
    }
    const result = textContrast({
      fg: item.fg,
      layers: item.layers,
      base: NO_BASE,
      opacity: item.opacity,
      fontSize: item.fontSize,
      fontWeight: item.fontWeight,
    });
    if (result.pass) continue;
    add(
      `${item.kind} contrast ${formatRatio(result.ratio)} < ${result.required}: ${item.description} (${hex(result.ink)} on ${hex(result.bg)}, ${item.fontSize}px/${item.fontWeight})`,
    );
  }
  return { violations, checked: items.items.length, skips: items.skips };
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
  const allowed = checkAllow(allow);
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
      // The field itself, else its wrapper, may draw the edge (border or fill);
      // the wrapper's parent may only add a border (the composer card).
      const chain = [];
      for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
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
          own: i < 2 ? g.__a11yNorm(ns.backgroundColor) : null,
          around: g.__a11yLayers(n.parentElement ?? n).layers,
        });
      }
      out.push({ description: g.__a11yDescribe(el), chain });
    }
    return { items: out };
  }, scope);
  if (items.error) return { violations: [items.error], checked: 0 };
  const base = NO_BASE;
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
    if (allowed(item.description)) continue;
    violations.push(
      `field boundary contrast ${formatRatio(best)} < 3: ${item.description} (best edge: ${note || "none"})`,
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
 * control, its three nearest ancestors and its closest <label> (an ancestor of
 * the control, not matched by FOCUSABLE itself) may carry the indicator.
 * Unchecked categories are counted in `skips` (0x0 controls, role-less
 * div[tabindex], elements that do not take focus); disabled controls are not
 * focusable (WCAG-exempt) and are counted too.
 */
export async function auditFocusIndicators(
  page,
  scope = "body",
  { allow = [] } = {},
) {
  const allowed = checkAllow(allow);
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
      const skips = {};
      const skip = (reason) => (skips[reason] = (skips[reason] ?? 0) + 1);
      for (const el of root.querySelectorAll(focusable)) {
        const rect = el.getBoundingClientRect();
        const s = g.getComputedStyle(el);
        if (s.visibility !== "visible" || s.display === "none") continue;
        if (el.closest("[aria-hidden='true'],[inert],[hidden],.xterm"))
          continue;
        if (el.closest(":disabled")) {
          skip("disabled control (WCAG-exempt)");
          continue;
        }
        // Visually-hidden inputs (custom radios/switches) have a ~0 box and are
        // not exercised here; they are counted, not silently dropped.
        if (rect.width === 0 && rect.height === 0) {
          skip("0x0 focusable");
          continue;
        }
        if (
          el.matches("[tabindex]") &&
          el.tagName === "DIV" &&
          !el.getAttribute("role")
        ) {
          skip("role-less div[tabindex]");
          continue;
        }
        const nodes = chain(el);
        g.__a11ySettle(nodes);
        const before = nodes.map(snap);
        el.focus({ focusVisible: true });
        g.__a11ySettle(nodes);
        if (g.document.activeElement !== el) {
          skip("did not take focus");
          continue;
        }
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
      return { items: out, skips };
    },
    { scopeSelector: scope, focusable: FOCUSABLE },
  );
  if (result.error)
    return { violations: [result.error], checked: 0, skips: {} };
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
  const base = NO_BASE;
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
    if (allowed(item.description)) continue;
    const line = `focus indicator ${kind === "none" ? "missing" : `${kind} ${formatRatio(best)} < 3`}: ${item.description}${item.focusVisible ? "" : " (not :focus-visible)"}`;
    if (!dedupe.has(line)) {
      dedupe.add(line);
      violations.push(line);
    }
  }
  return { violations, checked: result.items.length, skips: result.skips };
}

/**
 * Runs the contrast + focus audits on `scope` in both themes (emulated OS colour
 * scheme; the app follows it by default). visualAudit returns the violations,
 * including text-field boundaries (WCAG 1.4.11, hard failures).
 * allow: { contrast, focus, field } lists of { match: RegExp, reason: string }.
 */
export function createVisualAudit(page, { allow = {} } = {}) {
  const audited = [];
  const skipped = {};
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
    const audits = [
      ["contrast", auditContrast],
      ["focus", auditFocusIndicators],
    ];
    await eachTheme(async (scheme) => {
      for (const [name, audit] of audits) {
        const r = await audit(page, scope, { allow: allow[name] ?? [] });
        checked += r.checked;
        found.push(...r.violations.map((v) => `[${scheme}] ${v}`));
        for (const [reason, n] of Object.entries(r.skips ?? {}))
          skipped[`${name}: ${reason}`] = Math.max(
            skipped[`${name}: ${reason}`] ?? 0,
            n,
          );
      }
      const fields = await auditFieldBoundaries(page, scope, {
        allow: allow.field ?? [],
      });
      checked += fields.checked;
      found.push(...fields.violations.map((v) => `[${scheme}] ${v}`));
    });
    if (checked === 0) found.push(`nothing was audited on ${surface}`);
    audited.push(`${surface}=${checked}`);
    return found.map((v) => `(${surface}) ${v}`);
  };
  const takeAuditNotes = () => {
    const skips = Object.entries(skipped)
      .map(([reason, n]) => `${reason} x${n}`)
      .join(", ");
    Object.keys(skipped).forEach((k) => delete skipped[k]);
    return `audited (text+focus+field checks, 2 themes): ${audited.splice(0).join(", ")}; unchecked (max per surface/theme): ${skips || "none"}`;
  };
  return { eachTheme, visualAudit, takeAuditNotes };
}
