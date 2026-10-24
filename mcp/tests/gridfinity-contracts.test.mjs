import test from "node:test";
import assert from "node:assert/strict";
import { compileMcpModel, reviseMcpParameters } from "../browser/models.js";

const document = () => ({ id: "gridfinity-contract", name: "Fixture", seq: 0, mode: "advanced", bodies: [], sketches: [], planes: [], joints: [] });
const blank = { id: "insert", type: "gridfinity", kind: "insert", columns: 2, rows: 3, heightUnits: 3, floor: 2, wall: 1.2, lip: false };
const pocket = (extra = {}) => ({ id: "pocket", type: "pocket", target: "insert", profile: { type: "roundedRect", width: 20, height: 30, radius: 3 }, position: [-15, -20], depth: 8, clearance: 0.3, minimumFloor: 2, minimumWall: 1.2, ...extra });

test("Gridfinity and pocket plans compile immutable native feature definitions and retain revisions through serialization", () => {
  const source = document(), original = JSON.stringify(source);
  const plan = { name: "Parametric Gridfinity insert", modelId: "cutout", parameters: { pocketDepth: { value: 8, unit: "mm", min: 5, max: 10 } }, operations: [blank, pocket({ depth: { $expr: "pocketDepth" } })] };
  const compiled = compileMcpModel(source, plan);
  assert.equal(JSON.stringify(source), original);
  assert.equal(compiled.document.bodies.length, 1);
  assert.ok(compiled.document.sketches.length > 0);
  assert.equal(compiled.document.bodies[0].node.t, "group");
  assert.ok(compiled.document.bodies[0].node.mods.length > 0);
  assert.ok(!JSON.stringify(compiled.document.bodies[0].node).includes('"t":"mesh"'));
  const saved = JSON.parse(JSON.stringify(compiled.document));
  const before = JSON.stringify(saved);
  const revised = reviseMcpParameters(saved, "cutout", { pocketDepth: 9 });
  assert.equal(JSON.stringify(saved), before);
  assert.equal(revised.createdBodyIds[0], compiled.createdBodyIds[0]);
  assert.equal(revised.parameters.pocketDepth.value, 9);
  assert.equal(revised.document.bodies[0].node.mods.length, compiled.document.bodies[0].node.mods.length);
  assert.equal(revised.document.sketches.length, compiled.document.sketches.length);
});

test("Gridfinity rejects unsupported layouts, unsafe pockets and implicit pocket merges", () => {
  const build = operations => compileMcpModel(document(), { name: "Invalid fixture", operations });
  for (const patch of [{ columns: 0 }, { columns: 1.5 }, { columns: 7 }, { rows: -1 }, { heightUnits: 1 }, { wall: 0 }, { floor: -1 }, { kind: "arbitrary" }, { arbitraryScript: "execute" }]) {
    assert.throws(() => build([{ ...blank, ...patch }]));
  }
  for (const patch of [
    { depth: 13 }, { clearance: -0.1 }, { minimumFloor: 0 }, { minimumWall: 0 },
    { position: [100, 0] }, { profile: { type: "circle", radius: 100 } },
    { profile: { type: "mesh", assetId: "x" } }, { profile: { type: "roundedRect", width: 20, height: 30, radius: 20 } },
  ]) assert.throws(() => build([blank, pocket(patch)]));
  assert.throws(() => build([blank, pocket(), pocket({ id: "overlap", profile: { type: "circle", radius: 6 }, position: [-15, -5] })]), /overlap|merg|wall|gap/i);
  assert.doesNotThrow(() => build([blank, pocket(), pocket({ id: "finger", profile: { type: "capsule", length: 25, width: 10 }, position: [-15, -5], depth: 5, merge: true })]));
});

test("Gridfinity pocket edits preserve unrelated bodies and reject locked, unknown or later targets", () => {
  const source = compileMcpModel(document(), { name: "Seed", primitives: [{ id: "reference", kind: "box", position: [160, 0, 0] }], operations: [{ id: "reference-role", type: "setRole", target: "reference", role: "reference" }, blank] }).document;
  const reference = structuredClone(source.bodies[0]), insert = source.bodies[1];
  const edited = compileMcpModel(source, { name: "Edit only insert", operations: [pocket({ target: insert.id })] });
  assert.deepEqual(edited.document.bodies.find(body => body.id === reference.id), reference);
  assert.equal(edited.document.bodies.length, 2);
  assert.throws(() => compileMcpModel(source, { name: "Wrong target", operations: [pocket({ target: reference.id })] }), /insert|Gridfinity|gridfinity/i);
  source.bodies[1].locked = true;
  assert.throws(() => compileMcpModel(source, { name: "Locked target", operations: [pocket({ target: insert.id })] }), /Unlock|locked/);
  assert.throws(() => compileMcpModel(document(), { name: "Later target", operations: [pocket(), blank] }), /unknown|later/i);
});
