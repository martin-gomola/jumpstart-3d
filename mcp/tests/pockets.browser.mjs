import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, waitIdle, watchErrors } from "../../test/helpers.mjs";
import { normalizePocket, buildPocket } from "../browser/plans/pockets.js";
import { inspectGeometry } from "../browser/inspection/inspection.js";

function pocketDocument(profile, extra = {}) {
  const target = body("insert", "Pocket test blank", prim("box", { w: 83.5, d: 125.5, h: 21 }));
  target.mcpGridfinity = { kind: "insert", width: 83.5, depth: 125.5, topZ: 21, protectedBaseHeight: 7, outerRadius: 3.75, nodeSignature: JSON.stringify(target.node) };
  const document = newDoc("Pocket native geometry", "advanced", { bodies: [target] });
  let count = 0;
  const op = normalizePocket({ type: "pocket", id: "measured", target: "insert", profile, position: [0, 0], depth: 8, clearance: 0.3, minimumFloor: 2, minimumWall: 1.2, ...extra });
  buildPocket(op, { document, target, idFactory: prefix => `${prefix}${++count}`, nextSeq: () => ++document.seq });
  return document;
}

test("native rounded rectangle, circle and capsule pockets have exact per-side clearance and retained floors", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  const cases = [
    { profile: { type: "roundedRect", width: 20, height: 30, radius: 3 }, area: 20.6 * 30.6 - (4 - Math.PI) * 3.3 ** 2 },
    { profile: { type: "circle", radius: 8 }, area: Math.PI * 8.3 ** 2 },
    { profile: { type: "capsule", length: 25, width: 10 }, area: 15 * 10.6 + Math.PI * 5.3 ** 2 },
  ];
  for (const { profile, area } of cases) {
    await loadDoc(page, pocketDocument(profile));
    const result = await page.evaluate(() => {
      const view = window.__app.scene.views.get("insert");
      return { error: window.__app.scene.errors.get("insert"), volume: view.data?.volume,
        vertices: Array.from(view.data?.vertices || []), triangles: Array.from(view.data?.triangles || []) };
    });
    expect(result.error).toBeUndefined();
    expect(result.volume).toBeCloseTo(83.5 * 125.5 * 21 - area * 8, 3);
    const inspection = inspectGeometry(result, { mesh: true, samples: [{ axis: "Z", point: [0, 0, -1] }] });
    expect(inspection.meshValidation.valid).toBe(true);
    expect(inspection.samples[0].intervals).toEqual([[0, 13]]);
  }
  expect(errors).toEqual([]);
});

test("closed line/arc contour pockets use true rounded 2D offsets in the shipped WASM", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  const profiles = [
    { type: "contour", segments: [[[-10,-5],[10,-5]],[[10,-5],[10,5]],[[10,5],[-10,5]],[[-10,5],[-10,-5]]].map(([start,end]) => ({ type: "line", start, end })) },
    { type: "contour", segments: [
      { type: "line", start: [-10,-5], end: [5,-5] },
      { type: "arc", start: [5,-5], through: [10,0], end: [5,5] },
      { type: "line", start: [5,5], end: [-10,5] },
      { type: "line", start: [-10,5], end: [-10,-5] },
    ] },
  ];
  const areas = [200 + 60 * 0.3 + Math.PI * 0.3 ** 2, 150 + Math.PI * 25 / 2 + (40 + Math.PI * 5) * 0.3 + Math.PI * 0.3 ** 2];
  for (let i = 0; i < profiles.length; i++) {
    await loadDoc(page, pocketDocument(profiles[i], { rotation: i ? 30 : 0 }));
    await waitIdle(page);
    const result = await page.evaluate(() => ({ error: window.__app.scene.errors.get("insert"), volume: window.__app.scene.views.get("insert").data?.volume }));
    expect(result.error).toBeUndefined();
    expect(result.volume).toBeCloseTo(83.5 * 125.5 * 21 - areas[i] * 8, 3);
  }
  expect(errors).toEqual([]);
});
