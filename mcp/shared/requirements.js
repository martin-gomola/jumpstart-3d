import { protectedRegionSchema, editIntentSchema } from "./edit-contracts.js";
import { previewPairSchema } from "./pairs.js";
// The same bounded acceptance contract is validated by the broker and browser.
const id = { type: "string", minLength: 1, maxLength: 120 };
const number = { type: "number", minimum: -10000, maximum: 10000 };
const positive = { type: "number", exclusiveMinimum: 0, maximum: 10000 };
const tolerance = { type: "number", minimum: 0.00000001, maximum: 1 };
const axis = { type: "string", enum: ["X", "Y", "Z"] };
const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
export const geometryCheckSchema = { oneOf: [
  object({ id, kind: { const: "dimension" }, axis, expected: positive, tolerance }, ["id", "kind", "axis", "expected"]),
  object({ id, kind: { const: "bound" }, axis, side: { type: "string", enum: ["min", "max"] }, expected: number, tolerance }, ["id", "kind", "axis", "side", "expected"]),
  object({ id, kind: { const: "components" }, expected: { type: "integer", minimum: 1, maximum: 128 } }, ["id", "kind", "expected"]),
  object({ id, kind: { const: "channels" }, axis: { type: "string", enum: ["X", "Y"] }, crossAt: number, tolerance,
    expected: { ...object({ count: { type: "integer", minimum: 1, maximum: 24 }, width: positive, depth: positive, floor: positive, spacing: positive, symmetric: { type: "boolean" }, openEnds: { type: "boolean" } }, []), minProperties: 1 } }, ["id", "kind", "axis", "crossAt", "expected"]),
  { description: "Heuristic print check along world +Z, bed at the body's lowest Z. Give maxOverhangArea and/or minWall.", ...object({ id, kind: { const: "printability" },
    overhangAngle: { type: "number", minimum: 0, maximum: 89, description: "Degrees from vertical a downward face may lean without support; default 45." },
    maxOverhangArea: { type: "number", minimum: 0, maximum: 100000000, description: "Allowed unsupported downward area in mm²." },
    baseZone: { type: "number", minimum: 0, maximum: 10, description: "Downward faces wholly within this height above the bed count as base overhang, not overhang; default 1 mm." },
    minWall: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Thinnest acceptable wall in mm, probed along inward normals." },
    maxThinWallArea: { type: "number", minimum: 0, maximum: 100000000, description: "Allowed surface area over walls thinner than minWall in mm²; default 0." } }, ["id", "kind"]) },
] };
export const requirementsSchema = { description: "Acceptance contract for this preview. All attached checks must pass before apply; resubmit requirements on later revisions.", ...object({
  intent: editIntentSchema,
  preserveRegions: { type: "array", minItems: 1, maxItems: 8, items: protectedRegionSchema, description: "Compare baseline and candidate native material inside world AABB regions. Defaults to zero permitted changed volume. Failed or unknown blocks apply." },
  pairs: { type: "array", minItems: 1, maxItems: 8, items: previewPairSchema, description: "Native/STEP body pairs measured within this preview; each pair needs a clearance and/or overlap requirement." },
  bodyCount: { type: "integer", minimum: 0, maximum: 128, description: "Total candidate document bodies, including hidden bodies and hole tools." },
  preserveBodyIds: { type: "array", minItems: 1, maxItems: 128, items: id, description: "Existing bodies whose source definitions, resolved geometry inputs, and placements must remain unchanged. This is not an exact solid-volume comparison." },
  bodies: { type: "array", minItems: 1, maxItems: 16, items: object({
    target: { ...id, description: "Plan body reference or existing native body id. Must resolve to one body." },
    checks: { type: "array", minItems: 1, maxItems: 8, items: geometryCheckSchema },
  }, ["target", "checks"]) },
}, []), minProperties: 1 };
