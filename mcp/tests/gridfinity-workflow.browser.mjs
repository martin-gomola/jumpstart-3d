import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import { parseSTL } from "../../src/meshimport.js";
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

const pocket = (id, profile, position, extra = {}) => ({ id, type: "pocket", target: "insert", profile, position, depth: 8, clearance: 0.3, minimumFloor: 2, minimumWall: 1.2, ...extra });
const insertPlan = () => ({
  name: "Editable Gridfinity cutout insert", modelId: "gridfinity-demo",
  parameters: { pocketDepth: { value: 8, unit: "mm", min: 5, max: 10 } },
  operations: [
    { id: "baseplate", type: "gridfinity", kind: "baseplate", columns: 2, rows: 3 },
    { id: "insert", type: "gridfinity", kind: "insert", columns: 2, rows: 3, heightUnits: 3, floor: 2, wall: 1.2, lip: false, position: [0, 0, 0.25] },
    pocket("tool-pocket", { type: "roundedRect", width: 20, height: 30, radius: 3 }, [-15, -20], { depth: { $expr: "pocketDepth" } }),
    pocket("round-pocket", { type: "circle", radius: 8 }, [15, 25]),
    pocket("finger-access", { type: "capsule", length: 25, width: 10 }, [-15, -5], { depth: 5, merge: true }),
  ],
});

function sampleGap(sample) {
  expect(sample.ambiguous).toBe(false);
  expect(sample.intervals).toHaveLength(2);
  return sample.intervals[1][0] - sample.intervals[0][1];
}

test("Gridfinity insert pockets inspect actual geometry, preserve references and remain editable through save, revise and undo", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page), editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const referencePreview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: {
    name: "Preserved reference object", primitives: [{ id: "object", name: "Measured object envelope", kind: "box", parameters: { w: 20, d: 30, h: 8 }, position: [160, 0, 0] }],
    operations: [{ id: "reference", type: "setRole", target: "object", role: "reference" }],
  } });
  expect(referencePreview.valid).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: referencePreview.previewId });
  const withReference = await get(), reference = withReference.bodies[0];
  const requirements = {
    bodyCount: 3, preserveBodyIds: [reference.id],
    bodies: [
      { target: "insert", checks: [{ id: "width", kind: "dimension", axis: "X", expected: 83.5, tolerance: 0.01 }, { id: "depth", kind: "dimension", axis: "Y", expected: 125.5, tolerance: 0.01 }, { id: "height", kind: "dimension", axis: "Z", expected: 21, tolerance: 0.01 }, { id: "connected", kind: "components", expected: 1 }] },
      { target: "baseplate", checks: [{ id: "width", kind: "dimension", axis: "X", expected: 84, tolerance: 0.01 }, { id: "depth", kind: "dimension", axis: "Y", expected: 126, tolerance: 0.01 }, { id: "connected", kind: "components", expected: 1 }] },
    ],
    pairs: [{ id: "interface", a: "insert", b: "baseplate", maximumOverlapVolume: 0.001 }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: withReference.revision, plan: insertPlan(), requirements, includeImage: false });
  expect(preview.valid, JSON.stringify(preview)).toBe(true);
  expect(preview.acceptance.status).toBe("passed");
  expect(preview.acceptance.pairs[0].status).toBe("measured");
  expect(preview.acceptance.pairs[0].overlapVolumeMm3).toBeLessThanOrEqual(0.001);
  expect((await get()).bodies).toEqual(withReference.bodies);
  const insert = preview.bodies.find(body => Math.abs(body.dimensions.x - 83.5) < 0.01);
  const baseplate = preview.bodies.find(body => Math.abs(body.dimensions.x - 84) < 0.01);
  expect(insert.featureTree.t).toBe("group");
  expect(JSON.stringify(insert.featureTree)).not.toContain('"t":"mesh"');
  expect(JSON.stringify(insert.featureTree)).toContain('"sketch":');
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, previewId: preview.previewId, bodyId: insert.id, mesh: true, samples: [
    { axis: "X", point: [0, -25, 17] },
    { axis: "X", point: [0, 25, 17] },
    { axis: "Z", point: [-15, -25, 0] },
  ] });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.disconnectedComponents).toBe(1);
  expect(sampleGap(inspection.samples[0])).toBeCloseTo(20.6, 1);
  expect(sampleGap(inspection.samples[1])).toBeCloseTo(16.6, 1);
  expect(inspection.samples[2].ambiguous).toBe(false);
  expect(inspection.samples[2].intervals.at(-1)[1]).toBeCloseTo(13.25, 2);
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: withReference.revision, plan: insertPlan(), requirements, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const current = await get();
  expect(current.bodies.find(body => body.id === reference.id)).toEqual(reference);
  const revised = await tool("jumpstart_preview_parameters", { editorId, expectedRevision: current.revision, modelId: "gridfinity-demo", values: { pocketDepth: 9 }, includeImage: false });
  expect(revised.valid, JSON.stringify(revised)).toBe(true);
  const revisedInspection = await tool("jumpstart_inspect_geometry", { editorId, previewId: revised.previewId, bodyId: insert.id, mesh: true, samples: [{ axis: "Z", point: [-15, -25, 0] }] });
  expect(revisedInspection.samples[0].intervals.at(-1)[1]).toBeCloseTo(12.25, 2);
  const revisionApplied = await tool("jumpstart_apply_model", { editorId, previewId: revised.previewId });
  const saved = await get();
  expect(saved.bodies.map(body => body.id)).toContain(insert.id);
  expect(saved.bodies.map(body => body.id)).toContain(baseplate.id);
  await tool("jumpstart_save_document", { editorId, expectedRevision: saved.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: saved.revision, documentId: saved.document.id });
  const reopened = await get();
  expect(reopened.parametricModels.find(model => model.id === "gridfinity-demo").parameters.pocketDepth.value).toBe(9);
  expect(reopened.bodies.find(body => body.id === reference.id)).toEqual(reference);
  const exported = await tool("jumpstart_export_model", { editorId, format: "stl", name: `gridfinity-acceptance-${process.pid}-${Date.now()}`, bodyIds: [insert.id] });
  try {
    expect(exported.bodyIds).toEqual([insert.id]);
    expect(exported.roles).toEqual([{ id: insert.id, role: "design" }]);
    const mesh = parseSTL(Uint8Array.from(await readFile(exported.path)).buffer);
    const xs = Array.from(mesh.V).filter((_, index) => index % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-41.75, 2);
    expect(Math.max(...xs)).toBeCloseTo(41.75, 2);
  } finally { await unlink(exported.path).catch(() => {}); }
  const undoneRevision = await tool("jumpstart_undo", { editorId, expectedRevision: reopened.revision });
  const restored = await get();
  expect(restored.parametricModels.find(model => model.id === "gridfinity-demo").parameters.pocketDepth.value).toBe(8);
  await tool("jumpstart_undo", { editorId, expectedRevision: undoneRevision.revision });
  expect((await get()).bodies).toEqual(withReference.bodies);
  expect(revisionApplied.revision).not.toBe(applied.revision);
  expect(errors).toEqual([]);
});

test("Gridfinity discovery and failed pockets report actionable errors without changing the document", async ({ page }) => {
  const editorId = await editor(page), get = () => tool("jumpstart_get_document", { editorId });
  const before = await get();
  const discovery = await tool("jumpstart_get_capabilities", { operationTypes: ["gridfinity", "pocket"] });
  const variants = discovery.toolSchemas.find(tool => tool.name === "jumpstart_preview_model").inputSchema.properties.plan.properties.operations.items.oneOf;
  expect(variants.map(variant => variant.properties.type.const)).toEqual(expect.arrayContaining(["gridfinity", "pocket"]));
  expect(variants).toHaveLength(2);
  const invalidOperations = [
    { id: "insert", type: "gridfinity", kind: "insert", columns: 0, rows: 3 },
    { id: "insert", type: "gridfinity", kind: "insert", columns: 5, rows: 3 },
    pocket("too-deep", { type: "circle", radius: 8 }, [0, 0], { depth: 13, minimumFloor: 2 }),
    pocket("too-wide", { type: "circle", radius: 50 }, [0, 0]),
    pocket("unsupported", { type: "mesh", bodyId: "reference" }, [0, 0]),
  ];
  for (const operation of invalidOperations) {
    const operations = operation.type === "gridfinity" ? [operation] : [{ id: "insert", type: "gridfinity", kind: "insert", columns: 2, rows: 3 }, operation];
    const result = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: { name: "Invalid Gridfinity request", operations } }, true);
    expect(result.error).toBeTruthy();
    expect(result.guidance.nextChecks.length).toBeGreaterThan(0);
    expect((await get()).revision).toBe(before.revision);
    expect((await get()).bodies).toEqual(before.bodies);
  }
});
