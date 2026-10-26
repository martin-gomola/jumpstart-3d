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

test("open bin walls remove their rims while retaining connected floors and Gridfinity feet", async ({ page }, info) => {
  const errors = watchErrors(page);
  const sides = ["left", "right", "front", "back"];
  const specs = [[], ...sides.map(side => [side]), sides, sides];
  const document = fixture(specs.map((openSides, index) => ({ kind: "bin", columns: 2, rows: 1, lip: true, openSides, ...(index === 6 ? { dividers: { x: 1 } } : {}), position: [index * 110, 0, 0] })));
  await boot(page, info); await loadDoc(page, document);
  const parts = await page.evaluate(() => window.__store.doc.bodies.map(body => {
    const data = window.__app.scene.views.get(body.id)?.data;
    return { error: window.__app.scene.errors.get(body.id), bounds: data?.bbox, volume: data?.volume, vertices: Array.from(data?.vertices || []), triangles: Array.from(data?.triangles || []) };
  }));
  const { inspectGeometry } = await import("../browser/inspection.js");
  for (const part of parts) {
    expect(part.error).toBeUndefined(); expect(part.volume).toBeGreaterThan(0);
    const validation = inspectGeometry(part, { mesh: true }).meshValidation;
    expect(validation.valid).toBe(true); expect(validation.disconnectedComponents).toBe(1);
  }
  expect(parts[5].bounds.max[2]).toBeCloseTo(9, 5);
  expect(parts[6].bounds.max[2]).toBeCloseTo(20.99, 5);
  const probe = (w, d, h, x = 0, y = 0, z = 0) => ({ node: { t: "prim", kind: "box", p: { w, d, h, r: 0, c: 0 }, mods: [] }, m: [...IDENTITY.slice(0, 12), x, y, z, 1] });
  const pairs = [];
  for (let index = 0; index < document.bodies.length; index++) {
    const native = { node: resolveNode(document.bodies[index].node, document), m: IDENTITY };
    pairs.push({ id: `base-${index}`, a: native, b: probe(90, 50, 9) });
    if (index === 6) pairs.push({ id: "retained-divider", a: native, b: probe(.5, .5, 2, 0, -18.8, 12) });
    if (index <= 2) {
      pairs.push({ id: `retained-front-${index}`, a: native, b: probe(90, .5, 12, 0, -20.5, 10) });
      pairs.push({ id: `retained-back-${index}`, a: native, b: probe(90, .5, 12, 0, 20.5, 10) });
    }
    if (index >= 1 && index <= 4) {
      const side = sides[index - 1], x = side === "left" ? -41.15 : side === "right" ? 41.15 : 0, y = side === "front" ? -20.15 : side === "back" ? 20.15 : 0;
      const shape = side === "left" || side === "right" ? [.4, 4] : [4, .4];
      pairs.push({ id: `wall-${side}`, a: native, b: probe(...shape, 4, x, y, 12) });
      pairs.push({ id: `rim-${side}`, a: native, b: probe(...shape, .5, x, y, 22) });
    }
  }
  const measured = [];
  for (let offset = 0; offset < pairs.length; offset += 8) measured.push(...await page.evaluate(pairs => window.__app.kernel.inspectPairs(pairs), pairs.slice(offset, offset + 8)));
  expect(measured.every(result => result.status === "measured"), JSON.stringify(measured)).toBe(true);
  const base = measured.find(result => result.id === "base-0").overlapVolumeMm3;
  const front = measured.find(result => result.id === "retained-front-0").overlapVolumeMm3, back = measured.find(result => result.id === "retained-back-0").overlapVolumeMm3;
  for (const result of measured) {
    if (result.id.startsWith("base-")) expect(result.overlapVolumeMm3).toBeCloseTo(base, 5);
    else if (result.id === "retained-divider") expect(result.overlapVolumeMm3).toBeGreaterThan(.4);
    else if (result.id.startsWith("retained-front")) expect(result.overlapVolumeMm3).toBeCloseTo(front, 5);
    else if (result.id.startsWith("retained-back")) expect(result.overlapVolumeMm3).toBeCloseTo(back, 5);
    else expect(result.overlapVolumeMm3).toBeCloseTo(0, 6);
  }
  expect(errors).toEqual([]);
});

test("separately printable adjoining bins clear a 280 mm item across their open sides", async ({ page }, info) => {
  const { compileMcpModel } = await import("../browser/models.js");
  const definition = { id: "drawer", type: "drawerLayout", width: 294, depth: 84, height: 50, includeBaseplate: false, binLimits: { columns: 5, rows: 5 }, printArea: { width: 250, depth: 250, height: 250, edgeMargin: 2 }, bins: [
    { id: "main", x: 0, y: 0, columns: 5, rows: 2, openSides: ["right"] },
    { id: "extension", x: 5, y: 0, columns: 2, rows: 2, openSides: ["left"] },
  ] };
  const document = compileMcpModel(newDoc("Long item bins", "advanced"), { operations: [definition] }).document;
  const closed = compileMcpModel(newDoc("Closed control", "advanced"), { operations: [{ ...definition, bins: definition.bins.map(bin => ({ ...bin, openSides: [] })) }] }).document;
  await boot(page, info); await loadDoc(page, document);
  const errors = await page.evaluate(() => [...window.__app.scene.errors.values()].map(String));
  expect(errors).toEqual([]);
  expect(document.bodies).toHaveLength(2);
  expect(document.bodies.every(body => body.mcpPrintFit.configured)).toBe(true);
  expect(document.bodies.map(body => body.mcpGridfinity.width)).toEqual([209.5, 83.5]);
  const item = { node: { t: "prim", kind: "box", p: { w: 280, d: 20, h: 5, r: 0, c: 0 }, mods: [] }, m: [...IDENTITY.slice(0, 12), 0, 0, 10, 1] };
  const pairs = [document, closed].flatMap((source, index) => source.bodies.map((body, i) => ({ id: `${index ? "closed" : "open"}-${i}`, a: { node: resolveNode(body.node, source), m: body.m }, b: item })));
  const measured = await page.evaluate(pairs => window.__app.kernel.inspectPairs(pairs), pairs);
  expect(measured.every(result => result.status === "measured"), JSON.stringify(measured)).toBe(true);
  for (const result of measured) {
    if (result.id.startsWith("open")) expect(result.overlapVolumeMm3).toBeCloseTo(0, 6);
    else expect(result.overlapVolumeMm3).toBeGreaterThan(1);
  }
  await page.screenshot({ path: info.outputPath("adjoining-open-bins.png") });
});

test("legacy adjoining open bins retain the standard clearance and rounded floor-corner cutout", async ({ page }, info) => {
  const doc = fixture([{ kind: "bin", openSides: ["right"] }, { kind: "bin", openSides: ["left"], position: [42, 0, 0] }]);
  await boot(page, info); await loadDoc(page, doc);
  const native = index => ({ node: resolveNode(doc.bodies[index].node, doc), m: doc.bodies[index].m });
  const m = IDENTITY.slice(); m[12] = 20.9; m[13] = -20.4; m[14] = 7.5;
  const witness = { node: { t: "prim", kind: "box", p: { w: .1, d: .1, h: 1 }, mods: [] }, m };
  const values = await page.evaluate(pairs => window.__app.kernel.inspectPairs(pairs), [
    { id: "seam", a: native(0), b: native(1) }, { id: "corner", a: native(0), b: witness },
  ]);
  expect(values.every(v => v.status === "measured"), JSON.stringify(values)).toBe(true);
  expect(values[0].distanceMm).toBeCloseTo(.5, 5);
  expect(values[1].overlapVolumeMm3).toBeCloseTo(0, 6);
  console.log(JSON.stringify({ openBinGapMm: values[0].distanceMm, roundedCornerWitnessVolume: values[1].overlapVolumeMm3 }));
});

test("flush open edges continue down to the feet without a rounded ledge and retain socket clearance", async ({ page }, info) => {
  const errors = watchErrors(page);
  const doc = fixture([
    { kind: "bin", openSides: ["right"], closeGaps: true, lip: true },
    { kind: "bin", openSides: ["left"], closeGaps: true, lip: true, position: [42, 0, 0] },
    { kind: "bin", openSides: ["right"], lip: true, position: [-100, 0, 0] },
    { kind: "baseplate", columns: 2, rows: 1, position: [21, 0, -.25] },
  ]);
  await boot(page, info); await loadDoc(page, doc);
  const { inspectGeometry } = await import("../browser/inspection.js");
  const parts = await page.evaluate(() => window.__store.doc.bodies.map(b => {
    const d = window.__app.scene.views.get(b.id)?.data;
    return { error: window.__app.scene.errors.get(b.id), bbox: d?.bbox, vertices: Array.from(d?.vertices || []), triangles: Array.from(d?.triangles || []) };
  }));
  for (const part of parts) { expect(part.error).toBeUndefined(); expect(inspectGeometry(part, { mesh: true }).meshValidation.valid).toBe(true); }
  expect(parts[0].bbox.max[0]).toBeCloseTo(21, 5);
  expect(parts[1].bbox.min[0]).toBeCloseTo(-21, 5);
  const native = (index, local = false) => ({ node: resolveNode(doc.bodies[index].node, doc), m: local ? IDENTITY : doc.bodies[index].m });
  const probe = (w,d,h,x,y,z) => { const m = IDENTITY.slice(); m[12]=x;m[13]=y;m[14]=z;return { node: {t:"prim",kind:"box",p:{w,d,h},mods:[]},m }; };
  const values = await page.evaluate(pairs => window.__app.kernel.inspectPairs(pairs), [
    { id: "join", a: native(0), b: native(1) },
    { id: "corner", a: native(0), b: probe(.1,.1,1,20.9,-20.4,7.5) },
    { id: "closed-corner", a: native(0), b: probe(.1,.1,1,-20.4,-20.4,5.5) },
    { id: "rim-at-join", a: native(0), b: probe(.1,.1,.2,20.9,18.8,20.6) },
    { id: "base-flush", a: native(0,true), b: probe(45,45,4.75,0,0,0) },
    { id: "base-original", a: native(2,true), b: probe(45,45,4.75,0,0,0) },
    { id: "socket", a: native(0), b: native(3) },
    { id: "lower-straight-corner", a: native(0), b: probe(.1,.1,1,20.9,-20.4,5.5) },
  ]);
  expect(values.every(v => v.status === "measured"), JSON.stringify(values)).toBe(true);
  expect(values[0].distanceMm).toBeCloseTo(0, 6); expect(values[0].overlapVolumeMm3).toBeCloseTo(0, 6);
  expect(values[1].overlapVolumeMm3).toBeCloseTo(.01, 5);
  expect(values[2].overlapVolumeMm3).toBeCloseTo(0, 6);
  expect(values[3].overlapVolumeMm3).toBeCloseTo(.002, 6);
  expect(values[4].overlapVolumeMm3).toBeCloseTo(values[5].overlapVolumeMm3, 5);
  expect(values[6].overlapVolumeMm3).toBeCloseTo(0, 5);
  expect(values[7].overlapVolumeMm3).toBeCloseTo(.01, 5);
  await page.screenshot({ path: "exports/ai-panel/flush-open-bin-native.png" });
  await page.evaluate(() => {
    const app=window.__app, box=app.scene.allBox(b=>b.id === "body-0");
    box.min.set(14,-23,2); box.max.set(28,-18,12);
    app.vp.setView("front",box);
  });
  await page.waitForFunction(()=>!window.__app.vp.anim);
  await page.screenshot({path:"exports/ai-panel/flush-open-bin-lower-joint.png"});
  expect(errors).toEqual([]);
});

test("flush openings build connected native solids on every axis and preserve dividers and magnet interfaces", async ({ page }, info) => {
  const cases = [
    { openSides: ["left"] }, { openSides: ["front"] }, { openSides: ["back"] },
    { openSides: ["left","front"], columns: 2, rows: 2, dividers: { x: 1, y: 1 } },
    { openSides: ["left","right"] }, { openSides: ["left","right","front","back"] },
    { openSides: ["left","right","front","back"], dividers: { x: 1, y: 1 } },
    { openSides: ["left","right"], columns: 6, rows: 6, magnets: true },
    { openSides: ["right"], heightUnits: 2, wall: 4, floor: 6, dividers: { x: 6, y: 6 } },
    { openSides: ["left","right","front","back"], heightUnits: 2, wall: 4, floor: 6 },
  ];
  const doc = fixture(cases.map((spec, i) => ({ kind: "bin", closeGaps: true, lip: true, position: [i*300,0,0], ...spec })));
  const errors = watchErrors(page); await boot(page, info); await loadDoc(page, doc);
  const { inspectGeometry } = await import("../browser/inspection.js");
  const parts = await page.evaluate(() => window.__store.doc.bodies.map(b => { const d=window.__app.scene.views.get(b.id)?.data;return {error:window.__app.scene.errors.get(b.id),vertices:Array.from(d?.vertices||[]),triangles:Array.from(d?.triangles||[]),bbox:d?.bbox}; }));
  for (const p of parts) { expect(p.error).toBeUndefined(); const mesh=inspectGeometry(p,{mesh:true}).meshValidation;expect(mesh.valid).toBe(true);expect(mesh.disconnectedComponents).toBe(1); }
  for (const [index,point] of [[0,[-20.9,-20.4,-1]],[1,[20.4,-20.9,-1]],[2,[20.4,20.9,-1]]]) {
    const result=inspectGeometry(parts[index],{samples:[{axis:"Z",point}]});
    expect(result.samples[0].intervals[0][0]).toBeCloseTo(4.75,5);
  }
  expect(parts[5].bbox.max[2]).toBeCloseTo(9,5); expect(parts[6].bbox.max[2]).toBeCloseTo(20.99,5);
  expect(parts[7].bbox.max[0]-parts[7].bbox.min[0]).toBeCloseTo(252,5);
  expect(errors).toEqual([]);
});
