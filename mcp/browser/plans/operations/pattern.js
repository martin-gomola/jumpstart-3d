import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, AXES, fail, strictObject, text, number, triple } from "../plan-input.js";
import { rotationMatrix, matrixMultiply, matrixForTransform } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "source", "mode", "axis", "count", "spacing", "symmetric", "angle", "origin"]);
  const mode = text(operation.mode, `${label}.mode`);
  if (!["linear", "circular"].includes(mode)) fail(`${label}.mode must be linear or circular`);
  if (operation.symmetric !== undefined && typeof operation.symmetric !== "boolean") fail(`${label}.symmetric must be a boolean`);
  const axis = text(operation.axis, `${label}.axis`).toUpperCase();
  if (!AXES.has(axis)) fail(`${label}.axis must be X, Y, or Z`);
  const count = number(operation.count, `${label}.count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
  if (!Number.isInteger(count)) fail(`${label}.count must be an integer`);
  return { type, id, source: text(operation.source, `${label}.source`), mode, axis, count,
    ...(mode === "linear" ? { spacing: number(operation.spacing, `${label}.spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), symmetric: operation.symmetric === true } : { angle: number(operation.angle ?? 360, `${label}.angle`, { min: 1, max: 360 }), origin: triple(operation.origin ?? [0, 0, 0], `${label}.origin`) }) };
}

export function build(operation, ctx) {
  const { doc, idFactory, bodyList, remember, createdBodyIds, affectedBodyIds } = ctx;
  const sources = bodyList(operation.source);
  const copyCount = operation.mode === "linear" && operation.symmetric ? operation.count * 2 - 1 : operation.count;
  if (doc.bodies.length + sources.length * (copyCount - 1) > MCP_PLAN_LIMITS.bodies) fail(`Pattern ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const copies = [];
  const indices = operation.mode === "linear" && operation.symmetric
    ? Array.from({ length: operation.count * 2 - 1 }, (_, i) => i - (operation.count - 1))
    : Array.from({ length: operation.count }, (_, i) => i);
  for (const index of indices) {
    for (const source of sources) {
      if (index === 0) { copies.push(source); continue; }
      let transform;
      if (operation.mode === "circular") {
        const fullCircle = operation.angle >= 359.999;
        const stepAngle = fullCircle ? 360 / operation.count : operation.angle / (operation.count - 1);
        transform = rotationMatrix(operation.axis, stepAngle * index, operation.origin);
      }
      else {
        const delta = [0, 0, 0]; delta[["X", "Y", "Z"].indexOf(operation.axis)] = index * operation.spacing;
        transform = matrixForTransform(delta);
      }
      const copy = clone(source);
      copy.id = idFactory("b"); copy.seq = ++doc.seq;
      copy.name = `${source.name} ${index + 1}`.slice(0, 80);
      copy.m = matrixMultiply(transform, source.m);
      doc.bodies.push(copy); createdBodyIds.push(copy.id); affectedBodyIds.add(copy.id); copies.push(copy);
    }
  }
  remember(operation.id, copies);
}
