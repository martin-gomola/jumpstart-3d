import { test, expect } from '@playwright/test';
import { boot, watchErrors } from '../../test/helpers.mjs';

test('Studio name and release stay distinct from editor core and match the built revision', async ({ page, request }, info) => {
  const errors = watchErrors(page);
  const response = await request.get(new URL('version.json', info.project.use.baseURL).href);
  expect(response.ok()).toBe(true); const product = await response.json();
  expect(product.name).toBe('JumpStart 3D Studio'); expect(product.version).toBe('0.1.0'); expect(product.editorVersion).toBe('2.7.7');
  expect(product.build).toMatch(/^([a-f0-9]{7,8}(-dirty)?|unversioned)$/);
  const label = `Studio ${product.version} · Editor ${product.editorVersion} · Build ${product.build}`;
  await page.setViewportSize({ width: 1920, height: 1000 });
  await boot(page, info);
  await expect(page).toHaveTitle(product.name);
  await expect(page.locator('.topbar .brand span')).toHaveText(product.name);
  await expect(page.locator('.topbar .brand span')).toBeVisible();
  expect(await page.locator('.topbar').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('#sp-ver')).toHaveText(label);
  await expect(page.locator('.topbar .brand')).toHaveAttribute('title', label);
  await page.locator('#btn-about').click();
  const about = page.getByRole('dialog', { name: 'About JumpStart 3D Studio', exact: true });
  await expect(about).toBeVisible(); await expect(about.locator('.ab-head')).toContainText('v0.1.0');
  await expect(about.locator('.ab-head')).toContainText('editor 2.7.7');
  await expect(about.getByRole('heading', { name: 'Studio additions' })).toBeVisible();
  await expect(about.getByRole('heading', { name: 'Editor core 2.7.7 changes', exact: true })).toBeVisible();
  await expect(about.locator('#ab-ver')).toHaveText(label);
  await expect(about.locator('#ab-ver')).toBeInViewport();
  await expect(about.locator('#ab-licenses')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/jumpstart-studio-about-desktop.png' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await about.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await about.locator('#ab-ver').scrollIntoViewIfNeeded(); await expect(about.locator('#ab-ver')).toBeInViewport();
    await page.screenshot({ path: `/tmp/jumpstart-studio-about-${width}.png` });
  }
  await page.keyboard.press('Escape'); await expect(about).toHaveCount(0);
  expect(errors).toEqual([]);
});
