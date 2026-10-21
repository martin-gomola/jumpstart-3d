const obj = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const dimension = maximum => ({ type: "number", minimum: 0.1, maximum });

export const framePlanSchema = obj({
  name: { type: "string", minLength: 1, maxLength: 80 },
  modelId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$", minLength: 1, maxLength: 80 },
  outerWidth: dimension(500), outerDepth: dimension(500), height: dimension(100), wall: dimension(249.5),
  assumptions: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 240 } },
}, ["outerWidth", "outerDepth", "height"]);
