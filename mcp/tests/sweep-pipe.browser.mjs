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

test("bent sweep and hollow pipe preview as native editable features, inspect geometry, apply once and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Bent handle and tube",
    sketches: [
      { id: "handleProfile", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 2 } },
      { id: "handlePath", plane: "XZ", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 18] }, { type: "line", start: [0, 18], end: [12, 18] }] },
      { id: "pipePath", plane: "XZ", origin: [30, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 10] }, { type: "arc", start: [0, 10], through: [5, 15], end: [10, 10] }] },
    ],
    features: [
      { id: "handle", type: "sweep", sketch: "handleProfile", path: "handlePath" },
      { id: "pipe", type: "pipe", path: "pipePath", section: "circle", size: 8, hollow: true, wall: 1 },
    ],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(2);
  expect(preview.bodies.every((body) => body.volume > 0)).toBe(true);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  const pipeInspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[1].id, previewId: preview.previewId, mesh: true });
  expect(pipeInspection.meshValidation.valid).toBe(true);
  expect(pipeInspection.meshValidation.triangleCount).toBeGreaterThan(0);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.bodies).toHaveLength(2);
  expect(saved.bodies[0].featureTree).toMatchObject({ t: "sweep", path: { ents: expect.any(Array) } });
  expect(saved.bodies[1].featureTree).toMatchObject({ t: "pipe", section: "circle", hollow: true, wall: 1, path: { ents: expect.any(Array) } });
  expect(saved.bodies[1].volume).toBeGreaterThan(0);
  await tool("jumpstart_undo", { editorId, expectedRevision: saved.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});
