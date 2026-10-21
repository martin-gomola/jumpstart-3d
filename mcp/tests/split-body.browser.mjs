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

test("split preview is read-only, returns two inspected native bodies, applies once and undoes", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Split storage block",
    primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 10, h: 8 }, position: [5, 0, 0] }],
    operations: [{ id: "halves", type: "splitBody", target: "block", plane: { origin: [5, 0, 0], normal: [4, 0, 0] } }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(2);
  for (const body of preview.bodies) expect(body.volume).toBeCloseTo(800, 2);
  expect(preview.bodies.every((body) => body.featureTree.mods.at(-1).t === "halfspace")).toBe(true);
  expect(preview.bodies.map((body) => body.featureTree.mods.at(-1).side).sort()).toEqual([-1, 1]);
  expect((await get()).revision).toBe(before.revision);
  for (const body of preview.bodies) {
    const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: body.id, previewId: preview.previewId, mesh: true });
    expect(inspection.meshValidation.valid).toBe(true);
    expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);
  }
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.bodies).toHaveLength(2);
  const original = saved.bodies.find((body) => body.id === preview.bodies.find((item) => item.featureTree.mods.at(-1).side === 1).id);
  expect(original).toBeTruthy();
  expect(original.name).toBe("box");
  expect(saved.bodies.map((body) => body.id).sort()).toEqual(preview.bodies.map((body) => body.id).sort());
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("split rejects invalid targets and normals and reports empty halfspaces", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const base = { name: "Invalid split", primitives: [{ id: "block", kind: "box" }] };
  const zero = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...base, operations: [{ id: "halves", type: "splitBody", target: "block", plane: { origin: [0, 0, 0], normal: [0, 0, 0] } }] } }, true);
  expect(zero.error).toMatch(/normal must not be zero/);
  const missingOrigin = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...base, operations: [{ id: "halves", type: "splitBody", target: "block", plane: { normal: [0, 0, 1] } }] } }, true);
  expect(missingOrigin.error).toMatch(/allowed input shape/);
  const missingTarget = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...base, operations: [{ id: "halves", type: "splitBody", target: "missing", plane: { origin: [0, 0, 0], normal: [0, 0, 1] } }] } }, true);
  expect(missingTarget.error).toMatch(/unknown or later body/);
  const empty = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...base, operations: [{ id: "halves", type: "splitBody", target: "block", plane: { origin: [0, 0, 10000], normal: [0, 0, 1] } }] } });
  expect(empty.valid).toBe(false);
  expect(JSON.stringify(empty.errors)).toMatch(/nothing of the body is on this side/);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
