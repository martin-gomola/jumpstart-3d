import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFramePlan, inspectRectangularFrame } from '../browser/plans/frame-plan.js';
import { reviseMcpParameters } from '../browser/plans/models.js';
import { frameTools } from '../server/frame-contracts.mjs';
import { validateToolInput } from '../shared/schema.js';
const document = () => ({ id: 'frame-test', name: 'Untitled', mode: 'beginner', seq: 0, bodies: [], planes: [], sketches: [], joints: [] });
const dimensions = { outerWidth: 86, outerDepth: 86, height: 10 };
test('frame preset compiles existing boolean history and makes assumed dimensions explicit', () => {
  const source = document();
  const compiled = compileFramePlan(source, dimensions);
  assert.equal(source.bodies.length, 0);
  assert.equal(compiled.document.bodies.length, 1);
  assert.equal(compiled.parameters.openingWidth.value, 76);
  assert.equal(compiled.parameters.openingDepth.value, 76);
  assert.equal(compiled.designContext.dimensionSources.wall.source, 'assumed');
  assert.equal(compiled.designContext.dimensionSources.height.source, 'supplied');
  assert.equal(compiled.designContext.fit, 'unverified');
  assert.equal(compiled.document.mcpModels[0].designContext.preset, 'rectangular_frame');
  assert.equal(compiled.plan.operations[0].operation, 'cut');
});
test('saved frame parameters revise height and wall while preserving final body identity', () => {
  const first = compileFramePlan(document(), { ...dimensions, wall: 5, modelId: 'switch-spacer' });
  const saved = JSON.parse(JSON.stringify(first.document));
  const revised = reviseMcpParameters(saved, first.modelId, { wall: 4, height: 12 });
  assert.equal(revised.parameters.openingWidth.value, 78);
  assert.equal(revised.parameters.openingDepth.value, 78);
  assert.equal(revised.parameters.height.value, 12);
  assert.equal(revised.createdBodyIds[0], first.createdBodyIds[0]);
  assert.throws(() => reviseMcpParameters(saved, first.modelId, { wall: 43 }), /bounds/);
});
test('frame inputs reject unsupported keys, invalid geometry and unbounded payloads', () => {
  for (const input of [{ ...dimensions, execute: 'code' }, { ...dimensions, wall: 43 }, { ...dimensions, outerWidth: 501 }, { ...dimensions, height: NaN }, { ...dimensions, assumptions: ['x'.repeat(241)] }, { ...dimensions, assumptions: Array(9).fill('assumption') }]) assert.throws(() => compileFramePlan(document(), input));
  validateToolInput({ expectedRevision: 'r1', plan: dimensions }, frameTools[0].inputSchema);
  assert.throws(() => validateToolInput({ plan: dimensions }, frameTools[0].inputSchema));
});
test('frame inspection rejects a solid box as an open-centre spacer', () => {
 const box = { vertices: [-43,-43,0,43,-43,0,43,43,0,-43,43,0,-43,-43,10,43,-43,10,43,43,10,-43,43,10], triangles: [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7] };
 const inspection = inspectRectangularFrame(box, { ...dimensions, wall: 5 });
 assert.equal(inspection.checks.dimensions, true);
 assert.equal(inspection.checks.openCentre, false);
 assert.equal(inspection.passed, false);
});
test('generated ring samples measure the opening, four walls and clear centre', () => {
 const vertices = [];
 for (const z of [0, 10]) for (const half of [43, 38]) vertices.push(-half,-half,z, half,-half,z, half,half,z, -half,half,z);
 const triangles = [];
 const quad = (a,b,c,d) => triangles.push(a,b,c,a,c,d);
 for (let i=0;i<4;i++) {
  const j=(i+1)%4;
  quad(i,j,j+8,i+8); quad(i+4,i+12,j+12,j+4);
  quad(i,j,i===3?4:j+4,i+4); quad(i+8,i+12,j+12,j+8);
 }
 const result=inspectRectangularFrame({vertices,triangles},{...dimensions,wall:5});
 assert.equal(result.passed,true,JSON.stringify(result));
 assert.equal(result.measured.openingWidth,76);
 assert.deepEqual(result.measured.walls,[5,5,5,5]);
});
