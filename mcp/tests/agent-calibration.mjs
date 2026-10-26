// Builds a scripted reference model for an agent task and runs the task's own grader on it.
// A task whose reference cannot pass is either miscalibrated or beyond the current MCP.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watchErrors } from "../../test/helpers.mjs";
import { agentTask } from "../benchmarks/agent-tasks.mjs";
import { measureGrader, gradeProbes, gradeNativeMods } from "../benchmarks/agent-runner.mjs";

let broker, baseURL, requestId = 0;

export function useBroker() {
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
    if (!broker || broker.exitCode !== null || broker.signalCode !== null) return;
    const exited = once(broker, "exit");
    broker.kill("SIGTERM");
    const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  });
}

export async function tool(name, args = {}) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  const value = JSON.parse(payload.result.content.find((item) => item.type === "text").text);
  if (payload.result.isError) throw new Error(value.error || "MCP tool failed");
  return value;
}

async function editor(page) {
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const documentId = await page.evaluate(() => window.__store.doc.id);
  let editorId;
  await expect.poll(async () => {
    editorId = (await tool("jumpstart_list_editors")).editors.find((entry) => entry.documentId === documentId)?.editorId;
    return !!editorId;
  }).toBe(true);
  return editorId;
}

// Returns the failed grader checks so a test can assert an empty list with readable detail.
export async function calibrate(page, taskId, plan) {
  const errors = watchErrors(page);
  const task = agentTask(taskId);
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const preview = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan, includeImage: false });
  expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: preview.previewId });
  const document = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  check("body-count", document.bodies.length === (task.bodies ?? 1), document.bodies.map(({ name }) => name));
  for (const [axis, expected] of Object.entries(task.dimensions)) {
    const i = "xyz".indexOf(axis);
    const extent = Math.max(...document.bodies.map((body) => body.bounds.max[i])) - Math.min(...document.bodies.map((body) => body.bounds.min[i]));
    check(`dimension-${axis}`, Math.abs(extent - expected) <= 0.15, { expected, measured: extent });
  }
  if (task.grader) gradeProbes(task, await measureGrader(task, document, (name, input) => tool(name, { ...input, editorId })), check);
  if (task.nativeMods) gradeNativeMods(task, document, check);
  await tool("jumpstart_undo", { editorId, expectedRevision: document.revision });
  expect(errors).toEqual([]);
  return checks.filter((entry) => !entry.pass);
}
