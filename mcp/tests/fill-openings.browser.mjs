import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "../../test/helpers.mjs";

const at = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
// 60 x 40 x 10 plate: a through hole (8 across), a blind hole (6 across, 4 deep) and a 12 x 6 pocket 3 deep
const plate = prim("box", { w: 60, d: 40, h: 10, r: 0, c: 0 }, [
  { id: "h1", seq: 1, t: "hole", p: [-18, 0, 10], n: [0, 0, 1], dia: 8, through: true },
  { id: "h2", seq: 2, t: "hole", p: [0, 0, 10], n: [0, 0, 1], dia: 6, depth: 4 },
  { id: "k1", seq: 3, t: "bool", op: "cut", tool: prim("box", { w: 12, d: 6, h: 4, r: 0, c: 0 }), m: at(18, 0, 7) },
]);
const design = () => newDoc("fill openings", "advanced", { bodies: [body("b1", "Plate", plate), body("b2", "Post", prim("cylinder", { w: 20, d: 20, h: 10, r: 0, c: 0 }), at(0, 45, 0))] });
const SOLID = 60 * 40 * 10, THROUGH = Math.PI * 16 * 10, BLIND = Math.PI * 9 * 4, POCKET = 12 * 6 * 3;

let page, errors;
test.beforeEach(async ({ page: p }, info) => {
  page = p;
  errors = watchErrors(p);
  await boot(p, info);
  await loadDoc(p, design());
  await p.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await waitIdle(p);
});
test.afterEach(() => expect(errors).toEqual([]));

const volume = () => page.evaluate(() => window.__app.scene.views.get("b1").data.volume);
const undoDepth = () => page.evaluate(() => window.__store.undoStack.length);
// a screen spot on a face of a body that the pointer really reaches
const spotOn = (id, kind) => page.evaluate(([id, kind]) => {
  const { vp, scene } = window.__app, v = scene.views.get(id), r = vp.canvas.getBoundingClientRect();
  const P = v.data.vertices, T = v.data.triangles;
  for (let face = 0; face < v.data.faceInfo.length; face++) {
    const info = v.data.faceInfo[face];
    const ok = kind === "top" ? info.t === "PLANE" && info.n[2] > 0.999 && info.openings : kind === "side" ? info.t === "PLANE" && Math.abs(info.n[2]) < 1e-6 : info.t !== "PLANE";
    if (!ok) continue;
    const [s, c] = v.data.faceGroups[face];
    for (let i = s; i < s + c; i += 3) {
      const q = [0, 1, 2].map((k) => [0, 1, 2].reduce((sum, j) => sum + P[T[i + j] * 3 + k], 0) / 3);
      const w = vp.view.target.clone().set(...q).applyMatrix4(v.group.matrix);
      const [px, py] = vp.project(w), e = { clientX: r.left + px, clientY: r.top + py };
      if (document.elementFromPoint(e.clientX, e.clientY) !== vp.canvas) continue;
      const hit = scene.pickFace(e);
      if (hit && hit.body === id && hit.face === face) return { x: e.clientX, y: e.clientY };
    }
  }
  return null;
}, [id, kind]);
async function clickFace(id, kind) {
  const spot = await spotOn(id, kind);
  expect(spot, `a visible ${kind} face on ${id}`).not.toBeNull();
  await page.mouse.click(spot.x, spot.y);
}

test("Fill openings lists the openings of a flat face and fills the ticked ones as deep as their walls, in one undo step", async () => {
  expect(await volume()).toBeCloseTo(SOLID - THROUGH - BLIND - POCKET, 1);
  const depth = await undoDepth();
  await page.click("#ad-fillopen");
  await clickFace("b1", "top");
  await expect(page.locator("[id^=fo-open]")).toHaveCount(3);
  await expect(page.locator("#cmd")).toContainText("Round, 8 mm across");
  await expect(page.locator("#cmd")).toContainText(/Opening, (12 × 6|6 × 12) mm/);
  const blind = page.locator("label.check", { hasText: "Round, 6 mm across" }).locator("input");
  await blind.uncheck();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  await expect.poll(volume).toBeCloseTo(SOLID - BLIND, 1);
  expect(await undoDepth()).toBe(depth + 1);
  const mod = await page.evaluate(() => window.__store.doc.bodies[0].node.mods.at(-1));
  expect(mod).toMatchObject({ t: "fillopenings", depth: "opening" });
  expect(mod.face.n[2]).toBeCloseTo(1, 9);
  expect(mod.loops).toHaveLength(2);

  await page.click("#btn-undo");
  await waitIdle(page);
  await expect.poll(volume).toBeCloseTo(SOLID - THROUGH - BLIND - POCKET, 1);
});

test("Set depth fills every ticked opening to that depth at most; Cancel changes nothing", async () => {
  await page.click("#ad-fillopen");
  await clickFace("b1", "top");
  await page.locator("#fo-mode").getByText("Set depth").click();
  await page.fill("#fo-depth", "2");
  await page.locator("#fo-depth").blur();
  await page.click("#cmd-ok");
  await waitIdle(page);
  // through hole 8 left of 10, blind hole 2 left of 4, pocket 1 left of 3
  await expect.poll(volume).toBeCloseTo(SOLID - THROUGH * 0.8 - BLIND / 2 - POCKET / 3, 1);

  const before = await page.evaluate(() => JSON.stringify(window.__store.doc));
  await page.click("#ad-fillopen");
  await page.keyboard.press("Escape");
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
});

test("a counterbored hole fills to its step and keeps the narrow hole below", async () => {
  const cbore = prim("box", { w: 60, d: 40, h: 10, r: 0, c: 0 }, [{ id: "h1", seq: 1, t: "hole", p: [0, 0, 10], n: [0, 0, 1], dia: 5, through: true, kind: "cbore", cbDia: 10, cbDepth: 3 }]);
  await loadDoc(page, newDoc("fill counterbore", "advanced", { bodies: [body("b1", "Plate", cbore)] }));
  await page.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await waitIdle(page);
  await page.click("#ad-fillopen");
  await clickFace("b1", "top");
  await page.click("#cmd-ok");
  await waitIdle(page);
  await expect.poll(volume).toBeCloseTo(SOLID - Math.PI * 2.5 ** 2 * 7, 1);
});

test("a curved face and a flat face without openings are refused with a message", async () => {
  await page.click("#ad-fillopen");
  await clickFace("b2", "curved");
  await expect(page.locator("#toasts")).toContainText("Pick a flat face");
  await clickFace("b1", "side");
  await expect(page.locator("#toasts")).toContainText("This face has no openings");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
});
