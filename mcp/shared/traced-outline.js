// Converts a traced tool outline (Tracefinity tool SVG or tool JSON, or a polygon SVG in
// physical units) into the closed line contour that the Gridfinity pocket operation accepts.
// Pure module: no DOM or file access, so the MCP server and the browser share it.
export const OUTLINE_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, points: 20000, segments: 64, minSegments: 8 });

const UNIT_MM = { mm: 1, cm: 10, in: 25.4 };
const fail = message => { throw new Error(`Outline: ${message}`); };
const finite = (value, label) => { if (!Number.isFinite(value)) fail(`${label} must be a finite number`); return value; };
const round = value => Math.round(value * 10000) / 10000 || 0;

function area(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; sum += x1 * y2 - x2 * y1; }
  return sum / 2;
}

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function cleanRing(points, label) {
  const ring = [];
  for (const point of points) {
    const last = ring.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-6) ring.push(point);
  }
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) <= 1e-6) ring.pop();
  if (ring.length < 3 || Math.abs(area(ring)) < 1e-6) fail(`${label} must enclose an area`);
  return ring;
}

function pointList(text, label) {
  const values = String(text).trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length % 2 || values.some(v => !Number.isFinite(v))) fail(`${label} has malformed coordinates`);
  const points = [];
  for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
  return points;
}

// Absolute and relative M, L, H, V and Z only. Curves would need sampling choices the
// trace already made, so they are rejected with a hint instead.
function pathRings(d) {
  const tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const rings = [];
  let ring = null, x = 0, y = 0, command = null, i = 0;
  const next = () => { const value = Number(tokens[i++]); if (!Number.isFinite(value)) fail("SVG path has malformed coordinates"); return value; };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) fail("SVG path must start with a move command");
    const relative = command === command.toLowerCase(), c = command.toUpperCase();
    if (c === "Z") { if (ring) rings.push(ring); ring = null; command = null; continue; }
    if (!"MLHV".includes(c)) fail("SVG curves are not supported; export the outline as straight-segment polygons (Tracefinity tool SVGs already are)");
    if (c === "M") { if (ring) rings.push(ring); x = next() + (relative ? x : 0); y = next() + (relative ? y : 0); ring = [[x, y]]; command = relative ? "l" : "L"; continue; }
    if (!ring) fail("SVG path must start with a move command");
    if (c === "L") { x = next() + (relative ? x : 0); y = next() + (relative ? y : 0); }
    else if (c === "H") x = next() + (relative ? x : 0);
    else y = next() + (relative ? y : 0);
    ring.push([x, y]);
  }
  if (ring) rings.push(ring);
  return rings;
}

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "s"))?.[2];

function svgScale(root) {
  const width = attribute(root, "width"), viewBox = attribute(root, "viewBox");
  const match = width?.trim().match(/^([\d.]+(?:[eE][-+]?\d+)?)\s*(mm|cm|in)$/);
  if (!match || !viewBox) fail("SVG needs a width in mm, cm or in and a viewBox, so its scale is known");
  const box = viewBox.trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some(v => !Number.isFinite(v)) || box[2] <= 0) fail("SVG viewBox is malformed");
  return (Number(match[1]) * UNIT_MM[match[2]]) / box[2];
}

function parseSvg(text) {
  const root = text.match(/<svg\b[^>]*>/s)?.[0];
  if (!root) fail("file is neither a tool JSON nor an SVG");
  if (/\stransform\s*=/.test(text)) fail("SVG transforms are not supported; flatten transforms before exporting");
  const scale = svgScale(root), rings = [];
  for (const [, kind, attributes] of text.matchAll(/<(polygon|polyline|path)\b([^>]*)>/gs)) {
    if (kind === "path") rings.push(...pathRings(attribute(attributes, "d") ?? ""));
    else rings.push(pointList(attribute(attributes, "points") ?? "", `SVG ${kind}`));
  }
  if (!rings.length) fail("SVG contains no polygon, polyline or path outline");
  // SVG y grows downward; flipping keeps the tool as seen from above in the photo.
  return { rings: rings.map(ring => ring.map(([x, y]) => [x * scale, -y * scale])), fingerHoles: [] };
}

function parseToolJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { fail("tool JSON is malformed"); }
  const tool = data?.tool ?? data;
  if (!Array.isArray(tool?.points)) fail("tool JSON needs a points array in mm");
  const ring = (points, label) => points.map((p, i) => [finite(p?.x, `${label}[${i}].x`), -finite(p?.y, `${label}[${i}].y`)]);
  const rings = [ring(tool.points, "points"), ...(tool.interior_rings || []).map((r, i) => ring(r, `interior_rings[${i}]`))];
  const fingerHoles = (tool.finger_holes || []).map((hole, i) => ({
    shape: hole.shape || "circle", x: finite(hole.x, `finger_holes[${i}].x`), y: -finite(hole.y, `finger_holes[${i}].y`),
    radius: finite(hole.radius ?? 15, `finger_holes[${i}].radius`), width: hole.width ?? null, height: hole.height ?? null, rotation: -(hole.rotation ?? 0),
  }));
  return { name: typeof tool.name === "string" ? tool.name.slice(0, 80) : undefined, rings, fingerHoles };
}

// Returns { name, outer, holes, fingerHoles } in mm with +Y pointing away from the viewer's bottom edge.
export function parseOutline(text, fileName = "outline") {
  if (typeof text !== "string" || !text.trim()) fail("file is empty");
  if (text.length > OUTLINE_LIMITS.bytes) fail(`file is larger than ${OUTLINE_LIMITS.bytes} bytes`);
  const parsed = text.trimStart().startsWith("{") ? parseToolJson(text) : parseSvg(text);
  const rings = parsed.rings.map((ring, i) => cleanRing(ring, i ? `inner outline ${i}` : "outline"));
  if (rings.reduce((sum, ring) => sum + ring.length, 0) > OUTLINE_LIMITS.points) fail(`outline has more than ${OUTLINE_LIMITS.points} points`);
  const order = rings.map((ring, i) => [Math.abs(area(ring)), i]).sort((a, b) => b[0] - a[0]);
  const outer = rings[order[0][1]];
  const holes = order.slice(1).map(([, i]) => rings[i]);
  if (holes.some(hole => !hole.every(point => inside(point, outer)))) fail("file contains separate outlines; keep one tool per file");
  return { name: parsed.name || fileName.replace(/\.[^.]+$/, "").slice(0, 80) || "Traced tool", outer, holes, fingerHoles: parsed.fingerHoles };
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function simplifyChain(points, tolerance) {
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1, worst = tolerance;
    for (let i = first + 1; i < last; i++) { const d = distanceToSegment(points[i], points[first], points[last]); if (d > worst) { worst = d; index = i; } }
    if (index >= 0) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Douglas-Peucker on a closed ring, split at the two mutually distant points so both halves are open chains.
function simplifyRing(ring, tolerance) {
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  const a = simplifyChain(ring.slice(0, far + 1), tolerance), b = simplifyChain([...ring.slice(far), ring[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}

function deviation(original, simplified) {
  let worst = 0;
  for (const point of original) {
    let best = Infinity;
    for (let i = 0; i < simplified.length; i++) best = Math.min(best, distanceToSegment(point, simplified[i], simplified[(i + 1) % simplified.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

function selfIntersects(ring) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
    if (i === 0 && j === ring.length - 1) continue;
    const [a, b, c, d] = [ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length]];
    if (Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 && Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0) return true;
  }
  return false;
}

function fingerHolePocket(hole, center) {
  const position = [round(hole.x - center[0]), round(hole.y - center[1])], rotation = round(hole.rotation);
  if (hole.shape === "circle" || hole.shape === "cylinder") return { profile: { type: "circle", radius: round(hole.radius) }, position, rotation: 0 };
  const width = hole.shape === "square" ? hole.radius * 2 : hole.width, height = hole.shape === "square" ? hole.radius * 2 : hole.height;
  if (!(width > 0 && height > 0)) fail(`finger hole ${hole.shape} needs a width and height`);
  const radius = hole.shape === "filleted_rectangle" ? Math.min(width, height) / 4 : 0.01;
  return { profile: { type: "roundedRect", width: round(width), height: round(height), radius: round(radius) }, position, rotation };
}

// Centres the outline on its bounding box and simplifies it to at most maxSegments lines.
// deviation is the largest distance between the trace and the simplified contour, so the
// pocket clearance must be at least that for the traced tool to fit.
export function outlinePocket(outline, { maxSegments = OUTLINE_LIMITS.segments } = {}) {
  if (!Number.isInteger(maxSegments) || maxSegments < OUTLINE_LIMITS.minSegments || maxSegments > OUTLINE_LIMITS.segments) fail(`maxSegments must be a whole number from ${OUTLINE_LIMITS.minSegments} to ${OUTLINE_LIMITS.segments}`);
  const xs = outline.outer.map(p => p[0]), ys = outline.outer.map(p => p[1]);
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const ring = outline.outer.map(([x, y]) => [x - center[0], y - center[1]]);
  let simplified = ring;
  if (ring.length > maxSegments) {
    let low = 0, high = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    for (let i = 0; i < 40; i++) { const mid = (low + high) / 2; if (simplifyRing(ring, mid).length > maxSegments) low = mid; else high = mid; }
    simplified = simplifyRing(ring, high);
  }
  const points = cleanRing(simplified.map(([x, y]) => [round(x), round(y)]), "simplified outline");
  if (points.length < 3) fail("outline is too small to simplify");
  if (selfIntersects(points)) fail("the simplified outline crosses itself; trace the tool with a smoother outline or allow more segments");
  const segments = points.map((start, i) => ({ type: "line", start, end: points[(i + 1) % points.length] }));
  const error = deviation(ring, points);
  return {
    name: outline.name,
    width: round(Math.max(...xs) - Math.min(...xs)), depth: round(Math.max(...ys) - Math.min(...ys)),
    profile: { type: "contour", segments },
    tracePoints: ring.length, deviation: round(error), minimumClearance: Math.ceil(error * 20) / 20,
    innerOutlinesIgnored: outline.holes.length,
    fingerHoles: outline.fingerHoles.map(hole => fingerHolePocket(hole, center)),
  };
}
