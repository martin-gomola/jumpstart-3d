import test from "node:test";
import assert from "node:assert/strict";
import { applyFeaturePatterns, buildModelPlan, normalizeModelPlan, resizeBodyDocument } from "../browser/plans/model-plan.js";
import { OPERATION_TYPES } from "../browser/plans/operations/index.js";

function doc() {
  return { id: "doc-1", name: "Untitled", mode: "beginner", seq: 0, sketches: [], bodies: [], planes: [], joints: [] };
}

function ids() {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

test("compiles a dimensioned revolve into the native sketch and feature model", () => {
  const result = buildModelPlan(doc(), {
    name: "Lid ring",
    sketches: [{ id: "wall", plane: "XZ", origin: [0, 0, 0], profile: { type: "polygon", points: [[45.5, 0], [49.5, 0], [49.5, 5.5], [45.5, 5.5]] } }],
    features: [{ id: "ring", type: "revolve", sketch: "wall", axis: "Z" }],
  }, ids());

  assert.equal(result.plan.mode, "advanced");
  assert.equal(result.document.name, "Lid ring");
  assert.equal(result.document.sketches[0].plane.n.join(","), "0,-1,0");
  assert.deepEqual(result.document.bodies[0].node, {
    t: "revolve", sketch: result.document.sketches[0].id,
    profiles: [{ key: result.document.sketches[0].ents.map((e) => e.id).sort().join(","), pt: [0, 0] }],
    mods: [], axis: "Z", angle: 360,
  });
  assert.deepEqual(result.affectedBodyIds, result.createdBodyIds);
});

test("rounded rectangles compile to a closed native line and quarter-arc profile", () => {
  const result = buildModelPlan(doc(), {
    name: "Rounded tray",
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "roundedRect", width: 30, height: 20, radius: 4, center: [3, -2] } }],
    features: [{ id: "body", type: "extrude", sketch: "outline", distance: 5 }],
  }, ids());
  const sketch = result.document.sketches[0];
  const edges = sketch.ents.map(({ id, ...entity }) => entity);
  assert.equal(sketch.ents.length, 8);
  assert.equal(sketch.ents.filter(({ t }) => t === "line").length, 4);
  assert.equal(sketch.ents.filter(({ t }) => t === "arc").length, 4);
  const endpoints = sketch.ents.map(({ a, b }) => [a, b]);
  for (let i = 0; i < endpoints.length; i++) assert.equal(endpoints[i][1], endpoints[(i + 1) % endpoints.length][0]);
  const profile = result.document.bodies[0].node.profiles[0];
  assert.deepEqual(profile, { key: sketch.ents.map(({ id }) => id).sort().join(","), pt: [3, -2] });
  assert.equal(result.document.bodies[0].node.sketch, sketch.id);
  assert.ok(edges.every(({ t }) => t === "line" || t === "arc"));
});

test("rounded rectangle profile validates positive sizes, bounded radius and strict keys", () => {
  const base = { name: "Rounded", sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "roundedRect", width: 30, height: 20, radius: 4 } }], features: [{ id: "body", type: "extrude", sketch: "outline", distance: 2 }] };
  assert.throws(() => normalizeModelPlan({ ...base, sketches: [{ ...base.sketches[0], profile: { ...base.sketches[0].profile, width: 0 } }] }), /width must be a finite number/);
  assert.throws(() => normalizeModelPlan({ ...base, sketches: [{ ...base.sketches[0], profile: { ...base.sketches[0].profile, height: -1 } }] }), /height must be a finite number/);
  assert.throws(() => normalizeModelPlan({ ...base, sketches: [{ ...base.sketches[0], profile: { ...base.sketches[0].profile, radius: 10.01 } }] }), /radius must be a finite number/);
  assert.throws(() => normalizeModelPlan({ ...base, sketches: [{ ...base.sketches[0], profile: { ...base.sketches[0].profile, extra: true } }] }), /extra is not supported/);
});

test("sharp rectangles and regular polygons compile to native line profiles", () => {
  const extrude = (profile) => buildModelPlan(doc(), { name: "Profile", sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile }], features: [{ id: "body", type: "extrude", sketch: "outline", distance: 2 }] }, ids()).document;
  const sharp = extrude({ type: "roundedRect", width: 30, height: 20, radius: 0, center: [3, -2] });
  assert.deepEqual(sharp.sketches[0].ents.map(({ t }) => t), ["line", "line", "line", "line"]);
  assert.deepEqual(sharp.sketches[0].pts.map(({ x, y }) => [x, y]), [[18, -12], [18, 8], [-12, 8], [-12, -12]]);
  const hex = extrude({ type: "regularPolygon", sides: 6, acrossFlats: 5.5, center: [10, 0] });
  const ys = hex.sketches[0].pts.map(({ y }) => y);
  assert.equal(hex.sketches[0].ents.length, 6);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 5.5) < 1e-9);
  assert.deepEqual(hex.bodies[0].node.profiles[0].pt, [10, 0]);
  const base = { name: "Hex", sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "regularPolygon", sides: 6, acrossFlats: 5.5 } }], features: [{ id: "body", type: "extrude", sketch: "outline", distance: 2 }] };
  const withProfile = (profile) => ({ ...base, sketches: [{ ...base.sketches[0], profile: { ...base.sketches[0].profile, ...profile } }] });
  assert.throws(() => normalizeModelPlan(withProfile({ circumradius: 3 })), /exactly one of acrossFlats or circumradius/);
  assert.throws(() => normalizeModelPlan(withProfile({ sides: 6.5 })), /sides must be an integer/);
  assert.throws(() => normalizeModelPlan(withProfile({ sides: 2 })), /sides must be/);
});

test("managed imports compile to native mesh and STEP nodes and require STL units", () => {
  const assetId = "a".repeat(64);
  const current = { ...doc(), assets: {
    [assetId]: { kind: "mesh", name: "housing.stl", data: "AA==" },
    ["b".repeat(64)]: { kind: "mesh", name: "housing.3mf", data: "AA==" },
    ["c".repeat(64)]: { kind: "step", name: "bracket.stp", data: "AA==" },
  } };
  const stl = buildModelPlan(current, { name: "Housing", operations: [{ id: "housing", type: "import", assetId, units: "in", position: [1, 2, 3] }] }, ids());
  assert.equal(stl.document.bodies[0].node.t, "mesh");
  assert.equal(stl.document.bodies[0].node.asset, assetId);
  assert.equal(stl.document.bodies[0].node.k, 25.4);
  assert.deepEqual(stl.document.bodies[0].m.slice(12, 15), [1, 2, 3]);
  assert.throws(() => buildModelPlan(current, { name: "Missing units", operations: [{ id: "housing", type: "import", assetId }] }, ids()), /requires explicit STL units/);
  const threeMf = buildModelPlan(current, { name: "3MF", operations: [{ id: "housing", type: "import", assetId: "b".repeat(64) }] }, ids());
  assert.equal(threeMf.document.bodies[0].node.t, "mesh");
  assert.equal(threeMf.document.bodies[0].node.k, undefined);
  const step = buildModelPlan(current, { name: "STEP", operations: [{ id: "bracket", type: "import", assetId: "c".repeat(64) }] }, ids());
  assert.equal(step.document.bodies[0].node.t, "step");
  assert.throws(() => buildModelPlan(current, { name: "STEP units", operations: [{ id: "bracket", type: "import", assetId: "c".repeat(64), units: "mm" }] }, ids()), /must preserve units/);
  assert.throws(() => buildModelPlan(doc(), { name: "Missing asset", operations: [{ id: "housing", type: "import", assetId }] }, ids()), /managed import catalog/);
});

test("phone cradles compile to an editable angled plate, two ribs and a lower stop with explicit front-back intent", () => {
  const base = {
    name: "Dashboard phone cradle",
    operations: [{ id: "cradle", type: "phoneCradle", width: 92, phoneLength: 145, angle: 50, plateThickness: 3, ribThickness: 8, stopHeight: 12, stopDepth: 8, topEdgeToward: "+Y", position: [0, -30, 5] }],
  };
  const result = buildModelPlan(doc(), base, ids());
  const body = result.document.bodies[0];
  assert.equal(body.name, "Angled phone cradle");
  assert.equal(body.node.t, "prim");
  assert.equal(body.node.kind, "box");
  assert.deepEqual(body.node.p, { w: 92, d: 145, h: 3 });
  assert.equal(body.node.mods.length, 3);
  assert.deepEqual(body.node.mods.map((modifier) => modifier.tool.kind), ["wedge", "wedge", "box"]);
  assert.ok(body.node.mods.every((modifier) => modifier.src === "phoneCradle" && modifier.op === "join"));
  assert.ok(body.m[6] > 0, "+Y top edge rises toward the dashboard");
  assert.deepEqual(body.mcpPhoneCradle, {
    coordinateFrame: { description: "X across · Y front/back · Z up", orientation: "+Y = dashboard", screen: "Screen faces -Y (driver side)" },
    topEdgeToward: "+Y", screenFacesToward: "-Y", width: 92, phoneLength: 145, angle: 50,
    plateThickness: 3, ribThickness: 8, stopHeight: 12, stopDepth: 8,
    run: 145 * Math.cos(50 * Math.PI / 180), rise: 145 * Math.sin(50 * Math.PI / 180),
    position: [0, -30, 5], supportRibs: 2,
  });
  assert.deepEqual(result.featureBodyIds, { cradle: body.id });

  const reverse = buildModelPlan(doc(), { ...base, operations: [{ ...base.operations[0], id: "reverse", topEdgeToward: "-Y" }] }, ids()).document.bodies[0];
  assert.ok(reverse.m[6] < 0, "-Y top edge leans toward the driver");
  assert.equal(reverse.mcpPhoneCradle.screenFacesToward, "+Y");
});

test("knurls compile into a native editable sketch extrusion with validated groove and bore dimensions", () => {
  const result = buildModelPlan(doc(), { name: "Knob", operations: [{ id: "knob", type: "knurl", diameter: 20, length: 15, grooves: 32, bore: "hex", boreSize: 6, position: [1, 2, 3] }] }, ids());
  const sketch = result.document.sketches[0], body = result.document.bodies[0];
  assert.equal(sketch.hidden, true);
  assert.equal(sketch.ents.filter(({ t }) => t === "line").length, 70);
  assert.equal(sketch.ents.filter(({ t }) => t === "circle").length, 0);
  assert.equal(body.node.t, "extrude");
  assert.equal(body.node.sketch, sketch.id);
  assert.equal(body.node.profiles[0].key, sketch.ents.slice(0, 64).map(({ id }) => id).sort().join(","));
  assert.ok(Math.hypot(...body.node.profiles[0].pt) > 0);
  assert.deepEqual({ dist: body.node.dist, mode: body.node.mode, dist2: body.node.dist2, mods: body.node.mods }, { dist: 15, mode: "one", dist2: 0, mods: [] });
  assert.equal(body.name, "Knurled knob 20 x 15");
  assert.deepEqual(body.m.slice(12, 15), [1, 2, 3]);
  assert.deepEqual(body.mcpKnurl, { diameter: 20, length: 15, grooves: 32, pitch: Math.PI * 20 / 32, depth: Math.round(Math.PI * 20 / 32 / 2 * 1000) / 1000, bore: "hex", boreSize: 6 });
  assert.equal(result.plan.mode, "advanced");

  for (const bore of ["round", "hex", "d"]) {
    const bored = buildModelPlan(doc(), { name: "Bored", operations: [{ id: "knob", type: "knurl", diameter: 24, grooves: 24, bore, boreSize: 5 }] }, ids());
    assert.ok(bored.document.sketches[0].ents.some(({ t }) => t === (bore === "round" ? "circle" : bore === "d" ? "arc" : "line")));
  }
  assert.throws(() => normalizeModelPlan({ name: "Bad size", operations: [{ id: "k", type: "knurl", diameter: 5 }] }), /diameter must be a finite number/);
  assert.throws(() => normalizeModelPlan({ name: "Bad length", operations: [{ id: "k", type: "knurl", length: 0 }] }), /length must be a finite number/);
  assert.throws(() => normalizeModelPlan({ name: "Bad count", operations: [{ id: "k", type: "knurl", grooves: 7 }] }), /grooves must be a finite number/);
  assert.throws(() => normalizeModelPlan({ name: "Too many", operations: [{ id: "k", type: "knurl", grooves: 121 }] }), /grooves must be a finite number/);
  assert.throws(() => normalizeModelPlan({ name: "Vanished grooves", operations: [{ id: "k", type: "knurl", diameter: 20, grooves: 8, depth: 0.1 }] }), /grooves vanish/);
  assert.throws(() => normalizeModelPlan({ name: "No wall", operations: [{ id: "k", type: "knurl", diameter: 20, depth: 5, bore: "round", boreSize: 10 }] }), /boreSize must be a finite number/);
  assert.throws(() => normalizeModelPlan({ name: "Unexpected size", operations: [{ id: "k", type: "knurl", boreSize: 4 }] }), /only supported when a bore is selected/);
});

test("knurl D bores take a flat offset and an optional blind depth from the bottom face", () => {
  const result = buildModelPlan(doc(), { name: "Knob", operations: [{ id: "knob", type: "knurl", diameter: 24, length: 15, grooves: 24, bore: "d", boreSize: 6, boreFlat: 1.5, boreDepth: 10 }] }, ids());
  const sketch = result.document.sketches[0], body = result.document.bodies[0];
  const flat = sketch.ents.at(-1), xs = [flat.a, flat.b].map((id) => sketch.pts.find((p) => p.id === id).x);
  assert.deepEqual(xs, [1.5, 1.5]);
  assert.equal(body.node.mods.length, 1);
  const [fill] = body.node.mods;
  assert.deepEqual({ t: fill.t, op: fill.op, dist: fill.tool.dist, sketch: fill.tool.sketch, lift: fill.m.slice(12, 15) }, { t: "bool", op: "join", dist: 5, sketch: sketch.id, lift: [0, 0, 10] });
  assert.notEqual(fill.tool.profiles[0].key, body.node.profiles[0].key);
  assert.equal(body.mcpKnurl.boreDepth, 10);
  assert.equal(body.mcpKnurl.boreFlat, 1.5);
  const through = buildModelPlan(doc(), { name: "Knob", operations: [{ id: "knob", type: "knurl", diameter: 24, length: 15, grooves: 24, bore: "round", boreSize: 6, boreDepth: 15 }] }, ids());
  assert.deepEqual(through.document.bodies[0].node.mods, []);
  assert.throws(() => normalizeModelPlan({ name: "k", operations: [{ id: "k", type: "knurl", bore: "round", boreFlat: 1 }] }), /only supported for a D bore/);
  assert.throws(() => normalizeModelPlan({ name: "k", operations: [{ id: "k", type: "knurl", boreDepth: 4 }] }), /only supported when a bore is selected/);
  assert.throws(() => normalizeModelPlan({ name: "k", operations: [{ id: "k", type: "knurl", bore: "d", boreSize: 6, boreFlat: 3 }] }), /boreFlat must be/);
  assert.throws(() => normalizeModelPlan({ name: "k", operations: [{ id: "k", type: "knurl", length: 10, bore: "d", boreDepth: 11 }] }), /boreDepth must be/);
});

test("phone cradle rejects invalid angles, undersized rib layouts and unsupported direction values", () => {
  const base = { name: "Phone cradle", operations: [{ id: "cradle", type: "phoneCradle", width: 80, phoneLength: 140, angle: 45, plateThickness: 3, ribThickness: 8, stopHeight: 10, stopDepth: 6, topEdgeToward: "+Y", position: [0, 0, 0] }] };
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], angle: 85 }] }), /angle must be a finite number/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], width: 16, ribThickness: 8 }] }), /width must be a finite number|leave room between the two ribs/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], topEdgeToward: "+X" }] }), /topEdgeToward must be \+Y .* or -Y/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], extra: true }] }), /extra is not supported/);
});

test("ordered contours compile line, arc, and fit-point spline segments as editable native entities", () => {
  const result = buildModelPlan(doc(), {
    name: "Curved tray",
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
      { type: "line", start: [0, 0], end: [10, 0] },
      { type: "arc", start: [10, 0], through: [12, 2], end: [10, 4] },
      { type: "spline", points: [[10, 4], [5, 6], [0, 4]] },
      { type: "line", start: [0, 4], end: [0, 0] },
    ] } }],
    features: [{ id: "tray", type: "extrude", sketch: "outline", distance: 3 }],
  }, ids());
  const sketch = result.document.sketches[0];
  assert.deepEqual(sketch.ents.map(({ t }) => t), ["line", "arc", "spline", "line"]);
  assert.deepEqual(sketch.ents[2].pts.map((id) => {
    const point = sketch.pts.find(({ id: pointId }) => pointId === id);
    return [point.x, point.y];
  }), [[10, 4], [5, 6], [0, 4]]);
  assert.equal(sketch.ents[2].closed, false);
  assert.deepEqual(result.document.bodies[0].node.profiles[0].key.split(",").sort(), sketch.ents.map(({ id }) => id).sort());
});

test("a closed fit-point spline compiles to one native closed sketch entity", () => {
  const result = buildModelPlan(doc(), {
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [{ type: "spline", closed: true, points: [[0, 0], [8, 0], [8, 8], [0, 8]] }] } }],
    features: [{ id: "body", type: "extrude", sketch: "outline", distance: 2 }],
  }, ids());
  assert.deepEqual(result.document.sketches[0].ents.map(({ t, closed }) => [t, closed]), [["spline", true]]);
});

test("contours reject disconnected, degenerate, oversized, and malformed segments", () => {
  const base = { name: "Contour", sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
    { type: "line", start: [0, 0], end: [10, 0] }, { type: "line", start: [10, 0], end: [10, 10] },
    { type: "line", start: [10, 10], end: [0, 10] }, { type: "line", start: [0, 10], end: [0, 0] },
  ] } }], features: [{ id: "body", type: "extrude", sketch: "outline", distance: 2 }] };
  const profile = (segments) => ({ ...base, sketches: [{ ...base.sketches[0], profile: { type: "contour", segments } }] });
  assert.throws(() => normalizeModelPlan(profile([])), /1 to 64 ordered contour segments/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "line", start: [0, 0], end: [10, 0] }, { type: "line", start: [10.01, 0], end: [0, 0] }])), /connect in order and close/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "line", start: [0, 0], end: [10, 0] }, { type: "line", start: [10, 0], end: [0, 0] }])), /zero area/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "spline", points: [[0, 0], [1, 1]] }])), /3 to 128 fit points/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "spline", points: [[0, 0], [1, 1], [1, 1]] }])), /consecutive duplicate fit points/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "spline", closed: "yes", points: [[0, 0], [1, 1], [2, 0]] }])), /closed must be a boolean/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "spline", closed: true, points: [[0, 0], [1, 1], [2, 0]] }, ...base.sketches[0].profile.segments.slice(1)])), /closed spline must be the only/);
  assert.throws(() => normalizeModelPlan(profile([{ type: "spline", points: Array.from({ length: 129 }, (_, i) => [i, Math.sin(i)]) }])), /3 to 128 fit points/);
  assert.throws(() => normalizeModelPlan(profile(Array.from({ length: 65 }, (_, i) => ({ type: "line", start: [i, 0], end: [i + 1, 0] })))), /1 to 64 ordered contour segments/);
});

test("compiles patterned extrude cutters into one native boolean feature", () => {
  const result = buildModelPlan(doc(), {
    name: "Lock test",
    sketches: [
      { id: "base", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 49.5 } },
      { id: "slot", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[45, -2], [52, -2], [52, 2], [45, 2]] } },
    ],
    features: [
      { id: "plate", type: "extrude", sketch: "base", distance: 2.4 },
      { id: "locks", type: "extrude", sketch: "slot", distance: 2.4, operation: "cut", target: "plate", pattern: { axis: "Z", count: 2 } },
    ],
  }, ids());

  assert.equal(result.document.bodies.length, 1);
  const [body] = result.document.bodies;
  assert.equal(body.node.mods[0].op, "cut");
  assert.equal(body.node.mods[0].tool.t, "group");
  assert.equal(body.node.mods[0].tool.children.length, 2);
  assert.ok(Math.abs(body.node.mods[0].tool.children[1].m[0] + 1) < 1e-10);
  assert.deepEqual(result.featureBodyIds, { plate: body.id, locks: body.id });
});

test("replacing a generated body keeps unrelated document state and drops unused source sketches", () => {
  const current = doc();
  current.sketches = [
    { id: "old-sketch", name: "Old", pts: [], ents: [] },
    { id: "other-sketch", name: "Other", pts: [], ents: [] },
  ];
  current.bodies = [
    { id: "old-body", name: "Old", node: { t: "revolve", sketch: "old-sketch", mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    { id: "other-body", name: "Other", node: { t: "revolve", sketch: "other-sketch", mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ];
  const result = buildModelPlan(current, {
    name: "Updated lid",
    sketches: [{ id: "new", plane: "XZ", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, 0], [12, 0], [12, 2], [0, 2]] } }],
    features: [{ id: "new-body", type: "revolve", sketch: "new" }],
  }, ids(), ["old-body"]);

  assert.equal(result.document.bodies.some((body) => body.id === "old-body"), false);
  assert.equal(result.document.bodies.some((body) => body.id === "other-body"), true);
  assert.equal(result.document.sketches.some((sketch) => sketch.id === "old-sketch"), false);
  assert.equal(result.document.sketches.some((sketch) => sketch.id === "other-sketch"), true);
});

test("rejects unsafe or ambiguous model plans before they reach the editor", () => {
  const bad = {
    name: "Bad",
    sketches: [{ id: "cross", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, 0], [5, 5], [0, 5], [5, 0]] } }],
    features: [{ id: "body", type: "extrude", sketch: "cross", distance: 2 }],
  };
  assert.throws(() => normalizeModelPlan(bad), /self-intersects|zero area/);
  assert.throws(() => normalizeModelPlan({ ...bad, sketches: [{ ...bad.sketches[0], profile: { type: "circle", center: [0, 0], radius: Infinity } }] }), /finite number/);
  const valid = { ...bad, sketches: [{ ...bad.sketches[0], profile: { type: "circle", center: [0, 0], radius: 5 } }] };
  assert.throws(() => normalizeModelPlan({ ...valid, features: [{ ...bad.features[0], operation: "cut", target: "missing" }] }), /earlier body/);
});

test("revises the imported yogurt-lid STL size while preserving its mesh and bottom anchor", () => {
  const current = doc();
  current.bodies = [{ id: "imported-lid", name: "yogurt_lid_M.stl", seq: 1, locked: false, m: [], node: { t: "mesh", asset: "yogurt_lid_M.stl", keepPos: true, mods: [] } }];
  const result = resizeBodyDocument(current, "imported-lid", { min: [-49.5, -49.5, 0], max: [49.5, 49.5, 5.5] }, { x: 100, y: 100 }, "base", ids());
  const body = result.document.bodies[0];
  assert.deepEqual(result.currentSize, [99, 99, 5.5]);
  assert.deepEqual(result.targetSize, [100, 100, 5.5]);
  assert.equal(body.node.t, "mesh");
  assert.equal(body.node.asset, "yogurt_lid_M.stl");
  assert.equal(body.node.mods[0].t, "scale");
  assert.ok(Math.abs(body.node.mods[0].k[0] - 100 / 99) < 1e-8);
  assert.ok(Math.abs(body.node.mods[0].k[1] - 100 / 99) < 1e-8);
  assert.deepEqual(body.node.mods[0].o, [0, 0, 0]);
  assert.equal(current.bodies[0].node.mods.length, 0);

  const revised = resizeBodyDocument(result.document, "imported-lid", { min: [-50, -50, 0], max: [50, 50, 5.5] }, { x: 95, y: 95 }, "base", ids());
  assert.ok(Math.abs(revised.document.bodies[0].node.mods[0].k[0] - 95 / 99) < 1e-8);
  assert.ok(Math.abs(revised.document.bodies[0].node.mods[0].k[1] - 95 / 99) < 1e-8);
  assert.equal(revised.document.bodies[0].node.asset, "yogurt_lid_M.stl");
  assert.equal(result.document.bodies[0].node.mods[0].k[0], body.node.mods[0].k[0]);
});

test("rejects locked bodies, unknown axes, and invalid requested sizes", () => {
  const current = doc();
  current.bodies = [{ id: "locked", name: "Locked", locked: true, node: { t: "mesh", mods: [] } }];
  const bounds = { min: [0, 0, 0], max: [10, 20, 5] };
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { x: 11 }), /Unlock/);
  current.bodies[0].locked = false;
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { width: 11 }), /x, y, or z/);
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { x: 0 }), /finite number/);
});

test("builds typed primitives, transforms, linear patterns, and cut groups", () => {
  const result = buildModelPlan(doc(), {
    name: "Tutorial keychain",
    primitives: [
      { id: "tag", kind: "box", parameters: { w: 60, d: 25, h: 4, r: 1.5 } },
      { id: "name", kind: "text", parameters: { text: "Mia", size: 9, h: 2 }, position: [5, 0, 4] },
      { id: "hole", kind: "cylinder", parameters: { w: 6, d: 6, h: 10 }, position: [-24, 0, -2], hole: true },
    ],
    operations: [{ id: "finished", type: "group", members: ["tag", "name", "hole"], operation: "union" }],
  }, ids());
  assert.equal(result.document.mode, "beginner");
  assert.equal(result.document.bodies.length, 1);
  assert.equal(result.document.bodies[0].node.t, "group");
  assert.equal(result.document.bodies[0].node.children.length, 3);
  assert.equal(result.document.bodies[0].node.children.filter((child) => child.hole).length, 1);
  assert.equal(result.document.bodies[0].node.children.find((child) => child.node.kind === "text").node.p.size, 9);
  assert.equal(result.createdBodyIds.length, 1);

  const patterned = buildModelPlan(doc(), {
    name: "Drainage channels",
    primitives: [{ id: "channel", kind: "box", parameters: { w: 110, d: 4, h: 4 }, position: [0, 0, 3], hole: true }],
    operations: [{ id: "row", type: "pattern", source: "channel", mode: "linear", axis: "Y", count: 4, spacing: 14, symmetric: true }],
  }, ids());
  assert.equal(patterned.document.bodies.length, 7);
  assert.equal(patterned.document.bodies.filter((body) => body.hole).length, 7);

  const partialCircular = buildModelPlan(doc(), {
    name: "Partial circular pattern",
    primitives: [{ id: "source", kind: "box", parameters: { w: 2, d: 2, h: 2 }, position: [10, 0, 0] }],
    operations: [{ id: "copies", type: "pattern", source: "source", mode: "circular", axis: "Z", count: 4, angle: 135, origin: [0, 0, 0] }],
  }, ids());
  const positions = partialCircular.document.bodies.map((body) => body.m.slice(12, 15));
  assert.equal(positions.length, 4);
  assert.ok(Math.abs(positions[3][0] + Math.sqrt(50)) < 1e-8);
  assert.ok(Math.abs(positions[3][1] - Math.sqrt(50)) < 1e-8);
});

test("feature patterns remap native hole points and sketch-backed boolean transforms in body coordinates", () => {
  const current = { ...doc(), mode: "advanced" };
  const plan = {
    name: "Repeated vents",
    primitives: [{ id: "plate", kind: "box", parameters: { w: 20, d: 10, h: 8 }, position: [10, 0, 0] }],
    sketches: [{ id: "cutter", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 1 } }],
    features: [{ id: "sketch-cut", type: "extrude", sketch: "cutter", distance: 8, operation: "cut", target: "plate" }],
    operations: [
      { id: "mount-hole", type: "modifier", target: "plate", modifier: { type: "hole", at: [{ p: [0, 0, 8], n: [0, 0, 1] }], diameter: 2, through: true } },
      { id: "repeat", type: "featurePattern", target: "plate", features: ["mount-hole", "sketch-cut"], mode: "linear", axis: "X", count: 3, spacing: 6, symmetric: true },
    ],
  };
  const makeId = ids();
  const compiled = buildModelPlan(current, plan, makeId);
  const body = compiled.document.bodies[0];
  assert.equal(body.node.mods.length, 2);
  assert.equal(compiled.pendingFeaturePatterns.length, 1);
  assert.deepEqual(compiled.pendingFeaturePatterns[0].featureRefs, ["mount-hole", "sketch-cut"]);
  const summaries = applyFeaturePatterns(compiled.document, compiled.pendingFeaturePatterns, makeId);
  assert.deepEqual(summaries, [{ id: "repeat", bodyId: body.id, sourceFeatures: ["mount-hole", "sketch-cut"], instances: 5, featureCopies: 8 }]);
  const holes = body.node.mods.filter((mod) => mod.t === "hole");
  assert.equal(holes.length, 5);
  assert.deepEqual(holes.map((mod) => mod.at[0].p[0]).sort((a, b) => a - b), [-12, -6, 0, 6, 12]);
  assert.ok(holes.every((mod) => mod.at[0].n.join(",") === "0,0,1"));
  const cuts = body.node.mods.filter((mod) => mod.t === "bool");
  assert.equal(cuts.length, 5);
  assert.ok(cuts.every((mod) => mod.tool.sketch === compiled.document.sketches[0].id));
  assert.deepEqual(cuts.map((mod) => mod.m[12] + 10).sort((a, b) => a - b), [-12, -6, 0, 6, 12]);
  assert.equal(new Set(body.node.mods.map((mod) => mod.id)).size, body.node.mods.length);
  assert.ok(body.node.mods.every((mod) => Number.isInteger(mod.seq)));
});

test("feature patterns reject unknown, unsupported, duplicate, and excessive references", () => {
  const base = { name: "Feature pattern", primitives: [{ id: "plate", kind: "box" }], operations: [{ id: "repeat", type: "featurePattern", target: "plate", features: ["feature"], mode: "linear", axis: "X", count: 3, spacing: 4 }] };
  assert.throws(() => buildModelPlan(doc(), base, ids()), /references unknown feature/);
  const unsupported = { ...base, operations: [{ id: "shell", type: "modifier", target: "plate", modifier: { type: "shell", thickness: 1, faces: [] } }, base.operations[0]] };
  unsupported.operations[1] = { ...base.operations[0], features: ["shell"] };
  assert.throws(() => buildModelPlan(doc(), unsupported, ids()), /unsupported feature type shell/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], features: ["feature", "feature"] }] }), /must not contain duplicates/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], count: 13 }] }), /count must be a finite number/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], mode: "linear", symmetric: true, count: 12, features: Array.from({ length: 12 }, (_, index) => `f${index}`) }] }), /more than 256 feature copies/);
});

test("feature patterns accept inspected native feature ids on existing bodies", () => {
  const current = { ...doc(), mode: "advanced", bodies: [{ id: "existing", name: "Existing", seq: 1, m: [1,0,0,0,0,1,0,0,0,0,1,0,10,0,0,1], node: { t: "prim", kind: "box", p: { w: 20, d: 10, h: 8 }, mods: [{ id: "native-hole", seq: 2, t: "hole", dia: 2, through: true, at: [{ p: [0, 0, 4], n: [0, 0, 1] }] }] } }] };
  const compiled = buildModelPlan(current, { name: "Vent plate", operations: [{ id: "vents", type: "featurePattern", target: "existing", features: ["native-hole"], mode: "linear", axis: "X", count: 3, spacing: 3 }] }, ids());
  applyFeaturePatterns(compiled.document, compiled.pendingFeaturePatterns, ids());
  const holes = compiled.document.bodies[0].node.mods;
  assert.equal(holes.length, 3);
  assert.deepEqual(holes.map((mod) => mod.at[0].p.map((value) => +value.toFixed(6))), [[0, 0, 4], [3, 0, 4], [6, 0, 4]]);
  assert.equal(new Set(holes.map((mod) => mod.id)).size, 3);
});

test("splits one body into native halfspace bodies and maps the operation to both", () => {
  const result = buildModelPlan(doc(), {
    name: "Split box",
    primitives: [{ id: "box", kind: "box", parameters: { w: 20, d: 20, h: 20 }, position: [10, 0, 0] }],
    operations: [{ id: "halves", type: "splitBody", target: "box", plane: { origin: [10, 0, 0], normal: [0, 0, 4] } }],
  }, ids());
  const [source, other] = result.document.bodies;
  assert.equal(source.id, "b-1");
  assert.equal(source.node.mods.at(-1).t, "halfspace");
  assert.equal(source.node.mods.at(-1).side, 1);
  assert.deepEqual(source.node.mods.at(-1).plane, { o: [0, 0, 0], n: [0, 0, 1] });
  assert.equal(other.node.mods.at(-1).t, "halfspace");
  assert.equal(other.node.mods.at(-1).side, -1);
  assert.equal(other.m[12], source.m[12]);
  assert.deepEqual(result.featureBodyIds.halves, [source.id, other.id]);
  assert.deepEqual(result.affectedBodyIds, [source.id, other.id]);
  assert.deepEqual(result.createdBodyIds, [source.id, other.id]);
});

test("patterns native bodies along typed open and closed paths while preserving the source transform", () => {
  const open = buildModelPlan(doc(), {
    name: "Clip row",
    primitives: [{ id: "clip", kind: "box", parameters: { w: 4, d: 3, h: 2 }, position: [5, 2, 0] }],
    sketches: [{ id: "route", plane: "XY", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [20, 0] }] }],
    operations: [{ id: "clips", type: "pathPattern", source: "clip", path: "route", mode: "fit", count: 3 }],
  }, ids());
  assert.equal(open.document.bodies.length, 3);
  assert.deepEqual(open.document.bodies.map((body) => body.m.slice(12, 15)), [[5, 2, 0], [12.5, 2, 0], [20, 2, 0]]);
  assert.equal(open.document.bodies[0].node.kind, "box");
  assert.deepEqual(open.featureBodyIds.clips, open.document.bodies.map((body) => body.id));
  assert.deepEqual(open.affectedBodyIds, open.createdBodyIds);

  const closed = buildModelPlan(doc(), {
    name: "Perimeter clips",
    primitives: [{ id: "clip", kind: "box", parameters: { w: 4, d: 3, h: 2 }, position: [10, 0, 0] }],
    sketches: [{ id: "loop", plane: "XY", origin: [0, 0, 0], segments: [
      { type: "line", start: [10, 0], end: [0, 10] }, { type: "line", start: [0, 10], end: [-10, 0] },
      { type: "line", start: [-10, 0], end: [0, -10] }, { type: "line", start: [0, -10], end: [10, 0] },
    ] }],
    operations: [{ id: "clips", type: "pathPattern", source: "clip", path: "loop", mode: "fit", count: 4, direction: "reverse" }],
  }, ids());
  assert.equal(closed.document.bodies.length, 4);
  assert.deepEqual(closed.document.bodies.map((body) => body.m.slice(12, 15)), [[10, 0, 0], [0, -10, 0], [-10, 0, 0], [0, 10, 0]]);

  const followed = buildModelPlan(doc(), {
    name: "Bend clips",
    primitives: [{ id: "clip", kind: "box", position: [0, 0, 0] }],
    sketches: [{ id: "route", plane: "XY", origin: [0, 0, 0], segments: [
      { type: "line", start: [0, 0], end: [10, 0] }, { type: "arc", start: [10, 0], through: [15, 5], end: [10, 10] },
    ] }],
    operations: [{ id: "clips", type: "pathPattern", source: "clip", path: "route", mode: "fit", count: 2, orientation: "follow-path" }],
  }, ids());
  assert.ok(Math.abs(followed.document.bodies[1].m[0] + 1) < 1e-8);
});

test("path patterns validate path references, fit limits, spacing, anchor and orientation", () => {
  const base = {
    name: "Path clips",
    primitives: [{ id: "clip", kind: "box" }],
    sketches: [{ id: "route", plane: "XY", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [10, 0] }] }],
    operations: [{ id: "copies", type: "pathPattern", source: "clip", path: "route", mode: "spacing", spacing: 3, count: 3 }],
  };
  assert.equal(normalizeModelPlan(base).operations[0].spacing, 3);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], path: "missing" }] }), /earlier path sketch/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], mode: "fit", spacing: 3 }] }), /only supported in spacing mode/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], mode: "spacing", spacing: undefined }] }), /spacing is required/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], count: 13 }] }), /count must be a finite number between 2 and 12/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], orientation: "free" }] }), /orientation must be same or follow-path/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], anchor: [0, 0, Infinity] }] }), /finite number/);
  assert.throws(() => buildModelPlan(doc(), { ...base, operations: [{ ...base.operations[0], spacing: 6 }] }, ids()), /exceeds the available length/);
  const full = doc(); full.bodies = Array.from({ length: 128 }, (_, i) => ({ id: `b${i}`, name: "Full", m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", mods: [] } }));
  assert.throws(() => buildModelPlan(full, { ...base, operations: [{ ...base.operations[0], source: "b0" }] }, ids()), /would exceed 128 document bodies/);
});

test("split validates strict planes, target uniqueness, locks, and output limits", () => {
  const base = { name: "Split", primitives: [{ id: "box", kind: "box" }], operations: [{ id: "halves", type: "splitBody", target: "box", plane: { origin: [0, 0, 0], normal: [0, 0, 1] } }] };
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], plane: { origin: [0, 0, 0], normal: [0, 0, 0] } }] }), /normal must not be zero/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], plane: { normal: [0, 0, 1] } }] }), /plane.origin/);
  assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], plane: { origin: [0, 0, 0], normal: [0, 0, 1], side: 1 } }] }), /side is not supported/);
  assert.throws(() => buildModelPlan(doc(), { ...base, operations: [{ ...base.operations[0], target: "missing" }] }, ids()), /unknown or later body/);
  assert.throws(() => buildModelPlan(doc(), { ...base, operations: [{ id: "first", type: "splitBody", target: "box", plane: base.operations[0].plane }, { id: "again", type: "splitBody", target: "first", plane: base.operations[0].plane }] }, ids()), /exactly one unambiguous target/);
  const locked = doc(); locked.bodies = [{ id: "locked", name: "Locked", locked: true, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", p: { w: 2, d: 2, h: 2 }, mods: [] } }];
  assert.throws(() => buildModelPlan(locked, { name: "Locked split", operations: [{ id: "halves", type: "splitBody", target: "locked", plane: base.operations[0].plane }] }, ids()), /Unlock body/);
  const full = doc(); full.bodies = Array.from({ length: 128 }, (_, i) => ({ id: `b${i}`, name: "Full", m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", mods: [] } }));
  assert.throws(() => buildModelPlan(full, { name: "Full split", operations: [{ id: "halves", type: "splitBody", target: "b0", plane: base.operations[0].plane }] }, ids()), /would exceed 128 document bodies/);
});

test("builds native loft, shell, thread, and emboss features from validated plan operations", () => {
  const result = buildModelPlan(doc(), {
    name: "Tutorial vase",
    sketches: [
      { id: "base", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 15 } },
      { id: "mid", plane: "XY", origin: [0, 0, 40], profile: { type: "circle", center: [0, 0], radius: 22.5 } },
      { id: "top", plane: "XY", origin: [0, 0, 80], profile: { type: "circle", center: [0, 0], radius: 12.5 } },
    ],
    planes: [{ id: "plane-1", plane: "XY", origin: [0, 0, 40] }, { id: "plane-2", plane: "XY", origin: [0, 0, 80] }],
    features: [{ id: "body", type: "loft", sections: ["base", "mid", "top"] }],
    operations: [{ id: "hollow", type: "modifier", target: "body", modifier: { type: "shell", thickness: 2, faces: [] } }],
  }, ids());
  assert.equal(result.document.planes.length, 2);
  assert.equal(result.document.bodies[0].node.t, "loft");
  assert.equal(result.document.bodies[0].node.sections.length, 3);
  assert.equal(result.document.bodies[0].node.mods[0].t, "shell");
  assert.equal(result.document.bodies[0].node.mods[0].th, 2);

  const detailed = buildModelPlan(doc(), {
    name: "Marked body",
    primitives: [{ id: "body", kind: "cylinder", parameters: { w: 20, d: 20, h: 10 } }],
    operations: [
      { id: "thread", type: "modifier", target: "body", modifier: { type: "thread", face: { c: [0, 0, 5], t: "CYLINDRE" }, pitch: 1, length: 0 } },
      { id: "label", type: "modifier", target: "body", modifier: { type: "emboss", geo: { kind: "plane", p: [0, 0, 10], n: [0, 0, 1], x: [1, 0, 0] }, text: "M3", size: 5, depth: 0.6 } },
    ],
  }, ids());
  assert.deepEqual(detailed.document.bodies[0].node.mods.map((mod) => mod.t), ["thread", "emboss"]);
});

test("coil features compile to native editable nodes with body placement and new/join/cut operations", () => {
  const result = buildModelPlan(doc(), {
    name: "Coil features",
    primitives: [{ id: "base", kind: "box", parameters: { w: 30, d: 30, h: 4 } }],
    features: [
      { id: "spring", type: "coil", d: 12, turns: 4.5, mode: "pitch", pitch: 4, section: "square", size: 2, pos: "on", left: true, position: [40, 0, 0], rotation: [0, 90, 0] },
      { id: "joined", type: "coil", operation: "join", target: "base", d: 12, turns: 4, mode: "height", h: 20, section: "triangle-in", size: 2, pos: "on" },
      { id: "cut", type: "coil", operation: "cut", target: "base", d: 12, turns: 4, mode: "pitch", pitch: 4, section: "circle", size: 2, pos: "on" },
    ],
  }, ids());
  const spring = result.document.bodies.find((body) => body.node.t === "coil");
  assert.deepEqual(spring.node, { t: "coil", d: 12, turns: 4.5, mode: "pitch", pitch: 4, angle: 0, section: "square", size: 2, pos: "on", left: true, mods: [] });
  assert.equal(spring.m[12], 40);
  assert.ok(Math.abs(spring.m[8] - 1) < 1e-8, "Y rotation directs the local +Z coil axis toward +X");
  const base = result.document.bodies.find((body) => body.node.t === "prim");
  assert.deepEqual(base.node.mods.map((mod) => mod.op), ["join", "cut"]);
  assert.deepEqual(base.node.mods.map((mod) => mod.tool.t), ["coil", "coil"]);
  assert.deepEqual({ spring: result.featureBodyIds.spring, joined: result.featureBodyIds.joined, cut: result.featureBodyIds.cut }, { spring: spring.id, joined: base.id, cut: base.id });
});

test("coil plans reject invalid dimensions, modes, clearance, and collapsed tapered ends", () => {
  const base = { name: "Invalid coil", features: [{ id: "coil", type: "coil" }] };
  for (const override of [
    { d: 0 }, { size: -1 }, { turns: 101 }, { turns: 0.1 }, { mode: "distance" },
    { section: "pentagon" }, { pos: "center" }, { left: "yes" }, { angle: 61 },
    { mode: "pitch", pitch: 1 }, { mode: "height", h: 8 },
    { d: 4, size: 2, mode: "pitch", pitch: 4, pos: "inside" },
    { d: 12, size: 2, mode: "pitch", pitch: 4, angle: -20 },
  ]) {
    assert.throws(() => buildModelPlan(doc(), { ...base, features: [{ ...base.features[0], ...override }] }, ids()), /coil|features\[0\]/i, JSON.stringify(override));
  }
});

test("adds typed modifiers to an existing body without replacing its source geometry", () => {
  const current = doc();
  current.mode = "advanced";
  current.bodies = [{ id: "imported", name: "Imported mesh", locked: false, hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "mesh", asset: "source-asset", keepPos: true, mods: [] } }];
  const result = buildModelPlan(current, {
    name: "Imported mesh updated",
    operations: [{ id: "new-scale", type: "modifier", target: "imported", modifier: { type: "scale", factors: [1.1, 1.1, 1], offset: [0, 0, 0] } }],
  }, ids());
  assert.equal(result.plan.mode, "advanced");
  assert.equal(result.document.bodies[0].node.t, "mesh");
  assert.equal(result.document.bodies[0].node.asset, "source-asset");
  assert.equal(result.document.bodies[0].node.mods[0].t, "scale");
  assert.deepEqual(result.createdBodyIds, []);
  assert.deepEqual(result.affectedBodyIds, ["imported"]);
});

test("compiles signed face offsets to an editable native modifier using geometric signatures", () => {
  const result = buildModelPlan(doc(), {
    name: "Offset block face",
    primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 20, h: 10 } }],
    operations: [{ id: "press-pull", type: "modifier", target: "block", modifier: { type: "offset", distance: -2, faces: [{ c: [0, 0, 5], n: [0, 0, 1], t: "PLANE" }] } }],
  }, ids());
  assert.deepEqual(result.document.bodies[0].node.mods[0], {
    id: "f-2", seq: 2, t: "offset", d: -2, faces: [{ c: [0, 0, 5], n: [0, 0, 1], t: "PLANE" }],
  });
  assert.deepEqual(result.affectedBodyIds, [result.document.bodies[0].id]);

  const curved = normalizeModelPlan({ name: "Offset cylinder", primitives: [{ id: "cylinder", kind: "cylinder" }], operations: [{ id: "offset", type: "modifier", target: "cylinder", modifier: { type: "offset", distance: 1, faces: [{ c: [0, 0, 10], t: "CYLINDRE" }] } }] });
  assert.deepEqual(curved.operations[0].modifier.faces, [{ c: [0, 0, 10], t: "CYLINDRE" }]);
});

test("offset modifiers reject zero distances, unsupported surfaces, missing selectors, and face indexes", () => {
  const base = { name: "Offset", primitives: [{ id: "block", kind: "box" }], operations: [{ id: "offset", type: "modifier", target: "block", modifier: { type: "offset", distance: 1, faces: [{ c: [0, 0, 10], t: "PLANE" }] } }] };
  for (const modifier of [
    { ...base.operations[0].modifier, distance: 0 },
    { ...base.operations[0].modifier, faces: [] },
    { ...base.operations[0].modifier, faces: [{ c: [0, 0, 10], t: "CONE" }] },
    { ...base.operations[0].modifier, faces: [{ c: [0, 0, 10], t: "PLANE", n: [0, 0, 0] }] },
    { ...base.operations[0].modifier, faces: [{ index: 2, c: [0, 0, 10], t: "PLANE" }] },
  ]) assert.throws(() => normalizeModelPlan({ ...base, operations: [{ ...base.operations[0], modifier }] }), /offset|faces|distance|not supported/i);
});

test("rejects unsupported plan fields and ambiguous modifier inputs", () => {
  assert.throws(() => normalizeModelPlan({ name: "Bad", python: "run me", primitives: [{ id: "b", kind: "box" }] }), /not supported/);
  assert.throws(() => normalizeModelPlan({ name: "Bad", primitives: [{ id: "b", kind: "box", hole: "yes" }] }), /hole must be a boolean/);
  assert.throws(() => normalizeModelPlan({
    name: "Bad",
    primitives: [{ id: "b", kind: "box" }],
    operations: [{ id: "shell", type: "modifier", target: "b", modifier: { type: "shell", thickness: 2, direction: "sideways", faces: [] } }],
  }), /direction must be in, out, or both/);
});

test("every operation type has a module that normalizes and builds it", () => {
  const types = Object.keys(OPERATION_TYPES);
  for (const type of types) {
    assert.equal(typeof OPERATION_TYPES[type].normalize, "function", type);
    assert.equal(typeof OPERATION_TYPES[type].build, "function", type);
  }
  assert.throws(() => normalizeModelPlan({ operations: [{ id: "x", type: "unknown" }] }), (error) => types.every((type) => error.message.includes(type)));
});
