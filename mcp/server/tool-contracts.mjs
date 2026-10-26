import { featureEditSchema, regionBoxSchema } from "../shared/edit-contracts.js";
import { pairChecksSchema } from "../shared/pairs.js";
import { geometryCheckSchema, requirementsSchema } from "../shared/requirements.js";
import { frameTools } from "./frame-contracts.mjs";
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
const section = object({ axis, offset: number, flip: { type: "boolean" } }, ["axis", "offset"]);
const expr = object({ $expr: { type: "string", minLength: 1, maxLength: 256 } }, ["$expr"]);
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
  tools.find((entry) => entry.name === "jumpstart_preview_model").description += " Numeric fields can use {$expr: 'diameter / 2'} with persisted named parameters. Returns top, side and isometric images with a labeled world-axis triad, plus an optional section image; restores camera and section state. Phone-cradle previews label +Y toward the dashboard and report the screen-facing direction.";
  const extra = [
    ["jumpstart_preview_new_document", "Preview a new blank document", "Prepare a fresh native document without discarding the current design. Apply its previewId as one undoable edit; undo restores the previous document. No UI clicks or arbitrary document JSON.", object({ editorId, expectedRevision, name: { type: "string", minLength: 1, maxLength: 80 }, mode: { type: "string", enum: ["beginner", "advanced"] } }, ["expectedRevision"])],
    ["jumpstart_get_capabilities", "Discover modeling and inspection capabilities", "Read schemas, limits and unsupported geometry. Use includeSchemas false for a compact summary, toolNames for selected tools, and operationTypes for selected plan operations. Omitted filters preserve the full catalog.", object({ includeSchemas: { type: "boolean" }, toolNames: { type: "array", minItems: 1, maxItems: 32, items: id }, operationTypes: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", enum: basePlan.properties.operations.items.oneOf.map(variant => variant.properties.type.const) } } })],
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
  const all = [...tools, ...extra, ...tutorialTools, ...frameTools];
  for (const tool of all.filter(tool => tool.name.startsWith("jumpstart_preview_"))) Object.assign(tool.inputSchema.properties,{requirements:requirementsSchema,detail:regionBoxSchema});
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
  return all;
}
