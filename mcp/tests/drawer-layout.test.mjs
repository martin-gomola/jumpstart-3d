import test from "node:test";
import assert from "node:assert/strict";
import { drawerMetrics, normalizeDrawerLayout, placementError, drawerParts, fillDrawerGaps, firstDrawerSpace } from "../shared/drawer-layout.js";
import { compileMcpModel } from "../browser/models.js";
import { summarizeDrawerLayouts } from "../browser/drawer-layout.js";

const bin = (id = "bin-1", changes = {}) => ({ id, label: id, x: 0, y: 0, columns: 2, rows: 2, heightUnits: 3, kind: "bin", ...changes });
const layout = changes => ({ id: "drawer", type: "drawerLayout", layoutId: "tools", name: "Tool drawer", width: 260, depth: 180, height: 40, bins: [bin()], ...changes });
const doc = () => ({ id: "d", seq: 0, mode: "advanced", bodies: [], sketches: [], planes: [], joints: [] });
test("drawer dimensions yield a centered standard grid, spare space and tiled native part placements", () => {
  const input = layout();
  assert.deepEqual(drawerMetrics(input), { columns: 6, rows: 4, gridWidth: 252, gridDepth: 168, spareWidth: 8, spareDepth: 12, occupied: 4, total: 24, fill: 17 });
  const parts = drawerParts(input);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0].position, [-84, -42, 0.25]);
  assert.deepEqual(parts.slice(1).map(p => [p.columns, p.rows, p.position]), [[4, 4, [-42, 0, 0]], [2, 4, [84, 0, 0]]]);
  assert.ok(parts.every(p => p.columns <= 4 && p.rows <= 4));
});
test("layout bounds, overlap, height, unknown fields and budgets are rejected without silently moving bins", () => {
  for (const input of [layout({ bins: [], includeBaseplate: false }), layout({ width: Infinity }), layout({ unexpected: true }), layout({ bins: [bin(), bin("b", { x: 1 })] }), layout({ bins: [bin("b", { x: 5 })] }), layout({ bins: [bin("b", { x: -1 })] }), layout({ height: 21 }), layout({ width: 840, depth: 840 }), layout({ bins: [bin("b", { columns: 5 })] }), layout({ bins: [bin("b", { kind: "mesh" })] })]) assert.throws(() => normalizeDrawerLayout(input));
  assert.equal(normalizeDrawerLayout(layout({ includeBaseplate: false, height: 21 })).bins[0].heightUnits, 3);
  assert.throws(() => normalizeDrawerLayout(layout({ height: 25, bins: [bin("b", { lip: true })] })), /too tall/);
  assert.throws(() => normalizeDrawerLayout(layout({ bins: [bin("b", { kind: "insert", dividers: { x: 1 } })] })), /insert blanks/);
});
test("space search and gap filling preserve existing bins and reject unprintable partial results atomically", () => {
  const input = layout(), snapshot = JSON.stringify(input);
  assert.match(placementError(input, { x: 1, y: 0, columns: 1, rows: 1 }), /occupied/);
  assert.equal(placementError(input, input.bins[0], "bin-1"), null);
  assert.deepEqual(firstDrawerSpace(input, 2, 2), { x: 2, y: 0 });
  let n = 1;
  const filled = fillDrawerGaps(input, rect => bin(`bin-${++n}`, rect));
  assert.equal(drawerMetrics(filled).occupied, 24);
  assert.deepEqual(filled.bins[0], input.bins[0]);
  normalizeDrawerLayout(filled);
  assert.equal(JSON.stringify(input), snapshot);
  const checker = layout({ width: 168, depth: 168, bins: Array.from({ length: 16 }, (_, i) => bin(`b${i}`, { x: i % 4, y: Math.floor(i / 4), columns: 1, rows: 1 })) });
  assert.equal(drawerMetrics(fillDrawerGaps(checker, () => assert.fail())).occupied, 16);
});
test("drawer plans remain native, persist metadata, replace only owned parts and reject native edits or dependencies", () => {
  const original = doc(), initial = compileMcpModel(original, { name: "Tool drawer", operations: [layout()] });
  assert.equal(original.bodies.length, 0);
  assert.equal(initial.document.bodies.length, 3);
  assert.ok(initial.document.bodies.every(body => body.node.t === "group" && body.mcpGridfinity));
  const stored = JSON.parse(JSON.stringify(initial.document));
  assert.equal(summarizeDrawerLayouts(stored)[0].editable, true);
  assert.deepEqual(summarizeDrawerLayouts(stored)[0].definition.bins, normalizeDrawerLayout(layout()).bins);
  assert.throws(() => compileMcpModel(stored, { name: "duplicate", operations: [layout()] }), /already exists/);
  stored.bodies.push({ id: "unrelated", name: "Reference", role: "reference", node: { t: "prim", kind: "box", p: { w: 10, d: 10, h: 10 } } });
  const keep = JSON.stringify(stored.bodies.at(-1));
  const edit = layout({ replaceExisting: true, bins: [bin("bin-1", { x: 2 })] });
  const revised = compileMcpModel(stored, { name: "Revised drawer", operations: [edit] });
  assert.equal(revised.document.bodies.length, 4);
  assert.equal(JSON.stringify(revised.document.bodies[0]), keep);
  assert.equal(summarizeDrawerLayouts(revised.document)[0].definition.bins[0].x, 2);
  for (const mutate of [d => { d.bodies[0].locked = true; }, d => { d.bodies[0].name = "Native custom name"; }, d => { delete d.bodies[0].mcpGridfinity; }, d => { d.bodies[0].m[12] += 1; }, d => { d.sketches[0].pts[0].x += 1; }, d => { d.bodies.pop(); }]) {
    const modified = structuredClone(initial.document); mutate(modified);
    assert.equal(summarizeDrawerLayouts(modified)[0].editable, false);
    assert.throws(() => compileMcpModel(modified, { name: "unsafe", operations: [edit] }), /edited|removed/);
  }
  const dependent = structuredClone(initial.document);
  dependent.joints.push({ a: dependent.bodies[0].id });
  assert.throws(() => compileMcpModel(dependent, { name: "unsafe", operations: [edit] }), /depends/);
});

test("configurable bin limits support larger native bins without changing default limits or baseplate tiling", () => {
  const large = layout({ width: 230, depth: 690, binLimits: { columns: 5, rows: 6 }, bins: [bin("wide", { columns: 5, rows: 4 })] });
  const normalized = normalizeDrawerLayout(large);
  assert.deepEqual(normalized.binLimits, { columns: 5, rows: 6 });
  const parts = drawerParts(normalized);
  assert.ok(parts.some(p => p.kind === "bin" && p.columns === 5 && p.rows === 4));
  assert.ok(parts.filter(p => p.kind === "baseplate").every(p => p.columns <= 4 && p.rows <= 4));
  assert.ok(compileMcpModel(doc(), { operations: [large] }).document.bodies.length > 1);
  let id = 0;
  const filled = fillDrawerGaps({ ...large, bins: [] }, rect => bin(`wide-${++id}`, rect));
  assert.deepEqual(filled.bins.map(b => [b.columns, b.rows]), [[5, 6], [5, 6], [5, 4]]);
  assert.equal(drawerMetrics(filled).fill, 100);
  assert.throws(() => normalizeDrawerLayout({ ...large, binLimits: { columns: 4, rows: 4 } }), /configured/);
  for (const binLimits of [{ columns: 7 }, { rows: 0 }, { columns: 2.5 }, { columns: Infinity }, { unexpected: 5 }, null]) assert.throws(() => normalizeDrawerLayout({ ...large, binLimits }));
});

test("corner spacers occupy only drawer margins and remain editable owned native parts", () => {
  const input = layout({ width: 230, depth: 695, height: 60, cornerSpacers: true });
  const normalized = normalizeDrawerLayout(input), parts = drawerParts(normalized).filter(p => p.type === "drawerSpacer");
  assert.equal(parts.length, 4);
  assert.throws(() => drawerParts({ ...input, bins: [bin("spacer-front-left")] }), /conflict/);
  assert.deepEqual(normalized.cornerSpacers, { clearance: 0.2, height: 5, legLength: 20 });
  for (const part of parts) for (const rect of part.rectangles) {
    const minX = part.position[0] + rect.x - rect.width / 2, maxX = minX + rect.width;
    const minY = part.position[1] + rect.y - rect.depth / 2, maxY = minY + rect.depth;
    assert.ok(minX >= -114.8 - 1e-8 && maxX <= 114.8 + 1e-8 && minY >= -347.3 - 1e-8 && maxY <= 347.3 + 1e-8);
    assert.ok(maxX <= -105 + 1e-8 || minX >= 105 - 1e-8 || maxY <= -336 + 1e-8 || minY >= 336 - 1e-8);
  }
  const compiled = compileMcpModel(doc(), { operations: [input] }).document;
  assert.equal(compiled.bodies.filter(body => body.mcpDrawerSpacer).length, 4);
  assert.equal(summarizeDrawerLayouts(compiled)[0].editable, true);
  const revised = compileMcpModel(compiled, { operations: [{ ...input, replaceExisting: true, cornerSpacers: { clearance: 0.4 } }] }).document;
  assert.equal(revised.bodies.length, compiled.bodies.length);
  const edited = structuredClone(compiled); edited.bodies.find(body => body.mcpDrawerSpacer).node.children[0].node.p.h += 1;
  assert.equal(summarizeDrawerLayouts(edited)[0].editable, false);
  assert.throws(() => compileMcpModel(edited, { operations: [{ ...input, replaceExisting: true }] }), /edited/);
});

test("spacer options reject unprintably thin gaps, oversized legs and invalid dimensions; exact fits need no stops", () => {
  for (const cornerSpacers of [{ clearance: -1 }, { height: 0 }, { legLength: 100 }, { arbitrary: 1 }, { clearance: Infinity }]) assert.throws(() => normalizeDrawerLayout(layout({ cornerSpacers })));
  assert.throws(() => normalizeDrawerLayout(layout({ cornerSpacers: true, includeBaseplate: false })), /baseplate/);
  assert.throws(() => normalizeDrawerLayout(layout({ width: 252.5, cornerSpacers: true })), /thin/);
  assert.throws(() => normalizeDrawerLayout(layout({ width: 42, depth: 180, bins: [bin("small", { columns: 1 })], cornerSpacers: { legLength: 21 } })), /overlap/);
  assert.equal(drawerParts(layout({ width: 252, depth: 168, cornerSpacers: true })).filter(p => p.type === "drawerSpacer").length, 0);
  const singleAxis = drawerParts(layout({ width: 252, depth: 180, cornerSpacers: true })).filter(p => p.type === "drawerSpacer");
  assert.equal(singleAxis.length, 4); assert.ok(singleAxis.every(p => p.rectangles.length === 1));
});

test("baseplate-only layouts support optional spacers and remain editable without allowing empty output", () => {
  const base = layout({ bins: [] });
  assert.equal(normalizeDrawerLayout(base).bins.length, 0);
  assert.ok(drawerParts(base).every(part => part.kind === "baseplate"));
  const withSpacers = { ...base, width: 230, depth: 695, cornerSpacers: true };
  const built = compileMcpModel(doc(), { operations: [withSpacers] }).document;
  assert.equal(built.bodies.length, 12);
  assert.equal(built.bodies.filter(body => body.mcpDrawerSpacer).length, 4);
  assert.equal(built.bodies.filter(body => body.mcpGridfinity?.kind === "bin").length, 0);
  assert.equal(summarizeDrawerLayouts(built)[0].editable, true);
  const revised = compileMcpModel(built, { operations: [{ ...withSpacers, replaceExisting: true, cornerSpacers: false }] }).document;
  assert.equal(revised.bodies.length, 8);
  assert.throws(() => normalizeDrawerLayout({ ...base, includeBaseplate: false }), /baseplates or add a bin/);
  assert.throws(() => normalizeDrawerLayout({ ...base, includeBaseplate: false, cornerSpacers: true }), /baseplates/);
});
