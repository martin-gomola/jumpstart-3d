import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, watchErrors } from "../../test/helpers.mjs";

const TRAPPED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40mm" height="20mm" viewBox="0 0 40 20" onload="window.__svgRan = 'onload'">
  <script>window.__svgRan = "script"</script>
  <image href="missing.png" width="1" height="1" onerror="window.__svgRan = 'onerror'"/>
  <a xlink:href="javascript:window.__svgRan='href'"><rect x="0" y="0" width="40" height="20" onmouseover="window.__svgRan = 'hover'"/></a>
</svg>`;

test("an imported SVG keeps its geometry but none of its scripts or handlers run", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("SVG import", "advanced"));
  const chooser = page.waitForEvent("filechooser");
  await page.evaluate(() => { window.__app.insertFile("svg"); });
  await (await chooser).setFiles({ name: "trapped.svg", mimeType: "image/svg+xml", buffer: Buffer.from(TRAPPED_SVG) });
  await expect(page.locator("#cmd")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__svgRan ?? null)).toBeNull();
  expect(errors.filter(e => !/missing\.png/.test(e))).toEqual([]);
});
