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

async function tool(name, args = {}) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  expect(payload.result.isError, payload.result.content?.find((item) => item.type === "text")?.text).not.toBe(true);
  return JSON.parse(payload.result.content.find((item) => item.type === "text").text);
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

const COASTER = {
  name: "Named coaster", modelId: "coaster",
  parameters: { diameter: { value: 100, unit: "mm", min: 10, max: 500 }, floor: { value: 3, unit: "mm" }, depth: { value: 3, unit: "mm" }, thickness: { expression: "floor + depth", unit: "mm" } },
  primitives: [{ id: "base", kind: "cylinder", parameters: { w: { $expr: "diameter" }, d: { $expr: "diameter" }, h: { $expr: "thickness" } } }],
};

test("selecting an AI-generated parameter model shows its settings and regenerates it through preview and apply", async ({ page }) => {
  const errors = watchErrors(page);
  const editorId = await editor(page);
  const before = await tool("jumpstart_get_document", { editorId });
  const created = await tool("jumpstart_preview_model", { editorId, expectedRevision: before.revision, plan: COASTER, includeImage: false });
  expect(created.valid, JSON.stringify(created.errors)).toBe(true);
  await tool("jumpstart_apply_model", { editorId, previewId: created.previewId });
  const bodyId = (await tool("jumpstart_get_document", { editorId })).bodies[0].id;

  // Applying selects the new model, so its settings show right away.
  const card = page.locator("#model-params");
  await expect(card).toBeVisible();
  await page.evaluate(() => window.__app.select([]));
  await expect(card).toHaveCount(0);
  await page.evaluate((id) => window.__app.select([id]), bodyId);
  await expect(card).toBeVisible();
  await expect(card.locator(".model-params-name")).toHaveText("Named coaster");
  const diameter = card.getByLabel("Diameter (mm)");
  await expect(diameter).toHaveValue("100");
  await expect(card.getByRole("definition")).toHaveText("6");
  await expect(page.locator("#model-params-preview")).toBeDisabled();

  await diameter.fill("600");
  await page.locator("#model-params-preview").click();
  await expect(page.locator("#model-params-message")).toContainText("between 10 and 500 mm");
  await expect(diameter).toHaveAttribute("aria-invalid", "true");

  await diameter.fill("120");
  await page.locator("#model-params-preview").click();
  await expect(page.locator("#model-params-message")).toContainText("Preview ready");
  await expect(card.locator(".model-params-dims")).toHaveText("120 × 120 × 6 mm");
  expect((await tool("jumpstart_get_document", { editorId })).bodies[0].dimensions.x).toBeCloseTo(100, 1);

  await page.locator("#model-params-apply").click();
  await expect(page.locator("#model-params-message")).toContainText("Updated");
  await expect(diameter).toHaveValue("120");
  const after = await tool("jumpstart_get_document", { editorId });
  expect(after.bodies).toHaveLength(1);
  expect(after.bodies[0].id).toBe(bodyId);
  expect(after.parametricModels[0].parameters.diameter.value).toBe(120);

  // Moving the body by hand breaks the saved plan; the card says so instead of offering regeneration.
  await page.evaluate((id) => window.__store.update((doc) => { doc.bodies.find((b) => b.id === id).m[12] += 5; }, "Move"), bodyId);
  await expect(card.locator(".model-params-note")).toContainText("moved or edited by hand");
  await expect(diameter).toBeDisabled();
  await expect(page.locator("#model-params-message")).toHaveText("");

  await page.evaluate(() => window.__app.select([]));
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});
