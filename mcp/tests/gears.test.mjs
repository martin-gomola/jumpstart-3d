import test from "node:test";
import assert from "node:assert/strict";
import { buildModelPlan, normalizeModelPlan } from "../browser/model-plan.js";

function doc() {
  return { id: "doc-gear", name: "Untitled", mode: "beginner", seq: 0, sketches: [], bodies: [], planes: [], joints: [] };
}

function ids() {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

const spur = (overrides = {}) => ({ id: "spur", type: "gear", gearType: "spur", module: 2, teeth: 24, thickness: 6, ...overrides });
const rack = (overrides = {}) => ({ id: "rack", type: "gear", gearType: "rack", module: 1.5, teeth: 30, thickness: 5, ...overrides });
const bevel = (overrides = {}) => ({ id: "bevel", type: "gear", gearType: "bevel", module: 2, teeth: 24, thickness: 6, ...overrides });
const plan = (operation) => ({ name: "Gear test", operations: [operation] });

test("spur and rack plans compile to editable native primitive parameters", () => {
  const result = buildModelPlan(doc(), {
    name: "Gear pair",
    operations: [
      spur({ bore: 5, pressureAngle: 25, position: [12, 0, 0] }),
      rack({ id: "rack", baseDepth: 5, position: [0, 30, 0] }),
    ],
  }, ids());

  assert.equal(result.document.bodies.length, 2);
  const [spurBody, rackBody] = result.document.bodies;
  assert.deepEqual(spurBody.node, {
    t: "prim", kind: "gear",
    p: { module: 2, teeth: 24, pressureAngle: 25, thickness: 6, bore: 5 },
    mods: [],
  });
  assert.deepEqual(rackBody.node, {
    t: "prim", kind: "rack",
    p: { module: 1.5, teeth: 30, pressureAngle: 20, thickness: 5, baseDepth: 5 },
    mods: [],
  });
  assert.deepEqual(result.featureBodyIds, { spur: spurBody.id, rack: rackBody.id });
  assert.deepEqual(result.createdBodyIds, [spurBody.id, rackBody.id]);
});

test("gear normalization supplies native defaults and keeps type-specific parameters", () => {
  const normalized = normalizeModelPlan({ name: "Gear defaults", operations: [spur(), rack()] });
  assert.deepEqual(normalized.operations[0], {
    type: "gear", id: "spur", gearType: "spur", module: 2, teeth: 24,
    pressureAngle: 20, thickness: 6, bore: 0, position: [0, 0, 0], rotation: [0, 0, 0], name: "Spur gear 24T",
  });
  assert.deepEqual(normalized.operations[1], {
    type: "gear", id: "rack", gearType: "rack", module: 1.5, teeth: 30,
    pressureAngle: 20, thickness: 5, baseDepth: 3, position: [0, 0, 0], rotation: [0, 0, 0], name: "Rack 30T",
  });
});

test("straight bevel gear plans compile to an editable native primitive", () => {
  const result = buildModelPlan(doc(), plan(bevel({ pressureAngle: 22, coneAngle: 35, bore: 5 })), ids());
  assert.deepEqual(result.document.bodies[0].node, {
    t: "prim", kind: "bevelgear",
    p: { module: 2, teeth: 24, pressureAngle: 22, thickness: 6, bore: 5, coneAngle: 35 },
    mods: [],
  });
  assert.equal(result.document.bodies[0].name, "Straight bevel gear 24T");

  assert.deepEqual(normalizeModelPlan(plan(bevel())).operations[0], {
    type: "gear", id: "bevel", gearType: "bevel", module: 2, teeth: 24,
    pressureAngle: 20, thickness: 6, bore: 0, coneAngle: 45,
    position: [0, 0, 0], rotation: [0, 0, 0], name: "Straight bevel gear 24T",
  });
});

test("gear plans reject invalid module, tooth count, pressure angle, and thickness", () => {
  for (const module of [0.19, 50.01]) assert.throws(() => normalizeModelPlan(plan(spur({ module }))), /module must be a finite number/);
  for (const teeth of [5, 121, 12.5]) assert.throws(() => normalizeModelPlan(plan(spur({ teeth }))), /teeth/);
  for (const pressureAngle of [13.99, 30.01]) assert.throws(() => normalizeModelPlan(plan(spur({ pressureAngle }))), /pressureAngle must be a finite number/);
  for (const thickness of [0.09, 10001]) assert.throws(() => normalizeModelPlan(plan(spur({ thickness }))), /thickness must be a finite number/);
});

test("gear plans reject incompatible bore or rack base-depth parameters", () => {
  assert.throws(() => normalizeModelPlan(plan(spur({ bore: 42.99 }))), /bore must be smaller than the gear root diameter/);
  assert.throws(() => normalizeModelPlan(plan(rack({ bore: 1 }))), /bore is only supported for spur gears/);
  assert.throws(() => normalizeModelPlan(plan(spur({ baseDepth: 4 }))), /baseDepth is only supported for racks/);
  assert.throws(() => normalizeModelPlan(plan(rack({ baseDepth: 0.09 }))), /baseDepth must be a finite number/);
  assert.throws(() => normalizeModelPlan(plan(rack({ baseDepth: 10000 }))), /rack height must not exceed/);
});

test("bevel gear plans reject invalid cone geometry, bore, and cross-type parameters", () => {
  for (const coneAngle of [4.99, 80.01]) assert.throws(() => normalizeModelPlan(plan(bevel({ coneAngle }))), /coneAngle must be a finite number/);
  assert.throws(() => normalizeModelPlan(plan(bevel({ coneAngle: 45, thickness: 25 }))), /leave no usable small-end root/);
  assert.throws(() => normalizeModelPlan(plan(bevel({ bore: 40 }))), /bore must be smaller than the smallest gear root diameter/);
  assert.throws(() => normalizeModelPlan(plan(bevel({ baseDepth: 2 }))), /baseDepth is only supported for racks/);
  assert.throws(() => normalizeModelPlan(plan(spur({ coneAngle: 35 }))), /coneAngle is only supported for bevel gears/);
  assert.throws(() => normalizeModelPlan(plan(rack({ coneAngle: 35 }))), /coneAngle is only supported for bevel gears/);
});

test("gear plans reject model-size limits before creating an oversized native body", () => {
  assert.throws(() => normalizeModelPlan(plan(rack({ module: 50, teeth: 120 }))), /rack length must not exceed 10000 mm/);

  const full = doc();
  full.bodies = Array.from({ length: 128 }, (_, index) => ({ id: `existing-${index}`, name: "Existing", node: { t: "prim", kind: "box", p: {}, mods: [] } }));
  assert.throws(() => buildModelPlan(full, plan(spur()), ids()), /Model plan would exceed 128 document bodies/);
});
