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

test("drawer magnet controls align baseplates and bins, check the raised seating height and update without duplicates", async ({ page }, info) => {
  const errors = watchErrors(page), editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  await page.click("#ai-status"); await page.click("#ai-templates-tab");
  for (const [id, value] of [["width", 140], ["depth", 100], ["height", 24]]) { await page.fill(`#drawer-${id}`, String(value)); await page.locator(`#drawer-${id}`).press("Tab"); }
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await page.getByRole("button", { name: "Fill gaps", exact: true }).click();
  await page.locator('.drawer-bin[data-bin-id="bin-1"]').click();
  await page.getByText("More bin options", { exact: true }).click();
  await page.locator("#drawer-bin-magnets").check();
  await page.fill("#drawer-bin-magnets-diameter", "6.2"); await page.locator("#drawer-bin-magnets-diameter").press("Tab");
  await page.fill("#drawer-bin-magnets-depth", "2.3"); await page.locator("#drawer-bin-magnets-depth").press("Tab");
  await page.getByRole("button", { name: "Use this magnet fit in all bins", exact: true }).click();
  await page.getByText("Advanced construction", { exact: true }).click();
  await page.locator("#drawer-baseplate-magnets").check();
  await expect(page.locator("#drawer-message")).toContainText("too tall");
  await expect(page.getByRole("button", { name: "Preview layout", exact: true })).toBeDisabled();
  await page.locator(".drawer-measurements summary").click();
  await page.fill("#drawer-height", "25"); await page.locator("#drawer-height").press("Tab");
  await expect(page.locator(".drawer-settings")).toContainText("Baseplate height: 8.2 mm");
  await expect(page.locator("#drawer-summary")).toContainText("48 magnet pockets");
  const before = await get();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  expect((await get()).revision).toBe(before.revision);
  await page.screenshot({ path: info.outputPath("magnetic-drawer.png") });
  await page.getByRole("button", { name: "Add layout to document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added", { timeout: 90_000 });
  const applied = await get();
  expect(applied.bodies).toHaveLength(3);
  expect(applied.drawerLayouts[0].definition.baseplateMagnets).toEqual({ diameter: 6.5, depth: 2.4 });
  expect(applied.drawerLayouts[0].definition.bins.every(bin => bin.magnets.diameter === 6.2 && bin.magnets.depth === 2.3)).toBe(true);
  for (const part of applied.bodies.filter(body => body.gridfinity.kind !== "baseplate")) {
    expect(part.bounds.min[2]).toBeCloseTo(3.45, 3);
    expect(part.gridfinity.magnetPockets.opening).toBe("bottom");
  }
  await tool("jumpstart_save_document", { editorId, expectedRevision: applied.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: applied.revision, documentId: applied.document.id });
  expect((await get()).drawerLayouts[0].definition).toEqual(applied.drawerLayouts[0].definition);
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.locator('.drawer-bin[data-bin-id="bin-1"]').click();
  await page.locator("#drawer-bin-magnets").uncheck();
  await page.getByRole("button", { name: "Preview layout", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Preview ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Update layout in document", exact: true }).click();
  await expect(page.locator("#drawer-message")).toContainText("Layout added", { timeout: 90_000 });
  const updated = await get();
  expect(updated.bodies).toHaveLength(3);
  expect(updated.bodies.find(body => body.drawerLayout.partId === "bin-1").gridfinity.magnetPockets).toBeUndefined();
  await tool("jumpstart_undo", { editorId, expectedRevision: updated.revision });
  expect((await get()).bodies.find(body => body.drawerLayout.partId === "bin-1").gridfinity.magnetPockets.count).toBe(16);
  expect(errors).toEqual([]);
});

test("maximum magnetic drawer preview remains within the bounded native build budget", async ({ page }) => {
  const editorId = await editor(page), before = await tool("jumpstart_get_document", { editorId });
  const bins = [];
  for (let y = 0; y < 12; y += 4) for (let x = 0; x < 12; x += 4) bins.push({ id: `bin-${x}-${y}`, x, y, columns: 4, rows: 4, magnets: true });
  const start = Date.now();
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { name: "Magnetic drawer", operations: [{ id: "drawer", type: "drawerLayout", width: 504, depth: 504, height: 40, baseplateMagnets: true, bins }] } });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(18);
  expect(preview.bodies.reduce((sum, body) => sum + body.gridfinity.magnetPockets.count, 0)).toBe(1152);
  console.info(JSON.stringify({ maximumMagneticDrawerPreviewMs: Date.now() - start, parts: preview.bodies.length, pockets: 1152 }));
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
