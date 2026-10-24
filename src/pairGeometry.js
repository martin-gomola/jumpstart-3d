/*!
Adapted from text-to-cad cadgen/geometry.py, commit 2f793659fb7bab537e2f00836e06448fc4087cb2.
MIT License

Copyright (c) 2026 Thompson Labs LLC

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
// Native solid queries only. Expectations and physical-fit decisions belong to the caller.
export const MAX_PAIR_FACES = 2000;

export function validatePairPlacement(m) {
  if (!Array.isArray(m) || m.length !== 16 || !m.every(Number.isFinite)) throw new Error("Pair inspection requires a finite placement matrix");
  if ([m[3], m[7], m[11], m[15] - 1].some((value) => Math.abs(value) > 1e-9)) throw new Error("Perspective pair placements are unsupported");
  const axes = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  const lengths = axes.map((axis) => Math.hypot(...axis));
  if (lengths.some((length) => length < 1e-9 || Math.abs(length - lengths[0]) > lengths[0] * 1e-8)) throw new Error("Nonuniform or singular pair placements are unsupported");
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(axes[a].reduce((sum, value, i) => sum + value * axes[b][i], 0)) > lengths[a] * lengths[b] * 1e-8) throw new Error("Sheared pair placements are unsupported");
}

export function measureSolidPair(left, right, OC, R) {
  const owned = [];
  const keep = (value) => { owned.push(value); return value; };
  const solids = (shape) => {
    const found = [], explorer = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      for (; explorer.More(); explorer.Next()) {
        if (found.length === 1) throw new Error("Pair inspection requires one solid per operand; split disconnected assemblies into separate bodies");
        found.push(keep(R.cast(OC.TopoDS.Solid(explorer.Current()))));
      }
    } finally { explorer.delete(); }
    if (!found.length) throw new Error("Pair inspection requires a nonempty solid");
    return found[0];
  };
  const valid = (shape) => {
    const analyzer = new OC.BRepCheck_Analyzer(shape.wrapped, true, false);
    try { return analyzer.IsValid(); } finally { analyzer.delete(); }
  };
  const faceBudget = (shape) => {
    const explorer = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_FACE, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      let count = 0;
      for (; explorer.More(); explorer.Next()) if (++count > MAX_PAIR_FACES) throw new Error(`Pair operand exceeds the ${MAX_PAIR_FACES}-face inspection limit`);
    } finally { explorer.delete(); }
  };
  try {
    const a = solids(left), b = solids(right);
    for (const shape of [a, b]) {
      faceBudget(shape);
      if (!valid(shape)) throw new Error("Pair operand failed native solid validation");
      const volume = R.measureVolume(shape);
      if (!Number.isFinite(volume) || volume <= 0) throw new Error("Pair operands require positive-volume oriented solids");
    }
    const query = keep(new OC.BRepExtrema_DistShapeShape());
    query.LoadS1(a.wrapped); query.LoadS2(b.wrapped); query.Perform();
    if (!query.IsDone() || query.NbSolution() < 1) throw new Error("Closest-point query did not complete");
    const p = keep(query.PointOnShape1(1)), q = keep(query.PointOnShape2(1));
    const distanceMm = query.Value();
    const witnessPoints = { a: [p.X(), p.Y(), p.Z()], b: [q.X(), q.Y(), q.Z()] };
    if (![distanceMm, ...witnessPoints.a, ...witnessPoints.b].every(Number.isFinite) || distanceMm < 0) throw new Error("Closest-point query returned invalid measurements");

    // Private copies isolate OCCT's boolean preparation from the distance operands and shape cache.
    const copy = (shape) => {
      const identity = keep(new OC.gp_Trsf());
      const copier = keep(new OC.BRepBuilderAPI_Transform(shape.wrapped, identity, true, false));
      if (!copier.IsDone()) throw new Error("Could not copy the pair operand");
      return keep(R.cast(copier.Shape()));
    };
    const ac = copy(a), bc = copy(b);
    const intersection = keep(new OC.BRepAlgoAPI_Common(ac.wrapped, bc.wrapped));
    if (!intersection.IsDone()) throw new Error("Intersection query did not complete");
    const common = keep(R.cast(intersection.Shape()));
    if (!valid(common)) throw new Error("Intersection query returned invalid geometry");
    let overlapVolumeMm3 = 0;
    const explorer = new OC.TopExp_Explorer(common.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      for (; explorer.More(); explorer.Next()) {
        const solid = keep(R.cast(OC.TopoDS.Solid(explorer.Current())));
        const volume = R.measureVolume(solid);
        if (!Number.isFinite(volume) || volume < 0) throw new Error("Intersection query returned an invalid solid volume");
        overlapVolumeMm3 += volume;
      }
    } finally { explorer.delete(); }
    if (!Number.isFinite(overlapVolumeMm3)) throw new Error("Intersection query returned an invalid volume");
    return { status: "measured", distanceMm, witnessPoints, overlapVolumeMm3, source: "native OCCT solid distance and intersection", coordinateSpace: "world", units: { distance: "mm", volume: "mm3" }, physicalFit: "unverified" };
  } finally { for (const value of owned.reverse()) value.delete(); }
}
