import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, bodies, body, prim } from "../../test/helpers.mjs";

const PARTS = [
  ["bb-gridfinity", "Gridfinity"],
  ["bb-fastener", "Fastener"],
  ["bb-gear", "Gear"],
  ["bb-nameplate", "Name plate"],
  ["bb-knurl", "Knurled knob"],
  ["bb-spring", "Coil spring"],
];

async function openTool(page, id) {
  const button = page.locator(`.bribbon #${id}`);
  if (!(await button.isVisible())) await page.click(`.bribbon [data-holds~="${id}"]`);
  await page.click(`#${id}`);
}

test("beginner Parts tools make solid bodies from their dialogs", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  for (const [id, label] of PARTS) {
    await loadDoc(page, newDoc(label, "beginner"));
    await openTool(page, id);
    await expect(page.locator("#cmd")).toBeVisible();
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
    const made = await bodies(page);
    expect(made.length, label).toBeGreaterThan(0);
    for (const b of made) {
      expect(b.error, `${label}: ${b.name}`).toBeNull();
      if (!b.hole) expect(b.volume, `${label}: ${b.name}`).toBeGreaterThan(0);
    }
  }
  expect(errors).toEqual([]);
});

test("Advanced Create lists the part tools and Hole pattern drills one Hole feature", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("plate", "advanced", { bodies: [body("plate", "Plate", prim("box", { w: 80, d: 50, h: 6 }))] }));
  await page.click("#ad-features");
  for (const id of ["ad-gridfinity", "ad-holepattern", "ad-fastener", "ad-gear", "ad-nameplate", "ad-knurl", "ad-spring"]) await expect(page.locator(`#${id}`)).toBeVisible();
  await page.keyboard.press("Escape");
  const [before] = await bodies(page);
  const made = await page.evaluate(() => window.__app.advanced.addHolePattern({ body: "plate", face: "+z", layout: { type: "grid", cols: 3, rows: 2, pitch: 20 }, hole: { dia: 3 } }));
  expect(made).toMatchObject({ holes: 6, dropped: 0 });
  await waitIdle(page);
  const [after] = await bodies(page);
  expect(after.error).toBeNull();
  expect(before.volume - after.volume).toBeCloseTo(6 * Math.PI * 1.5 ** 2 * 6, 0);
  expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods.filter((m) => m.t === "hole").length)).toBe(1);
  expect(errors).toEqual([]);
});

test("Parts folds into one menu on a narrow window", async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await boot(page, info);
  await loadDoc(page, newDoc("narrow", "beginner"));
  const holder = page.locator('.bribbon [data-holds~="bb-gear"]');
  await expect(holder).toHaveAttribute("aria-label", "Parts tools");
  await holder.click();
  const labels = PARTS.map(([, label]) => label);
  labels.splice(1, 0, "Drawer layout");
  await expect(page.getByRole("menu", { name: "Parts" }).getByRole("menuitem")).toHaveText(labels);
});

test("Gridfinity part dialog previews live, keeps the editor mode and adds a pocketed insert as a saved model", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("tray", "beginner"));
  await openTool(page, "bb-gridfinity");
  const dialog = page.locator("#cmd");
  await expect(dialog.locator("h4").first()).toHaveText("Gridfinity part");
  await dialog.locator('[data-template="baseplate"]').click();
  expect(await dialog.locator(".gp-form").evaluate(form => [...form.querySelectorAll("h3,h4,p")].map(node => getComputedStyle(node).marginBlockStart).filter(margin => margin !== "0px"))).toEqual([]);
  await dialog.screenshot({ path: "exports/ai-panel/gridfinity-dialog-baseplate.png" });
  await dialog.locator('[data-template="insert"]').click();
  await page.fill("#gp-1-width", "30"); await page.fill("#gp-1-height", "20"); await page.fill("#gp-1-depth", "6");
  await expect.poll(() => page.evaluate(() => window.__store.view.bodies.length)).toBe(1);
  await waitIdle(page);
  await page.screenshot({ path: "exports/ai-panel/gridfinity-dialog.png" });
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  await page.fill("#gp-1-depth", "");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.fill("#gp-1-depth", "60");
  await expect(page.locator("#gp-message")).toContainText("depth");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.fill("#gp-1-depth", "6");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.click("#cmd-ok");
  await expect(dialog).toBeHidden();
  await waitIdle(page);
  const doc = await page.evaluate(() => { const d = window.__store.doc; return { mode: d.mode, models: d.mcpModels?.length, bodies: d.bodies.map(b => ({ kind: b.mcpGridfinity?.kind, pockets: b.mcpPockets?.map(p => p.depth) })), selected: window.__app.sel.length }; });
  expect(doc).toEqual({ mode: "beginner", models: 1, bodies: [{ kind: "insert", pockets: [6] }], selected: 1 });
  const [made] = await bodies(page);
  expect(made.error).toBeNull();
  expect(made.volume).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
