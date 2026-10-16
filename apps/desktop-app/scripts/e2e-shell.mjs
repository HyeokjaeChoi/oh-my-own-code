// Header utilities (알림·자동화·데이터·설정) live in the "더 보기" menu; the
// sidebar footer has a separate "설정" button. Open them through the menu.
import { expect } from "@playwright/test";

/** Opens the header "더 보기" menu and activates the labeled item. */
export async function openMoreMenuItem(page, name) {
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Settings: the sidebar footer button, else the header "더 보기" menu entry. */
export async function openSettings(page) {
  const button = page.getByRole("button", { name: "설정", exact: true });
  if (await button.isVisible()) return button.click();
  // Below 1200px an open detail panel hides the sidebar (and its footer
  // button); the header menu then carries 설정.
  const item = page.getByRole("menuitem", { name: "설정", exact: true });
  try {
    await page
      .getByRole("button", { name: "더 보기", exact: true })
      .click({ timeout: 3000 });
    await item.click({ timeout: 3000 });
  } catch {
    // A modal sheet may already own the page: fire the same app event the
    // command palette uses.
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      globalThis.dispatchEvent(new globalThis.Event("omoc:open-settings")),
    );
  }
}

/** Opens the sidebar workspace switcher menu and returns the menu locator. */
export async function openWorkspaceMenu(page) {
  await page.getByRole("button", { name: /^작업 공간 전환:/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Shows the sidebar session search field (toggle) and returns it. */
export async function openSessionSearch(page) {
  const field = page.getByRole("searchbox", { name: "세션 검색" });
  if (!(await field.isVisible()))
    await page.getByRole("button", { name: "세션 검색", exact: true }).click();
  return field;
}

/** Switches workspace through the sidebar switcher (opens the nav if collapsed). */
export async function selectWorkspace(page, id) {
  const trigger = page.getByRole("button", { name: /^작업 공간 전환:/ });
  if (!(await trigger.isVisible()))
    await page
      .getByRole("button", { name: "작업 공간 탐색 열기", exact: true })
      .click();
  await trigger.click();
  await page.locator(`[role="menuitemradio"][data-value="${id}"]`).click();
}

const EXTENSION_ROWS = {
  mcp: /^MCP/,
  skills: /^스킬/,
  agents: /^에이전트/,
  instructions: /^지침/,
  commands: /^명령/,
  native: /^런타임 확장/,
};

/**
 * Opens Settings -> 확장 (back at the kind list), then drills into `sub`
 * ("mcp" | "skills" | "agents" | "instructions" | "commands" | "native").
 * Reuses an already open settings dialog. Narrow windows collapse the nav to a
 * select, so the page is picked through it there.
 */
export async function openExtensions(page, sub) {
  const dialog = page.getByRole("dialog", { name: "설정", exact: true });
  if (!(await dialog.isVisible())) await openSettings(page);
  await expect(dialog).toBeVisible();
  const tab = dialog.getByRole("tab", { name: "확장", exact: true });
  if (await tab.isVisible()) await tab.click();
  else
    await dialog
      .getByRole("combobox", { name: "설정 페이지", exact: true })
      .selectOption({ label: "확장" });
  const back = dialog.getByRole("button", { name: "확장", exact: true });
  if (await back.isVisible()) await back.click();
  if (sub)
    await dialog.getByRole("button", { name: EXTENSION_ROWS[sub] }).click();
  return dialog;
}

/**
 * Changes the window's selection while the (modal) settings dialog stays open
 * and its editor stays mounted. The renderer polls `notify.clicked` every 5s
 * and selects what a clicked OS notification carries; the test main answers
 * that poll once with the requested workspace/session.
 */
export async function selectWhileSettingsOpen(
  page,
  application,
  workspaceId,
  sessionId,
) {
  await application.evaluate(
    ({ ipcMain }, target) => {
      globalThis.__omocNotifyConsumed = false;
      ipcMain.removeHandler("desktop:v1:notify");
      ipcMain.handle("desktop:v1:notify", (_event, request) => {
        if (
          request?.type === "notify.clicked" &&
          !globalThis.__omocNotifyConsumed
        ) {
          globalThis.__omocNotifyConsumed = true;
          return { ok: true, value: target };
        }
        return { ok: true, value: null };
      });
    },
    { workspaceId, sessionId },
  );
  await expect
    .poll(() => application.evaluate(() => globalThis.__omocNotifyConsumed), {
      timeout: 20000,
    })
    .toBe(true);
  await expect(
    page.getByRole("dialog", { name: "설정", exact: true }),
  ).toBeVisible();
}

/** Closes Settings with its button (Escape would cancel an in-flight observation). */
export async function closeSettings(page) {
  const dialog = page.getByRole("dialog", { name: "설정", exact: true });
  await dialog.getByRole("button", { name: "설정 닫기", exact: true }).click();
  await expect(dialog).toBeHidden();
}
