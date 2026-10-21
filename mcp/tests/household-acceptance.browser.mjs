import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0, generatedExport;

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

test.afterEach(async () => {
  if (!generatedExport) return;
  await unlink(generatedExport).catch((error) => { if (error.code !== "ENOENT") throw error; });
  generatedExport = undefined;
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

const fixtures = [
  {
    name: "divided rounded organizer tray",
    plan: {
      name: "80 by 60 divided organizer",
      sketches: [
        { id: "outer", plane: "XY", origin: [0, 0, 0], profile: { type: "roundedRect", width: 80, height: 60, radius: 5 } },
        { id: "cavity", plane: "XY", origin: [0, 0, 2], profile: { type: "roundedRect", width: 76, height: 56, radius: 3 } },
        { id: "divider", plane: "XY", origin: [0, 0, 2], profile: { type: "polygon", points: [[-1, -28.1], [1, -28.1], [1, 28.1], [-1, 28.1]] } },
      ],
      features: [
        { id: "tray", type: "extrude", sketch: "outer", distance: 16 },
        { id: "cavity-cut", type: "extrude", sketch: "cavity", distance: 14, operation: "cut", target: "tray" },
        { id: "divider-wall", type: "extrude", sketch: "divider", distance: 14, operation: "join", target: "tray" },
      ],
    },
    assertGeometry(preview, body) {
      expect(body.dimensions.x).toBeCloseTo(80, 2);
      expect(body.dimensions.y).toBeCloseTo(60, 2);
      expect(body.dimensions.z).toBeCloseTo(16, 2);
      const outerArea = 80 * 60 - (4 - Math.PI) * 25;
      const cavityArea = 76 * 56 - (4 - Math.PI) * 9;
      const expectedVolume = outerArea * 16 - cavityArea * 14 + 2 * 56 * 14;
      expect(body.volume).toBeGreaterThan(expectedVolume - 12);
      expect(body.volume).toBeLessThan(expectedVolume + 12);
      expect(body.featureTree.mods.map((mod) => mod.t)).toEqual(expect.arrayContaining(["bool", "bool"]));
      expect(preview.bodies).toHaveLength(1);
    },
    async assertInspection(inspection) {
      expect(inspection.meshValidation.valid).toBe(true);
      expect(inspection.meshValidation.bounds.dimensions[0]).toBeCloseTo(80, 2);
      expect(inspection.meshValidation.bounds.dimensions[1]).toBeCloseTo(60, 2);
      expect(inspection.checks).toEqual([expect.objectContaining({
        id: "compartments", pass: true,
        measured: expect.objectContaining({ count: 2, width: expect.closeTo(37, 1), depth: expect.closeTo(14, 1), floor: expect.closeTo(2, 1), spacing: expect.closeTo(39, 1), symmetric: true }),
      })]);
      expect(inspection.checks[0].measured.width + inspection.checks[0].measured.spacing).toBeCloseTo(76, 1);
    },
    inspectionArgs() {
      return { checks: [{ id: "compartments", kind: "channels", axis: "X", crossAt: 0, tolerance: 0.1, expected: { count: 2, width: 37, depth: 14, floor: 2, spacing: 39, symmetric: true, openEnds: false } }] };
    },
    assertSaved(document) {
      expect(document.sketches).toHaveLength(3);
      expect(document.bodies[0].featureTree.mods.map((mod) => mod.t)).toEqual(expect.arrayContaining(["bool", "bool"]));
      expect(document.bodies[0].dimensions).toMatchObject({ x: 80, y: 60, z: 16 });
      expect(document.bodies[0].volume).toBeGreaterThan(0);
    },
  },
  {
    name: "curved swept hook and hollow cable guide",
    plan: {
      name: "Curved hook and cable guide",
      sketches: [
        { id: "hook-profile", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 2 } },
        { id: "hook-path", plane: "XZ", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 18] }, { type: "line", start: [0, 18], end: [12, 18] }] },
        { id: "guide-path", plane: "XZ", origin: [30, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 10] }, { type: "arc", start: [0, 10], through: [5, 15], end: [10, 10] }] },
      ],
      features: [
        { id: "hook", type: "sweep", sketch: "hook-profile", path: "hook-path" },
        { id: "guide", type: "pipe", path: "guide-path", section: "circle", size: 8, hollow: true, wall: 1 },
      ],
    },
    assertGeometry(preview) {
      expect(preview.bodies).toHaveLength(2);
      const [hook, guide] = preview.bodies;
      expect(hook.volume).toBeCloseTo(120 * Math.PI, 1);
      expect(hook.dimensions.x).toBeCloseTo(14, 1);
      expect(hook.dimensions.z).toBeGreaterThan(19);
      expect(guide.volume).toBeGreaterThan(500);
      expect(guide.volume).toBeLessThan(900);
      expect(guide.dimensions.x).toBeGreaterThan(17);
      expect(guide.featureTree).toMatchObject({ t: "pipe", section: "circle", hollow: true, wall: 1 });
    },
    async assertInspection(inspection, body, index) {
      expect(inspection.meshValidation.valid).toBe(true);
      expect(inspection.meshValidation.bounds.dimensions[0]).toBeCloseTo(body.dimensions.x, 2);
      expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);
      const intervals = inspection.samples[0].intervals;
      expect(intervals).toHaveLength(index === 0 ? 1 : 2);
      const expectedThickness = index === 0 ? 4 : 1;
      for (const [start, end] of intervals) expect(end - start).toBeCloseTo(expectedThickness, 1);
    },
    inspectionArgs(_body, index) {
      return { samples: [index === 0 ? { axis: "Y", point: [0, 0, 9] } : { axis: "Y", point: [30, 0, 5] }] };
    },
    assertSaved(document, preview) {
      const hook = document.bodies.find((body) => body.featureTree.t === "sweep");
      const guide = document.bodies.find((body) => body.featureTree.t === "pipe");
      expect(hook).toBeDefined();
      expect(guide).toBeDefined();
      expect(hook.featureTree.path.ents.length).toBe(2);
      expect(hook.dimensions.x).toBeCloseTo(preview.bodies[0].dimensions.x, 2);
      expect(hook.dimensions.z).toBeCloseTo(preview.bodies[0].dimensions.z, 2);
      expect(hook.volume).toBeCloseTo(preview.bodies[0].volume, 1);
      expect(guide.dimensions.x).toBeCloseTo(preview.bodies[1].dimensions.x, 2);
      expect(guide.volume).toBeCloseTo(preview.bodies[1].volume, 1);
    },
  },
  {
    name: "mirrored slotted wall bracket pair",
    plan: {
      name: "Mirrored slotted wall brackets",
      primitives: [{ id: "bracket", kind: "box", parameters: { w: 40, d: 24, h: 6 }, position: [22, 0, 0] }],
      operations: [
        { id: "mount-slots", type: "holePattern", target: "bracket", face: "+z", layout: { type: "grid", cols: 2, rows: 1, pitch: [16, 12], margin: 6 }, shape: "slot", width: 4, length: 10 },
        { id: "opposite-bracket", type: "mirror", source: "bracket", plane: { origin: [0, 0, 0], normal: [1, 0, 0] } },
      ],
    },
    assertGeometry(preview) {
      expect(preview.bodies).toHaveLength(2);
      const [first, second] = preview.bodies;
      expect(first.dimensions.x).toBeCloseTo(40, 2);
      expect(first.dimensions.z).toBeCloseTo(6, 2);
      expect(second.dimensions.x).toBeCloseTo(40, 2);
      expect(second.dimensions.z).toBeCloseTo(6, 2);
      expect(Math.abs(first.bounds.center[0])).toBeCloseTo(Math.abs(second.bounds.center[0]), 2);
      expect(first.bounds.center[0] * second.bounds.center[0]).toBeLessThan(0);
      expect(first.volume).toBeCloseTo(second.volume, 2);
      expect(first.volume).toBeLessThan(40 * 24 * 6);
      expect(preview.holePatterns).toEqual([expect.objectContaining({ shape: "slot", total: 2 })]);
      expect(second.featureTree).toMatchObject({ t: "mirror", plane: { n: [1, 0, 0] } });
    },
    async assertInspection(inspection, body) {
      expect(inspection.meshValidation.valid).toBe(true);
      expect(inspection.meshValidation.bounds.dimensions[2]).toBeCloseTo(body.dimensions.z, 2);
    },
    assertSaved(document, preview) {
      expect(document.bodies).toHaveLength(2);
      const mirrored = document.bodies.find((body) => body.featureTree.t === "mirror");
      expect(mirrored).toBeDefined();
      expect(document.sketches.some((sketch) => sketch.name.includes("mount-slots"))).toBe(true);
      for (const [index, body] of document.bodies.entries()) {
        expect(body.dimensions.x).toBeCloseTo(40, 2);
        expect(body.dimensions.z).toBeCloseTo(6, 2);
        expect(body.volume).toBeCloseTo(preview.bodies[index].volume, 1);
      }
      expect(document.bodies[0].bounds.center[0] + document.bodies[1].bounds.center[0]).toBeCloseTo(0, 2);
    },
  },
  {
    name: "hollow cylindrical cup cover",
    plan: {
      name: "Hollow 40 by 40 cup",
      primitives: [{ id: "cup", kind: "cylinder", parameters: { w: 40, d: 40, h: 40 } }],
      sketches: [{ id: "inside", plane: "XY", origin: [0, 0, 2], profile: { type: "circle", center: [0, 0], radius: 18 } }],
      features: [{ id: "cup-cavity", type: "extrude", sketch: "inside", distance: 38, operation: "cut", target: "cup" }],
    },
    assertGeometry(preview, body) {
      expect(body.dimensions.x).toBeCloseTo(40, 2);
      expect(body.dimensions.y).toBeCloseTo(40, 2);
      expect(body.dimensions.z).toBeCloseTo(40, 2);
      const expectedVolume = Math.PI * 20 ** 2 * 40 - Math.PI * 18 ** 2 * 38;
      expect(body.volume).toBeGreaterThan(expectedVolume * 0.97);
      expect(body.volume).toBeLessThan(expectedVolume * 1.03);
      expect(body.featureTree.mods).toEqual(expect.arrayContaining([expect.objectContaining({ t: "bool", op: "cut" })]));
    },
    async assertInspection(inspection, body) {
      expect(inspection.meshValidation.valid).toBe(true);
      for (const dimension of inspection.meshValidation.bounds.dimensions) expect(Math.abs(dimension - 40)).toBeLessThan(0.05);
      expect(inspection.section.segments.length).toBeGreaterThan(0);
      expect(inspection.samples[0].intervals).toHaveLength(2);
      expect(inspection.samples[0].intervals[0][1] - inspection.samples[0].intervals[0][0]).toBeCloseTo(2, 1);
      expect(inspection.samples[0].intervals[1][1] - inspection.samples[0].intervals[1][0]).toBeCloseTo(2, 1);
      expect(body.volume).toBeGreaterThan(0);
    },
    inspectionArgs() {
      return { section: { axis: "X", offset: 0 }, samples: [{ axis: "X", point: [0, 0, 20] }] };
    },
    assertSaved(document) {
      expect(document.bodies[0].featureTree.mods).toEqual(expect.arrayContaining([expect.objectContaining({ t: "bool", op: "cut" })]));
      expect(document.bodies[0].dimensions).toMatchObject({ x: 40, y: 40, z: 40 });
      expect(document.bodies[0].volume).toBeGreaterThan(0);
    },
  },
];

for (const fixture of fixtures) {
  test(`${fixture.name}: preview, inspect, apply, persist native features, and undo`, async ({ page }) => {
    const errors = watchErrors(page);
    const editorId = await editor(page);
    const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
    const before = await get();
    const originalDocument = await page.evaluate(() => JSON.stringify(window.__store.doc));
    const args = { editorId, expectedRevision: before.revision, plan: fixture.plan, includeImage: false };
    const preview = await tool("jumpstart_preview_model", args);
    const stale = await tool("jumpstart_preview_model", args);
    expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
    expect(preview.bodies.length).toBeGreaterThan(0);
    for (const body of preview.bodies) {
      expect(body.volume).toBeGreaterThan(0);
      expect(Object.values(body.dimensions).every((dimension) => dimension > 0)).toBe(true);
    }
    fixture.assertGeometry(preview, preview.bodies[0]);
    expect((await get()).revision).toBe(before.revision);
    expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(originalDocument);

    for (const [index, body] of preview.bodies.entries()) {
      const inspection = await tool("jumpstart_inspect_geometry", {
        editorId, bodyId: body.id, previewId: preview.previewId, mesh: true,
        ...(fixture.inspectionArgs?.(body, index) || {}),
      });
      await fixture.assertInspection(inspection, body, index);
    }

    const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
    expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
    expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
    let saved = await get();
    expect(saved.revision).toBe(applied.revision);
    fixture.assertSaved(saved, preview);

    await tool("jumpstart_save_document", { editorId, expectedRevision: saved.revision });
    await tool("jumpstart_reopen_document", { editorId, expectedRevision: saved.revision, documentId: saved.document.id });
    saved = await get();
    fixture.assertSaved(saved, preview);
    const exported = await tool("jumpstart_export_model", { editorId, format: "stl", name: `household-${process.pid}-${Date.now()}` });
    generatedExport = exported.path;
    expect(exported.format).toBe("stl");
    expect(exported.byteLength).toBeGreaterThan(84);
    expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.meshValidation.valid).toBe(true);
    expect(exported.physicalFit).toBe("unverified");

    await tool("jumpstart_undo", { editorId, expectedRevision: saved.revision });
    expect((await get()).bodies).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}
