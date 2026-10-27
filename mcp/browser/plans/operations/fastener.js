import { MCP_PLAN_LIMITS, fail, strictObject, text, number, triple } from "../plan-input.js";
import { matrixForTransform } from "../plan-geometry.js";
import { createFastener } from "../fasteners.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "fastenerType", "size", "length", "clearance", "left", "position", "rotation", "name"]);
  const fastenerType = text(operation.fastenerType, `${label}.fastenerType`);
  if (!["bolt", "nut", "rod", "cutter"].includes(fastenerType)) fail(`${label}.fastenerType must be bolt, nut, rod, or cutter`);
  if (operation.left !== undefined && typeof operation.left !== "boolean") fail(`${label}.left must be a boolean`);
  const out = { type, id, fastenerType, size: text(operation.size, `${label}.size`), position: triple(operation.position ?? [0, 0, 0], `${label}.position`), rotation: triple(operation.rotation ?? [0, 0, 0], `${label}.rotation`), left: operation.left === true, clearance: number(operation.clearance ?? 0, `${label}.clearance`, { min: -1, max: 0 }) };
  if (fastenerType !== "nut") out.length = number(operation.length, `${label}.length`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
  if (operation.name !== undefined) out.name = text(operation.name, `${label}.name`);
  return out;
}

export function build(operation, ctx) {
  const { doc, idFactory, remember, createdBodyIds, affectedBodyIds } = ctx;
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const result = createFastener(operation, { idFactory, nextSeq: () => ++doc.seq, matrixForTransform });
  doc.bodies.push(result.body);
  createdBodyIds.push(result.body.id);
  affectedBodyIds.add(result.body.id);
  remember(operation.id, [result.body]);
}
