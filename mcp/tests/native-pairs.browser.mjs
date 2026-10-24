import { test, expect } from "@playwright/test";

const matrix = (x = 0, y = 0, z = 0) => [1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1];
const box = (size = 10, m = matrix()) => ({ node: { t: "prim", kind: "box", p: { w: size, d: size, h: size }, mods: [] }, m });

test("shipped OCCT measures separated, contacting, overlapping and contained native solids without editing the document", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc));
  const pairs = [
    { id: "separated", a: box(), b: box(10, matrix(15)) },
    { id: "contact", a: box(), b: box(10, matrix(10)) },
    { id: "overlap", a: box(), b: box(10, matrix(5)) },
    { id: "contained", a: box(), b: box(2, matrix(0, 0, 2)) },
    { id: "rotated", a: box(), b: { node: { t: "prim", kind: "box", p: { w: 4, d: 2, h: 6 }, mods: [] }, m: [0,1,0,0,-1,0,0,0,0,0,1,0,20,0,0,1] } },
    { id: "cavity", a: { node: { t: "group", children: [{ node: box().node, m: matrix(), hole: false }, { node: box(6).node, m: matrix(0, 0, 2), hole: true }], mods: [] }, m: matrix() }, b: box(2, matrix(0, 0, 4)) },
  ];
  const results = await page.evaluate((pairs) => window.__app.kernel.inspectPairs(pairs), pairs);
  expect(results.map(({ status }) => status), JSON.stringify(results)).toEqual(Array(6).fill("measured"));
  for (let i = 0; i < results.length; i++) {
    expect(results[i].distanceMm).toBeCloseTo([5, 0, 0, 0, 14, 2][i], 6);
    expect(results[i].overlapVolumeMm3).toBeCloseTo([0, 0, 500, 8, 0, 0][i], 5);
    expect(results[i].witnessPoints.a.every(Number.isFinite)).toBe(true);
    expect(results[i].physicalFit).toBe("unverified");
  }
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
  const unknown = await page.evaluate((pair) => window.__app.kernel.inspectPairs([pair]), { id: "unsupported", a: { node: { t: "mesh", asset: "missing" }, m: matrix() }, b: box() });
  expect(unknown[0]).toMatchObject({ status: "unknown", distanceMm: null, overlapVolumeMm3: null });
  expect(unknown[0].error).toMatch(/unsupported/);
  const nonuniform = matrix(); nonuniform[0] = 2;
  const [invalidPlacement] = await page.evaluate((pair) => window.__app.kernel.inspectPairs([pair]), { id: "nonuniform", a: box(10, nonuniform), b: box(10, matrix(20)) });
  expect(invalidPlacement.status).toBe("unknown");
  expect(invalidPlacement.error).toMatch(/Nonuniform/);
});


test("disconnected native groups are unknown rather than silently measured as one solid", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  const pair = { id: "group", a: { node: { t: "group", children: [{ node: box().node, m: matrix(), hole: false }, { node: box().node, m: matrix(30), hole: false }], mods: [] }, m: matrix() }, b: box(2, matrix(60)) };
  const [result] = await page.evaluate((pair) => window.__app.kernel.inspectPairs([pair]), pair);
  expect(result.status).toBe("unknown");
  expect(result.error).toMatch(/one solid per operand/);
  expect(result.overlapVolumeMm3).toBeNull();
});
