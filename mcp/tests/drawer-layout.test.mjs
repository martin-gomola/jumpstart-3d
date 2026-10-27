import test from "node:test";
import assert from "node:assert/strict";
import { drawerMetrics, normalizeDrawerLayout, placementError, drawerParts, fillDrawerGaps, firstDrawerSpace } from "../shared/drawer-layout.js";
import { compileMcpModel } from "../browser/plans/models.js";
import { summarizeDrawerLayouts } from "../browser/plans/drawer-layout.js";

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

test("drawer bins override floor and wall and insert bins keep measured pockets through regeneration and rotation", async () => {
  const { rotateDrawerLayout } = await import("../shared/drawer-layout.js");
  const pocket = { profile: { type: "roundedRect", width: 30, height: 12, radius: 2 }, position: [5, 10], rotation: 0, depth: 6, clearance: 0.3, sourceEvidence: { product: "Caliper", kind: "measured" } };
  const input = layout({ floor: 2, wall: 1.2, bins: [bin("tray", { floor: 3, wall: 2 }), bin("tool", { x: 2, kind: "insert", wall: 1.6, pockets: [pocket, { ...pocket, id: "pen", position: [-10, -10], profile: { type: "circle", radius: 4 } }] })] });
  const normalized = normalizeDrawerLayout(input);
  assert.deepEqual([normalized.bins[0].floor, normalized.bins[0].wall, normalized.bins[1].floor], [3, 2, undefined]);
  assert.deepEqual(normalized.bins[1].pockets.map(p => p.id), ["pocket-1", "pen"]);
  assert.equal(normalized.bins[1].pockets[0].minimumWall, undefined);
  const [tray, tool] = drawerParts(normalized);
  assert.deepEqual([tray.floor, tray.wall, tool.floor, tool.wall], [3, 2, 2, 1.6]);
  assert.deepEqual(tool.pockets.map(p => [p.target, p.minimumFloor, p.minimumWall]), [["tool", 2, 1.6], ["tool", 2, 1.6]]);
  for (const bins of [[bin("b", { pockets: [pocket] })], [bin("b", { kind: "insert", pockets: [{ ...pocket, target: "other" }] })], [bin("b", { kind: "insert", pockets: [pocket, { ...pocket, id: "pocket-1" }] })], [bin("b", { floor: 0.5 })]])
    assert.throws(() => normalizeDrawerLayout(layout({ bins })), /pockets|unsupported|unique|floor/);
  const built = compileMcpModel(doc(), { name: "Tool drawer", operations: [input] });
  const insert = built.document.bodies.find(body => body.mcpDrawerLayout.partId === "tool");
  assert.deepEqual(insert.mcpPockets.map(p => p.id), ["pocket-1", "pen"]);
  assert.equal(insert.node.mods.filter(mod => mod.src === "pocket").length, 2);
  const stored = JSON.parse(JSON.stringify(built.document));
  assert.equal(summarizeDrawerLayouts(stored)[0].editable, true);
  const revised = compileMcpModel(stored, { name: "Revised", operations: [{ ...input, replaceExisting: true, bins: [input.bins[0], { ...input.bins[1], pockets: [pocket] }] }] });
  assert.equal(revised.document.bodies.find(body => body.mcpDrawerLayout.partId === "tool").mcpPockets.length, 1);
  assert.equal(revised.document.sketches.filter(sketch => sketch.name.startsWith("Pocket ")).length, 1);
  assert.throws(() => compileMcpModel(doc(), { operations: [layout({ bins: [bin("tool", { kind: "insert", pockets: [{ ...pocket, depth: 20 }] })] })] }), /tool: Pocket: depth/);
  const turned = rotateDrawerLayout(normalized);
  assert.deepEqual(turned.bins[1].pockets.map(p => [p.position, p.rotation]), [[[10, -5], -90], [[-10, 10], -90]]);
  assert.deepEqual(rotateDrawerLayout(rotateDrawerLayout(rotateDrawerLayout(turned))), normalized);
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

test("baseplate clips join tile joints from below and stay owned, editable native parts", () => {
  const input = layout({ width: 9 * 42, depth: 5 * 42, bins: [], baseplateClips: true });
  const parts = drawerParts(input), clips = parts.filter(p => p.type === "baseplateClip");
  assert.deepEqual(clips.map(c => [c.position[0], c.position[1], c.axis]), [[-21, -63, "x"], [-21, 21, "x"], [-21, 84, "y"], [147, -63, "x"], [147, 21, "x"], [147, 84, "y"], [-147, 63, "y"], [-63, 63, "y"], [21, 63, "y"], [105, 63, "y"], [168, 63, "x"]]);
  assert.deepEqual([clips[0].width, clips[0].length, clips[0].height, clips[0].clearance], [2, 15.7, 1.85, 0.15]);
  const tile = parts.find(p => p.id === "baseplate-0-0");
  assert.deepEqual(tile.clipSlots.map(s => [s.x, s.y, s.axis, s.width, s.length, s.depth]), [[84, -42, "x", 2.3, 16, 2], [84, 42, "x", 2.3, 16, 2], [-42, 84, "y", 2.3, 16, 2], [42, 84, "y", 2.3, 16, 2]]);
  assert.equal(drawerParts(layout({ width: 4 * 42, depth: 4 * 42, bins: [], baseplateClips: true })).some(p => p.type === "baseplateClip"), false);
  assert.deepEqual(normalizeDrawerLayout(layout({ baseplateClips: { clearance: 0.2 } })).baseplateClips, { clearance: 0.2 });
  for (const baseplateClips of [{ clearance: 0 }, { clearance: 1 }, { size: 10 }, "yes"]) assert.throws(() => normalizeDrawerLayout(layout({ baseplateClips })));
  assert.throws(() => normalizeDrawerLayout(layout({ includeBaseplate: false, baseplateClips: true })), /clips require/);
  const compiled = compileMcpModel(doc(), { operations: [input] }).document;
  const clipBodies = compiled.bodies.filter(body => body.mcpBaseplateClip);
  assert.equal(clipBodies.length, 11);
  assert.deepEqual(clipBodies[0].node.p, { w: 15.7, d: 2, h: 1.85, r: 0, c: 0 });
  const slotted = compiled.bodies.find(body => body.mcpDrawerLayout?.partId === "baseplate-0-0");
  assert.equal(slotted.node.mods.find(mod => mod.src === "clipSlots").tool.children.length, 4);
  assert.equal(slotted.mcpGridfinity.clipSlots.length, 4);
  assert.equal(summarizeDrawerLayouts(compiled)[0].editable, true);
  const revised = compileMcpModel(compiled, { operations: [{ ...input, replaceExisting: true, baseplateClips: false }] }).document;
  assert.equal(revised.bodies.filter(body => body.mcpBaseplateClip).length, 0);
  assert.equal(revised.bodies.some(body => body.node.mods?.some(mod => mod.src === "clipSlots")), false);
  const edited = structuredClone(compiled); edited.bodies.find(body => body.mcpBaseplateClip).node.p.h += 1;
  assert.equal(summarizeDrawerLayouts(edited)[0].editable, false);
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

test("drawer rotation preserves parts, height and matching openings through four turns", async () => {
  const { rotateDrawerLayout } = await import("../shared/drawer-layout.js");
  const input = normalizeDrawerLayout(layout({ width: 230, depth: 695, height: 60, binLimits: { columns: 3, rows: 5 }, bins: [
    bin("main", { x: 0, y: 1, columns: 2, rows: 4, dividers: { x: 1, y: 2 }, openSides: ["back"], lip: true }),
    bin("extension", { x: 0, y: 5, columns: 2, rows: 1, openSides: ["front"] }),
  ] }));
  const snapshot = structuredClone(input), next = rotateDrawerLayout(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual([next.width, next.depth, next.height], [695, 230, 60]);
  assert.deepEqual(next.binLimits, { columns: 5, rows: 3 });
  assert.deepEqual(next.bins.map(b => [b.id, b.x, b.y, b.columns, b.rows, b.openSides]), [
    ["main", 1, 3, 4, 2, ["right"]], ["extension", 5, 3, 1, 2, ["left"]],
  ]);
  assert.deepEqual(next.bins[0].dividers, { x: 2, y: 1 });
  assert.equal(drawerMetrics(next).occupied, drawerMetrics(input).occupied);
  assert.deepEqual(rotateDrawerLayout(rotateDrawerLayout(rotateDrawerLayout(next))), input);
});

test("empty drawer dimensions can be swapped before height is entered; invalid dimensions do not mutate the draft", async () => {
  const { rotateDrawerLayout } = await import("../shared/drawer-layout.js");
  const input = layout({ width: 230, depth: 695, height: 0, bins: [] });
  const next = rotateDrawerLayout(input);
  assert.deepEqual([next.width, next.depth, next.height], [695, 230, 0]);
  for (const width of [0, NaN, Infinity, 882]) {
    const invalid = { ...input, width }, snapshot = structuredClone(invalid);
    assert.throws(() => rotateDrawerLayout(invalid)); assert.deepEqual(invalid, snapshot);
  }
});
