import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, copyFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0, importDirectory, exportedPath;

test.beforeAll(async () => {
  importDirectory = await mkdtemp(join(tmpdir(), "jumpstart-mcp-imports-"));
  await copyFile(new URL("./fixtures/tetra.stl", import.meta.url), join(importDirectory, "tetra.stl"));
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1", JUMPSTART_MCP_IMPORT_DIR: importDirectory },
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
  if (broker && broker.exitCode === null && broker.signalCode === null) {
    const exited = once(broker, "exit");
    broker.kill("SIGTERM");
    const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  if (importDirectory) await rm(importDirectory, { recursive: true, force: true });
});

test.afterEach(async () => {
  if (exportedPath) await unlink(exportedPath).catch(() => undefined);
  exportedPath = undefined;
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

test("managed STL import previews and inspects without mutation, applies once, saves, reopens, exports, and undoes", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const listed = await tool("jumpstart_list_imports");
  expect(listed.assets).toHaveLength(1);
  expect(listed.assets[0]).toMatchObject({ name: "tetra.stl", format: "stl" });
  expect(listed.assets[0].base64).toBeUndefined();
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = {
    name: "Resized imported tetra",
    operations: [
      { id: "tetra", type: "import", assetId: listed.assets[0].assetId, units: "mm" },
      { id: "resize-reference", type: "modifier", target: "tetra", modifier: { type: "scale", factors: [1.5, 1, 1] } },
    ],
  };
  const preview = await tool("jumpstart_preview_model", { editorId, plan, expectedRevision: before.revision, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  expect(preview.bodies).toHaveLength(1);
  expect(preview.bodies[0].featureTree).toMatchObject({ t: "mesh", asset: listed.assets[0].assetId, k: 1 });
  expect(preview.bodies[0].dimensions.x).toBeCloseTo(15, 2);
  expect(preview.bodies[0].dimensions.y).toBeCloseTo(10, 2);
  expect(preview.bodies[0].dimensions.z).toBeCloseTo(10, 2);
  expect(preview.bodies[0].featureTree.mods).toEqual([expect.objectContaining({ t: "scale", k: [1.5, 1, 1] })]);
  expect((await get()).revision).toBe(before.revision);
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, bodyId: preview.bodies[0].id, previewId: preview.previewId, mesh: true });
  expect(inspection.meshValidation.valid).toBe(true);
  expect(inspection.meshValidation.triangleCount).toBeGreaterThan(0);

  const stale = await tool("jumpstart_preview_model", { editorId, plan, expectedRevision: before.revision, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const saved = await get();
  expect(saved.bodies).toHaveLength(1);
  expect(saved.bodies[0].featureTree.asset).toBe(listed.assets[0].assetId);
  expect(saved.bodies[0].featureTree.mods[0]).toMatchObject({ t: "scale", k: [1.5, 1, 1] });
  await tool("jumpstart_save_document", { editorId, expectedRevision: saved.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: saved.revision, documentId: saved.document.id });
  const reopened = await get();
  expect(reopened.bodies[0].featureTree).toMatchObject({ t: "mesh", asset: listed.assets[0].assetId });
  const exported = await tool("jumpstart_export_model", { editorId, format: "stl", name: `managed-import-${process.pid}` });
  exportedPath = exported.path;
  expect(exported.meshValidation.valid).toBe(true);
  await tool("jumpstart_undo", { editorId, expectedRevision: reopened.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("imports reject missing STL units, host paths, and changed asset digests", async ({ page }) => {
  const editorId = await editor(page);
  const listed = await tool("jumpstart_list_imports");
  const before = await tool("jumpstart_get_document", { editorId });
  const base = { name: "Bad import", operations: [{ id: "tetra", type: "import", assetId: listed.assets[0].assetId }] };
  const missingUnits = await tool("jumpstart_preview_model", { editorId, plan: base, expectedRevision: before.revision, includeImage: false }, true);
  expect(missingUnits.error).toMatch(/STL import requires explicit units/);
  const noPath = await tool("jumpstart_preview_model", { editorId, plan: { name: "Path", operations: [{ id: "x", type: "import", assetId: "../tetra.stl", units: "mm", path: "/etc/passwd" }] }, includeImage: false }, true);
  expect(noPath.error).toMatch(/allowed input shape/);
  const digestFailure = await tool("jumpstart_preview_model", { editorId, plan: { name: "Missing", operations: [{ id: "x", type: "import", assetId: "0".repeat(64), units: "mm" }] }, includeImage: false }, true);
  expect(digestFailure.error).toMatch(/unavailable, changed/);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(before.revision);
});
