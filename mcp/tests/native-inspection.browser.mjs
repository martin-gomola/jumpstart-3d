import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { loadDoc, watchErrors } from "../../test/helpers.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../test/projects/parametric-plate.json", import.meta.url), "utf8"));
let broker, baseURL, requestId = 0;

test.beforeAll(async ({}, info) => {
  if (info.project.name !== "site") return;
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1" },
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

async function tool(name, args = {}, expectError = false, includeImages = false) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  if (expectError) expect(payload.result.isError).toBe(true);
  else expect(payload.result.isError).not.toBe(true);
  const value = JSON.parse(payload.result.content.find((item) => item.type === "text").text);
  return includeImages ? { value, images: payload.result.content.filter(item => item.type === "image") } : value;
}

test("bare broker URL activates MCP and exposes native parameter bindings without editing", async ({ page }, info) => {
  test.skip(info.project.name !== "site", "The offline single-file build intentionally has no MCP broker");
  const errors = watchErrors(page);
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  await loadDoc(page, fixture);
  let editorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    editorId = listed.editors?.[0]?.editorId;
    return !!editorId;
  }).toBe(true);
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc));
  const result = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(result.nativeParameters).toEqual([
    { id: "q1", name: "w", expression: "40", unit: "mm", value: 40 },
    { id: "q2", name: "h", expression: "w/2", unit: "mm", value: 20 },
  ]);
  expect(result.nativeParametersTruncated).toBe(false);
  const dimensions = result.sketches.flatMap((sketch) => sketch.constraints).filter((constraint) => constraint.t === "dim");
  expect(dimensions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "d1", expr: "w", v: 40 }),
    expect.objectContaining({ id: "d2", expr: "h", v: 20 }),
  ]));
  expect(dimensions.every((dimension) => dimension.expr === "w" || dimension.expr === "h")).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
  expect(errors, "console or page errors").toEqual([]);
});


async function freshEditor(page) {
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90000 });
  await page.waitForSelector("#loading", { state: "hidden" });
  const documentId = await page.evaluate(() => window.__store.doc.id);
  let editorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    editorId = listed.editors.find(entry => entry.documentId === documentId)?.editorId;
    return !!editorId;
  }).toBe(true);
  return editorId;
}

test("MCP editor opens the subscription-client setup drawer without API-key fields", async ({ page }, info) => {
  await freshEditor(page);
  const status = page.locator("#ai-status"), panel = page.locator("#ai-setup-panel");
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(status).toBeVisible();
  await expect(status).toBeInViewport();
  await expect(panel).toBeHidden();
  await status.click();
  await expect(status).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Codex");
  await expect(panel).toContainText("Claude Code");
  await expect(panel).toContainText("Antigravity CLI");
  await expect(panel).toContainText("No model API key is needed");
  await expect(panel.locator("input")).toHaveCount(0);
  const mobilePanel = await panel.boundingBox();
  expect(mobilePanel.x).toBeGreaterThanOrEqual(0);
  expect(mobilePanel.x + mobilePanel.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `exports/ai-setup-live-mobile-${info.project.name}.png` });
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.screenshot({ path: `exports/ai-setup-live-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(status).toHaveAttribute("aria-expanded", "false");
});

test("native parameter previews are atomic, reject stale edits and survive save/reopen and undo", async ({ page }) => {
  const editorId = await freshEditor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const blank = await get();
  const plan = { name: "Agent, Test, Bracket", parameters: [{name: "w", expression: "60"}, {name: "h", expression: "w/2"}, {name: "t", expression: "8"}], rectangle: {id: "rectangle", widthExpression: "w", heightExpression: "h"}, extrude: {id: "bracket", distanceExpression: "t"} };
  const preview = await tool("jumpstart_preview_native_model", {editorId, expectedRevision: blank.revision, plan});
  expect(preview.valid).toBe(true); expect(preview.images.length).toBeGreaterThanOrEqual(3);
  expect((await get()).revision).toBe(blank.revision);
  const stale = await tool("jumpstart_preview_native_model", {editorId, expectedRevision: blank.revision, plan, includeImage: false});
  const applied = await tool("jumpstart_apply_model", {editorId, previewId: preview.previewId});
  expect((await tool("jumpstart_apply_model", {editorId, previewId: preview.previewId})).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", {editorId, previewId: stale.previewId}, true)).error).toMatch(/changed/);
  const failed = await tool("jumpstart_preview_native_parameters", {editorId, expectedRevision: applied.revision, values: {w: -1}}, true);
  expect(failed.error).toMatch(/invalid|skipped|evaluate/i); expect((await get()).revision).toBe(applied.revision);
  const revised = await tool("jumpstart_preview_native_parameters", {editorId, expectedRevision: applied.revision, values: {w: 80}});
  expect(revised.valid).toBe(true);
  await tool("jumpstart_apply_model", {editorId, previewId: revised.previewId});
  let current = await get();
  expect(current.nativeParameters.map(parameter => parameter.value)).toEqual([80,40,8]);
  expect(current.bodies[0].dimensions.x).toBeCloseTo(80, 3);
  expect(current.bodies[0].featureTree.exprs.dist).toBe("t");
  await tool("jumpstart_save_document", {editorId, expectedRevision: current.revision, versioned: true});
  current = await get();
  await tool("jumpstart_reopen_document", {editorId, expectedRevision: current.revision, documentId: current.document.id});
  expect((await get()).revision).toBe(current.revision);
  for (let i=0;i<2;i++) await tool("jumpstart_undo", {editorId, expectedRevision: (await get()).revision});
  expect((await get()).bodies).toEqual([]); expect((await get()).nativeParameters).toEqual([]);
});

test("native Lathe recipes revise without accumulating assets and export valid 3MF", async ({page}) => {
  const editorId = await freshEditor(page);
  const get = () => tool("jumpstart_get_document", {editorId, includeGeometry: true});
  const plan = {name: "Agent, Test, Cup", blank: {kind: "round", diameter: 60, length: 90}, profile: [[0,22],[50,26.45],[56,27],[60,23.3],[64,27.7],[90,30]], hollow: {wall:3,base:6,end:"tail",style:"follow"}};
  let current = await get();
  const preview = await tool("jumpstart_preview_lathe", {editorId, expectedRevision:current.revision, plan});
  expect(preview.valid).toBe(true); expect((await get()).revision).toBe(current.revision);
  await tool("jumpstart_apply_model", {editorId, previewId:preview.previewId});
  current = await get(); const bodyId = current.bodies[0].id;
  expect(current.bodies[0].turned.hollow).toBe(true);
  const revision = await tool("jumpstart_preview_lathe", {editorId, expectedRevision:current.revision, bodyId, plan:{...plan,scale:1.1}});
  await tool("jumpstart_apply_model", {editorId, previewId:revision.previewId});
  current = await get(); expect(current.bodies[0].id).toBe(bodyId); expect(current.bodies[0].dimensions.z).toBeCloseTo(99,3);
  expect(current.bodies[0].featureTree.mods[0].t).toBe("scale");
  expect(await page.evaluate(() => Object.keys(window.__store.doc.assets).length)).toBe(1);
  const exported = await tool("jumpstart_export_model", {editorId, format:"3mf", name:"native-cup-test"});
  expect(exported.format).toBe("3mf"); expect(exported.byteLength).toBeGreaterThan(500);
  for(let i=0;i<2;i++) await tool("jumpstart_undo", {editorId, expectedRevision:(await get()).revision});
  expect((await get()).bodies).toEqual([]);
});


test("frame spacer preview fits every camera and persists measured assumptions through revisions", async ({page}) => {
  const editorId = await freshEditor(page);
  const get = () => tool("jumpstart_get_document", {editorId,includeGeometry:true});
  await page.evaluate(() => { window.__app.vp.anim = null; });
  const blank = await get();
  let proposal;
  for (const [width,height] of [[1400,700],[390,844],[1400,460]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(() => window.__app.vp.w === window.__app.vp.container.clientWidth && window.__app.vp.h === window.__app.vp.container.clientHeight);
    const result = await tool("jumpstart_preview_frame", {editorId,expectedRevision:blank.revision,plan:{name:"Switch spacer",modelId:"spacer",outerWidth:86,outerDepth:86,height:10}},false,true);
    proposal = result.value; expect(proposal.valid).toBe(true); expect(proposal.imageErrors).toEqual([]);
    expect(proposal.designContext.dimensionSources.wall.source).toBe("assumed");
    expect(proposal.frameInspection.passed).toBe(true); expect(proposal.frameInspection.measured.openingWidth).toBeCloseTo(76,2);
    expect(proposal.images.length).toBe(3); expect(result.images.length).toBe(3);
    for (const metadata of proposal.images) expect(metadata.framing.fullyVisible).toBe(true);
    for (const image of result.images) {
      const perimeter = await page.evaluate(async ({data,mimeType}) => {
        const image = new Image(); image.src = `data:${mimeType};base64,${data}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
        const background=[...pixels.slice(0,3)];let changed=0;
        const sample=(x,y)=>{const offset=(y*image.width+x)*4;if(background.some((v,i)=>Math.abs(v-pixels[offset+i])>20))changed++;};
        for(let x=0;x<image.width;x++){sample(x,0);sample(x,image.height-1);}for(let y=0;y<image.height;y++){sample(0,y);sample(image.width-1,y);}
        return {changed,width:image.width,height:image.height};
      },image);
      expect(perimeter.changed, "Model must not touch any image edge").toBe(0);
    }
    expect((await get()).revision).toBe(blank.revision);
  }
  const wrong = await tool("jumpstart_inspect_geometry", {editorId,previewId:proposal.previewId,bodyId:proposal.bodies[0].id,frame:{outerWidth:86,outerDepth:86,height:10,wall:4}});
  expect(wrong.frame.passed).toBe(false);
  expect((await tool("jumpstart_apply_model",{editorId,previewId:proposal.previewId},true)).error).toMatch(/failed requested geometry checks/);
  expect((await get()).revision).toBe(blank.revision);
  const corrected = await tool("jumpstart_inspect_geometry", {editorId,previewId:proposal.previewId,bodyId:proposal.bodies[0].id,frame:{outerWidth:86,outerDepth:86,height:10,wall:5}});
  expect(corrected.frame.passed).toBe(true);
  await tool("jumpstart_apply_model",{editorId,previewId:proposal.previewId});
  let current=await get();const bodyId=current.bodies[0].id;
  const revision=await tool("jumpstart_preview_parameters",{editorId,expectedRevision:current.revision,modelId:"spacer",values:{wall:4,height:12}});
  expect(revision.valid).toBe(true);expect(revision.designContext.dimensionSources.wall.source).toBe("supplied");expect(revision.designContext.dimensionSources.wall.value).toBe(4);
  expect(revision.frameInspection.measured.openingWidth).toBeCloseTo(78,2);
  await tool("jumpstart_apply_model",{editorId,previewId:revision.previewId});current=await get();expect(current.bodies[0].id).toBe(bodyId);
  const measured=await tool("jumpstart_inspect_geometry",{editorId,expectedRevision:current.revision,bodyId,frame:{outerWidth:86,outerDepth:86,height:12,wall:4}});
  expect(measured.frame.passed).toBe(true);
  await tool("jumpstart_save_document",{editorId,expectedRevision:current.revision});
  await tool("jumpstart_reopen_document",{editorId,expectedRevision:current.revision,documentId:current.document.id});
  expect((await get()).parametricModels[0].designContext.dimensionSources.wall.value).toBe(4);
  const stl=await tool("jumpstart_export_model",{editorId,format:"stl",name:"frame-spacer-regression"});expect(stl.meshValidation.valid).toBe(true);
  for(let i=0;i<2;i++)await tool("jumpstart_undo",{editorId,expectedRevision:(await get()).revision});
  expect((await get()).bodies).toEqual([]);
});
