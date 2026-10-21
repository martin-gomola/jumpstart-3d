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

test("chamfer preview, geometry inspection, explicit apply, stale rejection and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const basePlan = { name: "Chamfered block", primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 20, h: 10 } }] };
  const basePreview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: basePlan, includeImage: false });
  expect(basePreview.valid, JSON.stringify(basePreview.errors)).toBe(true);
  const edge = basePreview.bodies[0].geometrySelectors.edges.find(({ t }) => t === "LINE");
  expect(edge).toBeTruthy();
  expect((await get()).revision).toBe(before.revision);

  const plan = {
    ...basePlan,
    operations: [{ id: "bevel", type: "modifier", target: "block", modifier: { type: "chamfer", distance: 1, edges: [edge] } }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies[0].volume).toBeLessThan(basePreview.bodies[0].volume);
  expect(preview.bodies[0].featureTree.mods[0]).toMatchObject({ t: "chamfer", d: 1 });
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect((await get()).revision).toBe(before.revision);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  expect((await get()).bodies[0].featureTree.mods[0]).toMatchObject({ t: "chamfer", d: 1, edges: [expect.objectContaining({ m: edge.m, t: edge.t })] });
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await tool("jumpstart_get_document", { editorId })).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("chamfer preview rejects an edge signature that does not match geometry", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const plan = {
    name: "Invalid chamfer",
    primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 20, h: 10 } }],
    operations: [{ id: "bevel", type: "modifier", target: "block", modifier: { type: "chamfer", distance: 1, edges: [{ m: [999, 999, 999], n: [0, 0.5, 0.5], t: "NO_SUCH_EDGE" }] } }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid).toBe(false);
  expect(preview.errors).toEqual([expect.objectContaining({ error: expect.stringMatching(/Chamfer: its edges no longer exist/) })]);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
