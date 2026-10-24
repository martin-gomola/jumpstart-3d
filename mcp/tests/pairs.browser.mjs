import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, copyFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, importDirectory, exportPath, requestId = 0;

test.beforeAll(async () => {
  importDirectory = await mkdtemp(join(tmpdir(), "jumpstart-pair-imports-"));
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
  if (exportPath) await unlink(exportPath).catch(() => undefined);
  if (importDirectory) await rm(importDirectory, { recursive: true, force: true });
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



test("native pair requirements inspect read-only geometry, block unsafe apply, retain idempotency/stale checks and undo", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const plan = { name: "Clearance fixture", primitives: [{ id: "base", kind: "box", parameters: { w: 10, d: 10, h: 10 } }, { id: "lid", kind: "box", parameters: { w: 10, d: 10, h: 10 }, position: [10.3, 0, 0] }] };
  const requirements = { pairs: [{ id: "fit", a: "base", b: "lid", minimumClearance: 0.3, maximumOverlapVolume: 0 }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, requirements, includeImage: false });
  expect(preview.valid, JSON.stringify(preview)).toBe(true);
  expect(preview.acceptance.status).toBe("passed");
  expect(preview.acceptance.pairs[0].distanceMm).toBeCloseTo(0.3, 6);
  expect(preview.acceptance.pairs[0].overlapVolumeMm3).toBeCloseTo(0, 6);
  expect((await get()).revision).toBe(before.revision);
  expect((await get()).bodies).toHaveLength(0);
  const [a, b] = preview.bodies;
  const inspection = await tool("jumpstart_inspect_geometry", { editorId, expectedRevision: before.revision, previewId: preview.previewId, bodyId: a.id, againstBodyId: b.id, pairChecks: { minimumClearance: 0.3, maximumOverlapVolume: 0 } });
  expect(inspection.pair.acceptance.passed).toBe(true);
  expect(inspection.pair.witnessPoints.a).toHaveLength(3);
  const stale = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, requirements, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).guidance.category).toBe("stale_state");
  const saved = await get();
  const actual = await tool("jumpstart_inspect_geometry", { editorId, expectedRevision: saved.revision, bodyId: a.id, againstBodyId: b.id });
  expect(actual.pair.distanceMm).toBeCloseTo(0.3, 6);

  const move = { name: "Colliding lid", operations: [{ id: "moved", type: "transform", target: b.id, position: [5, 0, 0] }] };
  const overlap = await tool("jumpstart_preview_model", { editorId, expectedRevision: saved.revision, plan: move, requirements: { preserveBodyIds: [a.id], pairs: [{ id: "no-overlap", a: a.id, b: "moved", maximumOverlapVolume: 0 }] }, includeImage: false });
  expect(overlap.valid).toBe(false);
  expect(overlap.acceptance.status).toBe("failed");
  expect(overlap.acceptance.pairs[0]).toMatchObject({ status: "measured", distanceMm: 0 });
  expect(overlap.acceptance.pairs[0].overlapVolumeMm3).toBeCloseTo(500, 4);
  const permissive = await tool("jumpstart_inspect_geometry", { editorId, expectedRevision: saved.revision, previewId: overlap.previewId, bodyId: a.id, againstBodyId: b.id, pairChecks: { maximumOverlapVolume: 1000 } });
  expect(permissive.pair.acceptance.passed).toBe(true);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: overlap.previewId }, true)).error).toMatch(/requirements did not pass/);
  expect((await get()).bodies).toEqual(saved.bodies);
  const missing = await tool("jumpstart_preview_model", { editorId, expectedRevision: saved.revision, plan: move, requirements: { pairs: [{ id: "missing", a: a.id, b: "missing-body", minimumClearance: 0.1 }] }, includeImage: false });
  expect(missing.valid).toBe(false);
  expect(missing.acceptance.status).toBe("unknown");
  expect((await tool("jumpstart_apply_model", { editorId, previewId: missing.previewId }, true)).error).toMatch(/requirements did not pass/);
  expect((await tool("jumpstart_inspect_geometry", { editorId, bodyId: a.id, againstBodyId: b.id }, true)).error).toMatch(/expectedRevision/);
  expect((await tool("jumpstart_preview_model", { editorId, plan: move, requirements, includeImage: false }, true)).error).toMatch(/expectedRevision/);
  expect((await tool("jumpstart_inspect_geometry", { editorId, expectedRevision: saved.revision, bodyId: a.id, pairChecks: { maximumOverlapVolume: 0 } }, true)).error).toMatch(/againstBodyId/);

  const meshPreview = await tool("jumpstart_preview_lathe", { editorId, expectedRevision: saved.revision, plan: { name: "Recipe mesh", blank: { kind: "round", diameter: 10, length: 10 }, profile: [[0, 5], [10, 5]] }, includeImage: false });
  const added = await tool("jumpstart_apply_model", { editorId, previewId: meshPreview.previewId });
  const meshId = added.bodyIds[0];
  const unsupported = await tool("jumpstart_preview_model", { editorId, expectedRevision: added.revision, plan: move, requirements: { pairs: [{ id: "mesh-fit", a: a.id, b: meshId, maximumOverlapVolume: 0 }] }, includeImage: false });
  expect(unsupported.valid).toBe(false);
  expect(unsupported.acceptance.status).toBe("unknown");
  expect(unsupported.acceptance.pairs[0].error).toMatch(/unsupported/);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: unsupported.previewId }, true)).error).toMatch(/requirements did not pass/);
  const restored = await tool("jumpstart_undo", { editorId, expectedRevision: added.revision });
  await tool("jumpstart_undo", { editorId, expectedRevision: restored.revision });
  expect((await get()).bodies).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("a managed STEP solid participates in exact pair acceptance with native placements", async ({ page }) => {
  test.setTimeout(90_000);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId });
  const before = await get();
  const seed = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: { name: "STEP seed", primitives: [{ id: "box", kind: "box", parameters: { w: 10, d: 10, h: 10 } }] }, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: seed.previewId });
  const exported = await tool("jumpstart_export_model", { editorId, format: "step", name: `pair-step-${process.pid}` });
  exportPath = exported.path;
  await copyFile(exportPath, join(importDirectory, "pair-solid.step"));
  const undone = await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  const catalog = await tool("jumpstart_list_imports");
  const assetId = catalog.assets.find(({ name }) => name === "pair-solid.step").assetId;
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: undone.revision, plan: { name: "STEP fit fixture", primitives: [{ id: "native", kind: "box", parameters: { w: 10, d: 10, h: 10 }, position: [15, 0, 0] }], operations: [{ id: "imported", type: "import", assetId }] }, requirements: { pairs: [{ id: "step-fit", a: "imported", b: "native", minimumClearance: 5, maximumOverlapVolume: 0 }] }, includeImage: false });
  expect(preview.valid, JSON.stringify(preview)).toBe(true);
  expect(preview.acceptance.pairs[0].status).toBe("measured");
  expect(preview.acceptance.pairs[0].distanceMm).toBeCloseTo(5, 5);
  expect(preview.acceptance.pairs[0].overlapVolumeMm3).toBeCloseTo(0, 6);
  expect((await get()).revision).toBe(undone.revision);
});

for (const action of ["inspection", "preview"]) test(`a user edit during pending pair ${action} is preserved and rejects the stale result`, async ({ page }) => {
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const seed = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: { name: "Concurrent edit fixture", primitives: [{ id: "a", kind: "box" }, { id: "b", kind: "box", position: [25, 0, 0] }] }, includeImage: false });
  await tool("jumpstart_apply_model", { editorId, previewId: seed.previewId });
  const saved = await get(), [a, b] = saved.bodies;
  await page.evaluate(() => {
    window.__originalPairInspector = window.__app.kernel.inspectPairs;
    window.__app.kernel.inspectPairs = async (pairs) => {
      window.__pairQueryPending = true;
      await new Promise((resolve) => { window.__resumePairQuery = resolve; });
      return pairs.map(({ id }) => ({ id, status: "measured", distanceMm: 5, overlapVolumeMm3: 0, witnessPoints: { a: [10, 0, 0], b: [15, 0, 0] } }));
    };
  });
  const pending = action === "inspection"
    ? tool("jumpstart_inspect_geometry", { editorId, expectedRevision: saved.revision, bodyId: a.id, againstBodyId: b.id }, true)
    : tool("jumpstart_preview_model", { editorId, expectedRevision: saved.revision, plan: { name: "Proposed move", operations: [{ id: "move", type: "transform", target: b.id, position: [30, 0, 0] }] }, requirements: { pairs: [{ id: "fit", a: a.id, b: "move", minimumClearance: 1 }] }, includeImage: false }, true);
  await page.waitForFunction(() => window.__pairQueryPending === true);
  await page.evaluate(() => {
    window.__store.update((doc) => { doc.name = "User edit during analysis"; }, "Human rename");
    window.__app.kernel.inspectPairs = window.__originalPairInspector;
    window.__resumePairQuery();
  });
  expect((await pending).error).toMatch(/document changed/i);
  const after = await get();
  expect(after.document.name).toBe("User edit during analysis");
  expect(after.bodies).toEqual(saved.bodies);
  expect(await page.evaluate(() => window.__store.preview)).toBeNull();
});
