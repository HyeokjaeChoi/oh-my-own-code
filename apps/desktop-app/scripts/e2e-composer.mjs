// Composer controls live in native popovers anchored to footer chips
// (파일 첨부 "+", Agent, 모델, 권한 모드). Open one before touching its fields.
import { expect } from "@playwright/test";

export const COMPOSER_POPOVERS = {
  attach: "파일 첨부와 미리보기",
  agent: "Agent:",
  model: "모델:",
  permission: "권한 모드:",
  run: "현재 실행 · 추가 지시와 대기열",
};

/** Opens (if closed) the popover behind the named trigger and returns its panel. */
export async function openComposerPopover(page, kind) {
  const trigger = page
    .getByRole("button", { name: COMPOSER_POPOVERS[kind] })
    .first();
  const id = await trigger.getAttribute("popovertarget");
  const panel = page.locator(`[id="${id}"]`);
  if (!(await panel.evaluate((el) => el.matches(":popover-open"))))
    await trigger.click();
  await expect(panel).toBeVisible();
  return panel;
}

export const closeComposerPopovers = (page) =>
  page.evaluate(() => {
    for (const el of globalThis.document.querySelectorAll(
      "[popover]:popover-open",
    ))
      el.hidePopover();
  });

/** Selects a permission mode radio by its visible label (e.g. "범위 내 편집 허용"). */
export async function setPermissionMode(page, label) {
  const panel = await openComposerPopover(page, "permission");
  const radio = panel.getByRole("radio", { name: new RegExp(`^${label}`) });
  // Controlled radio: it flips only after the mutation settles, so click + expect.
  await radio.click();
  await expect(radio).toBeChecked({ timeout: 15000 });
  return radio;
}
