import test from "node:test";
import assert from "node:assert/strict";
import { buildHolePattern } from "../browser/hole-pattern.js";
import { buildModelPlan, normalizeModelPlan } from "../browser/model-plan.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function doc() { return { id: "d1", name: "Untitled", mode: "beginner", seq: 0, sketches: [], bodies: [], planes: [], joints: [] }; }
function ids() { let n = 0; return (prefix) => `${prefix}-${++n}`; }
function rectangleData() {
  return {
    vertices: new Float32Array([-30, -20, 6, 30, -20, 6, 30, 20, 6, -30, 20, 6]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceGroups: [[0, 6]], faceInfo: [{ t: "PLANE", n: [0, 0, 1], c: [0, 0, 6] }],
  };
}
function pattern(overrides = {}) {
  return {
    id: "holes", featureId: "f-holes", seq: 3, bodyId: "plate", face: "+z",
    layout: { type: "grid", cols: 3, rows: 2, pitch: 10, margin: 0, stagger: false, angle: 0 },
    hole: { kind: "simple", diameter: 4, counterboreDiameter: 8, counterboreDepth: 3, countersinkDiameter: 9, countersinkAngle: 90, pitch: 0.5, clearance: 0, tip: false },
    ...overrides,
  };
}

test("fastener plans compile to editable native thread and hole nodes", () => {
  const result = buildModelPlan(doc(), {
    name: "Fasteners",
    operations: [
      { id: "bolt", type: "fastener", fastenerType: "bolt", size: "M8", length: 30 },
      { id: "nut", type: "fastener", fastenerType: "nut", size: "#10-24" },
      { id: "rod", type: "fastener", fastenerType: "rod", size: "M3", length: 5, left: true, position: [0, 0, 4] },
      { id: "cutter", type: "fastener", fastenerType: "cutter", size: "1/4-20", length: 12, clearance: -0.2 },
    ],
  }, ids());
  assert.equal(result.document.bodies.length, 4);
  const [bolt, nut, rod, cutter] = result.document.bodies;
  assert.equal(bolt.node.t, "group");
  assert.deepEqual(bolt.node.mods.map((mod) => mod.t), ["thread"]);
  assert.equal(bolt.node.mods[0].pitch, 1.25);
  assert.deepEqual(nut.node.mods.map((mod) => mod.t), ["hole", "thread"]);
  assert.equal(rod.node.mods[0].left, true);
  assert.equal(cutter.hole, true);
  assert.equal(cutter.node.mods[0].clear, 0);
  assert.deepEqual(result.featureBodyIds, { bolt: bolt.id, nut: nut.id, rod: rod.id, cutter: cutter.id });
  assert.equal(result.createdBodyIds.length, 4);
});

test("fastener plans reject unsupported sizes, short lengths and excessive thread turns", () => {
  const base = { name: "Bad fastener", operations: [{ id: "part", type: "fastener", fastenerType: "rod", size: "M7", length: 10 }] };
  assert.throws(() => buildModelPlan(doc(), base, ids()), /Unknown fastener size/);
  assert.throws(() => buildModelPlan(doc(), { ...base, operations: [{ ...base.operations[0], size: "M8", length: 3 }] }, ids()), /at least 3\.750 mm/);
  assert.throws(() => buildModelPlan(doc(), { ...base, operations: [{ ...base.operations[0], size: "M2.5", length: 1000 }] }, ids()), /150-thread-turn limit/);
});

test("hole patterns normalize as typed operations and defer native placement until geometry is built", () => {
  const current = doc();
  const input = {
    name: "Perforated plate",
    primitives: [{ id: "plate", kind: "box", parameters: { w: 60, d: 40, h: 6 } }],
    operations: [{ id: "holes", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 3, rows: 2, pitch: 10 }, hole: { diameter: 4 } }],
  };
  const result = buildModelPlan(current, input, ids());
  assert.deepEqual(current.bodies, []);
  assert.deepEqual(result.document.bodies[0].node.mods, []);
  assert.equal(result.pendingHolePatterns.length, 1);
  assert.equal(result.pendingHolePatterns[0].bodyId, result.document.bodies[0].id);
  assert.ok(result.affectedBodyIds.includes(result.document.bodies[0].id));
});

test("grid, staggered and circular hole layouts fit the native flat-face boundary", () => {
  const body = { id: "plate", m: identity };
  const grid = buildHolePattern(body, rectangleData(), pattern());
  assert.equal(grid.holes, 6);
  assert.equal(grid.dropped, 0);
  assert.equal(grid.mod.t, "hole");
  assert.deepEqual(grid.mod.at.map((entry) => entry.n), Array.from({ length: 6 }, () => [0, 0, 1]));

  const staggered = buildHolePattern(body, rectangleData(), pattern({ layout: { type: "grid", cols: 3, rows: 3, pitch: 10, margin: 0, stagger: true, angle: 0 } }));
  assert.equal(staggered.holes, 8);
  const circle = buildHolePattern(body, rectangleData(), pattern({ layout: { type: "circle", count: 4, radius: 10, start: 45, margin: 0 }, hole: { ...pattern().hole, kind: "tapped", diameter: 2.5, pitch: 0.45, clearance: -0.1 } }));
  assert.equal(circle.holes, 4);
  assert.equal(circle.mod.tapped, true);
  assert.equal(circle.mod.kind, "simple");
});

test("square, hex and slot patterns compile as editable sketch-and-extrude cuts", () => {
  const body = { id: "plate", m: identity };
  for (const shape of [
    { type: "square", width: 6 },
    { type: "hex", width: 6 },
    { type: "slot", width: 4, length: 10 },
  ]) {
    const generated = buildHolePattern(body, rectangleData(), pattern({
      sketchId: `sketch-${shape.type}`, shape,
      layout: { type: "grid", cols: 2, rows: 2, pitch: 12, margin: 0, stagger: false, angle: 0 },
    }));
    assert.equal(generated.shape, shape.type);
    assert.equal(generated.holes, 4);
    assert.equal(generated.sketch.id, `sketch-${shape.type}`);
    assert.equal(generated.sketch.plane.n.join(","), "0,0,1");
    assert.equal(generated.tool.t, "extrude");
    assert.equal(generated.tool.profiles.length, 4);
    assert.ok(generated.sketch.ents.some((entity) => entity.t === "arc") === (shape.type === "slot"));
    assert.equal(generated.mod, undefined);
  }
});

test("circular slot patterns orient each slot along its radius", () => {
  const generated = buildHolePattern({ id: "plate", m: identity }, rectangleData(), pattern({
    sketchId: "circle-slots", shape: { type: "slot", width: 4, length: 10 },
    layout: { type: "circle", count: 4, radius: 10, start: 0, margin: 0 },
  }));
  const points = new Map(generated.sketch.pts.map((entry) => [entry.id, entry]));
  for (const [index, axis] of [[0, "x"], [6, "y"]]) {
    const entity = generated.sketch.ents[index];
    const delta = [points.get(entity.b).x - points.get(entity.a).x, points.get(entity.b).y - points.get(entity.a).y];
    assert.ok(Math.abs(delta[axis === "x" ? 1 : 0]) < 1e-6);
    assert.ok(Math.abs(delta[axis === "x" ? 0 : 1]) > 1);
  }
});

test("shaped hole patterns normalize only valid dimensions and reject round-hole settings", () => {
  const base = {
    name: "Slot plate", primitives: [{ id: "plate", kind: "box" }],
    operations: [{ id: "slots", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 2, rows: 2 }, shape: "slot", width: 4, length: 10 }],
  };
  assert.deepEqual(normalizeModelPlan(base).operations[0].shape, { type: "slot", width: 4, length: 10 });
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], shape: "slot", length: 4 }] }), /length must be greater than its width/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], shape: "hex", length: 10 }] }), /length is only supported for slot/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], shape: "slot", hole: { diameter: 4 } }] }), /hole settings are only supported for round patterns/);
});

test("hole patterns reject missing faces, overlapping holes and unsupported counts", () => {
  assert.throws(() => buildHolePattern({ id: "plate", m: identity }, { ...rectangleData(), faceInfo: [{ t: "CYLINDRE", n: [0, 0, 1], c: [0, 0, 6] }] }, pattern()), /no flat face/);
  assert.throws(() => buildHolePattern({ id: "plate", m: identity }, rectangleData(), pattern({ layout: { type: "grid", cols: 2, rows: 2, pitch: 2, margin: 0, stagger: false, angle: 0 } })), /pitch is smaller/);
  const normalized = (plan) => normalizeModelPlan(plan);
  assert.throws(() => normalized({ name: "Too many holes", primitives: [{ id: "plate", kind: "box" }], operations: [{ id: "holes", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 15, rows: 14 }, hole: { diameter: 2 } }] }), /at most 200 positions/);
  assert.throws(() => normalized({ name: "Bad layout", primitives: [{ id: "plate", kind: "box" }], operations: [{ id: "holes", type: "holePattern", target: "plate", face: "top", layout: { type: "circle", count: 4, radius: 10 }, hole: { diameter: 2 } }] }), /face must be/);
});
