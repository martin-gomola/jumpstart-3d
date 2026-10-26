import { test, expect } from "@playwright/test";
import { useBroker, calibrate } from "./agent-calibration.mjs";

useBroker();

const R = 4.1 / Math.cos(Math.PI / 6);
const references = {
  "nut-trap-block": {
    name: "M5 nut trap block",
    primitives: [{ id: "block", kind: "box", parameters: { w: 30, d: 30, h: 15 } }],
    sketches: [
      { id: "hex", plane: "XY", origin: [0, 0, 10.8], profile: { type: "polygon", points: [[0, R], [4.1, R / 2], [4.1, -R / 2], [0, -R], [-4.1, -R / 2], [-4.1, R / 2]] } },
      { id: "bore", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 2.7 } },
    ],
    features: [
      { id: "pocket", type: "extrude", sketch: "hex", distance: 4.2, operation: "cut", target: "block" },
      { id: "clearance", type: "extrude", sketch: "bore", distance: 15, operation: "cut", target: "block" },
    ],
  },
};

for (const [taskId, plan] of Object.entries(references)) {
  test(`${taskId}: a scripted reference passes the agent task grader`, async ({ page }) => {
    expect(await calibrate(page, taskId, plan)).toEqual([]);
  });
}
