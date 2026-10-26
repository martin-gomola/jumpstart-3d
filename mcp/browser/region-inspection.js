import { validateRegionBox } from "../shared/edit-contracts.js";
export async function inspectProtectedRegions(regions, before, after, kernel, intent) {
  const pending = [], results = [];
  const queries = [...regions, ...(intent?.changeRegion ? intent.targetBodyIds.map(bodyId=>({id:`outside:${bodyId}`,bodyId,box:{...intent.changeRegion,outside:true}})) : [])];
  for (const r of queries) {
    validateRegionBox(r.box);
    const a=before.get(r.bodyId), b=after.get(r.bodyId)?.nativeBody;
    if (!a || !b) results.push({id:r.id,status:"unknown",error:"Protected region body must exist in baseline and candidate"});
    else pending.push({id:r.id,a,b,region:r.box});
  }
  if (pending.length) {
    try { results.push(...await kernel.inspectPairs(pending)); }
    catch (error) { results.push(...pending.map(r=>({id:r.id,status:"unknown",error:error.message}))); }
  }
  return results;
}
