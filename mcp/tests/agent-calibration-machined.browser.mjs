import { test, expect } from "@playwright/test";
import { useBroker, calibrate } from "./agent-calibration.mjs";

useBroker();

const C45 = Math.SQRT1_2;
const references = {
  "wall-bracket": {
    name: "L shelf bracket",
    sketches: [{ id: "profile", plane: "XY", origin: [0, 0, 0], profile: { type: "contour", segments: [
      { type: "line", start: [0, 0], end: [60, 0] },
      { type: "line", start: [60, 0], end: [60, 5] },
      { type: "line", start: [60, 5], end: [15, 5] },
      { type: "arc", start: [15, 5], through: [15 - 10 * C45, 15 - 10 * C45], end: [5, 15] },
      { type: "line", start: [5, 15], end: [5, 80] },
      { type: "line", start: [5, 80], end: [0, 80] },
      { type: "line", start: [0, 80], end: [0, 0] },
    ] } }],
    features: [{ id: "bracket", type: "extrude", sketch: "profile", distance: 40, operation: "new" }],
    operations: [{ id: "screws", type: "modifier", target: "bracket", modifier: {
      type: "hole", kind: "csink", diameter: 4.5, through: true, countersinkDiameter: 9, countersinkAngle: 90,
      at: [{ p: [5, 30, 20], n: [1, 0, 0] }, { p: [5, 65, 20], n: [1, 0, 0] }],
    } }],
  },
  "leg-cap": {
    name: "Furniture leg cap",
    primitives: [{ id: "cap", kind: "box", parameters: { w: 26, d: 26, h: 18 } }],
    sketches: [{ id: "socket-outline", plane: "XY", origin: [0, 0, 3], profile: { type: "polygon", points: [[-11.2, -11.2], [11.2, -11.2], [11.2, 11.2], [-11.2, 11.2]] } }],
    features: [{ id: "socket", type: "extrude", sketch: "socket-outline", distance: 15, operation: "cut", target: "cap" }],
    operations: [
      { id: "corners", type: "modifier", target: "cap", modifier: { type: "fillet", radius: 2, edges: [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => (
        { m: [13 * sx, 13 * sy, 9], n: [(sx + 1) / 2, (sy + 1) / 2, 0.5], t: "LINE" })) } },
      { id: "foot", type: "modifier", target: "cap", modifier: { type: "chamfer", distance: 1, edges: [[0, -13], [13, 0], [0, 13], [-13, 0]].map(([x, y]) => (
        { m: [x, y, 0], n: [(x + 13) / 26, (y + 13) / 26, 0], t: "LINE" })) } },
    ],
  },
  "heat-set-bosses": {
    name: "Electronics base plate",
    primitives: [
      { id: "plate", kind: "box", parameters: { w: 60, d: 40, h: 3 } },
      ...[[22, 12], [-22, 12], [-22, -12], [22, -12]].map(([x, y], i) => ({ id: `boss-${i}`, kind: "cylinder", parameters: { w: 7, d: 7, h: 8 }, position: [x, y, 3] })),
    ],
    operations: [
      ...[0, 1, 2, 3].map((i) => ({ id: `join-${i}`, type: "combine", target: "plate", tool: `boss-${i}`, operation: "join" })),
      { id: "inserts", type: "modifier", target: "plate", modifier: {
        type: "hole", diameter: 4, through: false, depth: 6,
        at: [[22, 12], [-22, 12], [-22, -12], [22, -12]].map(([x, y]) => ({ p: [x, y, 11], n: [0, 0, 1] })),
      } },
    ],
  },
  "name-plate": {
    name: "WORKSHOP door sign",
    sketches: [{ id: "outline", plane: "XY", origin: [0, 0, 0], profile: { type: "roundedRect", width: 80, height: 25, radius: 3 } }],
    features: [{ id: "sign", type: "extrude", sketch: "outline", distance: 3, operation: "new" }],
    operations: [
      { id: "screws", type: "modifier", target: "sign", modifier: { type: "hole", diameter: 3.5, through: true, at: [{ p: [36, 0, 3], n: [0, 0, 1] }, { p: [-36, 0, 3], n: [0, 0, 1] }] } },
      { id: "label", type: "modifier", target: "sign", modifier: { type: "emboss", geo: { kind: "plane", p: [0, 0, 3], n: [0, 0, 1], x: [1, 0, 0] }, text: "WORKSHOP", size: 8, depth: 1 } },
    ],
  },
};

for (const [taskId, plan] of Object.entries(references)) {
  test(`${taskId}: a scripted reference passes the agent task grader`, async ({ page }) => {
    expect(await calibrate(page, taskId, plan)).toEqual([]);
  });
}
