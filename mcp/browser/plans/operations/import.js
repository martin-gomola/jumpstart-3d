import { MCP_PLAN_LIMITS, fail, strictObject, text, triple } from "../plan-input.js";
import { matrixForTransform } from "../plan-geometry.js";

// Runs before any body is replaced, so an unusable asset leaves the document untouched.
export function check(operation, doc) {
  const asset = doc.assets?.[operation.assetId];
  if (!asset) fail(`Import ${operation.id} does not reference an asset supplied by the managed import catalog`);
  const name = String(asset.name || "");
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const format = ext === "stp" ? "step" : ext;
  if (!/^[^/\\]+\.(stl|3mf|step|stp)$/i.test(name) || !["stl", "3mf", "step"].includes(format) || !["mesh", "step"].includes(asset.kind)) fail(`Import ${operation.id} has an unsupported managed file type`);
  if (format === "stl" && !operation.units) fail(`Import ${operation.id} requires explicit STL units: mm, cm, or in`);
  if (format !== "stl" && operation.units !== undefined) fail(`Import ${operation.id} must preserve units encoded in its ${format.toUpperCase()} file`);
}

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "assetId", "units", "position", "rotation"]);
  const assetId = text(operation.assetId, `${label}.assetId`);
  if (!/^[a-f0-9]{64}$/.test(assetId)) fail(`${label}.assetId must be a SHA-256 id from jumpstart_list_imports`);
  if (operation.units !== undefined && !["mm", "cm", "in"].includes(operation.units)) fail(`${label}.units must be mm, cm, or in`);
  return { type, id, assetId, ...(operation.units === undefined ? {} : { units: operation.units }), position: triple(operation.position ?? [0, 0, 0], `${label}.position`), rotation: triple(operation.rotation ?? [0, 0, 0], `${label}.rotation`) };
}

export function build(operation, ctx) {
  const { doc, addBody, remember } = ctx;
  const asset = doc.assets[operation.assetId];
  const ext = String(asset.name || "").slice(String(asset.name || "").lastIndexOf(".") + 1).toLowerCase();
  const format = ext === "stp" ? "step" : ext;
  if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Import ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
  const scale = operation.units === "cm" ? 10 : operation.units === "in" ? 25.4 : 1;
  const node = { t: format === "step" ? "step" : "mesh", asset: operation.assetId, ...(format === "stl" ? { k: scale } : {}), mods: [] };
  const body = addBody(asset.name.replace(/\.(stl|3mf|step|stp)$/i, "") || "Imported model", node, matrixForTransform(operation.position, operation.rotation));
  remember(operation.id, [body]);
}
