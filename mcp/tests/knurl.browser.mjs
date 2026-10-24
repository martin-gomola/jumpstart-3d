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

test("knurled knob previews measurable native geometry, inspects, applies idempotently, rejects stale preview and undoes", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = { name: "Knurled control knob", operations: [{ id: "knob", type: "knurl", diameter: 20, length: 15, grooves: 24, bore: "round", boreSize: 5 }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  const [body] = preview.bodies;
  expect(body.dimensions.z).toBeCloseTo(15, 3);
  expect(body.bounds.min[0]).toBeCloseTo(-10, 1);
  expect(body.bounds.max[0]).toBeCloseTo(10, 1);
  expect(body.volume).toBeGreaterThan(0);
  expect(body.featureTree).toMatchObject({ t: "extrude", profiles: [{ key: expect.any(String), pt: [expect.any(Number), expect.any(Number)] }], dist: 15 });
  expect((await get()).revision).toBe(before.revision);
  expect((await get()).bodies).toHaveLength(0);

  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: body.id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.bodies).toHaveLength(1);
  expect(saved.bodies[0].featureTree.t).toBe("extrude");
  expect(saved.sketches).toHaveLength(1);
  expect(saved.sketches[0].hidden).toBe(true);
  expect(saved.sketches[0].entities).toHaveLength(49);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("shell exports remain byte-stable after saving and rebuilding the native document", async ({ page }) => {
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Stable shell export",
    primitives: [{ id: "shell-body", kind: "box", parameters: { w: 30, d: 24, h: 18 } }],
    operations: [{ id: "shell", type: "modifier", target: "shell-body", modifier: { type: "shell", thickness: 1, direction: "in", faces: [] } }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies[0].volume).toBeGreaterThan(0);
  await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  const saved = await get();
  await tool("jumpstart_save_document", { editorId, expectedRevision: saved.revision });
  const first = await tool("jumpstart_export_model", { editorId, format: "stl", name: "shell-order-first" });
  expect(first.byteLength).toBeGreaterThan(84);

  await page.reload();
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const reloadedDocumentId = await page.evaluate(() => window.__store.doc.id);
  let reloadedEditorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    reloadedEditorId = listed.editors.find((entry) => entry.documentId === reloadedDocumentId)?.editorId;
    return !!reloadedEditorId;
  }).toBe(true);
  await expect.poll(async () => (await tool("jumpstart_get_document", { editorId: reloadedEditorId, includeGeometry: true })).bodies.length).toBe(1);
  const second = await tool("jumpstart_export_model", { editorId: reloadedEditorId, format: "stl", name: "shell-order-second" });
  expect(second.byteLength).toBe(first.byteLength);
  expect(second.base64).toBe(first.base64);
});
