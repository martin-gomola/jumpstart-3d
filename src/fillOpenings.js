// Fill openings: close the holes, slots and pockets that open onto a flat face.
// Each opening is an inner loop of the face. Its loop becomes a flat face that is
// extruded into the body as deep as the opening's side walls go, then fused.
import * as R from "replicad";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function planeAxes(face, OC) {
  const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const pos = ad.Plane().Position(), x = pos.XDirection(), y = pos.YDirection();
    return [[x.X(), x.Y(), x.Z()], [y.X(), y.Y(), y.Z()]];
  } finally { ad.delete(); }
}

function innerWires(face, OC) {
  const outer = OC.BRepTools.OuterWire(OC.TopoDS.Face(face.wrapped));
  const out = [];
  const ex = new OC.TopExp_Explorer(face.wrapped, OC.TopAbs_ShapeEnum.TopAbs_WIRE, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) if (!ex.Current().IsSame(outer)) out.push(R.cast(OC.TopoDS.Wire(ex.Current())));
  ex.delete();
  return out;
}

function describeLoop(wire, axes, OC) {
  const edges = wire.edges;
  try {
    const pts = [];
    for (const ed of edges) for (let i = 0; i <= 8; i++) pts.push(ed.pointAt(i / 8).toTuple());
    const u = pts.map((p) => dot(p, axes[0])), v = pts.map((p) => dot(p, axes[1]));
    const size = [Math.max(...u) - Math.min(...u), Math.max(...v) - Math.min(...v)];
    const props = new OC.GProp_GProps();
    OC.BRepGProp.LinearProperties(wire.wrapped, props, false, false);
    const g = props.CentreOfMass(), c = [g.X(), g.Y(), g.Z()];
    props.delete();
    const types = edges.map((ed) => ed.geomType);
    const kind = types.every((t) => t === "CIRCLE") ? "round" : types.filter((t) => t === "CIRCLE").length === 2 && types.filter((t) => t === "LINE").length === 2 ? "slot" : "other";
    return { c, kind, size };
  } finally { edges.forEach((ed) => ed.delete()); }
}

// The openings of a flat face, for the picker: centre, shape and size in the face plane.
export function faceOpenings(face, OC) {
  const axes = planeAxes(face, OC);
  const wires = innerWires(face, OC);
  try { return wires.map((w) => describeLoop(w, axes, OC)); } finally { wires.forEach((w) => w.delete()); }
}

// How far the opening's side walls reach into the body below the face: the shallowest
// wall wins, so a stepped hole fills to its first step.
function openingDepth(shape, wire, face, n, OC) {
  const loopEdges = wire.edges;
  const origin = face.center.toTuple();
  let depth = Infinity;
  const faces = shape.faces;
  try {
    for (const f of faces) {
      if (f.wrapped.IsSame(face.wrapped)) continue;
      const fe = f.edges;
      const wall = fe.some((a) => loopEdges.some((b) => a.wrapped.IsSame(b.wrapped)));
      fe.forEach((ed) => ed.delete());
      if (!wall) continue;
      const box = new OC.Bnd_Box();
      OC.BRepBndLib.Add(f.wrapped, box, false);
      const lo = box.CornerMin(), hi = box.CornerMax();
      let reach = 0;
      for (const x of [lo.X(), hi.X()]) for (const y of [lo.Y(), hi.Y()]) for (const z of [lo.Z(), hi.Z()]) reach = Math.max(reach, dot(sub(origin, [x, y, z]), n));
      box.delete();
      depth = Math.min(depth, reach);
    }
  } finally { faces.forEach((f) => f.delete()); loopEdges.forEach((ed) => ed.delete()); }
  return depth;
}

function pickFace(shape, q) {
  const n = unit(q.n);
  const bb = shape.boundingBox, [lo, hi] = bb.bounds;
  bb.delete();
  const diagonal = Math.hypot(...sub(hi, lo));
  const faces = shape.faces;
  let best = null, bd = Infinity;
  for (const f of faces) {
    if (f.geomType !== "PLANE") continue;
    let fn;
    try { fn = unit(f.normalAt().toTuple()); } catch (e) { continue; }
    if (dot(fn, n) < 0.999) continue;
    const d = Math.hypot(...sub(f.center.toTuple(), q.c));
    if (d < bd) { bd = d; best = f; }
  }
  faces.forEach((f) => { if (f !== best) f.delete(); });
  if (!best || bd > Math.max(0.05, diagonal * 0.002)) { best?.delete(); throw new Error("Fill openings: the picked face no longer exists"); }
  return best;
}

export function fillOpenings(shape, mod, OC) {
  const face = pickFace(shape, mod.face);
  const n = unit(mod.face.n);
  const wires = innerWires(face, OC);
  const prisms = [];
  try {
    if (!wires.length) throw new Error("Fill openings: this face has no openings");
    const axes = planeAxes(face, OC);
    const loops = wires.map((w) => ({ w, ...describeLoop(w, axes, OC) }));
    for (const want of mod.loops || []) {
      const tol = Math.max(0.05, 0.25 * Math.min(...(want.size || [1, 1])));
      let hit = null, hd = Infinity;
      for (const l of loops) { const d = Math.hypot(...sub(l.c, want.c)); if (d < hd) { hd = d; hit = l; } }
      if (!hit || hd > tol) throw new Error("Fill openings: an opening no longer exists");
      const walls = openingDepth(shape, hit.w, face, n, OC);
      const depth = Math.min(walls, typeof mod.depth === "number" ? mod.depth : Infinity);
      if (!(depth > 1e-6) || !Number.isFinite(depth)) throw new Error("Fill openings: an opening has no depth to fill");
      const mf = new OC.BRepBuilderAPI_MakeFace(OC.TopoDS.Wire(hit.w.wrapped), true);
      if (!mf.IsDone()) { mf.delete(); throw new Error("Fill openings: an opening's outline isn't closed"); }
      const plug = R.cast(mf.Face());
      mf.delete();
      prisms.push(R.basicFaceExtrusion(plug, new R.Vector(n.map((v) => -v * depth))));
      plug.delete();
    }
  } catch (e) { prisms.forEach((p) => p.delete()); throw e; }
  finally { wires.forEach((w) => w.delete()); face.delete(); }
  if (!prisms.length) return shape;
  let out = shape;
  for (const p of prisms) { const next = out.fuse(p); if (out !== shape) out.delete(); p.delete(); out = next; }
  shape.delete();
  return out;
}
