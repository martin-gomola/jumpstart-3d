// Filter copies only: discovery must never alter the schemas used for validation.
const isExpr = (node) => node?.type === "object" && node.properties?.$expr && Object.keys(node.properties).length === 1;
function shareExpr(node, defs) {
  if (Array.isArray(node)) return node.map((entry) => shareExpr(entry, defs));
  if (!node || typeof node !== "object") return node;
  if (isExpr(node)) { defs.expr = node; return { $ref: "#/$defs/expr" }; }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, shareExpr(value, defs)]));
}

// Compact tools/list copies; tools/call still validates against the full schemas.
export function publishTools(tools) {
  return tools.map((tool) => {
    const defs = {};
    const inputSchema = shareExpr(tool.inputSchema, defs);
    if (defs.expr) inputSchema.$defs = defs;
    if (tool.name.startsWith("jumpstart_preview_") && tool.name !== "jumpstart_preview_model" && inputSchema.properties?.requirements) {
      inputSchema.properties.requirements = { type: "object", description: `Optional acceptance requirements, same shape as jumpstart_preview_model requirements. Full schema: jumpstart_get_capabilities with toolNames ["${tool.name}"]. The server validates it in full.` };
    }
    return { ...tool, inputSchema };
  });
}

export function focusCapabilities(capabilities, options = {}) {
  const names = options.toolNames;
  for (const name of names || []) if (!capabilities.toolSchemas.some((tool) => tool.name === name)) throw new Error(`Unknown capability tool: ${name}`);
  const operations = options.operationTypes;
  const model = capabilities.toolSchemas.find((tool) => tool.name === "jumpstart_preview_model");
  const variants = model.inputSchema.properties.plan.properties.operations.items.oneOf;
  for (const type of operations || []) if (!variants.some((variant) => variant.properties.type.const === type)) throw new Error(`Unsupported plan operation type: ${type}`);
  const selected = capabilities.toolSchemas.filter((tool) => names ? names.includes(tool.name) : operations ? tool.name === model.name : true);
  if (operations && !selected.some((tool) => tool.inputSchema?.properties?.plan?.properties?.operations)) throw new Error("Selected tools do not accept plan operations");
  const result = { ...capabilities };
  if (options.includeSchemas === false) {
    delete result.toolSchemas;
    result.availableTools = selected.map(({ name, title }) => ({ name, title }));
  } else if (names || operations) {
    result.toolSchemas = selected.map((tool) => {
      const copy = structuredClone(tool);
      const plan = copy.inputSchema.properties.plan;
      if (operations && plan?.properties.operations) plan.properties.operations.items.oneOf = plan.properties.operations.items.oneOf.filter((variant) => operations.includes(variant.properties.type.const));
      return copy;
    });
  }
  if (names || operations || options.includeSchemas === false) result.discovery = { totalTools: capabilities.toolSchemas.length, returnedTools: selected.length, ...(operations ? { operationTypes: operations } : {}) };
  return result;
}
