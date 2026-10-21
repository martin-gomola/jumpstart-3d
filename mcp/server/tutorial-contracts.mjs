const obj = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", minLength: 1, maxLength: 120 };
const expression = { type: "string", minLength: 1, maxLength: 256 };
const coordinate = { type: "number", minimum: -10000, maximum: 10000 };
const positive = (maximum) => ({ type: "number", exclusiveMinimum: 0, maximum });
const point = { type: "array", minItems: 3, maxItems: 3, items: coordinate };
const name = { type: "string", minLength: 1, maxLength: 80 };
const common = { editorId: id, expectedRevision: id };
const preview = { ...common, includeImage: { type: "boolean" }, section: obj({ axis: { enum: ["X", "Y", "Z"] }, offset: coordinate, flip: { type: "boolean" } }, ["axis", "offset"]) };
const nativePlan = obj({
  name,
  parameters: { type: "array", minItems: 1, maxItems: 64, items: obj({ name: id, expression }, ["name", "expression"]) },
  rectangle: obj({ id, widthExpression: expression, heightExpression: expression, plane: { enum: ["XY", "XZ", "YZ"] }, origin: point }, ["id", "widthExpression", "heightExpression"]),
  extrude: obj({ id, distanceExpression: expression }, ["id", "distanceExpression"]),
}, ["parameters", "rectangle", "extrude"]);
const lathePlan = obj({
  name,
  blank: obj({ kind: { enum: ["square", "round"] }, length: positive(500), side: positive(250), diameter: positive(250) }, ["kind", "length"]),
  profile: { type: "array", minItems: 2, maxItems: 128, items: { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0, maximum: 500 } } },
  hollow: obj({ wall: positive(125), base: positive(500), end: { enum: ["tail", "head"] }, style: { enum: ["follow", "straight"] } }, ["wall", "base", "end", "style"]),
  scale: { type: "number", minimum: 0.01, maximum: 10 },
}, ["blank", "profile"]);

export const tutorialTools = [
  ["jumpstart_preview_native_model", "Preview native parametric CAD", "Create a native rectangle in a document with no bodies or sketches, with driving width/height dimensions and an expression-bound extrusion. Uses doc.params and the native constraint solver, not MCP template parameters. Apply previewId as one undoable edit.", obj({ ...preview, plan: nativePlan }, ["expectedRevision", "plan"])],
  ["jumpstart_preview_native_parameters", "Preview native parameter changes", "Revise existing native parameter values and rebuild their bound sketches and features. Reject invalid or silently skipped expressions; preview before applying.", obj({ ...preview, values: { type: "object", minProperties: 1, maxProperties: 64, additionalProperties: coordinate } }, ["expectedRevision", "values"])],
  ["jumpstart_preview_lathe", "Preview a native turned part", "Build a native Lathe mesh from a bounded cut-only axial radius profile using the editor's Lathe mesh and hollowing routines. Axial coordinates are 0..blank.length millimeters; output axis is Z. Persists an editable recipe; bodyId revises its unchanged owned body. This is declarative turning, not a simulated pedal/chisel session.", obj({ ...preview, plan: lathePlan, bodyId: id }, ["expectedRevision", "plan"])],
  ["jumpstart_start_tutorial", "Start tutorial checks on a blank design", "Bind a built-in tutorial to the current blank document without replacing it. Resets this MCP check session and observes actual native tutorial predicates over subsequent status calls.", obj({ ...common, tutorialId: id }, ["expectedRevision", "tutorialId"])],
  ["jumpstart_get_tutorial_status", "Inspect observed native tutorial checks", "Evaluate native automatic completion checks and retain checks observed earlier in this session. Manual or optional steps are not certified. Lathe final-body fallback predicates require separate independent geometry checks.", obj({ editorId: id })],
].map(([name, title, description, inputSchema]) => ({ name, title, description, inputSchema }));
