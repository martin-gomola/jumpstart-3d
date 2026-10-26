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
  return { ...JSON.parse(payload.result.content.find((item) => item.type === "text").text), mcpImageBlocks: payload.result.content.filter((item) => item.type === "image").length };
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

test("phone cradle clarifies direction, checks connected supports before apply, and remains undoable", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Dashboard phone cradle",
    operations: [{ id: "cradle", type: "phoneCradle", width: 92, phoneLength: 145, angle: 50, plateThickness: 3, ribThickness: 8, stopHeight: 12, stopDepth: 8, topEdgeToward: "+Y", position: [0, -30, 5] }],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: true });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  expect(preview.phoneCradle).toMatchObject({ topEdgeToward: "+Y", screenFacesToward: "-Y", supportRibs: 2 });
  expect(preview.images.map((image) => image.view)).toEqual(["top", "side", "isometric", "section"]);
  expect(preview.images[3].section).toMatchObject({ axis: "X", default: true });
  expect(preview.images.every((image) => image.coordinateFrame.orientation === "+Y = dashboard")).toBe(true);
  expect(preview.mcpImageBlocks).toBe(4);
  expect((await get()).revision).toBe(before.revision);

  const prematureApply = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId }, true);
  expect(prematureApply.error).toMatch(/Inspect every phone-cradle preview with mesh validation/);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.phoneCradle.supportConnectivity).toMatchObject({ connectedComponents: 1, expectedComponents: 1, passed: true });

  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  const saved = await get();
  expect(saved.bodies).toHaveLength(1);
  expect(saved.bodies[0].phoneCradle).toMatchObject({ topEdgeToward: "+Y", screenFacesToward: "-Y" });
  expect(saved.bodies[0].featureTree.mods.filter((modifier) => modifier.src === "phoneCradle" && modifier.op === "join")).toHaveLength(3);
  await expect(page.getByText("Combined (Box)", { exact: true })).toBeVisible();
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});
