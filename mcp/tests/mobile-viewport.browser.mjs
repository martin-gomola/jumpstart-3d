import { test, expect, devices } from '@playwright/test';
import { boot, loadDoc, newDoc } from '../../test/helpers.mjs';

test('iPhone profile uses device width and can measure and arrange a drawer', async ({ browser }, info) => {
  const { defaultBrowserType, ...iphone } = devices['iPhone 15 Pro'];
  const context = await browser.newContext(iphone);
  try {
    const page = await context.newPage(); await boot(page, info);
    expect(await page.evaluate(() => innerWidth)).toBe(iphone.viewport.width);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
    await loadDoc(page, newDoc('Mobile drawer', 'beginner')); await page.locator('#ai-status').tap();
    const header = await page.locator('.ai-setup-header').boundingBox(), tabs = await page.locator('.ai-workspace-tabs').boundingBox();
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(header.y + header.height + 1);
    for (const [id, value] of [['width','140'], ['depth','100'], ['height','50']]) {
      await page.locator(`#drawer-${id}`).fill(value); await page.locator(`#drawer-${id}`).press('Tab');
    }
    await expect(page.getByRole('button', { name: 'Preview layout', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add bin', exact: true }).tap();
    await expect(page.locator('.drawer-bin')).toHaveCount(1);
    expect(await page.locator('#ai-setup-panel').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `/tmp/jumpstart-iphone-profile-${info.project.name}.png` });
  } finally { await context.close(); }
});
