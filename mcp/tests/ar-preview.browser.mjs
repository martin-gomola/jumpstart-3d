import { test, expect } from '@playwright/test';
import { boot, loadDoc, waitIdle, newDoc, body, prim } from '../../test/helpers.mjs';

test('AR dialog exports a model snapshot and presents its QR share link', async ({ page }, info) => {
  await boot(page, info);
  await loadDoc(page, newDoc('AR box', 'beginner', { bodies: [body('ar-box', 'Box', prim('box', { w: 80, d: 60, h: 10, r: 0, c: 0 }))] }));
  await waitIdle(page);
  let bytes;
  await page.route('**/__mcp/ar', async route => {
    bytes = route.request().postDataBuffer();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a'.repeat(48) }) });
  });
  await page.locator('#btn-export').click();
  await page.locator('[data-act="ar"]').click();
  const dialog = page.getByRole('dialog', { name: 'View in AR', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create QR code' }).click();
  await expect(dialog.getByRole('status')).toContainText('Invalid URL');
  await page.locator('#ar-origin').fill('https://cad.example.com');
  await dialog.getByRole('button', { name: 'Create QR code' }).click();
  await expect(dialog.getByRole('link', { name: 'Open AR share' })).toHaveAttribute('href', 'https://cad.example.com/ar/' + 'a'.repeat(48));
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  await expect(dialog.getByAltText('QR code for this AR model')).toBeVisible();
  await page.screenshot({ path: '/tmp/jumpstart-ar-panel.png' });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test('AR on an HTTPS server creates a QR for the current address without asking for a URL', async ({ page }, info) => {
  const origin = 'https://cad.example.com';
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(url.pathname + url.search, info.project.use.baseURL).href });
    await route.fulfill({ response });
  });
  let uploads = 0, releaseUpload;
  await page.route(`${origin}/__mcp/ar`, async route => {
    uploads++; await new Promise(resolve => { releaseUpload = resolve; });
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'b'.repeat(48) }) });
  });
  await boot(page, { project: { use: { baseURL: origin } } });
  await loadDoc(page, newDoc('Hosted AR box', 'beginner', { bodies: [body('ar-box', 'Box', prim('box', { w: 80, d: 60, h: 10, r: 0, c: 0 }))] }));
  await page.locator('#btn-export').click(); await page.locator('[data-act="ar"]').click();
  const dialog = page.getByRole('dialog', { name: 'View in AR', exact: true });
  await expect(dialog.locator('input')).toHaveCount(0);
  await expect(dialog).not.toContainText('forward /ar/');
  await dialog.getByRole('button', { name: 'Create QR code' }).click();
  await expect.poll(() => uploads).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Creating…', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('button', { name: 'Creating…', exact: true }).dispatchEvent('click');
  expect(uploads).toBe(1); releaseUpload();
  await expect(dialog.getByRole('link', { name: 'Open AR share' })).toHaveAttribute('href', origin + '/ar/' + 'b'.repeat(48));
  await expect(dialog.getByAltText('QR code for this AR model')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create QR code' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Open AR share' })).toBeFocused();
  await expect(dialog.locator('#ar-share-details')).toBeHidden();
  await dialog.getByRole('button', { name: 'Share details' }).click();
  await expect(dialog.locator('#ar-share-details')).toBeVisible();
  await expect(dialog.locator('#ar-share-details')).toContainText('Anyone with the link');
  await dialog.getByRole('button', { name: 'Share details' }).click();
  await page.evaluate(() => document.activeElement.blur());
  for (const [name, width, height, mode, large] of [
    ['desktop', 1400, 880, 'light', false], ['phone', 390, 844, 'light', false],
    ['small', 320, 568, 'light', false], ['landscape', 844, 390, 'light', false],
    ['dark', 390, 844, 'dark', false], ['large-text', 390, 844, 'light', true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(({ mode, large }) => { document.documentElement.dataset.ui = mode; document.documentElement.style.fontSize = large ? '200%' : ''; }, { mode, large });
    const bounds = await dialog.locator('.ar-panel').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('link', { name: 'Open AR share' })).toBeInViewport();
    expect(await dialog.locator('.ar-panel-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/jumpstart-qr-dialog-${name}.png` });
  }
  await dialog.getByRole('link', { name: 'Open AR share' }).focus();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.locator('#btn-export')).toBeFocused();
});
