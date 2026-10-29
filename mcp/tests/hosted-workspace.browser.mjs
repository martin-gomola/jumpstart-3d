import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle } from "../../test/helpers.mjs";

// A plain static build (the Render demo) has no MCP broker. The Create workspace
// still runs in the page; only the agent connection is unavailable.
test("without the MCP broker, the ribbon opens the drawer planner and adds a layout", async ({ page }, info) => {
  const errors = watchErrors(page), bridgeCalls = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/__mcp")) bridgeCalls.push(request.url()); });
  await boot(page, info);
  await loadDoc(page, newDoc("drawer", "beginner"));
  const ai = page.locator("#ai-status");
  await expect(ai).toBeVisible();
  await expect(ai).toHaveAttribute("data-state", "unavailable");

  const button = page.locator(".bribbon #bb-drawer");
  if (!(await button.isVisible())) await page.click('.bribbon [data-holds~="bb-drawer"]');
  await page.click("#bb-drawer");
  await expect(page.locator("#ai-setup-panel")).toBeVisible();
  await expect(page.locator("#ai-templates-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-gridfinity-title")).toHaveText("Organize your drawer");

  for (const [id, value] of [["width", 140], ["depth", 100], ["height", 50]]) {
    await page.fill(`#drawer-${id}`, String(value)); await page.locator(`#drawer-${id}`).press("Tab");
  }
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added", { timeout: 90_000 });
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(3);

  await page.click("#ai-connection-tab");
  await expect(page.locator("#ai-setup-state")).toHaveText("AI needs a local install");
  await expect(page.locator(".ai-setup-note a")).toHaveAttribute("href", /github\.com\/martin-gomola\/jumpstart-3d/);
  await page.click("#ai-setup-close");
  await expect(page.locator("#ai-setup-panel")).toBeHidden();

  await page.evaluate(() => window.__app.setMode("advanced", true));
  await page.click("#ad-features");
  await page.click("#ad-drawer");
  await expect(page.locator("#ai-setup-panel")).toBeVisible();
  await expect(page.locator("#ai-gridfinity-title")).toHaveText("Organize your drawer");

  expect(bridgeCalls).toEqual([]);
  expect(errors).toEqual([]);
});
