import { MCP_PLAN_LIMITS, fail, strictObject, text, number, triple } from "../plan-input.js";
import { matrixForTransform } from "../plan-geometry.js";

export const advanced = true;

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "gearType", "module", "teeth", "pressureAngle", "thickness", "bore", "baseDepth", "coneAngle", "position", "rotation", "name"]);
  const gearType = text(operation.gearType, `${label}.gearType`).toLowerCase();
  if (!["spur", "rack", "bevel"].includes(gearType)) fail(`${label}.gearType must be spur, rack, or bevel`);
  if (gearType === "rack" && operation.bore !== undefined) fail(`${label}.bore is only supported for spur gears or bevel gears`);
  if (gearType !== "rack" && operation.baseDepth !== undefined) fail(`${label}.baseDepth is only supported for racks`);
  if (gearType !== "bevel" && operation.coneAngle !== undefined) fail(`${label}.coneAngle is only supported for bevel gears`);
  const module = number(operation.module, `${label}.module`, { min: 0.2, max: 50 });
  const teeth = number(operation.teeth, `${label}.teeth`, { min: 6, max: MCP_PLAN_LIMITS.gearTeeth });
  if (!Number.isInteger(teeth)) fail(`${label}.teeth must be an integer`);
  const pressureAngle = number(operation.pressureAngle ?? 20, `${label}.pressureAngle`, { min: 14, max: 30 });
  const thickness = number(operation.thickness, `${label}.thickness`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
  if (gearType === "rack" && Math.PI * module * teeth > MCP_PLAN_LIMITS.coordinate) fail(`${label} rack length must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
  if (gearType !== "rack" && module * (teeth + 2) > MCP_PLAN_LIMITS.coordinate) fail(`${label} gear outside diameter must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
  const bore = gearType !== "rack" ? number(operation.bore ?? 0, `${label}.bore`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
  const coneAngle = gearType === "bevel" ? number(operation.coneAngle ?? 45, `${label}.coneAngle`, { min: 5, max: 80 }) : undefined;
  const smallEndRoot = gearType === "bevel" ? module * (teeth - 2.5) / 2 * (module * teeth / 2 - thickness * Math.tan(coneAngle * Math.PI / 180)) / (module * teeth / 2) : module * (teeth - 2.5) / 2;
  if (gearType === "bevel" && smallEndRoot <= 0.01) fail(`${label} face width and cone angle leave no usable small-end root`);
  if (gearType !== "rack" && bore >= smallEndRoot * 2 - 0.01) fail(gearType === "bevel" ? `${label}.bore must be smaller than the smallest gear root diameter` : `${label}.bore must be smaller than the gear root diameter`);
  const baseDepth = gearType === "rack" ? number(operation.baseDepth ?? module * 2, `${label}.baseDepth`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
  if (gearType === "rack" && baseDepth + 2.25 * module > MCP_PLAN_LIMITS.coordinate) fail(`${label} rack height must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
  const rotation = triple(operation.rotation ?? [0, 0, 0], `${label}.rotation`).map((v, axis) => number(v, `${label}.rotation[${axis}]`, { min: -360, max: 360 }));
  return { type, id, gearType, module, teeth, pressureAngle, thickness, ...(bore === undefined ? {} : { bore }), ...(baseDepth === undefined ? {} : { baseDepth }), ...(coneAngle === undefined ? {} : { coneAngle }), position: triple(operation.position ?? [0, 0, 0], `${label}.position`), rotation, name: text(operation.name, `${label}.name`, gearType === "spur" ? `Spur gear ${teeth}T` : gearType === "bevel" ? `Straight bevel gear ${teeth}T` : `Rack ${teeth}T`) };
}

export function build(operation, ctx) {
  const { doc, addBody, remember } = ctx;
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const node = { t: "prim", kind: operation.gearType === "spur" ? "gear" : operation.gearType === "bevel" ? "bevelgear" : "rack", p: { module: operation.module, teeth: operation.teeth, pressureAngle: operation.pressureAngle, thickness: operation.thickness, ...(operation.bore === undefined ? {} : { bore: operation.bore }), ...(operation.baseDepth === undefined ? {} : { baseDepth: operation.baseDepth }), ...(operation.coneAngle === undefined ? {} : { coneAngle: operation.coneAngle }) }, mods: [] };
  remember(operation.id, [addBody(operation.name, node, matrixForTransform(operation.position, operation.rotation))]);
}
