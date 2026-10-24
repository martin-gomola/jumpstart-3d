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


test("capability discovery returns compact or focused schemas without changing the full catalog", async () => {
  const full = await tool("jumpstart_get_capabilities");
  const compact = await tool("jumpstart_get_capabilities", { includeSchemas: false });
  expect(compact.toolSchemas).toBeUndefined();
  expect(compact.availableTools).toHaveLength(full.toolSchemas.length);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
  const focused = await tool("jumpstart_get_capabilities", { toolNames: ["jumpstart_preview_model"], operationTypes: ["knurl"] });
  expect(focused.toolSchemas).toHaveLength(1);
  expect(focused.toolSchemas[0].inputSchema.properties.plan.properties.operations.items.oneOf.map((entry) => entry.properties.type.const)).toEqual(["knurl"]);
  const again = await tool("jumpstart_get_capabilities");
  expect(again.toolSchemas).toEqual(full.toolSchemas);
  expect(full.toolSchemas.filter(({ name }) => name.startsWith("jumpstart_preview_")).every((entry) => entry.inputSchema.properties.requirements)).toBe(true);
  expect((await tool("jumpstart_get_capabilities", { toolNames: ["nonexistent"] }, true)).error).toMatch(/Unknown capability/);
});

test("focused document reads and immutable acceptance checks preserve unrelated geometry through preview, apply, stale checks and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = (options = {}) => tool("jumpstart_get_document", { editorId, includeGeometry: true, ...options });
  const before = await get();
  const plan = {
    name: "Bracket and preserved reference",
    sketches: [
      { id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[-20,-10],[20,-10],[20,10],[-20,10]] } },
      { id: "reference-outline", plane: "XY", origin: [80, 0, 0], profile: { type: "circle", center: [0, 0], radius: 5 } },
    ],
    features: [{ id: "edit", type: "extrude", sketch: "outline", distance: 6 }, { id: "keep", type: "extrude", sketch: "reference-outline", distance: 3 }],
  };
  const requirements = { bodyCount: 2, bodies: [{ target: "edit", checks: [{ id: "width", kind: "dimension", axis: "X", expected: 40, tolerance: 0.01 }, { id: "connected", kind: "components", expected: 1 }] }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, requirements, includeImage: false });
  expect(preview.valid, JSON.stringify(preview)).toBe(true);
  expect(preview.acceptance.status).toBe("passed");
  expect(preview.changes.added).toHaveLength(2);
  expect((await get()).revision).toBe(before.revision);
  expect((await get()).bodies).toHaveLength(0);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  const document = await get();
  const [edit, kept] = document.bodies;
  const focused = await get({ bodyIds: [edit.id], includeSelectors: false, includeFeatureTree: false });
  expect(focused.bodies).toHaveLength(1);
  expect(focused.bodies[0].geometrySelectors).toBeUndefined();
  expect(focused.bodies[0].featureTree).toBeUndefined();
  expect(focused.sketches).toHaveLength(1);
  expect(focused.sketches[0].id).toBe(edit.featureTree.sketch);
  expect(focused.selection).toEqual({ bodyIds: [edit.id], totalBodies: 2, returnedBodies: 1 });
  expect((await get({ bodyIds: [edit.id], includeSketches: false })).sketches).toHaveLength(0);
  expect((await tool("jumpstart_get_document", { editorId, bodyIds: ["missing"] }, true)).error).toMatch(/existing body ids/);

  const move = { name: "Move only the bracket", operations: [{ id: "moved", type: "transform", target: edit.id, position: [10, 0, 0] }] };
  const validRequirements = { bodyCount: 2, preserveBodyIds: [kept.id], bodies: [{ target: "moved", checks: [{ id: "position", kind: "bound", axis: "X", side: "max", expected: 30, tolerance: 0.01 }] }] };
  const moved = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: move, requirements: validRequirements, includeImage: false });
  expect(moved.valid, JSON.stringify(moved)).toBe(true);
  expect(moved.changes.changed).toEqual([edit.id]);
  expect(moved.changes.unchanged).toContain(kept.id);
  expect(moved.changes.measurements[0].dimensionsDelta.x).toBeCloseTo(0, 3);
  expect(moved.changes.measurements[0].volumeDelta).toBeCloseTo(0, 3);
  expect(moved.changes.measurements[0].after.bounds.max[0]).toBeCloseTo(30, 3);
  expect((await get()).bodies).toEqual(document.bodies);

  const preserved = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: move, requirements: { preserveBodyIds: [edit.id] }, includeImage: false });
  expect(preserved.valid).toBe(false);
  expect(preserved.acceptance.checks[0]).toMatchObject({ kind: "sourcePreservation", pass: false });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preserved.previewId }, true)).guidance.category).toBe("acceptance");

  const wrong = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: move, requirements: { bodies: [{ target: "moved", checks: [{ id: "width", kind: "dimension", axis: "X", expected: 80, tolerance: 0.01 }] }] }, includeImage: false });
  expect(wrong.valid).toBe(false);
  expect(wrong.acceptance.status).toBe("failed");
  const spotCheck = await tool("jumpstart_inspect_geometry", { editorId, previewId: wrong.previewId, bodyId: edit.id, checks: [{ id: "width", kind: "dimension", axis: "X", expected: 40, tolerance: 0.01 }] });
  expect(spotCheck.checks[0].pass).toBe(true);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: wrong.previewId }, true)).error).toMatch(/requirements did not pass/);

  const unknown = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: move, requirements: { bodies: [{ target: "moved", checks: [{ id: "channels", kind: "channels", axis: "Y", crossAt: 100, expected: { count: 2 } }] }] }, includeImage: false });
  expect(unknown.valid).toBe(false);
  expect(unknown.acceptance.status).toBe("unknown");
  expect((await tool("jumpstart_apply_model", { editorId, previewId: unknown.previewId }, true)).error).toMatch(/requirements did not pass/);
  const invalid = await tool("jumpstart_preview_model", { editorId, plan: move, requirements: { bodies: [{ target: "moved", checks: [{ id: "unsafe", kind: "script", expected: 1 }] }] } }, true);
  expect(invalid.error).toMatch(/allowed input shape/);
  expect((await get()).bodies).toEqual(document.bodies);

  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: move, requirements: validRequirements, includeImage: false });
  const changed = await tool("jumpstart_apply_model", { editorId, previewId: moved.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).guidance.category).toBe("stale_state");
  expect((await get()).bodies.find(({ id }) => id === kept.id)).toEqual(kept);
  const undone = await tool("jumpstart_undo", { editorId, expectedRevision: changed.revision });
  await tool("jumpstart_undo", { editorId, expectedRevision: undone.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("a disconnected grouped body fails a one-component acceptance requirement", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const plan = { name: "Two separated solids", primitives: [{ id: "left", kind: "box", parameters: { w: 10, d: 10, h: 10 } }, { id: "right", kind: "box", parameters: { w: 10, d: 10, h: 10 }, position: [30, 0, 0] }], operations: [{ id: "pair", type: "group", members: ["left", "right"] }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, requirements: { bodyCount: 1, bodies: [{ target: "pair", checks: [{ id: "connected", kind: "components", expected: 1 }] }] }, includeImage: false });
  expect(preview.valid).toBe(false);
  expect(preview.acceptance.checks.find(({ id }) => id === "connected")).toMatchObject({ pass: false, measured: 2 });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId }, true)).error).toMatch(/requirements did not pass/);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
