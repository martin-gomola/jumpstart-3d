import test from "node:test";
import assert from "node:assert/strict";
import { composeDrawing, drawingPDF, drawingSVG, normalizeDrawing, projectPoint } from "../shared/drawing-sheet.js";

// A 60 x 40 x 20 mm block with two 6 mm through holes, as the kernel would project it.
const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
const ring = (cx, cy, r) => { const pts = []; for (let i = 0; i <= 32; i++) { const a = (i / 32) * 2 * Math.PI; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return pts; };
const block = [
  { view: "front", visible: rect(0, 0, 60, 20), hidden: [[7, 0, 7, 20], [13, 0, 13, 20]], circles: [], box: [0, 0, 60, 20] },
  { view: "top", visible: [...rect(0, 0, 60, 40), ring(10, 10, 3), ring(50, 10, 3)], hidden: [], circles: [{ c: [10, 10], r: 3 }, { c: [50, 10], r: 3 }], box: [0, 0, 60, 40] },
  { view: "right", visible: rect(0, 0, 40, 20), hidden: [], circles: [], box: [0, 0, 40, 20] },
  { view: "iso", visible: rect(-40, -20, 40, 30), hidden: [], circles: [], box: [-40, -20, 40, 30] },
];
const view = (sheet, name) => sheet.report.views.find((entry) => entry.view === name);

test("view axes follow the drawing cameras", () => {
  assert.deepEqual(projectPoint("front", [1, 2, 3]), [1, 3]);
  assert.deepEqual(projectPoint("top", [1, 2, 3]), [1, 2]);
  assert.deepEqual(projectPoint("right", [1, 2, 3]), [2, 3]);
});

test("third angle sheet measures overall sizes and groups hole callouts", () => {
  const sheet = composeDrawing(block, { title: "Plate", date: "2026-10-29" });
  assert.equal(sheet.report.scale, "1:1");
  assert.deepEqual(sheet.report.dimensions.map(({ text, source }) => [text, source]), [["60", "overall width (X)"], ["20", "overall height (Z)"], ["40", "overall depth (Y)"], ["2X Ø6", "auto"]]);
  assert.deepEqual(sheet.report.holes, [{ view: "top", diameter: 6, count: 2 }]);
  assert.deepEqual(sheet.report.warnings, []);
  const front = view(sheet, "front").paperBox, top = view(sheet, "top").paperBox, right = view(sheet, "right").paperBox;
  assert.ok(top[3] < front[1], "top view sits above the front view");
  assert.ok(right[0] > front[2], "right view sits right of the front view");
  assert.equal(top[0], front[0], "top and front views share the X alignment");
  assert.equal(right[1], front[1], "right and front views share the Z alignment");
});

test("first angle swaps the view positions", () => {
  const sheet = composeDrawing(block, { title: "Plate", projection: "first", views: ["front", "top", "right"] });
  const front = view(sheet, "front").paperBox, top = view(sheet, "top").paperBox, right = view(sheet, "right").paperBox;
  assert.ok(top[1] > front[3]);
  assert.ok(right[2] < front[0]);
  assert.equal(sheet.report.scale, "1:1");
  assert.equal(composeDrawing(block, { title: "Plate", sheet: "A3", views: ["front", "top", "right"] }).report.scale, "2:1");
});

test("requested dimensions are measured and checked against the geometry", () => {
  const sheet = composeDrawing(block, {
    title: "Plate", autoDimensions: false,
    dimensions: [
      { view: "top", direction: "horizontal", from: [10, 10, 0], to: [50, 10, 0], tolerance: "±0.1" },
      { view: "front", direction: "horizontal", from: [0, 0, 5], to: [30, 0, 5] },
      { view: "front", direction: "vertical", from: [0, 0, 5], to: [9, 0, 5] },
      { view: "top", direction: "diameter", from: [50, 10, 20], suffix: " THRU" },
      { view: "top", direction: "diameter", from: [30, 30, 0] },
    ],
  });
  assert.deepEqual(sheet.report.dimensions.map(({ text, value }) => [text, value]), [["40 ±0.1", 40], ["30", 30], ["Ø6 THRU", 6]]);
  assert.equal(sheet.report.warnings.length, 3);
  assert.match(sheet.report.warnings[0], /Dimension 2 to point is 5 mm .* blank paper/);
  assert.match(sheet.report.warnings[1], /Dimension 3 has zero length/);
  assert.match(sheet.report.warnings[2], /Dimension 5: no circle/);
});

test("oversized fixed scales and overlapping notes are reported", () => {
  const sheet = composeDrawing(block, { title: "Plate", scale: "10:1", notes: Array.from({ length: 8 }, (_, i) => `Note ${i} ${"word ".repeat(30)}`) });
  assert.ok(sheet.report.warnings.some((w) => /do not fit the A4 sheet at 10:1/.test(w)));
  assert.ok(sheet.report.warnings.some((w) => /notes need \d+ lines/.test(w)));
  assert.throws(() => normalizeDrawing({ views: ["front", "iso"], dimensions: [{ view: "iso", direction: "horizontal", from: [0, 0, 0], to: [1, 0, 0] }] }), /front, top or right/);
  assert.throws(() => normalizeDrawing({ scale: "two" }), /scale/);
});

test("SVG and PDF writers produce well-formed files", () => {
  const sheet = composeDrawing(block, { title: "Plate Ø", number: "JS-1", date: "2026-10-29" });
  const svg = drawingSVG(sheet);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="297mm" height="210mm"/);
  assert.ok(svg.includes(">2X Ø6</text>") && svg.includes('stroke-dasharray="3 1.5"'));
  const pdf = drawingPDF(sheet), text = new TextDecoder("latin1").decode(pdf);
  assert.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"));
  const start = +/startxref\n(\d+)/.exec(text)[1];
  assert.equal(text.slice(start, start + 4), "xref");
  for (const [, offset, n] of [...text.matchAll(/(\d{10}) 00000 n /g)].map((m, i) => [m, +m[1], i + 1])) assert.equal(text.slice(offset, offset + `${n} 0 obj`.length), `${n} 0 obj`);
  assert.ok(text.includes("(2X \\330") && text.includes("/MediaBox [0 0 841.89 595.276]"));
});
