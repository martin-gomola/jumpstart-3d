import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, watchErrors } from "../../test/helpers.mjs";
import { mkdir } from "node:fs/promises";

test("v2.7.4 tools open, choices support keyboard and narrow layouts", async ({ page }, info) => {
  const errors = watchErrors(page), workerUrls = [], workerWarnings = [];
  page.on("worker", worker => workerUrls.push(worker.url()));
  page.on("console", message => { if (message.type() === "warning" && message.text().includes("CAM worker")) workerWarnings.push(message.text()); });
  await boot(page, info);
  await mkdir("exports/editor-v274", { recursive: true });
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });
  await page.click("#mode-arch");
  await expect(page.locator("#mode-arch")).toHaveAttribute("aria-pressed", "true");
  const level = page.locator("#ar-level");
  await expect(level).toHaveAttribute("role", "combobox");
  await level.focus(); await page.keyboard.press("Enter");
  await expect(level).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("End"); await page.keyboard.press("Escape");
  await expect(level).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: "exports/editor-v274/architect.png" });
  await page.click("#mode-advanced");
  await loadDoc(page, newDoc("v274", "advanced", { bodies: [body("block", "Block", prim("box", { w: 20, d: 20, h: 12 }))] }));
  for (const [name, selector] of [["cam", "#cam"], ["voxel", "#voxel"], ["cosforge", "#cosforge"]]) {
    await page.evaluate(name => window.__app[name].open(), name);
    await expect.poll(() => page.evaluate(name => window.__app[name].isOpen, name)).toBe(true);
    if (name === "cam") {
      await expect.poll(() => page.evaluate(() => !!window.__app.cam._ui()?.result?.gcode), { timeout: 60_000 }).toBe(true);
      expect(await page.evaluate(() => window.__app.cam._ui().serial)).toBeFalsy();
      expect(workerUrls.some(url => url.startsWith("blob:"))).toBe(true);
      expect(workerWarnings).toEqual([]);
    }
    if (name === "cam") {
      await page.locator('#cam-level').getByRole('button', { name: 'Pro', exact: true }).click();
      await page.locator('.cam-gcode summary').click();
    }
    if (name === "cosforge") {
      await page.click('#cf-step-parts');
      await page.locator('.cf-card').first().click();
      await expect.poll(() => page.evaluate(() => window.__app.cosforge._t().st.parts.length)).toBe(1);
      await page.click('#cf-step-cut');
      const printer = page.locator('#cf-printer');
      await printer.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
      await expect(printer).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(page.locator(selector)).toHaveAttribute("aria-modal", "true");
    expect(await page.locator("#app").evaluate(e => e.inert)).toBe(true);
    const violations = await page.evaluate(async selector => (await axe.run(document.querySelector(selector), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), selector);
    expect(violations, `${name} accessibility`).toEqual([]);
    await page.screenshot({ path: `exports/editor-v274/${name}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `exports/editor-v274/${name}-phone.png` });
    const overflow = await page.evaluate(selector => {
      const e = document.querySelector(selector) || document.querySelector('.s3d, .cf');
      return e ? e.scrollWidth > e.clientWidth + 1 : true;
    }, selector);
    expect(overflow, `${name} horizontal overflow`).toBe(false);
    expect(await page.locator(`${selector} select`).count()).toBe(0);
    await page.evaluate(name => window.__app[name].close(), name);
    expect(await page.locator("#app").evaluate(e => e.inert)).toBe(false);
    await page.setViewportSize({ width: 1400, height: 880 });
  }
  expect(errors).toEqual([]);
});

test("shared tool choice commits once, groups options, supports typeahead, disabled and dynamic values", async ({ page }, info) => {
  await boot(page, info);
  await page.evaluate(() => {
    const c = document.createElement("tool-choice"); c.id = "choice-contract"; c.setAttribute("aria-label", "Test material");
    const g = document.createElement("optgroup"); g.label = "Materials";
    for (const [value, text] of [["a", "Aluminium"], ["b", "Brass"], ["s", "Steel"]]) { const o = document.createElement("option"); o.value = value; o.textContent = text; g.append(o); }
    c.append(g); window.__choiceChanges = 0; c.onchange = () => window.__choiceChanges++;
    document.body.append(c); c.style.position = "fixed"; c.style.zIndex = "999"; c.style.top = "0";
  });
  const choice = page.locator("#choice-contract");
  await choice.focus(); await page.keyboard.press("Enter"); await page.keyboard.press("s"); await page.keyboard.press("Enter");
  expect(await choice.evaluate(e => e.value)).toBe("s");
  expect(await page.evaluate(() => window.__choiceChanges)).toBe(1);
  await choice.evaluate(e => { e.value = "b"; e.disabled = true; });
  await expect(choice).toHaveAttribute("aria-disabled", "true");
  await expect(choice.locator(".tool-choice-label")).toHaveText("Brass");
  await choice.evaluate(e => { e.disabled = false; });
  await choice.focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Home"); await page.keyboard.press("Escape");
  expect(await choice.evaluate(e => e.value)).toBe("b");
  await page.keyboard.press("Enter"); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  expect(await choice.evaluate(e => e.value)).toBe("a");
  expect(await page.evaluate(() => window.__choiceChanges)).toBe(2);
});

test("updated native kernel builds closed hollow shells and editable face patterns", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  const cases = [
    { name: "Hollow", mods: [{ t: "shell", id: "hollow", th: 2, dir: "in", faces: [] }], expected: 2752 },
    { name: "Pattern", mods: [{ t: "facepat", id: "pattern", mode: "cut", kind: "circles", p: [0, 0, 12], n: [0, 0, 1], x: [1, 0, 0], size: 6, gap: 1, border: 1, depth: 1 }] },
  ];
  for (const c of cases) {
    await loadDoc(page, newDoc(c.name, "advanced", { bodies: [body("part", c.name, prim("box", { w: 20, d: 20, h: 12 }, c.mods))] }));
    const result = await page.evaluate(() => ({ error: window.__app.scene.errors.get("part"), volume: window.__app.scene.views.get("part")?.data?.volume }));
    expect(result.error).toBeUndefined(); expect(result.volume).toBeGreaterThan(0); expect(result.volume).toBeLessThan(4800);
    if (c.expected) expect(result.volume).toBeCloseTo(c.expected, 3);
    expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods[0].id)).toBe(c.mods[0].id);
  }
  expect(errors).toEqual([]);
});
