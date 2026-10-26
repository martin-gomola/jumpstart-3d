#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { resolve, join, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { agentTask } from "./agent-tasks.mjs";
import { evaluateEditSession } from "./edit-evaluator.mjs";
import { inspectStl } from "./agent-runner.mjs";
export function decodeTrace(text) {
 if(Buffer.byteLength(text)>32*1024*1024)throw new Error("Trace exceeds the 32 MiB budget");
 const events=text.trim().split("\n").filter(Boolean).map(JSON.parse), calls=[], completed=new Set(), sessions=new Set();
 for(const e of events) {
  if(e.version!==1||!e.callId||!e.sessionId)throw new Error("Invalid trace event"); sessions.add(e.sessionId);
  if(e.event==="call") {if(calls.some(c=>c.callId===e.callId))throw new Error("Duplicate trace call"); calls.push({...e});}
  else if(e.event==="result") {
   const call=calls.find(c=>c.callId===e.callId);if(!call||completed.has(e.callId)||e.name!==call.name)throw new Error("Unmatched trace result");
   completed.add(e.callId);Object.assign(call,{result:e.result,error:e.error,elapsedMs:e.elapsedMs,outputBytes:e.outputBytes});
  } else throw new Error("Unknown trace event");
 }
 if(sessions.size!==1||!calls.length)throw new Error("Trace must contain one nonempty session");
 return {version:1,sessionId:[...sessions][0],complete:completed.size===calls.length,calls,
  metrics:{calls:calls.length,failedCalls:calls.filter(c=>c.error||c.result?.valid===false).length,
   previewAttempts:calls.filter(c=>c.name.startsWith("jumpstart_preview_")).length,
   elapsedToolMs:calls.reduce((n,c)=>n+(c.elapsedMs||0),0),inputBytes:calls.reduce((n,c)=>n+(c.inputBytes||0),0),resultBytes:calls.reduce((n,c)=>n+(c.outputBytes||0),0)},
  limits:"Tool durations include recorder overhead; bytes are serialized internal results, not LLM tokens. No reasoning-quality score is inferred."};
}
export async function reportTrace(path, taskId, exportsDir=resolve("exports"), baselineSequence) {
 const trace=decodeTrace(await readFile(path,"utf8"));
 if(!taskId)return {...trace, calls:trace.calls.map(({sequence,name,elapsedMs,error})=>({sequence,name,elapsedMs,...(error?{error}:{})})),evaluation:"not_requested"};
 const task=agentTask(taskId);if(task.kind!=="edit")throw new Error("Automatic trace grading currently supports general edit tasks; legacy tasks use their checkpoint recorder");
 const candidates=trace.calls.filter(c=>c.name==="jumpstart_get_document"&&!c.error&&c.result?.bodies?.some(b=>b.name===task.targetName));
 if (baselineSequence===undefined && new Set(candidates.map(c=>`${c.args.editorId}:${c.result.document?.id}`)).size>1) throw new Error("Ambiguous task baseline; provide the exact baseline call sequence from the trace summary");
 const baseline=baselineSequence===undefined?candidates[0]:candidates.find(c=>c.sequence===baselineSequence);
 if (baselineSequence!==undefined && !baseline) throw new Error("Baseline sequence is not an observed target document read");
 const calls=baseline ? trace.calls.filter(c=>c.sequence>=baseline.sequence && (!c.args?.editorId || c.args.editorId===baseline.args.editorId)) : [];
 const ok=name=>calls.filter(c=>c.name===name&&!c.error), reads=ok("jumpstart_get_document");
 const applies=ok("jumpstart_apply_model"), firstApply=applies[0], lastUndo=ok("jumpstart_undo").at(-1);
 const candidate=reads.filter(c=>firstApply&&c.sequence>firstApply.sequence&&(!lastUndo||c.sequence<lastUndo.sequence)).at(-1);
 const reopenedCall=ok("jumpstart_reopen_document").at(-1), reopened=reads.find(c=>reopenedCall&&c.sequence>reopenedCall.sequence&&(!lastUndo||c.sequence<lastUndo.sequence));
 const undone=reads.find(c=>lastUndo&&c.sequence>lastUndo.sequence);
 const session={taskId,baseline:baseline?.result,calls,checkpoints:{candidate:{document:candidate?.result},reopened:{document:reopened?.result},undone:{document:undone?.result}}};
 const exported=ok("jumpstart_export_model").filter(c=>c.args?.format==="stl"&&c.result?.revision===candidate?.result?.revision).at(-1);
 if(exported?.result?.path) {
  const root=await realpath(exportsDir), file=await realpath(join(root,basename(exported.result.path)));
  if(!file.startsWith(root+sep))throw new Error("Export read must remain within managed exports");
  const data=await readFile(file), hash=createHash("sha256").update(data).digest("hex");
  const target=baseline?.result.bodies.find(b=>b.name===task.targetName);
  if(hash!==exported.result.sha256 || data.byteLength!==exported.result.byteLength || exported.result.bodyIds?.length!==1 || exported.result.bodyIds[0]!==target?.id) throw new Error("Export evidence does not match the recorded target, bytes and digest");
  session.checkpoints.candidate.stl={...inspectStl(data),sha256:hash};
 }
 const evaluation=evaluateEditSession(session,task);
 return {sessionId:trace.sessionId,baselineSequence:baseline?.sequence,complete:trace.complete,metrics:{calls:calls.length,failedCalls:calls.filter(c=>c.error||c.result?.valid===false).length,elapsedToolMs:calls.reduce((n,c)=>n+(c.elapsedMs||0),0),inputBytes:calls.reduce((n,c)=>n+(c.inputBytes||0),0),resultBytes:calls.reduce((n,c)=>n+(c.outputBytes||0),0)},sessionMetrics:trace.metrics,...evaluation,pass:trace.complete&&evaluation.pass};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 reportTrace(process.argv[2],process.argv[3],undefined,process.argv[4]===undefined?undefined:Number(process.argv[4])).then(r=>{console.log(JSON.stringify(r,null,2));if(r.pass===false||!r.complete)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
