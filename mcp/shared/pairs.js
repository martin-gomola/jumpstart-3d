const id = { type: "string", minLength: 1, maxLength: 120 };
const nonnegative = (maximum) => ({ type: "number", minimum: 0, maximum });
export const pairCheckFields = {
  minimumClearance: { ...nonnegative(10000), description: "Minimum native solid set distance, in mm. Intentional contacts must be handled explicitly." },
  maximumOverlapVolume: { ...nonnegative(1e12), description: "Maximum intersection volume, in mm3. Zero distance alone does not distinguish contact from overlap." },
  distanceTolerance: { type: "number", minimum: 1e-8, maximum: 1, description: "Numerical comparison tolerance in mm; default 0.0001, not a manufacturing allowance." },
  volumeTolerance: { ...nonnegative(1), description: "Numerical comparison tolerance in mm3; default 0.000001." },
};
export const pairChecksSchema = { type: "object", additionalProperties: false, minProperties: 1, properties: pairCheckFields };
export const previewPairSchema = { type: "object", additionalProperties: false, required: ["id", "a", "b"], properties: { id, a: id, b: id, ...pairCheckFields } };

export function validatePairThresholds(checks) {
  if (checks.minimumClearance === undefined && checks.maximumOverlapVolume === undefined) throw new Error("Pair requirements need minimumClearance or maximumOverlapVolume");
}

export function evaluatePairChecks(measurement, expected) {
  validatePairThresholds(expected);
  const measured = measurement?.status === "measured" && [measurement.distanceMm, measurement.overlapVolumeMm3].every((value) => Number.isFinite(value) && value >= 0);
  const checks = [];
  if (expected.minimumClearance !== undefined) {
    const tolerance = expected.distanceTolerance ?? 0.0001;
    checks.push({ id: "minimumClearance", expected: expected.minimumClearance, measured: measured ? measurement.distanceMm : null, units: "mm", tolerance, pass: measured ? measurement.distanceMm + tolerance >= expected.minimumClearance : null });
  }
  if (expected.maximumOverlapVolume !== undefined) {
    const tolerance = expected.volumeTolerance ?? 0.000001;
    checks.push({ id: "maximumOverlapVolume", expected: expected.maximumOverlapVolume, measured: measured ? measurement.overlapVolumeMm3 : null, units: "mm3", tolerance, pass: measured ? measurement.overlapVolumeMm3 <= expected.maximumOverlapVolume + tolerance : null });
  }
  const passed = checks.every((check) => check.pass === true);
  return { status: passed ? "passed" : checks.some((check) => check.pass === false) ? "failed" : "unknown", passed, checks };
}
