/*! @license
Dimensional profiles adapted from gridfinity-rebuilt-openscad, revision
910e22d8607fd7f5f51ad5e5cbc5287a76810bfd.
Additional baseplate notice: Copyright Arthur Moore 2025, MIT License.

MIT License

Copyright (c) 2023 Kenneth Hodson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


This repository is based on Gridfinity:

MIT License

Copyright (c) 2023 Zachary Freedman and Voidstar Lab LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { findRegions, resolveSketch } from "../../src/regions.js";
import { normalizeMagnetPockets, magnetCarrierHeight, magnetCenters, MAGNET_CARRIER_FLOOR } from "../shared/gridfinity-magnets.js";

export const GRIDFINITY_LIMITS = Object.freeze({ columns: 4, rows: 4, cells: 16, heightUnits: 12, dividers: 6 });
const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const sourceRevision = "910e22d8607fd7f5f51ad5e5cbc5287a76810bfd";
const fail = message => { throw new Error(message); };
function number(value, label, min, max, fallback) {
  const n = value === undefined ? fallback : value;
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}`);
  return n;
}
function integer(value, label, min, max, fallback) {
  const n = number(value, label, min, max, fallback);
  if (!Number.isInteger(n)) fail(`${label} must be an integer`);
  return n;
}
function text(value, label, fallback) {
  const s = value === undefined ? fallback : value;
  if (typeof s !== "string" || !s.trim() || s.length > 80) fail(`${label} must contain 1 to 80 characters`);
  return s.trim();
}
function triple(value, label, min, max) {
  const v = value === undefined ? [0,0,0] : value;
  if (!Array.isArray(v) || v.length !== 3) fail(`${label} must be a triple`);
  return v.map((n, i) => number(n, `${label}[${i}]`, min, max));
}

export function normalizeGridfinity(raw, label = "operation") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${label} must be an object`);
  const allowed = new Set(["id", "type", "name", "kind", "columns", "rows", "heightUnits", "floor", "wall", "lip", "dividers", "magnets", "position", "rotation"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) fail(`${label}.${key} is not supported`);
  if (raw.type !== "gridfinity") fail(`${label}.type must be gridfinity`);
  const kind = raw.kind ?? "insert";
  if (!["insert", "bin", "baseplate"].includes(kind)) fail(`${label}.kind must be insert, bin or baseplate`);
  const columns = integer(raw.columns, `${label}.columns`, 1, GRIDFINITY_LIMITS.columns, 1);
  const rows = integer(raw.rows, `${label}.rows`, 1, GRIDFINITY_LIMITS.rows, 1);
  if (columns * rows > GRIDFINITY_LIMITS.cells) fail(`${label} exceeds the ${GRIDFINITY_LIMITS.cells}-cell limit`);
  const heightUnits = integer(raw.heightUnits, `${label}.heightUnits`, 2, GRIDFINITY_LIMITS.heightUnits, 3);
  const floor = number(raw.floor, `${label}.floor`, 0.8, 6, 2);
  const wall = number(raw.wall, `${label}.wall`, 0.8, 4, 1.2);
  if (raw.lip !== undefined && typeof raw.lip !== "boolean") fail(`${label}.lip must be a boolean`);
  const lip = raw.lip === true;
  const dividers = raw.dividers ?? {};
  if (!dividers || typeof dividers !== "object" || Array.isArray(dividers) || Object.keys(dividers).some(key => !["x", "y"].includes(key))) fail(`${label}.dividers must contain only x and y counts`);
  const x = integer(dividers.x, `${label}.dividers.x`, 0, GRIDFINITY_LIMITS.dividers, 0);
  const y = integer(dividers.y, `${label}.dividers.y`, 0, GRIDFINITY_LIMITS.dividers, 0);
  if (kind !== "bin" && (lip || x || y)) fail(`${label}: stacking lip and dividers are only supported for bins`);
  if (kind === "baseplate" && (raw.heightUnits !== undefined && heightUnits !== 3 || raw.floor !== undefined && floor !== 2 || raw.wall !== undefined && wall !== 1.2)) fail(`${label}: baseplate height is fixed at 5 mm; bin height, floor and wall overrides are unsupported`);
  if (kind === "bin" && heightUnits * 7 - 7 - floor < 1) fail(`${label}: floor leaves less than 1 mm of usable bin depth`);
  return { type: "gridfinity", id: text(raw.id, `${label}.id`), name: text(raw.name, `${label}.name`, `Gridfinity ${kind}`), kind, columns, rows, heightUnits, floor, wall, lip, dividers: { x, y }, magnets: normalizeMagnetPockets(raw.magnets, `${label}.magnets`), position: triple(raw.position, `${label}.position`, -10000, 10000), rotation: triple(raw.rotation, `${label}.rotation`, -360, 360) };
}

export function buildGridfinity(operation, { document, idFactory, nextSeq }) {
  const op = normalizeGridfinity(operation);
  const width = op.columns * 42 - (op.kind === "baseplate" ? 0 : 0.5);
  const depth = op.rows * 42 - (op.kind === "baseplate" ? 0 : 0.5);
  const carrierHeight = op.kind === "baseplate" ? magnetCarrierHeight(op.magnets) : 0;
  const topZ = op.kind === "baseplate" ? 5 + carrierHeight : op.heightUnits * 7;
  const seq = nextSeq || (() => ++document.seq);
  const child = (node, x = 0, y = 0, z = 0, hole = false) => {
    const m = IDENTITY.slice(); m[12] = x; m[13] = y; m[14] = z;
    return { node: structuredClone(node), m, hole };
  };
  const group = children => ({ t: "group", children, mods: [] });
  const roundedSketch = (name, w, d, radius, z) => {
    const sketch = { id: idFactory("s"), name, seq: seq(), plane: { o: [0,0,z], x: [1,0,0], n: [0,0,1] }, pts: [], ents: [], hidden: true };
    const point = xy => {
      const existing = sketch.pts.find(p => Math.hypot(p.x - xy[0], p.y - xy[1]) < 1e-8);
      if (existing) return existing.id;
      const id = idFactory("p"); sketch.pts.push({ id, x: xy[0], y: xy[1] }); return id;
    };
    const line = (a, b) => sketch.ents.push({ id: idFactory("e"), t: "line", a: point(a), b: point(b) });
    const [l,r,b,t] = [-w/2,w/2,-d/2,d/2];
    if (radius <= 1e-8) {
      const corners = [[l,b],[r,b],[r,t],[l,t]];
      corners.forEach((corner, i) => line(corner, corners[(i+1)%4]));
    } else {
      const corners = [
        { a: [r-radius,b], b: [r,b+radius], c: [r-radius,b+radius] },
        { a: [r,t-radius], b: [r-radius,t], c: [r-radius,t-radius] },
        { a: [l+radius,t], b: [l,t-radius], c: [l+radius,t-radius] },
        { a: [l,b+radius], b: [l+radius,b], c: [l+radius,b+radius] },
      ];
      corners.forEach((corner, i) => {
        sketch.ents.push({ id: idFactory("e"), t: "arc", a: point(corner.a), b: point(corner.b), c: point(corner.c) });
        line(corner.b, corners[(i+1)%4].a);
      });
    }
    const regions = findRegions(resolveSketch(sketch));
    if (regions.length !== 1) fail(`Gridfinity profile ${name} did not form one closed region`);
    document.sketches.push(sketch);
    return { sketch: sketch.id, ref: { key: sketch.ents.map(entity => entity.id).sort().join(","), pt: [0,0] } };
  };
  const extrude = (name, w, d, radius, z, height) => {
    const ref = roundedSketch(name, w, d, radius, z);
    return { t: "extrude", sketch: ref.sketch, profiles: [ref.ref], dist: height, mode: "one", dist2: 0, mods: [] };
  };
  const loft = sections => ({ t: "loft", sections, rail: null, ruled: true, closed: false, mods: [] });
  const repeated = (node, hole = false) => Array.from({ length: op.columns * op.rows }, (_, i) => child(node, (i % op.columns - (op.columns-1)/2)*42, (Math.floor(i/op.columns)-(op.rows-1)/2)*42, 0, hole));
  let node;
  if (op.kind === "baseplate") {
    const sections = [
      [-0.02,36.3,1.15], [0.35,36.3,1.15], [1.05,37.7,1.85], [2.85,37.7,1.85], [5,42,4], [5.02,42,4],
    ].map(([z,w,r]) => roundedSketch(`Socket at ${z + carrierHeight} mm`, w, w, r, z + carrierHeight));
    const socket = loft(sections);
    node = group([child(extrude("Baseplate perimeter", width, depth, 4, carrierHeight ? carrierHeight - 0.02 : 0, carrierHeight ? 5.02 : 5)), ...repeated(socket, true)]);
    if (op.magnets) {
      // A perforated carrier leaves corner pads and edge rails beneath the sockets.
      const carrier = extrude("Magnet carrier", width, depth, 4, 0, carrierHeight);
      const padRadius = op.magnets.diameter / 2 + 1.2;
      const crossWidth = 26 - 2 * padRadius;
      const horizontal = extrude("Carrier horizontal opening", 37.2, crossWidth, 1.2, -0.01, carrierHeight + 0.02);
      const vertical = extrude("Carrier vertical opening", crossWidth, 37.2, 1.2, -0.01, carrierHeight + 0.02);
      carrier.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "magnetCarrier", op: "cut", tool: group([...repeated(horizontal), ...repeated(vertical)]), m: IDENTITY.slice() });
      node = group([child(carrier), child(node)]);
    }
  } else {
    const sections = [[0,35.6,0.8],[0.8,37.2,1.6],[2.6,37.2,1.6],[4.75,41.5,3.75]].map(([z,w,r]) => roundedSketch(`Foot at ${z} mm`, w, w, r, z));
    const foot = loft(sections);
    const outer = extrude("Outer body", width, depth, 3.75, 4.75, topZ-4.75);
    if (op.kind === "bin") {
      const cavity = extrude("Bin cavity", width-2*op.wall, depth-2*op.wall, Math.max(0,3.75-op.wall), 7+op.floor, topZ-(7+op.floor)+0.02);
      outer.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", op: "cut", tool: cavity, m: IDENTITY.slice() });
    }
    const solids = [...repeated(foot), child(outer)];
    if (op.kind === "bin") {
      const h = topZ-7-op.floor;
      const box = (w,d) => ({ t: "prim", kind: "box", p: { w,d,h,r:0,c:0 }, mods: [] });
      for (let i = 1; i <= op.dividers.x; i++) solids.push(child(box(op.wall,depth-2*op.wall+0.02), -width/2+op.wall+(width-2*op.wall)*i/(op.dividers.x+1), 0, 7+op.floor-0.01));
      for (let i = 1; i <= op.dividers.y; i++) solids.push(child(box(width-2*op.wall+0.02,op.wall), 0, -depth/2+op.wall+(depth-2*op.wall)*i/(op.dividers.y+1), 7+op.floor-0.01));
      if (op.lip) {
        const lower = topZ-3.8;
        const lipOuter = extrude("Stacking lip outside", width,depth,3.75, lower, 8.2);
        const innerSections = [
          [lower-0.01,width-2*op.wall,depth-2*op.wall,Math.max(0,3.75-op.wall)],
          [topZ-1.2,width-5.2,depth-5.2,1.15], [topZ,width-5.2,depth-5.2,1.15],
          [topZ+0.7,width-3.8,depth-3.8,1.85], [topZ+2.5,width-3.8,depth-3.8,1.85],
          [topZ+4.4,width,depth,3.75], [topZ+4.42,width,depth,3.75],
        ].map(([z,w,d,r]) => roundedSketch(`Stacking lip inside at ${z} mm`, w,d,r,z));
        lipOuter.mods.push({ id:idFactory("f"),seq:seq(),t:"bool",op:"cut",tool:loft(innerSections),m:IDENTITY.slice() });
        solids.push(child(lipOuter));
      }
    }
    node = group(solids);
  }
  const centers = op.magnets ? magnetCenters(op.columns, op.rows) : [];
  if (op.magnets) {
    const bottom = op.kind === "baseplate" ? MAGNET_CARRIER_FLOOR : -0.01;
    const pocketHeight = op.magnets.depth + 0.01;
    const cutter = { t: "prim", kind: "cylinder", p: { w: op.magnets.diameter, d: op.magnets.diameter, h: pocketHeight, r: 0, c: 0 }, mods: [] };
    node.mods.push({ id: idFactory("f"), seq: seq(), t: "bool", src: "magnetPockets", op: "cut", tool: group(centers.map(([x, y]) => child(cutter, x, y, bottom))), m: IDENTITY.slice() });
  }
  const referencedSketches = new Set();
  JSON.stringify(node, (key, value) => { if (key === "sketch" && typeof value === "string") referencedSketches.add(value); return value; });
  const sketchSignatures = Object.fromEntries([...referencedSketches].map(id => [id, JSON.stringify(document.sketches.find(sketch => sketch.id === id))]));
  const recipe = { version: 1, ...op, width,depth,topZ, protectedBaseHeight: op.kind === "baseplate" ? 0 : 7, outerRadius: op.kind === "baseplate" ? 4 : 3.75, totalHeight: topZ+(op.lip?4.4:0), pitch:42, heightUnit:7, sourceRevision, referenceFit: "unverified", baseplatePlacementZ:carrierHeight + 0.25,
    ...(op.magnets ? { magnetPockets: { ...op.magnets, count: centers.length, centers, carrierHeight, carrierFloor: op.kind === "baseplate" ? MAGNET_CARRIER_FLOOR : null, opening: op.kind === "baseplate" ? "top" : "bottom" } } : {}), nodeSignature:JSON.stringify(node), sketchSignatures };
  return { node, recipe };
}
