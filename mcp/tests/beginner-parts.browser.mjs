import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, bodies, body, prim } from "../../test/helpers.mjs";

const PARTS = [
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
  for (const id of ["ad-holepattern", "ad-fastener", "ad-gear", "ad-nameplate", "ad-knurl", "ad-spring"]) await expect(page.locator(`#${id}`)).toBeVisible();
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
  await expect(page.getByRole("menu", { name: "Parts" }).getByRole("menuitem")).toHaveText(PARTS.map(([, label]) => label));
});
