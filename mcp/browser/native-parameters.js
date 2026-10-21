import { applyParams, evalExpr, paramNameOk, forEachFeatureExpr } from "../../src/params.js";
import { uid } from "../../src/util.js";

const MAX = 10000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}.${key} is not supported`);
  return value;
}
function text(value, label, limit = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${label} must be nonempty text up to ${limit} characters`);
  return value.trim();
}
function expression(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_ .+*/()\-]+$/.test(result)) throw new Error(`${label} contains unsupported expression characters`);
  return result;
}
function size(value, label) {
  if (!Number.isFinite(value) || value < 0.01 || value > MAX) throw new Error(`${label} must evaluate to 0.01 through ${MAX} mm`);
  return value;
}
function recompute(doc) {
  const skipped = applyParams(doc);
  if (skipped) throw new Error(`Native parameter recomputation skipped ${skipped} invalid bindings`);
  for (const p of doc.params) if (!Number.isFinite(p.value) || Math.abs(p.value) > MAX) throw new Error(`Invalid parameter ${p.name}`);
  forEachFeatureExpr(doc, (owner, key) => {
    const value = owner.t === "prim" ? owner.p[key] : owner[key];
    if (!Number.isFinite(value) || Math.abs(value) > MAX) throw new Error(`Invalid bound feature ${key}`);
  });
  for (const sk of doc.sketches || []) {
    for (const p of sk.pts || []) if (![p.x, p.y].every(v => Number.isFinite(v) && Math.abs(v) <= MAX)) throw new Error(`Invalid sketch coordinate in ${sk.id}`);
    for (const c of sk.cons || []) if (c.t === "dim" && c.expr) {
      size(c.v, "Dimension");
      if (c.k === "dist" && ["h", "v"].includes(c.o)) {
        const a = sk.pts.find(p => p.id === c.p1), b = sk.pts.find(p => p.id === c.p2);
        const actual = Math.abs(c.o === "h" ? b.x - a.x : b.y - a.y);
        if (Math.abs(actual - c.v) > 0.001) throw new Error(`Native sketch solver did not satisfy dimension ${c.id}`);
      }
    }
  }
}
function base(document) {
  const doc = structuredClone(document);
  doc.params ||= [];
  if (!Array.isArray(doc.params) || !Array.isArray(doc.sketches) || !Array.isArray(doc.bodies)) throw new Error("Invalid native document");
  if (doc.params.length > 64 || doc.bodies.length > 128 || doc.sketches.length > 128) throw new Error("Native document budget exceeded");
  return doc;
}

export function createNativeParametricModel(document, input) {
  object(input, ["name", "parameters", "rectangle", "extrude"], "model");
  object(input.rectangle, ["id", "widthExpression", "heightExpression", "plane", "origin"], "rectangle");
  object(input.extrude, ["id", "distanceExpression"], "extrude");
  const doc = base(document);
  if (doc.bodies.length || doc.sketches.length) throw new Error("Native parametric creation requires a document with no bodies or sketches");
  doc.mode = "advanced";
  if (!Array.isArray(input.parameters) || !input.parameters.length || input.parameters.length + doc.params.length > 64) throw new Error("parameters must contain 1 through 64 entries within the document budget");
  for (const entry of input.parameters) {
    object(entry, ["name", "expression"], "parameter");
    const name = text(entry.name, "parameter.name", 64);
    const error = paramNameOk(name, doc.params);
    if (error) throw new Error(error);
    doc.params.push({ id: uid("q"), name, expr: expression(entry.expression, "parameter.expression"), unit: "mm", value: 0 });
  }
  if (applyParams(doc) || doc.params.some(p => !Number.isFinite(p.value) || Math.abs(p.value) > MAX)) throw new Error("Invalid native parameter expressions");
  const widthExpression = expression(input.rectangle.widthExpression, "rectangle.widthExpression");
  const heightExpression = expression(input.rectangle.heightExpression, "rectangle.heightExpression");
  const distanceExpression = expression(input.extrude.distanceExpression, "extrude.distanceExpression");
  const w = size(evalExpr(widthExpression, doc.params), "Width");
  const h = size(evalExpr(heightExpression, doc.params), "Height");
  const dist = size(evalExpr(distanceExpression, doc.params), "Extrusion");
  const plane = input.rectangle.plane || "XY";
  if (!["XY", "XZ", "YZ"].includes(plane)) throw new Error("rectangle.plane must be XY, XZ or YZ");
  const origin = input.rectangle.origin || [0, 0, 0];
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(v => Number.isFinite(v) && Math.abs(v) <= MAX)) throw new Error("rectangle.origin must contain three bounded coordinates");
  const sketchName = text(input.rectangle.id, "rectangle.id", 80), bodyName = text(input.extrude.id, "extrude.id", 80);
  const sid = uid("s"), bid = uid("b");
  const sketch = { id: sid, name: sketchName, seq: ++doc.seq, hidden: true,
    plane: { o: [...origin], x: plane === "YZ" ? [0, 1, 0] : [1, 0, 0], n: plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, -1, 0] : [1, 0, 0] },
    pts: [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y], i) => ({id: `p${i}`, x, y})),
    ents: [0, 1, 2, 3].map(i => ({id: `e${i}`, t: "line", a: `p${i}`, b: `p${(i + 1) % 4}`})),
    cons: [{id: "c0", t: "origin", p: "p0"}, ...[0, 1, 2, 3].map(i => ({id: `c${i + 1}`, t: i % 2 ? "vertical" : "horizontal", e1: `e${i}`})),
      {id: "dw", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: w, off: [w / 2, -6], expr: widthExpression, unit: "mm"},
      {id: "dh", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: h, off: [w + 6, h / 2], expr: heightExpression, unit: "mm"}] };
  doc.sketches.push(sketch);
  doc.bodies.push({ id: bid, name: bodyName, seq: ++doc.seq, color: "#3b82c4", hole: false, hidden: false, m: [...IDENTITY], node: {t: "extrude", sketch: sid, profiles: [{key: "e0,e1,e2,e3", pt: [w / 2, h / 2]}], dist, mode: "one", dist2: 0, mods: [], exprs: {dist: distanceExpression}, exprUnits: {dist: "mm"}} });
  if (input.name !== undefined) doc.name = text(input.name, "model.name", 80);
  recompute(doc);
  return { document: doc, createdBodyIds: [bid], affectedBodyIds: [bid], featureBodyIds: {[bodyName]: bid}, plan: {...structuredClone(input), name: doc.name, mode: doc.mode || "advanced"} };
}

export function reviseNativeParameters(document, input) {
  object(input, ["values"], "revision");
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values) || !Object.keys(input.values).length || Object.keys(input.values).length > 64) throw new Error("values must contain 1 through 64 parameter changes");
  const doc = base(document);
  // MCP model-plan expressions are compiled separately and would otherwise become stale.
  if (Object.keys(doc.mcpModels || {}).length) throw new Error("Native parameter revision is unavailable while MCP model-plan metadata exists; use a separate native document");
  for (const [name, value] of Object.entries(input.values)) {
    const parameter = doc.params.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!parameter) throw new Error(`Unknown native parameter ${name}`);
    parameter.expr = expression(typeof value === "number" && Number.isFinite(value) ? String(value) : value, `values.${name}`);
    parameter.unit = "mm";
  }
  recompute(doc);
  // Keep the native profile pick inside a resized four-edge rectangle, including shrink edits.
  for (const body of doc.bodies) {
    const node = body.node;
    if (node.t !== "extrude") continue;
    const sketch = doc.sketches.find(sk => sk.id === node.sketch);
    if (!sketch || !sketch.cons?.some(c => c.id === "c0" && c.t === "origin" && c.p === "p0") ||
      !sketch.cons.some(c => c.id === "dw" && c.t === "dim" && c.o === "h" && c.expr) ||
      !sketch.cons.some(c => c.id === "dh" && c.t === "dim" && c.o === "v" && c.expr) || sketch.pts.length !== 4 || sketch.ents.length !== 4 || !sketch.ents.every(e => e.t === "line")) continue;
    if (sketch.cons.filter(c => c.t === "horizontal" || c.t === "vertical").length !== 4) continue;
    if (sketch.pts.some(p => !["p0", "p1", "p2", "p3"].includes(p.id))) continue;
    const key = sketch.ents.map(e => e.id).sort().join(",");
    for (const profile of node.profiles || []) if (profile.key.split(",").sort().join(",") === key) {
      profile.pt = [sketch.pts.reduce((sum, p) => sum + p.x, 0) / 4, sketch.pts.reduce((sum, p) => sum + p.y, 0) / 4];
    }
  }
  for (const body of document.bodies) if (body.locked || body.lock) {
    const next = doc.bodies.find(b => b.id === body.id);
    if (JSON.stringify(next) !== JSON.stringify(body)) throw new Error(`Native parameter revision would change locked body ${body.id}`);
    // Features may bind sketches recursively, including boolean tools and copied source nodes.
    const sketches = new Set();
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (typeof node.sketch === "string") sketches.add(node.sketch);
      if (node.src) visit(node.src);
      for (const mod of node.mods || []) { visit(mod); if (mod.tool) visit(mod.tool); }
      for (const child of node.children || []) visit(child.node);
    };
    visit(body.node);
    for (const id of sketches) if (JSON.stringify(document.sketches.find(sk => sk.id === id)) !== JSON.stringify(doc.sketches.find(sk => sk.id === id))) throw new Error(`Native parameter revision would change sketch of locked body ${body.id}`);
  }
  const affectedBodyIds = doc.bodies.map(b => b.id);
  return {document: doc, createdBodyIds: [], affectedBodyIds, featureBodyIds: {}, plan: {...structuredClone(input), name: doc.name, mode: doc.mode || "advanced"}};
}
