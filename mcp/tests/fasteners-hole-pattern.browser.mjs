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

test("hole patterns preview actual geometry, apply once, reject stale previews and undo", async ({ page }, info) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  expect(before.bodies).toHaveLength(0);
  const plan = {
    name: "Perforated plate", modelId: "perforated-plate",
    parameters: { width: { value: 60, unit: "mm", min: 20, max: 100 } },
    primitives: [{ id: "plate", kind: "box", parameters: { w: { $expr: "width" }, d: 40, h: 6 } }],
    operations: [{ id: "holes", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 3, rows: 2, pitch: 10 }, hole: { diameter: 4 } }],
  };
  const first = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(first.valid).toBe(true);
  expect(first.holePatterns).toEqual([expect.objectContaining({ holes: 6, total: 6, dropped: 0 })]);
  expect(first.bodies[0].volume).toBeCloseTo(60 * 40 * 6 - 6 * Math.PI * 2 * 2 * 6, 0);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: first.bodies[0].id, previewId: first.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: first.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: first.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const revision = await tool("jumpstart_preview_parameters", { editorId, expectedRevision: applied.revision, modelId: "perforated-plate", values: { width: 80 }, includeImage: false });
  expect(revision.valid).toBe(true);
  expect(revision.holePatterns).toEqual([expect.objectContaining({ holes: 6, dropped: 0 })]);
  const revised = await tool("jumpstart_apply_model", { editorId, previewId: revision.previewId });
  const saved = await get();
  expect(saved.bodies[0].dimensions.x).toBeCloseTo(80, 3);
  expect(saved.bodies[0].featureTree.mods[0]).toMatchObject({ t: "hole", at: expect.arrayContaining([expect.objectContaining({ p: expect.any(Array), n: [0, 0, 1] })]) });
  expect(saved.bodies[0].featureTree.mods[0].at).toHaveLength(6);
  const reverted = await tool("jumpstart_undo", { editorId, expectedRevision: revised.revision });
  await tool("jumpstart_undo", { editorId, expectedRevision: reverted.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("fastener preview produces a native thread and apply keeps it editable", async ({ page }, info) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const preview = await tool("jumpstart_preview_model", {
    editorId, expectedRevision: before.revision, includeImage: false,
    plan: { name: "M3 rod", operations: [{ id: "rod", type: "fastener", fastenerType: "rod", size: "M3", length: 5 }] },
  });
  expect(preview.valid).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  expect(preview.bodies[0].featureTree.mods[0]).toMatchObject({ t: "thread", pitch: 0.5 });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  const saved = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(saved.bodies[0].featureTree.mods[0]).toMatchObject({ t: "thread", pitch: 0.5 });
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect(errors).toEqual([]);
});
