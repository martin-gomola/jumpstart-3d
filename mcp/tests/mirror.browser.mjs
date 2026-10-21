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

test("linked and joined mirrors preview, inspect, apply idempotently and undo", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const base = { name: "Reflected block", primitives: [{ id: "block", kind: "box", parameters: { w: 20, d: 10, h: 8 }, position: [5, 0, 0] }] };
  const linkedPlan = { ...base, operations: [{ id: "mirror", type: "mirror", source: "block", plane: { origin: [0, 0, 0], normal: [3, 0, 0] } }] };
  const linked = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: linkedPlan, includeImage: false });
  const linkedStale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: linkedPlan, includeImage: false });
  expect(linked.valid, JSON.stringify(linked.errors)).toBe(true);
  expect(linked.bodies).toHaveLength(2);
  const linkedBody = linked.bodies.find(({ feature }) => feature === "mirror");
  expect(linkedBody.bounds).toMatchObject({ min: [-15, -5, 0], max: [5, 5, 8] });
  expect(linkedBody.volume).toBeCloseTo(1600, 2);
  expect(linkedBody.featureTree).toMatchObject({ t: "mirror", srcBody: expect.any(String), plane: { o: [0, 0, 0], n: [1, 0, 0] } });
  expect((await get()).revision).toBe(before.revision);
  const linkedInspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: linkedBody.id, previewId: linked.previewId, mesh: true });
  expect(linkedInspection.meshValidation.valid).toBe(true);
  const linkedApplied = await tool("jumpstart_apply_model", { editorId, previewId: linked.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: linked.previewId })).revision).toBe(linkedApplied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: linkedStale.previewId }, true)).error).toMatch(/changed after preview/);
  const linkedSaved = await get();
  expect(linkedSaved.bodies).toHaveLength(2);
  expect(linkedSaved.bodies[1].featureTree).toMatchObject({ t: "mirror", srcBody: linkedSaved.bodies[0].id });
  const afterLinkedUndo = await tool("jumpstart_undo", { editorId, expectedRevision: linkedApplied.revision });
  expect((await get()).bodies).toHaveLength(0);

  const joinPlan = { ...base, name: "Joined reflection", operations: [{ id: "mirror", type: "mirror", source: "block", plane: { normal: [1, 0, 0] }, behavior: "join" }] };
  const joined = await tool("jumpstart_preview_model", { editorId, expectedRevision: afterLinkedUndo.revision, plan: joinPlan, includeImage: false });
  expect(joined.valid, JSON.stringify(joined.errors)).toBe(true);
  expect(joined.bodies).toHaveLength(1);
  expect(joined.bodies[0].volume).toBeCloseTo(2400, 2);
  expect(joined.bodies[0].featureTree.mods[0]).toMatchObject({ t: "bool", op: "join", tool: { t: "mirror" } });
  expect((await get()).revision).toBe(afterLinkedUndo.revision);
  const joinedInspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: joined.bodies[0].id, previewId: joined.previewId, mesh: true });
  expect(joinedInspection.meshValidation.valid).toBe(true);
  const joinedApplied = await tool("jumpstart_apply_model", { editorId, previewId: joined.previewId });
  expect((await get()).bodies[0].featureTree.mods[0]).toMatchObject({ t: "bool", op: "join", tool: { t: "mirror" } });
  await tool("jumpstart_undo", { editorId, expectedRevision: joinedApplied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("mirror preview rejects a zero plane normal without changing the document", async ({ page }) => {
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const preview = await tool("jumpstart_preview_model", {
    editorId, expectedRevision: before.revision, includeImage: false,
    plan: { name: "Invalid mirror", primitives: [{ id: "block", kind: "box" }], operations: [{ id: "mirror", type: "mirror", source: "block", plane: { normal: [0, 0, 0] } }] },
  }, true);
  expect(preview.error).toMatch(/normal must not be zero/);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
