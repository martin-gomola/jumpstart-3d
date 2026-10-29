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
