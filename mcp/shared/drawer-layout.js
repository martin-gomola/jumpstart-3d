import { normalizeOpenSides, binTotalHeight } from "./gridfinity-walls.js";
import { normalizePrintArea, baseplateTileLimits, checkPrintFit } from "./print-area.js";
import { normalizeCornerSpacers, cornerSpacerParts } from "./drawer-spacers.js";
import { GRIDFINITY_LIMITS, normalizeBinLimits } from "./gridfinity-limits.js";
// Drawer planning uses grid cells; the native Gridfinity generator owns interface geometry.
import { normalizeMagnetPockets, magnetCarrierHeight } from "./gridfinity-magnets.js";
export const DRAWER_LIMITS = Object.freeze({ axisCells: 20, cells: 144, bins: 16, partCells: GRIDFINITY_LIMITS.columns, baseplateTileCells: 4 });
export const GRID_PITCH = 42;
export const drawerBinBaseZ = drawer => drawer.includeBaseplate === false ? 0 : magnetCarrierHeight(drawer.baseplateMagnets) + 0.25;
const fail = message => { throw new Error(`Drawer layout: ${message}`); };
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} is unsupported`);
  return value;
}
function number(value, min, max, label, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) fail(`${label} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  return value;
}
function text(value, label, fallback) {
  const s = value === undefined ? fallback : value;
  if (typeof s !== "string" || !s.trim() || s.length > 80) fail(`${label} must contain 1 to 80 characters`);
  return s.trim();
}
export function drawerMetrics(drawer) {
  const columns = Math.floor(drawer.width / GRID_PITCH), rows = Math.floor(drawer.depth / GRID_PITCH);
  const occupied = (drawer.bins || []).reduce((sum, bin) => sum + bin.columns * bin.rows, 0);
  return { columns, rows, gridWidth: columns * GRID_PITCH, gridDepth: rows * GRID_PITCH,
    spareWidth: drawer.width - columns * GRID_PITCH, spareDepth: drawer.depth - rows * GRID_PITCH,
    occupied, total: columns * rows, fill: columns * rows ? Math.round(occupied / (columns * rows) * 100) : 0 };
}
export function placementError(drawer, candidate, ignoreId) {
  const { columns, rows } = drawerMetrics(drawer);
  if (![candidate.x, candidate.y, candidate.columns, candidate.rows].every(Number.isInteger)) return "Place bins on whole grid cells.";
  const limits = normalizeBinLimits(drawer.binLimits);
  if (candidate.columns < 1 || candidate.rows < 1 || candidate.columns > limits.columns || candidate.rows > limits.rows) return `Bin exceeds the configured ${limits.columns} × ${limits.rows} cell limit. Adjust Gridfinity Settings.`;
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.columns > columns || candidate.y + candidate.rows > rows) return "Keep the bin inside the drawer grid.";
  try { checkPrintFit(drawer.printArea, candidate.columns * 42 - 0.5, candidate.rows * 42 - 0.5, candidate.kind === "insert" ? (candidate.heightUnits ?? 2) * 7 : binTotalHeight({ ...candidate, heightUnits: candidate.heightUnits ?? 2, floor: drawer.floor ?? 2 }), candidate.label || "Bin"); } catch (error) { return error.message; }
  const overlap = (drawer.bins || []).find(bin => bin.id !== ignoreId && bin.x < candidate.x + candidate.columns && bin.x + bin.columns > candidate.x && bin.y < candidate.y + candidate.rows && bin.y + bin.rows > candidate.y);
  return overlap ? `That space is occupied by ${overlap.label || "another bin"}.` : null;
}
export function firstDrawerSpace(drawer, columns = 1, rows = 1, ignoreId) {
  const metrics = drawerMetrics(drawer);
  for (let y = 0; y <= metrics.rows - rows; y++) for (let x = 0; x <= metrics.columns - columns; x++) {
    if (!placementError(drawer, { x, y, columns, rows }, ignoreId)) return { x, y };
  }
  return null;
}
export function normalizeDrawerLayout(raw) {
  object(raw, ["type", "id", "layoutId", "name", "width", "depth", "height", "includeBaseplate", "baseplateMagnets", "floor", "wall", "bins", "replaceExisting", "binLimits", "cornerSpacers", "printArea"], "plan");
  if (raw.type !== "drawerLayout") fail("type must be drawerLayout");
  const id = text(raw.id, "id"), layoutId = text(raw.layoutId, "layoutId", id);
  if (!/^[a-zA-Z0-9_-]+$/.test(layoutId)) fail("layoutId must use letters, numbers, underscores or hyphens");
  const width = number(raw.width, 42, 881.99, "inside width"), depth = number(raw.depth, 42, 881.99, "inside depth");
  const height = number(raw.height, 14, 10000, "usable height");
  for (const key of ["includeBaseplate", "replaceExisting"]) if (raw[key] !== undefined && typeof raw[key] !== "boolean") fail(`${key} must be a boolean`);
  const result = { type: "drawerLayout", id, layoutId, name: text(raw.name, "name", "Drawer layout"), width, depth, height,
    includeBaseplate: raw.includeBaseplate !== false, baseplateMagnets: normalizeMagnetPockets(raw.baseplateMagnets, "baseplateMagnets"), replaceExisting: raw.replaceExisting === true,
    printArea: normalizePrintArea(raw.printArea), cornerSpacers: normalizeCornerSpacers(raw.cornerSpacers), binLimits: normalizeBinLimits(raw.binLimits), floor: number(raw.floor ?? 2, 0.8, 6, "floor"), wall: number(raw.wall ?? 1.2, 0.8, 4, "wall"), bins: [] };
  if (result.baseplateMagnets && !result.includeBaseplate) fail("baseplate magnet pockets require matching baseplates");
  if (!Array.isArray(raw.bins) || raw.bins.length > DRAWER_LIMITS.bins) fail(`use between 0 and ${DRAWER_LIMITS.bins} bins`);
  if (!raw.bins.length && !result.includeBaseplate) fail("Enable matching baseplates or add a bin before previewing.");
  const ids = new Set();
  for (const [i, entry] of raw.bins.entries()) {
    object(entry, ["id", "label", "x", "y", "columns", "rows", "heightUnits", "kind", "dividers", "lip", "magnets", "openSides"], `bin ${i + 1}`);
    const bin = { id: text(entry.id, `bin ${i + 1} id`), label: text(entry.label, `bin ${i + 1} label`, `Bin ${i + 1}`),
      x: number(entry.x, 0, 19, "column", true), y: number(entry.y, 0, 19, "row", true),
      columns: number(entry.columns, 1, GRIDFINITY_LIMITS.columns, "bin width", true), rows: number(entry.rows, 1, GRIDFINITY_LIMITS.rows, "bin depth", true),
      heightUnits: number(entry.heightUnits ?? 3, 2, 12, "bin height", true), kind: entry.kind ?? "bin", openSides: normalizeOpenSides(entry.openSides, `${entry.label || entry.id} openSides`), lip: entry.lip === true, magnets: normalizeMagnetPockets(entry.magnets, `${entry.label || entry.id} magnets`) };
    if (ids.has(bin.id)) fail("bin ids must be unique"); ids.add(bin.id);
    if (!["bin", "insert"].includes(bin.kind)) fail("parts must be bins or insert blanks");
    if (bin.kind !== "bin" && bin.openSides.length) fail("insert blanks do not support open sides");
    if (entry.lip !== undefined && typeof entry.lip !== "boolean") fail("stacking lip must be a boolean");
    const dividers = object(entry.dividers ?? {}, ["x", "y"], "compartments");
    bin.dividers = { x: number(dividers.x ?? 0, 0, 6, "width dividers", true), y: number(dividers.y ?? 0, 0, 6, "depth dividers", true) };
    if (bin.kind === "insert" && (bin.lip || bin.dividers.x || bin.dividers.y)) fail("insert blanks do not use dividers or stacking lips");
    const baseZ = drawerBinBaseZ(result);
    if ((bin.kind === "bin" ? binTotalHeight({ ...bin, floor: result.floor }) : bin.heightUnits * 7) + baseZ > height + 1e-7) fail(`${bin.label} is too tall for the drawer; reduce its height or stacking lip`);
    if (bin.kind === "bin" && bin.heightUnits * 7 - 7 - result.floor < 1) fail(`${bin.label} has insufficient space above its floor`);
    const error = placementError(result, bin); if (error) fail(`${bin.label}: ${error}`);
    result.bins.push(bin);
  }
  const metrics = drawerMetrics(result);
  if (metrics.columns > 20 || metrics.rows > 20) fail("use at most 20 cells per drawer direction");
  if (metrics.occupied > DRAWER_LIMITS.cells || result.includeBaseplate && metrics.total > DRAWER_LIMITS.cells) fail("preview up to 144 grid cells at a time; divide a larger drawer into sections");
  const tiles = result.includeBaseplate ? baseplateTileLimits(result.printArea, metrics) : { columns: 4, rows: 4 };
  if (result.includeBaseplate) checkPrintFit(result.printArea, Math.min(tiles.columns, metrics.columns) * 42, Math.min(tiles.rows, metrics.rows) * 42, 5 + magnetCarrierHeight(result.baseplateMagnets), "Baseplate");
  for (const stop of cornerSpacerParts(result, metrics)) checkPrintFit(result.printArea, Math.max(...stop.rectangles.map(rect => rect.width)), Math.max(...stop.rectangles.map(rect => rect.depth)), stop.height, stop.name);
  return result;
}
export function drawerParts(raw) {
  const drawer = normalizeDrawerLayout(raw), m = drawerMetrics(drawer), parts = [];
  const part = (id, kind, x, y, columns, rows, extra = {}) => ({ id, type: "gridfinity", kind, columns, rows,
    position: [(x + columns / 2) * 42 - m.gridWidth / 2, (y + rows / 2) * 42 - m.gridDepth / 2, kind === "baseplate" ? 0 : drawerBinBaseZ(drawer)], ...extra });
  for (const bin of drawer.bins) parts.push(part(bin.id, bin.kind, bin.x, bin.y, bin.columns, bin.rows,
    { name: bin.label, heightUnits: bin.heightUnits, floor: drawer.floor, wall: drawer.wall, lip: bin.lip, openSides: bin.openSides, dividers: bin.dividers, magnets: bin.magnets }));
  const tile = drawer.includeBaseplate ? baseplateTileLimits(drawer.printArea, m) : { columns: 4, rows: 4 };
  if (drawer.includeBaseplate) for (let y = 0; y < m.rows; y += tile.rows) for (let x = 0; x < m.columns; x += tile.columns) {
    parts.push(part(`baseplate-${x}-${y}`, "baseplate", x, y, Math.min(tile.columns, m.columns - x), Math.min(tile.rows, m.rows - y), { name: `Baseplate ${x / tile.columns + 1}, ${y / tile.rows + 1}`, magnets: drawer.baseplateMagnets }));
  }
  parts.push(...cornerSpacerParts(drawer, m));
  if (new Set(parts.map(part => part.id)).size !== parts.length) fail("Bin ids conflict with generated baseplate or spacer ids; rename the bin id.");
  return parts;
}
export function fillDrawerGaps(drawer, makeBin) {
  checkPrintFit(drawer.printArea, 41.5, 41.5, 14, "Minimum size bin");
  const next = structuredClone(drawer), { columns, rows } = drawerMetrics(next);
  const limits = normalizeBinLimits(drawer.binLimits);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (placementError(next, { x, y, columns: 1, rows: 1 })) continue;
    let best = { x, y, columns: 1, rows: 1 };
    for (let w = 1; w <= limits.columns; w++) for (let d = 1; d <= limits.rows; d++) {
      const candidate = { x, y, columns: w, rows: d };
      if (w * d > best.columns * best.rows && !placementError(next, candidate)) best = candidate;
    }
    if (next.bins.length >= DRAWER_LIMITS.bins) fail("the drawer needs more than 16 parts; remove small bins or plan a section");
    next.bins.push(makeBin(best));
  }
  normalizeDrawerLayout(next);
  return next;
}
