import { test, expect } from "@playwright/test";
import { buildGridfinity, normalizeGridfinity } from "../browser/gridfinity.js";
import { resolveGridfinityFixture as resolveNode } from "./gridfinity-test-helpers.mjs";
import { boot, loadDoc, newDoc, body, IDENTITY, watchErrors } from "../../test/helpers.mjs";

function fixture(specs) {
  const doc=newDoc("Gridfinity geometry","advanced");let id=0;
  for (const [i,spec] of specs.entries()) {
    const operation=normalizeGridfinity({id:`grid-${i}`,type:"gridfinity",...spec});
    const {node,recipe}=buildGridfinity(operation,{document:doc,idFactory:prefix=>`${prefix}-${++id}`});
    const m=IDENTITY.slice();m[12]=operation.position[0];m[13]=operation.position[1];m[14]=operation.position[2];
    doc.bodies.push(body(`body-${i}`,operation.name,node,m,{mcpGridfinity:recipe}));
  }
  return doc;
}

test("native Gridfinity insert and socket baseplate have measured bounds and noninterfering aligned geometry",async({page},info)=>{
  const errors=watchErrors(page);
  const doc=fixture([{kind:"insert",columns:2,rows:3,position:[0,0,0.25]},{kind:"baseplate",columns:2,rows:3}]);
  await boot(page,info);await loadDoc(page,doc);
  const measured=await page.evaluate(()=>window.__store.doc.bodies.map(body=>{
    const view=window.__app.scene.views.get(body.id);return {error:window.__app.scene.errors.get(body.id)||null,volume:view?.data?.volume,bounds:view?.data?.bbox};
  }));
  expect(measured.map(body=>body.error),JSON.stringify(measured)).toEqual([null,null]);
  expect(measured[0].volume).toBeGreaterThan(100000);
  expect(measured[0].bounds.min[0]).toBeCloseTo(-41.75,3);
  expect(measured[0].bounds.max[1]).toBeCloseTo(62.75,3);
  expect(measured[0].bounds.max[2]).toBeCloseTo(21,3);
  expect(measured[1].bounds.max[0]).toBeCloseTo(42,3);
  expect(measured[1].bounds.max[1]).toBeCloseTo(63,3);
  expect(measured[1].bounds.max[2]).toBeCloseTo(5,3);
  const pairs=[{id:"fit",a:{node:resolveNode(doc.bodies[0].node,doc),m:doc.bodies[0].m},b:{node:resolveNode(doc.bodies[1].node,doc),m:doc.bodies[1].m}}];
  const [fit]=await page.evaluate(pairs=>window.__app.kernel.inspectPairs(pairs),pairs);
  expect(fit.status,JSON.stringify(fit)).toBe("measured");
  expect(fit.overlapVolumeMm3).toBeCloseTo(0,5);
  expect(fit.distanceMm).toBeCloseTo(0,6);
  expect(errors).toEqual([]);
});

test("native divided bin with stacking lip builds as a connected editable solid",async({page},info)=>{
  const errors=watchErrors(page);
  const doc=fixture([{kind:"bin",columns:2,rows:3,lip:true,dividers:{x:1,y:2}}]);
  await boot(page,info);await loadDoc(page,doc);
  const measured=await page.evaluate(()=>{
    const body=window.__store.doc.bodies[0],view=window.__app.scene.views.get(body.id);
    return {error:window.__app.scene.errors.get(body.id)||null,volume:view?.data?.volume,bounds:view?.data?.bbox};
  });
  expect(measured.error,JSON.stringify(measured)).toBeNull();
  expect(measured.volume).toBeGreaterThan(10000);
  expect(measured.bounds.max[2]).toBeCloseTo(25.4,3);
  const native={node:resolveNode(doc.bodies[0].node,doc),m:IDENTITY};
  const other={node:{t:"prim",kind:"box",p:{w:2,d:2,h:2},mods:[]},m:[1,0,0,0,0,1,0,0,0,0,1,0,200,0,0,1]};
  const [inspection]=await page.evaluate(pairs=>window.__app.kernel.inspectPairs(pairs),[{id:"single",a:native,b:other}]);
  expect(inspection.status,JSON.stringify(inspection)).toBe("measured");
  expect(errors).toEqual([]);
});

test("supported maximum grids and the narrow minimum-height lip bin build within the native budget",async({page},info)=>{
  const errors=watchErrors(page);
  const doc=fixture([
    {kind:"insert",columns:4,rows:4},
    {kind:"bin",columns:4,rows:4,lip:true,dividers:{x:2,y:2},position:[200,0,0]},
    {kind:"bin",columns:1,rows:1,heightUnits:2,wall:4,floor:6,lip:true,dividers:{x:6,y:6},position:[400,0,0]},
  ]);
  await boot(page,info);
  const started=performance.now();await loadDoc(page,doc);
  const elapsedMs=Math.round(performance.now()-started);
  const measured=await page.evaluate(()=>window.__store.doc.bodies.map(body=>{
    const view=window.__app.scene.views.get(body.id);
    return {error:window.__app.scene.errors.get(body.id)||null,volume:view?.data?.volume,faces:view?.data?.faceInfo?.length,triangles:view?.data?.triangles?.length/3,bounds:view?.data?.bbox};
  }));
  expect(measured.map(body=>body.error),JSON.stringify(measured)).toEqual([null,null,null]);
  expect(measured.every(body=>Number.isFinite(body.volume)&&body.volume>0)).toBe(true);
  expect(measured[0].bounds.max[0]).toBeCloseTo(83.75,3);
  expect(measured[1].bounds.max[2]).toBeCloseTo(25.4,3);
  expect(measured[2].bounds.max[2]).toBeCloseTo(18.4,3);
  console.info(JSON.stringify({gridfinityNativeBudget:{elapsedMs,profiles:doc.sketches.length,bodies:measured.map(({volume,faces,triangles})=>({volume,faces,triangles}))}}));
  expect(errors).toEqual([]);
});

test("4x5 and 6x6 native bins and magnetic socket carriers have connected measured geometry", async ({ page }, info) => {
  const errors = watchErrors(page);
  const document = fixture([{ kind: "bin", columns: 4, rows: 5 }, { kind: "bin", columns: 6, rows: 6, magnets: true, lip: true, position: [400, 0, 0] }, { kind: "baseplate", columns: 6, rows: 6, magnets: true, position: [800, 0, 0] }]);
  await boot(page, info); const started = Date.now(); await loadDoc(page, document);
  const parts = await page.evaluate(() => window.__store.doc.bodies.map(body => {
    const view = window.__app.scene.views.get(body.id);
    return { error: window.__app.scene.errors.get(body.id), bounds: view.data?.bbox, volume: view.data?.volume, vertices: Array.from(view.data?.vertices || []), triangles: Array.from(view.data?.triangles || []) };
  }));
  const { inspectGeometry } = await import("../browser/inspection.js");
  for (const part of parts) {
    expect(part.error).toBeUndefined(); expect(part.volume).toBeGreaterThan(0);
    const mesh = inspectGeometry(part, { mesh: true }).meshValidation;
    expect(mesh.valid).toBe(true); expect(mesh.disconnectedComponents).toBe(1);
  }
  expect(parts[0].bounds.max[0] - parts[0].bounds.min[0]).toBeCloseTo(167.5, 3);
  expect(parts[0].bounds.max[1] - parts[0].bounds.min[1]).toBeCloseTo(209.5, 3);
  expect(parts[1].bounds.max[0] - parts[1].bounds.min[0]).toBeCloseTo(251.5, 3);
  expect(parts[2].bounds.max[2]).toBeCloseTo(8.2, 3);
  console.info(JSON.stringify({ largerGridfinityBuildMs: Date.now() - started, bodies: parts.length }));
  expect(errors).toEqual([]);
});
