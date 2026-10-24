import test from "node:test";
import assert from "node:assert/strict";
import { bodyRole, combinedRole, selectExportBodies } from "../../src/bodyRoles.js";
import { compileMcpModel, reviseMcpParameters } from "../browser/models.js";

const doc = () => ({ id: "roles", seq: 0, mode: "beginner", bodies: [], sketches: [], planes: [], joints: [] });
const primitives = ["part", "phone", "screw"].map(id => ({ id, kind: "box" }));
const rolePlan = (target, role) => ({ operations: [{ id: "classified", type: "setRole", target, role }] });

test("export roles default to design and exclude references even from assembly", () => {
  const bodies = [{ id: "part" }, { id: "phone", role: "reference" }, { id: "screw", role: "hardware" }, { id: "hidden", hidden: true }, { id: "hole", hole: true }, { id: "preview", cutPreview: true }];
  assert.equal(bodyRole(bodies[0]), "design");
  assert.deepEqual(selectExportBodies(bodies).map(b => b.id), ["part"]);
  assert.deepEqual(selectExportBodies(bodies, { scope: "assembly" }).map(b => b.id), ["part", "screw"]);
  assert.deepEqual(selectExportBodies(bodies, { scope: "assembly", bodyIds: ["screw"] }).map(b => b.id), ["screw"]);
  for (const bodyIds of [[], ["part", "part"], ["missing"], ["phone"], ["hidden"], ["hole"], ["preview"], ["screw"], Array(129).fill("part")]) assert.throws(() => selectExportBodies(bodies, { bodyIds }));
  assert.throws(() => selectExportBodies(bodies, { scope: "all" }), /scope/);
  assert.throws(() => selectExportBodies([{ id: "bad", role: "unknown" }]), /role/);
  assert.deepEqual(selectExportBodies([{ id: "phone", role: "reference" }]), []);
});

test("typed role plans are immutable, validate targets and roles, respect locks and classify pattern lists", () => {
  const initial = compileMcpModel(doc(), { primitives });
  const before = JSON.stringify(initial.document);
  const id = initial.createdBodyIds[0];
  const changed = compileMcpModel(initial.document, rolePlan(id, "reference"));
  assert.equal(changed.document.bodies[0].role, "reference");
  assert.equal(JSON.stringify(initial.document), before);
  for (const role of [undefined, "other", null]) assert.throws(() => compileMcpModel(initial.document, rolePlan(id, role)), /role|parameters/);
  assert.throws(() => compileMcpModel(initial.document, rolePlan("unknown", "reference")), /unknown/);
  initial.document.bodies[0].locked = true;
  assert.throws(() => compileMcpModel(initial.document, rolePlan(id, "hardware")), /Unlock/);
  const patterned = compileMcpModel(doc(), { primitives: [primitives[0]], operations: [
    { id: "copies", type: "pattern", source: "part", mode: "linear", axis: "X", count: 3, spacing: 30 },
    { id: "roles", type: "setRole", target: "copies", role: "hardware" },
  ] });
  assert.equal(patterned.document.bodies.length, 3);
  assert.ok(patterned.document.bodies.every(body => body.role === "hardware"));
});

test("mirrors, split outputs and mixed native groups retain conservative roles", () => {
  for (const operation of [
    { id: "output", type: "mirror", source: "tag", plane: { normal: [1, 0, 0] } },
    { id: "output", type: "splitBody", target: "tag", plane: { origin: [0, 0, 5], normal: [0, 0, 1] } },
  ]) {
    const result = compileMcpModel(doc(), { primitives: [primitives[0]], operations: [{ id: "tag", type: "setRole", target: "part", role: "reference" }, operation] });
    assert.ok(result.document.bodies.every(body => body.role === "reference"));
  }
  const result = compileMcpModel(doc(), { primitives, operations: [{ id: "tag", type: "setRole", target: "phone", role: "reference" }, { id: "group", type: "group", members: ["part", "phone"] }] });
  const group = result.document.bodies.find(body => body.node.t === "group");
  assert.equal(group.role, "reference");
  assert.deepEqual(group.node.children.map(child => child.role), ["design", "reference"]);
  assert.equal(combinedRole([{ role: "design" }, { role: "reference" }], "cut"), "design");
  assert.equal(combinedRole([{}, { role: "hardware" }], "join"), "hardware");
  assert.equal(combinedRole([{}, { role: "reference", hole: true }], "union"), "design");
  for (const operation of ["join", "cut", "intersect"]) {
    const result = compileMcpModel(doc(), { primitives: primitives.slice(0, 2), operations: [
      { id: "tag", type: "setRole", target: "phone", role: "reference" },
      { id: "combined", type: "combine", target: "part", tool: "phone", operation },
    ] });
    assert.equal(bodyRole(result.document.bodies[0]), operation === "cut" ? "design" : "reference");
  }
});

test("role-only edits retain parameter templates through serialization and regeneration without blessing geometry edits", () => {
  const built = compileMcpModel(doc(), { modelId: "part", parameters: { width: { value: 20, unit: "mm" } }, primitives: [{ id: "part", kind: "box", parameters: { w: { $expr: "width" } } }] });
  const id = built.createdBodyIds[0];
  const classified = compileMcpModel(built.document, rolePlan(id, "reference"));
  assert.equal(classified.document.mcpModels.length, 1);
  const repeated = compileMcpModel(classified.document, rolePlan(id, "reference"));
  assert.equal(repeated.document.mcpModels.length, 1);
  const revised = reviseMcpParameters(JSON.parse(JSON.stringify(repeated.document)), "part", { width: 25 });
  assert.equal(revised.document.bodies[0].id, id);
  assert.equal(revised.document.bodies[0].role, "reference");
  assert.equal(revised.document.bodies[0].node.p.w, 25);
  classified.document.bodies[0].node.p.h = 99;
  const edited = compileMcpModel(classified.document, rolePlan(id, "hardware"));
  assert.equal(edited.document.mcpModels.length, 0);
  assert.throws(() => reviseMcpParameters(classified.document, "part", { width: 30 }), /outside/);
});
