import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text, triple } from "../plan-input.js";
import { matrixInverse } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "plane"]);
  const plane = strictObject(operation.plane, `${label}.plane`, ["origin", "normal"]);
  const normal = triple(plane.normal, `${label}.plane.normal`);
  const length = Math.hypot(...normal);
  if (length < 1e-12) fail(`${label}.plane.normal must not be zero`);
  return { type, id, target: text(operation.target, `${label}.target`), plane: { o: triple(plane.origin, `${label}.plane.origin`), n: normal.map((value) => value / length) } };
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, bodyList, remember, affectedBodyIds } = ctx;
  const targets = bodyList(operation.target);
  if (targets.length !== 1) fail(`Split ${operation.id} requires exactly one unambiguous target body`);
  const source = targets[0];
  if (source.locked) fail(`Unlock body ${operation.target} before splitting it`);
  if (!source.node || typeof source.node !== "object") fail(`Split ${operation.id} requires an editable body`);
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Split ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const inverse = matrixInverse(source.m);
  const [x, y, z] = operation.plane.o, [nx, ny, nz] = operation.plane.n;
  const origin = [
    inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12],
    inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13],
    inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14],
  ];
  const normal = [
    inverse[0] * nx + inverse[4] * ny + inverse[8] * nz,
    inverse[1] * nx + inverse[5] * ny + inverse[9] * nz,
    inverse[2] * nx + inverse[6] * ny + inverse[10] * nz,
  ];
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length < 1e-12) fail(`Split ${operation.id} has an invalid transformed plane`);
  const localPlane = { o: origin, n: normal.map((value) => value / length) };
  source.node.mods = source.node.mods || [];
  source.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "halfspace", plane: clone(localPlane), side: 1 });
  const otherNode = clone(source.node);
  otherNode.mods = otherNode.mods.slice(0, -1);
  otherNode.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "halfspace", plane: clone(localPlane), side: -1 });
  const other = addBody(`${source.name || "Body"} (split)`.slice(0, 80), otherNode, source.m, !!source.hole);
  if (source.color !== undefined) other.color = source.color;
  if (source.role !== undefined) other.role = source.role;
  affectedBodyIds.add(source.id);
  remember(operation.id, [source, other]);
}
