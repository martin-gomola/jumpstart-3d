import { evaluatePairChecks, validatePairThresholds } from "../shared/pairs.js";
import { validateToolInput } from "../shared/schema.js";
import { requirementsSchema } from "../shared/requirements.js";
import { inspectGeometry } from "./inspection.js";

export function validateRequirements(requirements) {
  if (requirements === undefined) return;
  validateToolInput(requirements, requirementsSchema);
  const unique = (values, label) => { if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`); };
  unique(requirements.preserveBodyIds || [], "preserveBodyIds");
  unique((requirements.bodies || []).map(({ target }) => target), "Requirement targets");
  unique((requirements.pairs || []).map(({ id }) => id), "Pair requirement ids");
  for (const pair of requirements.pairs || []) {
    validatePairThresholds(pair);
    if (pair.a === pair.b) throw new Error("Pair operands must be two different bodies");
  }
  let visits = (requirements.pairs || []).reduce((sum, pair) => sum + Number(pair.minimumClearance !== undefined) + Number(pair.maximumOverlapVolume !== undefined), 0);
  for (const body of requirements.bodies || []) {
    unique(body.checks.map(({ id }) => id), `Requirement check ids for ${body.target}`);
    visits += body.checks.length;
  }
  if (visits > 64) throw new Error("Preview requirements exceed the 64-check limit");
}

export function evaluateRequirements(requirements, { document, featureBodyIds = {}, geometries, beforeSignatures, afterSignatures, pairResults = [] }) {
  validateRequirements(requirements);
  if (requirements === undefined) return undefined;
  const checks = [];
  if (requirements.bodyCount !== undefined) checks.push({ id: "bodyCount", kind: "bodyCount", expected: requirements.bodyCount, measured: document.bodies.length, pass: requirements.bodyCount === document.bodies.length });
  for (const bodyId of requirements.preserveBodyIds || []) {
    const before = beforeSignatures.get(bodyId), after = afterSignatures.get(bodyId);
    checks.push({ id: `preserve:${bodyId}`, kind: "sourcePreservation", bodyId, pass: before !== undefined && before === after, source: "native body definition, resolved geometry inputs and placement; not an exact geometry comparison" });
  }
  let triangleVisits = 0;
  for (const { target, checks: requested } of requirements.bodies || []) {
    const bodyId = featureBodyIds[target] ?? target;
    const geometry = typeof bodyId === "string" ? geometries.get(bodyId) : undefined;
    if (!geometry) {
      checks.push({ id: `target:${target}`, target, pass: null, error: "Requirement target has no single inspectable preview body" });
      continue;
    }
    triangleVisits += geometry.mesh.triangles.length / 3 * (1 + requested.reduce((sum, check) => sum + (check.kind === "channels" ? 104 : 2), 0));
    if (triangleVisits > 8000000) {
      checks.push({ id: `budget:${target}`, target, pass: null, error: "Requirements exceed the 8 million triangle-visit budget" });
      continue;
    }
    try {
      const inspection = inspectGeometry(geometry.mesh, { mesh: false, checks: requested });
      checks.push(...inspection.checks.map((check) => ({ ...check, target, bodyId })));
    } catch (error) { checks.push({ id: `inspect:${target}`, target, bodyId, pass: null, error: error.message }); }
  }
  for (const pair of requirements.pairs || []) {
    const measurement = pairResults.find(({ id }) => id === pair.id);
    const acceptance = evaluatePairChecks(measurement, pair);
    checks.push(...acceptance.checks.map((check) => ({ ...check, id: `pair:${pair.id}:${check.id}`, kind: "pair", pairId: pair.id, ...(measurement?.error ? { error: measurement.error } : {}) })));
  }
  const passed = checks.length > 0 && checks.every((check) => check.pass === true);
  return { status: passed ? "passed" : checks.some((check) => check.pass === false) ? "failed" : "unknown", passed, checks, physicalFit: "unverified", ...(requirements.pairs ? { pairs: pairResults } : {}) };
}

export function comparePreviewBodies(before, after, beforeSignatures, afterSignatures) {
  const added = [], removed = [], changed = [], unchanged = [], measurements = [];
  for (const bodyId of new Set([...beforeSignatures.keys(), ...afterSignatures.keys()])) {
    const kind = !beforeSignatures.has(bodyId) ? "added" : !afterSignatures.has(bodyId) ? "removed" : beforeSignatures.get(bodyId) === afterSignatures.get(bodyId) ? "unchanged" : "changed";
    ({ added, removed, changed, unchanged })[kind].push(bodyId);
    if (kind === "unchanged") continue;
    const a = before.get(bodyId), b = after.get(bodyId);
    const dimensionsDelta = a?.dimensions && b?.dimensions ? Object.fromEntries(["x", "y", "z"].map((axis) => [axis, b.dimensions[axis] - a.dimensions[axis]])) : null;
    measurements.push({ bodyId, change: kind, before: a ? { role: a.role, dimensions: a.dimensions, bounds: a.bounds, volume: a.volume } : null, after: b ? { role: b.role, dimensions: b.dimensions, bounds: b.bounds, volume: b.volume } : null, dimensionsDelta, volumeDelta: Number.isFinite(a?.volume) && Number.isFinite(b?.volume) ? b.volume - a.volume : null });
  }
  return { added, removed, changed, unchanged, measurements, coordinateSpace: "world", preservationEvidence: "source definitions and resolved inputs; no exact solid difference or physical fit certification" };
}
