import { clone } from "../../../../src/util.js";
import { bodyRole, combinedRole } from "../../../../src/bodyRoles.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text } from "../plan-input.js";
import { IDENTITY } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "name", "members", "operation"]);
  if (!Array.isArray(operation.members) || operation.members.length < 1 || operation.members.length > MCP_PLAN_LIMITS.primitives) fail(`${label}.members must contain 1 to ${MCP_PLAN_LIMITS.primitives} body ids`);
  if (new Set(operation.members).size !== operation.members.length) fail(`${label}.members must not contain duplicates`);
  const op = operation.operation ?? "union";
  if (!["union", "cut", "intersect"].includes(op)) fail(`${label}.operation must be union, cut, or intersect`);
  return { type, id, name: text(operation.name, `${label}.name`, id), members: operation.members.map((member) => text(member, `${label}.members`)), operation: op };
}

export function build(operation, ctx) {
  const { doc, addBody, bodyList, remember } = ctx;
  const members = operation.members.flatMap((member) => bodyList(member));
  if (members.length < 2) fail(`Group ${operation.id} must contain at least two bodies`);
  if (new Set(members.map((body) => body.id)).size !== members.length) fail(`Group ${operation.id} contains the same body more than once`);
  const children = members.map((body, i) => ({
    node: clone(body.node), m: body.m.slice(), hole: operation.operation === "cut" ? i > 0 : !!body.hole,
    name: body.name, color: body.color,
    ...(members.some(member => member.role !== undefined) ? { role: bodyRole(body) } : {}),
  }));
  const node = { t: "group", ...(operation.operation === "intersect" ? { op: "intersect" } : {}), children, mods: [] };
  const group = addBody(operation.name, node, IDENTITY.slice(), children.every((child) => child.hole));
  const role = combinedRole(members, operation.operation);
  if (role !== undefined) group.role = role;
  doc.bodies = doc.bodies.filter((body) => !members.some((member) => member.id === body.id));
  remember(operation.id, [group]);
}
