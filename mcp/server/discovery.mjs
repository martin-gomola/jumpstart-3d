// Filter copies only: discovery must never alter the schemas used for validation.
const isExpr = (node) => node?.type === "object" && node.properties?.$expr && Object.keys(node.properties).length === 1;
function shareExpr(node, defs) {
  if (Array.isArray(node)) return node.map((entry) => shareExpr(entry, defs));
  if (!node || typeof node !== "object") return node;
  if (isExpr(node)) { defs.expr = node; return { $ref: "#/$defs/expr" }; }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, shareExpr(value, defs)]));
}

function withSharedExpr(tool) {
  const defs = {};
  const inputSchema = shareExpr(tool.inputSchema, defs);
  if (defs.expr) inputSchema.$defs = defs;
  return { ...tool, inputSchema };
}

const constTypes = (variants) => variants.map((variant) => variant.properties.type.const);
const variantsOf = (node) => [...(node.oneOf || []), ...Object.values(node.properties || {}).flatMap((child) => child.oneOf || [])].filter((variant) => variant.properties?.type?.const);

function schemaAt(schema, path) {
  let node = schema;
  for (const key of path.split(".")) {
    if (node.items) node = node.items;
    const next = node.properties?.[key] ?? variantsOf(node).find((variant) => variant.properties.type.const === key);
    if (!next) {
      const available = [...Object.keys(node.properties || {}), ...variantsOf(node).map((variant) => variant.properties.type.const)];
      throw new Error(`Unknown schema path ${path} at ${key}; available: ${available.join(", ") || "none"}`);
    }
    node = next;
  }
  return node;
}
function planVocabulary(model) {
  const plan = model.inputSchema.properties.plan.properties;
  const operations = plan.operations.items.oneOf;
  return {
    primitiveKinds: plan.primitives.items.properties.kind.enum,
    profileTypes: constTypes(plan.sketches.items.properties.profile.oneOf),
    featureTypes: plan.features.items.properties.type.enum,
    operationTypes: constTypes(operations),
    modifierTypes: constTypes(operations.find((variant) => variant.properties.type.const === "modifier").properties.modifier.oneOf),
    guide: "plan.primitives[].kind, plan.sketches[].profile.type, plan.features[].type (sketch-based extrude/revolve/...), plan.operations[].type. Fillet, chamfer, offset, shell, hole, thread, emboss and scale are operations of type modifier with modifier.type. The operationTypes filter accepts operationTypes only. Features run before operations, so cut an operation body with combine. pocket only targets Gridfinity insert blanks; use a cut extrude or hole elsewhere.",
  };
}

const DEFERRED_OPERATIONS = {
  gridfinity: "Editable Gridfinity insert, bin or matching baseplate on the 42 mm grid.",
  pocket: "Measured vertical pocket cut into an unchanged Gridfinity insert.",
  drawerLayout: "Measured drawer filled with cell-aligned Gridfinity bins and optional baseplate tiles.",
  holePattern: "Grid or circle layout of round, square, hex or slot cuts on a flat body face.",
  phoneCradle: "Native angled phone cradle with plate, ribs and a stop.",
  gear: "Spur, rack or bevel gear by module and tooth count.",
  knurl: "Knurled round knob with optional round, hex or D bore; grows along +Z from position.",
  fastener: "Bolt, nut, threaded rod or cutter in metric or imperial sizes.",
};

// Compact tools/list copies; tools/call still validates against the full schemas.
export function publishTools(tools) {
  return tools.map((tool) => {
    const { inputSchema } = withSharedExpr(tool);
    if (tool.name.startsWith("jumpstart_preview_") && tool.name !== "jumpstart_preview_model" && inputSchema.properties?.requirements) {
      inputSchema.properties.requirements = { type: "object", description: `Optional acceptance requirements, same shape as jumpstart_preview_model requirements. Full schema: jumpstart_get_capabilities with toolNames ["${tool.name}"]. The server validates it in full.` };
    }
    if (inputSchema.properties?.drawing) inputSchema.properties.drawing = { type: "object", required: ["title"], description: 'Full schema: jumpstart_get_capabilities toolNames ["jumpstart_render_drawing"].' };
    const operations = inputSchema.properties?.plan?.properties?.operations?.items;
    if (operations?.oneOf) {
      operations.oneOf = operations.oneOf.map((variant) => {
        const type = variant.properties?.type?.const;
        if (!DEFERRED_OPERATIONS[type]) return variant;
        return { type: "object", required: variant.required, properties: { type: variant.properties.type }, description: `${DEFERRED_OPERATIONS[type]} Read its fields first: jumpstart_get_capabilities with schemaPaths ["plan.operations.${type}"]. The server validates it in full.` };
      });
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
  if (options.schemaPaths) {
    const targets = names ? selected : [model];
    if (operations || targets.length !== 1) throw new Error("schemaPaths reads one tool: pass at most one toolNames entry and no operationTypes");
    const [tool] = targets;
    delete result.toolSchemas;
    result.schemaFragments = options.schemaPaths.map((path) => {
      const defs = {};
      const schema = shareExpr(schemaAt(tool.inputSchema, path), defs);
      return { tool: tool.name, path, schema: defs.expr ? { ...schema, $defs: defs } : schema };
    });
  } else if (options.includeSchemas === false) {
    delete result.toolSchemas;
    result.availableTools = selected.map(({ name, title }) => ({ name, title }));
    result.planVocabulary = planVocabulary(model);
  } else {
    result.toolSchemas = selected.map((tool) => {
      const copy = structuredClone(tool);
      const plan = copy.inputSchema?.properties?.plan;
      if (operations && plan?.properties.operations) plan.properties.operations.items.oneOf = plan.properties.operations.items.oneOf.filter((variant) => operations.includes(variant.properties.type.const));
      return withSharedExpr(copy);
    });
  }
  if (names || operations || options.schemaPaths || options.includeSchemas === false) result.discovery = { totalTools: capabilities.toolSchemas.length, returnedTools: selected.length, ...(operations ? { operationTypes: operations } : {}) };
  return result;
}
