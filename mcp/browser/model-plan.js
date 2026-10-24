import { clone } from "../../src/util.js";
import { findRegions, resolveSketch } from "../../src/regions.js";
import { createFastener } from "./fasteners.js";
import { BODY_ROLES, bodyRole, combinedRole } from "../../src/bodyRoles.js";

export const MCP_PLAN_LIMITS = {
  sketches: 12,
  features: 24,
  primitives: 64,
  bodies: 128,
  operations: 128,
  profilePoints: 128,
  profileSegments: 64,
  patternCount: 12,
  patternFeatureRefs: 24,
  patternFeatureCopies: 256,
  holePatternPositions: 200,
  coilTurns: 100,
  gearTeeth: 120,
  knurlGrooves: 120,
  pathSegments: 64,
  coordinate: 10000,
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const AXES = new Set(["X", "Y", "Z"]);
const MODES = new Set(["one", "sym", "two"]);
const OPERATIONS = new Set(["new", "join", "cut"]);
const PRIMITIVE_DEFAULTS = {
  box: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  cylinder: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  sphere: { w: 20, d: 20, h: 20 },
  cone: { w: 20, d: 20, h: 20, top: 0 },
  pyramid: { w: 20, d: 20, h: 20, sides: 4 },
  wedge: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  torus: { w: 20, d: 20, h: 4, tube: 4 },
  tube: { w: 20, d: 20, h: 20, wall: 2 },
  hemisphere: { w: 20, d: 20, h: 10 },
  prism: { w: 20, d: 20, h: 20, sides: 6, r: 0, c: 0 },
  text: { text: "TEXT", size: 15, h: 5, font: "sans" },
  star: { w: 20, d: 20, h: 5, points: 5, inner: 0.5 },
  heart: { w: 20, d: 18, h: 6 },
  roof: { w: 20, d: 20, h: 12 },
  roundroof: { w: 20, d: 20, h: 10 },
  paraboloid: { w: 20, d: 20, h: 20 },
  gem: { w: 20, d: 20, h: 20 },
  spring: { w: 20, d: 20, h: 30, turns: 5, wire: 2 },
  capsule: { w: 30, d: 12, h: 12 },
  arrow: { w: 30, d: 20, h: 5 },
};
const PRIMITIVE_ENUMS = { pyramid: { sides: [3, 64] }, prism: { sides: [3, 64] }, star: { points: [3, 64] }, spring: { turns: [1, 100] } };

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function strictObject(value, label, keys) {
  const result = object(value, label);
  const allowed = new Set(keys);
  const unknown = Object.keys(result).find((key) => !allowed.has(key));
  if (unknown) fail(`${label}.${unknown} is not supported`);
  return result;
}

function text(value, label, fallback) {
  const v = value === undefined ? fallback : value;
  if (typeof v !== "string" || !v.trim() || v.length > 80) fail(`${label} must be a non-empty string of at most 80 characters`);
  return v.trim();
}

function number(value, label, { min = -MCP_PLAN_LIMITS.coordinate, max = MCP_PLAN_LIMITS.coordinate } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function pair(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must contain two numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

function triple(value, label) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label} must contain three numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function arcCenter(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const aa = a[0] ** 2 + a[1] ** 2, mm = m[0] ** 2 + m[1] ** 2, bb = b[0] ** 2 + b[1] ** 2;
  return [(aa * (m[1] - b[1]) + mm * (b[1] - a[1]) + bb * (a[1] - m[1])) / d, (aa * (b[0] - m[0]) + mm * (a[0] - b[0]) + bb * (m[0] - a[0])) / d];
}

function sampledContourArea(segments) {
  const points = [];
  const append = (samples) => points.push(...(points.length ? samples.slice(1) : samples));
  for (const segment of segments) {
    if (segment.type === "line") append([segment.start, segment.end]);
    else if (segment.type === "arc") {
      const center = arcCenter(segment.start, segment.through, segment.end);
      const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
      const tau = Math.PI * 2;
      const forward = (angle(segment.through) - angle(segment.start) + tau) % tau <= (angle(segment.end) - angle(segment.start) + tau) % tau + 1e-9;
      const start = angle(segment.start), end = angle(segment.end);
      const sweep = forward ? (end - start + tau) % tau : -((start - end + tau) % tau);
      const radius = Math.hypot(segment.start[0] - center[0], segment.start[1] - center[1]);
      append(Array.from({ length: 17 }, (_, i) => {
        const a = start + sweep * i / 16;
        return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
      }));
    } else {
      const fit = segment.points, closed = !!segment.closed;
      const spans = closed ? fit.length : fit.length - 1;
      const get = (i) => closed ? fit[(i % fit.length + fit.length) % fit.length] : fit[Math.max(0, Math.min(fit.length - 1, i))];
      const samples = [];
      for (let i = 0; i < spans; i++) {
        const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
        for (let j = 0; j < 8; j++) {
          const t = j / 8, t2 = t * t, t3 = t2 * t;
          samples.push([0, 1].map((axis) => 0.5 * ((2 * p1[axis]) + (-p0[axis] + p2[axis]) * t + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3)));
        }
      }
      samples.push(closed ? fit[0] : fit.at(-1));
      append(samples);
    }
  }
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

function segmentsCross(a, b, c, d) {
  const abC = cross2(a, b, c), abD = cross2(a, b, d), cdA = cross2(c, d, a), cdB = cross2(c, d, b);
  return abC * abD < -1e-12 && cdA * cdB < -1e-12;
}

function planeFor(type, origin) {
  const bases = {
    XY: { x: [1, 0, 0], n: [0, 0, 1] },
    XZ: { x: [1, 0, 0], n: [0, -1, 0] },
    YZ: { x: [0, 1, 0], n: [1, 0, 0] },
  };
  const base = bases[type];
  if (!base) fail("Sketch plane must be XY, XZ, or YZ");
  return { o: origin, x: base.x, n: base.n };
}

function newId(prefix) {
  return `${prefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
}

export function normalizeModelPlan(value, existingBodyIds = [], defaultMode) {
  const input = strictObject(value, "plan", ["name", "mode", "sketches", "features", "primitives", "operations", "planes"]);
  const rawSketches = input.sketches ?? [];
  const rawFeatures = input.features ?? [];
  const rawPrimitives = input.primitives ?? [];
  const rawOperations = input.operations ?? [];
  const rawPlanes = input.planes ?? [];
  if (!Array.isArray(rawSketches) || rawSketches.length > MCP_PLAN_LIMITS.sketches) fail(`plan.sketches must contain at most ${MCP_PLAN_LIMITS.sketches} sketches`);
  if (!Array.isArray(rawFeatures) || rawFeatures.length > MCP_PLAN_LIMITS.features) fail(`plan.features must contain at most ${MCP_PLAN_LIMITS.features} features`);
  if (!Array.isArray(rawPrimitives) || rawPrimitives.length > MCP_PLAN_LIMITS.primitives) fail(`plan.primitives must contain at most ${MCP_PLAN_LIMITS.primitives} primitives`);
  if (!Array.isArray(rawOperations) || rawOperations.length > MCP_PLAN_LIMITS.operations) fail(`plan.operations must contain at most ${MCP_PLAN_LIMITS.operations} operations`);
  if (!Array.isArray(rawPlanes) || rawPlanes.length > 8) fail("plan.planes must contain at most 8 construction planes");
  if (!rawPrimitives.length && !rawFeatures.length && !rawOperations.length) fail("plan must contain a primitive, feature, or body operation");

  const sketchIds = new Set();
  const sketches = rawSketches.map((raw, i) => {
    const sketch = strictObject(raw, `sketches[${i}]`, ["id", "name", "plane", "origin", "profile", "segments"]);
    const id = text(sketch.id, `sketches[${i}].id`);
    if (sketchIds.has(id)) fail(`Duplicate sketch id: ${id}`);
    sketchIds.add(id);
    const plane = text(sketch.plane, `sketches[${i}].plane`).toUpperCase();
    if (!Array.isArray(sketch.origin)) fail(`sketches[${i}].origin must be a 3D coordinate`);
    const origin = triple(sketch.origin, `sketches[${i}].origin`);
    const isPath = sketch.segments !== undefined;
    if (isPath === (sketch.profile !== undefined)) fail(`sketches[${i}] must define exactly one of profile or segments`);
    let normalizedProfile;
    let segments;
    if (isPath) {
      if (!Array.isArray(sketch.segments) || sketch.segments.length < 1 || sketch.segments.length > MCP_PLAN_LIMITS.pathSegments) fail(`sketches[${i}].segments must contain 1 to ${MCP_PLAN_LIMITS.pathSegments} ordered path segments`);
      const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
      segments = sketch.segments.map((rawSegment, j) => {
        const label = `sketches[${i}].segments[${j}]`;
        const segment = object(rawSegment, label);
        if (segment.type === "line") {
          strictObject(segment, label, ["type", "start", "end"]);
          const start = pair(segment.start, `${label}.start`), end = pair(segment.end, `${label}.end`);
          if (samePoint(start, end)) fail(`${label} has zero length`);
          return { type: "line", start, end };
        }
        if (segment.type === "arc") {
          strictObject(segment, label, ["type", "start", "through", "end"]);
          const start = pair(segment.start, `${label}.start`), through = pair(segment.through, `${label}.through`), end = pair(segment.end, `${label}.end`);
          const twiceArea = Math.abs(cross2(start, through, end));
          if (samePoint(start, end) || samePoint(start, through) || samePoint(through, end) || twiceArea < 0.000001) fail(`${label} is a degenerate arc`);
          const center = arcCenter(start, through, end);
          const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
          if (!Number.isFinite(radius) || radius < 0.001 || radius > MCP_PLAN_LIMITS.coordinate) fail(`${label} has an invalid radius`);
          return { type: "arc", start, through, end };
        }
        fail(`${label}.type must be line or arc`);
      });
      for (let j = 1; j < segments.length; j++) if (!samePoint(segments[j - 1].end, segments[j].start)) fail(`sketches[${i}].segments must be connected in order`);
    } else {
      const profile = object(sketch.profile, `sketches[${i}].profile`);
      if (profile.type === "circle") {
        strictObject(profile, `sketches[${i}].profile`, ["type", "center", "radius"]);
        normalizedProfile = {
          type: "circle",
          center: pair(profile.center, `sketches[${i}].profile.center`),
          radius: number(profile.radius, `sketches[${i}].profile.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
        };
      } else if (profile.type === "polygon") {
        strictObject(profile, `sketches[${i}].profile`, ["type", "points"]);
        if (!Array.isArray(profile.points) || profile.points.length < 3 || profile.points.length > MCP_PLAN_LIMITS.profilePoints) {
          fail(`sketches[${i}].profile.points must contain 3 to ${MCP_PLAN_LIMITS.profilePoints} points`);
        }
        const points = profile.points.map((p, j) => pair(p, `sketches[${i}].profile.points[${j}]`));
        let area = 0;
        for (let j = 0; j < points.length; j++) {
          const a = points[j], b = points[(j + 1) % points.length];
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001) fail(`sketches[${i}].profile has a zero-length edge`);
          area += a[0] * b[1] - b[0] * a[1];
        }
        if (Math.abs(area) < 0.002) fail(`sketches[${i}].profile has zero area`);
        for (let a = 0; a < points.length; a++) {
          for (let b = a + 1; b < points.length; b++) {
            if (b === a + 1 || (a === 0 && b === points.length - 1)) continue;
            if (segmentsCross(points[a], points[(a + 1) % points.length], points[b], points[(b + 1) % points.length])) {
              fail(`sketches[${i}].profile self-intersects`);
            }
          }
        }
        normalizedProfile = { type: "polygon", points };
      } else if (profile.type === "roundedRect") {
        strictObject(profile, `sketches[${i}].profile`, ["type", "width", "height", "radius", "center"]);
        const width = number(profile.width, `sketches[${i}].profile.width`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        const height = number(profile.height, `sketches[${i}].profile.height`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        const radius = number(profile.radius, `sketches[${i}].profile.radius`, { min: 0.001, max: Math.min(width, height) / 2 });
        normalizedProfile = { type: "roundedRect", width, height, radius, center: profile.center === undefined ? [0, 0] : pair(profile.center, `sketches[${i}].profile.center`) };
      } else if (profile.type === "contour") {
        strictObject(profile, `sketches[${i}].profile`, ["type", "segments"]);
        if (!Array.isArray(profile.segments) || profile.segments.length < 1 || profile.segments.length > MCP_PLAN_LIMITS.profileSegments) {
          fail(`sketches[${i}].profile.segments must contain 1 to ${MCP_PLAN_LIMITS.profileSegments} ordered contour segments`);
        }
        let pointCount = 0;
        const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
        const contourSegments = profile.segments.map((rawSegment, j) => {
          const label = `sketches[${i}].profile.segments[${j}]`;
          const segment = object(rawSegment, label);
          if (segment.type === "line") {
            strictObject(segment, label, ["type", "start", "end"]);
            const start = pair(segment.start, `${label}.start`), end = pair(segment.end, `${label}.end`);
            pointCount += 2;
            if (samePoint(start, end)) fail(`${label} has zero length`);
            return { type: "line", start, end };
          }
          if (segment.type === "arc") {
            strictObject(segment, label, ["type", "start", "through", "end"]);
            const start = pair(segment.start, `${label}.start`), through = pair(segment.through, `${label}.through`), end = pair(segment.end, `${label}.end`);
            pointCount += 3;
            const twiceArea = Math.abs(cross2(start, through, end));
            if (samePoint(start, end) || samePoint(start, through) || samePoint(through, end) || twiceArea < 0.000001) fail(`${label} is a degenerate arc`);
            const center = arcCenter(start, through, end);
            const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
            if (!Number.isFinite(radius) || radius < 0.001 || radius > MCP_PLAN_LIMITS.coordinate) fail(`${label} has an invalid radius`);
            return { type: "arc", start, through, end };
          }
          if (segment.type === "spline") {
            strictObject(segment, label, ["type", "points", "closed"]);
            if (segment.closed !== undefined && typeof segment.closed !== "boolean") fail(`${label}.closed must be a boolean`);
            if (!Array.isArray(segment.points) || segment.points.length < 3 || segment.points.length > MCP_PLAN_LIMITS.profilePoints) {
              fail(`${label}.points must contain 3 to ${MCP_PLAN_LIMITS.profilePoints} fit points`);
            }
            const points = segment.points.map((point, k) => pair(point, `${label}.points[${k}]`));
            pointCount += points.length;
            for (let k = 1; k < points.length; k++) if (samePoint(points[k - 1], points[k])) fail(`${label} has consecutive duplicate fit points`);
            if (new Set(points.map((point) => point.map((value) => Math.round(value * 1000)).join(","))).size < 3) fail(`${label} is degenerate`);
            return { type: "spline", points, ...(segment.closed === undefined ? {} : { closed: segment.closed }) };
          }
          fail(`${label}.type must be line, arc, or spline`);
        });
        if (pointCount > MCP_PLAN_LIMITS.profilePoints) fail(`sketches[${i}].profile may contain at most ${MCP_PLAN_LIMITS.profilePoints} fit and segment points`);
        const closedSplines = contourSegments.filter((segment) => segment.type === "spline" && segment.closed);
        if (closedSplines.length && (contourSegments.length !== 1 || closedSplines.length !== 1)) fail(`sketches[${i}].profile a closed spline must be the only contour segment`);
        if (contourSegments.length === 1 && contourSegments[0].type === "spline" && !contourSegments[0].closed) fail(`sketches[${i}].profile needs a closed contour`);
        if (!closedSplines.length) {
          const endpoints = (segment) => segment.type === "spline" ? [segment.points[0], segment.points.at(-1)] : [segment.start, segment.end];
          for (let j = 0; j < contourSegments.length; j++) {
            const [, end] = endpoints(contourSegments[j]);
            const [start] = endpoints(contourSegments[(j + 1) % contourSegments.length]);
            if (!samePoint(end, start)) fail(`sketches[${i}].profile.segments must connect in order and close`);
          }
        }
        if (sampledContourArea(contourSegments) < 0.001) fail(`sketches[${i}].profile has zero area`);
        normalizedProfile = { type: "contour", segments: contourSegments };
      } else {
        fail(`sketches[${i}].profile.type must be circle, polygon, roundedRect, or contour`);
      }
    }
    return { id, name: text(sketch.name, `sketches[${i}].name`, id), plane, origin, ...(isPath ? { segments } : { profile: normalizedProfile }) };
  });

  const primitives = rawPrimitives.map(normalizePrimitive);
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  if (primitiveIds.size !== primitives.length) fail("Primitive ids must be unique");
  const planes = rawPlanes.map((raw, i) => {
    const plane = strictObject(raw, `planes[${i}]`, ["id", "name", "plane", "origin"]);
    const type = text(plane.plane, `planes[${i}].plane`).toUpperCase();
    if (!["XY", "XZ", "YZ"].includes(type)) fail(`planes[${i}].plane must be XY, XZ, or YZ`);
    return { id: text(plane.id, `planes[${i}].id`), name: text(plane.name, `planes[${i}].name`, `Construction plane ${i + 1}`), plane: type, origin: triple(plane.origin ?? [0, 0, 0], `planes[${i}].origin`) };
  });
  if (new Set(planes.map((plane) => plane.id)).size !== planes.length) fail("Construction plane ids must be unique");

  const featureIds = new Set();
  const features = rawFeatures.map((raw, i) => {
    const feature = strictObject(raw, `features[${i}]`, ["id", "name", "type", "sketch", "path", "sections", "operation", "target", "axis", "angle", "distance", "mode", "distance2", "pattern", "ruled", "closed", "section", "size", "hollow", "wall", "d", "turns", "h", "pitch", "pos", "left", "position", "rotation"]);
    const id = text(feature.id, `features[${i}].id`);
    if (featureIds.has(id) || primitiveIds.has(id)) fail(`Duplicate model id: ${id}`);
    featureIds.add(id);
    const type = text(feature.type, `features[${i}].type`);
    if (!["revolve", "extrude", "loft", "sweep", "pipe", "coil"].includes(type)) fail(`features[${i}].type must be revolve, extrude, loft, sweep, pipe, or coil`);
    const sketch = feature.sketch === undefined ? undefined : text(feature.sketch, `features[${i}].sketch`);
    const path = feature.path === undefined ? undefined : text(feature.path, `features[${i}].path`);
    const sections = type === "loft" ? feature.sections : undefined;
    if (type === "coil") {
      if (feature.sketch !== undefined || feature.path !== undefined || feature.sections !== undefined) fail(`features[${i}] coil does not use sketches or paths`);
    } else if (type === "loft") {
      if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12 || sections.some((id) => typeof id !== "string" || !sketchIds.has(id))) {
        fail(`features[${i}].sections must reference 2 to 12 earlier sketches`);
      }
    } else if (type === "pipe") {
      if (!path || !sketchIds.has(path)) fail(`features[${i}].path must reference an earlier path sketch`);
      if (feature.sketch !== undefined) fail(`features[${i}].sketch is not supported for pipe`);
    } else {
      if (!sketch || !sketchIds.has(sketch)) fail(`features[${i}] references an unknown sketch`);
      if (type === "sweep" && (!path || !sketchIds.has(path))) fail(`features[${i}].path must reference an earlier path sketch`);
      if (type !== "sweep" && feature.path !== undefined) fail(`features[${i}].path is only supported for sweep or pipe`);
    }
    if (sketch && !rawSketches.find((entry) => entry.id === sketch)?.profile) fail(`features[${i}].sketch must reference a closed profile sketch`);
    if (path && !rawSketches.find((entry) => entry.id === path)?.segments) fail(`features[${i}].path must reference a path sketch`);
    if (type === "sweep" && sketch === path) fail(`features[${i}] profile and path must use different sketches`);
    const operation = text(feature.operation, `features[${i}].operation`, "new");
    if (!OPERATIONS.has(operation)) fail(`features[${i}].operation must be new, join, or cut`);
    const target = feature.target === undefined ? undefined : text(feature.target, `features[${i}].target`);
    if (operation !== "new" && !target) fail(`features[${i}].target is required for ${operation}`);
    if (operation === "new" && target) fail(`features[${i}].target is only valid for join or cut`);

    const out = {
      id,
      name: text(feature.name, `features[${i}].name`, id),
      type,
      operation,
      ...(target ? { target } : {}),
      ...(sketch ? { sketch } : {}),
      ...(path ? { path } : {}),
      ...(sections ? { sections: sections.slice() } : {}),
    };
    if (type === "revolve") {
      const axis = text(feature.axis, `features[${i}].axis`, "Z").toUpperCase();
      if (!AXES.has(axis)) fail(`features[${i}].axis must be X, Y, or Z`);
      out.axis = axis;
      out.angle = number(feature.angle ?? 360, `features[${i}].angle`, { min: 1, max: 360 });
    } else if (type === "extrude") {
      out.distance = number(feature.distance, `features[${i}].distance`, { min: -MCP_PLAN_LIMITS.coordinate, max: MCP_PLAN_LIMITS.coordinate });
      if (Math.abs(out.distance) < 0.001) fail(`features[${i}].distance must not be zero`);
      out.mode = text(feature.mode, `features[${i}].mode`, "one");
      if (!MODES.has(out.mode)) fail(`features[${i}].mode must be one, sym, or two`);
      if (out.mode === "two") out.distance2 = number(feature.distance2, `features[${i}].distance2`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
    } else if (type === "loft") {
      if (feature.ruled !== undefined && typeof feature.ruled !== "boolean") fail(`features[${i}].ruled must be a boolean`);
      if (feature.closed !== undefined && typeof feature.closed !== "boolean") fail(`features[${i}].closed must be a boolean`);
      out.ruled = feature.ruled === true;
      out.closed = feature.closed === true;
    } else if (type === "sweep") {
      out.orient = "perp";
    } else if (type === "pipe") {
      const section = text(feature.section, `features[${i}].section`, "circle").toLowerCase();
      if (!["circle", "square", "triangle"].includes(section)) fail(`features[${i}].section must be circle, square, or triangle`);
      out.section = section;
      out.size = number(feature.size, `features[${i}].size`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
      if (feature.hollow !== undefined && typeof feature.hollow !== "boolean") fail(`features[${i}].hollow must be a boolean`);
      out.hollow = feature.hollow === true;
      if (feature.wall !== undefined || out.hollow) {
        out.wall = number(feature.wall ?? 1, `features[${i}].wall`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        if (out.hollow && out.size - 2 * out.wall <= 0.01) fail(`features[${i}].wall is too thick for the pipe size`);
      }
    } else if (type === "coil") {
      const d = number(feature.d ?? 20, `features[${i}].d`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
      const turns = number(feature.turns ?? 5, `features[${i}].turns`, { min: 0.25, max: MCP_PLAN_LIMITS.coilTurns });
      const mode = text(feature.mode, `features[${i}].mode`, "height");
      if (!new Set(["height", "pitch"]).has(mode)) fail(`features[${i}].mode must be height or pitch for coil`);
      if ((mode === "height" && feature.pitch !== undefined) || (mode === "pitch" && feature.h !== undefined)) fail(`features[${i}] coil must supply only h in height mode or pitch in pitch mode`);
      const angle = number(feature.angle ?? 0, `features[${i}].angle`, { min: -60, max: 60 });
      const section = text(feature.section, `features[${i}].section`, "circle").toLowerCase();
      if (!["circle", "square", "triangle", "triangle-in"].includes(section)) fail(`features[${i}].section must be circle, square, triangle, or triangle-in`);
      const size = number(feature.size ?? 2, `features[${i}].size`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate });
      const pos = text(feature.pos, `features[${i}].pos`, "on");
      if (!["inside", "on", "outside"].includes(pos)) fail(`features[${i}].pos must be inside, on, or outside`);
      if (feature.left !== undefined && typeof feature.left !== "boolean") fail(`features[${i}].left must be a boolean`);
      const h = mode === "height" ? number(feature.h ?? 20, `features[${i}].h`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
      const pitch = mode === "pitch" ? number(feature.pitch ?? 4, `features[${i}].pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
      const actualPitch = mode === "pitch" ? pitch : (h - size) / turns;
      if (actualPitch < size * 1.01) fail(`features[${i}] coil turns overlap: pitch or height must provide at least 1.01 times the section size per turn`);
      const radius = d / 2 + (pos === "inside" ? -size / 2 : pos === "outside" ? size / 2 : 0);
      const coilHeight = actualPitch * turns;
      const endRadius = radius + coilHeight * Math.tan(angle * Math.PI / 180);
      if (radius - size / 2 <= 0.01 || endRadius - size / 2 <= 0.01) fail(`features[${i}] coil taper collapses the end radius; increase diameter, reduce section size, or use a gentler taper`);
      out.d = d; out.turns = turns; out.mode = mode; out.angle = angle; out.section = section; out.size = size; out.pos = pos; out.left = feature.left === true;
      if (h !== undefined) out.h = h;
      if (pitch !== undefined) out.pitch = pitch;
      out.position = triple(feature.position ?? [0, 0, 0], `features[${i}].position`);
      out.rotation = triple(feature.rotation ?? [0, 0, 0], `features[${i}].rotation`).map((v, axis) => number(v, `features[${i}].rotation[${axis}]`, { min: -360, max: 360 }));
    }

    if (feature.pattern !== undefined) {
      const pattern = strictObject(feature.pattern, `features[${i}].pattern`, ["axis", "count", "angle", "origin"]);
      const axis = text(pattern.axis, `features[${i}].pattern.axis`).toUpperCase();
      if (!AXES.has(axis)) fail(`features[${i}].pattern.axis must be X, Y, or Z`);
      const count = number(pattern.count, `features[${i}].pattern.count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`features[${i}].pattern.count must be an integer`);
      out.pattern = {
        axis,
        count,
        angle: number(pattern.angle ?? 360, `features[${i}].pattern.angle`, { min: 1, max: 360 }),
        origin: triple(pattern.origin ?? [0, 0, 0], `features[${i}].pattern.origin`),
      };
    }
    return out;
  });

  const seenFeatures = new Set([...existingBodyIds, ...primitiveIds]);
  for (const feature of features) {
    if (feature.target && !seenFeatures.has(feature.target)) fail(`Feature ${feature.id} must target an earlier body`);
    if (feature.operation === "new") seenFeatures.add(feature.id);
  }
  const operations = rawOperations.map((raw, i) => {
    const operation = object(raw, `operations[${i}]`);
    const type = text(operation.type, `operations[${i}].type`);
    const id = text(operation.id, `operations[${i}].id`);
    if (featureIds.has(id) || primitiveIds.has(id)) fail(`Duplicate model id: ${id}`);
    if (type === "phoneCradle") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "name", "width", "phoneLength", "angle", "plateThickness", "ribThickness", "stopHeight", "stopDepth", "topEdgeToward", "position"]);
      const width = number(operation.width, `operations[${i}].width`, { min: 30, max: 500 });
      const phoneLength = number(operation.phoneLength, `operations[${i}].phoneLength`, { min: 30, max: 300 });
      const angle = number(operation.angle, `operations[${i}].angle`, { min: 10, max: 70 });
      const plateThickness = number(operation.plateThickness, `operations[${i}].plateThickness`, { min: 1, max: 10 });
      const ribThickness = number(operation.ribThickness, `operations[${i}].ribThickness`, { min: 2, max: 30 });
      if (ribThickness * 2 >= width) fail(`operations[${i}].ribThickness must leave room between the two ribs`);
      const stopHeight = number(operation.stopHeight, `operations[${i}].stopHeight`, { min: 3, max: 40 });
      const stopDepth = number(operation.stopDepth, `operations[${i}].stopDepth`, { min: 2, max: 20 });
      const topEdgeToward = text(operation.topEdgeToward, `operations[${i}].topEdgeToward`).toUpperCase();
      if (!["+Y", "-Y"].includes(topEdgeToward)) fail(`operations[${i}].topEdgeToward must be +Y (toward dashboard) or -Y (toward driver)`);
      const position = triple(operation.position, `operations[${i}].position`);
      const run = phoneLength * Math.cos(angle * Math.PI / 180);
      const rise = phoneLength * Math.sin(angle * Math.PI / 180);
      if (run < 10 || rise < 5) fail(`operations[${i}] cradle angle and phoneLength produce an unusable support footprint`);
      return { type, id, name: text(operation.name, `operations[${i}].name`, "Angled phone cradle"), width, phoneLength, angle, plateThickness, ribThickness, stopHeight, stopDepth, topEdgeToward, position, run, rise };
    }
    if (type === "group") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "name", "members", "operation"]);
      if (!Array.isArray(operation.members) || operation.members.length < 1 || operation.members.length > MCP_PLAN_LIMITS.primitives) fail(`operations[${i}].members must contain 1 to ${MCP_PLAN_LIMITS.primitives} body ids`);
      if (new Set(operation.members).size !== operation.members.length) fail(`operations[${i}].members must not contain duplicates`);
      const op = operation.operation ?? "union";
      if (!["union", "cut", "intersect"].includes(op)) fail(`operations[${i}].operation must be union, cut, or intersect`);
      return { type, id, name: text(operation.name, `operations[${i}].name`, id), members: operation.members.map((member) => text(member, `operations[${i}].members`)), operation: op };
    }
    if (type === "mirror") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "source", "plane", "behavior"]);
      const plane = strictObject(operation.plane, `operations[${i}].plane`, ["origin", "normal"]);
      const normal = triple(plane.normal, `operations[${i}].plane.normal`);
      const length = Math.hypot(...normal);
      if (length < 1e-12) fail(`operations[${i}].plane.normal must not be zero`);
      const behavior = text(operation.behavior, `operations[${i}].behavior`, "linked");
      if (!["linked", "join"].includes(behavior)) fail(`operations[${i}].behavior must be linked or join`);
      return { type, id, source: text(operation.source, `operations[${i}].source`), plane: { o: triple(plane.origin ?? [0, 0, 0], `operations[${i}].plane.origin`), n: normal.map((value) => value / length) }, behavior };
    }
    if (type === "splitBody") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "plane"]);
      const plane = strictObject(operation.plane, `operations[${i}].plane`, ["origin", "normal"]);
      const normal = triple(plane.normal, `operations[${i}].plane.normal`);
      const length = Math.hypot(...normal);
      if (length < 1e-12) fail(`operations[${i}].plane.normal must not be zero`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), plane: { o: triple(plane.origin, `operations[${i}].plane.origin`), n: normal.map((value) => value / length) } };
    }
    if (type === "pattern") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "source", "mode", "axis", "count", "spacing", "symmetric", "angle", "origin"]);
      const mode = text(operation.mode, `operations[${i}].mode`);
      if (!["linear", "circular"].includes(mode)) fail(`operations[${i}].mode must be linear or circular`);
      if (operation.symmetric !== undefined && typeof operation.symmetric !== "boolean") fail(`operations[${i}].symmetric must be a boolean`);
      const axis = text(operation.axis, `operations[${i}].axis`).toUpperCase();
      if (!AXES.has(axis)) fail(`operations[${i}].axis must be X, Y, or Z`);
      const count = number(operation.count, `operations[${i}].count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`operations[${i}].count must be an integer`);
      return { type, id, source: text(operation.source, `operations[${i}].source`), mode, axis, count,
        ...(mode === "linear" ? { spacing: number(operation.spacing, `operations[${i}].spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), symmetric: operation.symmetric === true } : { angle: number(operation.angle ?? 360, `operations[${i}].angle`, { min: 1, max: 360 }), origin: triple(operation.origin ?? [0, 0, 0], `operations[${i}].origin`) }) };
    }
    if (type === "pathPattern") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "source", "path", "mode", "count", "spacing", "direction", "orientation", "anchor"]);
      const mode = text(operation.mode, `operations[${i}].mode`, "fit");
      if (!["fit", "spacing"].includes(mode)) fail(`operations[${i}].mode must be fit or spacing`);
      const count = number(operation.count, `operations[${i}].count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`operations[${i}].count must be an integer`);
      if (mode === "fit" && operation.spacing !== undefined) fail(`operations[${i}].spacing is only supported in spacing mode`);
      if (mode === "spacing" && operation.spacing === undefined) fail(`operations[${i}].spacing is required in spacing mode`);
      const direction = text(operation.direction, `operations[${i}].direction`, "forward");
      if (!["forward", "reverse"].includes(direction)) fail(`operations[${i}].direction must be forward or reverse`);
      const orientation = text(operation.orientation, `operations[${i}].orientation`, "same");
      if (!["same", "follow-path"].includes(orientation)) fail(`operations[${i}].orientation must be same or follow-path`);
      const path = text(operation.path, `operations[${i}].path`);
      if (!sketches.some((sketch) => sketch.id === path && sketch.segments)) fail(`operations[${i}].path must reference an earlier path sketch`);
      return { type, id, source: text(operation.source, `operations[${i}].source`), path, mode, count,
        ...(mode === "spacing" ? { spacing: number(operation.spacing, `operations[${i}].spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }) } : {}), direction, orientation,
        ...(operation.anchor === undefined ? {} : { anchor: triple(operation.anchor, `operations[${i}].anchor`) }) };
    }
    if (type === "featurePattern") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "features", "mode", "axis", "count", "spacing", "symmetric", "angle", "origin"]);
      const mode = text(operation.mode, `operations[${i}].mode`);
      if (!["linear", "circular"].includes(mode)) fail(`operations[${i}].mode must be linear or circular`);
      if (!Array.isArray(operation.features) || operation.features.length < 1 || operation.features.length > MCP_PLAN_LIMITS.patternFeatureRefs) fail(`operations[${i}].features must contain 1 to ${MCP_PLAN_LIMITS.patternFeatureRefs} stable feature references`);
      const features = operation.features.map((feature, j) => text(feature, `operations[${i}].features[${j}]`));
      if (new Set(features).size !== features.length) fail(`operations[${i}].features must not contain duplicates`);
      if (operation.symmetric !== undefined && typeof operation.symmetric !== "boolean") fail(`operations[${i}].symmetric must be a boolean`);
      const axis = text(operation.axis, `operations[${i}].axis`).toUpperCase();
      if (!AXES.has(axis)) fail(`operations[${i}].axis must be X, Y, or Z`);
      const count = number(operation.count, `operations[${i}].count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`operations[${i}].count must be an integer`);
      const copies = mode === "linear" && operation.symmetric === true ? count * 2 - 2 : count - 1;
      if (features.length * copies > MCP_PLAN_LIMITS.patternFeatureCopies) fail(`operations[${i}] would create more than ${MCP_PLAN_LIMITS.patternFeatureCopies} feature copies`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), features, mode, axis, count,
        ...(mode === "linear" ? { spacing: number(operation.spacing, `operations[${i}].spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), symmetric: operation.symmetric === true } : { angle: number(operation.angle ?? 360, `operations[${i}].angle`, { min: 1, max: 360 }), origin: triple(operation.origin ?? [0, 0, 0], `operations[${i}].origin`) }) };
    }
    if (type === "transform") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "position", "rotation", "relative"]);
      if (operation.relative !== undefined && typeof operation.relative !== "boolean") fail(`operations[${i}].relative must be a boolean`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), position: triple(operation.position ?? [0, 0, 0], `operations[${i}].position`), rotation: triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`), relative: operation.relative === true };
    }
    if (type === "combine") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "tool", "operation", "keepTool"]);
      if (operation.keepTool !== undefined && typeof operation.keepTool !== "boolean") fail(`operations[${i}].keepTool must be a boolean`);
      const op = text(operation.operation, `operations[${i}].operation`);
      if (!["join", "cut", "intersect"].includes(op)) fail(`operations[${i}].operation must be join, cut, or intersect`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), tool: text(operation.tool, `operations[${i}].tool`), operation: op, keepTool: operation.keepTool === true };
    }
    if (type === "fastener") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "fastenerType", "size", "length", "clearance", "left", "position", "rotation", "name"]);
      const fastenerType = text(operation.fastenerType, `operations[${i}].fastenerType`);
      if (!["bolt", "nut", "rod", "cutter"].includes(fastenerType)) fail(`operations[${i}].fastenerType must be bolt, nut, rod, or cutter`);
      if (operation.left !== undefined && typeof operation.left !== "boolean") fail(`operations[${i}].left must be a boolean`);
      const out = { type, id, fastenerType, size: text(operation.size, `operations[${i}].size`), position: triple(operation.position ?? [0, 0, 0], `operations[${i}].position`), rotation: triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`), left: operation.left === true, clearance: number(operation.clearance ?? 0, `operations[${i}].clearance`, { min: -1, max: 0 }) };
      if (fastenerType !== "nut") out.length = number(operation.length, `operations[${i}].length`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
      if (operation.name !== undefined) out.name = text(operation.name, `operations[${i}].name`);
      return out;
    }
    if (type === "import") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "assetId", "units", "position", "rotation"]);
      const assetId = text(operation.assetId, `operations[${i}].assetId`);
      if (!/^[a-f0-9]{64}$/.test(assetId)) fail(`operations[${i}].assetId must be a SHA-256 id from jumpstart_list_imports`);
      if (operation.units !== undefined && !["mm", "cm", "in"].includes(operation.units)) fail(`operations[${i}].units must be mm, cm, or in`);
      return { type, id, assetId, ...(operation.units === undefined ? {} : { units: operation.units }), position: triple(operation.position ?? [0, 0, 0], `operations[${i}].position`), rotation: triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`) };
    }
    if (type === "gear") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "gearType", "module", "teeth", "pressureAngle", "thickness", "bore", "baseDepth", "coneAngle", "position", "rotation", "name"]);
      const gearType = text(operation.gearType, `operations[${i}].gearType`).toLowerCase();
      if (!["spur", "rack", "bevel"].includes(gearType)) fail(`operations[${i}].gearType must be spur, rack, or bevel`);
      if (gearType === "rack" && operation.bore !== undefined) fail(`operations[${i}].bore is only supported for spur gears or bevel gears`);
      if (gearType !== "rack" && operation.baseDepth !== undefined) fail(`operations[${i}].baseDepth is only supported for racks`);
      if (gearType !== "bevel" && operation.coneAngle !== undefined) fail(`operations[${i}].coneAngle is only supported for bevel gears`);
      const module = number(operation.module, `operations[${i}].module`, { min: 0.2, max: 50 });
      const teeth = number(operation.teeth, `operations[${i}].teeth`, { min: 6, max: MCP_PLAN_LIMITS.gearTeeth });
      if (!Number.isInteger(teeth)) fail(`operations[${i}].teeth must be an integer`);
      const pressureAngle = number(operation.pressureAngle ?? 20, `operations[${i}].pressureAngle`, { min: 14, max: 30 });
      const thickness = number(operation.thickness, `operations[${i}].thickness`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
      if (gearType === "rack" && Math.PI * module * teeth > MCP_PLAN_LIMITS.coordinate) fail(`operations[${i}] rack length must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
      if (gearType !== "rack" && module * (teeth + 2) > MCP_PLAN_LIMITS.coordinate) fail(`operations[${i}] gear outside diameter must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
      const bore = gearType !== "rack" ? number(operation.bore ?? 0, `operations[${i}].bore`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
      const coneAngle = gearType === "bevel" ? number(operation.coneAngle ?? 45, `operations[${i}].coneAngle`, { min: 5, max: 80 }) : undefined;
      const smallEndRoot = gearType === "bevel" ? module * (teeth - 2.5) / 2 * (module * teeth / 2 - thickness * Math.tan(coneAngle * Math.PI / 180)) / (module * teeth / 2) : module * (teeth - 2.5) / 2;
      if (gearType === "bevel" && smallEndRoot <= 0.01) fail(`operations[${i}] face width and cone angle leave no usable small-end root`);
      if (gearType !== "rack" && bore >= smallEndRoot * 2 - 0.01) fail(gearType === "bevel" ? `operations[${i}].bore must be smaller than the smallest gear root diameter` : `operations[${i}].bore must be smaller than the gear root diameter`);
      const baseDepth = gearType === "rack" ? number(operation.baseDepth ?? module * 2, `operations[${i}].baseDepth`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate }) : undefined;
      if (gearType === "rack" && baseDepth + 2.25 * module > MCP_PLAN_LIMITS.coordinate) fail(`operations[${i}] rack height must not exceed ${MCP_PLAN_LIMITS.coordinate} mm`);
      const rotation = triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`).map((v, axis) => number(v, `operations[${i}].rotation[${axis}]`, { min: -360, max: 360 }));
      return { type, id, gearType, module, teeth, pressureAngle, thickness, ...(bore === undefined ? {} : { bore }), ...(baseDepth === undefined ? {} : { baseDepth }), ...(coneAngle === undefined ? {} : { coneAngle }), position: triple(operation.position ?? [0, 0, 0], `operations[${i}].position`), rotation, name: text(operation.name, `operations[${i}].name`, gearType === "spur" ? `Spur gear ${teeth}T` : gearType === "bevel" ? `Straight bevel gear ${teeth}T` : `Rack ${teeth}T`) };
    }
    if (type === "knurl") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "diameter", "length", "grooves", "depth", "bore", "boreSize", "position", "rotation", "name"]);
      const diameter = number(operation.diameter ?? 20, `operations[${i}].diameter`, { min: 6, max: 150 });
      const length = number(operation.length ?? 15, `operations[${i}].length`, { min: 1, max: 200 });
      const grooves = number(operation.grooves ?? Math.min(MCP_PLAN_LIMITS.knurlGrooves, Math.max(8, Math.round(Math.PI * diameter))), `operations[${i}].grooves`, { min: 8, max: MCP_PLAN_LIMITS.knurlGrooves });
      if (!Number.isInteger(grooves)) fail(`operations[${i}].grooves must be a whole number from 8 to ${MCP_PLAN_LIMITS.knurlGrooves}`);
      const radius = diameter / 2;
      const maxDepth = Math.floor(radius / 2 * 1000 + 1e-6) / 1000;
      const minDepth = Math.ceil(radius * (1 - Math.cos(Math.PI / grooves)) * 1000 - 1e-6) / 1000;
      const depth = number(operation.depth ?? Math.round(Math.PI * diameter / grooves / 2 * 1000) / 1000, `operations[${i}].depth`, { min: 0.1, max: maxDepth });
      if (depth < minDepth - 1e-9) fail(`operations[${i}].depth must be at least ${minDepth} mm for ${grooves} grooves; shallower grooves vanish`);
      const bore = text(operation.bore, `operations[${i}].bore`, "none").toLowerCase();
      if (!["none", "round", "hex", "d"].includes(bore)) fail(`operations[${i}].bore must be none, round, hex, or d`);
      if (bore === "none" && operation.boreSize !== undefined) fail(`operations[${i}].boreSize is only supported when a bore is selected`);
      const rootRadius = radius - depth;
      const maxBore = Math.floor((bore === "hex" ? Math.sqrt(3) : 2) * (rootRadius - 1) * 1000 + 1e-6) / 1000;
      const defaultBore = bore === "hex" ? 8 : 5;
      const boreSize = bore === "none" ? undefined : number(operation.boreSize ?? defaultBore, `operations[${i}].boreSize`, { min: 1, max: Math.max(0, maxBore) });
      const position = triple(operation.position ?? [0, 0, 0], `operations[${i}].position`);
      const rotation = triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`).map((v, axis) => number(v, `operations[${i}].rotation[${axis}]`, { min: -360, max: 360 }));
      return { type, id, diameter, length, grooves, depth, bore, ...(boreSize === undefined ? {} : { boreSize }), position, rotation, name: text(operation.name, `operations[${i}].name`, `Knurled knob ${diameter} x ${length}`) };
    }
    if (type === "holePattern") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "face", "layout", "hole", "shape", "width", "length", "depth"]);
      const face = text(operation.face, `operations[${i}].face`).toLowerCase();
      if (!["+x", "-x", "+y", "-y", "+z", "-z"].includes(face)) fail(`operations[${i}].face must be +x, -x, +y, -y, +z, or -z`);
      const layout = object(operation.layout, `operations[${i}].layout`);
      let normalizedLayout;
      if (layout.type === "grid") {
        strictObject(layout, `operations[${i}].layout`, ["type", "cols", "rows", "pitch", "margin", "stagger", "angle"]);
        const cols = number(layout.cols, `operations[${i}].layout.cols`, { min: 1, max: MCP_PLAN_LIMITS.holePatternPositions });
        const rows = number(layout.rows, `operations[${i}].layout.rows`, { min: 1, max: MCP_PLAN_LIMITS.holePatternPositions });
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols * rows > MCP_PLAN_LIMITS.holePatternPositions) fail(`operations[${i}].layout grid must contain at most ${MCP_PLAN_LIMITS.holePatternPositions} positions`);
        const pitch = layout.pitch === undefined ? undefined : Array.isArray(layout.pitch)
          ? layout.pitch.map((value, j) => number(value, `operations[${i}].layout.pitch[${j}]`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }))
          : number(layout.pitch, `operations[${i}].layout.pitch`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        if (Array.isArray(pitch) && pitch.length !== 2) fail(`operations[${i}].layout.pitch must be a number or a pair`);
        if (layout.stagger !== undefined && typeof layout.stagger !== "boolean") fail(`operations[${i}].layout.stagger must be a boolean`);
        normalizedLayout = { type: "grid", cols, rows, pitch, margin: number(layout.margin ?? 0, `operations[${i}].layout.margin`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }), stagger: layout.stagger === true, angle: number(layout.angle ?? 0, `operations[${i}].layout.angle`, { min: -360, max: 360 }) };
      } else if (layout.type === "circle") {
        strictObject(layout, `operations[${i}].layout`, ["type", "count", "radius", "start", "center", "margin"]);
        const count = number(layout.count, `operations[${i}].layout.count`, { min: 2, max: MCP_PLAN_LIMITS.holePatternPositions });
        if (!Number.isInteger(count)) fail(`operations[${i}].layout.count must be an integer`);
        normalizedLayout = { type: "circle", count, radius: number(layout.radius, `operations[${i}].layout.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), start: number(layout.start ?? 0, `operations[${i}].layout.start`, { min: -360, max: 360 }), center: layout.center === undefined ? undefined : triple(layout.center, `operations[${i}].layout.center`), margin: number(layout.margin ?? 0, `operations[${i}].layout.margin`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) };
      } else fail(`operations[${i}].layout.type must be grid or circle`);
      const shapeType = text(operation.shape, `operations[${i}].shape`, "round").toLowerCase();
      if (!["round", "square", "hex", "slot"].includes(shapeType)) fail(`operations[${i}].shape must be round, square, hex, or slot`);
      let shape = { type: shapeType };
      let normalizedHole;
      if (shapeType === "round") {
        if (operation.width !== undefined || operation.length !== undefined || operation.depth !== undefined) fail(`operations[${i}] width, length, and depth are only supported for shaped patterns`);
        const hole = object(operation.hole, `operations[${i}].hole`);
        strictObject(hole, `operations[${i}].hole`, ["kind", "diameter", "depth", "counterboreDiameter", "counterboreDepth", "countersinkDiameter", "countersinkAngle", "pitch", "clearance", "tip"]);
        const kind = hole.kind ?? "simple";
        if (!["simple", "cbore", "csink", "tapped"].includes(kind)) fail(`operations[${i}].hole.kind must be simple, cbore, csink, or tapped`);
        normalizedHole = {
          kind,
          diameter: number(hole.diameter, `operations[${i}].hole.diameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
          depth: hole.depth === undefined ? undefined : number(hole.depth, `operations[${i}].hole.depth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
          counterboreDiameter: number(hole.counterboreDiameter ?? 8, `operations[${i}].hole.counterboreDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
          counterboreDepth: number(hole.counterboreDepth ?? 3, `operations[${i}].hole.counterboreDepth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
          countersinkDiameter: number(hole.countersinkDiameter ?? 9, `operations[${i}].hole.countersinkDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
          countersinkAngle: number(hole.countersinkAngle ?? 90, `operations[${i}].hole.countersinkAngle`, { min: 1, max: 179 }),
          pitch: number(hole.pitch ?? 0.5, `operations[${i}].hole.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }),
          clearance: number(hole.clearance ?? 0, `operations[${i}].hole.clearance`, { min: -1, max: 0 }),
          tip: hole.tip === true,
        };
        if (hole.tip !== undefined && typeof hole.tip !== "boolean") fail(`operations[${i}].hole.tip must be a boolean`);
      } else {
        if (operation.hole !== undefined) fail(`operations[${i}].hole settings are only supported for round patterns`);
        const width = number(operation.width, `operations[${i}].width`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
        if (shapeType === "slot") {
          const length = number(operation.length, `operations[${i}].length`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
          if (length <= width) fail(`operations[${i}].length must be greater than its width for a slot`);
          shape.length = length;
        } else if (operation.length !== undefined) fail(`operations[${i}].length is only supported for slot patterns`);
        if (operation.depth !== undefined) shape.depth = number(operation.depth, `operations[${i}].depth`, { min: 0.1, max: MCP_PLAN_LIMITS.coordinate });
        shape.width = width;
      }
      return { type, id, target: text(operation.target, `operations[${i}].target`), face, layout: normalizedLayout, shape, ...(normalizedHole ? { hole: normalizedHole } : {}) };
    }
    if (type === "setRole") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "role"]);
      if (!BODY_ROLES.includes(operation.role)) fail(`operations[${i}].role must be design, reference or hardware`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), role: operation.role };
    }
    if (type === "modifier") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "modifier"]);
      return { type, id, target: text(operation.target, `operations[${i}].target`), modifier: normalizeModifier(operation.modifier, `operations[${i}].modifier`) };
    }
    fail(`operations[${i}].type must be import, group, mirror, pattern, pathPattern, featurePattern, transform, combine, modifier, fastener, gear, knurl, holePattern, phoneCradle, splitBody, or setRole`);
  });
  const allIds = new Set([...existingBodyIds, ...primitiveIds, ...featureIds]);
  for (const operation of operations) {
    if (allIds.has(operation.id)) fail(`Duplicate model id: ${operation.id}`);
    if (operation.type === "group") {
      for (const member of operation.members) if (!allIds.has(member)) fail(`Group ${operation.id} references unknown or later body ${member}`);
    } else if (operation.type === "mirror" || operation.type === "pattern" || operation.type === "pathPattern") {
      if (!allIds.has(operation.source)) fail(`${operation.type === "mirror" ? "Mirror" : operation.type === "pathPattern" ? "Path pattern" : "Pattern"} ${operation.id} references unknown or later body ${operation.source}`);
    } else if (operation.type === "setRole" || operation.type === "transform" || operation.type === "modifier" || operation.type === "holePattern" || operation.type === "featurePattern" || operation.type === "splitBody") {
      if (!allIds.has(operation.target)) fail(`${operation.type} ${operation.id} references unknown or later body ${operation.target}`);
    } else if (operation.type === "combine") {
      if (!allIds.has(operation.target) || !allIds.has(operation.tool)) fail(`Combine ${operation.id} references an unknown or later body`);
    }
    allIds.add(operation.id);
  }
  const inferredMode = features.length || sketches.length || operations.some((operation) => operation.type === "gear" || operation.type === "knurl" || operation.type === "phoneCradle") ? "advanced" : defaultMode || "beginner";
  const mode = text(input.mode, "plan.mode", inferredMode).toLowerCase();
  if (!["beginner", "advanced"].includes(mode)) fail("plan.mode must be beginner or advanced");
  return { name: text(input.name, "plan.name", "AI model"), mode, sketches, features, primitives, operations, planes };
}

function sketchFromDefinition(definition, seq, idFactory) {
  const sketch = {
    id: idFactory("s"),
    name: definition.name,
    seq,
    plane: planeFor(definition.plane, definition.origin),
    pts: [],
    ents: [],
    hidden: true,
  };
  const point = (xy) => {
    const id = idFactory("p");
    sketch.pts.push({ id, x: xy[0], y: xy[1] });
    return id;
  };
  if (definition.segments) {
    const pointAt = (xy) => {
      const existing = sketch.pts.find((entry) => Math.hypot(entry.x - xy[0], entry.y - xy[1]) < 0.001);
      return existing?.id || point(xy);
    };
    for (const segment of definition.segments) {
      if (segment.type === "line") sketch.ents.push({ id: idFactory("e"), t: "line", a: pointAt(segment.start), b: pointAt(segment.end) });
      else {
        const [a, m, b] = [segment.start, segment.through, segment.end];
        const center = arcCenter(a, m, b);
        const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
        const ccwDistance = (from, to) => (to - from + Math.PI * 2) % (Math.PI * 2);
        const a0 = angle(a), a1 = angle(b), am = angle(m);
        const useForward = ccwDistance(a0, am) <= ccwDistance(a0, a1) + 1e-9;
        sketch.ents.push({ id: idFactory("e"), t: "arc", c: pointAt(center), a: pointAt(useForward ? a : b), b: pointAt(useForward ? b : a) });
      }
    }
  } else if (definition.profile.type === "circle") {
    sketch.ents.push({ id: idFactory("e"), t: "circle", c: point(definition.profile.center), r: definition.profile.radius });
  } else if (definition.profile.type === "roundedRect") {
    const { width, height, radius, center: [cx, cy] } = definition.profile;
    const left = cx - width / 2, right = cx + width / 2, bottom = cy - height / 2, top = cy + height / 2;
    const corners = [
      { start: [right - radius, bottom], end: [right, bottom + radius], center: [right - radius, bottom + radius] },
      { start: [right, top - radius], end: [right - radius, top], center: [right - radius, top - radius] },
      { start: [left + radius, top], end: [left, top - radius], center: [left + radius, top - radius] },
      { start: [left, bottom + radius], end: [left + radius, bottom], center: [left + radius, bottom + radius] },
    ];
    const pointAt = (xy) => {
      const existing = sketch.pts.find((entry) => Math.hypot(entry.x - xy[0], entry.y - xy[1]) < 0.001);
      return existing?.id || point(xy);
    };
    const line = (start, end) => sketch.ents.push({ id: idFactory("e"), t: "line", a: pointAt(start), b: pointAt(end) });
    const arc = ({ start, end, center }) => sketch.ents.push({ id: idFactory("e"), t: "arc", c: pointAt(center), a: pointAt(start), b: pointAt(end) });
    for (let i = 0; i < corners.length; i++) {
      arc(corners[i]);
      const next = corners[(i + 1) % corners.length];
      line(corners[i].end, next.start);
    }
  } else if (definition.profile.type === "contour") {
    const pointAt = (xy) => {
      const existing = sketch.pts.find((entry) => Math.hypot(entry.x - xy[0], entry.y - xy[1]) < 0.001);
      return existing?.id || point(xy);
    };
    for (const segment of definition.profile.segments) {
      if (segment.type === "line") {
        sketch.ents.push({ id: idFactory("e"), t: "line", a: pointAt(segment.start), b: pointAt(segment.end) });
      } else if (segment.type === "arc") {
        const center = arcCenter(segment.start, segment.through, segment.end);
        const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
        const ccwDistance = (from, to) => (to - from + Math.PI * 2) % (Math.PI * 2);
        const a0 = angle(segment.start), a1 = angle(segment.end), am = angle(segment.through);
        const useForward = ccwDistance(a0, am) <= ccwDistance(a0, a1) + 1e-9;
        sketch.ents.push({ id: idFactory("e"), t: "arc", c: pointAt(center), a: pointAt(useForward ? segment.start : segment.end), b: pointAt(useForward ? segment.end : segment.start) });
      } else {
        sketch.ents.push({ id: idFactory("e"), t: "spline", pts: segment.points.map(pointAt), closed: !!segment.closed });
      }
    }
  } else {
    const points = definition.profile.points.map(point);
    for (let i = 0; i < points.length; i++) sketch.ents.push({ id: idFactory("e"), t: "line", a: points[i], b: points[(i + 1) % points.length] });
  }
  const profilePoint = definition.profile?.type === "roundedRect" ? definition.profile.center : [0, 0];
  return { sketch, profileRef: { key: sketch.ents.map((entity) => entity.id).sort().join(","), pt: profilePoint } };
}

function rotationMatrix(axis, angle, origin) {
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

function matrixMultiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  }
  return out;
}

function axisRotationMatrix(axis, angle, origin) {
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

function pathFrame(type, origin) {
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

function pathSamples(sketch, count, mode, spacing, direction, anchor) {
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

function matrixInverse(m) {
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

function patternableFeature(mod, document) {
  if (mod?.t === "hole" || mod?.t === "emboss" && mod.kind !== "other") return true;
  return mod?.t === "bool" && mod.src !== "combine" && ["extrude", "revolve", "sweep"].includes(mod.tool?.t) &&
    typeof mod.tool.sketch === "string" && document.sketches.some((sketch) => sketch.id === mod.tool.sketch);
}

function movedFeature(body, mod, worldTransform, key, idFactory, nextSeq) {
  const inverse = matrixInverse(body.m), local = matrixMultiply(matrixMultiply(inverse, worldTransform), body.m);
  const point = (p) => [
    local[0] * p[0] + local[4] * p[1] + local[8] * p[2] + local[12],
    local[1] * p[0] + local[5] * p[1] + local[9] * p[2] + local[13],
    local[2] * p[0] + local[6] * p[1] + local[10] * p[2] + local[14],
  ].map((value) => +value.toFixed(9));
  const direction = (v) => {
    const d = [local[0] * v[0] + local[4] * v[1] + local[8] * v[2], local[1] * v[0] + local[5] * v[1] + local[9] * v[2], local[2] * v[0] + local[6] * v[1] + local[10] * v[2]];
    const length = Math.hypot(...d) || 1;
    return d.map((value) => +(value / length).toFixed(9));
  };
  const copy = clone(mod);
  copy.id = idFactory("f");
  copy.seq = nextSeq();
  if (copy.t === "hole") {
    if (copy.at) copy.at = copy.at.map((entry) => ({ ...entry, p: point(entry.p), n: direction(entry.n) }));
    if (copy.p) copy.p = point(copy.p);
    if (copy.n) copy.n = direction(copy.n);
  } else if (copy.t === "emboss") {
    for (const keyName of ["p", "o", "c"]) if (copy[keyName]) copy[keyName] = point(copy[keyName]);
    for (const keyName of ["n", "x", "ax", "up"]) if (copy[keyName]) copy[keyName] = direction(copy[keyName]);
  } else copy.m = matrixMultiply(local, copy.m || IDENTITY);
  return copy;
}

export function applyFeaturePatterns(document, patterns, idFactory = newId) {
  const doc = document;
  const summaries = [];
  for (const pattern of patterns || []) {
    const body = doc.bodies.find((entry) => entry.id === pattern.bodyId);
    if (!body || body.locked) fail(`Feature pattern ${pattern.id} requires one available, unlocked target body`);
    const refs = pattern.features.map((ref) => {
      const mod = (body.node.mods || []).find((entry) => entry.id === ref);
      if (!mod) fail(`Feature pattern ${pattern.id} references unknown feature ${ref} on body ${body.id}`);
      if (!patternableFeature(mod, doc)) fail(`Feature pattern ${pattern.id} cannot copy unsupported feature type ${mod.t}${mod.t === "bool" ? ` (${mod.tool?.t || "unknown"})` : ""}`);
      return mod;
    });
    const copies = [];
    const indices = pattern.mode === "linear" && pattern.symmetric
      ? Array.from({ length: pattern.count * 2 - 1 }, (_, index) => index - pattern.count + 1).filter(Boolean)
      : Array.from({ length: pattern.count - 1 }, (_, index) => index + 1);
    for (const index of indices) {
      let transform;
      if (pattern.mode === "circular") {
        const full = pattern.angle >= 359.999;
        transform = rotationMatrix(pattern.axis, (full ? 360 / pattern.count : pattern.angle / (pattern.count - 1)) * index, pattern.origin);
      } else {
        const delta = [0, 0, 0];
        delta[["X", "Y", "Z"].indexOf(pattern.axis)] = index * pattern.spacing;
        transform = matrixForTransform(delta);
      }
      for (const mod of refs) {
        const copy = movedFeature(body, mod, transform, index, idFactory, () => ++doc.seq);
        body.node.mods.push(copy);
        copies.push(copy.id);
      }
    }
    summaries.push({ id: pattern.id, bodyId: body.id, sourceFeatures: (pattern.featureRefs || pattern.features).slice(), instances: indices.length + 1, featureCopies: copies.length });
  }
  return summaries;
}

function normalizePrimitive(raw, index) {
  const item = strictObject(raw, `primitives[${index}]`, ["id", "name", "kind", "parameters", "position", "rotation", "hole"]);
  const kind = text(item.kind, `primitives[${index}].kind`).toLowerCase();
  const defaults = PRIMITIVE_DEFAULTS[kind];
  if (!defaults) fail(`primitives[${index}].kind is not a supported JumpStart primitive`);
  const input = object(item.parameters ?? {}, `primitives[${index}].parameters`);
  const p = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults)) fail(`primitives[${index}].parameters.${key} is not valid for ${kind}`);
    if (typeof defaults[key] === "string") {
      if (typeof value !== "string" || !value.trim() || value.length > 256) fail(`primitives[${index}].parameters.${key} must be a non-empty string`);
      p[key] = value.trim();
    } else if (PRIMITIVE_ENUMS[kind]?.[key]) {
      const [min, max] = PRIMITIVE_ENUMS[kind][key];
      const n = number(value, `primitives[${index}].parameters.${key}`, { min, max });
      if (!Number.isInteger(n)) fail(`primitives[${index}].parameters.${key} must be an integer`);
      p[key] = n;
    } else {
      p[key] = number(value, `primitives[${index}].parameters.${key}`, { min: ["w", "d", "h", "size", "tube", "wall", "wire"].includes(key) ? 0.001 : 0, max: MCP_PLAN_LIMITS.coordinate });
    }
  }
  for (const key of ["w", "d", "h", "size", "tube", "wall", "wire"]) if (key in p && p[key] <= 0) fail(`primitives[${index}].parameters.${key} must be greater than zero`);
  for (const key of ["sides", "points", "turns"]) if (key in p && !Number.isInteger(p[key])) fail(`primitives[${index}].parameters.${key} must be an integer`);
  if (item.hole !== undefined && typeof item.hole !== "boolean") fail(`primitives[${index}].hole must be a boolean`);
  return {
    id: text(item.id, `primitives[${index}].id`),
    name: text(item.name, `primitives[${index}].name`, kind),
    kind,
    parameters: p,
    position: triple(item.position ?? [0, 0, 0], `primitives[${index}].position`),
    rotation: triple(item.rotation ?? [0, 0, 0], `primitives[${index}].rotation`),
    hole: item.hole === true,
  };
}

function normalizeEdgeSignatures(edges, label) {
  if (!Array.isArray(edges) || !edges.length || edges.length > 512) fail(`${label} must contain 1 to 512 edge signatures`);
  return edges.map((edge, i) => {
    strictObject(edge, `${label}[${i}]`, ["index", "a", "b", "m", "n", "t"]);
    return {
      ...(edge.a === undefined ? {} : { a: triple(edge.a, `${label}[${i}].a`) }),
      ...(edge.b === undefined ? {} : { b: triple(edge.b, `${label}[${i}].b`) }),
      m: triple(edge.m, `${label}[${i}].m`),
      n: triple(edge.n, `${label}[${i}].n`),
      t: text(edge.t, `${label}[${i}].t`),
    };
  });
}

function normalizeModifier(raw, label) {
  const mod = object(raw, label);
  const type = text(mod.type, `${label}.type`);
  if (type === "fillet") {
    strictObject(mod, label, ["type", "radius", "edges", "chain"]);
    return { type, radius: number(mod.radius, `${label}.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), edges: normalizeEdgeSignatures(mod.edges, `${label}.edges`), chain: mod.chain !== false };
  }
  if (type === "chamfer") {
    strictObject(mod, label, ["type", "distance", "edges", "chain"]);
    return { type, distance: number(mod.distance, `${label}.distance`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), edges: normalizeEdgeSignatures(mod.edges, `${label}.edges`), chain: mod.chain !== false };
  }
  if (type === "offset") {
    strictObject(mod, label, ["type", "distance", "faces"]);
    if (!Array.isArray(mod.faces) || !mod.faces.length || mod.faces.length > 256) fail(`${label}.faces must contain 1 to 256 face signatures`);
    const faces = mod.faces.map((face, i) => {
      const faceLabel = `${label}.faces[${i}]`;
      strictObject(face, faceLabel, ["c", "n", "t"]);
      const t = text(face.t, `${faceLabel}.t`);
      if (!["PLANE", "CYLINDRE", "SPHERE"].includes(t)) fail(`${faceLabel}.t must be PLANE, CYLINDRE, or SPHERE`);
      if (face.n !== undefined && t !== "PLANE") fail(`${faceLabel}.n is only supported for planar faces`);
      const signature = { c: triple(face.c, `${faceLabel}.c`), t };
      if (face.n !== undefined) {
        const n = triple(face.n, `${faceLabel}.n`);
        if (Math.hypot(...n) < 1e-9) fail(`${faceLabel}.n must not be zero`);
        signature.n = n;
      }
      return signature;
    });
    const distance = number(mod.distance, `${label}.distance`, { min: -MCP_PLAN_LIMITS.coordinate, max: MCP_PLAN_LIMITS.coordinate });
    if (distance === 0) fail(`${label}.distance must not be zero`);
    return { type, distance, faces };
  }
  if (type === "shell") {
    strictObject(mod, label, ["type", "thickness", "faces", "direction"]);
    if (mod.direction !== undefined && !["in", "out", "both"].includes(mod.direction)) fail(`${label}.direction must be in, out, or both`);
    if (!Array.isArray(mod.faces) || mod.faces.length > 256) fail(`${label}.faces must be an array of at most 256 face centers`);
    return { type, thickness: number(mod.thickness, `${label}.thickness`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), faces: mod.faces.map((face, i) => ({ c: triple(strictObject(face, `${label}.faces[${i}]`, ["index", "c", "n", "t", "r", "ext", "o", "d", "ax"]).c, `${label}.faces[${i}].c`) })), direction: mod.direction ?? "in" };
  }
  if (type === "hole") {
    strictObject(mod, label, ["type", "at", "kind", "diameter", "through", "depth", "counterboreDiameter", "counterboreDepth", "countersinkDiameter", "countersinkAngle", "tip", "pitch", "clearance"]);
    if (!Array.isArray(mod.at) || !mod.at.length || mod.at.length > 64) fail(`${label}.at must contain 1 to 64 positions`);
    const kind = text(mod.kind, `${label}.kind`, "simple");
    if (!["simple", "cbore", "csink", "tapped"].includes(kind)) fail(`${label}.kind must be simple, cbore, csink, or tapped`);
    const through = mod.through !== false;
    return {
      type, kind: kind === "tapped" ? "simple" : kind,
      dia: number(mod.diameter, `${label}.diameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      through, depth: number(mod.depth ?? 10, `${label}.depth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDia: number(mod.counterboreDiameter ?? 8, `${label}.counterboreDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDepth: number(mod.counterboreDepth ?? 3, `${label}.counterboreDepth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csDia: number(mod.countersinkDiameter ?? 9, `${label}.countersinkDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csAngle: number(mod.countersinkAngle ?? 90, `${label}.countersinkAngle`, { min: 1, max: 179 }),
      tip: mod.tip === true, tapped: kind === "tapped",
      pitch: number(mod.pitch ?? 0.5, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }),
      clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }),
      at: mod.at.map((at, i) => {
        const point = strictObject(at, `${label}.at[${i}]`, ["p", "n"]);
        const n = triple(point.n, `${label}.at[${i}].n`);
        if (Math.hypot(...n) < 1e-9) fail(`${label}.at[${i}].n must not be zero`);
        return { p: triple(point.p, `${label}.at[${i}].p`), n };
      }),
    };
  }
  if (type === "thread") {
    strictObject(mod, label, ["type", "face", "pitch", "length", "flip", "left", "clearance"]);
    const face = strictObject(mod.face, `${label}.face`, ["index", "c", "t", "n", "r", "ext", "o", "d", "ax"]);
    if (face.t !== "CYLINDRE") fail(`${label}.face.t must be CYLINDRE`);
    return { type, face: { c: triple(face.c, `${label}.face.c`), t: "CYLINDRE" }, pitch: number(mod.pitch, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), length: number(mod.length ?? 0, `${label}.length`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }), flip: mod.flip === true, left: mod.left === true, clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) };
  }
  if (type === "emboss") {
    strictObject(mod, label, ["type", "geo", "text", "font", "size", "depth", "mode", "angle"]);
    const geo = strictObject(mod.geo, `${label}.geo`, ["kind", "p", "n", "x"]);
    const kind = text(geo.kind, `${label}.geo.kind`);
    if (kind !== "plane") fail(`${label}.geo.kind must be plane for declarative embossing`);
    if (mod.mode !== undefined && !["emboss", "deboss"].includes(mod.mode)) fail(`${label}.mode must be emboss or deboss`);
    const n = triple(geo.n, `${label}.geo.n`), x = triple(geo.x, `${label}.geo.x`);
    if (Math.hypot(...n) < 1e-9 || Math.hypot(...x) < 1e-9) fail(`${label}.geo.n and geo.x must not be zero`);
    return { type, geo: { kind, p: triple(geo.p, `${label}.geo.p`), n, x }, text: text(mod.text, `${label}.text`), font: text(mod.font, `${label}.font`, "sans"), size: number(mod.size, `${label}.size`, { min: 0.5, max: MCP_PLAN_LIMITS.coordinate }), depth: number(mod.depth, `${label}.depth`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), mode: mod.mode ?? "emboss", angle: number(mod.angle ?? 0, `${label}.angle`, { min: -360, max: 360 }) };
  }
  if (type === "scale") {
    strictObject(mod, label, ["type", "factors", "offset"]);
    return { type, factors: triple(mod.factors, `${label}.factors`).map((value, i) => number(value, `${label}.factors[${i}]`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate })), offset: triple(mod.offset ?? [0, 0, 0], `${label}.offset`) };
  }
  fail(`${label}.type must be fillet, chamfer, offset, shell, hole, thread, emboss, or scale`);
}

function patternedNode(node, pattern) {
  if (!pattern) return node;
  return {
    t: "group",
    mods: [],
    children: Array.from({ length: pattern.count }, (_, i) => ({
      node: clone(node),
      m: rotationMatrix(pattern.axis, pattern.angle * i / pattern.count, pattern.origin),
      hole: false,
    })),
  };
}

export function buildModelPlan(document, input, idFactory = newId, replaceBodyIds = [], inputIsNormalized = false) {
  const doc = clone(document);
  const plan = inputIsNormalized ? input : normalizeModelPlan(input, doc.bodies.map((body) => body.id), doc.mode);
  for (const operation of plan.operations) {
    if (operation.type !== "import") continue;
    const asset = doc.assets?.[operation.assetId];
    if (!asset) fail(`Import ${operation.id} does not reference an asset supplied by the managed import catalog`);
    const name = String(asset.name || "");
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const format = ext === "stp" ? "step" : ext;
    if (!/^[^/\\]+\.(stl|3mf|step|stp)$/i.test(name) || !["stl", "3mf", "step"].includes(format) || !["mesh", "step"].includes(asset.kind)) fail(`Import ${operation.id} has an unsupported managed file type`);
    if (format === "stl" && !operation.units) fail(`Import ${operation.id} requires explicit STL units: mm, cm, or in`);
    if (format !== "stl" && operation.units !== undefined) fail(`Import ${operation.id} must preserve units encoded in its ${format.toUpperCase()} file`);
  }
  if (!Array.isArray(replaceBodyIds) || replaceBodyIds.length > MCP_PLAN_LIMITS.features || replaceBodyIds.some((bodyId) => typeof bodyId !== "string")) {
    fail("replaceBodyIds must be an array of existing body ids");
  }
  const replaced = new Set(replaceBodyIds);
  if (replaced.size !== replaceBodyIds.length) fail("replaceBodyIds must not contain duplicates");
  const removed = doc.bodies.filter((body) => replaced.has(body.id));
  if (removed.length !== replaced.size) fail("Every replaceBodyId must exist in the current document");
  if (removed.some((body) => body.locked)) fail("Unlock every body before replacing it");
  const removedSketchIds = new Set();
  for (const body of removed) {
    JSON.stringify(body.node, (key, value) => {
      if (key === "sketch" && typeof value === "string") removedSketchIds.add(value);
      return value;
    });
  }
  doc.bodies = doc.bodies.filter((body) => !replaced.has(body.id));
  const keptSketchIds = new Set();
  for (const body of doc.bodies) {
    JSON.stringify(body.node, (key, value) => {
      if (key === "sketch" && typeof value === "string") keptSketchIds.add(value);
      return value;
    });
  }
  doc.sketches = doc.sketches.filter((sketch) => !removedSketchIds.has(sketch.id) || keptSketchIds.has(sketch.id));
  doc.mode = plan.mode;
  const sketches = new Map();
  const bodies = new Map();
  const createdBodyIds = [];
  const affectedBodyIds = new Set();
  const pendingHolePatterns = [];
  const pendingFeaturePatterns = [];
  const featureMods = new Map();
  const remember = (modelId, bodyList) => bodies.set(modelId, bodyList);
  const bodyList = (modelId) => {
    const value = (bodies.get(modelId) || []).filter((entry) => doc.bodies.some((body) => body.id === entry.id));
    if (!value.length) fail(`Body ${modelId} is unavailable or has already been consumed by a group or boolean`);
    return value;
  };
  const addBody = (name, node, m = IDENTITY.slice(), hole = false) => {
    if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
    const body = { id: idFactory("b"), name, seq: ++doc.seq, color: "#9fb1c4", hole, hidden: false, m: m.slice(), node };
    doc.bodies.push(body);
    createdBodyIds.push(body.id);
    affectedBodyIds.add(body.id);
    return body;
  };
  for (const body of doc.bodies) remember(body.id, [body]);
  for (const definition of plan.planes) {
    const plane = planeFor(definition.plane, definition.origin);
    doc.planes.push({ id: idFactory("pl"), name: definition.name, seq: ++doc.seq, kind: "mcp", def: {}, plane, size: 100, hidden: false });
  }
  for (const definition of plan.sketches) {
    const built = sketchFromDefinition(definition, ++doc.seq, idFactory);
    doc.sketches.push(built.sketch);
    sketches.set(definition.id, built);
  }

  for (const primitive of plan.primitives) {
    const node = { t: "prim", kind: primitive.kind, p: clone(primitive.parameters), mods: [] };
    remember(primitive.id, [addBody(primitive.name, node, matrixForTransform(primitive.position, primitive.rotation), primitive.hole)]);
  }

  for (const feature of plan.features) {
    let node;
    if (feature.type === "coil") {
      node = { t: "coil", d: feature.d, turns: feature.turns, mode: feature.mode, ...(feature.h === undefined ? {} : { h: feature.h }), ...(feature.pitch === undefined ? {} : { pitch: feature.pitch }), angle: feature.angle, section: feature.section, size: feature.size, pos: feature.pos, left: feature.left, mods: [] };
    } else if (feature.type === "loft") {
      node = {
        t: "loft",
        sections: feature.sections.map((sketchId) => {
          const section = sketches.get(sketchId);
          return { sketch: section.sketch.id, ref: clone(section.profileRef) };
        }),
        rail: null, ruled: feature.ruled, closed: feature.closed, mods: [],
      };
    } else {
      if (feature.type === "pipe") {
        const path = sketches.get(feature.path);
        node = { t: "pipe", path: { sketch: path.sketch.id, ents: path.sketch.ents.map((entity) => entity.id) }, section: feature.section, size: feature.size, hollow: feature.hollow, ...(feature.wall === undefined ? {} : { wall: feature.wall }), mods: [] };
      } else {
        const source = sketches.get(feature.sketch);
        node = { t: feature.type, sketch: source.sketch.id, profiles: [source.profileRef], mods: [] };
        if (feature.type === "revolve") Object.assign(node, { axis: feature.axis, angle: feature.angle });
        else if (feature.type === "extrude") Object.assign(node, { dist: feature.distance, mode: feature.mode, dist2: feature.distance2 ?? 0 });
        else {
          const path = sketches.get(feature.path);
          Object.assign(node, { path: { sketch: path.sketch.id, ents: path.sketch.ents.map((entity) => entity.id) }, orient: feature.orient, dist: 1, taper: 0, twist: 0, chain: false });
        }
      }
    }
    const tool = patternedNode(node, feature.pattern);
    const transform = feature.type === "coil" ? matrixForTransform(feature.position, feature.rotation) : IDENTITY.slice();
    if (feature.operation === "new") {
      remember(feature.id, [addBody(feature.name, tool, transform)]);
    } else {
      const target = bodyList(feature.target)[0];
      target.node.mods = target.node.mods || [];
      const mod = { id: idFactory("f"), seq: ++doc.seq, t: "bool", op: feature.operation, tool, m: matrixMultiply(matrixInverse(target.m), transform) };
      target.node.mods.push(mod);
      featureMods.set(feature.id, [{ bodyId: target.id, featureId: mod.id }]);
      affectedBodyIds.add(target.id);
      remember(feature.id, [target]);
    }
  }

  for (const operation of plan.operations) {
    if (operation.type === "phoneCradle") {
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Phone cradle ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const [centerX, lowerEdgeY, baseZ] = operation.position;
      const direction = operation.topEdgeToward === "+Y" ? 1 : -1;
      const radians = operation.angle * Math.PI / 180;
      const centerY = lowerEdgeY + direction * operation.run / 2;
      const panelPosition = [centerX, centerY + direction * Math.sin(radians) * 0.4, baseZ + operation.rise / 2 - Math.cos(radians) * 0.4];
      const panelRotation = [direction * operation.angle, 0, 0];
      const panelTransform = matrixForTransform(panelPosition, panelRotation);
      const panel = { t: "prim", kind: "box", p: { w: operation.width, d: operation.phoneLength, h: operation.plateThickness }, mods: [] };
      const body = addBody(operation.name, panel, panelTransform);
      const addSupport = (kind, parameters, position, rotation = [0, 0, 0]) => {
        body.node.mods.push({
          id: idFactory("f"), seq: ++doc.seq, t: "bool", src: "phoneCradle", op: "join",
          tool: { t: "prim", kind, p: clone(parameters), mods: [] },
          m: matrixMultiply(matrixInverse(body.m), matrixForTransform(position, rotation)),
        });
      };
      for (const side of [-1, 1]) {
        const ribX = centerX + side * (operation.width / 2 - operation.ribThickness / 2);
        addSupport("wedge", { w: operation.ribThickness, d: operation.run, h: operation.rise }, [ribX, centerY, baseZ], direction < 0 ? [0, 0, 180] : [0, 0, 0]);
      }
      const stopOverlap = Math.min(1, operation.stopDepth / 4);
      const stopY = lowerEdgeY - direction * (operation.stopDepth / 2 - stopOverlap);
      addSupport("box", { w: operation.width, d: operation.stopDepth, h: operation.stopHeight }, [centerX, stopY, baseZ]);
      body.mcpPhoneCradle = {
        coordinateFrame: { description: "X across · Y front/back · Z up", orientation: "+Y = dashboard", screen: direction > 0 ? "Screen faces -Y (driver side)" : "Screen faces +Y (dashboard side)" },
        topEdgeToward: operation.topEdgeToward,
        screenFacesToward: direction > 0 ? "-Y" : "+Y",
        width: operation.width, phoneLength: operation.phoneLength, angle: operation.angle,
        plateThickness: operation.plateThickness, ribThickness: operation.ribThickness,
        stopHeight: operation.stopHeight, stopDepth: operation.stopDepth,
        run: operation.run, rise: operation.rise, position: operation.position.slice(), supportRibs: 2,
      };
      remember(operation.id, [body]);
    } else if (operation.type === "import") {
      const asset = doc.assets[operation.assetId];
      const ext = String(asset.name || "").slice(String(asset.name || "").lastIndexOf(".") + 1).toLowerCase();
      const format = ext === "stp" ? "step" : ext;
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Import ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const scale = operation.units === "cm" ? 10 : operation.units === "in" ? 25.4 : 1;
      const node = { t: format === "step" ? "step" : "mesh", asset: operation.assetId, ...(format === "stl" ? { k: scale } : {}), mods: [] };
      const body = addBody(asset.name.replace(/\.(stl|3mf|step|stp)$/i, "") || "Imported model", node, matrixForTransform(operation.position, operation.rotation));
      remember(operation.id, [body]);
    } else if (operation.type === "group") {
      const members = operation.members.flatMap((member) => bodyList(member));
      if (members.length < 2) fail(`Group ${operation.id} must contain at least two bodies`);
      if (new Set(members.map((body) => body.id)).size !== members.length) fail(`Group ${operation.id} contains the same body more than once`);
      const children = members.map((body, i) => ({
        node: clone(body.node), m: body.m.slice(), hole: operation.operation === "cut" ? i > 0 : !!body.hole,
        name: body.name, color: body.color,
        ...(members.some(member => member.role !== undefined) ? { role: bodyRole(body) } : {}),
      }));
      const node = { t: "group", ...(operation.operation === "intersect" ? { op: "intersect" } : {}), children, mods: [] };
      const group = addBody(operation.name, node, IDENTITY.slice(), children.every((child) => child.hole));
      const role = combinedRole(members, operation.operation);
      if (role !== undefined) group.role = role;
      doc.bodies = doc.bodies.filter((body) => !members.some((member) => member.id === body.id));
      remember(operation.id, [group]);
    } else if (operation.type === "pattern") {
      const sources = bodyList(operation.source);
      const copyCount = operation.mode === "linear" && operation.symmetric ? operation.count * 2 - 1 : operation.count;
      if (doc.bodies.length + sources.length * (copyCount - 1) > MCP_PLAN_LIMITS.bodies) fail(`Pattern ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const copies = [];
      const indices = operation.mode === "linear" && operation.symmetric
        ? Array.from({ length: operation.count * 2 - 1 }, (_, i) => i - (operation.count - 1))
        : Array.from({ length: operation.count }, (_, i) => i);
      for (const index of indices) {
        for (const source of sources) {
          if (index === 0) { copies.push(source); continue; }
          let transform;
          if (operation.mode === "circular") {
            const fullCircle = operation.angle >= 359.999;
            const stepAngle = fullCircle ? 360 / operation.count : operation.angle / (operation.count - 1);
            transform = rotationMatrix(operation.axis, stepAngle * index, operation.origin);
          }
          else {
            const delta = [0, 0, 0]; delta[["X", "Y", "Z"].indexOf(operation.axis)] = index * operation.spacing;
            transform = matrixForTransform(delta);
          }
          const copy = clone(source);
          copy.id = idFactory("b"); copy.seq = ++doc.seq;
          copy.name = `${source.name} ${index + 1}`.slice(0, 80);
          copy.m = matrixMultiply(transform, source.m);
          doc.bodies.push(copy); createdBodyIds.push(copy.id); affectedBodyIds.add(copy.id); copies.push(copy);
        }
      }
      remember(operation.id, copies);
    } else if (operation.type === "pathPattern") {
      const sources = bodyList(operation.source);
      const definition = plan.sketches.find((sketch) => sketch.id === operation.path);
      if (!definition?.segments) fail(`Path pattern ${operation.id} references an unavailable path sketch`);
      if (doc.bodies.length + sources.length * (operation.count - 1) > MCP_PLAN_LIMITS.bodies) fail(`Path pattern ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const frame = pathFrame(definition.plane, definition.origin);
      const tangentAngle = (tangent) => Math.atan2(tangent[0] * frame.y[0] + tangent[1] * frame.y[1] + tangent[2] * frame.y[2], tangent[0] * frame.x[0] + tangent[1] * frame.x[1] + tangent[2] * frame.x[2]);
      const copies = [];
      for (const source of sources) {
        const samples = pathSamples(definition, operation.count, operation.mode, operation.spacing, operation.direction, operation.anchor || source.m.slice(12, 15));
        const first = samples[0];
        for (let index = 0; index < samples.length; index++) {
          const sample = samples[index];
          if (index === 0) { copies.push(source); continue; }
          const delta = sample.point.map((value, axis) => value - first.point[axis]);
          let transform = matrixForTransform(delta);
          if (operation.orientation === "follow-path") {
            const angle = tangentAngle(sample.tangent) - tangentAngle(first.tangent);
            transform = matrixMultiply(transform, axisRotationMatrix(frame.n, angle, first.point));
          }
          const copy = clone(source);
          copy.id = idFactory("b"); copy.seq = ++doc.seq;
          copy.name = `${source.name} path ${index + 1}`.slice(0, 80);
          copy.m = matrixMultiply(transform, source.m);
          doc.bodies.push(copy); createdBodyIds.push(copy.id); affectedBodyIds.add(copy.id); copies.push(copy);
        }
      }
      remember(operation.id, copies);
    } else if (operation.type === "featurePattern") {
      const targets = bodyList(operation.target);
      if (targets.length !== 1) fail(`Feature pattern ${operation.id} must target exactly one body`);
      const target = targets[0];
      if (target.locked) fail(`Unlock body ${operation.target} before patterning its features`);
      const refs = [];
      for (const ref of operation.features) {
        const mapped = (featureMods.get(ref) || []).find((entry) => entry.bodyId === target.id);
        const pendingHolePattern = pendingHolePatterns.find((entry) => entry.id === ref && entry.bodyId === target.id);
        const nativeRef = mapped?.featureId || pendingHolePattern?.featureId || ref;
        const mod = (target.node.mods || []).find((entry) => entry.id === nativeRef);
        if (mod && !patternableFeature(mod, doc)) fail(`Feature pattern ${operation.id} cannot copy unsupported feature type ${mod.t}${mod.t === "bool" ? ` (${mod.tool?.t || "unknown"})` : ""}`);
        if (!mod && !pendingHolePattern) fail(`Feature pattern ${operation.id} references unknown feature ${ref} on body ${target.id}`);
        refs.push(nativeRef);
      }
      pendingFeaturePatterns.push({ ...clone(operation), bodyId: target.id, features: refs, featureRefs: operation.features.slice() });
      affectedBodyIds.add(target.id);
      remember(operation.id, targets);
    } else if (operation.type === "mirror") {
      const sources = bodyList(operation.source);
      for (const source of sources) {
        if (source.locked) fail(`Unlock body ${operation.source} before mirroring it`);
        if (!source.node || typeof source.node !== "object" || source.node.t === "mirror") fail(`Mirror ${operation.id} requires an editable body that is not itself a linked mirror`);
      }
      if (operation.behavior === "linked") {
        if (doc.bodies.length + sources.length > MCP_PLAN_LIMITS.bodies) fail(`Mirror ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
        const mirrors = sources.map((source) => {
          const mirror = addBody(`${source.name || "Body"} (mirror)`.slice(0, 80), { t: "mirror", srcBody: source.id, plane: clone(operation.plane), mods: [] }, IDENTITY.slice(), !!source.hole);
          if (source.color !== undefined) mirror.color = source.color;
          if (source.role !== undefined) mirror.role = source.role;
          return mirror;
        });
        remember(operation.id, mirrors);
      } else {
        for (const source of sources) {
          source.node.mods = source.node.mods || [];
          source.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", op: "join", tool: { t: "mirror", src: clone(source.node), srcM: source.m.slice(), plane: clone(operation.plane), mods: [] }, m: matrixInverse(source.m) });
          affectedBodyIds.add(source.id);
        }
        remember(operation.id, sources);
      }
    } else if (operation.type === "splitBody") {
      const targets = bodyList(operation.target);
      if (targets.length !== 1) fail(`Split ${operation.id} requires exactly one unambiguous target body`);
      const source = targets[0];
      if (source.locked) fail(`Unlock body ${operation.target} before splitting it`);
      if (!source.node || typeof source.node !== "object") fail(`Split ${operation.id} requires an editable body`);
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Split ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const inverse = matrixInverse(source.m);
      const [x, y, z] = operation.plane.o, [nx, ny, nz] = operation.plane.n;
      const origin = [
        inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12],
        inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13],
        inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14],
      ];
      const normal = [
        inverse[0] * nx + inverse[4] * ny + inverse[8] * nz,
        inverse[1] * nx + inverse[5] * ny + inverse[9] * nz,
        inverse[2] * nx + inverse[6] * ny + inverse[10] * nz,
      ];
      const length = Math.hypot(...normal);
      if (!Number.isFinite(length) || length < 1e-12) fail(`Split ${operation.id} has an invalid transformed plane`);
      const localPlane = { o: origin, n: normal.map((value) => value / length) };
      source.node.mods = source.node.mods || [];
      source.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "halfspace", plane: clone(localPlane), side: 1 });
      const otherNode = clone(source.node);
      otherNode.mods = otherNode.mods.slice(0, -1);
      otherNode.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "halfspace", plane: clone(localPlane), side: -1 });
      const other = addBody(`${source.name || "Body"} (split)`.slice(0, 80), otherNode, source.m, !!source.hole);
      if (source.color !== undefined) other.color = source.color;
      if (source.role !== undefined) other.role = source.role;
      affectedBodyIds.add(source.id);
      remember(operation.id, [source, other]);
    } else if (operation.type === "setRole") {
      const targets = bodyList(operation.target);
      for (const body of targets) {
        if (body.locked) fail(`Unlock body ${body.id} before changing its role`);
        body.role = operation.role;
        affectedBodyIds.add(body.id);
      }
      remember(operation.id, targets);
    } else if (operation.type === "transform") {
      const targets = bodyList(operation.target);
      const transform = matrixForTransform(operation.position, operation.rotation);
      for (const body of targets) {
        body.m = operation.relative ? matrixMultiply(transform, body.m) : transform.slice();
        affectedBodyIds.add(body.id);
      }
      remember(operation.id, targets);
    } else if (operation.type === "fastener") {
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const result = createFastener(operation, { idFactory, nextSeq: () => ++doc.seq, matrixForTransform });
      doc.bodies.push(result.body);
      createdBodyIds.push(result.body.id);
      affectedBodyIds.add(result.body.id);
      remember(operation.id, [result.body]);
    } else if (operation.type === "gear") {
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const node = { t: "prim", kind: operation.gearType === "spur" ? "gear" : operation.gearType === "bevel" ? "bevelgear" : "rack", p: { module: operation.module, teeth: operation.teeth, pressureAngle: operation.pressureAngle, thickness: operation.thickness, ...(operation.bore === undefined ? {} : { bore: operation.bore }), ...(operation.baseDepth === undefined ? {} : { baseDepth: operation.baseDepth }), ...(operation.coneAngle === undefined ? {} : { coneAngle: operation.coneAngle }) }, mods: [] };
      remember(operation.id, [addBody(operation.name, node, matrixForTransform(operation.position, operation.rotation))]);
    } else if (operation.type === "knurl") {
      if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Knurl ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const radius = operation.diameter / 2, rootRadius = radius - operation.depth;
      const sketch = { id: idFactory("s"), name: `${operation.name} profile`, seq: ++doc.seq, plane: planeFor("XY", [0, 0, 0]), pts: [], ents: [], hidden: true };
      const point = (x, y) => { const id = idFactory("p"); sketch.pts.push({ id, x: Math.round(x * 1e6) / 1e6 || 0, y: Math.round(y * 1e6) / 1e6 || 0 }); return id; };
      const line = (a, b) => sketch.ents.push({ id: idFactory("e"), t: "line", a, b });
      const ring = [];
      for (let i = 0; i < operation.grooves; i++) {
        const tip = 2 * Math.PI * i / operation.grooves;
        const root = tip + Math.PI / operation.grooves;
        ring.push(point(radius * Math.cos(tip), radius * Math.sin(tip)), point(rootRadius * Math.cos(root), rootRadius * Math.sin(root)));
      }
      for (let i = 0; i < ring.length; i++) line(ring[i], ring[(i + 1) % ring.length]);
      if (operation.bore === "round") sketch.ents.push({ id: idFactory("e"), t: "circle", c: point(0, 0), r: operation.boreSize / 2 });
      else if (operation.bore === "hex") {
        const cornerRadius = operation.boreSize / Math.sqrt(3);
        const vertices = Array.from({ length: 6 }, (_, i) => point(cornerRadius * Math.cos(i * Math.PI / 3), cornerRadius * Math.sin(i * Math.PI / 3)));
        for (let i = 0; i < vertices.length; i++) line(vertices[i], vertices[(i + 1) % vertices.length]);
      } else if (operation.bore === "d") {
        const boreRadius = operation.boreSize / 2, flatX = 0.4 * operation.boreSize;
        const y = Math.sqrt(boreRadius ** 2 - flatX ** 2), center = point(0, 0), top = point(flatX, y), bottom = point(flatX, -y);
        sketch.ents.push({ id: idFactory("e"), t: "arc", c: center, a: top, b: bottom });
        line(bottom, top);
      }
      doc.sketches.push(sketch);
      const outerEdge = sketch.ents[0]?.id;
      const profile = findRegions(resolveSketch(sketch)).find((region) => region.ents.includes(outerEdge));
      if (!profile) fail(`Knurl ${operation.id} could not resolve its outer groove profile`);
      const profileRef = { key: profile.key, pt: profile.pt };
      const body = addBody(operation.name, { t: "extrude", sketch: sketch.id, profiles: [profileRef], dist: operation.length, mode: "one", dist2: 0, mods: [] }, matrixForTransform(operation.position, operation.rotation));
      body.mcpKnurl = { diameter: operation.diameter, length: operation.length, grooves: operation.grooves, pitch: Math.PI * operation.diameter / operation.grooves, depth: operation.depth, bore: operation.bore, ...(operation.boreSize === undefined ? {} : { boreSize: operation.boreSize }) };
      remember(operation.id, [body]);
    } else if (operation.type === "holePattern") {
      const targets = bodyList(operation.target);
      if (targets.length !== 1) fail(`Hole pattern ${operation.id} must target exactly one body`);
      const target = targets[0];
      if (target.locked) fail(`Unlock body ${operation.target} before adding a hole pattern`);
      const pending = { ...clone(operation), bodyId: target.id, featureId: idFactory("f") };
      if (operation.shape.type === "round") pending.seq = ++doc.seq;
      else {
        pending.sketchId = idFactory("s");
        pending.sketchSeq = ++doc.seq;
        pending.seq = ++doc.seq;
      }
      pendingHolePatterns.push(pending);
      featureMods.set(operation.id, [{ bodyId: target.id, featureId: pending.featureId }]);
      affectedBodyIds.add(target.id);
      remember(operation.id, targets);
    } else if (operation.type === "combine") {
      const target = bodyList(operation.target);
      const tools = bodyList(operation.tool);
      if (target.length !== 1 || tools.length !== 1 || target[0].id === tools[0].id) fail(`Combine ${operation.id} requires two distinct single bodies`);
      const [base, tool] = [target[0], tools[0]];
      const role = combinedRole([base, tool], operation.operation);
      if (role !== undefined) base.role = role;
      base.node.mods = base.node.mods || [];
      base.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", src: "combine", ...(operation.operation === "join" ? {} : { op: operation.operation }), tool: clone(tool.node), m: matrixMultiply(matrixInverse(base.m), tool.m) });
      affectedBodyIds.add(base.id);
      if (!operation.keepTool) doc.bodies = doc.bodies.filter((body) => body.id !== tool.id);
      remember(operation.id, [base]);
    } else if (operation.type === "modifier") {
      const targets = bodyList(operation.target);
      const { type, ...properties } = operation.modifier;
      for (const body of targets) {
        body.node.mods = body.node.mods || [];
        const mod = { id: idFactory("f"), seq: ++doc.seq, t: type };
        if (type === "fillet") Object.assign(mod, { r: properties.radius, edges: properties.edges, chain: properties.chain });
        else if (type === "chamfer") Object.assign(mod, { d: properties.distance, edges: properties.edges, chain: properties.chain });
        else if (type === "offset") Object.assign(mod, { d: properties.distance, faces: properties.faces });
        else if (type === "shell") Object.assign(mod, { th: properties.thickness, faces: properties.faces, ...(properties.direction === "in" ? {} : { dir: properties.direction }) });
        else if (type === "hole") Object.assign(mod, { dia: properties.dia, kind: properties.kind, through: properties.through, depth: properties.depth, cbDia: properties.cbDia, cbDepth: properties.cbDepth, csDia: properties.csDia, csAngle: properties.csAngle, tip: properties.tip, tapped: properties.tapped, pitch: properties.pitch, clear: properties.clear, at: properties.at });
        else if (type === "thread") Object.assign(mod, { face: properties.face, pitch: properties.pitch, length: properties.length, flip: properties.flip, left: properties.left, clear: properties.clear });
        else if (type === "emboss") Object.assign(mod, { ...properties.geo, str: properties.text, font: properties.font, size: properties.size, depth: properties.depth, mode: properties.mode, angle: properties.angle, along: false, mirror: false, reverse: false });
        else if (type === "scale") Object.assign(mod, { k: properties.factors, o: properties.offset });
        body.node.mods.push(mod);
        const refs = featureMods.get(operation.id) || [];
        refs.push({ bodyId: body.id, featureId: mod.id });
        featureMods.set(operation.id, refs);
        affectedBodyIds.add(body.id);
      }
      remember(operation.id, targets);
    }
  }

  for (const pattern of pendingHolePatterns) {
    if (!doc.bodies.some((body) => body.id === pattern.bodyId)) fail(`Hole pattern ${pattern.id} targets a body that was consumed by a later operation`);
  }

  doc.name = plan.name;
  const featureBodyIds = Object.fromEntries([...bodies].map(([id, list]) => [id, list.length === 1 ? list[0].id : list.map((body) => body.id)]));
  const liveCreatedIds = [...new Set(createdBodyIds)].filter((bodyId) => doc.bodies.some((body) => body.id === bodyId));
  return { document: doc, createdBodyIds: liveCreatedIds, featureBodyIds, affectedBodyIds: [...affectedBodyIds].filter((bodyId) => doc.bodies.some((body) => body.id === bodyId)), pendingHolePatterns, pendingFeaturePatterns };
}

export function resizeBodyDocument(document, bodyId, bounds, requestedSize, anchor = "base", idFactory = newId) {
  const doc = clone(document);
  const body = doc.bodies.find((entry) => entry.id === bodyId);
  if (!body) fail(`Body ${bodyId} does not exist in the current document`);
  if (body.locked) fail("Unlock the body before resizing it");
  if (!body.node || typeof body.node !== "object") fail("The selected body has no editable feature node");
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 3 || bounds.max.length !== 3) {
    fail("The selected body does not have ready 3D bounds");
  }
  object(requestedSize, "size");
  if (!Object.keys(requestedSize).length || Object.keys(requestedSize).some((key) => !["x", "y", "z"].includes(key))) {
    fail("size must specify at least one of x, y, or z");
  }
  if (!["base", "center", "corner"].includes(anchor)) fail("anchor must be base, center, or corner");

  const minimum = triple(bounds.min, "bounds.min");
  const maximum = triple(bounds.max, "bounds.max");
  const current = maximum.map((value, i) => value - minimum[i]);
  if (current.some((value) => !Number.isFinite(value) || value <= 0)) fail("The selected body has a zero or invalid dimension");
  const target = ["x", "y", "z"].map((axis, i) => requestedSize[axis] === undefined
    ? current[i]
    : number(requestedSize[axis], `size.${axis}`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }));
  const factors = target.map((value, i) => value / current[i]);
  const fixed = minimum.map((value, i) => anchor === "base"
    ? (i === 2 ? value : (value + maximum[i]) / 2)
    : anchor === "center" ? (value + maximum[i]) / 2 : value);
  const offset = fixed.map((value, i) => value - factors[i] * value);
  body.node.mods = body.node.mods || [];
  const last = body.node.mods[body.node.mods.length - 1];
  if (last?.t === "scale") {
    last.k = last.k.map((value, i) => +(value * factors[i]).toPrecision(10));
    last.o = last.o.map((value, i) => +(value * factors[i] + offset[i]).toPrecision(10));
  } else {
    body.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "scale", k: factors.map((value) => +value.toPrecision(10)), o: offset.map((value) => +value.toPrecision(10)) });
  }
  return { document: doc, bodyId, currentSize: current, targetSize: target, factors };
}
