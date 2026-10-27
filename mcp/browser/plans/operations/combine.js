import { clone } from "../../../../src/util.js";
import { combinedRole } from "../../../../src/bodyRoles.js";
import { fail, strictObject, text } from "../plan-input.js";
import { matrixMultiply, matrixInverse } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "tool", "operation", "keepTool"]);
  if (operation.keepTool !== undefined && typeof operation.keepTool !== "boolean") fail(`${label}.keepTool must be a boolean`);
  const op = text(operation.operation, `${label}.operation`);
  if (!["join", "cut", "intersect"].includes(op)) fail(`${label}.operation must be join, cut, or intersect`);
  return { type, id, target: text(operation.target, `${label}.target`), tool: text(operation.tool, `${label}.tool`), operation: op, keepTool: operation.keepTool === true };
}

export function build(operation, ctx) {
  const { doc, idFactory, bodyList, remember, affectedBodyIds } = ctx;
  const target = bodyList(operation.target);
  const tools = bodyList(operation.tool);
  if (target.length !== 1 || tools.length !== 1 || target[0].id === tools[0].id) fail(`Combine ${operation.id} requires two distinct single bodies`);
  const [base, tool] = [target[0], tools[0]];
  const role = combinedRole([base, tool], operation.operation);
  if (role !== undefined) base.role = role;
  base.node.mods = base.node.mods || [];
  base.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", src: "combine", ...(operation.operation === "join" ? {} : { op: operation.operation }), tool: clone(tool.node), m: matrixMultiply(matrixInverse(base.m), tool.m) });
  affectedBodyIds.add(base.id);
  if (!operation.keepTool) doc.bodies = doc.bodies.filter((body) => body.id !== tool.id);
  remember(operation.id, [base]);
}
