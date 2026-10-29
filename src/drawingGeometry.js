// Hidden-line projections of solids for 2D drawings. Output is view-plane millimetres, y up.
// Each camera: { view, dir (from the model towards the viewer), x (the sheet's right), hidden }.
export const MAX_DRAWING_POINTS = 200000;

export function projectShape(shape, cameras, OC, { hidden = true } = {}) {
  let budget = MAX_DRAWING_POINTS;
  return cameras.map((cam) => {
    const { view } = cam;
    if (![cam.dir, cam.x].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || Math.hypot(...cam.dir) < 1e-9 || Math.hypot(...cam.x) < 1e-9) throw new Error(`Invalid drawing camera for ${view}`);
    const owned = [];
    const keep = (value) => { owned.push(value); return value; };
    try {
      const n = Math.hypot(...cam.dir), m = Math.hypot(...cam.x);
      const ax = keep(new OC.gp_Ax2(keep(new OC.gp_Pnt(0, 0, 0)), keep(new OC.gp_Dir(cam.dir[0] / n, cam.dir[1] / n, cam.dir[2] / n)), keep(new OC.gp_Dir(cam.x[0] / m, cam.x[1] / m, cam.x[2] / m))));
      const algo = keep(new OC.HLRBRep_Algo());
      algo.Add(shape.wrapped, 0);
      algo.Projector(keep(new OC.HLRAlgo_Projector(ax)));
      algo.Update();
      algo.Hide();
      const out = keep(new OC.HLRBRep_HLRToShape(algo));
      const result = { view, visible: [], hidden: [], circles: [], box: null };
      const arcs = new Map();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const collect = (compound, into, visible) => {
        if (compound.IsNull()) return;
        const ex = keep(new OC.TopExp_Explorer(compound, OC.TopAbs_ShapeEnum.TopAbs_EDGE, OC.TopAbs_ShapeEnum.TopAbs_SHAPE));
        for (; ex.More(); ex.Next()) {
          const edge = OC.TopoDS.Edge(ex.Current());
          OC.BRepLib.BuildCurves3d(edge);
          const curve = new OC.BRepAdaptor_Curve(edge);
          try {
            const u0 = curve.FirstParameter(), u1 = curve.LastParameter(), type = curve.GetType();
            const line = type === OC.GeomAbs_CurveType.GeomAbs_Line, circle = type === OC.GeomAbs_CurveType.GeomAbs_Circle;
            let steps = 1;
            if (!line) {
              const a = curve.Value(u0), b = curve.Value((u0 + u1) / 2), c = curve.Value(u1);
              const span = Math.hypot(b.X() - a.X(), b.Y() - a.Y()) + Math.hypot(c.X() - b.X(), c.Y() - b.Y());
              a.delete(); b.delete(); c.delete();
              steps = Math.max(8, Math.min(256, Math.ceil(span / 0.5)));
            }
            if ((budget -= steps + 1) < 0) throw new Error("The drawing is too complex for the projection budget; draw fewer bodies");
            const pts = [];
            for (let i = 0; i <= steps; i++) {
              const p = curve.Value(u0 + ((u1 - u0) * i) / steps), x = p.X(), y = p.Y();
              p.delete();
              pts.push(+x.toFixed(4), +y.toFixed(4));
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            into.push(pts);
            if (circle && visible) {
              const circ = curve.Circle(), loc = circ.Location(), r = circ.Radius();
              const key = `${loc.X().toFixed(3)},${loc.Y().toFixed(3)},${r.toFixed(3)}`;
              const entry = arcs.get(key) || { c: [+loc.X().toFixed(4), +loc.Y().toFixed(4)], r: +r.toFixed(4), span: 0 };
              entry.span += Math.abs(u1 - u0);
              arcs.set(key, entry);
              loc.delete(); circ.delete();
            }
          } finally { curve.delete(); }
        }
      };
      collect(out.VCompound(), result.visible, true);
      collect(out.OutLineVCompound(), result.visible, true);
      collect(out.Rg1LineVCompound(), result.visible, true);
      if (hidden && cam.hidden !== false) {
        collect(out.HCompound(), result.hidden, false);
        collect(out.OutLineHCompound(), result.hidden, false);
      }
      for (const { c, r, span } of arcs.values()) if (span >= 2 * Math.PI - 1e-3) result.circles.push({ c, r });
      if (Number.isFinite(x0)) result.box = [x0, y0, x1, y1].map((v) => +v.toFixed(4));
      return result;
    } finally { for (const value of owned.reverse()) value.delete?.(); }
  });
}
