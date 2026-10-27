import { normalizeOpenSides, normalizeCloseGaps, rotateOpenSides } from "./gridfinity-walls.js";
import { partEnvelope, partPrintFit, usableDepthError } from "./gridfinity-envelope.js";
import { normalizePrintArea, baseplateTileLimits, checkPrintFit } from "./print-area.js";
import { normalizeCornerSpacers, cornerSpacerParts } from "./drawer-spacers.js";
import { normalizeBaseplateClips, baseplateClipLayout } from "./baseplate-clips.js";
import { GRIDFINITY_LIMITS, normalizeBinLimits } from "./gridfinity-limits.js";
// Drawer planning uses grid cells; the native Gridfinity generator owns interface geometry.
import { normalizeMagnetPockets, magnetCarrierHeight } from "./gridfinity-magnets.js";
import { normalizePocket, POCKET_LIMITS } from "./pockets.js";
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
// A bin's own floor and wall override the drawer's defaults.
export const binFloor = (drawer, bin) => bin.floor ?? drawer.floor ?? 2;
export const binWall = (drawer, bin) => bin.wall ?? drawer.wall ?? 1.2;
const BIN_POCKET_KEYS = ["id", "profile", "position", "rotation", "depth", "clearance", "minimumFloor", "minimumWall", "merge", "sourceEvidence"];
// Bin pockets are pocket operations aimed at their own insert; the material limits default to its floor and wall.
export function binPocketOperation(drawer, bin, pocket) {
  return { ...pocket, type: "pocket", target: bin.id, minimumFloor: pocket.minimumFloor ?? binFloor(drawer, bin), minimumWall: pocket.minimumWall ?? binWall(drawer, bin) };
}
function normalizeBinPockets(drawer, bin, raw) {
  if (raw === undefined || Array.isArray(raw) && !raw.length) return undefined;
  if (bin.kind !== "insert") fail(`${bin.label}: only insert blanks take pockets`);
  if (!Array.isArray(raw) || raw.length > POCKET_LIMITS.count) fail(`${bin.label}: use at most ${POCKET_LIMITS.count} pockets`);
  const ids = new Set();
  return raw.map((entry, i) => {
    const label = `${bin.label} pocket ${i + 1}`;
    object(entry, BIN_POCKET_KEYS, label);
    const id = entry.id ?? `pocket-${i + 1}`;
    if (ids.has(id)) fail(`${bin.label}: pocket ids must be unique`); ids.add(id);
    const { type, target, ...pocket } = normalizePocket(binPocketOperation(drawer, bin, { ...entry, id }), label);
    if (entry.minimumFloor === undefined) delete pocket.minimumFloor;
    if (entry.minimumWall === undefined) delete pocket.minimumWall;
    return pocket;
  });
}
// Clockwise quarter turn in the bin's own XY plane, matching rotateOpenSides.
export function rotateBinPockets(pockets) {
  return pockets?.map(pocket => {
    const rotation = (pocket.rotation ?? 0) - 90;
    return { ...pocket, position: [(pocket.position?.[1] ?? 0) + 0, -(pocket.position?.[0] ?? 0) + 0], rotation: rotation <= -180 ? rotation + 360 : rotation };
  });
}
export function drawerMetrics(drawer) {
  const columns = Math.floor(drawer.width / GRID_PITCH), rows = Math.floor(drawer.depth / GRID_PITCH);
  const occupied = (drawer.bins || []).reduce((sum, bin) => sum + bin.columns * bin.rows, 0);
  return { columns, rows, gridWidth: columns * GRID_PITCH, gridDepth: rows * GRID_PITCH,
    spareWidth: drawer.width - columns * GRID_PITCH, spareDepth: drawer.depth - rows * GRID_PITCH,
    occupied, total: columns * rows, fill: columns * rows ? Math.round(occupied / (columns * rows) * 100) : 0 };
}
// Rotate the complete draft clockwise, including directional bin features.
// Empty drawers can be oriented before the usable height is entered.
export function rotateDrawerLayout(drawer) {
  const width = number(drawer.width, 42, 881.99, "inside width"), depth = number(drawer.depth, 42, 881.99, "inside depth");
  if (drawer.bins.length) normalizeDrawerLayout(drawer);
  const next = structuredClone(drawer), columns = Math.floor(width / GRID_PITCH);
  next.width = depth; next.depth = width;
  const limits = normalizeBinLimits(drawer.binLimits);
  next.binLimits = { columns: limits.rows, rows: limits.columns };
  next.bins = next.bins.map(bin => ({ ...bin, x: bin.y, y: columns - bin.x - bin.columns,
    columns: bin.rows, rows: bin.columns, dividers: { x: bin.dividers?.y ?? 0, y: bin.dividers?.x ?? 0 }, openSides: rotateOpenSides(bin.openSides),
    ...(bin.pockets ? { pockets: rotateBinPockets(bin.pockets) } : {}) }));
  if (next.bins.length) normalizeDrawerLayout(next);
  return next;
}
export function placementError(drawer, candidate, ignoreId) {
  const { columns, rows } = drawerMetrics(drawer);
  if (![candidate.x, candidate.y, candidate.columns, candidate.rows].every(Number.isInteger)) return "Place bins on whole grid cells.";
  const limits = normalizeBinLimits(drawer.binLimits);
  if (candidate.columns < 1 || candidate.rows < 1 || candidate.columns > limits.columns || candidate.rows > limits.rows) return `Bin exceeds the configured ${limits.columns} × ${limits.rows} cell limit. Adjust Gridfinity Settings.`;
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.columns > columns || candidate.y + candidate.rows > rows) return "Keep the bin inside the drawer grid.";
  try { partPrintFit({ ...candidate, kind: candidate.kind ?? "bin", heightUnits: candidate.heightUnits ?? 2, floor: binFloor(drawer, candidate) }, drawer.printArea, candidate.label || "Bin"); } catch (error) { return error.message; }
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
  object(raw, ["type", "id", "layoutId", "name", "width", "depth", "height", "includeBaseplate", "baseplateMagnets", "baseplateClips", "floor", "wall", "bins", "replaceExisting", "binLimits", "cornerSpacers", "printArea"], "plan");
  if (raw.type !== "drawerLayout") fail("type must be drawerLayout");
  const id = text(raw.id, "id"), layoutId = text(raw.layoutId, "layoutId", id);
  if (!/^[a-zA-Z0-9_-]+$/.test(layoutId)) fail("layoutId must use letters, numbers, underscores or hyphens");
  const width = number(raw.width, 42, 881.99, "inside width"), depth = number(raw.depth, 42, 881.99, "inside depth");
  const height = number(raw.height, 14, 10000, "usable height");
  for (const key of ["includeBaseplate", "replaceExisting"]) if (raw[key] !== undefined && typeof raw[key] !== "boolean") fail(`${key} must be a boolean`);
  const result = { type: "drawerLayout", id, layoutId, name: text(raw.name, "name", "Drawer layout"), width, depth, height,
    includeBaseplate: raw.includeBaseplate !== false, baseplateMagnets: normalizeMagnetPockets(raw.baseplateMagnets, "baseplateMagnets"), baseplateClips: normalizeBaseplateClips(raw.baseplateClips), replaceExisting: raw.replaceExisting === true,
    printArea: normalizePrintArea(raw.printArea), cornerSpacers: normalizeCornerSpacers(raw.cornerSpacers), binLimits: normalizeBinLimits(raw.binLimits), floor: number(raw.floor ?? 2, 0.8, 6, "floor"), wall: number(raw.wall ?? 1.2, 0.8, 4, "wall"), bins: [] };
  if (result.baseplateMagnets && !result.includeBaseplate) fail("baseplate magnet pockets require matching baseplates");
  if (result.baseplateClips && !result.includeBaseplate) fail("baseplate clips require matching baseplates");
  if (!Array.isArray(raw.bins) || raw.bins.length > DRAWER_LIMITS.bins) fail(`use between 0 and ${DRAWER_LIMITS.bins} bins`);
  if (!raw.bins.length && !result.includeBaseplate) fail("Enable matching baseplates or add a bin before previewing.");
  const ids = new Set();
  for (const [i, entry] of raw.bins.entries()) {
    object(entry, ["id", "label", "x", "y", "columns", "rows", "heightUnits", "kind", "dividers", "lip", "magnets", "openSides", "closeGaps", "floor", "wall", "pockets"], `bin ${i + 1}`);
    const bin = { id: text(entry.id, `bin ${i + 1} id`), label: text(entry.label, `bin ${i + 1} label`, `Bin ${i + 1}`),
      x: number(entry.x, 0, 19, "column", true), y: number(entry.y, 0, 19, "row", true),
      columns: number(entry.columns, 1, GRIDFINITY_LIMITS.columns, "bin width", true), rows: number(entry.rows, 1, GRIDFINITY_LIMITS.rows, "bin depth", true),
      heightUnits: number(entry.heightUnits ?? 3, 2, 12, "bin height", true), kind: entry.kind ?? "bin", openSides: normalizeOpenSides(entry.openSides, `${entry.label || entry.id} openSides`), lip: entry.lip === true, magnets: normalizeMagnetPockets(entry.magnets, `${entry.label || entry.id} magnets`) };
    bin.closeGaps = normalizeCloseGaps(entry.closeGaps, bin.openSides, bin.kind);
    if (ids.has(bin.id)) fail("bin ids must be unique"); ids.add(bin.id);
    if (!["bin", "insert"].includes(bin.kind)) fail("parts must be bins or insert blanks");
    if (bin.kind !== "bin" && bin.openSides.length) fail("insert blanks do not support open sides");
    if (entry.lip !== undefined && typeof entry.lip !== "boolean") fail("stacking lip must be a boolean");
    const dividers = object(entry.dividers ?? {}, ["x", "y"], "compartments");
    bin.dividers = { x: number(dividers.x ?? 0, 0, 6, "width dividers", true), y: number(dividers.y ?? 0, 0, 6, "depth dividers", true) };
    if (bin.kind === "insert" && (bin.lip || bin.dividers.x || bin.dividers.y)) fail("insert blanks do not use dividers or stacking lips");
    if (entry.floor !== undefined) bin.floor = number(entry.floor, 0.8, 6, `${bin.label} floor`);
    if (entry.wall !== undefined) bin.wall = number(entry.wall, 0.8, 4, `${bin.label} wall`);
    const pockets = normalizeBinPockets(result, bin, entry.pockets);
    if (pockets) bin.pockets = pockets;
    const baseZ = drawerBinBaseZ(result), floor = binFloor(result, bin);
    if (partEnvelope({ ...bin, floor }).height + baseZ > height + 1e-7) fail(`${bin.label} is too tall for the drawer; reduce its height or stacking lip`);
    const depthError = usableDepthError({ ...bin, floor }, bin.label); if (depthError) fail(depthError);
    const error = placementError(result, bin); if (error) fail(`${bin.label}: ${error}`);
    result.bins.push(bin);
  }
  const metrics = drawerMetrics(result);
  if (metrics.columns > 20 || metrics.rows > 20) fail("use at most 20 cells per drawer direction");
  if (metrics.occupied > DRAWER_LIMITS.cells || result.includeBaseplate && metrics.total > DRAWER_LIMITS.cells) fail("preview up to 144 grid cells at a time; divide a larger drawer into sections");
  const tiles = result.includeBaseplate ? baseplateTileLimits(result.printArea, metrics) : { columns: 4, rows: 4 };
  if (result.includeBaseplate) partPrintFit({ kind: "baseplate", columns: Math.min(tiles.columns, metrics.columns), rows: Math.min(tiles.rows, metrics.rows), magnets: result.baseplateMagnets }, result.printArea, "Baseplate");
  for (const stop of cornerSpacerParts(result, metrics)) checkPrintFit(result.printArea, Math.max(...stop.rectangles.map(rect => rect.width)), Math.max(...stop.rectangles.map(rect => rect.depth)), stop.height, stop.name);
  return result;
}
export function drawerParts(raw) {
  const drawer = normalizeDrawerLayout(raw), m = drawerMetrics(drawer), parts = [];
  const part = (id, kind, x, y, columns, rows, extra = {}) => ({ id, type: "gridfinity", kind, columns, rows,
    position: [(x + columns / 2) * 42 - m.gridWidth / 2, (y + rows / 2) * 42 - m.gridDepth / 2, kind === "baseplate" ? 0 : drawerBinBaseZ(drawer)], ...extra });
  for (const bin of drawer.bins) parts.push(part(bin.id, bin.kind, bin.x, bin.y, bin.columns, bin.rows,
    { name: bin.label, heightUnits: bin.heightUnits, floor: binFloor(drawer, bin), wall: binWall(drawer, bin), lip: bin.lip, openSides: bin.openSides, closeGaps: bin.closeGaps, dividers: bin.dividers, magnets: bin.magnets,
      ...(bin.pockets ? { pockets: bin.pockets.map(pocket => binPocketOperation(drawer, bin, pocket)) } : {}) }));
  const tile = drawer.includeBaseplate ? baseplateTileLimits(drawer.printArea, m) : { columns: 4, rows: 4 };
  const clips = baseplateClipLayout(drawer, m, tile);
  if (drawer.includeBaseplate) for (let y = 0; y < m.rows; y += tile.rows) for (let x = 0; x < m.columns; x += tile.columns) {
    const clipSlots = clips.slots.get(`baseplate-${x}-${y}`);
    parts.push(part(`baseplate-${x}-${y}`, "baseplate", x, y, Math.min(tile.columns, m.columns - x), Math.min(tile.rows, m.rows - y), { name: `Baseplate ${x / tile.columns + 1}, ${y / tile.rows + 1}`, magnets: drawer.baseplateMagnets, ...(clipSlots ? { clipSlots } : {}) }));
  }
  parts.push(...clips.clips, ...cornerSpacerParts(drawer, m));
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
