import { expect } from "@playwright/test";

// Dependency-free accessibility audit helpers for the e2e suites (no axe-core in
// the repo): a DOM pass for names/roles/landmarks plus Playwright focus checks.

/**
 * Audits the visible DOM under `scope` and returns violation strings.
 * Rules: interactive controls and images are named, no positive tabindex, no
 * duplicate ids, dialogs/radiogroups/landmarks are named and landmarks of one
 * role are distinguishable.
 */
export async function auditDom(page, scope = "body") {
  return page.evaluate((scopeSelector) => {
    const { document, getComputedStyle } = globalThis;
    const root = document.querySelector(scopeSelector);
    if (!root) return [`scope ${scopeSelector} not found`];
    const out = [];
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className
          ? `.${el.className.split(/\s+/)[0]}`
          : "";
      const role = el.getAttribute("role");
      return `${el.tagName.toLowerCase()}${id}${cls}${role ? `[role=${role}]` : ""}`;
    };
    const visible = (el) => {
      if (el.closest("[aria-hidden='true'],[inert],[hidden]")) return false;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none")
        return false;
      return el.getClientRects().length > 0;
    };
    // Text content without aria-hidden subtrees (decorative icons/glyphs).
    const text = (el) => {
      const copy = el.cloneNode(true);
      copy
        .querySelectorAll?.("[aria-hidden='true']")
        .forEach((n) => n.remove());
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    // Containers (dialog, radiogroup, landmarks...) are named only by an
    // explicit label, never by their content.
    const labelOf = (el) => {
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const joined = by
          .split(/\s+/)
          .map((id) => {
            const target = document.getElementById(id);
            return target ? text(target) : "";
          })
          .join(" ")
          .trim();
        if (joined) return joined;
      }
      const label = el.getAttribute("aria-label")?.trim();
      if (label) return label;
      if ("labels" in el && el.labels?.length)
        return [...el.labels].map(text).join(" ").trim();
      return "";
    };
    const nameOf = (el) => {
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const joined = by
          .split(/\s+/)
          .map((id) =>
            text(document.getElementById(id) ?? document.body.cloneNode()),
          )
          .join(" ")
          .trim();
        if (joined) return joined;
      }
      const label = el.getAttribute("aria-label")?.trim();
      if (label) return label;
      if ("labels" in el && el.labels?.length)
        return [...el.labels].map(text).join(" ").trim();
      if (el.tagName === "INPUT" && /^(button|submit|reset)$/.test(el.type))
        return el.value;
      if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
      const own = text(el);
      if (own) return own;
      const img = el.querySelector("img[alt]:not([alt=''])");
      if (img) return img.getAttribute("alt");
      const svgTitle = el.querySelector("svg title");
      if (svgTitle) return text(svgTitle);
      return el.getAttribute("title")?.trim() ?? "";
    };
    const nameRoles =
      "button,a[href],input:not([type=hidden]),select,textarea,summary," +
      "[role=button],[role=tab],[role=menuitem],[role=menuitemradio]," +
      "[role=menuitemcheckbox],[role=option],[role=switch],[role=checkbox]," +
      "[role=radio],[role=combobox],[role=textbox],[role=searchbox]," +
      "[role=slider],[role=separator][tabindex],[role=link]";
    for (const el of root.querySelectorAll(nameRoles))
      if (visible(el) && !nameOf(el))
        out.push(`unnamed interactive: ${describe(el)}`);
    for (const img of root.querySelectorAll("img"))
      if (visible(img) && !img.hasAttribute("alt"))
        out.push(`img without alt: ${describe(img)}`);
    for (const el of root.querySelectorAll("[tabindex]"))
      if (Number(el.getAttribute("tabindex")) > 0)
        out.push(`positive tabindex: ${describe(el)}`);
    const seen = new Set();
    for (const el of root.querySelectorAll("[id]")) {
      if (seen.has(el.id)) out.push(`duplicate id: ${el.id}`);
      seen.add(el.id);
    }
    for (const el of root.querySelectorAll("[role=dialog],[role=alertdialog]"))
      if (visible(el)) {
        if (!labelOf(el)) out.push(`unnamed dialog: ${describe(el)}`);
        if (el.getAttribute("aria-modal") !== "true")
          out.push(`dialog without aria-modal: ${describe(el)}`);
      }
    for (const el of root.querySelectorAll(
      "[role=radiogroup],[role=tablist],[role=menu],[role=listbox]",
    ))
      if (visible(el) && !labelOf(el))
        out.push(`unnamed ${el.getAttribute("role")}: ${describe(el)}`);
    const landmarkSelector =
      "header,footer,nav,main,aside,section[aria-label],section[aria-labelledby],form[aria-label],[role=banner],[role=navigation],[role=main],[role=complementary],[role=region],[role=search],[role=contentinfo]";
    const roleOf = (el) =>
      el.getAttribute("role") ??
      {
        HEADER: "banner",
        FOOTER: "contentinfo",
        NAV: "navigation",
        MAIN: "main",
        ASIDE: "complementary",
        SECTION: "region",
        FORM: "form",
      }[el.tagName];
    const byRole = new Map();
    for (const el of root.querySelectorAll(landmarkSelector)) {
      if (!visible(el)) continue;
      // header/footer inside sectioning content are not page landmarks.
      if (
        /^(HEADER|FOOTER)$/.test(el.tagName) &&
        el.parentElement?.closest("article,aside,main,nav,section")
      )
        continue;
      const role = roleOf(el);
      const list = byRole.get(role) ?? [];
      list.push({ el, label: labelOf(el) });
      byRole.set(role, list);
    }
    for (const [role, list] of byRole) {
      if (role === "region") {
        for (const { el, label } of list)
          if (!label) out.push(`unnamed region: ${describe(el)}`);
      }
      if (list.length > 1) {
        const labels = list.map((l) => l.label);
        if (labels.some((l) => !l))
          out.push(`multiple ${role} landmarks, some unlabeled`);
        else if (new Set(labels).size !== labels.length)
          out.push(`duplicate ${role} landmark names: ${labels.join(" | ")}`);
      }
    }
    return out;
  }, scope);
}

/** Tabs through the page: every stop must be a visible element; returns violations. */
export async function auditTabOrder(page, { scope = "body", stops = 40 } = {}) {
  const out = [];
  const seen = [];
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((scopeSelector) => {
      const { document, getComputedStyle } = globalThis;
      const el = document.activeElement;
      if (!el || el === document.body) return { body: true };
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        label:
          el.getAttribute("aria-label") ||
          (el.textContent ?? "").trim().slice(0, 30),
        visible:
          rect.width > 0 && rect.height > 0 && style.visibility !== "hidden",
        inScope: !!el.closest(scopeSelector),
        key: `${el.tagName}|${el.getAttribute("aria-label") ?? ""}|${(el.textContent ?? "").trim().slice(0, 30)}|${Math.round(rect.x)}|${Math.round(rect.y)}`,
      };
    }, scope);
    if (info.body) continue;
    if (!info.visible)
      out.push(`focus on invisible element: ${info.tag} ${info.label}`);
    if (!info.inScope)
      out.push(`focus escaped scope: ${info.tag} ${info.label}`);
    if (seen.includes(info.key)) break; // wrapped around
    seen.push(info.key);
  }
  if (seen.length < 3) out.push(`Tab reached only ${seen.length} stops`);
  return { violations: out, stops: seen.length };
}

/** Modal focus contract: focus moves in, Tab cycles inside, Escape restores the opener. */
export async function auditDialogFocus(
  page,
  { open, openerLocator, dialogLocator },
) {
  const out = [];
  await open();
  const dialog = dialogLocator;
  await dialog.waitFor({ state: "visible" });
  const inside = () =>
    dialog.evaluate((el) => el.contains(globalThis.document.activeElement));
  if (!(await inside())) out.push("focus did not move into the dialog");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (!(await inside())) {
      out.push(`focus escaped the dialog after ${i + 1} Tab presses`);
      break;
    }
  }
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Shift+Tab");
    if (!(await inside())) {
      out.push(`focus escaped the dialog on Shift+Tab (${i + 1})`);
      break;
    }
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (openerLocator) {
    // Focus is restored after the close transition.
    const restored = await expect(openerLocator)
      .toBeFocused({ timeout: 2000 })
      .then(
        () => true,
        () => false,
      );
    if (!restored) out.push("focus did not return to the opener");
  }
  return out;
}
