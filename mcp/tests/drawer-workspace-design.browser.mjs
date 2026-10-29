import { test, expect } from '@playwright/test';
import { boot, loadDoc, newDoc, watchErrors } from '../../test/helpers.mjs';

test('drawer workspace guides measurements, keeps actions nearby and adapts through arrangement', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info); await loadDoc(page, newDoc('Drawer workspace', 'beginner'));
  await page.locator('#ai-status').click();
  const workspace = page.locator('#ai-setup-panel'), drawer = page.locator('.ai-drawer-mode');
  await expect(page.locator('.drawer-empty')).toBeVisible();
  await expect(page.locator('.drawer-review-toolbar')).toBeHidden();
  await expect(drawer.getByText('Drag to draw or move a bin.', { exact: false })).toBeHidden();
  const preview = drawer.getByRole('button', { name: 'Preview layout', exact: true });
  await expect(preview).toBeDisabled();
  const form = await page.locator('.drawer-measurements').boundingBox(), action = await preview.boundingBox();
  expect(action.y - form.y - form.height).toBeLessThan(100);
  const width = await page.locator('#drawer-width').boundingBox(), depth = await page.locator('#drawer-depth').boundingBox();
  expect(Math.abs(width.y - depth.y)).toBeLessThan(1);
  for (const id of ['height', 'name']) {
    const bounds = await page.locator(`#drawer-${id}`).boundingBox();
    expect(Math.abs(bounds.x - width.x)).toBeLessThan(1);
    expect(Math.abs(bounds.x + bounds.width - depth.x - depth.width)).toBeLessThan(1);
  }
  for (const [name, w, h, theme, zoom] of [
    ['reference', 1586, 992, 'light', false], ['desktop', 1920, 1000, 'light', false], ['short', 1280, 600, 'light', false],
    ['tablet', 768, 900, 'light', false], ['phone', 390, 844, 'light', false],
    ['small', 320, 700, 'light', false], ['dark', 1400, 880, 'dark', false],
    ['contrast', 1400, 880, 'contrast', false], ['large', 1280, 900, 'light', true],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(({ theme, zoom }) => { document.documentElement.dataset.ui = theme; document.documentElement.style.fontSize = zoom ? '200%' : ''; }, { theme, zoom });
    expect(await workspace.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await drawer.evaluate(el => { el.scrollTop = 0; el.querySelector('.drawer-settings').scrollTop = 0; el.querySelector('.drawer-review').scrollTop = 0; });
    await page.locator('#ai-templates-panel').evaluate(el => { el.scrollTop = 0; });
    if (w <= 640 || zoom) {
      const header = await page.locator('.ai-setup-header').boundingBox(), title = await page.locator('#ai-gridfinity-title').boundingBox();
      const appbar = await page.locator('.topbar').boundingBox();
      expect(Math.abs(header.y - appbar.y - appbar.height)).toBeLessThanOrEqual(1);
      const tabs = await page.locator('.ai-workspace-tabs').boundingBox();
      expect(tabs.y + tabs.height).toBeLessThanOrEqual(header.y + header.height + 1);
      expect(title.y).toBeGreaterThanOrEqual(header.y + header.height + 12);
      const lines = await page.locator('.ai-workspace-tabs .ai-control-label, .ai-setup-close .ai-control-label').evaluateAll(labels => labels.map(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; }));
      expect(lines.every(count => count === 1)).toBe(true);
    }
    if (name === 'dark') await expect(preview).toBeInViewport({ ratio: .99 });
    if (zoom) {
      const formBox = await drawer.locator('.ai-template-settings').boundingBox(), reviewBox = await page.locator('.drawer-review').boundingBox();
      expect(reviewBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
      for (const id of ['width', 'depth', 'height', 'name']) {
        await page.locator(`#drawer-${id}`).focus(); await expect(page.locator(`#drawer-${id}`)).toBeInViewport({ ratio: .99 });
      }
      await drawer.evaluate(el => { el.scrollTop = 0; });
      await page.locator('#ai-templates-panel').evaluate(el => { el.scrollTop = 0; });
    }
    await expect.poll(() => page.locator('.drawer-measure-art img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    if (name === 'short') {
      await preview.scrollIntoViewIfNeeded(); await expect(preview).toBeInViewport({ ratio: 1 });
      const example = page.getByRole('button', { name: 'Try a 336 × 252 mm example' });
      await example.scrollIntoViewIfNeeded(); await expect(example).toBeInViewport({ ratio: 1 });
      await page.locator('#drawer-name').focus();
      const input = await page.locator('#drawer-name').boundingBox(), button = await preview.boundingBox();
      expect(input.y + input.height).toBeLessThanOrEqual(button.y + 1);
    }
    if (name === 'reference') {
      const left = await drawer.locator('.ai-template-settings').boundingBox(), right = await page.locator('.drawer-review').boundingBox();
      expect(left.width).toBe(512); expect(Math.abs(left.y - right.y)).toBeLessThan(1);
      expect(Math.abs(left.y + left.height - right.y - right.height)).toBeLessThan(1);
      const art = await page.locator('.drawer-measure-art').boundingBox();
      expect(art.width).toBe(508); expect(art.y - right.y).toBeLessThan(160);
      expect(await page.locator('#ai-gridfinity-title').evaluate(el => getComputedStyle(el).fontSize)).toBe('48px');
      expect(await page.locator('.ai-flow li').first().evaluate(el => getComputedStyle(el).flexDirection)).toBe('column');
      await expect(drawer.locator('.drawer-measure-card').getByRole('button', { name: 'Preview layout', exact: true })).toBeVisible();
      expect(await page.locator('.ai-workspace-tabs button[aria-selected="true"]').evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('0px');
    }
    await page.screenshot({ path: `/tmp/jumpstart-drawer-workspace-${name}.png` });
  }
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.evaluate(() => { document.documentElement.dataset.ui = 'light'; document.documentElement.style.fontSize = ''; });
  await page.getByRole('button', { name: 'Try a 336 × 252 mm example' }).click();
  await expect(page.locator('.drawer-empty')).toBeHidden(); await expect(page.locator('#drawer-board')).toBeVisible();
  await expect(page.locator('.drawer-review-toolbar')).toBeVisible(); await expect(preview).toBeEnabled();
  await page.getByRole('button', { name: 'Add bin', exact: true }).click();
  await expect(page.locator('.drawer-bin')).toHaveCount(1);
  await page.locator('.drawer-bin').focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await page.locator('.drawer-layout-view').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.ai-flow li').first()).toBeInViewport({ ratio: .99 });
  const stepBox = await page.locator('.ai-flow li').first().boundingBox(), reviewBox = await page.locator('.drawer-review').boundingBox();
  expect(stepBox.y).toBeGreaterThanOrEqual(reviewBox.y);
  const flowBox = await page.locator('.ai-flow').boundingBox(), toolbarBox = await page.locator('.drawer-review-toolbar').boundingBox();
  expect(toolbarBox.y).toBeGreaterThanOrEqual(flowBox.y + flowBox.height);
  const layoutBox = await page.locator('.drawer-layout-view').boundingBox();
  expect(layoutBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
  await page.screenshot({ path: '/tmp/jumpstart-drawer-workspace-arranged.png' });
  if (!(await page.locator('.drawer-measurements').evaluate(el => el.open))) await page.locator('.drawer-measurements summary').click();
  await page.locator('#drawer-height').fill('10'); await page.locator('#drawer-height').press('Tab');
  await expect(page.locator('#drawer-message')).toContainText('usable height');
  await page.locator('#drawer-message').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/jumpstart-drawer-workspace-error.png' });
  await page.locator('#drawer-height').fill('50'); await page.locator('#drawer-height').press('Tab');
  await page.getByRole('button', { name: 'New drawer', exact: true }).click();
  await expect(page.locator('.drawer-empty')).toBeVisible();
  expect(await page.locator('.drawer-layout-view').evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo layout', exact: true })).toBeVisible();
  await expect(page.locator('#drawer-width')).toBeFocused();
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(page.locator('#drawer-board')).toBeVisible();
  await page.locator('#ai-setup-close').click(); await expect(workspace).toBeHidden();
  expect(errors).toEqual([]);
});

test('reference workspace keeps a real 3D preview visible and cancel returns focus without applying', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info); await loadDoc(page, newDoc('Drawer preview layout', 'beginner'));
  await page.locator('#ai-status').click();
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc));
  for (const [id, value] of [['width', '140'], ['depth', '100'], ['height', '50']]) {
    await page.locator(`#drawer-${id}`).fill(value); await page.locator(`#drawer-${id}`).press('Tab');
  }
  await page.getByRole('button', { name: 'Add bin', exact: true }).click();
  await page.getByRole('button', { name: 'Fill gaps', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  await expect(page.locator('#drawer-message')).toContainText('Preview ready', { timeout: 90000 });
  await expect(page.locator('.drawer-3d')).toBeVisible();
  const canvas = await page.locator('.drawer-3d .ai-preview-canvas').boundingBox();
  expect(canvas.height).toBeGreaterThanOrEqual(100);
  await page.screenshot({ path: '/tmp/jumpstart-drawer-workspace-preview.png' });
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview layout', exact: true })).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
  expect(errors).toEqual([]);
});
