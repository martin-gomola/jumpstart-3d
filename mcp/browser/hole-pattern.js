const add = (a, b) => a.map((value, i) => value + b[i]);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const scale = (a, k) => a.map((value) => value * k);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / (length(a) || 1));
const round = (value) => Math.round(value * 1e4) / 1e4 || 0;
const point = (matrix, p) => [0, 1, 2].map((r) => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r]);
const vector = (matrix, p) => unit([0, 1, 2].map((r) => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2]));
const dirs = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };

function projectedFace(data, face, angle) {
  const [start, count] = data.faceGroups[face];
  const triangles = data.triangles, vertices = data.vertices, info = data.faceInfo[face];
  const position = (index) => [vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]];
  const key = (p) => p.map((value) => Math.round(value * 1e6)).join(",");
  const edgeMap = new Map(), tris = [], lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const n = unit(info.n), c = info.c;
  for (let i = start; i + 2 < start + count; i += 3) {
    const tri = [position(triangles[i]), position(triangles[i + 1]), position(triangles[i + 2])];
    if (tri.some((p) => !p.every(Number.isFinite))) continue;
    tris.push(tri);
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], ka = key(a), kb = key(b), id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = edgeMap.get(id);
      if (edge) edge.count++;
      else edgeMap.set(id, { a, b, count: 1 });
    }
  }
  const edges = [...edgeMap.values()].filter((edge) => edge.count === 1);
  if (!tris.length || !edges.length) throw new Error("The selected face has no usable boundary");

  const baseX = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let U0 = unit(sub(baseX, scale(n, dot(baseX, n))));
  const inPlane = (d) => sub(d, scale(n, dot(d, n)));
  const longest = Math.max(...edges.map(({ a, b }) => length(inPlane(sub(b, a)))));
  if (longest >= 0.1 * length([0, 1, 2].map((i) => Math.max(...tris.flatMap((tri) => tri.map((p) => p[i]))) - Math.min(...tris.flatMap((tri) => tri.map((p) => p[i])))))) {
    let best = null, parallel = -1;
    for (const { a, b } of edges) {
      const d = inPlane(sub(b, a)), l = length(d);
      if (l < longest - 1e-3) continue;
      const score = Math.abs(dot(unit(d), U0));
      if (score > parallel) { parallel = score; best = d; }
    }
    if (best) U0 = unit(best);
  }
  const reference = unit(sub(baseX, scale(n, dot(baseX, n))));
  const along = dot(U0, reference);
  if (along < -1e-9 || (Math.abs(along) <= 1e-9 && dot(U0, cross(n, reference)) < 0)) U0 = scale(U0, -1);
  const V0 = cross(n, U0);
  const th = angle * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const U = add(scale(U0, cs), scale(V0, sn)), V = cross(n, U);
  const uv = (p) => { const d = sub(p, c); return [dot(d, U), dot(d, V)]; };
  const tri2 = tris.map((tri) => tri.map(uv));
  const edge2 = edges.map(({ a, b }) => [uv(a), uv(b)]);
  for (const tri of tri2) for (const [u, v] of tri) { lo[0] = Math.min(lo[0], u); hi[0] = Math.max(hi[0], u); lo[1] = Math.min(lo[1], v); hi[1] = Math.max(hi[1], v); }
  const cu = (lo[0] + hi[0]) / 2, cv = (lo[1] + hi[1]) / 2;
  const inside = (x, y) => tri2.some((tri) => {
    const [[x0, y0], [x1, y1], [x2, y2]] = tri;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) return false;
    const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
    const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
    return a >= -1e-9 && b >= -1e-9 && 1 - a - b >= -1e-9;
  });
  const edgeDistance = (x, y) => Math.min(...edge2.map(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(ax + dx * t - x, ay + dy * t - y);
  }));
  return {
    n, c, U, V, width: hi[0] - lo[0], depth: hi[1] - lo[1],
    toPoint: (a, b) => [0, 1, 2].map((i) => round(c[i] + U[i] * (cu + a) + V[i] * (cv + b))),
    toOffset: (p) => { const d = sub(p, c); return [dot(d, U) - cu, dot(d, V) - cv]; },
    fits: (a, b, radius) => {
      const x = cu + a, y = cv + b;
      return x >= lo[0] - 1e-4 && x <= hi[0] + 1e-4 && y >= lo[1] - 1e-4 && y <= hi[1] + 1e-4 && inside(x, y) && edgeDistance(x, y) >= radius - 1e-4;
    },
  };
}

function findFace(body, data, direction) {
  const d = dirs[direction];
  const found = [];
  for (let i = 0; i < data.faceInfo.length; i++) {
    const info = data.faceInfo[i];
    if (!info || info.t !== "PLANE" || !info.n || !info.c) continue;
    const normal = vector(body.m, info.n);
    if (dot(normal, d) < Math.cos(Math.PI / 180)) continue;
    found.push({ index: i, far: dot(point(body.m, info.c), d) });
  }
  if (!found.length) throw new Error(`Body ${body.id} has no flat face facing ${direction}`);
  const far = Math.max(...found.map((entry) => entry.far));
  const tied = found.filter((entry) => entry.far >= far - 0.01);
  const area = (face) => {
    const [start, count] = data.faceGroups[face], triangles = data.triangles, vertices = data.vertices;
    const at = (index) => [vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]];
    let sum = 0;
    for (let i = start; i + 2 < start + count; i += 3) {
      const [a, b, c] = [at(triangles[i]), at(triangles[i + 1]), at(triangles[i + 2])];
      sum += length(cross(sub(b, a), sub(c, a))) / 2;
    }
    return sum;
  };
  return tied.sort((a, b) => area(b.index) - area(a.index))[0].index;
}

function outerRadius(hole) {
  if (hole.kind === "tapped") return hole.diameter / 2 + 0.5413 * hole.pitch + 2 * Math.min(Math.abs(hole.clearance), 0.3 * hole.pitch);
  return Math.max(hole.diameter, hole.kind === "cbore" ? hole.counterboreDiameter : 0, hole.kind === "csink" ? hole.countersinkDiameter : 0) / 2;
}

function spotsOnFace(frame, layout, radius) {
  const candidates = [];
  let total, px, py;
  if (layout.type === "grid") {
    const columns = layout.stagger ? layout.cols : layout.cols;
    const rowCount = layout.stagger ? Math.ceil(layout.rows / 2) * columns + Math.floor(layout.rows / 2) * Math.max(0, columns - 1) : columns * layout.rows;
    total = rowCount;
    const pitchX = Array.isArray(layout.pitch) ? layout.pitch[0] : layout.pitch;
    const pitchY = Array.isArray(layout.pitch) ? layout.pitch[1] : layout.pitch;
    px = pitchX ?? (layout.cols > 1 ? (frame.width - 2 * (layout.margin + radius)) / (layout.cols - 1) : 0);
    py = pitchY ?? (layout.rows > 1 ? (frame.depth - 2 * (layout.margin + radius)) / (layout.rows - 1) : 0);
    const impossible = px < 0 || py < 0;
    if (!impossible) for (let row = 0; row < layout.rows; row++) {
      const count = layout.stagger && row % 2 ? Math.max(0, layout.cols - 1) : layout.cols;
      for (let col = 0; col < count; col++) candidates.push([(col - (count - 1) / 2) * px, (row - (layout.rows - 1) / 2) * py]);
    }
    if (layout.cols > 1 && px < 2 * radius - 1e-9 || layout.rows > 1 && py < 2 * radius - 1e-9) throw new Error("Hole pattern pitch is smaller than the hole diameter");
    if (impossible) candidates.length = 0;
  } else {
    total = layout.count;
    const [cx, cy] = layout.center ? frame.toOffset(layout.center) : [0, 0];
    for (let i = 0; i < layout.count; i++) {
      const angle = (layout.start + i * 360 / layout.count) * Math.PI / 180;
      candidates.push([cx + layout.radius * Math.cos(angle), cy + layout.radius * Math.sin(angle)]);
    }
    if (2 * layout.radius * Math.sin(Math.PI / layout.count) < 2 * radius - 1e-9) throw new Error("Holes on this circle would overlap; use a larger radius or fewer holes");
  }
  const positions = candidates.filter(([a, b]) => frame.fits(a, b, radius + layout.margin)).map(([a, b]) => ({ p: frame.toPoint(a, b), n: frame.n.slice() }));
  if (!positions.length) throw new Error("No holes fit on the selected face with this layout and margin");
  const limits = { simple: 200, cbore: 130, csink: 130, tapped: 8 };
  if (positions.length > limits[layout.kind]) throw new Error(`Too many ${layout.kind} holes (${positions.length}; limit ${limits[layout.kind]})`);
  return { positions, total, dropped: total - positions.length, pitch: [px, py] };
}

export function buildHolePattern(body, data, pattern) {
  const face = findFace(body, data, pattern.face);
  const frame = projectedFace(data, face, pattern.layout.type === "grid" ? pattern.layout.angle : 0);
  const hole = pattern.hole;
  const layout = spotsOnFace(frame, { ...pattern.layout, kind: hole.kind }, outerRadius(hole));
  const tapped = hole.kind === "tapped";
  return {
    mod: {
      id: pattern.featureId, seq: pattern.seq, t: "hole",
      kind: tapped ? "simple" : hole.kind,
      dia: hole.diameter, through: hole.depth === undefined, depth: hole.depth ?? 10,
      cbDia: hole.counterboreDiameter, cbDepth: hole.counterboreDepth,
      csDia: hole.countersinkDiameter, csAngle: hole.countersinkAngle,
      size: "", tapped, pitch: tapped ? hole.pitch : 0, clear: tapped ? hole.clearance : 0,
      tip: hole.depth !== undefined && hole.tip,
      at: layout.positions,
    },
    faceIndex: face, holes: layout.positions.length, dropped: layout.dropped, total: layout.total,
    fittedPitch: layout.pitch,
  };
}
