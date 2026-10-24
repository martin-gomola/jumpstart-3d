export const GRIDFINITY_LIMITS = Object.freeze({ columns: 6, rows: 6, cells: 36, heightUnits: 12, dividers: 6 });
export const DEFAULT_BIN_LIMITS = Object.freeze({ columns: 4, rows: 4 });
export function normalizeBinLimits(value = DEFAULT_BIN_LIMITS) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["columns", "rows"].includes(key))) throw new Error("Bin limits must contain columns and rows only.");
  const result = {};
  for (const key of ["columns", "rows"]) {
    const amount = value[key] ?? DEFAULT_BIN_LIMITS[key];
    if (!Number.isInteger(amount) || amount < 1 || amount > GRIDFINITY_LIMITS[key]) throw new Error(`Maximum bin ${key === "columns" ? "width" : "depth"} must be 1 to ${GRIDFINITY_LIMITS[key]} cells.`);
    result[key] = amount;
  }
  return result;
}
