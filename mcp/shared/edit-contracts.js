const id = { type: "string", minLength: 1, maxLength: 120 };
const number = { type: "number", minimum: -10000, maximum: 10000 };
const vector = { type: "array", minItems: 3, maxItems: 3, items: number };
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
export const regionBoxSchema = object({ min: vector, max: vector }, ["min", "max"]);
export const protectedRegionSchema = object({ id, bodyId: id, box: regionBoxSchema,
  maximumChangedVolume: { type: "number", minimum: 0, maximum: 1e12 },
  volumeTolerance: { type: "number", minimum: 0, maximum: 1 },
}, ["id", "bodyId", "box"]);
export const editIntentSchema = object({ goal: { type: "string", minLength: 1, maxLength: 1000 },
  targetBodyIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: id },
  changeRegion: { ...regionBoxSchema, description: "World AABB allowed to change. Native material outside it must remain unchanged; unsupported comparisons block apply." },
}, ["goal", "targetBodyIds"]);
export const featureEditSchema = object({ bodyId: id, featureId: id, action: { type: "string", enum: ["update", "remove"] },
  values: object({ radius: number, distance: number, thickness: number, diameter: number, depth: number, position: vector }),
}, ["bodyId", "featureId", "action"]);
export function validateRegionBox(box) {
  if (!box || ![box.min, box.max].every(v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) || box.min.some((n, i) => n >= box.max[i])) throw new Error("Region box requires bounded min coordinates strictly below max");
  return box;
}
