import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("a part's success state returns to sizing when its document edit is undone", async ({ page }, info) => {
  await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true });
  await page.goto(`${info.project.use.baseURL}?mcp=1`);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden" });
  await page.click("#ai-status");
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#ai-template-message")).toContainText("Preview ready", { timeout: 90_000 });
  await expect(page.locator("#ai-template-preview canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).not.toHaveClass(/ai-template-primary/);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  const bounds = await page.locator("#ai-template-preview").evaluate(root => {
    const content = root.querySelector(".ai-preview-content").getBoundingClientRect(), footer = root.querySelector(".ai-preview-footer").getBoundingClientRect();
    return { contentBottom: content.bottom, footerTop: footer.top, footerBottom: footer.bottom, viewportBottom: innerHeight, controlsBottom: Math.max(...[...root.querySelectorAll(".ai-preview-viewer button")].map(button => button.getBoundingClientRect().bottom)), dimensionsBottom: root.querySelector("dl").getBoundingClientRect().bottom };
  });
  expect(bounds.contentBottom).toBeLessThanOrEqual(bounds.footerTop);
  expect(bounds.footerBottom).toBeLessThanOrEqual(bounds.viewportBottom);
  expect(bounds.controlsBottom).toBeLessThanOrEqual(bounds.contentBottom);
  expect(bounds.dimensionsBottom).toBeLessThanOrEqual(bounds.contentBottom);
  await page.screenshot({ path: "exports/ai-panel/native-preview.png" });
  await page.getByRole("button", { name: "Add to document", exact: true }).click();
  await expect(page.locator(".ai-template-success")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue in editor", exact: true })).toHaveClass(/ai-template-primary/);
  await page.screenshot({ path: "exports/ai-panel/success.png" });
  await page.getByRole("button", { name: "Continue in editor", exact: true }).click();
  await expect(page.locator("#ai-setup-panel")).toBeHidden();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
  await page.click("#btn-undo");
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  await page.click("#ai-status");
  await expect(page.locator(".ai-template-success")).toBeHidden();
  await expect(page.locator(".ai-single-part .ai-dimension-guide")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveClass(/ai-template-primary/);
});
