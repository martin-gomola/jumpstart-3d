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

test("feature pattern copies inspected native holes through preview, apply, stale checks, and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const base = {
    name: "Vent plate",
    primitives: [{ id: "plate", kind: "box", parameters: { w: 20, d: 10, h: 8 } }],
    operations: [{ id: "first-hole", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 1, rows: 1 }, hole: { diameter: 2 } }],
  };
  const oneHole = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: base, includeImage: false });
  expect(oneHole.valid, JSON.stringify(oneHole.errors)).toBe(true);
  const baselineVolume = oneHole.bodies[0].volume;
  const plan = { ...base, operations: [...base.operations, { id: "vents", type: "featurePattern", target: "plate", features: ["first-hole"], mode: "linear", axis: "X", count: 2, spacing: 6, symmetric: true }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.featurePatterns).toEqual([{ id: "vents", bodyId: preview.bodies[0].id, sourceFeatures: ["first-hole"], instances: 3, featureCopies: 2 }]);
  expect(preview.bodies[0].featureTree.mods.filter((mod) => mod.t === "hole")).toHaveLength(3);
  expect(preview.bodies[0].volume).toBeLessThan(baselineVolume - 15);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  expect((await get()).bodies[0].featureTree.mods.filter((mod) => mod.t === "hole")).toHaveLength(3);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("circular feature patterns rotate sketch-backed cut tools and reject invalid references or limits", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const plan = {
    name: "Four bores",
    primitives: [{ id: "plate", kind: "box", parameters: { w: 24, d: 24, h: 8 } }],
    sketches: [{ id: "bore", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [8, 0], radius: 1 } }],
    features: [{ id: "bore-cut", type: "extrude", sketch: "bore", distance: 8, operation: "cut", target: "plate" }],
    operations: [{ id: "bore-ring", type: "featurePattern", target: "plate", features: ["bore-cut"], mode: "circular", axis: "Z", count: 4, origin: [0, 0, 0] }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  const cuts = preview.bodies[0].featureTree.mods.filter((mod) => mod.t === "bool");
  expect(cuts).toHaveLength(4);
  const orientations = cuts.map((mod) => [mod.m[0], mod.m[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  expect(orientations[0][0]).toBeCloseTo(-1, 5);
  expect(orientations[1][1]).toBeCloseTo(-1, 5);
  expect(orientations[2][1]).toBeCloseTo(1, 5);
  expect(orientations[3][0]).toBeCloseTo(1, 5);
  expect(preview.bodies[0].volume).toBeLessThan(24 * 24 * 8);
  const invalidRef = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...plan, operations: [{ ...plan.operations[0], features: ["missing"] }] } }, true);
  expect(invalidRef.error).toMatch(/references unknown feature/);
  const invalidType = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...plan, operations: [{ ...plan.operations[0], features: ["unsupported"] }], features: [{ id: "unsupported", type: "extrude", sketch: "bore", distance: 8, operation: "cut", target: "plate", pattern: { axis: "Z", count: 3 } }] } }, true);
  expect(invalidType.error).toMatch(/unsupported feature type bool/);
  const tooMany = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { ...plan, operations: [{ ...plan.operations[0], count: 13 }] } }, true);
  expect(tooMany.error).toMatch(/does not match an allowed input shape/);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
