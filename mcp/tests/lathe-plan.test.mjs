import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLathePlanMesh,compileLathePlan,validateLathePlan} from '../browser/plans/lathe-plan.js';
const top={name:'Spinning top',blank:{kind:'square',length:70,side:40},profile:[[0,0.5],[8,7],[22,20],[30,20],[40,5],[70,5]]};
const cup={name:'Turned cup',blank:{kind:'round',length:90,diameter:60},profile:[[0,26],[12,26],[16,29],[20,27],[24,29],[90,30]],hollow:{wall:3,base:6,end:'tail',style:'follow'},scale:1.1};
const document=()=>({id:'doc',mode:'beginner',seq:0,bodies:[],sketches:[],planes:[],params:[]});
function volume(mesh) { let v=0; for(let k=0;k<mesh.I.length;k+=3) {const a=mesh.I[k]*3,b=mesh.I[k+1]*3,c=mesh.I[k+2]*3,V=mesh.V;v+=(V[a]*(V[b+1]*V[c+2]-V[b+2]*V[c+1])+V[a+1]*(V[b+2]*V[c]-V[b]*V[c+2])+V[a+2]*(V[b]*V[c+1]-V[b+1]*V[c]))/6;} return v; }
function manifold(mesh) {const edges=new Map();for(let k=0;k<mesh.I.length;k+=3)for(let j=0;j<3;j++){const a=mesh.I[k+j],b=mesh.I[k+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(key,(edges.get(key)||0)+1);}assert.ok([...edges.values()].every(n=>n===2));}
test('native Lathe produces bounded upright closed top and hollow cup meshes',()=>{
 for(const plan of [top,cup]){const {mesh}=buildLathePlanMesh(plan);assert.ok(mesh.I.length/3<=15000);assert.ok(volume(mesh)>0);manifold(mesh);const zs=Array.from(mesh.V).filter((_,i)=>i%3===2);assert.equal(Math.min(...zs),0);assert.equal(Math.max(...zs),plan.blank.length);assert.equal(mesh.hollow,!!plan.hollow);}
});
test('native Lathe cavity has correct straight cylindrical wall and base',()=>{
 const {mesh}=buildLathePlanMesh({blank:{kind:'round',length:90,diameter:60},profile:[[0,30],[90,30]],hollow:{wall:3,base:6}});
 const inner=[];for(let k=0;k<mesh.V.length;k+=3)if(Math.abs(Math.hypot(mesh.V[k],mesh.V[k+1])-27)<0.001)inner.push(mesh.V[k+2]);
 assert.equal(Math.max(...inner),90);assert.ok(Math.min(...inner)>=6 && Math.min(...inner)<6.35);manifold(mesh);
});
test('compiled Lathe recipe preserves input, stable identity, native metadata and scale history',()=>{
 const source=document(), compiled=compileLathePlan({document:source,plan:cup});assert.equal(source.bodies.length,0);assert.equal(compiled.document.name,cup.name);
 const body=compiled.document.bodies[0];assert.equal(body.turned.hollow,true);assert.equal(body.node.t,'mesh');assert.equal(body.node.mods[0].t,'scale');assert.deepEqual(body.node.mods[0].k,[1.1,1.1,1.1]);assert.deepEqual(body.mcpLathe.plan.hollow,cup.hollow);
 body.role='reference';
 const revised=compileLathePlan({document:compiled.document,bodyId:body.id,plan:{...cup,scale:1.2}});assert.equal(revised.document.bodies.length,1);assert.equal(revised.document.bodies[0].id,body.id);assert.deepEqual(revised.createdBodyIds,[]);assert.equal(revised.document.bodies[0].role,'reference');
 const changed=structuredClone(compiled.document);changed.bodies[0].m[12]=1;assert.throws(()=>compileLathePlan({document:changed,bodyId:body.id,plan:cup}),/changed outside/);
 changed.bodies[0].locked=true;assert.throws(()=>compileLathePlan({document:changed,bodyId:body.id,plan:cup}),/unlocked/);
});
test('Lathe validation rejects unknown fields, nonfinite numbers, excessive geometry and impossible cuts',()=>{
 for(const bad of [{...top,code:'alert(1)'},{...top,scale:NaN},{...top,profile:[[0,1],[70,25]]},{...top,profile:[[0,1],[0,3],[70,2]]},{...top,profile:Array.from({length:129},(_,i)=>[70*i/128,4])},{...cup,hollow:{wall:29.5,base:6}},{...cup,hollow:{wall:3,base:89.5}}])assert.throws(()=>validateLathePlan(bad),/Lathe plan/);
});

test('Lathe recipe rejects asset tampering and drops only unreferenced old assets',()=>{
 const initial=compileLathePlan({document:document(),plan:cup}).document, body=initial.bodies[0], oldAsset=body.node.asset;
 const tampered=structuredClone(initial);tampered.assets[oldAsset].data=btoa('changed');
 assert.throws(()=>compileLathePlan({document:tampered,bodyId:body.id,plan:cup}),/asset changed/);
 const plan={...cup,profile:[[0,25],[90,29]]};
 const revised=compileLathePlan({document:initial,bodyId:body.id,plan}).document;
 assert.equal(Object.keys(revised.assets).length,1);assert.notEqual(revised.bodies[0].node.asset,oldAsset);
 const shared=structuredClone(initial);shared.bodies.push({...structuredClone(body),id:'shared',mcpLathe:undefined});
 const kept=compileLathePlan({document:shared,bodyId:body.id,plan}).document;
 assert.ok(kept.assets[oldAsset]);assert.equal(Object.keys(kept.assets).length,2);
});
