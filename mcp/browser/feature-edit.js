import { validateToolInput } from "../shared/schema.js";
import { featureEditSchema } from "../shared/edit-contracts.js";
const fields = { fillet: { radius: "r" }, chamfer: { distance: "d" }, offset: { distance: "d" }, shell: { thickness: "th" }, hole: { diameter: "dia", depth: "depth", position: "position" } };
function availableFields(mod) {
  const names=Object.keys(mod.sets?.length ? {} : fields[mod.t] || {});
  return names.filter(name=>!(mod.t === "hole" && (name === "depth" && mod.through !== false || name === "position" && !(mod.at?.length===1 || !mod.at && mod.p))));
}
export function featureEditContext(document, body) {
  const model = document.mcpModels?.find(m => m.bodyIds?.includes(body.id));
  let special = body.mcpGridfinity || body.mcpDrawerLayout || body.mcpLathe || body.mcpPhoneCradle;
  let mesh = false, expressions = false;
  if (!special && !model) JSON.stringify(body.node, (k, v) => { if (k === "t" && ["mesh", "step"].includes(v)) mesh = true; if (k === "exprs" && v && Object.values(v).some(x=>typeof x === "string" && x.trim())) expressions = true; return v; });
  const dependents = special || model ? [] : document.bodies.filter(b => b.id !== body.id && JSON.stringify(b.node).includes(`"srcBody":"${body.id}"`)).map(b => b.id);
  const blocked = body.locked || body.hidden || body.hole || mesh || special || expressions || model || dependents.length;
  const features = [{ id: "$base", kind: body.node?.t, fields: body.node?.t === "extrude" && body.node.mode === "one" ? ["distance"] : [], values: body.node?.t === "extrude" ? {distance:body.node.dist} : {}, removable: false },
    ...(body.node?.mods || []).slice(0,128).map(m => ({ id: m.id, kind: m.t, fields: availableFields(m), values: Object.fromEntries(availableFields(m).map(name=>[name,name === "position" ? m.at?.[0]?.p || m.p : m[fields[m.t][name]]])), removable: !!fields[m.t] && !m.sets?.length }))];
  return { representation: mesh ? "imported_or_mesh" : model ? "parameter_template" : special || expressions ? "managed_or_bound_native" : "native",
    preferredTool: model ? "jumpstart_preview_parameters" : expressions ? "jumpstart_preview_native_parameters" : body.mcpLathe ? "jumpstart_preview_lathe" : body.mcpGridfinity || body.mcpDrawerLayout || body.mcpPhoneCradle ? "jumpstart_preview_model" : blocked ? "jumpstart_get_capabilities" : features.some(f=>f.fields.length && typeof f.id === "string") ? "jumpstart_preview_feature_edit" : "jumpstart_preview_resize_body",
    ...(model ? { modelId: model.id } : {}), editable: !blocked,
    features: features.map(f => ({ ...f, editable: !blocked && typeof f.id === "string" && (f.fields.length > 0 || f.removable) })),
    dependentBodyIds: dependents, truncated: (body.node?.mods?.length || 0)>128,
    limits: "Top-level modifiers and one-sided base extrusion only. No automatic topology remapping; downstream selectors must remain valid." };
}
export function compileFeatureEdit(document, edit) {
  validateToolInput(edit, featureEditSchema);
  const input = document.bodies.find(b => b.id === edit.bodyId);
  if (!input) throw new Error("Feature edit body does not exist");
  const context = featureEditContext(document, input);
  if (!context.editable) throw new Error(`Use ${context.preferredTool} for this ${context.representation} body; native edit would bypass its ownership or bindings`);
  const doc = structuredClone(document), body = doc.bodies.find(b => b.id === edit.bodyId);
  const base = edit.featureId === "$base";
  const matches = base ? [body.node] : (body.node.mods || []).filter(m => m.id === edit.featureId);
  if (matches.length !== 1) throw new Error("Feature id is missing or ambiguous; reread this body's feature context");
  const feature = matches[0], allowed = base && feature.t === "extrude" && feature.mode === "one" ? { distance: "dist" } : base ? {} : fields[feature.t] || {};
  if (!Object.keys(allowed).length) throw new Error("This native feature is not supported for targeted editing");
  if (feature.sets?.length) throw new Error("Variable-radius feature sets require a dedicated edit; a single radius cannot replace them");
  const before = structuredClone(feature);
  if (edit.action === "remove") {
    if (base || edit.values !== undefined) throw new Error("Remove supports a modifier id and no values; the base feature cannot be removed");
    body.node.mods = body.node.mods.filter(m => m.id !== edit.featureId);
  } else {
    if (!edit.values || !Object.keys(edit.values).length) throw new Error("Update requires at least one supported numeric value");
    for (const [name, value] of Object.entries(edit.values)) {
      if (!allowed[name]) throw new Error(`Feature ${feature.t} does not support changing ${name}`);
      if (name === "position") {
        if (feature.at) {
          if (feature.at.length !== 1) throw new Error("Position editing requires a single hole location");
          feature.at[0].p = [...value];
        } else if (feature.p) feature.p = [...value];
        else throw new Error("Hole location is not available");
        continue;
      }
      if (value === 0 || (feature.t !== "offset" && value < 0) || Math.abs(value) > 10000) throw new Error(`${name} requires a bounded nonzero ${feature.t === "offset" ? "signed" : "positive"} dimension`);
      if (feature.t === "hole" && name === "depth" && feature.through !== false) throw new Error("Depth editing requires a blind hole");
      feature[allowed[name]] = value;
    }
  }
  return { document: doc, createdBodyIds: [], affectedBodyIds: [body.id], featureBodyIds: { [body.id]: body.id },
    edit: { ...structuredClone(edit), before, after: edit.action === "remove" ? null : structuredClone(feature) } };
}
