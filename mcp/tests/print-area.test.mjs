import test from "node:test";
import assert from "node:assert/strict";
import { PRINT_AREA_PRESETS, normalizePrintArea, baseplateTileLimits, checkPrintFit } from "../shared/print-area.js";
import { normalizeDrawerLayout, drawerParts, fillDrawerGaps } from "../shared/drawer-layout.js";
import { compileMcpModel } from "../browser/plans/models.js";
const layout = changes => ({ id: "drawer", type: "drawerLayout", width: 230, depth: 695, height: 60, bins: [], ...changes });
test("printer area preserves decimal nozzle dimensions and rejects invalid envelopes", () => {
  assert.equal(normalizePrintArea(), false);
  assert.equal(normalizePrintArea(PRINT_AREA_PRESETS[1]).width, 235.5);
  for (const patch of [{ width: NaN }, { height: -1 }, { depth: Infinity }, { edgeMargin: 129 }, { width: 4, edgeMargin: 2 }, { unknown: true }]) assert.throws(() => normalizePrintArea({ ...PRINT_AREA_PRESETS[0], ...patch }));
  assert.throws(() => baseplateTileLimits({ width: 40, depth: 100, height: 100, edgeMargin: 0 }), /42 mm/);
});
test("nozzle areas choose native capped tiles and use rotation when it reduces tile count", () => {
  assert.deepEqual(baseplateTileLimits(), { columns: 4, rows: 4 });
  assert.deepEqual(baseplateTileLimits(PRINT_AREA_PRESETS[0]), { columns: 6, rows: 6 });
  assert.deepEqual(baseplateTileLimits(PRINT_AREA_PRESETS[1]), { columns: 5, rows: 6 });
  assert.deepEqual(baseplateTileLimits(PRINT_AREA_PRESETS[1], { columns: 6, rows: 5 }), { columns: 6, rows: 5 });
  const parts = drawerParts(layout({ printArea: PRINT_AREA_PRESETS[0], cornerSpacers: true }));
  assert.deepEqual(parts.filter(p => p.kind === "baseplate").map(p => [p.columns, p.rows]), [[5, 6], [5, 6], [5, 4]]);
  assert.equal(parts.filter(p => p.type === "drawerSpacer").length, 4);
  for (const p of parts.filter(p => p.kind === "baseplate")) assert.doesNotThrow(() => checkPrintFit(PRINT_AREA_PRESETS[0], p.columns * 42, p.rows * 42, 5));
});
test("per-part fit handles bin gaps, 90 degree placement, height and magnetic carriers", () => {
  assert.equal(checkPrintFit(PRINT_AREA_PRESETS[1], 252, 210, 5).rotation, 90);
  assert.throws(() => checkPrintFit(PRINT_AREA_PRESETS[1], 252, 252, 5), /exceeds/);
  assert.throws(() => checkPrintFit(PRINT_AREA_PRESETS[0], 20, 20, 261), /exceeds/);
  assert.throws(() => checkPrintFit(PRINT_AREA_PRESETS[0], 20, 20, NaN), /finite positive/);
  assert.doesNotThrow(() => checkPrintFit(PRINT_AREA_PRESETS[0], 252.0005, 252.0005, 5));
  assert.throws(() => checkPrintFit(PRINT_AREA_PRESETS[0], 252.01, 252.01, 5), /exceeds/);
  const exactBin = { width: 255.5, depth: 255.5, height: 260, edgeMargin: 2 };
  assert.doesNotThrow(() => checkPrintFit(exactBin, 251.5, 251.5, 21));
  assert.deepEqual(baseplateTileLimits(exactBin), { columns: 5, rows: 5 });
  assert.throws(() => normalizeDrawerLayout(layout({ printArea: { ...PRINT_AREA_PRESETS[0], height: 6 }, baseplateMagnets: true })), /exceeds/);
  assert.throws(() => normalizeDrawerLayout(layout({ printArea: { ...PRINT_AREA_PRESETS[0], width: 100, depth: 100 }, bins: [{ id: "big", x: 0, y: 0, columns: 4, rows: 4 }] })), /exceeds/);
  let i = 0;
  const filled = fillDrawerGaps(layout({ printArea: PRINT_AREA_PRESETS[1], binLimits: { columns: 6, rows: 6 } }), rect => ({ id: `b${++i}`, ...rect, heightUnits: 3 }));
  assert.ok(filled.bins.every(bin => !(bin.columns === 6 && bin.rows === 6)));
  assert.ok(filled.bins.some(bin => bin.columns === 5 && bin.rows === 6));
});
test("printer preferences and rotated native output remain in saved layout metadata", () => {
  const doc = { id: "d", seq: 0, mode: "advanced", bodies: [], sketches: [], planes: [], joints: [] };
  const compiled = compileMcpModel(doc, { operations: [layout({ width: 252, depth: 210, printArea: PRINT_AREA_PRESETS[1] })] }).document;
  assert.equal(compiled.bodies.length, 1);
  assert.equal(compiled.bodies[0].mcpPrintFit.rotation, 90);
  assert.equal(JSON.parse(JSON.stringify(compiled)).bodies[0].mcpDrawerLayout.definition.printArea.width, 235.5);
});
