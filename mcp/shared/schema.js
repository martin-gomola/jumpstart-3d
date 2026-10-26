// The subset of JSON Schema used by the local tool contracts. Unknown input fails closed.
export function validateToolInput(value, schema, path = "arguments") {
  const fail = (message) => { throw new Error(`${path}: ${message}`); };
  if (schema.oneOf || schema.anyOf) {
    const candidates = schema.oneOf || schema.anyOf;
    const passed = candidates.filter((candidate) => {
      try { validateToolInput(value, candidate, path); return true; } catch { return false; }
    });
    if (!passed.length) {
      const { variant, label, hint } = explainShape(value, candidates);
      if (variant) {
        try { validateToolInput(value, variant, path); } catch (error) {
          throw /allowed input shape/.test(error.message) ? error : new Error(`${error.message} (does not match an allowed input shape${label})`);
        }
      }
      fail(`does not match an allowed input shape${hint || ""}`);
    }
    if (schema.oneOf && passed.length !== 1) fail("does not match an allowed input shape");
    return;
  }
  if (schema.const !== undefined && value !== schema.const) fail(`must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("reserved property");
      const child = schema.properties?.[key];
      if (!child && schema.additionalProperties === false) fail(`unknown property ${key}; allowed: ${Object.keys(schema.properties || {}).join(", ") || "none"}`);
      if (child || typeof schema.additionalProperties === "object") validateToolInput(value[key], child || schema.additionalProperties, `${path}.${key}`);
    }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    if (Object.keys(value).length < (schema.minProperties ?? 0) || Object.keys(value).length > (schema.maxProperties ?? Infinity)) fail("property count outside limits");
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail("item count outside limits");
    for (let i = 0; i < value.length; i++) validateToolInput(value[i], schema.items || {}, `${path}[${i}]`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) fail(`must be a finite ${schema.type}`);
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity)) fail("number outside limits");
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail("string outside limits");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("invalid string format");
  } else if (schema.type === "boolean" && typeof value !== "boolean") fail("must be a boolean");
}

const jsonType = (value) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value === "number" ? "number" : typeof value;
const schemaType = (schema) => schema.type === "integer" ? "number" : schema.type;
// Explain a failed oneOf: pick the variant named by `type`, or the only variant of the value's JSON type.
function explainShape(value, candidates) {
  const typed = candidates.filter((candidate) => candidate.properties?.type?.const !== undefined);
  if (jsonType(value) === "object" && typed.length === candidates.length) {
    const variant = typed.find((candidate) => candidate.properties.type.const === value.type);
    if (variant) return { variant, label: ` for type ${value.type}` };
    const nested = typed.flatMap((candidate) => Object.entries(candidate.properties)
      .filter(([, child]) => child.oneOf?.some((entry) => entry.properties?.type?.const === value.type))
      .map(([key]) => [candidate.properties.type.const, key]));
    const example = nested.length ? `; ${value.type} is a ${nested[0][0]}.${nested[0][1]}.type: { "type": "${nested[0][0]}", "${nested[0][1]}": { "type": "${value.type}", ... } }` : "";
    return { hint: `: type must be one of ${typed.map((candidate) => candidate.properties.type.const).join(", ")}${example}` };
  }
  const sameType = candidates.filter((candidate) => schemaType(candidate) === jsonType(value));
  if (sameType.length === 1) return { variant: sameType[0], label: "" };
  if (!sameType.length && candidates.every((candidate) => candidate.type)) {
    return { hint: `: expected ${candidates.map((candidate) => candidate.properties?.$expr ? '{ "$expr": "..." }' : candidate.type).join(" or ")}, got ${jsonType(value)}` };
  }
  return {};
}
