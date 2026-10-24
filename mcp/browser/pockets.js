import { findRegions, resolveSketch } from "../../src/regions.js";

export const POCKET_LIMITS = Object.freeze({ count: 16, segments: 64, coordinate: 10000, clearance: 10 });
const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const fail = message => { throw new Error(`Pocket: ${message}`); };
const object = (value, label, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} is unsupported`);
  return value;
};
const number = (value, label, min, max = POCKET_LIMITS.coordinate) => {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
  return value;
};
const text = (value, label, max = 80) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must contain 1 to ${max} characters`);
  return value.trim();
};
const pair = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must contain two coordinates`);
  return value.map((v, i) => number(v, `${label}[${i}]`, -POCKET_LIMITS.coordinate));
};
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.000001;
const arcCenter = (a, m, b) => {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-8) fail("contour contains a degenerate arc");
  const aa = a[0] ** 2 + a[1] ** 2, mm = m[0] ** 2 + m[1] ** 2, bb = b[0] ** 2 + b[1] ** 2;
  return [(aa * (m[1] - b[1]) + mm * (b[1] - a[1]) + bb * (a[1] - m[1])) / d,
    (aa * (b[0] - m[0]) + mm * (a[0] - b[0]) + bb * (m[0] - a[0])) / d];
};
const tau = Math.PI * 2;
const angleDistance = (a, b) => (b - a + tau) % tau;

export function normalizePocket(raw, label = "operation") {
  object(raw, label, ["id", "type", "target", "profile", "position", "rotation", "depth", "clearance", "minimumFloor", "minimumWall", "merge", "referenceBodyId", "sourceEvidence"]);
  if (raw.type !== "pocket") fail(`${label}.type must be pocket`);
  const id = text(raw.id, `${label}.id`), target = text(raw.target, `${label}.target`);
  const p = raw.profile;
  if (!p || typeof p !== "object" || Array.isArray(p)) fail(`${label}.profile must be an object`);
  let profile;
  if (p.type === "circle") {
    object(p, `${label}.profile`, ["type", "radius"]);
    profile = { type: p.type, radius: number(p.radius, "radius", 0.01) };
  } else if (p.type === "roundedRect") {
    object(p, `${label}.profile`, ["type", "width", "height", "radius"]);
    const width = number(p.width, "width", 0.02), height = number(p.height, "height", 0.02);
    profile = { type: p.type, width, height, radius: number(p.radius, "radius", 0.01, Math.min(width, height) / 2) };
  } else if (p.type === "capsule") {
    object(p, `${label}.profile`, ["type", "length", "width"]);
    const width = number(p.width, "width", 0.02), length = number(p.length, "length", 0.02);
    if (length <= width) fail("capsule length must exceed width; use a circle for equal dimensions");
    profile = { type: p.type, length, width };
  } else if (p.type === "contour") {
    object(p, `${label}.profile`, ["type", "segments"]);
    if (!Array.isArray(p.segments) || p.segments.length < 2 || p.segments.length > POCKET_LIMITS.segments) fail(`contour must contain 2 to ${POCKET_LIMITS.segments} connected line/arc segments`);
    const segments = p.segments.map((s, i) => {
      object(s, `segments[${i}]`, s?.type === "arc" ? ["type", "start", "through", "end"] : ["type", "start", "end"]);
      if (!["line", "arc"].includes(s.type)) fail("contour supports only line and three-point arc segments");
      const start = pair(s.start, "start"), end = pair(s.end, "end");
      if (near(start, end)) fail("contour contains a zero-length segment");
      if (s.type === "line") return { type: "line", start, end };
      const through = pair(s.through, "through");
      if (near(start, through) || near(through, end)) fail("contour contains a degenerate arc");
      const center = arcCenter(start, through, end);
      number(Math.hypot(start[0] - center[0], start[1] - center[1]), "arc radius", 0.01);
      return { type: "arc", start, through, end };
    });
    if (segments.some((s, i) => !near(s.end, segments[(i + 1) % segments.length].start))) fail("contour must connect and close within 0.000001 mm");
    profile = { type: p.type, segments };
  } else fail("profile type must be circle, roundedRect, capsule or contour");
  if (raw.merge !== undefined && typeof raw.merge !== "boolean") fail("merge must be a boolean");
  let sourceEvidence;
  if (raw.sourceEvidence !== undefined) {
    const e = object(raw.sourceEvidence, "sourceEvidence", ["product", "variant", "url", "units", "kind"]);
    if (!["measured", "manufacturer", "model", "estimate"].includes(e.kind)) fail("sourceEvidence.kind must be measured, manufacturer, model or estimate");
    if (e.units !== undefined && !["mm", "cm", "in"].includes(e.units)) fail("sourceEvidence.units must be mm, cm or in");
    sourceEvidence = { product: text(e.product, "sourceEvidence.product", 160), kind: e.kind, units: e.units || "mm" };
    if (e.variant !== undefined) sourceEvidence.variant = text(e.variant, "sourceEvidence.variant", 160);
    if (e.url !== undefined) {
      sourceEvidence.url = text(e.url, "sourceEvidence.url", 2000);
      let url; try { url = new URL(sourceEvidence.url); } catch { fail("sourceEvidence.url must be an HTTP or HTTPS URL"); }
      if (!["http:", "https:"].includes(url.protocol)) fail("sourceEvidence.url must be an HTTP or HTTPS URL");
    }
  }
  return { type: "pocket", id, target, profile, position: pair(raw.position ?? [0, 0], "position"), rotation: number(raw.rotation ?? 0, "rotation", -360, 360),
    depth: number(raw.depth, "depth", 0.01), clearance: number(raw.clearance, "clearance", 0, POCKET_LIMITS.clearance),
    minimumFloor: number(raw.minimumFloor, "minimumFloor", 0.1), minimumWall: number(raw.minimumWall, "minimumWall", 0.1), merge: raw.merge === true,
    ...(raw.referenceBodyId === undefined ? {} : { referenceBodyId: text(raw.referenceBodyId, "referenceBodyId") }), ...(sourceEvidence ? { sourceEvidence } : {}) };
}

function segmentsFor(profile, clearance) {
  if (profile.type === "contour") return profile.segments;
  const radius = (profile.type === "capsule" ? profile.width / 2 : profile.radius) + clearance;
  const width = (profile.type === "capsule" ? profile.length : profile.width) + 2 * clearance;
  const height = (profile.type === "capsule" ? profile.width : profile.height) + 2 * clearance;
  const x = width / 2 - radius, y = height / 2 - radius;
  const corners = [[x, -y, -Math.PI / 2], [x, y, 0], [-x, y, Math.PI / 2], [-x, -y, Math.PI]];
  const result = [];
  const at = (cx, cy, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  corners.forEach(([cx, cy, angle], i) => {
    const start = at(cx, cy, angle), end = at(cx, cy, angle + Math.PI / 2), through = at(cx, cy, angle + Math.PI / 4);
    result.push({ type: "arc", start, through, end });
    const [nx, ny, na] = corners[(i + 1) % 4], next = at(nx, ny, na);
    if (!near(end, next)) result.push({ type: "line", start: end, end: next });
  });
  return result;
}

function profileBounds(op) {
  const c = Math.cos(op.rotation * Math.PI / 180), s = Math.sin(op.rotation * Math.PI / 180);
  const p = op.profile, gap = op.clearance;
  if (p.type !== "contour") {
    const radius = (p.type === "capsule" ? p.width / 2 : p.radius) + gap;
    const width = p.type === "circle" ? radius * 2 : (p.type === "capsule" ? p.length : p.width) + 2 * gap;
    const height = p.type === "circle" ? radius * 2 : (p.type === "capsule" ? p.width : p.height) + 2 * gap;
    const dx = (width / 2 - radius) * Math.abs(c) + (height / 2 - radius) * Math.abs(s) + radius;
    const dy = (width / 2 - radius) * Math.abs(s) + (height / 2 - radius) * Math.abs(c) + radius;
    return { min: [op.position[0] - dx, op.position[1] - dy], max: [op.position[0] + dx, op.position[1] + dy] };
  }
  const points = [];
  for (const segment of p.segments) {
    points.push(segment.start, segment.end);
    if (segment.type === "arc") {
      const center = arcCenter(segment.start, segment.through, segment.end), r = Math.hypot(segment.start[0] - center[0], segment.start[1] - center[1]);
      const angle = q => Math.atan2(q[1] - center[1], q[0] - center[0]);
      let a = angle(segment.start), b = angle(segment.end);
      if (angleDistance(a, angle(segment.through)) > angleDistance(a, b)) [a, b] = [b, a];
      for (let i = 0; i < 4; i++) {
        const t = i * Math.PI / 2 - op.rotation * Math.PI / 180;
        if (angleDistance(a, t) <= angleDistance(a, b) + 1e-9) points.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
      }
    }
  }
  const transformed = points.map(([x, y]) => [x * c - y * s + op.position[0], x * s + y * c + op.position[1]]);
  return { min: [0, 1].map(axis => Math.min(...transformed.map(p => p[axis])) - gap), max: [0, 1].map(axis => Math.max(...transformed.map(p => p[axis])) + gap) };
}

function makeSketch(op, top, idFactory, seq) {
  const c = Math.cos(op.rotation * Math.PI / 180), s = Math.sin(op.rotation * Math.PI / 180);
  const sk = { id: idFactory("s"), name: `Pocket ${op.id}`, seq, plane: { o: [op.position[0], op.position[1], top], x: [c, s, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: true };
  const point = xy => {
    const previous = sk.pts.find(p => near([p.x, p.y], xy));
    if (previous) return previous.id;
    const id = idFactory("p"); sk.pts.push({ id, x: xy[0], y: xy[1] }); return id;
  };
  if (op.profile.type === "circle") sk.ents.push({ id: idFactory("e"), t: "circle", c: point([0, 0]), r: op.profile.radius + op.clearance });
  else for (const segment of segmentsFor(op.profile, op.clearance)) {
    if (segment.type === "line") sk.ents.push({ id: idFactory("e"), t: "line", a: point(segment.start), b: point(segment.end) });
    else {
      const center = arcCenter(segment.start, segment.through, segment.end), a = Math.atan2(segment.start[1] - center[1], segment.start[0] - center[0]);
      const b = Math.atan2(segment.end[1] - center[1], segment.end[0] - center[0]), m = Math.atan2(segment.through[1] - center[1], segment.through[0] - center[0]);
      const forward = angleDistance(a, m) <= angleDistance(a, b);
      sk.ents.push({ id: idFactory("e"), t: "arc", c: point(center), a: point(forward ? segment.start : segment.end), b: point(forward ? segment.end : segment.start) });
    }
  }
  const regions = findRegions(resolveSketch(sk));
  if (regions.length !== 1 || regions[0].holes?.length) fail("profile must form one simple closed region without holes or self-intersections");
  return { sketch: sk, ref: { key: regions[0].key, pt: regions[0].pt } };
}

export function buildPocket(op, { document, target, idFactory, nextSeq }) {
  if (!target || target.locked) fail("unlock an existing target before creating a pocket");
  const m = target.m || IDENTITY;
  if (!Array.isArray(m) || m.length !== 16 || !m.every(Number.isFinite) || [m[3], m[7], m[11], m[15] - 1].some(v => Math.abs(v) > 1e-8)) fail("target must have a finite rigid placement");
  const axes = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  if (axes.some(a => Math.abs(Math.hypot(...a) - 1) > 1e-8) || [[0,1], [0,2], [1,2]].some(([a,b]) => Math.abs(axes[a].reduce((sum, v, i) => sum + v * axes[b][i], 0)) > 1e-8)) fail("scaled or sheared inserts require regeneration before checking pocket dimensions");
  const base = target.mcpGridfinity;
  if (!base || base.kind !== "insert") fail("target must be a Gridfinity insert blank");
  if (base.nodeSignature !== JSON.stringify(target.node)) fail("insert geometry changed outside its preset; regenerate the insert before checking pocket material");
  const sketchIds = new Set();
  JSON.stringify(target.node, (key, value) => { if (key === "sketch" && typeof value === "string") sketchIds.add(value); return value; });
  for (const id of sketchIds) {
    const sketch = document.sketches.find(sketch => sketch.id === id);
    if (!sketch || base.sketchSignatures?.[id] !== JSON.stringify(sketch)) fail("insert sketch changed outside its preset; regenerate the insert before checking pocket material");
  }
  if (op.referenceBodyId && (op.referenceBodyId === target.id || !document.bodies.some(b => b.id === op.referenceBodyId))) fail("referenceBodyId must identify another existing body");
  const previous = target.mcpPockets || [];
  if (previous.length >= POCKET_LIMITS.count) fail(`at most ${POCKET_LIMITS.count} pockets are supported per insert`);
  if (previous.some(p => p.id === op.id)) fail(`duplicate pocket id ${op.id}`);
  const bottomZ = base.topZ - op.depth;
  if (bottomZ < base.protectedBaseHeight + op.minimumFloor - 1e-7) fail(`depth breaches the protected Gridfinity base or minimum floor; cut bottom must be at least ${base.protectedBaseHeight + op.minimumFloor} mm`);
  const bounds = profileBounds(op), w = base.width / 2 - op.minimumWall, h = base.depth / 2 - op.minimumWall, r = Math.max(0, base.outerRadius - op.minimumWall);
  const inside = (x, y) => w > 0 && h > 0 && Math.hypot(Math.max(0, Math.abs(x) - (w - r)), Math.max(0, Math.abs(y) - (h - r))) <= r + 1e-7 && Math.abs(x) <= w + 1e-7 && Math.abs(y) <= h + 1e-7;
  if ([bounds.min[0], bounds.max[0]].some(x => [bounds.min[1], bounds.max[1]].some(y => !inside(x, y)))) fail("conservative pocket bounds cannot preserve the minimum outer wall; move or resize the pocket");
  for (const other of previous) {
    const gapX = Math.max(0, bounds.min[0] - other.bounds.max[0], other.bounds.min[0] - bounds.max[0]);
    const gapY = Math.max(0, bounds.min[1] - other.bounds.max[1], other.bounds.min[1] - bounds.max[1]);
    if (Math.hypot(gapX, gapY) < Math.max(op.minimumWall, other.minimumWall) - 1e-7) {
      if (!op.merge) fail(`conservative bounds cannot preserve material to pocket ${other.id}; reposition it or explicitly allow merging`);
      if (bottomZ < base.protectedBaseHeight + other.minimumFloor - 1e-7) fail(`merged cut would breach pocket ${other.id}'s minimum floor`);
    }
  }
  const built = makeSketch(op, base.topZ, idFactory, nextSeq());
  const tool = { t: "extrude", sketch: built.sketch.id, profiles: [built.ref], dist: -op.depth, mode: "one", dist2: 0, mods: [], ...(op.profile.type === "contour" && op.clearance ? { profileOffset: op.clearance } : {}) };
  document.sketches.push(built.sketch);
  target.node.mods ||= [];
  target.node.mods.push({ id: idFactory("f"), seq: nextSeq(), t: "bool", op: "cut", src: "pocket", tool, m: IDENTITY.slice() });
  const recipe = { ...structuredClone(op), sketchId: built.sketch.id, bounds, bottomZ,
    materialCheck: { status: "passed", method: "conservative local profile bounds and protected base", floorAboveProtectedBase: bottomZ - base.protectedBaseHeight, minimumWall: op.minimumWall, physicalFit: "unverified" } };
  target.mcpPockets = [...previous, recipe];
  base.nodeSignature = JSON.stringify(target.node);
  base.sketchSignatures = { ...base.sketchSignatures, [built.sketch.id]: JSON.stringify(built.sketch) };
  return recipe;
}
