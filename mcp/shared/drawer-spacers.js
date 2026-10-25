// Small native corner stops in the margins outside the centered baseplate grid.
export function normalizeCornerSpacers(value) {
  if (value === undefined || value === false) return false;
  const input = value === true ? {} : value;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["clearance", "height", "legLength"].includes(key))) throw new Error("Corner spacers accept clearance, height and legLength only.");
  const result = {};
  for (const [key, initial, min, max] of [["clearance", 0.2, 0, 1], ["height", 5, 1, 12], ["legLength", 20, 5, 60]]) {
    const amount = input[key] ?? initial;
    if (!Number.isFinite(amount) || amount < min || amount > max) throw new Error(`Corner spacer ${key} must be between ${min} and ${max} mm.`);
    result[key] = amount;
  }
  return result;
}
export function cornerSpacerParts(drawer, metrics) {
  const options = normalizeCornerSpacers(drawer.cornerSpacers);
  if (!options) return [];
  if (!drawer.includeBaseplate) throw new Error("Corner spacers require matching baseplates.");
  if (options.height > drawer.height) throw new Error("Corner spacers must fit below the drawer's usable height.");
  if (options.legLength > Math.min(metrics.gridWidth, metrics.gridDepth) / 2 - 1) throw new Error("Corner spacer legs would overlap; use shorter legs for this grid.");
  const gaps = [metrics.spareWidth / 2, metrics.spareDepth / 2];
  if (gaps.every(gap => gap === 0)) return [];
  for (const gap of gaps) if (gap > 0 && gap - options.clearance < 1) throw new Error("Corner spacer margin is too thin: leave at least 1 mm after clearance, or disable spacers.");
  return [[-1, -1, "front-left"], [1, -1, "front-right"], [-1, 1, "back-left"], [1, 1, "back-right"]].map(([sx, sy, corner]) => {
    const [tx, ty] = gaps.map(gap => gap > 0 ? gap - options.clearance : 0);
    const rectangles = [];
    if (tx) rectangles.push({ width: tx, depth: ty + options.legLength, x: -sx * tx / 2, y: -sy * (ty + options.legLength) / 2 });
    if (ty) rectangles.push({ width: tx + options.legLength, depth: ty, x: -sx * (tx + options.legLength) / 2, y: -sy * ty / 2 });
    return { id: `spacer-${corner}`, type: "drawerSpacer", name: `Corner spacer ${corner}`, corner,
      position: [sx * (drawer.width / 2 - (tx ? options.clearance : 0)), sy * (drawer.depth / 2 - (ty ? options.clearance : 0)), 0],
      rectangles, ...options };
  });
}
