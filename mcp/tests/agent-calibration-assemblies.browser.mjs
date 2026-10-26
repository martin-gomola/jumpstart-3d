import { test, expect } from "@playwright/test";
import { useBroker, calibrate } from "./agent-calibration.mjs";

useBroker();

const rect = (x0, x1, y0, y1) => ({ type: "polygon", points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const expr = ($expr) => ({ $expr });
const circle = (id, plane, origin, center, radius) => ({ id, plane, origin, profile: { type: "circle", center, radius } });
const flatY = Math.sqrt(3.15 ** 2 - 1.65 ** 2);

const references = {
  "box-friction-lid": {
    name: "Friction-fit storage box", modelId: "friction-lid-box",
    parameters: { clearance: { value: 0.2, unit: "mm", min: 0, max: 1 }, lip: { value: 1.6, unit: "mm", min: 0.8, max: 3 } },
    sketches: [
      { id: "box-outline", plane: "XY", origin: [0, 0, 0], profile: rect(-40, 40, -30, 30) },
      { id: "box-cavity", plane: "XY", origin: [0, 0, 2], profile: rect(-38, 38, -28, 28) },
      { id: "lid-plate", plane: "XY", origin: [0, 0, 40], profile: rect(-40, 40, -30, 30) },
      { id: "lip-outer", plane: "XY", origin: [0, 0, 37], profile: rect(expr("clearance - 38"), expr("38 - clearance"), expr("clearance - 28"), expr("28 - clearance")) },
      { id: "lip-inner", plane: "XY", origin: [0, 0, 37], profile: rect(expr("clearance + lip - 38"), expr("38 - clearance - lip"), expr("clearance + lip - 28"), expr("28 - clearance - lip")) },
    ],
    features: [
      { id: "box", name: "Box", type: "extrude", sketch: "box-outline", distance: 40, operation: "new" },
      { id: "cavity", type: "extrude", sketch: "box-cavity", distance: 38, operation: "cut", target: "box" },
      { id: "lid", name: "Lid", type: "extrude", sketch: "lid-plate", distance: 2, operation: "new" },
      { id: "lip", type: "extrude", sketch: "lip-outer", distance: 3, operation: "join", target: "lid" },
      { id: "lip-hollow", type: "extrude", sketch: "lip-inner", distance: 3, operation: "cut", target: "lid" },
    ],
  },
  "print-in-place-hinge": {
    name: "Print-in-place hinge",
    sketches: [
      { id: "a-leaf", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, 0], [12.8, 0], [12.8, 3.4], [27.2, 3.4], [27.2, 0], [40, 0], [40, 25], [0, 25]] } },
      circle("a-knuckle-1", "YZ", [0, 0, 0], [0, 3], 3),
      circle("a-knuckle-2", "YZ", [27.2, 0, 0], [0, 3], 3),
      circle("a-pin", "YZ", [0, 0, 0], [0, 3], 1.5),
      { id: "b-leaf", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, -25], [40, -25], [40, -3.4], [26.8, -3.4], [26.8, 0], [13.2, 0], [13.2, -3.4], [0, -3.4]] } },
      circle("b-knuckle", "YZ", [13.2, 0, 0], [0, 3], 3),
      circle("b-bore", "YZ", [13, 0, 0], [0, 3], 1.9),
    ],
    features: [
      { id: "leaf-a", name: "Leaf A", type: "extrude", sketch: "a-leaf", distance: 2.4, operation: "new" },
      { id: "knuckle-a1", type: "extrude", sketch: "a-knuckle-1", distance: 12.8, operation: "join", target: "leaf-a" },
      { id: "knuckle-a2", type: "extrude", sketch: "a-knuckle-2", distance: 12.8, operation: "join", target: "leaf-a" },
      { id: "pin", type: "extrude", sketch: "a-pin", distance: 40, operation: "join", target: "leaf-a" },
      { id: "leaf-b", name: "Leaf B", type: "extrude", sketch: "b-leaf", distance: 2.4, operation: "new" },
      { id: "knuckle-b", type: "extrude", sketch: "b-knuckle", distance: 13.6, operation: "join", target: "leaf-b" },
      { id: "bore", type: "extrude", sketch: "b-bore", distance: 14, operation: "cut", target: "leaf-b" },
    ],
  },
  "knob-d-shaft": {
    name: "Potentiometer knob",
    sketches: [
      { id: "d-bore", plane: "XY", origin: [0, 0, 5], profile: { type: "contour", segments: [
        { type: "arc", start: [1.65, flatY], through: [-3.15, 0], end: [1.65, -flatY] },
        { type: "line", start: [1.65, -flatY], end: [1.65, flatY] },
      ] } },
    ],
    features: [{ id: "d-tool", type: "extrude", sketch: "d-bore", distance: 11, operation: "new" }],
    operations: [
      { id: "knob", type: "knurl", name: "Knob", diameter: 30, length: 15, grooves: 30, bore: "none" },
      { id: "bore", type: "combine", target: "knob", tool: "d-tool", operation: "cut" },
    ],
  },
  "screw-cap-m30": {
    name: "M30 x 2 screw cap",
    sketches: [
      circle("cap-outline", "XY", [0, 0, 0], [0, 0], 18),
      circle("cap-bore", "XY", [0, 0, 2], [0, 0], (30 - 1.0825 * 2) / 2),
    ],
    features: [
      { id: "cap", name: "Cap", type: "extrude", sketch: "cap-outline", distance: 15, operation: "new" },
      { id: "bore", type: "extrude", sketch: "cap-bore", distance: 13, operation: "cut", target: "cap" },
    ],
    operations: [
      { id: "thread", type: "modifier", target: "cap", modifier: { type: "thread", face: { c: [0, 0, 8.5], t: "CYLINDRE" }, pitch: 2, length: 0, clearance: 0.3 } },
    ],
  },
};

for (const [taskId, plan] of Object.entries(references)) {
  test(`${taskId}: a scripted reference passes the agent task grader`, async ({ page }) => {
    test.setTimeout(240_000);
    expect(await calibrate(page, taskId, plan)).toEqual([]);
  });
}
