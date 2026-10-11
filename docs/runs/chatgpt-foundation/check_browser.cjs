const { chromium } = require('/Users/hyukjaechoi/.nvm/versions/node/v24.14.1/lib/node_modules/designlang/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve('.');
const captures = path.resolve('docs/runs/chatgpt-foundation/captures');
fs.mkdirSync(captures, { recursive: true });
const manifest = JSON.parse(fs.readFileSync('docs/design/tokens/manifest.json', 'utf8'));
const tokens = new Map(manifest.tokens.map(token => [token.path, token]));

function resolve(pathName, mode) {
  const token = tokens.get(pathName);
  assert(token, `Missing token ${pathName}`);
  const value = token.layer === 'primitive' ? token.value : token.value[mode];
  return typeof value === 'string' && /^\{[^{}]+\}$/.test(value)
    ? resolve(value.slice(1, -1), mode)
    : value;
}

function rgb(hex) {
  return `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
}

(async () => {
  const base = pathToFileURL(path.join(root, 'docs/design/explorations/foundation-options/index.html')).href;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const result = { viewports: [], modes: [], interactions: [], errors, limits: 'Static synthetic preview; no product backend, actual permission, vendor parity, or screen-reader claim.' };

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.title(), '검색 근거 검토 · oh-my-own-code 미리보기');
    assert.equal(await page.locator('link[href="../../tokens/tokens.css"]').count(), 1, 'canonical CSS is linked');
    assert.equal(await page.locator('.message').count(), 2);
    assert.match(await page.locator('.permission').innerText(), /결정 전달됨/);
    assert.match(await page.locator('.execution-status').innerText(), /결과 알 수 없음|확인 대기/);
    assert.match(await page.locator('#composer-note').innerText(), /전송되지 않/);
    const measures = await page.evaluate(() => ({ sidebar: document.querySelector('.sidebar').getBoundingClientRect().width, reading: document.querySelector('.conversation-inner').getBoundingClientRect().width }));
    assert(Math.abs(measures.sidebar - 260) <= 16, `sidebar ${measures.sidebar}px is not close to observed 260px`);
    assert(measures.reading <= 820 && measures.reading >= 650, `reading width ${measures.reading}px`);

    for (const mode of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== mode) await page.locator('#theme-toggle').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), mode);
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          tokenCanvas: root.getPropertyValue('--omoc-semantic-color-canvas').trim(),
          canvas: getComputedStyle(document.querySelector('.workspace')).backgroundColor,
          composer: getComputedStyle(document.querySelector('.composer')).backgroundColor,
          composerBorder: getComputedStyle(document.querySelector('.composer')).borderTopColor,
          composerRadius: getComputedStyle(document.querySelector('.composer')).borderTopLeftRadius,
          composerWidth: document.querySelector('.composer').getBoundingClientRect().width,
          readingWidth: document.querySelector('.conversation-inner').getBoundingClientRect().width,
          family: getComputedStyle(document.querySelector('.conversation-inner')).fontFamily,
          fontSize: getComputedStyle(document.querySelector('.conversation-inner')).fontSize,
          lineHeight: getComputedStyle(document.querySelector('.conversation-inner')).lineHeight,
        };
      });
      const expected = rgb(resolve('semantic.color.canvas', mode));
      assert.equal(colors.tokenCanvas, resolve('semantic.color.canvas', mode));
      assert.equal(colors.canvas, expected, `${mode} canvas must consume canonical token`);
      assert.equal(colors.composer, rgb(resolve('component.color.input.background', mode)), `${mode} composer surface`);
      assert.equal(colors.composerBorder, rgb(resolve('component.color.input.border', mode)), `${mode} composer border`);
      assert.equal(colors.fontSize, resolve('semantic.type.size.body', mode), `${mode} body size`);
      assert.equal(colors.lineHeight, resolve('semantic.type.line.body', mode), `${mode} body line height`);
      assert.equal(colors.composerRadius, '24px', 'composer radius follows the reviewed geometry');
      assert(Math.abs(colors.composerWidth - colors.readingWidth) <= 1, 'composer aligns with reading width');
      assert(colors.family.includes('system') || colors.family.includes('Noto Sans KR'), 'web font must follow the system-sans mapping');
      await page.screenshot({ path: path.join(captures, `desktop-${mode}.png`), fullPage: true });
      result.modes.push({ mode, canvas: colors.canvas, sidebar: measures.sidebar, reading: measures.reading });
    }

    await page.locator('#panel-toggle').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#evidence-panel').isVisible());
    assert.equal(await page.locator('#panel-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#close-panel').click();
    assert(await page.locator('#evidence-panel').isHidden());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'panel-toggle');
    result.interactions.push('panel open/close and focus return');
    await page.locator('#theme-toggle').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'panel-toggle', 'toolbar keyboard order');
    await page.locator('.nav-item.selected').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const selectedFocus = await page.locator('.nav-item.selected').evaluate(element => ({
      current: element.getAttribute('aria-current'),
      outline: getComputedStyle(element).outlineStyle,
      background: getComputedStyle(element).backgroundColor,
      height: element.getBoundingClientRect().height,
    }));
    assert.equal(selectedFocus.current, 'page');
    assert.equal(selectedFocus.outline, 'solid', 'selected nav retains a visible keyboard focus ring');
    assert.equal(selectedFocus.background, rgb(resolve('component.color.navigation.selected-background', 'dark')));
    assert(selectedFocus.height >= 44, 'navigation touch target must be 44px');
    result.interactions.push('toolbar order and selected+focused navigation composition');

    await page.locator('#prompt').evaluate(element => element.setAttribute('aria-invalid', 'true'));
    await page.locator('#prompt').focus();
    const errorFocus = await page.locator('.composer').evaluate(element => ({
      border: getComputedStyle(element).borderTopColor,
      outline: getComputedStyle(element).outlineStyle,
    }));
    assert.equal(errorFocus.border, rgb(resolve('component.color.input.error-border', 'dark')));
    assert.equal(errorFocus.outline, 'solid', 'focused invalid input retains an outer focus ring');
    await page.locator('#prompt').evaluate(element => element.removeAttribute('aria-invalid'));
    result.interactions.push('focused+error input composition');

    const before = await page.locator('.message').count();
    await page.locator('#prompt').fill('가상 메시지');
    await page.locator('#demo-form button[type="submit"]').click();
    assert.equal(await page.locator('.message').count(), before, 'demo submit must not append a fake message');
    assert.match(await page.locator('#toast').innerText(), /전송되지 않|미리보기/);
    result.interactions.push('demo send does not execute');
    await page.evaluate(() => document.activeElement?.blur());

    for (const [width, height, label] of [[390, 844, 'mobile'], [720, 900, 'narrow']]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.locator('#sidebar').getAttribute('class'), 'sidebar', `${label} drawer must start closed`);
      assert(await page.locator('#evidence-panel').isHidden(), `${label} preview panel must remain closed`);
      assert(await page.locator('#scrim').isHidden(), `${label} scrim must remain hidden`);
      await page.locator('#toast').waitFor({ state: 'hidden', timeout: 6000 });
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, `${label} horizontal overflow ${overflow}px`);
      await page.screenshot({ path: path.join(captures, `${label}-dark.png`), fullPage: true });
      result.viewports.push({ width, height, label, overflow });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await page.locator('.conversation-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(captures, 'mobile-permission-dark.png'), fullPage: true });
    const permissionVisible = await page.evaluate(() => {
      const permission = document.querySelector('.permission').getBoundingClientRect();
      const scroll = document.querySelector('.conversation-scroll').getBoundingClientRect();
      return permission.bottom <= scroll.bottom + 1;
    });
    assert(permissionVisible, 'permission card must remain reachable above the composer when scrolled');
    const sendSize = await page.locator('.send-button').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    assert(sendSize.width >= 44 && sendSize.height >= 44, 'send touch target must be 44px');
    const longPath = '/Users/example/Documents/로컬-문서-앱/내보내기/검색-근거-검토-초안-아주-긴-파일-이름-반복-반복-반복-반복.md';
    await page.locator('.permission-scope code').evaluate((element, value) => { element.textContent = value; }, longPath);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), 'long Korean path must not overflow');
    await page.locator('#open-sidebar').click();
    await page.locator('#sidebar').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#open-sidebar').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#sidebar').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
    assert(await page.locator('.workspace').evaluate(element => element.inert), 'background is inert while drawer is modal');
    await page.locator('#close-sidebar').focus();
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('#sidebar').contains(document.activeElement)), 'Tab stays inside drawer');
    await page.locator('#close-sidebar').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'open-sidebar');
    assert(!(await page.locator('.workspace').evaluate(element => element.inert)), 'background inert is restored');
    result.interactions.push('mobile drawer open/close and focus return');

    await page.locator('#panel-toggle').click();
    assert.equal(await page.locator('#evidence-panel').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#evidence-panel').getAttribute('aria-modal'), 'true');
    assert(await page.locator('.workspace').evaluate(element => element.inert), 'background is inert while preview is modal');
    await page.locator('#close-panel').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'panel-toggle');
    assert(!(await page.locator('.workspace').evaluate(element => element.inert)));
    result.interactions.push('mobile preview modal semantics and inert recovery');

    // At 200% browser zoom, a physical 720×900 viewport exposes about 360×450 CSS pixels.
    await page.setViewportSize({ width: 360, height: 450 });
    const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(zoomOverflow <= 1, `200% zoom horizontal overflow ${zoomOverflow}px`);
    const zoomRects = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const composer = box('.composer');
      const send = box('.send-button');
      const scroll = box('.conversation-scroll');
      return { composer: { left: composer.left, right: composer.right, bottom: composer.bottom }, send: { left: send.left, right: send.right, top: send.top, bottom: send.bottom }, scroll: { height: scroll.height }, viewport: { width: innerWidth, height: innerHeight } };
    });
    assert(zoomRects.composer.left >= 0 && zoomRects.composer.right <= zoomRects.viewport.width + 1, 'zoomed composer must fit viewport');
    assert(zoomRects.send.left >= 0 && zoomRects.send.right <= zoomRects.viewport.width + 1 && zoomRects.send.bottom <= zoomRects.viewport.height + 1, 'zoomed send control must be reachable');
    assert(zoomRects.scroll.height > 0, 'zoomed conversation must remain scrollable');
    result.viewports.push({ width: 360, height: 450, label: '200% effective viewport from 720×900', overflow: zoomOverflow });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(captures, 'browser-results.json'), JSON.stringify(result, null, 2));
    console.log('PASS: canonical styles, light/dark, desktop/mobile/narrow, panel, drawer, focus, demo states, zoom, console.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
