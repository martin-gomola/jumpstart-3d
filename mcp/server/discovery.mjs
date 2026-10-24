// Filter copies only: discovery must never alter the schemas used for validation.
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
