import test from "node:test";
import assert from "node:assert/strict";
import { BIN_SIDES, normalizeOpenSides, rotateOpenSides, binTotalHeight } from "../shared/gridfinity-walls.js";
import { normalizeGridfinity, buildGridfinity } from "../browser/plans/gridfinity.js";
import { normalizeDrawerLayout, drawerParts } from "../shared/drawer-layout.js";
import { compileMcpModel } from "../browser/plans/models.js";
import { summarizeDrawerLayouts } from "../browser/plans/drawer-layout.js";

const doc = () => ({ id: "open-bin", seq: 0, mode: "advanced", bodies: [], sketches: [], planes: [], joints: [] });
const bin = changes => ({ id: "bin", type: "gridfinity", kind: "bin", ...changes });
const layout = changes => ({ id: "drawer", type: "drawerLayout", width: 294, depth: 84, height: 50, binLimits: { columns: 5, rows: 5 }, printArea: { width: 250, depth: 250, height: 250, edgeMargin: 2 }, bins: [
  { id: "main", x: 0, y: 0, columns: 5, rows: 2, openSides: ["right"] },
  { id: "extension", x: 5, y: 0, columns: 2, rows: 2, openSides: ["left"] },
], ...changes });

test("open sides are canonical, strict, bin-only, and rotate with the footprint", () => {
  assert.deepEqual(normalizeOpenSides(), []);
  assert.deepEqual(normalizeOpenSides(["back", "left"]), ["left", "back"]);
  for (const value of [null, true, "left", ["Left"], ["top"], ["right", "right"], [1]]) assert.throws(() => normalizeOpenSides(value));
  for (const kind of ["insert", "baseplate"]) assert.throws(() => normalizeGridfinity({ ...bin({ openSides: ["right"] }), kind }), /only supported for bins/);
  assert.deepEqual(rotateOpenSides(["right"]), ["front"]);
  let sides = ["left", "back"];
  for (let i = 0; i < 4; i++) sides = rotateOpenSides(sides);
  assert.deepEqual(sides, ["left", "back"]);
});

test("wall cuts start above the protected base and floor and clear the full rim", () => {
  const document = doc(); let counter = 0;
  const { node, recipe } = buildGridfinity(bin({ columns: 1, rows: 1, lip: true, openSides: ["right"] }), { document, idFactory: prefix => `${prefix}-${++counter}` });
  const cut = node.mods.find(mod => mod.src === "openSides");
  assert.equal(cut.op, "cut"); assert.equal(cut.tool.children.length, 1);
  const tool = cut.tool.children[0];
  assert.equal(tool.m[14], 9); assert.ok(tool.m[14] >= recipe.protectedBaseHeight + recipe.floor);
  assert.ok(tool.m[14] + tool.node.p.h > recipe.totalHeight);
  assert.deepEqual(recipe.openSides, ["right"]);
  assert.equal(recipe.totalHeight, 25.4);
  assert.equal(binTotalHeight({ heightUnits: 3, floor: 2, lip: true, openSides: BIN_SIDES }), 9);
  assert.equal(binTotalHeight({ heightUnits: 3, floor: 2, lip: true, openSides: BIN_SIDES, dividers: { x: 1 } }), 20.99);
});

test("adjoining 5+2 cell bins remain separately printable, persist their openings and regenerate safely", () => {
  const normalized = normalizeDrawerLayout(layout());
  assert.deepEqual(normalized.bins.map(bin => bin.openSides), [["right"], ["left"]]);
  assert.deepEqual(drawerParts(normalized).filter(part => part.kind === "bin").map(part => part.openSides), [["right"], ["left"]]);
  const compiled = compileMcpModel(doc(), { operations: [layout()] }).document;
  const bins = compiled.bodies.filter(body => body.mcpGridfinity?.kind === "bin");
  assert.equal(bins.length, 2);
  assert.ok(bins.every(body => body.mcpPrintFit.configured));
  assert.equal(summarizeDrawerLayouts(JSON.parse(JSON.stringify(compiled)))[0].editable, true);
  const changed = layout({ replaceExisting: true }); changed.bins[0].openSides = ["left", "right"];
  const regenerated = compileMcpModel(compiled, { operations: [changed] }).document;
  assert.equal(regenerated.bodies.length, compiled.bodies.length);
  assert.deepEqual(regenerated.bodies.find(body => body.mcpDrawerLayout.partId === "main").mcpGridfinity.openSides, ["left", "right"]);
  assert.throws(() => normalizeDrawerLayout(layout({ bins: [{ id: "too-long", x: 0, y: 0, columns: 7, rows: 2, openSides: ["right"] }] })), /bin width/);
  assert.throws(() => normalizeDrawerLayout(layout({ bins: [{ id: "insert", x: 0, y: 0, columns: 1, rows: 1, kind: "insert", openSides: ["right"] }] })), /insert blanks/);
});

test("flush joins are strict opt-in bins and printer checks include the enlarged upper footprint", async () => {
  const { binFootprint } = await import("../shared/gridfinity-walls.js");
  assert.equal(normalizeGridfinity(bin()).closeGaps, false);
  for (const changes of [{ closeGaps: "yes", openSides: ["right"] }, { closeGaps: true }, { kind: "insert", closeGaps: true, openSides: ["left"] }]) assert.throws(() => normalizeGridfinity(bin(changes)));
  assert.deepEqual(binFootprint({ columns: 2, rows: 1, closeGaps: true, openSides: ["right"] }), { width: 83.75, depth: 41.5, minX: -41.75, maxX: 42, minY: -20.75, maxY: 20.75 });
  const plan = { id: "drawer", type: "drawerLayout", width: 252, depth: 42, height: 50, includeBaseplate: false, binLimits: { columns: 6, rows: 6 }, printArea: { width: 251.6, depth: 42, height: 100, edgeMargin: 0 }, bins: [
    { id: "long", x: 0, y: 0, columns: 6, rows: 1, openSides: ["right"] },
  ] };
  assert.doesNotThrow(() => normalizeDrawerLayout(plan));
  assert.throws(() => normalizeDrawerLayout({ ...plan, bins: [{ ...plan.bins[0], closeGaps: true }] }), /fit|area|printer/i);
  plan.printArea.width = 252;
  const normalized = normalizeDrawerLayout({ ...plan, bins: [{ ...plan.bins[0], closeGaps: true }] });
  assert.equal(drawerParts(normalized)[0].closeGaps, true);
  const compiled = compileMcpModel(doc(), { operations: [normalized] }).document;
  const updated = compileMcpModel(compiled, { operations: [{ ...normalized, replaceExisting: true }] }).document;
  assert.equal(updated.bodies[0].mcpGridfinity.closeGaps, true);
  assert.equal(updated.bodies[0].mcpGridfinity.width, 251.75);
});


test("legacy saved drawer metadata remains editable and flush flags survive complete layout rotation", async () => {
  const { rotateDrawerLayout } = await import("../shared/drawer-layout.js");
  const old = compileMcpModel(doc(), { operations: [layout()] }).document;
  for (const body of old.bodies) {
    if (body.mcpGridfinity) delete body.mcpGridfinity.closeGaps;
    if (body.mcpDrawerLayout) for (const bin of body.mcpDrawerLayout.definition.bins) delete bin.closeGaps;
  }
  assert.equal(summarizeDrawerLayouts(old)[0].editable, true);
  const definition = normalizeDrawerLayout(layout({ bins: layout().bins.map(b => ({ ...b, closeGaps: true })) }));
  const rotated = rotateDrawerLayout(definition);
  assert.equal(rotated.bins.every(b => b.closeGaps), true);
  assert.deepEqual(rotated.bins.map(b => b.openSides), [["front"],["back"]]);
});
