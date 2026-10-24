import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { boot } from "../../test/helpers.mjs";

const inputs = [
  ["offline", {}], ["checking", { checking: true }], ["waiting", { online: true }],
  ["connected", { online: true, connected: true }], ["recent", { online: true, recent: true }],
  ["reading", { action: "get_document" }], ["previewing", { action: "preview_model" }],
  ["editing", { action: "apply_model" }], ["saving", { action: "save_document" }],
  ["exporting", { action: "export_model" }], ["completed", { online: true, outcome: "apply_model" }],
  ["error", { online: true, error: "Geometry unavailable" }],
];

test("compact status fits all states and exposes keyboard descriptions", async ({ page }, info) => {
  // Route only the component fixture and its two source dependencies. This tests
  // the same production CSS and renderer without running a model operation.
  await page.route("http://status.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const allowed = ["/mcp/tests/fixtures/ai-status.html", "/mcp/browser/ai-status.js", "/mcp/tokens/ai-status.json"];
    if (!allowed.includes(path)) return route.abort();
    await route.fulfill({ body: await readFile(resolve(`.${path}`)), contentType: extname(path) === ".json" ? "application/json" : extname(path) === ".js" ? "text/javascript" : "text/html" });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__copiedSetup = value; } } });
  });
  await page.goto("http://status.test/mcp/tests/fixtures/ai-status.html");
  await page.waitForFunction(() => typeof window.setStatus === "function");
  const status = page.locator("#ai-status"), tooltip = page.locator("#ai-status-tooltip");
  const panel = page.locator("#ai-setup-panel");
  const labels = new Set();
  await expect(status.locator("svg")).toHaveCount(0);
  for (const width of [320, 768, 1400]) {
    await page.setViewportSize({ width, height: 500 });
    for (const [state, input] of inputs) {
      await page.evaluate((value) => window.setStatus(value), input);
      await expect(status).toHaveAttribute("data-state", state);
      const label = status.locator(".ai-status-short");
      await expect(label).toBeVisible();
      await expect(label).toContainText(/^AI /);
      await expect(status).toHaveAttribute("aria-label", /.+/);
      const box = await status.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(24); expect(box.width).toBeLessThanOrEqual(128);
      expect(box.height).toBeGreaterThanOrEqual(24);
      labels.add(await label.textContent());
      const ratios = await status.evaluate((element) => {
        const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const ratio = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
        const header = getComputedStyle(element.parentElement).backgroundColor;
        const tooltip = getComputedStyle(element.querySelector(".ai-status-tooltip"));
        return { text: ratio(getComputedStyle(element).color, header), light: ratio(getComputedStyle(element.querySelector(".ai-status-light")).backgroundColor, header), tooltip: ratio(tooltip.color, tooltip.backgroundColor) };
      });
      expect(ratios.text).toBeGreaterThanOrEqual(3); expect(ratios.light).toBeGreaterThanOrEqual(3); expect(ratios.tooltip).toBeGreaterThanOrEqual(4.5);
      await status.focus(); await expect(tooltip).toBeVisible();
      expect(await tooltip.innerText()).toBe(await status.getAttribute("data-detail"));
      const tip = await tooltip.boundingBox(); expect(tip.x).toBeGreaterThanOrEqual(0); expect(tip.x + tip.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape"); await expect(tooltip).toBeHidden();
      await status.evaluate((element) => element.blur());
    }
  }
  expect(labels.size).toBe(inputs.length);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.setStatus({ action: "apply_model" }));
  expect(await status.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.evaluate(() => window.setStatus({ online: true }));
  await expect(tooltip).toContainText("Follow the setup steps below");
  await status.hover(); await expect(tooltip).toBeVisible();
  await page.screenshot({ path: `exports/ai-status-${info.project.name}.png` });

  await page.setViewportSize({ width: 320, height: 500 });
  await status.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".ai-setup-note")).toContainText("No model API key is needed");
  await expect(panel.locator(".ai-setup-note")).toContainText("sign in to your AI client");
  const mobilePanel = await panel.boundingBox();
  expect(mobilePanel.x).toBeGreaterThanOrEqual(0);
  expect(mobilePanel.width).toBeLessThanOrEqual(320);
  await expect(tooltip).toBeHidden();
  await expect(panel).toContainText("Codex");
  await expect(panel).toContainText("Claude Code");
  await expect(panel).toContainText("Antigravity CLI");
  await page.evaluate(() => window.setStatus({ online: true, connected: true }));
  await expect(panel.locator("#ai-setup-state")).toHaveText("AI client connected");
  const contrast = await panel.evaluate((root) => {
    const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const effectiveBackground = (element) => {
      for (let current = element; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)") return value;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const contrastRatio = (element) => {
      const values = [luminance(getComputedStyle(element).color), luminance(effectiveBackground(element))].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    };
    return [root.querySelector("h2"), root.querySelector(".ai-setup-kicker"), root.querySelector(".ai-setup-current strong"), root.querySelector(".ai-setup-note"), root.querySelector(".ai-setup-client h3"), root.querySelector(".ai-setup-client p"), root.querySelector("pre code"), root.querySelector(".ai-setup-close")].map(contrastRatio);
  });
  expect(contrast.every((ratio) => ratio >= 4.5)).toBe(true);
  await page.setViewportSize({ width: 1400, height: 500 });
  await status.hover();
  for (const [target, expected] of [
    ["ai-setup-codex", "make codex-install"],
    ["ai-setup-claude", 'claude mcp add --scope user --transport stdio jumpstart -- node "$(pwd)/mcp/server/stdio-proxy.mjs"'],
    ["ai-setup-antigravity", '{\n  "mcpServers": {\n    "jumpstart": {\n      "command": "node",\n      "args": ["/absolute/path/to/jumpstart-3d/mcp/server/stdio-proxy.mjs"]\n    }\n  }\n}'],
  ]) {
    await panel.locator(`[data-copy-target="${target}"]`).click();
    await expect(panel.locator("#ai-setup-copy-status")).toHaveText("Setup copied.");
    expect(await page.evaluate(() => window.__copiedSetup)).toBe(expected);
  }
  await page.screenshot({ path: `exports/ai-setup-panel-open-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(status).toHaveAttribute("aria-expanded", "false");
  await expect(status).toBeFocused();
  await expect(tooltip).toBeHidden();
  await page.screenshot({ path: `exports/ai-setup-panel-${info.project.name}.png` });
});

test("editor retains compact status markup in both builds", async ({ page }, info) => {
  await boot(page, info);
  expect(await page.locator("#ai-status").evaluate((element) => element.tabIndex)).toBe(0);
  await expect(page.locator("#ai-status")).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.locator("#ai-setup-panel")).toBeHidden();
  expect(await page.locator("#ai-status .ai-status-light").count()).toBe(1);
  expect(await page.locator("#ai-status-tooltip").count()).toBe(1);
});

test("AI shares the mode switch and restores the CAD selection when closed", async ({ page }, info) => {
  await page.goto(`${info.project.use.baseURL}?mcp=1`);
  await page.waitForFunction(() => window.__app?.kernel?.ready);
  await page.waitForSelector("#loading", { state: "hidden" });
  const group = page.locator(".modeswitch"), ai = group.locator("#ai-status");
  await expect(group.locator("button")).toHaveCount(4);
  await expect(group.locator("button")).toHaveText(["Beginner", "Advanced", "Chisel", /AI/]);
  await expect(ai.locator(".ai-status-short")).toHaveText("AI");
  const originalMode = await page.evaluate(() => window.__app.mode);
  const mode = page.locator(`#mode-${originalMode}`);
  for (const theme of ["light", "dark", "contrast"]) {
    await page.evaluate(theme => document.documentElement.dataset.ui = theme, theme);
    await ai.focus();
    await page.keyboard.press("Enter");
    await expect(ai).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#ai-setup-panel")).toBeVisible();
    expect(await page.evaluate(() => window.__app.mode)).toBe(originalMode);
    const styles = await group.evaluate(element => {
      const ai = getComputedStyle(element.querySelector("#ai-status"));
      const mode = getComputedStyle(element.querySelector('[aria-pressed="true"]'));
      return { font: ai.fontFamily, modeFont: mode.fontFamily, weight: ai.fontWeight, modeWeight: mode.fontWeight, background: ai.backgroundColor, modeBackground: mode.backgroundColor };
    });
    expect(styles.font).toBe(styles.modeFont);
    expect(styles.weight).toBe(styles.modeWeight);
    expect(styles.background).not.toBe(styles.modeBackground);
    await page.screenshot({ path: info.outputPath(`ai-mode-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(ai).toBeFocused();
    await expect(ai).toHaveAttribute("aria-expanded", "false");
    await expect(mode).toHaveAttribute("aria-pressed", "true");
  }
  await ai.click();
  await page.locator("#mode-advanced").click();
  await expect(page.locator("#ai-setup-panel")).toBeHidden();
  await expect(page.locator("#mode-advanced")).toHaveAttribute("aria-pressed", "true");
  await expect(ai).toHaveAttribute("aria-expanded", "false");
});
