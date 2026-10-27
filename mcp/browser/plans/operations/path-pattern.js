import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text, number, triple } from "../plan-input.js";
import { matrixMultiply, axisRotationMatrix, pathFrame, pathSamples, matrixForTransform } from "../plan-geometry.js";

export function normalize(operation, label, { type, id, sketches }) {
  strictObject(operation, label, ["id", "type", "source", "path", "mode", "count", "spacing", "direction", "orientation", "anchor"]);
  const mode = text(operation.mode, `${label}.mode`, "fit");
  if (!["fit", "spacing"].includes(mode)) fail(`${label}.mode must be fit or spacing`);
  const count = number(operation.count, `${label}.count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
  if (!Number.isInteger(count)) fail(`${label}.count must be an integer`);
  if (mode === "fit" && operation.spacing !== undefined) fail(`${label}.spacing is only supported in spacing mode`);
  if (mode === "spacing" && operation.spacing === undefined) fail(`${label}.spacing is required in spacing mode`);
  const direction = text(operation.direction, `${label}.direction`, "forward");
  if (!["forward", "reverse"].includes(direction)) fail(`${label}.direction must be forward or reverse`);
  const orientation = text(operation.orientation, `${label}.orientation`, "same");
  if (!["same", "follow-path"].includes(orientation)) fail(`${label}.orientation must be same or follow-path`);
  const path = text(operation.path, `${label}.path`);
  if (!sketches.some((sketch) => sketch.id === path && sketch.segments)) fail(`${label}.path must reference an earlier path sketch`);
  return { type, id, source: text(operation.source, `${label}.source`), path, mode, count,
    ...(mode === "spacing" ? { spacing: number(operation.spacing, `${label}.spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }) } : {}), direction, orientation,
    ...(operation.anchor === undefined ? {} : { anchor: triple(operation.anchor, `${label}.anchor`) }) };
}

export function build(operation, ctx) {
  const { doc, plan, idFactory, bodyList, remember, createdBodyIds, affectedBodyIds } = ctx;
  const sources = bodyList(operation.source);
  const definition = plan.sketches.find((sketch) => sketch.id === operation.path);
  if (!definition?.segments) fail(`Path pattern ${operation.id} references an unavailable path sketch`);
  if (doc.bodies.length + sources.length * (operation.count - 1) > MCP_PLAN_LIMITS.bodies) fail(`Path pattern ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const frame = pathFrame(definition.plane, definition.origin);
  const tangentAngle = (tangent) => Math.atan2(tangent[0] * frame.y[0] + tangent[1] * frame.y[1] + tangent[2] * frame.y[2], tangent[0] * frame.x[0] + tangent[1] * frame.x[1] + tangent[2] * frame.x[2]);
  const copies = [];
  for (const source of sources) {
    const samples = pathSamples(definition, operation.count, operation.mode, operation.spacing, operation.direction, operation.anchor || source.m.slice(12, 15));
    const first = samples[0];
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      if (index === 0) { copies.push(source); continue; }
      const delta = sample.point.map((value, axis) => value - first.point[axis]);
      let transform = matrixForTransform(delta);
      if (operation.orientation === "follow-path") {
        const angle = tangentAngle(sample.tangent) - tangentAngle(first.tangent);
        transform = matrixMultiply(transform, axisRotationMatrix(frame.n, angle, first.point));
      }
      const copy = clone(source);
      copy.id = idFactory("b"); copy.seq = ++doc.seq;
      copy.name = `${source.name} path ${index + 1}`.slice(0, 80);
      copy.m = matrixMultiply(transform, source.m);
      doc.bodies.push(copy); createdBodyIds.push(copy.id); affectedBodyIds.add(copy.id); copies.push(copy);
    }
  }
  remember(operation.id, copies);
}
