import { GRIDFINITY_LIMITS } from "./gridfinity-limits.js";
// Numeric allowance for tessellation/kernel bounds; not a manufacturing clearance.
export const PRINT_FIT_TOLERANCE = 0.001;
export const PRINT_AREA_PRESETS = Object.freeze([
  { name: "Main nozzle", width: 256, depth: 256, height: 260, edgeMargin: 2 },
  { name: "Auxiliary nozzle", width: 235.5, depth: 256, height: 256, edgeMargin: 2 },
]);
export function normalizePrintArea(value) {
  if (value === undefined || value === false) return false;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["name", "width", "depth", "height", "edgeMargin"].includes(key))) throw new Error("Print area accepts name, width, depth, height and edgeMargin only.");
  const result = {};
  for (const [key, min, max] of [["width", 1, 2000], ["depth", 1, 2000], ["height", 1, 2000], ["edgeMargin", 0, 20]]) {
    const amount = value[key] ?? (key === "edgeMargin" ? 2 : undefined);
    if (!Number.isFinite(amount) || amount < min || amount > max) throw new Error(`Print area ${key} must be between ${min} and ${max} mm.`);
    result[key] = amount;
  }
  if (result.width <= result.edgeMargin * 2 || result.depth <= result.edgeMargin * 2) throw new Error("Print area reserve must leave a positive usable bed area.");
  if (value.name !== undefined) {
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) throw new Error("Printer name must contain 1 to 80 characters.");
    result.name = value.name.trim();
  }
  return result;
}
export function baseplateTileLimits(value, grid) {
  const area = normalizePrintArea(value);
  if (!area) return { columns: 4, rows: 4 };
  const columns = Math.min(GRIDFINITY_LIMITS.columns, Math.floor((area.width - area.edgeMargin * 2 + 1e-8) / 42));
  const rows = Math.min(GRIDFINITY_LIMITS.rows, Math.floor((area.depth - area.edgeMargin * 2 + 1e-8) / 42));
  if (columns < 1 || rows < 1) throw new Error("The usable printer area must fit at least one 42 mm baseplate cell after the edge reserve.");
  if (grid && Math.ceil(grid.columns / rows) * Math.ceil(grid.rows / columns) < Math.ceil(grid.columns / columns) * Math.ceil(grid.rows / rows)) return { columns: rows, rows: columns };
  return { columns, rows };
}
export function checkPrintFit(value, width, depth, height, name = "Part") {
  const area = normalizePrintArea(value);
  if (!area) return { configured: false };
  if (![width, depth, height].every(amount => Number.isFinite(amount) && amount > 0)) throw new Error("Print fit requires finite positive measured dimensions.");
  const w = area.width - area.edgeMargin * 2, d = area.depth - area.edgeMargin * 2;
  const direct = width <= w + PRINT_FIT_TOLERANCE && depth <= d + PRINT_FIT_TOLERANCE;
  const rotated = depth <= w + PRINT_FIT_TOLERANCE && width <= d + PRINT_FIT_TOLERANCE;
  if ((!direct && !rotated) || height > area.height + PRINT_FIT_TOLERANCE) throw new Error(`${name} (${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} mm) exceeds the usable printer area ${w.toFixed(1)} × ${d.toFixed(1)} × ${area.height.toFixed(1)} mm. Resize the part or change Gridfinity Settings.`);
  return { configured: true, rotation: direct ? 0 : 90, width, depth, height, usableWidth: w, usableDepth: d, usableHeight: area.height };
}
