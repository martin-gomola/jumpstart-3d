import { findRegions, resolveSketch } from "../../../../src/regions.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text, number, triple } from "../plan-input.js";
import { planeFor, matrixForTransform } from "../plan-geometry.js";

export const advanced = true;

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "diameter", "length", "grooves", "depth", "bore", "boreSize", "boreDepth", "boreFlat", "position", "rotation", "name"]);
  const diameter = number(operation.diameter ?? 20, `${label}.diameter`, { min: 6, max: 150 });
  const length = number(operation.length ?? 15, `${label}.length`, { min: 1, max: 200 });
  const grooves = number(operation.grooves ?? Math.min(MCP_PLAN_LIMITS.knurlGrooves, Math.max(8, Math.round(Math.PI * diameter))), `${label}.grooves`, { min: 8, max: MCP_PLAN_LIMITS.knurlGrooves });
  if (!Number.isInteger(grooves)) fail(`${label}.grooves must be a whole number from 8 to ${MCP_PLAN_LIMITS.knurlGrooves}`);
  const radius = diameter / 2;
  const maxDepth = Math.floor(radius / 2 * 1000 + 1e-6) / 1000;
  const minDepth = Math.ceil(radius * (1 - Math.cos(Math.PI / grooves)) * 1000 - 1e-6) / 1000;
  const depth = number(operation.depth ?? Math.round(Math.PI * diameter / grooves / 2 * 1000) / 1000, `${label}.depth`, { min: 0.1, max: maxDepth });
  if (depth < minDepth - 1e-9) fail(`${label}.depth must be at least ${minDepth} mm for ${grooves} grooves; shallower grooves vanish`);
  const bore = text(operation.bore, `${label}.bore`, "none").toLowerCase();
  if (!["none", "round", "hex", "d"].includes(bore)) fail(`${label}.bore must be none, round, hex, or d`);
  if (bore === "none" && operation.boreSize !== undefined) fail(`${label}.boreSize is only supported when a bore is selected`);
  const rootRadius = radius - depth;
  const maxBore = Math.floor((bore === "hex" ? Math.sqrt(3) : 2) * (rootRadius - 1) * 1000 + 1e-6) / 1000;
  const defaultBore = bore === "hex" ? 8 : 5;
  const boreSize = bore === "none" ? undefined : number(operation.boreSize ?? defaultBore, `${label}.boreSize`, { min: 1, max: Math.max(0, maxBore) });
  if (bore === "none" && operation.boreDepth !== undefined) fail(`${label}.boreDepth is only supported when a bore is selected`);
  if (bore !== "d" && operation.boreFlat !== undefined) fail(`${label}.boreFlat is only supported for a D bore`);
  const boreDepth = operation.boreDepth === undefined ? undefined : number(operation.boreDepth, `${label}.boreDepth`, { min: 0.5, max: length });
  const boreFlat = bore === "d" ? number(operation.boreFlat ?? 0.4 * boreSize, `${label}.boreFlat`, { min: 0, max: Math.floor((boreSize / 2 - 0.1) * 1000) / 1000 }) : undefined;
  const blind = boreDepth !== undefined && boreDepth < length - 1e-9 ? { boreDepth } : {};
  const position = triple(operation.position ?? [0, 0, 0], `${label}.position`);
  const rotation = triple(operation.rotation ?? [0, 0, 0], `${label}.rotation`).map((v, axis) => number(v, `${label}.rotation[${axis}]`, { min: -360, max: 360 }));
  return { type, id, diameter, length, grooves, depth, bore, ...(boreSize === undefined ? {} : { boreSize }), ...blind, ...(boreFlat === undefined ? {} : { boreFlat }), position, rotation, name: text(operation.name, `${label}.name`, `Knurled knob ${diameter} x ${length}`) };
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, remember } = ctx;
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Knurl ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const radius = operation.diameter / 2, rootRadius = radius - operation.depth;
  const sketch = { id: idFactory("s"), name: `${operation.name} profile`, seq: ++doc.seq, plane: planeFor("XY", [0, 0, 0]), pts: [], ents: [], hidden: true };
  const point = (x, y) => { const id = idFactory("p"); sketch.pts.push({ id, x: Math.round(x * 1e6) / 1e6 || 0, y: Math.round(y * 1e6) / 1e6 || 0 }); return id; };
  const line = (a, b) => sketch.ents.push({ id: idFactory("e"), t: "line", a, b });
  const ring = [];
  for (let i = 0; i < operation.grooves; i++) {
    const tip = 2 * Math.PI * i / operation.grooves;
    const root = tip + Math.PI / operation.grooves;
    ring.push(point(radius * Math.cos(tip), radius * Math.sin(tip)), point(rootRadius * Math.cos(root), rootRadius * Math.sin(root)));
  }
  for (let i = 0; i < ring.length; i++) line(ring[i], ring[(i + 1) % ring.length]);
  if (operation.bore === "round") sketch.ents.push({ id: idFactory("e"), t: "circle", c: point(0, 0), r: operation.boreSize / 2 });
  else if (operation.bore === "hex") {
    const cornerRadius = operation.boreSize / Math.sqrt(3);
    const vertices = Array.from({ length: 6 }, (_, i) => point(cornerRadius * Math.cos(i * Math.PI / 3), cornerRadius * Math.sin(i * Math.PI / 3)));
    for (let i = 0; i < vertices.length; i++) line(vertices[i], vertices[(i + 1) % vertices.length]);
  } else if (operation.bore === "d") {
    const boreRadius = operation.boreSize / 2, flatX = operation.boreFlat;
    const y = Math.sqrt(boreRadius ** 2 - flatX ** 2), center = point(0, 0), top = point(flatX, y), bottom = point(flatX, -y);
    sketch.ents.push({ id: idFactory("e"), t: "arc", c: center, a: top, b: bottom });
    line(bottom, top);
  }
  doc.sketches.push(sketch);
  const outerEdge = sketch.ents[0]?.id;
  const regions = findRegions(resolveSketch(sketch));
  const profile = regions.find((region) => region.ents.includes(outerEdge));
  if (!profile) fail(`Knurl ${operation.id} could not resolve its outer groove profile`);
  const profileRef = { key: profile.key, pt: profile.pt };
  const mods = [];
  if (operation.boreDepth !== undefined) {
    const core = regions.find((region) => !region.ents.includes(outerEdge));
    if (!core) fail(`Knurl ${operation.id} could not resolve its bore profile`);
    const tool = { t: "extrude", sketch: sketch.id, profiles: [{ key: core.key, pt: core.pt }], dist: operation.length - operation.boreDepth, mode: "one", dist2: 0, mods: [] };
    mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", op: "join", tool, m: matrixForTransform([0, 0, operation.boreDepth]) });
  }
  const body = addBody(operation.name, { t: "extrude", sketch: sketch.id, profiles: [profileRef], dist: operation.length, mode: "one", dist2: 0, mods }, matrixForTransform(operation.position, operation.rotation));
  body.mcpKnurl = { diameter: operation.diameter, length: operation.length, grooves: operation.grooves, pitch: Math.PI * operation.diameter / operation.grooves, depth: operation.depth, bore: operation.bore, ...(operation.boreSize === undefined ? {} : { boreSize: operation.boreSize }), ...(operation.boreDepth === undefined ? {} : { boreDepth: operation.boreDepth }), ...(operation.boreFlat === undefined ? {} : { boreFlat: operation.boreFlat }) };
  remember(operation.id, [body]);
}
