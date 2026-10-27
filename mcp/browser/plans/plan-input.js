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

export const AXES = new Set(["X", "Y", "Z"]);

export function fail(message) {
  throw new Error(message);
}

export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

export function strictObject(value, label, keys) {
  const result = object(value, label);
  const allowed = new Set(keys);
  const unknown = Object.keys(result).find((key) => !allowed.has(key));
  if (unknown) fail(`${label}.${unknown} is not supported`);
  return result;
}

export function text(value, label, fallback) {
  const v = value === undefined ? fallback : value;
  if (typeof v !== "string" || !v.trim() || v.length > 80) fail(`${label} must be a non-empty string of at most 80 characters`);
  return v.trim();
}

export function number(value, label, { min = -MCP_PLAN_LIMITS.coordinate, max = MCP_PLAN_LIMITS.coordinate } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function pair(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must contain two numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

export function triple(value, label) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label} must contain three numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

export function newId(prefix) {
  return `${prefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
}
