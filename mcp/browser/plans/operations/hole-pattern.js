import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, fail, object, strictObject, text, number, triple } from "../plan-input.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "face", "layout", "hole", "shape", "width", "length", "depth"]);
  const face = text(operation.face, `${label}.face`).toLowerCase();
  if (!["+x", "-x", "+y", "-y", "+z", "-z"].includes(face)) fail(`${label}.face must be +x, -x, +y, -y, +z, or -z`);
  const layout = object(operation.layout, `${label}.layout`);
  let normalizedLayout;
  if (layout.type === "grid") {
    strictObject(layout, `${label}.layout`, ["type", "cols", "rows", "pitch", "margin", "stagger", "angle"]);
    const cols = number(layout.cols, `${label}.layout.cols`, { min: 1, max: MCP_PLAN_LIMITS.holePatternPositions });
    const rows = number(layout.rows, `${label}.layout.rows`, { min: 1, max: MCP_PLAN_LIMITS.holePatternPositions });
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols * rows > MCP_PLAN_LIMITS.holePatternPositions) fail(`${label}.layout grid must contain at most ${MCP_PLAN_LIMITS.holePatternPositions} positions`);
    const pitch = layout.pitch === undefined ? undefined : Array.isArray(layout.pitch)
      ? layout.pitch.map((value, j) => number(value, `${label}.layout.pitch[${j}]`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }))
      : number(layout.pitch, `${label}.layout.pitch`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
    if (Array.isArray(pitch) && pitch.length !== 2) fail(`${label}.layout.pitch must be a number or a pair`);
    if (layout.stagger !== undefined && typeof layout.stagger !== "boolean") fail(`${label}.layout.stagger must be a boolean`);
    normalizedLayout = { type: "grid", cols, rows, pitch, margin: number(layout.margin ?? 0, `${label}.layout.margin`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }), stagger: layout.stagger === true, angle: number(layout.angle ?? 0, `${label}.layout.angle`, { min: -360, max: 360 }) };
  } else if (layout.type === "circle") {
    strictObject(layout, `${label}.layout`, ["type", "count", "radius", "start", "center", "margin"]);
    const count = number(layout.count, `${label}.layout.count`, { min: 2, max: MCP_PLAN_LIMITS.holePatternPositions });
    if (!Number.isInteger(count)) fail(`${label}.layout.count must be an integer`);
    normalizedLayout = { type: "circle", count, radius: number(layout.radius, `${label}.layout.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), start: number(layout.start ?? 0, `${label}.layout.start`, { min: -360, max: 360 }), center: layout.center === undefined ? undefined : triple(layout.center, `${label}.layout.center`), margin: number(layout.margin ?? 0, `${label}.layout.margin`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) };
  } else fail(`${label}.layout.type must be grid or circle`);
  const shapeType = text(operation.shape, `${label}.shape`, "round").toLowerCase();
  if (!["round", "square", "hex", "slot"].includes(shapeType)) fail(`${label}.shape must be round, square, hex, or slot`);
  let shape = { type: shapeType };
  let normalizedHole;
  if (shapeType === "round") {
    if (operation.width !== undefined || operation.length !== undefined || operation.depth !== undefined) fail(`${label} width, length, and depth are only supported for shaped patterns`);
    const hole = object(operation.hole, `${label}.hole`);
    strictObject(hole, `${label}.hole`, ["kind", "diameter", "depth", "counterboreDiameter", "counterboreDepth", "countersinkDiameter", "countersinkAngle", "pitch", "clearance", "tip"]);
    const kind = hole.kind ?? "simple";
    if (!["simple", "cbore", "csink", "tapped"].includes(kind)) fail(`${label}.hole.kind must be simple, cbore, csink, or tapped`);
    normalizedHole = {
      kind,
      diameter: number(hole.diameter, `${label}.hole.diameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      depth: hole.depth === undefined ? undefined : number(hole.depth, `${label}.hole.depth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      counterboreDiameter: number(hole.counterboreDiameter ?? 8, `${label}.hole.counterboreDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      counterboreDepth: number(hole.counterboreDepth ?? 3, `${label}.hole.counterboreDepth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      countersinkDiameter: number(hole.countersinkDiameter ?? 9, `${label}.hole.countersinkDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      countersinkAngle: number(hole.countersinkAngle ?? 90, `${label}.hole.countersinkAngle`, { min: 1, max: 179 }),
      pitch: number(hole.pitch ?? 0.5, `${label}.hole.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }),
      clearance: number(hole.clearance ?? 0, `${label}.hole.clearance`, { min: -1, max: 0 }),
      tip: hole.tip === true,
    };
    if (hole.tip !== undefined && typeof hole.tip !== "boolean") fail(`${label}.hole.tip must be a boolean`);
  } else {
    if (operation.hole !== undefined) fail(`${label}.hole settings are only supported for round patterns`);
    const width = number(operation.width, `${label}.width`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
    if (shapeType === "slot") {
      const length = number(operation.length, `${label}.length`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
      if (length <= width) fail(`${label}.length must be greater than its width for a slot`);
      shape.length = length;
    } else if (operation.length !== undefined) fail(`${label}.length is only supported for slot patterns`);
    if (operation.depth !== undefined) shape.depth = number(operation.depth, `${label}.depth`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
    shape.width = width;
  }
  return { type, id, target: text(operation.target, `${label}.target`), face, layout: normalizedLayout, shape, ...(normalizedHole ? { hole: normalizedHole } : {}) };
}

export function build(operation, ctx) {
  const { doc, idFactory, bodyList, remember, affectedBodyIds, featureMods, pendingHolePatterns } = ctx;
  const targets = bodyList(operation.target);
  if (targets.length !== 1) fail(`Hole pattern ${operation.id} must target exactly one body`);
  const target = targets[0];
  if (target.locked) fail(`Unlock body ${operation.target} before adding a hole pattern`);
  const pending = { ...clone(operation), bodyId: target.id, featureId: idFactory("f") };
  if (operation.shape.type === "round") pending.seq = ++doc.seq;
  else {
    pending.sketchId = idFactory("s");
    pending.sketchSeq = ++doc.seq;
    pending.seq = ++doc.seq;
  }
  pendingHolePatterns.push(pending);
  featureMods.set(operation.id, [{ bodyId: target.id, featureId: pending.featureId }]);
  affectedBodyIds.add(target.id);
  remember(operation.id, targets);
}
