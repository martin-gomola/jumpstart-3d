import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors } from "../../test/helpers.mjs";

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

test("rounded rectangle previews exact native extrusion geometry, inspects, applies and undoes", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Rounded tray wall",
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "roundedRect", width: 30, height: 20, radius: 4, center: [3, -2] } }],
    features: [{ id: "wall", type: "extrude", sketch: "outline", distance: 5 }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  expect(preview.bodies[0].volume).toBeCloseTo((30 * 20 - (4 - Math.PI) * 16) * 5, 1);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.sketches[0].entities.filter(({ t }) => t === "arc")).toHaveLength(4);
  expect(saved.bodies[0].featureTree).toMatchObject({ t: "extrude", sketch: saved.sketches[0].id });
  expect(saved.bodies[0].volume).toBeCloseTo((30 * 20 - (4 - Math.PI) * 16) * 5, 1);
  await tool("jumpstart_undo", { editorId, expectedRevision: saved.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("mixed native contour previews, inspects, applies idempotently, rejects stale preview, and undoes", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Curved tray",
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
      { type: "line", start: [0, 0], end: [20, 0] },
      { type: "arc", start: [20, 0], through: [23, 3], end: [20, 6] },
      { type: "spline", points: [[20, 6], [10, 8], [0, 6]] },
      { type: "line", start: [0, 6], end: [0, 0] },
    ] } }],
    features: [{ id: "tray", type: "extrude", sketch: "outline", distance: 4 }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  expect(preview.bodies[0].volume).toBeGreaterThan(20 * 6 * 4);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.sketches[0].entities.map(({ t }) => t)).toEqual(["line", "arc", "spline", "line"]);
  expect(saved.sketches[0].entities.find(({ t }) => t === "spline").closed).toBe(false);
  expect(saved.bodies[0].featureTree).toMatchObject({ t: "extrude", sketch: saved.sketches[0].id });
  await tool("jumpstart_undo", { editorId, expectedRevision: saved.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});
