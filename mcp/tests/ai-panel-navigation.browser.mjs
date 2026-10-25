import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("wider controls and labeled pictograms remain aligned and operable across window sizes", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(`${info.project.use.baseURL}?mcp=1`);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden" });
  await page.click("#ai-status");
  const sidebar = page.locator(".ai-drawer-mode > .ai-template-settings");
  expect((await sidebar.boundingBox()).width).toBe(448);
  for (const [id, amount] of [["width", "695"], ["depth", "230"], ["height", "60"]]) {
    await page.fill(`#drawer-${id}`, amount); await page.locator(`#drawer-${id}`).press("Tab");
  }
  for (const [view, name] of [["drawer", "Drawer layout"], ["part", "Single part"], ["settings", "Printer & settings"]]) {
    const button = page.locator(`[data-workspace-view="${view}"]`);
    await expect(button).toHaveAccessibleName(name);
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(button.locator("svg")).toHaveAttribute("focusable", "false");
  }
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(1);
  const alignment = await page.locator(".drawer-inspector-header .ai-template-actions button").evaluateAll(buttons => buttons.map(button => {
    const icon = button.querySelector(".ai-pictogram").getBoundingClientRect(), label = button.querySelector(".ai-control-label").getBoundingClientRect();
    return Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2);
  }));
  expect(Math.max(...alignment)).toBeLessThanOrEqual(1);
  await page.locator(".drawer-inspector").getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo layout", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(1);
  await page.locator(".drawer-bin").click();
  for (const theme of ["light", "dark", "contrast"]) {
    await page.evaluate(theme => document.documentElement.dataset.ui = theme, theme);
    await page.screenshot({ path: `exports/ai-panel/pictograms-${theme}.png` });
  }
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await page.getByRole("button", { name: "Increase part width", exact: true }).click();
  await expect(page.locator("#ai-template-columns")).toHaveValue("3");
  for (const width of [1280, 768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator("#ai-setup-panel").evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 1280) {
      const sizes = await page.locator(".ai-single-part").evaluate(root => ({ controls: root.children[0].getBoundingClientRect().width, work: root.children[1].getBoundingClientRect().width }));
      expect(sizes.controls).toBe(448); expect(sizes.work).toBeGreaterThan(sizes.controls);
    }
    await page.screenshot({ path: `exports/ai-panel/pictograms-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.locator("#ai-setup-panel").evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
  const scaled = await page.locator(".ai-single-part").evaluate(root => {
    const controls = root.children[0].getBoundingClientRect(), work = root.children[1].getBoundingClientRect(), heading = root.querySelector(".ai-dimension-guide h3").getBoundingClientRect();
    return { controls: controls.width, work: work.width, headingTop: heading.top, workTop: work.top, sidebarBottom: controls.bottom, actionBottom: root.querySelector("button[type=submit]").getBoundingClientRect().bottom };
  });
  expect(scaled.controls).toBeLessThan(scaled.work);
  expect(scaled.headingTop).toBeGreaterThanOrEqual(scaled.workTop);
  expect(scaled.actionBottom).toBeLessThanOrEqual(scaled.sidebarBottom);
  await page.locator("#ai-template-columns").fill("2");
  await page.locator("#ai-template-columns").press("Tab");
  await expect(page.locator("#ai-template-columns")).toHaveValue("2");
  await page.screenshot({ path: "exports/ai-panel/pictograms-200-percent.png" });
  expect(errors).toEqual([]);
});
