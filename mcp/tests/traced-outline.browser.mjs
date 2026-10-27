import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0, importDirectory;

// A concave, peanut-shaped tool traced at 360 points, written the way Tracefinity exports tool.svg.
const trace = Array.from({ length: 360 }, (_, i) => {
  const t = (i / 360) * 2 * Math.PI;
  return [50 * Math.cos(t), (14 + 7 * Math.cos(2 * t)) * Math.sin(t)];
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="102mm" height="44mm" viewBox="-51 -22 102 44">\n  <polygon points="${trace.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(" ")}" fill="black" stroke="none"/>\n</svg>\n`;
const area = points => Math.abs(points.reduce((sum, [x1, y1], i) => { const [x2, y2] = points[(i + 1) % points.length]; return sum + x1 * y2 - x2 * y1; }, 0) / 2);
const perimeter = points => points.reduce((sum, [x1, y1], i) => { const [x2, y2] = points[(i + 1) % points.length]; return sum + Math.hypot(x2 - x1, y2 - y1); }, 0);

test.beforeAll(async () => {
  importDirectory = await mkdtemp(join(tmpdir(), "jumpstart-mcp-outlines-"));
  await writeFile(join(importDirectory, "peanut-tool.svg"), svg);
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1", JUMPSTART_MCP_IMPORT_DIR: importDirectory },
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
  if (broker && broker.exitCode === null && broker.signalCode === null) {
    const exited = once(broker, "exit");
    broker.kill("SIGTERM");
    const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  if (importDirectory) await rm(importDirectory, { recursive: true, force: true });
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

test("a traced tool SVG becomes a measured insert pocket through list, outline, preview, inspect and apply", async ({ page }) => {
  const errors = watchErrors(page), editorId = await editor(page);
  const [asset] = (await tool("jumpstart_list_imports")).assets;
  expect(asset).toMatchObject({ name: "peanut-tool.svg", format: "svg" });
  const outline = await tool("jumpstart_get_outline", { assetId: asset.assetId });
  expect(outline).toMatchObject({ name: "peanut-tool", innerOutlinesIgnored: 0, fingerHoles: [], sourceEvidence: { product: "peanut-tool", kind: "measured" } });
  expect(outline.width).toBeCloseTo(100, 1);
  expect(outline.profile.segments.length).toBeLessThanOrEqual(64);
  expect(outline.deviation).toBeLessThan(0.3);
  const importAsCad = await tool("jumpstart_preview_model", { editorId, includeImage: false, plan: { name: "Wrong", operations: [{ id: "x", type: "import", assetId: asset.assetId }] } }, true);
  expect(importAsCad.error).toMatch(/tool outline; read it with jumpstart_get_outline/);

  const clearance = Math.max(0.5, outline.minimumClearance + 0.3), depth = 10;
  const insert = { id: "insert", type: "gridfinity", kind: "insert", columns: 3, rows: 2, heightUnits: 3, floor: 2, wall: 1.2, lip: false };
  const cut = { id: "tool", type: "pocket", target: "insert", profile: outline.profile, position: [0, 0], depth, clearance, minimumFloor: 2, minimumWall: 1.2, sourceEvidence: outline.sourceEvidence };
  const before = await tool("jumpstart_get_document", { editorId });
  const blank = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { name: "Blank", operations: [insert] } });
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { name: "Peanut tool insert", operations: [insert, cut] } });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  const contour = outline.profile.segments.map((segment) => segment.start);
  const removed = blank.bodies[0].volume - preview.bodies[0].volume;
  expect(removed).toBeGreaterThan(area(contour) * depth);
  expect(removed).toBeLessThan((area(contour) + perimeter(contour) * clearance + Math.PI * clearance ** 2) * depth + 1);
  expect(removed).toBeGreaterThan(area(trace) * depth);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, previewId: preview.previewId, bodyId: preview.bodies[0].id, mesh: true });
  expect(inspection.meshValidation).toMatchObject({ valid: true, disconnectedComponents: 1 });
  await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_get_document", { editorId })).bodies).toHaveLength(1);
  expect(errors).toEqual([]);
});
