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
    ['desktop', 1920, 1000, 'light', false], ['short', 1280, 600, 'light', false],
    ['tablet', 768, 900, 'light', false], ['phone', 390, 844, 'light', false],
    ['small', 320, 700, 'light', false], ['dark', 1400, 880, 'dark', false],
    ['contrast', 1400, 880, 'contrast', false], ['large', 1280, 900, 'light', true],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(({ theme, zoom }) => { document.documentElement.dataset.ui = theme; document.documentElement.style.fontSize = zoom ? '200%' : ''; }, { theme, zoom });
    expect(await workspace.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await drawer.evaluate(el => { el.scrollTop = 0; el.querySelector('.drawer-settings').scrollTop = 0; el.querySelector('.drawer-review').scrollTop = 0; });
    if (zoom) {
      const formBox = await drawer.locator('.ai-template-settings').boundingBox(), reviewBox = await page.locator('.drawer-review').boundingBox();
      expect(reviewBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
      for (const id of ['width', 'depth', 'height', 'name']) {
        await page.locator(`#drawer-${id}`).focus(); await expect(page.locator(`#drawer-${id}`)).toBeInViewport({ ratio: .99 });
      }
      await drawer.evaluate(el => { el.scrollTop = 0; });
    }
    if (name === 'short') {
      await expect(preview).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Try a 336 × 252 mm example' })).toBeInViewport({ ratio: 1 });
      await page.locator('#drawer-name').focus();
      const input = await page.locator('#drawer-name').boundingBox(), button = await preview.boundingBox();
      expect(input.y + input.height).toBeLessThanOrEqual(button.y);
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
  await page.screenshot({ path: '/tmp/jumpstart-drawer-workspace-arranged.png' });
  await page.getByRole('button', { name: 'New drawer', exact: true }).click();
  await expect(page.locator('.drawer-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo layout', exact: true })).toBeVisible();
  await expect(page.locator('#drawer-width')).toBeFocused();
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect(page.locator('#drawer-board')).toBeVisible();
  await page.locator('#ai-setup-close').click(); await expect(workspace).toBeHidden();
  expect(errors).toEqual([]);
});
