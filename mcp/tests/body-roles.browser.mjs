import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import { parseSTL, parse3MF } from "../../src/meshimport.js";
import { exportBytes, waitIdle, watchErrors } from "../../test/helpers.mjs";

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

test("roles survive preview, apply, parameter revisions, saves and undo; every export format honors scope", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const get = () => tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const before = await get();
  const initial = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, includeImage: false, plan: {
    name: "Holder with reference phone and purchased screw", modelId: "holder",
    parameters: { width: { value: 10, unit: "mm", min: 5, max: 20 } },
    primitives: [
      { id: "part", kind: "box", parameters: { w: { $expr: "width" }, d: 10, h: 10 } },
      { id: "phone", kind: "box", parameters: { w: 10, d: 10, h: 10 }, position: [100, 0, 0] },
      { id: "screw", kind: "box", parameters: { w: 10, d: 10, h: 10 }, position: [50, 0, 0] },
    ],
    operations: [{ id: "hardware", type: "setRole", target: "screw", role: "hardware" }],
  } });
  expect(initial.valid).toBe(true);
  expect((await get()).bodies).toHaveLength(0);
  await tool("jumpstart_apply_model", { editorId, previewId: initial.previewId });
  const current = await get();
  const [part, phone, screw] = current.bodies;
  expect(current.bodies.map(body => body.role)).toEqual(["design", "design", "hardware"]);
  const classify = () => tool("jumpstart_preview_model", { editorId, expectedRevision: current.revision, includeImage: false, plan: { name: "Classify phone reference", operations: [{ id: "reference", type: "setRole", target: phone.id, role: "reference" }] } });
  const preview = await classify(), stale = await classify();
  expect(preview.valid).toBe(true);
  expect(preview.bodies.find(body => body.id === phone.id).role).toBe("reference");
  expect(preview.changes.measurements.find(body => body.bodyId === phone.id)).toMatchObject({ before: { role: "design" }, after: { role: "reference" }, volumeDelta: 0 });
  const inspected = await tool("jumpstart_inspect_geometry", { editorId, previewId: preview.previewId, bodyId: phone.id, mesh: true });
  expect(inspected.meshValidation.valid).toBe(true);
  expect((await get()).bodies).toEqual(current.bodies);
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  expect((await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId })).revision).toBe(applied.revision);
  expect((await tool("jumpstart_apply_model", { editorId, previewId: stale.previewId }, true)).error).toMatch(/changed after preview/);
  const undo = await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect((await get()).bodies.find(body => body.id === phone.id).role).toBe("design");
  const again = await tool("jumpstart_preview_model", { editorId, expectedRevision: undo.revision, includeImage: false, plan: { name: "Classify phone reference", operations: [{ id: "reference", type: "setRole", target: phone.id, role: "reference" }] } });
  await tool("jumpstart_apply_model", { editorId, previewId: again.previewId });
  const revision = await get();
  const resized = await tool("jumpstart_preview_parameters", { editorId, expectedRevision: revision.revision, modelId: "holder", values: { width: 12 }, includeImage: false });
  expect(resized.valid, JSON.stringify(resized)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: resized.previewId });
  const saved = await get();
  expect(saved.bodies.map(body => body.role)).toEqual(["design", "reference", "hardware"]);
  expect(saved.bodies[0].dimensions.x).toBeCloseTo(12, 3);
  await tool("jumpstart_save_document", { editorId, expectedRevision: saved.revision });
  await tool("jumpstart_reopen_document", { editorId, expectedRevision: saved.revision, documentId: saved.document.id });
  const reopened = await get();
  expect(reopened.bodies.map(body => body.role)).toEqual(["design", "reference", "hardware"]);
  expect(reopened.bodies.every(body => !body.hidden)).toBe(true);
  const snapshot = await page.evaluate(() => JSON.stringify(window.__store.doc));
  const paths = [];
  try {
    for (const format of ["stl", "3mf", "step"]) {
      for (const selection of [{}, { scope: "assembly" }, { scope: "assembly", bodyIds: [screw.id] }]) {
        const exported = await tool("jumpstart_export_model", { editorId, format, name: `roles-${process.pid}-${format}`, ...selection });
        paths.push(exported.path);
        const ids = selection.bodyIds || (selection.scope === "assembly" ? [part.id, screw.id] : [part.id]);
        expect(exported.bodyIds).toEqual(ids);
        expect(exported.scope).toBe(selection.scope || "printable");
        expect(exported.roles.map(body => body.role)).toEqual(ids.map(id => id === part.id ? "design" : "hardware"));
        const bytes = await readFile(exported.path);
        if (format !== "step") {
          const buffer = Uint8Array.from(bytes).buffer;
          const mesh = format === "stl" ? parseSTL(buffer) : await parse3MF(buffer);
          const xs = Array.from(mesh.V || mesh.pos).filter((_, i) => i % 3 === 0);
          expect(Math.max(...xs)).toBeCloseTo(ids.includes(screw.id) ? 55 : 6, 2);
          expect(Math.min(...xs)).toBeCloseTo(ids.includes(part.id) ? -6 : 45, 2);
        } else {
          // Rebuild the actual exported STEP in an isolated geometry worker.
          const rebuilt = await page.evaluate(async bytes => {
            const kernel = window.__app.kernel;
            return await new Promise((resolve, reject) => {
              const worker = new Worker(kernel.workerUrl, kernel.workerType === "classic" ? {} : { type: "module" });
              const timer = setTimeout(() => { worker.terminate(); reject(new Error("STEP reimport timed out")); }, 30000);
              const finish = value => { clearTimeout(timer); worker.terminate(); resolve(value); };
              worker.onerror = error => finish({ error: error.message });
              worker.onmessage = ({ data }) => {
                if (data.type === "ready") {
                  worker.postMessage({ type: "asset", id: "exported", kind: "step", bytes: new Uint8Array(bytes).buffer });
                  worker.postMessage({ type: "build", bodies: [{ id: "check", rev: "check", node: { t: "step", asset: "exported", keepPos: true, mods: [] } }] });
                } else if (data.type === "built") finish(data.results[0]);
                else if (data.type === "error") finish({ error: data.error });
              };
              worker.postMessage({ type: "init", parts: kernel.parts });
            });
          }, Array.from(bytes));
          expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
          expect(rebuilt.mesh.volume).toBeCloseTo(ids.includes(part.id) ? (ids.length === 2 ? 2200 : 1200) : 1000, 2);
          expect(rebuilt.mesh.bbox.min[0]).toBeCloseTo(ids.includes(part.id) ? -6 : 45, 2);
          expect(rebuilt.mesh.bbox.max[0]).toBeCloseTo(ids.includes(screw.id) ? 55 : 6, 2);
        }
      }
    }
    expect((await tool("jumpstart_export_model", { editorId, format: "stl", bodyIds: [phone.id] }, true)).error).toMatch(/not eligible/);
    expect((await tool("jumpstart_export_model", { editorId, format: "stl", bodyIds: [screw.id] }, true)).error).toMatch(/not eligible/);
    expect((await tool("jumpstart_export_model", { editorId, format: "stl", scope: "assembly", bodyIds: [phone.id] }, true)).error).toMatch(/not eligible/);
    await page.evaluate(id => window.__app.select([id]), phone.id);
    const uiExport = await exportBytes(page, "stl");
    const mesh = parseSTL(Uint8Array.from(uiExport.bytes).buffer);
    expect(Math.max(...Array.from(mesh.V || mesh.pos).filter((_, i) => i % 3 === 0))).toBeCloseTo(6, 2);
    expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(snapshot);
    await waitIdle(page);
    expect(errors).toEqual([]);
  } finally {
    for (const path of new Set(paths)) await unlink(path).catch(() => {});
  }
});

test("native group and ungroup preserve mixed roles and prevent accidental printable assemblies", async ({ page }) => {
  const editorId = await editor(page);
  const initial = await tool("jumpstart_preview_model", { editorId, includeImage: false, plan: {
    name: "Mixed native assembly", mode: "beginner",
    primitives: [{ id: "part", name: "Printed part", kind: "box" }, { id: "screw", name: "Purchased screw", kind: "box", position: [10, 0, 0] }],
    operations: [{ id: "hardware", type: "setRole", target: "screw", role: "hardware" }],
  } });
  expect(initial.valid).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: initial.previewId });
  await page.evaluate(() => window.__app.select(window.__store.doc.bodies.map(body => body.id)));
  await page.click("#bb-group");
  await waitIdle(page);
  let current = await tool("jumpstart_get_document", { editorId });
  expect(current.bodies).toHaveLength(1);
  expect(current.bodies[0].role).toBe("hardware");
  expect((await tool("jumpstart_export_model", { editorId, format: "stl" }, true)).error).toMatch(/No eligible bodies/);
  await page.click("#bb-ungroup");
  await waitIdle(page);
  current = await tool("jumpstart_get_document", { editorId });
  expect(current.bodies.map(body => body.role)).toEqual(["design", "hardware"]);
});

test("a role change while STEP export is pending rejects stale output and retains the user's edit", async ({ page }) => {
  const editorId = await editor(page);
  const initial = await tool("jumpstart_preview_model", { editorId, includeImage: false, plan: { name: "Export race", primitives: [{ id: "part", kind: "box" }] } });
  await tool("jumpstart_apply_model", { editorId, previewId: initial.previewId });
  await page.evaluate(() => {
    const kernel = window.__app.kernel;
    const step = kernel.step.bind(kernel);
    kernel.step = async bodies => {
      kernel.step = step;
      window.__roleExportStarted = true;
      await new Promise(resolve => { window.__releaseRoleExport = resolve; });
      return step(bodies);
    };
  });
  const pending = tool("jumpstart_export_model", { editorId, format: "step", name: `roles-race-${process.pid}` }, true);
  await page.waitForFunction(() => window.__roleExportStarted);
  await page.evaluate(() => {
    window.__store.update(doc => { doc.bodies[0].role = "reference"; }, "User role edit");
    window.__releaseRoleExport();
  });
  expect((await pending).error).toMatch(/document changed/);
  expect((await tool("jumpstart_get_document", { editorId })).bodies[0].role).toBe("reference");
});
