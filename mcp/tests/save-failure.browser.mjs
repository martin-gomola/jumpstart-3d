import { test, expect } from "@playwright/test";

test("a failed local design write does not claim a saved version and can recover on the next save", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const state = await page.evaluate(() => {
    const docId = window.__store.doc.id;
    const key = `workplane.doc.v1.${docId}`;
    const original = Storage.prototype.setItem;
    const blocked = function (name, value) {
      if (name === key) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, name, value);
    };
    blocked.__original = original;
    Storage.prototype.setItem = blocked;
    return { docId, key };
  });
  await page.click("#btn-save");
  await expect(page.locator("#savestate")).toContainText("Not saved");
  expect(await page.evaluate(({ docId, key }) => ({
    document: localStorage.getItem(key),
    version: localStorage.getItem(`jumpstart3d.ver.${docId}`),
    inMemoryVersion: window.__store.doc.ver || 0,
  }), state)).toEqual({ document: null, version: null, inMemoryVersion: 0 });

  await page.evaluate((key) => {
    const current = Storage.prototype.setItem;
    Storage.prototype.setItem = current.__original;
    localStorage.removeItem(key);
  }, state.key);
  await page.click("#btn-save");
  await expect(page.locator("#savestate")).toContainText("Saved in this browser");
  expect(await page.evaluate(({ docId, key }) => ({
    document: JSON.parse(localStorage.getItem(key)).id,
    version: localStorage.getItem(`jumpstart3d.ver.${docId}`),
    inMemoryVersion: window.__store.doc.ver,
  }), state)).toEqual({ document: state.docId, version: "1", inMemoryVersion: 1 });
});
