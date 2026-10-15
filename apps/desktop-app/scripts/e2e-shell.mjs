// Header utilities (알림·자동화·데이터·설정) live in the "더 보기" menu; the
// sidebar footer has a separate "설정" button. Open them through the menu.
import { expect } from "@playwright/test";

/** Opens the header "더 보기" menu and activates the labeled item. */
export async function openMoreMenuItem(page, name) {
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Settings live in the sidebar footer; open the nav first when it is collapsed. */
export async function openSettings(page) {
  const button = page.getByRole("button", { name: "설정", exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "작업 공간 탐색 열기", exact: true })
      .click();
  await button.click();
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
