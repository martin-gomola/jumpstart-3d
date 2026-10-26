import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors, waitIdle, loadDoc, newDoc, body, prim } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0;

test.beforeAll(async () => {
  await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true });
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1", JUMPSTART_MCP_TRACE: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`MCP broker startup timed out: ${output}`)), 15_000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    broker.once("error", fail);
    broker.once("exit", (code) => fail(new Error(`MCP broker exited during startup (${code}): ${output}`)));
    broker.stderr.setEncoding("utf8");
    broker.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/JumpStart MCP app: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); baseURL = `http://127.0.0.1:${match[1]}/`; resolve(); }
    });
  });
});

test.afterAll(async () => {
  if (!broker || broker.exitCode !== null || broker.signalCode !== null) return;
  const exited = once(broker, "exit");
  broker.kill("SIGTERM");
  const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
});

async function tool(name, args = {}, expectError = false) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  expect(response.ok).toBe(true);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  if (expectError) expect(payload.result.isError).toBe(true);
  else expect(payload.result.isError, payload.result.content?.find((item) => item.type === "text")?.text).not.toBe(true);
  return JSON.parse(payload.result.content.find((item) => item.type === "text").text);
}

async function editor(page) {
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const documentId = await page.evaluate(() => window.__store.doc.id);
  let editorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    editorId = listed.editors.find((entry) => entry.documentId === documentId)?.editorId;
    return !!editorId;
  }).toBe(true);
  return editorId;
}


test("general native feature editing protects regions, compares before/after detail and records normal MCP calls", async ({page})=>{
 const errors=watchErrors(page), editorId=await editor(page), get=()=>tool("jumpstart_get_document",{editorId,includeGeometry:true});
 const create=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Generic edit baseline",sketches:[{id:"profile",plane:"XY",origin:[0,0,0],profile:{type:"polygon",points:[[-20,-15],[20,-15],[20,15],[-20,15]]}}],features:[{id:"part",type:"extrude",sketch:"profile",distance:10}],primitives:[{id:"ref",kind:"box",position:[100,0,0],parameters:{w:10,d:10,h:10}}]}});
 await tool("jumpstart_apply_model",{editorId,previewId:create.previewId});
 const baseline=await get(), part=baseline.bodies.find(b=>b.feature==="extrude"), other=baseline.bodies.find(b=>b.id!==part.id);
 expect(part.editing.features.find(f=>f.id==="$base").editable).toBe(true);
 const compact=await tool("jumpstart_get_document",{editorId,bodyIds:[part.id],includeGeometry:true,includeSelectors:false,includeFeatureTree:false});
 expect(compact.bodies[0].geometryFingerprint).toBe(part.geometrySelectors.fingerprint);expect(compact.bodies[0].geometrySelectors).toBeUndefined();expect(compact.bodies[0].featureTree).toBeUndefined();expect(compact.bodies[0].editing.features[0].values.distance).toBe(10);expect(compact.bodies[0].placementMatrix).toHaveLength(16);
 await page.click("#unit-toggle"); const inches=await get();expect(inches.units).toBe("mm");expect(inches.displayUnits).toBe("in");expect(inches.revision).toBe(baseline.revision);await page.click("#unit-toggle");

 const baseArgs={editorId,expectedRevision:baseline.revision,expectedFingerprint:part.geometrySelectors.fingerprint,edit:{bodyId:part.id,featureId:"$base",action:"update",values:{distance:14}}};
 const intent={goal:"Extend only the top four millimetres; preserve mounting floor and companion",targetBodyIds:[part.id],changeRegion:{min:[-21,-16,10],max:[21,16,15]}};
 const req={intent,preserveBodyIds:[other.id],preserveRegions:[{id:"mount",bodyId:part.id,box:{min:[-21,-16,0],max:[21,16,3]}},{id:"empty",bodyId:part.id,box:{min:[70,70,70],max:[80,80,80]}}],bodyCount:2,bodies:[{target:part.id,checks:[{id:"height",kind:"dimension",axis:"Z",expected:14,tolerance:.001}]}]};
 const edit=await tool("jumpstart_preview_feature_edit",{...baseArgs,requirements:req});
 expect(edit.valid,JSON.stringify(edit.errors)).toBe(true);expect(edit.acceptance.passed).toBe(true);
 expect(edit.acceptance.checks.find(c=>c.kind==="regionPreservation").measured).toBeCloseTo(0,6);
 expect(edit.images).toHaveLength(4);expect(edit.images.map(i=>[i.phase,i.view])).toEqual([["before","isometric"],["before","detail"],["after","isometric"],["after","detail"]]);
 expect(edit.images[1].focusRegion).toEqual(edit.images[3].focusRegion);
 expect(edit.images[1].framing).toEqual(edit.images[3].framing);
 expect((await get()).revision).toBe(baseline.revision);
 const bad=await tool("jumpstart_preview_feature_edit",{...baseArgs,includeImage:false,requirements:{intent:{...intent,changeRegion:{min:[-21,-16,0],max:[21,16,1]}}}});
 expect(bad.valid).toBe(false);expect(bad.acceptance.checks.some(c=>c.kind==="outsideChangeRegion"&&c.pass===false)).toBe(true);
 await tool("jumpstart_apply_model",{editorId,previewId:bad.previewId},true);
 expect((await get()).revision).toBe(baseline.revision);
 const shifted=await tool("jumpstart_preview_model",{editorId,expectedRevision:baseline.revision,includeImage:false,plan:{name:"Shift control",operations:[{id:"shift",type:"transform",target:part.id,position:[3,0,0],relative:true}]},requirements:{preserveRegions:[{id:"same-volume",bodyId:part.id,box:{min:[-50,-50,-1],max:[50,50,20]}}]}});
 expect(shifted.valid).toBe(false);
 const measured=shifted.acceptance.regions[0];expect(measured.beforeVolumeMm3).toBeCloseTo(measured.afterVolumeMm3,5);expect(measured.changedVolumeMm3).toBeGreaterThan(1000);
 const applied=await tool("jumpstart_apply_model",{editorId,previewId:edit.previewId});
 const duplicate=await tool("jumpstart_apply_model",{editorId,previewId:edit.previewId});expect(duplicate.revision).toBe(applied.revision);
 await tool("jumpstart_preview_feature_edit",{...baseArgs,requirements:req,includeImage:false},true);
 const final=await get();expect(final.bodies.find(b=>b.id===part.id).featureTree.dist).toBe(14);expect(final.bodies.find(b=>b.id===other.id).dimensions).toEqual(other.dimensions);
 await tool("jumpstart_save_document",{editorId,expectedRevision:final.revision});await tool("jumpstart_reopen_document",{editorId,expectedRevision:final.revision,documentId:final.document.id});
 const reopened=await get();await tool("jumpstart_undo",{editorId,expectedRevision:reopened.revision});expect((await get()).bodies.find(b=>b.id===part.id).featureTree.dist).toBe(10);
 const caps=await tool("jumpstart_get_capabilities",{includeSchemas:false});expect(caps.telemetry.enabled).toBe(true);
 const text=await readFile(`exports/agent-traces/${caps.telemetry.sessionId}.jsonl`,"utf8");
 const {decodeTrace}=await import("../benchmarks/trace-report.mjs");const trace=decodeTrace(text);expect(trace.complete).toBe(true);expect(trace.calls.some(c=>c.name==="jumpstart_preview_feature_edit"&&c.result?.valid)).toBe(true);
 expect(errors).toEqual([]);
});

test("a general hole edit is measured, saved and graded from the ordinary MCP trace",async({page})=>{
 const editorId=await editor(page), get=()=>tool("jumpstart_get_document",{editorId,includeGeometry:true});
 const seed=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Hole edit",primitives:[{id:"plate",name:"Plate",kind:"box",parameters:{w:80,d:60,h:10}},{id:"other",name:"Companion",kind:"box",parameters:{w:10,d:10,h:10},position:[100,0,0]}],operations:[{id:"hole",type:"modifier",target:"plate",modifier:{type:"hole",diameter:10,through:true,at:[{p:[-20,0,10],n:[0,0,1]}]}}]}});
 await tool("jumpstart_apply_model",{editorId,previewId:seed.previewId});
 const before=await get(), part=before.bodies.find(b=>b.name==="Plate"), other=before.bodies.find(b=>b.id!==part.id), feature=part.featureTree.mods.find(m=>m.t==="hole");
 await tool("jumpstart_inspect_geometry",{editorId,bodyId:part.id,expectedRevision:before.revision,mesh:true,samples:[{axis:"Z",point:[-20,0,-1]},{axis:"Z",point:[20,0,-1]}]});
 const proposal=await tool("jumpstart_preview_feature_edit",{editorId,expectedRevision:before.revision,expectedFingerprint:part.geometrySelectors.fingerprint,includeImage:false,edit:{bodyId:part.id,featureId:feature.id,action:"update",values:{position:[20,0,10]}},requirements:{intent:{goal:"Move only the hole; preserve the plate envelope and companion",targetBodyIds:[part.id]},preserveBodyIds:[other.id],bodies:[{target:part.id,checks:[{id:"x",kind:"dimension",axis:"X",expected:80}]}]}});
 expect(proposal.valid,JSON.stringify(proposal.errors)).toBe(true);
 await tool("jumpstart_apply_model",{editorId,previewId:proposal.previewId});
 const candidate=await get();
 const inspection=await tool("jumpstart_inspect_geometry",{editorId,bodyId:part.id,expectedRevision:candidate.revision,mesh:true,samples:[{axis:"Z",point:[-20,0,-1]},{axis:"Z",point:[20,0,-1]}]});
 expect(inspection.samples[0].intervals).toEqual([[0,10]]);expect(inspection.samples[1].intervals).toEqual([]);
 await tool("jumpstart_save_document",{editorId,expectedRevision:candidate.revision});await tool("jumpstart_reopen_document",{editorId,expectedRevision:candidate.revision,documentId:candidate.document.id});await get();
 await tool("jumpstart_export_model",{editorId,format:"stl",bodyIds:[part.id],name:"agent-general-hole-edit"});
 await tool("jumpstart_undo",{editorId,expectedRevision:candidate.revision});expect((await get()).revision).toBe(before.revision);
 const caps=await tool("jumpstart_get_capabilities",{includeSchemas:false});
 const {reportTrace}=await import("../benchmarks/trace-report.mjs");
 const report=await reportTrace(`exports/agent-traces/${caps.telemetry.sessionId}.jsonl`,"edit-move-hole");
 expect(report.pass,JSON.stringify(report.checks)).toBe(true);
 const blind=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Blind floor guard",primitives:[{id:"blind",name:"Blind plate",kind:"box",parameters:{w:80,d:60,h:10}}],operations:[{id:"bore",type:"modifier",target:"blind",modifier:{type:"hole",diameter:10,through:false,depth:5,at:[{p:[0,0,10],n:[0,0,1]}]}}]}});
 await tool("jumpstart_apply_model",{editorId,previewId:blind.previewId});
 const snap=await get(), target=snap.bodies.find(b=>b.name==="Blind plate"), bore=target.featureTree.mods.find(m=>m.t==="hole");
 const common={editorId,expectedRevision:snap.revision,expectedFingerprint:target.geometrySelectors.fingerprint,includeImage:false,requirements:{intent:{goal:"Deepen bore with an intact bottom floor",targetBodyIds:[target.id]},preserveRegions:[{id:"floor",bodyId:target.id,box:{min:[-40,-30,0],max:[40,30,2]}}]}};
 const unsafe=await tool("jumpstart_preview_feature_edit",{...common,edit:{bodyId:target.id,featureId:bore.id,action:"update",values:{depth:12}}});expect(unsafe.valid).toBe(false);
 await tool("jumpstart_apply_model",{editorId,previewId:unsafe.previewId},true);expect((await get()).revision).toBe(snap.revision);
 const safe=await tool("jumpstart_preview_feature_edit",{...common,edit:{bodyId:target.id,featureId:bore.id,action:"update",values:{depth:8}}});expect(safe.valid,JSON.stringify(safe.errors)).toBe(true);
 const floor=await tool("jumpstart_inspect_geometry",{editorId,bodyId:target.id,previewId:safe.previewId,samples:[{axis:"Z",point:[0,0,-1]}]});expect(floor.samples[0].intervals).toEqual([[0,2]]);

});

test("feature removal retains independent holes and a shell update retains its outer envelope",async({page})=>{
 const editorId=await editor(page), get=()=>tool("jumpstart_get_document",{editorId,includeGeometry:true});
 const seed=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Native feature baseline",primitives:[{id:"block",kind:"box",parameters:{w:60,d:40,h:20}}]}});
 const edges=seed.bodies[0].geometrySelectors.edges.filter(e=>e.t==="LINE"&&Math.abs(e.a[2]-e.b[2])>19);
 expect(edges).toHaveLength(4);
 const rounded=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Native feature baseline",primitives:[{id:"block",kind:"box",parameters:{w:60,d:40,h:20}}],operations:[{id:"round",type:"modifier",target:"block",modifier:{type:"fillet",radius:2,edges}},{id:"bore",type:"modifier",target:"block",modifier:{type:"hole",diameter:10,through:true,at:[{p:[0,0,20],n:[0,0,1]}]}}]}});
 await tool("jumpstart_apply_model",{editorId,previewId:rounded.previewId});
 const before=await get(), b=before.bodies[0], feature=b.featureTree.mods.find(m=>m.t==="fillet");
 const bigger=await tool("jumpstart_preview_feature_edit",{editorId,expectedRevision:before.revision,expectedFingerprint:b.geometrySelectors.fingerprint,includeImage:false,edit:{bodyId:b.id,featureId:feature.id,action:"update",values:{radius:4}},requirements:{intent:{goal:"Change only the existing outer fillet",targetBodyIds:[b.id]},preserveRegions:[{id:"bore",bodyId:b.id,box:{min:[-10,-10,0],max:[10,10,20]}}]}});
 expect(bigger.valid,JSON.stringify(bigger.errors)).toBe(true);expect(bigger.bodies[0].volume).toBeCloseTo((60*40-(4-Math.PI)*16)*20-Math.PI*25*20,3);
 const edit=await tool("jumpstart_preview_feature_edit",{editorId,expectedRevision:before.revision,expectedFingerprint:b.geometrySelectors.fingerprint,includeImage:false,edit:{bodyId:b.id,featureId:feature.id,action:"remove"},requirements:{intent:{goal:"Remove outer rounding while retaining the independent bore",targetBodyIds:[b.id]},preserveRegions:[{id:"bore",bodyId:b.id,box:{min:[-10,-10,0],max:[10,10,20]}}]}});
 expect(edit.valid,JSON.stringify(edit.errors)).toBe(true);expect(edit.bodies[0].volume).toBeCloseTo(60*40*20-Math.PI*25*20,3);
 expect(edit.bodies[0].featureTree.mods).toHaveLength(1);expect(edit.bodies[0].featureTree.mods[0].t).toBe("hole");
 const housing=await tool("jumpstart_preview_model",{editorId,includeImage:false,plan:{name:"Native feature baseline",primitives:[{id:"housing",name:"Housing",kind:"box",position:[100,0,0],parameters:{w:80,d:60,h:30}}],operations:[{id:"shell",type:"modifier",target:"housing",modifier:{type:"shell",thickness:2,faces:[{c:[0,0,30]}],direction:"in"}}]}});
 expect(housing.valid,JSON.stringify(housing.errors)).toBe(true);await tool("jumpstart_apply_model",{editorId,previewId:housing.previewId});
 const snapshot=await get(), target=snapshot.bodies.find(b=>b.name==="Housing"), shell=target.featureTree.mods.find(m=>m.t==="shell");
 const thicker=await tool("jumpstart_preview_feature_edit",{editorId,expectedRevision:snapshot.revision,expectedFingerprint:target.geometrySelectors.fingerprint,includeImage:false,edit:{bodyId:target.id,featureId:shell.id,action:"update",values:{thickness:3}},requirements:{intent:{goal:"Thicken the inward shell only",targetBodyIds:[target.id]},preserveBodyIds:[b.id],preserveRegions:[{id:"floor",bodyId:target.id,box:{min:[59,-31,0],max:[141,31,2]}}]}});
 expect(thicker.valid,JSON.stringify(thicker.errors)).toBe(true);expect(thicker.bodies[0].dimensions).toEqual({x:80,y:60,z:30});expect(thicker.bodies[0].volume).toBeCloseTo(80*60*30-74*54*27,2);

});
