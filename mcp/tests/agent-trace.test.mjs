import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {createAgentTrace,traceValue} from "../server/agent-trace.mjs";
test("normal MCP calls can be recorded without changing results; sensitive values and image bytes are separated",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"cad-trace-"));
 try {
 const trace=createAgentTrace({exportsDir:dir,enabled:true});
 const result={revision:"r1",images:[{view:"top",dataUrl:"data:image/png;base64,aGVsbG8="}]};
 assert.equal(await trace.run("test",{apiKey:"private",plan:{name:"part"}},async()=>result,"http"),result);
 const lines=(await readFile(join(dir,"agent-traces",`${trace.status().sessionId}.jsonl`),"utf8")).trim().split("\n").map(JSON.parse);
 assert.equal(lines.length,2);assert.equal(lines[0].args.apiKey,"[redacted]");assert(lines[1].result.images[0].dataUrl.omitted);assert.equal(lines[1].result.images[0].artifact.bytes,5);assert.equal(lines[1].result.revision,"r1");assert(lines[1].elapsedMs>=0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("trace write failure cannot turn a committed operation into a failed mutation or replay",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"cad-trace-"));let calls=0;
 try {const trace=createAgentTrace({exportsDir:dir,enabled:true,write:async()=>{throw new Error("disk full");}});assert.deepEqual(await trace.run("apply",{},async()=>{calls++;return {applied:true};}),{applied:true});assert.equal(calls,1);assert.equal(trace.status().status,"incomplete");}
 finally{await rm(dir,{recursive:true,force:true});}
 const clean=traceValue({authorization:"Bearer hidden",name:"/home/private/project", // pii:allow - synthetic redaction fixture
 url:"https://example.test/?token=hidden&x=1"});
 assert.equal(clean.authorization,"[redacted]");assert(!clean.name.includes("private"));assert(!clean.url.includes("hidden"));
});
