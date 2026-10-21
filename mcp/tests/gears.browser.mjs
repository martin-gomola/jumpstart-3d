import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0;

test.beforeAll(async () => {
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

async function verifyGearWorkflow(page, plan, inspectPreview) {
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  inspectPreview(preview);
  expect((await get()).revision).toBe(before.revision);
  expect((await get()).bodies).toHaveLength(0);

  for (const body of preview.bodies) {
    const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: body.id, previewId: preview.previewId, mesh: true });
    expect(inspection.meshValidation.valid).toBe(true);
    expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);
  }

  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.bodies).toHaveLength(preview.bodies.length);
  expect(saved.bodies.map(({ featureTree }) => featureTree)).toEqual(preview.bodies.map(({ featureTree }) => featureTree));
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
}

test("spur gears preview measured native geometry, inspect, apply idempotently, reject stale preview and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const plan = {
    name: "Spur gear pair",
    operations: [
      { id: "bored", type: "gear", gearType: "spur", module: 2, teeth: 24, pressureAngle: 20, thickness: 6, bore: 5 },
      { id: "solid", type: "gear", gearType: "spur", module: 2, teeth: 24, pressureAngle: 20, thickness: 6, position: [70, 0, 0] },
    ],
  };
  await verifyGearWorkflow(page, plan, (preview) => {
    expect(preview.bodies).toHaveLength(2);
    const [bored, solid] = preview.bodies;
    expect(bored.volume).toBeGreaterThan(0);
    expect(solid.volume).toBeGreaterThan(bored.volume);
    for (let axis = 0; axis < 3; axis++) {
      expect(bored.bounds.min[axis]).toBeCloseTo([-26, -26, 0][axis], 1);
      expect(bored.bounds.max[axis]).toBeCloseTo([26, 26, 6][axis], 1);
    }
    expect(bored.featureTree).toMatchObject({ t: "prim", kind: "gear", p: { module: 2, teeth: 24, pressureAngle: 20, thickness: 6, bore: 5 } });
    expect(solid.featureTree).toMatchObject({ t: "prim", kind: "gear", p: { module: 2, teeth: 24, thickness: 6 } });
  });
  expect(errors).toEqual([]);
});

test("racks preview measured native geometry, inspect, apply idempotently, reject stale preview and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const plan = {
    name: "Rack",
    operations: [{ id: "rack", type: "gear", gearType: "rack", module: 1.5, teeth: 30, pressureAngle: 20, thickness: 5, baseDepth: 4, position: [0, 60, 0] }],
  };
  await verifyGearWorkflow(page, plan, (preview) => {
    expect(preview.bodies).toHaveLength(1);
    const [rack] = preview.bodies;
    expect(rack.volume).toBeGreaterThan(0);
    expect(rack.bounds.min[0]).toBeCloseTo(-Math.PI * 1.5 * 30 / 2, 1);
    expect(rack.bounds.max[0]).toBeCloseTo(Math.PI * 1.5 * 30 / 2, 1);
    expect(rack.bounds.min[1]).toBeCloseTo(60 - 4 - 1.25 * 1.5, 1);
    expect(rack.bounds.max[1]).toBeCloseTo(60 + 1.5, 1);
    expect(rack.bounds.max[2] - rack.bounds.min[2]).toBeCloseTo(5, 2);
    expect(rack.featureTree).toMatchObject({ t: "prim", kind: "rack", p: { module: 1.5, teeth: 30, pressureAngle: 20, thickness: 5, baseDepth: 4 } });
  });
  expect(errors).toEqual([]);
});

test("straight bevel gears create a conical native solid through preview, inspection, apply, and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const plan = {
    name: "Bevel gear",
    operations: [{ id: "bevel", type: "gear", gearType: "bevel", module: 2, teeth: 24, pressureAngle: 20, thickness: 6, coneAngle: 45, bore: 5 }],
  };
  await verifyGearWorkflow(page, plan, (preview) => {
    expect(preview.bodies).toHaveLength(1);
    const [gear] = preview.bodies;
    expect(gear.volume).toBeGreaterThan(0);
    expect(gear.bounds.min[0]).toBeCloseTo(-26, 1);
    expect(gear.bounds.max[0]).toBeCloseTo(26, 1);
    expect(gear.bounds.min[1]).toBeCloseTo(-26, 1);
    expect(gear.bounds.max[1]).toBeCloseTo(26, 1);
    expect(gear.bounds.min[2]).toBeCloseTo(0, 2);
    expect(gear.bounds.max[2]).toBeCloseTo(6, 2);
    expect(gear.featureTree).toMatchObject({ t: "prim", kind: "bevelgear", p: { module: 2, teeth: 24, pressureAngle: 20, thickness: 6, coneAngle: 45, bore: 5 } });
  });
  expect(errors).toEqual([]);
});

test("gear parameters remain editable through the editor timeline", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const preview = await tool("jumpstart_preview_model", {
    editorId, expectedRevision: before.revision, includeImage: false,
    plan: { name: "Editable spur", operations: [{ id: "gear", type: "gear", gearType: "spur", module: 2, teeth: 18, thickness: 5 }] },
  });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });

  await page.locator("#mode-advanced").click();
  await page.locator("#timeline .tl-item").last().dblclick();
  const moduleField = page.locator("#pr-gear-module");
  await expect(moduleField).toBeVisible();
  await expect(moduleField).toHaveValue("2");
  await expect(page.locator("#pr-gear-teeth")).toHaveValue("18");
  await expect(page.locator("#pr-gear-bore")).toBeVisible();
  await page.screenshot({ path: "/tmp/jumpstart-gear-editor.png" });
  await moduleField.fill("2.5");
  await moduleField.press("Tab");
  await page.locator("#cmd-ok").click();

  const edited = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(edited.revision).not.toBe(applied.revision);
  expect(edited.bodies[0].featureTree.p.module).toBe(2.5);
  await tool("jumpstart_undo", { editorId, expectedRevision: edited.revision });
  const reverted = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(reverted.bodies[0].featureTree.p.module).toBe(2);
  await tool("jumpstart_undo", { editorId, expectedRevision: reverted.revision });
  expect((await tool("jumpstart_get_document", { editorId })).bodies).toHaveLength(0);
});

test("bevel gear cone angle and bore remain editable through the editor timeline", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const preview = await tool("jumpstart_preview_model", {
    editorId, expectedRevision: before.revision, includeImage: false,
    plan: { name: "Editable bevel", operations: [{ id: "gear", type: "gear", gearType: "bevel", module: 2, teeth: 20, thickness: 5, coneAngle: 40, bore: 4 }] },
  });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });

  await page.locator("#mode-advanced").click();
  await page.locator("#timeline .tl-item").last().dblclick();
  await expect(page.locator("#pr-gear-coneAngle")).toHaveValue("40");
  await expect(page.locator("#pr-gear-bore")).toBeVisible();
  const coneAngle = page.locator("#pr-gear-coneAngle");
  await coneAngle.fill("35");
  await coneAngle.press("Tab");
  await page.locator("#cmd-ok").click();

  const edited = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(edited.revision).not.toBe(applied.revision);
  expect(edited.bodies[0].featureTree.p.coneAngle).toBe(35);
  await tool("jumpstart_undo", { editorId, expectedRevision: edited.revision });
  await tool("jumpstart_undo", { editorId, expectedRevision: (await tool("jumpstart_get_document", { editorId })).revision });
  expect((await tool("jumpstart_get_document", { editorId })).bodies).toHaveLength(0);
});
