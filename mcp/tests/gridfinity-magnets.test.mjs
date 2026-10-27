import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMagnetPockets, magnetCenters, magnetCarrierHeight } from "../shared/gridfinity-magnets.js";
import { normalizeGridfinity, buildGridfinity } from "../browser/plans/gridfinity.js";
import { normalizeDrawerLayout, drawerParts, drawerBinBaseZ } from "../shared/drawer-layout.js";
import { compileMcpModel, reviseMcpParameters } from "../browser/plans/models.js";

const document = () => ({ id: "magnets", seq: 0, mode: "advanced", bodies: [], sketches: [], planes: [], joints: [] });
function build(kind, magnets, columns = 1, rows = 1) {
  const doc = document(); let i = 0;
  const op = normalizeGridfinity({ type: "gridfinity", id: "part", kind, magnets, columns, rows });
  return { document: doc, ...buildGridfinity(op, { document: doc, idFactory: p => `${p}-${++i}` }) };
}
test("magnet pocket defaults and strict limits preserve standard foot walls and roof", () => {
  assert.deepEqual(normalizeMagnetPockets(true), { diameter: 6.5, depth: 2.4 });
  assert.equal(normalizeMagnetPockets(undefined), false);
  assert.equal(normalizeMagnetPockets(false), false);
  assert.deepEqual(normalizeMagnetPockets({ diameter: 6.2, depth: 2.3 }), { diameter: 6.2, depth: 2.3 });
  for (const value of [null, "yes", 1, [], { enabled: true }, { diameter: 0 }, { diameter: 8.1 }, { diameter: NaN }, { depth: 0 }, { depth: 4.1 }, { depth: Infinity }]) assert.throws(() => normalizeMagnetPockets(value));
  assert.equal(magnetCarrierHeight(true), 3.2);
  assert.equal(magnetCarrierHeight(false), 0);
});
test("four pockets per cell use common 26 mm center spacing and repeat on 42 mm pitch", () => {
  assert.deepEqual(magnetCenters(1, 1), [[-13, -13], [13, -13], [-13, 13], [13, 13]]);
  const centers = magnetCenters(2, 3);
  assert.equal(centers.length, 24);
  assert.equal(new Set(centers.map(p => p.join())).size, 24);
  assert.deepEqual(centers.slice(0, 4), [[-34, -55], [-8, -55], [-34, -29], [-8, -29]]);
});
test("magnets off retains the original native geometry; pockets are editable native booleans", () => {
  for (const kind of ["bin", "insert", "baseplate"]) {
    const plain = build(kind), off = build(kind, false), magnetic = build(kind, true, 2, 3);
    assert.deepEqual(plain.node, off.node);
    assert.equal(magnetic.node.mods.at(-1).src, "magnetPockets");
    assert.equal(magnetic.node.mods.at(-1).tool.children.length, 24);
    assert.ok(magnetic.node.mods.at(-1).tool.children.every(child => child.node.t === "prim" && child.node.kind === "cylinder"));
    assert.equal(magnetic.recipe.magnetPockets.count, 24);
    assert.equal(magnetic.recipe.magnetPockets.opening, kind === "baseplate" ? "top" : "bottom");
    assert.equal(magnetic.recipe.totalHeight, kind === "baseplate" ? 8.2 : 21);
    assert.equal(magnetic.recipe.nodeSignature, JSON.stringify(magnetic.node));
  }
});
test("magnetic drawer seating propagates through tiled baseplates and rejects insufficient height", () => {
  const raw = { type: "drawerLayout", id: "drawer", width: 260, depth: 180, height: 25, baseplateMagnets: true, bins: [{ id: "bin", x: 0, y: 0, columns: 2, rows: 2, magnets: { diameter: 6.2, depth: 2.3 } }] };
  const layout = normalizeDrawerLayout(raw), parts = drawerParts(layout);
  assert.equal(drawerBinBaseZ(layout), 3.45);
  assert.equal(parts[0].position[2], 3.45);
  assert.deepEqual(parts[0].magnets, { diameter: 6.2, depth: 2.3 });
  assert.ok(parts.slice(1).every(part => part.magnets.diameter === 6.5 && part.magnets.depth === 2.4));
  assert.throws(() => normalizeDrawerLayout({ ...raw, height: 24 }), /too tall/);
  assert.throws(() => normalizeDrawerLayout({ ...raw, includeBaseplate: false }), /require matching baseplates/);
  const noBase = normalizeDrawerLayout({ ...raw, includeBaseplate: false, baseplateMagnets: false, height: 21 });
  assert.equal(drawerParts(noBase)[0].position[2], 0);
});
test("magnet sizes survive native serialization and named parameter revisions", () => {
  const plan = { name: "Magnetic bin", modelId: "magnetic-bin", parameters: { pocket: { value: 6.2, unit: "mm", min: 2, max: 8 } }, operations: [{ id: "bin", type: "gridfinity", kind: "bin", magnets: { diameter: { $expr: "pocket" }, depth: 2.4 } }] };
  const built = compileMcpModel(document(), plan);
  const revised = reviseMcpParameters(JSON.parse(JSON.stringify(built.document)), "magnetic-bin", { pocket: 6.5 });
  assert.equal(revised.document.bodies[0].id, built.document.bodies[0].id);
  assert.equal(revised.document.bodies[0].mcpGridfinity.magnetPockets.diameter, 6.5);
  assert.equal(revised.document.bodies[0].node.mods.at(-1).tool.children[0].node.p.w, 6.5);
  assert.throws(() => reviseMcpParameters(built.document, "magnetic-bin", { pocket: 9 }), /maximum|constraint|between|range|bounds/);
});
