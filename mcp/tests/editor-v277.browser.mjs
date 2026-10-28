import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, watchErrors } from "../../test/helpers.mjs";

test("v2.7.7 Chip Carve opens from the ribbon with shared choices and closes cleanly", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("v277", "beginner", { bodies: [body("block", "Block", prim("box", { w: 20, d: 20, h: 12 }))] }));
  if (!(await page.locator(".bribbon #bb-chipcarve").isVisible())) await page.click('.bribbon [data-holds~="bb-chipcarve"]');
  await page.click("#bb-chipcarve");
  await expect.poll(() => page.evaluate(() => window.__app.carve.active)).toBe(true);
  await expect(page.locator("#carve select")).toHaveCount(0);
  const wood = page.locator("#carve-wood");
  await expect(wood).toHaveAttribute("role", "combobox");
  await wood.focus(); await page.keyboard.press("Enter");
  await expect(wood).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(wood).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.__app.carve.close());
  expect(await page.evaluate(() => window.__app.carve.active)).toBe(false);
  expect(errors).toEqual([]);
});
