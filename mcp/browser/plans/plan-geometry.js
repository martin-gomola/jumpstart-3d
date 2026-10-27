import { fail } from "./plan-input.js";

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function arcCenter(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const aa = a[0] ** 2 + a[1] ** 2, mm = m[0] ** 2 + m[1] ** 2, bb = b[0] ** 2 + b[1] ** 2;
  return [(aa * (m[1] - b[1]) + mm * (b[1] - a[1]) + bb * (a[1] - m[1])) / d, (aa * (b[0] - m[0]) + mm * (a[0] - b[0]) + bb * (m[0] - a[0])) / d];
}

export function planeFor(type, origin) {
  const bases = {
    XY: { x: [1, 0, 0], n: [0, 0, 1] },
    XZ: { x: [1, 0, 0], n: [0, -1, 0] },
    YZ: { x: [0, 1, 0], n: [1, 0, 0] },
  };
  const base = bases[type];
  if (!base) fail("Sketch plane must be XY, XZ, or YZ");
  return { o: origin, x: base.x, n: base.n };
}

export function rotationMatrix(axis, angle, origin) {
  const a = angle * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let r;
  if (axis === "X") r = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0];
  else if (axis === "Y") r = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0];
  else r = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0];
  const [x, y, z] = origin;
  r.push(x - r[0] * x - r[4] * y - r[8] * z, y - r[1] * x - r[5] * y - r[9] * z, z - r[2] * x - r[6] * y - r[10] * z, 1);
  return r;
}

export function matrixMultiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  }
  return out;
}

export function axisRotationMatrix(axis, angle, origin) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const r = [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
  ];
  const [ox, oy, oz] = origin;
  r.push(ox - r[0] * ox - r[4] * oy - r[8] * oz, oy - r[1] * ox - r[5] * oy - r[9] * oz, oz - r[2] * ox - r[6] * oy - r[10] * oz, 1);
  return r;
}

export function pathFrame(type, origin) {
  const bases = {
    XY: { x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
    XZ: { x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] },
    YZ: { x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] },
  };
  const basis = bases[type];
  if (!basis) fail("Path sketch plane must be XY, XZ, or YZ");
  const world = (point) => origin.map((value, i) => value + basis.x[i] * point[0] + basis.y[i] * point[1]);
  return { ...basis, world };
}

export function pathSamples(sketch, count, mode, spacing, direction, anchor) {
  const frame = pathFrame(sketch.plane, sketch.origin);
  const segments = sketch.segments.map((segment) => {
    if (segment.type === "line") {
      const delta = [segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]];
      const length = Math.hypot(...delta);
      const nearestT = (target) => Math.max(0, Math.min(1, ((target[0] - segment.start[0]) * delta[0] + (target[1] - segment.start[1]) * delta[1]) / (length * length)));
      return { length, point: (t) => [segment.start[0] + delta[0] * t, segment.start[1] + delta[1] * t], tangent: () => [delta[0] / length, delta[1] / length], nearestT };
    }
    const center = arcCenter(segment.start, segment.through, segment.end);
    const startAngle = Math.atan2(segment.start[1] - center[1], segment.start[0] - center[0]);
    const throughAngle = Math.atan2(segment.through[1] - center[1], segment.through[0] - center[0]);
    const endAngle = Math.atan2(segment.end[1] - center[1], segment.end[0] - center[0]);
    const positive = (angle) => (angle + Math.PI * 2) % (Math.PI * 2);
    const ccwEnd = positive(endAngle - startAngle), ccwThrough = positive(throughAngle - startAngle);
    const sweep = ccwThrough <= ccwEnd + 1e-9 ? ccwEnd : ccwEnd - Math.PI * 2;
    const radius = Math.hypot(segment.start[0] - center[0], segment.start[1] - center[1]);
    const length = Math.abs(sweep) * radius;
    const nearestT = (target) => {
      const angle = Math.atan2(target[1] - center[1], target[0] - center[0]);
      const delta = sweep >= 0 ? positive(angle - startAngle) : -positive(startAngle - angle);
      if (Math.sign(delta || sweep) === Math.sign(sweep) && Math.abs(delta) <= Math.abs(sweep)) return Math.max(0, Math.min(1, delta / sweep));
      const startDistance = (target[0] - segment.start[0]) ** 2 + (target[1] - segment.start[1]) ** 2;
      const endDistance = (target[0] - segment.end[0]) ** 2 + (target[1] - segment.end[1]) ** 2;
      return startDistance <= endDistance ? 0 : 1;
    };
    return {
      length,
      point: (t) => [center[0] + radius * Math.cos(startAngle + sweep * t), center[1] + radius * Math.sin(startAngle + sweep * t)],
      tangent: (t) => { const angle = startAngle + sweep * t, sign = Math.sign(sweep); return [-Math.sin(angle) * sign, Math.cos(angle) * sign]; },
      nearestT,
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!(total > 0) || !Number.isFinite(total)) fail(`Path ${sketch.id} has no measurable length`);
  const firstLocal = sketch.segments[0].start, lastLocal = sketch.segments.at(-1).end;
  const closed = Math.hypot(firstLocal[0] - lastLocal[0], firstLocal[1] - lastLocal[1]) < 0.001;
  const sample = (distance) => {
    let left = closed ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance));
    let segment = segments.at(-1), t = 1;
    for (const candidate of segments) {
      if (left <= candidate.length + 1e-9) { segment = candidate; t = Math.max(0, Math.min(1, left / candidate.length)); break; }
      left -= candidate.length;
    }
    const local = segment.point(t);
    const localTangent = segment.tangent(t);
    return { point: frame.world(local), tangent: [
      frame.x[0] * localTangent[0] + frame.y[0] * localTangent[1],
      frame.x[1] * localTangent[0] + frame.y[1] * localTangent[1],
      frame.x[2] * localTangent[0] + frame.y[2] * localTangent[1],
    ], local };
  };
  const localAnchor = [
    (anchor[0] - sketch.origin[0]) * frame.x[0] + (anchor[1] - sketch.origin[1]) * frame.x[1] + (anchor[2] - sketch.origin[2]) * frame.x[2],
    (anchor[0] - sketch.origin[0]) * frame.y[0] + (anchor[1] - sketch.origin[1]) * frame.y[1] + (anchor[2] - sketch.origin[2]) * frame.y[2],
  ];
  let anchorDistance = 0, bestDistance = Infinity, prior = 0;
  for (const segment of segments) {
    const bestT = segment.nearestT(localAnchor), point = segment.point(bestT);
    const best = (point[0] - localAnchor[0]) ** 2 + (point[1] - localAnchor[1]) ** 2;
    if (best < bestDistance) { bestDistance = best; anchorDistance = prior + segment.length * bestT; }
    prior += segment.length;
  }
  const reverse = direction === "reverse";
  const travel = closed ? total : reverse ? anchorDistance : total - anchorDistance;
  if (travel < 0.001) fail(`Path pattern ${sketch.id} has no room for another instance in the selected direction`);
  if (mode === "spacing" && (spacing * (count - 1) > travel + 1e-7 || closed && spacing * (count - 1) >= total - 1e-7)) fail(`Path pattern spacing exceeds the available length of path ${sketch.id}`);
  const step = mode === "fit" ? travel / (closed ? count : count - 1) : spacing;
  const sign = reverse ? -1 : 1;
  return Array.from({ length: count }, (_, index) => {
    const station = sample(anchorDistance + sign * step * index);
    if (sign < 0) station.tangent = station.tangent.map((value) => -value);
    return station;
  });
}

export function matrixForTransform(position = [0, 0, 0], rotation = [0, 0, 0]) {
  const [rx, ry, rz] = rotation.map((value) => value * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const x = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const y = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const z = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const out = matrixMultiply(matrixMultiply(x, y), z);
  out[12] = position[0]; out[13] = position[1]; out[14] = position[2];
  return out;
}

export function matrixInverse(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) fail("Cannot combine bodies with a singular transform");
  const q = 1 / det;
  const out = [
    (e * i - f * h) * q, (f * g - d * i) * q, (d * h - e * g) * q, 0,
    (c * h - b * i) * q, (a * i - c * g) * q, (b * g - a * h) * q, 0,
    (b * f - c * e) * q, (c * d - a * f) * q, (a * e - b * d) * q, 0,
    0, 0, 0, 1,
  ];
  for (let row = 0; row < 3; row++) out[12 + row] = -(out[row] * m[12] + out[4 + row] * m[13] + out[8 + row] * m[14]);
  return out;
}
