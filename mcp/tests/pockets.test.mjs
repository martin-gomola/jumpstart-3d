import test from "node:test";
import assert from "node:assert/strict";
import { normalizePocket, buildPocket, POCKET_LIMITS } from "../browser/plans/pockets.js";
import { findRegions, resolveSketch } from "../../src/regions.js";

const input = (changes = {}) => ({ type: "pocket", id: "pocket1", target: "insert", profile: { type: "roundedRect", width: 20, height: 30, radius: 3 }, position: [-15, -20], depth: 8, clearance: 0.3, minimumFloor: 2, minimumWall: 1.2, ...changes });
function fixture() {
  let id = 0;
  const document = { id: "pocket-test", seq: 0, sketches: [], bodies: [], planes: [], joints: [] };
  const target = { id: "insert", name: "Insert", node: { t: "prim", kind: "box", p: { w: 83.5, d: 125.5, h: 21 }, mods: [] } };
  target.mcpGridfinity = { kind: "insert", width: 83.5, depth: 125.5, topZ: 21, protectedBaseHeight: 7, outerRadius: 3.75, nodeSignature: JSON.stringify(target.node) };
  document.bodies.push(target);
  return { document, target, idFactory: prefix => `${prefix}${++id}`, nextSeq: () => ++document.seq };
}
const add = (f, changes) => buildPocket(normalizePocket(input(changes)), f);

test("pocket normalization validates explicit sizes, clearances, provenance and resource bounds", () => {
  const normalized = normalizePocket(input());
  assert.equal(normalized.rotation, 0);
  assert.equal(normalized.merge, false);
  for (const changes of [{ depth: undefined }, { clearance: undefined }, { clearance: -1 }, { clearance: 10.1 }, { minimumFloor: 0 }, { minimumWall: 0 }, { position: [1] }, { rotation: Infinity }, { merge: "yes" }, { unknown: 1 }, { profile: { type: "roundedRect", width: 20, height: 10, radius: 6 } }, { profile: { type: "capsule", length: 10, width: 10 } }, { profile: { type: "mesh", assetId: "untrusted" } }, { sourceEvidence: { kind: "estimate", product: "Item", url: "javascript:alert(1)" } }]) assert.throws(() => normalizePocket(input(changes)));
  const withEvidence = normalizePocket(input({ sourceEvidence: { product: "iPhone", variant: "15 Pro", kind: "manufacturer", units: "in", url: "https://example.com/specification" }, referenceBodyId: "phone" }));
  assert.equal(withEvidence.sourceEvidence.variant, "15 Pro");
  assert.equal(withEvidence.sourceEvidence.units, "in");
  assert.equal(normalizePocket(input({ sourceEvidence: { product: "Item", kind: "estimate" } })).sourceEvidence.units, "mm");
  assert.throws(() => normalizePocket(input({ sourceEvidence: { product: "Item", kind: "estimate", units: "yards" } })), /units/);
  assert.equal(withEvidence.referenceBodyId, "phone");
});

test("pocket creates an editable native sketch and cut with independent local clearances", () => {
  const f = fixture();
  const recipe = add(f);
  assert.equal(f.document.sketches.length, 1);
  assert.equal(recipe.bottomZ, 13);
  assert.equal(recipe.materialCheck.floorAboveProtectedBase, 6);
  assert.deepEqual(recipe.bounds.min, [-25.3, -35.3]);
  const cut = f.target.node.mods[0];
  assert.equal(cut.t, "bool");
  assert.equal(cut.op, "cut");
  assert.equal(cut.tool.t, "extrude");
  assert.equal(cut.tool.dist, -8);
  const regions = findRegions(resolveSketch(f.document.sketches[0]));
  assert.equal(regions.length, 1);
  assert.equal(regions[0].outer.filter(s => s.t === "arc").length, 4);
  assert.equal(f.target.mcpGridfinity.nodeSignature, JSON.stringify(f.target.node));
});

test("pockets protect the base, outer walls, prior floors, locks and unrelated references", () => {
  for (const changes of [{ depth: 13 }, { position: [40, 0] }, { position: [30, 50], profile: { type: "circle", radius: 15 } }]) assert.throws(() => add(fixture(), changes), /floor|wall|base/);
  const f = fixture();
  f.target.locked = true; assert.throws(() => add(f), /unlock/); delete f.target.locked;
  const scaled = fixture(); scaled.target.m = [0.5,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  assert.throws(() => add(scaled), /scaled or sheared/);
  f.target.node.p.h = 25; assert.throws(() => add(f), /changed outside/);
  const referenceFixture = fixture();
  const phone = { id: "phone", role: "reference", node: { t: "mesh", asset: "retained" } };
  referenceFixture.document.bodies.push(phone);
  const before = JSON.stringify(phone);
  add(referenceFixture, { referenceBodyId: "phone", sourceEvidence: { product: "Phone", kind: "estimate" } });
  assert.equal(JSON.stringify(phone), before);
  assert.equal(referenceFixture.target.mcpPockets[0].sourceEvidence.kind, "estimate");
  referenceFixture.document.sketches[0].pts[0].x += 1;
  assert.throws(() => add(referenceFixture, { id: "after-native-sketch-edit", position: [15, 25], profile: { type: "circle", radius: 8 } }), /sketch changed outside/);
  assert.throws(() => add(fixture(), { referenceBodyId: "missing" }), /another existing body/);
});

test("neighbor bounds require material separation or explicit merge and preserve earlier floors", () => {
  const f = fixture();
  add(f, { minimumFloor: 5 });
  assert.throws(() => add(f, { id: "finger", profile: { type: "capsule", length: 25, width: 10 }, position: [-15, -5], depth: 5 }), /explicitly allow merging/);
  add(f, { id: "finger", profile: { type: "capsule", length: 25, width: 10 }, position: [-15, -5], depth: 5, merge: true });
  assert.equal(f.target.mcpPockets.length, 2);
  assert.throws(() => add(f, { id: "deep", position: [-15, -20], depth: 11, merge: true }), /minimum floor/);
  add(f, { id: "circle", profile: { type: "circle", radius: 8 }, position: [15, 25], depth: 8 });
  assert.equal(f.target.mcpPockets.length, 3);
  assert.throws(() => add(f, { id: "circle", profile: { type: "circle", radius: 2 }, position: [15, 50] }), /duplicate/);
  const capped = fixture(); capped.target.mcpPockets = Array(POCKET_LIMITS.count).fill({});
  assert.throws(() => add(capped), /at most 16/);
});

test("closed line/arc contours receive a native round offset; malformed and self-crossing profiles fail", () => {
  const contour = { type: "contour", segments: [
    { type: "line", start: [-10, -5], end: [5, -5] },
    { type: "arc", start: [5, -5], through: [10, 0], end: [5, 5] },
    { type: "line", start: [5, 5], end: [-10, 5] },
    { type: "line", start: [-10, 5], end: [-10, -5] },
  ] };
  const f = fixture(); add(f, { profile: contour, rotation: 30 });
  assert.equal(f.target.node.mods[0].tool.profileOffset, 0.3);
  assert.equal(f.document.sketches[0].ents.length, 4);
  assert.throws(() => normalizePocket(input({ profile: { type: "contour", segments: contour.segments.slice(0, 3) } })), /connect and close/);
  const crossing = { type: "contour", segments: [[[-5,-5],[5,5]],[[5,5],[-5,5]],[[-5,5],[5,-5]],[[5,-5],[-5,-5]]].map(([start,end]) => ({ type: "line", start, end })) };
  assert.throws(() => add(fixture(), { profile: crossing }), /simple closed region/);
});
