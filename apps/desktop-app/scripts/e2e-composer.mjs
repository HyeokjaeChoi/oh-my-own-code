// Composer controls live in native popovers anchored to footer chips
// (첨부 및 추가 "+", 에이전트, 모델, 추론 강도, 권한 모드) and to the run strip
// (대기열). Open one before touching its fields.
import { expect } from "@playwright/test";

export const COMPOSER_POPOVERS = {
  attach: "첨부 및 추가",
  agent: "에이전트 모드:",
  model: "모델:",
  effort: "추론 강도:",
  permission: "권한 모드:",
};

// The queue trigger lives in the run strip (visible only while running or
// with a queue), and its name overlaps the "대기열에 추가" button.
const inboxTrigger = (page) => page.locator("[data-context-inbox-trigger]");

/**
 * Opens (if closed) the popover behind the named trigger and returns its panel.
 * Auto popovers can be closed by a remount or another popover, so the
 * click-if-closed + visible check is retried until it holds.
 */
export async function openComposerPopover(page, kind) {
  // The agent indicator exists only for a non-default requested agent; the
  // default mode is reached through the `/` menu entry.
  if (
    kind === "agent" &&
    !(await page.getByRole("button", { name: COMPOSER_POPOVERS.agent }).count())
  ) {
    await closeComposerPopovers(page);
    await openCommandMenuShortcut(page);
    await page.getByRole("button", { name: "에이전트 모드 바꾸기" }).click();
    const panel = page.getByRole("group", { name: "에이전트", exact: true });
    await expect(panel).toBeVisible();
    return panel;
  }
  const trigger =
    kind === "inbox"
      ? inboxTrigger(page)
      : page.getByRole("button", { name: COMPOSER_POPOVERS[kind] }).first();
  const id = await trigger.getAttribute("popovertarget");
  const panel = page.locator(`[id="${id}"]`);
  await expect(async () => {
    if (!(await panel.evaluate((el) => el.matches(":popover-open"))))
      await trigger.click();
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
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

/** Model rows by catalog id (the list is a listbox, not a native select). */
export const modelOption = (page, id) =>
  page.locator(`[role="option"][data-model-option="${id}"]`);

/** Picks a model by catalog id or visible name in the model popover. */
export async function pickModel(page, key) {
  const panel = await openComposerPopover(page, "model");
  await expect(panel.getByRole("listbox", { name: "모델" })).toBeVisible();
  const byId = modelOption(page, key);
  const option = (await byId.count())
    ? byId
    : panel.getByRole("option", { name: key });
  await option.first().click();
  return panel;
}

/**
 * Picks a reasoning level ("" = 기본) in the effort popover. The effort chip
 * only exists while the model offers levels or one is requested.
 */
export async function pickVariant(page, value) {
  const chip = page.getByRole("button", { name: COMPOSER_POPOVERS.effort });
  // No chip: no reasoning levels listed, nothing to clear.
  if (!value && !(await chip.count())) return undefined;
  const panel = await openComposerPopover(page, "effort");
  await panel
    .getByRole("radio", {
      name: value || "기본 (모델 기본값)",
      exact: true,
    })
    .check();
  return panel;
}

/** Native popovers must sit above the composer card, never over the input. */
export async function expectAboveComposer(page, panel) {
  const gap = await panel.evaluate((el) => {
    const card = el.ownerDocument.querySelector("[class*=composerCard]");
    return card.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(-0.5);
}

/** Opens the command menu the way a user does: "/" in an empty composer. */
export async function openCommandMenu(page) {
  const input = page.getByRole("textbox", { name: "메시지 작성", exact: true });
  await input.fill("");
  await input.focus();
  await page.keyboard.press("/");
  const menu = page.getByRole("region", { name: "앱 동작 및 런타임 명령" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the command menu with ⌘/ (Ctrl+/), leaving any draft untouched. */
export async function openCommandMenuShortcut(page) {
  const input = page.getByRole("textbox", { name: "메시지 작성", exact: true });
  await input.focus();
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+/`,
  );
  const menu = page.getByRole("region", { name: "앱 동작 및 런타임 명령" });
  await expect(menu).toBeVisible();
  return menu;
}
