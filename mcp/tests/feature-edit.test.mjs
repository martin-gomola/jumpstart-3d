import test from "node:test";
import assert from "node:assert/strict";
import { compileFeatureEdit, featureEditContext } from "../browser/feature-edit.js";
const doc = () => ({bodies:[{id:"a",role:"design",node:{t:"extrude",mode:"one",dist:10,mods:[{id:"round",t:"fillet",r:2,edges:[]},{id:"hole",t:"hole",dia:8,through:false,depth:4,at:[{p:[0,0,10],n:[0,0,1]}]}]}},{id:"ref",node:{t:"prim",kind:"box",p:{w:10,d:10,h:10}}}],sketches:[]});
test("native feature edit updates by id while preserving identity, metadata and unrelated sources",()=>{
 const before=doc(), copy=structuredClone(before), edit={bodyId:"a",featureId:"round",action:"update",values:{radius:4}};
 const result=compileFeatureEdit(before,edit);
 assert.deepEqual(before,copy);assert.equal(result.document.bodies[0].node.mods[0].r,4);assert.equal(result.document.bodies[0].id,"a");assert.deepEqual(result.document.bodies[1],before.bodies[1]);
 assert.equal(compileFeatureEdit(before,{bodyId:"a",featureId:"$base",action:"update",values:{distance:14}}).document.bodies[0].node.dist,14);
 assert.equal(compileFeatureEdit(before,{bodyId:"a",featureId:"round",action:"remove"}).document.bodies[0].node.mods.length,1);
 const moved=compileFeatureEdit(before,{bodyId:"a",featureId:"hole",action:"update",values:{position:[10,0,10],depth:6}}).document.bodies[0].node.mods[1];
 assert.deepEqual(moved.at[0],{p:[10,0,10],n:[0,0,1]});assert.equal(moved.depth,6);
});
test("native edits reject unsupported or ambiguous state rather than silently detach managed models",()=>{
 for(const edit of [{featureId:"unknown",action:"remove"},{featureId:"$base",action:"remove"},{featureId:"round",action:"update",values:{radius:0}},{featureId:"round",action:"update",values:{depth:3}},{featureId:"round",action:"remove",values:{radius:3}}]) assert.throws(()=>compileFeatureEdit(doc(),{bodyId:"a",...edit}));
 for(const mutate of [d=>d.bodies[0].locked=true,d=>d.bodies[0].mcpGridfinity={},d=>d.bodies[0].node.exprs={dist:"height"},d=>d.mcpModels=[{id:"params",bodyIds:["a"]}],d=>d.bodies[0].node.mods.push({id:"round",t:"fillet",r:3}),d=>d.bodies[1].node={t:"mirror",srcBody:"a"}]) {
  const d=doc();mutate(d);assert.throws(()=>compileFeatureEdit(d,{bodyId:"a",featureId:"round",action:"remove"}));
 }
 const d=doc();d.mcpModels=[{id:"params",bodyIds:["a"]}];assert.equal(featureEditContext(d,d.bodies[0]).preferredTool,"jumpstart_preview_parameters");
});
