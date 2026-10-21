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

test("planar offset uses a face signature and preserves preview/apply transaction guarantees", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  let document = await get();
  const base = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, includeImage: false, plan: { name: "Offset block", primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 20, h: 10 } }] } });
  expect(base.valid, JSON.stringify(base.errors)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: base.previewId });
  document = await get();
  const body = document.bodies[0];
  const face = body.geometrySelectors.faces.find(({ t, n }) => t === "PLANE" && n?.[2] > 0.999);
  expect(face).toBeTruthy();
  const plan = { name: "Offset block", operations: [{ id: "press-pull", type: "modifier", target: body.id, modifier: { type: "offset", distance: -2, faces: [{ c: face.c, t: face.t, n: face.n }] } }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies[0].volume).toBeLessThan(body.volume);
  expect(preview.bodies[0].featureTree.mods[0]).toMatchObject({ t: "offset", d: -2, faces: [{ c: face.c, t: "PLANE", n: face.n }] });
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: body.id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect((await get()).revision).toBe(document.revision);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies[0].volume).toBeCloseTo(body.volume, 5);
  expect(errors).toEqual([]);
});

test("cylindrical offset adds material while stale or invalid face signatures fail", async ({ page }) => {
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  let document = await get();
  const base = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, includeImage: false, plan: { name: "Offset cylinder", primitives: [{ id: "cylinder", kind: "cylinder", parameters: { w: 20, d: 20, h: 20 } }] } });
  expect(base.valid, JSON.stringify(base.errors)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: base.previewId });
  document = await get();
  const body = document.bodies[0];
  const face = body.geometrySelectors.faces.find(({ t }) => t === "CYLINDRE");
  expect(face).toBeTruthy();
  const plan = { name: "Offset cylinder", operations: [{ id: "press-pull", type: "modifier", target: body.id, modifier: { type: "offset", distance: 1, faces: [{ c: face.c, t: face.t }] } }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies[0].volume).toBeGreaterThan(body.volume);
  expect((await tool("jumpstart_inspect_geometry", { editorId, bodyId: body.id, previewId: preview.previewId, mesh: true })).meshValidation.valid).toBe(true);
  expect((await get()).revision).toBe(document.revision);

  const wrongFace = { ...plan, operations: [{ ...plan.operations[0], modifier: { ...plan.operations[0].modifier, faces: [{ c: [1000, 1000, 1000], t: "CYLINDRE" }] } }] };
  const invalid = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: wrongFace, includeImage: false });
  expect(invalid.valid).toBe(false);
  expect(invalid.errors).toEqual([expect.objectContaining({ error: expect.stringMatching(/picked face no longer exists/) })]);
  expect((await get()).revision).toBe(document.revision);
  const zero = { ...plan, operations: [{ ...plan.operations[0], modifier: { ...plan.operations[0].modifier, distance: 0 } }] };
  expect((await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan: zero, includeImage: false }, true)).error).toMatch(/oneOf|schema|distance|allowed input shape/i);

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies[0].volume).toBeCloseTo(body.volume, 5);
});

test("offset rejects a face signature that matches multiple distinct cylindrical surfaces", async ({ page }) => {
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  let document = await get();
  const base = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, includeImage: false, plan: { name: "Tube", primitives: [{ id: "tube", kind: "tube", parameters: { w: 20, d: 20, h: 20, wall: 0.1 } }] } });
  expect(base.valid, JSON.stringify(base.errors)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: base.previewId });
  document = await get();
  const body = document.bodies[0];
  const cylindricalFaces = body.geometrySelectors.faces.filter(({ t }) => t === "CYLINDRE");
  expect(cylindricalFaces.length).toBeGreaterThan(1);
  const pairs = cylindricalFaces.flatMap((a, i) => cylindricalFaces.slice(i + 1).map((b) => ({ a, b, distance: Math.hypot(...a.c.map((value, axis) => value - b.c[axis])) })));
  pairs.sort((a, b) => a.distance - b.distance);
  expect(pairs[0].distance).toBeLessThan(0.1);
  const center = pairs[0].a.c.map((value, axis) => (value + pairs[0].b.c[axis]) / 2);
  const plan = { name: "Ambiguous tube", operations: [{ id: "press-pull", type: "modifier", target: body.id, modifier: { type: "offset", distance: 1, faces: [{ c: center, t: "CYLINDRE" }] } }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: document.revision, plan, includeImage: false });
  expect(preview.valid).toBe(false);
  expect(preview.errors).toEqual([expect.objectContaining({ error: expect.stringMatching(/signature is ambiguous/) })]);
  expect((await get()).revision).toBe(document.revision);
});
