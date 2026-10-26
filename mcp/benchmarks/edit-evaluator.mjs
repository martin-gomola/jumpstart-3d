const near = (a,b,t=.05) => Number.isFinite(a) && Math.abs(a-b)<=t;
export function evaluateEditSession(session, task) {
 const checks=[], add=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
 const baseline=session.baseline, candidate=session.checkpoints?.candidate, doc=candidate?.document;
 const target=baseline?.bodies?.find(b=>b.name===task.targetName), final=doc?.bodies?.find(b=>b.id===target?.id);
 add("baseline-target",!!target && baseline.bodies.length>=2,"Target must be observed before editing");
 add("identity-and-native-history",!!final && final.featureTree && final.featureTree.t!=="mesh" && final.role===target?.role,"Preserve target identity and role; read back native features");
 const calls=session.calls||[], ok=name=>calls.filter(c=>c.name===name&&!c.error);
 const previews=(task.previewTools||["jumpstart_preview_feature_edit"]).flatMap(ok).filter(c=>c.result?.valid).sort((a,b)=>a.sequence-b.sequence), applies=ok("jumpstart_apply_model");
 add("preview-before-apply",applies.length>0 && applies.every(a=>previews.some(p=>p.sequence<a.sequence&&p.result.previewId===a.args.previewId)),"Every mutation needs a matching successful preview");
 const selected=previews.findLast(p=>applies.some(a=>a.args.previewId===p.result.previewId));
 add("requested-delta",selected?.result?.changes?.changed?.includes(target?.id),"The target geometry inputs must actually change");
 add("explicit-edit-contract",selected?.args?.requirements?.intent?.targetBodyIds?.includes(target?.id) && selected?.result?.acceptance?.passed,"Intent and independent acceptance must pass");
 const others=baseline?.bodies?.filter(b=>b.id!==target?.id)||[];
 add("preserve-other-bodies",others.every(b=>doc?.bodies?.some(a=>a.id===b.id) && selected?.result?.acceptance?.checks?.some(c=>c.kind==="sourcePreservation"&&c.bodyId===b.id&&c.pass===true)),"All baseline companion bodies need preservation checks");
 for(const [axis,expected] of Object.entries(task.dimensions||{})) add(`export-dimension-${axis}`,near(candidate?.stl?.dimensions?.[axis],expected),{expected,measured:candidate?.stl?.dimensions?.[axis]});
 if(task.volume!==undefined)add("native-volume",near(final?.volume,task.volume,.1),{expected:task.volume,measured:final?.volume});
 if(task.protectRegion)add("protected-interface",selected?.result?.acceptance?.checks?.some(c=>c.kind==="regionPreservation"&&c.bodyId===target?.id&&c.pass===true&&Number.isFinite(c.measured)&&c.measured<=.000001&&task.protectedBox&&c.box?.min.every((v,i)=>v<=task.protectedBox.min[i])&&c.box.max.every((v,i)=>v>=task.protectedBox.max[i])),"Native protected-region comparison required");
 if(task.field) {
  const mod=final?.featureTree?.mods?.find(m=>m.t===task.field.kind);
  add("feature-value",near(mod?.[task.field.key],task.field.expected),{expected:task.field.expected,measured:mod?.[task.field.key]});
 }
 if(task.addedKind)add("feature-added",!target?.featureTree?.mods?.some(m=>m.t===task.addedKind)&&final?.featureTree?.mods?.some(m=>m.t===task.addedKind),"Add the requested native feature to the existing body");
 if(task.removedKind)add("feature-removed",target?.featureTree?.mods?.some(m=>m.t===task.removedKind)&&!final?.featureTree?.mods?.some(m=>m.t===task.removedKind),"Remove the existing feature, not its body");
 const baselineInspections=ok("jumpstart_inspect_geometry").filter(c=>c.args.bodyId===target?.id&&c.result?.revision===baseline?.revision);
 const inspections=ok("jumpstart_inspect_geometry").filter(c=>c.args.bodyId===target?.id&&c.result?.revision===doc?.revision);
 add("independent-mesh",inspections.some(c=>c.result.meshValidation?.valid),"Inspect the actual final revision");
 for(const sample of [...(task.samples||[]),...(task.baselineSamples||[]).map(s=>({...s,baseline:true}))]) {
  const measured=(sample.baseline?baselineInspections:inspections).flatMap(c=>c.result.samples||[]).find(s=>!s.ambiguous && s.axis===sample.axis && s.point?.every((v,i)=>near(v,sample.point[i],.001)));
  add(`sample-${sample.id}`,measured?.intervals?.length===sample.intervals.length && measured.intervals.every((v,i)=>v.every((x,j)=>near(x,sample.intervals[i][j]))),{expected:sample,measured});
 }
 if(task.rejectedPreview)add("unsafe-preview-rejected",calls.some(c=>c.name==="jumpstart_preview_feature_edit"&&c.result?.valid===false&&!applies.some(a=>a.args.previewId===c.result.previewId)),"Failed acceptance may not be applied");
 add("save-reopen",ok("jumpstart_save_document").length && ok("jumpstart_reopen_document").length && session.checkpoints?.reopened?.document?.revision===doc?.revision,"Verify persistence in the same revision");
 add("undo",ok("jumpstart_undo").length && session.checkpoints?.undone?.document?.revision===baseline?.revision,"Restore the captured baseline");
 add("export-mesh",candidate?.stl?.triangles>0 && candidate.stl.degenerate===0,"Inspect exported binary STL independently");
 return {taskId:task.id,pass:checks.every(c=>c.pass),checks,recordedCalls:calls.length,agentReasoning:"Behavior evidence only; not a score for latent reasoning or physical fit"};
}
