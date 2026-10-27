import { clone } from "../../../src/util.js";
import { MCP_PLAN_LIMITS, AXES, fail, object, strictObject, text, number, pair, triple, newId } from "./plan-input.js";
import { IDENTITY, cross2, arcCenter, planeFor, rotationMatrix, matrixMultiply, matrixForTransform, matrixInverse } from "./plan-geometry.js";
import { OPERATION_TYPES } from "./operations/index.js";

export { MCP_PLAN_LIMITS } from "./plan-input.js";
export { matrixForTransform } from "./plan-geometry.js";
export { applyFeaturePatterns } from "./operations/feature-pattern.js";

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
      } else if (profile.type === "regularPolygon") {
        const label = `sketches[${i}].profile`;
        strictObject(profile, label, ["type", "sides", "acrossFlats", "circumradius", "rotation", "center"]);
        const sides = number(profile.sides, `${label}.sides`, { min: 3, max: 64 });
        if (!Number.isInteger(sides)) fail(`${label}.sides must be an integer`);
        if ((profile.acrossFlats === undefined) === (profile.circumradius === undefined)) fail(`${label} needs exactly one of acrossFlats or circumradius`);
        const radius = profile.circumradius === undefined
          ? number(profile.acrossFlats, `${label}.acrossFlats`, { min: 0.002, max: MCP_PLAN_LIMITS.coordinate }) / 2 / Math.cos(Math.PI / sides)
          : number(profile.circumradius, `${label}.circumradius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        const start = number(profile.rotation ?? 0, `${label}.rotation`, { min: -360, max: 360 }) * Math.PI / 180;
        const [cx, cy] = profile.center === undefined ? [0, 0] : pair(profile.center, `${label}.center`);
        normalizedProfile = { type: "polygon", center: [cx, cy], points: Array.from({ length: sides }, (_, k) => [cx + radius * Math.cos(start + 2 * Math.PI * k / sides), cy + radius * Math.sin(start + 2 * Math.PI * k / sides)]) };
      } else if (profile.type === "roundedRect") {
        strictObject(profile, `sketches[${i}].profile`, ["type", "width", "height", "radius", "center"]);
        const width = number(profile.width, `sketches[${i}].profile.width`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        const height = number(profile.height, `sketches[${i}].profile.height`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
        const radius = number(profile.radius, `sketches[${i}].profile.radius`, { min: 0, max: Math.min(width, height) / 2 });
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
        fail(`sketches[${i}].profile.type must be circle, polygon, regularPolygon, roundedRect, or contour`);
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
    if (feature.target && !seenFeatures.has(feature.target)) fail(`Feature ${feature.id} must target an earlier body: an existing body, a primitive or an earlier new feature. Features run before operations; use a combine operation to cut an operation body`);
    if (feature.operation === "new") seenFeatures.add(feature.id);
  }
  const operations = rawOperations.map((raw, i) => {
    const operation = object(raw, `operations[${i}]`);
    const type = text(operation.type, `operations[${i}].type`);
    const id = text(operation.id, `operations[${i}].id`);
    if (featureIds.has(id) || primitiveIds.has(id)) fail(`Duplicate model id: ${id}`);
    if (!Object.hasOwn(OPERATION_TYPES, type)) fail(`operations[${i}].type must be import, group, mirror, pattern, pathPattern, featurePattern, transform, combine, modifier, fastener, gear, knurl, holePattern, phoneCradle, splitBody, setRole, gridfinity, pocket, or drawerLayout`);
    return OPERATION_TYPES[type].normalize(operation, `operations[${i}]`, { type, id, sketches });
  });
  const allIds = new Set([...existingBodyIds, ...primitiveIds, ...featureIds]);
  for (const operation of operations) {
    if (allIds.has(operation.id)) fail(`Duplicate model id: ${operation.id}`);
    if (operation.type === "group") {
      for (const member of operation.members) if (!allIds.has(member)) fail(`Group ${operation.id} references unknown or later body ${member}`);
    } else if (operation.type === "mirror" || operation.type === "pattern" || operation.type === "pathPattern") {
      if (!allIds.has(operation.source)) fail(`${operation.type === "mirror" ? "Mirror" : operation.type === "pathPattern" ? "Path pattern" : "Pattern"} ${operation.id} references unknown or later body ${operation.source}`);
    } else if (operation.type === "pocket" || operation.type === "setRole" || operation.type === "transform" || operation.type === "modifier" || operation.type === "holePattern" || operation.type === "featurePattern" || operation.type === "splitBody") {
      if (!allIds.has(operation.target)) fail(`${operation.type} ${operation.id} references unknown or later body ${operation.target}`);
    } else if (operation.type === "combine") {
      if (!allIds.has(operation.target) || !allIds.has(operation.tool)) fail(`Combine ${operation.id} references an unknown or later body`);
    }
    allIds.add(operation.id);
  }
  const inferredMode = features.length || sketches.length || operations.some((operation) => OPERATION_TYPES[operation.type].advanced) ? "advanced" : defaultMode || "beginner";
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
    if (radius === 0) {
      const square = [[right, bottom], [right, top], [left, top], [left, bottom]];
      square.forEach((start, i) => line(start, square[(i + 1) % 4]));
    } else for (let i = 0; i < corners.length; i++) {
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
  const profilePoint = definition.profile?.type !== "circle" && definition.profile?.center || [0, 0];
  return { sketch, profileRef: { key: sketch.ents.map((entity) => entity.id).sort().join(","), pt: profilePoint } };
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
  for (const operation of plan.operations) OPERATION_TYPES[operation.type].check?.(operation, doc);
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

  const context = { doc, plan, idFactory, addBody, bodyList, remember, createdBodyIds, affectedBodyIds, featureMods, pendingHolePatterns, pendingFeaturePatterns };
  for (const operation of plan.operations) OPERATION_TYPES[operation.type].build(operation, context);

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
