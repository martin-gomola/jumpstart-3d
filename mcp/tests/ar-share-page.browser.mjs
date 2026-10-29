import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createArShares } from '../server/ar-shares.mjs';

let server, origin, clock = 0;
test.beforeAll(async () => {
  const handle = createArShares({ now: () => clock });
  server = createServer((req, res) => void handle(req, res, req.url, req.method === 'POST'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

async function share(request) {
  const response = await request.post(origin + '/__mcp/ar', { headers: { 'Content-Type': 'model/vnd.usdz+zip' }, data: Buffer.from([0x50, 0x4b, 3, 4]) });
  return origin + '/ar/' + (await response.json()).id;
}

test('iPhone share page has an obvious native AR link and adapts without JavaScript', async ({ browser, request }) => {
  const url = await share(request);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 760 } });
  const page = await context.newPage(); await page.goto(url);
  const primary = page.getByRole('link', { name: 'View in your room', exact: true });
  await expect(primary).toHaveAttribute('rel', 'ar'); await expect(primary).toHaveAttribute('href', /model\.usdz#allowsContentScaling=0$/);
  expect(await primary.evaluate(el => el.firstElementChild.tagName)).toBe('IMG');
  expect((await primary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(primary).toBeInViewport(); await expect(page.locator('script')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download 3D model' })).toHaveAttribute('href', /model\.usdz$/);
  await page.keyboard.press('Tab'); await expect(primary).toBeFocused();
  expect(await primary.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.screenshot({ path: '/tmp/jumpstart-ar-share-keyboard.png', fullPage: true });
  await primary.evaluate(el => el.blur());
  for (const [name, width, height, dark, large] of [
    ['iphone', 390, 760, false, false], ['small', 320, 568, false, false],
    ['landscape', 844, 390, false, false], ['desktop', 1000, 800, false, false],
    ['dark', 390, 760, true, false], ['large-text', 390, 760, false, true],
  ]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.evaluate(large => { document.documentElement.style.fontSize = large ? '200%' : ''; }, large);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(primary).toBeVisible();
    await page.screenshot({ path: `/tmp/jumpstart-ar-share-${name}.png`, fullPage: true });
  }
  await context.close();
});

test('expired shares give a readable recovery page with no dead AR action', async ({ page, request }) => {
  const url = await share(request); clock += 30 * 60 * 1000;
  const response = await page.goto(url); expect(response.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await expect(page.getByText('Create a new QR code in JumpStart, then scan it again.')).toBeVisible();
  await expect(page.locator('a[rel="ar"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.screenshot({ path: '/tmp/jumpstart-ar-share-expired.png', fullPage: true });
});
