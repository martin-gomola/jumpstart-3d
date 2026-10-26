import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGeometry, measureParallelChannels } from '../browser/inspection.js';
import { inspectPrintability, rankPrintOrientations } from '../shared/geometry.js';

// Independently construct a stepped solid from exposed grid-cell faces, without CAD plans.
function groovedMesh() {
 const xs=[-12,12], ys=[-10,-7,-5,-1,1,5,7,10], zs=[0,3,6], vertices=[],triangles=[];
 const solid=(x,y,z)=>x===0&&y>=0&&y<ys.length-1&&z>=0&&z<2&&(z===0||y%2===0);
 const quad=(points)=>{const at=vertices.length/3;vertices.push(...points.flat());triangles.push(at,at+1,at+2,at,at+2,at+3);};
 for(let y=0;y<ys.length-1;y++)for(let z=0;z<2;z++)if(solid(0,y,z)) {
  const [a,b]=xs,[c,d]=ys.slice(y,y+2),[e,f]=zs.slice(z,z+2);
  quad([[a,c,e],[a,c,f],[a,d,f],[a,d,e]]);quad([[b,c,e],[b,d,e],[b,d,f],[b,c,f]]);
  if(!solid(0,y-1,z))quad([[a,c,e],[b,c,e],[b,c,f],[a,c,f]]);
  if(!solid(0,y+1,z))quad([[a,d,e],[a,d,f],[b,d,f],[b,d,e]]);
  if(!solid(0,y,z-1))quad([[a,c,e],[a,d,e],[b,d,e],[b,c,e]]);
  if(!solid(0,y,z+1))quad([[a,c,f],[b,c,f],[b,d,f],[a,d,f]]);
 }
 return {vertices,triangles};
}
test('channel measurements derive from triangle intersections, with wrong expected values failing',()=>{
 const mesh=groovedMesh(),actual=measureParallelChannels(mesh,{axis:'Y',crossAt:0});
 assert.equal(actual.count,3);assert.deepEqual(actual.widths,[2,2,2]);assert.deepEqual(actual.spacings,[6,6]);assert.equal(actual.depth,3);assert.equal(actual.floor,3);assert.equal(actual.openEnds,true);assert.equal(actual.symmetric,true);
 const check={id:'grooves',kind:'channels',axis:'Y',crossAt:0,expected:{count:3,width:2,depth:3,floor:3,spacing:6,symmetric:true,openEnds:true},tolerance:.01};
 assert.equal(inspectGeometry(mesh,{checks:[check]}).checks[0].pass,true);
 assert.equal(inspectGeometry(mesh,{checks:[{...check,expected:{width:4}}]}).checks[0].pass,false);
 assert.equal(inspectGeometry(mesh,{checks:[{...check,expected:{count:4},tolerance:1}]}).checks[0].pass,false);
 assert.equal(inspectGeometry(mesh,{checks:[{id:'x',kind:'dimension',axis:'X',expected:25,tolerance:.01}]}).checks[0].pass,false);
});
test('unsupported sections fail explicitly rather than trusting submitted dimensions',()=>{
 assert.throws(()=>measureParallelChannels(groovedMesh(),{axis:'Z'}),/supports/);
 const result=inspectGeometry(groovedMesh(),{checks:[{id:'outside',kind:'channels',axis:'Y',crossAt:30,expected:{count:3}}]});
 assert.equal(result.checks[0].pass,null);assert.equal(result.geometricRequirements,'unknown');assert.equal(result.physicalFit,'unverified');
 const mesh=groovedMesh();
 assert.throws(()=>inspectGeometry({...mesh,triangles:Array.from({length:600000},()=>0)},{checks:[{kind:'channels'}]}),/budget/);
});
// Outward-wound closed boxes, each [[x0,y0,z0],[x1,y1,z1]].
function boxes(...extents) {
 const vertices=[],triangles=[];
 const quad=(points)=>{const at=vertices.length/3;vertices.push(...points.flat());triangles.push(at,at+1,at+2,at,at+2,at+3);};
 for(const [[a,c,e],[b,d,f]] of extents) {
  quad([[a,c,e],[a,d,e],[b,d,e],[b,c,e]]);quad([[a,c,f],[b,c,f],[b,d,f],[a,d,f]]);
  quad([[a,c,e],[b,c,e],[b,c,f],[a,c,f]]);quad([[a,d,e],[a,d,f],[b,d,f],[b,d,e]]);
  quad([[a,c,e],[a,c,f],[a,d,f],[a,d,e]]);quad([[b,c,e],[b,d,e],[b,d,f],[b,c,f]]);
 }
 return {vertices,triangles};
}
test('printability measures downward overhangs above the bed and thin walls from the mesh',()=>{
 const grounded=boxes([[0,0,0],[10,10,10]]);
 assert.equal(inspectPrintability(grounded).overhangArea,0);
 const floating=inspectPrintability(boxes([[0,0,0],[10,10,1]],[[20,0,5],[30,10,6]]),{minWall:2});
 assert.ok(Math.abs(floating.overhangArea-100)<1e-9);assert.deepEqual(floating.overhangBounds,{min:[20,0,5],max:[30,10,5]});
 assert.ok(Math.abs(floating.thinWallArea-400)<1e-9);assert.ok(Math.abs(floating.thinnestWall-1)<1e-9);
 assert.equal(inspectPrintability(grounded,{minWall:2}).thinWallArea,0);
 const inverted=boxes([[0,0,0],[10,10,1]],[[20,0,5],[30,10,6]]);
 for(let i=0;i<inverted.triangles.length;i+=3)[inverted.triangles[i+1],inverted.triangles[i+2]]=[inverted.triangles[i+2],inverted.triangles[i+1]];
 assert.ok(Math.abs(inspectPrintability(inverted,{minWall:2}).overhangArea-100)<1e-9);
});
test('print orientations lay each candidate on the bed and rank by overhang, bed contact and height',()=>{
 const brick=rankPrintOrientations(boxes([[0,0,0],[10,20,30]]));
 assert.equal(brick.candidates.length,6);
 assert.ok(brick.candidates.every(c=>c.overhangArea===0));
 assert.deepEqual(brick.candidates[0].down.map(Math.abs),[1,0,0]);
 assert.ok(Math.abs(brick.candidates[0].bedContactArea-600)<1e-9);assert.ok(Math.abs(brick.candidates[0].height-10)<1e-9);
 const upright=brick.candidates.find(c=>c.current);assert.ok(Math.abs(upright.height-30)<1e-9);
 for(const {down,rotation:m} of brick.candidates){const z=[m[2]*down[0]+m[6]*down[1]+m[10]*down[2]];assert.ok(Math.abs(z[0]+1)<1e-9);}
 const tee=rankPrintOrientations(boxes([[4,4,0],[8,8,10]],[[0,0,10],[12,12,12]]));
 const best=tee.candidates[0],current=tee.candidates.find(c=>c.current);
 assert.deepEqual(best.down,[0,0,1]);
 assert.ok(Math.abs(current.overhangArea-144)<1e-9);assert.ok(Math.abs(best.overhangArea-16)<1e-9);
 assert.throws(()=>rankPrintOrientations({vertices:[0,0,0,1,0,0,0,1,0],triangles:[0,1,2]}),/closed/);
});
test('printability separates base overhangs and measures bed contact and proportions',()=>{
 const base=inspectPrintability(boxes([[0,0,0],[10,10,5]],[[20,0,0.3],[22,2,0.8]]));
 assert.equal(base.overhangArea,0);assert.ok(Math.abs(base.baseOverhangArea-4)<1e-9);assert.ok(Math.abs(base.bedContactArea-100)<1e-9);
 assert.ok(Math.abs(inspectPrintability(boxes([[0,0,0],[10,10,5]],[[20,0,0.3],[22,2,0.8]]),{baseZone:0}).overhangArea-4)<1e-9);
 const tower=inspectPrintability(boxes([[0,0,0],[5,5,30]]));
 assert.equal(tower.slenderness,6);assert.equal(tower.thinnestDimension,5);assert.ok(Math.abs(tower.bedContactArea-25)<1e-9);
 const notes=inspectGeometry(boxes([[0,0,0],[5,5,30]]),{checks:[{id:'print',kind:'printability',maxOverhangArea:0}]}).checks[0];
 assert.equal(notes.pass,true);assert.deepEqual(notes.notes.map(n=>[n.code,n.severity]),[['slender','warn'],['bed_contact','warn']]);
 assert.ok(notes.notes.every(n=>n.fix));
});
test('printability notes carry fixes and mark threshold failures as errors',()=>{
 const mesh=boxes([[0,0,0],[10,10,1]],[[20,0,5],[30,10,6]]);
 const result=inspectGeometry(mesh,{checks:[{id:'print',kind:'printability',maxOverhangArea:50,minWall:2}]}).checks[0];
 const byCode=Object.fromEntries(result.notes.map(n=>[n.code,n]));
 assert.equal(byCode.overhang.severity,'error');assert.match(byCode.overhang.message,/worst at 90°.*5\.0 mm above the bed/);
 assert.equal(byCode.thin_wall.severity,'error');assert.match(byCode.thin_wall.fix,/at least 2 mm/);
 assert.equal(byCode.slender,undefined);
 const passing=inspectGeometry(mesh,{checks:[{id:'print',kind:'printability',maxOverhangArea:100}]}).checks[0];
 assert.equal(passing.pass,true);assert.equal(passing.notes.find(n=>n.code==='overhang').severity,'warn');
 assert.equal(inspectGeometry(boxes([[0,0,0],[10,10,1]]),{checks:[{id:'print',kind:'printability',maxOverhangArea:0}]}).checks[0].notes[0].code,'thin_part');
});
test('printability checks gate on thresholds and report unknown for unsupported input',()=>{
 const mesh=boxes([[0,0,0],[10,10,1]],[[20,0,5],[30,10,6]]);
 const run=(check)=>inspectGeometry(mesh,{checks:[{id:'print',kind:'printability',...check}]}).checks[0];
 assert.equal(run({maxOverhangArea:100}).pass,true);
 assert.equal(run({maxOverhangArea:50}).pass,false);
 assert.equal(run({overhangAngle:89,maxOverhangArea:0}).pass,false);
 assert.equal(run({minWall:0.5}).pass,true);
 const thin=run({minWall:2,maxThinWallArea:10});assert.equal(thin.pass,false);assert.match(thin.errors[0],/thinner than 2 mm/);
 assert.equal(run({}).pass,null);assert.equal(run({maxThinWallArea:1}).pass,null);
 const open={vertices:mesh.vertices,triangles:mesh.triangles.slice(6)};
 const result=inspectGeometry(open,{checks:[{id:'print',kind:'printability',maxOverhangArea:0}]});
 assert.equal(result.checks[0].pass,null);assert.match(result.checks[0].error,/closed/);assert.equal(result.geometricRequirements,'unknown');
});
