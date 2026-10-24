import { test, expect } from "@playwright/test";
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.fill("#ai-template-max-bin-width", "5"); await page.fill("#ai-template-max-bin-depth", "6");
  await page.getByRole("button", { name: "Save limits", exact: true }).click();
  await expect(page.getByRole("form", { name: "Gridfinity settings" })).toContainText("Limits saved");
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.fill("#ai-template-max-bin-depth", "4");
  await page.getByRole("button", { name: "Save limits", exact: true }).click();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
