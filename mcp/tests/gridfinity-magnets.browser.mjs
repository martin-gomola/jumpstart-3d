import { test, expect } from "@playwright/test";
import { buildGridfinity, normalizeGridfinity } from "../browser/plans/gridfinity.js";
import { magnetCarrierHeight } from "../shared/gridfinity-magnets.js";
import { resolveGridfinityFixture } from "./gridfinity-test-helpers.mjs";
import { inspectGeometry } from "../browser/inspection/inspection.js";
import { boot, loadDoc, newDoc, body, IDENTITY, watchErrors } from "../../test/helpers.mjs";

function fixture(columns = 1, rows = 1, magnets = true) {
  const document = newDoc("Magnetic Gridfinity", "advanced"); let id = 0;
  for (const [index, [kind, options, position]] of [["baseplate", magnets, [0, 0, 0]], ["bin", magnets, [0, 0, magnetCarrierHeight(magnets) + 0.25]], ["bin", false, [250, 0, 0]]].entries()) {
    const op = normalizeGridfinity({ id: `part-${index}`, type: "gridfinity", kind, columns, rows, magnets: options });
    const result = buildGridfinity(op, { document, idFactory: p => `${p}-${++id}` });
    const m = IDENTITY.slice(); m[12] = position[0]; m[13] = position[1]; m[14] = position[2];
    document.bodies.push(body(`part-${index}`, kind, result.node, m, { mcpGridfinity: result.recipe }));
  }
  return document;
}

test("magnetic pockets have measured depth, retained floors, connected carriers and no seated-bin interference", async ({ page }, info) => {
  const errors = watchErrors(page), doc = fixture();
  await boot(page, info); await loadDoc(page, doc);
  const shapes = await page.evaluate(() => window.__store.doc.bodies.map(body => {
    const data = window.__app.scene.views.get(body.id)?.data;
    return { error: window.__app.scene.errors.get(body.id), volume: data?.volume, bounds: data?.bbox, vertices: Array.from(data?.vertices || []), triangles: Array.from(data?.triangles || []) };
  }));
  expect(shapes.every(shape => !shape.error), JSON.stringify(shapes.map(s => s.error))).toBe(true);
  expect(shapes[0].bounds.min[2]).toBeCloseTo(0, 5);
  expect(shapes[0].bounds.max[2]).toBeCloseTo(8.2, 4);
  expect(shapes[2].volume - shapes[1].volume).toBeCloseTo(4 * Math.PI * (6.5 / 2) ** 2 * 2.4, 3);
  const plate = inspectGeometry(shapes[0], { mesh: true, samples: [{ axis: "Z", point: [13, 13, -1] }, { axis: "X", point: [0, 13, 2] }] });
  expect(plate.meshValidation.valid).toBe(true);
  expect(plate.meshValidation.disconnectedComponents).toBe(1);
  expect(plate.samples[0].ambiguous).toBe(false);
  expect(plate.samples[0].intervals).toHaveLength(1);
  expect(plate.samples[0].intervals[0][0]).toBeCloseTo(0, 4);
  expect(plate.samples[0].intervals[0][1]).toBeCloseTo(0.8, 4);
  expect(plate.samples[1].intervals).toHaveLength(4);
  expect(plate.samples[1].intervals[1][0] - plate.samples[1].intervals[0][1]).toBeCloseTo(6.5, 1);
  const bin = inspectGeometry(shapes[1], { mesh: true, samples: [{ axis: "Z", point: [13, 13, -1] }] });
  expect(bin.meshValidation.valid).toBe(true);
  expect(bin.meshValidation.disconnectedComponents).toBe(1);
  expect(bin.samples[0].intervals[0][0]).toBeCloseTo(2.4, 4);
  expect(bin.samples[0].intervals[0][1]).toBeCloseTo(9, 4);
  const [fit] = await page.evaluate(pair => window.__app.kernel.inspectPairs([pair]), { id: "magnetic-fit", a: { node: resolveGridfinityFixture(doc.bodies[0].node, doc), m: doc.bodies[0].m }, b: { node: resolveGridfinityFixture(doc.bodies[1].node, doc), m: doc.bodies[1].m } });
  expect(fit.status, JSON.stringify(fit)).toBe("measured");
  expect(fit.overlapVolumeMm3).toBeCloseTo(0, 5);
  expect(errors).toEqual([]);
});

test("largest supported magnetic parts remain connected with custom fit sizes", async ({ page }, info) => {
  const errors = watchErrors(page), doc = fixture(4, 4, { diameter: 8, depth: 4 });
  await boot(page, info); const start = Date.now(); await loadDoc(page, doc);
  const measured = await page.evaluate(() => window.__store.doc.bodies.map(body => {
    const data = window.__app.scene.views.get(body.id)?.data;
    return { error: window.__app.scene.errors.get(body.id), volume: data?.volume, bounds: data?.bbox, vertices: Array.from(data?.vertices || []), triangles: Array.from(data?.triangles || []) };
  }));
  expect(measured.every(part => !part.error && part.volume > 0), JSON.stringify(measured.map(p => p.error))).toBe(true);
  for (const part of measured.slice(0, 2)) {
    const inspection = inspectGeometry(part, { mesh: true });
    expect(inspection.meshValidation.valid).toBe(true);
    expect(inspection.meshValidation.disconnectedComponents).toBe(1);
  }
  expect(measured[0].bounds.max[2]).toBeCloseTo(9.8, 4);
  expect(doc.bodies[0].mcpGridfinity.magnetPockets.count).toBe(64);
  console.info(JSON.stringify({ magneticMaxPartBuildMs: Date.now() - start, parts: 3 }));
  expect(errors).toEqual([]);
});

test("native cutter geometry stays correct when timeline metadata changes and tools overlap or separate", async ({ page }, info) => {
  await boot(page, info);
  for (const [spacing, removed] of [[6, 1280], [4, 1280], [2, 960]]) {
    const tool = { t: "prim", kind: "box", p: { w: 8, d: 8, h: 12 }, mods: [] };
    const children = [-spacing, spacing].map(x => { const m = IDENTITY.slice(); m[12] = x; m[14] = -1; return { node: tool, m, hole: false }; });
    const target = { t: "prim", kind: "box", p: { w: 20, d: 20, h: 10 }, mods: [{ t: "bool", seq: spacing * 10, op: "cut", tool: { t: "group", children, mods: [] }, m: IDENTITY }] };
    await loadDoc(page, newDoc(`Cut ${spacing}`, "advanced", { bodies: [body("cut-target", "Cut target", target)] }));
    const measured = await page.evaluate(() => { const data = window.__app.scene.views.get("cut-target").data; return { error: window.__app.scene.errors.get("cut-target"), volume: data?.volume, vertices: Array.from(data?.vertices || []), triangles: Array.from(data?.triangles || []) }; });
    expect(measured.error).toBeUndefined();
    expect(measured.volume).toBeCloseTo(4000 - removed, 4);
    const section = inspectGeometry(measured, { samples: [{ axis: "Z", point: [0, 0, -1] }] });
    expect(section.samples[0].intervals).toEqual(spacing === 6 ? [[0, 10]] : []);
  }
});
