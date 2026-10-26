import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors, waitIdle } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0;

test.beforeAll(async () => {
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`MCP broker startup timed out: ${output}`)), 15_000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    broker.once("error", fail);
    broker.once("exit", (code) => fail(new Error(`MCP broker exited during startup (${code}): ${output}`)));
    broker.stderr.setEncoding("utf8");
    broker.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/JumpStart MCP app: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); baseURL = `http://127.0.0.1:${match[1]}/`; resolve(); }
    });
  });
});

test.afterAll(async () => {
  if (!broker || broker.exitCode !== null || broker.signalCode !== null) return;
  const exited = once(broker, "exit");
  broker.kill("SIGTERM");
  const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
});

async function tool(name, args = {}, expectError = false) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  expect(response.ok).toBe(true);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  if (expectError) expect(payload.result.isError).toBe(true);
  else expect(payload.result.isError, payload.result.content?.find((item) => item.type === "text")?.text).not.toBe(true);
  return JSON.parse(payload.result.content.find((item) => item.type === "text").text);
}

async function editor(page) {
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const documentId = await page.evaluate(() => window.__store.doc.id);
  let editorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    editorId = listed.editors.find((entry) => entry.documentId === documentId)?.editorId;
    return !!editorId;
  }).toBe(true);
  return editorId;
}

async function openPlanner(page) {
  const editorId = await editor(page);
  await page.click("#ai-status"); await page.click("#ai-templates-tab");
  return editorId;
}
async function dimensions(page, width = 260, depth = 180, height = 50) {
  for (const [id, value] of [["width", width], ["depth", depth], ["height", height]]) {
    await page.fill(`#drawer-${id}`, String(value)); await page.locator(`#drawer-${id}`).press("Tab");
  }
}
async function draw(page, start, end, columns = 6, rows = 4) {
  const board = page.locator("#drawer-board"); await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  const point = ([x, y]) => ({ x: box.x + (x + 0.5) / columns * box.width, y: box.y + (rows - y - 0.5) / rows * box.height });
  const a = point(start), b = point(end);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
}

test("drawer-first planning calculates fit, draws and moves bins, rejects overlap and supports undo", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const reference = await tool("jumpstart_preview_model", { editorId, includeImage: false, plan: { name: "Preserved item", primitives: [{ id: "reference", kind: "box", position: [300, 0, 0] }] } });
  await tool("jumpstart_apply_model", { editorId, previewId: reference.previewId });
  const original = await tool("jumpstart_get_document", { editorId });
  await expect(page.locator(".drawer-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeDisabled();
  await dimensions(page);
  await expect(page.locator("#drawer-fit")).toContainText("6 × 4 grid");
  await expect(page.locator("#drawer-fit")).toContainText("4.0 mm per side");
  await draw(page, [0, 0], [1, 1]);
  await expect(page.locator(".drawer-bin")).toHaveCount(1);
  await page.getByRole("button", { name: "Increase width", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Increase width", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Decrease width", exact: true }).click();
  await page.fill("#drawer-bin-label", "Screwdrivers"); await page.locator("#drawer-bin-label").press("Tab");
  await draw(page, [3, 0], [3, 2]);
  await expect(page.locator(".drawer-bin")).toHaveCount(2);
  const second = page.locator('[data-bin-id="bin-2"]');
  await second.focus(); await page.keyboard.press("ArrowRight");
  expect(await second.evaluate(el => parseFloat(el.style.left))).toBeCloseTo(4 / 6 * 100, 3);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(second).toContainText("2 × 3");
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#drawer-message")).toContainText("occupied");
  expect(await second.evaluate(el => parseFloat(el.style.left))).toBeCloseTo(2 / 6 * 100, 3);
  await page.getByRole("button", { name: "Remove bin", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo layout", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".drawer-bin")).toHaveCount(2);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(original.revision);
  await page.locator(".drawer-measurements summary").click();
  await page.fill("#drawer-height", "10"); await page.locator("#drawer-height").press("Tab");
  await expect(page.locator("#drawer-message")).toContainText("usable height");
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeDisabled();
  await page.fill("#drawer-height", "50"); await page.locator("#drawer-height").press("Tab");
  await expect(page.locator(".drawer-bin")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("drawer-layout.png") });
  expect(errors).toEqual([]);
});

test("drawer layout previews without mutation, saves and reloads its native plan, then updates without duplicating parts", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await dimensions(page, 140, 100, 50);
  await page.fill("#drawer-name", "Kitchen drawer"); await page.locator("#drawer-name").press("Tab");
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  await expect(page.locator("#drawer-summary")).toContainText("6 of 6 cells used");
  const before = await get();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await get()).revision).toBe(before.revision);
  const viewer = page.locator(".drawer-3d canvas");
  await expect(viewer).toBeVisible();
  const capture = () => viewer.screenshot({ style: "canvas { outline: none !important; }" });
  await viewer.focus();
  await viewer.press("0");
  const homeImage = await capture();
  await viewer.press("ArrowRight");
  expect((await capture()).equals(homeImage)).toBe(false);
  await viewer.press("0");
  expect((await capture()).equals(homeImage)).toBe(true);
  const bounds = await viewer.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  expect((await capture()).equals(homeImage)).toBe(false);
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await viewer.focus();
  const topImage = await capture();
  expect(topImage.equals(homeImage)).toBe(false);
  await viewer.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await capture()).equals(topImage)).toBe(false);
  expect((await get()).revision).toBe(before.revision);
  expect((await get()).bodies).toEqual(before.bodies);
  await expect(page.getByRole("button", { name: "Add layout to document", exact: true })).toBeEnabled();
  await page.locator(".drawer-measurements summary").click();
  await page.fill("#drawer-height", "55"); await page.locator("#drawer-height").press("Tab");
  await expect(page.locator(".drawer-3d .ai-template-stale")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add layout to document", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.screenshot({ path: info.outputPath("drawer-3d.png") });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added", { timeout: 90_000 });
  const applied = await get();
  expect(applied.bodies).toHaveLength(3);
  expect(applied.drawerLayouts).toHaveLength(1);
  expect(applied.drawerLayouts[0]).toMatchObject({ editable: true, definition: { width: 140, depth: 100, height: 55 } });
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  await page.reload(); await page.waitForFunction(() => window.__app?.kernel?.ready); await page.waitForSelector("#loading", { state: "hidden" });
  await page.click("#ai-status"); await page.click("#ai-templates-tab");
  await expect(page.locator("#drawer-name")).toHaveValue("Kitchen drawer");
  await expect(page.locator(".drawer-bin")).toHaveCount(2);
  await page.locator('[data-bin-id="bin-1"]').click();
  await page.getByRole("button", { name: "35 mm", exact: true }).click();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Update layout in document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added", { timeout: 90_000 });
  const updated = await get();
  expect(updated.bodies).toHaveLength(3);
  expect(updated.drawerLayouts[0].definition.bins[0].heightUnits).toBe(5);
  await tool("jumpstart_undo", { editorId, expectedRevision: updated.revision });
  expect((await get()).drawerLayouts[0].definition.bins[0].heightUnits).toBe(3);
  expect(errors).toEqual([]);
});

test("maximum drawer cell budget builds native connected parts within the preview budget", async ({ page }) => {
  const editorId = await editor(page), before = await tool("jumpstart_get_document", { editorId });
  const bins = [];
  for (let y = 0; y < 12; y += 4) for (let x = 0; x < 12; x += 4) bins.push({ id: `bin-${x}-${y}`, x, y, columns: 4, rows: 4, heightUnits: 3 });
  const start = Date.now();
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { name: "Large drawer", operations: [{ type: "drawerLayout", id: "drawer", layoutId: "large-drawer", width: 504, depth: 504, height: 50, bins }] } });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(18);
  expect(preview.bodies.every(body => body.volume > 0 && !body.error)).toBe(true);
  console.info(JSON.stringify({ maximumDrawerPreviewMs: Date.now() - start, parts: preview.bodies.length }));
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});

test("New drawer clears draft and preview in one action, supports undo and leaves CAD bodies intact", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const reference = await tool("jumpstart_preview_model", { editorId, includeImage: false, plan: { name: "Keep existing model", primitives: [{ id: "reference", kind: "box", position: [300, 0, 0] }] } });
  await tool("jumpstart_apply_model", { editorId, previewId: reference.previewId });
  const before = await tool("jumpstart_get_document", { editorId });
  await dimensions(page, 140, 100, 50);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  const binCount = await page.locator(".drawer-bin").count();
  expect(binCount).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await expect(page.locator(".drawer-3d canvas")).toBeVisible();
  await page.getByRole("button", { name: "New drawer", exact: true }).click();
  await expect(page.locator("#drawer-width")).toBeFocused();
  for (const axis of ["width", "depth", "height"]) await expect(page.locator(`#drawer-${axis}`)).toHaveValue("");
  await expect(page.locator(".drawer-bin")).toHaveCount(0);
  await expect(page.locator(".drawer-3d canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Undo layout", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(binCount);
  await expect(page.locator("#drawer-width")).toHaveValue("140");
  await expect(page.locator("#drawer-depth")).toHaveValue("100");
  await expect(page.locator("#drawer-height")).toHaveValue("50");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(0);
  await dimensions(page, 252, 168, 35);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toContainText("Bin 1");
  await expect(page.locator("#drawer-fit")).toContainText("6 × 4 grid");
  const after = await tool("jumpstart_get_document", { editorId });
  expect(after.revision).toBe(before.revision);
  expect(after.bodies).toEqual(before.bodies);
  await page.screenshot({ path: info.outputPath("new-drawer.png") });
  expect(errors).toEqual([]);
});

test("selecting a bin reveals its inspector and keeps quick actions visible without moving the board", async ({ page }, info) => {
  const errors = watchErrors(page);
  await openPlanner(page); await dimensions(page, 700, 230, 50);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  const settings = page.locator(".drawer-settings"), inspector = page.locator(".drawer-inspector");
  await page.locator(".drawer-measurements summary").click();
  const boardBefore = await page.locator("#drawer-board").boundingBox();
  await settings.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator('[data-bin-id="bin-1"]').click();
  await expect(page.locator("#drawer-bin-label")).toHaveValue("Bin 1");
  expect(await page.locator(".drawer-measurements").evaluate(el => el.open)).toBe(false);
  expect(await settings.evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.locator("#drawer-board").boundingBox()).toEqual(boardBefore);
  const inside = async locator => locator.evaluate(el => {
    const box = el.getBoundingClientRect(), panel = el.closest('.drawer-settings').getBoundingClientRect();
    return box.top >= panel.top && box.bottom <= panel.bottom;
  });
  await expect(page.getByRole("button", { name: "Remove bin", exact: true })).toBeVisible();
  expect(await inside(page.getByRole("button", { name: "Remove bin", exact: true }))).toBe(true);
  expect(await inside(page.locator("#drawer-bin-label"))).toBe(true);
  await settings.evaluate(el => { el.scrollTop = 150; });
  expect(await inside(page.getByRole("button", { name: "Remove bin", exact: true }))).toBe(true);
  await page.locator('[data-bin-id="bin-2"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-bin-id="bin-2"]')).toBeFocused();
  expect(await settings.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.locator("#drawer-bin-label")).toHaveValue("Bin 2");
  await page.screenshot({ path: info.outputPath("selected-bin-inspector.png") });
  const count = await page.locator(".drawer-bin").count();
  await page.getByRole("button", { name: "Remove bin", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(count - 1);
  await page.getByRole("button", { name: "Undo layout", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(count);
  expect(errors).toEqual([]);
});

test("Gridfinity Settings persist bin limits and enable a measured 4x5 bin without shrinking existing bins", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  await dimensions(page, 230, 690, 60);
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await page.fill("#ai-template-max-bin-width", "5"); await page.fill("#ai-template-max-bin-depth", "6");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("form", { name: "Gridfinity settings" })).toContainText("Settings saved");
  await page.getByRole("button", { name: "Drawer layout", exact: true }).click();
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Increase width", exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Increase depth", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toContainText("4 × 5");
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const applied = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  expect(applied.drawerLayouts[0].definition.binLimits).toEqual({ columns: 5, rows: 6 });
  expect(applied.drawerLayouts[0].definition.bins[0]).toMatchObject({ columns: 4, rows: 5 });
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await page.fill("#ai-template-max-bin-depth", "4");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("form", { name: "Gridfinity settings" })).toContainText("Existing bins exceed");
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(applied.revision);
  await page.getByRole("button", { name: "Drawer layout", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toContainText("4 × 5");
  await page.getByRole("button", { name: "New drawer", exact: true }).click();
  await dimensions(page, 230, 690, 60);
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(3);
  await expect(page.locator(".drawer-bin").first()).toContainText("5 × 6");
  await page.reload(); await page.waitForFunction(() => window.__app?.kernel?.ready); await page.waitForSelector("#loading", { state: "hidden" });
  await page.click("#ai-status"); await page.click("#ai-templates-tab");
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await expect(page.locator("#ai-template-max-bin-width")).toHaveValue("5");
  await expect(page.locator("#ai-template-max-bin-depth")).toHaveValue("6");
  await page.screenshot({ path: info.outputPath("gridfinity-settings.png") });
  expect(errors).toEqual([]);
});

test("drawer disclosures use pointer cursors and keyboard toggles; reduced motion disables press scaling", async ({ page }, info) => {
  await openPlanner(page);
  const summary = page.locator(".drawer-measurements > summary");
  expect(await summary.evaluate(el => getComputedStyle(el).cursor)).toBe("pointer");
  expect(await summary.evaluate(el => getComputedStyle(el).listStyleType)).toBe("none");
  await summary.focus(); await page.keyboard.press("Enter");
  expect(await summary.evaluate(el => el.parentElement.open)).toBe(false);
  await page.keyboard.press("Space");
  expect(await summary.evaluate(el => el.parentElement.open)).toBe(true);
  expect(await summary.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const button = page.getByRole("button", { name: "New drawer", exact: true });
  await button.hover(); await page.mouse.down();
  await expect.poll(() => button.evaluate(el => getComputedStyle(el).scale)).toBe("0.96");
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.hover(); await page.mouse.down();
  expect(await button.evaluate(el => getComputedStyle(el).scale)).toBe("none");
  expect(await button.evaluate(el => getComputedStyle(el).transform)).toBe("none");
  await page.mouse.up();
  await page.screenshot({ path: info.outputPath("disclosure-polish.png") });
});

test("corner spacers preview as connected native stops outside the grid, persist, update and undo", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  await dimensions(page, 230, 695, 60);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.locator("#drawer-corner-spacers").check();
  await expect(page.locator("#drawer-fit")).toContainText("11.5 mm front/back");
  const previewButton = page.getByRole("button", { name: "Preview layout", exact: true });
  for (const theme of ["light", "dark", "contrast"]) {
    await page.evaluate(theme => window.__app.setTheme(theme, true), theme);
    await previewButton.hover();
    const ratio = await previewButton.evaluate(el => {
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const style = getComputedStyle(el), a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
  const before = await tool("jumpstart_get_document", { editorId });
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
  await page.screenshot({ path: info.outputPath("corner-spacers-preview.png") });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const applied = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const stops = applied.bodies.filter(body => body.drawerSpacer), plates = applied.bodies.filter(body => body.gridfinity?.kind === "baseplate");
  expect(stops).toHaveLength(4); expect(applied.drawerLayouts[0].editable).toBe(true);
  for (const stop of stops) {
    expect(stop.dimensions.x).toBeCloseTo(29.8, 3); expect(stop.dimensions.y).toBeCloseTo(31.3, 3); expect(stop.dimensions.z).toBeCloseTo(5, 3);
    expect(stop.volume).toBeCloseTo(2663.7, 2);
    expect(stop.bounds.min[2]).toBeCloseTo(0, 5);
    const sx = stop.drawerSpacer.corner.includes("right") ? 1 : -1, sy = stop.drawerSpacer.corner.includes("back") ? 1 : -1;
    const plate = plates.toSorted((a, b) => (sx * b.bounds.center[0] + sy * b.bounds.center[1]) - (sx * a.bounds.center[0] + sy * a.bounds.center[1]))[0];
    const inspection = await tool("jumpstart_inspect_geometry", { editorId, expectedRevision: applied.revision, bodyId: stop.id, mesh: true, againstBodyId: plate.id, pairChecks: { maximumOverlapVolume: 0 } });
    expect(inspection.meshValidation.valid).toBe(true); expect(inspection.meshValidation.disconnectedComponents).toBe(1);
    expect(inspection.pair.status).toBe("measured"); expect(inspection.pair.overlapVolumeMm3).toBeCloseTo(0, 5); expect(inspection.pair.distanceMm).toBeCloseTo(0, 4);
  }
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  await page.fill("#drawer-spacer-clearance", "0.4"); await page.locator("#drawer-spacer-clearance").press("Tab");
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Update layout in document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const updated = await tool("jumpstart_get_document", { editorId });
  expect(updated.bodies).toHaveLength(applied.bodies.length);
  expect(updated.bodies.filter(body => body.drawerSpacer).every(body => body.drawerSpacer.clearance === 0.4)).toBe(true);
  await tool("jumpstart_undo", { editorId, expectedRevision: updated.revision });
  expect((await tool("jumpstart_get_document", { editorId })).bodies.filter(body => body.drawerSpacer).every(body => body.drawerSpacer.clearance === 0.2)).toBe(true);
  expect(errors).toEqual([]);
});

test("an empty drawer can preview and add only baseplates and spacers, then save, reopen and undo", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  await dimensions(page, 230, 695, 60);
  await expect(page.locator(".drawer-bin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeEnabled();
  await expect(page.locator("#drawer-summary")).toContainText("Baseplates only");
  await page.locator("#drawer-corner-spacers").check();
  const before = await tool("jumpstart_get_document", { editorId });
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
  await page.screenshot({ path: info.outputPath("baseplates-and-spacers.png") });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const applied = await tool("jumpstart_get_document", { editorId });
  expect(applied.bodies).toHaveLength(12);
  expect(applied.bodies.filter(body => body.drawerSpacer)).toHaveLength(4);
  expect(applied.bodies.filter(body => body.gridfinity?.kind === "baseplate")).toHaveLength(8);
  expect(applied.drawerLayouts[0].definition.bins).toEqual([]);
  expect(applied.drawerLayouts[0].editable).toBe(true);
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  const reopened = await tool("jumpstart_get_document", { editorId });
  expect(reopened.bodies).toHaveLength(12);
  expect(reopened.drawerLayouts[0].definition.bins).toEqual([]);
  await tool("jumpstart_undo", { editorId, expectedRevision: reopened.revision });
  expect((await tool("jumpstart_get_document", { editorId })).bodies).toHaveLength(0);
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByText("Advanced construction", { exact: true }).click();
  await page.locator("#drawer-baseplate").uncheck();
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeDisabled();
  await expect(page.locator("#drawer-message")).toContainText("Enable matching baseplates or add a bin");
  expect(errors).toEqual([]);
});

test("printer settings size baseplate tiles for the selected nozzle and preserve printer-fit metadata", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  await dimensions(page, 230, 695, 60);
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await page.getByRole("button", { name: /^Main nozzle ·/ }).click();
  await expect(page.locator("#ai-template-print-width")).toHaveValue("256");
  await expect(page.locator("#ai-template-print-height")).toHaveValue("260");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("form", { name: "Gridfinity settings" })).toContainText("Settings saved");
  await page.getByRole("button", { name: "Drawer layout", exact: true }).click();
  const before = await tool("jumpstart_get_document", { editorId });
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const applied = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(applied.bodies).toHaveLength(3);
  expect(applied.bodies.map(body => [body.gridfinity.columns, body.gridfinity.rows])).toEqual([[5, 6], [5, 6], [5, 4]]);
  for (const part of applied.bodies) {
    expect(part.dimensions.x).toBeLessThanOrEqual(252.0001); expect(part.dimensions.y).toBeLessThanOrEqual(252.0001);
    expect(part.printFit.status).toBe("passed"); expect(part.printFit.source).toBe("current bounds");
  }
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  expect((await tool("jumpstart_get_document", { editorId })).drawerLayouts[0].definition.printArea.height).toBe(260);
  await page.evaluate(id => window.__store.update(doc => { doc.bodies.find(body => body.id === id).m[0] *= 2; }, "Manual size edit"), applied.bodies[0].id);
  const edited = await tool("jumpstart_get_document", { editorId });
  expect(edited.bodies.find(body => body.id === applied.bodies[0].id).printFit.status).toBe("failed");
  await tool("jumpstart_undo", { editorId, expectedRevision: edited.revision });
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await page.fill("#ai-template-print-height", "4");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("form", { name: "Gridfinity settings" })).toContainText("exceeds the usable printer area");
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(applied.revision);
  await page.getByRole("button", { name: /^Auxiliary nozzle ·/ }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("button", { name: "Drawer layout", exact: true }).click();
  await page.getByRole("button", { name: "New drawer", exact: true }).click();
  await dimensions(page, 252, 210, 60);
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await expect(page.locator(".drawer-3d")).toContainText("90° turn");
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const second = await tool("jumpstart_get_document", { editorId });
  expect(second.bodies).toHaveLength(4);
  const rotated = second.bodies.find(body => body.printFit.rotation === 90);
  expect(rotated.gridfinity.columns).toBe(6); expect(rotated.gridfinity.rows).toBe(5);
  await tool("jumpstart_save_document", { editorId, expectedRevision: second.revision });
  await page.reload(); await page.waitForFunction(() => window.__app?.kernel?.ready); await page.waitForSelector("#loading", { state: "hidden" });
  await page.click("#ai-status"); await page.click("#ai-templates-tab"); await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await expect(page.locator("#ai-template-print-width")).toHaveValue("235.5");
  await expect(page.locator("#ai-template-print-height")).toHaveValue("256");
  await page.screenshot({ path: info.outputPath("printer-area-settings.png") });
  expect(errors).toEqual([]);
});


test("matching open sides support separately printed long-item bins through preview, save and undo", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await editor(page);
  await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true });
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await page.click("#ai-status");
  for (const [key, amount] of [["width", "294"], ["depth", "84"], ["height", "50"]]) {
    await page.fill(`#drawer-${key}`, amount); await page.locator(`#drawer-${key}`).press("Tab");
  }
  await page.getByRole("button", { name: "Printer & settings", exact: true }).click();
  await page.locator("#ai-print-area-enabled").check();
  for (const key of ["width", "depth", "height"]) await page.fill(`#ai-template-print-${key}`, "250");
  await page.fill("#ai-template-max-bin-width", "5"); await page.fill("#ai-template-max-bin-depth", "5");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("button", { name: "Drawer layout", exact: true }).click();
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  for (let count = 0; count < 3; count++) await page.getByRole("button", { name: "Increase width", exact: true }).click();
  await page.locator(".drawer-compartment-options summary").click();
  const compartments = page.getByRole("group", { name: "Across width compartments", exact: true });
  await compartments.getByRole("button", { name: "2", exact: true }).click();
  await expect(compartments.getByRole("button", { name: "2", exact: true })).toBeFocused();
  await compartments.getByRole("button", { name: "1", exact: true }).click();
  await page.locator(".drawer-compartment-options summary").click();
  await page.locator(".drawer-wall-options summary").click();
  await page.getByRole("button", { name: "Open right side", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open right side", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Open right side", exact: true })).toBeFocused();
  await expect(page.locator('.drawer-bin[data-bin-id="bin-1"]')).toHaveAttribute("data-open-right", "true");
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.locator(".drawer-wall-options summary").click();
  await page.getByRole("button", { name: "Open left side", exact: true }).click();
  await page.locator(".drawer-inspector").getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open back side", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo layout", exact: true }).click();
  await page.locator('.drawer-bin[data-bin-id="bin-2"]').click();
  await expect(page.getByRole("button", { name: "Open left side", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "exports/ai-panel/open-sided-layout.png" });
  const before = await get();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await get()).revision).toBe(before.revision);
  await page.screenshot({ path: "exports/ai-panel/open-sided-preview.png" });
  await page.getByRole("button", { name: "Open front side", exact: true }).click();
  await expect(page.locator(".drawer-3d .ai-template-stale")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add layout to document", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open front side", exact: true }).click();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added");
  const applied = await get(), bins = applied.bodies.filter(body => body.gridfinity?.kind === "bin");
  expect(bins).toHaveLength(2);
  expect(bins.map(body => body.gridfinity.openSides)).toEqual([["right"], ["left"]]);
  expect(bins.every(body => body.printFit.configured)).toBe(true);
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  const reopened = await get();
  expect(reopened.drawerLayouts[0].definition.bins.map(bin => bin.openSides)).toEqual([["right"], ["left"]]);
  await tool("jumpstart_undo", { editorId, expectedRevision: reopened.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("drawer width and depth swap rotates bins, invalidates preview and supports keyboard undo", async ({ page }) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const swap = page.getByRole("button", { name: "Swap width & depth", exact: true });
  await expect(swap).toBeDisabled();
  await dimensions(page, 230, 695, 60);
  await swap.focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#drawer-width")).toHaveValue("695");
  await expect(page.locator("#drawer-depth")).toHaveValue("230");
  await expect(page.locator("#drawer-height")).toHaveValue("60");
  const board = await page.locator("#drawer-board").boundingBox();
  expect(board.width).toBeGreaterThan(board.height);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.locator(".drawer-wall-options summary").click();
  await page.getByRole("button", { name: "Open right side", exact: true }).click();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  const add = page.getByRole("button", { name: "Add layout to document", exact: true });
  await expect(add).toBeEnabled({ timeout: 90_000 });
  await page.locator(".drawer-measurements summary").click();
  await swap.click();
  await expect(page.locator("#drawer-width")).toHaveValue("230");
  await expect(page.locator("#drawer-depth")).toHaveValue("695");
  await expect(page.locator('.drawer-bin[data-bin-id="bin-1"]')).toHaveAttribute("data-open-front", "true");
  await page.getByRole("button", { name: "3D preview", exact: true }).click();
  await expect(page.locator(".drawer-3d .ai-template-stale")).toBeVisible();
  await expect(add).toBeDisabled();
  await swap.focus(); await page.keyboard.press("Control+z");
  await expect(page.locator("#drawer-width")).toHaveValue("695");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("drawer-swap-dimensions");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#drawer-width")).toHaveValue("230");
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(add).toBeEnabled({ timeout: 90_000 }); await add.click();
  const applied = await tool("jumpstart_get_document", { editorId });
  expect(applied.drawerLayouts[0].definition).toMatchObject({ width: 230, depth: 695, height: 60,
    bins: [{ id: "bin-1", x: 0, y: 14, columns: 2, rows: 2, openSides: ["front"] }] });
  await mkdir("exports/ai-panel", { recursive: true });
  await page.screenshot({ path: "exports/ai-panel/swapped-drawer-preview.png" });
  expect(errors).toEqual([]);
});

test("selected drawer bins expose stackable rims, preserve them through save and reject a rim that exceeds drawer height", async ({ page }) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await dimensions(page, 126, 84, 50);
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  const stacking = page.getByRole("checkbox", { name: "Stackable rim", exact: true });
  await expect(stacking).toBeVisible(); await expect(stacking).not.toBeChecked();
  await stacking.focus(); await page.keyboard.press("Space");
  await expect(stacking).toBeChecked(); await expect(stacking).toBeFocused();
  await expect(page.locator("#drawer-bin-stacking-note")).toContainText("Total bin height: 25.4 mm");
  await page.locator(".drawer-wall-options summary").click();
  await page.getByRole("button", { name: "Open back side", exact: true }).focus();
  for (let step = 0; step < 5; step++) await page.keyboard.press("Shift+Tab");
  await expect(stacking).toBeFocused();
  const checkboxBounds = await stacking.boundingBox(), headerBounds = await page.locator(".drawer-inspector-header").boundingBox();
  expect(checkboxBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);

  await page.keyboard.press("Control+z");
  await page.locator('.drawer-bin[data-bin-id="bin-1"]').click();
  await expect(stacking).not.toBeChecked(); await stacking.check();
  const before = await get();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  const add = page.getByRole("button", { name: "Add layout to document", exact: true });
  await expect(add).toBeEnabled({ timeout: 90_000 });
  expect((await get()).revision).toBe(before.revision);
  await stacking.uncheck();
  await expect(page.locator(".drawer-3d .ai-template-stale")).toBeVisible(); await expect(add).toBeDisabled();
  await stacking.check();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(add).toBeEnabled({ timeout: 90_000 }); await add.click();
  const applied = await get();
  expect(applied.drawerLayouts[0].definition.bins[0].lip).toBe(true);
  expect(applied.bodies.find(b => b.gridfinity?.kind === "bin").gridfinity.lip).toBe(true);
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  expect((await get()).drawerLayouts[0].definition.bins[0].lip).toBe(true);
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.locator('.drawer-bin[data-bin-id="bin-1"]').click();
  await page.locator(".drawer-measurements summary").click();
  await stacking.uncheck();
  await page.fill("#drawer-height", "24"); await page.locator("#drawer-height").press("Tab");
  await stacking.click();
  await expect(stacking).not.toBeChecked(); await expect(stacking).toBeFocused();
  await expect(page.locator("#drawer-message")).toContainText("too tall for the drawer");
  await page.locator(".drawer-inspector .drawer-advanced summary").click();
  await page.getByRole("button", { name: "Insert blank", exact: true }).click();
  await expect(stacking).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("flush open-edge joins persist through drawer save and Single part supports the same option", async ({ page }) => {
  const errors = watchErrors(page), editorId = await openPlanner(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await dimensions(page, 84, 42, 50);
  for (const side of ["right", "left"]) {
    await page.getByRole("button", { name: "Add bin", exact: true }).click();
    await page.locator(".drawer-wall-options summary").click();
    const close = page.getByRole("checkbox", { name: "Close gaps on open sides", exact: true });
    await expect(close).toBeDisabled();
    await page.getByRole("button", { name: `Open ${side} side`, exact: true }).click();
    await close.check(); await expect(close).toBeChecked(); await expect(close).toBeFocused();
    await expect(page.locator('.drawer-bin[aria-pressed="true"]')).toHaveAttribute("data-close-gaps", "true");
  }
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  const add = page.getByRole("button", { name: "Add layout to document", exact: true });
  await expect(add).toBeEnabled({ timeout: 90_000 });
  const close = page.getByRole("checkbox", { name: "Close gaps on open sides", exact: true });
  await close.uncheck(); await expect(add).toBeDisabled(); await close.check();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(add).toBeEnabled({ timeout: 90_000 }); await add.click();
  const applied = await get();
  expect(applied.drawerLayouts[0].definition.bins.every(b => b.closeGaps)).toBe(true);
  expect(applied.bodies.filter(b => b.gridfinity?.kind === "bin").map(b => b.gridfinity.width)).toEqual([41.75,41.75]);
  await mkdir("exports/ai-panel", { recursive: true });
  await page.screenshot({ path: "exports/ai-panel/flush-joined-bins-preview.png" });
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  const saved = await get(); expect(saved.drawerLayouts[0].definition.bins.every(b => b.closeGaps)).toBe(true);
  const ids = new Set(saved.bodies.map(b => b.id));
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await page.locator('[data-template="bin"]').click();
  await page.getByText("Compartments & stacking", { exact: true }).click();
  const singleClose = page.getByRole("checkbox", { name: "Close gaps on open sides", exact: true });
  await expect(singleClose).toBeDisabled();
  await page.getByRole("button", { name: "Open right side", exact: true }).click();
  await singleClose.check();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const singleAdd = page.getByRole("button", { name: "Add to document", exact: true });
  await expect(singleAdd).toBeEnabled({ timeout: 90_000 }); await singleAdd.click();
  const created = (await get()).bodies.find(b => !ids.has(b.id));
  expect(created.gridfinity.closeGaps).toBe(true);
  expect(created.dimensions.x).toBeCloseTo(created.gridfinity.columns * 42 - .25, 4);
  await page.getByRole("button", { name: "Open right side", exact: true }).click();
  await expect(singleClose).toBeDisabled(); await expect(singleClose).not.toBeChecked();
  expect(errors).toEqual([]);
});
