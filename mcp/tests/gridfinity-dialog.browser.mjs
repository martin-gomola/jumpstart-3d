import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, bodies } from "../../test/helpers.mjs";

const open = page => page.evaluate(() => window.__app.advanced.gridfinityPart());
const made = page => page.evaluate(() => window.__store.doc.bodies.filter(b => b.mcpGridfinity).map(b => {
  const box = window.__app.scene.bodyWorldBox(b.id);
  return { recipe: b.mcpGridfinity, pockets: b.mcpPockets, size: box && { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z } };
}));
async function create(page) {
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  for (const b of await bodies(page)) expect(b.error, b.name).toBeNull();
  return made(page);
}

test.beforeAll(async () => { await mkdir(new URL("../../exports/ai-panel/", import.meta.url), { recursive: true }); });

test("Gridfinity dialog sizes a part, rejects invalid values and fits a narrow window", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("sizing", "beginner"));
  await open(page);
  const dialog = page.locator("#cmd"), ok = page.locator("#cmd-ok");
  await expect(page.locator('[data-template="bin"]')).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toContainText("83.5 × 125.5 ×");
  await page.getByRole("button", { name: "Increase part width", exact: true }).click();
  await expect(dialog).toContainText("125.5 × 125.5 ×");
  await page.getByRole("button", { name: "35 mm", exact: true }).click();
  await expect(dialog).toContainText("× 39.4 mm overall");
  await page.fill("#gp-columns", "6");
  await expect(page.getByRole("button", { name: "Increase part width", exact: true })).toBeDisabled();
  await page.fill("#gp-columns", "2");
  await page.getByText("Construction & magnets", { exact: true }).click();
  await page.fill("#gp-floor", "0");
  await expect(ok).toBeDisabled();
  await page.fill("#gp-floor", "2");
  await expect(ok).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await dialog.evaluate(node => [...node.querySelectorAll("*")].filter(child => child.getBoundingClientRect().right > innerWidth + 1).length)).toBe(0);
  await page.screenshot({ path: "exports/ai-panel/gridfinity-dialog-narrow.png" });
  expect(errors).toEqual([]);
});

test("Gridfinity dialog blocks parts larger than the saved printer area and notes a 90° turn", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("printer", "beginner"));
  const saveArea = area => page.evaluate(area => localStorage.setItem("jumpstart.gridfinity.printArea", JSON.stringify(area)), area);
  await saveArea({ width: 90, depth: 90, height: 100, edgeMargin: 2 });
  await open(page);
  const ok = page.locator("#cmd-ok"), turn = page.getByText("Turn this part 90° on the print bed to fit your printer area.");
  await expect(page.locator("#gp-message")).toContainText("exceeds the usable printer area");
  await expect(page.locator("#gp-message")).toHaveAttribute("data-error", "true");
  await expect(ok).toBeDisabled();
  await page.fill("#gp-rows", "2");
  await expect(page.locator("#gp-message")).toBeEmpty();
  await expect(ok).toBeEnabled();
  await page.locator("#cmd .xbtn").click();
  await expect(page.locator("#cmd")).toBeHidden();
  await saveArea({ width: 130, depth: 90, height: 100, edgeMargin: 2 });
  await open(page);
  await expect(turn).toBeVisible();
  await expect(ok).toBeEnabled();
  expect(await create(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("Gridfinity dialog inserts take a reference body's size and published source evidence", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("reference", "advanced"));
  await page.evaluate(() => window.__store.update(doc => {
    doc.bodies.push({ id: "reference-item", name: "Measured tool envelope", seq: ++doc.seq, color: "#9fb1c4", role: "reference", hole: false, hidden: false, m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: { w: 30, d: 20, h: 8 }, mods: [] } });
  }, "Add reference envelope"));
  await waitIdle(page);
  await open(page);
  await page.locator('[data-template="insert"]').click();
  await page.getByText("Reference and dimensions", { exact: true }).click();
  await page.locator("#cmd").getByRole("button", { name: "Measured tool envelope" }).click();
  await expect(page.locator("#gp-1-width")).toHaveValue("30");
  await expect(page.locator("#gp-1-height")).toHaveValue("20");
  await expect(page.locator("#gp-1-product")).toHaveValue("Measured tool envelope");
  await expect(page.locator("#gp-message")).toContainText("Envelope dimensions copied");
  await page.getByRole("button", { name: "in", exact: true }).click();
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await page.fill("#gp-1-url", "https://example.com/dimensions");
  await page.fill("#gp-1-depth", "8");
  const [insert] = await create(page);
  expect(insert.recipe).toMatchObject({ kind: "insert", columns: 2, rows: 3 });
  expect(insert.pockets).toMatchObject([{ depth: 8, sourceEvidence: { kind: "manufacturer", units: "in", product: "Measured tool envelope", url: "https://example.com/dimensions" } }]);
  expect(await page.evaluate(() => window.__store.doc.bodies.find(b => b.id === "reference-item")?.role)).toBe("reference");
  await page.evaluate(() => window.__store.undo());
  expect(await made(page)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("Gridfinity dialog bins keep open sides, flush joins and the stackable rim", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("walls", "beginner"));
  await open(page);
  await page.getByText("Compartments & stacking", { exact: true }).click();
  const close = page.getByRole("checkbox", { name: "Close gaps on open sides", exact: true });
  await expect(close).toBeDisabled();
  await page.getByRole("button", { name: "Open right side", exact: true }).click();
  await close.check();
  await page.getByRole("button", { name: "Open back side", exact: true }).click();
  const [bin] = await create(page);
  expect(bin.recipe).toMatchObject({ kind: "bin", openSides: ["right", "back"], closeGaps: true, lip: true });
  expect(bin.size.x).toBeCloseTo(2 * 42 - 0.25, 3);
  expect(bin.size.z).toBeCloseTo(25.4, 3);
  expect(errors).toEqual([]);
});

test("Gridfinity dialog magnetic baseplates validate magnet sizes and keep native pockets after reload", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("magnets", "beginner"));
  await open(page);
  await page.locator('[data-template="baseplate"]').click();
  await page.getByText("Construction & magnets", { exact: true }).click();
  await page.locator("#gp-magnets").check();
  await page.fill("#gp-magnets-diameter", "0");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.fill("#gp-magnets-diameter", "6.5"); await page.locator("#gp-magnets-diameter").press("Tab");
  await expect(page.locator("#cmd")).toContainText("Baseplate height 8.2 mm");
  const [plate] = await create(page);
  expect(plate.recipe.magnetPockets).toMatchObject({ count: 24, diameter: 6.5, depth: 2.4, carrierFloor: 0.8, opening: "top" });
  expect(plate.size.z).toBeCloseTo(8.2, 3);
  await loadDoc(page, await page.evaluate(() => structuredClone(window.__store.doc)));
  await waitIdle(page);
  expect((await made(page))[0].recipe.magnetPockets).toEqual(plate.recipe.magnetPockets);
  expect(errors).toEqual([]);
});
