import test from "node:test";
import assert from "node:assert/strict";
import { buildGridfinity, GRIDFINITY_LIMITS, normalizeGridfinity } from "../browser/gridfinity.js";
import { resolveGridfinityFixture as resolveNode } from "./gridfinity-test-helpers.mjs";

const raw = overrides => ({ type:"gridfinity", id:"grid", ...overrides });
const document = () => ({ id:"grid", seq:0, mode:"advanced", bodies:[], sketches:[], planes:[], joints:[] });
function build(overrides = {}) {
  const doc = document(); let i=0;
  const operation = normalizeGridfinity(raw(overrides));
  const result = buildGridfinity(operation, { document:doc, idFactory:p=>`${p}-${++i}` });
  return { ...result, document:doc };
}

test("Gridfinity normalizer has bounded explicit dimensions and rejects unused geometry options", () => {
  const op=normalizeGridfinity(raw());
  assert.equal(op.kind,"insert");
  assert.deepEqual([op.columns,op.rows,op.heightUnits,op.floor,op.wall],[1,1,3,2,1.2]);
  assert.equal(GRIDFINITY_LIMITS.cells,16);
  for (const overrides of [{columns:0},{rows:5},{heightUnits:1},{columns:1.5},{floor:NaN},{wall:0.1},{lip:"yes"},{kind:"other"},{kind:"insert",lip:true},{kind:"insert",dividers:{x:1}},{kind:"bin",dividers:{y:7}},{kind:"bin",dividers:{z:1}},{kind:"baseplate",heightUnits:4},{kind:"baseplate",wall:2},{extra:1},{position:[0,0]},{rotation:[0,0,361]}]) {
    assert.throws(()=>normalizeGridfinity(raw(overrides)),JSON.stringify(overrides));
  }
  assert.throws(()=>normalizeGridfinity({id:"grid"}),/type/);
});

test("2 by 3 insert repeats native feet on pitch while sharing editable foot sketches", () => {
  const {document:doc,node,recipe}=build({columns:2,rows:3});
  assert.deepEqual([recipe.width,recipe.depth,recipe.topZ,recipe.protectedBaseHeight],[83.5,125.5,21,7]);
  assert.equal(recipe.floor,2);
  assert.equal(recipe.outerRadius,3.75);
  assert.equal(recipe.nodeSignature,JSON.stringify(node));
  assert.equal(Object.keys(recipe.sketchSignatures).length,5);
  for (const sketch of doc.sketches) assert.equal(recipe.sketchSignatures[sketch.id],JSON.stringify(sketch));
  assert.equal(doc.sketches.length,5);
  assert.equal(node.children.length,7);
  assert.deepEqual(node.children.slice(0,6).map(child=>child.m.slice(12,15)),[[-21,-42,0],[21,-42,0],[-21,0,0],[21,0,0],[-21,42,0],[21,42,0]]);
  assert.deepEqual(doc.sketches.slice(0,4).map(sketch=>sketch.plane.o[2]),[0,0.8,2.6,4.75]);
  assert.ok(doc.sketches.every(sketch=>sketch.hidden && sketch.ents.filter(e=>e.t==="arc").length===4));
  const resolved=resolveNode(node,doc);
  assert.ok(resolved.children[0].node.sections.every(section=>section.region?.outer?.length===8));
  assert.equal(JSON.stringify(node).includes('"mesh"'),false);
});

test("socket baseplate and bin lip use separate native profiles and retain recipe height semantics", () => {
  const plate=build({kind:"baseplate",columns:2,rows:3});
  assert.deepEqual([plate.recipe.width,plate.recipe.depth,plate.recipe.topZ,plate.recipe.totalHeight],[84,126,5,5]);
  assert.equal(plate.recipe.baseplatePlacementZ,0.25);
  assert.equal(plate.node.children.filter(child=>child.hole).length,6);
  assert.deepEqual(plate.document.sketches.slice(0,6).map(sketch=>sketch.plane.o[2]),[-0.02,0.35,1.05,2.85,5,5.02]);
  const bin=build({kind:"bin",columns:2,rows:3,lip:true,dividers:{x:1,y:2}});
  assert.equal(bin.recipe.topZ,21);
  assert.equal(bin.recipe.totalHeight,25.4);
  assert.equal(bin.node.children.length,11);
  assert.equal(bin.node.children[6].node.mods[0].op,"cut");
  assert.equal(bin.node.children.at(-1).node.mods[0].tool.t,"loft");
  const resolved=resolveNode(bin.node,bin.document);
  assert.ok(resolved.children.at(-1).node.mods[0].tool.sections.every(section=>section.region));
});

test("all supported grid sizes have bounded native profile counts", () => {
  for (const kind of ["insert","bin","baseplate"]) {
    const {document:doc,node}=build({kind,columns:4,rows:4});
    assert.ok(doc.sketches.length<=7);
    assert.equal(node.children.filter(child=>child.node.t==="loft").length,16);
  }
});
