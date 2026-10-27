import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text, number, triple } from "../plan-input.js";
import { matrixMultiply, matrixForTransform, matrixInverse } from "../plan-geometry.js";

export const advanced = true;

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "name", "width", "phoneLength", "angle", "plateThickness", "ribThickness", "stopHeight", "stopDepth", "topEdgeToward", "position"]);
  const width = number(operation.width, `${label}.width`, { min: 30, max: 500 });
  const phoneLength = number(operation.phoneLength, `${label}.phoneLength`, { min: 30, max: 300 });
  const angle = number(operation.angle, `${label}.angle`, { min: 10, max: 70 });
  const plateThickness = number(operation.plateThickness, `${label}.plateThickness`, { min: 1, max: 10 });
  const ribThickness = number(operation.ribThickness, `${label}.ribThickness`, { min: 2, max: 30 });
  if (ribThickness * 2 >= width) fail(`${label}.ribThickness must leave room between the two ribs`);
  const stopHeight = number(operation.stopHeight, `${label}.stopHeight`, { min: 3, max: 40 });
  const stopDepth = number(operation.stopDepth, `${label}.stopDepth`, { min: 2, max: 20 });
  const topEdgeToward = text(operation.topEdgeToward, `${label}.topEdgeToward`).toUpperCase();
  if (!["+Y", "-Y"].includes(topEdgeToward)) fail(`${label}.topEdgeToward must be +Y (toward dashboard) or -Y (toward driver)`);
  const position = triple(operation.position, `${label}.position`);
  const run = phoneLength * Math.cos(angle * Math.PI / 180);
  const rise = phoneLength * Math.sin(angle * Math.PI / 180);
  if (run < 10 || rise < 5) fail(`${label} cradle angle and phoneLength produce an unusable support footprint`);
  return { type, id, name: text(operation.name, `${label}.name`, "Angled phone cradle"), width, phoneLength, angle, plateThickness, ribThickness, stopHeight, stopDepth, topEdgeToward, position, run, rise };
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, remember } = ctx;
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Phone cradle ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const [centerX, lowerEdgeY, baseZ] = operation.position;
  const direction = operation.topEdgeToward === "+Y" ? 1 : -1;
  const radians = operation.angle * Math.PI / 180;
  const centerY = lowerEdgeY + direction * operation.run / 2;
  const panelPosition = [centerX, centerY + direction * Math.sin(radians) * 0.4, baseZ + operation.rise / 2 - Math.cos(radians) * 0.4];
  const panelRotation = [direction * operation.angle, 0, 0];
  const panelTransform = matrixForTransform(panelPosition, panelRotation);
  const panel = { t: "prim", kind: "box", p: { w: operation.width, d: operation.phoneLength, h: operation.plateThickness }, mods: [] };
  const body = addBody(operation.name, panel, panelTransform);
  const addSupport = (kind, parameters, position, rotation = [0, 0, 0]) => {
    body.node.mods.push({
      id: idFactory("f"), seq: ++doc.seq, t: "bool", src: "phoneCradle", op: "join",
      tool: { t: "prim", kind, p: clone(parameters), mods: [] },
      m: matrixMultiply(matrixInverse(body.m), matrixForTransform(position, rotation)),
    });
  };
  for (const side of [-1, 1]) {
    const ribX = centerX + side * (operation.width / 2 - operation.ribThickness / 2);
    addSupport("wedge", { w: operation.ribThickness, d: operation.run, h: operation.rise }, [ribX, centerY, baseZ], direction < 0 ? [0, 0, 180] : [0, 0, 0]);
  }
  const stopOverlap = Math.min(1, operation.stopDepth / 4);
  const stopY = lowerEdgeY - direction * (operation.stopDepth / 2 - stopOverlap);
  addSupport("box", { w: operation.width, d: operation.stopDepth, h: operation.stopHeight }, [centerX, stopY, baseZ]);
  body.mcpPhoneCradle = {
    coordinateFrame: { description: "X across · Y front/back · Z up", orientation: "+Y = dashboard", screen: direction > 0 ? "Screen faces -Y (driver side)" : "Screen faces +Y (dashboard side)" },
    topEdgeToward: operation.topEdgeToward,
    screenFacesToward: direction > 0 ? "-Y" : "+Y",
    width: operation.width, phoneLength: operation.phoneLength, angle: operation.angle,
    plateThickness: operation.plateThickness, ribThickness: operation.ribThickness,
    stopHeight: operation.stopHeight, stopDepth: operation.stopDepth,
    run: operation.run, rise: operation.rise, position: operation.position.slice(), supportRibs: 2,
  };
  remember(operation.id, [body]);
}
