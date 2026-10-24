// Resolves both operands against one captured preview/current geometry map.
export async function inspectNativePairs(pairs, geometries, featureBodyIds, kernel) {
  const resolved = new Map(), pending = [];
  const fail = (pair, error) => ({ id: pair.id, a: pair.a, b: pair.b, status: "unknown", error, distanceMm: null, overlapVolumeMm3: null, physicalFit: "unverified" });
  for (const pair of pairs) {
    const a = featureBodyIds?.[pair.a] ?? pair.a, b = featureBodyIds?.[pair.b] ?? pair.b;
    const first = typeof a === "string" ? geometries.get(a)?.nativeBody : undefined;
    const second = typeof b === "string" ? geometries.get(b)?.nativeBody : undefined;
    let error;
    if (!first || !second) error = "Pair operands must each resolve to one inspectable body in the same revision";
    else if (a === b) error = "Pair operands must be two different bodies";
    else {
      let mesh = false;
      JSON.stringify([first, second], (key, value) => { if (key === "t" && value === "mesh") mesh = true; return value; });
      if (mesh) error = "Mesh and recipe-mesh pair inspection is unsupported; native CAD or STEP solids are required";
    }
    if (error) resolved.set(pair.id, fail(pair, error));
    else pending.push({ id: pair.id, a: first, b: second, bodyA: a, bodyB: b });
  }
  if (pending.length) {
    let measurements;
    try { measurements = await kernel.inspectPairs(pending.map(({ id, a, b }) => ({ id, a, b }))); }
    catch (error) { measurements = pending.map(({ id }) => ({ id, status: "unknown", error: error.message })); }
    for (const pair of pending) {
      const result = Array.isArray(measurements) ? measurements.find(({ id }) => id === pair.id) : undefined;
      const point = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
      const complete = result?.status === "measured" && [result.distanceMm, result.overlapVolumeMm3].every((value) => Number.isFinite(value) && value >= 0) && point(result.witnessPoints?.a) && point(result.witnessPoints?.b);
      resolved.set(pair.id, complete ? { ...result, a: pair.bodyA, b: pair.bodyB } : { ...fail(pair, result?.error || "Native pair query returned no complete measurement"), a: pair.bodyA, b: pair.bodyB });
    }
  }
  return pairs.map((pair) => resolved.get(pair.id));
}
