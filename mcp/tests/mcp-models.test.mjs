import test from "node:test";
import assert from "node:assert/strict";
import { compileMcpModel, refreshMcpModelBodyState, reviseMcpParameters } from "../browser/plans/models.js";
import { validateToolInput } from "../shared/schema.js";

const doc = () => ({ id: "d1", name: "Untitled", seq: 0, mode: "beginner", bodies: [], sketches: [], planes: [], joints: [] });
const plan = {
  name: "Named coaster", modelId: "coaster", parameters: { diameter: { value: 100, unit: "mm", min: 10, max: 500 }, floor: { value: 3, unit: "mm" }, depth: { value: 3, unit: "mm" }, thickness: { expression: "floor + depth", unit: "mm" } },
  primitives: [{ id: "base", kind: "cylinder", parameters: { w: { $expr: "diameter" }, d: { $expr: "diameter" }, h: { $expr: "thickness" } } }],
};
test("parameter revision survives native serialization, keeps root identities and unrelated bodies", () => {
  const initial = compileMcpModel(doc(), plan);
  const snapshot = JSON.stringify(initial.document);
  const saved = JSON.parse(snapshot);
  saved.bodies[0]._key = "native runtime cache is not a user edit";
  saved.bodies.push({ id: "unrelated", node: { t: "prim", kind: "box", p: { w: 1, d: 1, h: 1 } } });
  const revised = reviseMcpParameters(saved, "coaster", { diameter: 110 });
  assert.equal(revised.document.bodies.length, 2);
  assert.equal(revised.document.bodies[1].node.p.w, 110);
  assert.equal(revised.document.bodies[1].id, initial.document.bodies[0].id);
  assert.deepEqual(revised.document.bodies[0], saved.bodies[1]);
  assert.equal(revised.parameters.thickness.value, 6);
  assert.equal(revised.document.mcpModels[0].template.parameters.diameter.value, 110);
  assert.equal(JSON.stringify(initial.document), snapshot);
  assert.equal(revised.diff.parameters[0].name, "diameter");
});
test("native edits, locked bodies and external dependencies cannot be silently overwritten", () => {
  const built = compileMcpModel(doc(), plan);
  built.document.bodies[0].node.p.h = 9;
  assert.throws(() => reviseMcpParameters(built.document, "coaster", { diameter: 110 }), /outside/);
  const fresh = compileMcpModel(doc(), plan);
  fresh.document.bodies.push({ id: "mirror", node: { t: "mirror", srcBody: fresh.createdBodyIds[0] } });
  assert.throws(() => reviseMcpParameters(fresh.document, "coaster", { diameter: 110 }), /depends/);
});
test("parametric hole patterns retain stable body identity and recognize their generated native feature", () => {
  const withPattern = {
    name: "Parametric plate", modelId: "plate", parameters: { width: { value: 60, unit: "mm", min: 20, max: 100 } },
    primitives: [{ id: "plateBody", kind: "box", parameters: { w: { $expr: "width" }, d: 40, h: 6 } }],
    operations: [{ id: "vents", type: "holePattern", target: "plateBody", face: "+z", layout: { type: "grid", cols: 3, rows: 2 }, hole: { diameter: 3 } }],
  };
  const initial = compileMcpModel(doc(), withPattern);
  const bodyId = initial.createdBodyIds[0];
  assert.equal(initial.pendingHolePatterns[0].bodyId, bodyId);
  initial.document.bodies[0].node.mods.push({ id: "native-hole", seq: 8, t: "hole", at: [] });
  refreshMcpModelBodyState(initial.document, initial.modelId);

  const revised = reviseMcpParameters(initial.document, "plate", { width: 80 });
  assert.equal(revised.createdBodyIds[0], bodyId);
  assert.equal(revised.pendingHolePatterns[0].bodyId, bodyId);
  assert.equal(revised.document.bodies[0].node.p.w, 80);
});
test("parameterized shaped patterns own and replace their generated native sketches", () => {
  const withSlots = {
    name: "Parametric slot plate", modelId: "slot-plate", parameters: { width: { value: 30, unit: "mm", min: 20, max: 100 } },
    primitives: [{ id: "plate", kind: "box", parameters: { w: { $expr: "width" }, d: 30, h: 6 } }],
    operations: [{ id: "slots", type: "holePattern", target: "plate", face: "+z", layout: { type: "grid", cols: 2, rows: 1, pitch: 12 }, shape: "slot", width: 4, length: 10 }],
  };
  const attachPatternSketch = (compiled) => {
    const pattern = compiled.pendingHolePatterns[0], body = compiled.document.bodies.find((entry) => entry.id === pattern.bodyId);
    compiled.document.sketches.push({ id: pattern.sketchId, name: "Slots", seq: pattern.sketchSeq, plane: { o: [0, 0, 6], x: [1, 0, 0], n: [0, 0, 1] }, pts: [{ id: `${pattern.sketchId}-p`, x: 0, y: 0 }], ents: [], hidden: true });
    body.node.mods.push({ id: pattern.featureId, seq: pattern.seq, t: "bool", op: "cut", tool: { t: "extrude", sketch: pattern.sketchId }, m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] });
    refreshMcpModelBodyState(compiled.document, compiled.modelId);
  };
  const initial = compileMcpModel(doc(), withSlots);
  attachPatternSketch(initial);
  const sketchId = initial.document.mcpModels[0].sketchIds.at(-1);
  assert.equal(sketchId, initial.pendingHolePatterns[0].sketchId);

  const tampered = structuredClone(initial.document);
  tampered.sketches.find((entry) => entry.id === sketchId).pts[0].x = 1;
  assert.throws(() => reviseMcpParameters(tampered, "slot-plate", { width: 40 }), /outside/);

  const revised = reviseMcpParameters(initial.document, "slot-plate", { width: 40 });
  assert.equal(revised.createdBodyIds[0], initial.createdBodyIds[0]);
  assert.equal(revised.document.sketches.length, 0);
  assert.notEqual(revised.pendingHolePatterns[0].sketchId, sketchId);
  attachPatternSketch(revised);
  const revisedAgain = reviseMcpParameters(revised.document, "slot-plate", { width: 50 });
  assert.equal(revisedAgain.document.sketches.length, 0);
});
test("chamfer modifiers compile to native editable chamfer nodes and reject invalid input", () => {
  const signature = { a: [0, 0, 0], b: [0, 0, 10], m: [0, 0, 5], n: [0, 0.5, 0.5], t: "LINE" };
  const chamferPlan = {
    name: "Beveled block", primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 20, h: 10 } }],
    operations: [{ id: "bevel", type: "modifier", target: "block", modifier: { type: "chamfer", distance: 1.25, edges: [signature] } }],
  };
  const compiled = compileMcpModel(doc(), chamferPlan);
  const chamfer = compiled.document.bodies[0].node.mods[0];
  assert.match(chamfer.id, /^f/);
  assert.deepEqual({ seq: chamfer.seq, t: chamfer.t, d: chamfer.d, edges: chamfer.edges, chain: chamfer.chain }, {
    seq: 2, t: "chamfer", d: 1.25, edges: [signature], chain: true,
  });
  assert.throws(() => compileMcpModel(doc(), { ...chamferPlan, operations: [{ ...chamferPlan.operations[0], modifier: { ...chamferPlan.operations[0].modifier, distance: 0 } }] }), /distance must be a finite number between 0.001 and 10000/);
  assert.throws(() => compileMcpModel(doc(), { ...chamferPlan, operations: [{ ...chamferPlan.operations[0], modifier: { ...chamferPlan.operations[0].modifier, edges: [] } }] }), /must contain 1 to 512 edge signatures/);
});
test("mirror plans compile linked body nodes and native join modifiers with normalized planes", () => {
  const source = { id: "block", kind: "box", parameters: { w: 20, d: 10, h: 8 }, position: [15, 0, 0] };
  const linked = compileMcpModel(doc(), { name: "Linked mirror", primitives: [source], operations: [{ id: "mirror", type: "mirror", source: "block", plane: { origin: [0, 0, 0], normal: [4, 0, 0] } }] });
  assert.equal(linked.document.bodies.length, 2);
  assert.deepEqual(linked.document.bodies[1].node, { t: "mirror", srcBody: linked.document.bodies[0].id, plane: { o: [0, 0, 0], n: [1, 0, 0] }, mods: [] });
  assert.equal(linked.document.bodies[1].color, linked.document.bodies[0].color);
  const joined = compileMcpModel(doc(), { name: "Joined mirror", primitives: [source], operations: [{ id: "mirror", type: "mirror", source: "block", plane: { normal: [1, 0, 0] }, behavior: "join" }] });
  const modifier = joined.document.bodies[0].node.mods[0];
  assert.equal(joined.document.bodies.length, 1);
  assert.deepEqual({ t: modifier.t, op: modifier.op, tool: modifier.tool.t, plane: modifier.tool.plane }, { t: "bool", op: "join", tool: "mirror", plane: { o: [0, 0, 0], n: [1, 0, 0] } });
});
test("mirror plans reject bad references, zero normals, locked bodies and linked mirrors as sources", () => {
  const base = { name: "Mirror", primitives: [{ id: "block", kind: "box" }], operations: [{ id: "mirror", type: "mirror", source: "block", plane: { normal: [1, 0, 0] } }] };
  assert.throws(() => compileMcpModel(doc(), { ...base, operations: [{ ...base.operations[0], source: "missing" }] }), /unknown or later body/);
  assert.throws(() => compileMcpModel(doc(), { ...base, operations: [{ ...base.operations[0], plane: { normal: [0, 0, 0] } }] }), /normal must not be zero/);
  const locked = doc(); locked.bodies.push({ id: "fixed", locked: true, m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: {} } });
  assert.throws(() => compileMcpModel(locked, { name: "Locked", operations: [{ id: "mirror", type: "mirror", source: "fixed", plane: { normal: [1, 0, 0] } }] }), /Unlock/);
  const linked = compileMcpModel(doc(), base);
  const linkedId = linked.createdBodyIds[0];
  assert.throws(() => compileMcpModel(linked.document, { name: "Nested", operations: [{ id: "nested", type: "mirror", source: linked.featureBodyIds.mirror, plane: { normal: [1, 0, 0] } }] }), /not itself a linked mirror/);
  assert.ok(linkedId);
});
test("parameterized body splits retain the identities of both native outputs", () => {
  const plan = {
    name: "Parametric split block", modelId: "split-block", parameters: { width: { value: 20, unit: "mm", min: 10, max: 100 } },
    primitives: [{ id: "block", kind: "box", parameters: { w: { $expr: "width" }, d: 10, h: 8 } }],
    operations: [{ id: "halves", type: "splitBody", target: "block", plane: { origin: [0, 0, 0], normal: [1, 0, 0] } }],
  };
  const initial = compileMcpModel(doc(), plan);
  const initialIds = initial.featureBodyIds.halves;
  assert.equal(initialIds.length, 2);
  const revised = reviseMcpParameters(initial.document, "split-block", { width: 40 });
  assert.deepEqual(revised.featureBodyIds.halves, initialIds);
  assert.deepEqual(revised.createdBodyIds, initialIds);
  assert.equal(revised.document.bodies.find((body) => body.id === initialIds[0]).node.p.w, 40);
});
test("sweep and pipe plans compile editable path sketches and preserve feature operations", () => {
  const plan = {
    name: "Bent handle",
    sketches: [
      { id: "profile", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 2 } },
      { id: "rail", plane: "XZ", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 20] }, { type: "line", start: [0, 20], end: [12, 20] }] },
      { id: "tubeRail", plane: "XY", origin: [30, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 10] }, { type: "arc", start: [0, 10], through: [5, 15], end: [10, 10] }] },
    ],
    features: [
      { id: "handle", type: "sweep", sketch: "profile", path: "rail" },
      { id: "tube", type: "pipe", path: "tubeRail", section: "square", size: 8, hollow: true, wall: 1 },
    ],
  };
  const compiled = compileMcpModel(doc(), plan);
  assert.equal(compiled.document.sketches.length, 3);
  assert.equal(compiled.document.bodies[0].node.t, "sweep");
  assert.equal(compiled.document.bodies[0].node.path.sketch, compiled.document.sketches[1].id);
  assert.equal(compiled.document.bodies[0].node.path.ents.length, 2);
  assert.equal(compiled.document.bodies[1].node.t, "pipe");
  assert.equal(compiled.document.bodies[1].node.hollow, true);
  assert.equal(compiled.document.bodies[1].node.wall, 1);
  const joined = compileMcpModel(doc(), { ...plan, features: [{ id: "base", type: "extrude", sketch: "profile", distance: 5 }, { id: "joined", type: "pipe", path: "tubeRail", size: 3, operation: "join", target: "base" }] });
  assert.equal(joined.document.bodies.length, 1);
  assert.equal(joined.document.bodies[0].node.mods[0].t, "bool");
  assert.equal(joined.document.bodies[0].node.mods[0].op, "join");
  assert.equal(joined.document.bodies[0].node.mods[0].tool.t, "pipe");
});
test("sweep and pipe plans reject disconnected, degenerate, profile-mismatched paths and invalid walls", () => {
  const base = {
    name: "Bad path",
    sketches: [
      { id: "profile", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 2 } },
      { id: "rail", plane: "XZ", origin: [0, 0, 0], segments: [{ type: "line", start: [0, 0], end: [0, 10] }] },
    ],
    features: [{ id: "sweep", type: "sweep", sketch: "profile", path: "rail" }],
  };
  assert.throws(() => compileMcpModel(doc(), { ...base, sketches: [base.sketches[0], { ...base.sketches[1], segments: [{ type: "line", start: [0, 0], end: [0, 0] }] }] }), /zero length/);
  assert.throws(() => compileMcpModel(doc(), { ...base, sketches: [base.sketches[0], { ...base.sketches[1], segments: [{ type: "line", start: [0, 0], end: [0, 10] }, { type: "line", start: [2, 10], end: [4, 10] }] }] }), /connected in order/);
  assert.throws(() => compileMcpModel(doc(), { ...base, features: [{ ...base.features[0], sketch: "rail" }] }), /closed profile sketch/);
  assert.throws(() => compileMcpModel(doc(), { ...base, features: [{ id: "pipe", type: "pipe", path: "rail", size: 4, hollow: true, wall: 2 }] }), /too thick/);
  assert.throws(() => compileMcpModel(doc(), { ...base, sketches: [base.sketches[0], { ...base.sketches[1], segments: [{ type: "arc", start: [0, 0], through: [1, 1], end: [2, 2] }] }] }), /degenerate arc/);
});
test("saved parameter models cannot depend on an external mirror source", () => {
  const d = doc(); d.bodies.push({ id: "external", name: "Existing", m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: {} } });
  assert.throws(() => compileMcpModel(d, { name: "Dependent", modelId: "dependent", parameters: { width: { value: 20, unit: "mm" } }, primitives: [{ id: "owned", kind: "box", parameters: { w: { $expr: "width" } } }], operations: [{ id: "mirror", type: "mirror", source: "external", plane: { normal: [1, 0, 0] } }] }), /must own the bodies they mirror/);
});
test("runtime tool schema rejects unknown keys, nonfinite values and excessive arrays", () => {
  const schema = { type: "object", additionalProperties: false, required: ["value"], properties: { value: { oneOf: [{ type: "number", minimum: 0 }, { type: "object", additionalProperties: false, required: ["$expr"], properties: { $expr: { type: "string", maxLength: 32 } } }] } } };
  validateToolInput({ value: { $expr: "diameter / 2" } }, schema);
  for (const value of [{ value: NaN }, { value: -1 }, { value: 1, unexpected: true }, {}, JSON.parse('{"value":1,"__proto__":{}}')]) assert.throws(() => validateToolInput(value, schema));
});
test("unused owned guide sketches do not accumulate across parameter revisions", () => {
  const withGuide = { ...structuredClone(plan), sketches: [{ id: "guide", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: { $expr: "diameter / 2" } } }] };
  const initial = compileMcpModel(doc(), withGuide);
  const second = reviseMcpParameters(initial.document, "coaster", { diameter: 110 });
  const third = reviseMcpParameters(second.document, "coaster", { diameter: 120 });
  assert.equal(third.document.sketches.length, 1);
  assert.equal(third.document.mcpModels[0].sketchIds.length, 1);
});
test("parameter plans cannot consume external bodies, including locked group members", () => {
  const d = doc();
  d.bodies.push({ id: "external", name: "Existing", m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: { w: 1, d: 1, h: 1 }, mods: [] } });
  const grouped = { ...structuredClone(plan), operations: [{ id: "combined", type: "group", members: ["base", "external"] }] };
  assert.throws(() => compileMcpModel(d, grouped), /own their bodies/);
  d.bodies[0].locked = true;
  const { parameters, ...plain } = grouped;
  plain.primitives = [{ id: "base", kind: "box", parameters: { w: 2, d: 2, h: 2 } }];
  assert.throws(() => compileMcpModel(d, plain), /Unlock/);
});

test("compiling a plan leaves the document's editor mode alone", () => {
  const compiled = compileMcpModel(doc(), { name: "Block", mode: "advanced", primitives: [{ id: "block", kind: "box", parameters: { w: 10, d: 10, h: 10 } }] });
  assert.equal(compiled.plan.mode, "advanced");
  assert.equal(compiled.document.mode, "beginner");
});
