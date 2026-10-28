import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors, loadDoc, newDoc, body, prim } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0;

test.beforeAll(async () => {
  await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true });
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

test("Generators groups the drawer workflow and printer settings under the Gridfinity feature", async ({ page }) => {
  const errors = watchErrors(page);
  await editor(page);
  await page.click("#ai-status");
  const panel = page.locator("#ai-setup-panel");
  await expect(panel).toBeVisible();
  const connection = page.getByRole("tab", { name: "AI connection" });
  const templates = page.getByRole("tab", { name: "Create" });
  const connectionBounds = await panel.boundingBox();
  expect(connectionBounds.x).toBe(0);
  expect(connectionBounds.width).toBe(page.viewportSize().width);
  expect(await page.locator("#ribbon").evaluate(el => el.inert)).toBe(true);
  expect(await page.locator("#app > .work").evaluate(el => el.inert)).toBe(true);
  expect(await page.locator(".topbar").evaluate(el => el.inert)).toBe(false);
  await expect(templates).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#drawer-width")).toBeVisible();
  await connection.click();
  await expect(page.locator("#ai-setup-codex")).toBeVisible();
  await expect(page.locator("#ai-setup-claude")).toBeHidden();
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(page.locator("#ai-setup-claude")).toBeVisible();
  await expect(page.locator("#ai-setup-codex")).toBeHidden();
  await page.getByRole("button", { name: "Antigravity CLI", exact: true }).click();
  await expect(page.locator("#ai-setup-antigravity")).toBeVisible();
  await page.screenshot({ path: "exports/ai-panel/connection.png" });
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await templates.focus();
  await page.keyboard.press("Enter");
  await expect(templates).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-templates-panel")).toBeVisible();
  expect(await panel.boundingBox()).toEqual(connectionBounds);
  const headerLayout = await page.locator(".ai-setup-header").evaluate(header => {
    const bounds = header.getBoundingClientRect(), tabs = header.querySelector('[role="tablist"]').getBoundingClientRect();
    return { height: bounds.height, tabsInside: tabs.top >= bounds.top && tabs.bottom <= bounds.bottom };
  });
  expect(headerLayout.height).toBeLessThanOrEqual(64);
  expect(headerLayout.tabsInside).toBe(true);
  const gridfinity = page.getByRole("region", { name: "Gridfinity", exact: true });
  await expect(gridfinity).toBeVisible();
  await expect(gridfinity.getByRole("group", { name: "Gridfinity workflow" })).toBeVisible();
  await expect(gridfinity.getByRole("button", { name: "Drawer layout", exact: true })).toBeVisible();
  await expect(gridfinity.getByRole("button", { name: "Single part", exact: true })).toHaveCount(0);
  await expect(page.locator("#drawer-width")).toBeVisible();
  await expect(page.locator("#ai-connection-panel")).toBeHidden();
  await templates.focus();
  await page.keyboard.press("ArrowRight");
  await expect(connection).toBeFocused();
  await expect(connection).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-connection-panel")).toBeVisible();
  expect(await panel.boundingBox()).toEqual(connectionBounds);
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

test("drawer setup stays separate from the connection panel at wide and narrow widths", async ({ page }) => {
  const errors = watchErrors(page);
  await editor(page);
  await page.click("#ai-status");
  await expect(page.locator("#ai-templates-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ai-connection-panel")).toBeHidden();
  await page.screenshot({ path: "exports/ai-panel/drawer-start.png" });
  await page.getByRole("button", { name: "Try a 336 × 252 mm example", exact: true }).click();
  await page.getByRole("button", { name: "Add bin", exact: true }).click();
  await expect(page.locator(".drawer-bin")).toHaveCount(1);
  await page.screenshot({ path: "exports/ai-panel/drawer-arrange.png" });
  await page.setViewportSize({ width: 320, height: 760 });
  const panel = page.locator("#ai-setup-panel");
  expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "exports/ai-panel/drawer-narrow.png" });
  expect(errors).toEqual([]);
});

test("new manual workspaces block MCP mutations while preserving document reads", async ({ page }) => {
  const editorId = await editor(page);
  await loadDoc(page, newDoc("Manual workspace guard", "advanced", { bodies: [body("guard-part", "Guard part", prim("box", { w: 20, d: 20, h: 12 }))] }));
  for (const name of ["arch", "cam", "voxel", "cosforge", "carve"]) {
    await page.evaluate(name => name === "arch" ? window.__app.setMode("arch") : window.__app[name].open(), name);
    const before = await tool("jumpstart_get_document", { editorId });
    const result = await tool("jumpstart_undo", { editorId, expectedRevision: before.revision }, true);
    expect(JSON.stringify(result)).toContain("before using MCP edits");
    expect(JSON.stringify(result).toLowerCase()).toContain(name === "arch" ? "architect" : name);
    expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
    await page.evaluate(name => name === "arch" ? window.__app.setMode("advanced") : window.__app[name].close(), name);
  }
});
