import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, AXES, fail, strictObject, text, number, triple, newId } from "../plan-input.js";
import { IDENTITY, rotationMatrix, matrixMultiply, matrixForTransform, matrixInverse } from "../plan-geometry.js";

export function patternableFeature(mod, document) {
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

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "features", "mode", "axis", "count", "spacing", "symmetric", "angle", "origin"]);
  const mode = text(operation.mode, `${label}.mode`);
  if (!["linear", "circular"].includes(mode)) fail(`${label}.mode must be linear or circular`);
  if (!Array.isArray(operation.features) || operation.features.length < 1 || operation.features.length > MCP_PLAN_LIMITS.patternFeatureRefs) fail(`${label}.features must contain 1 to ${MCP_PLAN_LIMITS.patternFeatureRefs} stable feature references`);
  const features = operation.features.map((feature, j) => text(feature, `${label}.features[${j}]`));
  if (new Set(features).size !== features.length) fail(`${label}.features must not contain duplicates`);
  if (operation.symmetric !== undefined && typeof operation.symmetric !== "boolean") fail(`${label}.symmetric must be a boolean`);
  const axis = text(operation.axis, `${label}.axis`).toUpperCase();
  if (!AXES.has(axis)) fail(`${label}.axis must be X, Y, or Z`);
  const count = number(operation.count, `${label}.count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
  if (!Number.isInteger(count)) fail(`${label}.count must be an integer`);
  const copies = mode === "linear" && operation.symmetric === true ? count * 2 - 2 : count - 1;
  if (features.length * copies > MCP_PLAN_LIMITS.patternFeatureCopies) fail(`${label} would create more than ${MCP_PLAN_LIMITS.patternFeatureCopies} feature copies`);
  return { type, id, target: text(operation.target, `${label}.target`), features, mode, axis, count,
    ...(mode === "linear" ? { spacing: number(operation.spacing, `${label}.spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), symmetric: operation.symmetric === true } : { angle: number(operation.angle ?? 360, `${label}.angle`, { min: 1, max: 360 }), origin: triple(operation.origin ?? [0, 0, 0], `${label}.origin`) }) };
}

export function build(operation, ctx) {
  const { doc, bodyList, remember, affectedBodyIds, featureMods, pendingHolePatterns, pendingFeaturePatterns } = ctx;
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
}
