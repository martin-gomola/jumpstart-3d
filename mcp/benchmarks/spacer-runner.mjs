#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const endpoint = process.env.JUMPSTART_MCP_HTTP_URL || "http://127.0.0.1:3210/__mcp/rpc";
let requestId = 0, editorId;
const calls = [];
async function tool(name, args = {}) {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: { ...args, ...(editorId ? { editorId } : {}) } } }), signal: AbortSignal.timeout(90000) });
  const payload = await response.json(); assert(!payload.error, JSON.stringify(payload.error));
  const result = payload.result, value = JSON.parse(result.content.find(block => block.type === "text").text);
  calls.push({ name, args, result: value });
  if (result.isError) throw new Error(value.error);
  return value;
}

async function main() {
  const listed = (await tool("jumpstart_list_editors")).editors;
  const chosen = process.env.JUMPSTART_MCP_EDITOR_ID ? listed.find(editor => editor.editorId === process.env.JUMPSTART_MCP_EDITOR_ID) : listed.length === 1 ? listed[0] : null;
  assert(chosen, "Select a blank editor using JUMPSTART_MCP_EDITOR_ID when multiple tabs are open"); editorId = chosen.editorId;
  const get = () => tool("jumpstart_get_document", { includeGeometry: true });
  const blank = await get(); assert(!blank.bodies.length && !blank.sketches.length, "Spacer benchmark requires a blank document");
  let edits = 0, report;
  try {
    const proposed = await tool("jumpstart_preview_frame", { expectedRevision: blank.revision, plan: { name: "Switch spacer regression", modelId: "spacer-regression", outerWidth: 86, outerDepth: 86, height: 10 } });
    assert(proposed.valid && proposed.frameInspection.passed && proposed.images.length === 3);
    assert(proposed.images.every(image => image.framing.fullyVisible));
    assert.equal(proposed.designContext.dimensionSources.wall.source, "assumed");
    assert.equal(proposed.frameInspection.measured.openingWidth, 76);
    assert.equal((await get()).revision, blank.revision);
    const applied = await tool("jumpstart_apply_model", { previewId: proposed.previewId }); edits++;
    assert.equal((await tool("jumpstart_apply_model", { previewId: proposed.previewId })).revision, applied.revision);
    const revision = await tool("jumpstart_preview_parameters", { expectedRevision: applied.revision, modelId: proposed.modelId, values: { height: 12, wall: 4 } });
    assert(revision.valid && revision.frameInspection.passed);
    assert.equal(revision.frameInspection.measured.openingWidth, 78);
    assert.equal(revision.designContext.dimensionSources.wall.source, "supplied");
    await tool("jumpstart_apply_model", { previewId: revision.previewId }); edits++;
    const current = await get(), bodyId = current.bodies[0].id;
    const inspection = await tool("jumpstart_inspect_geometry", { bodyId, expectedRevision: current.revision, frame: { outerWidth: 86, outerDepth: 86, height: 12, wall: 4 } });
    assert(inspection.frame.passed && inspection.meshValidation.valid);
    await tool("jumpstart_save_document", { expectedRevision: current.revision });
    await tool("jumpstart_reopen_document", { expectedRevision: current.revision, documentId: current.document.id });
    assert.equal((await get()).parametricModels[0].designContext.dimensionSources.wall.value, 4);
    const exported = await tool("jumpstart_export_model", { format: "stl", name: "switch-spacer-regression-86x86x12-wall4" });
    assert(exported.meshValidation.valid);
    const bytes = await readFile(new URL(`../../exports/${basename(exported.path)}`, import.meta.url));
    assert.equal(bytes.length, 84 + bytes.readUInt32LE(80) * 50);
    report = { pass: true, method: "Prepared switch-spacer workflow, not a fresh agent reasoning evaluation", initial: proposed.frameInspection, revised: inspection.frame, designContext: revision.designContext, export: { name: basename(exported.path), bytes: bytes.length }, calls };

  } finally {
    while (edits-- > 0) await tool("jumpstart_undo", { expectedRevision: (await get()).revision });
    const restored = await get(); assert(!restored.bodies.length && !restored.sketches.length, "Spacer undo must restore the blank document");
  }
  report.undoRestoredBlank = true;
  await writeFile(new URL("../../exports/spacer-regression-results.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log("Spacer regression: passed creation, complete previews, assumptions, revision, save/reopen, STL export, retry and undo");
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
