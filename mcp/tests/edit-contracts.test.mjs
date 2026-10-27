import test from "node:test";
import assert from "node:assert/strict";
import {validateRequirements,evaluateRequirements} from "../browser/inspection/preview-requirements.js";
import {decodeTrace} from "../benchmarks/trace-report.mjs";
import {evaluateEditSession} from "../benchmarks/edit-evaluator.mjs";
import {agentTask} from "../benchmarks/agent-tasks.mjs";
const box={min:[0,0,0],max:[10,10,2]};
test("edit contracts reject invalid regions, count budgets and fail unknown regional evidence",()=>{
 assert.throws(()=>validateRequirements({preserveRegions:[{id:"p",bodyId:"a",box:{min:[0,0,0],max:[0,10,2]}}]}));
 assert.throws(()=>validateRequirements({preserveRegions:Array.from({length:8},(_,i)=>({id:`r${i}`,bodyId:"a",box})),intent:{goal:"edit",targetBodyIds:["a"],changeRegion:box}}));
 assert.throws(()=>validateRequirements({preserveRegions:[{id:"outside:a",bodyId:"a",box}]}),/reserved/);
 assert.throws(()=>validateRequirements({intent:{goal:"local",targetBodyIds:["a"],changeRegion:box},bodies:Array.from({length:8},(_,j)=>({target:`body${j}`,checks:Array.from({length:8},(_,i)=>({id:`c${i}`,kind:"dimension",axis:"X",expected:10}))}))}),/64-check/);
 const result=evaluateRequirements({preserveRegions:[{id:"p",bodyId:"a",box}]},{document:{bodies:[]},geometries:new Map(),beforeSignatures:new Map(),afterSignatures:new Map()});assert.equal(result.status,"unknown");assert.equal(result.passed,false);
 const escaped=evaluateRequirements({intent:{goal:"a only",targetBodyIds:["a"]}},{document:{bodies:[]},geometries:new Map(),beforeSignatures:new Map([["a","old"],["b","old"]]),afterSignatures:new Map([["a","new"],["b","new"]])});assert.equal(escaped.passed,false);
});
test("an incomplete real tool trace is not accepted as complete, and an unmatched result fails",()=>{
 const start={version:1,event:"call",callId:"c",sessionId:"s",sequence:1,name:"jumpstart_get_document",args:{}};
 assert.equal(decodeTrace(JSON.stringify(start)).complete,false);
 assert.throws(()=>decodeTrace(JSON.stringify({...start,event:"result"})),/Unmatched/);
 assert.equal(decodeTrace(JSON.stringify(start)+"\n"+JSON.stringify({...start,event:"result",result:{revision:"r"},elapsedMs:1})).complete,true);
});
test("general editing grades require actual delta and protected-interface geometry, not declarations",()=>{
 const task=agentTask("edit-preserve-interface");
 const session={baseline:{bodies:[{id:"a",name:"Boss",role:"design"},{id:"b"}]},checkpoints:{candidate:{document:{bodies:[{id:"a",role:"design",featureTree:{t:"extrude"},volume:72000},{id:"b"}]}}},calls:[{name:"jumpstart_preview_feature_edit",sequence:1,args:{requirements:{intent:{targetBodyIds:["a"]}}},result:{valid:true,previewId:"p",acceptance:{passed:true,checks:[{kind:"regionPreservation",bodyId:"a",box:{min:[100,100,100],max:[101,101,101]},measured:0,pass:true}]},changes:{changed:[]}}},{name:"jumpstart_apply_model",sequence:2,args:{previewId:"p"},result:{}}]};
 const grade=evaluateEditSession(session,task);assert.equal(grade.pass,false);assert.equal(grade.checks.find(c=>c.name==="requested-delta").pass,false);assert.equal(grade.checks.find(c=>c.name==="protected-interface").pass,false);
});
