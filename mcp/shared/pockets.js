export const POCKET_LIMITS = Object.freeze({ count: 16, segments: 64, coordinate: 10000, clearance: 10 });
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
export const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.000001;
export const arcCenter = (a, m, b) => {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-8) fail("contour contains a degenerate arc");
  const aa = a[0] ** 2 + a[1] ** 2, mm = m[0] ** 2 + m[1] ** 2, bb = b[0] ** 2 + b[1] ** 2;
  return [(aa * (m[1] - b[1]) + mm * (b[1] - a[1]) + bb * (a[1] - m[1])) / d,
    (aa * (b[0] - m[0]) + mm * (a[0] - b[0]) + bb * (m[0] - a[0])) / d];
};
const tau = Math.PI * 2;
export const angleDistance = (a, b) => (b - a + tau) % tau;

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
