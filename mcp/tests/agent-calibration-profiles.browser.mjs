import { test, expect } from "@playwright/test";
import { useBroker, calibrate } from "./agent-calibration.mjs";

useBroker();

const line = (start, end) => ({ type: "line", start, end });
const polyline = (points) => points.map((point, i) => line(point, points[(i + 1) % points.length]));
const leadInStart = 23 - 1 / Math.tan(Math.PI / 6);
const filletMid = 0.8 * Math.SQRT1_2;
const supportTop = 16 + 80 / Math.tan(65 * Math.PI / 180);

const references = {
  "snap-hook": {
    name: "Cantilever snap hook",
    sketches: [{ id: "hook", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
      line([0, 0], [10, 0]),
      line([10, 0], [10, 8]),
      line([10, 8], [2.4, 8]),
      { type: "arc", start: [2.4, 8], through: [2.4 - filletMid, 8.8 - filletMid], end: [1.6, 8.8] },
      line([1.6, 8.8], [1.6, 23]),
      line([1.6, 23], [0, 23]),
      line([0, 23], [-1, leadInStart]),
      line([-1, leadInStart], [-1, 20]),
      line([-1, 20], [0, 20]),
      line([0, 20], [0, 0]),
    ] } }],
    features: [{ id: "body", type: "extrude", sketch: "hook", distance: 6 }],
  },
  "cable-clip": {
    name: "Cable clip",
    sketches: [{ id: "clip", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
      line([-10, 0], [10, 0]),
      line([10, 0], [10, 2]),
      line([10, 2], [Math.sqrt(4.9 ** 2 - 4.5 ** 2), 2]),
      { type: "arc", start: [Math.sqrt(4.9 ** 2 - 4.5 ** 2), 2], through: [4.9, 6.5], end: [2.6, 6.5 + Math.sqrt(4.9 ** 2 - 2.6 ** 2)] },
      line([2.6, 6.5 + Math.sqrt(4.9 ** 2 - 2.6 ** 2)], [2.6, 6.5 + Math.sqrt(3.3 ** 2 - 2.6 ** 2)]),
      { type: "arc", start: [2.6, 6.5 + Math.sqrt(3.3 ** 2 - 2.6 ** 2)], through: [0, 3.2], end: [-2.6, 6.5 + Math.sqrt(3.3 ** 2 - 2.6 ** 2)] },
      line([-2.6, 6.5 + Math.sqrt(3.3 ** 2 - 2.6 ** 2)], [-2.6, 6.5 + Math.sqrt(4.9 ** 2 - 2.6 ** 2)]),
      { type: "arc", start: [-2.6, 6.5 + Math.sqrt(4.9 ** 2 - 2.6 ** 2)], through: [-4.9, 6.5], end: [-Math.sqrt(4.9 ** 2 - 4.5 ** 2), 2] },
      line([-Math.sqrt(4.9 ** 2 - 4.5 ** 2), 2], [-10, 2]),
      line([-10, 2], [-10, 0]),
    ] } }],
    features: [{ id: "clip", type: "extrude", sketch: "clip", distance: 8 }],
    operations: [{ id: "screw-holes", type: "modifier", target: "clip", modifier: { type: "hole", at: [{ p: [7, 2, 4], n: [0, 1, 0] }, { p: [-7, 2, 4], n: [0, 1, 0] }], diameter: 3.5, through: true } }],
  },
  "phone-stand-65deg": {
    name: "Phone stand 65 degrees",
    sketches: [{ id: "stand", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: polyline([
      [0, 0], [90, 0], [90, 6], [60, 86], [supportTop, 86], [16, 6], [4, 6], [4, 22], [0, 22],
    ]) } }],
    features: [{ id: "stand", type: "extrude", sketch: "stand", distance: 75 }],
  },
  "gridfinity-bin-1x1": {
    name: "Gridfinity 1x1 bin",
    operations: [{ id: "bin", type: "gridfinity", kind: "bin", columns: 1, rows: 1, heightUnits: 3, floor: 1.2, wall: 1.2, lip: true }],
  },
};

for (const [taskId, plan] of Object.entries(references)) {
  test(`${taskId}: a scripted reference passes the agent task grader`, async ({ page }) => {
    expect(await calibrate(page, taskId, plan)).toEqual([]);
  });
}
