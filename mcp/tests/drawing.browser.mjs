import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import { watchErrors } from "../../test/helpers.mjs";

let broker, baseURL, requestId = 0;
const written = [];

test.beforeAll(async () => {
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`MCP broker startup timed out: ${output}`)), 15_000);
    broker.once("exit", (code) => { clearTimeout(timer); reject(new Error(`MCP broker exited during startup (${code}): ${output}`)); });
    broker.stderr.setEncoding("utf8");
    broker.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/JumpStart MCP app: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); baseURL = `http://127.0.0.1:${match[1]}/`; resolve(); }
    });
  });
});

test.afterAll(async () => {
  for (const path of written) await unlink(path).catch(() => undefined);
  if (!broker || broker.exitCode !== null || broker.signalCode !== null) return;
  const exited = once(broker, "exit");
  broker.kill("SIGTERM");
  const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
});

async function call(name, args = {}) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(90_000),
  });
  expect(response.ok).toBe(true);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  return payload.result;
}
async function tool(name, args = {}, expectError = false) {
  const result = await call(name, args);
  const text = result.content.find((item) => item.type === "text").text;
  expect(result.isError === true, text).toBe(expectError);
  return JSON.parse(text);
}

test("drawings project native geometry, measure it and export SVG and PDF sheets", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const documentId = await page.evaluate(() => window.__store.doc.id);
  let editorId;
  await expect.poll(async () => (editorId = (await tool("jumpstart_list_editors")).editors.find((entry) => entry.documentId === documentId)?.editorId)).toBeTruthy();

  const before = await tool("jumpstart_get_document", { editorId });
  const plan = { name: "Drawing plate", primitives: [{ id: "plate", kind: "box", parameters: { w: 60, d: 40, h: 20 } }], operations: [{ id: "hole", type: "modifier", target: "plate", modifier: { type: "hole", diameter: 6, through: true, at: [{ p: [20, 10, 20], n: [0, 0, 1] }] } }] };
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  const applied = await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });

  // The projection axes: an off-centre hole at +X, +Y lands right and up in the top view.
  const views = await page.evaluate(() => {
    const body = window.__store.doc.bodies[0];
    return window.__app.kernel.project([{ node: body.node, m: body.m }], [{ view: "top", dir: [0, 0, 1], x: [1, 0, 0] }, { view: "front", dir: [0, -1, 0], x: [1, 0, 0] }, { view: "right", dir: [1, 0, 0], x: [0, 1, 0] }]);
  });
  const [top, front, right] = views, centre = (box) => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  expect(top.circles).toHaveLength(1);
  expect(top.circles[0].r).toBeCloseTo(3, 4);
  expect(top.circles[0].c[0] - centre(top.box)[0]).toBeCloseTo(20, 3);
  expect(top.circles[0].c[1] - centre(top.box)[1]).toBeCloseTo(10, 3);
  expect(front.box[2] - front.box[0]).toBeCloseTo(60, 3);
  expect(front.box[3] - front.box[1]).toBeCloseTo(20, 3);
  const hiddenVerticals = (view) => view.hidden.filter((pl) => Math.abs(pl[0] - pl[pl.length - 2]) < 1e-3).map((pl) => +(pl[0] - centre(view.box)[0]).toFixed(2));
  expect(hiddenVerticals(front)).toEqual(expect.arrayContaining([17, 23]));
  expect(hiddenVerticals(right)).toEqual(expect.arrayContaining([7, 13]));

  const drawing = { title: "Drawing plate", number: "JS-DRW-1", material: "PETG", date: "2026-10-29", notes: ["Break sharp edges."], dimensions: [{ view: "top", direction: "horizontal", from: [-30, 10, 20], to: [20, 10, 20], tolerance: "±0.1" }] };
  const rendered = await call("jumpstart_render_drawing", { editorId, expectedRevision: applied.revision, drawing });
  expect(rendered.isError).not.toBe(true);
  const report = JSON.parse(rendered.content[0].text);
  expect(rendered.content.find((item) => item.type === "image")?.mimeType).toBe("image/png");  expect(report.revision).toBe(applied.revision);
  expect(report.scale).toBe("1:1");
  expect(report.dimensions.map(({ text }) => text)).toEqual(["60", "20", "40", "Ø6", "50 ±0.1"]);
  expect(report.holes).toEqual([{ view: "top", diameter: 6, count: 1 }]);
  expect(report.warnings).toEqual([]);
  expect((await tool("jumpstart_get_document", { editorId })).revision).toBe(applied.revision);

  for (const format of ["svg", "pdf"]) {
    const exported = await tool("jumpstart_export_drawing", { editorId, expectedRevision: applied.revision, drawing, format, name: `drawing-test-${process.pid}` });
    written.push(exported.path);
    expect(exported.path.endsWith(`.${format}`)).toBe(true);
    expect(exported.dimensions).toHaveLength(5);
    const bytes = await readFile(exported.path);
    expect(bytes.byteLength).toBe(exported.byteLength);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe(format === "pdf" ? "%PDF-" : "<svg ");
  }

  expect((await tool("jumpstart_render_drawing", { editorId, expectedRevision: before.revision, drawing }, true)).error).toMatch(/document changed/);
  expect((await tool("jumpstart_render_drawing", { editorId, expectedRevision: applied.revision, drawing: { ...drawing, dimensions: [{ view: "iso", direction: "horizontal", from: [0, 0, 0], to: [1, 0, 0] }] } }, true)).error).toMatch(/view/);
  await tool("jumpstart_undo", { editorId, expectedRevision: applied.revision });
  expect(errors).toEqual([]);
});
