import { featureEditSchema, regionBoxSchema } from "../shared/edit-contracts.js";
import { pairChecksSchema } from "../shared/pairs.js";
import { geometryCheckSchema, requirementsSchema } from "../shared/requirements.js";
import { frameTools } from "./frame-contracts.mjs";
import { drawingTools } from "./drawing-contracts.mjs";
import { tutorialTools } from "./tutorial-contracts.mjs";

const number = { type: "number", minimum: -10000, maximum: 10000 };
const positive = { type: "number", exclusiveMinimum: 0, maximum: 10000 };
const tolerance = { type: "number", minimum: 0.00000001, maximum: 1 };
const id = { type: "string", minLength: 1, maxLength: 120 };
const axis = { type: "string", enum: ["X", "Y", "Z"] };
const editorId = id;
const expectedRevision = id;
const point = { type: "array", minItems: 3, maxItems: 3, items: number };
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const section = { ...object({ axis, offset: number, flip: { type: "boolean" } }, ["axis", "offset"]), description: "Section image plane. Defaults to X through the middle of the proposal; detail previews omit the section image." };
const expr = object({ $expr: { type: "string", minLength: 1, maxLength: 256, description: "Named parameters with + - * / and parentheses, plus sin, cos, tan, asin, acos, atan, atan2 (degrees), sqrt, abs, min, max, round, floor and ceil." } }, ["$expr"]);
function references(schema) {
  if (schema.type === "number" || schema.type === "integer") return { oneOf: [schema, expr] };
  const result = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, references(value)]));
  if (schema.items) result.items = references(schema.items);
  if (schema.oneOf) result.oneOf = schema.oneOf.map(references);
  return result;
}

export function extendMcpTools(tools, basePlan) {
  const plan = references(basePlan);
  Object.assign(plan.properties, {
    modelId: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
    parameters: { type: "object", minProperties: 1, maxProperties: 64, additionalProperties: object({ value: number, expression: { type: "string", minLength: 1, maxLength: 256 }, unit: { type: "string", enum: ["mm", "deg", "count", "scalar"] }, min: number, max: number }, ["unit"]) },
    constraints: { type: "array", maxItems: 64, items: object({ id, left: { type: "string", maxLength: 256 }, right: { type: "string", maxLength: 256 }, operator: { type: "string", enum: ["gt", "gte", "lt", "lte", "eq"] }, message: { type: "string", maxLength: 256 } }, ["id", "left", "operator", "right"]) },
  });
  for (const tool of tools.filter((entry) => entry.name.startsWith("jumpstart_preview"))) Object.assign(tool.inputSchema.properties, { section, expectedRevision });
  tools.find((entry) => entry.name === "jumpstart_preview_model").inputSchema.properties.plan = plan;
  const extra = [
    ["jumpstart_preview_new_document", "Preview a new blank document", "Prepare a fresh native document without discarding the current design. Apply its previewId as one undoable edit; undo restores the previous document. No UI clicks or arbitrary document JSON.", object({ editorId, expectedRevision, name: { type: "string", minLength: 1, maxLength: 80 }, mode: { type: "string", enum: ["beginner", "advanced"] } }, ["expectedRevision"])],
    ["jumpstart_get_capabilities", "Discover modeling and inspection capabilities", "Read schemas, limits and unsupported geometry. Use includeSchemas false for a compact summary with planVocabulary (valid primitive, profile, feature, operation and modifier type ids), toolNames for selected tools, and operationTypes for selected plan.operations[].type values. Omitted filters preserve the full catalog. schemaPaths returns only the named subschemas of one tool (default jumpstart_preview_model), for example plan.sketches.profile.circle, plan.features or plan.operations.modifier.hole. Schemas share the number-or-expression object as $defs.expr.", object({ includeSchemas: { type: "boolean" }, toolNames: { type: "array", minItems: 1, maxItems: 32, items: id }, schemaPaths: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z$][\\w$]*(\\.[A-Za-z$][\\w$]*)*$" }, description: "Dot paths through properties; array items are entered automatically and oneOf variants are chosen by their type id." }, operationTypes: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", enum: basePlan.properties.operations.items.oneOf.map(variant => variant.properties.type.const) } } })],
    ["jumpstart_preview_parameters", "Preview named parameter revisions", "Regenerate a saved model from independent parameter values. Reject derived overrides, invalid constraints and external native edits. Returns parameter and feature diff; apply with previewId.", object({ editorId, expectedRevision, modelId: id, values: { type: "object", minProperties: 1, maxProperties: 64, additionalProperties: number }, includeImage: { type: "boolean" }, section }, ["expectedRevision", "modelId", "values"])],
    ["jumpstart_inspect_geometry", "Measure generated geometry", "Measure world-space tessellation independently of submitted CAD parameters: dimensions, plane sections, line/solid intervals, flat parallel channels, mesh checks and printability heuristics (overhang area and sampled thin walls for a +Z build), and with printOrientations a read-only ranking of print poses. Phone-cradle reports include axis intent and independently measured support connectivity; the preview cannot certify vehicle fit or printability. A previewId inspects its successful cached geometry without applying it.", object({ editorId, bodyId: id, previewId: id, expectedRevision, tolerance, mesh: { type: "boolean" }, section: object({ axis, offset: number }, ["axis", "offset"]), samples: { type: "array", maxItems: 16, items: object({ axis, point }, ["axis", "point"]) }, checks: { type: "array", maxItems: 8, items: geometryCheckSchema } }, ["bodyId"])],
    ["jumpstart_select_geometry", "Select native geometry by geometric predicates", "Query body-local native signatures by type, axis, extreme, coordinate, nearby point, plane normal, cylinder radius or external/internal material orientation. Returns candidates and ambiguity; never silently picks. Requires a current revision and rejects stale geometry fingerprints.", object({ editorId, bodyId: id, previewId: id, expectedRevision, expectedFingerprint: id, query: object({ kind: { type: "string", enum: ["edge", "face"] }, type: { type: "string", maxLength: 30 }, axis, extreme: { type: "string", enum: ["min", "max"] }, coordinate: number, near: point, tolerance, unique: { type: "boolean" }, external: { type: "boolean" }, radius: positive, normal: point }, ["kind"]) }, ["bodyId", "expectedRevision", "expectedFingerprint", "query"])],
    ["jumpstart_save_document", "Save the current local project", "Save the exact native document and parameter templates in browser-local project storage. No remote upload or version bump. Reject stale revisions or failed storage writes.", object({ editorId, expectedRevision }, ["expectedRevision"])],
    ["jumpstart_reopen_document", "Reopen the current saved local project", "Read the current project's saved local document through native serialization and restore it as a recoverable edit. Requires the same document id and current revision; retains undo history. Does not open arbitrary projects or accept arbitrary document JSON.", object({ editorId, expectedRevision, documentId: id }, ["expectedRevision", "documentId"])],
  ].map(([name, title, description, inputSchema]) => ({ name, title, description, inputSchema }));
  extra.find(tool => tool.name === "jumpstart_save_document").inputSchema.properties.versioned = { type: "boolean", description: "Save a new native version locally; default false. A versioned save changes the document revision." };
  extra.find(tool => tool.name === "jumpstart_inspect_geometry").inputSchema.properties.printOrientations = { ...object({ overhangAngle: { type: "number", minimum: 0, maximum: 89 }, baseZone: { type: "number", minimum: 0, maximum: 10 } }), description: "Read-only print pose advice: lay the six axis directions and the largest flat faces on the bed and rank them by overhang area, bed contact and height. Returns rotations; the document is unchanged." };
  extra.find(tool => tool.name === "jumpstart_inspect_geometry").inputSchema.properties.frame = { type: "object", additionalProperties: false, required: ["outerWidth", "outerDepth", "height", "wall"], properties: Object.fromEntries(["outerWidth", "outerDepth", "height", "wall"].map(name => [name, positive])) };
  extra.push({name:"jumpstart_preview_feature_edit",title:"Preview a targeted native feature edit",description:"Update or remove a supported top-level native modifier by feature id, or change a one-sided base extrusion distance ($base). Hole positions are body-local mm. Preserves body identity, role and unrelated source definitions. Managed templates, bound features and ambiguous topology are rejected; use parameter tools first. Inspect editing context and current geometry fingerprint before editing; apply the returned preview id explicitly.",inputSchema:object({editorId,expectedRevision,expectedFingerprint:id,edit:featureEditSchema,includeImage:{type:"boolean"},section},["expectedRevision","expectedFingerprint","edit","requirements"])});
  const all = [...tools, ...extra, ...tutorialTools, ...frameTools, ...drawingTools];
  for (const tool of all.filter(tool => tool.name.startsWith("jumpstart_preview_"))) Object.assign(tool.inputSchema.properties,{requirements:requirementsSchema,detail:regionBoxSchema,
    includeSelectors:{type:"boolean",description:"Default true; false omits body geometrySelectors."},
    includeFeatureTree:{type:"boolean",description:"Default true; false omits body featureTree."}});
  const inspector = all.find(tool => tool.name === "jumpstart_inspect_geometry");
  Object.assign(inspector.inputSchema.properties, {
    againstBodyId: { ...id, description: "Measure a native/STEP pair against this second body in the same current document or preview. Requires expectedRevision." },
    pairChecks: pairChecksSchema,
  });
  inspector.description += " With againstBodyId, also measure native solid distance, world witness points and intersection volume. Meshes are unsupported; incomplete queries are unknown. Optional pairChecks require minimumClearance and/or maximumOverlapVolume.";
  const document = all.find(tool => tool.name === "jumpstart_get_document");
  Object.assign(document.inputSchema.properties, {
    bodyIds: { type: "array", minItems: 1, maxItems: 128, items: id, description: "Return these existing bodies only; unknown ids are rejected. With geometry enabled, include only their referenced sketches." },
    includeSketches: { type: "boolean", description: "Default true; set false to omit sketch details." },
    includeSelectors: { type: "boolean", description: "With includeGeometry, defaults to true. Set false to omit edge/face arrays." },
    includeFeatureTree: { type: "boolean", description: "With includeGeometry, defaults to true. Set false to omit native feature trees." },
  });
  for (const tool of all) {
    const properties = tool.inputSchema.properties || {};
    for (const [key, schema] of Object.entries(properties)) {
      const description = PARAMETER_DESCRIPTIONS[`${tool.name}.${key}`] || PARAMETER_DESCRIPTIONS[key];
      if (description && !schema.description) properties[key] = { ...schema, description };
    }
    tool.annotations = { ...annotationsFor(tool.name), openWorldHint: false };
    if (OUTPUT_SCHEMAS[tool.name]) tool.outputSchema = OUTPUT_SCHEMAS[tool.name];
  }
  return all;
}

const PARAMETER_DESCRIPTIONS = {
  editorId: "From jumpstart_list_editors; optional with one open editor.",
  expectedRevision: "Revision from the latest document read, preview or apply; stale values are rejected.",
  previewId: "From a successful jumpstart_preview_* call in the same editor.",
  bodyId: "Body id from jumpstart_get_document, or from the preview's bodies when previewId is set.",
  expectedFingerprint: "geometryFingerprint of the body from jumpstart_get_document with includeGeometry true; changed geometry is rejected.",
  includeImage: "Default true; false skips images.",
  detail: "World box { min, max } for before/after detail images instead of a section.",
  plan: "Typed plan; read its schema with jumpstart_get_capabilities and schemaPaths.",
  values: "Parameter name to new value.",
  modelId: "modelId of a model previously applied with named parameters.",
  tutorialId: "Built-in tutorial id.",
  documentId: "Id of the current document from jumpstart_get_document.",
  mode: "Editor mode for the new document.",
  name: "Display name.",
  tolerance: "Comparison tolerance in mm.",
  mesh: "Default true. Set false to skip mesh validation.",
  samples: "Line samples through the body: each gives an axis and a point; returns solid intervals along that line.",
  checks: "Measured checks to evaluate against the tessellation.",
  frame: "Expected rectangular frame dimensions to verify.",
  includeSchemas: "Default true. Set false for the compact summary with planVocabulary.",
  toolNames: "Return schemas for these tools only.",
  operationTypes: "Return only these plan.operations[].type variants of jumpstart_preview_model.",
  "jumpstart_export_model.format": "stl, step or 3mf.",
  "jumpstart_export_model.name": "File name stem; a content hash and extension are appended.",
  "jumpstart_export_model.scope": "printable (default) exports design bodies; assembly adds hardware. References are never exported.",
  "jumpstart_export_model.bodyIds": "Export only these eligible bodies.",
  "jumpstart_select_geometry.query": "Predicate: kind edge or face plus optional type, axis, extreme, coordinate, near, normal, radius and external.",
  "jumpstart_preview_feature_edit.edit": "Feature id and the update or removal to preview.",
};

const READ_ONLY = { readOnlyHint: true };
function annotationsFor(name) {
  if (/^jumpstart_(list_|get_|inspect_|select_|preview_)/.test(name)) return READ_ONLY;
  return {
    jumpstart_apply_model: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    jumpstart_undo: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    jumpstart_export_model: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    jumpstart_render_drawing: READ_ONLY,
    jumpstart_export_drawing: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    jumpstart_save_document: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    jumpstart_reopen_document: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    jumpstart_start_tutorial: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }[name] || { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
}

const revisionOut = { type: "string", description: "Document revision after the call." };
const OUTPUT_SCHEMAS = {
  jumpstart_list_editors: { type: "object", required: ["editors"], properties: { editors: { type: "array", items: { type: "object", required: ["editorId", "documentId"], properties: { editorId: { type: "string" }, documentId: { type: "string" }, documentName: { type: "string" }, focused: { type: "boolean" }, connectionState: { type: "string" } } } } } },
  jumpstart_apply_model: { type: "object", required: ["applied", "previewId", "revision", "meshValidation"], properties: { applied: { type: "boolean" }, previewId: { type: "string" }, revision: revisionOut, bodyIds: { type: "array", items: { type: "string" } }, meshValidation: { type: "object", required: ["valid", "bodies"], properties: { valid: { type: "boolean" }, bodies: { type: "object" } } } } },
  jumpstart_undo: { type: "object", required: ["undone", "revision"], properties: { undone: { type: "boolean" }, revision: revisionOut, document: { type: "object" } } },
  jumpstart_save_document: { type: "object", required: ["saved", "documentId", "revision"], properties: { saved: { type: "boolean" }, documentId: { type: "string" }, revision: revisionOut, version: {} } },
  jumpstart_export_model: { type: "object", required: ["format", "revision", "path", "bodyIds", "byteLength", "sha256"], properties: { format: { type: "string" }, revision: revisionOut, path: { type: "string" }, bodyIds: { type: "array", items: { type: "string" } }, byteLength: { type: "integer" }, sha256: { type: "string" }, meshValidation: { type: "object", description: "STL only; bodies holds per-body results for multi-body files." } } },
  jumpstart_export_drawing: { type: "object", required: ["path", "sha256", "warnings"], properties: { path: { type: "string" }, sha256: { type: "string" }, warnings: { type: "array" } } },
};
