// Pocket dimensions from the pinned MIT Gridfinity interface reference, in mm.
export const DEFAULT_MAGNET_POCKETS = Object.freeze({ diameter: 6.5, depth: 2.4 });
export const MAGNET_CARRIER_FLOOR = 0.8;

export function normalizeMagnetPockets(value, label = "magnets") {
  if (value === undefined || value === false) return false;
  if (value === true) return { ...DEFAULT_MAGNET_POCKETS };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a boolean or pocket dimensions`);
  for (const key of Object.keys(value)) if (!["diameter", "depth"].includes(key)) throw new Error(`${label}.${key} is unsupported`);
  const diameter = value.diameter ?? DEFAULT_MAGNET_POCKETS.diameter, depth = value.depth ?? DEFAULT_MAGNET_POCKETS.depth;
  if (!Number.isFinite(diameter) || diameter < 2 || diameter > 8) throw new Error(`${label}.diameter must be between 2 and 8 mm to preserve the foot walls`);
  if (!Number.isFinite(depth) || depth < 0.5 || depth > 4) throw new Error(`${label}.depth must be between 0.5 and 4 mm to preserve the base`);
  return { diameter, depth };
}

export function magnetCarrierHeight(config) {
  const magnets = normalizeMagnetPockets(config);
  return magnets ? magnets.depth + MAGNET_CARRIER_FLOOR : 0;
}

export function magnetCenters(columns, rows) {
  const centers = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
    centers.push([(x - (columns - 1) / 2) * 42 + sx * 13, (y - (rows - 1) / 2) * 42 + sy * 13]);
  }
  return centers;
}
