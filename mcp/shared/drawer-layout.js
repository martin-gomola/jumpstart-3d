// Drawer planning uses grid cells; the native Gridfinity generator owns interface geometry.
export const DRAWER_LIMITS = Object.freeze({ axisCells: 20, cells: 144, bins: 16, partCells: 4 });
export const GRID_PITCH = 42;
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
  if (candidate.columns < 1 || candidate.rows < 1 || candidate.columns > 4 || candidate.rows > 4) return "Each part can span 1 to 4 cells in either direction.";
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.columns > columns || candidate.y + candidate.rows > rows) return "Keep the bin inside the drawer grid.";
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
  object(raw, ["type", "id", "layoutId", "name", "width", "depth", "height", "includeBaseplate", "floor", "wall", "bins", "replaceExisting"], "plan");
  if (raw.type !== "drawerLayout") fail("type must be drawerLayout");
  const id = text(raw.id, "id"), layoutId = text(raw.layoutId, "layoutId", id);
  if (!/^[a-zA-Z0-9_-]+$/.test(layoutId)) fail("layoutId must use letters, numbers, underscores or hyphens");
  const width = number(raw.width, 42, 881.99, "inside width"), depth = number(raw.depth, 42, 881.99, "inside depth");
  const height = number(raw.height, 14, 10000, "usable height");
  for (const key of ["includeBaseplate", "replaceExisting"]) if (raw[key] !== undefined && typeof raw[key] !== "boolean") fail(`${key} must be a boolean`);
  const result = { type: "drawerLayout", id, layoutId, name: text(raw.name, "name", "Drawer layout"), width, depth, height,
    includeBaseplate: raw.includeBaseplate !== false, replaceExisting: raw.replaceExisting === true,
    floor: number(raw.floor ?? 2, 0.8, 6, "floor"), wall: number(raw.wall ?? 1.2, 0.8, 4, "wall"), bins: [] };
  if (!Array.isArray(raw.bins) || !raw.bins.length || raw.bins.length > DRAWER_LIMITS.bins) fail(`add between 1 and ${DRAWER_LIMITS.bins} bins`);
  const ids = new Set();
  for (const [i, entry] of raw.bins.entries()) {
    object(entry, ["id", "label", "x", "y", "columns", "rows", "heightUnits", "kind", "dividers", "lip"], `bin ${i + 1}`);
    const bin = { id: text(entry.id, `bin ${i + 1} id`), label: text(entry.label, `bin ${i + 1} label`, `Bin ${i + 1}`),
      x: number(entry.x, 0, 19, "column", true), y: number(entry.y, 0, 19, "row", true),
      columns: number(entry.columns, 1, 4, "bin width", true), rows: number(entry.rows, 1, 4, "bin depth", true),
      heightUnits: number(entry.heightUnits ?? 3, 2, 12, "bin height", true), kind: entry.kind ?? "bin", lip: entry.lip === true };
    if (ids.has(bin.id)) fail("bin ids must be unique"); ids.add(bin.id);
    if (!["bin", "insert"].includes(bin.kind)) fail("parts must be bins or insert blanks");
    if (entry.lip !== undefined && typeof entry.lip !== "boolean") fail("stacking lip must be a boolean");
    const dividers = object(entry.dividers ?? {}, ["x", "y"], "compartments");
    bin.dividers = { x: number(dividers.x ?? 0, 0, 6, "width dividers", true), y: number(dividers.y ?? 0, 0, 6, "depth dividers", true) };
    if (bin.kind === "insert" && (bin.lip || bin.dividers.x || bin.dividers.y)) fail("insert blanks do not use dividers or stacking lips");
    const baseZ = result.includeBaseplate ? 0.25 : 0;
    if (bin.heightUnits * 7 + (bin.lip ? 4.4 : 0) + baseZ > height + 1e-7) fail(`${bin.label} is too tall for the drawer; reduce its height or stacking lip`);
    if (bin.kind === "bin" && bin.heightUnits * 7 - 7 - result.floor < 1) fail(`${bin.label} has insufficient space above its floor`);
    const error = placementError(result, bin); if (error) fail(`${bin.label}: ${error}`);
    result.bins.push(bin);
  }
  const metrics = drawerMetrics(result);
  if (metrics.columns > 20 || metrics.rows > 20) fail("use at most 20 cells per drawer direction");
  if (metrics.occupied > DRAWER_LIMITS.cells || result.includeBaseplate && metrics.total > DRAWER_LIMITS.cells) fail("preview up to 144 grid cells at a time; divide a larger drawer into sections");
  return result;
}
export function drawerParts(raw) {
  const drawer = normalizeDrawerLayout(raw), m = drawerMetrics(drawer), parts = [];
  const part = (id, kind, x, y, columns, rows, extra = {}) => ({ id, type: "gridfinity", kind, columns, rows,
    position: [(x + columns / 2) * 42 - m.gridWidth / 2, (y + rows / 2) * 42 - m.gridDepth / 2, kind === "baseplate" ? 0 : drawer.includeBaseplate ? 0.25 : 0], ...extra });
  for (const bin of drawer.bins) parts.push(part(bin.id, bin.kind, bin.x, bin.y, bin.columns, bin.rows,
    { name: bin.label, heightUnits: bin.heightUnits, floor: drawer.floor, wall: drawer.wall, lip: bin.lip, dividers: bin.dividers }));
  if (drawer.includeBaseplate) for (let y = 0; y < m.rows; y += 4) for (let x = 0; x < m.columns; x += 4) {
    parts.push(part(`baseplate-${x}-${y}`, "baseplate", x, y, Math.min(4, m.columns - x), Math.min(4, m.rows - y), { name: `Baseplate ${x / 4 + 1}, ${y / 4 + 1}` }));
  }
  return parts;
}
export function fillDrawerGaps(drawer, makeBin) {
  const next = structuredClone(drawer), { columns, rows } = drawerMetrics(next);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (placementError(next, { x, y, columns: 1, rows: 1 })) continue;
    let best = { x, y, columns: 1, rows: 1 };
    for (let w = 1; w <= 4; w++) for (let d = 1; d <= 4; d++) {
      const candidate = { x, y, columns: w, rows: d };
      if (w * d > best.columns * best.rows && !placementError(next, candidate)) best = candidate;
    }
    if (next.bins.length >= DRAWER_LIMITS.bins) fail("the drawer needs more than 16 parts; remove small bins or plan a section");
    next.bins.push(makeBin(best));
  }
  normalizeDrawerLayout(next);
  return next;
}
