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

test("AI workspace tabs keep connection setup and expose an accessible manual Templates view", async ({ page }) => {
  const errors = watchErrors(page);
  await editor(page);
  await page.click("#ai-status");
  const panel = page.locator("#ai-setup-panel");
  await expect(panel).toBeVisible();
  const connection = page.getByRole("tab", { name: "Connection" });
  const templates = page.getByRole("tab", { name: "Templates" });
  await expect(connection).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-setup-codex")).toBeVisible();
  await templates.focus();
  await page.keyboard.press("Enter");
  await expect(templates).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-templates-panel")).toBeVisible();
  await expect(page.locator("#drawer-width")).toBeVisible();
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await expect(page.getByRole("button", { name: /Custom insert/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bin/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Baseplate/ })).toBeVisible();
  await expect(page.locator("#ai-connection-panel")).toBeHidden();
  await templates.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(connection).toBeFocused();
  await expect(connection).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-connection-panel")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await templates.click();
  const mobileBounds = await page.locator("#ai-setup-panel").evaluate(panel => {
    const rect = panel.getBoundingClientRect(), content = panel.querySelector("#ai-templates-panel");
    return { left: rect.left, right: rect.right, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth,
      overflowingControls: [...content.querySelectorAll("button,input")].filter(control => control.getBoundingClientRect().right > innerWidth).length };
  });
  expect(mobileBounds).toMatchObject({ left: 0, right: 320 });
  expect(mobileBounds.contentScrollWidth).toBeLessThanOrEqual(mobileBounds.contentWidth);
  expect(mobileBounds.overflowingControls).toBe(0);
  expect(errors).toEqual([]);
});

test("desktop settings stay beside the preview and edits retain a stale image until refreshed", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await page.click("#ai-status");
  await page.click("#ai-templates-tab");
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  const before = await get();
  expect(before.bodies).toHaveLength(0);
  await page.getByText("Reference and dimensions", { exact: true }).click();
  await page.getByRole("button", { name: "in", exact: true }).click();
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await page.fill("#ai-template-1-product", "Sample organizer");
  await page.fill("#ai-template-1-url", "https://example.com/dimensions");
  await page.click("#ai-template-1-depth");
  await page.fill("#ai-template-1-depth", "8");
  await page.click("#ai-templates-panel button[type=submit]");
  await expect(page.locator("#ai-template-message")).toContainText("Preview ready", { timeout: 90_000 });
  const previewArea = page.locator("#ai-template-preview");
  await expect(previewArea).toBeVisible();
  await expect(previewArea.locator("img")).toHaveAttribute("alt", /isometric/i);
  await expect(previewArea).toContainText("Connected geometry checked");
  const afterPreview = await get();
  expect(afterPreview.revision).toBe(before.revision);
  expect(afterPreview.bodies).toHaveLength(0);

  const desktopLayout = await page.evaluate(() => {
    const panel = document.querySelector("#ai-setup-panel").getBoundingClientRect();
    const settings = document.querySelector(".ai-template-settings").getBoundingClientRect();
    const preview = document.querySelector("#ai-template-preview").getBoundingClientRect();
    return { panelWidth: panel.width, settingsRight: settings.right, previewLeft: preview.left, previewTop: preview.top };
  });
  expect(desktopLayout.panelWidth).toBeGreaterThan(900);
  expect(desktopLayout.settingsRight).toBeLessThan(desktopLayout.previewLeft);
  const image = previewArea.locator("img");
  const source = await image.getAttribute("src");
  await page.fill("#ai-template-1-depth", "9");
  await expect(previewArea).toBeVisible();
  await expect(previewArea).toContainText("Out of date");
  await expect(image).toHaveAttribute("src", source);
  await expect(page.getByRole("button", { name: "Add to document" })).toBeDisabled();
  const previewTop = await previewArea.evaluate(element => element.getBoundingClientRect().top);
  expect(previewTop).toBeCloseTo(desktopLayout.previewTop, 1);
  expect((await get()).revision).toBe(before.revision);

  await page.getByRole("button", { name: "Cancel preview" }).click();
  await expect(page.getByRole("button", { name: "Add to document" })).toHaveCount(0);
  await expect(previewArea).toBeHidden();
  await expect(page.locator("#ai-template-message")).toContainText("Preview cancelled");
  expect((await get()).revision).toBe(before.revision);

  await page.click("#ai-templates-panel button[type=submit]");
  await expect(page.locator("#ai-template-message")).toContainText("Preview ready", { timeout: 90_000 });
  await expect(previewArea.locator(".ai-template-stale")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("templates-wide.png") });
  await page.getByRole("button", { name: "Add to document" }).click();
  await expect(page.locator("#ai-template-message")).toContainText("Added to the document", { timeout: 90_000 });
  const applied = await get();
  expect(applied.bodies).toHaveLength(1);
  expect(applied.bodies[0]).toMatchObject({ gridfinity: { kind: "insert", columns: 2, rows: 3 }, pockets: [{ id: "pocket1", depth: 9, clearance: 0.3, sourceEvidence: { kind: "manufacturer", units: "in", product: "Sample organizer", url: "https://example.com/dimensions" } }] });
  await expect(page.getByRole("button", { name: "Add to document" })).toHaveCount(0);
  expect((await get()).bodies).toHaveLength(1);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("a selected reference body supplies envelope dimensions and remains in the document after adding its insert", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  await page.evaluate(() => window.__store.update(doc => {
    doc.mode = "advanced";
    doc.bodies.push({ id: "reference-item", name: "Measured tool envelope", seq: ++doc.seq, color: "#9fb1c4", role: "reference", hole: false, hidden: false, m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: { w: 30, d: 20, h: 8 }, mods: [] } });
  }, "Add reference envelope"));
  await waitIdle(page);
  await page.click("#ai-status");
  await page.click("#ai-templates-tab");
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await page.getByText("Reference and dimensions", { exact: true }).click();
  const referenceButton = page.getByRole("button", { name: "Measured tool envelope" });
  await expect(referenceButton).toBeVisible();
  await referenceButton.click();
  await expect(page.locator("#ai-template-1-width")).toHaveValue("30");
  await expect(page.locator("#ai-template-1-height")).toHaveValue("20");
  await expect(page.locator("#ai-template-1-product")).toHaveValue("Measured tool envelope");
  await expect(page.locator("#ai-template-message")).toContainText("Envelope dimensions copied");
  await page.click("#ai-templates-panel button[type=submit]");
  await expect(page.locator("#ai-template-message")).toContainText("Preview ready", { timeout: 90_000 });
  const preview = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(preview.bodies).toHaveLength(1);
  await page.getByRole("button", { name: "Add to document" }).click();
  await expect(page.locator("#ai-template-message")).toContainText("Added to the document", { timeout: 90_000 });
  const final = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(final.bodies).toHaveLength(2);
  expect(final.bodies.find(body => body.id === "reference-item")).toMatchObject({ role: "reference", dimensions: { x: 30, y: 20, z: 8 } });
  expect(final.bodies.find(body => body.gridfinity)).toBeDefined();
  expect(errors).toEqual([]);
});

test("a new template preview excludes existing parts and restores their viewport visibility", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  await page.click("#ai-status");
  await page.click("#ai-templates-tab");
  await page.getByRole("button", { name: "Single part", exact: true }).click();
  await page.locator('[data-template="bin"]').click();
  const preview = async () => {
    await page.click("#ai-templates-panel button[type=submit]");
    await expect(page.locator("#ai-template-message")).toContainText("Preview ready", { timeout: 90_000 });
  };
  await preview();
  await page.getByRole("button", { name: "Add to document", exact: true }).click();
  await expect(page.locator("#ai-template-message")).toContainText("Added to the document");
  const before = await tool("jumpstart_get_document", { editorId });
  expect(before.bodies).toHaveLength(1);
  await page.evaluate(() => {
    const app = window.__app, render = app.vp.render.bind(app.vp);
    window.__capturedBodyIds = [];
    app.vp.render = (...args) => {
      if (window.__store.preview && !app.vp.grid.visible) {
        window.__capturedBodyIds.push([...app.scene.views].filter(([, view]) => view.group.visible).map(([id]) => id));
      }
      return render(...args);
    };
  });
  await page.fill("#ai-template-columns", "1");
  await preview();
  const captures = await page.evaluate(() => window.__capturedBodyIds);
  expect(captures.length).toBeGreaterThanOrEqual(3);
  for (const ids of captures) {
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(before.bodies[0].id);
  }
  const after = await tool("jumpstart_get_document", { editorId });
  expect(after.revision).toBe(before.revision);
  expect(after.bodies).toEqual(before.bodies);
  expect(await page.evaluate(id => window.__app.scene.views.get(id)?.group.visible, before.bodies[0].id)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("isolated-template-preview.png") });
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  expect(await page.evaluate(id => window.__app.scene.views.get(id)?.group.visible, before.bodies[0].id)).toBe(true);
  expect(errors).toEqual([]);
});
